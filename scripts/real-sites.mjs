/* global document, window, OffscreenCanvas, HTMLInputElement -- some code runs in pages. */
// A release check on real public websites: chooses images in their upload fields with the
// built extension and reports what each site's own code received. Every request that
// could carry a file (anything but GET, HEAD and OPTIONS) is refused, so nothing is ever
// uploaded. Third-party pages change, so this is run by hand before a release, not in CI.
// `pnpm real-sites` builds first. Exits with 1 if a site received the wrong file.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = fileURLToPath(new URL('..', import.meta.url));
const extension = `${root}.output/chrome-mv3`;
const MDN = 'https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/input/file';

const heic = {
  name: 'IMG_0001.HEIC',
  mimeType: 'image/heic',
  buffer: readFileSync(`${root}tests/fixtures/portrait-3024x4032.heic`),
};

const unchanged = (sent) => (got) =>
  got.length === sent.length &&
  got.every((file, i) => file.name === sent[i].name && file.size === sent[i].buffer.length);
const jpegs = (count) => (got) =>
  got.length === count && got.every((file) => file.type === 'image/jpeg');

/** `files` names images made below; `check` gets what the site's change handler saw. */
const cases = [
  {
    site: 'MDN',
    rule: 'PNG or JPEG only',
    url: MDN,
    frame: /mdnplay\.dev/,
    field: '#avatar',
    files: ['heic'],
    expect: 'HEIC becomes JPG',
    check: jpegs(1),
  },
  {
    site: 'MDN',
    rule: 'PNG or JPEG only',
    url: MDN,
    frame: /mdnplay\.dev/,
    field: '#avatar',
    files: ['webp'],
    expect: 'WebP becomes JPG or PNG',
    check: (got) => got.length === 1 && ['image/jpeg', 'image/png'].includes(got[0].type),
  },
  {
    site: 'MDN',
    rule: 'PNG or JPEG only',
    url: MDN,
    frame: /mdnplay\.dev/,
    field: '#avatar',
    files: ['small'],
    expect: 'a JPG goes through untouched',
    check: (got, sent) => unchanged(sent)(got),
  },
  {
    site: 'MDN',
    rule: '.jpg, .jpeg, .png, several files',
    url: MDN,
    frame: /mdnplay\.dev/,
    field: '#image_uploads',
    files: ['heic', 'small'],
    expect: 'HEIC becomes JPG, the JPG is untouched, order kept',
    check: (got, sent) =>
      jpegs(2)(got) && got[0].name === 'IMG_0001.jpg' && unchanged(sent.slice(1))(got.slice(1)),
  },
  {
    site: 'TinyPNG',
    rule: '“max 5 MB each”',
    url: 'https://tinypng.com/',
    field: 'input[type=file]',
    files: ['big'],
    expect: 'made smaller than 5 MB',
    check: (got) => jpegs(1)(got) && got[0].size < 5_000_000,
  },
  {
    site: 'TinyPNG',
    rule: 'takes HEIC',
    url: 'https://tinypng.com/',
    field: 'input[type=file]',
    files: ['heic'],
    expect: 'untouched',
    check: (got, sent) => unchanged(sent)(got),
  },
  {
    site: 'FilePond',
    rule: 'PNG, JPEG or GIF; describes its own 200 × 200 crop',
    url: 'https://pqina.nl/filepond/',
    field: 'input[accept="image/png,image/jpeg,image/gif"]',
    files: ['heic'],
    expect: 'HEIC becomes JPG, without asking to crop',
    check: jpegs(1),
    noQuestion: true,
  },
  {
    site: 'imgbb',
    rule: 'any image, “32 MB limit”',
    url: 'https://imgbb.com/',
    field: '#anywhere-upload-input',
    files: ['big'],
    expect: 'untouched',
    check: (got, sent) => unchanged(sent)(got),
  },
  {
    site: 'jQuery File Upload',
    rule: 'none stated near the field',
    url: 'https://blueimp.github.io/jQuery-File-Upload/',
    field: 'input[type=file]',
    files: ['heic'],
    expect: 'untouched',
    check: (got, sent) => unchanged(sent)(got),
  },
  {
    site: 'Uppy',
    rule: 'none',
    url: 'https://uppy.io/examples/',
    field: 'input[type=file]',
    files: ['heic'],
    expect: 'untouched',
    check: (got, sent) => unchanged(sent)(got),
  },
  {
    site: 'Dropzone',
    rule: 'none',
    url: 'https://www.dropzone.dev/',
    field: 'input[type=file]',
    files: ['heic'],
    expect: 'untouched',
    check: (got, sent) => unchanged(sent)(got),
  },
];

const context = await chromium.launchPersistentContext('', {
  channel: 'chromium',
  viewport: { width: 1280, height: 900 },
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
});
await context.route('**/*', (route) =>
  ['GET', 'HEAD', 'OPTIONS'].includes(route.request().method()) ? route.continue() : route.abort(),
);
// Records what the page's own change handlers see, after Just Upload has done its work.
await context.addInitScript(() => {
  document.addEventListener(
    'change',
    ({ target }) => {
      if (target instanceof HTMLInputElement && target.type === 'file')
        (window.__received ??= []).push(
          [...(target.files ?? [])].map(({ name, type, size }) => ({ name, type, size })),
        );
    },
    true,
  );
});
if (!context.serviceWorkers().length) await context.waitForEvent('serviceworker');

// Photo-like images drawn in the browser: a small JPG, the same as WebP, and a
// 6000 × 4500 JPG at full quality, far over 5 MB.
const files = { heic };
{
  const page = await context.newPage();
  const made = await page.evaluate(async () => {
    const photo = async (width, height, type, quality) => {
      const canvas = new OffscreenCanvas(width, height);
      const c = canvas.getContext('2d');
      let seed = 7;
      const random = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
      const sky = c.createLinearGradient(0, 0, 0, height);
      sky.addColorStop(0, '#6f9fd8');
      sky.addColorStop(0.55, '#f3d6a8');
      sky.addColorStop(1, '#3e5a3a');
      c.fillStyle = sky;
      c.fillRect(0, 0, width, height);
      for (let i = 0; i < (width * height) / 4000; i++) {
        c.fillStyle = `hsla(${90 + random() * 60}, ${30 + random() * 40}%, ${18 + random() * 35}%, 0.8)`;
        c.beginPath();
        c.ellipse(
          random() * width,
          height * 0.45 + random() * height * 0.55,
          4 + random() * width * 0.01,
          2 + random() * width * 0.005,
          random() * Math.PI,
          0,
          Math.PI * 2,
        );
        c.fill();
      }
      const pixels = c.getImageData(0, 0, width, height);
      for (let i = 0; i < pixels.data.length; i += 4) {
        const grain = (random() - 0.5) * 14;
        pixels.data[i] += grain;
        pixels.data[i + 1] += grain;
        pixels.data[i + 2] += grain;
      }
      c.putImageData(pixels, 0, 0);
      const blob = await canvas.convertToBlob({ type, quality });
      return [...new Uint8Array(await blob.arrayBuffer())];
    };
    return {
      small: await photo(800, 600, 'image/jpeg', 0.85),
      webp: await photo(800, 600, 'image/webp', 0.85),
      big: await photo(6000, 4500, 'image/jpeg', 1),
    };
  });
  files.small = { name: 'photo.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(made.small) };
  files.webp = { name: 'photo.webp', mimeType: 'image/webp', buffer: Buffer.from(made.webp) };
  files.big = { name: 'big-photo.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(made.big) };
  await page.close();
}

const megabytes = (bytes) => `${(bytes / 1e6).toFixed(2)} MB`;
const describe = (list) =>
  list
    .map((file) => `${file.name} (${file.type || 'no type'}, ${megabytes(file.size)})`)
    .join(', ');

let failed = 0;
let unreachable = 0;
for (const item of cases) {
  const sent = item.files.map((key) => files[key]);
  const page = await context.newPage();
  const label = `${item.site} · ${item.rule} · ${describe(sent.map((f) => ({ name: f.name, type: f.mimeType, size: f.buffer.length })))}`;
  try {
    await page.goto(item.url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  } catch {
    unreachable++;
    console.log(`?  ${label}\n   site did not load\n`);
    await page.close();
    continue;
  }
  await page.waitForTimeout(3_000);
  let frame = page.mainFrame();
  for (const candidate of page.frames()) {
    if (item.frame && !item.frame.test(candidate.url())) continue;
    if (
      await candidate
        .locator(item.field)
        .count()
        .catch(() => 0)
    ) {
      frame = candidate;
      break;
    }
  }
  const lines = [];
  let pass = false;
  try {
    await frame.locator(item.field).first().setInputFiles(sent, { timeout: 10_000 });
    const started = Date.now();
    let got;
    let question = '';
    while (Date.now() - started < 60_000) {
      got = (await frame.evaluate(() => window.__received?.at(-1)).catch(() => undefined)) ?? got;
      if (got) break;
      // A question from Just Upload: note it and say yes, as a person would.
      const confirm = frame.locator('just-upload-ui dialog[open] .ju-button.primary');
      if (!question && (await confirm.count())) {
        question = (await frame.locator('just-upload-ui dialog[open] h2').innerText()).trim();
        await confirm.click();
      }
      await page.waitForTimeout(150);
    }
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    await page.waitForTimeout(500);
    const toast = (
      await frame
        .locator('just-upload-ui .ju-toast')
        .innerText()
        .catch(() => '')
    )
      .replace(/\s+/g, ' ')
      .trim();
    pass = Boolean(got) && item.check(got, sent) && !(item.noQuestion && question);
    lines.push(`expected: ${item.expect}`);
    lines.push(`received: ${got ? describe(got) : 'nothing'} in ${seconds} s`);
    if (question) lines.push(`asked: “${question}”`);
    if (toast) lines.push(`note: “${toast}”`);
  } catch (error) {
    lines.push(`could not choose the file: ${String(error).split('\n')[0]}`);
  }
  if (!pass) failed++;
  console.log(`${pass ? '✓' : '✗'}  ${label}\n${lines.map((line) => `   ${line}`).join('\n')}\n`);
  await page.close();
}
await context.close();

console.log(
  `${cases.length - failed - unreachable} passed, ${failed} failed, ${unreachable} unreachable.`,
);
process.exit(failed ? 1 : 0);
