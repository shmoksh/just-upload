import { browser } from 'wxt/browser';

// Two ways people can tell us how Just Upload is doing, with no tracking: a quiet
// suggestion to rate it, once, after it has helped a few times; and an optional form when
// they uninstall it. Nothing is ever sent automatically.

/**
 * A short, optional form that opens in the browser when someone uninstalls Just Upload.
 * Nothing is attached to it. Left empty until the form exists.
 */
export const UNINSTALL_FORM_URL = '';

/** Fixes before the popup suggests rating Just Upload. */
export const RATE_AFTER_FIXES = 10;
/** Whether the suggestion was answered ("rated" or "dismissed"); it is never shown again. */
export const RATE_PROMPT_KEY = 'ratePrompt';

/**
 * The store page where people rate Just Upload, for a copy installed from a store; an
 * unpacked copy has none. Edge's own store for Edge, the Chrome Web Store otherwise.
 */
export function reviewPageFor(
  installType: string,
  brands: readonly string[],
  id: string,
): string | undefined {
  if (installType !== 'normal') return undefined;
  return brands.some((brand) => /edge/i.test(brand))
    ? `https://microsoftedge.microsoft.com/addons/detail/${id}`
    : `https://chromewebstore.google.com/detail/${id}/reviews`;
}

export function shouldSuggestRating(fixes: number, answered: unknown): boolean {
  return fixes >= RATE_AFTER_FIXES && !answered;
}

/** Where this copy of Just Upload can be rated, if anywhere. */
export async function reviewPageUrl(): Promise<string | undefined> {
  try {
    const { installType } = await browser.management.getSelf();
    const brands =
      (
        navigator as Navigator & { userAgentData?: { brands?: { brand: string }[] } }
      ).userAgentData?.brands?.map(({ brand }) => brand) ?? [];
    return reviewPageFor(installType, brands, browser.runtime.id);
  } catch {
    return undefined;
  }
}
