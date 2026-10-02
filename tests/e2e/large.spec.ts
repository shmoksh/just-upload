import { rmSync, statSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { expect, receiptsFor, test, toast } from './fixtures';
import {
  writeHugeBigTiff,
  writeHugeBmp,
  writeHugeJpeg,
  writeHugePng,
  writeHugeTiff,
} from './large-files';

// Images far beyond what a browser can decode go to the in-page processor by reference
// and are read in a stream, straight down to the size the website states. Each test file
// is red on the left and blue on the right (dark and light for the greyscale JPEG).
// Without a stated size, Just Upload never changes the pixel size, so such an image is
// passed through untouched instead.

interface Case {
  name: string;
  file: string;
  /** A field the file cannot pass through untouched. */
  field: string;
  write: (path: string) => Promise<void>;
  width: number;
  height: number;
  left: number[];
  right: number[];
}

const cases: Case[] = [
  {
    name: 'a 256-megapixel PNG',
    file: 'huge.png',
    field: 'maximum',
    write: (path) => writeHugePng(path, 16_000, 16_000),
    width: 16_000,
    height: 16_000,
    left: [220, 30, 30],
    right: [30, 60, 220],
  },
  {
    name: 'a 588 MB BMP',
    file: 'huge.bmp',
    field: 'maximum',
    write: (path) => writeHugeBmp(path, 14_000, 14_000),
    width: 14_000,
    height: 14_000,
    left: [220, 30, 30],
    right: [30, 60, 220],
  },
  {
    name: 'a 400-megapixel tiled TIFF',
    file: 'huge.tif',
    field: 'maximum',
    write: (path) => writeHugeTiff(path, 20_000, 20_000),
    width: 20_000,
    height: 20_000,
    left: [220, 30, 30],
    right: [30, 60, 220],
  },
  {
    name: 'a 432-megapixel JPEG, beyond what Chrome decodes',
    file: 'huge.jpg',
    field: 'maximum',
    write: (path) => writeHugeJpeg(path, 24_000, 18_000),
    width: 24_000,
    height: 18_000,
    left: [64, 64, 64],
    right: [192, 192, 192],
  },
];

/** The chosen file's size and the colours a quarter and three quarters across it. */
function inspect(page: Page, field: string) {
  return page.evaluate(async (id) => {
    const file = document.querySelector<HTMLInputElement>(`#${id}`)!.files![0]!;
    const bitmap = await createImageBitmap(file);
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d')!;
    context.drawImage(bitmap, 0, 0);
    const at = (x: number) =>
      Array.from(
        context
          .getImageData(Math.floor(bitmap.width * x), Math.floor(bitmap.height / 2), 1, 1)
          .data.subarray(0, 3),
      );
    return {
      type: file.type,
      size: file.size,
      width: bitmap.width,
      height: bitmap.height,
      left: at(0.25),
      right: at(0.75),
    };
  }, field);
}

test.describe('images far too large for the browser', () => {
  for (const item of cases) {
    test(`${item.name} is brought to the 1920 × 1920 the website states`, async ({ site }) => {
      test.setTimeout(240_000);
      const path = test.info().outputPath(item.file);
      await item.write(path);
      const bytes = statSync(path).size;
      const started = Date.now();
      await site.setInputFiles(`#${item.field}`, path);
      await expect
        .poll(async () => (await receiptsFor(site, item.field)).length, { timeout: 180_000 })
        .toBeGreaterThan(0);
      const seconds = ((Date.now() - started) / 1000).toFixed(1);
      const result = await inspect(site, item.field);
      console.log(
        `\nLARGE ${item.name} (${(bytes / 1e6).toFixed(0)} MB) → ${result.width} × ${result.height}, ${(result.size / 1e6).toFixed(2)} MB, in ${seconds} s\n`,
      );
      expect(['image/jpeg', 'image/png']).toContain(result.type);
      expect(Math.max(result.width, result.height)).toBe(1920);
      expect(result.width / result.height).toBeCloseTo(item.width / item.height, 2);
      result.left.forEach((value, i) => expect(Math.abs(value - item.left[i]!)).toBeLessThan(24));
      result.right.forEach((value, i) => expect(Math.abs(value - item.right[i]!)).toBeLessThan(24));
      await expect(toast(site)).toContainText('Ready to upload');
    });
  }
});

test('without a stated size, a huge image keeps its pixels: it is passed through untouched', async ({
  site,
}) => {
  test.setTimeout(240_000);
  const path = test.info().outputPath('huge.png');
  await writeHugePng(path, 16_000, 16_000);
  const bytes = statSync(path).size;
  // "JPG only", and nothing about pixels: converting would mean shrinking it.
  await site.setInputFiles('#jpeg', path);
  await expect
    .poll(async () => (await receiptsFor(site, 'jpeg')).length, { timeout: 120_000 })
    .toBeGreaterThan(0);
  const [received] = (await receiptsFor(site, 'jpeg'))[0]!.files;
  expect(received).toEqual({ name: 'huge.png', type: 'image/png', size: bytes });
  await expect(toast(site)).toContainText('too large to prepare');
});

test('a 4.6 GB BigTIFF scan is brought to the size the website states', async ({ site }) => {
  test.skip(
    !process.env.JUST_UPLOAD_STRESS,
    'Writes a 4.6 GB file: set JUST_UPLOAD_STRESS=1 to run it.',
  );
  test.setTimeout(900_000);
  const path = test.info().outputPath('scan.tif');
  try {
    await writeHugeBigTiff(path, 40_000, 38_000);
    const bytes = statSync(path).size;
    const started = Date.now();
    await site.setInputFiles('#maximum', path);
    await expect
      .poll(async () => (await receiptsFor(site, 'maximum')).length, { timeout: 600_000 })
      .toBeGreaterThan(0);
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    const result = await inspect(site, 'maximum');
    console.log(
      `\nLARGE a ${(bytes / 1e9).toFixed(2)} GB BigTIFF → ${result.width} × ${result.height}, ${(result.size / 1e6).toFixed(2)} MB, in ${seconds} s\n`,
    );
    expect(bytes).toBeGreaterThan(4e9);
    expect(result.type).toBe('image/jpeg');
    expect(Math.max(result.width, result.height)).toBe(1920);
    expect(result.width / result.height).toBeCloseTo(40_000 / 38_000, 2);
    result.left.forEach((value, i) => expect(Math.abs(value - [220, 30, 30][i]!)).toBeLessThan(24));
    result.right.forEach((value, i) =>
      expect(Math.abs(value - [30, 60, 220][i]!)).toBeLessThan(24),
    );
  } finally {
    rmSync(path, { force: true });
  }
});
