import { assertDimensions } from '../../security/limits';
import { fail } from '../../utils/errors';
import { RowDownscaler } from './downscale';
import { readRange } from './source';
import type { Progress, SizeFor, StreamedImage } from './types';

/** Rows read per slice of the file. */
const BLOCK_BYTES = 8 * 1024 * 1024;

/** Position and width of each colour channel in a 16- or 32-bit pixel. */
interface Mask {
  shift: number;
  bits: number;
}
function maskOf(mask: number): Mask | undefined {
  if (!mask) return undefined;
  let shift = 0;
  while (!((mask >>> shift) & 1)) shift++;
  let bits = 0;
  while ((mask >>> (shift + bits)) & 1) bits++;
  return { shift, bits };
}
const channel = (value: number, mask: Mask | undefined, fallback: number) =>
  mask
    ? Math.round((((value >>> mask.shift) & ((1 << mask.bits) - 1)) * 255) / ((1 << mask.bits) - 1))
    : fallback;

/**
 * Decodes an uncompressed BMP of any size straight to a smaller working size. Most BMPs
 * store rows bottom-up, so blocks are read from the end of the file backwards and each
 * row is averaged in from the top.
 */
export async function decodeBmpStream(
  file: Blob,
  sizeFor: SizeFor,
  progress?: Progress,
): Promise<StreamedImage> {
  const head = await readRange(file, 0, Math.min(file.size, 14 + 124));
  const view = new DataView(head.buffer, head.byteOffset, head.byteLength);
  if (head[0] !== 0x42 || head[1] !== 0x4d || head.length < 54) fail('damaged');
  const dataOffset = view.getUint32(10, true);
  const headerSize = view.getUint32(14, true);
  const width = view.getInt32(18, true);
  const storedHeight = view.getInt32(22, true);
  const bits = view.getUint16(28, true);
  const compression = view.getUint32(30, true);
  const height = Math.abs(storedHeight);
  const topDown = storedHeight < 0;
  if (width <= 0 || height <= 0) fail('damaged');
  assertDimensions(width, height, 'stream');
  // RLE-compressed rows have no fixed size, so they cannot be read in blocks.
  if (compression !== 0 && compression !== 3) fail('too-large-to-process');
  if (![8, 16, 24, 32].includes(bits)) fail('too-large-to-process');

  let masks: [Mask | undefined, Mask | undefined, Mask | undefined, Mask | undefined] = [
    undefined,
    undefined,
    undefined,
    undefined,
  ];
  if (compression === 3) {
    // V4/V5 headers hold the masks; a 40-byte header is followed by them.
    const at = 14 + 40;
    if (head.length < at + 12) fail('damaged');
    masks = [
      maskOf(view.getUint32(at, true)),
      maskOf(view.getUint32(at + 4, true)),
      maskOf(view.getUint32(at + 8, true)),
      headerSize >= 56 && head.length >= at + 16
        ? maskOf(view.getUint32(at + 12, true))
        : undefined,
    ];
  } else if (bits === 16) {
    masks = [maskOf(0x7c00), maskOf(0x03e0), maskOf(0x001f), undefined];
  }

  let palette: Uint8Array | undefined;
  if (bits === 8) {
    const used = view.getUint32(46, true) || 256;
    palette = await readRange(file, 14 + headerSize, Math.min(256, used) * 4);
  }

  const stride = Math.floor((bits * width + 31) / 32) * 4;
  if (dataOffset + stride * height > file.size) fail('damaged');
  const size = sizeFor(width, height);
  const downscaler = new RowDownscaler(width, height, size.width, size.height);
  const rgba = new Uint8Array(width * 4);
  const perBlock = Math.max(1, Math.floor(BLOCK_BYTES / stride));

  for (let y = 0; y < height; y += perBlock) {
    const count = Math.min(perBlock, height - y);
    // File row of output row y: top-down files store it in order, others from the end.
    const firstFileRow = topDown ? y : height - y - count;
    const block = await readRange(file, dataOffset + firstFileRow * stride, count * stride);
    const blockView = new DataView(block.buffer, block.byteOffset, block.byteLength);
    for (let i = 0; i < count; i++) {
      const fileRow = topDown ? i : count - 1 - i;
      const start = fileRow * stride;
      for (let x = 0, o = 0; x < width; x++, o += 4) {
        if (bits === 24) {
          const p = start + x * 3;
          rgba[o] = block[p + 2]!;
          rgba[o + 1] = block[p + 1]!;
          rgba[o + 2] = block[p]!;
          rgba[o + 3] = 255;
        } else if (bits === 8) {
          const index = block[start + x]!;
          rgba[o] = palette?.[index * 4 + 2] ?? 0;
          rgba[o + 1] = palette?.[index * 4 + 1] ?? 0;
          rgba[o + 2] = palette?.[index * 4] ?? 0;
          rgba[o + 3] = 255;
        } else if (bits === 32 && compression === 0) {
          // In plain 32-bit BMPs the fourth byte is padding, not alpha.
          const p = start + x * 4;
          rgba[o] = block[p + 2]!;
          rgba[o + 1] = block[p + 1]!;
          rgba[o + 2] = block[p]!;
          rgba[o + 3] = 255;
        } else {
          const value =
            bits === 16
              ? blockView.getUint16(start + x * 2, true)
              : blockView.getUint32(start + x * 4, true);
          rgba[o] = channel(value, masks[0], 0);
          rgba[o + 1] = channel(value, masks[1], 0);
          rgba[o + 2] = channel(value, masks[2], 0);
          rgba[o + 3] = channel(value, masks[3], 255);
        }
      }
      downscaler.addRow(rgba, y + i);
    }
    progress?.((y + count) / height);
  }
  return {
    ...downscaler.finish(),
    fullWidth: width,
    fullHeight: height,
    orientation: 1,
  };
}
