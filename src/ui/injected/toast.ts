import type { Receipt, ToastCopy } from '../copy';
import { arrow, h, icon, mountLayer, svgElement, tag, type Layer } from './dom';

export type ToastKind = 'success' | 'error' | 'processing';

/** The prepared image, shown small in the note so people see which photo is ready. */
export interface ToastPhoto {
  file: Blob;
  width: number;
  height: number;
}

/** Thumbnail size in device pixels: sharp at 40 CSS pixels on a 2× screen. */
const PHOTO_SIZE = 80;
/** Decoding a larger image just for a thumbnail would cost the page too much memory. */
const PHOTO_MAX_PIXELS = 40_000_000;

/**
 * A "Preparing…" note that is dismissed lingers this long, so the result that usually
 * follows straight after can take its place instead of a second note popping in.
 */
const HANDOVER_MS = 80;

/**
 * How long a note stays: long enough to read at a glance, short enough not to linger.
 * Its countdown line shows the time left and pauses while pointed at.
 */
const DURATION: Record<ToastKind, number | undefined> = {
  success: 2_800,
  error: 6_500,
  processing: undefined,
};

let layer: Layer | undefined;
let region: HTMLElement | undefined;
let current: Toast | undefined;

function ensureLayer(): Layer {
  if (!layer?.host.isConnected) {
    layer = mountLayer('toast');
    // A live region that already exists is announced reliably; a freshly inserted one often is not.
    region = h('div', {
      class: 'ju-visually-hidden',
      role: 'status',
      'aria-live': 'polite',
      'aria-atomic': 'true',
    });
    layer.root.append(region);
  }
  return layer;
}

function announce(text: string): void {
  if (!region) return;
  region.textContent = '';
  const target = region;
  setTimeout(() => {
    target.textContent = text;
  }, 60);
}

/**
 * Just Upload's mark, in the note's corner. One drawing holds every state: a progress ring
 * with a rising arrow while preparing, a check that draws itself when ready, and an
 * exclamation when something went wrong. The note's kind decides which is shown, so a
 * "Preparing…" note turns into "Ready" in place.
 */
function mark(): HTMLElement {
  const drawing = svgElement('svg', { viewBox: '0 0 32 32', fill: 'none', 'aria-hidden': 'true' });
  drawing.append(
    svgElement('circle', { class: 'ju-track', cx: '16', cy: '16', r: '11' }),
    svgElement('circle', { class: 'ju-ring', cx: '16', cy: '16', r: '11', pathLength: '100' }),
    svgElement('path', { class: 'ju-arrow-up', d: 'M16 20.5V11.5M12.25 15.25 16 11.5l3.75 3.75' }),
    svgElement('path', { class: 'ju-check', d: 'm10.75 16.25 3.5 3.5 7-7.5', pathLength: '1' }),
    svgElement('path', { class: 'ju-alert', d: 'M16 10.5v6.5M16 21.25v.01' }),
  );
  return h('span', { class: 'ju-mark' }, drawing as unknown as Node);
}

/**
 * Draws the photo, cropped to a square, at thumbnail size. The browser decodes it scaled
 * down, off the page's main thread. Formats it can't show (TIFF) keep the plain check.
 */
async function drawPhoto(photo: ToastPhoto): Promise<HTMLCanvasElement | undefined> {
  const { width, height } = photo;
  if (!(width > 0 && height > 0) || width * height > PHOTO_MAX_PIXELS) return undefined;
  try {
    const scale = PHOTO_SIZE / Math.min(width, height);
    const bitmap = await createImageBitmap(photo.file, {
      resizeWidth: Math.max(PHOTO_SIZE, Math.round(width * scale)),
      resizeHeight: Math.max(PHOTO_SIZE, Math.round(height * scale)),
      resizeQuality: 'medium',
    });
    const canvas = h('canvas', { class: 'ju-photo', 'aria-hidden': 'true' });
    canvas.width = PHOTO_SIZE;
    canvas.height = PHOTO_SIZE;
    canvas
      .getContext('2d')
      ?.drawImage(bitmap, (PHOTO_SIZE - bitmap.width) / 2, (PHOTO_SIZE - bitmap.height) / 2);
    bitmap.close();
    return canvas;
  } catch {
    return undefined;
  }
}

/**
 * The change, drawn: "HEIC 3.1 MB → JPG 1.8 MB", and the pixel size when it changed. The
 * sentence is read aloud instead.
 */
function receiptRow(receipt: Receipt): HTMLElement {
  return h(
    'div',
    { class: 'ju-receipt', 'aria-hidden': 'true' },
    h(
      'div',
      { class: 'ju-receipt-tags' },
      receipt.note && h('span', { class: 'ju-receipt-note' }, receipt.note),
      receipt.from && tag(receipt.from.name, receipt.from.size),
      receipt.from && receipt.to && arrow(),
      receipt.to && tag(receipt.to.name, receipt.to.size, true),
    ),
    receipt.pixels &&
      h('p', { class: 'ju-pixels' }, `${receipt.pixels.from} → ${receipt.pixels.to} pixels`),
  );
}

export interface ToastAction {
  label: string;
  run(): void;
}

class Toast {
  readonly element: HTMLElement;
  private readonly mark: HTMLElement;
  private readonly body: HTMLElement;
  private readonly meter: HTMLElement;
  private readonly timer: HTMLElement;
  private readonly close: HTMLButtonElement;
  kind: ToastKind;
  leaving = false;
  private handover?: ReturnType<typeof setTimeout>;

  constructor(kind: ToastKind, copy: ToastCopy, action?: ToastAction, photo?: ToastPhoto) {
    this.kind = kind;
    this.mark = mark();
    this.body = h('div', { class: 'ju-body' });
    this.meter = h('span', { class: 'ju-meter', 'aria-hidden': 'true' });
    this.timer = h('span', { class: 'ju-timer', 'aria-hidden': 'true' });
    this.close = h(
      'button',
      { type: 'button', class: 'ju-toast-close', 'aria-label': 'Dismiss' },
      icon('close'),
    );
    this.element = h(
      'div',
      { class: 'ju-toast', 'data-kind': kind, popover: 'manual' },
      this.mark,
      this.body,
      this.meter,
      this.close,
      this.timer,
    );
    this.fill(kind, copy, action, photo);

    this.close.addEventListener('click', () => this.dismiss());
    // The countdown is the timer: it pauses with the pointer over the note or focus in it.
    this.timer.addEventListener('animationend', () => this.dismiss());
    for (const type of ['mouseenter', 'focusin'] as const)
      this.element.addEventListener(type, () => this.element.toggleAttribute('data-paused', true));
    for (const type of ['mouseleave', 'focusout'] as const)
      this.element.addEventListener(type, () => {
        if (!this.element.matches(':hover, :focus-within'))
          this.element.removeAttribute('data-paused');
      });
  }

  private fill(kind: ToastKind, copy: ToastCopy, action?: ToastAction, photo?: ToastPhoto): void {
    this.kind = kind;
    this.element.dataset.kind = kind;
    this.mark.querySelector('.ju-photo')?.remove();
    this.mark.removeAttribute('data-photo');
    if (kind === 'success' && photo) void this.showPhoto(photo);
    const { receipt } = copy;
    const lines: (Node | false | undefined | '')[] = [
      h('p', { class: 'ju-title' }, copy.title),
      receipt ? receiptRow(receipt) : copy.detail && h('p', { class: 'ju-detail' }, copy.detail),
      receipt && copy.detail && h('span', { class: 'ju-visually-hidden' }, copy.detail),
      action && h('button', { type: 'button', class: 'ju-toast-action' }, action.label, arrow()),
    ];
    this.body.replaceChildren(...lines.filter((line): line is Node => Boolean(line)));
    this.body.querySelector('.ju-toast-action')?.addEventListener('click', () => {
      action?.run();
      this.dismiss();
    });
    // The figure in the corner: quality kept when ready, progress while preparing.
    this.meter.replaceChildren();
    this.meter.classList.toggle('is-low', Boolean(receipt?.noticeable));
    if (receipt) this.meter.append(h('b', {}, receipt.quality), h('span', {}, 'quality kept'));

    const duration = DURATION[kind];
    this.timer.hidden = !duration;
    if (duration) {
      this.timer.style.setProperty('--ju-duration', `${duration}ms`);
      // Restart the countdown when a note changes in place.
      this.timer.classList.remove('is-running');
      void this.timer.offsetWidth;
      this.timer.classList.add('is-running');
    }
    announce(copy.detail ? `${copy.title}. ${copy.detail}` : copy.title);
  }

  /** The photo takes the mark's place once drawn; the check moves to its corner. */
  private async showPhoto(photo: ToastPhoto): Promise<void> {
    const canvas = await drawPhoto(photo);
    if (!canvas || this.leaving || this.kind !== 'success') return;
    this.mark.prepend(canvas);
    this.mark.toggleAttribute('data-photo', true);
  }

  /** Turns "Preparing…" into the result without a second note popping in. */
  morph(kind: ToastKind, copy: ToastCopy, action?: ToastAction, photo?: ToastPhoto): void {
    clearTimeout(this.handover);
    const before = this.element.getBoundingClientRect().height;
    this.fill(kind, copy, action, photo);
    const after = this.element.getBoundingClientRect().height;
    if (Math.abs(after - before) > 1)
      this.element.animate([{ height: `${before}px` }, { height: `${after}px` }], {
        duration: 320,
        easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
      });
    this.body.animate(
      [
        { opacity: 0, transform: 'translateY(3px)' },
        { opacity: 1, transform: 'none' },
      ],
      { duration: 260, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
    );
  }

  progress(title: string, fraction: number): void {
    const titleElement = this.body.querySelector('.ju-title');
    if (titleElement) titleElement.textContent = title;
    this.element.style.setProperty('--ju-progress', String(Math.min(1, Math.max(0, fraction))));
    this.element.toggleAttribute('data-determinate', true);
    this.meter.replaceChildren(h('b', {}, `${Math.floor(fraction * 100)}%`));
  }

  dismiss(): void {
    if (this.leaving) return;
    if (this.kind === 'processing') {
      clearTimeout(this.handover);
      this.handover = setTimeout(() => this.leave(), HANDOVER_MS);
      return;
    }
    this.leave();
  }

  /** Replaced by a newer note: gone at once, so the two never overlap. */
  discard(): void {
    clearTimeout(this.handover);
    this.leaving = true;
    if (current === this) current = undefined;
    this.element.remove();
  }

  private leave(): void {
    if (this.leaving) return;
    this.leaving = true;
    if (current === this) current = undefined;
    const remove = () => this.element.remove();
    this.element.classList.add('is-leaving');
    this.element.addEventListener('animationend', remove, { once: true });
    // Without animations (reduced motion, or a hidden tab), remove it anyway.
    setTimeout(remove, 260);
  }
}

/** Shows a small, non-blocking note. It never takes focus. Returns a dismiss function. */
export function showToast(
  kind: ToastKind,
  copy: ToastCopy,
  action?: ToastAction,
  photo?: ToastPhoto,
): () => void {
  const { root } = ensureLayer();
  const previous = current;
  if (
    previous?.kind === 'processing' &&
    !previous.leaving &&
    previous.element.isConnected &&
    kind !== 'processing'
  ) {
    previous.morph(kind, copy, action, photo);
    return () => previous.dismiss();
  }
  previous?.discard();
  const toast = new Toast(kind, copy, action, photo);
  current = toast;
  root.append(toast.element);
  // The top layer keeps the note visible above a site's own modal dialogs.
  try {
    toast.element.showPopover();
  } catch {
    toast.element.removeAttribute('popover');
  }
  // Hiding "Preparing…" must not hide the result it may have turned into.
  return kind === 'processing'
    ? () => {
        if (toast.kind === 'processing') toast.dismiss();
      }
    : () => toast.dismiss();
}

/** Updates the "Preparing…" note in place, if one is showing. */
export function updateProcessingToast(title: string, fraction: number): void {
  if (current?.kind === 'processing' && current.element.isConnected)
    current.progress(title, fraction);
}
