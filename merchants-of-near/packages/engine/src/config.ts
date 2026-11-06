/**
 * Economic configuration. Every number that shapes the economy lives here so the
 * simulation can be tuned (or replaced per world) without touching engine logic.
 */

export const RESOURCES = [
  'wheat',
  'bread',
  'wood',
  'iron',
  'coal',
  'stone',
  'tools',
  'livestock',
  'fish',
  'cloth',
  'weapons',
] as const;
export type Resource = (typeof RESOURCES)[number];

export const MARKETS = ['nearhaven', 'aurora'] as const;
export type MarketId = (typeof MARKETS)[number];

export interface ResourceDef {
  label: string;
  /** Equilibrium price in gold at reference stock. */
  basePrice: number;
  /** Stock level at which the price equals basePrice. */
  refStock: number;
  /** How strongly price reacts to stock: price ∝ (ref/stock)^elasticity. */
  elasticity: number;
  /** Starting stock in each market. */
  initialStock: Record<MarketId, number>;
  category: 'raw' | 'food' | 'crafted';
  description: string;
}

export const RESOURCE_DEFS: Record<Resource, ResourceDef> = {
  wheat: { label: 'Wheat', basePrice: 3, refStock: 220, elasticity: 0.75, initialStock: { nearhaven: 220, aurora: 60 }, category: 'raw', description: 'Golden grain from the valley farms. Bakers turn it into bread.' },
  bread: { label: 'Bread', basePrice: 8, refStock: 90, elasticity: 0.85, initialStock: { nearhaven: 90, aurora: 30 }, category: 'food', description: 'The staple of every citizen. Shortages cause unrest.' },
  wood: { label: 'Wood', basePrice: 4, refStock: 160, elasticity: 0.6, initialStock: { nearhaven: 160, aurora: 120 }, category: 'raw', description: 'Timber for hearths, carts and tool handles.' },
  iron: { label: 'Iron', basePrice: 9, refStock: 110, elasticity: 0.7, initialStock: { nearhaven: 110, aurora: 200 }, category: 'raw', description: 'Ore smelted into bars. The blacksmith’s lifeblood.' },
  coal: { label: 'Coal', basePrice: 5, refStock: 120, elasticity: 0.65, initialStock: { nearhaven: 120, aurora: 140 }, category: 'raw', description: 'Fuel for forges and winter fires.' },
  stone: { label: 'Stone', basePrice: 4, refStock: 140, elasticity: 0.55, initialStock: { nearhaven: 140, aurora: 90 }, category: 'raw', description: 'Quarried blocks for the growing town.' },
  tools: { label: 'Tools', basePrice: 28, refStock: 40, elasticity: 0.8, initialStock: { nearhaven: 40, aurora: 12 }, category: 'crafted', description: 'Ploughs, saws and hammers. Every trade needs them.' },
  livestock: { label: 'Livestock', basePrice: 18, refStock: 50, elasticity: 0.7, initialStock: { nearhaven: 50, aurora: 30 }, category: 'food', description: 'Sheep and cattle — meat, hides and wool.' },
  fish: { label: 'Fish', basePrice: 6, refStock: 100, elasticity: 0.85, initialStock: { nearhaven: 100, aurora: 260 }, category: 'food', description: 'Fresh catch from the river and the sea.' },
  cloth: { label: 'Cloth', basePrice: 14, refStock: 60, elasticity: 0.7, initialStock: { nearhaven: 60, aurora: 110 }, category: 'crafted', description: 'Woven wool and linen for garments and sails.' },
  weapons: { label: 'Weapons', basePrice: 45, refStock: 25, elasticity: 0.8, initialStock: { nearhaven: 25, aurora: 8 }, category: 'crafted', description: 'Swords and spears for the town guard and caravans.' },
};

export const MARKET_DEFS: Record<MarketId, { name: string; fee: number; description: string }> = {
  nearhaven: { name: 'Nearhaven Exchange', fee: 0.03, description: 'The bustling central market of Nearhaven.' },
  aurora: { name: 'Port Aurora', fee: 0.04, description: 'A distant sea port. Rich in fish, iron and cloth; hungry for bread and tools.' },
};

export const TIME = {
  ticksPerDay: 24,
  daysPerSeason: 7,
  daysPerWeek: 7,
} as const;

export const SEASONS = ['spring', 'summer', 'autumn', 'winter'] as const;
export type Season = (typeof SEASONS)[number];

export const WEATHERS = ['clear', 'cloudy', 'rain', 'storm', 'snow', 'heatwave'] as const;
export type Weather = (typeof WEATHERS)[number];

export const ECONOMY = {
  /** Bounds on price relative to base price. */
  minPriceFactor: 0.25,
  maxPriceFactor: 8,
  /** Speed at which demand pressure converges each tick. */
  pressureSpeed: 0.04,
  pressureMin: 0.6,
  pressureMax: 2.2,
  /** Citizens' price elasticity of demand. */
  citizenElasticity: 0.8,
  /** Population growth per day when well fed (fraction). */
  popGrowth: 0.01,
  popDecline: 0.02,
  initialPopulation: 400,
  /** Outside income per citizen per tick (farmland rents, royal stipends, travellers). */
  citizenIncome: 0.03,
  /** Exponential moving-average weight for per-tick flows. */
  flowEma: 0.08,
  historyDays: 60,
  intradayHistory: 48,
  feedSize: 300,
} as const;

/** Units consumed per tick by every 100 citizens (before price elasticity). */
export const CITIZEN_DEMAND: Partial<Record<Resource, number>> = {
  bread: 0.55,
  fish: 0.3,
  livestock: 0.04,
  cloth: 0.07,
  tools: 0.025,
  weapons: 0.012,
  wood: 0.18,
  stone: 0.07,
  coal: 0.05,
  wheat: 0.04,
};

/** Seasonal multipliers on citizen demand. */
export const SEASONAL_DEMAND: Record<Season, Partial<Record<Resource, number>>> = {
  spring: { tools: 1.2, stone: 1.2 },
  summer: { fish: 1.15, stone: 1.3 },
  autumn: { bread: 1.1, cloth: 1.15 },
  winter: { wood: 1.8, coal: 1.7, cloth: 1.3, fish: 0.8 },
};

/** Port Aurora is modelled as a regional economy with exogenous flows (units/tick). */
export const AURORA_FLOWS: Record<Resource, { produce: number; consume: number }> = {
  wheat: { produce: 0.6, consume: 1.4 },
  bread: { produce: 0.2, consume: 0.9 },
  wood: { produce: 1.0, consume: 0.9 },
  iron: { produce: 1.6, consume: 0.9 },
  coal: { produce: 1.0, consume: 0.8 },
  stone: { produce: 0.6, consume: 0.6 },
  tools: { produce: 0.05, consume: 0.18 },
  livestock: { produce: 0.15, consume: 0.18 },
  fish: { produce: 2.6, consume: 1.6 },
  cloth: { produce: 0.7, consume: 0.45 },
  weapons: { produce: 0.02, consume: 0.08 },
};

export const TRAVEL_TICKS = 6;

/** Player-facing constants. */
export const PLAYER = {
  startingGold: 100,
  startingWarehouse: 60,
  warehouseExpansion: 60,
  warehouseExpansionBaseCost: 40,
  maxTradeQty: 500,
  startingReputation: 10,
} as const;

export interface Recipe {
  inputs: Partial<Record<Resource, number>>;
  outputs: Partial<Record<Resource, number>>;
  /** Batches per worker per tick. */
  ratePerWorker: number;
}
