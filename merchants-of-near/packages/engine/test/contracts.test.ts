import { describe, expect, it } from 'vitest';
import { CONTRACTS, MARKETS, TIME, acceptContract, abandonContract, advanceWorld, contractsView, deliverContract, migrateWorld, type DeliveryContract, type WorldState } from '../src/index';
import { freshWorld, totalGold, withPlayer } from './helpers';

const openIn = (w: WorldState, city: string) => Object.values(w.contracts!).filter((c) => c.city === city && c.status === 'open');
const homeJob = (w: WorldState): DeliveryContract => openIn(w, 'nearhaven')[0];

describe('delivery contracts', () => {
  it('posts jobs in every city, priced from the local market and paid by the city', () => {
    const w = freshWorld();
    for (const city of MARKETS) {
      const jobs = openIn(w, city);
      expect(jobs.length).toBe(CONTRACTS.openPerCity);
      for (const j of jobs) {
        expect(j.qty).toBeGreaterThanOrEqual(5);
        expect(j.reward).toBeGreaterThan(0);
        expect(j.reward).toBeLessThanOrEqual(w.markets[city].treasury * CONTRACTS.maxPurseShare + 0.01);
        expect(j.rep).toBeGreaterThanOrEqual(2);
      }
    }
    expect(contractsView(w).length).toBe(MARKETS.length * CONTRACTS.openPerCity);
  });

  it('pays the reward, reputation and XP on delivery, with gold conserved and goods handed to the exchange', () => {
    const { world: w } = withPlayer();
    const p = w.players.p1;
    const job = homeJob(w);
    expect(acceptContract(w, 'p1', job.id).ok).toBe(true);
    // Short of goods: refused, nothing changes.
    p.inventory[job.resource] = job.qty - 1;
    expect(deliverContract(w, 'p1', job.id).ok).toBe(false);
    p.inventory[job.resource] = job.qty + 3;
    const before = { gold: totalGold(w), rep: p.reputation, xp: p.xp, stock: w.markets.nearhaven.stock[job.resource], pg: p.gold };
    const r = deliverContract(w, 'p1', job.id);
    expect(r.ok).toBe(true);
    expect(p.inventory[job.resource]).toBe(3);
    expect(p.gold).toBeCloseTo(before.pg + job.reward, 2);
    expect(p.reputation).toBe(before.rep + job.rep);
    expect(p.xp).toBe(before.xp + job.xp);
    expect(w.markets.nearhaven.stock[job.resource]).toBe(before.stock + job.qty);
    expect(totalGold(w)).toBeCloseTo(before.gold, 2);
    expect(p.lifetime.contracts).toBe(1);
    expect(w.contracts![job.id].status).toBe('done');
  });

  it('needs a trading office for jobs in other cities, and caps jobs held at once', () => {
    const { world: w } = withPlayer();
    const far = openIn(w, 'kingsreach')[0];
    const r = acceptContract(w, 'p1', far.id);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/trading office/);
    // Hold the maximum, then one more is refused.
    w.players.p1.charters.push('aurora', 'goldenvale');
    const jobs = [...openIn(w, 'nearhaven'), ...openIn(w, 'aurora'), ...openIn(w, 'goldenvale')];
    for (const j of jobs.slice(0, CONTRACTS.maxActive)) expect(acceptContract(w, 'p1', j.id).ok).toBe(true);
    expect(acceptContract(w, 'p1', jobs[CONTRACTS.maxActive].id).ok).toBe(false);
  });

  it('costs reputation to abandon a job or miss its deadline, and keeps posting new jobs', () => {
    const { world: w } = withPlayer();
    const p = w.players.p1;
    p.reputation = 20;
    const [a, b] = openIn(w, 'nearhaven');
    acceptContract(w, 'p1', a.id);
    expect(abandonContract(w, 'p1', a.id).ok).toBe(true);
    expect(p.reputation).toBe(20 - CONTRACTS.abandonRep);
    acceptContract(w, 'p1', b.id);
    advanceWorld(w, (b.days + 1) * TIME.ticksPerDay);
    expect(w.contracts![b.id]?.status ?? 'failed').toBe('failed');
    expect(p.reputation).toBe(20 - CONTRACTS.abandonRep - CONTRACTS.failRep);
    for (const city of MARKETS) expect(openIn(w, city).length).toBeGreaterThan(0);
  });

  it('gives old saves a first set of jobs', () => {
    const w = freshWorld();
    delete w.contracts;
    migrateWorld(w);
    expect(Object.keys(w.contracts!).length).toBeGreaterThan(0);
  });
});
