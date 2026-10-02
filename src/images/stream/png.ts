import { assertDimensions } from '../../security/limits';
import { fail } from '../../utils/errors';
import type { ColorDescription } from '../color';
import { RowDownscaler } from './downscale';
import { Source } from './source';
import type { Progress, SizeFor, StreamedImage } from './types';

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
/** Bytes of compressed data handed to the inflater at a time. */
const PIECE = 4 * 1024 * 1024;
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

async function inflate(data: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Undoes one row's PNG filter, writing the row's real bytes into `out`. */
function unfilter(
  type: number,
  raw: Uint8Array,
  previous: Uint8Array,
  out: Uint8Array,
  step: number,
): void {
  const length = raw.length;
  if (type === 0) out.set(raw);
  else if (type === 1) {
    for (let i = 0; i < length; i++) out[i] = raw[i]! + (i >= step ? out[i - step]! : 0);
  } else if (type === 2) {
    for (let i = 0; i < length; i++) out[i] = raw[i]! + previous[i]!;
  } else if (type === 3) {
    for (let i = 0; i < length; i++)
      out[i] = raw[i]! + (((i >= step ? out[i - step]! : 0) + previous[i]!) >> 1);
  } else if (type === 4) {
    for (let i = 0; i < length; i++) {
      const a = i >= step ? out[i - step]! : 0;
      const b = previous[i]!;
      const c = i >= step ? previous[i - step]! : 0;
      const p = a + b - c;
      const pa = Math.abs(p - a);
      const pb = Math.abs(p - b);
      const pc = Math.abs(p - c);
      out[i] = raw[i]! + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
    }
  } else fail('damaged');
}

interface Layout {
  width: number;
  depth: number;
  colorType: number;
  palette?: Uint8Array;
  transparency?: Uint8Array;
}

/** Turns one unfiltered row into RGBA values. */
function toRgba(row: Uint8Array, out: Uint8Array, layout: Layout): void {
  const { width, depth, colorType, palette, transparency } = layout;
  const wide = depth === 16;
  // A tRNS colour key, compared at the file's own bit depth.
  const key =
    transparency && (colorType === 0 || colorType === 2)
      ? Array.from(
          { length: colorType === 0 ? 1 : 3 },
          (_, i) => (transparency[i * 2]! << 8) | transparency[i * 2 + 1]!,
        )
      : undefined;
  const sample = (index: number): number => {
    if (wide) return (row[index * 2]! << 8) | row[index * 2 + 1]!;
    if (depth === 8) return row[index]!;
    const perByte = 8 / depth;
    const shift = (perByte - 1 - (index % perByte)) * depth;
    return (row[Math.floor(index / perByte)]! >> shift) & ((1 << depth) - 1);
  };
  const scale = (value: number) =>
    wide ? value >> 8 : depth === 8 ? value : Math.round((value * 255) / ((1 << depth) - 1));
  for (let x = 0, o = 0; x < width; x++, o += 4) {
    if (colorType === 3) {
      const index = sample(x);
      out[o] = palette?.[index * 3] ?? 0;
      out[o + 1] = palette?.[index * 3 + 1] ?? 0;
      out[o + 2] = palette?.[index * 3 + 2] ?? 0;
      out[o + 3] = transparency?.[index] ?? 255;
    } else if (colorType === 0 || colorType === 4) {
      const channels = colorType === 0 ? 1 : 2;
      const raw = sample(x * channels);
      const gray = scale(raw);
      out[o] = out[o + 1] = out[o + 2] = gray;
      out[o + 3] = colorType === 4 ? scale(sample(x * 2 + 1)) : key && raw === key[0] ? 0 : 255;
    } else {
      const channels = colorType === 2 ? 3 : 4;
      const r = sample(x * channels);
      const g = sample(x * channels + 1);
      const b = sample(x * channels + 2);
      out[o] = scale(r);
      out[o + 1] = scale(g);
      out[o + 2] = scale(b);
      out[o + 3] =
        colorType === 6
          ? scale(sample(x * 4 + 3))
          : key && r === key[0] && g === key[1] && b === key[2]
            ? 0
            : 255;
    }
  }
}

/**
 * Decodes a PNG of any size straight to a smaller working size: compressed data is
 * inflated as a stream and each row is averaged in as it appears. Interlaced PNGs store
 * rows out of order, so only non-interlaced ones can be read this way.
 */
export async function decodePngStream(
  file: Blob,
  sizeFor: SizeFor,
  progress?: Progress,
): Promise<StreamedImage> {
  const source = new Source(file);
  const signature = await source.bytes(8);
  if (!SIGNATURE.every((byte, i) => signature[i] === byte)) fail('damaged');

  let layout: Layout | undefined;
  let height = 0;
  let color: ColorDescription | undefined;
  for (;;) {
    const length = await source.u32();
    const type = await source.ascii(4);
    if (type === 'IDAT') {
      if (!layout) fail('damaged');
      return await readImage(source, length, layout, height, color, sizeFor, progress);
    }
    if (type === 'IEND') fail('damaged');
    if (type === 'IHDR') {
      if (length !== 13) fail('damaged');
      const data = await source.bytes(13);
      const view = new DataView(data.buffer, data.byteOffset, 13);
      const width = view.getUint32(0);
      height = view.getUint32(4);
      const depth = data[8]!;
      const colorType = data[9]!;
      if (
        !width ||
        !height ||
        CHANNELS[colorType] === undefined ||
        ![1, 2, 4, 8, 16].includes(depth)
      )
        fail('damaged');
      // Before any buffer is sized from them: a damaged header can claim billions.
      assertDimensions(width, height, 'stream');
      // Adam7 interlacing stores rows out of order; a full decode is the only way.
      if (data[12] !== 0) fail('too-large-to-process');
      layout = { width, depth, colorType };
    } else if (type === 'PLTE' && layout) {
      layout.palette = await source.copy(length);
    } else if (type === 'tRNS' && layout) {
      layout.transparency = await source.copy(length);
    } else if (type === 'iCCP' && length < 4 * 1024 * 1024) {
      const data = await source.copy(length);
      const nameEnd = data.indexOf(0);
      if (nameEnd > 0 && data[nameEnd + 1] === 0) {
        const profile = await inflate(data.subarray(nameEnd + 2)).catch(() => undefined);
        if (profile) color = { kind: 'icc', profile };
      }
    } else {
      await source.skip(length);
    }
    await source.skip(4); // CRC
  }
}

async function readImage(
  source: Source,
  firstLength: number,
  layout: Layout,
  height: number,
  color: ColorDescription | undefined,
  sizeFor: SizeFor,
  progress?: Progress,
): Promise<StreamedImage> {
  const { width, depth, colorType } = layout;
  const channels = CHANNELS[colorType]!;
  const stride = Math.ceil((width * channels * depth) / 8);
  const step = Math.max(1, (channels * depth) / 8);
  const size = sizeFor(width, height);
  const downscaler = new RowDownscaler(width, height, size.width, size.height);

  const inflater = new DecompressionStream('deflate');
  const writer = inflater.writable.getWriter();
  const rows = (async () => {
    const reader = inflater.readable.getReader();
    const raw = new Uint8Array(stride + 1);
    let previous = new Uint8Array(stride);
    let current = new Uint8Array(stride);
    const rgba = new Uint8Array(width * 4);
    let filled = 0;
    let y = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      for (let offset = 0; offset < value.length && y < height;) {
        const take = Math.min(raw.length - filled, value.length - offset);
        raw.set(value.subarray(offset, offset + take), filled);
        filled += take;
        offset += take;
        if (filled < raw.length) break;
        unfilter(raw[0]!, raw.subarray(1), previous, current, step);
        toRgba(current, rgba, layout);
        downscaler.addRow(rgba, y);
        [previous, current] = [current, previous];
        filled = 0;
        y++;
      }
    }
    if (y < height) fail('damaged');
  })();
  // If reading rows fails, stop feeding the inflater too.
  rows.catch((error: unknown) => writer.abort(error).catch(() => {}));

  let remaining = firstLength;
  for (;;) {
    while (remaining > 0) {
      const piece = await source.copy(Math.min(PIECE, remaining));
      remaining -= piece.length;
      await writer.write(piece);
      progress?.(source.position / source.size);
    }
    await source.skip(4);
    const length = await source.u32();
    const type = await source.ascii(4);
    if (type !== 'IDAT') break;
    remaining = length;
  }
  await writer.close();
  await rows;
  const result = downscaler.finish();
  return {
    ...result,
    fullWidth: width,
    fullHeight: height,
    color,
    orientation: 1,
  };
}
