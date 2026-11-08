import type { CityArchetype, MarketId } from '@mon/engine';
import type { BuildingSpec } from './art/buildings';
import type { BuildingDef, DecorDef, TileKind } from './layout';

/**
 * Procedural towns for the five cities beyond Nearhaven. Every town shares the
 * same street skeleton (two main roads crossing at a central market square
 * with the exchange and the tavern beside it), so routing, routines and the
 * market square work everywhere; each city then gets its own terrain,
 * landmarks, building palette and props, so the capital, the port, the
 * industrial city, the grain city and the mining town look like themselves.
 */
export interface CityLayout {
  id: MarketId;
  buildings: BuildingDef[];
  decor: DecorDef[];
  plots: Array<{ gx: number; gy: number }>;
  tileKind: (gx: number, gy: number) => TileKind;
  /** Specs for this town's buildings, by id. */
  specs: Record<string, BuildingSpec>;
  props: Array<{ k: string; gx: number; gy: number; scale?: number; flip?: boolean; originY?: number }>;
  /** Bridges where the western road crosses water. */
  bridge: boolean;
}

// Small deterministic RNG so a city always looks the same.
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Style {
  walls: Array<[BuildingSpec['wall'], number]>;
  roofs: Array<[BuildingSpec['roofMat'], number]>;
  /** Terrain beyond the shared skeleton. */
  terrain: (gx: number, gy: number) => TileKind | null;
  /** Extra streets (beyond the two main roads). */
  streets: (gx: number, gy: number) => boolean;
  landmarks: Array<{ id: string; label: string; gx: number; gy: number; w?: number; d?: number; spec: Partial<BuildingSpec> & Pick<BuildingSpec, 'emblem'> }>;
  props: CityLayout['props'];
  exchangeRoof: number;
  exchangeWall: BuildingSpec['wall'];
  exchangeColor: number;
  bridge: boolean;
}

const STYLES: Record<Exclude<CityArchetype, 'merchant'>, Style> = {
  capital: {
    walls: [['ashlar', 0xe8e2d4], ['plaster', 0xe6dfcf], ['ashlar', 0xd8d0bd], ['plaster', 0xdcd5c8]],
    roofs: [['slate', 0x34476e], ['slate', 0x2c3a5a], ['clay', 0x8e3a22]],
    terrain: (gx, gy) => (gx <= 2 ? 'water' : gx === 3 ? 'sand' : gx >= 12 && gx <= 18 && gy >= 12 && gy <= 18 ? 'plaza' : null),
    streets: (gx, gy) => ((gx === 9 || gx === 21) && gy >= 5 && gy <= 25) || ((gy === 9 || gy === 21) && gx >= 5 && gx <= 25),
    landmarks: [
      { id: 'palace', label: 'The Crown Palace', gx: 16, gy: 4, w: 3, d: 3, spec: { h: 58, wall: 'ashlar', wallColor: 0xf0ead8, roof: 'hip', roofMat: 'slate', roofColor: 0x2a3d66, roofH: 30, door: 'grand', windows: 3, emblem: 'scale', tower: true, columns: true, plinth: 10 } },
      { id: 'cathedral', label: 'Cathedral of the Dawn', gx: 4, gy: 11, w: 3, d: 3, spec: { h: 54, wall: 'ashlar', wallColor: 0xdcd3bf, roof: 'gable', roofMat: 'slate', roofColor: 0x3a4a66, roofH: 34, door: 'grand', windows: 3, emblem: 'none', tower: true, plinth: 8 } },
      { id: 'royalbank', label: 'Royal Bank of Kingsreach', gx: 22, gy: 11, spec: { h: 44, wall: 'ashlar', wallColor: 0xe4e1d8, roof: 'hip', roofMat: 'slate', roofColor: 0x34435f, roofH: 20, door: 'grand', windows: 2, emblem: 'coin', columns: true, plinth: 8 } },
      { id: 'guildhall', label: 'Hall of the Merchant Guilds', gx: 22, gy: 18, spec: { h: 40, wall: 'plaster', wallColor: 0xeae2cc, roof: 'hip', roofMat: 'clay', roofColor: 0x8e3a22, roofH: 22, door: 'grand', windows: 3, emblem: 'scale', porch: true, plinth: 6 } },
      { id: 'barracks', label: 'Royal Guard Barracks', gx: 10, gy: 22, spec: { h: 34, wall: 'stone', wallColor: 0xa39d92, roof: 'gable', roofMat: 'slate', roofColor: 0x3d434f, roofH: 22, door: 'double', windows: 2, emblem: 'anvil', plinth: 4 } },
    ],
    props: [{ k: 'banner', gx: 18.6, gy: 7.4 }, { k: 'banner', gx: 15.6, gy: 7.4 }, { k: 'lamp2', gx: 12, gy: 12 }, { k: 'lamp2', gx: 18, gy: 18 }, { k: 'lamp2', gx: 12, gy: 18 }, { k: 'banner', gx: 24.2, gy: 13.3 }, { k: 'weaponrack', gx: 12.4, gy: 24.3, originY: 0.9 }],
    exchangeRoof: 0x2a3d66, exchangeWall: 'ashlar', exchangeColor: 0xf2ecdc, bridge: true,
  },
  port: {
    walls: [['plaster', 0xf1f0ea], ['plaster', 0xd6e4e6], ['timber', 0xeee6d6], ['planks', 0x7a8f98]],
    roofs: [['clay', 0xb4462f], ['slate', 0x2f6f73], ['shingle', 0x3e5f6a]],
    terrain: (gx, gy) => {
      const shore = gx + (29 - gy) * 0.9;
      if (gy >= 20 && shore < 13) return 'water';
      if (gy >= 19 && shore < 15) return 'sand';
      if (gx <= 2) return 'water';
      if (gx === 3) return 'sand';
      return null;
    },
    streets: (gx, gy) => (gy === 19 && gx >= 5 && gx <= 22) || (gx === 21 && gy >= 4 && gy <= 19),
    landmarks: [
      { id: 'lighthouse', label: 'The Aurora Light', gx: 3, gy: 25, w: 2, d: 2, spec: { h: 70, wall: 'plaster', wallColor: 0xf4f1e8, roof: 'hip', roofMat: 'clay', roofColor: 0xb4462f, roofH: 14, door: 'arched', windows: 2, emblem: 'none', tower: true, plinth: 8 } },
      { id: 'harbour', label: "Harbour Master's House", gx: 10, gy: 16, spec: { h: 36, wall: 'plaster', wallColor: 0xe6ecea, roof: 'hip', roofMat: 'slate', roofColor: 0x2f6f73, roofH: 20, door: 'double', windows: 2, emblem: 'ship', porch: true, plinth: 6 } },
      { id: 'docks', label: 'The Aurora Quays', gx: 7, gy: 21, spec: { h: 0, wall: 'planks', wallColor: 0x8a6a46, roof: 'none', roofMat: 'shingle', roofColor: 0x4f6f7f, roofH: 0, door: 'arched', windows: 0, emblem: 'fish' } },
      { id: 'shipwright', label: "Shipwright's Yard", gx: 17, gy: 21, spec: { h: 30, wall: 'planks', wallColor: 0x8f6a44, roof: 'gable', roofMat: 'shingle', roofColor: 0x3e5f6a, roofH: 24, door: 'barn', windows: 1, emblem: 'axe', plinth: 4 } },
      { id: 'customs', label: 'Customs House', gx: 22, gy: 11, spec: { h: 40, wall: 'ashlar', wallColor: 0xdfe3e0, roof: 'hip', roofMat: 'slate', roofColor: 0x2f5560, roofH: 20, door: 'grand', windows: 2, emblem: 'coin', columns: true, plinth: 6 } },
      { id: 'fishmarket', label: 'Fish Market', gx: 5, gy: 16, spec: { h: 24, wall: 'planks', wallColor: 0x9aa9ad, roof: 'gable', roofMat: 'shingle', roofColor: 0x2f6f73, roofH: 18, door: 'double', windows: 1, emblem: 'fish', awning: 0x2f7d8f, plinth: 3 } },
    ],
    props: [{ k: 'boat', gx: 6, gy: 26.5, originY: 0.5 }, { k: 'boat', gx: 3.5, gy: 22, originY: 0.5, flip: true }, { k: 'boat', gx: 10, gy: 26, originY: 0.5 }, { k: 'net', gx: 9.5, gy: 23.3, originY: 0.9 }, { k: 'barrel', gx: 9.2, gy: 22.6 }, { k: 'crate', gx: 9.8, gy: 21.4 }, { k: 'crate', gx: 19.2, gy: 23.4 }, { k: 'logs', gx: 19.6, gy: 22.4 }, { k: 'barrel', gx: 7.2, gy: 18.4 }],
    exchangeRoof: 0x2f6f73, exchangeWall: 'plaster', exchangeColor: 0xf0ede4, bridge: true,
  },
  industrial: {
    walls: [['brick', 0x9c4f32], ['brick', 0x7d3f2a], ['stone', 0x8a8178], ['brick', 0xa85a3c]],
    roofs: [['slate', 0x2f333a], ['slate', 0x3d434f], ['shingle', 0x4a3a2c]],
    terrain: (gx, gy) => (gx <= 1 ? 'water' : gx === 2 ? 'sand' : (gx >= 19 && gy <= 11 && gy >= 2) || (gx <= 11 && gy >= 20) ? 'dirt' : null),
    streets: (gx, gy) => (gx === 21 && gy >= 3 && gy <= 15) || (gy === 22 && gx >= 4 && gx <= 15),
    landmarks: [
      { id: 'ironworks', label: 'Emberforge Ironworks', gx: 22, gy: 4, w: 3, d: 3, spec: { h: 40, wall: 'brick', wallColor: 0x7d3f2a, roof: 'gable', roofMat: 'slate', roofColor: 0x2a2d33, roofH: 22, door: 'double', windows: 2, emblem: 'anvil', forge: true, chimney: 'both', plinth: 6 } },
      { id: 'foundry', label: 'Great Foundry', gx: 18, gy: 8, spec: { h: 36, wall: 'stone', wallColor: 0x6e6862, roof: 'gable', roofMat: 'slate', roofColor: 0x2f333a, roofH: 20, door: 'double', windows: 1, emblem: 'anvil', forge: true, chimney: 'both', plinth: 6 } },
      { id: 'clothmill', label: 'Weavers’ Mill', gx: 6, gy: 22, w: 3, d: 2, spec: { h: 38, wall: 'brick', wallColor: 0xa85a3c, roof: 'gable', roofMat: 'slate', roofColor: 0x3d434f, roofH: 20, door: 'double', windows: 3, emblem: 'cloth', chimney: 'right', plinth: 5 } },
      { id: 'workshall', label: 'Workers’ Hall', gx: 22, gy: 18, spec: { h: 34, wall: 'brick', wallColor: 0x9c4f32, roof: 'hip', roofMat: 'slate', roofColor: 0x2f333a, roofH: 20, door: 'arched', windows: 2, emblem: 'tankard', plinth: 4 } },
      { id: 'canalyard', label: 'Canal Warehouse', gx: 4, gy: 8, spec: { h: 34, wall: 'planks', wallColor: 0x7e6245, roof: 'gable', roofMat: 'shingle', roofColor: 0x4a3a2c, roofH: 22, door: 'barn', windows: 1, emblem: 'crate', plinth: 6 } },
    ],
    props: [{ k: 'orecart', gx: 21.3, gy: 7.8 }, { k: 'crate', gx: 25.5, gy: 7.6 }, { k: 'crate', gx: 25.9, gy: 8.2 }, { k: 'barrel', gx: 20.6, gy: 10.6 }, { k: 'logs', gx: 7.0, gy: 10.6 }, { k: 'cart', gx: 6.0, gy: 11.0 }, { k: 'sack', gx: 9.6, gy: 24.5 }, { k: 'anvil', gx: 19.5, gy: 10.4 }],
    exchangeRoof: 0x3d434f, exchangeWall: 'brick', exchangeColor: 0xa85a3c, bridge: true,
  },
  agricultural: {
    walls: [['timber', 0xefe2c2], ['planks', 0xa0522d], ['plaster', 0xe9d6b8], ['planks', 0x8f5a36]],
    roofs: [['thatch', 0xd2ad66], ['thatch', 0xc9a25e], ['clay', 0xa9472a]],
    terrain: (gx, gy) => ((gx >= 19 && gy <= 11) || (gx <= 11 && gy <= 11 && gx >= 4) || (gx >= 19 && gy >= 19) ? 'field' : gx <= 2 ? 'water' : gx === 3 ? 'sand' : null),
    streets: () => false,
    landmarks: [
      { id: 'granary', label: 'The Great Granary', gx: 17, gy: 18, w: 2, d: 3, spec: { h: 46, wall: 'planks', wallColor: 0x9a5a34, roof: 'gable', roofMat: 'thatch', roofColor: 0xd2ad66, roofH: 30, door: 'barn', windows: 1, emblem: 'wheat', dovecote: true, plinth: 6 } },
      { id: 'windmill', label: 'Valley Windmill', gx: 22, gy: 5, spec: { h: 50, wall: 'plaster', wallColor: 0xe9dcc2, roof: 'hip', roofMat: 'thatch', roofColor: 0xc9a25e, roofH: 18, door: 'arched', windows: 1, emblem: 'wheat', tower: true, plinth: 5 } },
      { id: 'windmill2', label: 'Hilltop Windmill', gx: 7, gy: 6, spec: { h: 46, wall: 'plaster', wallColor: 0xece2cc, roof: 'hip', roofMat: 'thatch', roofColor: 0xd2ad66, roofH: 16, door: 'arched', windows: 1, emblem: 'wheat', tower: true, plinth: 5 } },
      { id: 'barn', label: 'Long Barn', gx: 22, gy: 22, w: 3, d: 2, spec: { h: 30, wall: 'planks', wallColor: 0xa0522d, roof: 'gable', roofMat: 'thatch', roofColor: 0xc99a4c, roofH: 26, door: 'barn', windows: 1, emblem: 'wheat', plinth: 4 } },
      { id: 'brewhouse', label: 'Vale Brewhouse', gx: 10, gy: 20, spec: { h: 32, wall: 'brick', wallColor: 0xa34f30, roof: 'gable', roofMat: 'clay', roofColor: 0x8e3a22, roofH: 24, door: 'double', windows: 2, emblem: 'tankard', chimney: 'both', plinth: 4 } },
    ],
    props: [{ k: 'haystack', gx: 24.5, gy: 8.6 }, { k: 'haystack', gx: 25.6, gy: 9.4, scale: 0.85 }, { k: 'scarecrow', gx: 21, gy: 9.5, originY: 0.95 }, { k: 'scarecrow', gx: 9, gy: 9, originY: 0.95 }, { k: 'haystack', gx: 5.5, gy: 9.5 }, { k: 'cart', gx: 20.5, gy: 21.2 }, { k: 'sack', gx: 16.3, gy: 21.4 }, { k: 'sack', gx: 16.6, gy: 21.8 }, { k: 'well', gx: 19.5, gy: 16.5, originY: 0.88 }, { k: 'haystack', gx: 26, gy: 25 }],
    exchangeRoof: 0xb58a42, exchangeWall: 'timber', exchangeColor: 0xefe2c2, bridge: true,
  },
  mining: {
    walls: [['stone', 0x8c857c], ['stone', 0x7a746c], ['planks', 0x6e5a44], ['stone', 0x9a948a]],
    roofs: [['slate', 0x454a56], ['slate', 0x3b3f47], ['shingle', 0x4a4038]],
    terrain: (gx, gy) => ((gx <= 11 && gy <= 11) || (gx >= 22 && gy <= 8) ? 'dirt' : gx >= 25 && gy >= 22 ? 'dirt' : null),
    streets: (gx, gy) => gx === 8 && gy >= 11 && gy <= 15,
    landmarks: [
      { id: 'mine', label: 'Deepcrag Main Shaft', gx: 5, gy: 4, spec: { h: 0, wall: 'stone', wallColor: 0x7d776f, roof: 'none', roofMat: 'slate', roofColor: 0x454a56, roofH: 0, door: 'arched', windows: 0, emblem: 'pick' } },
      { id: 'quarry', label: 'Greyface Quarry', gx: 23, gy: 4, spec: { h: 0, wall: 'stone', wallColor: 0x9a948a, roof: 'none', roofMat: 'slate', roofColor: 0x454a56, roofH: 0, door: 'arched', windows: 0, emblem: 'pick' } },
      { id: 'smelter', label: 'Crag Smelter', gx: 9, gy: 7, spec: { h: 34, wall: 'stone', wallColor: 0x6e6862, roof: 'gable', roofMat: 'slate', roofColor: 0x2f333a, roofH: 18, door: 'double', windows: 1, emblem: 'anvil', forge: true, chimney: 'both', plinth: 6 } },
      { id: 'assay', label: 'Assay Office', gx: 20, gy: 11, spec: { h: 38, wall: 'ashlar', wallColor: 0xb3aa98, roof: 'hip', roofMat: 'slate', roofColor: 0x3b3f47, roofH: 18, door: 'grand', windows: 2, emblem: 'coin', columns: true, plinth: 6 } },
      { id: 'lodge', label: 'Miners’ Lodge', gx: 21, gy: 19, w: 3, d: 2, spec: { h: 32, wall: 'planks', wallColor: 0x6e5a44, roof: 'gable', roofMat: 'shingle', roofColor: 0x4a4038, roofH: 24, door: 'arched', windows: 2, emblem: 'tankard', chimney: 'both', plinth: 4 } },
    ],
    props: [{ k: 'orecart', gx: 7.4, gy: 6.2 }, { k: 'orecart', gx: 6.4, gy: 7.6, flip: true }, { k: 'rock', gx: 3.5, gy: 9 }, { k: 'rock', gx: 10.5, gy: 3.2 }, { k: 'rock', gx: 26, gy: 7 }, { k: 'crate', gx: 25.3, gy: 6.6 }, { k: 'logs', gx: 12, gy: 9.5 }, { k: 'rock', gx: 27, gy: 25 }, { k: 'rock', gx: 26.2, gy: 23.4, scale: 1.3 }],
    exchangeRoof: 0x3b3f47, exchangeWall: 'stone', exchangeColor: 0x9a948a, bridge: false,
  },
};

const ARCH: Record<Exclude<MarketId, 'nearhaven'>, Exclude<CityArchetype, 'merchant'>> = { kingsreach: 'capital', aurora: 'port', emberforge: 'industrial', goldenvale: 'agricultural', deepcrag: 'mining' };

export function generateCity(id: Exclude<MarketId, 'nearhaven'>, exchangeName: string, seed: number): CityLayout {
  const st = STYLES[ARCH[id]];
  const r = rng(seed);
  const tileKind = (gx: number, gy: number): TileKind => {
    const t = st.terrain(gx, gy);
    if (t === 'water' || t === 'sand') return t;
    if (gx >= 13 && gx <= 17 && gy >= 13 && gy <= 17) return 'plaza';
    if (t === 'plaza') return 'plaza';
    if (gy === 15 || gx === 15) return 'road';
    if (st.streets(gx, gy)) return 'road';
    return t ?? 'grass';
  };
  const taken = new Set<string>();
  const key = (x: number, y: number) => `${x},${y}`;
  const free = (gx: number, gy: number, w: number, d: number, allowField = false) => {
    for (let x = gx; x < gx + w; x++) for (let y = gy; y < gy + d; y++) {
      if (x < 1 || y < 1 || x > 28 || y > 28 || taken.has(key(x, y))) return false;
      const t = tileKind(x, y);
      if (t === 'road' || t === 'plaza' || t === 'water' || t === 'sand' || (t === 'field' && !allowField)) return false;
    }
    return true;
  };
  const take = (gx: number, gy: number, w: number, d: number) => { for (let x = gx - 0; x < gx + w; x++) for (let y = gy; y < gy + d; y++) taken.add(key(x, y)); };

  const specs: Record<string, BuildingSpec> = {};
  const buildings: BuildingDef[] = [];
  // The exchange on the square (same place in every town).
  specs.exchange = { w: 3, d: 3, h: 50, wall: st.exchangeWall, wallColor: st.exchangeColor, plinth: 8, roof: 'hip', roofMat: 'slate', roofColor: st.exchangeRoof, roofH: 30, door: 'grand', windows: 3, emblem: 'scale', tower: true, columns: true, seed: 1 };
  buildings.push({ id: 'exchange', label: exchangeName, gx: 14, gy: 14, w: 3, d: 3, h: 50, wall: st.exchangeColor, roof: st.exchangeRoof, style: 'hall', door: { gx: 15, gy: 17 } });
  take(14, 14, 3, 3);
  take(11, 16, 2, 2); // tavern
  for (const [i, lm] of st.landmarks.entries()) {
    const w = lm.w ?? 2, d = lm.d ?? 2;
    take(lm.gx, lm.gy, w, d);
    specs[lm.id] = { w, d, h: 32, wall: 'stone', wallColor: 0x9a948a, roof: 'gable', roofMat: 'slate', roofColor: 0x454a56, roofH: 22, door: 'arched', windows: 1, seed: 40 + i, ...lm.spec } as BuildingSpec;
    buildings.push({ id: lm.id, label: lm.label, gx: lm.gx, gy: lm.gy, w, d, h: specs[lm.id].h, wall: specs[lm.id].wallColor, roof: specs[lm.id].roofColor, style: 'house', door: { gx: lm.gx + Math.floor(w / 2), gy: lm.gy + d } });
  }
  // Candidate 2×2 blocks, nearest the square first: player plots, then houses.
  const blocks: Array<{ gx: number; gy: number; dist: number }> = [];
  for (let gx = 2; gx <= 26; gx += 3) for (let gy = 2; gy <= 26; gy += 3) {
    for (const [ox, oy] of [[0, 0], [1, 0], [0, 1], [-1, 0], [0, -1]]) {
      const x = gx + ox, y = gy + oy;
      if (free(x, y, 2, 3)) { blocks.push({ gx: x, gy: y, dist: Math.hypot(x + 1 - 15.5, y + 1 - 15.5) }); take(x, y, 2, 2); break; }
    }
  }
  blocks.sort((a, b) => a.dist - b.dist);
  const plots = blocks.slice(0, 22).map((b) => ({ gx: b.gx, gy: b.gy }));
  const decor: DecorDef[] = [{ id: 'tavern', label: 'The Travellers’ Rest — tavern & inn', gx: 11, gy: 16, w: 2, d: 2 }];
  const houseSpots: Array<{ gx: number; gy: number }> = [];
  for (const b of blocks.slice(22)) houseSpots.push({ gx: b.gx, gy: b.gy }, { gx: b.gx + 1, gy: b.gy });
  // Plus single cottages wherever a lone tile is free beside a street.
  for (let gx = 2; gx <= 27 && houseSpots.length < 40; gx++) for (let gy = 2; gy <= 27 && houseSpots.length < 40; gy++) {
    if (r() < 0.12 && free(gx, gy, 1, 2)) { const near = [tileKind(gx + 1, gy), tileKind(gx, gy + 1), tileKind(gx, gy + 2)].includes('road'); if (near) { houseSpots.push({ gx, gy }); take(gx, gy, 1, 1); } }
  }
  houseSpots.slice(0, 34).forEach((h, i) => {
    const [wall, wc] = st.walls[Math.floor(r() * st.walls.length)];
    const [rm, rc] = st.roofs[Math.floor(r() * st.roofs.length)];
    const hid = `house${i}`;
    specs[hid] = { w: 1, d: 1, h: (ARCH[id] === 'capital' ? 28 : 22) + Math.floor(r() * 8), wall, wallColor: wc, plinth: 3, roof: r() > 0.35 ? 'gable' : 'hip', roofMat: rm, roofColor: rc, roofH: 18 + Math.floor(r() * 6), chimney: r() > 0.4 ? 'right' : undefined, door: 'arched', windows: 1, emblem: 'none', seed: 300 + i + seed % 97 };
    decor.push({ id: hid, label: 'Town house', gx: h.gx, gy: h.gy, w: 1, d: 1 });
  });
  return { id, buildings, decor, plots, tileKind, specs, props: st.props, bridge: st.bridge };
}
