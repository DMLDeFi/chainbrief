import { TIME } from './config';
import type { Result, WorldState } from './types';
import { clamp, fail, money, ok, pushFeed } from './internal';

/**
 * Tavern games and the hippodrome, played for in-game gold only.
 * Stakes go into the richest city's purse and winnings are paid from it, so no gold is
 * created; the small house edge is a gold sink that steadies the economy.
 * Outcomes come from the supplied `roll` (Math.random by default; tests pass
 * their own), never from the world's RNG, so games never change the simulation.
 */
export const GAMES = {
  minBet: 5,
  maxBet: 100,
  /** A single win may never pay more than this share of the city's purse. */
  maxPayoutShare: 0.08,
  dice: { payout: 1.9 },
  cups: { payout: 2.75 },
  race: { everyTicks: 12, horses: 6, edge: 0.1 },
};

type Roll = () => number;
/** The house is backed by the richest city's treasury, so a drained home purse never closes the tables. */
const purse = (w: WorldState) => Object.values(w.markets).reduce((a, b) => (b.treasury > a.treasury ? b : a));

function stakeCheck(w: WorldState, playerId: string, stake: unknown, payout: number): Result<number> {
  const p = w.players[playerId];
  if (!p) return fail('Unknown player');
  const s = typeof stake === 'number' ? Math.floor(stake) : NaN;
  if (!Number.isFinite(s) || s < GAMES.minBet || s > GAMES.maxBet) return fail(`Bets are ${GAMES.minBet}–${GAMES.maxBet} gold`);
  if (p.gold < s) return fail(`You have ${Math.floor(p.gold)}g`);
  if (s * payout > Math.max(0, purse(w).treasury) * GAMES.maxPayoutShare) return fail('The house cannot cover a bet that large right now');
  return ok(s);
}
function settle(w: WorldState, playerId: string, stake: number, win: number, game: string, details: Record<string, unknown>) {
  const p = w.players[playerId];
  const m = purse(w);
  p.gold = money(p.gold - stake + win);
  m.treasury = money(m.treasury + stake - win);
  w.ledger.push({ tick: w.tick, playerId, type: `game.${game}`, goldDelta: money(win - stake), details });
}

const d6 = (roll: Roll) => 1 + Math.floor(roll() * 6);

/** Merchant's Dice: two dice each against the innkeeper. Higher total wins, a tie returns the stake. */
export function playDice(w: WorldState, playerId: string, stake: unknown, roll: Roll = Math.random): Result<{ you: [number, number]; house: [number, number]; outcome: 'win' | 'lose' | 'push'; win: number; stake: number }> {
  const s = stakeCheck(w, playerId, stake, GAMES.dice.payout);
  if (!s.ok) return s;
  const you: [number, number] = [d6(roll), d6(roll)];
  const house: [number, number] = [d6(roll), d6(roll)];
  const a = you[0] + you[1], b = house[0] + house[1];
  const outcome = a > b ? 'win' : a < b ? 'lose' : 'push';
  const win = outcome === 'win' ? money(s.data * GAMES.dice.payout) : outcome === 'push' ? s.data : 0;
  settle(w, playerId, s.data, win, 'dice', { you, house });
  return ok({ you, house, outcome, win, stake: s.data });
}

/** The shell game: a coin hides under one of three cups. Pick the right one to win. */
export function playCups(w: WorldState, playerId: string, stake: unknown, pick: unknown, roll: Roll = Math.random): Result<{ pick: number; coin: number; win: number; stake: number }> {
  const s = stakeCheck(w, playerId, stake, GAMES.cups.payout);
  if (!s.ok) return s;
  if (pick !== 0 && pick !== 1 && pick !== 2) return fail('Pick a cup');
  const coin = Math.floor(roll() * 3);
  const win = coin === pick ? money(s.data * GAMES.cups.payout) : 0;
  settle(w, playerId, s.data, win, 'cups', { pick, coin });
  return ok({ pick, coin, win, stake: s.data });
}

// ---------------------------------------------------------------- races ---
const HORSES = ['Ember Dancer', 'Old Barley', 'Silver Tide', 'Kingsreach Pride', 'Mud Lark', 'Northgate Flyer', 'Copper Penny', 'Goldenvale Gale', 'Night Market', 'Duchess Rye', 'Tanner’s Luck', 'Storm of Deepcrag'];
const COLORS = ['#c2552f', '#e0ad4f', '#3aa6d8', '#7d4f7a', '#5fbf5a', '#d9d2c3'];

export interface Race {
  id: string;
  number: number;
  /** Bets close and the race is run at this tick. */
  startTick: number;
  horses: Array<{ name: string; color: string; odds: number }>;
  bets: Array<{ playerId: string; horse: number; stake: number }>;
}
export interface RaceResult { id: string; number: number; tick: number; horses: Race['horses']; order: number[]; winner: number; payouts: Array<{ playerId: string; name: string; horse: number; stake: number; win: number }> }

type WithRaces = WorldState & { race?: Race; lastRace?: RaceResult; raceCount?: number };

/** A deterministic sequence for laying out a race (names, colours, odds), from the race number. */
function raceRng(n: number) {
  let h = (Math.imul(n + 11, 2654435761) ^ 0x5bd1e995) >>> 0;
  return () => {
    h = (Math.imul(h ^ (h >>> 15), 2246822507) + 0x9e3779b9) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 3266489909) >>> 0;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
}
function newRace(w: WorldState, store = true): Race {
  const g = w as WithRaces;
  const n = (g.raceCount ?? 0) + 1;
  if (store) g.raceCount = n;
  const r = raceRng(n);
  const names = HORSES.slice().sort(() => r() - 0.5).slice(0, GAMES.race.horses);
  const strength = names.map(() => 0.5 + r() * 1.5);
  const total = strength.reduce((a, b) => a + b, 0);
  return {
    id: `race-${n}`, number: n,
    startTick: w.tick + GAMES.race.everyTicks,
    horses: names.map((name, i) => ({ name, color: COLORS[i], odds: Math.max(1.3, Math.round(((1 - GAMES.race.edge) * total) / strength[i] * 10) / 10) })),
    bets: [],
  };
}
export function currentRace(w: WorldState): Race {
  const g = w as WithRaces;
  return (g.race ??= newRace(w));
}
export const lastRace = (w: WorldState) => (w as WithRaces).lastRace;

export function betOnRace(w: WorldState, playerId: string, horse: unknown, stake: unknown): Result<{ race: number; horse: number; stake: number }> {
  const race = currentRace(w);
  if (typeof horse !== 'number' || !race.horses[horse]) return fail('Pick a horse');
  if (w.tick >= race.startTick) return fail('Bets for this race have closed');
  const s = stakeCheck(w, playerId, stake, race.horses[horse].odds);
  if (!s.ok) return s;
  if (race.bets.filter((b) => b.playerId === playerId).length >= 3) return fail('Three bets per race at most');
  const p = w.players[playerId];
  const m = purse(w);
  p.gold = money(p.gold - s.data);
  m.treasury = money(m.treasury + s.data);
  race.bets.push({ playerId, horse, stake: s.data });
  w.ledger.push({ tick: w.tick, playerId, type: 'game.race.bet', goldDelta: -s.data, details: { race: race.number, horse } });
  return ok({ race: race.number, horse, stake: s.data });
}

/** Run the race when due: the winner is drawn in proportion to each horse's chances, then a new race opens. */
export function racesTick(w: WorldState, roll: Roll = Math.random): void {
  const race = currentRace(w);
  if (w.tick < race.startTick) return;
  // Chances follow the odds (inverse odds, normalised).
  const inv = race.horses.map((h) => 1 / h.odds);
  const sum = inv.reduce((a, b) => a + b, 0);
  let x = roll() * sum, winner = 0;
  for (let i = 0; i < inv.length; i++) { x -= inv[i]; if (x <= 0) { winner = i; break; } }
  const rest = race.horses.map((_, i) => i).filter((i) => i !== winner).sort(() => roll() - 0.5);
  const order = [winner, ...rest];
  const m = purse(w);
  const payouts: RaceResult['payouts'] = [];
  for (const b of race.bets) {
    const p = w.players[b.playerId];
    if (!p) continue;
    const win = b.horse === winner ? money(Math.min(b.stake * race.horses[winner].odds, Math.max(0, m.treasury))) : 0;
    if (win > 0) {
      m.treasury = money(m.treasury - win);
      p.gold = money(p.gold + win);
      w.ledger.push({ tick: w.tick, playerId: p.id, type: 'game.race.win', goldDelta: win, details: { race: race.number } });
    }
    payouts.push({ playerId: p.id, name: p.name, horse: b.horse, stake: b.stake, win });
  }
  const g = w as WithRaces;
  g.lastRace = { id: race.id, number: race.number, tick: w.tick, horses: race.horses, order, winner, payouts };
  if (race.bets.length) {
    const big = payouts.filter((x) => x.win > 0).sort((a, b) => b.win - a.win)[0];
    pushFeed(w, { kind: 'event', text: `Hippodrome race ${race.number}: ${race.horses[winner].name} wins at ${race.horses[winner].odds}×${big ? `. ${big.name} collects ${big.win}g` : ''}.` });
  }
  g.race = newRace(w);
}

/** Public view: the open race (bets summarised) and the last result. */
export function racesView(w: WorldState) {
  // Reading the view never changes the world: before the first race, show the one that will open.
  const r = (w as WithRaces).race ?? newRace(w, false);
  return {
    race: { id: r.id, number: r.number, startTick: r.startTick, horses: r.horses, pool: money(r.bets.reduce((s, b) => s + b.stake, 0)), bets: r.bets.map((b) => ({ ...b, name: w.players[b.playerId]?.name ?? '?' })) },
    last: lastRace(w) ?? null,
    minutesPerRace: clamp(GAMES.race.everyTicks / TIME.ticksPerDay * 24, 1, 24),
  };
}
