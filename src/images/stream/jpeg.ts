import { fail } from '../../utils/errors';
import type { ColorDescription } from '../color';
import { exifOrientation } from '../headers';
import { RowDownscaler } from './downscale';
import { readRange, Source } from './source';
import type { Progress, SizeFor, StreamedImage } from './types';

// A JPEG too big for the browser's decoder is read at one eighth of its size, from each
// 8 × 8 block's DC coefficient: the block's average, which is exactly what libjpeg's
// 1/8 scaling computes. The other 63 coefficients are skipped, never transformed, so
// even a gigapixel JPEG decodes in seconds with memory for the small image only.

/** Bytes of entropy-coded data held at a time. */
const CHUNK = 8 * 1024 * 1024;
/** Unread bytes that guarantee a whole MCU can be decoded without refilling. */
const MARGIN = 64 * 1024;
/** DC values kept, across all components; about 1.6 GB of 16-bit values at most. */
const MAX_BLOCKS = 800_000_000;

interface Huffman {
  /** Indexed by the next 16 bits: (code length << 8) | symbol, or 0 for no code. */
  lookup: Uint16Array;
}

function buildHuffman(counts: Uint8Array, symbols: Uint8Array): Huffman {
  const lookup = new Uint16Array(65536);
  let code = 0;
  let k = 0;
  for (let length = 1; length <= 16; length++) {
    for (let i = 0; i < counts[length - 1]!; i++) {
      const symbol = symbols[k++]!;
      const shift = 16 - length;
      lookup.fill((length << 8) | symbol, code << shift, (code + 1) << shift);
      code++;
    }
    code <<= 1;
  }
  return { lookup };
}

interface Component {
  id: number;
  h: number;
  v: number;
  quant: number;
  /** Blocks across and down, padded to whole MCUs. */
  blocksX: number;
  blocksY: number;
  dc: Int32Array;
  predictor: number;
  dcTable?: Huffman;
  acTable?: Huffman;
}

/** Entropy-coded data: a bit reader over a sliding window of the file. */
class Bits {
  private data = new Uint8Array(0);
  private pos = 0;
  /** File offset of data[0]. */
  private base: number;
  private buffer = 0;
  private count = 0;
  /** A marker was reached; zero bits are fed until the scan ends. */
  private marker = false;

  constructor(
    private readonly file: Blob,
    start: number,
  ) {
    this.base = start;
  }

  /** File offset of the next unread byte. */
  get offset(): number {
    return this.base + this.pos;
  }

  /** Keeps at least MARGIN bytes ready, so the next MCU never runs out mid-way. */
  async ready(): Promise<void> {
    if (this.data.length - this.pos >= MARGIN) return;
    const start = this.base + this.data.length;
    if (start >= this.file.size) return;
    const more = await readRange(this.file, start, Math.min(CHUNK, this.file.size - start));
    const joined = new Uint8Array(this.data.length - this.pos + more.length);
    joined.set(this.data.subarray(this.pos));
    joined.set(more, this.data.length - this.pos);
    this.base += this.pos;
    this.data = joined;
    this.pos = 0;
  }

  private fill(): void {
    while (this.count <= 24) {
      let byte = 0;
      if (!this.marker && this.pos < this.data.length) {
        byte = this.data[this.pos]!;
        if (byte === 0xff) {
          const next = this.data[this.pos + 1];
          if (next === 0x00) this.pos += 2;
          else {
            // A marker ends the data; it is left for the parser.
            this.marker = true;
            byte = 0;
          }
        } else this.pos++;
      }
      this.buffer = ((this.buffer << 8) | byte) >>> 0;
      this.count += 8;
    }
  }

  decode(table: Huffman | undefined): number {
    if (!table) fail('damaged');
    this.fill();
    const entry = table.lookup[(this.buffer >>> (this.count - 16)) & 0xffff]!;
    if (!entry) fail('damaged');
    this.count -= entry >> 8;
    return entry & 0xff;
  }

  receive(length: number): number {
    if (!length) return 0;
    this.fill();
    const value = (this.buffer >>> (this.count - length)) & ((1 << length) - 1);
    this.count -= length;
    return value;
  }

  /** A signed coefficient of `length` bits (JPEG's EXTEND). */
  signed(length: number): number {
    const value = this.receive(length);
    return value < 1 << (length - 1) ? value - (1 << length) + 1 : value;
  }

  /** At a restart marker: drop leftover bits and step over the marker. */
  restart(): void {
    this.count = 0;
    this.buffer = 0;
    this.marker = false;
    while (this.pos + 1 < this.data.length) {
      if (
        this.data[this.pos] === 0xff &&
        this.data[this.pos + 1]! >= 0xd0 &&
        this.data[this.pos + 1]! <= 0xd7
      ) {
        this.pos += 2;
        return;
      }
      this.pos++;
    }
  }
}

/** Skips the 63 AC coefficients of one block in a sequential scan. */
function skipAc(bits: Bits, table: Huffman | undefined): void {
  for (let k = 1; k < 64;) {
    const symbol = bits.decode(table);
    const run = symbol >> 4;
    const size = symbol & 15;
    if (!size) {
      if (run !== 15) return;
      k += 16;
      continue;
    }
    k += run;
    bits.receive(size);
    k++;
  }
}

/** Finds the next marker at or after `offset`; returns the offset of its 0xFF byte. */
async function nextMarker(file: Blob, offset: number): Promise<number> {
  for (let start = offset; start < file.size;) {
    const data = await readRange(file, start, Math.min(CHUNK, file.size - start));
    for (let i = 0; i + 1 < data.length; i++) {
      if (data[i] !== 0xff) continue;
      const next = data[i + 1]!;
      if (next !== 0x00 && next !== 0xff && (next < 0xd0 || next > 0xd7)) return start + i;
    }
    // Keep the last byte, in case it is the 0xFF of a marker split across reads.
    start += Math.max(1, data.length - 1);
  }
  return file.size;
}

export async function decodeJpegStream(
  file: Blob,
  sizeFor: SizeFor,
  progress?: Progress,
): Promise<StreamedImage> {
  const source = new Source(file);
  if ((await source.u16()) !== 0xffd8) fail('damaged');
  const quant: number[] = [1, 1, 1, 1];
  const dcTables: (Huffman | undefined)[] = [];
  const acTables: (Huffman | undefined)[] = [];
  const iccParts: Uint8Array[] = [];
  let components: Component[] = [];
  let width = 0;
  let height = 0;
  let progressive = false;
  let restartInterval = 0;
  let adobeTransform: number | undefined;
  let orientation = 1;
  let maxH = 1;
  let maxV = 1;
  let mcusX = 0;
  let mcusY = 0;

  for (;;) {
    let marker = await source.u8();
    if (marker !== 0xff) fail('damaged');
    do marker = await source.u8();
    while (marker === 0xff);
    if (marker === 0xd9) break; // EOI
    if (marker >= 0xd0 && marker <= 0xd7) continue;
    const length = (await source.u16()) - 2;
    if (length < 0) fail('damaged');
    const segmentStart = source.position;

    if (marker === 0xe1) {
      const data = await source.bytes(Math.min(length, 65_533));
      if (String.fromCharCode(...data.subarray(0, 4)) === 'Exif')
        orientation = exifOrientation(data);
    } else if (marker === 0xe2) {
      const data = await source.copy(length);
      if (String.fromCharCode(...data.subarray(0, 11)) === 'ICC_PROFILE')
        iccParts[data[12]! - 1] = data.subarray(14);
    } else if (marker === 0xee) {
      const data = await source.bytes(length);
      if (String.fromCharCode(...data.subarray(0, 5)) === 'Adobe' && data.length >= 12)
        adobeTransform = data[11];
    } else if (marker === 0xdb) {
      const data = await source.bytes(length);
      for (let i = 0; i < data.length;) {
        const precision = data[i]! >> 4;
        const id = data[i]! & 15;
        quant[id] = precision ? (data[i + 1]! << 8) | data[i + 2]! : data[i + 1]!;
        i += 1 + 64 * (precision ? 2 : 1);
      }
    } else if (marker === 0xc4) {
      const data = await source.bytes(length);
      for (let i = 0; i < data.length;) {
        const kind = data[i]! >> 4;
        const id = data[i]! & 15;
        const counts = data.subarray(i + 1, i + 17);
        const total = counts.reduce((sum, value) => sum + value, 0);
        const table = buildHuffman(counts, data.subarray(i + 17, i + 17 + total));
        (kind ? acTables : dcTables)[id] = table;
        i += 17 + total;
      }
    } else if (marker === 0xdd) {
      restartInterval = await source.u16();
    } else if (
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc
    ) {
      // Baseline, extended and progressive Huffman only; arithmetic and lossless are rare.
      if (marker !== 0xc0 && marker !== 0xc1 && marker !== 0xc2) fail('too-large-to-process');
      progressive = marker === 0xc2;
      const data = await source.bytes(length);
      if (data[0] !== 8) fail('too-large-to-process');
      height = (data[1]! << 8) | data[2]!;
      width = (data[3]! << 8) | data[4]!;
      if (!width || !height) fail('damaged');
      components = [];
      for (let i = 0; i < data[5]!; i++) {
        const at = 6 + i * 3;
        components.push({
          id: data[at]!,
          h: data[at + 1]! >> 4 || 1,
          v: data[at + 1]! & 15 || 1,
          quant: data[at + 2]! & 3,
          blocksX: 0,
          blocksY: 0,
          dc: new Int32Array(0),
          predictor: 0,
        });
      }
      maxH = Math.max(...components.map((c) => c.h));
      maxV = Math.max(...components.map((c) => c.v));
      mcusX = Math.ceil(width / (8 * maxH));
      mcusY = Math.ceil(height / (8 * maxV));
      const blocks = components.reduce((sum, c) => sum + mcusX * c.h * mcusY * c.v, 0);
      if (blocks > MAX_BLOCKS) fail('too-large-to-process');
      for (const c of components) {
        c.blocksX = mcusX * c.h;
        c.blocksY = mcusY * c.v;
        c.dc = new Int32Array(c.blocksX * c.blocksY);
      }
    } else if (marker === 0xda) {
      const data = await source.bytes(length);
      const count = data[0]!;
      const scan: Component[] = [];
      for (let i = 0; i < count; i++) {
        const component = components.find((c) => c.id === data[1 + i * 2]);
        if (!component) fail('damaged');
        component.dcTable = dcTables[data[2 + i * 2]! >> 4];
        component.acTable = acTables[data[2 + i * 2]! & 15];
        scan.push(component);
      }
      const at = 1 + count * 2;
      const spectralStart = data[at]!;
      const approxHigh = data[at + 2]! >> 4;
      const approxLow = data[at + 2]! & 15;
      const dataStart = segmentStart + length;
      if (progressive && spectralStart > 0) {
        // AC detail is not needed at one eighth size: jump to the next marker.
        source.seek(await nextMarker(file, dataStart));
        continue;
      }
      const end = await decodeScan(file, dataStart, scan, {
        progressive,
        refine: approxHigh > 0,
        shift: progressive ? approxLow : 0,
        restartInterval,
        mcusX,
        mcusY,
        width,
        height,
        maxH,
        maxV,
        progress,
      });
      source.seek(await nextMarker(file, end));
      continue;
    }
    source.seek(segmentStart + length);
  }
  if (!components.length) fail('damaged');

  // One eighth of the image, from the DC values, then averaged to the working size.
  const gridWidth = Math.ceil(width / 8);
  const gridHeight = Math.ceil(height / 8);
  const wanted = sizeFor(width, height);
  const target = {
    width: Math.min(gridWidth, wanted.width),
    height: Math.min(gridHeight, wanted.height),
  };
  const downscaler = new RowDownscaler(gridWidth, gridHeight, target.width, target.height);
  const rgba = new Uint8Array(gridWidth * 4);
  const levels = components.map(() => new Uint8Array(gridWidth));
  const clamp = (value: number) => (value < 0 ? 0 : value > 255 ? 255 : Math.round(value));
  /**
   * Where output position `i` falls between a component's samples, centre to centre:
   * subsampled colour is blended between neighbours, as libjpeg's upsampling does,
   * rather than repeated in steps.
   */
  const between = (i: number, factor: number, max: number, count: number) => {
    const position = Math.max(0, ((i + 0.5) * factor) / max - 0.5);
    const low = Math.min(count - 1, Math.floor(position));
    return { low, high: Math.min(count - 1, low + 1), weight: position - Math.floor(position) };
  };
  const columns = components.map((c) =>
    Array.from({ length: gridWidth }, (_, x) => between(x, c.h, maxH, c.blocksX)),
  );
  for (let y = 0; y < gridHeight; y++) {
    components.forEach((c, index) => {
      const { low: top, high: bottom, weight: down } = between(y, c.v, maxV, c.blocksY);
      const scale = quant[c.quant]! / 8;
      const upper = top * c.blocksX;
      const lower = bottom * c.blocksX;
      const spots = columns[index]!;
      for (let x = 0; x < gridWidth; x++) {
        const { low, high, weight } = spots[x]!;
        const above = c.dc[upper + low]! + (c.dc[upper + high]! - c.dc[upper + low]!) * weight;
        const below = c.dc[lower + low]! + (c.dc[lower + high]! - c.dc[lower + low]!) * weight;
        levels[index]![x] = clamp((above + (below - above) * down) * scale + 128);
      }
    });
    // Three components are YCbCr unless an Adobe marker says RGB; four are CMYK, or
    // YCCK when the Adobe marker says so.
    const ycc = components.length === 3 ? adobeTransform !== 0 : adobeTransform === 2;
    for (let x = 0, o = 0; x < gridWidth; x++, o += 4) {
      if (components.length < 3) {
        rgba[o] = rgba[o + 1] = rgba[o + 2] = levels[0]![x]!;
      } else {
        const first = levels[0]![x]!;
        const second = levels[1]![x]!;
        const third = levels[2]![x]!;
        let r = first;
        let g = second;
        let b = third;
        if (ycc) {
          r = clamp(first + 1.402 * (third - 128));
          g = clamp(first - 0.344136 * (second - 128) - 0.714136 * (third - 128));
          b = clamp(first + 1.772 * (second - 128));
        }
        if (components.length === 4) {
          // Adobe stores CMYK inverted, so these values are already 255 − ink.
          const k = levels[3]![x]!;
          r = (r * k) / 255;
          g = (g * k) / 255;
          b = (b * k) / 255;
        }
        rgba[o] = r;
        rgba[o + 1] = g;
        rgba[o + 2] = b;
      }
      rgba[o + 3] = 255;
    }
    downscaler.addRow(rgba, y);
  }

  const total = iccParts.reduce((sum, part) => sum + (part?.length ?? 0), 0);
  let color: ColorDescription | undefined;
  if (total >= 132 && iccParts.every(Boolean)) {
    const profile = new Uint8Array(total);
    let offset = 0;
    for (const part of iccParts) {
      profile.set(part, offset);
      offset += part.length;
    }
    color = { kind: 'icc', profile };
  }
  return {
    ...downscaler.finish(),
    fullWidth: width,
    fullHeight: height,
    color,
    orientation,
  };
}

interface ScanOptions {
  progressive: boolean;
  refine: boolean;
  shift: number;
  restartInterval: number;
  mcusX: number;
  mcusY: number;
  width: number;
  height: number;
  maxH: number;
  maxV: number;
  progress?: Progress;
}

/** Decodes one scan's DC values; returns the file offset where its data stops. */
async function decodeScan(
  file: Blob,
  start: number,
  scan: Component[],
  options: ScanOptions,
): Promise<number> {
  const bits = new Bits(file, start);
  for (const component of scan) component.predictor = 0;
  const single = scan.length === 1;
  const only = scan[0]!;
  // A single-component scan codes just that component's own blocks, in raster order,
  // without MCU padding; an interleaved one codes whole MCUs.
  const codedX = single
    ? Math.ceil(Math.ceil((options.width * only.h) / options.maxH) / 8)
    : options.mcusX;
  const codedY = single
    ? Math.ceil(Math.ceil((options.height * only.v) / options.maxV) / 8)
    : options.mcusY;
  const total = codedX * codedY;
  const block = (component: Component, index: number) => {
    if (options.refine) {
      if (bits.receive(1)) component.dc[index]! |= 1 << options.shift;
      return;
    }
    const size = bits.decode(component.dcTable);
    component.predictor += size ? bits.signed(size) : 0;
    component.dc[index] = component.predictor << options.shift;
    if (!options.progressive) skipAc(bits, component.acTable);
  };
  for (let unit = 0; unit < total; unit++) {
    if (options.restartInterval && unit > 0 && unit % options.restartInterval === 0) {
      bits.restart();
      for (const component of scan) component.predictor = 0;
    }
    if (!(unit & 63)) {
      await bits.ready();
      if (!(unit & 0xffff)) options.progress?.(bits.offset / file.size);
    }
    if (single) {
      block(only, Math.floor(unit / codedX) * only.blocksX + (unit % codedX));
    } else {
      const mcuX = unit % options.mcusX;
      const mcuY = Math.floor(unit / options.mcusX);
      for (const component of scan)
        for (let v = 0; v < component.v; v++)
          for (let h = 0; h < component.h; h++)
            block(component, (mcuY * component.v + v) * component.blocksX + mcuX * component.h + h);
    }
  }
  return bits.offset;
}
