import { useCallback, useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import type { Settings, Stats } from '../models';
import {
  DEFAULT_SETTINGS,
  loadSettings,
  normalizeSettings,
  saveSettings,
  SETTINGS_KEY,
} from '../settings';
import { loadProblems, normalizeProblems, type Problem, PROBLEMS_KEY } from '../storage/problems';
import {
  loadSessionCount,
  loadStats,
  normalizeStats,
  SESSION_COUNT_KEY,
  STATS_KEY,
} from '../storage/stats';

type StorageChanges = Record<string, { newValue?: unknown }>;

function useStorage(listener: (changes: StorageChanges, area: string) => void): void {
  useEffect(() => {
    browser.storage.onChanged.addListener(listener);
    return () => browser.storage.onChanged.removeListener(listener);
  }, [listener]);
}

export function useSettings() {
  const [settings, setSettings] = useState<Settings>({ ...DEFAULT_SETTINGS });
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    loadSettings()
      .then(setSettings)
      .catch(() => setError('Your preferences couldn’t be loaded. Please reopen this page.'))
      .finally(() => setReady(true));
  }, []);
  useStorage(
    useCallback((changes: StorageChanges, area: string) => {
      if (area === 'local' && changes[SETTINGS_KEY])
        setSettings(normalizeSettings(changes[SETTINGS_KEY].newValue));
    }, []),
  );
  const update = useCallback(async (patch: Partial<Settings>) => {
    setError('');
    try {
      setSettings(await saveSettings(patch));
    } catch {
      setError('That change couldn’t be saved. Please try again.');
    }
  }, []);
  return { settings, update, ready, error };
}

export function useStats() {
  const [stats, setStats] = useState<Stats>(normalizeStats({}));
  const [session, setSession] = useState(0);
  useEffect(() => {
    void loadStats()
      .then(setStats)
      .catch(() => {});
    void loadSessionCount().then(setSession);
  }, []);
  useStorage(
    useCallback((changes: StorageChanges, area: string) => {
      if (area === 'local' && changes[STATS_KEY])
        setStats(normalizeStats(changes[STATS_KEY].newValue));
      if (area === 'session' && changes[SESSION_COUNT_KEY])
        setSession(Number(changes[SESSION_COUNT_KEY].newValue) || 0);
    }, []),
  );
  return { stats, session };
}

export function useProblems() {
  const [problems, setProblems] = useState<Problem[]>([]);
  useEffect(() => {
    void loadProblems()
      .then(setProblems)
      .catch(() => {});
  }, []);
  useStorage(
    useCallback((changes: StorageChanges, area: string) => {
      if (area === 'local' && changes[PROBLEMS_KEY])
        setProblems(normalizeProblems(changes[PROBLEMS_KEY].newValue));
    }, []),
  );
  return problems;
}
