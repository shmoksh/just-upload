import { describe, expect, it } from 'vitest';
import { compressToTarget, finestThatFits, QUALITY, type Encoder } from '../../src/images/compress';
import { calculateDimensions, normalizeCrop, outputFilename } from '../../src/images/geometry';
import { detectFormat, displaySize, parseHeader } from '../../src/images/headers';
import { isCompatibleByHeader } from '../../src/images/quick-check';
import { blockSimilarity } from '../../src/images/quality';
import type { UploadRequirements } from '../../src/models';
import { errorCode } from '../../src/utils/errors';
import { fileOf, heicBytes, jpegBytes, pngBytes, webpBytes } from './helpers/images';

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

describe('signature detection (names and MIME types can lie)', () => {
  it('recognises each supported format by its bytes', () => {
    expect(detectFormat(jpegBytes())).toBe('jpeg');
    expect(detectFormat(pngBytes())).toBe('png');
    expect(detectFormat(webpBytes())).toBe('webp');
    expect(detectFormat(heicBytes())).toBe('heic');
    expect(detectFormat(heicBytes({ brand: 'mif1', compatible: ['mif1'] }))).toBe('heif');
  });
  it('tells AVIF from HEIC, and random bytes from both', () => {
    expect(detectFormat(heicBytes({ brand: 'avif', compatible: ['mif1', 'avif'] }))).toBe('avif');
    expect(
      detectFormat(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16])),
    ).toBe('unknown');
    expect(detectFormat(new Uint8Array())).toBe('unknown');
  });
});

describe('parseHeader', () => {
  it('reads sizes, alpha and animation', () => {
    expect(parseHeader(pngBytes({ width: 640, height: 480, colorType: 2 }))).toMatchObject({
      format: 'png',
      width: 640,
      height: 480,
      mayHaveAlpha: false,
    });
    expect(parseHeader(pngBytes({ colorType: 2, extra: ['tRNS'] })).mayHaveAlpha).toBe(true);
    expect(parseHeader(pngBytes({ extra: ['acTL'] })).animated).toBe(true);
    expect(
      parseHeader(webpBytes({ width: 300, height: 200, alpha: true, animated: true })),
    ).toMatchObject({ width: 300, height: 200, mayHaveAlpha: true, animated: true });
    expect(parseHeader(heicBytes({ width: 4032, height: 3024 }))).toMatchObject({
      format: 'heic',
      width: 4032,
      height: 3024,
    });
  });
  it('reads EXIF orientation and reports the upright size', () => {
    const header = parseHeader(jpegBytes({ width: 4032, height: 3024, orientation: 6 }));
    expect(header.orientation).toBe(6);
    expect(displaySize(header)).toEqual({ width: 3024, height: 4032 });
    expect(
      displaySize(parseHeader(jpegBytes({ width: 400, height: 300, orientation: 3 }))),
    ).toEqual({ width: 400, height: 300 });
  });
  it('rejects damaged, empty and oversized images with a code', () => {
    expect(codeOf(() => parseHeader(pngBytes({ truncated: true })))).toBe('damaged');
    expect(codeOf(() => parseHeader(jpegBytes().subarray(0, 6)))).toBe('damaged');
    expect(codeOf(() => parseHeader(pngBytes({ width: 0 })))).toBe('damaged');
    // Gigapixel PNGs are read in a stream, but a side beyond a million pixels is not real.
    expect(parseHeader(pngBytes({ width: 40_000, height: 40_000 }))).toMatchObject({
      width: 40_000,
    });
    expect(codeOf(() => parseHeader(pngBytes({ width: 2_000_000, height: 10 })))).toBe(
      'too-large-to-process',
    );
    expect(codeOf(() => parseHeader(heicBytes({ width: 100_000, height: 100_000 })))).toBe(
      'too-large-to-process',
    );
    expect(codeOf(() => parseHeader(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])))).toBe(
      'unsupported-format',
    );
  });
});

describe('in-page quick check', () => {
  it('confirms compatibility from the header alone', async () => {
    const file = fileOf(jpegBytes({ width: 1000, height: 800 }), 'a.jpg', 'image/jpeg');
    expect(await isCompatibleByHeader(file, rules({ maxWidth: 1920, maxHeight: 1920 }))).toBe(true);
    expect(await isCompatibleByHeader(file, rules({ minWidth: 1200 }))).toBe(false);
  });
  it('uses the upright size for rotated photos', async () => {
    const rotated = fileOf(
      jpegBytes({ width: 4032, height: 3024, orientation: 6 }),
      'a.jpg',
      'image/jpeg',
    );
    expect(await isCompatibleByHeader(rotated, rules({ maxWidth: 3100, maxHeight: 4100 }))).toBe(
      true,
    );
  });
  it('defers HEIC shape questions to the decoder', async () => {
    const heic = fileOf(heicBytes(), 'a.heic');
    expect(
      await isCompatibleByHeader(
        heic,
        rules({ acceptedMimeTypes: ['image/heic'], maxWidth: 5000 }),
      ),
    ).toBe(false);
  });
});

describe('outputFilename', () => {
  it.each([
    ['IMG_9283.HEIC', 'jpeg', 'IMG_9283.jpg'],
    ['photo.webp', 'jpeg', 'photo.jpg'],
    ['photo.jpg', 'webp', 'photo.webp'],
    ['holiday.2024.final.heic', 'jpeg', 'holiday.2024.final.jpg'],
    ['Café in Zürich 📷.heic', 'png', 'Café in Zürich 📷.png'],
    ['noextension', 'jpeg', 'noextension.jpg'],
    ['.heic', 'jpeg', 'image.jpg'],
    ['Photo.JPG', 'jpeg', 'Photo.JPG'],
    ['scan.jpeg', 'jpeg', 'scan.jpeg'],
  ] as const)('%s as %s is %s', (name, format, expected) =>
    expect(outputFilename(name, format)).toBe(expected),
  );
});

describe('calculateDimensions', () => {
  it('fits within a maximum, keeping the shape: 4032 × 3024 in 1920 × 1920 is 1920 × 1440', () => {
    expect(calculateDimensions(4032, 3024, rules({ maxWidth: 1920, maxHeight: 1920 }))).toEqual({
      width: 1920,
      height: 1440,
    });
    expect(calculateDimensions(3024, 4032, rules({ maxWidth: 1920, maxHeight: 1920 }))).toEqual({
      width: 1440,
      height: 1920,
    });
  });
  it('never changes a size that already fits', () => {
    expect(calculateDimensions(800, 600, rules({ maxWidth: 1920 }))).toEqual({
      width: 800,
      height: 600,
    });
  });
  it('produces exact sizes once the shape matches', () => {
    expect(calculateDimensions(3024, 3024, rules({ exactWidth: 600, exactHeight: 600 }))).toEqual({
      width: 600,
      height: 600,
    });
  });
  it('requires approval to enlarge, and a crop to change shape', () => {
    expect(codeOf(() => calculateDimensions(300, 300, rules({ minWidth: 600 })))).toBe(
      'needs-upscale',
    );
    expect(calculateDimensions(300, 300, rules({ minWidth: 600 }), true)).toEqual({
      width: 600,
      height: 600,
    });
    expect(codeOf(() => calculateDimensions(800, 600, rules({ aspectRatio: 1 })))).toBe(
      'needs-crop',
    );
  });
  it('reports rules no size can satisfy', () => {
    expect(
      codeOf(() => calculateDimensions(1000, 100, rules({ maxWidth: 500, minHeight: 90 }))),
    ).toBe('rules-conflict');
  });
});

describe('normalizeCrop', () => {
  it('rounds to whole pixels and keeps the crop inside the image', () => {
    expect(normalizeCrop({ x: 0.4, y: 503.6, width: 3024.2, height: 3024.2 }, 3024, 4032)).toEqual({
      x: 0,
      y: 504,
      width: 3024,
      height: 3024,
    });
    expect(normalizeCrop(undefined, 10, 20)).toEqual({ x: 0, y: 0, width: 10, height: 20 });
  });
  it('rejects impossible crops', () => {
    expect(codeOf(() => normalizeCrop({ x: Number.NaN, y: 0, width: 1, height: 1 }, 10, 10))).toBe(
      'needs-crop',
    );
    expect(codeOf(() => normalizeCrop({ x: 20, y: 0, width: 5, height: 5 }, 10, 10))).toBe(
      'needs-crop',
    );
  });
});

describe('compressToTarget', () => {
  /** A deterministic stand-in: bytes grow with pixels and quality, like a real encoder. */
  function encoder(bytesPerPixelAtFull = 0.5) {
    const calls: [number, number, number][] = [];
    const encode: Encoder = async (width, height, quality) => {
      calls.push([width, height, quality]);
      const size = Math.round(width * height * bytesPerPixelAtFull * quality ** 3);
      return new Blob([new Uint8Array(size)], { type: 'image/jpeg' });
    };
    return { encode, calls };
  }
  const base = { width: 4000, height: 3000, format: 'jpeg' as const };

  it('keeps top quality when the limit is already met', async () => {
    const { encode, calls } = encoder(0.05);
    const result = await compressToTarget({ ...base, maxBytes: 2_000_000 }, encode);
    expect(result.quality).toBe(QUALITY.max);
    expect(calls).toHaveLength(1);
  });
  it('searches quality and stays under the limit with a small margin', async () => {
    const { encode } = encoder(0.5);
    const result = await compressToTarget({ ...base, maxBytes: 3_000_000 }, encode);
    expect(result.blob.size).toBeLessThanOrEqual(3_000_000 * QUALITY.margin);
    expect(result.quality).toBeGreaterThanOrEqual(QUALITY.floor);
    expect(result.quality).toBeLessThan(QUALITY.max);
  });
  it('never changes the pixel size, whatever the limit', async () => {
    const { encode, calls } = encoder(0.5);
    const result = await compressToTarget({ ...base, maxBytes: 500_000 }, encode);
    expect([result.width, result.height]).toEqual([4000, 3000]);
    await expect(compressToTarget({ ...base, maxBytes: 100_000 }, encode)).rejects.toThrow(
      'target-unreachable',
    );
    expect(calls.every(([width, height]) => width === 4000 && height === 3000)).toBe(true);
    expect(calls.length).toBeLessThan(20);
  });
  it('brings a too-small file up to the minimum, read strictly, without adding pixels', async () => {
    const { encode, calls } = encoder(0.002);
    // "20 KB" may be counted as 20,480 bytes.
    const result = await compressToTarget({ ...base, maxBytes: 50_000, minBytes: 20_000 }, encode);
    expect(result.blob.size).toBeGreaterThanOrEqual(20_480);
    expect(result.quality).toBe(QUALITY.highest);
    expect(calls.every(([width, height]) => width === 4000 && height === 3000)).toBe(true);
  });
  it('pads a file the most detailed save leaves too small, and keeps it under the maximum', async () => {
    // A JPEG's start: SOI, then a short APP0 segment.
    const encode: Encoder = async (width, height, quality) => {
      const bytes = new Uint8Array(Math.round(width * height * 0.0001 * quality));
      bytes.set([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xdb]);
      return new Blob([bytes], { type: 'image/jpeg' });
    };
    const result = await compressToTarget({ ...base, maxBytes: 50_000, minBytes: 30_000 }, encode);
    expect(result.blob.size).toBeGreaterThanOrEqual(30_720);
    expect(result.blob.size).toBeLessThanOrEqual(50_000 * QUALITY.margin);
    expect([result.width, result.height, result.quality]).toEqual([4000, 3000, QUALITY.highest]);
    const bytes = new Uint8Array(await result.blob.arrayBuffer());
    expect(Array.from(bytes.subarray(8, 10))).toEqual([0xff, 0xfe]);
    // A format that cannot be padded safely says so.
    await expect(
      compressToTarget({ ...base, format: 'webp', maxBytes: 50_000, minBytes: 30_000 }, encode),
    ).rejects.toThrow('target-unreachable');
  });
  it('cannot shrink a lossless format, so it says so instead of changing pixels', async () => {
    const { encode, calls } = encoder(0.5);
    await expect(
      compressToTarget({ ...base, format: 'png', maxBytes: 3_000_000 }, encode),
    ).rejects.toThrow('target-unreachable');
    expect(calls).toHaveLength(1);
  });
});

describe('fewer pixels, when no quality fits at full size (asked about first)', () => {
  const base = { width: 6000, height: 4000, format: 'jpeg' as const };
  const shrink = { minWidth: 1, minHeight: 1 };
  /** Bytes grow with quality, and with pixels raised to `power` (real photos: under 1). */
  function encoder(bytesPerPixel: number, power = 1) {
    const calls: [number, number, number][] = [];
    const encode: Encoder = async (width, height, quality) => {
      calls.push([width, height, quality]);
      const size = Math.round((width * height) ** power * bytesPerPixel * quality ** 3);
      return new Blob([new Uint8Array(size)], { type: 'image/jpeg' });
    };
    return { encode, calls };
  }
  /** The width at which `size` stops fitting, found the slow way. */
  function largestFitting(size: (width: number) => number, target: number): number {
    let width = base.width;
    while (size(width) > target) width--;
    return width;
  }

  it('shrinks only as much as needed: just under the largest size that fits', async () => {
    const { encode, calls } = encoder(0.5);
    const target = 500_000 * QUALITY.margin;
    const result = await compressToTarget({ ...base, maxBytes: 500_000, shrink }, encode);
    expect(result.blob.size).toBeLessThanOrEqual(target);
    expect(result.quality).toBe(QUALITY.fit);
    const best = largestFitting(
      (width) => Math.round(width * Math.round((width * 2) / 3) * 0.5 * QUALITY.fit ** 3),
      target,
    );
    expect(result.width).toBeLessThanOrEqual(best);
    expect(result.width).toBeGreaterThanOrEqual(best * (1 - QUALITY.fitPrecision - 0.01));
    // The shape never changes.
    expect(result.width / result.height).toBeCloseTo(1.5, 2);
    expect(calls.length).toBeLessThanOrEqual(2 + QUALITY.fitSteps);
  });
  it('finds it too for pictures whose size falls more slowly than their pixels', async () => {
    const { encode } = encoder(4, 0.8);
    const target = 300_000 * QUALITY.margin;
    const result = await compressToTarget({ ...base, maxBytes: 300_000, shrink }, encode);
    expect(result.blob.size).toBeLessThanOrEqual(target);
    const best = largestFitting(
      (width) => Math.round((width * Math.round((width * 2) / 3)) ** 0.8 * 4 * QUALITY.fit ** 3),
      target,
    );
    expect(result.width).toBeGreaterThanOrEqual(best * (1 - QUALITY.fitPrecision - 0.01));
  });
  it('keeps full size whenever quality alone can meet the limit', async () => {
    const { encode, calls } = encoder(0.5);
    const result = await compressToTarget({ ...base, maxBytes: 2_000_000, shrink }, encode);
    expect([result.width, result.height]).toEqual([6000, 4000]);
    expect(calls.every(([width]) => width === 6000)).toBe(true);
  });
  it('shrinks a lossless format the same way, since pixels are all it holds', async () => {
    const { encode } = encoder(0.5);
    const result = await compressToTarget(
      { ...base, format: 'png', maxBytes: 3_000_000, shrink },
      encode,
    );
    expect(result.width).toBeLessThan(6000);
    expect(result.blob.size).toBeLessThanOrEqual(3_000_000 * QUALITY.margin);
  });
  it('never goes below the sides the website asks for at least', async () => {
    const { encode, calls } = encoder(0.5);
    await expect(
      compressToTarget(
        { ...base, maxBytes: 500_000, shrink: { minWidth: 3000, minHeight: 1 } },
        encode,
      ),
    ).rejects.toThrow('target-unreachable');
    expect(calls.every(([width]) => width >= 3000)).toBe(true);
  });
});

describe('a finer save, where the usual quality shows', () => {
  // A stand-in encoder: the file grows with quality, from 400 KB at 0.92 to 1 MB at 1.
  const encode = async (quality: number) =>
    new Blob([new Uint8Array(Math.round(400_000 + ((quality - 0.92) / 0.08) * 600_000))]);

  it('finds the finest quality above the usual one that fits the limit', async () => {
    const found = await finestThatFits(encode, 800_000);
    // 0.96 fits (700 KB), 0.98 does not (850 KB), 0.97 does (775 KB).
    expect(found?.quality).toBeCloseTo(0.97, 5);
    expect(found?.blob.size).toBeLessThanOrEqual(800_000);
  });
  it('finds nothing when even a little finer does not fit', async () => {
    expect(await finestThatFits(encode, 450_000)).toBeUndefined();
  });
});

describe('quality score', () => {
  const gradient = (width: number, height: number, noise = 0) => {
    const pixels = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      const value = ((i % width) * 255) / width + (noise ? ((i * 7919) % 17) - 8 : 0) * noise;
      pixels.set([value, value, value, 255], i * 4);
    }
    return pixels;
  };
  it('scores identical images as fully alike', () => {
    const image = gradient(64, 32);
    const { sum, count } = blockSimilarity(image, image, 64, 32);
    expect(count).toBe(32);
    expect(sum / count).toBeCloseTo(1, 6);
  });
  it('scores added noise below identical, and more noise lower still', () => {
    const clean = gradient(64, 64);
    const score = (noise: number) => {
      const { sum, count } = blockSimilarity(clean, gradient(64, 64, noise), 64, 64);
      return sum / count;
    };
    expect(score(1)).toBeLessThan(1);
    expect(score(3)).toBeLessThan(score(1));
  });
  it('counts colour: stripes smeared into one flat colour are a loss, though as bright', () => {
    // Red and blue of the same brightness (0.299 R + 0.587 G + 0.114 B ≈ 60), in stripes
    // two pixels wide; smeared, they are one flat purple of that brightness.
    const stripes = (smeared: boolean) => {
      const pixels = new Uint8ClampedArray(64 * 64 * 4);
      for (let i = 0; i < 64 * 64; i++) {
        const red = smeared ? 0.5 : (i % 64) % 4 < 2 ? 1 : 0;
        pixels.set([200 * red, 52 * (1 - red), 255 * (1 - red), 255], i * 4);
      }
      return pixels;
    };
    const { sum, count } = blockSimilarity(stripes(false), stripes(true), 64, 64);
    expect(sum / count).toBeLessThan(0.9);
    const same = blockSimilarity(stripes(false), stripes(false), 64, 64);
    expect(same.sum / same.count).toBeCloseTo(1, 6);
  });
  it('never lets unchanged colour raise a score above what brightness kept', () => {
    // A grey checkerboard flattened to its average: SSIM is C2 / (variance + C2), and the
    // colour channels, identical in both, must not pull that up.
    const board = new Uint8ClampedArray(8 * 8 * 4);
    const flat = new Uint8ClampedArray(8 * 8 * 4);
    for (let i = 0; i < 64; i++) {
      const value = 128 + ((i + (i >> 3)) % 2 ? 20 : -20);
      board.set([value, value, value, 255], i * 4);
      flat.set([128, 128, 128, 255], i * 4);
    }
    const { sum, count } = blockSimilarity(board, flat, 8, 8);
    expect(count).toBe(1);
    const c2 = (0.03 * 255) ** 2;
    expect(sum).toBeCloseTo(c2 / ((64 * 400) / 63 + c2), 4);
  });
});
