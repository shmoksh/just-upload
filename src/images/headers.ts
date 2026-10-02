import type { ImageFormat } from '../models';
import { assertDimensions } from '../security/limits';
import { fail } from '../utils/errors';
import type { ColorDescription } from './color';

export interface ImageHeader {
  format: ImageFormat;
  /** Stored pixel size, before any orientation is applied. */
  width: number;
  height: number;
  /** More than one frame or page. */
  animated: boolean;
  mayHaveAlpha: boolean;
  /** EXIF orientation, 1–8. */
  orientation: number;
  /** The colour profile, for formats whose decoders return raw values (HEIF, TIFF). */
  color?: ColorDescription;
}

/**
 * Formats whose stored size may not be the size a person sees: HEIF-family and JPEG XL
 * rotate after decoding, and SVG has no fixed pixel size. Shape decisions for these
 * wait for the decoder.
 */
export const SIZE_SETTLED_BY_DECODER: ReadonlySet<ImageFormat> = new Set([
  'heic',
  'heif',
  'avif',
  'jxl',
  'svg',
]);

const ascii = (bytes: Uint8Array, start: number, length: number): string =>
  String.fromCharCode(...bytes.subarray(start, Math.min(bytes.length, start + length)));
const HEIC_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs']);
const HEIF_BRANDS = new Set(['mif1', 'msf1']);
const AVIF_BRANDS = new Set(['avif', 'avis']);
const SEQUENCE_BRANDS = /msf1|hevc|hevx|hevm|hevs|avis/;
const JPEG_FRAME_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);
const BMP_HEADER_SIZES = new Set([12, 16, 40, 52, 56, 64, 108, 124]);
const JXL_CONTAINER = [0, 0, 0, 0x0c, 0x4a, 0x58, 0x4c, 0x20, 0x0d, 0x0a, 0x87, 0x0a];
const SVG_START = /^\s*(?:<\?xml[^>]*>\s*)?(?:(?:<!--[\s\S]*?-->|<!DOCTYPE[^>]*>)\s*)*<svg[\s>/]/i;

/**
 * The in-page check reads only the start of a file. While `partial` is set, running out
 * of bytes means "read more", not "damaged".
 */
const NEED_MORE = new Error('need-more');
let partial = false;
function short(): never {
  if (partial) throw NEED_MORE;
  return fail('damaged');
}

function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function sniffText(bytes: Uint8Array): string {
  return new TextDecoder('utf-8').decode(bytes.subarray(0, 4096)).replace(/^\uFEFF/, '');
}

/** Identifies the format from the file's first bytes; names and MIME types can lie. */
export function detectFormat(bytes: Uint8Array): ImageFormat {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if (bytes.length >= 8 && ascii(bytes, 0, 8) === '\x89PNG\r\n\x1a\n') return 'png';
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') {
    return 'webp';
  }
  if (bytes.length >= 10 && /^GIF8[79]a$/.test(ascii(bytes, 0, 6))) return 'gif';
  if (bytes.length >= 18 && ascii(bytes, 0, 2) === 'BM') {
    if (BMP_HEADER_SIZES.has(view(bytes).getUint32(14, true))) return 'bmp';
  }
  if (bytes.length >= 8) {
    const order = ascii(bytes, 0, 4);
    // Classic TIFF, and BigTIFF (64-bit offsets, for files over 4 GB).
    if (order === 'II*\0' || order === 'MM\0*' || order === 'II+\0' || order === 'MM\0+')
      return 'tiff';
  }
  if (
    bytes.length >= 22 &&
    bytes[0] === 0 &&
    bytes[1] === 0 &&
    (bytes[2] === 1 || bytes[2] === 2)
  ) {
    const count = view(bytes).getUint16(4, true);
    if (bytes[3] === 0 && count > 0 && bytes[9] === 0) return 'ico';
  }
  if (bytes[0] === 0xff && bytes[1] === 0x0a) return 'jxl';
  if (bytes.length >= 12 && JXL_CONTAINER.every((value, i) => bytes[i] === value)) return 'jxl';
  if (bytes.length >= 16 && ascii(bytes, 4, 4) === 'ftyp') {
    const end = Math.min(view(bytes).getUint32(0), bytes.length, 256);
    const brands = [ascii(bytes, 8, 4)];
    for (let offset = 16; offset + 4 <= end; offset += 4) brands.push(ascii(bytes, offset, 4));
    if (brands.some((brand) => AVIF_BRANDS.has(brand))) return 'avif';
    if (brands.some((brand) => HEIC_BRANDS.has(brand))) return 'heic';
    if (brands.some((brand) => HEIF_BRANDS.has(brand))) return 'heif';
  }
  if (bytes.length >= 5 && SVG_START.test(sniffText(bytes))) return 'svg';
  return 'unknown';
}

/** Reads only the orientation tag. No other EXIF value is kept or shown. */
export function exifOrientation(bytes: Uint8Array): number {
  const start = ascii(bytes, 0, 6) === 'Exif\0\0' ? 6 : 0;
  if (bytes.length < start + 8) return 1;
  const little = ascii(bytes, start, 2) === 'II';
  if (!little && ascii(bytes, start, 2) !== 'MM') return 1;
  const data = view(bytes);
  if (data.getUint16(start + 2, little) !== 42) return 1;
  const ifd = start + data.getUint32(start + 4, little);
  if (ifd < start || ifd + 2 > bytes.length) return 1;
  const count = Math.min(data.getUint16(ifd, little), 512);
  for (let i = 0; i < count; i++) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > bytes.length) break;
    if (data.getUint16(entry, little) === 0x0112 && data.getUint16(entry + 2, little) === 3) {
      const value = data.getUint16(entry + 8, little);
      return value >= 1 && value <= 8 ? value : 1;
    }
  }
  return 1;
}

/** Width and height as a person sees the image, after EXIF rotation. */
export function displaySize(header: Pick<ImageHeader, 'width' | 'height' | 'orientation'>) {
  return header.orientation >= 5
    ? { width: header.height, height: header.width }
    : { width: header.width, height: header.height };
}

function parsePng(bytes: Uint8Array, data: DataView, header: ImageHeader): void {
  if (bytes.length < 33 || ascii(bytes, 12, 4) !== 'IHDR' || data.getUint32(8) !== 13) {
    fail('damaged');
  }
  header.width = data.getUint32(16);
  header.height = data.getUint32(20);
  header.mayHaveAlpha = bytes[25] === 4 || bytes[25] === 6;
  // The size is all a quick check needs; the full walk finds animation and transparency.
  if (partial) return;
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const length = data.getUint32(offset);
    const kind = ascii(bytes, offset + 4, 4);
    if (length > bytes.length - offset - 12) short();
    if (kind === 'acTL') header.animated = true;
    if (kind === 'tRNS') header.mayHaveAlpha = true;
    if (kind === 'IEND') return;
    offset += length + 12;
  }
  short();
}

function parseJpeg(bytes: Uint8Array, data: DataView, header: ImageHeader): void {
  let offset = 2;
  while (offset < bytes.length) {
    if (bytes[offset++] !== 0xff) fail('damaged');
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === undefined) short();
    if (marker === 0xda || marker === 0xd9) return;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) short();
    const length = data.getUint16(offset);
    if (length < 2) fail('damaged');
    if (offset + length > bytes.length) short();
    if (marker === 0xe1) {
      header.orientation = exifOrientation(bytes.subarray(offset + 2, offset + length));
    }
    if (JPEG_FRAME_MARKERS.has(marker)) {
      if (length < 8) fail('damaged');
      header.height = data.getUint16(offset + 3);
      header.width = data.getUint16(offset + 5);
    }
    offset += length;
  }
  if (!header.width) short();
}

function parseWebp(bytes: Uint8Array, data: DataView, header: ImageHeader): void {
  if (bytes.length < 20) short();
  let end = data.getUint32(4, true) + 8;
  if (end > bytes.length) {
    if (!partial) fail('damaged');
    end = bytes.length;
  }
  for (let offset = 12; offset + 8 <= end;) {
    const kind = ascii(bytes, offset, 4);
    const length = data.getUint32(offset + 4, true);
    const start = offset + 8;
    if (length > end - start) {
      if (partial && header.width) return;
      short();
    }
    if (kind === 'VP8X') {
      if (length < 10) fail('damaged');
      const flags = data.getUint8(start);
      header.mayHaveAlpha = Boolean(flags & 0x10);
      header.animated = Boolean(flags & 0x02);
      header.width =
        1 +
        data.getUint8(start + 4) +
        (data.getUint8(start + 5) << 8) +
        (data.getUint8(start + 6) << 16);
      header.height =
        1 +
        data.getUint8(start + 7) +
        (data.getUint8(start + 8) << 8) +
        (data.getUint8(start + 9) << 16);
    } else if (kind === 'VP8 ' && !header.width) {
      if (length < 10 || ascii(bytes, start + 3, 3) !== '\x9d\x01\x2a') fail('damaged');
      header.width = data.getUint16(start + 6, true) & 0x3fff;
      header.height = data.getUint16(start + 8, true) & 0x3fff;
    } else if (kind === 'VP8L' && !header.width) {
      if (length < 5 || data.getUint8(start) !== 0x2f) fail('damaged');
      const bits = data.getUint32(start + 1, true);
      header.width = (bits & 0x3fff) + 1;
      header.height = ((bits >>> 14) & 0x3fff) + 1;
      header.mayHaveAlpha = Boolean((bits >>> 28) & 1);
    } else if (kind === 'EXIF') {
      header.orientation = exifOrientation(bytes.subarray(start, start + length));
    }
    if (kind === 'ALPH') header.mayHaveAlpha = true;
    if (kind === 'ANIM' || kind === 'ANMF') header.animated = true;
    offset = start + length + (length % 2);
  }
}

/**
 * Walks ISO-BMFF box boundaries (HEIC, HEIF, AVIF) and checks every declared size before
 * a decoder can allocate a pixel buffer for it.
 */
function parseIsoMedia(bytes: Uint8Array, data: DataView, header: ImageHeader): void {
  let boxes = 0;
  const walk = (start: number, end: number, depth: number): void => {
    if (depth > 8) fail('damaged');
    for (let offset = start; offset + 8 <= end;) {
      if (++boxes > 4096) fail('damaged');
      let length = data.getUint32(offset);
      let body = offset + 8;
      const kind = ascii(bytes, offset + 4, 4);
      if (length === 1) {
        if (offset + 16 > end || data.getUint32(offset + 8) !== 0) fail('damaged');
        length = data.getUint32(offset + 12);
        body += 8;
      } else if (length === 0) length = end - offset;
      if (length < body - offset) fail('damaged');
      if (length > end - offset) {
        // In a partial read, a box running past the slice (usually the pixel data)
        // ends the walk; the size boxes come before it.
        if (partial && header.width) return;
        short();
      }
      const next = offset + length;
      if (kind === 'ispe') {
        if (next - body < 12) fail('damaged');
        const width = data.getUint32(body + 4);
        const height = data.getUint32(body + 8);
        assertDimensions(width, height);
        if (width * height > header.width * header.height) {
          header.width = width;
          header.height = height;
        }
      }
      if (kind === 'colr' && next - body >= 4) {
        const type = ascii(bytes, body, 4);
        // An embedded ICC profile is the exact description; it wins over the code points.
        if ((type === 'prof' || type === 'rICC') && next - body > 4) {
          header.color = { kind: 'icc', profile: bytes.slice(body + 4, next) };
        } else if (type === 'nclx' && next - body >= 10) {
          header.color ??= {
            kind: 'nclx',
            primaries: data.getUint16(body + 4),
            transfer: data.getUint16(body + 6),
          };
        }
      }
      if (kind === 'moov') header.animated = true;
      if (kind === 'meta') walk(body + 4, next, depth + 1);
      if (kind === 'iprp' || kind === 'ipco') walk(body, next, depth + 1);
      offset = next;
    }
  };
  walk(0, bytes.length, 0);
  if (SEQUENCE_BRANDS.test(ascii(bytes, 8, Math.min(128, bytes.length - 8))))
    header.animated = true;
  header.mayHaveAlpha = true;
}

/** Skips GIF data sub-blocks; returns the offset after the terminator. */
function skipSubBlocks(bytes: Uint8Array, offset: number): number {
  while (offset < bytes.length) {
    const size = bytes[offset++]!;
    if (size === 0) return offset;
    offset += size;
  }
  return short();
}

function parseGif(bytes: Uint8Array, data: DataView, header: ImageHeader): void {
  header.width = data.getUint16(6, true);
  header.height = data.getUint16(8, true);
  if (partial) return;
  const packed = bytes[10]!;
  let offset = 13 + (packed & 0x80 ? 3 * 2 ** ((packed & 7) + 1) : 0);
  let frames = 0;
  // Stops at the second frame: enough to know it is animated.
  for (let blocks = 0; offset < bytes.length && frames < 2 && blocks < 10_000; blocks++) {
    const introducer = bytes[offset++];
    if (introducer === 0x21) {
      const label = bytes[offset++];
      if (label === 0xf9 && bytes[offset] === 4 && (bytes[offset + 1]! & 1) === 1)
        header.mayHaveAlpha = true;
      offset = skipSubBlocks(bytes, offset);
    } else if (introducer === 0x2c) {
      frames++;
      const local = bytes[offset + 8]!;
      offset += 9 + (local & 0x80 ? 3 * 2 ** ((local & 7) + 1) : 0) + 1;
      offset = skipSubBlocks(bytes, offset);
    } else if (introducer === 0x3b) break;
    else if (frames) break;
    else fail('damaged');
  }
  if (!frames) fail('damaged');
  header.animated = frames > 1;
}

function parseBmp(bytes: Uint8Array, data: DataView, header: ImageHeader): void {
  const size = data.getUint32(14, true);
  if (bytes.length < 14 + size) short();
  if (!partial && data.getUint32(10, true) > bytes.length) fail('damaged');
  if (size === 12) {
    header.width = data.getUint16(18, true);
    header.height = data.getUint16(20, true);
  } else {
    header.width = data.getInt32(18, true);
    header.height = Math.abs(data.getInt32(22, true));
    header.mayHaveAlpha = data.getUint16(28, true) === 32;
  }
}

const TIFF_TAG = {
  width: 256,
  height: 257,
  orientation: 274,
  extraSamples: 338,
  iccProfile: 34675,
  dngVersion: 50706,
};
/** ICC profiles are a few kilobytes; anything far larger is not one. */
const MAX_ICC_BYTES = 4 * 1024 * 1024;

/** BigTIFF: TIFF with 64-bit offsets, the only way past 4 GB. */
export function isBigTiff(bytes: Uint8Array): boolean {
  return detectFormat(bytes) === 'tiff' && (bytes[2] === 43 || bytes[3] === 43);
}

function parseTiff(bytes: Uint8Array, data: DataView, header: ImageHeader): void {
  const little = bytes[0] === 0x49;
  const big = isBigTiff(bytes);
  // Canon CR2 and DNG raw photos are TIFF-shaped but are not finished images.
  if (!big && ascii(bytes, 8, 2) === 'CR') fail('unsupported-format');
  if (bytes.length < (big ? 16 : 8)) short();
  const u64 = (at: number) =>
    data.getUint32(at + (little ? 4 : 0), little) * 2 ** 32 +
    data.getUint32(at + (little ? 0 : 4), little);
  if (big && data.getUint16(4, little) !== 8) fail('damaged');
  const ifd = big ? u64(8) : data.getUint32(4, little);
  if (ifd < 8) fail('damaged');
  const countSize = big ? 8 : 2;
  const entrySize = big ? 20 : 12;
  const valueAt = big ? 12 : 8;
  if (ifd + countSize > bytes.length) short();
  const count = big ? u64(ifd) : data.getUint16(ifd, little);
  if (ifd + countSize + count * entrySize + countSize > bytes.length) short();
  for (let i = 0; i < count; i++) {
    const entry = ifd + countSize + i * entrySize;
    const tag = data.getUint16(entry, little);
    const type = data.getUint16(entry + 2, little);
    const value =
      type === 3
        ? data.getUint16(entry + valueAt, little)
        : type === 16
          ? u64(entry + valueAt)
          : data.getUint32(entry + valueAt, little);
    if (tag === TIFF_TAG.width) header.width = value;
    else if (tag === TIFF_TAG.height) header.height = value;
    else if (tag === TIFF_TAG.orientation)
      header.orientation = value >= 1 && value <= 8 ? value : 1;
    else if (tag === TIFF_TAG.extraSamples) header.mayHaveAlpha = true;
    else if (tag === TIFF_TAG.iccProfile) {
      const length = big ? u64(entry + 4) : data.getUint32(entry + 4, little);
      // Beyond a partial read's slice it is simply not needed yet.
      if (length >= 132 && length <= MAX_ICC_BYTES && value + length <= bytes.length)
        header.color = { kind: 'icc', profile: bytes.slice(value, value + length) };
    } else if (tag === TIFF_TAG.dngVersion) fail('unsupported-format');
  }
  // A second directory is a second page.
  const next = ifd + countSize + count * entrySize;
  header.animated = (big ? u64(next) : data.getUint32(next, little)) !== 0;
}

function parseIco(bytes: Uint8Array, data: DataView, header: ImageHeader): void {
  const count = data.getUint16(4, true);
  if (count > 256) fail('damaged');
  if (bytes.length < 6 + count * 16) short();
  for (let i = 0; i < count; i++) {
    const entry = 6 + i * 16;
    const width = bytes[entry] || 256;
    const height = bytes[entry + 1] || 256;
    const size = data.getUint32(entry + 8, true);
    const offset = data.getUint32(entry + 12, true);
    if (!size || offset < 6 + count * 16) fail('damaged');
    if (!partial && offset + size > bytes.length) fail('damaged');
    if (width * height > header.width * header.height) {
      header.width = width;
      header.height = height;
    }
  }
  header.mayHaveAlpha = true;
}

const SVG_UNITS: Record<string, number> = {
  '': 1,
  px: 1,
  pt: 4 / 3,
  pc: 16,
  in: 96,
  cm: 96 / 2.54,
  mm: 96 / 25.4,
};

function svgLength(tag: string, name: string): number | undefined {
  const match = new RegExp(`\\s${name}\\s*=\\s*["']\\s*([\\d.]+)\\s*([a-z%]*)\\s*["']`, 'i').exec(
    tag,
  );
  if (!match) return undefined;
  const unit = SVG_UNITS[match[2]!.toLowerCase()];
  const value = Number(match[1]) * (unit ?? Number.NaN);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

/** An SVG's intrinsic size from its root element: width/height, else viewBox, else 300 × 150. */
function parseSvg(bytes: Uint8Array, header: ImageHeader): void {
  const tag = /<svg[\s\S]*?>/i.exec(sniffText(bytes))?.[0] ?? '';
  const box =
    /\sviewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)\s*["']/i.exec(tag);
  const boxWidth = box ? Number(box[1]) : undefined;
  const boxHeight = box ? Number(box[2]) : undefined;
  let width = svgLength(tag, 'width');
  let height = svgLength(tag, 'height');
  if (boxWidth && boxHeight) {
    if (width && !height) height = (width * boxHeight) / boxWidth;
    else if (height && !width) width = (height * boxWidth) / boxHeight;
    else if (!width && !height) [width, height] = [boxWidth, boxHeight];
  }
  header.width = Math.max(1, Math.round(width ?? 300));
  header.height = Math.max(1, Math.round(height ?? 150));
  header.mayHaveAlpha = true;
}

/** Reads bits least-significant first, as JPEG XL headers are written. */
function bitReader(bytes: Uint8Array, start: number) {
  let position = start * 8;
  return (count: number): number => {
    let value = 0;
    for (let i = 0; i < count; i++, position++) {
      const byte = bytes[position >> 3];
      if (byte === undefined) short();
      value += ((byte >> (position & 7)) & 1) * 2 ** i;
    }
    return value;
  };
}

function jxlCodestreamStart(bytes: Uint8Array, data: DataView): number {
  if (bytes[0] === 0xff) return 0;
  for (let offset = 0, boxes = 0; offset + 8 <= bytes.length && boxes < 64; boxes++) {
    const length = data.getUint32(offset);
    const kind = ascii(bytes, offset + 4, 4);
    if (kind === 'jxlc') return offset + 8;
    if (kind === 'jxlp') return offset + 12;
    if (length < 8) break;
    offset += length;
  }
  return short();
}

const JXL_RATIOS: Record<number, [number, number]> = {
  1: [1, 1],
  2: [12, 10],
  3: [4, 3],
  4: [3, 2],
  5: [16, 9],
  6: [5, 4],
  7: [2, 1],
};

function parseJxl(bytes: Uint8Array, data: DataView, header: ImageHeader): void {
  const start = jxlCodestreamStart(bytes, data);
  if (bytes[start] !== 0xff || bytes[start + 1] !== 0x0a) fail('damaged');
  const read = bitReader(bytes, start + 2);
  const dimension = () => [9, 13, 18, 30][read(2)]!;
  const small = read(1) === 1;
  header.height = small ? (read(5) + 1) * 8 : read(dimension()) + 1;
  const ratio = read(3);
  if (ratio) {
    const [numerator, denominator] = JXL_RATIOS[ratio]!;
    header.width = Math.floor((header.height * numerator) / denominator);
  } else header.width = small ? (read(5) + 1) * 8 : read(dimension()) + 1;
  header.mayHaveAlpha = true;
}

/**
 * Validates the container structure and reads size, alpha, animation and orientation.
 * With `partial`, `bytes` is only the start of the file: the result has the format and
 * size (enough for a compatibility check), or is undefined when more bytes are needed.
 */
export function parseHeader(bytes: Uint8Array): ImageHeader;
export function parseHeader(
  bytes: Uint8Array,
  options: { partial: boolean },
): ImageHeader | undefined;
export function parseHeader(
  bytes: Uint8Array,
  options?: { partial: boolean },
): ImageHeader | undefined {
  partial = options?.partial ?? false;
  try {
    return readHeader(bytes);
  } catch (error) {
    if (error === NEED_MORE) return undefined;
    throw error;
  } finally {
    partial = false;
  }
}

function readHeader(bytes: Uint8Array): ImageHeader {
  const format = detectFormat(bytes);
  if (format === 'unknown') fail('unsupported-format');
  const data = view(bytes);
  const header: ImageHeader = {
    format,
    width: 0,
    height: 0,
    animated: false,
    mayHaveAlpha: false,
    orientation: 1,
  };
  if (format === 'png') parsePng(bytes, data, header);
  else if (format === 'jpeg') parseJpeg(bytes, data, header);
  else if (format === 'webp') parseWebp(bytes, data, header);
  else if (format === 'gif') parseGif(bytes, data, header);
  else if (format === 'bmp') parseBmp(bytes, data, header);
  else if (format === 'tiff') parseTiff(bytes, data, header);
  else if (format === 'ico') parseIco(bytes, data, header);
  else if (format === 'svg') parseSvg(bytes, header);
  else if (format === 'jxl') parseJxl(bytes, data, header);
  else parseIsoMedia(bytes, data, header);
  // How big an image may be depends on how it will be read; the decoder decides that.
  assertDimensions(header.width, header.height, 'stream');
  return header;
}
