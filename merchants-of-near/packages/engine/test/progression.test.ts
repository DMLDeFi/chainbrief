import { describe, expect, it } from 'vitest';
import { advanceWorld, buyBusiness, claimMission, collectFromBusiness, createListing, buyListing, cancelListing, evaluateProgression, expandWarehouse, hireWorker, playerNetWorth, playerTrade, registerPlayer, upgradeBusiness, LEVELS } from '../src/index';
import { totalGold, withPlayer } from './helpers';

describe('businesses', () => {
  it('a farm produces wheat, sells it and books profit and loss', () => {
    const { world, player } = withPlayer(11);
    const r = buyBusiness(world, player.id, 'farm');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const farm = r.data;
    expect(player.gold).toBe(15);
    advanceWorld(world, 24 * 3);
    expect(farm.totals.produced).toBeGreaterThan(5);
    expect(farm.totals.revenue).toBeGreaterThan(0);
    expect(farm.history.length).toBe(3);
    expect(farm.history[0]).toHaveProperty('profit');
  });

  it('bakeries require level 2 and consume wheat to make bread', () => {
    const { world, player } = withPlayer(11);
    player.gold = 1000;
    expect(buyBusiness(world, player.id, 'bakery').ok).toBe(false);
    player.level = 2;
    const r = buyBusiness(world, player.id, 'bakery');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    r.data.policy.autoSell = false;
    advanceWorld(world, 24);
    expect(r.data.totals.produced).toBeGreaterThan(0);
    expect(r.data.inventory.bread).toBeGreaterThan(0);
    const collect = collectFromBusiness(world, player.id, r.data.id);
    expect(collect.ok).toBe(true);
    expect(player.inventory.bread).toBeGreaterThan(0);
  });

  it('hiring and upgrading are bounded and cost gold', () => {
    const { world, player } = withPlayer(11);
    player.gold = 2000;
    const b = buyBusiness(world, player.id, 'farm');
    if (!b.ok) throw new Error(b.error);
    expect(hireWorker(world, player.id, b.data.id).ok).toBe(true);
    expect(hireWorker(world, player.id, b.data.id).ok).toBe(false); // level 1 max 2
    expect(upgradeBusiness(world, player.id, b.data.id).ok).toBe(true);
    expect(hireWorker(world, player.id, b.data.id).ok).toBe(true);
    expect(b.data.level).toBe(2);
    expect(hireWorker(world, 'someone-else', b.data.id).ok).toBe(false);
  });

  it('warehouse expansion raises capacity', () => {
    const { world, player } = withPlayer(11);
    const cap = player.warehouseCapacity;
    expect(expandWarehouse(world, player.id).ok).toBe(true);
    expect(player.warehouseCapacity).toBeGreaterThan(cap);
  });
});

describe('progression', () => {
  it('earns XP, achievements and missions from real activity', () => {
    const { world, player } = withPlayer(11);
    playerTrade(world, player.id, { side: 'buy', resource: 'wheat', qty: 5 });
    expect(player.achievements.first_trade).toBeDefined();
    expect(player.xp).toBeGreaterThan(0);
    expect(player.daily.length).toBe(3);
    expect(player.weekly.length).toBe(2);
  });

  it('missions can be claimed once and are paid from the guild treasury', () => {
    const { world, player } = withPlayer(11);
    const mission = player.daily[0];
    expect(claimMission(world, player, mission.def.id).ok).toBe(false);
    player.dayCounters[mission.def.metric] = mission.def.target;
    evaluateProgression(world, player);
    const total = totalGold(world);
    expect(claimMission(world, player, mission.def.id).ok).toBe(true);
    expect(claimMission(world, player, mission.def.id).ok).toBe(false);
    expect(totalGold(world)).toBeCloseTo(total, 2); // transfer, not minting
  });

  it('levels up only when every requirement is met', () => {
    const { world, player } = withPlayer(11);
    player.xp = 10000;
    evaluateProgression(world, player);
    expect(player.level).toBe(1); // net worth too low
    player.gold = LEVELS[1].netWorth + 10;
    evaluateProgression(world, player);
    expect(player.level).toBe(2);
    expect(playerNetWorth(world, player)).toBeGreaterThan(200);
  });
});

describe('player marketplace', () => {
  it('escrows goods and settles player-to-player trades', () => {
    const { world, player } = withPlayer(11);
    const b = registerPlayer(world, 'p2', 'Buyer');
    if (!b.ok) throw new Error(b.error);
    playerTrade(world, player.id, { side: 'buy', resource: 'wheat', qty: 10 });
    expect(createListing(world, player.id, 'wheat', 5, 4).ok).toBe(false); // level 1
    player.level = 2;
    const price = world.markets.nearhaven.price.wheat;
    const l = createListing(world, player.id, 'wheat', 5, price);
    expect(l.ok).toBe(true);
    if (!l.ok) return;
    expect(player.inventory.wheat).toBe(5);
    expect(buyListing(world, player.id, l.data.id).ok).toBe(false); // own listing
    const goldBefore = player.gold;
    expect(buyListing(world, 'p2', l.data.id).ok).toBe(true);
    expect(b.data.inventory.wheat).toBe(5);
    expect(player.gold).toBeGreaterThan(goldBefore);
    expect(buyListing(world, 'p2', l.data.id).ok).toBe(false); // double spend
  });

  it('rejects listings far from market price and returns escrow on cancel', () => {
    const { world, player } = withPlayer(11);
    player.level = 2;
    playerTrade(world, player.id, { side: 'buy', resource: 'wheat', qty: 10 });
    expect(createListing(world, player.id, 'wheat', 5, 999).ok).toBe(false);
    const l = createListing(world, player.id, 'wheat', 5, world.markets.nearhaven.price.wheat);
    if (!l.ok) throw new Error(l.error);
    expect(cancelListing(world, player.id, l.data.id).ok).toBe(true);
    expect(player.inventory.wheat).toBe(10);
  });
});

describe('full game loop', () => {
  it('register → trade → buy a business → fast-forward → profit → level up', () => {
    const { world, player } = withPlayer(21, 'Loop');
    // Trade a little.
    playerTrade(world, player.id, { side: 'buy', resource: 'wheat', qty: 4 });
    playerTrade(world, player.id, { side: 'sell', resource: 'wheat', qty: 4 });
    // Expand.
    const farm = buyBusiness(world, player.id, 'farm');
    expect(farm.ok).toBe(true);
    // Fast-forward two weeks.
    advanceWorld(world, 24 * 14);
    const nw = playerNetWorth(world, player);
    expect(nw).toBeGreaterThan(100);
    expect(player.xp).toBeGreaterThan(0);
    expect(player.history.length).toBe(14);
    expect(Object.keys(player.achievements)).toContain('landowner');
    expect(player.level).toBeGreaterThanOrEqual(1);
  });

  it('the economy stays alive over a simulated season (no total collapse)', () => {
    const { world } = withPlayer(33);
    advanceWorld(world, 24 * 28);
    const active = Object.values(world.merchants).filter((m) => m.status !== 'bankrupt').length;
    expect(active).toBeGreaterThanOrEqual(7);
    expect(world.population).toBeGreaterThan(200);
    for (const m of Object.values(world.markets)) for (const p of Object.values(m.price)) expect(Number.isFinite(p)).toBe(true);
  });

  it('is deterministic for a given seed', () => {
    const a = withPlayer(77).world;
    const b = withPlayer(77).world;
    advanceWorld(a, 200);
    advanceWorld(b, 200);
    expect(a.markets.nearhaven.price).toEqual(b.markets.nearhaven.price);
    expect(a.feed.length).toBe(b.feed.length);
  });
});
