import { deflate } from 'pako';

/**
 * TIFF's LZW: most-significant bit first, 9–12-bit codes. The decoder's table lags the
 * encoder's by one entry, so the encoder widens when its count reaches 2^width and the
 * decoder one entry earlier ("early change").
 */
export function lzwEncode(data: Uint8Array): Uint8Array {
  const out: number[] = [];
  let buffer = 0;
  let bits = 0;
  let width = 9;
  const emit = (code: number) => {
    buffer = (buffer << width) | code;
    bits += width;
    while (bits >= 8) {
      out.push((buffer >>> (bits - 8)) & 255);
      bits -= 8;
    }
    buffer &= (1 << bits) - 1;
  };
  let table = new Map<number, number>();
  let next = 258;
  emit(256);
  if (data.length) {
    let prefix = data[0]!;
    for (let i = 1; i < data.length; i++) {
      const byte = data[i]!;
      const found = table.get(prefix * 256 + byte);
      if (found !== undefined) {
        prefix = found;
        continue;
      }
      emit(prefix);
      table.set(prefix * 256 + byte, next++);
      if (next >= 1 << width && width < 12) width++;
      if (next >= 4094) {
        emit(256);
        table = new Map();
        next = 258;
        width = 9;
      }
      prefix = byte;
    }
    emit(prefix);
  }
  emit(257);
  if (bits > 0) out.push((buffer << (8 - bits)) & 255);
  return Uint8Array.from(out);
}

export function packBits(data: Uint8Array): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < data.length;) {
    let run = 1;
    while (i + run < data.length && run < 128 && data[i + run] === data[i]) run++;
    if (run > 1) {
      out.push((1 - run) & 255, data[i]!);
      i += run;
    } else {
      let literal = 1;
      while (
        i + literal < data.length &&
        literal < 128 &&
        data[i + literal] !== data[i + literal + 1]
      )
        literal++;
      out.push(literal - 1, ...data.subarray(i, i + literal));
      i += literal;
    }
  }
  return Uint8Array.from(out);
}

export interface TiffSpec {
  width: number;
  height: number;
  samples: number;
  bits: number;
  photometric: number;
  /** Chunky samples for the whole image, rows packed as TIFF stores them. */
  data: Uint8Array;
  compression?: 1 | 5 | 8 | 32773;
  predictor?: 1 | 2;
  tile?: { width: number; height: number };
  rowsPerStrip?: number;
  planar?: 1 | 2;
  little?: boolean;
  big?: boolean;
  extraSamples?: number[];
  colorMap?: number[];
  orientation?: number;
  icc?: Uint8Array;
  /** Put a reduced-resolution 1 × 1 preview before the real image. */
  previewFirst?: boolean;
}

/**
 * Writes a TIFF (or BigTIFF) for tests: image data first, directories at the end of the
 * file, which is the layout that defeats readers that only look at the start.
 */
export function writeTiff(spec: TiffSpec): Blob {
  const little = spec.little ?? true;
  const big = spec.big ?? false;
  const bytesPerSample = spec.bits === 16 ? 2 : 1;
  const planar = spec.planar ?? 1;
  const chunkWidth = spec.tile?.width ?? spec.width;
  const chunkHeight = spec.tile?.height ?? spec.rowsPerStrip ?? spec.height;
  const across = Math.ceil(spec.width / chunkWidth);
  const down = Math.ceil(spec.height / chunkHeight);
  const planes = planar === 2 ? spec.samples : 1;
  const perPixel = planar === 2 ? 1 : spec.samples;
  const rowBytes = (width: number) => Math.ceil((width * perPixel * spec.bits) / 8);
  const fullRowBytes = Math.ceil((spec.width * spec.samples * spec.bits) / 8);

  // Extracts one chunk's samples (padded to the chunk size for tiles).
  const chunkData = (plane: number, row: number, column: number): Uint8Array => {
    const rows = spec.tile ? chunkHeight : Math.min(chunkHeight, spec.height - row * chunkHeight);
    const out = new Uint8Array(rowBytes(chunkWidth) * rows);
    for (let r = 0; r < rows; r++) {
      const y = row * chunkHeight + r;
      if (y >= spec.height) break;
      for (let c = 0; c < chunkWidth; c++) {
        const x = column * chunkWidth + c;
        if (x >= spec.width) break;
        if (spec.bits < 8) {
          // Only whole-row strips are used with packed samples in these tests.
          out.set(spec.data.subarray(y * fullRowBytes, (y + 1) * fullRowBytes), r * fullRowBytes);
          break;
        }
        for (let s = 0; s < perPixel; s++) {
          const sample = planar === 2 ? plane : s;
          for (let b = 0; b < bytesPerSample; b++) {
            out[r * rowBytes(chunkWidth) + (c * perPixel + s) * bytesPerSample + b] =
              spec.data[((y * spec.width + x) * spec.samples + sample) * bytesPerSample + b]!;
          }
        }
      }
    }
    if (spec.predictor === 2) {
      // Horizontal differencing, last pixel first so earlier values are still original.
      for (let r = 0; r < rows; r++) {
        if (bytesPerSample === 1) {
          for (let i = rowBytes(chunkWidth) - 1; i >= perPixel; i--) {
            const at = r * rowBytes(chunkWidth) + i;
            out[at] = (out[at]! - out[at - perPixel]! + 256) & 255;
          }
        } else {
          const view = new DataView(out.buffer);
          for (let i = chunkWidth * perPixel - 1; i >= perPixel; i--) {
            const at = r * rowBytes(chunkWidth) + i * 2;
            const value = view.getUint16(at, little) - view.getUint16(at - perPixel * 2, little);
            view.setUint16(at, value & 0xffff, little);
          }
        }
      }
    }
    if (spec.compression === 5) return lzwEncode(out);
    if (spec.compression === 8) return deflate(out);
    if (spec.compression === 32773) return packBits(out);
    return out;
  };

  const parts: Uint8Array[] = [];
  let position = big ? 16 : 8;
  const offsets: number[] = [];
  const counts: number[] = [];
  for (let plane = 0; plane < planes; plane++)
    for (let row = 0; row < down; row++)
      for (let column = 0; column < across; column++) {
        const chunk = chunkData(plane, row, column);
        offsets.push(position);
        counts.push(chunk.length);
        parts.push(chunk);
        position += chunk.length;
      }

  const u16 = (n: number) => (little ? [n & 255, n >>> 8] : [n >>> 8, n & 255]);
  const u32 = (n: number) =>
    little
      ? [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, n >>> 24]
      : [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  const u64 = (n: number) => {
    const low = u32(n % 2 ** 32);
    const high = u32(Math.floor(n / 2 ** 32));
    return little ? [...low, ...high] : [...high, ...low];
  };
  const encode = (type: number, value: number) =>
    type === 3 ? u16(value) : type === 4 ? u32(value) : type === 16 ? u64(value) : [value];

  /** Writes a directory at `position`, returning its bytes (data it points to follows it). */
  const directory = (entries: [number, number, number[] | Uint8Array][], next: number) => {
    entries.sort((a, b) => a[0] - b[0]);
    const entrySize = big ? 20 : 12;
    const inline = big ? 8 : 4;
    const headerBytes = (big ? 8 : 2) + entries.length * entrySize + (big ? 8 : 4);
    let extraAt = position + headerBytes;
    const table: number[] = [...(big ? u64(entries.length) : u16(entries.length))];
    const extra: number[] = [];
    for (const [tag, type, values] of entries) {
      const bytes =
        values instanceof Uint8Array ? [...values] : values.flatMap((v) => encode(type, v));
      table.push(...u16(tag), ...u16(type), ...(big ? u64(values.length) : u32(values.length)));
      if (bytes.length <= inline) {
        table.push(...bytes, ...new Array<number>(inline - bytes.length).fill(0));
      } else {
        table.push(...(big ? u64(extraAt) : u32(extraAt)));
        extra.push(...bytes);
        extraAt += bytes.length;
        if (extraAt % 2) {
          extra.push(0);
          extraAt++;
        }
      }
    }
    table.push(...(big ? u64(next) : u32(next)));
    const bytes = Uint8Array.from([...table, ...extra]);
    position += bytes.length;
    return bytes;
  };

  const offsetType = big ? 16 : 4;
  const entries: [number, number, number[] | Uint8Array][] = [
    [256, 4, [spec.width]],
    [257, 4, [spec.height]],
    [258, 3, new Array<number>(spec.samples).fill(spec.bits)],
    [259, 3, [spec.compression ?? 1]],
    [262, 3, [spec.photometric]],
    [277, 3, [spec.samples]],
    [284, 3, [planar]],
  ];
  if (spec.tile) {
    entries.push([322, 4, [spec.tile.width]], [323, 4, [spec.tile.height]]);
    entries.push([324, offsetType, offsets], [325, 4, counts]);
  } else {
    entries.push([273, offsetType, offsets], [278, 4, [chunkHeight]], [279, 4, counts]);
  }
  if (spec.predictor) entries.push([317, 3, [spec.predictor]]);
  if (spec.extraSamples) entries.push([338, 3, spec.extraSamples]);
  if (spec.colorMap) entries.push([320, 3, spec.colorMap]);
  if (spec.orientation) entries.push([274, 3, [spec.orientation]]);
  if (spec.icc) entries.push([34675, 7, spec.icc]);

  let first: Uint8Array | undefined;
  let firstOffset = position;
  if (spec.previewFirst) {
    // A 1 × 1 grey preview with its own one-byte strip, pointing on to the real image.
    const previewPixel = position;
    parts.push(Uint8Array.from([128, 0]));
    position += 2;
    firstOffset = position;
    const previewEntries: [number, number, number[] | Uint8Array][] = [
      [254, 4, [1]],
      [256, 4, [1]],
      [257, 4, [1]],
      [258, 3, [8]],
      [262, 3, [1]],
      [273, offsetType, [previewPixel]],
      [277, 3, [1]],
      [279, 4, [1]],
    ];
    // Its "next" points to where the main directory will start.
    const size = (big ? 8 : 2) + previewEntries.length * (big ? 20 : 12) + (big ? 8 : 4);
    first = directory(previewEntries, position + size);
  }
  const mainOffset = position;
  const main = directory(entries, 0);
  const header = big
    ? [
        ...(little ? [0x49, 0x49] : [0x4d, 0x4d]),
        ...u16(43),
        ...u16(8),
        ...u16(0),
        ...u64(first ? firstOffset : mainOffset),
      ]
    : [
        ...(little ? [0x49, 0x49] : [0x4d, 0x4d]),
        ...u16(42),
        ...u32(first ? firstOffset : mainOffset),
      ];
  const pieces = [Uint8Array.from(header), ...parts, ...(first ? [first] : []), main];
  return new Blob(pieces.map((piece) => piece.slice()));
}
