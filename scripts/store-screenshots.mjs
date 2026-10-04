/* global document, OffscreenCanvas -- the evaluate() callbacks run inside the browser page. */
// Captures the Chrome Web Store screenshots (1280 × 800) from the real extension, on a
// neutral demo page, and draws the small promo tile (440 × 280) the store requires. Also
// draws the README's images: the brand banner and the welcome page, light and dark.
// Run `pnpm build` first. Output: docs/store/ and docs/images/.
import { mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('..', import.meta.url));
const extension = `${root}.output/chrome-mv3`;
const out = `${root}docs/store/screenshots`;
const images = `${root}docs/images`;
const fixture = (name) => `${root}tests/fixtures/${name}`;

await mkdir(out, { recursive: true });
await mkdir(images, { recursive: true });
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
      background: '#eef0ed',
    });
    Object.assign(document.querySelector('.popup').style, {
      width: '340px',
      background: '#ffffff',
      borderRadius: '16px',
      boxShadow: '0 0 0 1px rgb(15 26 20 / 7%), 0 18px 48px -12px rgb(15 26 20 / 26%)',
      transform: 'scale(1.5)',
    });
  });
  await popup.waitForTimeout(300);
  await popup.screenshot({ path: `${out}/4-popup.png` });

  // 5. The welcome page: what it does, at a glance.
  const welcome = await context.newPage();
  await welcome.goto(`chrome-extension://${id}/onboarding.html`);
  // Let the first file on the hero get its "accepted" stamp.
  await welcome.waitForTimeout(3_200);
  await welcome.screenshot({ path: `${out}/5-welcome.png` });
  console.log(`Saved 5 screenshots to ${out}`);
  // For the README on GitHub's dark theme: the same page in dark mode.
  await welcome.emulateMedia({ colorScheme: 'dark' });
  await welcome.reload();
  await welcome.waitForTimeout(3_200);
  await welcome.screenshot({ path: `${images}/welcome-dark.png` });

  // The small promo tile: the logo, the name and the promise, nothing else, with the name
  // in the display face the extension's pages use.
  const logo = await readFile(`${root}public/logo.svg`, 'utf8');
  const serif = (await readFile(`${root}public/fonts/instrument-serif-latin.woff2`)).toString(
    'base64',
  );
  const tile = await context.newPage();
  await tile.setViewportSize({ width: 440, height: 280 });
  await tile.setContent(`<!doctype html>
    <style>@font-face{font-family:Serif;src:url(data:font/woff2;base64,${serif}) format('woff2')}</style>
    <body style="margin:0;height:280px;display:grid;place-items:center;background:#ffffff;
      font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f1a14">
      <div style="display:grid;justify-items:center;gap:12px;text-align:center">
        <div style="width:76px;height:76px">${logo.replace('<svg ', '<svg width="76" height="76" ')}</div>
        <div style="font:400 48px/1 Serif;letter-spacing:-0.02em">Just Upload</div>
        <div style="font-size:17px;color:#5c6660">Fix rejected uploads as you upload.</div>
      </div>
    </body>`);
  await tile.evaluate(() => document.fonts.ready);
  await tile.screenshot({ path: `${root}docs/store/promo-440x280.png` });
  console.log('Saved the promo tile to docs/store/promo-440x280.png');

  // The README's banner, in the colours of GitHub's light and dark themes, drawn at
  // twice its size so it stays sharp.
  const italic = (
    await readFile(`${root}public/fonts/instrument-serif-italic-latin.woff2`)
  ).toString('base64');
  const themes = {
    light: { paper: '#ffffff', ink: '#0f1a14', muted: '#5c6660', em: '#0e3a26', mark: '#a2ed76' },
    dark: {
      paper: '#0d1117',
      ink: '#f1f4f1',
      muted: '#979f9a',
      em: '#a2ed76',
      mark: 'transparent',
    },
  };
  const browser = await chromium.launch({ channel: 'chromium' });
  try {
    const banner = await browser.newPage({
      viewport: { width: 1280, height: 360 },
      deviceScaleFactor: 2,
    });
    for (const [theme, c] of Object.entries(themes)) {
      await banner.setContent(`<!doctype html>
        <style>
          @font-face{font-family:Serif;src:url(data:font/woff2;base64,${serif}) format('woff2')}
          @font-face{font-family:Serif;font-style:italic;src:url(data:font/woff2;base64,${italic}) format('woff2')}
          html,body{margin:0;height:100%;background:${c.paper}}
          body{display:grid;place-items:center;color:${c.ink};
            font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif}
          .lockup{display:flex;align-items:center;justify-content:center;gap:24px}
          .name{font:400 88px/1 Serif;letter-spacing:-0.02em}
          .line{margin:26px 0 0;font:400 42px/1 Serif;text-align:center}
          em{padding:0 .04em;color:${c.em};
            background:linear-gradient(transparent 64%,${c.mark} 64%,${c.mark} 90%,transparent 90%)}
          .facts{margin:28px 0 0;font-size:13px;font-weight:600;letter-spacing:.16em;
            text-transform:uppercase;text-align:center;color:${c.muted}}
        </style>
        <body><div>
          <div class="lockup">${logo.replace('<svg ', '<svg width="88" height="88" ')}<span class="name">Just Upload</span></div>
          <p class="line">Fix rejected uploads <em>as you upload.</em></p>
          <p class="facts">Private by design · Free · No account</p>
        </div></body>`);
      await banner.evaluate(() => document.fonts.ready);
      await banner.screenshot({ path: `${images}/banner-${theme}.png` });
    }
    console.log('Saved the README banner and welcome images to docs/images');
  } finally {
    await browser.close();
  }
} finally {
  await context.close();
  await server.close();
}
