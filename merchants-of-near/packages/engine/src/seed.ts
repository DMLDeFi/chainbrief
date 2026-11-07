import type { MarketId } from './config';
import type { MerchantRole, MerchantState, Personality } from './types';

interface Seed {
  id: string;
  name: string;
  role: MerchantRole;
  title: string;
  bio: string;
  personality: Personality;
  objectives: string[];
  gold: number;
  inventory: MerchantState['inventory'];
  workers: number;
  maxWorkers: number;
  wage: number;
  home: string;
  acceptsInvestment: boolean;
  location?: MarketId;
}

/** The founding merchants of Nearhaven. Personalities drive every decision they make. */
export const MERCHANT_SEEDS: Seed[] = [
  {
    id: 'farmer', name: 'Farmer John', role: 'farmer', title: 'Wheat Farmer of Greenfield',
    bio: 'A weathered, patient farmer who reads the sky better than any almanac. He would rather hold his grain than sell it cheap.',
    personality: { greed: 0.35, risk: 0.3, patience: 0.75, warmth: 0.7 },
    objectives: ['Sell the harvest above cost', 'Never let the granary overflow', 'Keep the farmhands employed'],
    gold: 160, inventory: { wheat: 40, livestock: 4 }, workers: 4, maxWorkers: 7, wage: 14, home: 'farm', acceptsInvestment: true,
  },
  {
    id: 'baker', name: 'Baker Mara', role: 'baker', title: 'Mistress of the Hearth Bakery',
    bio: 'Up before dawn, Mara watches wheat prices like a hawk and refuses to bake at a loss. Fiercely competitive with the Golden Crust.',
    personality: { greed: 0.4, risk: 0.45, patience: 0.4, warmth: 0.6 },
    objectives: ['Out-sell the Golden Crust', 'Keep bread margins above 20%', 'Expand to four ovens'],
    gold: 140, inventory: { wheat: 18, bread: 10 }, workers: 2, maxWorkers: 5, wage: 12, home: 'bakery', acceptsInvestment: true,
  },
  {
    id: 'baker2', name: 'Old Tobin', role: 'baker', title: 'Owner of the Golden Crust',
    bio: 'A cautious veteran baker. Tobin undercuts Mara when he can and never borrows a single coin.',
    personality: { greed: 0.25, risk: 0.2, patience: 0.6, warmth: 0.45 },
    objectives: ['Defend market share', 'Stay debt-free'],
    gold: 120, inventory: { wheat: 12, bread: 8 }, workers: 2, maxWorkers: 4, wage: 11, home: 'bakery2', acceptsInvestment: false,
  },
  {
    id: 'blacksmith', name: 'Smith Brunhild', role: 'blacksmith', title: 'Master of the Anvil',
    bio: 'An ambitious smith who invests boldly in iron and coal and borrows to expand. Her forge is either booming or in debt.',
    personality: { greed: 0.5, risk: 0.7, patience: 0.35, warmth: 0.4 },
    objectives: ['Forge whatever pays best: tools or weapons', 'Grow the forge to five smiths', 'Corner the weapons trade'],
    gold: 220, inventory: { iron: 10, coal: 10, wood: 6, tools: 3 }, workers: 2, maxWorkers: 5, wage: 16, home: 'smithy', acceptsInvestment: true,
  },
  {
    id: 'trader', name: 'Trader Selene', role: 'trader', title: 'Caravan Master of the Silk Road',
    bio: 'A sharp-eyed trader who travels between Nearhaven and Port Aurora, buying wherever goods are cheap and selling wherever they are dear. She remembers every route that burned her.',
    personality: { greed: 0.55, risk: 0.6, patience: 0.5, warmth: 0.5 },
    objectives: ['Exploit price gaps between markets', 'Grow the caravan fleet', 'Avoid routes that lost money'],
    gold: 300, inventory: {}, workers: 2, maxWorkers: 4, wage: 12, home: 'trading_post', acceptsInvestment: true,
  },
  {
    id: 'banker', name: 'Banker Aldric', role: 'banker', title: 'Keeper of the Silver Vault',
    bio: 'Precise, unsentimental and very rich. Aldric lends to anyone whose numbers add up — and refuses everyone else, politely.',
    personality: { greed: 0.6, risk: 0.45, patience: 0.9, warmth: 0.3 },
    objectives: ['Grow the vault through interest', 'Keep defaults below 10%', 'Refuse borrowers who cannot repay'],
    gold: 3000, inventory: {}, workers: 0, maxWorkers: 0, wage: 0, home: 'bank', acceptsInvestment: false,
  },
  {
    id: 'miner', name: 'Miner Brann', role: 'miner', title: 'Foreman of the Greyrock Mine',
    bio: 'Gruff and practical. Brann shifts his miners between iron, coal and stone depending on what the market is paying.',
    personality: { greed: 0.4, risk: 0.4, patience: 0.5, warmth: 0.35 },
    objectives: ['Dig what pays best', 'Keep the shafts safe'],
    gold: 150, inventory: { iron: 15, coal: 15, stone: 15 }, workers: 3, maxWorkers: 6, wage: 13, home: 'mine', acceptsInvestment: true,
  },
  {
    id: 'fisher', name: 'Fisher Wen', role: 'fisher', title: 'Captain of the Silver Herring',
    bio: 'Cheerful and impatient — Wen sells the catch fast before it spoils, even if prices are low.',
    personality: { greed: 0.25, risk: 0.35, patience: 0.15, warmth: 0.8 },
    objectives: ['Sell the catch while it is fresh', 'Buy a second boat'],
    gold: 90, inventory: { fish: 12 }, workers: 3, maxWorkers: 5, wage: 10, home: 'docks', acceptsInvestment: true,
  },
  {
    id: 'weaver', name: 'Weaver Isolde', role: 'weaver', title: 'Clothier of Loom Lane',
    bio: 'Meticulous and proud of her craft. Isolde buys livestock for wool and hides and weaves the finest cloth in the valley.',
    personality: { greed: 0.45, risk: 0.4, patience: 0.6, warmth: 0.55 },
    objectives: ['Keep the looms busy', 'Sell cloth above 12g'],
    gold: 130, inventory: { livestock: 3, cloth: 6 }, workers: 2, maxWorkers: 4, wage: 12, home: 'loom', acceptsInvestment: true,
  },
  {
    id: 'woodcutter', name: 'Woodcutter Hale', role: 'woodcutter', title: 'Warden of the Eastwood',
    bio: 'A quiet giant of a man who knows winter is his season: when the snow comes, firewood is worth its weight in silver.',
    personality: { greed: 0.5, risk: 0.3, patience: 0.7, warmth: 0.5 },
    objectives: ['Stockpile for winter', 'Supply the forge with charcoal wood'],
    gold: 100, inventory: { wood: 20 }, workers: 2, maxWorkers: 4, wage: 10, home: 'lumberyard', acceptsInvestment: true,
  },
];

export function createMerchant(s: Seed): MerchantState {
  return {
    id: s.id,
    name: s.name,
    role: s.role,
    title: s.title,
    bio: s.bio,
    personality: { ...s.personality },
    objectives: [...s.objectives],
    gold: s.gold,
    inventory: { ...s.inventory },
    workers: s.workers,
    maxWorkers: s.maxWorkers,
    wage: s.wage,
    ask: {},
    bid: {},
    beliefs: {},
    memory: [],
    decisions: [],
    history: [],
    today: { revenue: 0, costs: 0, produced: 0, sold: 0 },
    status: 'active',
    missedWages: 0,
    generation: 0,
    location: s.location ?? 'nearhaven',
    routes: {},
    homeBuilding: s.home,
    relationships: {},
    stats: { revenue: 0, costs: 0, trades: 0, loans: 0, defaults: 0, repaid: 0 },
    acceptsInvestment: s.acceptsInvestment,
    shares: 100,
    investors: {},
  };
}
