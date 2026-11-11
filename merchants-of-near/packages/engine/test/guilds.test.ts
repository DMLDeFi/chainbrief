import { describe, expect, it } from 'vitest';
import { SEASON, TIME, acceptContract, currentSeason, guildsDaily, deliverContract, guildsView, joinGuild, playerTrade, registerPlayer, titlesOf } from '../src/index';
import { totalGold, withPlayer } from './helpers';

describe('merchant guilds and seasons', () => {
  it('lets a player join a guild and earn points for it from trading profit and contracts', () => {
    const { world: w } = withPlayer();
    const p = w.players.p1;
    expect(joinGuild(w, 'p1', 'sheaf').ok).toBe(true);
    expect(joinGuild(w, 'p1', 'nonsense').ok).toBe(false);
    // Profit from a trade scores.
    p.inventory.wheat = 40;
    p.costBasis.wheat = 0.5;
    expect(playerTrade(w, 'p1', { side: 'sell', resource: 'wheat', qty: 20 }).ok).toBe(true);
    const afterTrade = currentSeason(w).points.sheaf;
    expect(afterTrade).toBeGreaterThan(0);
    // A delivered contract scores its reward.
    const job = Object.values(w.contracts!).find((c) => c.city === 'nearhaven' && c.status === 'open')!;
    acceptContract(w, 'p1', job.id);
    p.inventory[job.resource] = (p.inventory[job.resource] ?? 0) + job.qty;
    expect(deliverContract(w, 'p1', job.id).ok).toBe(true);
    expect(currentSeason(w).points.sheaf).toBe(afterTrade + Math.round(job.reward));
    const view = guildsView(w).guilds.find((g) => g.id === 'sheaf')!;
    expect(view.members).toBe(1);
    expect(view.top[0].name).toBe(p.name);
  });

  it('allows changing guild only once per season', () => {
    const { world: w } = withPlayer();
    joinGuild(w, 'p1', 'scale');
    // The first join is this season, so switching now is refused.
    expect(joinGuild(w, 'p1', 'anvil').ok).toBe(false);
  });

  it('crowns the winning guild and the top merchant at the end of a season, without creating gold', () => {
    const { world: w } = withPlayer();
    const b = registerPlayer(w, 'p2', 'Rival');
    expect(b.ok).toBe(true);
    joinGuild(w, 'p1', 'compass');
    joinGuild(w, 'p2', 'anvil');
    const s = currentSeason(w);
    s.points.compass = 900; s.players.p1 = 900;
    s.points.anvil = 300; s.players.p2 = 300;
    const xp1 = w.players.p1.xp, xp2 = w.players.p2.xp;
    const gold = totalGold(w);
    // Close the season: move its start back by a full season and run the daily check.
    w.tick += SEASON.days * TIME.ticksPerDay;
    guildsDaily(w);
    expect(totalGold(w)).toBe(gold); // season rewards create no gold
    expect(titlesOf(w.players.p1)).toContain('Champion of Season 1');
    expect(titlesOf(w.players.p1)).toContain('Grand Merchant of Season 1');
    expect(titlesOf(w.players.p2)).toEqual([]);
    expect(w.players.p1.xp).toBeGreaterThanOrEqual(xp1 + SEASON.championXp + SEASON.topXp);
    expect(w.players.p2.xp - xp2).toBeLessThan(SEASON.championXp);
    expect(currentSeason(w).number).toBe(2);
    expect(guildsView(w).history[0].winner).toBe('compass');
  });
});
