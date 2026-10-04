import type { FileFormat } from '../models';
import { crc32 } from './pad';

// The pixels per inch a JPEG or PNG records, read and set in its header only: the
// picture itself is never touched. Passport and exam forms ask for it ("200 DPI").

const ascii = (bytes: Uint8Array, start: number, length: number) =>
  String.fromCharCode(...bytes.subarray(start, start + length));
const view = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

/** The DPI a JPEG or PNG records, from the start of the file; undefined if none. */
export function readDpi(bytes: Uint8Array, format: FileFormat): number | undefined {
  if (format === 'jpeg') return jpegDpi(bytes);
  if (format === 'png') return pngDpi(bytes);
  return undefined;
}

interface Segment {
  marker: number;
  /** Where the marker starts, and where its data (after the length) starts and ends. */
  at: number;
  data: number;
  end: number;
}

/** A JPEG's APPn segments, which come first, before any picture data. */
function appSegments(bytes: Uint8Array): Segment[] {
  const segments: Segment[] = [];
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return segments;
  for (let at = 2; at + 4 <= bytes.length && bytes[at] === 0xff;) {
    const marker = bytes[at + 1]!;
    if (marker < 0xe0 || marker > 0xef) break;
    const end = at + 2 + ((bytes[at + 2]! << 8) | bytes[at + 3]!);
    if (end > bytes.length) break;
    segments.push({ marker, at, data: at + 4, end });
    at = end;
  }
  return segments;
}

const isJfif = (bytes: Uint8Array, segment: Segment) =>
  segment.marker === 0xe0 &&
  segment.end - segment.data >= 14 &&
  ascii(bytes, segment.data, 5) === 'JFIF\0';
const isExif = (bytes: Uint8Array, segment: Segment) =>
  segment.marker === 0xe1 && ascii(bytes, segment.data, 6) === 'Exif\0\0';

function jpegDpi(bytes: Uint8Array): number | undefined {
  let fromExif: number | undefined;
  for (const segment of appSegments(bytes)) {
    if (isJfif(bytes, segment)) {
      const units = bytes[segment.data + 7];
      const density = (bytes[segment.data + 8]! << 8) | bytes[segment.data + 9]!;
      if (units === 1 && density) return density;
      if (units === 2 && density) return Math.round(density * 2.54);
    }
    if (isExif(bytes, segment)) fromExif = exifDpi(bytes.subarray(segment.data + 6, segment.end));
  }
  return fromExif;
}

interface ExifResolution {
  little: boolean;
  /** Where the X and Y resolution values (rationals) and the unit (a short) are. */
  x?: number;
  y?: number;
  unit?: number;
}

/** Finds the resolution entries in an EXIF block's first directory. */
function exifResolution(tiff: Uint8Array): ExifResolution | undefined {
  if (tiff.length < 8) return undefined;
  const little = ascii(tiff, 0, 2) === 'II';
  if (!little && ascii(tiff, 0, 2) !== 'MM') return undefined;
  const data = view(tiff);
  if (data.getUint16(2, little) !== 42) return undefined;
  const ifd = data.getUint32(4, little);
  if (ifd + 2 > tiff.length) return undefined;
  const found: ExifResolution = { little };
  const count = Math.min(data.getUint16(ifd, little), 512);
  for (let i = 0; i < count; i++) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > tiff.length) break;
    const tag = data.getUint16(entry, little);
    const type = data.getUint16(entry + 2, little);
    if ((tag === 0x011a || tag === 0x011b) && type === 5) {
      const offset = data.getUint32(entry + 8, little);
      if (offset + 8 <= tiff.length) found[tag === 0x011a ? 'x' : 'y'] = offset;
    }
    if (tag === 0x0128 && type === 3) found.unit = entry + 8;
  }
  return found;
}

function exifDpi(tiff: Uint8Array): number | undefined {
  const found = exifResolution(tiff);
  if (found?.x === undefined) return undefined;
  const data = view(tiff);
  const value =
    data.getUint32(found.x, found.little) / (data.getUint32(found.x + 4, found.little) || 1);
  const unit = found.unit === undefined ? 2 : data.getUint16(found.unit, found.little);
  if (!(value > 0)) return undefined;
  if (unit === 2) return Math.round(value);
  if (unit === 3) return Math.round(value * 2.54);
  return undefined;
}

function pngDpi(bytes: Uint8Array): number | undefined {
  const data = view(bytes);
  for (let at = 8; at + 12 <= bytes.length;) {
    const length = data.getUint32(at);
    const kind = ascii(bytes, at + 4, 4);
    if (kind === 'IDAT' || kind === 'IEND') return undefined;
    if (kind === 'pHYs' && length === 9 && at + 17 <= bytes.length) {
      return bytes[at + 16] === 1 ? Math.round(data.getUint32(at + 8) * 0.0254) : undefined;
    }
    at += 12 + length;
  }
  return undefined;
}

/**
 * The same file, recording `dpi`. A JPEG gets it in its JFIF header (added if missing)
 * and in its EXIF block when it has one; a PNG in its pHYs chunk. The picture data is
 * copied unchanged.
 */
export async function withDpi(blob: Blob, format: 'jpeg' | 'png', dpi: number): Promise<Blob> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const value = Math.max(1, Math.min(0xffff, Math.round(dpi)));
  const parts = format === 'jpeg' ? jpegWithDpi(bytes, value) : pngWithDpi(bytes, value);
  return new Blob(parts, { type: blob.type });
}

function jpegWithDpi(bytes: Uint8Array<ArrayBuffer>, dpi: number): Uint8Array<ArrayBuffer>[] {
  const segments = appSegments(bytes);
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return [bytes];
  const copy = bytes.slice();
  for (const segment of segments) {
    if (!isExif(copy, segment)) continue;
    const tiff = copy.subarray(segment.data + 6, segment.end);
    const found = exifResolution(tiff);
    if (!found) continue;
    const data = view(tiff);
    for (const offset of [found.x, found.y]) {
      if (offset === undefined) continue;
      data.setUint32(offset, dpi, found.little);
      data.setUint32(offset + 4, 1, found.little);
    }
    if (found.unit !== undefined) data.setUint16(found.unit, 2, found.little);
  }
  const jfif = segments.find((segment) => isJfif(copy, segment));
  if (jfif) {
    copy[jfif.data + 7] = 1;
    copy.set([dpi >> 8, dpi & 0xff, dpi >> 8, dpi & 0xff], jfif.data + 8);
    return [copy];
  }
  // A JFIF header comes right after the start-of-image marker.
  const header = Uint8Array.from([
    0xff,
    0xe0,
    0x00,
    0x10,
    0x4a,
    0x46,
    0x49,
    0x46,
    0x00,
    0x01,
    0x02,
    0x01,
    dpi >> 8,
    dpi & 0xff,
    dpi >> 8,
    dpi & 0xff,
    0x00,
    0x00,
  ]);
  return [copy.subarray(0, 2), header, copy.subarray(2)];
}

function pngWithDpi(bytes: Uint8Array<ArrayBuffer>, dpi: number): Uint8Array<ArrayBuffer>[] {
  if (bytes.length < 33 || ascii(bytes, 12, 4) !== 'IHDR') return [bytes];
  const data = view(bytes);
  const parts: Uint8Array<ArrayBuffer>[] = [bytes.subarray(0, 33), physChunk(dpi)];
  // Every chunk but an old pHYs, in order.
  for (let at = 33; at + 12 <= bytes.length;) {
    const end = at + 12 + data.getUint32(at);
    if (ascii(bytes, at + 4, 4) !== 'pHYs')
      parts.push(bytes.subarray(at, Math.min(end, bytes.length)));
    if (end >= bytes.length) break;
    at = end;
  }
  return parts;
}

/** A pHYs chunk: pixels per metre on both axes, unit metre. */
function physChunk(dpi: number): Uint8Array<ArrayBuffer> {
  const perMetre = Math.round(dpi / 0.0254);
  const chunk = new Uint8Array(21);
  const data = view(chunk);
  data.setUint32(0, 9);
  chunk.set([0x70, 0x48, 0x59, 0x73], 4);
  data.setUint32(8, perMetre);
  data.setUint32(12, perMetre);
  chunk[16] = 1;
  data.setUint32(17, crc32(chunk.subarray(4, 17)));
  return chunk;
}
