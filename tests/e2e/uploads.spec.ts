import {
  approveQuality,
  dialog,
  expect,
  fixture,
  JPEG_MAGIC,
  makeImage,
  receiptsFor,
  received,
  selectedImage,
  setSettings,
  test,
  toast,
} from './fixtures';

test.describe('compatible files are left alone', () => {
  test('a 900 KB JPG on a "JPG/PNG, max 2 MB" field is delivered untouched, with no toast', async ({
    site,
  }) => {
    const photo = await makeImage(site, 'photo.jpg', {
      width: 1200,
      height: 900,
      type: 'image/jpeg',
      quality: 0.97,
      detail: 'photo',
    });
    expect(photo.buffer.length).toBeLessThan(2_000_000);
    await site.setInputFiles('#profile', photo);
    // No delay: the page's handler has already run by the time setInputFiles resolves.
    const inputs = await receiptsFor(site, 'profile', 'input');
    const changes = await receiptsFor(site, 'profile', 'change');
    expect(inputs).toHaveLength(1);
    expect(changes).toEqual([
      {
        field: 'profile',
        via: 'change',
        files: [{ name: 'photo.jpg', type: 'image/jpeg', size: photo.buffer.length }],
      },
    ]);
    await site.waitForTimeout(600);
    await expect(toast(site)).toHaveCount(0);
  });

  test('a HEIC on an "any image" field is not touched', async ({ site }) => {
    const heic = fixture('landscape-1600x1200.heic');
    await site.setInputFiles('#any', heic);
    const changes = await receiptsFor(site, 'any');
    expect(changes[0]?.files[0]).toEqual({
      name: heic.name,
      type: 'image/heic',
      size: heic.buffer.length,
    });
  });

  test('a PDF field is never processed', async ({ site }) => {
    await site.setInputFiles('#pdf', {
      name: 'doc.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4\n%%EOF'),
    });
    expect((await receiptsFor(site, 'pdf'))[0]?.files[0]?.name).toBe('doc.pdf');
  });

  test('a transparent PNG on a PNG field passes through', async ({ site }) => {
    const png = await makeImage(site, 'logo.png', {
      width: 400,
      height: 400,
      type: 'image/png',
      transparent: true,
    });
    await site.setInputFiles('#png', png);
    expect((await receiptsFor(site, 'png'))[0]?.files[0]).toEqual({
      name: 'logo.png',
      type: 'image/png',
      size: png.buffer.length,
    });
  });
});

test.describe('automatic fixes', () => {
  test('definition of done: a 3 MB 3024×4032 HEIC becomes a JPG under 2 MB for a "JPG or PNG, max 2 MB" field', async ({
    site,
  }) => {
    const heic = fixture('portrait-3024x4032.heic', 'image/heic', 'IMG_9283.HEIC');
    await site.setInputFiles('#profile', heic);
    // This test photo is grainy on purpose, so squeezing it under 2 MB shows. Just Upload
    // says how much quality is kept and waits for an OK.
    const kept = await approveQuality(site);
    expect(kept).toBeGreaterThan(50);
    expect(kept).toBeLessThan(97);
    const receipt = await received(site, 'profile');
    // The page only ever sees the converted file.
    expect(await receiptsFor(site, 'profile')).toHaveLength(1);
    expect(await receiptsFor(site, 'profile', 'input')).toHaveLength(1);
    expect(receipt.files).toHaveLength(1);
    expect(receipt.files[0]!.name).toBe('IMG_9283.jpg');
    expect(receipt.files[0]!.type).toBe('image/jpeg');
    expect(receipt.files[0]!.size).toBeLessThan(2_000_000);
    const image = await selectedImage(site, '#profile');
    expect(image.head.slice(0, 3)).toEqual(JPEG_MAGIC);
    expect(image.width / image.height).toBeCloseTo(3024 / 4032, 2);
    await expect(toast(site)).toContainText('Ready to upload');
    // What is shown: the change as two tags, and the quality kept at the side.
    await expect(toast(site).locator('.ju-tag').first()).toContainText('HEIC');
    await expect(toast(site).locator('.ju-tag-after')).toContainText('JPG');
    await expect(toast(site).locator('.ju-meter')).toContainText(`${kept}%`);
    // What is read aloud: the same, as one sentence.
    await expect(toast(site)).toContainText('HEIC → JPG');
    await expect(toast(site)).toContainText(`Quality kept: ${kept}%`);
  });

  test('a photo that still looks the same under the size limit is made smaller without asking', async ({
    site,
  }) => {
    const photo = await makeImage(site, 'IMG_2001.jpg', {
      width: 4000,
      height: 3000,
      type: 'image/jpeg',
      quality: 0.98,
      detail: 'texture',
    });
    expect(photo.buffer.length).toBeGreaterThan(2_000_000);
    await site.setInputFiles('#profile', photo);
    const receipt = await received(site, 'profile');
    expect(receipt.files[0]!.size).toBeLessThan(2_000_000);
    await expect(dialog(site)).toHaveCount(0);
    await expect(toast(site)).toContainText(/Quality kept: (9[7-9]|100)%/);
  });

  test('a HEIC with no MIME type is still recognized and converted', async ({ site }) => {
    await site.setInputFiles('#jpeg', fixture('landscape-1600x1200.heic', '', 'holiday.heic'));
    const receipt = await received(site, 'jpeg');
    expect(receipt.files[0]).toMatchObject({ name: 'holiday.jpg', type: 'image/jpeg' });
    const image = await selectedImage(site, '#jpeg');
    expect([image.width, image.height]).toEqual([1600, 1200]);
  });

  test('with "ask before visible quality loss" off, a large JPG is compressed under 500 KB without asking', async ({
    site,
    context,
    extensionId,
  }) => {
    await setSettings(context, extensionId, { askBeforeQualityChanges: false });
    const photo = await makeImage(site, 'big.jpg', {
      width: 2400,
      height: 1600,
      type: 'image/jpeg',
      quality: 0.95,
      detail: 'photo',
    });
    expect(photo.buffer.length).toBeGreaterThan(1_000_000);
    await site.setInputFiles('#small', photo);
    const receipt = await received(site, 'small');
    expect(receipt.files[0]).toMatchObject({ name: 'big.jpg', type: 'image/jpeg' });
    expect(receipt.files[0]!.size).toBeLessThanOrEqual(500_000);
    await expect(dialog(site)).toHaveCount(0);
  });

  test('acceptance 2: a WebP on an image/jpeg,image/png field becomes an allowed format', async ({
    site,
  }) => {
    const webp = await makeImage(site, 'photo.webp', {
      width: 800,
      height: 600,
      type: 'image/webp',
    });
    await site.setInputFiles('#jpg-png', webp);
    const receipt = await received(site, 'jpg-png');
    expect(receipt.files[0]).toMatchObject({ name: 'photo.jpg', type: 'image/jpeg' });
  });

  test('a JPG becomes WebP when WebP is explicitly required', async ({ site }) => {
    const jpg = await makeImage(site, 'photo.jpg', { width: 800, height: 600, type: 'image/jpeg' });
    await site.setInputFiles('#webp', jpg);
    const receipt = await received(site, 'webp');
    expect(receipt.files[0]).toMatchObject({ name: 'photo.webp', type: 'image/webp' });
  });

  test('an oversized image is resized to fit 1920 × 1920, keeping its shape', async ({ site }) => {
    const photo = await makeImage(site, 'wide.png', {
      width: 4000,
      height: 3000,
      type: 'image/png',
    });
    await site.setInputFiles('#maximum', photo);
    await received(site, 'maximum');
    const image = await selectedImage(site, '#maximum');
    expect(image).toMatchObject({ name: 'wide.png', type: 'image/png', width: 1920, height: 1440 });
  });

  test('an input added after page load is handled', async ({ site }) => {
    await site.click('#add-input');
    const webp = await makeImage(site, 'later.webp', {
      width: 640,
      height: 480,
      type: 'image/webp',
    });
    await site.setInputFiles('#dynamic', webp);
    const receipt = await received(site, 'dynamic');
    expect(receipt.files[0]).toMatchObject({ name: 'later.jpg', type: 'image/jpeg' });
  });

  test('a React upload-on-select handler never sees the original file', async ({ site }) => {
    const webp = await makeImage(site, 'avatar.webp', {
      width: 640,
      height: 480,
      type: 'image/webp',
    });
    await site.setInputFiles('#react-image', webp);
    const receipt = await received(site, 'react-image', 'react-upload');
    await site.waitForTimeout(300);
    expect(await receiptsFor(site, 'react-image', 'react-upload')).toHaveLength(1);
    expect(receipt.files[0]).toMatchObject({ name: 'avatar.jpg', type: 'image/jpeg' });
  });

  test('several files are converted and keep their order', async ({ site }) => {
    const first = await makeImage(site, 'one.webp', {
      width: 300,
      height: 200,
      type: 'image/webp',
    });
    const second = await makeImage(site, 'two.jpg', {
      width: 300,
      height: 200,
      type: 'image/jpeg',
    });
    const third = await makeImage(site, 'three.png', {
      width: 300,
      height: 200,
      type: 'image/png',
    });
    await site.setInputFiles('#multiple', [first, second, third]);
    const receipt = await received(site, 'multiple');
    expect(receipt.files.map((file) => file.name)).toEqual(['one.jpg', 'two.jpg', 'three.jpg']);
    expect(receipt.files[1]!.size).toBe(second.buffer.length);
  });

  test('a form submitted while an image is being prepared sends the prepared image', async ({
    site,
  }) => {
    const webp = await makeImage(site, 'upload.webp', {
      width: 2000,
      height: 1500,
      type: 'image/webp',
      detail: 'photo',
    });
    await site.setInputFiles('#form-image', webp);
    await site.click('#form button[type="submit"]');
    // The submit waits while Just Upload asks about this grainy photo's quality.
    await approveQuality(site);
    const receipt = await received(site, 'form-image', 'submit');
    expect(receipt.files[0]).toMatchObject({ name: 'upload.jpg', type: 'image/jpeg' });
    expect(receipt.files[0]!.size).toBeLessThanOrEqual(1_000_000);
  });
});

test.describe('changes that need a person to decide', () => {
  test('acceptance 4: a portrait photo on a square 600 × 600 field asks for a crop first', async ({
    site,
  }) => {
    const portrait = await makeImage(site, 'me.jpg', {
      width: 900,
      height: 1200,
      type: 'image/jpeg',
    });
    await site.setInputFiles('#square', portrait);
    await expect(dialog(site)).toBeVisible();
    await expect(dialog(site)).toContainText('square');
    expect(await receiptsFor(site, 'square')).toHaveLength(0);
    await dialog(site).getByRole('button', { name: 'Use this crop' }).click();
    const receipt = await received(site, 'square');
    expect(receipt.files[0]).toMatchObject({ name: 'me.jpg', type: 'image/jpeg' });
    const image = await selectedImage(site, '#square');
    expect([image.width, image.height]).toEqual([600, 600]);
  });

  test('cancelling the crop hands the original file to the site', async ({ site }) => {
    const portrait = await makeImage(site, 'me.jpg', {
      width: 900,
      height: 1200,
      type: 'image/jpeg',
    });
    await site.setInputFiles('#square', portrait);
    await expect(dialog(site)).toBeVisible();
    await site.keyboard.press('Escape');
    await expect(dialog(site)).toHaveCount(0);
    const receipt = await received(site, 'square');
    expect(receipt.files[0]).toEqual({
      name: 'me.jpg',
      type: 'image/jpeg',
      size: portrait.buffer.length,
    });
  });

  test('a transparent PNG on a JPG-only field asks before adding a white background', async ({
    site,
  }) => {
    const png = await makeImage(site, 'logo.png', {
      width: 500,
      height: 500,
      type: 'image/png',
      transparent: true,
    });
    await site.setInputFiles('#jpeg', png);
    await expect(dialog(site)).toBeVisible();
    await expect(dialog(site)).toContainText('transparent');
    expect(await receiptsFor(site, 'jpeg')).toHaveLength(0);
    await dialog(site)
      .getByRole('button', { name: /convert/i })
      .click();
    const receipt = await received(site, 'jpeg');
    expect(receipt.files[0]).toMatchObject({ name: 'logo.jpg', type: 'image/jpeg' });
  });
});

test.describe('minimum file sizes, as exam and government forms ask', () => {
  test('an iPhone photo on "200 × 230 pixels, between 20 KB and 50 KB" is cropped, sized and kept in range', async ({
    site,
  }) => {
    await site.setInputFiles('#exam', fixture('everyday-3024x4032.heic', 'image/heic', 'me.heic'));
    await expect(dialog(site)).toBeVisible();
    await dialog(site).getByRole('button', { name: 'Use this crop' }).click();
    const receipt = await received(site, 'exam');
    expect(receipt.files[0]).toMatchObject({ name: 'me.jpg', type: 'image/jpeg' });
    // Read strictly: "20 KB" may be counted as 20,480 bytes.
    expect(receipt.files[0]!.size).toBeGreaterThanOrEqual(20_480);
    expect(receipt.files[0]!.size).toBeLessThanOrEqual(50_000);
    const image = await selectedImage(site, '#exam');
    expect([image.width, image.height]).toEqual([200, 230]);
  });

  test('a tiny PNG signature is brought up to "minimum 30 KB" without changing its pixels', async ({
    site,
  }) => {
    const signature = await makeImage(site, 'signature.png', {
      width: 120,
      height: 60,
      type: 'image/png',
    });
    expect(signature.buffer.length).toBeLessThan(30_000);
    await site.setInputFiles('#document', signature);
    const receipt = await received(site, 'document');
    expect(receipt.files[0]).toMatchObject({ name: 'signature.png', type: 'image/png' });
    expect(receipt.files[0]!.size).toBeGreaterThanOrEqual(30_720);
    const image = await selectedImage(site, '#document');
    expect([image.width, image.height]).toEqual([120, 60]);
    await expect(toast(site)).toContainText('Quality kept: 100%');
  });
});

test.describe('failure and races', () => {
  test('a damaged HEIC fails open: the site gets the original and the person gets a calm message', async ({
    site,
  }) => {
    const broken = fixture('landscape-1600x1200.heic', 'image/heic', 'broken.heic');
    broken.buffer = broken.buffer.subarray(0, 4096);
    await site.setInputFiles('#jpeg', broken);
    const receipt = await received(site, 'jpeg');
    expect(receipt.files[0]).toEqual({ name: 'broken.heic', type: 'image/heic', size: 4096 });
    await expect(toast(site)).toBeVisible();
    await expect(toast(site)).toContainText(/couldn.t/i);
    // The page keeps working.
    const next = await makeImage(site, 'fine.jpg', { width: 200, height: 200, type: 'image/jpeg' });
    await site.setInputFiles('#jpeg', next);
    await expect
      .poll(async () => (await receiptsFor(site, 'jpeg')).at(-1)?.files[0]?.name)
      .toBe('fine.jpg');
  });

  test('a failure leaves a private note, and “Report a problem” opens it as a report', async ({
    context,
    site,
  }) => {
    const broken = fixture('landscape-1600x1200.heic', 'image/heic', 'broken.heic');
    broken.buffer = broken.buffer.subarray(0, 4096);
    await site.setInputFiles('#jpeg', broken);
    await expect(toast(site)).toContainText(/couldn.t/i);
    const opened = context.waitForEvent('page');
    await toast(site).getByRole('button', { name: 'Report a problem' }).click();
    const settings = await opened;
    await expect(settings).toHaveURL(/options\.html#problems$/);
    const notes = settings.getByRole('region', { name: 'Problems' });
    await expect(notes.locator('.row-title')).toHaveText(['The image could not be read']);
    await settings.getByLabel('Which website was it? (optional)').fill('a job site');
    const report = await settings.getByLabel('Problem report').inputValue();
    expect(report).toContain('Website: a job site');
    expect(report).toContain('The image could not be read (damaged)');
    expect(report).toContain('Image: HEIC, about 4 KB');
    expect(report).toContain('Upload rules: JPG');
    // Only what the person typed: no file name, no address.
    expect(report).not.toMatch(/broken|localhost|127\.0\.0\.1/);
    await settings.getByRole('button', { name: 'Clear notes' }).click();
    await expect(settings.getByText('No problems so far.')).toBeVisible();
  });

  test('if the processing frame crashes mid-job, the site soon gets the original and the next image still works', async ({
    context,
    site,
  }) => {
    test.setTimeout(90_000);
    // A 12 MP photo written as AVIF takes seconds: time enough to crash the frame mid-job.
    await site.setInputFiles('#avif-only', fixture('portrait-3024x4032.heic'));
    await expect
      .poll(() => site.frames().some((frame) => frame.url().includes('/processor.html')))
      .toBe(true);
    const processor = site.frames().find((frame) => frame.url().includes('/processor.html'))!;
    await site.waitForTimeout(500);
    const crashedAt = Date.now();
    // What running out of memory on a huge image does: the frame's process dies.
    const cdp = await context.newCDPSession(processor);
    await cdp.send('Page.crash').catch(() => {});
    const receipt = await received(site, 'avif-only');
    expect(Date.now() - crashedAt).toBeLessThan(15_000);
    expect(receipt.files[0]).toMatchObject({ name: 'portrait-3024x4032.heic', type: 'image/heic' });
    await expect(toast(site)).toContainText(/couldn.t/i);
    // A fresh frame takes the next image.
    await site.setInputFiles('#jpeg', fixture('landscape-1600x1200.heic'));
    await expect
      .poll(async () => (await receiptsFor(site, 'jpeg')).at(-1)?.files[0]?.type, {
        timeout: 30_000,
      })
      .toBe('image/jpeg');
  });

  test('picking a second file while the first is being prepared never lets the first one win', async ({
    site,
  }) => {
    await site.setInputFiles('#profile', fixture('portrait-3024x4032.heic'));
    const second = await makeImage(site, 'second.jpg', {
      width: 400,
      height: 300,
      type: 'image/jpeg',
    });
    await site.setInputFiles('#profile', second);
    await site.waitForTimeout(4000);
    const changes = await receiptsFor(site, 'profile');
    expect(changes.map((receipt) => receipt.files[0]?.name)).toEqual(['second.jpg']);
    expect((await selectedImage(site, '#profile')).name).toBe('second.jpg');
  });
});
