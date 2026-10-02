import type {
  CompatibilityIssue,
  FileFormat,
  FileOutput,
  ImageInfo,
  OutputFormat,
  UploadRequirements,
} from '../models';
import {
  FORMATS,
  formatFromExtension,
  formatFromMime,
  isImage,
  isSheet,
  OUTPUT_FORMATS,
  SHEET_OUTPUTS,
  type KnownFormat,
} from '../formats';

export { OUTPUT_FORMATS };

const DIMENSION_FIELDS = [
  'minWidth',
  'minHeight',
  'maxWidth',
  'maxHeight',
  'exactWidth',
  'exactHeight',
  'aspectRatio',
] as const;

/**
 * "At least 20 KB" may be counted as 20,000 bytes or as 20,480: a file is safely over a
 * minimum only when it is over both.
 */
export const safeMinimum = (minBytes: number) =>
  Math.ceil(minBytes * (minBytes < 1e6 ? 1.024 : 1.024 ** 2));

/** "The same shape" allows only a pixel of rounding; sites often check squares exactly. */
export function sameRatio(width: number, height: number, ratio: number): boolean {
  return Math.abs(width - height * ratio) <= Math.max(1, ratio);
}

export function formatAllowed(
  format: FileFormat | FileOutput,
  requirements: UploadRequirements,
): boolean {
  const { acceptedMimeTypes: mimeTypes, acceptedExtensions: extensions } = requirements;
  if (!mimeTypes.length && !extensions.length) return true;
  if (format === 'unknown') return false;
  if (mimeTypes.includes('*/*')) return true;
  // "image/*" takes any image, but not a PDF or a spreadsheet.
  if (mimeTypes.includes('image/*') && isImage(format)) return true;
  // A field accepting HEIF also takes HEIC, and the other way round.
  return [format, ...(FORMATS[format].family ?? [])].some(
    (candidate: KnownFormat) =>
      FORMATS[candidate].mimeTypes.some((mime) => mimeTypes.includes(mime)) ||
      FORMATS[candidate].extensions.some((extension) => extensions.includes(extension)),
  );
}

/** Output formats this field accepts, in our order of preference. */
export function allowedOutputs(requirements: UploadRequirements): OutputFormat[] {
  return OUTPUT_FORMATS.filter((format) => formatAllowed(format, requirements));
}

export function hasDimensionRules(requirements: UploadRequirements): boolean {
  return DIMENSION_FIELDS.some((field) => requirements[field] !== undefined);
}

/**
 * What a file of this format can become on this field, best first: an accepted image or
 * a PDF, for an image or a PDF; another accepted spreadsheet format, for a spreadsheet.
 * Empty when the field takes nothing Just Upload can make from it.
 */
export function conversionTargets(
  format: FileFormat,
  requirements: UploadRequirements,
): FileOutput[] {
  if (format === 'unknown') return [];
  if (isSheet(format))
    return SHEET_OUTPUTS.filter(
      (output) => output !== format && formatAllowed(output, requirements),
    );
  const pdf: FileOutput[] = formatAllowed('pdf', requirements) ? ['pdf'] : [];
  // An image stays an image where it can; a PDF stays a PDF where it can.
  return format === 'pdf'
    ? [...pdf, ...allowedOutputs(requirements)]
    : [...allowedOutputs(requirements), ...pdf];
}

/** A fast hint from the name and type. Real decisions use the file's signature. */
export function guessFormat(file: Pick<File, 'name' | 'type'>): FileFormat {
  const extension = /\.[^.]+$/.exec(file.name)?.[0] ?? '';
  const byExtension = formatFromExtension(extension);
  // Windows reports a CSV file as an Excel one when Excel is installed.
  if (byExtension === 'csv') return 'csv';
  return formatFromMime(file.type) ?? byExtension ?? 'unknown';
}

/**
 * Decides, synchronously and without reading the file, whether a selection could need
 * work. When this is false the page receives the user's event exactly as it was.
 */
export function mightNeedWork(
  file: Pick<File, 'name' | 'type' | 'size'>,
  requirements: UploadRequirements,
): boolean {
  if (!file.size) return false;
  const format = guessFormat(file);
  if (format === 'unknown') return false;
  if (!formatAllowed(format, requirements))
    return conversionTargets(format, requirements).length > 0;
  // A spreadsheet in an accepted format is left exactly as it is.
  if (isSheet(format)) return false;
  if (requirements.maxBytes !== undefined && file.size > requirements.maxBytes) return true;
  if (format === 'pdf') return false;
  if (requirements.minBytes !== undefined && file.size < safeMinimum(requirements.minBytes))
    return true;
  return allowedOutputs(requirements).length > 0 && hasDimensionRules(requirements);
}

/** Every way this image fails the field's rules, not just the first. */
export function evaluateCompatibility(
  info: Pick<ImageInfo, 'format' | 'width' | 'height' | 'bytes'>,
  requirements: UploadRequirements,
): CompatibilityIssue[] {
  if (info.format === 'unknown' || !(info.bytes > 0)) return ['unknown'];
  const issues: CompatibilityIssue[] = [];
  if (!formatAllowed(info.format, requirements)) issues.push('unsupported-format');
  if (requirements.maxBytes !== undefined && info.bytes > requirements.maxBytes)
    issues.push('too-large');
  if (requirements.minBytes !== undefined && info.bytes < safeMinimum(requirements.minBytes))
    issues.push('too-small-file');
  if (!hasDimensionRules(requirements)) return issues;
  const { width, height } = info;
  if (!(width > 0) || !(height > 0)) return [...issues, 'unknown'];
  const { minWidth, minHeight, maxWidth, maxHeight, exactWidth, exactHeight } = requirements;
  const ratio =
    requirements.aspectRatio ?? (exactWidth && exactHeight ? exactWidth / exactHeight : undefined);
  if ((minWidth && width < minWidth) || (minHeight && height < minHeight))
    issues.push('too-small-dimensions');
  if ((maxWidth && width > maxWidth) || (maxHeight && height > maxHeight))
    issues.push('too-large-dimensions');
  if ((exactWidth && width !== exactWidth) || (exactHeight && height !== exactHeight)) {
    issues.push('exact-dimensions-required');
  }
  if (ratio && !sameRatio(width, height, ratio)) issues.push('wrong-aspect-ratio');
  return issues;
}

/** Rules that contradict each other cannot be satisfied; better to leave the file alone. */
export function conflictingRules(requirements: UploadRequirements): boolean {
  const { minBytes, maxBytes } = requirements;
  if (minBytes !== undefined && maxBytes !== undefined && minBytes > maxBytes) return true;
  for (const axis of ['Width', 'Height'] as const) {
    const min = requirements[`min${axis}`];
    const max = requirements[`max${axis}`];
    const exact = requirements[`exact${axis}`];
    if ((min && max && min > max) || (exact && min && exact < min) || (exact && max && exact > max))
      return true;
  }
  const { exactWidth, exactHeight, aspectRatio } = requirements;
  return Boolean(
    exactWidth && exactHeight && aspectRatio && !sameRatio(exactWidth, exactHeight, aspectRatio),
  );
}
