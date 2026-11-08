import type { MarketId } from '@mon/engine';
import { generateCity, type CityLayout } from './cityLayouts';
import { SPECS } from './art/buildings';
/** Static town layout in isometric grid coordinates. */
export const MAP = 30;
export const TILE_W = 64;
export const TILE_H = 32;

export const iso = (gx: number, gy: number) => ({ x: (gx - gy) * (TILE_W / 2), y: (gx + gy) * (TILE_H / 2) });

export type BuildingStyle = 'hall' | 'house' | 'barn' | 'forge' | 'bank' | 'mine' | 'dock' | 'mill' | 'warehouse' | 'tent';

export interface BuildingDef {
  id: string;
  label: string;
  /** Merchant id living/working here, if any. */
  merchant?: string;
  gx: number;
  gy: number;
  w: number;
  d: number;
  h: number;
  wall: number;
  roof: number;
  style: BuildingStyle;
  chimney?: boolean;
  /** Where NPCs stand when "at the door". */
  door: { gx: number; gy: number };
}

const NEARHAVEN_BUILDINGS: BuildingDef[] = [
  { id: 'exchange', label: 'Nearhaven Exchange', gx: 14, gy: 14, w: 3, d: 3, h: 46, wall: 0xd8c39a, roof: 0x7b3b2c, style: 'hall', door: { gx: 15, gy: 17 } },
  { id: 'farm', label: "Farmer John's Farmstead", merchant: 'farmer', gx: 22, gy: 5, w: 2, d: 2, h: 26, wall: 0xc9a46c, roof: 0x9a4f2e, style: 'barn', door: { gx: 22, gy: 7 } },
  { id: 'bakery', label: "Mara's Hearth Bakery", merchant: 'baker', gx: 11, gy: 10, w: 2, d: 2, h: 30, wall: 0xe8d6ad, roof: 0xb4562f, style: 'house', chimney: true, door: { gx: 12, gy: 12 } },
  { id: 'bakery2', label: 'The Golden Crust', merchant: 'baker2', gx: 19, gy: 19, w: 2, d: 2, h: 30, wall: 0xe2c98f, roof: 0x6d4a2a, style: 'house', chimney: true, door: { gx: 19, gy: 18 } },
  { id: 'smithy', label: "Brunhild's Forge", merchant: 'blacksmith', gx: 19, gy: 10, w: 2, d: 2, h: 28, wall: 0x8c8378, roof: 0x3d3a40, style: 'forge', chimney: true, door: { gx: 18, gy: 11 } },
  { id: 'trading_post', label: "Selene's Trading Post", merchant: 'trader', gx: 25, gy: 13, w: 2, d: 2, h: 30, wall: 0xb88a5a, roof: 0x2f5e6e, style: 'warehouse', door: { gx: 25, gy: 15 } },
  { id: 'bank', label: 'The Silver Vault', merchant: 'banker', gx: 10, gy: 18, w: 2, d: 2, h: 40, wall: 0xcfd3d6, roof: 0x3b4d6b, style: 'bank', door: { gx: 12, gy: 19 } },
  { id: 'mine', label: 'Greyrock Mine', merchant: 'miner', gx: 5, gy: 4, w: 2, d: 2, h: 22, wall: 0x6e665e, roof: 0x4a4038, style: 'mine', door: { gx: 7, gy: 5 } },
  { id: 'docks', label: "Wen's Docks", merchant: 'fisher', gx: 4, gy: 21, w: 2, d: 2, h: 18, wall: 0x8a6a46, roof: 0x5b7f8f, style: 'dock', door: { gx: 6, gy: 22 } },
  { id: 'loom', label: "Isolde's Loom House", merchant: 'weaver', gx: 10, gy: 24, w: 2, d: 2, h: 30, wall: 0xd9c2c8, roof: 0x7d4f7a, style: 'house', door: { gx: 12, gy: 25 } },
  { id: 'lumberyard', label: "Hale's Lumberyard", merchant: 'woodcutter', gx: 23, gy: 23, w: 2, d: 2, h: 24, wall: 0x9b7448, roof: 0x4d6b3a, style: 'mill', door: { gx: 23, gy: 22 } },
];

/** Plots for player-owned businesses (index = engine plot number). */
const NEARHAVEN_PLOTS: Array<{ gx: number; gy: number }> = [
  { gx: 11, gy: 6 }, { gx: 17, gy: 6 }, { gx: 7, gy: 11 }, { gx: 6, gy: 13 },
  { gx: 22, gy: 10 }, { gx: 21, gy: 16 }, { gx: 16, gy: 22 }, { gx: 12, gy: 22 },
  { gx: 6, gy: 18 }, { gx: 18, gy: 25 }, { gx: 26, gy: 18 }, { gx: 13, gy: 3 },
];

export type TileKind = 'water' | 'road' | 'plaza' | 'field' | 'dirt' | 'grass' | 'sand';
function nearhavenTile(gx: number, gy: number): TileKind {
  if (gx <= 2 || (gx === 3 && gy % 5 !== 0)) return 'water';
  if (gx === 3) return 'sand';
  if (gx >= 13 && gx <= 17 && gy >= 13 && gy <= 17) return 'plaza';
  if (gy === 15 || gx === 15) return 'road';
  if (gy === 8 && gx >= 8 && gx <= 22) return 'road';
  if (gx === 9 && gy >= 8 && gy <= 26) return 'road';
  if (gy === 21 && gx >= 6 && gx <= 26) return 'road';
  if (gx >= 20 && gx <= 27 && gy >= 1 && gy <= 4) return 'field';
  if (gx >= 24 && gx <= 27 && gy >= 5 && gy <= 7) return 'field';
  if (gx >= 4 && gx <= 8 && gy >= 1 && gy <= 6) return 'dirt';
  return 'grass';
}

/** Deterministic hash for scattering decorations. */
export const hash2 = (x: number, y: number) => {
  let h = (x * 374761393 + y * 668265263) ^ 0x5bd1e995;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

/** Decorative (non-merchant) architecture: tavern and town houses. */
export interface DecorDef { id: string; label: string; gx: number; gy: number; w: number; d: number }
const NEARHAVEN_DECOR: DecorDef[] = [
  { id: 'tavern', label: 'The Gilded Tankard — tavern & inn', gx: 11, gy: 16, w: 2, d: 2 },
  { id: 'house0', label: 'Town house', gx: 19, gy: 7, w: 1, d: 1 },
  { id: 'house1', label: 'Town house', gx: 10, gy: 6, w: 1, d: 1 },
  { id: 'house2', label: 'Town house', gx: 20, gy: 13, w: 1, d: 1 },
  { id: 'house3', label: 'Town house', gx: 19, gy: 22, w: 1, d: 1 },
  { id: 'house4', label: 'Town house', gx: 14, gy: 24, w: 1, d: 1 },
  { id: 'house5', label: 'Town house', gx: 22, gy: 19, w: 1, d: 1 },
  { id: 'house6', label: 'Town house', gx: 7, gy: 9, w: 1, d: 1 },
  { id: 'house7', label: 'Town house', gx: 16, gy: 19, w: 1, d: 1 },
  { id: 'house8', label: 'Town house', gx: 13, gy: 19, w: 1, d: 1 },
];

// ------------------------------------------------------------------ city ---
// The town being shown. These are live bindings: the scene reads whichever
// city's layout was selected (with setCityLayout) before the game was created.
export let CITY_ID: MarketId = 'nearhaven';
export let BUILDINGS: BuildingDef[] = NEARHAVEN_BUILDINGS;
export let DECOR: DecorDef[] = NEARHAVEN_DECOR;
export let PLOTS: Array<{ gx: number; gy: number }> = NEARHAVEN_PLOTS;
export let tileKind: (gx: number, gy: number) => TileKind = nearhavenTile;
/** Props for generated towns (Nearhaven's hand-placed props live in the scene). */
export let CITY_PROPS: CityLayout['props'] | null = null;
export let CITY_BRIDGE = true;

const cache = new Map<MarketId, CityLayout>();
/** Nearhaven's own specs, restored before another city's are laid over them. */
const BASE_SPECS = { ...SPECS };
export function setCityLayout(city: MarketId, exchangeName: string) {
  CITY_ID = city;
  for (const k of Object.keys(SPECS)) if (!(k in BASE_SPECS)) delete SPECS[k];
  Object.assign(SPECS, BASE_SPECS);
  if (city === 'nearhaven') {
    BUILDINGS = NEARHAVEN_BUILDINGS; DECOR = NEARHAVEN_DECOR; PLOTS = NEARHAVEN_PLOTS; tileKind = nearhavenTile; CITY_PROPS = null; CITY_BRIDGE = true;
    return;
  }
  let L = cache.get(city);
  if (!L) { L = generateCity(city, exchangeName, 1000 + city.length * 97 + city.charCodeAt(0)); cache.set(city, L); }
  BUILDINGS = L.buildings; DECOR = L.decor; PLOTS = L.plots; tileKind = L.tileKind; CITY_PROPS = L.props; CITY_BRIDGE = L.bridge;
  Object.assign(SPECS, L.specs);
}
