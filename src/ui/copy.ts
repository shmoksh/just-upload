import type {
  Consent,
  Decision,
  ImageFormat,
  TransformResult,
  UploadRequirements,
} from '../models';
import { LOOKS_THE_SAME, targetRatio } from '../decision';
import { FORMATS, formatFromExtension, formatFromMime } from '../formats';
import type { ErrorCode } from '../utils/errors';
import { formatBytes } from '../utils/files';

// Every word a person sees on a website comes from here. Plain language only: no
// encoders or pixel math. Quality is one number, the share of the original's look kept.

export const formatLabel = (format: ImageFormat): string =>
  format === 'unknown' ? 'image' : FORMATS[format].label;

/** One side of a change, shown as a small tag: "HEIC" and "3.1 MB", or "600 × 600". */
export interface ReceiptTag {
  name: string;
  size?: string;
}

/** The change at a glance: what was chosen, what the site gets, and the quality kept. */
export interface Receipt {
  from?: ReceiptTag;
  to?: ReceiptTag;
  /** Words in place of tags, e.g. "3 images, in order". */
  note?: string;
  quality: string;
  /** Below what the eye can tell apart; shown in amber. */
  noticeable: boolean;
  /** The pixel change, when the image was made smaller or larger: "3024 × 4032 → 2872 × 3829". */
  pixels?: { from: string; to: string };
}

export interface ToastCopy {
  title: string;
  /** The whole message as one sentence: what is read aloud. */
  detail?: string;
  receipt?: Receipt;
}

const qualityText = (low: number, high = low) =>
  low === high ? `Quality kept: ${low}%` : `Quality kept: ${low}–${high}%`;
const percent = (low: number, high = low) => (low === high ? `${low}%` : `${low}–${high}%`);
const pixels = (width: number, height: number) => `${width} × ${height}`;

/** "HEIC → JPG · 5.8 MB → 1.8 MB · Quality kept: 98%" */
export function successCopy(results: TransformResult[]): ToastCopy {
  if (results.length > 1) {
    const kept = results.map((result) => result.qualityKept);
    const [low, high] = [Math.min(...kept), Math.max(...kept)];
    return {
      title: 'Ready to upload',
      detail: `${results.length} images prepared, in the same order · ${qualityText(low, high)}`,
      receipt: {
        note: `${results.length} images, in the same order`,
        quality: percent(low, high),
        noticeable: low < LOOKS_THE_SAME,
      },
    };
  }
  const [result] = results;
  if (!result) return { title: 'Ready to upload' };
  const parts: string[] = [];
  const converted = result.originalFormat !== result.finalFormat;
  if (converted) {
    parts.push(`${formatLabel(result.originalFormat)} → ${formatLabel(result.finalFormat)}`);
  } else if (result.changes.includes('cropped')) parts.push('Cropped');
  else if (result.changes.includes('resized')) parts.push('Resized to fit');
  else if (result.changes.includes('raised-to-minimum'))
    parts.push('Brought up to the site’s minimum');
  else parts.push('Made smaller');
  // A converted JPG is often larger than its HEIC; only a smaller size is worth mentioning.
  // A file brought up to a site's minimum grew on purpose: that is worth showing too.
  const smaller =
    (result.finalSize < result.originalSize || result.changes.includes('raised-to-minimum')) &&
    formatBytes(result.originalSize) !== formatBytes(result.finalSize);
  if (smaller) {
    parts.push(`${formatBytes(result.originalSize)} → ${formatBytes(result.finalSize)}`);
  }
  parts.push(qualityText(result.qualityKept));

  const before = smaller ? formatBytes(result.originalSize) : undefined;
  const after = smaller ? formatBytes(result.finalSize) : undefined;
  const receipt: Receipt = {
    quality: percent(result.qualityKept),
    noticeable: result.qualityKept < LOOKS_THE_SAME,
  };
  if (converted) {
    receipt.from = { name: formatLabel(result.originalFormat), size: before };
    receipt.to = { name: formatLabel(result.finalFormat), size: after };
  } else if (result.changes.includes('cropped')) {
    receipt.note = 'Cropped to';
    receipt.to = { name: pixels(result.finalWidth, result.finalHeight) };
  } else if (result.changes.includes('resized')) {
    receipt.from = { name: pixels(result.originalWidth, result.originalHeight) };
    receipt.to = { name: pixels(result.finalWidth, result.finalHeight) };
  } else {
    receipt.from = { name: formatLabel(result.originalFormat), size: before };
    receipt.to = { name: formatLabel(result.finalFormat), size: after };
  }
  // When the tags show the format, a change in pixels gets a line of its own.
  if (converted && result.changes.includes('resized')) {
    receipt.pixels = {
      from: pixels(result.originalWidth, result.originalHeight),
      to: pixels(result.finalWidth, result.finalHeight),
    };
    parts.splice(-1, 0, `${receipt.pixels.from} → ${receipt.pixels.to}`);
  }
  return { title: 'Ready to upload', detail: parts.join(' · '), receipt };
}

export function processingCopy(count: number, fraction?: number): ToastCopy {
  const title = count > 1 ? 'Preparing images…' : 'Preparing image…';
  // Only very large images take long enough for progress to mean anything.
  return { title: fraction === undefined ? title : `${title} ${Math.floor(fraction * 100)}%` };
}

/**
 * When preparation fails, the site gets the original (fail open), unless the file only
 * became selectable because Just Upload widened the picker; then it is removed.
 */
export function failureCopy(code: ErrorCode, removed: boolean): ToastCopy {
  if (removed)
    return { title: 'Couldn’t prepare this image', detail: 'Please choose a different file.' };
  if (code === 'too-large-to-process') {
    return {
      title: 'This image is too large to prepare at full size',
      detail: 'Your original file is still selected.',
    };
  }
  if (code === 'target-unreachable') {
    return {
      title: 'Couldn’t fit this image at full size',
      detail: 'Your original file is still selected.',
    };
  }
  return {
    title: 'Couldn’t safely prepare this image',
    detail: 'Your original file is still selected.',
  };
}

export interface DialogCopy {
  title: string;
  body: string;
  notes: string[];
  confirm: string;
  decline: string;
}

function shapeName(ratio: number): string {
  if (Math.abs(ratio - 1) < 0.02) return 'a square';
  return ratio > 1 ? 'a wide' : 'a tall';
}

const LEAD: Record<
  Consent,
  (
    requirements: UploadRequirements,
    decision: Decision,
    quality: number,
  ) => Omit<DialogCopy, 'notes' | 'decline'>
> = {
  crop: (requirements) => ({
    title: `This site needs ${shapeName(targetRatio(requirements) ?? 1)} photo`,
    body: 'Drag to choose the part to keep.',
    confirm: 'Use this crop',
  }),
  transparency: (_requirements, decision) => ({
    title: `This site only accepts ${formatLabel(decision.outputFormat ?? 'jpeg')}`,
    body: 'Your image has a transparent background. It will be filled with white.',
    confirm: 'Convert & upload',
  }),
  animation: () => ({
    title: 'This site needs a single image',
    body: 'Only the first frame (or page) of your file will be used.',
    confirm: 'Use first frame',
  }),
  palette: () => ({
    title: 'This site only accepts GIF',
    body: 'GIF can show only 256 colours, so photos may look a little grainy.',
    confirm: 'Convert & upload',
  }),
  upscale: () => ({
    title: 'This site needs a bigger image',
    body: 'Your image will be enlarged to fit. It may look a little soft.',
    confirm: 'Enlarge & upload',
  }),
  quality: (_requirements, _decision, quality) => ({
    title: 'Some quality would be lost',
    body: `Quality kept: ${quality}% of your photo. That’s the best that fits this site’s limits.`,
    confirm: `Upload at ${quality}%`,
  }),
};

const NOTE: Record<Consent, string> = {
  crop: 'It will be cropped to fit.',
  transparency: 'The transparent background will be filled with white.',
  animation: 'Only the first frame (or page) will be used.',
  palette: 'It will be saved as a GIF with fewer colours.',
  upscale: 'It will be enlarged, so it may look a little soft.',
  quality: 'Some quality will be lost.',
};

export function dialogCopy(
  decision: Decision,
  requirements: UploadRequirements,
  removeOnDecline: boolean,
  quality = 100,
): DialogCopy {
  const [lead = 'quality', ...others] = decision.consents;
  return {
    ...LEAD[lead](requirements, decision, quality),
    notes: others.map((consent) => NOTE[consent]),
    decline: removeOnDecline ? 'Cancel' : 'Use original',
  };
}

/** A field's rules in one short line, e.g. "JPG, PNG · max 2 MB · 600 × 600". */
export function rulesSummary(requirements: UploadRequirements): string {
  const parts: string[] = [];
  const formats = [
    ...requirements.acceptedMimeTypes.map(formatFromMime),
    ...requirements.acceptedExtensions.map(formatFromExtension),
  ];
  const labels = [...new Set(formats.filter(Boolean).map((format) => FORMATS[format!].label))];
  if (labels.length) parts.push(labels.join(', '));
  else if (requirements.acceptedMimeTypes.includes('image/*')) parts.push('any image');
  const { minBytes, maxBytes } = requirements;
  if (minBytes && maxBytes) parts.push(`${formatBytes(minBytes)}–${formatBytes(maxBytes)}`);
  else if (maxBytes) parts.push(`max ${formatBytes(maxBytes)}`);
  else if (minBytes) parts.push(`at least ${formatBytes(minBytes)}`);
  const { exactWidth, exactHeight, minWidth, minHeight, maxWidth, maxHeight, aspectRatio } =
    requirements;
  if (exactWidth || exactHeight) parts.push(`${exactWidth ?? 'any'} × ${exactHeight ?? 'any'}`);
  if (minWidth || minHeight) parts.push(`at least ${minWidth ?? 'any'} × ${minHeight ?? 'any'}`);
  if (maxWidth || maxHeight) parts.push(`at most ${maxWidth ?? 'any'} × ${maxHeight ?? 'any'}`);
  if (aspectRatio && !exactWidth) parts.push(`shape ${Number(aspectRatio.toFixed(3))} : 1`);
  return parts.join(' · ') || 'no rules found';
}

/** What happened, in the words a problem report uses. */
export function problemLabel(code: ErrorCode): string {
  const labels: Partial<Record<ErrorCode, string>> = {
    damaged: 'The image could not be read',
    'unsupported-format': 'The image’s format is not supported',
    'too-large-to-process': 'The image was too large to prepare',
    'target-unreachable': 'The image could not be made small enough',
    'rules-conflict': 'The site’s rules contradict each other',
    timeout: 'Preparing the image took too long',
    busy: 'Too many images at once',
    'empty-file': 'The file was empty',
  };
  return labels[code] ?? 'Something went wrong while preparing the image';
}

export interface ReportEnvironment {
  version: string;
  browser: string;
  platform: string;
  /** Only ever what the person typed in themselves. */
  website?: string;
}

/** The plain-text report a person can copy and send. */
export function problemReport(
  problems: readonly {
    at: string;
    code: ErrorCode;
    format: ImageFormat;
    bytes: number;
    rules: string;
  }[],
  environment: ReportEnvironment,
): string {
  const lines = [
    'Just Upload problem report',
    `Version ${environment.version} · ${environment.browser} · ${environment.platform}`,
    `Website: ${environment.website?.trim() || 'not given'}`,
    '',
  ];
  if (!problems.length) lines.push('No problems recorded.');
  problems
    .slice()
    .reverse()
    .forEach((problem, index) => {
      const when = new Date(problem.at).toISOString().slice(0, 16).replace('T', ' ');
      lines.push(
        `${index + 1}. ${when} UTC: ${problemLabel(problem.code)} (${problem.code})`,
        `   Image: ${formatLabel(problem.format)}, about ${formatBytes(problem.bytes)}`,
        `   Upload rules: ${problem.rules || 'none read'}`,
      );
    });
  return lines.join('\n');
}
