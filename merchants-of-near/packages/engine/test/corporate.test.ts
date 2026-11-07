import { describe, expect, it } from 'vitest';
import {
  advanceWorld, assignBusiness, bankDeposit, buyBusiness, buyLand, cancelOffer, charterCity, companyReport, dissolveSubsidiary, evaluateProgression, expireOffers,
  foundSubsidiary, hireWorker, LEVELS, makeOffer, MAX_LEVEL, overheadFactor, powerhouseTier, rankTitle, registerPlayer, respondToOffer, sellBusiness, setCompanyName,
  stepWorld, SUBSIDIARY_FEE,
} from '../src/index';
import { totalGold, withPlayer } from './helpers';

const rich = (level = 10, gold = 200000) => {
  const { world: w, player } = withPlayer();
  const p = w.players[player.id];
  p.gold = gold;
  p.level = level;
  return { w, p };
};

describe('ten ranks and beyond', () => {
  it('has ten ranks from Street Trader to Economic Powerhouse, with tiers after the top', () => {
    expect(MAX_LEVEL).toBe(10);
    expect(LEVELS[0].title).toBe('Street Trader');
    expect(LEVELS[9].title).toBe('Economic Powerhouse');
    for (let i = 1; i < LEVELS.length; i++) expect(LEVELS[i].netWorth).toBeGreaterThan(LEVELS[i - 1].netWorth);
    const { w, p } = rich(10);
    expect(powerhouseTier(p, 300000)).toBe(1);
    expect(powerhouseTier(p, 1_250_000)).toBe(3);
    expect(rankTitle(p, 1_250_000)).toBe('Economic Powerhouse III');
    void w;
  });

  it('needs businesses in several cities to rise past Master Merchant', () => {
    const { w, p } = rich(6, 60000);
    Object.assign(p, { xp: 99999, reputation: 100 });
    for (let i = 0; i < 6; i++) buyBusiness(w, p.id, i % 2 ? 'farm' : 'lumbercamp');
    evaluateProgression(w, p);
    expect(p.level).toBe(6); // all in Nearhaven
    charterCity(w, p.id, 'goldenvale'); charterCity(w, p.id, 'emberforge');
    buyBusiness(w, p.id, 'farm', 'goldenvale'); buyBusiness(w, p.id, 'sawmill', 'emberforge');
    evaluateProgression(w, p);
    expect(p.level).toBeGreaterThanOrEqual(7);
  });
});

describe('parent company and subsidiaries', () => {
  it('limits subsidiaries by rank, charges registration and keeps overheads separate per company', () => {
    const lowRank = rich(4);
    expect(foundSubsidiary(lowRank.w, lowRank.p.id, 'Vale Grain Co.').ok).toBe(false);
    const { w, p } = rich(7);
    expect(setCompanyName(w, p.id, 'Ashdale Holdings').ok).toBe(true);
    expect(setCompanyName(w, p.id, 'x').ok).toBe(false);
    const guild = w.guildTreasury;
    const sub = foundSubsidiary(w, p.id, 'Vale Grain Co.');
    expect(sub.ok).toBe(true);
    expect(w.guildTreasury).toBeCloseTo(guild + SUBSIDIARY_FEE, 2);
    foundSubsidiary(w, p.id, 'Ember Works');
    foundSubsidiary(w, p.id, 'Crown Retail');
    expect(foundSubsidiary(w, p.id, 'One Too Many').ok).toBe(false); // rank 7 allows three
    if (!sub.ok) return;
    const ids: string[] = [];
    for (let i = 0; i < 6; i++) { const b = buyBusiness(w, p.id, 'lumbercamp'); if (b.ok) ids.push(b.data.id); }
    expect(overheadFactor(w, p.id)).toBeCloseTo(1.18, 5);
    for (const id of ids.slice(0, 3)) expect(assignBusiness(w, p.id, id, sub.data.id).ok).toBe(true);
    expect(overheadFactor(w, p.id)).toBe(1);
    expect(overheadFactor(w, p.id, sub.data.id)).toBe(1);
    const report = companyReport(w, p.id);
    expect(report.name).toBe('Ashdale Holdings');
    expect(report.byCompany[sub.data.id].businesses).toBe(3);
    expect(report.byCompany.parent.businesses).toBe(3);
    expect(dissolveSubsidiary(w, p.id, sub.data.id).ok).toBe(true);
    expect(ids.every((id) => !w.businesses[id].companyId)).toBe(true);
  });
});

describe('acquisitions', () => {
  const twoPlayers = () => {
    const { w, p } = rich(6, 5000);
    const r = registerPlayer(w, 'p2', 'Seller Sam');
    if (!r.ok) throw new Error(r.error);
    const s = w.players.p2;
    s.gold = 500;
    const b = buyBusiness(w, s.id, 'farm');
    if (!b.ok) throw new Error(b.error);
    return { w, buyer: p, seller: s, biz: b.data };
  };

  it('holds the buyer’s gold in escrow and transfers the business when the owner accepts', () => {
    const { w, buyer, seller, biz } = twoPlayers();
    const before = totalGold(w);
    const o = makeOffer(w, buyer.id, { businessId: biz.id, price: 400 });
    expect(o.ok).toBe(true);
    if (!o.ok) return;
    expect(buyer.gold).toBeCloseTo(4600, 2);
    expect(respondToOffer(w, buyer.id, o.data.id, true).ok).toBe(false); // only the owner may answer
    const sellerGold = seller.gold;
    expect(respondToOffer(w, seller.id, o.data.id, true).ok).toBe(true);
    expect(w.businesses[biz.id].ownerId).toBe(buyer.id);
    expect(seller.gold).toBeCloseTo(sellerGold + 400, 2);
    expect(totalGold(w)).toBeCloseTo(before, 2);
    expect(buyer.lifetime.acquisitions).toBe(1);
  });

  it('refunds declined, withdrawn and expired offers, and refuses deeds and low ranks', () => {
    const { w, buyer, seller, biz } = twoPlayers();
    const a = makeOffer(w, buyer.id, { businessId: biz.id, price: 300 });
    if (!a.ok) throw new Error(a.error);
    expect(makeOffer(w, buyer.id, { businessId: biz.id, price: 350 }).ok).toBe(false); // one offer at a time
    respondToOffer(w, seller.id, a.data.id, false);
    expect(buyer.gold).toBeCloseTo(5000, 2);
    const b = makeOffer(w, buyer.id, { businessId: biz.id, price: 300 });
    if (!b.ok) throw new Error(b.error);
    expect(cancelOffer(w, buyer.id, b.data.id).ok).toBe(true);
    expect(buyer.gold).toBeCloseTo(5000, 2);
    // Offers survive the fast game clock, but are void once the business changes hands.
    const c = makeOffer(w, buyer.id, { businessId: biz.id, price: 300 });
    if (!c.ok) throw new Error(c.error);
    for (let i = 0; i < 24 * 10; i++) stepWorld(w);
    expect(w.offers[c.data.id]).toBeTruthy();
    const third = registerPlayer(w, 'p3', 'Third Party');
    if (!third.ok) throw new Error(third.error);
    biz.ownerId = third.data.id;
    expireOffers(w);
    expect(Object.keys(w.offers)).toHaveLength(0);
    expect(buyer.gold).toBeCloseTo(5000, 2);
    biz.ownerId = seller.id;
    biz.deedTokenId = 'deed-9';
    expect(makeOffer(w, buyer.id, { businessId: biz.id, price: 300 }).ok).toBe(false);
    buyer.level = 4;
    biz.deedTokenId = undefined;
    expect(makeOffer(w, buyer.id, { businessId: biz.id, price: 300 }).ok).toBe(false);
  });
});

describe('finance and property', () => {
  it('a bank earns interest on deposited capital from the city, and returns the capital when sold', () => {
    const { w, p } = rich(7, 20000);
    const bank = buyBusiness(w, p.id, 'bank');
    if (!bank.ok) throw new Error(bank.error);
    hireWorker(w, p.id, bank.data.id);
    expect(bankDeposit(w, p.id, bank.data.id, 999999).ok).toBe(false); // over capacity
    expect(bankDeposit(w, p.id, bank.data.id, 2000).ok).toBe(true);
    expect(bank.data.capital).toBe(2000);
    expect(bankDeposit(w, p.id, bank.data.id, -500).ok).toBe(true);
    expect(bank.data.capital).toBe(1500);
    w.ledger.length = 0;
    advanceWorld(w, 48);
    const interest = w.ledger.filter((e) => e.type === 'bank.interest').reduce((s, e) => s + e.goldDelta, 0);
    expect(interest).toBeGreaterThan(0);
    const gold = p.gold;
    const capital = bank.data.capital ?? 0;
    const s = sellBusiness(w, p.id, bank.data.id);
    expect(s.ok).toBe(true);
    if (s.ok) expect(p.gold).toBeCloseTo(gold + capital + s.data.price, 2);
  });

  it('an estate agency earns rent from your vacant land in its city', () => {
    const { w, p } = rich(7, 20000);
    const est = buyBusiness(w, p.id, 'estate');
    if (!est.ok) throw new Error(est.error);
    w.ledger.length = 0;
    advanceWorld(w, 25);
    expect(est.data.idle).toBe('no-land');
    for (let i = 0; i < 3; i++) buyLand(w, p.id, 'nearhaven');
    w.ledger.length = 0;
    advanceWorld(w, 48);
    expect(w.ledger.some((e) => e.type === 'estate.rent' && e.goldDelta > 0)).toBe(true);
  });
});

describe('empire report', () => {
  it('adds up the balance sheet and results by city', () => {
    const { w, p } = rich(7, 20000);
    charterCity(w, p.id, 'goldenvale');
    buyBusiness(w, p.id, 'farm');
    buyBusiness(w, p.id, 'farm', 'goldenvale');
    for (let i = 0; i < 3 * 24; i++) stepWorld(w);
    const r = companyReport(w, p.id);
    expect(r.results.businesses).toBe(2);
    expect(Object.keys(r.byCity).sort()).toEqual(['goldenvale', 'nearhaven']);
    expect(r.balance.cash).toBeCloseTo(p.gold, 2);
    expect(r.history.length).toBeGreaterThan(0);
  });
});
