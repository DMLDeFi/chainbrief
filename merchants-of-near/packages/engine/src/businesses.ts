import { ECONOMY, MARKETS, RESOURCE_DEFS, type MarketId, type Recipe, type Resource } from './config';
import { freightCost, travelTicks } from './cities';
import { CITY_DEFS } from './cities';
import { depotCapacity, hasAccess, isCity, storeFor } from './logistics';
import { affinity, freePlot, landDef, landPrice, landValue, plotsTaken, releasePlot, starterGrant, takePlot } from './property';
import type { Business, BusinessKind, Result, WorldState } from './types';
import { addInv, dayOf, fail, fmt, invTotal, money, newId, ok, pushFeed } from './internal';
import { maxAffordable, quoteBuy, quoteSell, settleOnMarket } from './market';
import { productionFactor } from './environment';
import { findOpportunity } from './merchants';

export interface BusinessDef {
  kind: BusinessKind;
  name: string;
  description: string;
  price: number;
  /** Player level required to purchase. */
  requiredLevel: number;
  recipes: Array<Recipe & { name: string }>;
  wage: number;
  upkeep: number;
  /** Per level, 1–5. */
  maxWorkers: number[];
  capacity: number[];
  efficiency: number[];
  /** Cost to go from level n to n+1 (before the city's building multiplier). */
  upgradeCost: number[];
  /** Extra storage granted where the warehouse stands. */
  storageBonus?: number[];
}

const EFF = [1, 1.2, 1.45, 1.7, 2.0];
export const MAX_BUSINESS_LEVEL = 5;
/** Player level needed before a business can be raised to each level (index = target level). */
export const UPGRADE_LEVEL_REQ = [0, 0, 0, 0, 3, 5];

export const BUSINESS_DEFS: Record<BusinessKind, BusinessDef> = {
  farm: {
    kind: 'farm', name: 'Farm', description: 'Grows wheat. Yields swing with the seasons and the weather.',
    price: 85, requiredLevel: 1,
    recipes: [{ name: 'wheat', inputs: {}, outputs: { wheat: 1 }, ratePerWorker: 0.32 }],
    wage: 4, upkeep: 2, maxWorkers: [2, 4, 6, 8, 10], capacity: [80, 160, 260, 380, 520], efficiency: EFF, upgradeCost: [120, 260, 520, 950],
  },
  bakery: {
    kind: 'bakery', name: 'Bakery', description: 'Bakes 2 bread from every 3 wheat. Citizens eat bread every day.',
    price: 190, requiredLevel: 2,
    recipes: [{ name: 'bread', inputs: { wheat: 3 }, outputs: { bread: 2 }, ratePerWorker: 0.14 }],
    wage: 5, upkeep: 3, maxWorkers: [2, 4, 6, 8, 10], capacity: [60, 120, 200, 300, 420], efficiency: EFF, upgradeCost: [200, 420, 800, 1400],
  },
  textile: {
    kind: 'textile', name: 'Textile Shop', description: 'Weaves 3 cloth from each head of livestock’s wool and hide.',
    price: 230, requiredLevel: 2,
    recipes: [{ name: 'cloth', inputs: { livestock: 1 }, outputs: { cloth: 3 }, ratePerWorker: 0.035 }],
    wage: 5, upkeep: 3, maxWorkers: [2, 4, 6, 8, 10], capacity: [50, 100, 160, 240, 340], efficiency: EFF, upgradeCost: [240, 480, 900, 1600],
  },
  blacksmith: {
    kind: 'blacksmith', name: 'Blacksmith', description: 'Forges tools (iron + coal + wood) or weapons (2 iron + coal).',
    price: 420, requiredLevel: 3,
    recipes: [
      { name: 'tools', inputs: { iron: 1, coal: 1, wood: 0.5 }, outputs: { tools: 1 }, ratePerWorker: 0.04 },
      { name: 'weapons', inputs: { iron: 2, coal: 1 }, outputs: { weapons: 1 }, ratePerWorker: 0.028 },
    ],
    wage: 7, upkeep: 5, maxWorkers: [2, 4, 6, 8, 10], capacity: [40, 80, 140, 210, 300], efficiency: EFF, upgradeCost: [380, 700, 1300, 2300],
  },
  warehouse: {
    kind: 'warehouse', name: 'Warehouse', description: 'Adds storage to your personal stockpile and earns rent from merchants storing surplus.',
    price: 140, requiredLevel: 1,
    recipes: [],
    wage: 3, upkeep: 2, maxWorkers: [1, 2, 3, 4, 5], capacity: [0, 0, 0, 0, 0], efficiency: [1, 1.3, 1.6, 1.9, 2.2], upgradeCost: [160, 320, 600, 1000],
    storageBonus: [80, 180, 320, 500, 750],
  },
  trading: {
    kind: 'trading', name: 'Trading Company', description: 'Runs caravans from its city to every city where you hold an office, buying cheap and selling dear. Unlocks direct Aurora trading.',
    price: 600, requiredLevel: 4,
    recipes: [],
    wage: 6, upkeep: 6, maxWorkers: [2, 3, 4, 5, 6], capacity: [40, 70, 110, 160, 220], efficiency: [1, 1.15, 1.3, 1.45, 1.6], upgradeCost: [500, 900, 1500, 2500],
  },
};

export const businessCapacity = (b: Business) => BUSINESS_DEFS[b.kind].capacity[b.level - 1];
export const businessMaxWorkers = (b: Business) => BUSINESS_DEFS[b.kind].maxWorkers[b.level - 1];

export function warehouseBonus(world: WorldState, playerId: string, city: MarketId = 'nearhaven'): number {
  let bonus = 0;
  for (const b of Object.values(world.businesses)) {
    if (b.ownerId === playerId && b.kind === 'warehouse' && (b.city ?? 'nearhaven') === city) bonus += Math.round(BUSINESS_DEFS.warehouse.storageBonus![b.level - 1] * affinity(city, 'warehouse'));
  }
  return bonus;
}

/** Coordination overhead: every business beyond the third makes running each one a little dearer. */
export function overheadFactor(world: WorldState, playerId: string): number {
  const n = Object.values(world.businesses).filter((b) => b.ownerId === playerId).length;
  return 1 + 0.06 * Math.max(0, n - 3);
}
/** Building cost of a business of this kind in that city. */
export const buildCost = (kind: BusinessKind, city: MarketId) => money(BUSINESS_DEFS[kind].price * landDef(city).build);
export function upgradeCostOf(b: Business): number | null {
  if (b.level >= MAX_BUSINESS_LEVEL) return null;
  return money(BUSINESS_DEFS[b.kind].upgradeCost[b.level - 1] * landDef(b.city ?? 'nearhaven').build);
}

export function playerCapacity(world: WorldState, playerId: string): number {
  const p = world.players[playerId];
  return p.warehouseCapacity + warehouseBonus(world, playerId);
}

/** Quote for opening a business: building plus land (or the free starter plot / your own vacant land). */
export function businessQuote(world: WorldState, playerId: string, kind: BusinessKind, city: MarketId) {
  const p = world.players[playerId];
  const build = buildCost(kind, city);
  const ownLand = !!p?.land.some((l) => l.city === city);
  const grant = !!p && !ownLand && starterGrant(world, p, city);
  const land = ownLand || grant ? 0 : landPrice(world, city);
  return { build, land, total: money(build + land), ownLand, grant, affinity: affinity(city, kind), plotsFree: landDef(city).plots - plotsTaken(world, city) + (ownLand ? 1 : 0) };
}

export function buyBusiness(world: WorldState, playerId: string, kind: BusinessKind, city: unknown = 'nearhaven'): Result<Business> {
  const p = world.players[playerId];
  const def = BUSINESS_DEFS[kind];
  if (!p) return fail('Unknown player');
  if (!def) return fail('Unknown business type');
  if (!isCity(city)) return fail('Unknown city');
  const cityName = CITY_DEFS[city].name;
  if (p.level < def.requiredLevel) return fail(`Requires level ${def.requiredLevel}`);
  if (!hasAccess(p, city)) return fail(`Open a trading office in ${cityName} first`);
  const q = businessQuote(world, playerId, kind, city);
  const landIdx = p.land.findIndex((l) => l.city === city);
  const plot = landIdx >= 0 ? p.land[landIdx].plot : freePlot(world, city);
  if (plot === undefined) return fail(`Every building plot in ${cityName} is taken. Build in another city, or wait for an owner to sell`);
  if (p.gold < q.total) return fail(q.land > 0 ? `Costs ${q.total} gold (${q.build}g building + ${q.land}g land)` : `Costs ${q.total} gold`);
  p.gold = money(p.gold - q.total);
  // The guild takes a licence fee; builders and the land sale are paid in the city where it stands.
  world.guildTreasury = money(world.guildTreasury + q.build * 0.2);
  world.markets[city].treasury = money(world.markets[city].treasury + q.build * 0.8 + q.land);
  if (landIdx >= 0) p.land.splice(landIdx, 1);
  else takePlot(world, city, plot);
  if (city === 'nearhaven' && !world.plotsUsed.includes(plot)) world.plotsUsed.push(plot);
  const b: Business = {
    id: newId(world, 'biz'),
    kind,
    name: city === 'nearhaven' ? `${p.name}'s ${def.name}` : `${p.name}'s ${cityName} ${def.name}`,
    ownerId: playerId,
    level: 1,
    workers: 1,
    inventory: {},
    purchasePrice: q.build,
    landCost: q.land,
    starterGrant: q.grant || undefined,
    policy: { autoBuyInputs: true, autoSell: true, supplyFromStore: true, minSellPrice: 0, product: kind === 'blacksmith' ? 'tools' : undefined },
    today: { revenue: 0, expenses: 0, produced: 0 },
    totals: { revenue: 0, expenses: q.total, produced: 0 },
    history: [],
    progress: 0,
    createdTick: world.tick,
    city,
    plot,
  };
  world.businesses[b.id] = b;
  if (kind === 'trading' && !p.marketAccess.includes('aurora')) p.marketAccess.push('aurora');
  world.ledger.push({ tick: world.tick, playerId, type: 'business.buy', goldDelta: -q.total, details: { businessId: b.id, kind, city, land: q.land } });
  pushFeed(world, { kind: 'player', actor: playerId, market: city, text: `${p.name} opened a new ${def.name.toLowerCase()} in ${cityName}.`, severity: 'good' });
  return ok(b);
}

/** What a business would fetch if sold today: its assets plus a multiple of recent profit, plus its land. */
export function businessSaleValue(world: WorldState, b: Business): { assets: number; goodwill: number; land: number; total: number } {
  const assets = money(b.purchasePrice * 0.6);
  const recent = b.history.slice(-14);
  const avg = recent.length ? recent.reduce((s, h) => s + h.profit, 0) / recent.length : 0;
  const goodwill = money(Math.max(0, avg) * 20);
  const land = b.starterGrant ? 0 : landValue(world, b.city ?? 'nearhaven');
  return { assets, goodwill, land, total: money(assets + goodwill + land) };
}

/**
 * Sell a business to local investors. They pay 90% of its value out of the
 * city's purse, so the sale cannot create money. Its stock moves to your store
 * in that city. Deeded businesses are owned on NEAR and are traded there.
 */
export function sellBusiness(world: WorldState, playerId: string, businessId: string): Result<{ price: number }> {
  const r = ownedBusiness(world, playerId, businessId);
  if (!r.ok) return r;
  const b = r.data;
  const p = world.players[playerId];
  if (b.deedTokenId || b.chainOwner) return fail('This business is a NEAR deed: sell it on the deed marketplace instead');
  if (b.caravan) return fail('Wait for the caravan to come home before selling');
  const city = b.city ?? 'nearhaven';
  const m = world.markets[city];
  const price = money(Math.min(businessSaleValue(world, b).total * 0.9, Math.max(0, m.treasury - 200)));
  if (price <= 0) return fail(`Nobody in ${CITY_DEFS[city].name} can afford it right now`);
  const store = storeFor(p, city);
  for (const [res, q] of Object.entries(b.inventory) as Array<[Resource, number]>) if (q >= 1) addInv(store, res, Math.floor(q));
  m.treasury = money(m.treasury - price);
  p.gold = money(p.gold + price);
  releasePlot(world, city, b.plot);
  delete world.businesses[b.id];
  world.ledger.push({ tick: world.tick, playerId, type: 'business.sell', goldDelta: price, details: { businessId, kind: b.kind, city } });
  pushFeed(world, { kind: 'player', actor: playerId, market: city, text: `${p.name} sold ${b.name} for ${price}g.` });
  return ok({ price });
}

function ownedBusiness(world: WorldState, playerId: string, businessId: string): Result<Business> {
  const b = world.businesses[businessId];
  if (!b || b.ownerId !== playerId) return fail('Business not found');
  return ok(b);
}

export function hireWorker(world: WorldState, playerId: string, businessId: string): Result<Business> {
  const r = ownedBusiness(world, playerId, businessId);
  if (!r.ok) return r;
  const b = r.data;
  const p = world.players[playerId];
  const fee = BUSINESS_DEFS[b.kind].wage * 2;
  if (b.workers >= businessMaxWorkers(b)) return fail('Upgrade the business to hire more workers');
  if (p.gold < fee) return fail(`Hiring costs a ${fee}g signing fee`);
  p.gold = money(p.gold - fee);
  b.workers += 1;
  b.today.expenses += fee;
  b.totals.expenses += fee;
  world.ledger.push({ tick: world.tick, playerId, type: 'business.hire', goldDelta: -fee, details: { businessId } });
  return ok(b);
}

export function fireWorker(world: WorldState, playerId: string, businessId: string): Result<Business> {
  const r = ownedBusiness(world, playerId, businessId);
  if (!r.ok) return r;
  if (r.data.workers <= 0) return fail('No workers to dismiss');
  r.data.workers -= 1;
  return ok(r.data);
}

export function upgradeBusiness(world: WorldState, playerId: string, businessId: string): Result<Business> {
  const r = ownedBusiness(world, playerId, businessId);
  if (!r.ok) return r;
  const b = r.data;
  const p = world.players[playerId];
  const cost = upgradeCostOf(b);
  if (cost == null) return fail('Already at maximum level');
  const need = UPGRADE_LEVEL_REQ[b.level + 1] ?? 0;
  if (p.level < need) return fail(`Level ${b.level + 1} needs you to reach player Level ${need}`);
  if (p.gold < cost) return fail(`Upgrade costs ${cost} gold`);
  p.gold = money(p.gold - cost);
  // Builders are paid in the city where the business stands.
  world.markets[b.city ?? 'nearhaven'].treasury = money(world.markets[b.city ?? 'nearhaven'].treasury + cost);
  b.level += 1;
  b.purchasePrice += cost;
  b.totals.expenses += cost;
  world.ledger.push({ tick: world.tick, playerId, type: 'business.upgrade', goldDelta: -cost, details: { businessId, level: b.level } });
  pushFeed(world, { kind: 'player', actor: playerId, text: `${p.name} upgraded ${b.name} to level ${b.level}.`, severity: 'good' });
  return ok(b);
}

export function setBusinessPolicy(world: WorldState, playerId: string, businessId: string, policy: Partial<Business['policy']>): Result<Business> {
  const r = ownedBusiness(world, playerId, businessId);
  if (!r.ok) return r;
  const b = r.data;
  if (policy.autoBuyInputs !== undefined) b.policy.autoBuyInputs = !!policy.autoBuyInputs;
  if (policy.autoSell !== undefined) b.policy.autoSell = !!policy.autoSell;
  if (policy.supplyFromStore !== undefined) b.policy.supplyFromStore = !!policy.supplyFromStore;
  if (policy.minSellPrice !== undefined) {
    const v = Number(policy.minSellPrice);
    if (!Number.isFinite(v) || v < 0 || v > 10000) return fail('Invalid minimum price');
    b.policy.minSellPrice = money(v);
  }
  if (policy.product !== undefined) {
    if (b.kind !== 'blacksmith' || !['tools', 'weapons'].includes(policy.product)) return fail('Invalid product');
    b.policy.product = policy.product;
  }
  return ok(b);
}

/** Move finished goods from the business into the owner's personal warehouse. */
export function collectFromBusiness(world: WorldState, playerId: string, businessId: string): Result<{ moved: Partial<Record<Resource, number>> }> {
  const r = ownedBusiness(world, playerId, businessId);
  if (!r.ok) return r;
  const b = r.data;
  const p = world.players[playerId];
  const city = b.city ?? 'nearhaven';
  const store = storeFor(p, city);
  let free = (city === 'nearhaven' ? playerCapacity(world, playerId) : depotCapacity(p, city, world)) - invTotal(store);
  const moved: Partial<Record<Resource, number>> = {};
  for (const [res, q] of Object.entries(b.inventory) as Array<[Resource, number]>) {
    const units = Math.min(Math.floor(q), Math.floor(free));
    if (units < 1) continue;
    addInv(b.inventory, res, -units);
    addInv(store, res, units);
    p.costBasis[res] = p.costBasis[res] ?? world.markets[city].price[res] * 0.6;
    free -= units;
    moved[res] = units;
  }
  if (!Object.keys(moved).length) return fail(free < 1 ? (city === 'nearhaven' ? 'Your warehouse is full' : `Your ${CITY_DEFS[city].name} depot is full`) : 'Nothing to collect');
  world.ledger.push({ tick: world.tick, playerId, type: 'business.collect', goldDelta: 0, items: moved, details: { businessId } });
  return ok({ moved });
}

function bizTrade(world: WorldState, b: Business, side: 'buy' | 'sell', r: Resource, qty: number, marketId: MarketId = 'nearhaven'): number {
  const p = world.players[b.ownerId];
  const m = world.markets[marketId];
  const q = side === 'buy' ? quoteBuy(m, r, qty) : quoteSell(m, r, qty, ECONOMY.playerSellReserve);
  if (!q.ok) return 0;
  if (side === 'buy' && p.gold < q.data.total) return 0;
  if (side === 'sell' && (b.inventory[r] ?? 0) < qty) return 0;
  settleOnMarket(world, m, r, side, q.data);
  if (side === 'buy') {
    p.gold = money(p.gold - q.data.total);
    addInv(b.inventory, r, qty);
    b.today.expenses += q.data.total;
    b.totals.expenses += q.data.total;
  } else {
    p.gold = money(p.gold + q.data.total);
    addInv(b.inventory, r, -qty);
    b.today.revenue += q.data.total;
    b.totals.revenue += q.data.total;
  }
  world.ledger.push({ tick: world.tick, playerId: p.id, type: `business.${side}`, goldDelta: side === 'buy' ? -q.data.total : q.data.total, items: { [r]: qty }, details: { businessId: b.id, market: marketId, avgPrice: q.data.avgPrice } });
  return q.data.total;
}

function recipeFor(b: Business): (Recipe & { name: string }) | undefined {
  const def = BUSINESS_DEFS[b.kind];
  if (b.kind === 'blacksmith') return def.recipes.find((r) => r.name === (b.policy.product ?? 'tools'));
  return def.recipes[0];
}

function runCaravan(world: WorldState, b: Business): void {
  const p = world.players[b.ownerId];
  const home: MarketId = b.city ?? 'nearhaven';
  const payFreight = (from: MarketId, to: MarketId, qty: number) => {
    const f = freightCost(from, to, qty);
    p.gold = money(p.gold - f);
    world.markets[from].treasury = money(world.markets[from].treasury + f);
  };
  if (b.caravan) {
    if (world.tick < b.caravan.arriveTick) return;
    const dest = b.caravan.to;
    for (const [r, q] of Object.entries(b.caravan.cargo) as Array<[Resource, number]>) {
      addInv(b.inventory, r, q);
      bizTrade(world, b, 'sell', r, Math.floor(q), dest);
    }
    const leftover = Object.keys(b.inventory).length;
    b.caravan = dest !== home ? { to: home, arriveTick: world.tick + travelTicks(dest, home), cargo: {}, costBasis: 0 } : undefined;
    if (leftover === 0 && dest !== home) {
      // Look for a return cargo home.
      const opp = findOpportunity(world, dest, p.gold * 0.5, businessCapacity(b) * BUSINESS_DEFS.trading.efficiency[b.level - 1], {}, [home]);
      if (opp && opp.expectedProfit > 5) {
        if (bizTrade(world, b, 'buy', opp.resource, opp.qty, dest) > 0) {
          addInv(b.inventory, opp.resource, -opp.qty);
          payFreight(dest, home, opp.qty);
          b.caravan = { to: home, arriveTick: world.tick + travelTicks(dest, home), cargo: { [opp.resource]: opp.qty }, costBasis: opp.cost };
        }
      }
    }
    return;
  }
  if (world.tick % 4 !== 0 || b.workers < 1) return;
  const cap = Math.floor(businessCapacity(b) * BUSINESS_DEFS.trading.efficiency[b.level - 1] * affinity(home, 'trading') * Math.min(1, b.workers / 2));
  // The company trades with every city where its owner holds a charter.
  const destinations = MARKETS.filter((c) => c !== home && hasAccess(p, c));
  const opp = findOpportunity(world, home, p.gold * 0.4, cap, {}, destinations);
  if (opp && opp.expectedProfit > 8 && opp.expectedProfit / opp.cost > 0.08) {
    if (bizTrade(world, b, 'buy', opp.resource, opp.qty, home) > 0) {
      addInv(b.inventory, opp.resource, -opp.qty);
      payFreight(home, opp.to, opp.qty);
      b.caravan = { to: opp.to, arriveTick: world.tick + travelTicks(home, opp.to), cargo: { [opp.resource]: opp.qty }, costBasis: opp.cost };
      pushFeed(world, { kind: 'opportunity', actor: p.id, text: `${b.name} dispatched a caravan of ${opp.qty} ${opp.resource} to ${world.markets[opp.to].name}.`, data: { expected: money(opp.expectedProfit) } });
    }
  }
}

/** What the owner can expect for a unit of output: the local price when it sells here, otherwise the best city they trade in. */
function bestOutputPrice(world: WorldState, b: Business, r: Resource): number {
  const city = b.city ?? 'nearhaven';
  if (b.policy.autoSell) return world.markets[city].price[r];
  const p = world.players[b.ownerId];
  return Math.max(...MARKETS.filter((c) => hasAccess(p, c)).map((c) => world.markets[c].price[r]));
}

/** One tick of a player business: produce, auto-supply inputs, auto-sell output. */
export function runBusiness(world: WorldState, b: Business): void {
  const p = world.players[b.ownerId];
  if (!p) return;
  // A deeded business only operates for the player whose wallet holds the deed.
  if (b.chainOwner && p.nearAccountId !== b.chainOwner) return;
  const def = BUSINESS_DEFS[b.kind];
  if (b.kind === 'trading') return runCaravan(world, b);
  if (b.kind === 'warehouse') return;
  const rc = recipeFor(b);
  if (!rc || b.workers < 1) return;
  const cap = businessCapacity(b);
  const out = Object.keys(rc.outputs)[0] as Resource;
  const city: MarketId = b.city ?? 'nearhaven';
  const m = world.markets[city];
  const eff = def.efficiency[b.level - 1] * affinity(city, b.kind);

  const inputs = Object.entries(rc.inputs) as Array<[Resource, number]>;
  if (world.tick % 3 === 0 && inputs.length) {
    // First use the owner's own stock in this city (shipped in from elsewhere, or bought earlier).
    if (b.policy.supplyFromStore) {
      const store = storeFor(p, city);
      for (const [r, perBatch] of inputs) {
        const want = Math.ceil(rc.ratePerWorker * b.workers * eff * 12 * perBatch - (b.inventory[r] ?? 0));
        const room = Math.floor(cap - invTotal(b.inventory));
        const take = Math.min(want, room, Math.floor(store[r] ?? 0));
        if (take >= 1) { addInv(store, r, -take); addInv(b.inventory, r, take); }
      }
    }
    // Then top up from the exchange, but only while a batch is worth more than its inputs cost.
    if (b.policy.autoBuyInputs) {
      const outValue = Object.entries(rc.outputs).reduce((s, [r, q]) => s + (q ?? 0) * bestOutputPrice(world, b, r as Resource), 0) * (1 - m.fee);
      const plan: Array<[Resource, number]> = [];
      let batchCost = 0;
      for (const [r, perBatch] of inputs) {
        const want = Math.ceil(rc.ratePerWorker * b.workers * eff * 12 * perBatch - (b.inventory[r] ?? 0));
        const room = Math.floor(cap - invTotal(b.inventory));
        const qty = Math.min(want, room, maxAffordable(m, r, p.gold * 0.5, want));
        const q = qty >= 1 ? quoteBuy(m, r, qty) : null;
        batchCost += perBatch * (q?.ok ? q.data.avgPrice : m.price[r]);
        if (qty >= 1) plan.push([r, qty]);
      }
      if (batchCost > outValue * 0.95) b.idle = 'inputs-too-dear';
      else {
        b.idle = null;
        for (const [r, qty] of plan) bizTrade(world, b, 'buy', r, qty, city);
      }
    }
  }

  // Production.
  if (invTotal(b.inventory) >= cap && !(b.inventory[out] ?? 0)) b.idle = 'full';
  if (invTotal(b.inventory) < cap) {
    let batches = rc.ratePerWorker * b.workers * eff;
    if (Object.keys(rc.inputs).length === 0) batches *= productionFactor(world, out);
    for (const [r, q] of Object.entries(rc.inputs) as Array<[Resource, number]>) batches = Math.min(batches, (b.inventory[r] ?? 0) / q);
    if (batches > 0.0001) {
      for (const [r, q] of Object.entries(rc.inputs) as Array<[Resource, number]>) addInv(b.inventory, r, -batches * q);
      const produced = batches * (rc.outputs[out] ?? 1);
      addInv(b.inventory, out, produced);
      b.today.produced += produced;
      b.totals.produced += produced;
      m.tickProduced[out] += produced;
      p.dayCounters.businessProduced = (p.dayCounters.businessProduced ?? 0) + produced;
      p.weekCounters.businessProduced = (p.weekCounters.businessProduced ?? 0) + produced;
    }
  }

  // Auto-sell whole units above the player's floor price.
  if (b.policy.autoSell && world.tick % 2 === 0) {
    const units = Math.floor(b.inventory[out] ?? 0);
    if (units >= 2) {
      const q = quoteSell(m, out, units, ECONOMY.playerSellReserve);
      if (q.ok && q.data.avgPrice >= b.policy.minSellPrice) bizTrade(world, b, 'sell', out, units, city);
    }
  }
}

/** Daily wages/upkeep and P&L bookkeeping for a business. */
export function businessDaily(world: WorldState, b: Business): void {
  const p = world.players[b.ownerId];
  if (!p) return;
  const def = BUSINESS_DEFS[b.kind];
  const city: MarketId = b.city ?? 'nearhaven';
  // Staff are paid local wages; upkeep grows with the size of the whole company.
  let cost = money(def.wage * landDef(city).wages * b.workers + def.upkeep * b.level * overheadFactor(world, p.id));
  if (b.kind === 'warehouse') {
    // Merchants rent space when the market is glutted: rent scales with total market overstock.
    const m = world.markets[city];
    let over = 0;
    for (const r of Object.keys(RESOURCE_DEFS) as Resource[]) over += Math.max(0, m.stock[r] / RESOURCE_DEFS[r].refStock - 0.8);
    const rent = money((4 + over * 6) * b.workers * def.efficiency[b.level - 1]);
    p.gold = money(p.gold + rent);
    b.today.revenue += rent;
    b.totals.revenue += rent;
    world.ledger.push({ tick: world.tick, playerId: p.id, type: 'business.rent', goldDelta: rent, details: { businessId: b.id } });
  }
  if (p.gold < cost) {
    // Unpaid staff quit.
    if (b.workers > 0) {
      b.workers -= 1;
      pushFeed(world, { kind: 'player', actor: p.id, text: `A worker quit ${b.name} after missing wages.`, severity: 'bad' });
    }
    cost = money(Math.max(0, p.gold));
  }
  p.gold = money(p.gold - cost);
  world.markets[city].treasury = money(world.markets[city].treasury + cost);
  b.today.expenses += cost;
  b.totals.expenses += cost;
  if (cost > 0) world.ledger.push({ tick: world.tick, playerId: p.id, type: 'business.wages', goldDelta: -cost, details: { businessId: b.id } });
  b.history.push({ day: dayOf(world.tick) - 1, revenue: money(b.today.revenue), expenses: money(b.today.expenses), profit: money(b.today.revenue - b.today.expenses), produced: Math.round(b.today.produced * 10) / 10 });
  if (b.history.length > 30) b.history.shift();
  b.today = { revenue: 0, expenses: 0, produced: 0 };
}

export const MARKET_IDS = MARKETS;
export const describeBusinessCost = (kind: BusinessKind) => `${BUSINESS_DEFS[kind].price}g`;
export { fmt };
