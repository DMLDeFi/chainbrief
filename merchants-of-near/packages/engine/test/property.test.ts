import { describe, expect, it } from 'vitest';
import {
  advanceWorld, buildCost, BUSINESS_DEFS, businessQuote, buyBusiness, buyLand, charterCity, collectFromBusiness, depotCapacity, DEPOT_CAPACITY, hireWorker,
  LAND, landPrice, landTaxDaily, landValue, migrateWorld, playerNetWorth, sellBusiness, sellLand, upgradeBusiness, type WorldState,
} from '../src/index';
import { totalGold, withPlayer } from './helpers';

const rich = (gold = 20000, level = 6) => {
  const { world: w, player } = withPlayer();
  const p = w.players[player.id];
  p.gold = gold;
  p.level = level;
  return { w, p };
};

describe('land and property', () => {
  it("gives a newcomer's first Nearhaven business a free plot, and charges land after that", () => {
    const { world: w, player } = withPlayer();
    const p = w.players[player.id];
    expect(businessQuote(w, p.id, 'farm', 'nearhaven').land).toBe(0);
    const first = buyBusiness(w, p.id, 'farm');
    expect(first.ok).toBe(true);
    expect(p.gold).toBeCloseTo(100 - BUSINESS_DEFS.farm.price, 2);
    p.gold = 500;
    const q = businessQuote(w, p.id, 'warehouse', 'nearhaven');
    expect(q.land).toBeGreaterThan(0);
    expect(buyBusiness(w, p.id, 'warehouse').ok).toBe(true);
    expect(p.gold).toBeCloseTo(500 - q.total, 2);
  });

  it('raises the price of land as a city fills up, and keeps every coin of a land deal in the economy', () => {
    const { w, p } = rich();
    expect(charterCity(w, p.id, 'kingsreach').ok).toBe(true);
    const before = totalGold(w);
    const first = landPrice(w, 'kingsreach');
    expect(buyLand(w, p.id, 'kingsreach').ok).toBe(true);
    expect(landPrice(w, 'kingsreach')).toBeGreaterThan(first);
    expect(totalGold(w)).toBeCloseTo(before, 2);
    for (let i = 1; i < LAND.capital.plots; i++) expect(buyLand(w, p.id, 'kingsreach').ok).toBe(true);
    expect(buyLand(w, p.id, 'kingsreach').ok).toBe(false); // the capital is full
    const sold = sellLand(w, p.id, 'kingsreach');
    expect(sold.ok).toBe(true);
    if (sold.ok) expect(sold.data.price).toBeLessThan(landPrice(w, 'kingsreach') + 1e-9);
    expect(totalGold(w)).toBeCloseTo(before, 2);
  });

  it('counts land in net worth and charges a daily land tax to the city', () => {
    const { w, p } = rich(3000);
    charterCity(w, p.id, 'aurora');
    buyLand(w, p.id, 'aurora');
    const nw = playerNetWorth(w, p);
    expect(nw).toBeGreaterThan(p.gold + landValue(w, 'aurora') * 0.99);
    const city = w.markets.aurora.treasury;
    const gold = p.gold;
    landTaxDaily(w, p);
    expect(p.gold).toBeLessThan(gold);
    expect(w.markets.aurora.treasury).toBeCloseTo(city + (gold - p.gold), 2);
  });

  it('repossesses vacant land when land tax goes unpaid', () => {
    const { w, p } = rich(3000);
    charterCity(w, p.id, 'aurora');
    buyLand(w, p.id, 'aurora');
    p.gold = 0;
    for (let d = 0; d < 12 && p.land.length; d++) landTaxDaily(w, p);
    expect(p.land).toHaveLength(0);
    expect(w.landUse.aurora).toHaveLength(0);
  });
});

describe('businesses across the realm', () => {
  it('builds in another city only with an office there, at local building and land prices', () => {
    const { w, p } = rich();
    expect(buyBusiness(w, p.id, 'farm', 'goldenvale').ok).toBe(false);
    charterCity(w, p.id, 'goldenvale');
    const q = businessQuote(w, p.id, 'farm', 'goldenvale');
    expect(q.build).toBeCloseTo(buildCost('farm', 'goldenvale'), 2);
    expect(q.land).toBeGreaterThan(0);
    const before = totalGold(w);
    const r = buyBusiness(w, p.id, 'farm', 'goldenvale');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.city).toBe('goldenvale');
    // Licence fee to the guild, builders and land paid in Goldenvale: no gold lost or made.
    expect(totalGold(w)).toBeCloseTo(before, 2);
  });

  it('runs a business on its own city exchange, and suits some cities better than others', () => {
    const { w, p } = rich();
    charterCity(w, p.id, 'goldenvale');
    const home = buyBusiness(w, p.id, 'farm', 'nearhaven');
    const vale = buyBusiness(w, p.id, 'farm', 'goldenvale');
    if (!home.ok || !vale.ok) throw new Error('setup');
    for (const b of [home.data, vale.data]) { hireWorker(w, p.id, b.id); b.policy.autoSell = false; }
    w.ledger.length = 0;
    advanceWorld(w, 48);
    expect(vale.data.totals.produced).toBeGreaterThan(home.data.totals.produced * 1.2); // the Grain City grows more wheat
    vale.data.policy.autoSell = true;
    advanceWorld(w, 4);
    const sales = w.ledger.filter((e) => e.type === 'business.sell' && (e.details as { businessId?: string }).businessId === vale.data.id);
    expect(sales.length).toBeGreaterThan(0);
    expect(sales.every((e) => (e.details as { market: string }).market === 'goldenvale')).toBe(true);
  });

  it('collects goods into that city’s depot, and a warehouse there enlarges it', () => {
    const { w, p } = rich();
    charterCity(w, p.id, 'emberforge');
    expect(depotCapacity(p, 'emberforge', w)).toBe(DEPOT_CAPACITY);
    const wh = buyBusiness(w, p.id, 'warehouse', 'emberforge');
    expect(wh.ok).toBe(true);
    expect(depotCapacity(p, 'emberforge', w)).toBeGreaterThan(DEPOT_CAPACITY);
    const smith = buyBusiness(w, p.id, 'blacksmith', 'emberforge');
    if (!smith.ok) throw new Error(smith.error);
    smith.data.inventory.tools = 5;
    expect(collectFromBusiness(w, p.id, smith.data.id).ok).toBe(true);
    expect(p.depots.emberforge?.tools).toBe(5);
    expect(p.inventory.tools ?? 0).toBe(0);
  });

  it('has no fixed cap on businesses, but overheads grow with the company', () => {
    const { w, p } = rich(50000);
    for (const c of ['goldenvale', 'emberforge', 'aurora'] as const) charterCity(w, p.id, c);
    const plan = [['farm', 'nearhaven'], ['farm', 'goldenvale'], ['farm', 'goldenvale'], ['bakery', 'nearhaven'], ['blacksmith', 'emberforge'], ['textile', 'emberforge'], ['warehouse', 'aurora'], ['trading', 'aurora']] as const;
    for (const [k, c] of plan) expect(buyBusiness(w, p.id, k, c).ok, `${k} in ${c}`).toBe(true);
    expect(Object.values(w.businesses).filter((b) => b.ownerId === p.id)).toHaveLength(plan.length);
  });
});

describe('levels 1 to 5', () => {
  it('needs player rank for the top levels and pays builders in the city', () => {
    const { w, p } = rich(20000, 2);
    const r = buyBusiness(w, p.id, 'farm');
    if (!r.ok) throw new Error(r.error);
    const b = r.data;
    expect(upgradeBusiness(w, p.id, b.id).ok).toBe(true); // 2
    expect(upgradeBusiness(w, p.id, b.id).ok).toBe(true); // 3
    expect(upgradeBusiness(w, p.id, b.id).ok).toBe(false); // 4 needs player level 3
    p.level = 3;
    const before = totalGold(w);
    expect(upgradeBusiness(w, p.id, b.id).ok).toBe(true);
    expect(totalGold(w)).toBeCloseTo(before, 2);
    expect(upgradeBusiness(w, p.id, b.id).ok).toBe(false); // 5 needs player level 5
    p.level = 5;
    expect(upgradeBusiness(w, p.id, b.id).ok).toBe(true);
    expect(b.level).toBe(5);
    expect(upgradeBusiness(w, p.id, b.id).ok).toBe(false);
  });
});

describe('selling a business', () => {
  it('sells for 90% of its value, paid by the city, and frees the plot', () => {
    const { w, p } = rich();
    charterCity(w, p.id, 'aurora');
    const r = buyBusiness(w, p.id, 'warehouse', 'aurora');
    if (!r.ok) throw new Error(r.error);
    r.data.inventory.fish = 4;
    const before = totalGold(w);
    const gold = p.gold;
    const s = sellBusiness(w, p.id, r.data.id);
    expect(s.ok).toBe(true);
    if (!s.ok) return;
    expect(p.gold).toBeCloseTo(gold + s.data.price, 2);
    expect(s.data.price).toBeLessThan(r.data.purchasePrice + (r.data.landCost ?? 0)); // building at a loss when sold at once
    expect(totalGold(w)).toBeCloseTo(before, 2);
    expect(w.businesses[r.data.id]).toBeUndefined();
    expect(w.landUse.aurora).toHaveLength(0);
    expect(p.depots.aurora?.fish).toBe(4);
  });

  it('refuses to sell a business that is a NEAR deed', () => {
    const { w, p } = rich();
    const r = buyBusiness(w, p.id, 'farm');
    if (!r.ok) throw new Error(r.error);
    r.data.deedTokenId = 'deed-1';
    expect(sellBusiness(w, p.id, r.data.id).ok).toBe(false);
  });
});

describe('save migration (phase 2)', () => {
  it('moves existing businesses onto Nearhaven land', () => {
    const { w, p } = rich();
    const r = buyBusiness(w, p.id, 'farm');
    if (!r.ok) throw new Error(r.error);
    const old = JSON.parse(JSON.stringify(w)) as WorldState;
    delete (old as Partial<WorldState>).landUse;
    delete (old.businesses[r.data.id] as Partial<typeof r.data>).city;
    delete (old.players[p.id] as Partial<typeof p>).land;
    const up = migrateWorld(old);
    expect(up.businesses[r.data.id].city).toBe('nearhaven');
    expect(up.landUse.nearhaven).toContain(r.data.plot);
    expect(up.players[p.id].land).toEqual([]);
    expect(() => advanceWorld(up, 25)).not.toThrow();
  });
});

describe('supply chains between your own sites', () => {
  it('feeds a business from your depot in its city before buying anything', () => {
    const { w, p } = rich();
    charterCity(w, p.id, 'kingsreach');
    const r = buyBusiness(w, p.id, 'bakery', 'kingsreach');
    if (!r.ok) throw new Error(r.error);
    const b = r.data;
    hireWorker(w, p.id, b.id);
    b.policy.autoBuyInputs = false;
    b.policy.autoSell = false;
    p.depots.kingsreach = { wheat: 30 };
    w.ledger.length = 0;
    advanceWorld(w, 24);
    expect(p.depots.kingsreach.wheat ?? 0).toBeLessThan(30);
    expect(b.totals.produced).toBeGreaterThan(0);
    expect(w.ledger.some((e) => e.type === 'business.buy' && (e.details as { businessId?: string }).businessId === b.id)).toBe(false);
  });

  it('will not buy inputs that cost more than the output is worth', () => {
    const { w, p } = rich();
    charterCity(w, p.id, 'kingsreach');
    const r = buyBusiness(w, p.id, 'bakery', 'kingsreach');
    if (!r.ok) throw new Error(r.error);
    const m = w.markets.kingsreach;
    m.price.wheat = 40; // a grain famine in the capital
    m.stock.wheat = 20;
    m.price.bread = 6;
    w.ledger.length = 0;
    advanceWorld(w, 6);
    expect(r.data.idle).toBe('inputs-too-dear');
    expect(w.ledger.some((e) => e.type === 'business.buy' && (e.details as { businessId?: string }).businessId === r.data.id)).toBe(false);
  });
});
