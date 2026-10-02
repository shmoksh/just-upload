import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import {
  addFixes,
  isChangeList,
  loadStats,
  SESSION_COUNT_KEY,
  STATS_KEY,
  loadSessionCount,
} from '../src/storage/stats';
import { LIMITS } from '../src/security/limits';
import { loadProblems, normalizeProblem, PROBLEMS_KEY, withProblem } from '../src/storage/problems';
import { isSerializedFile } from '../src/utils/files';
import { logger } from '../src/utils/logger';

const MAX_TRACKED_JOBS = 8;
/** Longer than a job's own limit, so the offscreen page normally answers first. */
const WATCHDOG_MS = LIMITS.processingMs + 15_000;

const delay = (ms: number) =>
  new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), ms));
const JOB_ID = /^[0-9a-f]{24}$/;
/** How long a content script has to connect its frame with a token. */
const TOKEN_MS = 30_000;
const MAX_TOKENS = 64;

export default defineBackground(() => {
  /** Job id → the frame that asked for it; only that frame may cancel it. */
  const jobs = new Map<string, string>();
  /** One-time tokens for connecting the in-page processor frame → when they expire. */
  const tokens = new Map<string, number>();
  let creating: Promise<void> | undefined;
  let statsQueue: Promise<void> = Promise.resolve();

  async function ensureOffscreen(): Promise<void> {
    creating ??= (async () => {
      const existing = await browser.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
      if (!existing.length) {
        await browser.offscreen.createDocument({
          url: 'offscreen.html',
          reasons: ['WORKERS', 'BLOBS'],
          justification:
            'Prepares images the person selected, locally, in a worker away from the website.',
        });
      }
    })().finally(() => {
      creating = undefined;
    });
    return creating;
  }

  /**
   * Workers are stopped by the offscreen page's own timer, but a page whose thread is
   * stuck (for example rendering a pathological SVG) cannot run that timer. If it
   * doesn't answer a ping either, close it; the next job gets a fresh one.
   */
  async function recoverIfStuck(): Promise<void> {
    const pong = await Promise.race([
      browser.runtime.sendMessage({ target: 'offscreen', kind: 'ping' }).catch(() => undefined),
      delay(2_000),
    ]);
    if (pong === undefined) await browser.offscreen.closeDocument().catch(() => {});
  }

  function recordFixes(changes: Parameters<typeof addFixes>[1]): void {
    // Serialized so two quick fixes cannot overwrite each other's count.
    statsQueue = statsQueue
      .then(async () => {
        const stats = addFixes(await loadStats(), changes);
        await browser.storage.local.set({ [STATS_KEY]: stats });
        await browser.storage.session.set({
          [SESSION_COUNT_KEY]: (await loadSessionCount()) + changes.length,
        });
      })
      .catch(() => logger.warn('stats-failed'));
  }

  browser.runtime.onMessage.addListener(
    (message: Record<string, unknown> | undefined, sender, sendResponse) => {
      if (sender.id !== browser.runtime.id || message?.target !== 'background') return;
      if (message.kind === 'warm') {
        void ensureOffscreen()
          .then(() => browser.runtime.sendMessage({ target: 'offscreen', kind: 'warm' }))
          .catch(() => {});
        return;
      }
      if (message.kind === 'fixed') {
        if (isChangeList(message.changes)) recordFixes(message.changes);
        return;
      }
      if (message.kind === 'problem') {
        const problem = normalizeProblem(message.problem);
        if (problem && sender.tab) {
          // Serialized like the counts, so two quick problems cannot overwrite each other.
          statsQueue = statsQueue
            .then(async () =>
              browser.storage.local.set({
                [PROBLEMS_KEY]: withProblem(await loadProblems(), problem),
              }),
            )
            .catch(() => logger.warn('problems-failed'));
        }
        return;
      }
      if (message.kind === 'open-problems') {
        if (sender.tab)
          void browser.tabs.create({ url: `${browser.runtime.getURL('/options.html')}#problems` });
        return;
      }
      // The content script, in a website, asks for a token for its processor frame...
      if (message.kind === 'processor-token') {
        if (!sender.tab) return;
        const now = Date.now();
        for (const [token, expires] of tokens) if (expires < now) tokens.delete(token);
        if (tokens.size >= MAX_TOKENS) {
          sendResponse({});
          return;
        }
        const token = Array.from(crypto.getRandomValues(new Uint8Array(24)), (byte) =>
          byte.toString(16).padStart(2, '0'),
        ).join('');
        tokens.set(token, now + TOKEN_MS);
        sendResponse({ token });
        return;
      }
      // ...and only Just Upload's own frame page can redeem it, once.
      if (message.kind === 'processor-verify') {
        const token = typeof message.token === 'string' ? message.token : '';
        const expires = tokens.get(token);
        tokens.delete(token);
        // The frame reports the extension's real address; getURL would give the session's
        // dynamic one, which is only for loading it.
        const ours = sender.url === `chrome-extension://${browser.runtime.id}/processor.html`;
        sendResponse({ ok: ours && expires !== undefined && expires >= Date.now() });
        return;
      }
      const id = message.id;
      if (typeof id !== 'string' || !JOB_ID.test(id)) return;
      const owner = `${sender.tab?.id ?? 'extension'}:${sender.frameId ?? 0}:${sender.documentId ?? ''}`;
      if (message.kind === 'cancel') {
        if (jobs.get(id) === owner)
          void browser.runtime
            .sendMessage({ target: 'offscreen', kind: 'cancel', id })
            .catch(() => {});
        return;
      }
      if (
        (message.kind !== 'prepare' && message.kind !== 'transform') ||
        !isSerializedFile(message.file)
      )
        return;
      if (jobs.size >= MAX_TRACKED_JOBS || jobs.has(id)) {
        sendResponse({ ok: false, error: 'busy' });
        return;
      }
      jobs.set(id, owner);
      void (async () => {
        try {
          await ensureOffscreen();
          const { kind, file, requirements, preferences, options } = message;
          const reply = await Promise.race([
            browser.runtime.sendMessage({
              target: 'offscreen',
              kind,
              id,
              file,
              requirements,
              preferences,
              options,
            }),
            delay(WATCHDOG_MS),
          ]);
          if (reply === undefined) {
            await recoverIfStuck();
            return { ok: false, error: 'timeout' };
          }
          return reply;
        } catch {
          logger.warn('offscreen-failed');
          return { ok: false, error: 'failed' };
        } finally {
          jobs.delete(id);
        }
      })().then(sendResponse);
      return true;
    },
  );

  browser.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install')
      void browser.tabs.create({ url: browser.runtime.getURL('/onboarding.html') });
  });
});
