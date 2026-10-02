import type { UploadRequirements } from '../models';
import { evaluateCompatibility, hasDimensionRules } from '../compatibility';
import { assertFileSize } from '../security/limits';
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
  // The first 256 KB hold the format and size of almost every image; reading a 10 MB
  // file whole would cost tens of milliseconds, and a 5 GB one could crash the page.
  const header =
    (file.size > HEAD_BYTES &&
      parseHeader(new Uint8Array(await file.slice(0, HEAD_BYTES).arrayBuffer()), {
        partial: true,
      })) ||
    (file.size <= MAX_WHOLE_READ
      ? parseHeader(new Uint8Array(await file.arrayBuffer()))
      : undefined);
  if (!header) return false;
  // HEIF-family and JPEG XL rotate while decoding, and SVG has no fixed pixel size.
  if (SIZE_SETTLED_BY_DECODER.has(header.format) && hasDimensionRules(requirements)) return false;
  const { width, height } = displaySize(header);
  return (
    evaluateCompatibility({ format: header.format, width, height, bytes: file.size }, requirements)
      .length === 0
  );
}
