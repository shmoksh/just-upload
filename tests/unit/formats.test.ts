import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  FORMATS,
  formatFromExtension,
  formatFromMime,
  normalizeMime,
  OUTPUT_FORMATS,
} from '../../src/formats';
import { avifQuality } from '../../src/images/codecs/avif';
import { encodeBmp } from '../../src/images/codecs/bmp';
import { encodeGif } from '../../src/images/codecs/gif';
import { encodeIco } from '../../src/images/codecs/ico';
import {
  detectFormat,
  displaySize,
  parseHeader,
  SIZE_SETTLED_BY_DECODER,
} from '../../src/images/headers';
import { svgRenderSize } from '../../src/images/svg';
import type { UploadRequirements } from '../../src/models';
import { errorCode, ProcessingError } from '../../src/utils/errors';
import { heicBytes, jpegBytes, pngBytes, webpBytes } from './helpers/images';

// Under happy-dom, import.meta.url is not a file URL; tests run from the project root.
const fixture = (name: string) =>
  new Uint8Array(readFileSync(join(process.cwd(), 'tests/fixtures', name)));
const text = (value: string) => new TextEncoder().encode(value);
const rules = (values: Partial<UploadRequirements> = {}): UploadRequirements => ({
  acceptedMimeTypes: [],
  acceptedExtensions: [],
  confidence: 1,
  sources: [],
  ...values,
});
const codeOf = (action: () => unknown) => {
  try {
    action();
  } catch (error) {
    return errorCode(error);
  }
  return undefined;
};

/** Writes values least-significant bit first, as JPEG XL headers are stored. */
function bits(...fields: [value: number, count: number][]): number[] {
  const out: number[] = [];
  let position = 0;
  for (const [value, count] of fields) {
    for (let i = 0; i < count; i++, position++) {
      if (position % 8 === 0) out.push(0);
      out[out.length - 1]! |= ((value >> i) & 1) << (position % 8);
    }
  }
  return out;
}

describe('format registry', () => {
  it('knows every format by MIME type and extension, including common aliases', () => {
    expect(formatFromMime('image/x-ms-bmp')).toBe('bmp');
    expect(formatFromMime('image/vnd.microsoft.icon')).toBe('ico');
    expect(formatFromMime('IMAGE/TIF')).toBe('tiff');
    expect(normalizeMime('image/jpg; charset=binary')).toBe('image/jpeg');
    expect(formatFromExtension('.JPEG')).toBe('jpeg');
    expect(formatFromExtension('.hif')).toBe('heif');
    expect(formatFromExtension('.psd')).toBeUndefined();
  });
  it('writes eight formats and reads four more', () => {
    expect(OUTPUT_FORMATS).toEqual(['jpeg', 'png', 'webp', 'avif', 'gif', 'tiff', 'bmp', 'ico']);
    expect(OUTPUT_FORMATS.every((format) => FORMATS[format].output)).toBe(true);
    for (const readOnly of ['heic', 'heif', 'svg', 'jxl'] as const)
      expect(FORMATS[readOnly].output).toBeUndefined();
  });
});

describe('reading real files made by other encoders', () => {
  it.each([
    ['photo-640x480.avif', 'avif', 640, 480],
    ['photo-320x240.gif', 'gif', 320, 240],
    ['photo-320x240.bmp', 'bmp', 320, 240],
    ['photo-320x240.tif', 'tiff', 320, 240],
    ['icon-128.ico', 'ico', 128, 128],
    ['photo-640x480.jxl', 'jxl', 640, 480],
    ['logo.svg', 'svg', 200, 100],
    ['landscape-1600x1200.heic', 'heic', 1600, 1200],
  ])('%s is %s, %i × %i', (name, format, width, height) => {
    expect(parseHeader(fixture(name))).toMatchObject({ format, width, height });
  });
  it('knows an animated GIF from a still one', () => {
    expect(parseHeader(fixture('animated-160x120.gif')).animated).toBe(true);
    expect(parseHeader(fixture('photo-320x240.gif')).animated).toBe(false);
  });
  it('defers shape decisions to the decoder for formats that rotate or have no pixel size', () => {
    expect([...SIZE_SETTLED_BY_DECODER].sort()).toEqual(['avif', 'heic', 'heif', 'jxl', 'svg']);
  });
});

describe('header edge cases', () => {
  const gif = (...body: number[]) =>
    new Uint8Array([...text('GIF89a'), 10, 0, 8, 0, 0, 0, 0, ...body]);
  const frame = [0x2c, 0, 0, 0, 0, 10, 0, 8, 0, 0, 2, 2, 0x4c, 0x01, 0];
  it('reads GIF transparency and frame count', () => {
    const transparent = gif(0x21, 0xf9, 4, 1, 0, 0, 0, 0, ...frame, 0x3b);
    expect(parseHeader(transparent)).toMatchObject({
      width: 10,
      height: 8,
      mayHaveAlpha: true,
      animated: false,
    });
    expect(parseHeader(gif(...frame, ...frame, 0x3b)).animated).toBe(true);
    expect(codeOf(() => parseHeader(gif(0x3b)))).toBe('damaged');
  });

  const bmp = (headerSize: number, width: number, height: number, bpp = 24) => {
    const bytes = new Uint8Array(14 + headerSize + 16);
    const data = new DataView(bytes.buffer);
    bytes.set(text('BM'));
    data.setUint32(10, 14 + headerSize, true);
    data.setUint32(14, headerSize, true);
    if (headerSize === 12) {
      data.setUint16(18, width, true);
      data.setUint16(20, height, true);
    } else {
      data.setInt32(18, width, true);
      data.setInt32(22, height, true);
      data.setUint16(28, bpp, true);
    }
    return bytes;
  };
  it('reads bottom-up, top-down and old OS/2 bitmaps', () => {
    expect(parseHeader(bmp(40, 30, 20))).toMatchObject({
      format: 'bmp',
      width: 30,
      height: 20,
      mayHaveAlpha: false,
    });
    expect(parseHeader(bmp(124, 30, -20, 32))).toMatchObject({ height: 20, mayHaveAlpha: true });
    expect(parseHeader(bmp(12, 7, 5))).toMatchObject({ width: 7, height: 5 });
    expect(detectFormat(text('BM is not a bitmap, just text'))).toBe('unknown');
  });

  const tiff = (tags: [number, number][], nextPage = 0) => {
    const bytes = new Uint8Array(8 + 2 + tags.length * 12 + 4);
    const data = new DataView(bytes.buffer);
    bytes.set(text('II*\0'));
    data.setUint32(4, 8, true);
    data.setUint16(8, tags.length, true);
    tags.forEach(([tag, value], i) => {
      const entry = 10 + i * 12;
      data.setUint16(entry, tag, true);
      data.setUint16(entry + 2, 4, true);
      data.setUint32(entry + 4, 1, true);
      data.setUint32(entry + 8, value, true);
    });
    data.setUint32(10 + tags.length * 12, nextPage, true);
    return bytes;
  };
  it('reads TIFF size, orientation, alpha and extra pages', () => {
    const header = parseHeader(
      tiff([
        [256, 400],
        [257, 300],
        [274, 6],
        [338, 1],
      ]),
    );
    expect(header).toMatchObject({
      format: 'tiff',
      width: 400,
      height: 300,
      orientation: 6,
      mayHaveAlpha: true,
      animated: false,
    });
    expect(displaySize(header)).toEqual({ width: 300, height: 400 });
    expect(
      parseHeader(
        tiff(
          [
            [256, 40],
            [257, 30],
          ],
          99,
        ),
      ).animated,
    ).toBe(true);
  });
  it('refuses camera RAW files that are shaped like TIFF', () => {
    expect(
      codeOf(() =>
        parseHeader(
          tiff([
            [256, 40],
            [257, 30],
            [50706, 1],
          ]),
        ),
      ),
    ).toBe('unsupported-format');
    const cr2 = tiff([
      [256, 40],
      [257, 30],
    ]);
    cr2.set(text('CR'), 8);
    expect(codeOf(() => parseHeader(cr2))).toBe('unsupported-format');
  });

  it('picks the largest image in an ICO and checks every entry', () => {
    const ico = new Uint8Array(6 + 32 + 20);
    const data = new DataView(ico.buffer);
    data.setUint16(2, 1, true);
    data.setUint16(4, 2, true);
    ico.set([16, 16], 6);
    data.setUint32(6 + 8, 10, true);
    data.setUint32(6 + 12, 38, true);
    ico.set([0, 0], 22); // 0 means 256
    data.setUint32(22 + 8, 10, true);
    data.setUint32(22 + 12, 48, true);
    expect(parseHeader(ico)).toMatchObject({ format: 'ico', width: 256, height: 256 });
    data.setUint32(22 + 12, 9999, true);
    expect(codeOf(() => parseHeader(ico))).toBe('damaged');
  });

  it.each([
    ['<svg width="120" height="80"></svg>', 120, 80],
    ['<svg width="2in" height="1in"></svg>', 192, 96],
    ['<svg viewBox="0 0 64 32"></svg>', 64, 32],
    ['<svg width="300" viewBox="0 0 64 32"></svg>', 300, 150],
    ['<svg width="50%" height="50%" viewBox="0,0,40,40"></svg>', 40, 40],
    ['<svg xmlns="http://www.w3.org/2000/svg"></svg>', 300, 150],
    [
      '﻿<?xml version="1.0"?>\n<!-- logo -->\n<!DOCTYPE svg>\n<svg height="10" width="20"/>',
      20,
      10,
    ],
  ])('reads SVG size from %s', (source, width, height) => {
    expect(parseHeader(text(source))).toMatchObject({
      format: 'svg',
      width,
      height,
      mayHaveAlpha: true,
    });
  });
  it('does not mistake HTML for SVG', () => {
    expect(detectFormat(text('<!doctype html><html><svg></svg></html>'))).toBe('unknown');
  });

  it('reads JPEG XL sizes from the codestream header', () => {
    // 640 × 480: a 9-bit height of 479 (+1) and the 4:3 ratio code.
    const photo = new Uint8Array([0xff, 0x0a, ...bits([0, 1], [0, 2], [479, 9], [3, 3]), 0, 0]);
    expect(parseHeader(photo)).toMatchObject({ format: 'jxl', width: 640, height: 480 });
    // A small image: both sides stored as multiples of 8.
    const small = new Uint8Array([0xff, 0x0a, ...bits([1, 1], [3, 5], [0, 3], [7, 5]), 0]);
    expect(parseHeader(small)).toMatchObject({ width: 64, height: 32 });
    // A huge size is read faithfully; whether it can be decoded is the decoder's call.
    const huge = new Uint8Array([0xff, 0x0a, ...bits([0, 1], [3, 2], [99_999, 30], [1, 3]), 0, 0]);
    expect(parseHeader(huge)).toMatchObject({ format: 'jxl', width: 100_000, height: 100_000 });
  });
});

describe('writers', () => {
  const pixels = (width: number, height: number, alpha = 255) => {
    const rgba = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < rgba.length; i += 4) rgba.set([(i / 4) % 256, 100, 200, alpha], i);
    return rgba;
  };

  it('BMP: 24-bit, bottom-up, blue-green-red, rows padded to 4 bytes', () => {
    const bmp = encodeBmp(pixels(3, 2), 3, 2);
    expect(parseHeader(bmp)).toMatchObject({ format: 'bmp', width: 3, height: 2 });
    expect(bmp.length).toBe(54 + 12 * 2);
    // The last row of the image is stored first; its first pixel has red = 3.
    expect(Array.from(bmp.subarray(54, 57))).toEqual([200, 100, 3]);
  });

  it('ICO: a PNG inside an icon directory, with 256 written as 0', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const ico = encodeIco(png, 256, 128);
    expect(Array.from(ico.subarray(0, 8))).toEqual([0, 0, 1, 0, 1, 0, 0, 128]);
    expect(new DataView(ico.buffer).getUint32(18, true)).toBe(22);
    expect(Array.from(ico.subarray(22))).toEqual(Array.from(png));
  });

  it('GIF: a valid still image, with a transparent colour only when needed', () => {
    const opaque = encodeGif(pixels(20, 10), 20, 10);
    expect(parseHeader(opaque)).toMatchObject({
      format: 'gif',
      width: 20,
      height: 10,
      animated: false,
      mayHaveAlpha: false,
    });
    const clear = pixels(20, 10);
    for (let i = 3; i < 80; i += 4) clear[i] = 0;
    expect(parseHeader(encodeGif(clear, 20, 10)).mayHaveAlpha).toBe(true);
  });

  it('AVIF quality follows the JPEG-like scale', () => {
    expect(avifQuality(0.92)).toBe(75);
    expect(avifQuality(0.72)).toBe(53);
    expect(avifQuality(0.6)).toBe(40);
    expect(avifQuality(0)).toBe(30);
  });
});

describe('SVG render size', () => {
  it('draws small drawings at 1024 px on the longer side', () => {
    expect(svgRenderSize({ width: 200, height: 100 }, rules())).toEqual({
      width: 1024,
      height: 512,
    });
    expect(svgRenderSize({ width: 24, height: 24 }, rules())).toEqual({
      width: 1024,
      height: 1024,
    });
  });
  it('keeps large drawings at their own size, up to 4096 px', () => {
    expect(svgRenderSize({ width: 2000, height: 1000 }, rules())).toEqual({
      width: 2000,
      height: 1000,
    });
    expect(svgRenderSize({ width: 10_000, height: 5000 }, rules())).toEqual({
      width: 4096,
      height: 2048,
    });
  });
  it('draws at the size a site needs: covering minimums and exact sizes, within maximums', () => {
    expect(svgRenderSize({ width: 200, height: 100 }, rules({ minWidth: 2000 }))).toEqual({
      width: 2000,
      height: 1000,
    });
    expect(
      svgRenderSize({ width: 200, height: 100 }, rules({ exactWidth: 600, exactHeight: 600 })),
    ).toEqual({ width: 1200, height: 600 });
    expect(
      svgRenderSize({ width: 200, height: 100 }, rules({ maxWidth: 500, maxHeight: 500 })),
    ).toEqual({ width: 500, height: 250 });
  });
});

describe('damaged and hostile headers', () => {
  // The header is read in the website's own tab for every image a person picks, so a
  // damaged file must end in a result or a ProcessingError, quickly: never another
  // exception or a long loop.
  const files: [string, Uint8Array][] = [
    ...[
      'photo-640x480.avif',
      'photo-320x240.gif',
      'photo-320x240.bmp',
      'photo-320x240.tif',
      'icon-128.ico',
      'photo-640x480.jxl',
      'logo.svg',
      'landscape-1600x1200.heic',
      'jpeg/rotated-6.jpg',
      'jpeg/profile.jpg',
    ].map((name): [string, Uint8Array] => [name, fixture(name)]),
    ['png', pngBytes({ width: 9, height: 7 })],
    ['jpeg', jpegBytes({ width: 9, height: 7, orientation: 6 })],
    ['webp', webpBytes({ width: 9, height: 7 })],
    ['heic', heicBytes()],
  ];

  it('never throw anything else, or take long', { timeout: 120_000 }, () => {
    const unexpected = new Set<string>();
    let slowest = 0;
    for (const [index, [name, bytes]] of files.entries()) {
      let state = 7 + index;
      const random = () => (state = (state * 1664525 + 1013904223) >>> 0) / 2 ** 32;
      for (let i = 0; i < 400; i++) {
        let variant: Uint8Array;
        if (i % 3 === 2) variant = bytes.slice(0, Math.floor(random() * bytes.length));
        else {
          variant = bytes.slice();
          // Mostly near the start, where sizes, offsets and box lengths live.
          const reach = Math.min(variant.length, i % 2 ? 512 : variant.length);
          const changes = 1 + Math.floor(random() * (i % 3 === 0 ? 3 : 16));
          for (let n = 0; n < changes; n++)
            variant[Math.floor(random() * reach)] = Math.floor(random() * 256);
        }
        for (const partial of [false, true]) {
          const started = performance.now();
          try {
            parseHeader(variant, { partial });
          } catch (error) {
            if (!(error instanceof ProcessingError)) unexpected.add(`${name}: ${String(error)}`);
          }
          slowest = Math.max(slowest, performance.now() - started);
        }
      }
    }
    expect([...unexpected]).toEqual([]);
    expect(slowest).toBeLessThan(250);
  });
});
