import { RESOURCES, TIME, SEASONS, type Resource, type Season } from './config';
import type { FeedEntry, ResourceMap, WorldState } from './types';

/** Deterministic PRNG (mulberry32). The state lives inside the world so replays are exact. */
export function nextRandom(world: WorldState): number {
  let t = (world.rng = (world.rng + 0x6d2b79f5) >>> 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function randRange(world: WorldState, min: number, max: number): number {
  return min + (max - min) * nextRandom(world);
}

export function pick<T>(world: WorldState, items: readonly T[]): T {
  return items[Math.floor(nextRandom(world) * items.length) % items.length];
}

/** Round to whole copper (1/100 gold). All balances are kept at this precision. */
export const money = (x: number): number => Math.round(x * 100) / 100;
export const round1 = (x: number): number => Math.round(x * 10) / 10;
export const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

export function resourceMap<T>(fn: (r: Resource) => T): ResourceMap<T> {
  const out = {} as ResourceMap<T>;
  for (const r of RESOURCES) out[r] = fn(r);
  return out;
}

export const dayOf = (tick: number): number => Math.floor(tick / TIME.ticksPerDay);
export const hourOf = (tick: number): number => tick % TIME.ticksPerDay;
export const weekOf = (tick: number): number => Math.floor(dayOf(tick) / TIME.daysPerWeek);
export function seasonOf(tick: number): Season {
  return SEASONS[Math.floor(dayOf(tick) / TIME.daysPerSeason) % SEASONS.length];
}

export function newId(world: WorldState, prefix: string): string {
  world.nextId += 1;
  return `${prefix}_${world.nextId.toString(36)}`;
}

export function pushFeed(world: WorldState, entry: Omit<FeedEntry, 'id' | 'tick'>): FeedEntry {
  const full: FeedEntry = { id: ++world.nextFeedId, tick: world.tick, ...entry };
  world.feed.push(full);
  if (world.feed.length > 300) world.feed.splice(0, world.feed.length - 300);
  return full;
}

export const pct = (x: number): string => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}%`;
export const fmt = (x: number): string => (Math.abs(x) >= 100 ? x.toFixed(0) : x.toFixed(2));

export function invTotal(inv: Partial<Record<Resource, number>>): number {
  let n = 0;
  for (const r of RESOURCES) n += inv[r] ?? 0;
  return n;
}

export function addInv(inv: Partial<Record<Resource, number>>, r: Resource, qty: number): void {
  const next = Math.round(((inv[r] ?? 0) + qty) * 100) / 100;
  if (next <= 0.004) delete inv[r];
  else inv[r] = next;
}
