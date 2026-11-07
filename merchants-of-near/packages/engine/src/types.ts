import type { MarketId, Resource, Season, Weather } from './config';

export type Inventory = Partial<Record<Resource, number>>;
export type ResourceMap<T> = Record<Resource, T>;

export type ActorRef =
  | { kind: 'player'; id: string }
  | { kind: 'merchant'; id: string }
  | { kind: 'business'; id: string }
  | { kind: 'citizens'; id: MarketId }
  | { kind: 'region'; id: MarketId };

export interface MarketState {
  id: MarketId;
  name: string;
  fee: number;
  stock: ResourceMap<number>;
  /** Demand pressure multiplier, driven by shortages and buy/sell imbalance. */
  pressure: ResourceMap<number>;
  /** Current mid price (cached each tick and after each trade). */
  price: ResourceMap<number>;
  /** Price at the start of the current day, for daily change. */
  openPrice: ResourceMap<number>;
  /** Closing price per day. */
  history: ResourceMap<number[]>;
  /** Hourly prices for the last two days. */
  intraday: ResourceMap<number[]>;
  /** EMA of units bought from the market per tick (demand). */
  demandRate: ResourceMap<number>;
  /** EMA of units sold into the market per tick (supply inflow). */
  supplyRate: ResourceMap<number>;
  /** EMA of units produced in the economy per tick. */
  productionRate: ResourceMap<number>;
  /** EMA of units consumed by citizens per tick. */
  consumptionRate: ResourceMap<number>;
  /** EMA of unmet citizen demand per tick. */
  shortageRate: ResourceMap<number>;
  /** Accumulators for the current tick, folded into the EMAs at tick end. */
  tickBuys: ResourceMap<number>;
  tickSells: ResourceMap<number>;
  tickProduced: ResourceMap<number>;
  tickConsumed: ResourceMap<number>;
  tickShortage: ResourceMap<number>;
  volumeToday: number;
  treasury: number;
}

export interface Personality {
  /** 0..1 — how much margin the merchant insists on. */
  greed: number;
  /** 0..1 — willingness to spend capital, borrow and expand. */
  risk: number;
  /** 0..1 — willingness to hold inventory waiting for better prices. */
  patience: number;
  /** 0..1 — friendliness in negotiation. */
  warmth: number;
}

export type MerchantRole =
  | 'farmer'
  | 'baker'
  | 'blacksmith'
  | 'trader'
  | 'banker'
  | 'miner'
  | 'fisher'
  | 'weaver'
  | 'woodcutter';

export interface MemoryItem {
  tick: number;
  kind: 'buy' | 'sell' | 'loan' | 'repay' | 'refuse' | 'produce' | 'expand' | 'deal' | 'travel' | 'wage' | 'invest';
  resource?: Resource;
  qty?: number;
  price?: number;
  counterparty?: string;
  note: string;
}

export interface Decision {
  tick: number;
  action: string;
  reasons: string[];
}

export interface DailyRecord {
  day: number;
  gold: number;
  netWorth: number;
  revenue: number;
  costs: number;
  profit: number;
}

export interface MerchantState {
  id: string;
  name: string;
  role: MerchantRole;
  title: string;
  bio: string;
  personality: Personality;
  objectives: string[];
  gold: number;
  inventory: Inventory;
  workers: number;
  maxWorkers: number;
  wage: number;
  /** Reservation (minimum) ask price per resource the merchant sells. */
  ask: Inventory;
  /** Reservation (maximum) bid price per resource the merchant buys. */
  bid: Inventory;
  /** Belief about typical price, an EMA of observed market prices. */
  beliefs: Inventory;
  memory: MemoryItem[];
  decisions: Decision[];
  history: DailyRecord[];
  today: { revenue: number; costs: number; produced: number; sold: number };
  status: 'active' | 'struggling' | 'bankrupt';
  missedWages: number;
  bankruptSince?: number;
  generation: number;
  location: MarketId;
  travel?: { to: MarketId; from?: MarketId; arriveTick: number; cargo: Inventory; costBasis: number; expected?: number };
  /** Trader memory: realised/expected revenue ratio per route, used to discount future forecasts. */
  routes: Record<string, number>;
  homeBuilding: string;
  relationships: Record<string, number>;
  stats: { revenue: number; costs: number; trades: number; loans: number; defaults: number; repaid: number };
  /** Accepts outside investment? */
  acceptsInvestment: boolean;
  /** Total equity shares outstanding (merchant owns the rest). 1 share = initial capital unit. */
  shares: number;
  /** Shares held by investors (playerId → shares). */
  investors: Record<string, number>;
}

export type BusinessKind = 'farm' | 'bakery' | 'blacksmith' | 'textile' | 'warehouse' | 'trading';

export interface BusinessDaily {
  day: number;
  revenue: number;
  expenses: number;
  profit: number;
  produced: number;
}

export interface Business {
  id: string;
  kind: BusinessKind;
  name: string;
  ownerId: string;
  level: number;
  workers: number;
  inventory: Inventory;
  purchasePrice: number;
  /** Player-configurable automation. */
  policy: {
    autoBuyInputs: boolean;
    autoSell: boolean;
    minSellPrice: number;
    /** For blacksmith: which product to craft. */
    product?: Resource;
  };
  today: { revenue: number; expenses: number; produced: number };
  totals: { revenue: number; expenses: number; produced: number };
  history: BusinessDaily[];
  /** Fractional production carried between ticks. */
  progress: number;
  createdTick: number;
  /** On-chain deed token id, if minted. */
  deedTokenId?: string;
  /** NEAR account that holds the deed on-chain (authoritative for deeded businesses). */
  chainOwner?: string;
  plot: number;
  /** Trading company caravan state. */
  caravan?: { to: MarketId; arriveTick: number; cargo: Inventory; costBasis: number };
}

export interface Loan {
  id: string;
  borrower: ActorRef;
  principal: number;
  outstanding: number;
  dailyRate: number;
  installment: number;
  issuedTick: number;
  termDays: number;
  missed: number;
  status: 'active' | 'repaid' | 'defaulted';
  riskScore: number;
}

export interface Listing {
  id: string;
  sellerId: string;
  resource: Resource;
  qty: number;
  unitPrice: number;
  createdTick: number;
  status: 'open' | 'sold' | 'cancelled';
  buyerId?: string;
}

export interface MissionDef {
  id: string;
  title: string;
  description: string;
  metric: MetricKey;
  target: number;
  rewardGold: number;
  rewardXp: number;
  rewardRep: number;
}

export type MetricKey =
  | 'trades'
  | 'unitsBought'
  | 'unitsSold'
  | 'volume'
  | 'profit'
  | 'breadSold'
  | 'foodBought'
  | 'businessProduced'
  | 'listings'
  | 'negotiations'
  | 'netWorth'
  | 'businesses'
  | 'workers';

export interface MissionProgress {
  def: MissionDef;
  progress: number;
  completed: boolean;
  claimed: boolean;
}

export interface PlayerState {
  id: string;
  name: string;
  joinedTick: number;
  gold: number;
  inventory: Inventory;
  /** Weighted-average acquisition cost per unit, for realised-profit tracking. */
  costBasis: Inventory;
  warehouseCapacity: number;
  warehouseLevel: number;
  xp: number;
  level: number;
  reputation: number;
  achievements: Record<string, number>;
  /** Counters reset daily/weekly for missions. */
  dayCounters: Partial<Record<MetricKey, number>>;
  weekCounters: Partial<Record<MetricKey, number>>;
  lifetime: Partial<Record<MetricKey, number>> & { realizedProfit?: number };
  daily: MissionProgress[];
  weekly: MissionProgress[];
  missionDay: number;
  missionWeek: number;
  relationships: Record<string, number>;
  nearAccountId?: string;
  credit: { repaid: number; defaults: number };
  history: { day: number; netWorth: number; gold: number }[];
  marketAccess: MarketId[];
  /** Trading offices the player has opened in other cities (with a depot there). */
  charters: MarketId[];
  /** Goods held in other cities' depots. The home warehouse is `inventory` (Nearhaven). */
  depots: Partial<Record<MarketId, Inventory>>;
}

/** Goods moving between two cities along the route network. */
export interface Shipment {
  id: string;
  ownerId: string;
  from: MarketId;
  to: MarketId;
  resource: Resource;
  qty: number;
  departTick: number;
  arriveTick: number;
  freight: number;
}

export interface ActiveEvent {
  id: string;
  kind: EventKind;
  title: string;
  description: string;
  startTick: number;
  endTick: number;
  effects: {
    production?: Partial<Record<Resource, number>>;
    demand?: Partial<Record<Resource, number>>;
  };
}

export type EventKind = 'drought' | 'bumper_harvest' | 'mine_collapse' | 'festival' | 'bandits' | 'fishing_boom' | 'cattle_plague' | 'royal_order';

export type FeedKind =
  | 'trade'
  | 'production'
  | 'price'
  | 'supply'
  | 'demand'
  | 'event'
  | 'loan'
  | 'bankruptcy'
  | 'expansion'
  | 'opportunity'
  | 'travel'
  | 'player'
  | 'weather'
  | 'population';

export interface FeedEntry {
  id: number;
  tick: number;
  kind: FeedKind;
  text: string;
  actor?: string;
  resource?: Resource;
  market?: MarketId;
  /** Structured numbers backing the text (so the UI can verify/visualise). */
  data?: Record<string, number | string>;
  severity?: 'info' | 'good' | 'bad';
}

export interface LedgerEntry {
  tick: number;
  playerId: string;
  type: string;
  goldDelta: number;
  items?: Inventory;
  details: Record<string, unknown>;
}

export interface WorldState {
  version: 1;
  seed: number;
  rng: number;
  tick: number;
  season: Season;
  weather: Weather;
  weatherUntil: number;
  population: number;
  markets: Record<MarketId, MarketState>;
  merchants: Record<string, MerchantState>;
  players: Record<string, PlayerState>;
  businesses: Record<string, Business>;
  loans: Record<string, Loan>;
  listings: Record<string, Listing>;
  events: ActiveEvent[];
  feed: FeedEntry[];
  nextId: number;
  nextFeedId: number;
  /** Plots in town available for player businesses. */
  plotsUsed: number[];
  /** Pending ledger entries for the persistence layer to flush. */
  ledger: LedgerEntry[];
  /** Guild treasury pays mission rewards; it is funded by market fees, so rewards are not minted from nothing. */
  guildTreasury: number;
  /** Last price/stock reported to the activity feed, to detect significant moves. */
  reported: Record<MarketId, { price: ResourceMap<number>; stock: ResourceMap<number> }>;
  stats: {
    dayFoodSatisfaction: number;
    lastDayFoodSatisfaction: number;
  };
  /** Per-city state beyond the exchange (population grows in later phases). */
  cities: Record<MarketId, { population: number }>;
  shipments: Record<string, Shipment>;
}

export type Result<T> = { ok: true; data: T } | { ok: false; error: string };
export const ok = <T>(data: T): Result<T> => ({ ok: true, data });
export const fail = <T = never>(error: string): Result<T> => ({ ok: false, error });
