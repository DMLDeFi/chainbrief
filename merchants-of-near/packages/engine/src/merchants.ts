import { MARKETS, RESOURCE_DEFS, TRAVEL_TICKS, type MarketId, type Recipe, type Resource } from './config';
import type { MemoryItem, MerchantRole, MerchantState, Result, WorldState } from './types';
import { addInv, clamp, dayOf, fail, fmt, money, ok, pct, pushFeed } from './internal';
import { maxAffordable, quoteBuy, quoteSell, settleOnMarket, supplyLevel, type TradeQuote } from './market';
import { productionFactor } from './environment';
import { activeLoansOf, requestLoan } from './banking';
import { merchantNetWorth, shareValue } from './valuation';

/**
 * AUTONOMOUS MERCHANT AGENTS
 * --------------------------
 * Each merchant runs a deterministic perceive → evaluate → act loop every tick:
 *   1. Perceive: update price beliefs from the market it stands in.
 *   2. Produce: run the most profitable recipe its workers and inputs allow.
 *   3. Evaluate: compare live quotes to its reservation prices, which are
 *      derived from costs, personality (greed/patience/risk) and memory.
 *   4. Act: buy inputs, sell output, borrow, travel, hire or lay off.
 * Every decision is logged with its reasons so players (and the optional LLM
 * layer) can see *why* a merchant acted. No LLM is required for any of this.
 */

export interface RoleSpec {
  recipes: Array<Recipe & { name: string }>;
  /** Raw producers split workers across outputs weighted by relative price. */
  split?: boolean;
  storageCap: number;
  /** Units of each output to hold back rather than sell. */
  keep: number;
}

export const ROLE_SPECS: Partial<Record<MerchantRole, RoleSpec>> = {
  farmer: {
    recipes: [
      { name: 'wheat', inputs: {}, outputs: { wheat: 1 }, ratePerWorker: 0.95 },
      { name: 'livestock', inputs: {}, outputs: { livestock: 1 }, ratePerWorker: 0.05 },
    ],
    storageCap: 400,
    keep: 4,
  },
  baker: {
    recipes: [{ name: 'bread', inputs: { wheat: 3 }, outputs: { bread: 2 }, ratePerWorker: 0.34 }],
    storageCap: 120,
    keep: 2,
  },
  blacksmith: {
    recipes: [
      { name: 'tools', inputs: { iron: 1, coal: 1, wood: 0.5 }, outputs: { tools: 1 }, ratePerWorker: 0.09 },
      { name: 'weapons', inputs: { iron: 2, coal: 1 }, outputs: { weapons: 1 }, ratePerWorker: 0.06 },
    ],
    storageCap: 60,
    keep: 1,
  },
  miner: {
    recipes: [
      { name: 'iron', inputs: {}, outputs: { iron: 1 }, ratePerWorker: 0.17 },
      { name: 'coal', inputs: {}, outputs: { coal: 1 }, ratePerWorker: 0.17 },
      { name: 'stone', inputs: {}, outputs: { stone: 1 }, ratePerWorker: 0.17 },
    ],
    split: true,
    storageCap: 250,
    keep: 3,
  },
  fisher: { recipes: [{ name: 'fish', inputs: {}, outputs: { fish: 1 }, ratePerWorker: 0.45 }], storageCap: 160, keep: 2 },
  weaver: { recipes: [{ name: 'cloth', inputs: { livestock: 1 }, outputs: { cloth: 3 }, ratePerWorker: 0.06 }], storageCap: 100, keep: 2 },
  woodcutter: { recipes: [{ name: 'wood', inputs: {}, outputs: { wood: 1 }, ratePerWorker: 0.42 }], storageCap: 250, keep: 3 },
};

export function logDecision(m: MerchantState, tick: number, action: string, reasons: string[]): void {
  m.decisions.push({ tick, action, reasons });
  if (m.decisions.length > 40) m.decisions.shift();
}

export function remember(m: MerchantState, item: MemoryItem): void {
  m.memory.push(item);
  if (m.memory.length > 40) m.memory.shift();
}

/** Execute a market trade on behalf of a merchant. Returns the quote on success. */
export function merchantTrade(world: WorldState, m: MerchantState, side: 'buy' | 'sell', r: Resource, qty: number, marketId: MarketId = m.location, why = ''): TradeQuote | null {
  if (qty < 1) return null;
  const market = world.markets[marketId];
  const q = side === 'buy' ? quoteBuy(market, r, qty) : quoteSell(market, r, qty);
  if (!q.ok) return null;
  if (side === 'buy' && q.data.total > m.gold) return null;
  if (side === 'sell' && (m.inventory[r] ?? 0) < qty) return null;
  const stockBefore = market.stock[r];
  settleOnMarket(world, market, r, side, q.data);
  if (side === 'buy') {
    m.gold = money(m.gold - q.data.total);
    addInv(m.inventory, r, qty);
    m.today.costs += q.data.total;
    m.stats.costs += q.data.total;
  } else {
    m.gold = money(m.gold + q.data.total);
    addInv(m.inventory, r, -qty);
    m.today.revenue += q.data.total;
    m.today.sold += qty;
    m.stats.revenue += q.data.total;
  }
  m.stats.trades += 1;
  remember(m, { tick: world.tick, kind: side, resource: r, qty, price: q.data.avgPrice, counterparty: marketId, note: `${side === 'buy' ? 'Bought' : 'Sold'} ${qty} ${r} @ ${fmt(q.data.avgPrice)}${why ? ` — ${why}` : ''}` });
  if (qty >= 4) {
    const change = (market.stock[r] - stockBefore) / Math.max(1, stockBefore);
    pushFeed(world, {
      kind: 'trade',
      actor: m.id,
      resource: r,
      market: marketId,
      text: `${m.name} ${side === 'buy' ? 'bought' : 'sold'} ${qty} ${RESOURCE_DEFS[r].label.toLowerCase()} ${side === 'buy' ? 'from' : 'to'} ${market.name} at ${fmt(q.data.avgPrice)}g each (${RESOURCE_DEFS[r].label} supply ${pct(change)}).`,
      data: { qty, price: q.data.avgPrice, total: q.data.total, stockChange: Math.round(change * 1000) / 10 },
    });
  }
  return q.data;
}

function perceive(world: WorldState, m: MerchantState, rs: Resource[]) {
  const market = world.markets[m.location];
  for (const r of rs) {
    const b = m.beliefs[r] ?? market.price[r];
    m.beliefs[r] = money(b * 0.92 + market.price[r] * 0.08);
  }
}

function recipeResources(spec: RoleSpec): { inputs: Resource[]; outputs: Resource[] } {
  const inputs = new Set<Resource>();
  const outputs = new Set<Resource>();
  for (const rc of spec.recipes) {
    Object.keys(rc.inputs).forEach((r) => inputs.add(r as Resource));
    Object.keys(rc.outputs).forEach((r) => outputs.add(r as Resource));
  }
  return { inputs: [...inputs], outputs: [...outputs] };
}

/** Value-per-batch minus input cost at current mid prices. */
export function recipeMargin(world: WorldState, rc: Recipe, marketId: MarketId = 'nearhaven'): { value: number; cost: number; margin: number } {
  const p = world.markets[marketId].price;
  let value = 0;
  let cost = 0;
  for (const [r, q] of Object.entries(rc.outputs)) value += p[r as Resource] * (q ?? 0);
  for (const [r, q] of Object.entries(rc.inputs)) cost += p[r as Resource] * (q ?? 0);
  return { value, cost, margin: cost > 0 ? value / cost - 1 : Infinity };
}

function chooseRecipe(world: WorldState, m: MerchantState, spec: RoleSpec): (Recipe & { name: string }) | null {
  let best: (Recipe & { name: string }) | null = null;
  let bestScore = -Infinity;
  for (const rc of spec.recipes) {
    const { value, cost } = recipeMargin(world, rc, m.location);
    const out = Object.keys(rc.outputs)[0] as Resource;
    // Prefer goods the town is short of: scarcity premium.
    const scarcity = clamp(1.4 - supplyLevel(world.markets.nearhaven, out), 0.5, 1.6);
    const score = (value - cost) * scarcity;
    if (score > bestScore) {
      bestScore = score;
      best = rc;
    }
  }
  return best;
}

function produce(world: WorldState, m: MerchantState, spec: RoleSpec): void {
  if (m.workers <= 0) return;
  const market = world.markets.nearhaven;
  if (spec.split) {
    // Allocate labour toward the outputs fetching the best price relative to normal.
    const weights = spec.recipes.map((rc) => {
      const r = Object.keys(rc.outputs)[0] as Resource;
      const full = (m.inventory[r] ?? 0) >= spec.storageCap;
      return full ? 0 : Math.pow(market.price[r] / RESOURCE_DEFS[r].basePrice, 2);
    });
    const total = weights.reduce((a, b) => a + b, 0) || 1;
    spec.recipes.forEach((rc, i) => {
      const r = Object.keys(rc.outputs)[0] as Resource;
      const units = ((rc.ratePerWorker * m.workers * spec.recipes.length * weights[i]) / total) * productionFactor(world, r);
      if (units > 0) {
        addInv(m.inventory, r, units);
        m.today.produced += units;
        market.tickProduced[r] += units;
      }
    });
    return;
  }
  const raw = spec.recipes.every((rc) => Object.keys(rc.inputs).length === 0);
  const recipes = raw ? spec.recipes : [chooseRecipe(world, m, spec)].filter(Boolean) as Array<Recipe & { name: string }>;
  for (const rc of recipes) {
    const out = Object.entries(rc.outputs)[0] as [Resource, number];
    if ((m.inventory[out[0]] ?? 0) >= spec.storageCap) continue;
    let batches = rc.ratePerWorker * m.workers * (raw ? productionFactor(world, out[0]) : 1);
    for (const [r, q] of Object.entries(rc.inputs)) batches = Math.min(batches, (m.inventory[r as Resource] ?? 0) / (q ?? 1));
    if (batches <= 0.001) continue;
    for (const [r, q] of Object.entries(rc.inputs)) addInv(m.inventory, r as Resource, -batches * (q ?? 0));
    for (const [r, q] of Object.entries(rc.outputs)) {
      addInv(m.inventory, r as Resource, batches * (q ?? 0));
      m.today.produced += batches * (q ?? 0);
      market.tickProduced[r as Resource] += batches * (q ?? 0);
    }
  }
}

/** Break-even unit cost of an output (inputs at belief prices + labour). */
function unitCost(world: WorldState, m: MerchantState, spec: RoleSpec, r: Resource): number {
  const rc = spec.recipes.find((x) => x.outputs[r]);
  if (!rc) return 0;
  const outQty = rc.outputs[r] ?? 1;
  let inputCost = 0;
  for (const [ir, q] of Object.entries(rc.inputs)) inputCost += (m.beliefs[ir as Resource] ?? world.markets.nearhaven.price[ir as Resource]) * (q ?? 0);
  const outputPerDay = Math.max(0.5, rc.ratePerWorker * m.workers * 24 * outQty * (spec.split ? 1 : 1));
  const labour = (m.wage * m.workers) / outputPerDay;
  return inputCost / outQty + labour;
}

function sellOutputs(world: WorldState, m: MerchantState, spec: RoleSpec, outputs: Resource[]): void {
  const market = world.markets[m.location];
  const wagesDue = m.wage * m.workers;
  for (const r of outputs) {
    const have = Math.floor((m.inventory[r] ?? 0) - spec.keep);
    if (have < 1) continue;
    const cost = unitCost(world, m, spec, r);
    const floor = cost * (1.02 + m.personality.greed * 0.08);
    let ask = Math.max(m.ask[r] ?? market.price[r], floor * 0.85);
    let chunk = Math.min(60, Math.max(1, Math.ceil(have * (0.25 + 0.5 * (1 - m.personality.patience)))));
    // Shrink the order until the exchange can pay for it and it doesn't crash the price below cost.
    let q = quoteSell(market, r, chunk);
    while (chunk > 1 && (!q.ok || q.data.priceAfter < floor * 0.9)) {
      chunk = Math.floor(chunk / 2);
      q = quoteSell(market, r, chunk);
    }
    if (!q.ok) continue;
    const distressed = m.gold < wagesDue;
    const glut = (m.inventory[r] ?? 0) > spec.storageCap * 0.7;
    if (q.data.avgPrice >= ask || distressed || glut) {
      const why = distressed ? 'needed cash for wages' : glut ? 'warehouse nearly full' : `price ${fmt(q.data.avgPrice)} ≥ ask ${fmt(ask)}`;
      merchantTrade(world, m, 'sell', r, chunk, m.location, why);
      logDecision(m, world.tick, `Sold ${chunk} ${r}`, [why, `Inventory ${Math.floor(m.inventory[r] ?? 0)} remaining`]);
      // Sold easily with stock running low → ask a little more next time.
      if ((m.inventory[r] ?? 0) < spec.keep * 3) ask *= 1.03;
    } else {
      // Unsold stock piling up → concede on price, more so if impatient.
      if ((m.inventory[r] ?? 0) > spec.keep * 4) {
        ask *= 1 - (0.015 + 0.03 * (1 - m.personality.patience));
        logDecision(m, world.tick, `Held ${have} ${r}, lowered ask to ${fmt(ask)}`, [`Market pays ${fmt(q.data.avgPrice)}, below ask`, `Patience ${(m.personality.patience * 100).toFixed(0)}%`]);
      }
    }
    m.ask[r] = money(Math.max(ask, floor * 0.85));
  }
}

function buyInputs(world: WorldState, m: MerchantState, spec: RoleSpec): void {
  const market = world.markets[m.location];
  const rc = chooseRecipe(world, m, spec);
  if (!rc || Object.keys(rc.inputs).length === 0) return;
  const out = Object.keys(rc.outputs)[0] as Resource;
  if ((m.inventory[out] ?? 0) >= spec.storageCap * 0.8) return;
  const horizon = 10 + 20 * m.personality.patience; // ticks of production to stock up for
  const batchesNeeded = rc.ratePerWorker * m.workers * horizon;
  const { margin } = recipeMargin(world, rc, m.location);
  const minMargin = 0.06 + m.personality.greed * 0.22;
  const budget = m.gold * (0.35 + 0.45 * m.personality.risk) - m.wage * m.workers * 0.5;
  for (const [r, perBatch] of Object.entries(rc.inputs) as Array<[Resource, number]>) {
    const desired = batchesNeeded * perBatch;
    const deficit = Math.floor(desired - (m.inventory[r] ?? 0));
    if (deficit < 1) continue;
    const belief = m.beliefs[r] ?? market.price[r];
    const bid = belief * (1.1 + 0.35 * m.personality.risk);
    m.bid[r] = money(bid);
    if (margin < minMargin) {
      if (world.tick % 12 === 0) logDecision(m, world.tick, `Paused buying ${r}`, [`Recipe margin ${(margin * 100).toFixed(0)}% below required ${(minMargin * 100).toFixed(0)}%`]);
      continue;
    }
    if (market.price[r] > bid) {
      if (world.tick % 12 === 0) logDecision(m, world.tick, `Waiting on ${r}`, [`Price ${fmt(market.price[r])} above bid ${fmt(bid)} (belief ${fmt(belief)})`]);
      continue;
    }
    const affordable = maxAffordable(market, r, Math.max(0, budget), deficit);
    const qty = Math.min(deficit, affordable);
    if (qty >= 1) {
      const q = merchantTrade(world, m, 'buy', r, qty, m.location, `stocking ${r} for ${rc.name} (margin ${(margin * 100).toFixed(0)}%)`);
      if (q) logDecision(m, world.tick, `Bought ${qty} ${r}`, [`Margin on ${rc.name}: ${(margin * 100).toFixed(0)}%`, `Price ${fmt(q.avgPrice)} ≤ bid ${fmt(bid)}`]);
    } else if (m.personality.risk >= 0.45 && margin > minMargin + 0.1 && activeLoansOf(world, { kind: 'merchant', id: m.id }).length === 0 && dayOf(world.tick) > 0) {
      const amount = money(Math.max(30, deficit * market.price[r] * 1.3));
      const res = requestLoan(world, { kind: 'merchant', id: m.id }, amount);
      logDecision(m, world.tick, res.ok ? `Borrowed ${fmt(amount)}g` : `Loan request refused`, [`Short of gold to buy ${deficit} ${r}`, `Margin ${(margin * 100).toFixed(0)}% justifies borrowing`]);
      if (res.ok) remember(m, { tick: world.tick, kind: 'loan', qty: amount, note: `Borrowed ${fmt(amount)}g to buy ${r}` });
    }
  }
}

function runProducer(world: WorldState, m: MerchantState, idx: number): void {
  const spec = ROLE_SPECS[m.role];
  if (!spec) return;
  const { inputs, outputs } = recipeResources(spec);
  perceive(world, m, [...inputs, ...outputs]);
  produce(world, m, spec);
  if ((world.tick + idx) % 2 === 0) {
    buyInputs(world, m, spec);
    sellOutputs(world, m, spec, outputs);
  }
}

// ---------------------------------------------------------------- TRADER ---

export interface Opportunity {
  resource: Resource;
  from: MarketId;
  to: MarketId;
  qty: number;
  cost: number;
  expectedRevenue: number;
  expectedProfit: number;
}

/** Scan every resource for a profitable cross-market trade given a budget. */
export function findOpportunity(world: WorldState, from: MarketId, budget: number, cargoCap: number, learned: Record<string, number> = {}): Opportunity | null {
  const to = MARKETS.find((x) => x !== from)!;
  let best: Opportunity | null = null;
  for (const r of Object.keys(RESOURCE_DEFS) as Resource[]) {
    const a = world.markets[from];
    const b = world.markets[to];
    if (b.price[r] <= a.price[r] * 1.12) continue;
    const qty = Math.min(cargoCap, maxAffordable(a, r, budget, cargoCap));
    if (qty < 3) continue;
    // Size the order where marginal profit is still positive (impact on both sides).
    let bestQ: Opportunity | null = null;
    for (const q of [qty, Math.ceil(qty * 0.66), Math.ceil(qty * 0.4), Math.ceil(qty * 0.2)]) {
      if (q < 3) continue;
      const buy = quoteBuy(a, r, q);
      const sell = quoteSell(b, r, q);
      if (!buy.ok || !sell.ok) continue;
      const routeKey = `${from}>${to}:${r}`;
      const learnedAdj = learned[routeKey] ?? 1; // memory of realised vs expected
      const expectedRevenue = sell.data.total * clamp(learnedAdj, 0.6, 1.1) * 0.97; // price risk during travel
      const profit = expectedRevenue - buy.data.total - 6;
      if (!bestQ || profit > bestQ.expectedProfit) bestQ = { resource: r, from, to, qty: q, cost: buy.data.total, expectedRevenue, expectedProfit: profit };
    }
    if (bestQ && (!best || bestQ.expectedProfit > best.expectedProfit)) best = bestQ;
  }
  return best;
}

function runTrader(world: WorldState, m: MerchantState, idx: number): void {
  if (m.travel) {
    if (world.tick < m.travel.arriveTick) return;
    // Arrived: sell the cargo at the destination.
    const dest = m.travel.to;
    m.location = dest;
    const cargo = m.travel.cargo;
    const costBasis = m.travel.costBasis;
    const expected = m.travel.expected ?? 0;
    m.travel = undefined;
    let revenue = 0;
    for (const [r, q] of Object.entries(cargo) as Array<[Resource, number]>) {
      addInv(m.inventory, r, q);
      const t = merchantTrade(world, m, 'sell', r, Math.floor(q), dest, 'selling caravan cargo');
      if (t) revenue += t.total;
    }
    // Learn from the outcome: remember how realised revenue compared to the forecast for this route.
    const cargoRes = Object.keys(cargo)[0];
    if (cargoRes && expected > 0) {
      const key = `${dest === 'aurora' ? 'nearhaven' : 'aurora'}>${dest}:${cargoRes}`;
      m.routes[key] = money((m.routes[key] ?? 1) * 0.6 + (revenue / expected) * 0.4);
    }
    const profit = money(revenue - costBasis);
    remember(m, { tick: world.tick, kind: 'travel', qty: profit, note: `Arrived at ${world.markets[dest].name}; caravan profit ${fmt(profit)}g` });
    logDecision(m, world.tick, `Sold caravan in ${world.markets[dest].name}`, [`Revenue ${fmt(revenue)}g vs cost ${fmt(costBasis)}g`, `Profit ${fmt(profit)}g`]);
    pushFeed(world, { kind: 'travel', actor: m.id, market: dest, text: `${m.name} arrived in ${world.markets[dest].name} and sold cargo for a ${profit >= 0 ? 'profit' : 'loss'} of ${fmt(Math.abs(profit))}g.`, data: { profit }, severity: profit >= 0 ? 'good' : 'bad' });
    return;
  }
  if ((world.tick + idx) % 3 !== 0) return;
  const learned = m.routes;
  const budget = m.gold * (0.35 + 0.5 * m.personality.risk);
  const cap = 20 + m.workers * 15;
  const opp = findOpportunity(world, m.location, budget, cap, learned);
  const minProfit = 6 + m.personality.greed * 14;
  if (opp && opp.expectedProfit >= minProfit && opp.expectedProfit / opp.cost >= 0.06 + m.personality.greed * 0.08) {
    const q = merchantTrade(world, m, 'buy', opp.resource, opp.qty, m.location, `arbitrage to ${opp.to}`);
    if (!q) return;
    addInv(m.inventory, opp.resource, -opp.qty);
    const fromP = world.markets[opp.from].price[opp.resource];
    const toP = world.markets[opp.to].price[opp.resource];
    m.travel = { to: opp.to, arriveTick: world.tick + TRAVEL_TICKS, cargo: { [opp.resource]: opp.qty }, costBasis: q.total + 6, expected: opp.expectedRevenue };
    m.gold = money(m.gold - 6); // caravan hire & tolls
    m.today.costs += 6;
    logDecision(m, world.tick, `Caravan: ${opp.qty} ${opp.resource} → ${world.markets[opp.to].name}`, [
      `${opp.resource} ${fmt(fromP)}g here vs ${fmt(toP)}g there`,
      `Expected profit ${fmt(opp.expectedProfit)}g on ${fmt(opp.cost)}g`,
    ]);
    pushFeed(world, {
      kind: 'opportunity',
      actor: m.id,
      resource: opp.resource,
      text: `${m.name} found a profitable opportunity: ${RESOURCE_DEFS[opp.resource].label.toLowerCase()} costs ${fmt(fromP)}g in ${world.markets[opp.from].name} but sells for ${fmt(toP)}g in ${world.markets[opp.to].name}. A caravan of ${opp.qty} sets out.`,
      data: { expectedProfit: money(opp.expectedProfit), qty: opp.qty },
      severity: 'good',
    });
  } else if (m.location !== 'nearhaven') {
    m.travel = { to: 'nearhaven', arriveTick: world.tick + TRAVEL_TICKS, cargo: {}, costBasis: 0 };
    logDecision(m, world.tick, 'Returning home empty', ['No profitable cargo found in Port Aurora']);
  } else if (world.tick % 24 === 0) {
    logDecision(m, world.tick, 'Waiting for an opportunity', [opp ? `Best route only yields ${fmt(opp.expectedProfit)}g (need ${fmt(minProfit)}g)` : 'No price gap above 12% between markets']);
  }
}

// ----------------------------------------------------------------- DAILY ---

const SUCCESSORS: Record<MerchantRole, string[]> = {
  farmer: ['Farmer Edda', 'Farmer Corwin', 'Farmer Lys'],
  baker: ['Baker Pell', 'Baker Imri', 'Baker Sefa'],
  blacksmith: ['Smith Varga', 'Smith Oren', 'Smith Halla'],
  trader: ['Trader Quill', 'Trader Nadia'],
  banker: ['Banker Osric'],
  miner: ['Miner Dagny', 'Miner Rusk'],
  fisher: ['Fisher Aldo', 'Fisher Mei'],
  weaver: ['Weaver Tamsin', 'Weaver Joss'],
  woodcutter: ['Woodcutter Bram', 'Woodcutter Ilse'],
};

export function merchantDaily(world: WorldState, m: MerchantState): void {
  const day = dayOf(world.tick) - 1;
  if (m.status === 'bankrupt') {
    if (m.bankruptSince !== undefined && world.tick - m.bankruptSince >= 4 * 24) reopen(world, m);
    return;
  }
  // Wages.
  const wages = money(m.wage * m.workers);
  if (wages > 0) {
    if (m.gold >= wages) {
      m.gold = money(m.gold - wages);
      m.today.costs += wages;
      world.markets.nearhaven.treasury = money(world.markets.nearhaven.treasury + wages);
      m.missedWages = 0;
    } else {
      m.today.costs += m.gold;
      world.markets.nearhaven.treasury = money(world.markets.nearhaven.treasury + m.gold);
      m.gold = 0;
      m.missedWages += 1;
      if (m.workers > 1) {
        m.workers -= 1;
        logDecision(m, world.tick, 'Laid off a worker', ['Could not meet payroll']);
      }
      m.status = 'struggling';
      pushFeed(world, { kind: 'bankruptcy', actor: m.id, text: `${m.name} could not pay wages (${m.missedWages} day${m.missedWages > 1 ? 's' : ''} in a row).`, severity: 'bad' });
    }
  }
  const profit = money(m.today.revenue - m.today.costs);
  const netWorth = merchantNetWorth(world, m);
  m.history.push({ day, gold: m.gold, netWorth, revenue: money(m.today.revenue), costs: money(m.today.costs), profit });
  if (m.history.length > 60) m.history.shift();

  // Dividends to investors.
  const investorShares = Object.values(m.investors).reduce((a, b) => a + b, 0);
  if (profit > 0 && investorShares > 0) {
    for (const [pid, shares] of Object.entries(m.investors)) {
      const p = world.players[pid];
      if (!p) continue;
      const div = money((profit * 0.4 * shares) / m.shares);
      if (div <= 0 || m.gold < div) continue;
      m.gold = money(m.gold - div);
      p.gold = money(p.gold + div);
      world.ledger.push({ tick: world.tick, playerId: pid, type: 'investment.dividend', goldDelta: div, details: { merchant: m.id } });
    }
  }

  // Expansion / contraction based on recent profitability and personality.
  const recent = m.history.slice(-3);
  const avgProfit = recent.reduce((s, d) => s + d.profit, 0) / Math.max(1, recent.length);
  const hireCost = 25 + m.wage * 2;
  if (m.role !== 'banker' && recent.length >= 2) {
    if (avgProfit > m.wage * 1.5 && m.gold > hireCost * (3 - 2 * m.personality.risk) + wages && m.workers < m.maxWorkers) {
      m.workers += 1;
      m.gold = money(m.gold - hireCost);
      m.today.costs += hireCost;
      logDecision(m, world.tick, `Expanded to ${m.workers} workers`, [`Average profit ${fmt(avgProfit)}g/day`, `Treasury ${fmt(m.gold)}g`]);
      remember(m, { tick: world.tick, kind: 'expand', qty: m.workers, note: `Hired worker #${m.workers}` });
      pushFeed(world, { kind: 'expansion', actor: m.id, text: `${m.name} is expanding — hired a worker (now ${m.workers}) after averaging ${fmt(avgProfit)}g profit a day.`, severity: 'good' });
    } else if (avgProfit < -m.wage && m.workers > 1) {
      m.workers -= 1;
      logDecision(m, world.tick, `Downsized to ${m.workers} workers`, [`Losing ${fmt(-avgProfit)}g/day`]);
      pushFeed(world, { kind: 'expansion', actor: m.id, text: `${m.name} downsized to ${m.workers} worker(s) after losing ${fmt(-avgProfit)}g a day.`, severity: 'bad' });
    }
  }
  if (m.status === 'struggling' && m.missedWages === 0 && avgProfit > 0) m.status = 'active';

  // Bankruptcy: three consecutive missed payrolls, or a defaulted loan with nothing left.
  const defaulted = Object.values(world.loans).some((l) => l.borrower.kind === 'merchant' && l.borrower.id === m.id && l.status === 'defaulted' && l.issuedTick > (m.bankruptSince ?? -1));
  if (m.missedWages >= 3 || (defaulted && netWorth < 20)) declareBankruptcy(world, m);
  m.today = { revenue: 0, costs: 0, produced: 0, sold: 0 };
}

export function declareBankruptcy(world: WorldState, m: MerchantState): void {
  // Liquidate everything into the market and pay creditors.
  for (const [r, q] of Object.entries(m.inventory) as Array<[Resource, number]>) {
    const units = Math.floor(q);
    if (units >= 1) merchantTrade(world, m, 'sell', r, units, m.location, 'liquidation');
  }
  for (const loan of activeLoansOf(world, { kind: 'merchant', id: m.id })) {
    const pay = Math.min(m.gold, loan.outstanding);
    m.gold = money(m.gold - pay);
    const banker = world.merchants.banker;
    if (banker) banker.gold = money(banker.gold + pay);
    loan.outstanding = money(loan.outstanding - pay);
    loan.status = loan.outstanding <= 0.01 ? 'repaid' : 'defaulted';
  }
  const investors = Object.keys(m.investors).length;
  m.investors = {};
  m.shares = 100;
  m.status = 'bankrupt';
  m.bankruptSince = world.tick;
  m.workers = 0;
  m.inventory = {};
  m.travel = undefined;
  logDecision(m, world.tick, 'Declared bankruptcy', ['Unable to meet obligations']);
  pushFeed(world, { kind: 'bankruptcy', actor: m.id, text: `${m.name} has gone BANKRUPT. Inventory liquidated${investors ? `; ${investors} investor(s) wiped out` : ''}.`, severity: 'bad' });
}

function reopen(world: WorldState, m: MerchantState): void {
  const names = SUCCESSORS[m.role];
  const name = names[m.generation % names.length];
  const capital = money(Math.min(150, Math.max(40, world.guildTreasury * 0.5)));
  world.guildTreasury = money(world.guildTreasury - capital);
  const old = m.name;
  m.name = name;
  m.generation += 1;
  m.gold = capital;
  m.workers = 1;
  m.status = 'active';
  m.missedWages = 0;
  m.ask = {};
  m.history = [];
  m.bankruptSince = world.tick;
  logDecision(m, world.tick, 'Reopened under new ownership', [`Guild seeded ${fmt(capital)}g`]);
  pushFeed(world, { kind: 'expansion', actor: m.id, text: `${name} has taken over ${old}'s former business with ${fmt(capital)}g of guild capital.`, severity: 'good' });
}

// ------------------------------------------------------------ INVESTMENT ---

export function investInMerchant(world: WorldState, playerId: string, merchantId: string, amount: number): Result<{ shares: number }> {
  const p = world.players[playerId];
  const m = world.merchants[merchantId];
  amount = money(amount);
  if (!p || !m) return fail('Unknown merchant');
  if (!(amount >= 10)) return fail('Minimum investment is 10 gold');
  if (p.gold < amount) return fail('Not enough gold');
  if (!m.acceptsInvestment) return fail(`${m.name} does not take outside investors`);
  if (m.status === 'bankrupt') return fail(`${m.name} is bankrupt`);
  const price = Math.max(0.5, shareValue(world, m));
  const shares = Math.round((amount / price) * 100) / 100;
  p.gold = money(p.gold - amount);
  m.gold = money(m.gold + amount);
  m.shares = Math.round((m.shares + shares) * 100) / 100;
  m.investors[playerId] = Math.round(((m.investors[playerId] ?? 0) + shares) * 100) / 100;
  m.relationships[playerId] = clamp((m.relationships[playerId] ?? 0) + 10, -100, 100);
  remember(m, { tick: world.tick, kind: 'invest', counterparty: playerId, qty: amount, note: `${p.name} invested ${fmt(amount)}g for ${shares} shares` });
  logDecision(m, world.tick, `Accepted ${fmt(amount)}g investment from ${p.name}`, [`Share price ${fmt(price)}g`, 'Capital will fund expansion']);
  world.ledger.push({ tick: world.tick, playerId, type: 'investment.buy', goldDelta: -amount, details: { merchant: m.id, shares, price } });
  pushFeed(world, { kind: 'player', actor: m.id, text: `${p.name} invested ${fmt(amount)}g in ${m.name}.`, severity: 'good' });
  return ok({ shares });
}

export function divestFromMerchant(world: WorldState, playerId: string, merchantId: string): Result<{ proceeds: number }> {
  const p = world.players[playerId];
  const m = world.merchants[merchantId];
  if (!p || !m) return fail('Unknown merchant');
  const shares = m.investors[playerId];
  if (!shares) return fail('You hold no shares');
  if (m.status === 'bankrupt') return fail('Shares in a bankrupt business are worthless');
  const proceeds = money(shares * shareValue(world, m) * 0.95);
  if (m.gold < proceeds) return fail(`${m.name} lacks the cash to buy back your shares right now`);
  m.gold = money(m.gold - proceeds);
  p.gold = money(p.gold + proceeds);
  m.shares = Math.round((m.shares - shares) * 100) / 100;
  delete m.investors[playerId];
  world.ledger.push({ tick: world.tick, playerId, type: 'investment.sell', goldDelta: proceeds, details: { merchant: m.id, shares } });
  return ok({ proceeds });
}

// ---------------------------------------------------------------- DRIVER ---

export function runMerchants(world: WorldState): void {
  const list = Object.values(world.merchants);
  list.forEach((m, idx) => {
    if (m.status === 'bankrupt') return;
    if (m.role === 'trader') runTrader(world, m, idx);
    else if (m.role !== 'banker') runProducer(world, m, idx);
  });
}

export const merchantRoleSpec = (role: MerchantRole) => ROLE_SPECS[role];
