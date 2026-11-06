'use client';
import { useCallback, useEffect, useState } from 'react';
import { action as sendAction, api } from './api';
import { refreshMe, toast } from './store';
import { gameAudio } from './audio';

/** Run a game action with busy state, toasts and a fresh player view afterwards. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const run = useCallback(async <T,>(payload: Record<string, unknown>, success?: string | ((d: T) => string)): Promise<T | null> => {
    setBusy(true);
    try {
      const data = await sendAction<T>(payload);
      gameAudio.coin();
      if (success) toast(typeof success === 'function' ? success(data) : success, 'good');
      await refreshMe();
      return data;
    } catch (e) {
      gameAudio.thud();
      toast((e as Error).message, 'bad');
      return null;
    } finally {
      setBusy(false);
    }
  }, []);
  return { run, busy };
}

export interface Settings {
  weather: boolean;
  reducedMotion: boolean;
  feed: boolean;
  compactFeed: boolean;
}
const DEFAULT: Settings = { weather: true, reducedMotion: false, feed: true, compactFeed: false };

export function useSettings(): [Settings, (p: Partial<Settings>) => void] {
  const [s, setS] = useState<Settings>(DEFAULT);
  useEffect(() => {
    try {
      const raw = localStorage.getItem('mon.settings');
      if (raw) setS({ ...DEFAULT, ...JSON.parse(raw) });
      else if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) setS({ ...DEFAULT, reducedMotion: true });
    } catch { /* storage unavailable */ }
  }, []);
  const update = useCallback((p: Partial<Settings>) => {
    setS((prev) => {
      const next = { ...prev, ...p };
      try { localStorage.setItem('mon.settings', JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }, []);
  return [s, update];
}

/** Fetch JSON once (and on demand). */
export function useFetch<T>(path: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!path) return;
    try {
      setData(await api<T>(path));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [path]);
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, ...deps]);
  return { data, error, reload: load };
}

let ffCache: boolean | null = null;
/** Whether this server allows fast-forward (public servers usually disable it). Null while loading. */
export function useFastForwardEnabled(): boolean | null {
  const [on, setOn] = useState<boolean | null>(ffCache);
  useEffect(() => {
    if (ffCache !== null) return;
    api<{ fastForward?: boolean }>('/catalog')
      .then((c) => setOn((ffCache = c.fastForward !== false)))
      .catch(() => setOn(null));
  }, []);
  return on;
}
