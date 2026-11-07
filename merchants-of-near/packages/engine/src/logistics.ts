import { MARKETS, RESOURCE_DEFS, RESOURCES, type MarketId, type Resource } from './config';
import type { Inventory, PlayerState, Result, Shipment, WorldState } from './types';
import { addInv, fail, fmt, invTotal, money, newId, ok, pushFeed } from './internal';
import { CITY_DEFS, findPath, freightCost, travelTicks } from './cities';
import { createMarket } from './market';
import { bumpMetric } from './progression';

/** Units a trading office's depot can hold in another city. */
export const DEPOT_CAPACITY = 80;

export const isCity = (x: unknown): x is MarketId => typeof x === 'string' && (MARKETS as readonly string[]).includes(x);

/** Can this player trade in that city? Home is always open; others need an office (or the legacy Aurora unlock). */
export function hasAccess(p: PlayerState, city: MarketId): boolean {
  return city === 'nearhaven' || p.charters.includes(city) || p.marketAccess.includes(city);
}

/** The store goods live in when a player trades in `city`: the home warehouse in Nearhaven, a depot elsewhere. */
export function storeFor(p: PlayerState, city: MarketId): Inventory {
  if (city === 'nearhaven') return p.inventory;
  return (p.depots[city] ??= {});
}
export function depotCapacity(_p: PlayerState, city: MarketId): number {
  return city === 'nearhaven' ? Infinity : DEPOT_CAPACITY;
}
/** Units already promised to a depot by shipments still on the road. */
function incoming(world: WorldState, ownerId: string, city: MarketId): number {
  let n = 0;
  for (const s of Object.values(world.shipments)) if (s.ownerId === ownerId && s.to === city) n += s.qty;
  return n;
}
/** Total units of a good the player holds anywhere (for cost-basis accounting). */
export function totalHeld(world: WorldState, p: PlayerState, r: Resource): number {
  let n = p.inventory[r] ?? 0;
  for (const inv of Object.values(p.depots)) n += inv?.[r] ?? 0;
  for (const s of Object.values(world.shipments)) if (s.ownerId === p.id && s.resource === r) n += s.qty;
  return n;
}

/** Open a trading office (and depot) in another city. Requires reputation level and pays the city's charter fee. */
export function charterCity(world: WorldState, playerId: string, city: unknown): Result<{ city: MarketId; cost: number }> {
  const p = world.players[playerId];
  if (!p) return fail('Unknown player');
  if (!isCity(city)) return fail('Unknown city');
  const def = CITY_DEFS[city];
  if (!def.charter) return fail(`${def.name} is your home city`);
  if (p.charters.includes(city)) return fail(`You already have an office in ${def.name}`);
  if (p.level < def.charter.level) return fail(`${def.name} grants trading charters from Level ${def.charter.level}`);
  if (p.gold < def.charter.cost) return fail(`A trading office in ${def.name} costs ${def.charter.cost}g`);
  p.gold = money(p.gold - def.charter.cost);
  // The charter fee is paid to that city's exchange, so gold stays in the closed economy.
  world.markets[city].treasury = money(world.markets[city].treasury + def.charter.cost);
  p.charters.push(city);
  p.depots[city] ??= {};
  p.xp += 25;
  world.ledger.push({ tick: world.tick, playerId, type: 'city.charter', goldDelta: -def.charter.cost, details: { city } });
  pushFeed(world, { kind: 'player', actor: playerId, market: city, text: `${p.name} opened a trading office in ${def.name}, ${def.title.toLowerCase()}.`, severity: 'good' });
  return ok({ city, cost: def.charter.cost });
}

/** Send goods from one of the player's stores to another along the fastest route. Freight is paid up front. */
export function shipGoods(world: WorldState, playerId: string, req: { from: unknown; to: unknown; resource: unknown; qty: unknown }): Result<Shipment> {
  const p = world.players[playerId];
  if (!p) return fail('Unknown player');
  if (!isCity(req.from) || !isCity(req.to)) return fail('Unknown city');
  if (req.from === req.to) return fail('Choose two different cities');
  if (!(RESOURCES as readonly string[]).includes(req.resource as string)) return fail('Unknown resource');
  const r = req.resource as Resource;
  const qty = Number(req.qty);
  if (!Number.isInteger(qty) || qty < 1 || qty > 500) return fail('Quantity must be a whole number between 1 and 500');
  for (const c of [req.from, req.to]) if (!hasAccess(p, c)) return fail(`Open a trading office in ${CITY_DEFS[c].name} first`);
  const path = findPath(req.from, req.to);
  if (!path) return fail('No route between those cities');
  const src = storeFor(p, req.from);
  if ((src[r] ?? 0) < qty) return fail(`You only have ${Math.floor(src[r] ?? 0)} ${r} in ${CITY_DEFS[req.from].name}`);
  if (req.to !== 'nearhaven') {
    const room = depotCapacity(p, req.to) - invTotal(storeFor(p, req.to)) - incoming(world, p.id, req.to);
    if (qty > room) return fail(`The ${CITY_DEFS[req.to].name} depot has room for ${Math.max(0, Math.floor(room))} more units`);
  }
  const cost = freightCost(req.from, req.to, qty);
  if (p.gold < cost) return fail(`Freight costs ${fmt(cost)}g`);
  // -- validated; mutate --
  p.gold = money(p.gold - cost);
  // Freight is paid to carters and boatmen in the origin city's economy.
  world.markets[req.from].treasury = money(world.markets[req.from].treasury + cost);
  addInv(src, r, -qty);
  const s: Shipment = { id: newId(world, 'ship'), ownerId: p.id, from: req.from, to: req.to, resource: r, qty, departTick: world.tick, arriveTick: world.tick + path.hours, freight: cost };
  world.shipments[s.id] = s;
  world.ledger.push({ tick: world.tick, playerId, type: 'ship.send', goldDelta: -cost, items: { [r]: -qty }, details: { from: s.from, to: s.to, arriveTick: s.arriveTick } });
  pushFeed(world, { kind: 'travel', actor: playerId, resource: r, market: s.to, text: `${p.name} shipped ${qty} ${RESOURCE_DEFS[r].label.toLowerCase()} from ${CITY_DEFS[s.from].name} to ${CITY_DEFS[s.to].name} (${path.hours}h by ${path.cities.length > 2 ? 'way of ' + path.cities.slice(1, -1).map((c) => CITY_DEFS[c].name).join(', ') : 'direct route'}).` });
  return ok(s);
}

/** Deliver shipments whose arrival time has come. */
export function processShipments(world: WorldState): void {
  for (const s of Object.values(world.shipments)) {
    if (world.tick < s.arriveTick) continue;
    delete world.shipments[s.id];
    const p = world.players[s.ownerId];
    if (!p) continue;
    addInv(storeFor(p, s.to), s.resource, s.qty);
    world.ledger.push({ tick: world.tick, playerId: p.id, type: 'ship.arrive', goldDelta: 0, items: { [s.resource]: s.qty }, details: { from: s.from, to: s.to } });
    pushFeed(world, { kind: 'travel', actor: p.id, resource: s.resource, market: s.to, text: `${p.name}'s shipment of ${s.qty} ${RESOURCE_DEFS[s.resource].label.toLowerCase()} arrived in ${CITY_DEFS[s.to].name}.`, severity: 'good' });
  }
}

/**
 * Bring a saved world from before the multi-city update up to date: add the
 * new cities' exchanges and per-city state, and give players depots. Safe to
 * run on every load (it only fills in what is missing).
 */
export function migrateWorld(world: WorldState): WorldState {
  for (const id of MARKETS) {
    if (!world.markets[id]) world.markets[id] = createMarket(id);
    world.reported ??= {} as WorldState['reported'];
    if (!world.reported[id]) world.reported[id] = { price: { ...world.markets[id].price }, stock: { ...world.markets[id].stock } };
  }
  world.cities ??= {} as WorldState['cities'];
  for (const id of MARKETS) world.cities[id] ??= { population: id === 'nearhaven' ? world.population : CITY_DEFS[id].population };
  world.shipments ??= {};
  for (const p of Object.values(world.players)) {
    p.charters ??= [];
    p.depots ??= {};
    // The old Port Aurora unlock becomes a proper office with a depot.
    if (p.marketAccess?.includes('aurora') && !p.charters.includes('aurora')) p.charters.push('aurora');
  }
  return world;
}

export { travelTicks };
