import type { MetricKey, MissionDef, MissionProgress, PlayerState, WorldState } from './types';
import { clamp, dayOf, money, pushFeed, weekOf } from './internal';
import { playerNetWorth } from './valuation';

export interface LevelDef {
  level: number;
  title: string;
  xp: number;
  netWorth: number;
  businesses: number;
  reputation: number;
  /** Cities where the player runs at least one business (from rank 7). */
  cities?: number;
  unlocks: string[];
}

export const LEVELS: LevelDef[] = [
  { level: 1, title: 'Street Trader', xp: 0, netWorth: 0, businesses: 0, reputation: 0, unlocks: ['Nearhaven Exchange', 'Farm', 'Warehouse', 'Loans'] },
  { level: 2, title: 'Market Merchant', xp: 120, netWorth: 220, businesses: 0, reputation: 0, unlocks: ['Bakery', 'Textile Shop', 'Player marketplace listings', 'Merchant investment'] },
  { level: 3, title: 'Business Owner', xp: 350, netWorth: 450, businesses: 1, reputation: 15, unlocks: ['Blacksmith', 'Private deals with merchants'] },
  { level: 4, title: 'Wealthy Trader', xp: 800, netWorth: 1100, businesses: 2, reputation: 25, unlocks: ['Trading Company', 'Port Aurora market'] },
  { level: 5, title: 'Trade Magnate', xp: 1800, netWorth: 3000, businesses: 3, reputation: 40, unlocks: ['Larger loans', 'Level 5 businesses', 'A first subsidiary company'] },
  { level: 6, title: 'Master Merchant', xp: 3500, netWorth: 8000, businesses: 4, reputation: 60, unlocks: ['Master Merchant deed on NEAR', 'Acquisitions of other owners’ businesses'] },
  { level: 7, title: 'Industrialist', xp: 6000, netWorth: 20000, businesses: 6, reputation: 68, cities: 3, unlocks: ['Three subsidiary companies', 'Bank'] },
  { level: 8, title: 'Regional Tycoon', xp: 10000, netWorth: 50000, businesses: 9, reputation: 76, cities: 4, unlocks: ['Five subsidiary companies'] },
  { level: 9, title: 'Merchant Prince', xp: 16000, netWorth: 120000, businesses: 13, reputation: 84, cities: 5, unlocks: ['Seven subsidiary companies'] },
  { level: 10, title: 'Economic Powerhouse', xp: 25000, netWorth: 300000, businesses: 18, reputation: 92, cities: 6, unlocks: ['Ten subsidiary companies', 'Powerhouse tiers beyond'] },
];
export const MAX_LEVEL = LEVELS.length;

export const levelTitle = (level: number) => LEVELS[clamp(level, 1, MAX_LEVEL) - 1].title;

/**
 * Beyond the top rank there is no ceiling: every doubling of net worth past
 * the Powerhouse threshold adds a tier (Economic Powerhouse II, III, …).
 */
export function powerhouseTier(p: PlayerState, netWorth: number): number {
  if (p.level < MAX_LEVEL) return 0;
  return 1 + Math.max(0, Math.floor(Math.log2(netWorth / LEVELS[MAX_LEVEL - 1].netWorth)));
}
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
export const rankTitle = (p: PlayerState, netWorth: number) => {
  const t = powerhouseTier(p, netWorth);
  return t > 1 ? `${levelTitle(p.level)} ${ROMAN[Math.min(10, t)] ?? t}` : levelTitle(p.level);
};
/** Cities where the player runs at least one business. */
export const citiesWithBusiness = (world: WorldState, p: PlayerState) => new Set(Object.values(world.businesses).filter((b) => b.ownerId === p.id).map((b) => b.city ?? 'nearhaven')).size;

export interface AchievementDef {
  id: string;
  title: string;
  description: string;
  xp: number;
  check: (world: WorldState, p: PlayerState) => boolean;
}

const owned = (world: WorldState, p: PlayerState) => Object.values(world.businesses).filter((b) => b.ownerId === p.id);

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: 'first_trade', title: 'First Coin', description: 'Complete your first trade.', xp: 10, check: (_w, p) => (p.lifetime.trades ?? 0) >= 1 },
  { id: 'profit_100', title: 'In the Black', description: 'Realise 100 gold of trading profit.', xp: 40, check: (_w, p) => (p.lifetime.realizedProfit ?? 0) >= 100 },
  { id: 'volume_1000', title: 'Market Regular', description: 'Trade 1,000 gold of goods.', xp: 40, check: (_w, p) => (p.lifetime.volume ?? 0) >= 1000 },
  { id: 'landowner', title: 'Landowner', description: 'Own your first business.', xp: 40, check: (w, p) => owned(w, p).length >= 1 },
  { id: 'diversified', title: 'Diversified', description: 'Own three different kinds of business.', xp: 80, check: (w, p) => new Set(owned(w, p).map((b) => b.kind)).size >= 3 },
  { id: 'employer', title: 'Employer', description: 'Employ 6 workers across your businesses.', xp: 60, check: (w, p) => owned(w, p).reduce((s, b) => s + b.workers, 0) >= 6 },
  { id: 'baker', title: 'Daily Bread', description: 'Sell 50 bread.', xp: 30, check: (_w, p) => (p.lifetime.breadSold ?? 0) >= 50 },
  { id: 'investor', title: 'Angel Investor', description: 'Invest in an AI merchant.', xp: 30, check: (w, p) => Object.values(w.merchants).some((m) => m.investors[p.id]) },
  { id: 'creditworthy', title: 'Creditworthy', description: 'Repay a loan in full.', xp: 40, check: (_w, p) => p.credit.repaid >= 1 },
  { id: 'negotiator', title: 'Silver Tongue', description: 'Close a private deal with a merchant.', xp: 30, check: (_w, p) => (p.lifetime.negotiations ?? 0) >= 1 },
  { id: 'networth_1000', title: 'Thousandaire', description: 'Reach a net worth of 1,000 gold.', xp: 80, check: (w, p) => playerNetWorth(w, p) >= 1000 },
  { id: 'networth_5000', title: 'Merchant Prince', description: 'Reach a net worth of 5,000 gold.', xp: 200, check: (w, p) => playerNetWorth(w, p) >= 5000 },
  { id: 'caravan', title: 'Caravan Master', description: 'Found a trading company.', xp: 80, check: (w, p) => owned(w, p).some((b) => b.kind === 'trading') },
  { id: 'master', title: 'Master Merchant', description: 'Reach level 6.', xp: 0, check: (_w, p) => p.level >= 6 },
  { id: 'realm', title: 'Across the Realm', description: 'Run businesses in three cities.', xp: 120, check: (w, p) => citiesWithBusiness(w, p) >= 3 },
  { id: 'everywhere', title: 'A Business in Every City', description: 'Run businesses in all six cities.', xp: 300, check: (w, p) => citiesWithBusiness(w, p) >= 6 },
  { id: 'patron', title: 'Patron of the Arts and Roads', description: 'Give 1,000 gold to public works.', xp: 150, check: (_w, p) => Object.values(p.patronage ?? {}).reduce((s, x) => s + (x ?? 0), 0) >= 1000 },
  { id: 'holding', title: 'Holding Company', description: 'Found a subsidiary company.', xp: 120, check: (_w, p) => (p.companies?.length ?? 0) >= 1 },
  { id: 'acquirer', title: 'Takeover', description: 'Acquire another owner’s business.', xp: 150, check: (_w, p) => (p.lifetime.acquisitions ?? 0) >= 1 },
  { id: 'powerhouse', title: 'Economic Powerhouse', description: 'Reach rank 10.', xp: 0, check: (_w, p) => p.level >= 10 },
];

const DAILY_POOL: Array<Omit<MissionDef, 'id'>> = [
  { title: 'Busy Hands', description: 'Complete 5 trades today.', metric: 'trades', target: 5, rewardGold: 8, rewardXp: 20, rewardRep: 1 },
  { title: 'Bulk Buyer', description: 'Buy 25 units of any goods.', metric: 'unitsBought', target: 25, rewardGold: 8, rewardXp: 20, rewardRep: 1 },
  { title: 'Clear the Stall', description: 'Sell 20 units of any goods.', metric: 'unitsSold', target: 20, rewardGold: 10, rewardXp: 20, rewardRep: 1 },
  { title: 'Feed the Town', description: 'Sell 10 bread.', metric: 'breadSold', target: 10, rewardGold: 12, rewardXp: 25, rewardRep: 2 },
  { title: 'Turn a Profit', description: 'Realise 25 gold of trading profit.', metric: 'profit', target: 25, rewardGold: 12, rewardXp: 30, rewardRep: 1 },
  { title: 'Grocer', description: 'Buy 15 units of food (bread, fish, livestock).', metric: 'foodBought', target: 15, rewardGold: 8, rewardXp: 20, rewardRep: 1 },
  { title: 'Volume Dealer', description: 'Trade 250 gold of goods.', metric: 'volume', target: 250, rewardGold: 12, rewardXp: 25, rewardRep: 1 },
  { title: 'Production Line', description: 'Your businesses produce 15 units.', metric: 'businessProduced', target: 15, rewardGold: 10, rewardXp: 25, rewardRep: 1 },
];

const WEEKLY_POOL: Array<Omit<MissionDef, 'id'>> = [
  { title: 'Trading Season', description: 'Trade 2,000 gold of goods this week.', metric: 'volume', target: 2000, rewardGold: 60, rewardXp: 120, rewardRep: 5 },
  { title: 'Industrialist', description: 'Your businesses produce 150 units this week.', metric: 'businessProduced', target: 150, rewardGold: 50, rewardXp: 120, rewardRep: 5 },
  { title: 'Profiteer', description: 'Realise 200 gold of trading profit this week.', metric: 'profit', target: 200, rewardGold: 60, rewardXp: 150, rewardRep: 5 },
  { title: 'Deal Maker', description: 'Close 3 private deals or player-market sales.', metric: 'negotiations', target: 3, rewardGold: 40, rewardXp: 100, rewardRep: 6 },
];

/** Deterministic mission selection per player per day so everyone gets a fair, varied set. */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function choose<T>(pool: T[], n: number, seed: number): T[] {
  const idx = pool.map((_, i) => i).sort((a, b) => hash(`${seed}:${a}`) - hash(`${seed}:${b}`));
  return idx.slice(0, n).map((i) => pool[i]);
}

export function refreshMissions(world: WorldState, p: PlayerState): void {
  const day = dayOf(world.tick);
  const week = weekOf(world.tick);
  if (p.missionDay !== day) {
    p.missionDay = day;
    p.dayCounters = {};
    p.daily = choose(DAILY_POOL, 3, hash(`${p.id}:d${day}`)).map((d, i) => ({ def: { ...d, id: `d${day}_${i}` }, progress: 0, completed: false, claimed: false }));
  }
  if (p.missionWeek !== week) {
    p.missionWeek = week;
    p.weekCounters = {};
    p.weekly = choose(WEEKLY_POOL, 2, hash(`${p.id}:w${week}`)).map((d, i) => ({ def: { ...d, id: `w${week}_${i}` }, progress: 0, completed: false, claimed: false }));
  }
}

export function bumpMetric(p: PlayerState, metric: MetricKey, amount: number): void {
  p.dayCounters[metric] = money((p.dayCounters[metric] ?? 0) + amount);
  p.weekCounters[metric] = money((p.weekCounters[metric] ?? 0) + amount);
  p.lifetime[metric] = money((p.lifetime[metric] ?? 0) + amount);
}

function updateMissionProgress(list: MissionProgress[], counters: PlayerState['dayCounters']) {
  for (const m of list) {
    m.progress = Math.min(m.def.target, counters[m.def.metric] ?? 0);
    if (m.progress >= m.def.target) m.completed = true;
  }
}

export function claimMission(world: WorldState, p: PlayerState, missionId: string): { ok: boolean; error?: string; reward?: MissionDef } {
  const m = [...p.daily, ...p.weekly].find((x) => x.def.id === missionId);
  if (!m) return { ok: false, error: 'Mission not found' };
  if (!m.completed) return { ok: false, error: 'Mission not completed yet' };
  if (m.claimed) return { ok: false, error: 'Reward already claimed' };
  m.claimed = true;
  // Rewards are paid from the guild treasury (funded by market fees), never minted.
  const gold = Math.min(m.def.rewardGold, Math.max(0, world.guildTreasury));
  world.guildTreasury = money(world.guildTreasury - gold);
  p.gold = money(p.gold + gold);
  p.xp += m.def.rewardXp;
  p.reputation = clamp(p.reputation + m.def.rewardRep, 0, 100);
  world.ledger.push({ tick: world.tick, playerId: p.id, type: 'mission.reward', goldDelta: gold, details: { missionId, xp: m.def.rewardXp } });
  return { ok: true, reward: m.def };
}

export interface ProgressionUpdate {
  newAchievements: string[];
  levelUp?: number;
}

/** Evaluate missions, achievements and level after any player action or tick. */
export function evaluateProgression(world: WorldState, p: PlayerState): ProgressionUpdate {
  refreshMissions(world, p);
  updateMissionProgress(p.daily, p.dayCounters);
  updateMissionProgress(p.weekly, p.weekCounters);
  const out: ProgressionUpdate = { newAchievements: [] };
  for (const a of ACHIEVEMENTS) {
    if (p.achievements[a.id] !== undefined) continue;
    if (a.check(world, p)) {
      p.achievements[a.id] = world.tick;
      p.xp += a.xp;
      out.newAchievements.push(a.id);
      pushFeed(world, { kind: 'player', actor: p.id, text: `${p.name} earned the achievement “${a.title}”.`, severity: 'good' });
    }
  }
  const nw = playerNetWorth(world, p);
  const biz = owned(world, p).length;
  const cities = citiesWithBusiness(world, p);
  let level = p.level;
  while (level < MAX_LEVEL) {
    const next = LEVELS[level];
    if (p.xp >= next.xp && nw >= next.netWorth && biz >= next.businesses && p.reputation >= next.reputation && cities >= (next.cities ?? 0)) level += 1;
    else break;
  }
  if (level > p.level) {
    p.level = level;
    out.levelUp = level;
    pushFeed(world, { kind: 'player', actor: p.id, text: `${p.name} rose to Level ${level}: ${levelTitle(level)}!`, severity: 'good' });
    if (level >= 4 && !p.marketAccess.includes('aurora')) p.marketAccess.push('aurora');
  }
  return out;
}

export function nextLevelRequirements(p: PlayerState): LevelDef | null {
  return p.level >= MAX_LEVEL ? null : LEVELS[p.level];
}
