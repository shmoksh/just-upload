import type { Page } from '@playwright/test';
import { dialog, expect, makeImage, received, selectedImage, test, toast } from './fixtures';

// Passport and exam forms give a printed size and a DPI: "3.5 cm × 4.5 cm · 200 DPI".

/** The bytes of the file an input now holds. */
async function chosenBytes(page: Page, selector: string): Promise<Buffer> {
  const bytes = await page.evaluate(async (target) => {
    const file = document.querySelector<HTMLInputElement>(target)!.files![0]!;
    return Array.from(new Uint8Array(await file.arrayBuffer()));
  }, selector);
  return Buffer.from(bytes);
}

/** The density in a JPEG's JFIF header, as image software reads it. */
function jfifDpi(bytes: Buffer): number | undefined {
  if (bytes.toString('latin1', 6, 11) !== 'JFIF\0' || bytes[13] !== 1) return undefined;
  return bytes.readUInt16BE(14);
}

test('a passport photo is cropped to 3.5 × 4.5 cm, sized for 200 DPI and saved at it', async ({
  site,
}) => {
  const photo = await makeImage(site, 'IMG_7001.jpg', {
    width: 1600,
    height: 1200,
    type: 'image/jpeg',
    detail: 'texture',
  });
  await site.setInputFiles('#passport', photo);
  await expect(dialog(site)).toContainText('This site needs a 3.5 × 4.5 cm photo');
  await dialog(site).getByRole('button', { name: 'Use this crop' }).click();
  const receipt = await received(site, 'passport');
  await expect(toast(site)).toContainText('200 DPI');
  expect(receipt.files[0]).toMatchObject({ name: 'IMG_7001.jpg', type: 'image/jpeg' });
  // 3.5 × 4.5 cm at 200 pixels to the inch.
  const image = await selectedImage(site, '#passport');
  expect([image.width, image.height]).toEqual([276, 354]);
  expect(jfifDpi(await chosenBytes(site, '#passport'))).toBe(200);
});

test('a photo that only records the wrong DPI gets the right one, and nothing else changes', async ({
  site,
}) => {
  const photo = await makeImage(site, 'IMG_7002.jpg', {
    width: 276,
    height: 354,
    type: 'image/jpeg',
  });
  expect(jfifDpi(photo.buffer)).not.toBe(200);
  await site.setInputFiles('#passport', photo);
  const receipt = await received(site, 'passport');
  await expect(toast(site)).toContainText('Set to 200 DPI');
  const bytes = await chosenBytes(site, '#passport');
  expect(receipt.files[0]).toMatchObject({ name: 'IMG_7002.jpg', type: 'image/jpeg' });
  expect(jfifDpi(bytes)).toBe(200);
  // Only the header changed: the compressed picture is byte for byte the same.
  expect(bytes.subarray(-1000).equals(photo.buffer.subarray(-1000))).toBe(true);
  expect(Math.abs(bytes.length - photo.buffer.length)).toBeLessThanOrEqual(18);
});
