import { browser } from 'wxt/browser';
import type { ImageFormat } from '../models';
import { FORMATS } from '../formats';
import { ERROR_CODES, type ErrorCode } from '../utils/errors';

// A short technical log of recent problems, kept on this device so a person can choose
// to send it with a problem report. It never holds images, file names or website
// addresses, and nothing leaves the device unless the person copies it.

export const PROBLEMS_KEY = 'problems';
const MAX_PROBLEMS = 20;
const MAX_RULES = 160;

export interface Problem {
  /** When it happened, to the minute. */
  at: string;
  code: ErrorCode;
  /** The chosen image's format, and its size rounded to two significant figures. */
  format: ImageFormat;
  bytes: number;
  /** The upload field's rules as Just Upload read them, e.g. "JPG, PNG · max 2 MB". */
  rules: string;
}

const KNOWN_CODES = new Set<string>(ERROR_CODES);
const KNOWN_FORMATS = new Set<string>([...Object.keys(FORMATS), 'unknown']);

/** Two significant figures: enough to reproduce a problem, too few to identify a file. */
export function roundBytes(bytes: number): number {
  if (!Number.isFinite(bytes) || bytes <= 0) return 0;
  const magnitude = 10 ** Math.max(0, Math.floor(Math.log10(bytes)) - 1);
  return Math.round(bytes / magnitude) * magnitude;
}

/** Control characters become spaces, so stored text cannot break a report's layout. */
const printable = (text: string) =>
  Array.from(text, (char) => {
    const code = char.charCodeAt(0);
    return code < 32 || code === 127 ? ' ' : char;
  }).join('');

/** Storage and messages are untrusted shapes: rebuild each entry field by field. */
export function normalizeProblem(value: unknown): Problem | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const entry = value as Record<string, unknown>;
  const at =
    typeof entry.at === 'string' && !Number.isNaN(Date.parse(entry.at)) ? entry.at : undefined;
  const code =
    typeof entry.code === 'string' && KNOWN_CODES.has(entry.code) ? entry.code : undefined;
  if (!at || !code) return undefined;
  return {
    at,
    code: code as ErrorCode,
    format:
      typeof entry.format === 'string' && KNOWN_FORMATS.has(entry.format)
        ? (entry.format as ImageFormat)
        : 'unknown',
    bytes: roundBytes(typeof entry.bytes === 'number' ? entry.bytes : 0),
    rules: typeof entry.rules === 'string' ? printable(entry.rules).slice(0, MAX_RULES) : '',
  };
}

export function normalizeProblems(value: unknown): Problem[] {
  return (Array.isArray(value) ? value : [])
    .map(normalizeProblem)
    .filter((problem): problem is Problem => Boolean(problem))
    .slice(-MAX_PROBLEMS);
}

export async function loadProblems(): Promise<Problem[]> {
  return normalizeProblems((await browser.storage.local.get(PROBLEMS_KEY))[PROBLEMS_KEY]);
}

/** Adds a problem, keeping only the most recent ones. */
export function withProblem(problems: Problem[], problem: Problem): Problem[] {
  return [...problems, problem].slice(-MAX_PROBLEMS);
}

export async function clearProblems(): Promise<void> {
  await browser.storage.local.remove(PROBLEMS_KEY);
}
