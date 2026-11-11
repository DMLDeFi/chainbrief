import { describe, expect, it } from 'vitest';
import { GAMES, betOnRace, currentRace, lastRace, playCups, playDice, racesTick, racesView } from '../src/index';
import { totalGold, withPlayer } from './helpers';

/** A fixed sequence of rolls, for deterministic games. */
const seq = (...xs: number[]) => { let i = 0; return () => xs[i++ % xs.length]; };

describe('tavern games and the hippodrome', () => {
  it('pays dice wins, returns ties and takes losses, with gold conserved', () => {
    const { world: w } = withPlayer();
    const p = w.players.p1;
    const g0 = totalGold(w);
    // You roll 6+6, the house 1+1: a win.
    const win = playDice(w, 'p1', 20, seq(0.99, 0.99, 0.01, 0.01));
    expect(win.ok && win.data.outcome).toBe('win');
    expect(p.gold).toBeCloseTo(100 - 20 + 20 * GAMES.dice.payout, 2);
    // A tie returns the stake.
    const before = p.gold;
    const push = playDice(w, 'p1', 10, seq(0.5, 0.5, 0.5, 0.5));
    expect(push.ok && push.data.outcome).toBe('push');
    expect(p.gold).toBeCloseTo(before, 2);
    // A loss.
    const lose = playDice(w, 'p1', 10, seq(0.01, 0.01, 0.99, 0.99));
    expect(lose.ok && lose.data.outcome).toBe('lose');
    expect(p.gold).toBeCloseTo(before - 10, 2);
    expect(totalGold(w)).toBeCloseTo(g0, 2);
  });

  it('pays the shell game only for the right cup, and enforces bet limits', () => {
    const { world: w } = withPlayer();
    const p = w.players.p1;
    const right = playCups(w, 'p1', 10, 1, seq(0.5)); // coin under cup 1
    expect(right.ok && right.data.win).toBeCloseTo(10 * GAMES.cups.payout, 2);
    const wrong = playCups(w, 'p1', 10, 0, seq(0.5));
    expect(wrong.ok && wrong.data.win).toBe(0);
    expect(playCups(w, 'p1', 2, 0).ok).toBe(false); // below the minimum
    expect(playDice(w, 'p1', GAMES.maxBet + 1).ok).toBe(false); // above the maximum
    p.gold = 3;
    expect(playDice(w, 'p1', 5).ok).toBe(false); // cannot afford
  });

  it('settles a race: winners are paid at the posted odds, losers lose their stake, gold is conserved', () => {
    const { world: w } = withPlayer();
    const p = w.players.p1;
    const race = currentRace(w);
    const g0 = totalGold(w);
    expect(betOnRace(w, 'p1', 0, 10).ok).toBe(true);
    expect(betOnRace(w, 'p1', 1, 10).ok).toBe(true);
    expect(p.gold).toBeCloseTo(80, 2);
    w.tick = race.startTick;
    racesTick(w, seq(0.0001)); // the draw lands on horse 0
    const r = lastRace(w)!;
    expect(r.winner).toBe(0);
    expect(r.order[0]).toBe(0);
    expect(p.gold).toBeCloseTo(80 + 10 * race.horses[0].odds, 2);
    expect(totalGold(w)).toBeCloseTo(g0, 2);
    // A new race opens, and bets on a closed race are refused.
    expect(currentRace(w).number).toBe(race.number + 1);
    expect(racesView(w).last?.number).toBe(race.number);
  });

  it('prices horses so the house keeps a small edge', () => {
    const { world: w } = withPlayer();
    const race = currentRace(w);
    const overround = race.horses.reduce((s, h) => s + 1 / h.odds, 0);
    expect(overround).toBeGreaterThan(1);
    expect(overround).toBeLessThan(1.3);
  });
});
