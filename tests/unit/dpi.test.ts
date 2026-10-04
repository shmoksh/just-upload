import { describe, expect, it } from 'vitest';
import { evaluateCompatibility, mightNeedWork } from '../../src/compatibility';
import { readDpi, withDpi } from '../../src/images/dpi';
import type { TransformResult } from '../../src/models';
import { parseText } from '../../src/requirements';
import { dialogCopy, printSize, rulesSummary, successCopy } from '../../src/ui/copy';
import { jpegBytes, pngBytes } from './helpers/images';

const u16 = (value: number) => [value >> 8, value & 0xff];
const u32 = (value: number) => [
  value >>> 24,
  (value >> 16) & 0xff,
  (value >> 8) & 0xff,
  value & 0xff,
];
const ascii = (text: string) => Array.from(text, (c) => c.charCodeAt(0));

/** A JPEG start: SOI, then a JFIF header with `units` and `density`. */
function jfif(units: number, density: number, rest = [0xff, 0xd9]): Uint8Array<ArrayBuffer> {
  return Uint8Array.from([
    0xff,
    0xd8,
    0xff,
    0xe0,
    ...u16(16),
    ...ascii('JFIF'),
    0,
    1,
    2,
    units,
    ...u16(density),
    ...u16(density),
    0,
    0,
    ...rest,
  ]);
}

/** A JPEG start with only an EXIF block recording `resolution` per `unit` (2 inch, 3 cm). */
function exif(resolution: number, unit = 2): Uint8Array<ArrayBuffer> {
  // Big-endian TIFF: three entries, then the X and Y rationals after the directory.
  const values = 8 + 2 + 3 * 12 + 4;
  const tiff = [
    ...ascii('MM'),
    0,
    42,
    ...u32(8),
    ...u16(3),
    ...u16(0x011a),
    ...u16(5),
    ...u32(1),
    ...u32(values),
    ...u16(0x011b),
    ...u16(5),
    ...u32(1),
    ...u32(values + 8),
    ...u16(0x0128),
    ...u16(3),
    ...u32(1),
    ...u16(unit),
    0,
    0,
    ...u32(0),
    ...u32(resolution),
    ...u32(1),
    ...u32(resolution),
    ...u32(1),
  ];
  const block = [...ascii('Exif'), 0, 0, ...tiff];
  return Uint8Array.from([0xff, 0xd8, 0xff, 0xe1, ...u16(block.length + 2), ...block, 0xff, 0xd9]);
}

const bytesOf = async (blob: Blob) => new Uint8Array(await blob.arrayBuffer());

describe('reading the DPI a file records', () => {
  it('reads a JPEG’s JFIF header, in inches or centimetres', () => {
    expect(readDpi(jfif(1, 300), 'jpeg')).toBe(300);
    expect(readDpi(jfif(2, 118), 'jpeg')).toBe(300);
    // No units: only a pixel shape, not a density.
    expect(readDpi(jfif(0, 1), 'jpeg')).toBeUndefined();
  });
  it('falls back to EXIF, and knows when nothing is recorded', () => {
    expect(readDpi(exif(72), 'jpeg')).toBe(72);
    expect(readDpi(exif(118, 3), 'jpeg')).toBe(300);
    expect(readDpi(jpegBytes(), 'jpeg')).toBeUndefined();
    expect(readDpi(pngBytes(), 'png')).toBeUndefined();
  });
});

describe('saving a DPI without touching the picture', () => {
  it('adds a JFIF header to a JPEG that has none, keeping every other byte', async () => {
    const original = jpegBytes({ width: 276, height: 354 });
    const saved = await bytesOf(await withDpi(new Blob([original]), 'jpeg', 200));
    expect(readDpi(saved, 'jpeg')).toBe(200);
    expect(saved.length).toBe(original.length + 18);
    expect(Array.from(saved.subarray(20))).toEqual(Array.from(original.subarray(2)));
  });
  it('sets an existing JFIF header in place, and EXIF too', async () => {
    const original = jfif(1, 72);
    const saved = await bytesOf(await withDpi(new Blob([original]), 'jpeg', 200));
    expect(saved.length).toBe(original.length);
    expect(readDpi(saved, 'jpeg')).toBe(200);
    const fromExif = await bytesOf(await withDpi(new Blob([exif(72)]), 'jpeg', 200));
    // A JFIF header is added, and the EXIF value agrees with it.
    expect(readDpi(fromExif, 'jpeg')).toBe(200);
    expect(readDpi(Uint8Array.from([0xff, 0xd8, ...fromExif.subarray(20)]), 'jpeg')).toBe(200);
  });
  it('gives a PNG one pHYs chunk with a valid checksum', async () => {
    const original = pngBytes({ extra: ['pHYs'] });
    const saved = await bytesOf(await withDpi(new Blob([original]), 'png', 300));
    expect(readDpi(saved, 'png')).toBe(300);
    const text = String.fromCharCode(...saved);
    expect(text.split('pHYs').length - 1).toBe(1);
    // CRC-32 of "pHYs" and its 9 data bytes, as any PNG reader checks it.
    const at = text.indexOf('pHYs');
    let crc = 0xffffffff;
    for (const byte of saved.subarray(at, at + 13)) {
      crc ^= byte;
      for (let k = 0; k < 8; k++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
    const stored = new DataView(saved.buffer).getUint32(at + 13);
    expect(stored).toBe((crc ^ 0xffffffff) >>> 0);
  });
});

describe('a DPI rule', () => {
  const passport = parseText('Photo 3.5 cm × 4.5 cm, 200 DPI');
  it('is a problem only for a JPEG or PNG that records another DPI', () => {
    const photo = { width: 276, height: 354, bytes: 40_000 };
    expect(evaluateCompatibility({ ...photo, format: 'jpeg', dpi: 72 }, passport)).toEqual([
      'wrong-dpi',
    ]);
    expect(evaluateCompatibility({ ...photo, format: 'jpeg', dpi: 200 }, passport)).toEqual([]);
    expect(evaluateCompatibility({ ...photo, format: 'webp' }, passport)).toEqual([]);
    expect(mightNeedWork({ name: 'a.jpg', type: 'image/jpeg', size: 1000 }, passport)).toBe(true);
  });
  it('is said plainly: the printed size, the DPI, and what changed', () => {
    expect(printSize(35, 45)).toBe('3.5 × 4.5 cm');
    expect(printSize(50.8, 50.8)).toBe('2 × 2 in');
    expect(rulesSummary(passport)).toBe('276 × 354 · 3.5 × 4.5 cm · 200 DPI');
    const crop = dialogCopy(
      { action: 'USER_CONFIRMATION', issues: [], outputFormat: 'jpeg', consents: ['crop'] },
      passport,
      false,
    );
    expect(crop.title).toBe('This site needs a 3.5 × 4.5 cm photo');
    const onlyDpi = {
      changes: ['dpi-set'],
      dpi: 200,
      originalFormat: 'jpeg',
      finalFormat: 'jpeg',
      qualityKept: 100,
    } as unknown as TransformResult;
    expect(successCopy([onlyDpi])).toMatchObject({
      title: 'Ready to upload',
      detail: 'Set to 200 DPI, nothing else changed',
    });
  });
});
