import type { OutputFormat } from '../models';
import { fail } from '../utils/errors';

/**
 * Brings a file up to `size` bytes with data every image reader skips: JPEG comment
 * segments or a PNG text chunk, filled with spaces. The picture is untouched. Used only
 * when a site refuses files under a minimum size and even the most detailed save is
 * smaller; other formats cannot be padded safely, so they end with an error.
 */
export async function padTo(blob: Blob, format: OutputFormat, size: number): Promise<Blob> {
  const missing = size - blob.size;
  if (missing <= 0) return blob;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (format === 'jpeg') return new Blob(padJpeg(bytes, missing), { type: blob.type });
  if (format === 'png') return new Blob(padPng(bytes, missing), { type: blob.type });
  return fail('target-unreachable');
}

/** Comment segments (FF FE, at most 64 KB each) after the APPn segments readers expect first. */
function padJpeg(bytes: Uint8Array<ArrayBuffer>, missing: number): Uint8Array<ArrayBuffer>[] {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) fail('target-unreachable');
  let at = 2;
  while (bytes[at] === 0xff && bytes[at + 1]! >= 0xe0 && bytes[at + 1]! <= 0xef)
    at += 2 + ((bytes[at + 2]! << 8) | bytes[at + 3]!);
  if (at + 2 > bytes.length) fail('target-unreachable');
  const segments: Uint8Array<ArrayBuffer>[] = [];
  for (let left = missing; left > 0;) {
    const text = Math.min(0xffff - 2, Math.max(0, left - 4));
    const segment = new Uint8Array(4 + text).fill(0x20);
    segment.set([0xff, 0xfe, (text + 2) >> 8, (text + 2) & 0xff]);
    segments.push(segment);
    left -= segment.length;
  }
  return [bytes.subarray(0, at), ...segments, bytes.subarray(at)];
}

/** One "Comment" text chunk, just before IEND. */
function padPng(bytes: Uint8Array<ArrayBuffer>, missing: number): Uint8Array<ArrayBuffer>[] {
  const end = bytes.length - 12;
  if (end < 8 || String.fromCharCode(...bytes.subarray(end + 4, end + 8)) !== 'IEND')
    fail('target-unreachable');
  const header = Array.from('tEXtComment\0', (c) => c.charCodeAt(0));
  const length = Math.max(header.length - 4, missing - 12);
  const chunk = new Uint8Array(12 + length).fill(0x20);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, length);
  chunk.set(header, 4);
  view.setUint32(8 + length, crc32(chunk.subarray(4, 8 + length)));
  return [bytes.subarray(0, end), chunk, bytes.subarray(end)];
}

let table: Uint32Array | undefined;
/** The CRC every PNG chunk ends with. */
export function crc32(data: Uint8Array): number {
  table ??= Uint32Array.from({ length: 256 }, (_, n) => {
    for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
    return n >>> 0;
  });
  let crc = 0xffffffff;
  for (const byte of data) crc = table[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
