import type { ImageFormat } from '../models';
import { fail } from '../utils/errors';

const GB = 1024 ** 3;
const MB = 1024 ** 2;

/**
 * Bounds on the work a single selection can cause. Large enough for gigapixel scans and
 * panoramas; small enough that a hostile or broken file cannot exhaust memory or hang.
 */
export const LIMITS = Object.freeze({
  /**
   * Per file. JPEG, PNG, TIFF and BMP of any size are read in a stream and reduced as
   * they are decoded, so files up to 5 GB work.
   */
  maxInputBytes: 5 * GB,
  /** Files read whole into memory: every other format, and the smaller images. */
  maxWholeFileBytes: 512 * MB,
  /**
   * The fallback path sends files as base64 in messages, which Chrome caps at 64 MB;
   * 40 MB of file stays well under it.
   */
  maxMessageBytes: 40 * MB,
  /** SVGs are rendered by the browser's engine; keep them to a sane size. */
  maxSvgBytes: 5 * MB,
  /** A canvas side cannot exceed this. */
  maxDimension: 32_767,
  /** Images the browser decodes whole (it manages 341 MP JPEGs, not 1 GP ones). */
  maxDecodePixels: 250_000_000,
  maxDecodeJpegPixels: 340_000_000,
  /** Images read in a stream: any size their format allows, within reason. */
  maxStreamDimension: 1_000_000,
  maxStreamPixels: 20_000_000_000,
  /** Larger images are reduced to this working size first: more than any upload needs. */
  maxWorkingPixels: 64_000_000,
  maxWorkingDimension: 16_384,
  processingMs: 30_000,
  /** Extra time allowed per gigabyte of file, for the very largest images. */
  processingMsPerGigabyte: 60_000,
  maxFiles: 12,
  maxSelectionBytes: 20 * GB,
});

/** Formats that can be read in a stream, at any size. */
export const STREAMED_FORMATS: ReadonlySet<ImageFormat> = new Set(['jpeg', 'png', 'tiff', 'bmp']);

/** How long one file may take, scaled for very large files. */
export function processingTime(bytes: number): number {
  return LIMITS.processingMs + Math.ceil((bytes / GB) * LIMITS.processingMsPerGigabyte);
}

/**
 * `decode`: pixels the browser decodes whole. `stream`: an image read in a stream, whose
 * stored size can be far larger.
 */
export function assertDimensions(
  width: number,
  height: number,
  kind: 'decode' | 'stream' = 'decode',
): void {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1)
    fail('damaged');
  const [side, pixels] =
    kind === 'stream'
      ? [LIMITS.maxStreamDimension, LIMITS.maxStreamPixels]
      : [LIMITS.maxDimension, LIMITS.maxDecodePixels];
  if (width > side || height > side || width * height > pixels) fail('too-large-to-process');
}

export function assertFileSize(size: number, limit: number = LIMITS.maxInputBytes): void {
  if (!Number.isFinite(size) || size <= 0) fail('empty-file');
  if (size > limit) fail('too-large-to-process');
}
