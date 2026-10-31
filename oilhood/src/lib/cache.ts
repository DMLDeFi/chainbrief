const store = new Map<string, { at: number; value: unknown }>();

/** Tiny in-memory TTL cache so upstream feeds aren't hit on every request. */
export async function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const hit = store.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value as T;
  const value = await load();
  store.set(key, { at: Date.now(), value });
  return value;
}

export async function fetchWithTimeout(url: string, init: RequestInit = {}, ms = 6000) {
  const res = await fetch(url, {
    ...init,
    cache: "no-store",
    signal: AbortSignal.timeout(ms),
    headers: { "User-Agent": "Mozilla/5.0 (OilHood Terminal)", ...init.headers },
  });
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res;
}
