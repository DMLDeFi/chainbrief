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

export const BUILDINGS: BuildingDef[] = [
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
export const PLOTS: Array<{ gx: number; gy: number }> = [
  { gx: 11, gy: 6 }, { gx: 17, gy: 6 }, { gx: 7, gy: 11 }, { gx: 6, gy: 13 },
  { gx: 22, gy: 10 }, { gx: 21, gy: 16 }, { gx: 16, gy: 22 }, { gx: 12, gy: 22 },
  { gx: 6, gy: 18 }, { gx: 18, gy: 25 }, { gx: 26, gy: 18 }, { gx: 13, gy: 3 },
];

export const PLAYER_STYLE: Record<string, { wall: number; roof: number; style: BuildingStyle; h: number; chimney?: boolean }> = {
  farm: { wall: 0xcfa874, roof: 0xa0522d, style: 'barn', h: 24 },
  bakery: { wall: 0xeedcb4, roof: 0xc2652f, style: 'house', h: 28, chimney: true },
  blacksmith: { wall: 0x8f877c, roof: 0x34313a, style: 'forge', h: 26, chimney: true },
  textile: { wall: 0xe0c7d0, roof: 0x8b5786, style: 'house', h: 28 },
  warehouse: { wall: 0xa98256, roof: 0x5d4a35, style: 'warehouse', h: 30 },
  trading: { wall: 0xbf9466, roof: 0x2d6170, style: 'warehouse', h: 32 },
};

export function tileKind(gx: number, gy: number): 'water' | 'road' | 'plaza' | 'field' | 'dirt' | 'grass' | 'sand' {
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
