import { describe, expect, it } from 'vitest';
import {
  advanceWorld, buyBusiness, charterCity, civicDaily, freightCost, freightFor, fundProject, hireWorker, infraCost, infraLevel, laborEmployed, laborSupply,
  MARKET_DEFS, migrateWorld, plotCount, populationCap, wageFactor, type WorldState,
} from '../src/index';
import { totalGold, withPlayer } from './helpers';

const rich = (gold = 100000) => {
  const { world: w, player } = withPlayer();
  const p = w.players[player.id];
  p.gold = gold;
  p.level = 6;
  return { w, p };
};

describe('public works', () => {
  it('lets players fund projects in cities where they trade, paying builders in that city', () => {
    const { w, p } = rich();
    expect(fundProject(w, p.id, { city: 'kingsreach', project: 'roads', amount: 100 }).ok).toBe(false); // no office
    charterCity(w, p.id, 'kingsreach');
    expect(fundProject(w, p.id, { city: 'kingsreach', project: 'aqueduct', amount: 100 }).ok).toBe(false);
    expect(fundProject(w, p.id, { city: 'kingsreach', project: 'roads', amount: 5 }).ok).toBe(false);
    const before = totalGold(w);
    const purse = w.markets.kingsreach.treasury;
    const r = fundProject(w, p.id, { city: 'kingsreach', project: 'roads', amount: 300 });
    expect(r.ok).toBe(true);
    expect(w.markets.kingsreach.treasury).toBeCloseTo(purse + 300, 2);
    expect(totalGold(w)).toBeCloseTo(before, 2);
    expect(p.patronage?.kingsreach).toBe(300);
  });

  it('completes a level when fully funded, and each project changes the city', () => {
    const { w, p } = rich();
    for (const c of ['aurora', 'emberforge', 'goldenvale'] as const) charterCity(w, p.id, c);
    const rep = p.reputation;
    // Market hall: lower fee.
    expect(fundProject(w, p.id, { city: 'aurora', project: 'markethall', amount: infraCost('aurora', 'markethall', 1) }).ok).toBe(true);
    expect(infraLevel(w, 'aurora', 'markethall')).toBe(1);
    expect(w.markets.aurora.fee).toBeCloseTo(MARKET_DEFS.aurora.fee - 0.005, 6);
    expect(p.reputation).toBeGreaterThan(rep);
    // Housing: more plots and more room to grow.
    const plots = plotCount(w, 'goldenvale'), cap = populationCap(w, 'goldenvale');
    fundProject(w, p.id, { city: 'goldenvale', project: 'housing', amount: infraCost('goldenvale', 'housing', 1) });
    expect(plotCount(w, 'goldenvale')).toBe(plots + 4);
    expect(populationCap(w, 'goldenvale')).toBeGreaterThan(cap);
    // Roads: cheaper freight.
    fundProject(w, p.id, { city: 'emberforge', project: 'roads', amount: infraCost('emberforge', 'roads', 1) });
    expect(freightFor(w, 'nearhaven', 'emberforge', 100)).toBeLessThan(freightCost('nearhaven', 'emberforge', 100));
    // A completed project cannot be overfunded past its last level.
    for (let lv = 2; lv <= 3; lv++) fundProject(w, p.id, { city: 'aurora', project: 'markethall', amount: infraCost('aurora', 'markethall', lv) });
    expect(infraLevel(w, 'aurora', 'markethall')).toBe(3);
    expect(fundProject(w, p.id, { city: 'aurora', project: 'markethall', amount: 100 }).ok).toBe(false);
  });

  it('makes industry in a city with a workshop quarter more productive', () => {
    const { w, p } = rich();
    charterCity(w, p.id, 'emberforge');
    const a = buyBusiness(w, p.id, 'sawmill', 'emberforge');
    if (!a.ok) throw new Error(a.error);
    a.data.policy.autoSell = false; a.data.policy.autoBuyInputs = false; a.data.policy.supplyFromStore = false;
    a.data.inventory = { wood: 60 };
    advanceWorld(w, 12);
    const base = a.data.totals.produced;
    a.data.inventory = { wood: 60 };
    fundProject(w, p.id, { city: 'emberforge', project: 'workshops', amount: infraCost('emberforge', 'workshops', 1) });
    a.data.totals.produced = 0;
    advanceWorld(w, 12);
    expect(a.data.totals.produced).toBeGreaterThan(base * 1.05);
  });

  it('cities slowly fund their own works from their surplus', () => {
    const { world: w } = withPlayer();
    advanceWorld(w, 24 * 45);
    const levels = (['aurora', 'kingsreach', 'emberforge', 'goldenvale', 'deepcrag'] as const).reduce((s, c) => s + Object.values(w.cities[c].infra).reduce((a, b) => a + (b ?? 0), 0), 0);
    expect(levels).toBeGreaterThan(0);
    expect(levels).toBeLessThan(5 * 6); // far from finished: players still matter
  });
});

describe('labour market', () => {
  it('limits hiring to the hands a city has, and raises wages when work is plentiful', () => {
    const { w, p } = rich();
    charterCity(w, p.id, 'deepcrag');
    w.cities.deepcrag.population = 150; // a small town: few hands to hire
    expect(wageFactor(w, 'deepcrag')).toBe(1);
    const supply = laborSupply(w, 'deepcrag');
    let hired = 0;
    for (let i = 0; i < 40 && laborEmployed(w, 'deepcrag') < supply; i++) {
      const b = buyBusiness(w, p.id, 'quarry', 'deepcrag');
      if (!b.ok) break;
      for (let j = 0; j < 10; j++) if (hireWorker(w, p.id, b.data.id).ok) hired++;
    }
    expect(laborEmployed(w, 'deepcrag')).toBe(supply);
    expect(wageFactor(w, 'deepcrag')).toBeGreaterThan(1.5);
    const any = Object.values(w.businesses).find((b) => b.city === 'deepcrag' && b.workers < 10)!;
    if (any) expect(hireWorker(w, p.id, any.id).ok).toBe(false);
    expect(hired).toBeGreaterThan(0);
  });
});

describe('population', () => {
  it('grows when food is cheap and jobs are there, shrinks when food is dear, and stays within housing', () => {
    const { world: w } = withPlayer();
    const start = w.cities.kingsreach.population;
    for (let d = 0; d < 20; d++) { w.markets.kingsreach.price.bread = 3; w.markets.kingsreach.price.fish = 2; civicDaily(w); }
    const grown = w.cities.kingsreach.population;
    expect(grown).toBeGreaterThan(start);
    for (let d = 0; d < 20; d++) { w.markets.kingsreach.price.bread = 40; w.markets.kingsreach.price.fish = 30; civicDaily(w); }
    expect(w.cities.kingsreach.population).toBeLessThan(grown);
    for (let d = 0; d < 400; d++) { w.markets.kingsreach.price.bread = 2; w.markets.kingsreach.price.fish = 1.5; civicDaily(w); }
    expect(w.cities.kingsreach.population).toBeLessThanOrEqual(populationCap(w, 'kingsreach'));
    expect(w.cities.kingsreach.popHistory.length).toBeLessThanOrEqual(60);
  });
});

describe('save migration (phase 4)', () => {
  it('adds public works and population history to old saves', () => {
    const { world: w } = withPlayer();
    const old = JSON.parse(JSON.stringify(w)) as WorldState;
    for (const c of Object.values(old.cities)) { delete (c as Partial<typeof c>).infra; delete (c as Partial<typeof c>).projects; delete (c as Partial<typeof c>).popHistory; }
    const up = migrateWorld(old);
    for (const c of Object.values(up.cities)) { expect(c.infra).toEqual({}); expect(c.popHistory).toEqual([]); }
    expect(() => advanceWorld(up, 48)).not.toThrow();
  });
});
