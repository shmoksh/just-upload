import type { FileFormat } from '../models';
import { formatFromExtension, formatFromMime } from '../formats';
import { detectFormat } from '../images/headers';

/** Bytes worth reading to recognise a file: enough for a workbook's first entry names. */
export const DETECT_BYTES = 64 * 1024;

const OLE2 = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

const latin1 = (bytes: Uint8Array) => new TextDecoder('latin1').decode(bytes);

/** A name stored in a Word or Excel 97–2003 file's directory, as UTF-16. */
function hasUtf16(bytes: Uint8Array, text: string): boolean {
  const pattern = Array.from(text).flatMap((c) => [c.charCodeAt(0), 0]);
  outer: for (let i = 0; i + pattern.length <= bytes.length; i++) {
    for (let j = 0; j < pattern.length; j++) if (bytes[i + j] !== pattern[j]) continue outer;
    return true;
  }
  return false;
}

/** Text has no NUL bytes; a binary file nearly always does in its first kilobytes. */
const looksLikeText = (bytes: Uint8Array) => !bytes.subarray(0, 8192).includes(0);

/**
 * What a file really is, from its first bytes: an image, a PDF, or a workbook. A CSV file
 * has no signature, so it is known by its name or type, and by being text.
 */
export function detectFile(head: Uint8Array, name: string, type = ''): FileFormat {
  const image = detectFormat(head);
  if (image !== 'unknown') return image;
  // A PDF may start with a little junk before its header.
  if (latin1(head.subarray(0, 1024)).includes('%PDF-')) return 'pdf';
  const extension = /\.[^.]+$/.exec(name)?.[0] ?? '';
  const byName = formatFromExtension(extension);
  // An XLSX file is a ZIP archive whose entries live under "xl/".
  if (head[0] === 0x50 && head[1] === 0x4b && head[2] === 3 && head[3] === 4)
    return latin1(head).includes('xl/') || byName === 'xlsx' ? 'xlsx' : 'unknown';
  if (OLE2.every((value, i) => head[i] === value))
    return hasUtf16(head, 'Workbook') || hasUtf16(head, 'Book') || byName === 'xls'
      ? 'xls'
      : 'unknown';
  if ((byName === 'csv' || formatFromMime(type) === 'csv') && looksLikeText(head)) return 'csv';
  return 'unknown';
}
