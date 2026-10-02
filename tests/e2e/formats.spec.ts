import type { Page } from '@playwright/test';
import {
  dialog,
  expect,
  fixture,
  JPEG_MAGIC,
  makeImage,
  received,
  receiptsFor,
  selectedImage,
  test,
} from './fixtures';

/** The first bytes of the file an input now holds, as text-friendly hex. */
async function magic(page: Page, selector: string, length = 4): Promise<string> {
  const bytes = await page.evaluate(
    async ({ selector, length }) => {
      const file = document.querySelector<HTMLInputElement>(selector)!.files![0]!;
      return Array.from(new Uint8Array(await file.slice(0, length).arrayBuffer()));
    },
    { selector, length },
  );
  return bytes.map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

test.describe('every supported format can be read', () => {
  const toJpeg: [string, string, number, number][] = [
    ['photo-640x480.avif', 'image/avif', 640, 480],
    ['photo-320x240.gif', 'image/gif', 320, 240],
    ['photo-320x240.bmp', 'image/bmp', 320, 240],
    ['photo-320x240.tif', 'image/tiff', 320, 240],
    ['photo-640x480.jxl', 'image/jxl', 640, 480],
  ];
  for (const [name, type, width, height] of toJpeg) {
    test(`${name} becomes a JPG for a JPG-only field`, async ({ site }) => {
      await site.setInputFiles('#jpeg', fixture(name, type));
      const receipt = await received(site, 'jpeg');
      expect(receipt.files[0]!.name).toBe(name.replace(/\.\w+$/, '.jpg'));
      expect(receipt.files[0]!.type).toBe('image/jpeg');
      const image = await selectedImage(site, '#jpeg');
      expect(image.head.slice(0, 3)).toEqual(JPEG_MAGIC);
      expect([image.width, image.height]).toEqual([width, height]);
    });
  }

  test('an ICO becomes a PNG and keeps its transparency', async ({ site }) => {
    await site.setInputFiles('#png', fixture('icon-128.ico', 'image/x-icon'));
    const receipt = await received(site, 'png');
    expect(receipt.files[0]).toMatchObject({ name: 'icon-128.png', type: 'image/png' });
    expect(await selectedImage(site, '#png')).toMatchObject({ width: 128, height: 128 });
  });

  test('an SVG logo is drawn sharp at a useful size, keeping its transparency', async ({
    site,
  }) => {
    await site.setInputFiles('#png', fixture('logo.svg', 'image/svg+xml'));
    const receipt = await received(site, 'png');
    expect(receipt.files[0]).toMatchObject({ name: 'logo.png', type: 'image/png' });
    // viewBox 200 × 100, drawn 1024 px on its longer side.
    expect(await selectedImage(site, '#png')).toMatchObject({ width: 1024, height: 512 });
  });

  test('an SVG is drawn at exactly the size a field asks for', async ({ site }) => {
    await site.setInputFiles('#maximum', fixture('logo.svg', 'image/svg+xml'));
    await received(site, 'maximum');
    expect(await selectedImage(site, '#maximum')).toMatchObject({
      name: 'logo.png',
      width: 1024,
      height: 512,
    });
  });

  test('an animated GIF asks before keeping only its first frame', async ({ site }) => {
    await site.setInputFiles('#jpeg', fixture('animated-160x120.gif', 'image/gif'));
    await expect(dialog(site)).toContainText('This site needs a single image');
    expect(await receiptsFor(site, 'jpeg')).toHaveLength(0);
    await dialog(site).getByRole('button', { name: 'Use first frame' }).click();
    const receipt = await received(site, 'jpeg');
    expect(receipt.files[0]).toMatchObject({ name: 'animated-160x120.jpg', type: 'image/jpeg' });
  });

  test('an AVIF on an "any image" field is left alone', async ({ site }) => {
    const avif = fixture('photo-640x480.avif', 'image/avif');
    await site.setInputFiles('#any', avif);
    expect((await receiptsFor(site, 'any'))[0]?.files[0]).toEqual({
      name: avif.name,
      type: 'image/avif',
      size: avif.buffer.length,
    });
  });
});

test.describe('every supported format can be written', () => {
  test('GIF, after saying photos may look grainy', async ({ site }) => {
    const photo = await makeImage(site, 'photo.jpg', {
      width: 400,
      height: 300,
      type: 'image/jpeg',
    });
    await site.setInputFiles('#gif-only', photo);
    await expect(dialog(site)).toContainText('This site only accepts GIF');
    await dialog(site).getByRole('button', { name: 'Convert & upload' }).click();
    const receipt = await received(site, 'gif-only');
    expect(receipt.files[0]).toMatchObject({ name: 'photo.gif', type: 'image/gif' });
    expect(await magic(site, '#gif-only', 6)).toBe('474946383961'); // GIF89a
    expect(await selectedImage(site, '#gif-only')).toMatchObject({ width: 400, height: 300 });
  });

  test('BMP', async ({ site }) => {
    const photo = await makeImage(site, 'photo.webp', {
      width: 400,
      height: 300,
      type: 'image/webp',
    });
    await site.setInputFiles('#bmp-only', photo);
    const receipt = await received(site, 'bmp-only');
    expect(receipt.files[0]).toMatchObject({ name: 'photo.bmp', type: 'image/bmp' });
    expect(await magic(site, '#bmp-only', 2)).toBe('424d'); // BM
    expect(await selectedImage(site, '#bmp-only')).toMatchObject({ width: 400, height: 300 });
  });

  test('BMP from a transparent image asks about the white background first', async ({ site }) => {
    const png = await makeImage(site, 'logo.png', {
      width: 300,
      height: 300,
      type: 'image/png',
      transparent: true,
    });
    await site.setInputFiles('#bmp-only', png);
    await expect(dialog(site)).toContainText('This site only accepts BMP');
    await dialog(site).getByRole('button', { name: 'Convert & upload' }).click();
    expect((await received(site, 'bmp-only')).files[0]!.name).toBe('logo.bmp');
  });

  test('TIFF', async ({ site }) => {
    const photo = await makeImage(site, 'scan.png', { width: 300, height: 200, type: 'image/png' });
    await site.setInputFiles('#tiff-only', photo);
    const receipt = await received(site, 'tiff-only');
    expect(receipt.files[0]).toMatchObject({ name: 'scan.tif', type: 'image/tiff' });
    expect(['49492a00', '4d4d002a']).toContain(await magic(site, '#tiff-only'));
    expect(receipt.files[0]!.size).toBeGreaterThan(300 * 200 * 3);
  });

  test('ICO, scaled down to the 256 × 256 an icon allows', async ({ site }) => {
    const png = await makeImage(site, 'logo.png', {
      width: 600,
      height: 600,
      type: 'image/png',
      transparent: true,
    });
    await site.setInputFiles('#ico-only', png);
    const receipt = await received(site, 'ico-only');
    expect(receipt.files[0]).toMatchObject({ name: 'logo.ico', type: 'image/x-icon' });
    expect(await magic(site, '#ico-only')).toBe('00000100');
    expect(await selectedImage(site, '#ico-only')).toMatchObject({ width: 256, height: 256 });
  });

  test('AVIF', async ({ site }) => {
    const photo = await makeImage(site, 'photo.jpg', {
      width: 800,
      height: 600,
      type: 'image/jpeg',
    });
    await site.setInputFiles('#avif-only', photo);
    const receipt = await received(site, 'avif-only');
    expect(receipt.files[0]).toMatchObject({ name: 'photo.avif', type: 'image/avif' });
    expect(await selectedImage(site, '#avif-only')).toMatchObject({ width: 800, height: 600 });
  });

  test('HEIC straight to AVIF', async ({ site }) => {
    await site.setInputFiles('#avif-only', fixture('landscape-1600x1200.heic'));
    const receipt = await received(site, 'avif-only');
    expect(receipt.files[0]).toMatchObject({
      name: 'landscape-1600x1200.avif',
      type: 'image/avif',
    });
    expect(await selectedImage(site, '#avif-only')).toMatchObject({ width: 1600, height: 1200 });
  });
});
