import { describe, expect, it } from 'vitest';
import { quoteBuy, quoteSell, unitPrice, playerTrade, RESOURCE_DEFS, settleOnMarket, advanceWorld } from '../src/index';
import { freshWorld, totalGold, withPlayer } from './helpers';

describe('price discovery', () => {
  it('prices rise as stock becomes scarce and fall in a glut', () => {
    const w = freshWorld();
    const m = w.markets.nearhaven;
    const ref = RESOURCE_DEFS.wheat.refStock;
    expect(unitPrice(m, 'wheat', ref / 2)).toBeGreaterThan(unitPrice(m, 'wheat', ref));
    expect(unitPrice(m, 'wheat', ref * 2)).toBeLessThan(unitPrice(m, 'wheat', ref));
  });

  it('respects the configured price floor and ceiling', () => {
    const w = freshWorld();
    const m = w.markets.nearhaven;
    const base = RESOURCE_DEFS.bread.basePrice;
    expect(unitPrice(m, 'bread', 1)).toBeLessThanOrEqual(base * 8);
    expect(unitPrice(m, 'bread', 1e7)).toBeGreaterThanOrEqual(base * 0.25);
  });

  it('large orders have price impact (average > first unit)', () => {
    const w = freshWorld();
    const m = w.markets.nearhaven;
    const one = quoteBuy(m, 'iron', 1);
    const many = quoteBuy(m, 'iron', 60);
    expect(one.ok && many.ok).toBe(true);
    if (one.ok && many.ok) {
      expect(many.data.avgPrice).toBeGreaterThan(one.data.avgPrice);
      expect(many.data.priceAfter).toBeGreaterThan(many.data.priceBefore);
    }
  });

  it('a buy→sell round trip always loses money (no arbitrage loop)', () => {
    const w = freshWorld();
    const m = w.markets.nearhaven;
    for (const qty of [1, 10, 50]) {
      const b = quoteBuy(m, 'tools', Math.min(qty, 30));
      if (!b.ok) throw new Error(b.error);
      settleOnMarket(w, m, 'tools', 'buy', b.data);
      const s = quoteSell(m, 'tools', b.data.qty);
      if (!s.ok) throw new Error(s.error);
      settleOnMarket(w, m, 'tools', 'sell', s.data);
      expect(s.data.total).toBeLessThan(b.data.total);
    }
  });

  it('rejects fractional, zero and oversized quantities', () => {
    const w = freshWorld();
    const m = w.markets.nearhaven;
    expect(quoteBuy(m, 'wheat', 0).ok).toBe(false);
    expect(quoteBuy(m, 'wheat', 1.5).ok).toBe(false);
    expect(quoteBuy(m, 'wheat', 100000).ok).toBe(false);
  });

  it('the exchange cannot pay out coin it does not hold', () => {
    const w = freshWorld();
    w.markets.nearhaven.treasury = 5;
    expect(quoteSell(w.markets.nearhaven, 'weapons', 5).ok).toBe(false);
  });
});

describe('supply and demand', () => {
  it('citizens consume goods and unmet demand raises pressure', () => {
    const w = freshWorld(5);
    const m = w.markets.nearhaven;
    m.stock.bread = 2; // famine
    for (const mer of Object.values(w.merchants)) if (mer.role === 'baker') { mer.workers = 0; mer.inventory = {}; }
    const before = m.pressure.bread;
    advanceWorld(w, 24);
    expect(m.shortageRate.bread).toBeGreaterThan(0);
    expect(m.pressure.bread).toBeGreaterThan(before);
  });

  it('a production glut drives prices down', () => {
    const w = freshWorld(5);
    const m = w.markets.nearhaven;
    const before = m.price.stone;
    m.stock.stone *= 3;
    advanceWorld(w, 1);
    expect(m.price.stone).toBeLessThan(before);
  });

  it('records production, consumption and price history', () => {
    const w = freshWorld(5);
    advanceWorld(w, 48);
    const m = w.markets.nearhaven;
    expect(m.history.wheat.length).toBe(3);
    expect(m.productionRate.wheat).toBeGreaterThan(0);
    expect(m.consumptionRate.bread).toBeGreaterThan(0);
    expect(m.intraday.bread.length).toBe(48);
  });
});

describe('player trading', () => {
  it('buying moves gold and goods atomically and updates the market', () => {
    const { world, player } = withPlayer();
    const stock = world.markets.nearhaven.stock.wheat;
    const r = playerTrade(world, player.id, { side: 'buy', resource: 'wheat', qty: 10 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(player.inventory.wheat).toBe(10);
    expect(player.gold).toBeCloseTo(100 - r.data.total, 2);
    expect(world.markets.nearhaven.stock.wheat).toBeCloseTo(stock - 10, 5);
  });

  it('selling realises profit against cost basis', () => {
    const { world, player } = withPlayer();
    playerTrade(world, player.id, { side: 'buy', resource: 'fish', qty: 5 });
    world.markets.nearhaven.stock.fish = 20; // fish becomes scarce → price jumps
    const r = playerTrade(world, player.id, { side: 'sell', resource: 'fish', qty: 5 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.realizedProfit).toBeGreaterThan(0);
    expect(player.inventory.fish).toBeUndefined();
  });

  it('rejects trades the player cannot afford, cannot store, or does not own', () => {
    const { world, player } = withPlayer();
    expect(playerTrade(world, player.id, { side: 'buy', resource: 'weapons', qty: 10 }).ok).toBe(false);
    expect(playerTrade(world, player.id, { side: 'buy', resource: 'wheat', qty: 61 }).ok).toBe(false); // warehouse 60
    expect(playerTrade(world, player.id, { side: 'sell', resource: 'iron', qty: 1 }).ok).toBe(false);
    expect(playerTrade(world, player.id, { side: 'buy', resource: 'gold' as never, qty: 1 }).ok).toBe(false);
    expect(player.gold).toBe(100);
  });

  it('honours slippage limits', () => {
    const { world, player } = withPlayer();
    const r = playerTrade(world, player.id, { side: 'buy', resource: 'wheat', qty: 10, limitPrice: 0.5 });
    expect(r.ok).toBe(false);
    expect(player.gold).toBe(100);
  });

  it('blocks Port Aurora until unlocked', () => {
    const { world, player } = withPlayer();
    expect(playerTrade(world, player.id, { side: 'buy', resource: 'fish', qty: 1, market: 'aurora' }).ok).toBe(false);
  });

  it('player trades never create gold out of thin air', () => {
    const { world, player } = withPlayer();
    const before = totalGold(world);
    for (let i = 0; i < 20; i++) {
      playerTrade(world, player.id, { side: 'buy', resource: 'wood', qty: 3 });
      playerTrade(world, player.id, { side: 'sell', resource: 'wood', qty: 3 });
    }
    expect(totalGold(world)).toBeCloseTo(before, 1);
    expect(player.gold).toBeLessThan(100); // fees were paid
  });
});
