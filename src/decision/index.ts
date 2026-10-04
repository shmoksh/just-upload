import type {
  Consent,
  CropRect,
  Decision,
  ImageInfo,
  OutputFormat,
  TransformOptions,
  TransformResult,
  UploadRequirements,
} from '../models';
import {
  allowedOutputs,
  conflictingRules,
  evaluateCompatibility,
  sameRatio,
} from '../compatibility';
import { isLossy, isOutputFormat, keepsTransparency } from '../formats';

export interface Preferences {
  askBeforeQualityChanges: boolean;
}
export const DEFAULT_PREFERENCES: Preferences = {
  askBeforeQualityChanges: true,
};

/**
 * At or above this share of the original's quality (see images/quality.ts), the prepared
 * image looks the same. Below it, the person is asked first. Calibrated on photos: JPEG
 * quality 85–92 at full size keeps 99–100%, while visibly smeared texture keeps under 95%.
 */
export const LOOKS_THE_SAME = 97;

/** Enlarging by up to 10% is visually negligible; anything more is the person's call. */
const SILENT_UPSCALE_LIMIT = 1.1;

/** The consent that leads a confirmation; its wording and button come first. */
const CONSENT_ORDER: readonly Consent[] = [
  'crop',
  'page',
  'sheet',
  'transparency',
  'animation',
  'palette',
  'upscale',
  'shrink',
  'quality',
];

/**
 * Whether the website states a pixel size an image may be brought to: a maximum, an
 * exact size, or an icon (which holds at most 256 × 256). Without one, Just Upload never
 * changes an image's pixel size.
 */
export function statesPixelSize(requirements: UploadRequirements): boolean {
  const iconOnly =
    requirements.acceptedMimeTypes.length + requirements.acceptedExtensions.length > 0 &&
    [...requirements.acceptedMimeTypes, ...requirements.acceptedExtensions].every((type) =>
      /icon|\.ico$|\.cur$/i.test(type),
    );
  return Boolean(
    requirements.maxWidth ||
    requirements.maxHeight ||
    requirements.exactWidth ||
    requirements.exactHeight ||
    iconOnly,
  );
}

export function targetRatio(requirements: UploadRequirements): number | undefined {
  const { aspectRatio, exactWidth, exactHeight } = requirements;
  return aspectRatio ?? (exactWidth && exactHeight ? exactWidth / exactHeight : undefined);
}

/** The largest centred region of the image with the required shape. */
export function defaultCrop(width: number, height: number, ratio: number): CropRect {
  const cropWidth = Math.min(width, height * ratio);
  const cropHeight = cropWidth / ratio;
  return {
    x: (width - cropWidth) / 2,
    y: (height - cropHeight) / 2,
    width: cropWidth,
    height: cropHeight,
  };
}

/** How much the image must grow (>1) or shrink (<1) to meet size rules; 1 when it fits. */
export function requiredScale(
  width: number,
  height: number,
  requirements: UploadRequirements,
): number {
  const { exactWidth, exactHeight, minWidth, minHeight, maxWidth, maxHeight } = requirements;
  if (exactWidth) return exactWidth / width;
  if (exactHeight) return exactHeight / height;
  const grow = Math.max(1, (minWidth ?? 0) / width, (minHeight ?? 0) / height);
  if (grow > 1) return grow;
  return Math.min(1, (maxWidth ?? Infinity) / width, (maxHeight ?? Infinity) / height);
}

/** For photos: the best-looking small file first. */
const PHOTO_ORDER: readonly OutputFormat[] = [
  'jpeg',
  'webp',
  'avif',
  'png',
  'tiff',
  'bmp',
  'gif',
  'ico',
];
/** For images with transparency: formats that keep it first. */
const TRANSPARENT_ORDER: readonly OutputFormat[] = [
  'png',
  'webp',
  'avif',
  'tiff',
  'gif',
  'ico',
  'jpeg',
  'bmp',
];

/**
 * Prefers the original format; otherwise JPEG for photos and PNG when transparency
 * matters. A lossless original (PNG, TIFF, BMP, GIF, ICO) that is simply too heavy
 * becomes a lossy format when allowed, since lossless formats can only shrink by losing
 * pixels.
 */
export function chooseOutput(
  info: ImageInfo,
  requirements: UploadRequirements,
): OutputFormat | undefined {
  const allowed = allowedOutputs(requirements);
  const pick = (order: readonly OutputFormat[]) => order.find((format) => allowed.includes(format));
  const original =
    isOutputFormat(info.format) && allowed.includes(info.format) ? info.format : undefined;
  const tooHeavy = requirements.maxBytes !== undefined && info.bytes > requirements.maxBytes;
  if (original && tooHeavy && !isLossy(original) && !info.transparent) {
    return pick(PHOTO_ORDER.filter(isLossy)) ?? original;
  }
  return original ?? pick(info.transparent ? TRANSPARENT_ORDER : PHOTO_ORDER);
}

export function decide(info: ImageInfo, requirements: UploadRequirements): Decision {
  const issues = evaluateCompatibility(info, requirements);
  if (!issues.length) return { action: 'PASS_THROUGH', issues, consents: [] };
  if (issues.includes('unknown') || conflictingRules(requirements)) {
    return { action: 'UNSAFE_TO_FIX', issues, consents: [] };
  }
  const outputFormat = chooseOutput(info, requirements);
  if (!outputFormat) return { action: 'UNSAFE_TO_FIX', issues, consents: [] };

  const consents = new Set<Consent>();
  const ratio = targetRatio(requirements);
  let { width, height } = info;
  if (ratio && !sameRatio(width, height, ratio)) {
    consents.add('crop');
    ({ width, height } = defaultCrop(width, height, ratio));
  }
  if (info.transparent && !keepsTransparency(outputFormat)) consents.add('transparency');
  if (info.animated) consents.add('animation');
  if ((info.pages ?? 1) > 1) consents.add('page');
  // 256 colours can make a photo look banded; asked unless it already was a GIF.
  if (outputFormat === 'gif' && info.format !== 'gif') consents.add('palette');
  const scale = requiredScale(width, height, requirements);
  if (scale > SILENT_UPSCALE_LIMIT) consents.add('upscale');
  // Shrinking to dimensions the website itself states is what it asked for. Shrinking
  // for any other reason (a file-size limit no quality can meet at full size) is asked
  // about once the smaller copy is ready, from the result (see needsShrinkConsent).
  const ordered = CONSENT_ORDER.filter((consent) => consents.has(consent));
  return {
    action: ordered.length ? 'USER_CONFIRMATION' : 'AUTO_FIX',
    issues,
    outputFormat,
    consents: ordered,
  };
}

/**
 * Options for the transform once a decision is approved (or needs no approval). Meeting
 * a file-size limit is always attempted; whether the result is good enough to use
 * without asking is decided afterwards, from what it actually looks like.
 */
export function transformOptions(
  decision: Decision,
  crop?: CropRect,
  sheet?: number,
): TransformOptions {
  const consented = (consent: Consent) => decision.consents.includes(consent);
  return {
    outputFormat: decision.outputFormat ?? 'jpeg',
    ...(crop ? { crop } : {}),
    ...(sheet ? { sheet } : {}),
    allowTransparencyLoss: consented('transparency'),
    allowAnimationLoss: consented('animation'),
    allowUpscale: true,
  };
}

/**
 * Whether a prepared file needs the person's OK before the site gets it: meeting the
 * site's file-size limit made it look visibly worse than the original. A conversion the
 * limit did not squeeze is already as good as the required format allows (the transform
 * saves it at the format's highest quality when the usual one shows), so there is nothing
 * better to offer.
 */
export function needsQualityConsent(
  result: Pick<TransformResult, 'qualityKept' | 'sizeLimited'>,
  preferences: Preferences,
): boolean {
  return (
    preferences.askBeforeQualityChanges && result.sizeLimited && result.qualityKept < LOOKS_THE_SAME
  );
}

/**
 * Whether a prepared file has fewer pixels than the website asks for, to fit its
 * file-size limit. Always asked, whatever the quality setting: Just Upload never changes
 * a file's pixel size on its own unless the website states one.
 */
export function needsShrinkConsent(result: Pick<TransformResult, 'resizedToFit'>): boolean {
  return result.resizedToFit;
}

/** What to ask before a prepared file is used, if anything: fewer pixels, or quality. */
export function consentFor(
  result: Pick<TransformResult, 'qualityKept' | 'sizeLimited' | 'resizedToFit'>,
  preferences: Preferences,
): 'shrink' | 'quality' | undefined {
  if (needsShrinkConsent(result)) return 'shrink';
  return needsQualityConsent(result, preferences) ? 'quality' : undefined;
}
