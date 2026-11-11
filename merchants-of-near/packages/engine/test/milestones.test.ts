import { describe, expect, it } from 'vitest';
import { MILESTONES, claimMilestone, joinGuild, milestonesView, playDice, playerTrade } from '../src/index';
import { totalGold, withPlayer } from './helpers';

describe("the Merchant's Path", () => {
  it('starts at the first step, with nothing done', () => {
    const { world: w } = withPlayer();
    const v = milestonesView(w, w.players.p1);
    expect(v.steps).toHaveLength(MILESTONES.length);
    expect(v.next).toBe('buy');
    expect(v.steps.every((s) => !s.done && !s.claimed)).toBe(true);
  });

  it('ticks steps off from the real record and pays from the guild treasury, creating no gold', () => {
    const { world: w } = withPlayer();
    const p = w.players.p1;
    expect(claimMilestone(w, 'p1', 'buy').ok).toBe(false); // not done yet
    expect(playerTrade(w, 'p1', { side: 'buy', resource: 'wheat', qty: 5 }).ok).toBe(true);
    joinGuild(w, 'p1', 'scale');
    playDice(w, 'p1', 5, () => 0.5);
    const v = milestonesView(w, p);
    expect(v.steps.find((s) => s.id === 'buy')!.done).toBe(true);
    expect(v.steps.find((s) => s.id === 'guild')!.done).toBe(true);
    expect(v.steps.find((s) => s.id === 'games')!.done).toBe(true);
    expect(v.next).toBe('profit');
    const gold = totalGold(w), before = { g: p.gold, xp: p.xp, t: w.guildTreasury };
    const r = claimMilestone(w, 'p1', 'buy');
    expect(r.ok).toBe(true);
    expect(p.gold).toBeCloseTo(before.g + 10, 2);
    expect(w.guildTreasury).toBeCloseTo(before.t - 10, 2);
    expect(p.xp).toBe(before.xp + 15);
    expect(totalGold(w)).toBeCloseTo(gold, 2);
    expect(claimMilestone(w, 'p1', 'buy').ok).toBe(false); // only once
  });

  it('pays no more than the guild treasury holds', () => {
    const { world: w } = withPlayer();
    playerTrade(w, 'p1', { side: 'buy', resource: 'wheat', qty: 5 });
    w.guildTreasury = 3;
    const r = claimMilestone(w, 'p1', 'buy');
    expect(r.ok && r.data.gold).toBe(3);
    expect(w.guildTreasury).toBe(0);
  });
});
