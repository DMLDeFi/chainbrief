import type { PlayerState, WorldState } from './types';
import { clamp, fail, money, ok, pushFeed } from './internal';
import { playerNetWorth } from './valuation';
import { guildOf } from './guilds';
import type { Result } from './types';

/**
 * The Merchant's Path: a newcomer's first steps, in order. Each step checks the
 * player's real record, and its small reward is paid from the guild treasury
 * (funded by market fees), like missions, so no gold is created.
 */
export interface Milestone {
  id: string;
  title: string;
  /** What to do, in a sentence. */
  hint: string;
  /** The panel that helps (the client opens it). */
  panel: 'market' | 'guilds' | 'contracts' | 'tavern' | 'hippodrome' | 'business' | 'world' | 'achievements' | 'inventory';
  gold: number;
  xp: number;
  done: (w: WorldState, p: PlayerState) => boolean;
}

const hasBusiness = (w: WorldState, p: PlayerState) => Object.values(w.businesses).some((b) => b.ownerId === p.id);

export const MILESTONES: Milestone[] = [
  { id: 'buy', title: 'Strike your first deal', hint: 'Buy any goods at the Nearhaven Exchange.', panel: 'market', gold: 10, xp: 15, done: (_w, p) => (p.lifetime.unitsBought ?? 0) > 0 },
  { id: 'profit', title: 'Sell at a profit', hint: 'Sell goods for more than you paid. Buy low, sell high.', panel: 'market', gold: 20, xp: 25, done: (_w, p) => (p.lifetime.realizedProfit ?? 0) > 0 },
  { id: 'guild', title: 'Join a merchant guild', hint: 'Pick a guild: your profits score points for it all season.', panel: 'guilds', gold: 10, xp: 20, done: (_w, p) => !!guildOf(p) },
  { id: 'contract', title: 'Deliver a contract', hint: 'Take a job from the contracts board and deliver the goods.', panel: 'contracts', gold: 25, xp: 40, done: (_w, p) => (p.lifetime.contracts ?? 0) > 0 },
  { id: 'games', title: 'Try your luck', hint: 'Play a tavern game or bet on a horse at the Hippodrome.', panel: 'tavern', gold: 5, xp: 15, done: (_w, p) => (p.lifetime.games ?? 0) > 0 },
  { id: 'business', title: 'Open a business', hint: 'Buy a plot in town and build a workshop that produces goods.', panel: 'business', gold: 40, xp: 60, done: hasBusiness },
  { id: 'office', title: 'Trade beyond Nearhaven', hint: 'Open a trading office in another city from the world map.', panel: 'world', gold: 40, xp: 60, done: (_w, p) => p.charters.length > 0 },
  { id: 'level3', title: 'Rise to level 3', hint: 'Earn XP from trades, contracts and missions.', panel: 'achievements', gold: 50, xp: 0, done: (_w, p) => p.level >= 3 },
  { id: 'networth', title: 'Worth 1,000 gold', hint: 'Grow your net worth (gold, goods, businesses) to 1,000g.', panel: 'inventory', gold: 100, xp: 100, done: (w, p) => playerNetWorth(w, p) >= 1000 },
];

type WithPath = PlayerState & { milestones?: Record<string, number> };
const claimed = (p: PlayerState) => ((p as WithPath).milestones ??= {});

/** The player's path: every step, whether it is done and claimed, and the next one to do. */
export function milestonesView(w: WorldState, p: PlayerState) {
  const c = (p as WithPath).milestones ?? {};
  const steps = MILESTONES.map((m) => ({ id: m.id, title: m.title, hint: m.hint, panel: m.panel, gold: m.gold, xp: m.xp, done: c[m.id] !== undefined || m.done(w, p), claimed: c[m.id] !== undefined }));
  const next = steps.find((s) => !s.done)?.id ?? null;
  return { steps, next, complete: steps.every((s) => s.claimed) };
}

export function claimMilestone(w: WorldState, playerId: string, id: unknown): Result<{ gold: number; xp: number; title: string; complete: boolean }> {
  const p = w.players[playerId];
  if (!p) return fail('Unknown player');
  const m = MILESTONES.find((x) => x.id === id);
  if (!m) return fail('Unknown milestone');
  const c = claimed(p);
  if (c[m.id] !== undefined) return fail('Already claimed');
  if (!m.done(w, p)) return fail(`Not yet: ${m.hint}`);
  c[m.id] = w.tick;
  const gold = money(Math.min(m.gold, Math.max(0, w.guildTreasury)));
  w.guildTreasury = money(w.guildTreasury - gold);
  p.gold = money(p.gold + gold);
  p.xp += m.xp;
  w.ledger.push({ tick: w.tick, playerId: p.id, type: 'milestone.reward', goldDelta: gold, details: { milestone: m.id, xp: m.xp } });
  const complete = MILESTONES.every((x) => c[x.id] !== undefined);
  if (complete) {
    p.reputation = clamp(p.reputation + 5, 0, 100);
    pushFeed(w, { kind: 'event', text: `${p.name} has walked the whole Merchant's Path. A true merchant of Nearhaven!` });
  }
  return ok({ gold, xp: m.xp, title: m.title, complete });
}
