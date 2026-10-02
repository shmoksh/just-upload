import { writeFileSync } from 'node:fs';
import {
  approveQuality,
  dropFiles,
  expect,
  fixture,
  fixturePath,
  makeImage,
  test,
  type Receipt,
} from './fixtures';
import type { Page } from '@playwright/test';

/** What a library reported for a field, once it has reported anything. */
async function reported(page: Page, field: string): Promise<Receipt> {
  await expect
    .poll(() => page.evaluate((f) => window.receipts.filter((r) => r.field === f).length, field), {
      timeout: 30_000,
    })
    .toBeGreaterThan(0);
  return page.evaluate((f) => window.receipts.find((r) => r.field === f)!, field);
}

test.describe('real upload libraries, choosing a file', () => {
  test.beforeEach(async ({ site }) => {
    await site.goto('/libraries.html');
  });

  test('React Dropzone accepts an iPhone photo it would otherwise reject', async ({ site }) => {
    await site.setInputFiles(
      '#react-dropzone input[type="file"]',
      fixture('portrait-3024x4032.heic', 'image/heic', 'IMG_4410.HEIC'),
    );
    // Squeezing this grainy test photo under the 2 MB limit shows, so Just Upload asks.
    await approveQuality(site);
    const receipt = await reported(site, 'react-dropzone');
    expect(receipt.via).toBe('accepted');
    expect(receipt.files[0]).toMatchObject({ name: 'IMG_4410.jpg', type: 'image/jpeg' });
    // The field says "max 2 MB", which React Dropzone enforces itself.
    expect(receipt.files[0]!.size).toBeLessThanOrEqual(2_000_000);
  });

  test('FilePond receives the converted photo', async ({ site }) => {
    await site.setInputFiles('.filepond--browser', fixture('landscape-1600x1200.heic'));
    const receipt = await reported(site, 'filepond');
    expect(receipt.files[0]).toMatchObject({ name: 'landscape-1600x1200.jpg', type: 'image/jpeg' });
  });

  test('Dropzone.js, whose input sits apart from its drop area, accepts the converted photo', async ({
    site,
  }) => {
    await site.setInputFiles('input.dz-hidden-input', fixture('landscape-1600x1200.heic'));
    const receipt = await reported(site, 'dropzone');
    expect(receipt).toMatchObject({
      via: 'accepted',
      files: [{ name: 'landscape-1600x1200.jpg', type: 'image/jpeg' }],
    });
  });
});

test.describe('real upload libraries, dropping a file', () => {
  test.beforeEach(async ({ site }) => {
    await site.goto('/libraries.html');
  });

  test('React Dropzone gets a dropped iPhone photo as a JPG under its limit', async ({ site }) => {
    await dropFiles(site, '#react-dropzone', [fixturePath('portrait-3024x4032.heic')]);
    await approveQuality(site);
    const receipt = await reported(site, 'react-dropzone');
    expect(receipt.via).toBe('accepted');
    expect(receipt.files[0]).toMatchObject({ name: 'portrait-3024x4032.jpg', type: 'image/jpeg' });
    expect(receipt.files[0]!.size).toBeLessThanOrEqual(2_000_000);
  });

  test('FilePond gets a dropped photo converted', async ({ site }) => {
    await dropFiles(site, '.filepond--root', [fixturePath('landscape-1600x1200.heic')]);
    const receipt = await reported(site, 'filepond');
    expect(receipt.files[0]).toMatchObject({ name: 'landscape-1600x1200.jpg', type: 'image/jpeg' });
  });

  test('a compatible dropped photo reaches the library untouched', async ({ site }) => {
    const photo = await makeImage(site, 'ok.jpg', { width: 800, height: 600, type: 'image/jpeg' });
    const path = test.info().outputPath('ok.jpg');
    writeFileSync(path, photo.buffer);
    await dropFiles(site, '#react-dropzone', [path]);
    const receipt = await reported(site, 'react-dropzone');
    expect(receipt).toEqual({
      field: 'react-dropzone',
      via: 'accepted',
      files: [{ name: 'ok.jpg', type: 'image/jpeg', size: photo.buffer.length }],
    });
  });

  test('Dropzone.js, whose input sits apart from its drop area, gets a dropped photo converted', async ({
    site,
  }) => {
    await dropFiles(site, '#dropzone', [fixturePath('landscape-1600x1200.heic')]);
    const receipt = await reported(site, 'dropzone');
    expect(receipt).toMatchObject({
      via: 'accepted',
      files: [{ name: 'landscape-1600x1200.jpg', type: 'image/jpeg' }],
    });
  });
});
