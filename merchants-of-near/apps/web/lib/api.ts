'use client';
import type { PlayerView, PublicSnapshot } from '@mon/engine';

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export async function api<T = unknown>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: init?.method ?? (init?.body !== undefined ? 'POST' : 'GET'),
    headers: init?.body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    credentials: 'same-origin',
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(data?.error ?? `Request failed (${res.status})`, res.status);
  return data as T;
}

/** Send a game action. Each call gets a fresh idempotency key; the server applies it at most once. */
export async function action<T = unknown>(payload: Record<string, unknown>): Promise<T> {
  const r = await api<{ ok: boolean; data?: T; error?: string }>('/action', { body: { requestId: crypto.randomUUID(), action: payload } });
  return r.data as T;
}

export interface Me {
  user: { id: string; username: string; nearAccountId: string | null };
  player: PlayerView;
}
export type { PublicSnapshot, PlayerView };
