import type { ImageFormat, OutputFormat } from './models';

export type KnownFormat = Exclude<ImageFormat, 'unknown'>;

export interface FormatSpec {
  /** How people see it written: "JPG", "HEIC". */
  label: string;
  /** Canonical MIME type first; the rest are aliases seen in the wild. */
  mimeTypes: readonly string[];
  /** Canonical extension first (used for output file names). */
  extensions: readonly string[];
  /** Other formats a field accepting this one also accepts. */
  family?: readonly KnownFormat[];
  /** For outputs: whether it can keep transparency, and whether it trades quality for size. */
  output?: { alpha: boolean; lossy: boolean };
}

/**
 * Every image format Just Upload understands, in one place. Reading covers all of them;
 * writing covers those with `output`. HEIC/HEIF, SVG and JPEG XL are read-only: the only
 * HEIC encoder (x265) is GPL, a photo cannot become a true vector drawing, and websites
 * don't accept JPEG XL.
 */
export const FORMATS: Readonly<Record<KnownFormat, FormatSpec>> = {
  jpeg: {
    label: 'JPG',
    mimeTypes: ['image/jpeg', 'image/jpg', 'image/pjpeg'],
    extensions: ['.jpg', '.jpeg', '.jpe', '.jfif'],
    output: { alpha: false, lossy: true },
  },
  png: {
    label: 'PNG',
    mimeTypes: ['image/png', 'image/x-png', 'image/apng'],
    extensions: ['.png', '.apng'],
    output: { alpha: true, lossy: false },
  },
  webp: {
    label: 'WebP',
    mimeTypes: ['image/webp'],
    extensions: ['.webp'],
    output: { alpha: true, lossy: true },
  },
  avif: {
    label: 'AVIF',
    mimeTypes: ['image/avif', 'image/avif-sequence'],
    extensions: ['.avif'],
    output: { alpha: true, lossy: true },
  },
  gif: {
    label: 'GIF',
    mimeTypes: ['image/gif'],
    extensions: ['.gif'],
    output: { alpha: true, lossy: false },
  },
  tiff: {
    label: 'TIFF',
    mimeTypes: ['image/tiff', 'image/tif', 'image/x-tiff'],
    extensions: ['.tif', '.tiff'],
    output: { alpha: true, lossy: false },
  },
  bmp: {
    label: 'BMP',
    mimeTypes: ['image/bmp', 'image/x-bmp', 'image/x-ms-bmp'],
    extensions: ['.bmp', '.dib'],
    output: { alpha: false, lossy: false },
  },
  ico: {
    label: 'ICO',
    mimeTypes: ['image/x-icon', 'image/vnd.microsoft.icon', 'image/ico', 'image/icon'],
    extensions: ['.ico', '.cur'],
    output: { alpha: true, lossy: false },
  },
  heic: {
    label: 'HEIC',
    mimeTypes: ['image/heic', 'image/heic-sequence'],
    extensions: ['.heic'],
    family: ['heif'],
  },
  heif: {
    label: 'HEIF',
    mimeTypes: ['image/heif', 'image/heif-sequence'],
    extensions: ['.heif', '.hif'],
    family: ['heic'],
  },
  svg: { label: 'SVG', mimeTypes: ['image/svg+xml'], extensions: ['.svg'] },
  jxl: { label: 'JPEG XL', mimeTypes: ['image/jxl'], extensions: ['.jxl'] },
};

export const KNOWN_FORMATS = Object.keys(FORMATS) as KnownFormat[];

/** Preference order when a site leaves the choice to us. */
export const OUTPUT_FORMATS: readonly OutputFormat[] = [
  'jpeg',
  'png',
  'webp',
  'avif',
  'gif',
  'tiff',
  'bmp',
  'ico',
];

const BY_MIME = new Map<string, KnownFormat>();
const BY_EXTENSION = new Map<string, KnownFormat>();
for (const format of KNOWN_FORMATS) {
  for (const mime of FORMATS[format].mimeTypes) BY_MIME.set(mime, format);
  for (const extension of FORMATS[format].extensions) BY_EXTENSION.set(extension, format);
}

export function normalizeMime(value: string): string {
  const mime = (value.toLowerCase().split(';')[0] ?? '').trim();
  const format = BY_MIME.get(mime);
  return format ? FORMATS[format].mimeTypes[0]! : mime;
}

export function formatFromMime(value: string): KnownFormat | undefined {
  return BY_MIME.get(normalizeMime(value));
}

export function formatFromExtension(extension: string): KnownFormat | undefined {
  return BY_EXTENSION.get(extension.toLowerCase());
}

export function mimeOf(format: KnownFormat): string {
  return FORMATS[format].mimeTypes[0]!;
}

export function isOutputFormat(format: ImageFormat): format is OutputFormat {
  return format !== 'unknown' && Boolean(FORMATS[format].output);
}

export function keepsTransparency(format: OutputFormat): boolean {
  return FORMATS[format].output!.alpha;
}

export function isLossy(format: OutputFormat): boolean {
  return FORMATS[format].output!.lossy;
}
