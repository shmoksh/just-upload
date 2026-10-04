import type { UploadRequirements } from '../models';
import { evaluateCompatibility, guessFormat, hasDimensionRules } from '../compatibility';
import { carriesDpi, isImage } from '../formats';
import { assertFileSize } from '../security/limits';
import { readDpi } from './dpi';
import { displaySize, parseHeader, SIZE_SETTLED_BY_DECODER } from './headers';

const HEAD_BYTES = 256 * 1024;
/** Beyond this, a file whose header needs more than its start is left to the processor. */
const MAX_WHOLE_READ = 16 * 1024 * 1024;

/**
 * Reads only the file's header, in the page, in about a millisecond: no decoding and no
 * messaging. A compatible file goes straight back to the site.
 */
export async function isCompatibleByHeader(
  file: Blob,
  requirements: UploadRequirements,
): Promise<boolean> {
  assertFileSize(file.size);
  // Only an image's header settles anything here; documents are checked by the processor.
  if (!isImage(guessFormat({ name: file instanceof File ? file.name : '', type: file.type })))
    return false;
  // The first 256 KB hold the format and size of almost every image; reading a 10 MB
  // file whole would cost tens of milliseconds, and a 5 GB one could crash the page.
  const head = new Uint8Array(await file.slice(0, HEAD_BYTES).arrayBuffer());
  const header =
    (file.size > HEAD_BYTES && parseHeader(head, { partial: true })) ||
    (file.size <= MAX_WHOLE_READ
      ? parseHeader(file.size > HEAD_BYTES ? new Uint8Array(await file.arrayBuffer()) : head)
      : undefined);
  if (!header) return false;
  // HEIF-family and JPEG XL rotate while decoding, and SVG has no fixed pixel size.
  if (SIZE_SETTLED_BY_DECODER.has(header.format) && hasDimensionRules(requirements)) return false;
  const { width, height } = displaySize(header);
  const dpi =
    requirements.dpi && carriesDpi(header.format) ? readDpi(head, header.format) : undefined;
  return (
    evaluateCompatibility(
      { format: header.format, width, height, bytes: file.size, dpi },
      requirements,
    ).length === 0
  );
}
