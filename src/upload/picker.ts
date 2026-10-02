import { conversionTargets, formatAllowed } from '../compatibility';
import { FORMATS, KNOWN_FORMATS } from '../formats';
import { isSpecificFormatList, parseAccept } from '../requirements';

/**
 * A field that accepts only "image/jpeg,image/png" makes the file picker grey out
 * HEIC photos, so they could never be converted. This returns the same list plus the
 * formats Just Upload can turn into an accepted one (images and PDFs for an image field,
 * images for a PDF field, the other spreadsheet format for a CSV or Excel field), or
 * undefined when nothing would change (no list, or a wildcard such as image/*).
 */
export function widenedAccept(accept: string): string | undefined {
  const rules = parseAccept(accept);
  if (!isSpecificFormatList(rules) || rules.acceptedMimeTypes.some((mime) => mime.endsWith('/*')))
    return undefined;
  const additions = KNOWN_FORMATS.filter(
    (format) => !formatAllowed(format, rules) && conversionTargets(format, rules).length > 0,
  ).flatMap((format) => [...FORMATS[format].extensions, FORMATS[format].mimeTypes[0]!]);
  return additions.length ? [accept.trim(), ...additions].join(',') : undefined;
}
