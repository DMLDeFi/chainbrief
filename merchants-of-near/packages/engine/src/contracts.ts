import { MARKETS, RESOURCES, RESOURCE_DEFS, TIME, type MarketId, type Resource } from './config';
import { CITY_DEFS } from './cities';
import type { PlayerState, Result, WorldState } from './types';
import { addInv, clamp, fail, money, newId, ok, pushFeed } from './internal';
import { hasAccess, storeFor } from './logistics';
import { bumpMetric } from './progression';
import { unitPrice } from './market';

/**
 * Delivery contracts: towns and merchants post jobs ("deliver 20 bread to
 * Kingsreach"). A player accepts one, brings the goods to that city's store
 * before the deadline and is paid by the city's purse (so no gold is created),
 * earning reputation and XP. The goods go into the city's exchange, easing the
 * shortage that caused the job. Missing a deadline costs reputation.
 */
export interface DeliveryContract {
  id: string;
  city: MarketId;
  issuer: string;
  resource: Resource;
  qty: number;
  reward: number;
  rep: number;
  xp: number;
  postedTick: number;
  /** An open job is withdrawn at this tick if nobody takes it. */
  expiresTick: number;
  /** Days allowed to deliver once accepted. */
  days: number;
  status: 'open' | 'taken' | 'done' | 'failed' | 'expired';
  takerId?: string;
  dueTick?: number;
  doneTick?: number;
}

export const CONTRACTS = {
  openPerCity: 3,
  maxActive: 3,
  listingDays: 3,
  premium: [1.3, 1.6] as const,
  /** A job never asks for more than this share of the city's purse. */
  maxPurseShare: 0.2,
  failRep: 3,
  abandonRep: 2,
};

const ISSUERS: Record<MarketId, string[]> = {
  nearhaven: ['Baker Mara', 'Old Tobin', 'Smith Brunhild', 'the Gilded Tankard', 'the Nearhaven guild hall'],
  aurora: ['the Harbourmaster', 'the Aurora shipwrights', 'Captain Ysolde', 'the Fish Market'],
  kingsreach: ['the Royal Quartermaster', 'the Crown Palace kitchens', 'the Royal Guard', 'the Cathedral stewards'],
  emberforge: ['the Great Foundry', 'the Ironworks foreman', 'the Workers’ Hall', 'the Weavers’ Mill'],
  goldenvale: ['the Valley Granary', 'the Vale Brewhouse', 'the Long Barn', 'Miller Hode'],
  deepcrag: ['the Main Shaft overseer', 'the Miners’ Lodge', 'the Assay Office', 'the Crag Smelter'],
};

const list = (w: WorldState) => (w.contracts ??= {});

/**
 * Contracts draw from their own deterministic sequence (seeded by world seed,
 * tick and slot) instead of the world's RNG, so posting jobs never changes the
 * rest of the simulation.
 */
function jobRng(w: WorldState, salt: number) {
  let h = (w.seed ^ Math.imul(w.tick + 1, 2654435761) ^ Math.imul(salt + 7, 40503)) >>> 0;
  return (min: number, max: number) => {
    h = (Math.imul(h ^ (h >>> 15), 2246822507) + 0x9e3779b9) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 3266489909) >>> 0;
    return min + (((h ^ (h >>> 16)) >>> 0) / 4294967296) * (max - min);
  };
}

/** How much a city wants a good right now: price against base, so shortages post jobs first. */
function wantScore(w: WorldState, city: MarketId, r: Resource): number {
  const m = w.markets[city];
  return m.price[r] / RESOURCE_DEFS[r].basePrice;
}

/** Post new jobs so each city has a few open. Called daily (and once on a new world). */
export function postContracts(w: WorldState): void {
  const all = list(w);
  for (const city of MARKETS) {
    const open = Object.values(all).filter((c) => c.city === city && c.status === 'open').length;
    for (let i = open; i < CONTRACTS.openPerCity; i++) {
      const randRange = (_w: WorldState, a: number, b: number) => rand(a, b);
      const rand = jobRng(w, MARKETS.indexOf(city) * 31 + i * 7 + Object.keys(all).length);
      const m = w.markets[city];
      // Weighted toward the goods the city is short of, one job per good, and in Nearhaven
      // always one cheap starter job a newcomer with 100 gold can fill.
      const here = Object.values(all).filter((c) => c.city === city && c.status === 'open');
      const usedGoods = new Set(here.map((c) => c.resource));
      const starterNeeded = city === 'nearhaven' && !here.some((c) => RESOURCE_DEFS[c.resource].basePrice <= 5);
      const pool = RESOURCES.filter((r) => !usedGoods.has(r) && (!starterNeeded || RESOURCE_DEFS[r].basePrice <= 5));
      if (!pool.length) continue;
      const scored = pool.map((r) => ({ r, s: Math.pow(Math.max(0.2, wantScore(w, city, r)), 2) }));
      const total = scored.reduce((s, x) => s + x.s, 0);
      let roll = randRange(w, 0, total), r = scored[0].r;
      for (const x of scored) { roll -= x.s; if (roll <= 0) { r = x.r; break; } }
      const price = unitPrice(m, r, m.stock[r]);
      const premium = randRange(w, CONTRACTS.premium[0], CONTRACTS.premium[1]);
      // Size the job to what the city can pay: dear goods come in smaller lots.
      const cap = Math.max(0, m.treasury) * CONTRACTS.maxPurseShare;
      const affordable = Math.floor(cap / (price * premium) / 5) * 5;
      if (affordable < 5) continue;
      const wanted = Math.round(randRange(w, 10, 36) * Math.min(1.6, 6 / Math.max(2, price)) / 5) * 5;
      const qty = clamp(wanted, 5, affordable);
      const reward = money(qty * price * premium);
      if (reward < 10) continue;
      const usedIssuers = new Set(here.map((c) => c.issuer));
      const issuers = ISSUERS[city].filter((x) => !usedIssuers.has(x));
      const names = issuers.length ? issuers : ISSUERS[city];
      const issuer = names[Math.floor(randRange(w, 0, names.length - 0.001))];
      const id = newId(w, 'ct');
      all[id] = {
        id, city, issuer, resource: r, qty, reward,
        rep: clamp(Math.round(2 + reward / 60), 2, 6),
        xp: clamp(Math.round(10 + reward / 8), 10, 90),
        postedTick: w.tick, expiresTick: w.tick + CONTRACTS.listingDays * TIME.ticksPerDay,
        days: Math.round(randRange(w, 2, 5.4)),
        status: 'open',
      };
    }
  }
}

const active = (w: WorldState, playerId: string) => Object.values(list(w)).filter((c) => c.status === 'taken' && c.takerId === playerId);

export function acceptContract(w: WorldState, playerId: string, id: unknown): Result<DeliveryContract> {
  const p = w.players[playerId];
  if (!p) return fail('Unknown player');
  const c = typeof id === 'string' ? list(w)[id] : undefined;
  if (!c || c.status !== 'open') return fail('That job is no longer available');
  if (!hasAccess(p, c.city)) return fail(`Open a trading office in ${CITY_DEFS[c.city].name} to take jobs there`);
  if (active(w, playerId).length >= CONTRACTS.maxActive) return fail(`You can hold ${CONTRACTS.maxActive} jobs at once. Deliver or abandon one first`);
  c.status = 'taken';
  c.takerId = playerId;
  c.dueTick = w.tick + c.days * TIME.ticksPerDay;
  return ok(c);
}

export function deliverContract(w: WorldState, playerId: string, id: unknown): Result<DeliveryContract> {
  const p = w.players[playerId];
  if (!p) return fail('Unknown player');
  const c = typeof id === 'string' ? list(w)[id] : undefined;
  if (!c || c.status !== 'taken' || c.takerId !== playerId) return fail('That is not one of your jobs');
  const store = storeFor(p, c.city);
  const have = store[c.resource] ?? 0;
  const city = CITY_DEFS[c.city].name;
  if (have < c.qty) return fail(`You have ${Math.floor(have)} of ${c.qty} ${RESOURCE_DEFS[c.resource].label.toLowerCase()} in ${c.city === 'nearhaven' ? 'your warehouse' : `your ${city} depot`}`);
  const m = w.markets[c.city];
  if (m.treasury - 50 < c.reward) return fail(`${city} cannot pay this job right now. Try again later`);
  addInv(store, c.resource, -c.qty);
  m.stock[c.resource] = (m.stock[c.resource] ?? 0) + c.qty; // the delivery eases the shortage
  m.treasury = money(m.treasury - c.reward);
  p.gold = money(p.gold + c.reward);
  p.reputation = clamp(p.reputation + c.rep, 0, 100);
  p.xp += c.xp;
  bumpMetric(p, 'contracts', 1);
  c.status = 'done';
  c.doneTick = w.tick;
  w.ledger.push({ tick: w.tick, playerId, type: 'contract.deliver', goldDelta: c.reward, items: { [c.resource]: -c.qty }, details: { contractId: c.id, city: c.city, issuer: c.issuer } });
  pushFeed(w, { kind: 'player', actor: playerId, market: c.city, text: `${p.name} delivered ${c.qty} ${RESOURCE_DEFS[c.resource].label.toLowerCase()} to ${c.issuer} in ${city} and was paid ${c.reward}g.`, severity: 'good' });
  return ok(c);
}

export function abandonContract(w: WorldState, playerId: string, id: unknown): Result<DeliveryContract> {
  const p = w.players[playerId];
  if (!p) return fail('Unknown player');
  const c = typeof id === 'string' ? list(w)[id] : undefined;
  if (!c || c.status !== 'taken' || c.takerId !== playerId) return fail('That is not one of your jobs');
  c.status = 'failed';
  p.reputation = clamp(p.reputation - CONTRACTS.abandonRep, 0, 100);
  return ok(c);
}

/** Daily: withdraw stale listings, fail overdue jobs, prune history, post new jobs. */
export function contractsDaily(w: WorldState): void {
  const all = list(w);
  for (const c of Object.values(all)) {
    if (c.status === 'open' && w.tick >= c.expiresTick) c.status = 'expired';
    if (c.status === 'taken' && c.dueTick !== undefined && w.tick >= c.dueTick) {
      c.status = 'failed';
      const p: PlayerState | undefined = c.takerId ? w.players[c.takerId] : undefined;
      if (p) {
        p.reputation = clamp(p.reputation - CONTRACTS.failRep, 0, 100);
        pushFeed(w, { kind: 'player', actor: p.id, market: c.city, text: `${p.name} missed a delivery for ${c.issuer} in ${CITY_DEFS[c.city].name}.`, severity: 'bad' });
      }
    }
  }
  const finished = Object.values(all).filter((c) => c.status !== 'open' && c.status !== 'taken').sort((a, b) => b.postedTick - a.postedTick);
  for (const c of finished.slice(60)) delete all[c.id];
  postContracts(w);
}

/** Public view: open jobs and jobs in progress (with the taker's name). */
export function contractsView(w: WorldState) {
  return Object.values(list(w))
    .filter((c) => c.status === 'open' || c.status === 'taken')
    .map((c) => ({ ...c, taker: c.takerId ? w.players[c.takerId]?.name ?? '?' : undefined }));
}
