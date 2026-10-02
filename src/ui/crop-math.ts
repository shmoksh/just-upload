import type { CropRect } from '../models';
import { defaultCrop } from '../decision';

export const MAX_ZOOM = 4;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

// All crop math is in the original image's pixels, independent of preview size, so
// what the person frames is exactly what gets encoded.

export function clampCrop(crop: CropRect, width: number, height: number): CropRect {
  const cropWidth = Math.min(crop.width, width);
  const cropHeight = Math.min(crop.height, height);
  return {
    x: clamp(crop.x, 0, width - cropWidth),
    y: clamp(crop.y, 0, height - cropHeight),
    width: cropWidth,
    height: cropHeight,
  };
}

export function zoomOf(crop: CropRect, width: number, height: number, ratio: number): number {
  return defaultCrop(width, height, ratio).width / crop.width;
}

/** Zooms around the crop's centre, keeping the required shape and staying inside the image. */
export function zoomCrop(
  crop: CropRect,
  zoom: number,
  width: number,
  height: number,
  ratio: number,
): CropRect {
  const base = defaultCrop(width, height, ratio);
  const level = clamp(zoom, 1, MAX_ZOOM);
  const cropWidth = base.width / level;
  const cropHeight = base.height / level;
  const centerX = crop.x + crop.width / 2;
  const centerY = crop.y + crop.height / 2;
  return clampCrop(
    {
      x: centerX - cropWidth / 2,
      y: centerY - cropHeight / 2,
      width: cropWidth,
      height: cropHeight,
    },
    width,
    height,
  );
}

/** Moves the crop by a distance in image pixels. */
export function panCrop(
  crop: CropRect,
  dx: number,
  dy: number,
  width: number,
  height: number,
): CropRect {
  return clampCrop({ ...crop, x: crop.x + dx, y: crop.y + dy }, width, height);
}
