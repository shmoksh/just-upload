import type { CropRect, OutputFormat, UploadRequirements } from '../models';
import { guessFormat, sameRatio } from '../compatibility';
import { FORMATS } from '../formats';
import { targetRatio } from '../decision';
import { assertDimensions } from '../security/limits';
import { fail } from '../utils/errors';

/**
 * "IMG_9283.HEIC" becomes "IMG_9283.jpg". A file that keeps its format keeps its
 * name exactly, including the extension's case.
 */
export function outputFilename(name: string, format: OutputFormat): string {
  if (guessFormat({ name, type: '' }) === format) return name;
  const base = name.replace(/\.[^.]*$/, '').trim() || 'image';
  return `${base}${FORMATS[format].extensions[0]}`;
}

/** Rounds a crop to whole pixels and rejects anything outside the image. */
export function normalizeCrop(crop: CropRect | undefined, width: number, height: number): CropRect {
  if (!crop) return { x: 0, y: 0, width, height };
  if (![crop.x, crop.y, crop.width, crop.height].every(Number.isFinite)) fail('needs-crop');
  const x = Math.max(0, Math.round(crop.x));
  const y = Math.max(0, Math.round(crop.y));
  const result = {
    x,
    y,
    width: Math.min(width - x, Math.round(crop.width)),
    height: Math.min(height - y, Math.round(crop.height)),
  };
  if (result.width < 1 || result.height < 1) fail('needs-crop');
  return result;
}

/**
 * The output size for an image of this size: the largest size that satisfies every
 * rule without changing its shape. 4032 × 3024 with a 1920 × 1920 maximum becomes
 * 1920 × 1440.
 */
export function calculateDimensions(
  width: number,
  height: number,
  requirements: UploadRequirements,
  allowUpscale = false,
): { width: number; height: number } {
  assertDimensions(width, height, 'stream');
  const ratio = targetRatio(requirements);
  if (ratio && !sameRatio(width, height, ratio)) fail('needs-crop');
  const { exactWidth, exactHeight, minWidth, minHeight, maxWidth, maxHeight } = requirements;
  let scale = Math.min(1, (maxWidth ?? Infinity) / width, (maxHeight ?? Infinity) / height);
  if (exactWidth) scale = exactWidth / width;
  else if (exactHeight) scale = exactHeight / height;
  scale = Math.max(scale, (minWidth ?? 0) / width, (minHeight ?? 0) / height);
  if (scale > 1.0001 && !allowUpscale) fail('needs-upscale');
  const finalWidth = exactWidth ?? Math.max(1, Math.round(width * scale));
  const finalHeight = exactHeight ?? Math.max(1, Math.round(height * scale));
  assertDimensions(finalWidth, finalHeight, 'stream');
  if (
    (maxWidth && finalWidth > maxWidth) ||
    (maxHeight && finalHeight > maxHeight) ||
    (minWidth && finalWidth < minWidth) ||
    (minHeight && finalHeight < minHeight)
  ) {
    fail('rules-conflict');
  }
  return { width: finalWidth, height: finalHeight };
}
