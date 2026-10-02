import { browser } from 'wxt/browser';
import type {
  SerializedTransform,
  TransformOptions,
  TransformResult,
  UploadRequirements,
} from '../models';
import { LIMITS, processingTime } from '../security/limits';
import { errorCode, ProcessingError } from '../utils/errors';
import { deserializeFile, serializeFile } from '../utils/files';
import { processorFrame, type ProcessorFrame } from './frame';
import type { JobResponse, SerializedPrepare } from './protocol';
import type { PrepareOutcome } from './transform';

/** Where image work happens. The content script never decodes or encodes itself. */
export interface Processor {
  prepare(
    file: File,
    requirements: UploadRequirements,
    signal: AbortSignal,
    progress?: (fraction: number) => void,
  ): Promise<PrepareOutcome>;
  transform(
    file: File,
    requirements: UploadRequirements,
    options: TransformOptions,
    signal: AbortSignal,
    progress?: (fraction: number) => void,
  ): Promise<TransformResult>;
}

/** crypto.randomUUID needs a secure context; plain http:// pages still deserve ids. */
function jobId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(12)), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

/** Evidence text stays in the page's content script; only the rules travel. */
function rulesOnly(requirements: UploadRequirements): UploadRequirements {
  return { ...requirements, sources: [] };
}

/**
 * Waits for one job's answer, giving up when the selection is abandoned or the job runs
 * far past its own limit. A job that keeps reporting progress is working, not stuck: each
 * report restarts its clock, so a slow computer can still finish a huge image.
 */
function awaitAnswer<T>(
  file: Blob,
  signal: AbortSignal,
  cancel: () => void,
  run: (stillWorking: () => void) => Promise<JobResponse<T> | undefined>,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const settle = (action: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      action();
    };
    const onAbort = () => {
      cancel();
      settle(() => reject(new ProcessingError('cancelled')));
    };
    const restart = () => {
      clearTimeout(timer);
      timer = setTimeout(
        () => {
          cancel();
          settle(() => reject(new ProcessingError('timeout')));
        },
        processingTime(file.size) + 10_000,
      );
    };
    restart();
    signal.addEventListener('abort', onAbort, { once: true });
    run(() => {
      if (!settled) restart();
    }).then(
      (response) =>
        settle(() =>
          response?.ok
            ? resolve(response.value)
            : reject(new ProcessingError(errorCode(response?.error))),
        ),
      () => settle(() => reject(new ProcessingError('failed'))),
    );
  });
}

/** The main path: the file goes to the in-page processor by reference. */
function viaFrame<T>(
  frame: ProcessorFrame,
  kind: 'prepare' | 'transform',
  file: File,
  extra: object,
  signal: AbortSignal,
  progress?: (fraction: number) => void,
): Promise<T> {
  const id = jobId();
  return awaitAnswer<T>(
    file,
    signal,
    () => frame.cancel(id),
    (stillWorking) =>
      frame.run({ kind, id, file, ...extra }, (fraction) => {
        stillWorking();
        progress?.(fraction);
      }) as Promise<JobResponse<T> | undefined>,
  );
}

/** The fallback: the file travels as base64 through the background, so it must be small. */
async function viaMessages<T>(
  kind: 'prepare' | 'transform',
  file: File,
  extra: object,
  signal: AbortSignal,
): Promise<T> {
  if (file.size > LIMITS.maxMessageBytes) throw new ProcessingError('too-large-to-process');
  const serialized = await serializeFile(file);
  signal.throwIfAborted();
  const id = jobId();
  return awaitAnswer<T>(
    file,
    signal,
    () =>
      void browser.runtime
        .sendMessage({ target: 'background', kind: 'cancel', id })
        .catch(() => {}),
    () =>
      browser.runtime.sendMessage({
        target: 'background',
        kind,
        id,
        file: serialized,
        ...extra,
      }) as Promise<JobResponse<T> | undefined>,
  );
}

function fromMessage(value: SerializedTransform): TransformResult {
  return { ...value, file: deserializeFile(value.file) };
}

export const extensionProcessor: Processor = {
  async prepare(file, requirements, signal, progress) {
    signal.throwIfAborted();
    const extra = { requirements: rulesOnly(requirements) };
    const frame = await processorFrame();
    signal.throwIfAborted();
    if (frame) return viaFrame<PrepareOutcome>(frame, 'prepare', file, extra, signal, progress);
    const value = await viaMessages<SerializedPrepare>('prepare', file, extra, signal);
    if (value.kind === 'fixed') return { kind: 'fixed', result: fromMessage(value.result) };
    if (value.kind === 'confirm') return { ...value, preview: deserializeFile(value.preview) };
    return value;
  },
  async transform(file, requirements, options, signal, progress) {
    signal.throwIfAborted();
    const extra = { requirements: rulesOnly(requirements), options };
    const frame = await processorFrame();
    signal.throwIfAborted();
    if (frame) return viaFrame<TransformResult>(frame, 'transform', file, extra, signal, progress);
    return fromMessage(await viaMessages<SerializedTransform>('transform', file, extra, signal));
  },
};

/** Gets the processor ready while a person is still choosing a file. */
export function warmProcessor(): void {
  void processorFrame().then((frame) => {
    if (frame) frame.warm();
    else void browser.runtime.sendMessage({ target: 'background', kind: 'warm' }).catch(() => {});
  });
}
