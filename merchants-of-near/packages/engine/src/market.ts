import { ECONOMY, MARKET_DEFS, RESOURCE_DEFS, RESOURCES, type MarketId, type Resource } from './config';
import type { MarketState, Result, WorldState } from './types';
import { clamp, fail, money, ok, resourceMap } from './internal';

/**
 * PRICE DISCOVERY MODEL
 * ---------------------
 * Each market is an automated exchange holding physical stock. The mid price of a
 * resource is a function of the stock currently on the shelves and a slowly moving
 * demand-pressure term:
 *
 *   price(stock) = basePrice × (refStock / stock)^elasticity × pressure
 *
 * - Scarcity (low stock) raises prices; gluts lower them.
 * - `pressure` rises with unmet citizen demand and buy-side imbalance and decays
 *   back towards 1 as the market clears (see `updatePressure`).
 * - Every unit bought or sold walks along this curve, so large orders have price
 *   impact, and an immediate buy→sell round trip always loses the fee: players
 *   cannot mint gold by cycling trades.
 */

export function createMarket(id: MarketId): MarketState {
  const def = MARKET_DEFS[id];
  const zero = () => resourceMap(() => 0);
  const m: MarketState = {
    id,
    name: def.name,
    fee: def.fee,
    stock: resourceMap((r) => RESOURCE_DEFS[r].initialStock[id]),
    pressure: resourceMap(() => 1),
    price: zero(),
    openPrice: zero(),
    history: resourceMap(() => []),
    intraday: resourceMap(() => []),
    demandRate: zero(),
    supplyRate: zero(),
    productionRate: zero(),
    consumptionRate: zero(),
    shortageRate: zero(),
    tickBuys: zero(),
    tickSells: zero(),
    tickProduced: zero(),
    tickConsumed: zero(),
    tickShortage: zero(),
    volumeToday: 0,
    treasury: 2000,
  };
  for (const r of RESOURCES) {
    m.price[r] = unitPrice(m, r, m.stock[r]);
    m.openPrice[r] = m.price[r];
    m.history[r].push(m.price[r]);
  }
  return m;
}

/** Mid price of one unit when `stock` units are on the shelf. */
export function unitPrice(m: MarketState, r: Resource, stock: number): number {
  const def = RESOURCE_DEFS[r];
  const s = Math.max(stock, 1);
  const raw = def.basePrice * Math.pow(def.refStock / s, def.elasticity) * m.pressure[r];
  return clamp(raw, def.basePrice * ECONOMY.minPriceFactor, def.basePrice * ECONOMY.maxPriceFactor);
}

export interface TradeQuote {
  qty: number;
  /** Gold paid (buy) or received (sell), fee included. */
  total: number;
  avgPrice: number;
  fee: number;
  priceBefore: number;
  priceAfter: number;
}

/** Cost of buying `qty` units right now. Unit i is priced at the stock remaining before it is taken. */
export function quoteBuy(m: MarketState, r: Resource, qty: number): Result<TradeQuote> {
  if (!Number.isInteger(qty) || qty <= 0) return fail('Quantity must be a positive whole number');
  if (m.stock[r] - qty < 1) return fail(`Only ${Math.max(0, Math.floor(m.stock[r] - 1))} ${r} available`);
  let gross = 0;
  for (let i = 0; i < qty; i++) gross += unitPrice(m, r, m.stock[r] - i);
  const fee = gross * m.fee;
  const total = money(gross + fee);
  return ok({
    qty,
    total,
    avgPrice: money(total / qty),
    fee: money(fee),
    priceBefore: m.price[r],
    priceAfter: unitPrice(m, r, m.stock[r] - qty),
  });
}

/** Proceeds of selling `qty` units right now. Unit i is priced at the stock level it creates. */
export function quoteSell(m: MarketState, r: Resource, qty: number): Result<TradeQuote> {
  if (!Number.isInteger(qty) || qty <= 0) return fail('Quantity must be a positive whole number');
  let gross = 0;
  for (let i = 0; i < qty; i++) gross += unitPrice(m, r, m.stock[r] + i + 1);
  // The exchange can only pay out coin it actually holds: gold is never created by selling.
  if (gross > m.treasury) return fail(`${m.name} is short of coin (holds ${Math.floor(m.treasury)}g) and cannot buy that much`);
  const fee = gross * m.fee;
  const total = money(gross - fee);
  return ok({
    qty,
    total,
    avgPrice: money(total / qty),
    fee: money(fee),
    priceBefore: m.price[r],
    priceAfter: unitPrice(m, r, m.stock[r] + qty),
  });
}

/** Largest quantity purchasable with `budget` gold (binary search over the curve). */
export function maxAffordable(m: MarketState, r: Resource, budget: number, cap = 500): number {
  let lo = 0;
  let hi = Math.min(cap, Math.floor(m.stock[r] - 1));
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const q = quoteBuy(m, r, mid);
    if (q.ok && q.data.total <= budget) lo = mid;
    else hi = mid - 1;
  }
  return Math.max(0, lo);
}

/**
 * Apply a quoted trade to the market's books. The caller is responsible for
 * moving gold/goods on the counterparty side *after* validating it can pay.
 */
export function settleOnMarket(world: WorldState, m: MarketState, r: Resource, side: 'buy' | 'sell', q: TradeQuote): void {
  if (side === 'buy') {
    m.stock[r] = Math.round((m.stock[r] - q.qty) * 100) / 100;
    m.tickBuys[r] += q.qty;
    m.treasury = money(m.treasury + q.total - q.fee);
  } else {
    m.stock[r] = Math.round((m.stock[r] + q.qty) * 100) / 100;
    m.tickSells[r] += q.qty;
    m.treasury = money(m.treasury - q.total - q.fee);
  }
  world.guildTreasury = money(world.guildTreasury + q.fee);
  m.volumeToday = money(m.volumeToday + q.total);
  m.price[r] = unitPrice(m, r, m.stock[r]);
}

/** Fold the tick's flows into the EMAs and move demand pressure toward its target. */
export function updatePressure(m: MarketState, citizenBase: Partial<Record<Resource, number>>): void {
  const a = ECONOMY.flowEma;
  for (const r of RESOURCES) {
    m.demandRate[r] = m.demandRate[r] * (1 - a) + (m.tickBuys[r] + m.tickConsumed[r]) * a;
    m.supplyRate[r] = m.supplyRate[r] * (1 - a) + m.tickSells[r] * a;
    m.productionRate[r] = m.productionRate[r] * (1 - a) + m.tickProduced[r] * a;
    m.consumptionRate[r] = m.consumptionRate[r] * (1 - a) + m.tickConsumed[r] * a;
    m.shortageRate[r] = m.shortageRate[r] * (1 - a) + m.tickShortage[r] * a;

    const d = m.demandRate[r];
    const s = m.supplyRate[r];
    const imbalance = (d - s) / (d + s + 0.5);
    const shortage = m.shortageRate[r] / ((citizenBase[r] ?? 0) + 0.2);
    const target = clamp(1 + 0.25 * imbalance + 0.9 * shortage, ECONOMY.pressureMin, ECONOMY.pressureMax);
    m.pressure[r] += (target - m.pressure[r]) * ECONOMY.pressureSpeed;

    m.tickBuys[r] = 0;
    m.tickSells[r] = 0;
    m.tickProduced[r] = 0;
    m.tickConsumed[r] = 0;
    m.tickShortage[r] = 0;
    m.price[r] = unitPrice(m, r, m.stock[r]);
    m.intraday[r].push(Math.round(m.price[r] * 100) / 100);
    if (m.intraday[r].length > ECONOMY.intradayHistory) m.intraday[r].shift();
  }
}

/** Supply level: stock relative to reference (1 = normal). */
export const supplyLevel = (m: MarketState, r: Resource) => m.stock[r] / RESOURCE_DEFS[r].refStock;
