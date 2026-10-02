import { assertDimensions } from '../../security/limits';
import { fail } from '../../utils/errors';
import type { ColorDescription } from '../color';
import { RowDownscaler } from './downscale';
import { readRange } from './source';
import type { Progress, SizeFor, StreamedImage } from './types';

const TAG = {
  newSubfileType: 254,
  width: 256,
  height: 257,
  bitsPerSample: 258,
  compression: 259,
  photometric: 262,
  stripOffsets: 273,
  orientation: 274,
  samplesPerPixel: 277,
  rowsPerStrip: 278,
  stripByteCounts: 279,
  planar: 284,
  predictor: 317,
  colorMap: 320,
  tileWidth: 322,
  tileLength: 323,
  tileOffsets: 324,
  tileByteCounts: 325,
  extraSamples: 338,
  sampleFormat: 339,
  jpegTables: 347,
  iccProfile: 34675,
} as const;
/** Bytes per value of each TIFF field type. */
const TYPE_SIZE: Record<number, number> = {
  1: 1,
  2: 1,
  3: 2,
  4: 4,
  5: 8,
  6: 1,
  7: 1,
  8: 2,
  9: 4,
  10: 8,
  11: 4,
  12: 8,
  13: 4,
  16: 8,
  17: 8,
  18: 8,
};
/** Largest array a tag may hold; a 200,000-row image with one row per strip fits. */
const MAX_VALUES = 4_000_000;

interface Directory {
  values: Map<number, number[]>;
  bytes: Map<number, Uint8Array>;
  next: number;
}

class Reader {
  constructor(
    readonly data: DataView,
    readonly little: boolean,
  ) {}
  u16(at: number) {
    return this.data.getUint16(at, this.little);
  }
  u32(at: number) {
    return this.data.getUint32(at, this.little);
  }
  u64(at: number) {
    const low = this.data.getUint32(at + (this.little ? 0 : 4), this.little);
    const high = this.data.getUint32(at + (this.little ? 4 : 0), this.little);
    return high * 2 ** 32 + low;
  }
  value(type: number, at: number): number {
    if (type === 1 || type === 2 || type === 6 || type === 7) return this.data.getUint8(at);
    if (type === 3 || type === 8) return this.u16(at);
    if (type === 4 || type === 9 || type === 13) return this.u32(at);
    if (type === 16 || type === 17 || type === 18) return this.u64(at);
    return 0;
  }
}

const view = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

/** Reads one image file directory, fetching out-of-line values from the file. */
async function readDirectory(
  file: Blob,
  offset: number,
  little: boolean,
  big: boolean,
): Promise<Directory> {
  const countBytes = big ? 8 : 2;
  const entrySize = big ? 20 : 12;
  const inline = big ? 8 : 4;
  const countView = new Reader(view(await readRange(file, offset, countBytes)), little);
  const count = big ? countView.u64(0) : countView.u16(0);
  if (count > 4096) fail('damaged');
  const table = new Reader(
    view(await readRange(file, offset + countBytes, count * entrySize + (big ? 8 : 4))),
    little,
  );
  const values = new Map<number, number[]>();
  const bytes = new Map<number, Uint8Array>();
  for (let i = 0; i < count; i++) {
    const at = i * entrySize;
    const tag = table.u16(at);
    const type = table.u16(at + 2);
    const items = big ? table.u64(at + 4) : table.u32(at + 4);
    const size = TYPE_SIZE[type];
    if (!size || items > MAX_VALUES) continue;
    const length = size * items;
    const valueAt = at + (big ? 12 : 8);
    let source: Reader;
    let start: number;
    if (length <= inline) {
      source = table;
      start = valueAt;
    } else {
      const position = big ? table.u64(valueAt) : table.u32(valueAt);
      if (position + length > file.size) continue;
      const data = await readRange(file, position, length);
      if (type === 7 || type === 1) bytes.set(tag, data);
      source = new Reader(view(data), little);
      start = 0;
    }
    if (tag === TAG.iccProfile || tag === TAG.jpegTables) {
      if (!bytes.has(tag))
        bytes.set(
          tag,
          new Uint8Array(source.data.buffer, source.data.byteOffset + start, length).slice(),
        );
      continue;
    }
    values.set(
      tag,
      Array.from({ length: items }, (_, k) => source.value(type, start + k * size)),
    );
  }
  const next = big ? table.u64(count * entrySize) : table.u32(count * entrySize);
  return { values, bytes, next };
}

function unpackBits(data: Uint8Array, expected: number): Uint8Array {
  const out = new Uint8Array(expected);
  let o = 0;
  for (let i = 0; i < data.length && o < expected;) {
    const n = (data[i++]! << 24) >> 24;
    if (n >= 0) {
      const run = Math.min(n + 1, expected - o, data.length - i);
      out.set(data.subarray(i, i + run), o);
      o += run;
      i += n + 1;
    } else if (n !== -128) {
      out.fill(data[i++]!, o, Math.min(expected, o + 1 - n));
      o += 1 - n;
    }
  }
  return out;
}

/** TIFF's LZW: most-significant bit first, 9–12-bit codes, widths change one code early. */
function lzwDecode(data: Uint8Array, expected: number): Uint8Array {
  const out = new Uint8Array(expected);
  const prefix = new Int32Array(4096);
  const suffix = new Uint8Array(4096);
  const lengths = new Int32Array(4096);
  for (let i = 0; i < 256; i++) {
    prefix[i] = -1;
    suffix[i] = i;
    lengths[i] = 1;
  }
  let next = 258;
  let width = 9;
  let o = 0;
  let previous = -1;
  let bitBuffer = 0;
  let bitCount = 0;
  let i = 0;
  const write = (code: number) => {
    const length = lengths[code]!;
    let end = o + length;
    if (end > expected) end = expected;
    let position = o + length - 1;
    let c = code;
    while (c >= 0) {
      if (position < expected) out[position] = suffix[c]!;
      position--;
      c = prefix[c]!;
    }
    o = end;
  };
  const first = (code: number) => {
    let c = code;
    while (prefix[c]! >= 0) c = prefix[c]!;
    return suffix[c]!;
  };
  while (o < expected) {
    while (bitCount < width && i < data.length) {
      bitBuffer = ((bitBuffer << 8) | data[i++]!) >>> 0;
      bitCount += 8;
    }
    if (bitCount < width) break;
    const code = (bitBuffer >>> (bitCount - width)) & ((1 << width) - 1);
    bitCount -= width;
    if (code === 257) break;
    if (code === 256) {
      next = 258;
      width = 9;
      previous = -1;
      continue;
    }
    if (previous < 0) {
      if (code > 255) fail('damaged');
      write(code);
      previous = code;
      continue;
    }
    if (code < next) {
      write(code);
      if (next < 4096) {
        prefix[next] = previous;
        suffix[next] = first(code);
        lengths[next] = lengths[previous]! + 1;
        next++;
      }
    } else if (code === next && next < 4096) {
      prefix[next] = previous;
      suffix[next] = first(previous);
      lengths[next] = lengths[previous]! + 1;
      next++;
      write(code);
    } else fail('damaged');
    previous = code;
    if (next + 1 >= 1 << width && width < 12) width++;
  }
  return out;
}

/** Inserts the shared JPEGTables into an abbreviated JPEG tile, making it decodable alone. */
function completeJpeg(
  tile: Uint8Array<ArrayBuffer>,
  tables: Uint8Array | undefined,
): Uint8Array<ArrayBuffer> {
  if (!tables || tables.length < 4) return tile;
  // tables: SOI … EOI; tile: SOI … ; result: SOI + tables' body + tile's body.
  const body = tables.subarray(2, tables.length - 2);
  const out = new Uint8Array(tile.length + body.length);
  out.set(tile.subarray(0, 2), 0);
  out.set(body, 2);
  out.set(tile.subarray(2), 2 + body.length);
  return out;
}

interface Layout {
  width: number;
  height: number;
  samples: number;
  bits: number;
  photometric: number;
  planar: number;
  predictor: number;
  alpha: 'none' | 'associated' | 'straight';
  colorMap?: number[];
  little: boolean;
}

/** Converts `rows` of decoded samples (in chunk order) to RGBA and averages them in. */
function emitRows(
  samples: Uint8Array,
  layout: Layout,
  chunkWidth: number,
  rows: number,
  write: (row: number, x: number, rgba: Uint8Array, count: number) => void,
): void {
  const { bits, samples: perPixel, photometric, alpha, colorMap, little } = layout;
  const rowBytes = Math.ceil((chunkWidth * perPixel * bits) / 8);
  const rgba = new Uint8Array(chunkWidth * 4);
  const max = (1 << bits) - 1;
  const sample = (row: Uint8Array, index: number): number => {
    if (bits === 8) return row[index]!;
    if (bits === 16) {
      const hi = little ? row[index * 2 + 1]! : row[index * 2]!;
      return hi;
    }
    const perByte = 8 / bits;
    const shift = (perByte - 1 - (index % perByte)) * bits;
    return Math.round((((row[Math.floor(index / perByte)]! >> shift) & max) * 255) / max);
  };
  const raw = (row: Uint8Array, index: number): number => {
    if (bits === 8) return row[index]!;
    if (bits === 16)
      return little
        ? row[index * 2]! | (row[index * 2 + 1]! << 8)
        : (row[index * 2]! << 8) | row[index * 2 + 1]!;
    const perByte = 8 / bits;
    const shift = (perByte - 1 - (index % perByte)) * bits;
    return (row[Math.floor(index / perByte)]! >> shift) & max;
  };
  for (let r = 0; r < rows; r++) {
    const row = samples.subarray(r * rowBytes, (r + 1) * rowBytes);
    for (let x = 0, o = 0; x < chunkWidth; x++, o += 4) {
      const base = x * perPixel;
      let red: number;
      let green: number;
      let blue: number;
      let a = 255;
      if (photometric === 3 && colorMap) {
        const index = raw(row, base);
        const entries = colorMap.length / 3;
        red = colorMap[index]! >> 8;
        green = colorMap[entries + index]! >> 8;
        blue = colorMap[entries * 2 + index]! >> 8;
      } else if (photometric === 5 && perPixel >= 4) {
        const k = 255 - sample(row, base + 3);
        red = ((255 - sample(row, base)) * k) / 255;
        green = ((255 - sample(row, base + 1)) * k) / 255;
        blue = ((255 - sample(row, base + 2)) * k) / 255;
      } else if (perPixel >= 3 && photometric === 2) {
        red = sample(row, base);
        green = sample(row, base + 1);
        blue = sample(row, base + 2);
        if (alpha !== 'none' && perPixel >= 4) a = sample(row, base + 3);
      } else {
        const value = sample(row, base);
        red = green = blue = photometric === 0 ? 255 - value : value;
        if (alpha !== 'none' && perPixel >= 2) a = sample(row, base + 1);
      }
      if (alpha === 'associated' && a > 0 && a < 255) {
        red = Math.min(255, (red * 255) / a);
        green = Math.min(255, (green * 255) / a);
        blue = Math.min(255, (blue * 255) / a);
      }
      rgba[o] = red;
      rgba[o + 1] = green;
      rgba[o + 2] = blue;
      rgba[o + 3] = a;
    }
    write(r, 0, rgba, chunkWidth);
  }
}

/** Undoes horizontal differencing (predictor 2) on one chunk, in place. */
function undoPredictor(
  samples: Uint8Array,
  layout: Layout,
  chunkWidth: number,
  rows: number,
): void {
  const perPixel = layout.planar === 2 ? 1 : layout.samples;
  if (layout.bits === 8) {
    const rowBytes = chunkWidth * perPixel;
    for (let r = 0; r < rows; r++)
      for (let i = r * rowBytes + perPixel; i < (r + 1) * rowBytes; i++)
        samples[i] = (samples[i]! + samples[i - perPixel]!) & 255;
  } else if (layout.bits === 16) {
    const data = view(samples);
    const rowValues = chunkWidth * perPixel;
    for (let r = 0; r < rows; r++)
      for (let i = r * rowValues + perPixel; i < (r + 1) * rowValues; i++)
        data.setUint16(
          i * 2,
          (data.getUint16(i * 2, layout.little) +
            data.getUint16((i - perPixel) * 2, layout.little)) &
            0xffff,
          layout.little,
        );
  }
}

/**
 * Decodes a TIFF or BigTIFF of any size, strip by strip or tile by tile, straight to a
 * smaller working size. The directory may sit anywhere in the file (often at the end),
 * so everything is read by offset rather than in order.
 */
export async function decodeTiffStream(
  file: Blob,
  sizeFor: SizeFor,
  progress?: Progress,
): Promise<StreamedImage> {
  const head = await readRange(file, 0, Math.min(file.size, 16));
  const little = head[0] === 0x49 && head[1] === 0x49;
  if (!little && !(head[0] === 0x4d && head[1] === 0x4d)) fail('damaged');
  const headReader = new Reader(view(head), little);
  const version = headReader.u16(2);
  const big = version === 43;
  if (version !== 42 && !big) fail('damaged');
  let offset = big ? headReader.u64(8) : headReader.u32(4);

  // The first full-resolution image: reduced-resolution previews have bit 0 set.
  let directory: Directory | undefined;
  for (let guard = 0; offset && guard < 64; guard++) {
    const candidate = await readDirectory(file, offset, little, big);
    if (!((candidate.values.get(TAG.newSubfileType)?.[0] ?? 0) & 1)) {
      directory = candidate;
      break;
    }
    offset = candidate.next;
  }
  if (!directory) fail('damaged');
  const get = (tag: number, fallback?: number) => directory.values.get(tag)?.[0] ?? fallback;
  const width = get(TAG.width)!;
  const height = get(TAG.height)!;
  if (!width || !height) fail('damaged');
  assertDimensions(width, height, 'stream');
  const samples = get(TAG.samplesPerPixel, 1)!;
  const bits = get(TAG.bitsPerSample, 1)!;
  const compression = get(TAG.compression, 1)!;
  const photometric = get(TAG.photometric, samples >= 3 ? 2 : 1)!;
  const planar = get(TAG.planar, 1)!;
  const predictor = get(TAG.predictor, 1)!;
  const extra = get(TAG.extraSamples, 0)!;
  if (
    ![1, 2, 4, 8, 16].includes(bits) ||
    (get(TAG.sampleFormat, 1) !== 1 && get(TAG.sampleFormat, 1) !== 4)
  )
    fail('too-large-to-process');
  if (
    ![1, 5, 7, 8, 32946, 32773].includes(compression) ||
    ![0, 1, 2, 3, 5, 6].includes(photometric)
  )
    fail('too-large-to-process');
  if (photometric === 6 && compression !== 7) fail('too-large-to-process');
  if (predictor !== 1 && predictor !== 2) fail('too-large-to-process');

  const layout: Layout = {
    width,
    height,
    samples,
    bits,
    photometric,
    planar,
    predictor,
    alpha:
      (photometric === 2 && samples >= 4) ||
      ((photometric === 0 || photometric === 1) && samples >= 2)
        ? extra === 1
          ? 'associated'
          : 'straight'
        : 'none',
    colorMap: directory.values.get(TAG.colorMap),
    little,
  };
  const tiled = directory.values.has(TAG.tileOffsets);
  const offsets = directory.values.get(tiled ? TAG.tileOffsets : TAG.stripOffsets);
  const counts = directory.values.get(tiled ? TAG.tileByteCounts : TAG.stripByteCounts);
  if (!offsets || !counts || offsets.length !== counts.length) fail('damaged');
  const chunkWidth = tiled ? get(TAG.tileWidth)! : width;
  const chunkHeight = tiled
    ? get(TAG.tileLength)!
    : Math.min(height, get(TAG.rowsPerStrip, height)!);
  if (!chunkWidth || !chunkHeight) fail('damaged');
  const across = Math.ceil(width / chunkWidth);
  const down = Math.ceil(height / chunkHeight);
  const planes = planar === 2 ? samples : 1;
  if (offsets.length < across * down * planes) fail('damaged');
  const tables = directory.bytes.get(TAG.jpegTables);

  const size = sizeFor(width, height);
  const downscaler = new RowDownscaler(width, height, size.width, size.height);
  const band = new Uint8Array(width * 4 * chunkHeight);
  const totalBytes = counts.reduce((sum, value) => sum + value, 0) || 1;
  let readBytes = 0;

  /** Decompresses one chunk to samples, `rows` × `chunkWidth`, for one plane or all. */
  const decodeChunk = async (
    index: number,
    rows: number,
    perPixel: number,
  ): Promise<Uint8Array> => {
    const expected = Math.ceil((chunkWidth * perPixel * bits) / 8) * rows;
    const data = await readRange(file, offsets[index]!, counts[index]!);
    readBytes += data.length;
    if (compression === 1)
      return data.length >= expected
        ? data
        : (() => {
            const out = new Uint8Array(expected);
            out.set(data);
            return out;
          })();
    if (compression === 32773) return unpackBits(data, expected);
    if (compression === 5) return lzwDecode(data, expected);
    // Loaded only when a Deflate-compressed TIFF is actually read.
    const { inflate } = await import('pako');
    const inflated = inflate(data);
    if (inflated.length >= expected) return inflated;
    const out = new Uint8Array(expected);
    out.set(inflated);
    return out;
  };

  /** A JPEG-compressed chunk, decoded by the browser into RGBA. */
  const decodeJpegChunk = async (index: number): Promise<Uint8Array> => {
    const data = await readRange(file, offsets[index]!, counts[index]!);
    readBytes += data.length;
    const bitmap = await createImageBitmap(
      new Blob([completeJpeg(data, tables)], { type: 'image/jpeg' }),
    ).catch(() => fail('damaged'));
    const canvas = new OffscreenCanvas(chunkWidth, chunkHeight);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) fail('failed');
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    return new Uint8Array(context.getImageData(0, 0, chunkWidth, chunkHeight).data.buffer);
  };

  for (let row = 0; row < down; row++) {
    const top = row * chunkHeight;
    const rows = Math.min(chunkHeight, height - top);
    for (let column = 0; column < across; column++) {
      const left = column * chunkWidth;
      const visible = Math.min(chunkWidth, width - left);
      const index = row * across + column;
      // Rows of RGBA for this chunk, chunkWidth wide (tiles may extend past the edge).
      let chunkRows: Uint8Array;
      if (compression === 7) {
        chunkRows = await decodeJpegChunk(index);
      } else if (planes === 1) {
        const decoded = await decodeChunk(index, tiled ? chunkHeight : rows, samples);
        if (predictor === 2) undoPredictor(decoded, layout, chunkWidth, tiled ? chunkHeight : rows);
        chunkRows = new Uint8Array(chunkWidth * 4 * rows);
        emitRows(decoded, layout, chunkWidth, rows, (r, _x, rgba) =>
          chunkRows.set(rgba, r * chunkWidth * 4),
        );
      } else {
        // Separate planes: gather each sample from its own plane, then interleave.
        const planesData: Uint8Array[] = [];
        for (let plane = 0; plane < planes; plane++) {
          const decoded = await decodeChunk(
            plane * across * down + index,
            tiled ? chunkHeight : rows,
            1,
          );
          if (predictor === 2)
            undoPredictor(
              decoded,
              { ...layout, planar: 2 },
              chunkWidth,
              tiled ? chunkHeight : rows,
            );
          planesData.push(decoded);
        }
        const bytesPerSample = bits === 16 ? 2 : 1;
        if (bits < 8) fail('too-large-to-process');
        const interleaved = new Uint8Array(chunkWidth * rows * samples * bytesPerSample);
        for (let p = 0; p < chunkWidth * rows; p++)
          for (let s = 0; s < samples; s++)
            for (let b = 0; b < bytesPerSample; b++)
              interleaved[(p * samples + s) * bytesPerSample + b] =
                planesData[s]![p * bytesPerSample + b]!;
        chunkRows = new Uint8Array(chunkWidth * 4 * rows);
        emitRows(interleaved, layout, chunkWidth, rows, (r, _x, rgba) =>
          chunkRows.set(rgba, r * chunkWidth * 4),
        );
      }
      for (let r = 0; r < rows; r++)
        band.set(
          chunkRows.subarray(r * chunkWidth * 4, r * chunkWidth * 4 + visible * 4),
          (r * width + left) * 4,
        );
    }
    for (let r = 0; r < rows; r++)
      downscaler.addRow(band.subarray(r * width * 4, (r + 1) * width * 4), top + r);
    progress?.(Math.min(1, readBytes / totalBytes));
  }

  const profile = directory.bytes.get(TAG.iccProfile);
  const color: ColorDescription | undefined =
    profile && profile.length >= 132 ? { kind: 'icc', profile } : undefined;
  const orientation = get(TAG.orientation, 1)!;
  return {
    ...downscaler.finish(),
    fullWidth: width,
    fullHeight: height,
    color,
    orientation: orientation >= 1 && orientation <= 8 ? orientation : 1,
  };
}
