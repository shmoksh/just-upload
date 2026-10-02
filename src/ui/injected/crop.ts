import type { CropRect } from '../../models';
import { defaultCrop } from '../../decision';
import { MAX_ZOOM, panCrop, zoomCrop, zoomOf } from '../crop-math';
import { h } from './dom';

export interface CropEditor {
  element: HTMLElement;
  /** The chosen region, in the original image's pixels. */
  value(): CropRect;
  destroy(): void;
}

interface CropEditorOptions {
  /** A downscaled rendering of the image; the crop itself is in original pixels. */
  preview: ImageBitmap;
  width: number;
  height: number;
  ratio: number;
  /** Paint this colour under the image, e.g. white when transparency will be flattened. */
  fill?: string;
}

const VIEW_WIDTH = 360;
const VIEW_HEIGHT = 300;

export function createCropEditor({
  preview,
  width,
  height,
  ratio,
  fill,
}: CropEditorOptions): CropEditor {
  let crop = defaultCrop(width, height, ratio);
  const canvas = h('canvas');
  const viewport = h(
    'div',
    {
      class: 'ju-crop',
      tabindex: '0',
      role: 'group',
      'aria-roledescription': 'crop area',
      'aria-label': 'Photo crop. Use the arrow keys to move the photo, and plus or minus to zoom.',
    },
    canvas,
  );
  const viewWidth = ratio >= VIEW_WIDTH / VIEW_HEIGHT ? VIEW_WIDTH : VIEW_HEIGHT * ratio;
  viewport.style.setProperty('width', `${Math.round(viewWidth)}px`);
  viewport.style.setProperty('aspect-ratio', String(ratio));
  const slider = h('input', {
    type: 'range',
    min: '1',
    max: String(MAX_ZOOM),
    step: '0.01',
    value: '1',
    'aria-label': 'Zoom',
  });
  const element = h(
    'div',
    {},
    h(
      'div',
      { class: 'ju-stage' },
      viewport,
      h('label', { class: 'ju-zoom' }, h('span', { 'aria-hidden': 'true' }, 'Zoom'), slider),
    ),
  );

  let frame = 0;
  const draw = () => {
    frame = 0;
    const scale = window.devicePixelRatio || 1;
    const targetWidth = Math.max(1, Math.round(viewport.clientWidth * scale));
    const targetHeight = Math.max(1, Math.round(viewport.clientHeight * scale));
    if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
      canvas.width = targetWidth;
      canvas.height = targetHeight;
    }
    const context = canvas.getContext('2d');
    if (!context) return;
    const sx = preview.width / width;
    const sy = preview.height / height;
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (fill) {
      context.fillStyle = fill;
      context.fillRect(0, 0, canvas.width, canvas.height);
    }
    context.imageSmoothingQuality = 'high';
    context.drawImage(
      preview,
      crop.x * sx,
      crop.y * sy,
      crop.width * sx,
      crop.height * sy,
      0,
      0,
      canvas.width,
      canvas.height,
    );
  };
  const update = (next: CropRect) => {
    crop = next;
    const zoom = zoomOf(crop, width, height, ratio);
    slider.value = String(zoom);
    slider.setAttribute('aria-valuetext', `${Math.round(zoom * 100)} percent`);
    frame ||= requestAnimationFrame(draw);
  };
  const zoomTo = (zoom: number) => update(zoomCrop(crop, zoom, width, height, ratio));
  /** Screen pixels to image pixels at the current zoom. */
  const toImage = (distance: number) => (distance * crop.width) / Math.max(1, viewport.clientWidth);

  const pointers = new Map<number, { x: number; y: number }>();
  let pinch: { distance: number; zoom: number } | undefined;
  const spread = () => {
    const [a, b] = [...pointers.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };
  viewport.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    viewport.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    viewport.toggleAttribute('data-dragging', true);
    if (pointers.size === 2)
      pinch = { distance: spread(), zoom: zoomOf(crop, width, height, ratio) };
  });
  viewport.addEventListener('pointermove', (event) => {
    const last = pointers.get(event.pointerId);
    if (!last) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pinch && pointers.size === 2) {
      zoomTo((pinch.zoom * spread()) / Math.max(1, pinch.distance));
    } else if (pointers.size === 1) {
      // Dragging moves the photo, so the crop window moves the other way.
      update(
        panCrop(
          crop,
          -toImage(event.clientX - last.x),
          -toImage(event.clientY - last.y),
          width,
          height,
        ),
      );
    }
  });
  const release = (event: PointerEvent) => {
    pointers.delete(event.pointerId);
    if (pointers.size < 2) pinch = undefined;
    if (!pointers.size) viewport.removeAttribute('data-dragging');
  };
  viewport.addEventListener('pointerup', release);
  viewport.addEventListener('pointercancel', release);
  viewport.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault();
      zoomTo(
        zoomOf(crop, width, height, ratio) *
          Math.exp(-event.deltaY * (event.ctrlKey ? 0.01 : 0.002)),
      );
    },
    { passive: false },
  );
  viewport.addEventListener('keydown', (event) => {
    const step = toImage(event.shiftKey ? 40 : 8);
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const move = moves[event.key];
    const zoom = zoomOf(crop, width, height, ratio);
    if (move) update(panCrop(crop, move[0], move[1], width, height));
    else if (event.key === '+' || event.key === '=') zoomTo(zoom + 0.1);
    else if (event.key === '-' || event.key === '_') zoomTo(zoom - 0.1);
    else if (event.key === '0') update(defaultCrop(width, height, ratio));
    else return;
    event.preventDefault();
  });
  slider.addEventListener('input', () => zoomTo(Number(slider.value)));

  const resize = new ResizeObserver(() => {
    frame ||= requestAnimationFrame(draw);
  });
  resize.observe(viewport);
  update(crop);

  return {
    element,
    value: () => ({ ...crop }),
    destroy() {
      resize.disconnect();
      cancelAnimationFrame(frame);
      canvas.width = 0;
      canvas.height = 0;
    },
  };
}

/** A still preview drawn to a canvas, so a strict page CSP cannot block it. */
export function createPreview(
  preview: ImageBitmap,
  options: { fill?: string; label: string },
): HTMLElement {
  const canvas = h('canvas', {
    class: 'ju-preview',
    role: 'img',
    'aria-label': options.label,
    'data-checker': options.fill ? undefined : true,
  });
  canvas.width = preview.width;
  canvas.height = preview.height;
  const context = canvas.getContext('2d');
  if (context) {
    if (options.fill) {
      context.fillStyle = options.fill;
      context.fillRect(0, 0, canvas.width, canvas.height);
    }
    context.drawImage(preview, 0, 0);
  }
  return h('div', { class: 'ju-stage' }, canvas);
}
