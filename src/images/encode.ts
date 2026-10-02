import type { OutputFormat } from '../models';
import { mimeOf } from '../formats';
import { fail } from '../utils/errors';
import { encodeAvif } from './codecs/avif';
import { encodeBmp } from './codecs/bmp';
import { encodeGif } from './codecs/gif';
import { encodeIco } from './codecs/ico';
import { encodeTiff } from './codecs/tiff';
import { context2d } from './decode';

const NATIVE = new Set<OutputFormat>(['jpeg', 'png', 'webp']);

/**
 * Encodes a finished canvas. JPEG, PNG and WebP use the browser's own encoders; the
 * others are written from the canvas's pixels. `quality` (0–1) only matters for lossy
 * formats.
 */
export async function encodeCanvas(
  canvas: OffscreenCanvas,
  format: OutputFormat,
  quality: number,
): Promise<Blob> {
  const type = mimeOf(format);
  if (NATIVE.has(format)) {
    const blob = await canvas.convertToBlob({ type, quality });
    if (blob.type !== type || !blob.size) fail('encode-unsupported');
    return blob;
  }
  const { width, height } = canvas;
  if (format === 'ico') {
    const png = new Uint8Array(
      await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer(),
    );
    return new Blob([encodeIco(png, width, height)], { type });
  }
  const image = context2d(canvas, true).getImageData(0, 0, width, height);
  let bytes: BlobPart;
  if (format === 'avif') bytes = new Uint8Array(await encodeAvif(image, quality));
  else if (format === 'gif') bytes = new Uint8Array(encodeGif(image.data, width, height));
  else if (format === 'bmp') bytes = encodeBmp(image.data, width, height);
  else bytes = await encodeTiff(image.data, width, height);
  return new Blob([bytes], { type });
}
