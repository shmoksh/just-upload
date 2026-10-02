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
  toast,
} from './fixtures';

test('the file picker offers HEIC on a JPG/PNG-only field, and the HEIC arrives as JPG', async ({
  site,
}) => {
  await site.evaluate(() => {
    const input = document.querySelector<HTMLInputElement>('#jpg-png')!;
    input.addEventListener('click', () => (input.dataset.acceptDuringClick = input.accept));
  });
  const [chooser] = await Promise.all([site.waitForEvent('filechooser'), site.click('#jpg-png')]);
  expect(await site.getAttribute('#jpg-png', 'data-accept-during-click')).toContain('.heic');
  // Restored on the next task, once the browser has read it to open the picker.
  await expect(site.locator('#jpg-png')).toHaveAttribute('accept', 'image/jpeg,image/png');
  await chooser.setFiles(fixture('landscape-1600x1200.heic', 'image/heic', 'IMG_0001.HEIC'));
  const receipt = await received(site, 'jpg-png');
  expect(receipt.files[0]).toMatchObject({ name: 'IMG_0001.jpg', type: 'image/jpeg' });
  expect((await selectedImage(site, '#jpg-png')).head.slice(0, 3)).toEqual(JPEG_MAGIC);
});

test('the crop dialog works on a page with a strict Content Security Policy', async ({ site }) => {
  await site.goto('/strict.html');
  const portrait = await makeImage(site, 'me.jpg', {
    width: 900,
    height: 1200,
    type: 'image/jpeg',
  });
  await site.setInputFiles('#square', portrait);
  await expect(dialog(site)).toBeVisible();
  // Styles come from a constructed stylesheet, which the page's style-src cannot block.
  expect(await dialog(site).evaluate((element) => getComputedStyle(element).borderRadius)).toBe(
    '20px',
  );
  // The preview is drawn on a canvas (blob: images would be blocked); wait for its first frame.
  await expect
    .poll(() =>
      dialog(site).evaluate((element) => {
        const canvas = element.querySelector('canvas')!;
        const context = canvas.getContext('2d')!;
        return context.getImageData(canvas.width / 2, canvas.height / 2, 1, 1).data[3];
      }),
    )
    .toBe(255);
  await dialog(site).getByRole('button', { name: 'Use this crop' }).click();
  await received(site, 'square');
  const image = await selectedImage(site, '#square');
  expect([image.width, image.height]).toEqual([600, 600]);
});

test('the crop can be adjusted from the keyboard and the choice is what gets uploaded', async ({
  site,
}) => {
  const portrait = await makeImage(site, 'tall.jpg', {
    width: 600,
    height: 1800,
    type: 'image/jpeg',
  });
  await site.setInputFiles('#square', portrait);
  await expect(dialog(site)).toBeVisible();
  await expect(dialog(site).getByRole('button', { name: 'Use this crop' })).toBeFocused();
  const area = dialog(site).getByRole('group');
  await area.focus();
  for (let i = 0; i < 30; i++) await site.keyboard.press('Shift+ArrowUp');
  await site.keyboard.press('Enter');
  await received(site, 'square');
  const top = await site.evaluate(async () => {
    const file = document.querySelector<HTMLInputElement>('#square')!.files![0]!;
    const bitmap = await createImageBitmap(file);
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d')!;
    context.drawImage(bitmap, 0, 0);
    return Array.from(context.getImageData(300, 5, 1, 1).data);
  });
  // The generated gradient's red channel is ~98 at the very top of the image and ~140
  // where the default, centred crop would start, so this only passes if the crop moved.
  expect(top[0]!).toBeLessThan(115);
});

test('turning automatic fixing off in the popup makes Just Upload hands-off', async ({
  site,
  context,
  extensionId,
}) => {
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  const toggle = popup.getByRole('switch', { name: /Automatic fixing/ });
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await expect(popup.getByRole('status')).toHaveText('Off · uploads stay untouched');
  await site.bringToFront();
  await site.waitForTimeout(200);
  const heic = fixture('landscape-1600x1200.heic');
  await site.setInputFiles('#jpeg', heic);
  expect((await receiptsFor(site, 'jpeg'))[0]?.files[0]).toEqual({
    name: heic.name,
    type: 'image/heic',
    size: heic.buffer.length,
  });
});

test('the welcome page converts the sample HEIC on the device', async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/onboarding.html`);
  await expect(page.getByRole('heading', { name: 'Uploads that just work.' })).toBeVisible();
  await page.getByRole('button', { name: 'HEIC photo' }).click();
  const result = page.locator('.lab-result');
  await expect(result.locator('.lab-done')).toContainText('Ready to upload', { timeout: 20_000 });
  await expect(result).toContainText('HEIC');
  await expect(result.locator('.tag.after')).toContainText('JPG');
  // No size was stated, so the photo keeps every pixel.
  await expect(result).toContainText('Full size kept');
  await expect(result).toContainText(/\d+% kept/);
});

test('extension pages load their styles under the extension CSP, without errors', async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  for (const name of ['popup', 'options', 'onboarding']) {
    await page.goto(`chrome-extension://${extensionId}/${name}.html`);
    const background = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    // The white paper background of tokens.css, not the browser's default transparent body.
    expect(background, name).toBe('rgb(255, 255, 255)');
  }
  expect(errors).toEqual([]);
});

test('every screen follows the computer’s light or dark setting', async ({
  context,
  extensionId,
  site,
}) => {
  // White, forest and lime in light mode; near-black and lime in dark mode.
  const page = await context.newPage();
  await page.emulateMedia({ colorScheme: 'dark' });
  for (const name of ['popup', 'options', 'onboarding']) {
    await page.goto(`chrome-extension://${extensionId}/${name}.html`);
    const background = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(background, name).toBe('rgb(11, 13, 12)');
  }
  const noteBackground = async () => {
    await site.setInputFiles(
      '#jpeg',
      await makeImage(site, 'photo.webp', { width: 800, height: 600, type: 'image/webp' }),
    );
    const note = toast(site);
    await expect(note).toContainText('Ready to upload');
    return note.evaluate((element) => getComputedStyle(element).backgroundColor);
  };
  // Frosted glass: the theme's surface colour, slightly see-through.
  expect(await noteBackground()).toBe('rgba(255, 255, 255, 0.86)');
  await site.emulateMedia({ colorScheme: 'dark' });
  await site.reload();
  expect(await noteBackground()).toBe('rgba(20, 23, 22, 0.92)');
});

test('the note shows the prepared photo itself, with the check on its corner', async ({ site }) => {
  await site.setInputFiles(
    '#jpeg',
    await makeImage(site, 'photo.webp', { width: 800, height: 600, type: 'image/webp' }),
  );
  const photo = toast(site).locator('.ju-mark[data-photo] canvas.ju-photo');
  await expect(photo).toHaveCount(1);
  // Drawn square, at twice its size for sharp screens.
  expect(
    await photo.evaluate((canvas: HTMLCanvasElement) => [canvas.width, canvas.height]),
  ).toEqual([80, 80]);
});
