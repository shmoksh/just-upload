import type { RequirementField, RequirementSource, UploadRequirements } from '../models';

/** Evidence at or above this confidence may drive automatic changes. */
export const AUTOMATIC_CONFIDENCE = 0.85;

export const NUMERIC_FIELDS = [
  'maxBytes',
  'minBytes',
  'minWidth',
  'minHeight',
  'maxWidth',
  'maxHeight',
  'exactWidth',
  'exactHeight',
  'aspectRatio',
  'printWidth',
  'printHeight',
  'dpi',
] as const;
export type NumericField = (typeof NUMERIC_FIELDS)[number];

export function emptyRequirements(): UploadRequirements {
  return { acceptedMimeTypes: [], acceptedExtensions: [], confidence: 0, sources: [] };
}

export function addEvidence(
  sources: RequirementSource[],
  field: RequirementField,
  value: RequirementSource['value'],
  source: string,
  confidence: number,
  evidence: string,
): void {
  if (typeof value === 'number' && (!Number.isFinite(value) || value <= 0)) return;
  sources.push({ field, value, source, confidence, evidence: evidence.slice(0, 300) });
}

/**
 * Turns raw evidence into requirements. Only trusted evidence becomes a requirement;
 * weaker evidence stays in `sources` for transparency but never changes a file.
 *
 * When trusted sources disagree, the closest (most confident) one wins, because a
 * field's own hint ("max 2 MB") is more specific than a form-wide note ("10 MB total
 * per form"). If equally close sources disagree, the field is dropped: fail open.
 */
export function resolve(
  sources: RequirementSource[],
  base?: UploadRequirements,
): UploadRequirements {
  const result = base ?? emptyRequirements();
  result.sources = sources;
  const trusted = sources.filter((item) => item.confidence >= AUTOMATIC_CONFIDENCE);
  for (const field of NUMERIC_FIELDS) {
    const claims = trusted.filter((item) => item.field === field);
    if (!claims.length) continue;
    const best = Math.max(...claims.map((item) => item.confidence));
    const values = new Set(
      claims.filter((item) => item.confidence === best).map((item) => item.value),
    );
    if (values.size === 1) result[field] = [...values][0] as number;
  }
  derivePrintSize(result);
  result.confidence = trusted.reduce((max, item) => Math.max(max, item.confidence), 0);
  return result;
}

/**
 * A printed size ("3.5 cm × 4.5 cm") is a shape; with a DPI it is also a pixel size
 * (3.5 × 4.5 cm at 200 DPI is 276 × 354). A pixel size the site states itself always
 * wins: forms often give both, and they rarely agree exactly.
 */
function derivePrintSize(result: UploadRequirements): void {
  const { printWidth, printHeight, dpi } = result;
  if (!printWidth || !printHeight || result.exactWidth || result.exactHeight) return;
  if (dpi) {
    result.exactWidth = Math.round((printWidth / 25.4) * dpi);
    result.exactHeight = Math.round((printHeight / 25.4) * dpi);
    result.aspectRatio = result.exactWidth / result.exactHeight;
  } else result.aspectRatio ??= printWidth / printHeight;
}
