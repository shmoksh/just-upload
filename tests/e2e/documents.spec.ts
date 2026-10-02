import { inflateRawSync } from 'node:zlib';
import type { Page } from '@playwright/test';
import { dialog, expect, fixture, received, selectedImage, test, toast } from './fixtures';

// PDFs and spreadsheets, checked with readers independent of the code that wrote them:
// PDF.js (in Node) for PDFs, and a small ZIP reader here for Excel workbooks.

/** The bytes of the file an input now holds. */
async function chosenBytes(page: Page, selector: string): Promise<Buffer> {
  const bytes = await page.evaluate(async (target) => {
    const file = document.querySelector<HTMLInputElement>(target)!.files![0]!;
    return Array.from(new Uint8Array(await file.arrayBuffer()));
  }, selector);
  return Buffer.from(bytes);
}

/** Page count and first-page size of a PDF, read by PDF.js. */
async function readPdf(bytes: Buffer): Promise<{ pages: number; width: number }> {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = getDocument({ data: new Uint8Array(bytes), verbosity: 0 });
  const pdf = await task.promise;
  const page = await pdf.getPage(1);
  const result = { pages: pdf.numPages, width: page.getViewport({ scale: 1 }).width };
  await task.destroy();
  return result;
}

/** One entry of a ZIP archive (an XLSX workbook is one), inflated. */
function zipEntry(zip: Buffer, name: string): string {
  let offset = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const entries = zip.readUInt16LE(offset + 10);
  offset = zip.readUInt32LE(offset + 16);
  for (let i = 0; i < entries; i++) {
    const nameLength = zip.readUInt16LE(offset + 28);
    const extra = zip.readUInt16LE(offset + 30) + zip.readUInt16LE(offset + 32);
    const entryName = zip.toString('utf8', offset + 46, offset + 46 + nameLength);
    if (entryName === name) {
      const local = zip.readUInt32LE(offset + 42);
      const size = zip.readUInt32LE(offset + 20);
      const method = zip.readUInt16LE(offset + 10);
      const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
      const data = zip.subarray(start, start + size);
      return (method === 8 ? inflateRawSync(data) : data).toString('utf8');
    }
    offset += 46 + nameLength + extra;
  }
  throw new Error(`${name} not in archive`);
}

/** Accepts the question about quality, if the size limit made the PDF ask one. */
async function acceptIfAsked(page: Page): Promise<void> {
  const question = dialog(page);
  await question.waitFor({ timeout: 4_000 }).catch(() => {});
  if (await question.count())
    await question.getByRole('button', { name: /Upload at|Make it smaller/ }).click();
}

/** The pixel size of each picture in a PDF, read by PDF.js. */
async function pictureSizes(bytes: Buffer): Promise<number[][]> {
  const { getDocument, OPS } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = getDocument({ data: new Uint8Array(bytes), verbosity: 0 });
  const pdf = await task.promise;
  const page = await pdf.getPage(1);
  const list = await page.getOperatorList();
  const sizes: number[][] = [];
  for (const [index, op] of list.fnArray.entries()) {
    if (op !== OPS.paintImageXObject) continue;
    const name = list.argsArray[index]![0] as string;
    const image = await new Promise<{ width: number; height: number }>((resolve) =>
      page.objs.get(name, resolve),
    );
    sizes.push([image.width, image.height]);
  }
  await task.destroy();
  return sizes;
}

test.describe('PDFs', () => {
  test('a photo becomes a one-page PDF where a site takes only PDF, full size and under its limit', async ({
    site,
  }) => {
    await site.setInputFiles(
      '#certificate',
      fixture('landscape-1600x1200.heic', 'image/heic', 'scan.heic'),
    );
    // This grainy photo fits 300 KB only at a visibly lower quality, so it asks first.
    await expect(dialog(site)).toContainText('Some quality would be lost');
    await dialog(site)
      .getByRole('button', { name: /Upload at/ })
      .click();
    const receipt = await received(site, 'certificate');
    // The note shows for a few seconds: check it before the slower reading of the PDF.
    await expect(toast(site)).toContainText('HEIC → PDF');
    expect(receipt.files[0]).toMatchObject({ name: 'scan.pdf', type: 'application/pdf' });
    expect(receipt.files[0]!.size).toBeLessThanOrEqual(300_000);
    const pdf = await readPdf(await chosenBytes(site, '#certificate'));
    expect(pdf.pages).toBe(1);
    // A wide picture gets a landscape A4 page.
    expect(Math.round(pdf.width)).toBe(842);
  });

  test('a PDF that is over the limit is made smaller and stays a PDF', async ({ site }) => {
    const original = fixture('scan-a4.pdf', 'application/pdf');
    expect(original.buffer.length).toBeGreaterThan(300_000);
    await site.setInputFiles('#certificate', original);
    await acceptIfAsked(site);
    const receipt = await received(site, 'certificate');
    expect(receipt.files[0]).toMatchObject({ name: 'scan-a4.pdf', type: 'application/pdf' });
    expect(receipt.files[0]!.size).toBeLessThanOrEqual(300_000);
    expect((await readPdf(await chosenBytes(site, '#certificate'))).pages).toBe(1);
  });

  test('a scan no quality can fit asks first, then gives its pictures only as few pixels as fit', async ({
    site,
  }) => {
    const original = fixture('scan-a4.pdf', 'application/pdf');
    const before = await pictureSizes(original.buffer);
    await site.setInputFiles('#marksheet', original);
    await expect(dialog(site)).toContainText('This PDF can’t fit 100 KB at full size');
    await expect(dialog(site)).toContainText('Its text and layout stay the same');
    await dialog(site).getByRole('button', { name: 'Make it smaller' }).click();
    const receipt = await received(site, 'marksheet');
    expect(receipt.files[0]).toMatchObject({ name: 'scan-a4.pdf', type: 'application/pdf' });
    expect(receipt.files[0]!.size).toBeLessThanOrEqual(100_000);
    const bytes = await chosenBytes(site, '#marksheet');
    // The page is the same page; only its picture has fewer pixels, in the same shape.
    const [after, page] = [await readPdf(bytes), await readPdf(original.buffer)];
    expect(after).toEqual(page);
    const [[width, height]] = (await pictureSizes(bytes)) as [[number, number]];
    const [[fullWidth, fullHeight]] = before as [[number, number]];
    expect(width).toBeLessThan(fullWidth);
    expect(width).toBeGreaterThanOrEqual(fullWidth * 0.3);
    expect(width / height).toBeCloseTo(fullWidth / fullHeight, 2);
  });

  test('a PDF that fits a PDF field is left exactly as it is', async ({ site }) => {
    const original = fixture('certificate.pdf', 'application/pdf');
    await site.setInputFiles('#certificate', original);
    const receipt = await received(site, 'certificate');
    expect(receipt.files[0]).toEqual({
      name: 'certificate.pdf',
      type: 'application/pdf',
      size: original.buffer.length,
    });
  });

  test('a one-page PDF becomes a JPG where a site takes only images', async ({ site }) => {
    await site.setInputFiles('#scan', fixture('certificate.pdf', 'application/pdf'));
    const receipt = await received(site, 'scan');
    expect(receipt.files[0]).toMatchObject({ name: 'certificate.jpg', type: 'image/jpeg' });
    const image = await selectedImage(site, '#scan');
    // An A4 page drawn at 200 pixels to the inch.
    expect([image.width, image.height]).toEqual([1652, 2338]);
    await expect(toast(site)).toContainText('PDF → JPG');
  });

  test('for a PDF with several pages, it asks before using only the first', async ({ site }) => {
    await site.setInputFiles('#scan', fixture('three-pages.pdf', 'application/pdf'));
    await expect(dialog(site)).toContainText('3 pages');
    await dialog(site).getByRole('button', { name: 'Use the first page' }).click();
    const receipt = await received(site, 'scan');
    expect(receipt.files[0]).toMatchObject({ name: 'three-pages.jpg', type: 'image/jpeg' });
  });
});

test.describe('spreadsheets', () => {
  test('an Excel workbook becomes a CSV file, after asking which sheet when it has several', async ({
    site,
  }) => {
    await site.setInputFiles(
      '#csv',
      fixture(
        'two-sheets.xlsx',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ),
    );
    await expect(dialog(site)).toContainText('“People”');
    await dialog(site).getByRole('button', { name: 'Use the first sheet' }).click();
    const receipt = await received(site, 'csv');
    expect(receipt.files[0]).toMatchObject({ name: 'two-sheets.csv', type: 'text/csv' });
    // Codes keep their leading zeros; names keep their accents.
    expect((await chosenBytes(site, '#csv')).toString('utf8')).toBe(
      'Name,Code,Amount\nZoë,00123,1234.5\nArjun,04567,99',
    );
  });

  test('a CSV file becomes an Excel workbook, keeping codes as text and numbers as numbers', async ({
    site,
  }) => {
    await site.setInputFiles('#xlsx', fixture('people.csv', 'text/csv'));
    const receipt = await received(site, 'xlsx');
    expect(receipt.files[0]).toMatchObject({
      name: 'people.xlsx',
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const sheet = zipEntry(await chosenBytes(site, '#xlsx'), 'xl/worksheets/sheet1.xml');
    // Text cells keep their exact text; plain numbers are stored as numbers.
    expect(sheet).toMatch(/<c r="B2"[^>]*t="(?:str|s|inlineStr)"[^>]*>.*?00123/);
    expect(sheet).toContain('Zoë');
    expect(sheet).toMatch(/<c r="C2"(?![^>]*t="s)[^>]*><v>1234\.5<\/v>/);
  });

  test('a spreadsheet in a format the site takes is left alone', async ({ site }) => {
    const original = fixture('people.csv', 'text/csv');
    await site.setInputFiles('#csv', original);
    const receipt = await received(site, 'csv');
    expect(receipt.files[0]).toEqual({
      name: 'people.csv',
      type: 'text/csv',
      size: original.buffer.length,
    });
  });
});
