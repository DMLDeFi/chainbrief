import { describe, expect, it } from 'vitest';
import { advanceWorld, declareBankruptcy, evaluateCredit, findOpportunity, merchantDaily, requestLoan, stepWorld, investInMerchant, divestFromMerchant, proposeDeal, playerTrade } from '../src/index';
import { freshWorld, withPlayer } from './helpers';

describe('autonomous merchants', () => {
  it('at least five distinct AI merchant roles operate', () => {
    const w = freshWorld();
    const roles = new Set(Object.values(w.merchants).map((m) => m.role));
    for (const r of ['farmer', 'baker', 'blacksmith', 'trader', 'banker']) expect(roles.has(r as never)).toBe(true);
    for (const m of Object.values(w.merchants)) {
      expect(m.personality.greed).toBeGreaterThanOrEqual(0);
      expect(m.objectives.length).toBeGreaterThan(0);
    }
  });

  it('merchants trade, produce and log reasoned decisions without any LLM', () => {
    const w = freshWorld(9);
    advanceWorld(w, 48);
    const farmer = w.merchants.farmer;
    expect(farmer.stats.trades).toBeGreaterThan(0);
    expect(farmer.memory.length).toBeGreaterThan(0);
    expect(farmer.decisions.length).toBeGreaterThan(0);
    expect(farmer.decisions[0].reasons.length).toBeGreaterThan(0);
    expect(w.merchants.baker.stats.trades).toBeGreaterThan(0);
  });

  it('bakers buy wheat when bread margins are healthy and pause when they are not', () => {
    const w = freshWorld(9);
    const baker = w.merchants.baker;
    baker.inventory = {};
    w.markets.nearhaven.stock.bread = 30; // bread scarce → high margin
    w.markets.nearhaven.price.bread = 30;
    stepWorld(w);
    stepWorld(w);
    expect(baker.memory.some((m) => m.kind === 'buy' && m.resource === 'wheat')).toBe(true);

    const w2 = freshWorld(9);
    const b2 = w2.merchants.baker;
    b2.inventory = {};
    w2.markets.nearhaven.stock.bread = 5000; // bread glut → negative margin
    w2.markets.nearhaven.price.bread = 2;
    stepWorld(w2);
    stepWorld(w2);
    expect(b2.memory.some((m) => m.kind === 'buy' && m.resource === 'wheat')).toBe(false);
  });

  it('a farmer with an overflowing granary lowers prices / sells into the glut', () => {
    const w = freshWorld(9);
    const f = w.merchants.farmer;
    f.inventory.wheat = 390;
    advanceWorld(w, 6);
    expect(f.inventory.wheat!).toBeLessThan(390);
  });

  it('the blacksmith switches to weapons when bandits drive demand', () => {
    const w = freshWorld(9);
    w.markets.nearhaven.stock.weapons = 3;
    w.markets.nearhaven.stock.tools = 200;
    stepWorld(w);
    const bs = w.merchants.blacksmith;
    const before = bs.inventory.weapons ?? 0;
    advanceWorld(w, 4);
    expect((bs.inventory.weapons ?? 0) + bs.stats.trades).toBeGreaterThan(before);
  });

  it('the trader identifies cross-market arbitrage', () => {
    const w = freshWorld(9);
    w.markets.aurora.stock.fish = 2000; // fish dirt cheap in Aurora
    w.markets.nearhaven.stock.fish = 10;
    for (const m of Object.values(w.markets)) m.price.fish = 0;
    w.markets.aurora.price.fish = 1;
    w.markets.nearhaven.price.fish = 40;
    const opp = findOpportunity(w, 'aurora', 500, 50);
    expect(opp?.resource).toBe('fish');
    expect(opp!.expectedProfit).toBeGreaterThan(0);
  });

  it('merchants that cannot pay wages for three days go bankrupt and are later replaced', () => {
    const w = freshWorld(9);
    const weaver = w.merchants.weaver;
    weaver.gold = 0;
    weaver.inventory = {};
    w.tick = 24;
    for (let i = 0; i < 3; i++) merchantDaily(w, weaver);
    expect(weaver.status).toBe('bankrupt');
    expect(w.feed.some((f) => f.kind === 'bankruptcy' && f.text.includes('BANKRUPT'))).toBe(true);
    w.tick += 24 * 4;
    merchantDaily(w, weaver);
    expect(weaver.status).toBe('active');
    expect(weaver.generation).toBe(1);
  });

  it('bankruptcy wipes out investors', () => {
    const { world, player } = withPlayer(3);
    investInMerchant(world, player.id, 'fisher', 50);
    expect(world.merchants.fisher.investors[player.id]).toBeGreaterThan(0);
    declareBankruptcy(world, world.merchants.fisher);
    expect(world.merchants.fisher.investors[player.id]).toBeUndefined();
    expect(divestFromMerchant(world, player.id, 'fisher').ok).toBe(false);
  });
});

describe('banker credit decisions', () => {
  it('approves sound borrowers and refuses over-leveraged ones', () => {
    const { world, player } = withPlayer(3);
    const small = evaluateCredit(world, { kind: 'player', id: player.id }, 30);
    expect(small.approved).toBe(true);
    const huge = evaluateCredit(world, { kind: 'player', id: player.id }, 900);
    expect(huge.approved).toBe(false);
    expect(huge.reasons.length).toBeGreaterThan(0);
  });

  it('loans transfer real gold from the vault and are collected daily', () => {
    const { world, player } = withPlayer(3);
    const vault = world.merchants.banker.gold;
    const r = requestLoan(world, { kind: 'player', id: player.id }, 40);
    expect(r.ok).toBe(true);
    expect(player.gold).toBe(140);
    expect(world.merchants.banker.gold).toBe(vault - 40);
    advanceWorld(world, 24 * 9);
    const loan = Object.values(world.loans)[0];
    expect(loan.status).toBe('repaid');
    expect(player.credit.repaid).toBe(1);
  });

  it('defaults after three missed installments damage reputation', () => {
    const { world, player } = withPlayer(3);
    requestLoan(world, { kind: 'player', id: player.id }, 40);
    const rep = player.reputation;
    player.gold = 0;
    // Keep the player broke while collections run.
    for (let d = 0; d < 4; d++) {
      advanceWorld(world, 24);
      player.gold = 0;
    }
    expect(Object.values(world.loans)[0].status).toBe('defaulted');
    expect(player.reputation).toBeLessThan(rep);
    expect(evaluateCredit(world, { kind: 'player', id: player.id }, 30).riskScore).toBeGreaterThan(0.3);
  });
});

describe('negotiation', () => {
  it('a fair offer is accepted, a lowball is countered, and relationships change', () => {
    const { world, player } = withPlayer(3);
    const farmer = world.merchants.farmer;
    farmer.inventory.wheat = 100;
    const low = proposeDeal(world, player.id, { merchantId: 'farmer', side: 'buy', resource: 'wheat', qty: 10, unitPrice: 0.5 });
    expect(low.ok && !low.data.accepted && low.data.counterPrice! > 0.5).toBe(true);
    if (!low.ok) return;
    const fair = proposeDeal(world, player.id, { merchantId: 'farmer', side: 'buy', resource: 'wheat', qty: 10, unitPrice: low.data.counterPrice! + 0.05 });
    expect(fair.ok && fair.data.executed).toBe(true);
    expect(player.inventory.wheat).toBe(10);
    expect(farmer.relationships[player.id]).toBeGreaterThan(0);
  });

  it('merchants will not buy goods they have no use for', () => {
    const { world, player } = withPlayer(3);
    playerTrade(world, player.id, { side: 'buy', resource: 'stone', qty: 5 });
    const r = proposeDeal(world, player.id, { merchantId: 'baker', side: 'sell', resource: 'stone', qty: 5, unitPrice: 1 });
    expect(r.ok && r.data.accepted).toBe(false);
  });
});
