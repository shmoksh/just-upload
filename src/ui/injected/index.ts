import { browser } from 'wxt/browser';
import type { TransformResult } from '../../models';
import type { ErrorCode } from '../../utils/errors';
import { failureCopy, processingCopy, successCopy } from '../copy';
import { confirmChange, type ConfirmAnswer, type ConfirmRequest } from './dialog';
import { showToast, updateProcessingToast } from './toast';

export type { ConfirmAnswer, ConfirmRequest };

/** Everything the upload interceptor can show. Swappable in tests. */
export interface PageUi {
  processing(count: number): () => void;
  /** How much of a large image has been read, shown in the "Preparing…" notice. */
  progress?(count: number, fraction: number): void;
  success(results: TransformResult[]): void;
  failure(code: ErrorCode, removed: boolean): void;
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
  processing: (count) =>
    quietly(
      () => showToast('processing', processingCopy(count)),
      () => {},
    ),
  progress: (count, fraction) =>
    quietly(() => updateProcessingToast(processingCopy(count).title, fraction), undefined),
  success: (results) =>
    quietly(() => {
      const [first] = results;
      const photo = first && {
        file: first.file,
        width: first.finalWidth,
        height: first.finalHeight,
      };
      void showToast('success', successCopy(results), undefined, photo);
    }, undefined),
  failure: (code, removed) =>
    quietly(
      () =>
        void showToast('error', failureCopy(code, removed), {
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
