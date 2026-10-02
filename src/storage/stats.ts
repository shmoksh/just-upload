import { browser } from 'wxt/browser';
import type { Stats, TransformChange } from '../models';

// Counts only. No sites, file names or sizes are ever recorded, and nothing leaves
// the device.

export const STATS_KEY = 'stats';
export const SESSION_COUNT_KEY = 'fixedThisSession';

const CHANGES: readonly TransformChange[] = [
  'converted',
  'resized',
  'compressed',
  'cropped',
  'background-added',
  'first-frame',
  'orientation-applied',
];

const count = (value: unknown) =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;

export function normalizeStats(value: unknown): Stats {
  const stored = (value && typeof value === 'object' ? value : {}) as {
    total?: unknown;
    byChange?: Record<string, unknown>;
  };
  const byChange: Stats['byChange'] = {};
  for (const change of CHANGES) {
    const n = count(stored.byChange?.[change]);
    if (n) byChange[change] = n;
  }
  return { total: count(stored.total), byChange };
}

export function isChangeList(value: unknown): value is TransformChange[][] {
  return (
    Array.isArray(value) &&
    value.length <= 32 &&
    value.every(
      (changes) =>
        Array.isArray(changes) &&
        changes.every((change) => CHANGES.includes(change as TransformChange)),
    )
  );
}

export function addFixes(stats: Stats, fixes: TransformChange[][]): Stats {
  const next = normalizeStats(stats);
  next.total += fixes.length;
  for (const change of new Set(fixes.flat())) {
    next.byChange[change] =
      (next.byChange[change] ?? 0) + fixes.filter((changes) => changes.includes(change)).length;
  }
  return next;
}

export async function loadStats(): Promise<Stats> {
  return normalizeStats((await browser.storage.local.get(STATS_KEY))[STATS_KEY]);
}

export async function loadSessionCount(): Promise<number> {
  try {
    return count((await browser.storage.session.get(SESSION_COUNT_KEY))[SESSION_COUNT_KEY]);
  } catch {
    return 0;
  }
}

export async function resetStats(): Promise<void> {
  await browser.storage.local.set({ [STATS_KEY]: normalizeStats({}) });
  await browser.storage.session.set({ [SESSION_COUNT_KEY]: 0 }).catch(() => {});
}
