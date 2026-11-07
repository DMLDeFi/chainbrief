import { MARKET_DEFS, MARKETS, RESOURCE_DEFS, type MarketId, type Resource } from './config';
import { inCity } from './bizIndex';
import type { BusinessKind, CityState, PlayerState, Result, WorldState } from './types';
import { clamp, fail, money, ok, pushFeed } from './internal';
import { CITY_DEFS, freightCost } from './cities';
import { hasAccess, isCity } from './logistics';

/**
 * Cities as living places: population that grows or shrinks with food, jobs
 * and infrastructure; public works that players (and the cities themselves)
 * fund; and a labour market that limits hiring and pushes wages up when work
 * is plentiful and hands are few.
 */
export type InfraKind = 'roads' | 'granary' | 'markethall' | 'housing' | 'workshops';
export const INFRA_KINDS: InfraKind[] = ['granary', 'roads', 'housing', 'markethall', 'workshops'];
export const MAX_INFRA = 3;
export const INFRA: Record<InfraKind, { name: string; baseCost: number; effect: (lv: number, city: MarketId) => string }> = {
  roads: { name: 'Paved roads', baseCost: 1400, effect: (lv) => `Freight to and from the city ${Math.round(10 * lv)}% cheaper` },
  granary: { name: 'Granary', baseCost: 1100, effect: (lv) => `${8 * lv}% more food from the hinterland; famines bite less` },
  markethall: { name: 'Market hall', baseCost: 1800, effect: (lv) => `Exchange fee cut by ${(0.5 * lv).toFixed(1)} points` },
  housing: { name: 'Housing district', baseCost: 1600, effect: (lv, c) => (c === 'nearhaven' ? `Room for ${20 * lv}% more citizens` : `${4 * lv} more building plots, room for ${20 * lv}% more citizens`) },
  workshops: { name: 'Workshop quarter', baseCost: 2000, effect: (lv) => `Workshops, mills and mines here ${8 * lv}% more productive` },
};
const CITY_COST_SCALE: Record<MarketId, number> = { nearhaven: 1, aurora: 1.15, kingsreach: 1.5, emberforge: 1.1, goldenvale: 0.9, deepcrag: 1 };
export const infraCost = (city: MarketId, kind: InfraKind, targetLevel: number) => Math.round(INFRA[kind].baseCost * Math.pow(targetLevel, 1.4) * CITY_COST_SCALE[city]);

export function cityState(world: WorldState, city: MarketId): CityState {
  const c = (world.cities[city] ??= { population: city === 'nearhaven' ? world.population : CITY_DEFS[city].population } as CityState);
  c.infra ??= {};
  c.projects ??= {};
  c.popHistory ??= [];
  c.growth ??= 0;
  return c;
}
export const infraLevel = (world: WorldState, city: MarketId, kind: InfraKind) => world.cities[city]?.infra?.[kind] ?? 0;
export const cityPopulation = (world: WorldState, city: MarketId) => (city === 'nearhaven' ? world.population : world.cities[city]?.population ?? CITY_DEFS[city].population);

/** How many people the city can house before growth stalls. */
export function populationCap(world: WorldState, city: MarketId): number {
  const housing = 1 + 0.2 * infraLevel(world, city, 'housing');
  return Math.round((city === 'nearhaven' ? 1200 : CITY_DEFS[city].population * 1.6) * housing);
}
/** Extra building plots opened by housing districts (outside Nearhaven, whose town map is fixed). */
export const extraPlots = (world: WorldState, city: MarketId) => (city === 'nearhaven' ? 0 : 4 * infraLevel(world, city, 'housing'));

// ---------------------------------------------------------------- labour ---
const PARTICIPATION = 0.1;
/** Hands available to player businesses in a city. */
export const laborSupply = (world: WorldState, city: MarketId) => Math.max(8, Math.floor(cityPopulation(world, city) * PARTICIPATION));
export function laborEmployed(world: WorldState, city: MarketId): number {
  let n = 0;
  for (const b of inCity(world, city)) n += b.workers;
  return n;
}
/** Wages rise once more than 70% of the workforce is employed, up to +60% when every hand is taken. */
export function wageFactor(world: WorldState, city: MarketId): number {
  const use = laborEmployed(world, city) / laborSupply(world, city);
  return 1 + clamp((use - 0.7) * 2, 0, 0.6);
}

// ------------------------------------------------------------- freight ---
/** Freight with the roads of both cities taken into account. */
export function freightFor(world: WorldState, from: MarketId, to: MarketId, qty: number): number {
  const roads = infraLevel(world, from, 'roads') + infraLevel(world, to, 'roads');
  return money(freightCost(from, to, qty) * Math.max(0.5, 1 - 0.05 * roads));
}

/** Workshop quarters lift the output of industry in the city. */
export function civicBoost(world: WorldState, city: MarketId, kind: BusinessKind): number {
  if (['warehouse', 'trading', 'shop'].includes(kind)) return 1;
  return 1 + 0.08 * infraLevel(world, city, 'workshops');
}
/** Granaries add food to the hinterland's output (or, in Nearhaven, bread to the exchange). */
export const granaryFactor = (world: WorldState, city: MarketId) => 1 + 0.08 * infraLevel(world, city, 'granary');
export const FOOD = new Set<Resource>(['bread', 'wheat', 'flour', 'fish', 'livestock']);

// ------------------------------------------------------------- projects ---
function completeLevel(world: WorldState, city: MarketId, kind: InfraKind) {
  const c = cityState(world, city);
  c.infra[kind] = (c.infra[kind] ?? 0) + 1;
  const lv = c.infra[kind]!;
  if (kind === 'markethall') world.markets[city].fee = Math.max(0.01, MARKET_DEFS[city].fee - 0.005 * lv);
  const pr = c.projects[kind];
  const patrons = pr ? Object.entries(pr.contributors).sort((a, b) => b[1] - a[1]) : [];
  for (const [pid] of patrons) { const p = world.players[pid]; if (p) p.reputation = Math.min(100, p.reputation + 3); }
  const top = patrons[0] ? world.players[patrons[0][0]]?.name : null;
  pushFeed(world, { kind: 'event', market: city, text: `${CITY_DEFS[city].name} completed ${INFRA[kind].name.toLowerCase()} (level ${lv})${top ? `, led by ${top}` : ''}: ${INFRA[kind].effect(lv, city).toLowerCase()}.`, severity: 'good' });
  // Anything paid beyond the cost carries into the next level.
  const carry = pr ? Math.max(0, pr.funded - infraCost(city, kind, lv)) : 0;
  c.projects[kind] = { funded: lv < MAX_INFRA ? money(carry) : 0, contributors: {} };
}

function addFunding(world: WorldState, city: MarketId, kind: InfraKind, amount: number, playerId?: string) {
  const c = cityState(world, city);
  const pr = (c.projects[kind] ??= { funded: 0, contributors: {} });
  pr.funded = money(pr.funded + amount);
  if (playerId) pr.contributors[playerId] = money((pr.contributors[playerId] ?? 0) + amount);
  const lv = c.infra[kind] ?? 0;
  if (lv < MAX_INFRA && pr.funded >= infraCost(city, kind, lv + 1)) completeLevel(world, city, kind);
}

/**
 * A player funds a public works project. The money pays builders in that city
 * (it goes into the city's purse), so nothing is created or destroyed; the
 * patron earns reputation, XP and standing with the city.
 */
export function fundProject(world: WorldState, playerId: string, req: { city: unknown; project: unknown; amount: unknown }): Result<{ funded: number; cost: number; level: number }> {
  const p = world.players[playerId];
  if (!p) return fail('Unknown player');
  if (!isCity(req.city)) return fail('Unknown city');
  const city = req.city;
  if (!INFRA_KINDS.includes(req.project as InfraKind)) return fail('Unknown project');
  const kind = req.project as InfraKind;
  const amount = Number(req.amount);
  if (!Number.isInteger(amount) || amount < 10 || amount > 100000) return fail('Contribute a whole number of gold from 10 to 100,000');
  if (!hasAccess(p, city)) return fail(`Open a trading office in ${CITY_DEFS[city].name} to take part in its public works`);
  const lv = infraLevel(world, city, kind);
  if (lv >= MAX_INFRA) return fail(`${INFRA[kind].name} in ${CITY_DEFS[city].name} is complete`);
  if (p.gold < amount) return fail(`You have ${Math.floor(p.gold)}g`);
  const cost = infraCost(city, kind, lv + 1);
  const pr = cityState(world, city).projects[kind] ?? { funded: 0, contributors: {} };
  const pay = money(Math.min(amount, cost - pr.funded));
  p.gold = money(p.gold - pay);
  world.markets[city].treasury = money(world.markets[city].treasury + pay);
  p.patronage ??= {};
  p.patronage[city] = money((p.patronage[city] ?? 0) + pay);
  p.xp += Math.floor(pay / 20);
  p.reputation = Math.min(100, p.reputation + Math.min(5, Math.floor(pay / 200)));
  world.ledger.push({ tick: world.tick, playerId, type: 'city.fund', goldDelta: -pay, details: { city, project: kind } });
  addFunding(world, city, kind, pay, playerId);
  const after = infraLevel(world, city, kind);
  if (after === lv) pushFeed(world, { kind: 'player', actor: playerId, market: city, text: `${p.name} gave ${pay}g towards ${CITY_DEFS[city].name}'s ${INFRA[kind].name.toLowerCase()}.` });
  return ok({ funded: cityState(world, city).projects[kind]?.funded ?? 0, cost: infraCost(city, kind, Math.min(MAX_INFRA, after + 1)), level: after });
}

/** Cities invest part of the surplus that would otherwise leave their purse in their own public works. */
export function cityInvest(world: WorldState, city: MarketId, amount: number) {
  if (amount <= 0) return;
  const c = cityState(world, city);
  const open = INFRA_KINDS.filter((k) => (c.infra[k] ?? 0) < MAX_INFRA);
  if (!open.length) return;
  // The city builds whatever is nearest completion, cheapest first.
  open.sort((a, b) => (infraCost(city, a, (c.infra[a] ?? 0) + 1) - (c.projects[a]?.funded ?? 0)) - (infraCost(city, b, (c.infra[b] ?? 0) + 1) - (c.projects[b]?.funded ?? 0)));
  addFunding(world, city, open[0], amount);
}

// ----------------------------------------------------------- population ---
/** Is food affordable? 1 at base prices, lower when food is dear. */
function foodScore(world: WorldState, city: MarketId): number {
  const m = world.markets[city];
  const items: Resource[] = ['bread', 'fish'];
  return items.reduce((s, r) => s + clamp(Math.pow(RESOURCE_DEFS[r].basePrice / m.price[r], 0.5), 0, 1.3), 0) / items.length;
}

export interface GrowthFactors { food: number; jobs: number; infrastructure: number; rate: number }
export function growthFactors(world: WorldState, city: MarketId): GrowthFactors {
  const pop = cityPopulation(world, city);
  const food = foodScore(world, city);
  const jobs = clamp(laborEmployed(world, city) / Math.max(1, pop * 0.02), 0, 1);
  const levels = INFRA_KINDS.reduce((s, k) => s + infraLevel(world, city, k), 0);
  let rate = 0.006 * (food - 0.9) + 0.003 * jobs + 0.0006 * levels;
  if (rate > 0) rate *= Math.max(0, 1 - pop / populationCap(world, city));
  return { food: Math.round(food * 100) / 100, jobs: Math.round(jobs * 100) / 100, infrastructure: levels, rate };
}

/** Once a day: hinterland cities grow or shrink; every city keeps a population history. */
export function civicDaily(world: WorldState): void {
  for (const city of MARKETS) {
    const c = cityState(world, city);
    if (city !== 'nearhaven') {
      const g = growthFactors(world, city);
      const before = c.population;
      const def = CITY_DEFS[city].population;
      c.population = Math.round(clamp(before * (1 + g.rate), def * 0.5, populationCap(world, city)));
      c.growth = before ? (c.population - before) / before : 0;
      const step = Math.max(50, Math.round(def * 0.05));
      if (Math.floor(c.population / step) !== Math.floor(before / step)) {
        pushFeed(world, { kind: 'population', market: city, text: c.population > before ? `${CITY_DEFS[city].name} grew to ${c.population.toLocaleString('en')} people.` : `${CITY_DEFS[city].name} shrank to ${c.population.toLocaleString('en')} people as food grew dear.`, severity: c.population > before ? 'good' : 'bad' });
      }
    } else {
      c.growth = c.population ? (world.population - c.population) / c.population : 0;
      c.population = world.population;
    }
    c.popHistory.push(c.population);
    if (c.popHistory.length > 60) c.popHistory.shift();
  }
}

/** Regional flows scale with the city's size: more people eat more, and a little more is grown and made. */
export function sizeFactors(world: WorldState, city: MarketId) {
  const r = cityPopulation(world, city) / CITY_DEFS[city].population;
  return { consume: Math.pow(r, 0.8), produce: Math.pow(r, 0.6) };
}

export function patronTitle(p: PlayerState): string | null {
  const best = Object.entries(p.patronage ?? {}).sort((a, b) => b[1] - a[1])[0];
  if (!best || best[1] < 500) return null;
  return `${best[1] >= 5000 ? 'Grand Patron' : best[1] >= 2000 ? 'Patron' : 'Benefactor'} of ${CITY_DEFS[best[0] as MarketId].name}`;
}
