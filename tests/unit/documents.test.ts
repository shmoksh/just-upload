import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  conversionTargets,
  formatAllowed,
  guessFormat,
  mightNeedWork,
} from '../../src/compatibility';
import { detectFile } from '../../src/documents/detect';
import { prepareSheet, transformSheet } from '../../src/documents/sheets';
import { parseAccept } from '../../src/requirements';

const bytes = (...parts: (string | number[])[]) =>
  Uint8Array.from(
    parts.flatMap((part) =>
      typeof part === 'string' ? Array.from(part, (c) => c.charCodeAt(0)) : part,
    ),
  );
const utf16 = (text: string) => Array.from(text).flatMap((c) => [c.charCodeAt(0), 0]);
const workbook = (name: string) =>
  new File([new Uint8Array(readFileSync(join(process.cwd(), 'tests/fixtures', name)))], name);

describe('recognising documents by their content', () => {
  it('knows a PDF, an XLSX workbook, an XLS workbook and a CSV file', () => {
    expect(detectFile(bytes('%PDF-1.7\n'), 'scan.bin')).toBe('pdf');
    // A little junk before the header is allowed.
    expect(detectFile(bytes('\r\n\r\n%PDF-1.4'), 'x')).toBe('pdf');
    expect(detectFile(bytes([0x50, 0x4b, 3, 4], '....xl/workbook.xml'), 'data')).toBe('xlsx');
    const ole = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
    expect(detectFile(bytes(ole, utf16('Workbook')), 'data')).toBe('xls');
    expect(detectFile(bytes('Name,Code\nZoë,00123\n'), 'people.csv')).toBe('csv');
    expect(detectFile(bytes('a,b\n'), 'export', 'text/csv')).toBe('csv');
  });
  it('does not mistake other files for documents', () => {
    // A Word document is a ZIP too, but has no "xl/" entries.
    expect(detectFile(bytes([0x50, 0x4b, 3, 4], '....word/document.xml'), 'cv.docx')).toBe(
      'unknown',
    );
    expect(detectFile(bytes([0, 1, 2, 0, 9]), 'data.csv')).toBe('unknown');
    expect(detectFile(bytes([0xff, 0xd8, 0xff, 0xe0]), 'photo.pdf')).toBe('jpeg');
  });
  it('takes a .csv name over the Excel type Windows gives CSV files', () => {
    expect(guessFormat({ name: 'export.csv', type: 'application/vnd.ms-excel' })).toBe('csv');
    expect(guessFormat({ name: 'book.xls', type: 'application/vnd.ms-excel' })).toBe('xls');
  });
});

describe('what a file can become on a field', () => {
  it('turns images into PDFs and PDFs into images, never spreadsheets into either', () => {
    const pdfOnly = parseAccept('application/pdf');
    expect(conversionTargets('heic', pdfOnly)).toEqual(['pdf']);
    expect(conversionTargets('pdf', parseAccept('image/jpeg,image/png'))).toEqual(['jpeg', 'png']);
    expect(conversionTargets('xlsx', pdfOnly)).toEqual([]);
    expect(conversionTargets('xlsx', parseAccept('.csv'))).toEqual(['csv']);
    expect(conversionTargets('csv', parseAccept('.xlsx,.xls'))).toEqual(['xlsx']);
    // An image stays an image where it can.
    expect(conversionTargets('heic', parseAccept('image/jpeg,application/pdf'))).toEqual([
      'jpeg',
      'pdf',
    ]);
  });
  it('reads "image/*" as images only, not PDFs', () => {
    expect(formatAllowed('pdf', parseAccept('image/*'))).toBe(false);
    expect(formatAllowed('heic', parseAccept('image/*'))).toBe(true);
    expect(formatAllowed('pdf', parseAccept('*/*'))).toBe(true);
  });
  it('leaves an accepted spreadsheet alone, and a PDF that fits', () => {
    const file = (name: string, size = 1000) => ({ name, type: '', size });
    expect(mightNeedWork(file('a.csv'), parseAccept('.csv'))).toBe(false);
    expect(mightNeedWork(file('a.xlsx'), parseAccept('.csv'))).toBe(true);
    const pdf = { ...parseAccept('.pdf'), maxBytes: 300_000 };
    expect(mightNeedWork(file('a.pdf', 200_000), pdf)).toBe(false);
    expect(mightNeedWork(file('a.pdf', 700_000), pdf)).toBe(true);
  });
});

describe('spreadsheets', () => {
  const csvText = 'Name,Code,Amount,Joined\r\nZoë,00123,1234.5,2024-01-31\r\nArjun,04567,99,\r\n';

  it('round-trips CSV through Excel, keeping codes, accents and numbers', async () => {
    const csv = new File([csvText], 'people.csv', { type: 'text/csv' });
    const workbook = await transformSheet(csv, 'csv', parseAccept('.xlsx'), {
      outputFormat: 'xlsx',
    });
    expect(workbook.file.name).toBe('people.xlsx');
    expect(workbook.changes).toEqual(['converted']);
    const back = await prepareSheet(workbook.file, 'xlsx', parseAccept('.csv'));
    expect(back.kind).toBe('fixed');
    if (back.kind !== 'fixed') return;
    expect(back.result.file.name).toBe('people.csv');
    expect(await back.result.file.text()).toBe(
      'Name,Code,Amount,Joined\nZoë,00123,1234.5,2024-01-31\nArjun,04567,99,',
    );
  });
  it('reads a CSV saved by older Excel on Windows (Windows-1252)', async () => {
    const latin = new File([Uint8Array.from([0x43, 0x61, 0x66, 0xe9, 0x0a, 0x31])], 'menu.csv');
    const result = await transformSheet(latin, 'csv', parseAccept('.xlsx'), {
      outputFormat: 'xlsx',
    });
    const back = await prepareSheet(result.file, 'xlsx', parseAccept('.csv'));
    expect(back.kind === 'fixed' && (await back.result.file.text())).toBe('Café\n1');
  });
  it('makes the CSV file from the sheet that was chosen', async () => {
    const file = workbook('two-sheets.xlsx');
    const csvOnly = parseAccept('.csv');
    const first = await transformSheet(file, 'xlsx', csvOnly, { outputFormat: 'csv' });
    expect(await first.file.text()).toBe('Name,Code,Amount\nZoë,00123,1234.5\nArjun,04567,99');
    const second = await transformSheet(file, 'xlsx', csvOnly, { outputFormat: 'csv', sheet: 1 });
    expect(await second.file.text()).toBe('Total,1333.5');
    expect(second.changes).toEqual(['converted', 'one-sheet']);
    await expect(
      transformSheet(file, 'xlsx', csvOnly, { outputFormat: 'csv', sheet: 2 }),
    ).rejects.toThrow('damaged');
  });
  it('uses formulas’ saved results, and refuses a sheet whose formulas have none', async () => {
    const saved = await prepareSheet(workbook('formulas-saved.xlsx'), 'xlsx', parseAccept('.csv'));
    expect(saved.kind === 'fixed' && (await saved.result.file.text())).toBe(
      'Item,Price,Qty,Total\nPen,2.5,4,10\nBook,12,2,24\nSum,,,34',
    );
    // Written by a script and never opened in a spreadsheet app: a CSV file would hold
    // empty cells, or the formulas' own text, where the totals should be.
    await expect(
      prepareSheet(workbook('formulas-unsaved.xlsx'), 'xlsx', parseAccept('.csv')),
    ).rejects.toThrow('uncalculated-formulas');
  });
  it('passes a spreadsheet the field already takes, and refuses a damaged workbook', async () => {
    const csv = new File([csvText], 'people.csv', { type: 'text/csv' });
    expect(await prepareSheet(csv, 'csv', parseAccept('.csv'))).toEqual({ kind: 'pass' });
    const broken = new File([Uint8Array.from([0x50, 0x4b, 3, 4, 1, 2, 3])], 'bad.xlsx');
    await expect(prepareSheet(broken, 'xlsx', parseAccept('.csv'))).rejects.toThrow('damaged');
  });
});
