import { MARKETS, type MarketId } from './config';
import type { BusinessKind, PlayerState, Result, WorldState } from './types';
import { fail, money, ok, pushFeed } from './internal';
import { CITY_DEFS, type CityArchetype } from './cities';
import { cityPopulation, extraPlots } from './civic';

/**
 * Land and property. Every city has a fixed number of building plots. Land is
 * bought from the city (the money goes into its purse), its price rises as the
 * city fills up and as the city prospers, and owners pay a yearly-style land
 * tax every day. Vacant land can be held as an investment and sold back later.
 */
export interface LandDef {
  plots: number;
  /** Price of the first plot in a fresh city. */
  basePrice: number;
  /** Building cost multiplier (materials and labour). */
  build: number;
  /** Wage multiplier for staff hired here. */
  wages: number;
}
export const LAND: Record<CityArchetype, LandDef> = {
  merchant: { plots: 12, basePrice: 10, build: 1.0, wages: 1.0 },
  capital: { plots: 10, basePrice: 140, build: 1.35, wages: 1.3 },
  port: { plots: 14, basePrice: 70, build: 1.1, wages: 1.1 },
  industrial: { plots: 16, basePrice: 55, build: 0.9, wages: 1.0 },
  agricultural: { plots: 20, basePrice: 25, build: 0.95, wages: 0.85 },
  mining: { plots: 14, basePrice: 35, build: 1.05, wages: 1.15 },
};
export const landDef = (city: MarketId) => LAND[CITY_DEFS[city].archetype];

/** How well each kind of business suits a city: a multiplier on output (or caravan capacity / storage). */
/** 0 means the trade cannot be set up there at all (no water for a fishery, no ore for a mine). */
export const AFFINITY: Record<CityArchetype, Partial<Record<BusinessKind, number>>> = {
  merchant: { trading: 1.1, warehouse: 1.1, shop: 1.1, mine: 0.7, quarry: 0.8, bank: 1.15, estate: 1.1 },
  capital: { bank: 1.3, estate: 1.2, bakery: 1.15, trading: 1.15, farm: 0.6, blacksmith: 1.05, ranch: 0.6, lumbercamp: 0.6, mine: 0, quarry: 0.7, shop: 1.3, carpenter: 1.1, brewery: 1.1 },
  port: { bank: 1.1, trading: 1.25, warehouse: 1.2, farm: 0.8, fishery: 1.4, sawmill: 1.1, mine: 0, shop: 1.1 },
  industrial: { blacksmith: 1.3, textile: 1.2, farm: 0.7, foundry: 1.3, sawmill: 1.2, carpenter: 1.2, mine: 0.8, fishery: 0, ranch: 0.7 },
  agricultural: { estate: 0.9, bank: 0.85, farm: 1.35, bakery: 1.1, blacksmith: 0.8, ranch: 1.35, mill: 1.3, brewery: 1.25, fishery: 0.8, mine: 0, quarry: 0, foundry: 0.7 },
  mining: { bank: 0.8, blacksmith: 1.15, farm: 0.55, textile: 0.8, mine: 1.45, quarry: 1.35, lumbercamp: 1.2, foundry: 1.15, fishery: 0, ranch: 0.6, mill: 0.8 },
};
export const affinity = (city: MarketId, kind: BusinessKind) => AFFINITY[CITY_DEFS[city].archetype][kind] ?? 1;

/** Daily land tax as a share of the plot's current value. */
export const LAND_TAX = 0.01;

/** Plots in a city: its original land plus districts opened by housing projects. */
export const plotCount = (world: WorldState, city: MarketId) => landDef(city).plots + extraPlots(world, city);

export function plotsTaken(world: WorldState, city: MarketId): number {
  return world.landUse[city]?.length ?? 0;
}

/** City prosperity: a bigger, richer city has dearer land. */
export function prosperity(world: WorldState, city: MarketId): number {
  const def = CITY_DEFS[city];
  const pop = cityPopulation(world, city);
  const purse = Math.max(1, world.markets[city].treasury);
  const raw = Math.pow(pop / def.population, 0.5) * Math.pow(purse / (def.treasury * 2), 0.15);
  return Math.max(0.75, Math.min(1.8, raw));
}

/** Price of the next plot in a city: scarcity times prosperity. */
export function landPrice(world: WorldState, city: MarketId): number {
  const d = landDef(city);
  const scarcity = 1 + 0.12 * plotsTaken(world, city);
  return money(d.basePrice * scarcity * prosperity(world, city));
}
/** What an already-owned plot is worth today (the city's current price, without the extra scarcity a new sale would add). */
export function landValue(world: WorldState, city: MarketId): number {
  const d = landDef(city);
  const scarcity = 1 + 0.12 * Math.max(0, plotsTaken(world, city) - 1);
  return money(d.basePrice * scarcity * prosperity(world, city));
}

/** Plots a player holds in a city (vacant land plus plots under their businesses). */
export function plotsOwned(world: WorldState, p: PlayerState, city?: MarketId): number {
  let n = p.land.filter((l) => !city || l.city === city).length;
  for (const b of Object.values(world.businesses)) if (b.ownerId === p.id && (!city || b.city === city)) n += 1;
  return n;
}

/** The guild grants each newcomer their first plot in Nearhaven, so a first business is always within reach. */
export function starterGrant(world: WorldState, p: PlayerState, city: MarketId): boolean {
  return city === 'nearhaven' && plotsOwned(world, p) === 0;
}

export function freePlot(world: WorldState, city: MarketId): number | undefined {
  const used = world.landUse[city] ?? [];
  return [...Array(plotCount(world, city)).keys()].find((i) => !used.includes(i));
}

export function takePlot(world: WorldState, city: MarketId, plot: number) {
  (world.landUse[city] ??= []).push(plot);
}
export function releasePlot(world: WorldState, city: MarketId, plot: number) {
  world.landUse[city] = (world.landUse[city] ?? []).filter((i) => i !== plot);
  if (city === 'nearhaven') world.plotsUsed = world.plotsUsed.filter((i) => i !== plot);
}

const cityOk = (x: unknown): x is MarketId => typeof x === 'string' && (MARKETS as readonly string[]).includes(x);
const canHold = (p: PlayerState, city: MarketId) => city === 'nearhaven' || p.charters.includes(city) || p.marketAccess.includes(city);

/** Buy a vacant plot as property. */
export function buyLand(world: WorldState, playerId: string, city: unknown): Result<{ city: MarketId; plot: number; price: number }> {
  const p = world.players[playerId];
  if (!p) return fail('Unknown player');
  if (!cityOk(city)) return fail('Unknown city');
  const name = CITY_DEFS[city].name;
  if (!canHold(p, city)) return fail(`Open a trading office in ${name} before buying land there`);
  const plot = freePlot(world, city);
  if (plot === undefined) return fail(`Every plot in ${name} is taken`);
  const price = landPrice(world, city);
  if (p.gold < price) return fail(`Land in ${name} costs ${price}g a plot`);
  p.gold = money(p.gold - price);
  world.markets[city].treasury = money(world.markets[city].treasury + price);
  takePlot(world, city, plot);
  p.land.push({ city, plot, paid: price, tick: world.tick });
  world.ledger.push({ tick: world.tick, playerId, type: 'land.buy', goldDelta: -price, details: { city, plot } });
  pushFeed(world, { kind: 'player', actor: playerId, market: city, text: `${p.name} bought a building plot in ${name} for ${price}g.` });
  return ok({ city, plot, price });
}

/** Sell a vacant plot back to the city at today's value (less a 5% conveyancing fee). */
export function sellLand(world: WorldState, playerId: string, city: unknown): Result<{ city: MarketId; price: number }> {
  const p = world.players[playerId];
  if (!p) return fail('Unknown player');
  if (!cityOk(city)) return fail('Unknown city');
  const i = p.land.findIndex((l) => l.city === city);
  if (i < 0) return fail(`You own no vacant land in ${CITY_DEFS[city].name}`);
  const m = world.markets[city];
  const price = money(Math.min(landValue(world, city) * 0.95, Math.max(0, m.treasury - 200)));
  if (price <= 0) return fail(`${CITY_DEFS[city].name} cannot afford to buy land right now`);
  const [h] = p.land.splice(i, 1);
  releasePlot(world, city, h.plot);
  m.treasury = money(m.treasury - price);
  p.gold = money(p.gold + price);
  world.ledger.push({ tick: world.tick, playerId, type: 'land.sell', goldDelta: price, details: { city, plot: h.plot, paid: h.paid } });
  pushFeed(world, { kind: 'player', actor: playerId, market: city, text: `${p.name} sold a plot in ${CITY_DEFS[city].name} for ${price}g.` });
  return ok({ city, price });
}

/** Daily land tax on everything a player owns. Unpaid tax builds arrears; large arrears cost vacant land. */
export function landTaxDaily(world: WorldState, p: PlayerState): void {
  const due: Partial<Record<MarketId, number>> = {};
  for (const l of p.land) due[l.city] = (due[l.city] ?? 0) + landValue(world, l.city) * LAND_TAX;
  for (const b of Object.values(world.businesses)) if (b.ownerId === p.id && !starterPlot(world, p, b.id)) due[b.city] = (due[b.city] ?? 0) + landValue(world, b.city) * LAND_TAX;
  let total = 0;
  for (const [city, amt] of Object.entries(due) as Array<[MarketId, number]>) {
    const pay = money(Math.min(amt, Math.max(0, p.gold)));
    p.gold = money(p.gold - pay);
    world.markets[city].treasury = money(world.markets[city].treasury + pay);
    p.taxArrears = money((p.taxArrears ?? 0) + amt - pay);
    total += pay;
  }
  // Settle old arrears when there is money again.
  if (p.taxArrears > 0 && p.gold > 0) {
    const pay = money(Math.min(p.taxArrears, p.gold));
    p.gold = money(p.gold - pay);
    world.markets.nearhaven.treasury = money(world.markets.nearhaven.treasury + pay);
    p.taxArrears = money(p.taxArrears - pay);
    total += pay;
  }
  if (total > 0) world.ledger.push({ tick: world.tick, playerId: p.id, type: 'land.tax', goldDelta: -money(total), details: {} });
  const daily = Object.values(due).reduce((s, x) => s + (x ?? 0), 0);
  if (p.taxArrears > Math.max(5, daily * 5) && p.land.length) {
    const h = p.land.shift()!;
    releasePlot(world, h.city, h.plot);
    p.taxArrears = money(Math.max(0, p.taxArrears - landValue(world, h.city)));
    pushFeed(world, { kind: 'player', actor: p.id, market: h.city, text: `${CITY_DEFS[h.city].name} repossessed a plot from ${p.name} over unpaid land tax.`, severity: 'bad' });
  }
}

/** The plot under a player's first Nearhaven business is the guild's starter grant and pays no tax. */
function starterPlot(world: WorldState, p: PlayerState, businessId: string): boolean {
  const b = world.businesses[businessId];
  return !!b?.starterGrant && b.ownerId === p.id;
}

export function landHoldingsValue(world: WorldState, p: PlayerState): number {
  let v = 0;
  for (const l of p.land) v += landValue(world, l.city);
  return money(v);
}
