import { describe, expect, it } from 'vitest';
import {
  advanceWorld, charterCity, CITY_DEFS, findPath, freightCost, MARKETS, migrateWorld, playerNetWorth, playerTrade, ROUTES, shipGoods, stepWorld, travelTicks,
  type WorldState,
} from '../src/index';
import { freshWorld, totalGold, withPlayer } from './helpers';

describe('world of cities', () => {
  it('connects all six cities through a symmetric route network', () => {
    expect(MARKETS).toHaveLength(6);
    for (const a of MARKETS) for (const b of MARKETS) {
      if (a === b) continue;
      const p = findPath(a, b);
      expect(p, `${a} → ${b}`).not.toBeNull();
      expect(travelTicks(a, b)).toBe(travelTicks(b, a));
    }
    // Direct routes are used when they are fastest.
    expect(travelTicks('nearhaven', 'goldenvale')).toBe(5);
    // Deepcrag is only reachable over mountain passes, via Emberforge from Nearhaven.
    expect(findPath('nearhaven', 'deepcrag')!.cities).toEqual(['nearhaven', 'emberforge', 'deepcrag']);
    expect(ROUTES.every((r) => r.hours > 0)).toBe(true);
  });

  it('gives each city its own exchange and a regional economy that matches its identity', () => {
    const w = freshWorld();
    for (const id of MARKETS) expect(w.markets[id].name).toBeTruthy();
    advanceWorld(w, 24 * 30);
    const price = (c: keyof WorldState['markets'], r: 'iron' | 'wheat' | 'tools' | 'coal') => w.markets[c].price[r];
    expect(price('deepcrag', 'iron')).toBeLessThan(price('kingsreach', 'iron'));
    expect(price('deepcrag', 'coal')).toBeLessThan(price('emberforge', 'coal'));
    expect(price('goldenvale', 'wheat')).toBeLessThan(price('kingsreach', 'wheat'));
    expect(price('emberforge', 'tools')).toBeLessThan(price('deepcrag', 'tools'));
    // No city's purse balloons from hinterland spending: it settles instead of growing without bound.
    const at30 = Object.fromEntries(MARKETS.map((id) => [id, w.markets[id].treasury]));
    advanceWorld(w, 24 * 30);
    for (const id of MARKETS) if (id !== 'nearhaven') {
      expect(w.markets[id].treasury).toBeLessThan(CITY_DEFS[id].treasury * 6);
      expect(w.markets[id].treasury).toBeLessThan(at30[id] * 1.5);
    }
  });
});

describe('long-run money supply', () => {
  it("keeps Nearhaven's town purse bounded despite citizens' outside income", () => {
    const w = freshWorld();
    advanceWorld(w, 24 * 120);
    const at120 = w.markets.nearhaven.treasury;
    advanceWorld(w, 24 * 60);
    expect(w.markets.nearhaven.treasury).toBeLessThan(3000 + w.population * 6 + 6000);
    expect(w.markets.nearhaven.treasury).toBeLessThan(at120 * 1.3);
  });
});

describe('trading offices and depots', () => {
  it('requires the level and charter fee, and pays the fee into that city', () => {
    const { world: w, player } = withPlayer();
    const p = w.players[player.id];
    expect(charterCity(w, p.id, 'kingsreach').ok).toBe(false); // level 1
    expect(playerTrade(w, p.id, { side: 'buy', resource: 'wheat', qty: 5, market: 'goldenvale' }).ok).toBe(false);
    const before = totalGold(w);
    const cityBefore = w.markets.goldenvale.treasury;
    const r = charterCity(w, p.id, 'goldenvale');
    expect(r.ok).toBe(true);
    expect(w.markets.goldenvale.treasury).toBeCloseTo(cityBefore + CITY_DEFS.goldenvale.charter!.cost, 2);
    expect(totalGold(w)).toBeCloseTo(before, 2);
    expect(charterCity(w, p.id, 'goldenvale').ok).toBe(false); // already open
  });

  it('stores goods bought in another city in that city, not at home', () => {
    const { world: w, player } = withPlayer();
    const p = w.players[player.id];
    p.gold = 1000;
    expect(charterCity(w, p.id, 'goldenvale').ok).toBe(true);
    expect(playerTrade(w, p.id, { side: 'buy', resource: 'wheat', qty: 20, market: 'goldenvale' }).ok).toBe(true);
    expect(p.depots.goldenvale?.wheat).toBe(20);
    expect(p.inventory.wheat ?? 0).toBe(0);
    // You cannot sell Goldenvale grain on the Nearhaven exchange until it has travelled there.
    expect(playerTrade(w, p.id, { side: 'sell', resource: 'wheat', qty: 5 }).ok).toBe(false);
    expect(playerTrade(w, p.id, { side: 'sell', resource: 'wheat', qty: 5, market: 'goldenvale' }).ok).toBe(true);
    // Depots have a capacity.
    expect(playerTrade(w, p.id, { side: 'buy', resource: 'wheat', qty: 200, market: 'goldenvale' }).ok).toBe(false);
  });
});

describe('shipping', () => {
  it('moves goods along the route over time, charges freight and keeps them in net worth on the road', () => {
    const { world: w, player } = withPlayer();
    const p = w.players[player.id];
    p.gold = 1000;
    charterCity(w, p.id, 'goldenvale');
    playerTrade(w, p.id, { side: 'buy', resource: 'wheat', qty: 30, market: 'goldenvale' });
    const goldBefore = p.gold;
    const s = shipGoods(w, p.id, { from: 'goldenvale', to: 'nearhaven', resource: 'wheat', qty: 30 });
    expect(s.ok).toBe(true);
    if (!s.ok) return;
    expect(p.gold).toBeCloseTo(goldBefore - freightCost('goldenvale', 'nearhaven', 30), 2);
    expect(p.depots.goldenvale?.wheat ?? 0).toBe(0);
    expect(playerNetWorth(w, p)).toBeGreaterThan(p.gold); // cargo still counts
    const hoursLeft = s.data.arriveTick - w.tick;
    for (let i = 0; i < hoursLeft - 1; i++) stepWorld(w);
    expect(p.inventory.wheat ?? 0).toBe(0);
    stepWorld(w);
    expect(p.inventory.wheat).toBe(30);
    expect(Object.keys(w.shipments)).toHaveLength(0);
  });

  it('rejects shipments to cities without an office, or more than you hold', () => {
    const { world: w, player } = withPlayer();
    const p = w.players[player.id];
    p.inventory.wheat = 10;
    expect(shipGoods(w, p.id, { from: 'nearhaven', to: 'kingsreach', resource: 'wheat', qty: 5 }).ok).toBe(false);
    p.gold = 500;
    charterCity(w, p.id, 'goldenvale');
    expect(shipGoods(w, p.id, { from: 'nearhaven', to: 'goldenvale', resource: 'wheat', qty: 50 }).ok).toBe(false);
    expect(shipGoods(w, p.id, { from: 'nearhaven', to: 'goldenvale', resource: 'wheat', qty: 10 }).ok).toBe(true);
  });
});

describe('save migration', () => {
  it('upgrades a world saved before the multi-city update', () => {
    const { world: w, player } = withPlayer();
    const p = w.players[player.id];
    // Simulate an old save: only two markets, no depots, the legacy Aurora unlock.
    const old = JSON.parse(JSON.stringify(w)) as WorldState;
    for (const id of ['kingsreach', 'emberforge', 'goldenvale', 'deepcrag'] as const) { delete (old.markets as Record<string, unknown>)[id]; delete (old.reported as Record<string, unknown>)[id]; }
    delete (old as Partial<WorldState>).cities; delete (old as Partial<WorldState>).shipments;
    const op = old.players[p.id] as Partial<typeof p>;
    delete op.charters; delete op.depots; op.marketAccess = ['nearhaven', 'aurora'];
    const up = migrateWorld(old);
    for (const id of MARKETS) expect(up.markets[id]).toBeTruthy();
    expect(up.players[p.id].charters).toContain('aurora');
    expect(up.players[p.id].depots).toEqual({});
    expect(() => advanceWorld(up, 24)).not.toThrow();
  });
});
