import type { ColorDescription } from '../color';

/** A huge image, decoded straight to a smaller working size. */
export interface StreamedImage {
  /** RGBA values at `width` × `height`, in the file's own colour space. */
  pixels: Uint8ClampedArray<ArrayBuffer>;
  width: number;
  height: number;
  /** The image's own size, as stored. */
  fullWidth: number;
  fullHeight: number;
  transparent: boolean;
  color?: ColorDescription;
  /** EXIF orientation, 1–8, still to be applied. */
  orientation: number;
}

/** Picks the working size for an image of the given full size. */
export type SizeFor = (width: number, height: number) => { width: number; height: number };

/** Reports how much of the file has been read, from 0 to 1. */
export type Progress = (fraction: number) => void;
