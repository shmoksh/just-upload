/**
 * Codes, not messages, cross process boundaries. They never contain file names,
 * page text, or image data, and the UI maps them to calm, human copy.
 */
export const ERROR_CODES = [
  'empty-file',
  'damaged',
  'unsupported-format',
  'too-large-to-process',
  'needs-crop',
  'needs-upscale',
  'needs-transparency-consent',
  'needs-animation-consent',
  'target-unreachable',
  'rules-conflict',
  'encode-unsupported',
  'timeout',
  'busy',
  'cancelled',
  'failed',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

const KNOWN = new Set<string>(ERROR_CODES);

export class ProcessingError extends Error {
  constructor(readonly code: ErrorCode) {
    super(code);
    this.name = 'ProcessingError';
  }
}

export function fail(code: ErrorCode): never {
  throw new ProcessingError(code);
}

export function errorCode(error: unknown): ErrorCode {
  if (error instanceof ProcessingError) return error.code;
  if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled';
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  return KNOWN.has(message) ? (message as ErrorCode) : 'failed';
}
