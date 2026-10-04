import { browser } from 'wxt/browser';
import type { TransformResult } from '../../models';
import type { ErrorCode } from '../../utils/errors';
import { isImage } from '../../formats';
import { failureCopy, processingCopy, successCopy } from '../copy';
import { confirmChange, type ConfirmAnswer, type ConfirmRequest } from './dialog';
import { showToast, updateProcessingToast } from './toast';

export type { ConfirmAnswer, ConfirmRequest };

/** Everything the upload interceptor can show. Swappable in tests. */
export interface PageUi {
  /** `noun` names the files: "image", "PDF" or "file". */
  processing(count: number, noun?: string): () => void;
  /** How much of a large image has been read, shown in the "Preparing…" notice. */
  progress?(count: number, fraction: number, noun?: string): void;
  /** `unprepared`: files of the same selection that go to the site as they were. */
  success(results: TransformResult[], unprepared?: number): void;
  failure(code: ErrorCode, removed: boolean, noun?: string): void;
  confirm(request: ConfirmRequest, signal: AbortSignal): Promise<ConfirmAnswer | null>;
}

/** A notice that fails to show must never become an error on the website. */
function quietly<T>(show: () => T, fallback: T): T {
  try {
    return show();
  } catch {
    return fallback;
  }
}

export const pageUi: PageUi = {
  processing: (count, noun) =>
    quietly(
      () => showToast('processing', processingCopy(count, undefined, noun)),
      () => {},
    ),
  progress: (count, fraction, noun) =>
    quietly(
      () => updateProcessingToast(processingCopy(count, undefined, noun).title, fraction),
      undefined,
    ),
  success: (results, unprepared) =>
    quietly(() => {
      const [first] = results;
      // Only an image is shown as a picture; a PDF or spreadsheet keeps the plain check.
      const photo =
        first && isImage(first.finalFormat)
          ? { file: first.file, width: first.finalWidth, height: first.finalHeight }
          : undefined;
      void showToast('success', successCopy(results, unprepared), undefined, photo);
    }, undefined),
  failure: (code, removed, noun) =>
    quietly(
      () =>
        void showToast('error', failureCopy(code, removed, noun), {
          label: 'Report a problem',
          run: () =>
            void browser.runtime
              .sendMessage({ target: 'background', kind: 'open-problems' })
              .catch(() => {}),
        }),
      undefined,
    ),
  // A dialog that cannot open resolves to null, which keeps the original file.
  confirm: (request, signal) => confirmChange(request, signal).catch(() => null),
};
