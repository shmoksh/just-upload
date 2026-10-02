import css from './styles.css?inline';

type Child = Node | string | null | undefined | false;

/**
 * Builds elements without innerHTML. Strings always become text nodes, so nothing
 * derived from a page or a file name can ever be parsed as markup.
 */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: Record<string, string | boolean | undefined> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (value === undefined || value === false) continue;
    element.setAttribute(name, value === true ? '' : value);
  }
  for (const child of children) if (child) element.append(child);
  return element;
}

const ICONS = {
  check: 'M4 12.5 9.5 18 20 6.5',
  alert: 'M12 7v6m0 4h.01',
  close: 'M6 6l12 12M18 6 6 18',
  lock: 'M7 11V8a5 5 0 0 1 10 0v3M6 11h12v9H6z',
} as const;

export function icon(name: keyof typeof ICONS): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', ICONS[name]);
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', name === 'lock' ? '1.8' : '2.4');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  svg.append(path);
  return svg;
}

const SVG = 'http://www.w3.org/2000/svg';

export function svgElement(name: string, attributes: Record<string, string>): SVGElement {
  const element = document.createElementNS(SVG, name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  return element;
}

/** A file's format and size, or its pixel size, as a small tag: "HEIC 3.1 MB". */
export function tag(name: string, size?: string, after = false): HTMLElement {
  return h(
    'span',
    { class: after ? 'ju-tag ju-tag-after' : 'ju-tag' },
    h('b', {}, name),
    size && h('span', {}, size),
  );
}

export function arrow(): Node {
  const drawing = svgElement('svg', {
    class: 'ju-arrow',
    viewBox: '0 0 16 10',
    fill: 'none',
    'aria-hidden': 'true',
  });
  drawing.append(svgElement('path', { d: 'M1 5h13M10 1.5 14 5l-4 3.5' }));
  return drawing;
}

/** Just Upload's mark, for the dialog's header: so a person knows who is asking. */
export function logo(): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 128 128');
  svg.setAttribute('aria-hidden', 'true');
  const parts: [string, Record<string, string>][] = [
    ['rect', { width: '128', height: '128', rx: '30', fill: '#a2ed76' }],
    [
      'path',
      {
        d: 'M56 96V32M32 55l24-24 24 24',
        fill: 'none',
        stroke: '#0e3a26',
        'stroke-width': '13',
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
      },
    ],
    ['circle', { cx: '92', cy: '92', r: '22', fill: '#0e3a26' }],
    [
      'path',
      {
        d: 'm82 92 7 7 13-14',
        fill: 'none',
        stroke: '#a2ed76',
        'stroke-width': '7',
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
      },
    ],
  ];
  for (const [name, attributes] of parts) {
    const element = document.createElementNS(ns, name);
    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
    svg.append(element);
  }
  return svg;
}

let sheet: CSSStyleSheet | undefined;

/**
 * Constructed stylesheets are not subject to a page's style-src CSP, unlike <style>
 * elements, so the interface looks right even on strict sites.
 */
function applyStyles(root: ShadowRoot): void {
  try {
    if (!sheet) {
      sheet = new CSSStyleSheet();
      sheet.replaceSync(css);
    }
    root.adoptedStyleSheets = [sheet];
  } catch {
    root.append(h('style', {}, css));
  }
}

export interface Layer {
  host: HTMLElement;
  root: ShadowRoot;
  remove(): void;
}

/** An isolated shadow root for Just Upload's interface; page CSS cannot reach inside. */
export function mountLayer(kind: 'toast' | 'dialog'): Layer {
  const host = document.createElement('just-upload-ui');
  host.setAttribute('data-layer', kind);
  // Set through CSSOM (allowed under any CSP), and !important so page rules cannot move it.
  for (const [property, value] of [
    ['all', 'initial'],
    ['position', 'fixed'],
    ['inset', '0 auto auto 0'],
    ['width', '0'],
    ['height', '0'],
    ['z-index', '2147483647'],
  ]) {
    host.style.setProperty(property!, value!, 'important');
  }
  const root = host.attachShadow({ mode: 'open' });
  applyStyles(root);
  // documentElement rather than body: some apps replace <body> wholesale.
  document.documentElement.append(host);
  return { host, root, remove: () => host.remove() };
}

/** The focused element, looking through open shadow roots. */
export function deepActiveElement(): HTMLElement | null {
  let active = document.activeElement;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  return active instanceof HTMLElement ? active : null;
}
