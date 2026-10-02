import { browser } from 'wxt/browser';
import type { Settings } from '../models';

export const SETTINGS_KEY = 'settings';

export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze({
  enabled: true,
  showNotifications: true,
  askBeforeQualityChanges: true,
  disabledSites: [],
});

const HOSTNAME = /^[a-z0-9.:[\]-]{1,253}$/i;

/** Storage is user-controlled data; rebuild it field by field with safe defaults. */
export function normalizeSettings(value: unknown): Settings {
  const stored = (value && typeof value === 'object' ? value : {}) as Partial<
    Record<keyof Settings, unknown>
  >;
  const flag = (key: 'enabled' | 'showNotifications' | 'askBeforeQualityChanges') =>
    typeof stored[key] === 'boolean' ? (stored[key] as boolean) : DEFAULT_SETTINGS[key];
  const sites = Array.isArray(stored.disabledSites) ? stored.disabledSites : [];
  return {
    enabled: flag('enabled'),
    showNotifications: flag('showNotifications'),
    askBeforeQualityChanges: flag('askBeforeQualityChanges'),
    disabledSites: [
      ...new Set(
        sites
          .filter((site): site is string => typeof site === 'string' && HOSTNAME.test(site))
          .map((site) => site.toLowerCase()),
      ),
    ].slice(0, 500),
  };
}

export async function loadSettings(): Promise<Settings> {
  return normalizeSettings((await browser.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY]);
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = normalizeSettings({ ...(await loadSettings()), ...patch });
  await browser.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}

/** A site is paused if the frame's own host or any page embedding it is paused. */
export function isActiveOn(settings: Settings, hostnames: readonly string[]): boolean {
  return (
    settings.enabled &&
    !hostnames.some((host) => settings.disabledSites.includes(host.toLowerCase()))
  );
}

/** This frame's hostname plus the hostnames of the pages that embed it. */
export function frameHostnames(): string[] {
  const hosts = [location.hostname];
  for (const origin of Array.from(location.ancestorOrigins ?? [])) {
    try {
      hosts.push(new URL(origin).hostname);
    } catch {
      // Opaque origins have no hostname.
    }
  }
  return hosts.filter(Boolean);
}
