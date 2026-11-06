import { ECONOMY, MARKETS, RESOURCE_DEFS, TRAVEL_TICKS, type Recipe, type Resource } from './config';
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
  maxWorkers: [number, number, number];
  capacity: [number, number, number];
  efficiency: [number, number, number];
  upgradeCost: [number, number];
  /** Extra player warehouse capacity granted (warehouse business). */
  storageBonus?: [number, number, number];
}

export const BUSINESS_DEFS: Record<BusinessKind, BusinessDef> = {
  farm: {
    kind: 'farm', name: 'Farm', description: 'Grows wheat. Yields swing with the seasons and the weather.',
    price: 85, requiredLevel: 1,
    recipes: [{ name: 'wheat', inputs: {}, outputs: { wheat: 1 }, ratePerWorker: 0.32 }],
    wage: 4, upkeep: 2, maxWorkers: [2, 4, 6], capacity: [80, 160, 260], efficiency: [1, 1.2, 1.45], upgradeCost: [120, 260],
  },
  bakery: {
    kind: 'bakery', name: 'Bakery', description: 'Bakes 2 bread from every 3 wheat. Citizens eat bread every day.',
    price: 190, requiredLevel: 2,
    recipes: [{ name: 'bread', inputs: { wheat: 3 }, outputs: { bread: 2 }, ratePerWorker: 0.14 }],
    wage: 5, upkeep: 3, maxWorkers: [2, 4, 6], capacity: [60, 120, 200], efficiency: [1, 1.2, 1.45], upgradeCost: [200, 420],
  },
  textile: {
    kind: 'textile', name: 'Textile Shop', description: 'Weaves 3 cloth from each head of livestock’s wool and hide.',
    price: 230, requiredLevel: 2,
    recipes: [{ name: 'cloth', inputs: { livestock: 1 }, outputs: { cloth: 3 }, ratePerWorker: 0.035 }],
    wage: 5, upkeep: 3, maxWorkers: [2, 4, 6], capacity: [50, 100, 160], efficiency: [1, 1.2, 1.45], upgradeCost: [240, 480],
  },
  blacksmith: {
    kind: 'blacksmith', name: 'Blacksmith', description: 'Forges tools (iron + coal + wood) or weapons (2 iron + coal).',
    price: 420, requiredLevel: 3,
    recipes: [
      { name: 'tools', inputs: { iron: 1, coal: 1, wood: 0.5 }, outputs: { tools: 1 }, ratePerWorker: 0.04 },
      { name: 'weapons', inputs: { iron: 2, coal: 1 }, outputs: { weapons: 1 }, ratePerWorker: 0.028 },
    ],
    wage: 7, upkeep: 5, maxWorkers: [2, 4, 6], capacity: [40, 80, 140], efficiency: [1, 1.2, 1.45], upgradeCost: [380, 700],
  },
  warehouse: {
    kind: 'warehouse', name: 'Warehouse', description: 'Adds storage to your personal stockpile and earns rent from merchants storing surplus.',
    price: 140, requiredLevel: 1,
    recipes: [],
    wage: 3, upkeep: 2, maxWorkers: [1, 2, 3], capacity: [0, 0, 0], efficiency: [1, 1.3, 1.6], upgradeCost: [160, 320],
    storageBonus: [80, 180, 320],
  },
  trading: {
    kind: 'trading', name: 'Trading Company', description: 'Runs caravans to Port Aurora, buying cheap and selling dear. Unlocks direct Aurora trading.',
    price: 600, requiredLevel: 4,
    recipes: [],
    wage: 6, upkeep: 6, maxWorkers: [2, 3, 4], capacity: [40, 70, 110], efficiency: [1, 1.15, 1.3], upgradeCost: [500, 900],
  },
};

export const businessCapacity = (b: Business) => BUSINESS_DEFS[b.kind].capacity[b.level - 1];
export const businessMaxWorkers = (b: Business) => BUSINESS_DEFS[b.kind].maxWorkers[b.level - 1];

export function warehouseBonus(world: WorldState, playerId: string): number {
  let bonus = 0;
  for (const b of Object.values(world.businesses)) {
    if (b.ownerId === playerId && b.kind === 'warehouse') bonus += BUSINESS_DEFS.warehouse.storageBonus![b.level - 1];
  }
  return bonus;
}

export function playerCapacity(world: WorldState, playerId: string): number {
  const p = world.players[playerId];
  return p.warehouseCapacity + warehouseBonus(world, playerId);
}

const PLOTS = 12;

export function buyBusiness(world: WorldState, playerId: string, kind: BusinessKind): Result<Business> {
  const p = world.players[playerId];
  const def = BUSINESS_DEFS[kind];
  if (!p) return fail('Unknown player');
  if (!def) return fail('Unknown business type');
  if (p.level < def.requiredLevel) return fail(`Requires level ${def.requiredLevel}`);
  if (p.gold < def.price) return fail(`Costs ${def.price} gold`);
  const owned = Object.values(world.businesses).filter((b) => b.ownerId === playerId);
  if (owned.length >= 6) return fail('You can own at most 6 businesses');
  const plot = [...Array(PLOTS).keys()].find((i) => !world.plotsUsed.includes(i));
  if (plot === undefined) return fail('No free building plots in town — the next season will bring more');
  p.gold = money(p.gold - def.price);
  world.guildTreasury = money(world.guildTreasury + def.price * 0.2);
  world.plotsUsed.push(plot);
  const b: Business = {
    id: newId(world, 'biz'),
    kind,
    name: `${p.name}'s ${def.name}`,
    ownerId: playerId,
    level: 1,
    workers: 1,
    inventory: {},
    purchasePrice: def.price,
    policy: { autoBuyInputs: true, autoSell: true, minSellPrice: 0, product: kind === 'blacksmith' ? 'tools' : undefined },
    today: { revenue: 0, expenses: 0, produced: 0 },
    totals: { revenue: 0, expenses: def.price, produced: 0 },
    history: [],
    progress: 0,
    createdTick: world.tick,
    plot,
  };
  world.businesses[b.id] = b;
  if (kind === 'trading' && !p.marketAccess.includes('aurora')) p.marketAccess.push('aurora');
  world.ledger.push({ tick: world.tick, playerId, type: 'business.buy', goldDelta: -def.price, details: { businessId: b.id, kind } });
  pushFeed(world, { kind: 'player', actor: playerId, text: `${p.name} opened a new ${def.name.toLowerCase()} in Nearhaven.`, severity: 'good' });
  return ok(b);
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
  if (b.level >= 3) return fail('Already at maximum level');
  const cost = BUSINESS_DEFS[b.kind].upgradeCost[b.level - 1];
  if (p.gold < cost) return fail(`Upgrade costs ${cost} gold`);
  p.gold = money(p.gold - cost);
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
  let free = playerCapacity(world, playerId) - invTotal(p.inventory);
  const moved: Partial<Record<Resource, number>> = {};
  for (const [res, q] of Object.entries(b.inventory) as Array<[Resource, number]>) {
    const units = Math.min(Math.floor(q), Math.floor(free));
    if (units < 1) continue;
    addInv(b.inventory, res, -units);
    addInv(p.inventory, res, units);
    p.costBasis[res] = p.costBasis[res] ?? world.markets.nearhaven.price[res] * 0.6;
    free -= units;
    moved[res] = units;
  }
  if (!Object.keys(moved).length) return fail(free < 1 ? 'Your warehouse is full' : 'Nothing to collect');
  world.ledger.push({ tick: world.tick, playerId, type: 'business.collect', goldDelta: 0, items: moved, details: { businessId } });
  return ok({ moved });
}

function bizTrade(world: WorldState, b: Business, side: 'buy' | 'sell', r: Resource, qty: number, marketId: 'nearhaven' | 'aurora' = 'nearhaven'): number {
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
  if (b.caravan) {
    if (world.tick < b.caravan.arriveTick) return;
    const dest = b.caravan.to;
    for (const [r, q] of Object.entries(b.caravan.cargo) as Array<[Resource, number]>) {
      addInv(b.inventory, r, q);
      bizTrade(world, b, 'sell', r, Math.floor(q), dest);
    }
    const leftover = Object.keys(b.inventory).length;
    b.caravan = dest === 'aurora' ? { to: 'nearhaven', arriveTick: world.tick + TRAVEL_TICKS, cargo: {}, costBasis: 0 } : undefined;
    if (leftover === 0 && dest === 'aurora') {
      // Look for a return cargo.
      const opp = findOpportunity(world, 'aurora', p.gold * 0.5, businessCapacity(b) * BUSINESS_DEFS.trading.efficiency[b.level - 1]);
      if (opp && opp.expectedProfit > 5) {
        if (bizTrade(world, b, 'buy', opp.resource, opp.qty, 'aurora') > 0) {
          addInv(b.inventory, opp.resource, -opp.qty);
          b.caravan = { to: 'nearhaven', arriveTick: world.tick + TRAVEL_TICKS, cargo: { [opp.resource]: opp.qty }, costBasis: opp.cost };
        }
      }
    }
    return;
  }
  if (world.tick % 4 !== 0 || b.workers < 1) return;
  const cap = Math.floor(businessCapacity(b) * BUSINESS_DEFS.trading.efficiency[b.level - 1] * Math.min(1, b.workers / 2));
  const opp = findOpportunity(world, 'nearhaven', p.gold * 0.4, cap);
  if (opp && opp.expectedProfit > 8 && opp.expectedProfit / opp.cost > 0.08) {
    if (bizTrade(world, b, 'buy', opp.resource, opp.qty, 'nearhaven') > 0) {
      addInv(b.inventory, opp.resource, -opp.qty);
      b.caravan = { to: 'aurora', arriveTick: world.tick + TRAVEL_TICKS, cargo: { [opp.resource]: opp.qty }, costBasis: opp.cost };
      pushFeed(world, { kind: 'opportunity', actor: p.id, text: `${b.name} dispatched a caravan of ${opp.qty} ${opp.resource} to ${world.markets[opp.to].name}.`, data: { expected: money(opp.expectedProfit) } });
    }
  }
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
  const eff = def.efficiency[b.level - 1];

  // Auto-buy inputs for ~12 ticks of production.
  if (b.policy.autoBuyInputs && world.tick % 3 === 0) {
    for (const [r, perBatch] of Object.entries(rc.inputs) as Array<[Resource, number]>) {
      const want = Math.ceil(rc.ratePerWorker * b.workers * eff * 12 * perBatch - (b.inventory[r] ?? 0));
      const room = Math.floor(cap - invTotal(b.inventory));
      const qty = Math.min(want, room, maxAffordable(world.markets.nearhaven, r, p.gold * 0.5, want));
      if (qty >= 1) bizTrade(world, b, 'buy', r, qty);
    }
  }

  // Production.
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
      world.markets.nearhaven.tickProduced[out] += produced;
      p.dayCounters.businessProduced = (p.dayCounters.businessProduced ?? 0) + produced;
      p.weekCounters.businessProduced = (p.weekCounters.businessProduced ?? 0) + produced;
    }
  }

  // Auto-sell whole units above the player's floor price.
  if (b.policy.autoSell && world.tick % 2 === 0) {
    const units = Math.floor(b.inventory[out] ?? 0);
    if (units >= 2) {
      const q = quoteSell(world.markets.nearhaven, out, units, ECONOMY.playerSellReserve);
      if (q.ok && q.data.avgPrice >= b.policy.minSellPrice) bizTrade(world, b, 'sell', out, units);
    }
  }
}

/** Daily wages/upkeep and P&L bookkeeping for a business. */
export function businessDaily(world: WorldState, b: Business): void {
  const p = world.players[b.ownerId];
  if (!p) return;
  const def = BUSINESS_DEFS[b.kind];
  let cost = money(def.wage * b.workers + def.upkeep * b.level);
  if (b.kind === 'warehouse') {
    // Merchants rent space when the market is glutted: rent scales with total market overstock.
    const m = world.markets.nearhaven;
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
  world.markets.nearhaven.treasury = money(world.markets.nearhaven.treasury + cost);
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
