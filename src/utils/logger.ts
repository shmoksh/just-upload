type LogEvent =
  | 'processing-failed'
  | 'detection-failed'
  | 'stats-failed'
  | 'problems-failed'
  | 'offscreen-failed';

/**
 * Local console only. Messages carry an event name and, at most, an error code:
 * never file names, image data, page text or form values.
 */
export const logger = {
  warn(event: LogEvent, code?: string): void {
    console.warn(`[Just Upload] ${event}${code ? `: ${code}` : ''}`);
  },
};
