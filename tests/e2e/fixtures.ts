import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test as base, chromium, expect, type BrowserContext, type Page } from '@playwright/test';

const extensionPath = fileURLToPath(new URL('../../.output/chrome-mv3', import.meta.url));

export interface Receipt {
  field: string;
  via: string;
  files: { name: string; type: string; size: number }[];
}

export interface ImageOptions {
  width: number;
  height: number;
  type: 'image/jpeg' | 'image/png' | 'image/webp';
  quality?: number;
  /**
   * "photo" has heavy grain, so encoded files are large and squeezing them shows;
   * "texture" has the light grain of a typical phone photo.
   */
  detail?: 'smooth' | 'texture' | 'photo';
  transparent?: boolean;
}

export interface Upload {
  name: string;
  mimeType: string;
  buffer: Buffer;
}

export const test = base.extend<{ context: BrowserContext; extensionId: string; site: Page }>({
  // eslint-disable-next-line no-empty-pattern
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    });
    await use(context);
    await context.close();
  },
  extensionId: async ({ context }, use) => {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    await use(new URL(worker.url()).host);
  },
  site: async ({ context, extensionId }, use) => {
    expect(extensionId).toBeTruthy();
    const page = await context.newPage();
    await page.goto('/');
    await use(page);
  },
});
export { expect };

export function fixture(name: string, mimeType = 'image/heic', rename = name): Upload {
  return {
    name: rename,
    mimeType,
    buffer: readFileSync(fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url))),
  };
}

/** Draws a deterministic image in the page and returns it as an upload. */
export async function makeImage(page: Page, name: string, options: ImageOptions): Promise<Upload> {
  const base64 = await page.evaluate(async (o) => {
    const canvas = new OffscreenCanvas(o.width, o.height);
    const c = canvas.getContext('2d')!;
    let seed = 7;
    const random = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
    const gradient = c.createLinearGradient(0, 0, o.width, o.height);
    gradient.addColorStop(0, '#5b8fd1');
    gradient.addColorStop(1, '#e8c38e');
    c.fillStyle = gradient;
    c.fillRect(0, 0, o.width, o.height);
    c.fillStyle = '#2f5a3c';
    c.beginPath();
    c.ellipse(o.width / 2, o.height / 2, o.width / 4, o.height / 5, 0, 0, Math.PI * 2);
    c.fill();
    if (o.detail === 'photo' || o.detail === 'texture') {
      const amount = o.detail === 'photo' ? 60 : 8;
      const image = c.getImageData(0, 0, o.width, o.height);
      for (let i = 0; i < image.data.length; i += 4) {
        const grain = (random() - 0.5) * amount;
        image.data[i]! += grain;
        image.data[i + 1]! += grain;
        image.data[i + 2]! += grain;
      }
      c.putImageData(image, 0, 0);
    }
    if (o.transparent) c.clearRect(0, 0, o.width / 3, o.height);
    const blob = await canvas.convertToBlob({ type: o.type, quality: o.quality ?? 0.92 });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return btoa(binary);
  }, options);
  return { name, mimeType: options.type, buffer: Buffer.from(base64, 'base64') };
}

export function receipts(page: Page): Promise<Receipt[]> {
  return page.evaluate(() => window.receipts);
}

export async function receiptsFor(page: Page, field: string, via = 'change'): Promise<Receipt[]> {
  return (await receipts(page)).filter((receipt) => receipt.field === field && receipt.via === via);
}

/** Waits until the page's own handler for `field` has run, then returns what it saw. */
export async function received(page: Page, field: string, via = 'change'): Promise<Receipt> {
  await expect
    .poll(async () => (await receiptsFor(page, field, via)).length, { timeout: 30_000 })
    .toBeGreaterThan(0);
  return (await receiptsFor(page, field, via))[0]!;
}

/** Reads the dimensions and leading bytes of the file currently held by an input. */
export function selectedImage(page: Page, selector: string, index = 0) {
  return page.evaluate(
    async ({ selector, index }) => {
      const file = document.querySelector<HTMLInputElement>(selector)!.files![index]!;
      const head = Array.from(new Uint8Array(await file.slice(0, 4).arrayBuffer()));
      let width = 0;
      let height = 0;
      try {
        const bitmap = await createImageBitmap(file);
        width = bitmap.width;
        height = bitmap.height;
        bitmap.close();
      } catch {
        // Not decodable by the browser (for example HEIC); dimensions stay 0.
      }
      return { name: file.name, type: file.type, size: file.size, width, height, head };
    },
    { selector, index },
  );
}

/** A file in tests/fixtures, as an absolute path on disk. */
export function fixturePath(name: string): string {
  return fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));
}

/**
 * Drops files from disk onto an element through Chrome's own input pipeline, exactly as
 * dragging from Finder or Explorer does (trusted events, real file data).
 */
export async function dropFiles(page: Page, selector: string, paths: string[]): Promise<void> {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error(`${selector} is not visible`);
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  const cdp = await page.context().newCDPSession(page);
  const data = { items: [], files: paths, dragOperationsMask: 1 };
  for (const type of ['dragEnter', 'dragOver', 'drop'] as const) {
    await cdp.send('Input.dispatchDragEvent', { type, x, y, data });
  }
  await cdp.detach();
}

export const JPEG_MAGIC = [0xff, 0xd8, 0xff];

/** Changes Just Upload's settings, as a person would on its settings page. */
export async function setSettings(
  context: BrowserContext,
  extensionId: string,
  values: Record<string, unknown>,
): Promise<void> {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  await page.evaluate(async (patch) => {
    const { storage } = (
      globalThis as unknown as {
        chrome: {
          storage: {
            local: {
              get(key: string): Promise<Record<string, object | undefined>>;
              set(items: object): Promise<void>;
            };
          };
        };
      }
    ).chrome;
    const stored = (await storage.local.get('settings')).settings ?? {};
    await storage.local.set({ settings: { ...stored, ...patch } });
  }, values);
  await page.close();
}

/** Approves the question about quality, returning the share of quality it said is kept. */
export async function approveQuality(page: Page): Promise<number> {
  const button = dialog(page).getByRole('button', { name: /^Upload at \d+%$/ });
  await expect(button).toBeVisible({ timeout: 30_000 });
  const kept = Number(/\d+/.exec((await button.textContent()) ?? '')?.[0]);
  await button.click();
  return kept;
}

/** The injected UI lives in a shadow root; Playwright's CSS locators pierce open roots. */
export function toast(page: Page) {
  return page.locator('just-upload-ui .ju-toast');
}
export function dialog(page: Page) {
  return page.locator('just-upload-ui dialog');
}
