import type { CropRect, Decision, ImageInfo, UploadRequirements } from '../../models';
import { LOOKS_THE_SAME, targetRatio } from '../../decision';
import { dialogCopy } from '../copy';
import { createCropEditor, createPreview, type CropEditor } from './crop';
import { deepActiveElement, h, icon, logo, mountLayer } from './dom';

export interface ConfirmRequest {
  decision: Decision;
  info: ImageInfo;
  requirements: UploadRequirements;
  /** What the change looks like; a PDF made smaller has no picture to show. */
  preview?: Blob;
  /** Declining removes the file instead of keeping it (see picker widening). */
  removeOnDecline: boolean;
  /** For a quality question: the share of the original's look the prepared file keeps. */
  quality?: number;
  /** For a smaller copy: its pixel size (for a PDF, its largest picture's). */
  fitted?: { width: number; height: number };
}
export interface ConfirmAnswer {
  crop?: CropRect;
}

let closeOpenDialog: (() => void) | undefined;

/** Quality kept, drawn against the point where a copy looks the same as the photo. */
function qualityScale(kept: number): HTMLElement {
  // Starts 10 to 20 points below the value, so the gap to "looks the same" is easy to see.
  const from = Math.max(0, Math.min(70, Math.floor((kept - 10) / 10) * 10));
  const position = (value: number) =>
    String(Math.min(1, Math.max(0, (value - from) / (100 - from))));
  const scale = h(
    'div',
    { class: 'ju-quality', 'aria-hidden': 'true' },
    h(
      'div',
      { class: 'ju-quality-head' },
      h('span', {}, 'Quality kept ', h('b', {}, `${kept}%`)),
      h('span', { class: 'ju-quality-same-label' }, `Looks the same · ${LOOKS_THE_SAME}%`),
    ),
    h(
      'div',
      { class: 'ju-quality-track' },
      h('i', { class: 'ju-quality-fill' }),
      h('i', { class: 'ju-quality-same' }),
    ),
  );
  // Through CSSOM: style attributes would be blocked by a strict site's CSP.
  scale.style.setProperty('--ju-quality', position(kept));
  scale.style.setProperty('--ju-same', position(LOOKS_THE_SAME));
  return scale;
}

/**
 * Asks before any change to how an image looks. Resolves with the approved choice,
 * or null when the person declines, presses Escape, or the selection goes stale.
 */
export async function confirmChange(
  request: ConfirmRequest,
  signal: AbortSignal,
): Promise<ConfirmAnswer | null> {
  closeOpenDialog?.();
  if (signal.aborted) return null;
  let preview: ImageBitmap | undefined;
  if (request.preview) {
    try {
      preview = await createImageBitmap(request.preview);
    } catch {
      return null;
    }
  }
  if (signal.aborted) {
    preview?.close();
    return null;
  }

  const { decision, info, requirements } = request;
  const copy = dialogCopy(decision, requirements, request.removeOnDecline, request.quality, {
    ...info,
    fitted: request.fitted,
  });
  const fill = decision.consents.includes('transparency') ? '#ffffff' : undefined;
  const ratio = targetRatio(requirements);
  const editor: CropEditor | undefined =
    decision.consents.includes('crop') && ratio && preview
      ? createCropEditor({ preview, width: info.width, height: info.height, ratio, fill })
      : undefined;

  const primary = h('button', { type: 'button', class: 'ju-button primary' }, copy.confirm);
  const secondary = h('button', { type: 'button', class: 'ju-button' }, copy.decline);
  const close = h(
    'button',
    { type: 'button', class: 'ju-dialog-close', 'aria-label': copy.decline },
    icon('close'),
  );
  const dialog = h(
    'dialog',
    { class: 'ju-dialog', 'aria-labelledby': 'ju-title', 'aria-describedby': 'ju-body' },
    close,
    h('p', { class: 'ju-dialog-brand' }, logo(), 'Just Upload'),
    h('h2', { id: 'ju-title' }, copy.title),
    h('p', { id: 'ju-body' }, copy.body),
    editor?.element ?? (preview && createPreview(preview, { fill, label: 'Your image' })),
    request.quality !== undefined &&
      (decision.consents.includes('quality') || decision.consents.includes('shrink')) &&
      qualityScale(request.quality),
    fill && h('div', { class: 'ju-chip' }, 'Background: White'),
    copy.notes.length > 0 &&
      h('ul', { class: 'ju-notes' }, ...copy.notes.map((note) => h('li', {}, note))),
    h('div', { class: 'ju-actions' }, secondary, primary),
    h(
      'p',
      { class: 'ju-footnote' },
      icon('lock'),
      'Your original file stays unchanged, on your device.',
    ),
  );

  const layer = mountLayer('dialog');
  layer.root.append(dialog);
  const returnFocus = deepActiveElement();

  return new Promise<ConfirmAnswer | null>((resolve) => {
    let finished = false;
    const finish = (answer: ConfirmAnswer | null) => {
      if (finished) return;
      finished = true;
      signal.removeEventListener('abort', abort);
      if (closeOpenDialog === abort) closeOpenDialog = undefined;
      try {
        if (dialog.open) dialog.close();
        editor?.destroy();
        layer.remove();
        preview?.close();
        if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
      } finally {
        resolve(answer);
      }
    };
    const confirm = () => finish(editor ? { crop: editor.value() } : {});
    const abort = () => finish(null);
    closeOpenDialog = abort;
    signal.addEventListener('abort', abort, { once: true });

    primary.addEventListener('click', confirm);
    secondary.addEventListener('click', abort);
    close.addEventListener('click', abort);
    // Escape arrives as the dialog's cancel event.
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      abort();
    });
    dialog.addEventListener('keydown', (event) => {
      const target = event.composedPath()[0];
      if (
        event.key === 'Enter' &&
        !(target instanceof HTMLButtonElement) &&
        !(target instanceof HTMLInputElement)
      ) {
        event.preventDefault();
        confirm();
      }
      // Keep the site's own keyboard shortcuts from reacting while this is open.
      event.stopPropagation();
    });

    try {
      dialog.showModal();
      primary.focus();
    } catch {
      finish(null);
    }
  });
}
