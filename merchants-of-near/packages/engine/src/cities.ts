import { RESOURCE_DEFS, RESOURCES, type MarketId, type Resource } from './config';

/**
 * The world of Nearhaven: six cities joined by roads, a river and a sea lane.
 * Each city has its own exchange, population, industries and needs, so prices
 * differ from place to place and goods must physically travel between them.
 */
export type CityArchetype = 'merchant' | 'port' | 'capital' | 'industrial' | 'agricultural' | 'mining';
export interface CityDef {
  id: MarketId;
  name: string;
  archetype: CityArchetype;
  title: string;
  /** Position on the world map (0–100 in both axes). */
  pos: { x: number; y: number };
  population: number;
  /** Starting coin in the exchange/household purse. */
  treasury: number;
  /** Level required to open a trading office here, and the office's price. */
  charter: { level: number; cost: number } | null;
  strengths: string[];
  needs: string[];
  /** Regional production and consumption per hour (units), beyond players and AI merchants. */
  flows: Partial<Record<Resource, { produce: number; consume: number }>>;
  /** Opening stock as a multiple of each good's reference stock. */
  stock: Partial<Record<Resource, number>>;
}

export const CITY_DEFS: Record<MarketId, CityDef> = {
  nearhaven: {
    id: 'nearhaven', name: 'Nearhaven', archetype: 'merchant', title: 'The Merchant City', pos: { x: 46, y: 52 }, population: 400, treasury: 2000, charter: null,
    strengths: ['Central exchange', 'Ten merchant houses', 'Building plots for new businesses'], needs: ['Food for a growing town'], flows: {}, stock: {},
  },
  aurora: {
    id: 'aurora', name: 'Port Aurora', archetype: 'port', title: 'The Coastal Port', pos: { x: 16, y: 74 }, population: 1300, treasury: 2000, charter: { level: 3, cost: 220 },
    strengths: ['Fish', 'Imported iron and cloth', 'Shipping'], needs: ['Bread', 'Wheat', 'Tools'],
    flows: {
      wheat: { produce: 0.6, consume: 1.4 }, bread: { produce: 0.2, consume: 0.9 }, wood: { produce: 1.0, consume: 0.9 }, iron: { produce: 1.6, consume: 0.9 },
      coal: { produce: 1.0, consume: 0.8 }, stone: { produce: 0.6, consume: 0.6 }, tools: { produce: 0.05, consume: 0.18 }, livestock: { produce: 0.15, consume: 0.18 },
      fish: { produce: 2.6, consume: 1.6 }, cloth: { produce: 0.7, consume: 0.45 }, weapons: { produce: 0.02, consume: 0.08 },
    },
    stock: {},
  },
  kingsreach: {
    id: 'kingsreach', name: 'Kingsreach', archetype: 'capital', title: 'The Royal Capital', pos: { x: 72, y: 26 }, population: 2600, treasury: 6000, charter: { level: 3, cost: 260 },
    strengths: ['Wealthy households', 'Royal banks', 'Luxury demand'], needs: ['Bread', 'Cloth', 'Weapons', 'Stone'],
    flows: {
      wheat: { produce: 0.4, consume: 0.5 }, bread: { produce: 0.9, consume: 1.4 }, wood: { produce: 0.55, consume: 0.8 }, iron: { produce: 0.25, consume: 0.35 }, coal: { produce: 0.4, consume: 0.55 }, stone: { produce: 0.6, consume: 0.95 }, tools: { produce: 0.1, consume: 0.15 }, livestock: { produce: 0.25, consume: 0.35 }, fish: { produce: 0.55, consume: 0.8 }, cloth: { produce: 0.3, consume: 0.5 }, weapons: { produce: 0.07, consume: 0.12 },
    },
    stock: { wheat: 0.5, bread: 0.6, wood: 0.6, iron: 0.6, coal: 0.6, stone: 0.5, tools: 0.6, livestock: 0.6, fish: 0.6, cloth: 0.5, weapons: 0.5 },
  },
  emberforge: {
    id: 'emberforge', name: 'Emberforge', archetype: 'industrial', title: 'The Industrial City', pos: { x: 78, y: 62 }, population: 1700, treasury: 3200, charter: { level: 2, cost: 150 },
    strengths: ['Tools', 'Weapons', 'Cloth mills'], needs: ['Iron', 'Coal', 'Wood', 'Food'],
    flows: {
      wheat: { produce: 0.2, consume: 0.3 }, bread: { produce: 0.6, consume: 0.9 }, wood: { produce: 0.5, consume: 0.8 }, iron: { produce: 0.6, consume: 1.0 }, coal: { produce: 0.7, consume: 1.15 }, stone: { produce: 0.4, consume: 0.5 }, tools: { produce: 0.3, consume: 0.15 }, livestock: { produce: 0.12, consume: 0.18 }, fish: { produce: 0.25, consume: 0.38 }, cloth: { produce: 0.5, consume: 0.28 }, weapons: { produce: 0.1, consume: 0.05 },
    },
    stock: { wheat: 0.4, bread: 0.6, wood: 0.5, iron: 0.6, coal: 0.6, stone: 0.8, tools: 1.6, livestock: 0.5, fish: 0.5, cloth: 1.3, weapons: 1.5 },
  },
  goldenvale: {
    id: 'goldenvale', name: 'Goldenvale', archetype: 'agricultural', title: 'The Agricultural City', pos: { x: 30, y: 30 }, population: 1100, treasury: 2400, charter: { level: 1, cost: 90 },
    strengths: ['Wheat', 'Livestock', 'Granaries'], needs: ['Tools', 'Cloth', 'Iron'],
    flows: {
      wheat: { produce: 1.8, consume: 1.0 }, bread: { produce: 0.6, consume: 0.55 }, wood: { produce: 0.5, consume: 0.45 }, iron: { produce: 0.12, consume: 0.2 }, coal: { produce: 0.15, consume: 0.25 }, stone: { produce: 0.2, consume: 0.25 }, tools: { produce: 0.08, consume: 0.13 }, livestock: { produce: 0.5, consume: 0.3 }, fish: { produce: 0.2, consume: 0.3 }, cloth: { produce: 0.12, consume: 0.2 }, weapons: { produce: 0.01, consume: 0.015 },
    },
    stock: { wheat: 1.8, bread: 1.1, wood: 0.9, iron: 0.4, coal: 0.5, stone: 0.6, tools: 0.4, livestock: 1.7, fish: 0.6, cloth: 0.4, weapons: 0.3 },
  },
  deepcrag: {
    id: 'deepcrag', name: 'Deepcrag', archetype: 'mining', title: 'The Mining City', pos: { x: 90, y: 40 }, population: 900, treasury: 2200, charter: { level: 2, cost: 120 },
    strengths: ['Iron ore', 'Coal', 'Stone quarries'], needs: ['Bread', 'Tools', 'Wood'],
    flows: {
      wheat: { produce: 0.15, consume: 0.25 }, bread: { produce: 0.4, consume: 0.65 }, wood: { produce: 0.45, consume: 0.7 }, iron: { produce: 2.0, consume: 0.9 }, coal: { produce: 2.0, consume: 0.9 }, stone: { produce: 1.6, consume: 0.8 }, tools: { produce: 0.12, consume: 0.22 }, livestock: { produce: 0.12, consume: 0.2 }, fish: { produce: 0.15, consume: 0.25 }, cloth: { produce: 0.08, consume: 0.12 }, weapons: { produce: 0.01, consume: 0.015 },
    },
    stock: { wheat: 0.4, bread: 0.5, wood: 0.5, iron: 1.9, coal: 1.9, stone: 1.9, tools: 0.5, livestock: 0.4, fish: 0.3, cloth: 0.5, weapons: 0.4 },
  },
};

/**
 * Processed goods in each city's hinterland (units/hour). Each city's industry
 * shows here: Goldenvale mills and brews, Emberforge saws and smelts, the capital
 * buys furniture and ale. Nearhaven has no hinterland: only its citizens consume,
 * so these goods must be made or imported by players and traders.
 */
const INDUSTRY: Partial<Record<MarketId, { flows: CityDef['flows']; stock: CityDef['stock'] }>> = {
  aurora: {
    flows: { flour: { produce: 0.3, consume: 0.5 }, planks: { produce: 0.6, consume: 0.5 }, steel: { produce: 0.1, consume: 0.18 }, ale: { produce: 0.5, consume: 0.6 }, furniture: { produce: 0.08, consume: 0.12 } },
    stock: {},
  },
  kingsreach: {
    flows: { flour: { produce: 0.3, consume: 0.55 }, planks: { produce: 0.3, consume: 0.55 }, steel: { produce: 0.15, consume: 0.28 }, ale: { produce: 0.5, consume: 0.85 }, furniture: { produce: 0.12, consume: 0.24 } },
    stock: { flour: 0.5, planks: 0.5, steel: 0.5, ale: 0.6, furniture: 0.5 },
  },
  emberforge: {
    flows: { flour: { produce: 0.15, consume: 0.25 }, planks: { produce: 0.7, consume: 0.45 }, steel: { produce: 0.55, consume: 0.3 }, ale: { produce: 0.3, consume: 0.42 }, furniture: { produce: 0.18, consume: 0.1 } },
    stock: { flour: 0.5, planks: 1.4, steel: 1.6, ale: 0.6, furniture: 1.4 },
  },
  goldenvale: {
    flows: { flour: { produce: 0.9, consume: 0.45 }, planks: { produce: 0.2, consume: 0.3 }, steel: { produce: 0.02, consume: 0.04 }, ale: { produce: 0.7, consume: 0.4 }, furniture: { produce: 0.03, consume: 0.05 } },
    stock: { flour: 1.7, planks: 0.6, steel: 0.4, ale: 1.6, furniture: 0.5 },
  },
  deepcrag: {
    flows: { flour: { produce: 0.1, consume: 0.2 }, planks: { produce: 0.25, consume: 0.35 }, steel: { produce: 0.3, consume: 0.2 }, ale: { produce: 0.25, consume: 0.45 }, furniture: { produce: 0.02, consume: 0.04 } },
    stock: { flour: 0.4, planks: 0.7, steel: 1.3, ale: 0.5, furniture: 0.4 },
  },
};
for (const [id, add] of Object.entries(INDUSTRY) as Array<[MarketId, { flows: CityDef['flows']; stock: CityDef['stock'] }]>) {
  Object.assign(CITY_DEFS[id].flows, add.flows);
  Object.assign(CITY_DEFS[id].stock, add.stock);
}

export type RouteKind = 'road' | 'river' | 'sea' | 'pass';
export interface Route { a: MarketId; b: MarketId; kind: RouteKind; hours: number; name: string }
export const ROUTES: Route[] = [
  { a: 'nearhaven', b: 'aurora', kind: 'river', hours: 6, name: 'The Silverrun' },
  { a: 'nearhaven', b: 'goldenvale', kind: 'road', hours: 5, name: 'Harvest Road' },
  { a: 'nearhaven', b: 'kingsreach', kind: 'road', hours: 8, name: "King's Highway" },
  { a: 'nearhaven', b: 'emberforge', kind: 'road', hours: 7, name: 'Iron Road' },
  { a: 'goldenvale', b: 'kingsreach', kind: 'road', hours: 6, name: 'Granary Way' },
  { a: 'goldenvale', b: 'aurora', kind: 'river', hours: 7, name: 'Lower Silverrun' },
  { a: 'kingsreach', b: 'emberforge', kind: 'road', hours: 8, name: 'Crown Road' },
  { a: 'kingsreach', b: 'deepcrag', kind: 'pass', hours: 9, name: 'Highcrown Pass' },
  { a: 'emberforge', b: 'deepcrag', kind: 'pass', hours: 6, name: 'Ember Pass' },
  { a: 'aurora', b: 'kingsreach', kind: 'sea', hours: 10, name: 'Royal Sea Lane' },
];
/** Freight cost per unit per hour of travel, by route kind (gold). */
export const FREIGHT: Record<RouteKind, number> = { road: 0.05, river: 0.03, sea: 0.025, pass: 0.07 };
export const SHIPMENT_FEE = 4;

export const CITY_IDS = Object.keys(CITY_DEFS) as MarketId[];

export function initialStockFor(id: MarketId, r: Resource): number {
  const def = RESOURCE_DEFS[r];
  if (id === 'nearhaven' || id === 'aurora') return def.initialStock[id];
  return Math.round(def.refStock * (CITY_DEFS[id].stock[r] ?? 1));
}

export interface Path { cities: MarketId[]; hours: number; freightPerUnit: number }
const pathCache = new Map<string, Path | null>();
/** Fastest route between two cities (Dijkstra over the route network). */
export function findPath(from: MarketId, to: MarketId): Path | null {
  const key = `${from}>${to}`;
  if (pathCache.has(key)) return pathCache.get(key)!;
  const dist = new Map<MarketId, number>(); const prev = new Map<MarketId, { city: MarketId; route: Route }>();
  const todo = new Set<MarketId>(CITY_IDS);
  for (const c of CITY_IDS) dist.set(c, Infinity);
  dist.set(from, 0);
  while (todo.size) {
    let u: MarketId | null = null;
    for (const c of todo) if (u === null || dist.get(c)! < dist.get(u)!) u = c;
    if (u === null || dist.get(u) === Infinity) break;
    todo.delete(u);
    if (u === to) break;
    for (const r of ROUTES) {
      const v = r.a === u ? r.b : r.b === u ? r.a : null;
      if (!v || !todo.has(v)) continue;
      const nd = dist.get(u)! + r.hours;
      if (nd < dist.get(v)!) { dist.set(v, nd); prev.set(v, { city: u, route: r }); }
    }
  }
  if (dist.get(to) === Infinity) { pathCache.set(key, null); return null; }
  const cities: MarketId[] = [to]; let freight = 0; let c = to;
  while (c !== from) { const p = prev.get(c)!; freight += FREIGHT[p.route.kind] * p.route.hours; c = p.city; cities.unshift(c); }
  const path = { cities, hours: dist.get(to)!, freightPerUnit: Math.round(freight * 1000) / 1000 };
  pathCache.set(key, path);
  return path;
}
export function travelTicks(from: MarketId, to: MarketId): number {
  return from === to ? 0 : findPath(from, to)?.hours ?? 12;
}
export function freightCost(from: MarketId, to: MarketId, qty: number): number {
  const p = findPath(from, to);
  return Math.round((SHIPMENT_FEE + qty * (p?.freightPerUnit ?? 0.5)) * 100) / 100;
}
export const ALL_RESOURCES: readonly Resource[] = RESOURCES;
