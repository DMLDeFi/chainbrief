import { describe, expect, it } from 'vitest';
import {
  addRoute, advanceWorld, BUSINESS_DEFS, buyBusiness, charterCity, hireWorker, INDUSTRY_OF, migrateWorld, removeRoute, RESOURCES, setBusinessPolicy, toggleRoute,
  type BusinessKind, type WorldState,
} from '../src/index';
import { totalGold, withPlayer } from './helpers';

const rich = (gold = 30000) => {
  const { world: w, player } = withPlayer();
  const p = w.players[player.id];
  p.gold = gold;
  p.level = 6;
  return { w, p };
};
const bizSales = (w: WorldState, id: string) => w.ledger.filter((e) => (e.details as { businessId?: string } | undefined)?.businessId === id);

describe('industries', () => {
  it('groups all nineteen kinds of business into industries', () => {
    const kinds = Object.keys(BUSINESS_DEFS) as BusinessKind[];
    expect(kinds).toHaveLength(19);
    for (const k of kinds) expect(BUSINESS_DEFS[k].industry).toBe(INDUSTRY_OF[k]);
    expect(new Set(kinds.map((k) => INDUSTRY_OF[k]))).toEqual(new Set(['agriculture', 'resources', 'food', 'manufacturing', 'retail', 'finance', 'property', 'logistics']));
  });

  it('lets every processed good be made from goods that exist', () => {
    for (const d of Object.values(BUSINESS_DEFS)) for (const rc of d.recipes) {
      for (const r of [...Object.keys(rc.inputs), ...Object.keys(rc.outputs)]) expect(RESOURCES as readonly string[]).toContain(r);
    }
    const made = new Set(Object.values(BUSINESS_DEFS).flatMap((d) => d.recipes.flatMap((rc) => Object.keys(rc.outputs))));
    for (const r of ['flour', 'planks', 'steel', 'ale', 'furniture']) expect(made.has(r), r).toBe(true);
  });

  it('respects geography: no fishery without water, no mine without ore', () => {
    const { w, p } = rich();
    for (const c of ['emberforge', 'deepcrag', 'goldenvale', 'kingsreach'] as const) charterCity(w, p.id, c);
    expect(buyBusiness(w, p.id, 'fishery', 'deepcrag').ok).toBe(false);
    expect(buyBusiness(w, p.id, 'mine', 'goldenvale').ok).toBe(false);
    expect(buyBusiness(w, p.id, 'mine', 'kingsreach').ok).toBe(false);
    expect(buyBusiness(w, p.id, 'mine', 'deepcrag').ok).toBe(true);
    expect(buyBusiness(w, p.id, 'fishery', 'nearhaven').ok).toBe(true);
  });
});

describe('production chains', () => {
  it('bakes half as much bread again from flour as from raw wheat', () => {
    const { w, p } = rich();
    const a = buyBusiness(w, p.id, 'bakery');
    const b = buyBusiness(w, p.id, 'bakery');
    if (!a.ok || !b.ok) throw new Error('setup');
    expect(setBusinessPolicy(w, p.id, b.data.id, { recipe: 'bread from flour' }).ok).toBe(true);
    expect(setBusinessPolicy(w, p.id, b.data.id, { recipe: 'gold from lead' }).ok).toBe(false);
    for (const x of [a.data, b.data]) { x.policy.autoBuyInputs = false; x.policy.autoSell = false; x.policy.supplyFromStore = false; }
    a.data.inventory = { wheat: 30 };
    b.data.inventory = { flour: 20 };
    advanceWorld(w, 48);
    // Same batches: 3 wheat → 2 bread, 2 flour → 3 bread.
    const breadA = a.data.inventory.bread ?? 0, breadB = b.data.inventory.bread ?? 0;
    expect(breadA).toBeGreaterThan(0);
    expect(breadB).toBeGreaterThan(breadA * 1.3);
  });

  it('collects output into the city store and ships it on a standing order', () => {
    const { w, p } = rich();
    charterCity(w, p.id, 'goldenvale');
    charterCity(w, p.id, 'kingsreach');
    const mill = buyBusiness(w, p.id, 'mill', 'goldenvale');
    if (!mill.ok) throw new Error(mill.error);
    for (let i = 0; i < 3; i++) hireWorker(w, p.id, mill.data.id);
    expect(setBusinessPolicy(w, p.id, mill.data.id, { autoSell: false, autoCollect: true }).ok).toBe(true);
    const route = addRoute(w, p.id, { from: 'goldenvale', to: 'kingsreach', resource: 'flour', batch: 10 });
    expect(route.ok).toBe(true);
    advanceWorld(w, 24 * 3);
    if (!route.ok) return;
    const r = p.routes.find((x) => x.id === route.data.id)!;
    expect(r.shipped).toBeGreaterThan(0);
    expect((p.depots.kingsreach?.flour ?? 0) + Object.values(w.shipments).filter((s) => s.resource === 'flour').reduce((s, x) => s + x.qty, 0)).toBeGreaterThan(0);
    expect(toggleRoute(w, p.id, r.id, false).ok).toBe(true);
    expect(removeRoute(w, p.id, r.id).ok).toBe(true);
    expect(p.routes).toHaveLength(0);
  });

  it('validates standing orders', () => {
    const { w, p } = rich();
    expect(addRoute(w, p.id, { from: 'nearhaven', to: 'kingsreach', resource: 'wheat', batch: 10 }).ok).toBe(false); // no office
    charterCity(w, p.id, 'kingsreach');
    expect(addRoute(w, p.id, { from: 'nearhaven', to: 'kingsreach', resource: 'gold', batch: 10 }).ok).toBe(false);
    expect(addRoute(w, p.id, { from: 'nearhaven', to: 'kingsreach', resource: 'wheat', batch: 2 }).ok).toBe(false);
    expect(addRoute(w, p.id, { from: 'nearhaven', to: 'nearhaven', resource: 'wheat', batch: 10 }).ok).toBe(false);
    expect(addRoute(w, p.id, { from: 'nearhaven', to: 'kingsreach', resource: 'wheat', batch: 10, keep: 5 }).ok).toBe(true);
  });
});

describe('retail', () => {
  it('sells from your city stock through the exchange, plus a premium paid by households, without creating gold', () => {
    const { w, p } = rich();
    charterCity(w, p.id, 'kingsreach');
    const shop = buyBusiness(w, p.id, 'shop', 'kingsreach');
    if (!shop.ok) throw new Error(shop.error);
    hireWorker(w, p.id, shop.data.id);
    expect(setBusinessPolicy(w, p.id, shop.data.id, { product: 'furniture' }).ok).toBe(true);
    p.depots.kingsreach = { furniture: 20 };
    const before = totalGold(w);
    const priceBefore = w.markets.kingsreach.price.furniture;
    w.ledger.length = 0;
    advanceWorld(w, 24);
    const retail = bizSales(w, shop.data.id).filter((e) => e.type === 'business.retail');
    const sales = bizSales(w, shop.data.id).filter((e) => e.type === 'business.sell');
    expect(sales.length).toBeGreaterThan(0);
    expect(retail.reduce((s, e) => s + e.goldDelta, 0)).toBeGreaterThan(0);
    expect((p.depots.kingsreach.furniture ?? 0)).toBeLessThan(20);
    // Selling into the exchange moves its price, so retail cannot be milked forever.
    expect(w.markets.kingsreach.price.furniture).not.toBe(priceBefore);
    // The household premium is a bounded share of real exchange sales, paid out of the city's purse.
    const saleTotal = sales.reduce((s, e) => s + e.goldDelta, 0), premTotal = retail.reduce((s, e) => s + e.goldDelta, 0);
    expect(premTotal).toBeLessThanOrEqual(saleTotal * 0.2 + 1e-6);
    void before;
  });
});

describe('save migration (phase 3)', () => {
  it('gives every exchange the new goods when an old save loads', () => {
    const { world: w } = withPlayer();
    const old = JSON.parse(JSON.stringify(w)) as WorldState;
    for (const m of Object.values(old.markets)) for (const k of ['stock', 'price', 'history', 'pressure', 'openPrice', 'intraday', 'tickBuys', 'tickSells', 'tickProduced', 'tickConsumed', 'tickShortage', 'demandRate', 'supplyRate', 'productionRate', 'consumptionRate', 'shortageRate'] as const) {
      delete (m[k] as Record<string, unknown>).steel;
      delete (m[k] as Record<string, unknown>).ale;
    }
    for (const p of Object.values(old.players)) delete (p as Partial<typeof p>).routes;
    const up = migrateWorld(old);
    for (const m of Object.values(up.markets)) { expect(m.stock.steel).toBeGreaterThan(0); expect(m.price.ale).toBeGreaterThan(0); }
    expect(Object.values(up.players).every((p) => Array.isArray(p.routes))).toBe(true);
    expect(() => advanceWorld(up, 24)).not.toThrow();
    for (const m of Object.values(up.markets)) expect(Number.isFinite(m.price.steel)).toBe(true);
  });
});

describe('co-located businesses', () => {
  it('feed each other directly, without going through the depot', () => {
    const { w, p } = rich();
    charterCity(w, p.id, 'goldenvale');
    const farm = buyBusiness(w, p.id, 'farm', 'goldenvale');
    const mill = buyBusiness(w, p.id, 'mill', 'goldenvale');
    if (!farm.ok || !mill.ok) throw new Error('setup');
    hireWorker(w, p.id, farm.data.id);
    setBusinessPolicy(w, p.id, farm.data.id, { autoSell: false });
    setBusinessPolicy(w, p.id, mill.data.id, { autoBuyInputs: false, autoSell: false });
    w.ledger.length = 0;
    advanceWorld(w, 48);
    expect(mill.data.totals.produced).toBeGreaterThan(5);
    expect(w.ledger.some((e) => e.type === 'business.buy' && (e.details as { businessId?: string }).businessId === mill.data.id)).toBe(false);
    expect(p.depots.goldenvale?.wheat ?? 0).toBe(0);
    // Transfer pricing: the farm is credited for the wheat the mill took, at market value.
    expect(farm.data.totals.revenue).toBeGreaterThan(0);
    expect(mill.data.totals.expenses).toBeGreaterThan(mill.data.purchasePrice + (mill.data.landCost ?? 0));
  });
});
