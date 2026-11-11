import { awardPoints } from './guilds';
import { PLAYER, RESOURCE_DEFS, RESOURCES, type MarketId, type Resource } from './config';
import type { Listing, PlayerState, Result, WorldState } from './types';
import { addInv, clamp, dayOf, fail, fmt, invTotal, money, newId, ok, pct, pushFeed } from './internal';
import { quoteBuy, quoteSell, settleOnMarket, type TradeQuote } from './market';
import { bumpMetric, evaluateProgression, refreshMissions } from './progression';
import { playerCapacity } from './businesses';
import { logDecision, remember, ROLE_SPECS } from './merchants';
import { playerNetWorth } from './valuation';
import { depotCapacity, hasAccess, storeFor, totalHeld } from './logistics';
import { CITY_DEFS } from './cities';

export const isResource = (r: unknown): r is Resource => typeof r === 'string' && (RESOURCES as readonly string[]).includes(r);
const FOOD: Resource[] = ['bread', 'fish', 'livestock'];

export function registerPlayer(world: WorldState, id: string, name: string): Result<PlayerState> {
  if (world.players[id]) return fail('Player already exists');
  const clean = name.trim();
  if (!/^[\p{L}\p{N} _'-]{3,20}$/u.test(clean)) return fail('Name must be 3-20 letters, numbers, spaces, - or _');
  if (Object.values(world.players).some((p) => p.name.toLowerCase() === clean.toLowerCase())) return fail('That merchant name is taken');
  const p: PlayerState = {
    id,
    name: clean,
    joinedTick: world.tick,
    gold: PLAYER.startingGold,
    inventory: {},
    costBasis: {},
    warehouseCapacity: PLAYER.startingWarehouse,
    warehouseLevel: 1,
    xp: 0,
    level: 1,
    reputation: PLAYER.startingReputation,
    achievements: {},
    dayCounters: {},
    weekCounters: {},
    lifetime: {},
    daily: [],
    weekly: [],
    missionDay: -1,
    missionWeek: -1,
    relationships: {},
    credit: { repaid: 0, defaults: 0 },
    history: [],
    marketAccess: ['nearhaven'],
    charters: [],
    depots: {},
    land: [],
    routes: [],
    taxArrears: 0,
  };
  world.players[id] = p;
  refreshMissions(world, p);
  world.ledger.push({ tick: world.tick, playerId: id, type: 'player.register', goldDelta: PLAYER.startingGold, details: {} });
  pushFeed(world, { kind: 'player', actor: id, text: `${clean} arrived in Nearhaven with ${PLAYER.startingGold} gold and big ambitions.` });
  return ok(p);
}

export interface TradeRequest {
  side: 'buy' | 'sell';
  resource: Resource;
  qty: number;
  market?: MarketId;
  /** Slippage protection: reject if average price moves past this. */
  limitPrice?: number;
}

export interface TradeResult extends TradeQuote {
  side: 'buy' | 'sell';
  resource: Resource;
  market: MarketId;
  realizedProfit: number;
  gold: number;
  xp: number;
}

export function playerTrade(world: WorldState, playerId: string, req: TradeRequest): Result<TradeResult> {
  const p = world.players[playerId];
  if (!p) return fail('Unknown player');
  if (req.side !== 'buy' && req.side !== 'sell') return fail('Invalid side');
  if (!isResource(req.resource)) return fail('Unknown resource');
  const qty = Number(req.qty);
  if (!Number.isInteger(qty) || qty < 1 || qty > PLAYER.maxTradeQty) return fail(`Quantity must be a whole number between 1 and ${PLAYER.maxTradeQty}`);
  const marketId: MarketId = req.market ?? 'nearhaven';
  const market = world.markets[marketId];
  if (!market) return fail('Unknown market');
  if (!hasAccess(p, marketId)) {
    const c = CITY_DEFS[marketId].charter;
    return fail(`Open a trading office in ${CITY_DEFS[marketId].name} to trade there${c ? ` (Level ${c.level}, ${c.cost}g)` : ''}`);
  }
  // Goods bought here are stored here: the home warehouse in Nearhaven, the office depot elsewhere.
  const store = storeFor(p, marketId);
  const r = req.resource;

  const q = req.side === 'buy' ? quoteBuy(market, r, qty) : quoteSell(market, r, qty);
  if (!q.ok) return q;
  const quote = q.data;
  if (req.limitPrice !== undefined) {
    const lim = Number(req.limitPrice);
    if (!Number.isFinite(lim) || lim <= 0) return fail('Invalid limit price');
    if (req.side === 'buy' && quote.avgPrice > lim) return fail(`Price moved to ${fmt(quote.avgPrice)} — above your limit of ${fmt(lim)}`);
    if (req.side === 'sell' && quote.avgPrice < lim) return fail(`Price moved to ${fmt(quote.avgPrice)} — below your limit of ${fmt(lim)}`);
  }

  let realized = 0;
  if (req.side === 'buy') {
    if (p.gold < quote.total) return fail(`Not enough gold: need ${fmt(quote.total)}, have ${fmt(p.gold)}`);
    const cap = marketId === 'nearhaven' ? playerCapacity(world, playerId) : depotCapacity(p, marketId, world);
    const free = cap - invTotal(store) - (marketId === 'nearhaven' ? 0 : Object.values(world.shipments).filter((x) => x.ownerId === p.id && x.to === marketId).reduce((a, x) => a + x.qty, 0));
    if (qty > free) return fail(`${marketId === 'nearhaven' ? 'Warehouse' : `${CITY_DEFS[marketId].name} depot`} full: room for ${Math.max(0, Math.floor(free))} more units`);
    // -- validated; mutate --
    settleOnMarket(world, market, r, 'buy', quote);
    const held = totalHeld(world, p, r);
    p.costBasis[r] = money(((p.costBasis[r] ?? 0) * held + quote.total) / (held + qty));
    p.gold = money(p.gold - quote.total);
    addInv(store, r, qty);
    bumpMetric(p, 'unitsBought', qty);
    if (FOOD.includes(r)) bumpMetric(p, 'foodBought', qty);
  } else {
    const held = store[r] ?? 0;
    if (held < qty) return fail(`You only have ${Math.floor(held)} ${r}${marketId === 'nearhaven' ? '' : ` in ${CITY_DEFS[marketId].name}`}`);
    settleOnMarket(world, market, r, 'sell', quote);
    realized = money((quote.avgPrice - (p.costBasis[r] ?? 0)) * qty);
    awardPoints(world, p, realized);
    p.gold = money(p.gold + quote.total);
    addInv(store, r, -qty);
    if (totalHeld(world, p, r) <= 0) delete p.costBasis[r];
    bumpMetric(p, 'unitsSold', qty);
    if (r === 'bread') bumpMetric(p, 'breadSold', qty);
    if (realized > 0) bumpMetric(p, 'profit', realized);
    p.lifetime.realizedProfit = money((p.lifetime.realizedProfit ?? 0) + realized);
  }
  bumpMetric(p, 'trades', 1);
  bumpMetric(p, 'volume', quote.total);
  const xp = Math.min(20, 1 + Math.floor(quote.total / 25));
  p.xp += xp;
  world.ledger.push({
    tick: world.tick,
    playerId,
    type: `trade.${req.side}`,
    goldDelta: req.side === 'buy' ? -quote.total : quote.total,
    items: { [r]: req.side === 'buy' ? qty : -qty },
    details: { market: marketId, avgPrice: quote.avgPrice, fee: quote.fee, realized },
  });
  const move = (quote.priceAfter - quote.priceBefore) / quote.priceBefore;
  pushFeed(world, {
    kind: 'player',
    actor: playerId,
    resource: r,
    market: marketId,
    text: `${p.name} ${req.side === 'buy' ? 'bought' : 'sold'} ${qty} ${RESOURCE_DEFS[r].label.toLowerCase()} at ${fmt(quote.avgPrice)}g${Math.abs(move) >= 0.03 ? `, moving the price ${pct(move)}` : ''}.`,
    data: { qty, price: quote.avgPrice, move: Math.round(move * 1000) / 10 },
  });
  evaluateProgression(world, p);
  return ok({ ...quote, side: req.side, resource: r, market: marketId, realizedProfit: realized, gold: p.gold, xp });
}

export function warehouseExpansionCost(p: PlayerState): number {
  return Math.round(PLAYER.warehouseExpansionBaseCost * Math.pow(1.6, p.warehouseLevel - 1));
}

export function expandWarehouse(world: WorldState, playerId: string): Result<PlayerState> {
  const p = world.players[playerId];
  if (!p) return fail('Unknown player');
  if (p.warehouseLevel >= 8) return fail('Warehouse is at maximum size — buy a Warehouse business for more space');
  const cost = warehouseExpansionCost(p);
  if (p.gold < cost) return fail(`Expansion costs ${cost} gold`);
  p.gold = money(p.gold - cost);
  world.guildTreasury = money(world.guildTreasury + cost * 0.5);
  p.warehouseLevel += 1;
  p.warehouseCapacity += PLAYER.warehouseExpansion;
  p.xp += 15;
  world.ledger.push({ tick: world.tick, playerId, type: 'warehouse.expand', goldDelta: -cost, details: { capacity: p.warehouseCapacity } });
  evaluateProgression(world, p);
  return ok(p);
}

// ------------------------------------------------------ PLAYER MARKETPLACE ---

const LISTING_FEE = 0.02;

export function createListing(world: WorldState, playerId: string, resource: Resource, qty: number, unitPrice: number): Result<Listing> {
  const p = world.players[playerId];
  if (!p) return fail('Unknown player');
  if (p.level < 2) return fail('Player listings unlock at Level 2');
  if (!isResource(resource)) return fail('Unknown resource');
  if (!Number.isInteger(qty) || qty < 1 || qty > PLAYER.maxTradeQty) return fail('Invalid quantity');
  unitPrice = money(Number(unitPrice));
  const ref = world.markets.nearhaven.price[resource];
  // Bounds stop listings being used to funnel gold between accounts.
  if (!(unitPrice >= ref * 0.3 && unitPrice <= ref * 3)) return fail(`Price must be between ${fmt(ref * 0.3)} and ${fmt(ref * 3)}g (30%–300% of market)`);
  if ((p.inventory[resource] ?? 0) < qty) return fail(`You only have ${Math.floor(p.inventory[resource] ?? 0)} ${resource}`);
  const open = Object.values(world.listings).filter((l) => l.sellerId === playerId && l.status === 'open').length;
  if (open >= 10) return fail('You can have at most 10 open listings');
  addInv(p.inventory, resource, -qty); // escrow
  const l: Listing = { id: newId(world, 'lst'), sellerId: playerId, resource, qty, unitPrice, createdTick: world.tick, status: 'open' };
  world.listings[l.id] = l;
  bumpMetric(p, 'listings', 1);
  world.ledger.push({ tick: world.tick, playerId, type: 'listing.create', goldDelta: 0, items: { [resource]: -qty }, details: { listingId: l.id, unitPrice } });
  pushFeed(world, { kind: 'player', actor: playerId, resource, text: `${p.name} listed ${qty} ${resource} on the player market at ${fmt(unitPrice)}g each.` });
  return ok(l);
}

export function cancelListing(world: WorldState, playerId: string, listingId: string): Result<Listing> {
  const l = world.listings[listingId];
  if (!l || l.sellerId !== playerId) return fail('Listing not found');
  if (l.status !== 'open') return fail('Listing is no longer open');
  const p = world.players[playerId];
  l.status = 'cancelled';
  addInv(p.inventory, l.resource, l.qty); // released escrow may exceed capacity; selling is still allowed
  world.ledger.push({ tick: world.tick, playerId, type: 'listing.cancel', goldDelta: 0, items: { [l.resource]: l.qty }, details: { listingId } });
  return ok(l);
}

export function buyListing(world: WorldState, buyerId: string, listingId: string): Result<Listing> {
  const l = world.listings[listingId];
  const buyer = world.players[buyerId];
  if (!buyer) return fail('Unknown player');
  if (!l || l.status !== 'open') return fail('Listing is no longer available');
  if (l.sellerId === buyerId) return fail('You cannot buy your own listing');
  const seller = world.players[l.sellerId];
  const total = money(l.qty * l.unitPrice);
  const fee = money(total * LISTING_FEE);
  if (buyer.gold < total + fee) return fail(`Need ${fmt(total + fee)} gold (incl. 2% fee)`);
  if (playerCapacity(world, buyerId) - invTotal(buyer.inventory) < l.qty) return fail('Not enough warehouse space');
  buyer.gold = money(buyer.gold - total - fee);
  seller.gold = money(seller.gold + total);
  world.guildTreasury = money(world.guildTreasury + fee);
  const held = buyer.inventory[l.resource] ?? 0;
  buyer.costBasis[l.resource] = money(((buyer.costBasis[l.resource] ?? 0) * held + total + fee) / (held + l.qty));
  addInv(buyer.inventory, l.resource, l.qty);
  l.status = 'sold';
  l.buyerId = buyerId;
  bumpMetric(buyer, 'negotiations', 1);
  bumpMetric(seller, 'negotiations', 1);
  bumpMetric(seller, 'volume', total);
  bumpMetric(buyer, 'volume', total);
  buyer.xp += 5;
  seller.xp += 5;
  world.ledger.push({ tick: world.tick, playerId: buyerId, type: 'listing.buy', goldDelta: -(total + fee), items: { [l.resource]: l.qty }, details: { listingId, seller: seller.id } });
  world.ledger.push({ tick: world.tick, playerId: seller.id, type: 'listing.sold', goldDelta: total, details: { listingId, buyer: buyerId } });
  pushFeed(world, { kind: 'player', actor: buyerId, text: `${buyer.name} bought ${l.qty} ${l.resource} from ${seller.name} on the player market.`, severity: 'good' });
  evaluateProgression(world, buyer);
  evaluateProgression(world, seller);
  return ok(l);
}

// ------------------------------------------------------------ NEGOTIATION ---

export interface DealProposal {
  merchantId: string;
  /** From the player's perspective. */
  side: 'buy' | 'sell';
  resource: Resource;
  qty: number;
  unitPrice: number;
}

export interface DealOutcome {
  accepted: boolean;
  counterPrice?: number;
  fairPrice: number;
  reasons: string[];
  mood: 'pleased' | 'neutral' | 'annoyed';
}

/**
 * Deterministic negotiation. A merchant compares the offer to its best market
 * alternative, adjusts for greed, warmth and its relationship with the player,
 * and either accepts, counters or refuses. The optional LLM layer only phrases
 * the reply — it never changes the outcome.
 */
export function evaluateDeal(world: WorldState, playerId: string, d: DealProposal): Result<DealOutcome> {
  const p = world.players[playerId];
  const m = world.merchants[d.merchantId];
  if (!p || !m) return fail('Unknown merchant');
  if (m.status === 'bankrupt') return fail(`${m.name} is bankrupt`);
  if (m.role === 'banker') return fail('The banker deals in credit, not goods');
  if (m.travel) return fail(`${m.name} is away with a caravan`);
  if (!isResource(d.resource)) return fail('Unknown resource');
  if (!Number.isInteger(d.qty) || d.qty < 1 || d.qty > 200) return fail('Quantity must be 1-200');
  const price = money(Number(d.unitPrice));
  if (!(price > 0)) return fail('Invalid price');
  const market = world.markets[m.location];
  const rel = m.relationships[playerId] ?? 0;
  const relAdj = rel / 1000; // ±10%
  const reasons: string[] = [];
  const spec = ROLE_SPECS[m.role];
  if (d.side === 'buy') {
    // Player buys from the merchant: the merchant's alternative is selling to the market.
    const have = Math.floor((m.inventory[d.resource] ?? 0) - (spec?.keep ?? 0));
    if (have < d.qty) return ok({ accepted: false, fairPrice: 0, reasons: [`${m.name} only has ${Math.max(0, have)} ${d.resource} to spare`], mood: 'neutral' });
    const alt = quoteSell(market, d.resource, d.qty);
    if (!alt.ok) return alt;
    const floor = alt.data.avgPrice * (1 + m.personality.greed * 0.12 - m.personality.warmth * 0.04 - relAdj);
    reasons.push(`Market would pay ${m.name} ${fmt(alt.data.avgPrice)} each`);
    if (rel) reasons.push(`Relationship ${rel > 0 ? '+' : ''}${rel}`);
    if (price >= floor) return ok({ accepted: true, fairPrice: money(floor), reasons, mood: price >= floor * 1.05 ? 'pleased' : 'neutral' });
    return ok({ accepted: false, counterPrice: money(floor), fairPrice: money(floor), reasons: [...reasons, `Wants at least ${fmt(floor)}`], mood: price < floor * 0.7 ? 'annoyed' : 'neutral' });
  }
  // Player sells to the merchant: the merchant's alternative is buying from the market.
  const wants = spec?.recipes.some((rc) => rc.inputs[d.resource]) || m.role === 'trader';
  if (!wants) return ok({ accepted: false, fairPrice: 0, reasons: [`${m.name} has no use for ${d.resource}`], mood: 'neutral' });
  if ((p.inventory[d.resource] ?? 0) < d.qty) return fail(`You only have ${Math.floor(p.inventory[d.resource] ?? 0)} ${d.resource}`);
  const alt = quoteBuy(market, d.resource, Math.min(d.qty, Math.max(1, Math.floor(market.stock[d.resource] - 1))));
  if (!alt.ok) return alt;
  const ceiling = alt.data.avgPrice * (1 - m.personality.greed * 0.1 + m.personality.warmth * 0.03 + relAdj);
  reasons.push(`Buying from the market would cost ${fmt(alt.data.avgPrice)} each`);
  if (price * d.qty > m.gold) return ok({ accepted: false, fairPrice: money(ceiling), reasons: [`${m.name} can't afford ${fmt(price * d.qty)}g right now`], mood: 'neutral' });
  if (price <= ceiling) return ok({ accepted: true, fairPrice: money(ceiling), reasons, mood: price <= ceiling * 0.95 ? 'pleased' : 'neutral' });
  return ok({ accepted: false, counterPrice: money(ceiling), fairPrice: money(ceiling), reasons: [...reasons, `Will pay at most ${fmt(ceiling)}`], mood: price > ceiling * 1.4 ? 'annoyed' : 'neutral' });
}

export function proposeDeal(world: WorldState, playerId: string, d: DealProposal): Result<DealOutcome & { executed: boolean }> {
  const ev = evaluateDeal(world, playerId, d);
  if (!ev.ok) return ev;
  const p = world.players[playerId];
  const m = world.merchants[d.merchantId];
  const out = ev.data;
  const price = money(Number(d.unitPrice));
  const total = money(price * d.qty);
  if (!out.accepted) {
    m.relationships[playerId] = clamp((m.relationships[playerId] ?? 0) + (out.mood === 'annoyed' ? -3 : 0), -100, 100);
    logDecision(m, world.tick, `Declined ${p.name}'s offer for ${d.qty} ${d.resource} @ ${fmt(price)}`, out.reasons);
    return ok({ ...out, executed: false });
  }
  if (d.side === 'buy') {
    if (p.gold < total) return fail('Not enough gold');
    if (playerCapacity(world, playerId) - invTotal(p.inventory) < d.qty) return fail('Not enough warehouse space');
    p.gold = money(p.gold - total);
    m.gold = money(m.gold + total);
    addInv(m.inventory, d.resource, -d.qty);
    const held = p.inventory[d.resource] ?? 0;
    p.costBasis[d.resource] = money(((p.costBasis[d.resource] ?? 0) * held + total) / (held + d.qty));
    addInv(p.inventory, d.resource, d.qty);
    m.today.revenue += total;
  } else {
    p.gold = money(p.gold + total);
    m.gold = money(m.gold - total);
    addInv(p.inventory, d.resource, -d.qty);
    addInv(m.inventory, d.resource, d.qty);
    const realized = money((price - (p.costBasis[d.resource] ?? 0)) * d.qty);
    if (realized > 0) bumpMetric(p, 'profit', realized);
    p.lifetime.realizedProfit = money((p.lifetime.realizedProfit ?? 0) + realized);
    m.today.costs += total;
  }
  m.relationships[playerId] = clamp((m.relationships[playerId] ?? 0) + 4, -100, 100);
  p.relationships[m.id] = m.relationships[playerId];
  p.reputation = clamp(p.reputation + 1, 0, 100);
  bumpMetric(p, 'negotiations', 1);
  bumpMetric(p, 'volume', total);
  p.xp += 8;
  remember(m, { tick: world.tick, kind: 'deal', resource: d.resource, qty: d.qty, price, counterparty: playerId, note: `Private deal with ${p.name}: ${d.side === 'buy' ? 'sold' : 'bought'} ${d.qty} ${d.resource} @ ${fmt(price)}` });
  logDecision(m, world.tick, `Accepted ${p.name}'s deal for ${d.qty} ${d.resource} @ ${fmt(price)}`, out.reasons);
  world.ledger.push({ tick: world.tick, playerId, type: `deal.${d.side}`, goldDelta: d.side === 'buy' ? -total : total, items: { [d.resource]: d.side === 'buy' ? d.qty : -d.qty }, details: { merchant: m.id, unitPrice: price } });
  pushFeed(world, { kind: 'trade', actor: m.id, resource: d.resource, text: `${m.name} struck a private deal with ${p.name}: ${d.qty} ${d.resource} at ${fmt(price)}g.`, severity: 'good' });
  evaluateProgression(world, p);
  return ok({ ...out, executed: true });
}

/** End-of-day snapshot for player net-worth history. */
export function playerDaily(world: WorldState, p: PlayerState): void {
  p.history.push({ day: dayOf(world.tick) - 1, netWorth: playerNetWorth(world, p), gold: p.gold });
  if (p.history.length > 60) p.history.shift();
}
