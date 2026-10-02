import type { RequirementSource, UploadRequirements } from '../models';
import { isSpecificFormatList, parseAccept } from './accept';
import { addEvidence, resolve } from './evidence';
import { parseTextEvidence, trustedFormats } from './text';

/** Help text is short. A long block is page content, not this field's rules. */
const MAX_TEXT = 1_500;
/** Confidence falls with distance; pure wrapper elements do not count as distance. */
const ANCESTOR_CONFIDENCE = [0.93, 0.9, 0.86, 0.72] as const;
const MAX_ANCESTOR_STEPS = 8;
const STOP_AT = 'body, html, form, main, [role="main"], dialog, [role="dialog"]';
const SKIPPED = new Set([
  'SCRIPT',
  'STYLE',
  'TEMPLATE',
  'NOSCRIPT',
  'SVG',
  'CANVAS',
  'VIDEO',
  'AUDIO',
  'IFRAME',
  'SELECT',
]);
const SIZE_ATTRIBUTES = [
  'data-max-size',
  'data-max-file-size',
  'data-maxsize',
  'data-max-filesize',
];

/** Visible-ish text of a small subtree, or undefined when it is too long to be help text. */
function textOf(element: Element): string | undefined {
  const walker = element.ownerDocument.createTreeWalker(
    element,
    NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
    {
      acceptNode: (node) =>
        node.nodeType === Node.ELEMENT_NODE &&
        (SKIPPED.has((node as Element).tagName.toUpperCase()) ||
          (node as Element).getAttribute('aria-hidden') === 'true')
          ? NodeFilter.FILTER_REJECT
          : NodeFilter.FILTER_ACCEPT,
    },
  );
  const parts: string[] = [];
  let length = 0;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeType !== Node.TEXT_NODE) continue;
    const text = node.textContent?.trim();
    if (!text) continue;
    length += text.length + 1;
    if (length > MAX_TEXT) return undefined;
    parts.push(text);
  }
  return parts.join('\n');
}

function parentOf(element: Element): Element | null {
  if (element.parentElement) return element.parentElement;
  const root = element.getRootNode();
  return root instanceof ShadowRoot ? root.host : null;
}

function otherFileInputs(element: Element, input: HTMLInputElement): number {
  let count = 0;
  for (const candidate of element.querySelectorAll('input[type="file" i]'))
    if (candidate !== input) count++;
  return count;
}

/** ids resolve within the field's own tree: the document, or its shadow root. */
function elementById(input: HTMLInputElement, id: string): Element | null {
  const root = input.getRootNode() as Partial<Pick<Document, 'getElementById'>>;
  return typeof root.getElementById === 'function' ? root.getElementById(id) : null;
}

/** An element that only wraps a single child adds no information and no distance. */
function isWrapper(element: Element): boolean {
  if (element.children.length > 1) return false;
  return !Array.from(element.childNodes).some(
    (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim(),
  );
}

/**
 * Collects this field's rules from its own attributes and nearby, related text.
 * Scope always starts at the field; the page is never scanned as a whole.
 */
export function detectRequirements(input: HTMLInputElement): UploadRequirements {
  const accept = parseAccept(input.getAttribute('accept') ?? '');
  const sources: RequirementSource[] = [...accept.sources];
  const seen = new Set<Element>();
  const fromText = (text: string, source: string, confidence: number) =>
    sources.push(...parseTextEvidence(text, source, confidence));
  const fromElement = (element: Element | null, source: string, confidence: number): boolean => {
    if (!element || seen.has(element)) return true;
    seen.add(element);
    if (otherFileInputs(element, input)) return false;
    const text = textOf(element);
    if (text === undefined) return false;
    if (text) fromText(text, source, confidence);
    return true;
  };

  for (const id of (input.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean)) {
    fromElement(elementById(input, id), 'aria-describedby', 0.97);
  }
  for (const id of (input.getAttribute('aria-labelledby') ?? '').split(/\s+/).filter(Boolean)) {
    fromElement(elementById(input, id), 'aria-labelledby', 0.95);
  }
  const ariaLabel = input.getAttribute('aria-label');
  if (ariaLabel) fromText(ariaLabel, 'aria-label', 0.95);
  if (input.title) fromText(input.title, 'title', 0.9);
  for (const label of Array.from(input.labels ?? [])) fromElement(label, 'label', 0.95);

  for (const attribute of SIZE_ATTRIBUTES) {
    const value = input.getAttribute(attribute)?.trim();
    if (!value) continue;
    if (/^\d+$/.test(value)) {
      // A bare number is only plausible as bytes when it is large.
      if (Number(value) >= 1024)
        addEvidence(sources, 'maxBytes', Number(value), attribute, 0.88, value);
    } else fromText(`max ${value}`, attribute, 0.9);
  }

  let element = parentOf(input);
  let top: Element = input;
  let depth = 0;
  let formWithOnlyThisField = false;
  for (
    let steps = 0;
    element && steps < MAX_ANCESTOR_STEPS && depth < ANCESTOR_CONFIDENCE.length;
    steps++
  ) {
    if (element.matches(STOP_AT)) {
      formWithOnlyThisField = element.matches('form') && otherFileInputs(element, input) === 0;
      break;
    }
    if (!isWrapper(element)) {
      if (!fromElement(element, depth === 0 ? 'parent' : 'ancestor', ANCESTOR_CONFIDENCE[depth]!))
        break;
      depth++;
    }
    top = element;
    element = parentOf(element);
  }
  // Form-level help text beside the widget, when no other upload in the form could own it.
  // Headings are titles, not rules; outside a form, neighbours are just page content.
  if (formWithOnlyThisField) {
    for (const sibling of [top.previousElementSibling, top.nextElementSibling]) {
      if (sibling?.matches('p, small, span, div, label, ul, li')) {
        const text = textOf(sibling);
        if (text && text.length <= 300) fromText(text, 'sibling', 0.86);
      }
    }
  }

  const result = resolve(sources, accept);
  if (!isSpecificFormatList(accept)) {
    const fromWords = trustedFormats(sources.filter((item) => item.source !== 'accept'));
    if (fromWords.length) result.acceptedMimeTypes = fromWords;
  }
  return result;
}
