import type { MarketId } from './config';
import type { Business, WorldState } from './types';

/**
 * A per-tick index of businesses by owner and by city. Many rules need "this
 * player's businesses" or "businesses in this city"; scanning every business in
 * the world for each of them made the daily cycle quadratic in the number of
 * businesses. The index is rebuilt at most once per tick (or when a business is
 * created, sold or changes hands) and is never saved.
 */
interface Index { tick: number; count: number; byOwner: Map<string, Business[]>; byCity: Map<MarketId, Business[]> }
const cache = new WeakMap<WorldState, Index>();

export function invalidateBizIndex(world: WorldState): void {
  cache.delete(world);
}

function build(world: WorldState): Index {
  const byOwner = new Map<string, Business[]>();
  const byCity = new Map<MarketId, Business[]>();
  const all = Object.values(world.businesses);
  for (const b of all) {
    let o = byOwner.get(b.ownerId);
    if (!o) byOwner.set(b.ownerId, (o = []));
    o.push(b);
    const c = (b.city ?? 'nearhaven') as MarketId;
    let l = byCity.get(c);
    if (!l) byCity.set(c, (l = []));
    l.push(b);
  }
  return { tick: world.tick, count: all.length, byOwner, byCity };
}

function index(world: WorldState): Index {
  let ix = cache.get(world);
  // Rebuilt every tick; creating, selling or transferring a business invalidates it at once.
  if (!ix || ix.tick !== world.tick) {
    ix = build(world);
    cache.set(world, ix);
  }
  return ix;
}

const NONE: Business[] = [];
/** The player's businesses (shared array: do not mutate). */
export const ownedBy = (world: WorldState, playerId: string): Business[] => index(world).byOwner.get(playerId) ?? NONE;
/** Businesses in a city (shared array: do not mutate). */
export const inCity = (world: WorldState, city: MarketId): Business[] => index(world).byCity.get(city) ?? NONE;
