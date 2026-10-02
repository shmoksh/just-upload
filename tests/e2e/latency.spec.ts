import type { Page } from '@playwright/test';
import { expect, fixture, makeImage, setSettings, test, type Upload } from './fixtures';

/**
 * Measures how long a page waits for its own change handler after a file is chosen,
 * with Just Upload on and off. The difference is the delay Just Upload adds. Questions
 * about quality are switched off: these measure the work, not a person deciding.
 */
const NO_QUESTIONS = { askBeforeQualityChanges: false };

interface Scenario {
  name: string;
  field: string;
  file: (page: Page) => Promise<Upload>;
  /** Budget for the added delay, in ms (fastest run with vs without). */
  budget: number;
  runs: number;
}

/** Milliseconds from asking the browser to select the file to the page's change handler. */
async function timeSelection(page: Page, field: string, upload: Upload): Promise<number> {
  const before = await page.evaluate(() => window.receipts.length);
  const start = Date.now();
  await page.setInputFiles(`#${field}`, upload);
  const handled = await page.waitForFunction(
    ({ field, before }) => {
      for (let i = before; i < window.receipts.length; i++) {
        const receipt = window.receipts[i]!;
        if (receipt.field === field && receipt.via === 'change') return window.receiptTimes[i];
      }
      return undefined;
    },
    { field, before },
    { timeout: 30_000, polling: 5 },
  );
  return (await handled.jsonValue())! - start;
}

/** Shared CI machines are slower than a laptop; budgets there get headroom. */
const SLACK = process.env.CI ? 3 : 1;

/** The fastest run: noise only ever adds time, so this isolates the fixed cost. */
const fastest = (values: number[]) => Math.min(...values);

const scenarios: Scenario[] = [
  {
    name: 'Compatible JPG on a "JPG/PNG, max 2 MB" field',
    field: 'profile',
    file: (page) => makeImage(page, 'ok.jpg', { width: 1200, height: 900, type: 'image/jpeg' }),
    budget: 5,
    runs: 7,
  },
  {
    name: 'Compatible JPG on a field with size rules (header check)',
    field: 'maximum',
    file: (page) => makeImage(page, 'ok.jpg', { width: 1200, height: 900, type: 'image/jpeg' }),
    budget: 15,
    runs: 7,
  },
  {
    name: 'Compatible 10 MB PNG on a field with size rules (header check)',
    field: 'maximum',
    file: (page) =>
      makeImage(page, 'big.png', { width: 1900, height: 1400, type: 'image/png', detail: 'photo' }),
    budget: 10,
    runs: 9,
  },
  {
    name: 'WebP 800 × 600 → JPG',
    field: 'jpg-png',
    file: (page) => makeImage(page, 'photo.webp', { width: 800, height: 600, type: 'image/webp' }),
    budget: 60,
    runs: 5,
  },
  {
    name: 'HEIC 1600 × 1200 → JPG',
    field: 'jpeg',
    file: async () => fixture('landscape-1600x1200.heic'),
    budget: 250,
    runs: 5,
  },
  {
    name: 'HEIC 3024 × 4032, 3 MB → JPG under 2 MB',
    field: 'profile',
    file: async () => fixture('portrait-3024x4032.heic'),
    budget: 1_300,
    runs: 3,
  },
];

test('first photo after the browser starts, without warm-up', async ({ context, extensionId }) => {
  test.setTimeout(120_000);
  expect(extensionId).toBeTruthy();
  await setSettings(context, extensionId, NO_QUESTIONS);
  const heic = fixture('portrait-3024x4032.heic');

  // Without warm-up: a file set by script, with no click on the picker first.
  const cold = await context.newPage();
  await cold.goto('/');
  const coldMs = await timeSelection(cold, 'profile', heic);
  await cold.close();

  console.log(`\nLATENCY first photo (12 MP HEIC → JPG under 2 MB), no warm-up: ${coldMs} ms\n`);
  expect(coldMs).toBeLessThanOrEqual(3_000 * SLACK);
});

test('warm-up while the picker is open makes the first photo as fast as later ones', async ({
  site,
  context,
  extensionId,
}) => {
  test.setTimeout(120_000);
  await setSettings(context, extensionId, NO_QUESTIONS);
  const heic = fixture('portrait-3024x4032.heic');
  const [chooser] = await Promise.all([site.waitForEvent('filechooser'), site.click('#profile')]);
  // A person takes at least a second or two to find a photo.
  await site.waitForTimeout(1_500);
  const start = Date.now();
  await chooser.setFiles(heic);
  const handled = await site.waitForFunction(
    () => {
      const index = window.receipts.findIndex((r) => r.field === 'profile' && r.via === 'change');
      return index >= 0 ? window.receiptTimes[index] : undefined;
    },
    undefined,
    { timeout: 30_000, polling: 5 },
  );
  const warmMs = (await handled.jsonValue())! - start;
  const later = await timeSelection(site, 'profile', heic);
  console.log(
    `\nLATENCY first photo after opening the picker: ${warmMs} ms; the next photo: ${later} ms\n`,
  );
  expect(warmMs).toBeLessThanOrEqual(1_500 * SLACK);
});

test('added delay stays within budget', async ({ site, context, extensionId }) => {
  test.setTimeout(240_000);
  await setSettings(context, extensionId, NO_QUESTIONS);
  const report: string[] = [];
  const uploads = new Map<string, Upload>();
  for (const scenario of scenarios) uploads.set(scenario.name, await scenario.file(site));

  // One conversion first, so every scenario below measures a warm extension.
  await timeSelection(site, 'jpeg', fixture('landscape-1600x1200.heic'));

  const results: { scenario: Scenario; on: number; off: number }[] = [];
  for (const scenario of scenarios) {
    const upload = uploads.get(scenario.name)!;
    const on: number[] = [];
    for (let i = 0; i < scenario.runs; i++)
      on.push(await timeSelection(site, scenario.field, upload));
    results.push({ scenario, on: fastest(on), off: 0 });
  }
  await setSettings(context, extensionId, { enabled: false });
  await site.waitForTimeout(100);
  for (const result of results) {
    const upload = uploads.get(result.scenario.name)!;
    const off: number[] = [];
    for (let i = 0; i < result.scenario.runs; i++)
      off.push(await timeSelection(site, result.scenario.field, upload));
    result.off = fastest(off);
  }
  for (const { scenario, on, off } of results) {
    report.push(
      `${scenario.name}: ${on} ms with Just Upload, ${off} ms without → adds ${on - off} ms (budget ${scenario.budget} ms)`,
    );
  }
  console.log(`\nLATENCY\n${report.join('\n')}\n`);
  for (const { scenario, on, off } of results) {
    expect.soft(on - off, scenario.name).toBeLessThanOrEqual(scenario.budget * SLACK);
  }
});
