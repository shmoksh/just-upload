/* global document, OffscreenCanvas -- the evaluate() callbacks run inside the browser page. */
// Captures the Chrome Web Store screenshots (1280 × 800) from the real extension, on a
// neutral demo page, and draws the small promo tile (440 × 280) the store requires.
// Run `pnpm build` first. Output: docs/store/.
import { mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('..', import.meta.url));
const extension = `${root}.output/chrome-mv3`;
const out = `${root}docs/store/screenshots`;
const fixture = (name) => `${root}tests/fixtures/${name}`;

await mkdir(out, { recursive: true });
const server = await createServer({
  configFile: `${root}test-site/vite.config.ts`,
  logLevel: 'silent',
});
await server.listen();
const context = await chromium.launchPersistentContext('', {
  channel: 'chromium',
  viewport: { width: 1280, height: 800 },
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
});
try {
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const id = new URL(worker.url()).host;
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:4173/demo.html');
  const shadow = (selector) => page.locator(`just-upload-ui ${selector}`);

  // 1. A photo saved from the web as WebP, 2.2 MB, on a "JPG or PNG · Maximum 2 MB" field.
  const webp = await page.evaluate(async () => {
    const [width, height] = [4032, 3024];
    const canvas = new OffscreenCanvas(width, height);
    const c = canvas.getContext('2d');
    let seed = 11;
    const random = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
    const sky = c.createLinearGradient(0, 0, 0, height);
    sky.addColorStop(0, '#6f9fd8');
    sky.addColorStop(0.5, '#f3d6a8');
    sky.addColorStop(1, '#3e5a3a');
    c.fillStyle = sky;
    c.fillRect(0, 0, width, height);
    for (let i = 0; i < (width * height) / 3500; i++) {
      c.fillStyle = `hsla(${80 + random() * 70}, ${30 + random() * 40}%, ${18 + random() * 40}%, 0.85)`;
      c.beginPath();
      c.ellipse(
        random() * width,
        height * 0.42 + random() * height * 0.58,
        3 + random() * width * 0.012,
        2 + random() * width * 0.006,
        random() * Math.PI,
        0,
        7,
      );
      c.fill();
    }
    const image = c.getImageData(0, 0, width, height);
    for (let i = 0; i < image.data.length; i += 4) {
      const noise = (random() - 0.5) * 8;
      image.data[i] += noise;
      image.data[i + 1] += noise;
      image.data[i + 2] += noise;
    }
    c.putImageData(image, 0, 0);
    const blob = await canvas.convertToBlob({ type: 'image/webp', quality: 0.92 });
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });
  await page.setInputFiles('#photo', {
    name: 'vacation.webp',
    mimeType: 'image/webp',
    buffer: Buffer.from(webp),
  });
  // Right at the 97% line, a machine may first ask about quality: take the copy it offers.
  for (let i = 0; i < 80 && !(await shadow('.ju-toast[data-kind="success"]').count()); i++) {
    const ask = shadow('dialog[open]');
    if (await ask.count()) await ask.getByRole('button', { name: /Upload at/ }).click();
    await page.waitForTimeout(250);
  }
  await shadow('.ju-toast[data-kind="success"]').waitFor({ timeout: 20_000 });
  // Let the note settle: the photo appears and its check finishes drawing.
  await shadow('.ju-mark[data-photo]').waitFor({ timeout: 10_000 });
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${out}/1-ready-to-upload.png` });

  // 2. A portrait photo on a square field.
  await page.setInputFiles('#square', fixture('portrait-3024x4032.heic'));
  await shadow('dialog').waitFor({ timeout: 20_000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${out}/2-square-crop.png` });
  await shadow('dialog').getByRole('button', { name: 'Use this crop' }).click();
  await shadow('.ju-toast[data-kind="success"]').waitFor({ timeout: 20_000 });
  // Let that note fade, so the next screenshot shows one thing at a time.
  await shadow('.ju-toast').waitFor({ state: 'detached', timeout: 20_000 });

  // 3. A transparent logo on a JPG-only field.
  await page.setInputFiles('#logo', fixture('logo.svg'));
  await shadow('dialog').waitFor({ timeout: 20_000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${out}/3-transparent-logo.png` });
  await shadow('dialog').getByRole('button', { name: 'Convert & upload' }).click();
  await page.waitForTimeout(1_000);

  // 4. The popup, shown on a neutral backdrop.
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${id}/popup.html`);
  await popup.evaluate(() => {
    // CSSOM, since extension pages allow no inline style elements.
    Object.assign(document.body.style, {
      width: 'auto',
      display: 'grid',
      placeItems: 'center',
      minHeight: '100vh',
      background: '#e8f1eb',
    });
    Object.assign(document.querySelector('.popup').style, {
      width: '340px',
      background: '#ffffff',
      borderRadius: '16px',
      boxShadow: '0 0 0 1px rgb(24 52 36 / 7%), 0 18px 48px -12px rgb(24 52 36 / 26%)',
      transform: 'scale(1.5)',
    });
  });
  await popup.waitForTimeout(300);
  await popup.screenshot({ path: `${out}/4-popup.png` });

  // 5. The welcome page: what it does, at a glance.
  const welcome = await context.newPage();
  await welcome.goto(`chrome-extension://${id}/onboarding.html`);
  // Let the opening animation of the receipt card finish.
  await welcome.waitForTimeout(3_000);
  await welcome.screenshot({ path: `${out}/5-welcome.png` });
  console.log(`Saved 5 screenshots to ${out}`);

  // The small promo tile: the logo, the name and the promise, nothing else.
  const logo = await readFile(`${root}public/logo.svg`, 'utf8');
  const tile = await context.newPage();
  await tile.setViewportSize({ width: 440, height: 280 });
  await tile.setContent(`<!doctype html>
    <body style="margin:0;height:280px;display:grid;place-items:center;background:#ffffff;
      font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#26352c">
      <div style="display:grid;justify-items:center;gap:14px;text-align:center">
        <div style="width:84px;height:84px">${logo.replace('<svg ', '<svg width="84" height="84" ')}</div>
        <div style="font-size:34px;font-weight:700;letter-spacing:-0.02em">Just Upload</div>
        <div style="font-size:17px;color:#5d6b62">Upload any image. We make it work.</div>
      </div>
    </body>`);
  await tile.screenshot({ path: `${root}docs/store/promo-440x280.png` });
  console.log('Saved the promo tile to docs/store/promo-440x280.png');
} finally {
  await context.close();
  await server.close();
}
