import { TIME } from './config';
import type { PlayerState, Result, WorldState } from './types';
import { clamp, dayOf, fail, money, ok, pushFeed } from './internal';

/**
 * Merchant guilds and seasons. Every player can join one of four guilds.
 * Trading profit, delivered contracts, new businesses and gifts to public works
 * earn points for the player and their guild. When a season ends the leading
 * guild's members are named its champions (title, XP and reputation) and the
 * season's top merchant is crowned. Rewards never create gold.
 */
export type GuildId = 'scale' | 'anvil' | 'sheaf' | 'compass';
export interface GuildDef { id: GuildId; name: string; motto: string; color: string; trade: string }
export const GUILDS: Record<GuildId, GuildDef> = {
  scale: { id: 'scale', name: 'Guild of the Gilded Scale', motto: 'Buy low. Sell high. Never blink.', color: '#e0ad4f', trade: 'traders and bankers' },
  anvil: { id: 'anvil', name: 'Iron Covenant', motto: 'What we forge outlasts the forger.', color: '#c2552f', trade: 'smiths and makers' },
  sheaf: { id: 'sheaf', name: 'Verdant Sheaf', motto: 'Every empire starts with bread.', color: '#5fbf5a', trade: 'farmers and bakers' },
  compass: { id: 'compass', name: 'Tidewater Compass', motto: 'Fortune belongs to the road.', color: '#3aa6d8', trade: 'carriers and captains' },
};
export const GUILD_IDS = Object.keys(GUILDS) as GuildId[];

export const SEASON = {
  /** Game days per season. The world only moves while people play, so this spans many real sessions. */
  days: 56,
  championXp: 250,
  championRep: 4,
  topXp: 400,
  topRep: 6,
};

export interface SeasonState {
  number: number;
  startTick: number;
  points: Record<GuildId, number>;
  /** Points each player earned this season. */
  players: Record<string, number>;
}
export interface SeasonResult { number: number; winner: GuildId; points: Record<GuildId, number>; topPlayer?: { id: string; name: string; points: number } }

type WithGuilds = WorldState & { season2?: SeasonState; seasonHistory?: SeasonResult[] };
type WithGuild = PlayerState & { guild?: GuildId; guildSince?: number; titles?: string[] };
const zero = (): Record<GuildId, number> => ({ scale: 0, anvil: 0, sheaf: 0, compass: 0 });

/** The current season (created on first use, so old saves gain one). */
export function currentSeason(w: WorldState): SeasonState {
  const g = w as WithGuilds;
  return (g.season2 ??= { number: 1, startTick: w.tick, points: zero(), players: {} });
}
export const guildOf = (p: PlayerState): GuildId | undefined => (p as WithGuild).guild;
export const titlesOf = (p: PlayerState): string[] => (p as WithGuild).titles ?? [];

export function joinGuild(w: WorldState, playerId: string, guild: unknown): Result<{ guild: GuildId }> {
  const p = w.players[playerId] as WithGuild | undefined;
  if (!p) return fail('Unknown player');
  if (typeof guild !== 'string' || !(guild in GUILDS)) return fail('Unknown guild');
  const g = guild as GuildId;
  if (p.guild === g) return fail(`You are already in the ${GUILDS[g].name}`);
  const s = currentSeason(w);
  if (p.guild) {
    // Changing sides mid-season: your points stay with the guild you leave, and you start again.
    if (p.guildSince !== undefined && p.guildSince >= s.startTick) return fail('You can change guild once per season');
    s.players[playerId] = 0;
  }
  p.guild = g;
  p.guildSince = w.tick;
  pushFeed(w, { kind: 'player', actor: playerId, text: `${p.name} joined the ${GUILDS[g].name}.` });
  return ok({ guild: g });
}

/** Award season points to a player and their guild (nothing happens for players without a guild). */
export function awardPoints(w: WorldState, p: PlayerState, points: number): void {
  const g = guildOf(p);
  if (!g || !(points > 0)) return;
  const s = currentSeason(w);
  const pts = Math.round(points);
  s.points[g] += pts;
  s.players[p.id] = (s.players[p.id] ?? 0) + pts;
}

/** Daily: close the season when it is due and start the next. */
export function guildsDaily(w: WorldState): void {
  const s = currentSeason(w);
  if (dayOf(w.tick) - dayOf(s.startTick) < SEASON.days) return;
  const winner = GUILD_IDS.slice().sort((a, b) => s.points[b] - s.points[a])[0];
  const top = Object.entries(s.players).sort((a, b) => b[1] - a[1])[0];
  const result: SeasonResult = { number: s.number, winner, points: { ...s.points } };
  if (s.points[winner] > 0) {
    for (const p of Object.values(w.players) as WithGuild[]) {
      if (p.guild !== winner || !(s.players[p.id] > 0)) continue;
      (p.titles ??= []).push(`Champion of Season ${s.number}`);
      p.xp += SEASON.championXp;
      p.reputation = clamp(p.reputation + SEASON.championRep, 0, 100);
    }
    pushFeed(w, { kind: 'event', text: `Season ${s.number} is over: the ${GUILDS[winner].name} wins with ${s.points[winner].toLocaleString('en-US')} points!`, severity: 'good' });
  }
  if (top && top[1] > 0) {
    const p = w.players[top[0]] as WithGuild | undefined;
    if (p) {
      (p.titles ??= []).push(`Grand Merchant of Season ${s.number}`);
      p.xp += SEASON.topXp;
      p.reputation = clamp(p.reputation + SEASON.topRep, 0, 100);
      result.topPlayer = { id: p.id, name: p.name, points: top[1] };
      pushFeed(w, { kind: 'player', actor: p.id, text: `${p.name} is crowned Grand Merchant of Season ${s.number} with ${top[1].toLocaleString('en-US')} points.`, severity: 'good' });
    }
  }
  const g = w as WithGuilds;
  (g.seasonHistory ??= []).unshift(result);
  g.seasonHistory.splice(10);
  g.season2 = { number: s.number + 1, startTick: w.tick, points: zero(), players: {} };
}

/** Public view of the guilds and the season race. */
export function guildsView(w: WorldState) {
  const s = currentSeason(w);
  const members: Record<GuildId, number> = zero();
  const top: Record<GuildId, Array<{ name: string; points: number }>> = { scale: [], anvil: [], sheaf: [], compass: [] };
  for (const p of Object.values(w.players)) {
    const g = guildOf(p);
    if (!g) continue;
    members[g] += 1;
    const pts = s.players[p.id] ?? 0;
    if (pts > 0) top[g].push({ name: p.name, points: pts });
  }
  for (const g of GUILD_IDS) top[g] = top[g].sort((a, b) => b.points - a.points).slice(0, 3);
  return {
    season: s.number,
    endsInDays: Math.max(0, SEASON.days - (dayOf(w.tick) - dayOf(s.startTick))),
    guilds: GUILD_IDS.map((id) => ({ ...GUILDS[id], points: s.points[id], members: members[id], top: top[id] })),
    history: ((w as WithGuilds).seasonHistory ?? []).slice(0, 5),
  };
}

/** A player's own guild standing. */
export function playerGuildView(w: WorldState, p: PlayerState) {
  const s = currentSeason(w);
  return { guild: guildOf(p) ?? null, seasonPoints: s.players[p.id] ?? 0, titles: titlesOf(p), canSwitch: !((p as WithGuild).guildSince !== undefined && (p as WithGuild).guildSince! >= s.startTick) };
}

/** Points for realised trading profit (one point per gold of profit). */
export const profitPoints = (profit: number) => Math.max(0, money(profit));
export const SEASON_TICKS = SEASON.days * TIME.ticksPerDay;
