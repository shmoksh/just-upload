import type { WorkBook, WorkSheet } from 'xlsx';
import type {
  SheetFormat,
  TransformChange,
  TransformOptions,
  TransformResult,
  UploadRequirements,
} from '../models';
import { conversionTargets, formatAllowed } from '../compatibility';
import { mimeOf } from '../formats';
import { outputFilename } from '../images/geometry';
import type { PrepareOutcome } from '../images/transform';
import { fail } from '../utils/errors';

// Spreadsheets: a CSV file where a site takes only CSV, an Excel workbook where it takes
// only Excel. SheetJS reads and writes them; it loads only when a spreadsheet needs work.

/** Workbooks are read whole, and a compressed one can unpack to many times its size. */
const MAX_SHEET_BYTES = 25 * 1024 * 1024;
/** Sheets offered to choose from; a workbook with more is rare. */
const MAX_LISTED_SHEETS = 50;

type SheetJs = typeof import('xlsx');
let library: Promise<SheetJs> | undefined;
const sheetjs = () => (library ??= import('xlsx'));

/** A number written plainly. "00123", "+44…" and long ID numbers stay as written. */
const PLAIN_NUMBER = /^-?(?:0|[1-9]\d{0,14})(?:\.\d+)?$/;

/** UTF-8 first, as sites expect; a CSV saved by older Excel on Windows is Windows-1252. */
function decodeText(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

async function readWorkbook(
  file: Blob,
  format: SheetFormat,
  output: 'csv' | 'xlsx',
): Promise<WorkBook> {
  if (file.size > MAX_SHEET_BYTES) fail('too-large-to-process');
  const XLSX = await sheetjs();
  try {
    if (format !== 'csv')
      // For a CSV file, cells without a value are kept: a formula that was never
      // calculated is one, and has to be noticed (see `uncalculated`).
      return XLSX.read(new Uint8Array(await file.arrayBuffer()), {
        type: 'array',
        sheetStubs: output === 'csv',
      });
    // Every cell is read as written; only plain numbers become numbers, so codes with
    // leading zeros and dates are not rewritten the way a spreadsheet app would.
    const workbook = XLSX.read(decodeText(new Uint8Array(await file.arrayBuffer())), {
      type: 'string',
      raw: true,
    });
    for (const name of workbook.SheetNames) {
      for (const [address, cell] of Object.entries(workbook.Sheets[name]!)) {
        if (address.startsWith('!') || cell.t !== 's' || !PLAIN_NUMBER.test(String(cell.v)))
          continue;
        cell.t = 'n';
        cell.v = Number(cell.v);
      }
    }
    return workbook;
  } catch {
    return fail('damaged');
  }
}

/** The first rows and columns of a sheet, drawn as a small table for the question. */
async function previewSheet(sheet: WorkSheet): Promise<Blob> {
  const XLSX = await sheetjs();
  const rows = XLSX.utils
    .sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, blankrows: false })
    .slice(0, 12);
  const columns = Math.min(5, Math.max(1, ...rows.map((row) => row.length)));
  const [cellWidth, cellHeight, pad] = [168, 34, 12];
  const canvas = new OffscreenCanvas(columns * cellWidth, Math.max(1, rows.length) * cellHeight);
  const context = canvas.getContext('2d');
  if (!context) return fail('failed');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = '#d7dfda';
  context.font = '15px system-ui, sans-serif';
  context.textBaseline = 'middle';
  rows.forEach((row, y) => {
    for (let x = 0; x < columns; x++) {
      context.strokeRect(x * cellWidth + 0.5, y * cellHeight + 0.5, cellWidth, cellHeight);
      let text = String(row[x] ?? '');
      while (text.length > 1 && context.measureText(text).width > cellWidth - 2 * pad)
        text = `${text.slice(0, -2)}…`;
      context.fillStyle = y === 0 ? '#26352c' : '#3c4b42';
      context.fillText(text, x * cellWidth + pad, y * cellHeight + cellHeight / 2);
    }
  });
  return canvas.convertToBlob({ type: 'image/png' });
}

/**
 * Whether a sheet has formulas with no saved result, as workbooks written by a script
 * often do. A CSV file holds values, not formulas, so such a cell would come out empty
 * or as the formula's own text.
 */
const uncalculated = (sheet: WorkSheet): boolean =>
  Object.entries(sheet).some(
    ([address, cell]) =>
      !address.startsWith('!') && cell.f !== undefined && (cell.t === 'z' || cell.v === undefined),
  );

async function convert(
  file: File,
  format: SheetFormat,
  workbook: WorkBook,
  output: 'csv' | 'xlsx',
  requirements: UploadRequirements,
  chosen = 0,
): Promise<TransformResult> {
  const XLSX = await sheetjs();
  const sheet = workbook.Sheets[workbook.SheetNames[chosen] ?? ''];
  if (!sheet) return fail('damaged');
  if (output === 'csv' && uncalculated(sheet)) fail('uncalculated-formulas');
  const data =
    output === 'csv'
      ? XLSX.utils.sheet_to_csv(sheet)
      : (XLSX.write(workbook, {
          type: 'array',
          bookType: 'xlsx',
          compression: true,
        }) as ArrayBuffer);
  const result = new File([data], outputFilename(file.name, output), {
    type: mimeOf(output),
    lastModified: file.lastModified,
  });
  if (requirements.maxBytes !== undefined && result.size > requirements.maxBytes)
    fail('target-unreachable');
  const changes: TransformChange[] = ['converted'];
  if (output === 'csv' && workbook.SheetNames.length > 1) changes.push('one-sheet');
  return {
    file: result,
    changes,
    originalSize: file.size,
    finalSize: result.size,
    originalWidth: 0,
    originalHeight: 0,
    finalWidth: 0,
    finalHeight: 0,
    originalFormat: format,
    finalFormat: output,
    qualityKept: 100,
    resizedToFit: false,
    sizeLimited: false,
  };
}

const sheetTarget = (format: SheetFormat, requirements: UploadRequirements) =>
  conversionTargets(format, requirements).find(
    (target): target is 'csv' | 'xlsx' => target === 'csv' || target === 'xlsx',
  );

/**
 * A spreadsheet in a format the site takes is left alone. Otherwise it becomes the one it
 * takes; a CSV file holds one sheet, so a workbook with several asks which.
 */
export async function prepareSheet(
  file: File,
  format: SheetFormat,
  requirements: UploadRequirements,
): Promise<PrepareOutcome> {
  if (formatAllowed(format, requirements)) return { kind: 'pass' };
  const output = sheetTarget(format, requirements);
  if (!output) return { kind: 'pass' };
  const workbook = await readWorkbook(file, format, output);
  if (output === 'csv' && workbook.SheetNames.length > 1) {
    const sheets = workbook.SheetNames.slice(0, MAX_LISTED_SHEETS);
    const previews: Blob[] = [];
    for (const name of sheets) previews.push(await previewSheet(workbook.Sheets[name]!));
    return {
      kind: 'confirm',
      decision: {
        action: 'USER_CONFIRMATION',
        issues: ['unsupported-format'],
        outputFormat: output,
        consents: ['sheet'],
      },
      info: {
        format,
        width: 0,
        height: 0,
        bytes: file.size,
        transparent: false,
        animated: false,
        sheets,
      },
      preview: previews[0]!,
      previews,
    };
  }
  return { kind: 'fixed', result: await convert(file, format, workbook, output, requirements) };
}

export async function transformSheet(
  file: File,
  format: SheetFormat,
  requirements: UploadRequirements,
  options: TransformOptions,
): Promise<TransformResult> {
  const output = options.outputFormat;
  if (output !== 'csv' && output !== 'xlsx') return fail('unsupported-format');
  return convert(
    file,
    format,
    await readWorkbook(file, format, output),
    output,
    requirements,
    options.sheet,
  );
}
