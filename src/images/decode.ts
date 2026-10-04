import type { ImageInfo } from '../models';
import { assertDimensions, assertFileSize, LIMITS, STREAMED_FORMATS } from '../security/limits';
import { fail, ProcessingError } from '../utils/errors';
import { managedBitmap } from './color';
import { decodeJxl } from './codecs/jxl';
import { decodeTiff } from './codecs/tiff';
import { readDpi } from './dpi';
import {
  detectFormat,
  displaySize,
  isBigTiff,
  parseHeader,
  SIZE_SETTLED_BY_DECODER,
  type ImageHeader,
} from './headers';
import { heicDecoder } from './heic';
import { STREAM_DECODERS } from './stream';
import { workingSize } from './stream/downscale';
import type { Progress } from './stream/types';

/** A decoded image in a single normalized form, whatever format it came from. */
export interface DecodedImage {
  /** Already rotated upright; EXIF and HEIF orientation are applied here. */
  bitmap: ImageBitmap;
  /** The image's own size and properties, whatever size `bitmap` was decoded at. */
  info: ImageInfo;
  /** Pixels of `bitmap` per pixel of the image: 1, or less for images over the working size. */
  scale: number;
}

export function context2d(
  canvas: OffscreenCanvas,
  willReadFrequently = false,
): OffscreenCanvasRenderingContext2D {
  const context = canvas.getContext('2d', { willReadFrequently });
  if (!context) fail('failed');
  return context;
}

/** Scans in 256-pixel tiles so the check never needs a second full-size buffer. */
function hasTransparentPixel(bitmap: ImageBitmap): boolean {
  const tile = new OffscreenCanvas(Math.min(256, bitmap.width), Math.min(256, bitmap.height));
  const context = context2d(tile, true);
  try {
    for (let y = 0; y < bitmap.height; y += tile.height) {
      for (let x = 0; x < bitmap.width; x += tile.width) {
        const width = Math.min(tile.width, bitmap.width - x);
        const height = Math.min(tile.height, bitmap.height - y);
        context.clearRect(0, 0, tile.width, tile.height);
        context.drawImage(bitmap, x, y, width, height, 0, 0, width, height);
        const data = context.getImageData(0, 0, width, height).data;
        for (let i = 3; i < data.length; i += 4) if (data[i] !== 255) return true;
      }
    }
    return false;
  } finally {
    tile.width = 0;
    tile.height = 0;
  }
}

/**
 * TIFF orientation is not applied by the TIFF decoder, so apply it here (the browser
 * already does this for JPEG, PNG and WebP, and libheif and libjxl do it for theirs).
 */
async function applyOrientation(bitmap: ImageBitmap, orientation: number): Promise<ImageBitmap> {
  if (orientation <= 1 || orientation > 8) return bitmap;
  const { width, height } = bitmap;
  const sideways = orientation >= 5;
  const canvas = new OffscreenCanvas(sideways ? height : width, sideways ? width : height);
  const context = context2d(canvas);
  const transforms: Record<number, [number, number, number, number, number, number]> = {
    2: [-1, 0, 0, 1, width, 0],
    3: [-1, 0, 0, -1, width, height],
    4: [1, 0, 0, -1, 0, height],
    5: [0, 1, 1, 0, 0, 0],
    6: [0, 1, -1, 0, height, 0],
    7: [0, -1, -1, 0, height, width],
    8: [0, -1, 1, 0, 0, width],
  };
  context.setTransform(...transforms[orientation]!);
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  try {
    return await createImageBitmap(canvas);
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}

/** Enough of a file to read its format and size, for almost every image. */
const HEAD_BYTES = 1024 * 1024;
/** UTIF holds a whole TIFF's samples at once, so larger TIFFs are streamed. */
const MAX_WHOLE_TIFF_PIXELS = 64_000_000;

type StreamedFormat = 'jpeg' | 'png' | 'tiff' | 'bmp';
const working = (width: number, height: number) =>
  workingSize(width, height, LIMITS.maxWorkingPixels, LIMITS.maxWorkingDimension);

/** Whether the browser (or the format's own decoder) can take this image whole. */
function decodesWhole(header: ImageHeader, bytes: number): boolean {
  const limit =
    header.format === 'jpeg'
      ? LIMITS.maxDecodeJpegPixels
      : header.format === 'tiff'
        ? MAX_WHOLE_TIFF_PIXELS
        : LIMITS.maxDecodePixels;
  return (
    bytes <= LIMITS.maxWholeFileBytes &&
    header.width * header.height <= limit &&
    Math.max(header.width, header.height) <= LIMITS.maxDimension
  );
}

/** Reads a huge image in a stream, straight to the working size. */
async function decodeStreamed(
  file: Blob,
  format: StreamedFormat,
  progress?: Progress,
): Promise<DecodedImage> {
  const streamed = await STREAM_DECODERS[format](file, working, progress);
  assertDimensions(streamed.fullWidth, streamed.fullHeight, 'stream');
  const bitmap = await applyOrientation(
    await managedBitmap(
      new ImageData(streamed.pixels, streamed.width, streamed.height),
      streamed.color,
    ),
    streamed.orientation,
  );
  const { width, height } = displaySize({
    width: streamed.fullWidth,
    height: streamed.fullHeight,
    orientation: streamed.orientation,
  });
  return {
    bitmap,
    info: {
      format,
      width,
      height,
      bytes: file.size,
      transparent: streamed.transparent,
      animated: Boolean(streamed.multipleImages),
      orientation: streamed.orientation,
    },
    scale: bitmap.width / width,
  };
}

/**
 * Decodes any supported format to an upright ImageBitmap. SVG has no pixels of its
 * own: the offscreen document renders it first and passes that rendering as `raster`.
 * Images larger than the working size are decoded smaller, and `scale` says by how much;
 * those too large for the browser to decode at all are read in a stream.
 *
 * With `fullSize`, the image must keep its own pixel size (the website states none), so
 * one larger than the working size is refused before any work rather than shrunk.
 */
export async function decodeImage(
  file: Blob,
  raster?: Blob,
  progress?: Progress,
  fullSize = false,
): Promise<DecodedImage> {
  assertFileSize(file.size);
  const head = new Uint8Array(await file.slice(0, HEAD_BYTES).arrayBuffer());
  const format = detectFormat(head);
  if (format === 'unknown') fail('unsupported-format');
  // The first megabyte holds almost every header; a TIFF's may be at the very end.
  let bytes: ArrayBuffer | undefined;
  let header = file.size <= HEAD_BYTES ? parseHeader(head) : parseHeader(head, { partial: true });
  if (!header && file.size <= LIMITS.maxWholeFileBytes) {
    bytes = await file.arrayBuffer();
    header = parseHeader(new Uint8Array(bytes));
  }
  const tooLarge = (width: number, height: number) =>
    width * height > LIMITS.maxWorkingPixels ||
    Math.max(width, height) > LIMITS.maxWorkingDimension;
  if (fullSize && header && tooLarge(header.width, header.height)) fail('too-large-to-process');
  // The whole-file TIFF decoder does not read BigTIFF; the streamed one does.
  if (!header || !decodesWhole(header, file.size) || isBigTiff(head)) {
    if (!STREAMED_FORMATS.has(format)) fail('too-large-to-process');
    try {
      const streamed = await decodeStreamed(file, format as StreamedFormat, progress);
      // A header that could not be read up front: check the size it turned out to be.
      if (fullSize && streamed.scale < 1) {
        streamed.bitmap.close();
        fail('too-large-to-process');
      }
      streamed.info.dpi = readDpi(head, format);
      // An animated PNG is known from its header; a TIFF's pages from reading it.
      streamed.info.animated ||= format !== 'tiff' && Boolean(header?.animated);
      return streamed;
    } catch (error) {
      if (error instanceof ProcessingError && error.code !== 'failed') throw error;
      fail('damaged');
    }
  }
  if (header.format === 'tiff' || header.format === 'jxl') bytes ??= await file.arrayBuffer();
  // Big images are decoded straight to the working size, where the browser can.
  const full = displaySize(header);
  const reduce =
    full.width * full.height > LIMITS.maxWorkingPixels &&
    !SIZE_SETTLED_BY_DECODER.has(header.format) &&
    !['heic', 'heif', 'svg', 'tiff', 'jxl'].includes(header.format)
      ? working(full.width, full.height)
      : undefined;
  let bitmap: ImageBitmap;
  let mayHaveAlpha = header.mayHaveAlpha;
  let multipleImages = false;
  try {
    if (header.format === 'heic' || header.format === 'heif') {
      const decoded = await heicDecoder.decode(file);
      bitmap = await managedBitmap(decoded.pixels, header.color);
      mayHaveAlpha = decoded.hasAlpha;
      multipleImages = decoded.multipleImages;
    } else if (header.format === 'svg') {
      if (!raster) fail('unsupported-format');
      bitmap = await createImageBitmap(raster);
    } else if (header.format === 'tiff') {
      bitmap = await applyOrientation(
        await managedBitmap(await decodeTiff(bytes!), header.color),
        header.orientation,
      );
    } else if (header.format === 'jxl') {
      // libjxl converts to sRGB itself.
      bitmap = await createImageBitmap(await decodeJxl(bytes!));
    } else {
      // Chromium decodes JPEG, PNG, WebP, GIF, BMP, ICO and AVIF itself, applying EXIF
      // orientation here; applying it again would rotate twice.
      bitmap = await createImageBitmap(file, {
        imageOrientation: 'from-image',
        ...(reduce
          ? { resizeWidth: reduce.width, resizeHeight: reduce.height, resizeQuality: 'high' }
          : {}),
      });
    }
  } catch (error) {
    if (error instanceof ProcessingError && error.code !== 'failed') throw error;
    fail('damaged');
  }
  try {
    assertDimensions(bitmap.width, bitmap.height);
    // A reduced decode keeps the image's own size in `info`; otherwise the decoder's
    // upright size is the truth (HEIF and JPEG XL rotate while decoding).
    const { width, height } = reduce ? full : bitmap;
    return {
      bitmap,
      info: {
        format: header.format,
        width,
        height,
        bytes: file.size,
        transparent: mayHaveAlpha && hasTransparentPixel(bitmap),
        animated: header.animated || multipleImages,
        orientation: header.orientation,
        dpi: readDpi(head, header.format),
      },
      scale: bitmap.width / width,
    };
  } catch (error) {
    bitmap.close();
    throw error;
  }
}
