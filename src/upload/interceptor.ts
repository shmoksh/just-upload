import type { Settings, TransformResult, UploadRequirements } from '../models';
import { allowedOutputs, formatAllowed, guessFormat, mightNeedWork } from '../compatibility';
import { isImage } from '../formats';
import { consentFor, transformOptions, type Preferences } from '../decision';
import type { Processor } from '../images/client';
import type { PrepareOutcome } from '../images/transform';
import { isCompatibleByHeader } from '../images/quick-check';
import { detectRequirements, parseAccept } from '../requirements';
import { LIMITS } from '../security/limits';
import { isActiveOn } from '../settings';
import { nounFor } from '../ui/copy';
import type { PageUi } from '../ui/injected';
import { errorCode, fail, type ErrorCode } from '../utils/errors';
import { logger } from '../utils/logger';
import {
  dropPosition,
  filesOf,
  nativeInputAdapter,
  sameFiles,
  type DropPosition,
  type UploadAdapter,
} from './adapter';
import { widenedAccept } from './picker';

export interface InterceptorDeps {
  settings(): Settings;
  hostnames(): string[];
  processor: Processor;
  ui: PageUi;
  onFixed(results: TransformResult[]): void;
  /** A selection could not be prepared; the content script keeps a technical note of it. */
  onProblem?(code: ErrorCode, files: readonly File[], requirements: UploadRequirements): void;
  /** Called when a person opens an image picker, so processing is ready before they choose. */
  warm?(): void;
  adapter?: UploadAdapter;
}

/** Only show "Preparing image…" if the work is slow enough to notice. */
const PROCESSING_NOTICE_MS = 350;

/** Failures that need no message: the site simply gets the original file. */
const QUIET_FAILURES = new Set<ErrorCode>(['unsupported-format', 'cancelled']);

/** One person's choice of files, from the time it is held back until it is handed over. */
interface Session {
  /** The file input the rules come from. */
  input: HTMLInputElement;
  original: File[];
  controller: AbortController;
  /** Event types held back from the page, in arrival order (choices in an input). */
  held: string[];
  /** Set when the picker only offered these files because we widened it. */
  unlocked?: { previous: File[] };
  /** Set when the files were dropped on an upload area rather than chosen in the input. */
  drop?: { target: Element; position: DropPosition };
}

interface Widened {
  accept: string;
  wider: string;
  previous: File[];
}

/** A file after the automatic part of preparation, possibly with a question pending. */
interface Inspected {
  file: File;
  result?: TransformResult;
  question?: Extract<PrepareOutcome, { kind: 'confirm' }>;
  /** Prepared, but used only if the person agrees (see consentFor). */
  candidate?: TransformResult;
}

/** Files prepared at the same time; matches the worker pool, so none waits in a queue. */
const PARALLEL_FILES = 2;

/** Runs `task` over `items`, at most `limit` at a time, returning results in order. */
function limited<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<R>,
): Promise<R>[] {
  let running = 0;
  const waiting: (() => void)[] = [];
  const next = () => {
    running--;
    waiting.shift()?.();
  };
  return items.map(
    (item) =>
      new Promise<R>((resolve, reject) => {
        const start = () => {
          running++;
          task(item).then(resolve, reject).finally(next);
        };
        if (running < limit) start();
        else waiting.push(start);
      }),
  );
}

/** Declining a file the site would never have accepted removes it rather than passing it on. */
class Declined extends Error {}

/**
 * Holds a file selection (chosen in a picker or dropped on an upload area) back from the
 * page for as long as Just Upload is preparing it, then hands the page the prepared file
 * with the same events a person's choice would have produced. Anything unexpected
 * releases the original selection.
 *
 * Listeners are registered on window in the capture phase at document_start, so they
 * run before any page listener, including React's root listeners. Delegation covers
 * inputs added later, hidden inputs and single-page navigation without scanning the DOM.
 */
export function installInterceptor(deps: InterceptorDeps): () => void {
  const adapter = deps.adapter ?? nativeInputAdapter;
  const sessions = new WeakMap<HTMLInputElement, Session>();
  const active = new Set<Session>();
  const ours = new WeakSet<Event>();
  const pendingSubmits = new Map<HTMLFormElement, HTMLElement | null>();
  const widened = new WeakMap<HTMLInputElement, Widened>();
  const shadowRoots = new Set<ShadowRoot>();
  let observer: MutationObserver | undefined;
  let dropSession: Session | undefined;

  const enabled = () => isActiveOn(deps.settings(), deps.hostnames());
  /** Still the person's latest choice, and still on the page. */
  const isCurrent = (session: Session) => {
    if (session.controller.signal.aborted) return false;
    if (session.drop) return dropSession === session && session.drop.target.isConnected;
    return (
      session.input.isConnected &&
      sessions.get(session.input) === session &&
      sameFiles(filesOf(session.input), session.original)
    );
  };
  const element = (session: Session): Element => session.drop?.target ?? session.input;

  function end(session: Session): void {
    active.delete(session);
    if (sessions.get(session.input) === session) sessions.delete(session.input);
    if (dropSession === session) dropSession = undefined;
    if (!active.size) {
      observer?.disconnect();
      observer = undefined;
    }
  }
  function cancel(session: Session): void {
    session.controller.abort();
    end(session);
  }
  /** Hands the page its files: the prepared ones, or the person's originals (fail open). */
  function deliver(session: Session, prepared?: File[]): void {
    const mark = (event: Event) => ours.add(event);
    if (session.drop) {
      adapter.redrop(
        session.drop.target,
        prepared ?? session.original,
        session.drop.position,
        mark,
      );
      return;
    }
    if (prepared) adapter.replace(session.input, prepared);
    adapter.resume(session.input, session.held, mark);
  }
  function track(session: Session): void {
    active.add(session);
    observer ??= new MutationObserver(() => {
      for (const pending of active) if (!element(pending).isConnected) cancel(pending);
    });
    observer.observe(document, { childList: true, subtree: true });
  }
  function flushSubmit(form: HTMLFormElement | null): void {
    if (
      !form ||
      !pendingSubmits.has(form) ||
      [...active].some((session) => !session.drop && session.input.form === form)
    )
      return;
    const submitter = pendingSubmits.get(form);
    pendingSubmits.delete(form);
    if (!form.isConnected) return;
    try {
      form.requestSubmit(submitter?.isConnected ? submitter : undefined);
    } catch {
      // The page changed the form while we worked; leave submitting to the person.
    }
  }

  /**
   * The part of preparing a file that needs no person: checking it and, when no question
   * is needed, converting it. Runs for several files at once.
   */
  async function inspectFile(
    session: Session,
    file: File,
    requirements: UploadRequirements,
    preferences: Preferences,
    signal: AbortSignal,
  ): Promise<Inspected> {
    const stale = () => {
      if (!isCurrent(session)) fail('cancelled');
    };
    if (!mightNeedWork(file, requirements)) return { file };
    if (file.size > LIMITS.maxInputBytes) fail('too-large-to-process');
    const compatible = await isCompatibleByHeader(file, requirements);
    stale();
    if (compatible) return { file };
    const outcome = await deps.processor.prepare(file, requirements, signal, (fraction) =>
      deps.ui.progress?.(session.original.length, fraction, nounFor(session.original)),
    );
    stale();
    if (outcome.kind === 'pass') return { file };
    if (outcome.kind === 'unsafe') fail(outcome.code);
    if (outcome.kind === 'fixed') {
      return consentFor(outcome.result, preferences)
        ? { file, candidate: outcome.result }
        : { file: outcome.result.file, result: outcome.result };
    }
    return { file, question: outcome };
  }

  /**
   * Shows what a prepared file keeps of the original (its quality, and its pixels when it
   * needed fewer to fit), and uses it only if approved.
   */
  async function confirmResult(
    session: Session,
    original: File,
    candidate: TransformResult,
    requirements: UploadRequirements,
    preferences: Preferences,
    notice: { stop(): void },
  ): Promise<{ file: File; result?: TransformResult }> {
    notice.stop();
    const answer = await deps.ui.confirm(
      {
        decision: {
          action: 'USER_CONFIRMATION',
          issues: [],
          outputFormat: candidate.finalFormat,
          consents: [consentFor(candidate, preferences) ?? 'quality'],
        },
        info: {
          format: candidate.originalFormat,
          width: candidate.originalWidth,
          height: candidate.originalHeight,
          bytes: candidate.originalSize,
          transparent: false,
          animated: false,
        },
        requirements,
        // A PDF made smaller has no picture to show; its numbers say enough.
        preview: isImage(candidate.finalFormat) ? candidate.file : undefined,
        removeOnDecline: Boolean(session.unlocked),
        quality: candidate.qualityKept,
        ...(candidate.resizedToFit
          ? { fitted: { width: candidate.finalWidth, height: candidate.finalHeight } }
          : {}),
      },
      session.controller.signal,
    );
    if (!isCurrent(session)) fail('cancelled');
    if (!answer) {
      if (session.unlocked) throw new Declined();
      return { file: original };
    }
    return { file: candidate.file, result: candidate };
  }

  /** Asks, then applies the answer. Questions come one at a time, in the order chosen. */
  async function answerFile(
    session: Session,
    inspected: Inspected,
    requirements: UploadRequirements,
    preferences: Preferences,
    notice: { start(): void; stop(): void },
  ): Promise<{ file: File; result?: TransformResult }> {
    const { question, candidate, file } = inspected;
    if (candidate)
      return confirmResult(session, file, candidate, requirements, preferences, notice);
    if (!question) return inspected;
    const { signal } = session.controller;
    notice.stop();
    const answer = await deps.ui.confirm(
      {
        decision: question.decision,
        info: question.info,
        requirements,
        preview: question.preview,
        previews: question.previews,
        removeOnDecline: Boolean(session.unlocked),
      },
      signal,
    );
    if (!isCurrent(session)) fail('cancelled');
    if (!answer) {
      if (session.unlocked) throw new Declined();
      return { file };
    }
    notice.start();
    const options = transformOptions(question.decision, answer.crop, answer.sheet);
    const result = await deps.processor.transform(file, requirements, options, signal, (fraction) =>
      deps.ui.progress?.(session.original.length, fraction, nounFor(session.original)),
    );
    if (!isCurrent(session)) fail('cancelled');
    if (consentFor(result, preferences))
      return confirmResult(session, file, result, requirements, preferences, notice);
    return { file: result.file, result };
  }

  async function run(session: Session, requirements: UploadRequirements): Promise<void> {
    const settings = deps.settings();
    const preferences: Preferences = {
      askBeforeQualityChanges: settings.askBeforeQualityChanges,
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    let hide: (() => void) | undefined;
    const notice = {
      start() {
        clearTimeout(timer);
        timer = setTimeout(() => {
          if (isCurrent(session))
            hide = deps.ui.processing(session.original.length, nounFor(session.original));
        }, PROCESSING_NOTICE_MS);
      },
      stop() {
        clearTimeout(timer);
        hide?.();
        hide = undefined;
      },
    };
    // Stops the rest of a selection's work if one file fails; the session itself stays
    // current so the original selection can still be handed over.
    const batch = new AbortController();
    const signal = AbortSignal.any([session.controller.signal, batch.signal]);
    notice.start();
    try {
      const inspections = limited(session.original, PARALLEL_FILES, (file) =>
        inspectFile(session, file, requirements, preferences, signal),
      );
      for (const inspection of inspections) inspection.catch(() => {});
      const replacements: File[] = [];
      const results: TransformResult[] = [];
      const unprepared: { file: File; code: ErrorCode }[] = [];
      // Awaited in order, so the site receives the files in the order they were chosen.
      for (const [index, inspection] of inspections.entries()) {
        try {
          const prepared = await answerFile(
            session,
            await inspection,
            requirements,
            preferences,
            notice,
          );
          replacements.push(prepared.file);
          if (prepared.result) results.push(prepared.result);
        } catch (error) {
          // One of several files that cannot be prepared goes to the site as it is, and
          // the rest are still prepared. A selection that went stale, was declined, or
          // holds a file the site would never have accepted ends as a whole.
          const code = errorCode(error);
          if (error instanceof Declined || code === 'cancelled' || session.unlocked) throw error;
          const file = session.original[index]!;
          unprepared.push({ file, code });
          replacements.push(file);
        }
      }
      if (!isCurrent(session)) return;
      // Nothing could be prepared: the selection fails open as one, with its message.
      if (unprepared.length && !results.length) fail(unprepared[0]!.code);
      notice.stop();
      deliver(session, results.length ? replacements : undefined);
      if (results.length) {
        deps.onFixed(results);
        for (const { file, code } of unprepared) deps.onProblem?.(code, [file], requirements);
        if (deps.settings().showNotifications) deps.ui.success(results, unprepared.length);
      }
    } catch (error) {
      batch.abort();
      notice.stop();
      if (!isCurrent(session)) return;
      if (session.unlocked) {
        // The site never accepted this format; put back what it last saw, silently.
        try {
          adapter.replace(session.input, session.unlocked.previous);
        } catch {
          session.input.value = '';
        }
        if (!(error instanceof Declined)) {
          deps.ui.failure(errorCode(error), true, nounFor(session.original));
          deps.onProblem?.(errorCode(error), session.original, requirements);
        }
        return;
      }
      // Fail open: the site gets exactly what the person chose.
      deliver(session);
      const code = errorCode(error);
      if (code !== 'cancelled') deps.onProblem?.(code, session.original, requirements);
      if (!QUIET_FAILURES.has(code)) {
        logger.warn('processing-failed', code);
        deps.ui.failure(code, false, nounFor(session.original));
      }
    } finally {
      notice.stop();
      end(session);
      if (!session.drop) flushSubmit(session.input.form);
    }
  }

  function watchShadowRoot(input: HTMLInputElement): void {
    // "change" does not cross shadow boundaries, so it never reaches window.
    const root = input.getRootNode();
    if (!(root instanceof ShadowRoot) || shadowRoots.has(root)) return;
    shadowRoots.add(root);
    root.addEventListener('input', capture, true);
    root.addEventListener('change', capture, true);
  }

  function capture(event: Event): void {
    if (ours.has(event)) return;
    const input = event.composedPath()[0];
    if (!adapter.matches(input)) return;
    watchShadowRoot(input);
    const files = filesOf(input);
    const existing = sessions.get(input);
    if (existing && sameFiles(files, existing.original)) {
      // The same selection's second event (input, then change): hold it too.
      event.stopImmediatePropagation();
      if (!existing.held.includes(event.type)) existing.held.push(event.type);
      return;
    }
    if (existing) cancel(existing);
    const widening = widened.get(input);
    widened.delete(input);
    // Rules come from the site's own accept, never from our temporary one.
    if (widening && input.getAttribute('accept') === widening.wider)
      input.setAttribute('accept', widening.accept);
    if (!enabled() || !files.length || files.length > LIMITS.maxFiles) return;
    if (files.reduce((total, file) => total + file.size, 0) > LIMITS.maxSelectionBytes) return;
    try {
      const requirements = detectRequirements(input);
      if (!files.some((file) => mightNeedWork(file, requirements))) return;
      const session: Session = {
        input,
        original: files,
        controller: new AbortController(),
        held: [event.type],
      };
      if (widening) {
        const offered = parseAccept(widening.accept);
        if (files.some((file) => !formatAllowed(guessFormat(file), offered)))
          session.unlocked = { previous: widening.previous };
      }
      event.stopImmediatePropagation();
      sessions.set(input, session);
      track(session);
      void run(session, requirements);
    } catch {
      logger.warn('detection-failed');
    }
  }

  /**
   * A click on a file input opens the picker. Choosing a file takes a person at least a
   * second, which is time enough to get the decoders ready, and the picker can be told
   * about formats we can convert.
   */
  function onPickerClick(event: Event): void {
    const input = event.composedPath()[0];
    if (!adapter.matches(input) || !enabled()) return;
    const accept = input.getAttribute('accept');
    if (allowedOutputs(parseAccept(accept ?? '')).length) deps.warm?.();
    if (input.multiple) return;
    const wider = accept && widenedAccept(accept);
    if (!accept || !wider) return;
    widened.set(input, { accept, wider, previous: filesOf(input) });
    input.setAttribute('accept', wider);
    // The browser reads accept when it opens the picker, right after this click is
    // dispatched. Restore it on the next task, unless the page changed it meanwhile.
    setTimeout(() => {
      if (input.getAttribute('accept') === wider) input.setAttribute('accept', accept);
    }, 0);
  }

  /**
   * The file input that belongs to the area files were dropped on: the only one inside
   * the nearest enclosing element that has one. Several candidates mean the rules are
   * ambiguous, and none means there are no rules to read; either way, the drop is left
   * alone.
   */
  function fieldForDrop(target: Element): HTMLInputElement | undefined {
    // Dropzone.js, one of the most used upload libraries, keeps its input at the end of
    // <body>, apart from its drop area. With exactly one on the page, it is unambiguous.
    if (target.closest('.dropzone, .dz-clickable')) {
      const inputs = document.querySelectorAll('input.dz-hidden-input');
      return inputs.length === 1 && adapter.matches(inputs[0]) ? inputs[0] : undefined;
    }
    let node: Element | null = target;
    for (let steps = 0; node && steps < 8 && !node.matches('body, html'); steps++) {
      const inputs = node.querySelectorAll('input[type="file" i]');
      if (inputs.length > 1) return undefined;
      const input = inputs[0];
      if (input) return adapter.matches(input) ? input : undefined;
      node = node.parentElement ?? (node.getRootNode() as ShadowRoot).host ?? null;
    }
    return undefined;
  }

  /**
   * Files dropped on an upload area, the other way people upload. The drop is held back
   * like a choice in a picker, then replayed on the same spot with the prepared files.
   */
  function onDrop(event: DragEvent): void {
    if (ours.has(event) || !enabled()) return;
    const target = event.composedPath()[0];
    // A drop onto a file input itself becomes an ordinary choice, handled above.
    if (!(target instanceof Element) || adapter.matches(target)) return;
    const files = Array.from(event.dataTransfer?.files ?? []);
    if (!files.length || files.length > LIMITS.maxFiles) return;
    if (files.reduce((total, file) => total + file.size, 0) > LIMITS.maxSelectionBytes) return;
    try {
      const input = fieldForDrop(target);
      if (!input) return;
      const requirements = detectRequirements(input);
      if (!files.some((file) => mightNeedWork(file, requirements))) return;
      if (dropSession) cancel(dropSession);
      const session: Session = {
        input,
        original: files,
        controller: new AbortController(),
        held: [],
        drop: { target, position: dropPosition(event) },
      };
      // Without this the browser would open the dropped file in the tab.
      event.preventDefault();
      event.stopImmediatePropagation();
      dropSession = session;
      track(session);
      void run(session, requirements);
    } catch {
      logger.warn('detection-failed');
    }
  }

  /** Someone is dragging files over the page: get the decoders ready. */
  function onDragEnter(event: DragEvent): void {
    if (enabled() && event.dataTransfer?.types.includes('Files')) deps.warm?.();
  }

  function submit(event: Event): void {
    const form = event.target;
    if (
      !(form instanceof HTMLFormElement) ||
      ![...active].some((session) => !session.drop && session.input.form === form)
    )
      return;
    // Wait for the prepared file, then submit exactly as the person asked.
    event.preventDefault();
    event.stopImmediatePropagation();
    pendingSubmits.set(form, (event as SubmitEvent).submitter);
  }

  function leave(): void {
    for (const session of active) cancel(session);
    pendingSubmits.clear();
  }

  window.addEventListener('click', onPickerClick, true);
  window.addEventListener('dragenter', onDragEnter, true);
  window.addEventListener('drop', onDrop, true);
  window.addEventListener('input', capture, true);
  window.addEventListener('change', capture, true);
  window.addEventListener('submit', submit, true);
  window.addEventListener('pagehide', leave);
  return () => {
    leave();
    window.removeEventListener('click', onPickerClick, true);
    window.removeEventListener('dragenter', onDragEnter, true);
    window.removeEventListener('drop', onDrop, true);
    window.removeEventListener('input', capture, true);
    window.removeEventListener('change', capture, true);
    window.removeEventListener('submit', submit, true);
    window.removeEventListener('pagehide', leave);
    for (const root of shadowRoots) {
      root.removeEventListener('input', capture, true);
      root.removeEventListener('change', capture, true);
    }
    shadowRoots.clear();
  };
}
