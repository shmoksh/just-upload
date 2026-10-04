import { describe, expect, it } from 'vitest';
import { RATE_AFTER_FIXES, reviewPageFor, shouldSuggestRating } from '../../src/feedback';

describe('asking for a rating, without tracking', () => {
  const id = 'abcdefghijklmnopabcdefghijklmnop';
  it('points to the store the extension came from, and only for a store install', () => {
    expect(reviewPageFor('normal', ['Google Chrome', 'Chromium'], id)).toBe(
      `https://chromewebstore.google.com/detail/${id}/reviews`,
    );
    expect(reviewPageFor('normal', ['Microsoft Edge', 'Chromium'], id)).toBe(
      `https://microsoftedge.microsoft.com/addons/detail/${id}`,
    );
    // An unpacked copy has no store page.
    expect(reviewPageFor('development', ['Google Chrome'], id)).toBeUndefined();
  });
  it('suggests it once, only after it has helped a few times', () => {
    expect(shouldSuggestRating(RATE_AFTER_FIXES - 1, undefined)).toBe(false);
    expect(shouldSuggestRating(RATE_AFTER_FIXES, undefined)).toBe(true);
    expect(shouldSuggestRating(50, 'dismissed')).toBe(false);
    expect(shouldSuggestRating(50, 'rated')).toBe(false);
  });
});
