import { MARKETS, type MarketId } from './config';
import type { AcquisitionOffer, Business, PlayerState, Result, Subsidiary, WorldState } from './types';
import { clamp, fail, money, newId, ok, pushFeed } from './internal';
import { CITY_DEFS } from './cities';
import { hasAccess } from './logistics';
import { BUSINESS_DEFS, businessCapacity, businessSaleValue } from './businesses';
import { landValue } from './property';
import { affinity } from './property';
import { cityPopulation, growthFactors } from './civic';
import { debtOf, depotValue, inventoryValue, investmentValue, playerNetWorth } from './valuation';
import { landHoldingsValue } from './property';
import { invTotal, nextRandom as random } from './internal';

/**
 * The corporate layer: a parent company with subsidiaries, acquisitions of
 * other owners' businesses, and finance and property businesses.
 */

// ------------------------------------------------------------ companies ---
/** How many subsidiaries each rank may run. */
export const SUBSIDIARY_LIMIT = [0, 0, 0, 0, 0, 1, 1, 3, 5, 7, 10];
export const SUBSIDIARY_FEE = 300;
export const SUBSIDIARY_DAILY = 4;
export const maxSubsidiaries = (p: PlayerState) => SUBSIDIARY_LIMIT[clamp(p.level, 0, SUBSIDIARY_LIMIT.length - 1)];

const cleanName = (x: unknown) => (typeof x === 'string' ? x.replace(/\s+/g, ' ').trim() : '');
const validName = (n: string) => n.length >= 3 && n.length <= 32 && /^[\p{L}\p{N} '&.,-]+$/u.test(n);

export function setCompanyName(world: WorldState, playerId: string, name: unknown): Result<{ name: string }> {
  const p = world.players[playerId];
  if (!p) return fail('Unknown player');
  const n = cleanName(name);
  if (!validName(n)) return fail('Company names are 3 to 32 letters, numbers, spaces or simple punctuation');
  p.companyName = n;
  return ok({ name: n });
}

/** Found a subsidiary. Registration is paid to the Nearhaven guild; each subsidiary then pays a small daily administration fee. */
export function foundSubsidiary(world: WorldState, playerId: string, name: unknown): Result<Subsidiary> {
  const p = world.players[playerId];
  if (!p) return fail('Unknown player');
  const n = cleanName(name);
  if (!validName(n)) return fail('Company names are 3 to 32 letters, numbers, spaces or simple punctuation');
  p.companies ??= [];
  const limit = maxSubsidiaries(p);
  if (limit === 0) return fail('Subsidiary companies open at rank 5 (Trade Magnate)');
  if (p.companies.length >= limit) return fail(`Your rank allows ${limit} subsidiar${limit === 1 ? 'y' : 'ies'}`);
  if (p.companies.some((c) => c.name.toLowerCase() === n.toLowerCase())) return fail('You already have a company with that name');
  if (p.gold < SUBSIDIARY_FEE) return fail(`Registering a company costs ${SUBSIDIARY_FEE}g`);
  p.gold = money(p.gold - SUBSIDIARY_FEE);
  world.guildTreasury = money(world.guildTreasury + SUBSIDIARY_FEE);
  const c: Subsidiary = { id: newId(world, 'co'), name: n, foundedTick: world.tick };
  p.companies.push(c);
  world.ledger.push({ tick: world.tick, playerId, type: 'company.found', goldDelta: -SUBSIDIARY_FEE, details: { companyId: c.id } });
  pushFeed(world, { kind: 'player', actor: playerId, text: `${p.name} founded ${n}, a subsidiary of ${p.companyName ?? `${p.name}'s company`}.`, severity: 'good' });
  return ok(c);
}

export function dissolveSubsidiary(world: WorldState, playerId: string, companyId: unknown): Result<{ id: string }> {
  const p = world.players[playerId];
  const i = p?.companies?.findIndex((c) => c.id === companyId) ?? -1;
  if (!p || i < 0) return fail('Company not found');
  p.companies!.splice(i, 1);
  for (const b of Object.values(world.businesses)) if (b.ownerId === playerId && b.companyId === companyId) b.companyId = undefined;
  return ok({ id: String(companyId) });
}

/** Put a business under a subsidiary (or back under the parent with null). */
export function assignBusiness(world: WorldState, playerId: string, businessId: unknown, companyId: unknown): Result<Business> {
  const b = world.businesses[String(businessId)];
  if (!b || b.ownerId !== playerId) return fail('Business not found');
  if (companyId === null || companyId === undefined || companyId === '') { b.companyId = undefined; return ok(b); }
  if (!world.players[playerId].companies?.some((c) => c.id === companyId)) return fail('Company not found');
  b.companyId = String(companyId);
  return ok(b);
}

/** Daily: subsidiaries' administration fees; expired acquisition offers are refunded. */
export function corporateDaily(world: WorldState, p: PlayerState): void {
  const n = p.companies?.length ?? 0;
  if (n > 0) {
    const fee = money(Math.min(p.gold, n * SUBSIDIARY_DAILY));
    p.gold = money(p.gold - fee);
    world.guildTreasury = money(world.guildTreasury + fee);
    if (fee > 0) world.ledger.push({ tick: world.tick, playerId: p.id, type: 'company.admin', goldDelta: -fee, details: { companies: n } });
  }
}

// -------------------------------------------------------- acquisitions ---
/**
 * Offers stay open until the buyer withdraws them, the owner answers, or the
 * business changes hands. Game time runs fast (an hour every couple of
 * seconds), so a game-time deadline would expire before another player even
 * logs in. The buyer's gold sits in escrow and can be withdrawn at any time.
 */
export const OFFER_HOURS = Number.MAX_SAFE_INTEGER;
export const ACQUISITION_LEVEL = 6;

export function makeOffer(world: WorldState, buyerId: string, req: { businessId: unknown; price: unknown }): Result<AcquisitionOffer> {
  const p = world.players[buyerId];
  if (!p) return fail('Unknown player');
  if (p.level < ACQUISITION_LEVEL) return fail(`Acquisitions open at rank ${ACQUISITION_LEVEL} (Master Merchant)`);
  const b = world.businesses[String(req.businessId)];
  if (!b) return fail('Business not found');
  if (b.ownerId === buyerId) return fail('You already own it');
  if (b.deedTokenId || b.chainOwner) return fail('This business is a NEAR deed: buy it on the deed marketplace');
  const city = b.city ?? 'nearhaven';
  if (!hasAccess(p, city)) return fail(`Open a trading office in ${CITY_DEFS[city].name} first`);
  const price = Number(req.price);
  if (!Number.isInteger(price) || price < 10 || price > 1_000_000) return fail('Offer a whole number of gold from 10 to 1,000,000');
  if (Object.values(world.offers).some((o) => o.buyerId === buyerId && o.businessId === b.id)) return fail('You already have an offer on this business');
  if (p.gold < price) return fail(`You need ${price}g to back the offer`);
  p.gold = money(p.gold - price); // held in escrow
  const o: AcquisitionOffer = { id: newId(world, 'offer'), businessId: b.id, buyerId, sellerId: b.ownerId, price, tick: world.tick, expiresTick: OFFER_HOURS };
  world.offers[o.id] = o;
  world.ledger.push({ tick: world.tick, playerId: buyerId, type: 'offer.escrow', goldDelta: -price, details: { offerId: o.id, businessId: b.id } });
  const seller = world.players[b.ownerId];
  pushFeed(world, { kind: 'player', actor: buyerId, market: city, text: `${p.name} offered ${price}g for ${b.name}${seller ? ` (owned by ${seller.name})` : ''}.` });
  return ok(o);
}

function refund(world: WorldState, o: AcquisitionOffer, reason: string) {
  delete world.offers[o.id];
  const buyer = world.players[o.buyerId];
  if (!buyer) return;
  buyer.gold = money(buyer.gold + o.price);
  world.ledger.push({ tick: world.tick, playerId: o.buyerId, type: 'offer.refund', goldDelta: o.price, details: { offerId: o.id, reason } });
}

export function respondToOffer(world: WorldState, playerId: string, offerId: unknown, accept: unknown): Result<{ accepted: boolean }> {
  const o = world.offers[String(offerId)];
  if (!o) return fail('Offer not found');
  const b = world.businesses[o.businessId];
  if (o.sellerId !== playerId || !b || b.ownerId !== playerId) return fail('Only the owner can answer this offer');
  if (!accept) { refund(world, o, 'declined'); return ok({ accepted: false }); }
  if (b.deedTokenId || b.chainOwner) return fail('This business became a NEAR deed and must be sold on-chain');
  const seller = world.players[playerId], buyer = world.players[o.buyerId];
  if (!buyer) { refund(world, o, 'buyer gone'); return fail('The buyer no longer exists'); }
  delete world.offers[o.id];
  // Bank capital belongs to the seller and is paid out before the business changes hands.
  if (b.capital) { seller.gold = money(seller.gold + b.capital); b.capital = 0; }
  seller.gold = money(seller.gold + o.price);
  b.ownerId = buyer.id;
  b.companyId = undefined;
  b.starterGrant = undefined;
  b.name = b.name.replace(seller.name, buyer.name);
  b.purchasePrice = o.price;
  b.landCost = 0;
  b.totals = { revenue: 0, expenses: o.price, produced: 0 };
  b.history = [];
  // Other offers on the same business are void.
  for (const other of Object.values(world.offers)) if (other.businessId === b.id) refund(world, other, 'sold to another buyer');
  buyer.lifetime.acquisitions = (buyer.lifetime.acquisitions ?? 0) + 1;
  world.ledger.push({ tick: world.tick, playerId, type: 'business.sold', goldDelta: o.price, details: { businessId: b.id, buyerId: buyer.id } });
  world.ledger.push({ tick: world.tick, playerId: buyer.id, type: 'business.acquired', goldDelta: 0, details: { businessId: b.id, sellerId: playerId, price: o.price } });
  pushFeed(world, { kind: 'player', actor: buyer.id, market: b.city, text: `${buyer.name} acquired ${b.name} from ${seller.name} for ${o.price}g.`, severity: 'good' });
  return ok({ accepted: true });
}

export function cancelOffer(world: WorldState, playerId: string, offerId: unknown): Result<{ id: string }> {
  const o = world.offers[String(offerId)];
  if (!o || o.buyerId !== playerId) return fail('Offer not found');
  refund(world, o, 'withdrawn');
  return ok({ id: o.id });
}

export function expireOffers(world: WorldState): void {
  for (const o of Object.values(world.offers ?? {})) {
    const b = world.businesses[o.businessId];
    if (world.tick >= o.expiresTick) refund(world, o, 'expired');
    else if (!b || b.ownerId !== o.sellerId) refund(world, o, 'business changed hands');
  }
}

// -------------------------------------------------------- finance & property ---
export const BANK_BASE_YIELD = 0.004; // per day on deposited capital

export function bankDeposit(world: WorldState, playerId: string, businessId: unknown, amount: unknown): Result<Business> {
  const b = world.businesses[String(businessId)];
  if (!b || b.ownerId !== playerId || b.kind !== 'bank') return fail('Bank not found');
  const p = world.players[playerId];
  const a = Number(amount);
  if (!Number.isInteger(a) || a === 0 || Math.abs(a) > 1_000_000) return fail('Enter a whole amount of gold');
  if (a > 0) {
    const room = businessCapacity(b) - (b.capital ?? 0);
    if (a > room) return fail(`This bank can hold ${Math.floor(room)}g more; upgrade it to hold more`);
    if (p.gold < a) return fail(`You have ${Math.floor(p.gold)}g`);
  } else if (-a > (b.capital ?? 0)) return fail(`The bank holds ${Math.floor(b.capital ?? 0)}g of your capital`);
  p.gold = money(p.gold - a);
  b.capital = money((b.capital ?? 0) + a);
  world.ledger.push({ tick: world.tick, playerId, type: a > 0 ? 'bank.deposit' : 'bank.withdraw', goldDelta: -a, details: { businessId: b.id } });
  return ok(b);
}

/** Daily earnings of finance and property businesses (called from the business daily cycle). */
export function financeDaily(world: WorldState, b: Business): number {
  const p = world.players[b.ownerId];
  const city: MarketId = b.city ?? 'nearhaven';
  const m = world.markets[city];
  if (!p || b.workers < 1) return 0;
  const def = BUSINESS_DEFS[b.kind];
  const eff = def.efficiency[b.level - 1] * affinity(city, b.kind);
  let income = 0;
  if (b.kind === 'bank') {
    const cap = b.capital ?? 0;
    if (cap < 1) { b.idle = 'no-capital'; return 0; }
    b.idle = null;
    // Lending pays more in a bigger, busier city; hard times bring bad debts.
    const size = Math.min(1.5, Math.sqrt(cityPopulation(world, city) / CITY_DEFS[city].population));
    income = cap * BANK_BASE_YIELD * eff * size * Math.min(1, b.workers / 2);
    const food = growthFactors(world, city).food;
    if (food < 0.85 && random(world) < 0.04) {
      const loss = money(cap * 0.06);
      b.capital = money(cap - loss);
      b.today.expenses += loss; b.totals.expenses += loss;
      pushFeed(world, { kind: 'player', actor: p.id, market: city, text: `Hard times in ${CITY_DEFS[city].name}: ${b.name} wrote off ${loss}g of bad debts.`, severity: 'bad' });
    }
  } else if (b.kind === 'estate') {
    const plots = p.land.filter((l) => l.city === city).length;
    if (!plots) { b.idle = 'no-land'; return 0; }
    b.idle = null;
    income = plots * landValue(world, city) * 0.02 * eff;
  } else return 0;
  // Borrowers and tenants pay out of the city's purse.
  income = money(Math.min(income, Math.max(0, m.treasury - 200)));
  if (income <= 0) return 0;
  m.treasury = money(m.treasury - income);
  p.gold = money(p.gold + income);
  b.today.revenue += income;
  b.totals.revenue += income;
  world.ledger.push({ tick: world.tick, playerId: p.id, type: b.kind === 'bank' ? 'bank.interest' : 'estate.rent', goldDelta: income, details: { businessId: b.id } });
  return income;
}

// ------------------------------------------------------------- reporting ---
interface Totals { businesses: number; employees: number; revenue7: number; expenses7: number; profit7: number; profit1: number; assets: number; invested: number }
const zero = (): Totals => ({ businesses: 0, employees: 0, revenue7: 0, expenses7: 0, profit7: 0, profit1: 0, assets: 0, invested: 0 });
function add(t: Totals, b: Business, world: WorldState) {
  const h = b.history.slice(-7);
  t.businesses += 1;
  t.employees += b.workers;
  t.revenue7 += h.reduce((s, x) => s + x.revenue, 0);
  t.expenses7 += h.reduce((s, x) => s + x.expenses, 0);
  t.profit7 += h.reduce((s, x) => s + x.profit, 0);
  t.profit1 += h.at(-1)?.profit ?? 0;
  t.assets += businessSaleValue(world, b).total + inventoryValue(world, b.inventory, b.city ?? 'nearhaven') + (b.capital ?? 0);
  t.invested += b.purchasePrice + (b.landCost ?? 0);
}
const round = (t: Totals) => Object.fromEntries(Object.entries(t).map(([k, v]) => [k, money(v)])) as unknown as Totals;

/** The whole empire at a glance: balance sheet, results, and breakdowns by city and by company. */
export function companyReport(world: WorldState, playerId: string) {
  const p = world.players[playerId];
  const mine = Object.values(world.businesses).filter((b) => b.ownerId === playerId);
  const all = zero();
  const byCity = Object.fromEntries(MARKETS.map((c) => [c, zero()])) as Record<MarketId, Totals>;
  const byCompany: Record<string, Totals> = { parent: zero() };
  for (const c of p.companies ?? []) byCompany[c.id] = zero();
  for (const b of mine) {
    add(all, b, world);
    add(byCity[b.city ?? 'nearhaven'], b, world);
    add(byCompany[b.companyId && byCompany[b.companyId] ? b.companyId : 'parent'], b, world);
  }
  const stock = invTotal(p.inventory) + Object.values(p.depots ?? {}).reduce((s, inv) => s + invTotal(inv ?? {}), 0);
  const debt = debtOf(world, { kind: 'player', id: playerId });
  const netWorth = playerNetWorth(world, p);
  const goods = inventoryValue(world, p.inventory) + depotValue(world, p);
  // Return per 30 game days on what was spent building (game days pass in minutes, so annualising would mislead).
  const roi = all.invested > 0 ? ((all.profit7 / 7) * 30) / all.invested : 0;
  return {
    name: p.companyName ?? `${p.name} & Co.`,
    netWorth,
    cash: money(p.gold),
    debt: money(debt),
    balance: {
      cash: money(p.gold),
      businesses: money(all.assets),
      land: landHoldingsValue(world, p),
      goods: money(goods),
      investments: investmentValue(world, playerId),
      liabilities: money(debt),
    },
    results: round(all),
    capacity: mine.reduce((s, b) => s + businessCapacity(b), 0),
    stockUnits: Math.round(stock),
    plots: mine.length + (p.land?.length ?? 0),
    monthlyReturn: Math.round(roi * 1000) / 10,
    byCity: Object.fromEntries(Object.entries(byCity).filter(([, t]) => t.businesses > 0).map(([c, t]) => [c, round(t)])),
    byCompany: Object.fromEntries(Object.entries(byCompany).map(([id, t]) => [id, round(t)])),
    history: p.history.slice(-30),
  };
}
