'use client';
import { useEffect, useSyncExternalStore } from 'react';
import type { FeedEntry, PublicSnapshot } from '@mon/engine';
import { api, ApiError, type Me } from './api';

/**
 * Client game store. The world arrives over a read-only WebSocket stream; the
 * player's private state is fetched from the authenticated REST API. The
 * client never computes prices or balances itself.
 */
interface State {
  world: PublicSnapshot | null;
  feed: FeedEntry[];
  me: Me | null;
  meLoaded: boolean;
  connected: boolean;
  toasts: Array<{ id: number; text: string; tone: 'good' | 'bad' | 'info' }>;
}

let state: State = { world: null, feed: [], me: null, meLoaded: false, connected: false, toasts: [] };
const listeners = new Set<() => void>();
const set = (patch: Partial<State>) => {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

let ws: WebSocket | null = null;
let meTimer: ReturnType<typeof setTimeout> | null = null;
let toastId = 0;

function wsUrl() {
  const explicit = process.env.NEXT_PUBLIC_WS_URL;
  if (explicit) return explicit;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  // Local dev runs Next on :3000 and the game server on :4000; in production
  // the game server fronts the site, so the stream is on the same origin.
  return location.port === '3000' ? `${proto}://${location.hostname}:4000/ws` : `${proto}://${location.host}/ws`;
}

let polling = false;
function applySnapshot(snap: PublicSnapshot) {
  const known = new Set(state.feed.map((f) => f.id));
  const fresh = snap.feed.filter((f) => !known.has(f.id));
  const feed = [...state.feed, ...fresh].slice(-250);
  set({ world: snap, feed });
  if (state.me) scheduleMe();
}

/** Serverless hosting (Vercel) has no WebSocket stream: fetch the world every two seconds instead. */
function poll() {
  if (polling || typeof window === 'undefined') return;
  polling = true;
  const loop = async () => {
    if (document.hidden) return void setTimeout(loop, 2000);
    try {
      const r = await fetch('/api/world', { cache: 'no-store' });
      if (r.ok) { applySnapshot((await r.json()) as PublicSnapshot); set({ connected: true }); }
      else set({ connected: false });
    } catch {
      set({ connected: false });
    }
    setTimeout(loop, 2000);
  };
  void loop();
}

export function connect() {
  if (process.env.NEXT_PUBLIC_REALTIME === 'poll') return poll();
  if (ws || typeof window === 'undefined') return;
  const sock = new WebSocket(wsUrl());
  ws = sock;
  sock.onopen = () => set({ connected: true });
  sock.onclose = () => {
    ws = null;
    set({ connected: false });
    setTimeout(connect, 2000);
  };
  sock.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type !== 'snapshot') return;
    applySnapshot(msg.data as PublicSnapshot);
  };
}

function scheduleMe() {
  if (meTimer) return;
  meTimer = setTimeout(() => {
    meTimer = null;
    void refreshMe();
  }, 600);
}

export async function refreshMe(): Promise<Me | null> {
  try {
    const me = await api<Me>('/me');
    set({ me, meLoaded: true });
    return me;
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) set({ me: null, meLoaded: true });
    else set({ meLoaded: true });
    return null;
  }
}

export function toast(text: string, tone: 'good' | 'bad' | 'info' = 'info') {
  const id = ++toastId;
  set({ toasts: [...state.toasts, { id, text, tone }].slice(-4) });
  setTimeout(() => set({ toasts: state.toasts.filter((t) => t.id !== id) }), 4200);
}

export function useGame(): State {
  useEffect(() => {
    connect();
    if (!state.meLoaded) void refreshMe();
  }, []);
  return useSyncExternalStore(subscribe, () => state, () => state);
}
