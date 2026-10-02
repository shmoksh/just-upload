import type { RequirementSource, UploadRequirements } from '../models';
import { addEvidence, AUTOMATIC_CONFIDENCE, resolve, type NumericField } from './evidence';
import { formatFromExtension, formatFromMime, mimeOf } from '../formats';

/** Advice is not a rule. "Recommended 1200 × 630" must never force a resize. */
const ADVISORY =
  /\b(?:recommend(?:ed|s)?|suggest(?:ed|s)?|ideal(?:ly)?|prefer(?:red|ably)?|optimal|for best results|works best|e\.g\.|for example)\b/i;
/** The site describing its own processing is not a requirement for our input. */
const SITE_PROCESSES =
  /\b(?:we(?:'ll| will)?|automatically)\b.{0,24}\b(?:compress|resiz|convert|optimi[sz]|crop)/i;

const SIZE =
  /(\d{1,3}(?:,\d{3})+|\d+(?:[.,]\d+)?)\s*(KiB|MiB|GiB|KB|MB|GB|kilobytes?|megabytes?|gigabytes?)(?![a-z])/gi;
const UNIT = '(KiB|MiB|GiB|KB|MB|GB|kilobytes?|megabytes?|gigabytes?)';
/** "between 20 KB and 50 KB", "20-50 KB", "from 10 KB to 200 KB", "20 to 50 KB". */
const SIZE_RANGE = new RegExp(
  String.raw`(\bbetween\s+|\bfrom\s+)?(\d+(?:[.,]\d+)?)\s*${UNIT}?\s*(-|–|—|\bto\b|\band\b)\s*(\d+(?:[.,]\d+)?)\s*${UNIT}(?![a-z])`,
  'gi',
);
/** A total for the whole form is not a rule for one image. */
const TOTAL_BEFORE = /\b(?:total|combined|overall|altogether|all (?:files|images|photos))\b/i;

/** KB/MB are read as decimal: the stricter reading keeps files under either convention. */
const UNIT_BYTES: Record<string, number> = {
  kb: 1e3,
  mb: 1e6,
  gb: 1e9,
  kib: 1024,
  mib: 1024 ** 2,
  gib: 1024 ** 3,
  kilobyte: 1e3,
  megabyte: 1e6,
  gigabyte: 1e9,
};

/**
 * One ordered pattern, so "no more than" is read as a maximum before "more than"
 * can be read as a minimum. The last qualifier before a number wins.
 */
const QUALIFIER =
  /(?<min>\bno (?:smaller|less|fewer) than\b|\bnot (?:be )?(?:smaller|less) than\b|\bmin(?:imum)?\b\.?|\bat least\b|>=?|≥)|(?<max>\bno (?:more|larger|bigger|greater) than\b|\bnot (?:be )?(?:more|larger|bigger|greater) than\b|\b(?:not|never|cannot|can't|mustn't|shouldn't|don't|doesn't|won't) (?:to )?exceed(?:ing)?\b|\bnot over\b|\bmax(?:imum)?\b\.?|\bup ?to\b|\bless than\b|\bunder\b|\bbelow\b|\bat most\b|\bsmaller than\b|\blimit(?:ed to)?\b|\bwithin\b|<=?|≤)|(?<above>\bmore than\b|\bover\b|\b(?:larger|bigger|greater) than\b|\bexceed(?:s|ing)?\b)/gi;

const PIXELS = String.raw`(?:\s*(?:px|pixels?))?`;
const DIMENSION_PAIR = new RegExp(
  String.raw`(?<![\d.])(\d{2,5})${PIXELS}\s*(?:[x×✕*]|\bby\b)\s*(\d{2,5})${PIXELS}(?![\d])`,
  'gi',
);
const NAMED_DIMENSION =
  /\b(?:(min(?:imum)?|max(?:imum)?)\.?\s+)?(width|height)\b([^\d\n,;]{0,32}?)(\d{2,5})\s*(?:px|pixels?)?\b/gi;
const DIMENSION_RANGE =
  /(\bbetween\s+)?(\d{2,5})\s*(?:px|pixels?)?\s*(-|–|\band\b|\bto\b)\s*(\d{2,5})\s*(?:px|pixels?)?\s+(wide|in width|high|tall|in height)\b/gi;
const TRAILING_DIMENSION =
  /\b(\d{2,5})\s*(?:px|pixels?)?\s+(wide|in width|high|tall|in height)\b/gi;
const SIDE_DIMENSION =
  /\b(\d{2,5})\s*(?:px|pixels?)\s+(?:on|along|for)\s+(?:the\s+|each\s+|both\s+|all\s+)?(?:shortest|shorter|longest|longer|each|every|both|all)?\s*(?:sides?|edges?|dimensions?)\b/gi;
const BOUNDING_DIMENSION =
  /(\bmax(?:imum)?\b\.?|\bup ?to\b|\bat most\b|\bno (?:larger|bigger) than\b|\bmin(?:imum)?\b\.?|\bat least\b)\s*(\d{2,5})\s*(?:px|pixels?)\b(?!\s*(?:[x×✕*]|by\b|wide|high|tall))/gi;

const RATIO = /(?<![\d:.])(\d{1,2}(?:\.\d{1,2})?)\s*:\s*(\d{1,2}(?:\.\d{1,2})?)(?![\d:])/g;
const COMMON_RATIOS = new Set([
  '1:1',
  '4:3',
  '3:4',
  '3:2',
  '2:3',
  '16:9',
  '9:16',
  '4:5',
  '5:4',
  '2:1',
  '1:2',
  '21:9',
]);
const SQUARE =
  /\bsquare\s+(?:image|photo|picture|avatar|profile|logo|format|crop|shape|icon|thumbnail)|\b(?:image|photo|picture|avatar|logo|icon|it)\s+(?:must|should|has to|needs to)\s+be\s+(?:a\s+)?square\b|\bmust be square\b|^\s*square\b/i;
const NOT_SQUARE = /\b(?:not|n't|need not|no need to)\s+(?:need to\s+|have to\s+)?be\s+square\b/i;

// "JPG/PNG" is a list, but "photos/png-files/x" is a path: a slash only separates
// format names, never other words.
const FORMAT_TOKEN =
  /(?<![\w.-])(?:((?:image|application|text)\/[a-z0-9.+-]+)|\.?(jpe?g[ -]?xl|jpe?g|jfif|png|apng|webp|heic|heif|hif|gif|avif|svg|bmp|tiff?|ico|jxl|pdf|csv|xlsx?|excel)s?)(?![\w-])/gi;
const FORMAT_ALLOW_WORDS =
  /\b(?:only|accept(?:s|ed)?|allow(?:s|ed)?|support(?:s|ed)?|formats?|file types?|types?|must be|should be|upload an?|(?:saved?|upload(?:ed)?|sen[dt]|submit(?:ted)?|export(?:ed)?)(?:\s+\w+){0,3}\s+as|convert(?:ed)?\b.{0,30}\bto)\b/i;
const FORMAT_NEGATION_BEFORE = /\b(?:no|not|except|excluding|without)\s+(?:\w+\s+)?$/i;
const FORMAT_NEGATION_AFTER =
  /^\s*(?:files?\s+|images?\s+)?(?:(?:is|are)\s+)?(?:not|n't)\s+(?:supported|allowed|accepted)|^\s*(?:files?\s+|images?\s+)?(?:unsupported|not allowed|not accepted)/i;

/** Splits into clauses so one clause's qualifier never leaks into another's number. */
function clauses(text: string): string[] {
  return text
    .replace(/\u00a0/g, ' ')
    .replace(/[^\S\n]+/g, ' ')
    .slice(0, 2_000)
    .split(/[;\n|•·]|(?<!\b(?:max|min|approx|ca|incl|e\.g|i\.e))[.!?](?=\s+[A-Z(]|\s*$)/i)
    .map((clause) => clause.trim())
    .filter(Boolean);
}

type Kind = 'min' | 'max' | 'exact';

/**
 * The words right before a number, without those that belong to an earlier number:
 * in "(max 5MB, 1024x768 minimum)" the "max" is the 5 MB's, not the size's.
 */
function nearBefore(text: string): string {
  let cut = 0;
  for (const match of text.matchAll(/\d[^,;()]*[,;()]/g))
    cut = (match.index ?? 0) + match[0].length;
  return text.slice(cut);
}

/**
 * Whether a file size is a maximum or a minimum. A minimum needs words that say so
 * ("at least", "minimum"): "photos over 5 MB are compressed" is not one.
 */
function sizeQualifier(before: string, after: string): 'min' | 'max' | undefined {
  const last = [...before.matchAll(QUALIFIER)].at(-1);
  if (last?.groups?.max) return 'max';
  if (last?.groups?.min) return 'min';
  if (last) return undefined;
  if (/^\s*(?:max(?:imum)?\b|or (?:less|smaller|lower)\b|limit\b)/i.test(after)) return 'max';
  if (/^\s*(?:min(?:imum)?\b|or (?:more|larger|bigger|greater|higher)\b)/i.test(after))
    return 'min';
  return undefined;
}

/** The qualifier nearest to the number decides whether it is a minimum or a maximum. */
function qualifier(before: string, after: string): Kind | undefined {
  const last = [...before.matchAll(QUALIFIER)].at(-1);
  if (last) return last.groups?.max ? 'max' : 'min';
  if (/^\s*(?:px|pixels?)?\s*(?:max(?:imum)?\b|or (?:less|smaller|lower)\b|limit\b)/i.test(after))
    return 'max';
  if (
    /^\s*(?:px|pixels?)?\s*(?:min(?:imum)?\b|or (?:more|larger|bigger|greater|higher)\b)/i.test(
      after,
    )
  )
    return 'min';
  return undefined;
}

function parseNumber(value: string): number {
  return /^\d{1,3}(?:,\d{3})+$/.test(value)
    ? Number(value.replace(/,/g, ''))
    : Number(value.replace(',', '.'));
}

interface Span {
  start: number;
  end: number;
}
const overlaps = (spans: Span[], start: number, end: number) =>
  spans.some((span) => start < span.end && end > span.start);

const bytesOf = (value: string, unit: string) =>
  Math.floor(parseNumber(value) * UNIT_BYTES[unit.toLowerCase().replace(/s$/, '')]!);

function parseSizes(
  clause: string,
  add: (field: NumericField, value: number, factor?: number) => void,
): void {
  const ranges: Span[] = [];
  for (const match of clause.matchAll(SIZE_RANGE)) {
    const [, lead, low, lowUnit, separator, high, highUnit] = match;
    const start = match.index ?? 0;
    const end = start + match[0].length;
    // "and" joins a range only after "between": "1 and 2 MB" is not one.
    if (/and/i.test(separator!) && !/between/i.test(lead ?? '')) continue;
    const min = bytesOf(low!, lowUnit ?? highUnit!);
    const max = bytesOf(high!, highUnit!);
    if (!(min < max)) continue;
    if (TOTAL_BEFORE.test(clause.slice(Math.max(0, start - 60), start))) continue;
    ranges.push({ start, end });
    add('minBytes', min);
    add('maxBytes', max);
  }
  let previousEnd = 0;
  for (const match of clause.matchAll(SIZE)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    const before = nearBefore(clause.slice(Math.max(previousEnd, start - 60), start));
    const after = clause.slice(end, end + 30);
    previousEnd = end;
    if (overlaps(ranges, start, end)) continue;
    if (
      TOTAL_BEFORE.test(before) ||
      /^\s*(?:in\s+)?(?:total|combined|overall|altogether|per (?:form|submission|post|message))\b/i.test(
        after,
      )
    )
      continue;
    const rejectedAbove =
      /^\s*(?:will be|are|is|get)\s+(?:rejected|refused|not (?:accepted|allowed|supported))|^\s*(?:won't|will not|can't|cannot) be (?:uploaded|accepted)/i.test(
        after,
      );
    const kind = rejectedAbove ? 'max' : sizeQualifier(before, after);
    if (kind) add(kind === 'max' ? 'maxBytes' : 'minBytes', bytesOf(match[1]!, match[2]!));
  }
}

function addDimension(
  add: (field: NumericField, value: number, factor?: number) => void,
  kind: Kind,
  axis: 'Width' | 'Height' | 'both',
  value: number,
  factor = 1,
): void {
  if (axis !== 'Height') add(`${kind}Width`, value, factor);
  if (axis !== 'Width') add(`${kind}Height`, value, factor);
}

function parseDimensions(
  clause: string,
  add: (field: NumericField, value: number, factor?: number) => void,
): void {
  const used: Span[] = [];
  const context = (start: number, end: number) => ({
    before: nearBefore(
      clause.slice(
        Math.max(used.filter((span) => span.end <= start).at(-1)?.end ?? 0, start - 40),
        start,
      ),
    ),
    after: clause.slice(end, end + 25),
  });

  for (const match of clause.matchAll(DIMENSION_PAIR)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    const { before, after } = context(start, end);
    used.push({ start, end });
    const kind = qualifier(before, after) ?? 'exact';
    add(`${kind}Width`, Number(match[1]));
    add(`${kind}Height`, Number(match[2]));
  }

  for (const match of clause.matchAll(DIMENSION_RANGE)) {
    const [, lead, low, separator, high, axisWord] = match;
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (overlaps(used, start, end)) continue;
    if (/and/i.test(separator!) && !/between/i.test(lead ?? '')) continue;
    if (!(Number(low) < Number(high))) continue;
    used.push({ start, end });
    const axis = /wide|width/i.test(axisWord!) ? 'Width' : 'Height';
    addDimension(add, 'min', axis, Number(low));
    addDimension(add, 'max', axis, Number(high));
  }

  // "Width 200 px and height 230 px": named on their own, a width or height is often
  // guidance; named together, they are the size.
  const named: { axis: 'Width' | 'Height'; value: number }[] = [];
  for (const match of clause.matchAll(NAMED_DIMENSION)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (overlaps(used, start, end)) continue;
    used.push({ start, end });
    const axis = match[2]!.toLowerCase() === 'width' ? 'Width' : 'Height';
    const kind = match[1]
      ? /^min/i.test(match[1])
        ? 'min'
        : 'max'
      : qualifier(
          match[3] ?? '',
          clause.slice(start + match[0].length, start + match[0].length + 25),
        );
    if (kind) addDimension(add, kind, axis, Number(match[4]));
    else named.push({ axis, value: Number(match[4]) });
  }
  const both =
    named.some((item) => item.axis === 'Width') && named.some((item) => item.axis === 'Height');
  for (const item of named) addDimension(add, 'exact', item.axis, item.value, both ? 1 : 0.8);

  for (const match of clause.matchAll(TRAILING_DIMENSION)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (overlaps(used, start, end)) continue;
    const { before, after } = context(start, end);
    used.push({ start, end });
    const axis = /wide|width/i.test(match[2]!) ? 'Width' : 'Height';
    const kind = qualifier(before, after);
    if (kind) addDimension(add, kind, axis, Number(match[1]));
    else
      addDimension(add, 'exact', axis, Number(match[1]), /\bexactly\s*$/i.test(before) ? 1 : 0.8);
  }

  for (const match of clause.matchAll(SIDE_DIMENSION)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (overlaps(used, start, end)) continue;
    const { before, after } = context(start, end);
    used.push({ start, end });
    // "at least 1080px on the shortest side" is exactly "both sides at least 1080px".
    const kind = qualifier(before, after);
    if (kind === 'min' || kind === 'max') addDimension(add, kind, 'both', Number(match[1]));
  }

  for (const match of clause.matchAll(BOUNDING_DIMENSION)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (overlaps(used, start, end)) continue;
    used.push({ start, end });
    addDimension(add, /^m(?:in)|least/i.test(match[1]!) ? 'min' : 'max', 'both', Number(match[2]));
  }
}

function parseAspect(
  clause: string,
  add: (field: NumericField, value: number, factor?: number) => void,
): void {
  for (const match of clause.matchAll(RATIO)) {
    const start = match.index ?? 0;
    const width = Number(match[1]);
    const height = Number(match[2]);
    if (!width || !height || width / height < 0.2 || width / height > 5) continue;
    const near = clause.slice(Math.max(0, start - 30), start + match[0].length + 15);
    // Common ratios cannot be clock times (minutes always have two digits), so they need
    // no context. Anything else ("12:30") counts only when called a ratio.
    const common = COMMON_RATIOS.has(`${width}:${height}`);
    if (common || /\b(?:aspect|ratio)\b/i.test(near)) add('aspectRatio', width / height);
  }
  if (SQUARE.test(clause) && !NOT_SQUARE.test(clause)) add('aspectRatio', 1);
}

function parseFormats(
  clause: string,
  confidence: number,
  source: string,
  sources: RequirementSource[],
): void {
  const found = new Set<string>();
  /** A file extension written with its dot, or a MIME type, names the format outright. */
  let explicit = false;
  let tokens = 0;
  for (const match of clause.matchAll(FORMAT_TOKEN)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (FORMAT_NEGATION_BEFORE.test(clause.slice(Math.max(0, start - 24), start))) continue;
    if (FORMAT_NEGATION_AFTER.test(clause.slice(end, end + 36))) continue;
    const token = match[2]?.toLowerCase().replace(/^jpe?g[ -]?xl$/, 'jxl');
    // "Excel" names both workbook formats.
    const formats = match[1]
      ? [formatFromMime(match[1])]
      : token === 'excel'
        ? (['xlsx', 'xls'] as const)
        : [formatFromExtension(`.${token}`)];
    if (!formats.some(Boolean)) continue;
    for (const format of formats) if (format) found.add(mimeOf(format));
    tokens++;
    if (match[1] || match[0].startsWith('.')) explicit = true;
  }
  if (!found.size) return;
  // A lone mention ("WebP images welcome") is weaker than a list or an explicit rule. A
  // format listed among sizes, as in "(JPEG, max 240 KB, 600 × 600 pixels)", is a rule.
  const amongRules = /\d\s*(?:KB|MB|GB|KiB|MiB|px|pixels?)\b|\d{2,5}\s*[x×]\s*\d{2,5}/i.test(
    clause,
  );
  const listLike =
    found.size > 1 || tokens > 1 || explicit || amongRules || FORMAT_ALLOW_WORDS.test(clause);
  addEvidence(
    sources,
    'acceptedMimeTypes',
    [...found],
    source,
    listLike ? confidence : confidence * 0.7,
    clause,
  );
}

/**
 * Reads upload rules from human text such as "JPG or PNG · Maximum 2 MB" or
 * "Minimum 600×600 pixels". Each finding keeps its evidence and confidence.
 */
export function parseTextEvidence(
  text: string,
  source = 'text',
  confidence = 0.97,
): RequirementSource[] {
  const sources: RequirementSource[] = [];
  for (const clause of clauses(text)) {
    const clauseConfidence =
      ADVISORY.test(clause) || SITE_PROCESSES.test(clause) ? Math.min(confidence, 0.6) : confidence;
    const add = (field: NumericField, value: number, factor = 1) =>
      addEvidence(sources, field, value, source, clauseConfidence * factor, clause);
    parseSizes(clause, add);
    parseDimensions(clause, add);
    parseAspect(clause, add);
    parseFormats(clause, clauseConfidence, source, sources);
  }
  return sources;
}

/** Trusted formats from text evidence; the closest source wins, ties are merged. */
export function trustedFormats(sources: RequirementSource[]): string[] {
  const claims = sources.filter(
    (item) => item.field === 'acceptedMimeTypes' && item.confidence >= AUTOMATIC_CONFIDENCE,
  );
  if (!claims.length) return [];
  const best = Math.max(...claims.map((item) => item.confidence));
  return [
    ...new Set(
      claims.filter((item) => item.confidence === best).flatMap((item) => item.value as string[]),
    ),
  ];
}

export function parseText(text: string, source = 'text', confidence = 0.97): UploadRequirements {
  const sources = parseTextEvidence(text, source, confidence);
  const result = resolve(sources);
  result.acceptedMimeTypes = trustedFormats(sources);
  return result;
}
