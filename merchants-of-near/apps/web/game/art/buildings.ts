import type * as Phaser from 'phaser';
import { TILE_H, TILE_W } from '../layout';
import { PAL, mix, rng, shade, type Pt } from './palette';
import { paintRoof, paintWall, type RoofMaterial, type WallMaterial } from './materials';

export type Emblem = 'coin' | 'wheat' | 'bread' | 'anvil' | 'scale' | 'pick' | 'fish' | 'cloth' | 'axe' | 'tankard' | 'crate' | 'ship' | 'none';

export interface BuildingSpec {
  w: number;
  d: number;
  /** Wall height in px. */
  h: number;
  wall: WallMaterial;
  wallColor: number;
  /** Stone plinth height (px). */
  plinth?: number;
  roof: 'gable' | 'hip' | 'none';
  roofMat: RoofMaterial;
  roofColor: number;
  roofH: number;
  chimney?: 'left' | 'right' | 'both';
  door: 'arched' | 'barn' | 'double' | 'grand';
  windows: number;
  emblem: Emblem;
  tower?: boolean;
  columns?: boolean;
  awning?: number; // stripe colour
  forge?: boolean;
  porch?: boolean;
  dovecote?: boolean;
  seed: number;
}

export interface BuildingArt {
  key: string;
  originX: number;
  originY: number;
  width: number;
  height: number;
  windows: Pt[];
  chimneys: Pt[];
  forge?: Pt;
  /** Top of the roof, for floating indicators. */
  crown: Pt;
}

/** Architectural spec for every building in town. */
export const SPECS: Record<string, BuildingSpec> = {
  exchange: { w: 3, d: 3, h: 50, wall: 'ashlar', wallColor: PAL.sandstone, plinth: 8, roof: 'hip', roofMat: 'clay', roofColor: PAL.clay, roofH: 30, door: 'grand', windows: 3, emblem: 'scale', tower: true, columns: true, seed: 1 },
  farm: { w: 2, d: 2, h: 28, wall: 'planks', wallColor: 0xa0522d, plinth: 4, roof: 'gable', roofMat: 'thatch', roofColor: PAL.thatch, roofH: 28, door: 'barn', windows: 1, emblem: 'wheat', dovecote: true, seed: 2 },
  bakery: { w: 2, d: 2, h: 32, wall: 'brick', wallColor: 0xb8653f, plinth: 4, roof: 'gable', roofMat: 'clay', roofColor: 0xa9472a, roofH: 26, chimney: 'right', door: 'arched', windows: 2, emblem: 'bread', awning: 0xc9472f, seed: 3 },
  bakery2: { w: 2, d: 2, h: 30, wall: 'timber', wallColor: 0xe9dcb8, plinth: 5, roof: 'gable', roofMat: 'shingle', roofColor: 0x6d4a2a, roofH: 24, chimney: 'left', door: 'arched', windows: 2, emblem: 'bread', awning: 0xd9a84a, seed: 4 },
  smithy: { w: 2, d: 2, h: 28, wall: 'stone', wallColor: 0x8c857c, plinth: 0, roof: 'gable', roofMat: 'slate', roofColor: 0x3d434f, roofH: 22, chimney: 'right', door: 'double', windows: 1, emblem: 'anvil', forge: true, seed: 5 },
  trading_post: { w: 2, d: 2, h: 32, wall: 'planks', wallColor: 0x9b6a3e, plinth: 6, roof: 'gable', roofMat: 'shingle', roofColor: 0x2f5e6e, roofH: 24, door: 'barn', windows: 2, emblem: 'ship', porch: true, seed: 6 },
  bank: { w: 2, d: 2, h: 42, wall: 'ashlar', wallColor: 0xd8d6cf, plinth: 8, roof: 'hip', roofMat: 'slate', roofColor: 0x34435f, roofH: 20, door: 'grand', windows: 2, emblem: 'coin', columns: true, seed: 7 },
  mine: { w: 2, d: 2, h: 0, wall: 'stone', wallColor: PAL.stone, roof: 'none', roofMat: 'slate', roofColor: PAL.slate, roofH: 0, door: 'arched', windows: 0, emblem: 'pick', seed: 8 },
  docks: { w: 2, d: 2, h: 0, wall: 'planks', wallColor: 0x8a6a46, roof: 'none', roofMat: 'shingle', roofColor: 0x4f6f7f, roofH: 0, door: 'arched', windows: 0, emblem: 'fish', seed: 9 },
  loom: { w: 2, d: 2, h: 32, wall: 'timber', wallColor: 0xe6d7dc, plinth: 5, roof: 'gable', roofMat: 'clay', roofColor: 0x7d4f7a, roofH: 24, door: 'arched', windows: 2, emblem: 'cloth', seed: 10 },
  lumberyard: { w: 2, d: 2, h: 26, wall: 'planks', wallColor: 0x8a6239, plinth: 3, roof: 'gable', roofMat: 'shingle', roofColor: 0x4d6b3a, roofH: 22, door: 'barn', windows: 1, emblem: 'axe', seed: 11 },
  tavern: { w: 2, d: 2, h: 36, wall: 'timber', wallColor: 0xefe2c2, plinth: 6, roof: 'gable', roofMat: 'clay', roofColor: 0x9b3d25, roofH: 26, chimney: 'both', door: 'arched', windows: 2, emblem: 'tankard', awning: 0x2f7d55, seed: 12 },
  // Player business styles.
  'p-farm': { w: 2, d: 2, h: 26, wall: 'planks', wallColor: 0xb0603a, plinth: 4, roof: 'gable', roofMat: 'thatch', roofColor: 0xd2ad66, roofH: 24, door: 'barn', windows: 1, emblem: 'wheat', seed: 21 },
  'p-bakery': { w: 2, d: 2, h: 30, wall: 'brick', wallColor: 0xc06a42, plinth: 4, roof: 'gable', roofMat: 'clay', roofColor: 0xb4562f, roofH: 24, chimney: 'right', door: 'arched', windows: 2, emblem: 'bread', awning: 0xd9a84a, seed: 22 },
  'p-blacksmith': { w: 2, d: 2, h: 28, wall: 'stone', wallColor: 0x958d83, roof: 'gable', roofMat: 'slate', roofColor: 0x454a56, roofH: 22, chimney: 'right', door: 'double', windows: 1, emblem: 'anvil', forge: true, seed: 23 },
  'p-textile': { w: 2, d: 2, h: 30, wall: 'timber', wallColor: 0xeadde0, plinth: 5, roof: 'gable', roofMat: 'clay', roofColor: 0x8b5786, roofH: 24, door: 'arched', windows: 2, emblem: 'cloth', seed: 24 },
  'p-warehouse': { w: 2, d: 2, h: 34, wall: 'planks', wallColor: 0x96714a, plinth: 6, roof: 'gable', roofMat: 'shingle', roofColor: 0x5d4a35, roofH: 22, door: 'barn', windows: 1, emblem: 'crate', seed: 25 },
  'p-trading': { w: 2, d: 2, h: 34, wall: 'brick', wallColor: 0xa85a3c, plinth: 6, roof: 'hip', roofMat: 'slate', roofColor: 0x2d6170, roofH: 22, door: 'double', windows: 2, emblem: 'ship', porch: true, seed: 26 },
};

/** Small town houses: varied colours and forms from one generator. */
export function houseSpec(i: number): BuildingSpec {
  const r = rng(100 + i);
  const walls: WallMaterial[] = ['timber', 'plaster', 'brick', 'timber', 'stone'];
  const wallCols = [0xefe2c2, 0xe7cfa6, 0xb5683f, 0xdfe2d6, 0xa49b8f, 0xe9d6b8];
  const roofs: Array<[RoofMaterial, number]> = [['clay', 0xa9472a], ['thatch', 0xc9a45c], ['slate', 0x4a5566], ['clay', 0x8e3a22], ['shingle', 0x5f4630]];
  const [rm, rc] = roofs[Math.floor(r() * roofs.length)];
  return {
    w: 1, d: 1, h: 22 + Math.floor(r() * 8), wall: walls[i % walls.length], wallColor: wallCols[Math.floor(r() * wallCols.length)], plinth: 3,
    roof: r() > 0.3 ? 'gable' : 'hip', roofMat: rm, roofColor: rc, roofH: 18 + Math.floor(r() * 6), chimney: r() > 0.4 ? 'right' : undefined,
    door: 'arched', windows: 1, emblem: 'none', seed: 200 + i,
  };
}

// ------------------------------------------------------------------ drawing

function emblemShape(g: Phaser.GameObjects.Graphics, cx: number, cy: number, e: Emblem) {
  const gold = PAL.goldBright;
  g.fillStyle(gold, 1);
  g.lineStyle(1.2, gold, 1);
  switch (e) {
    case 'coin': g.fillCircle(cx, cy, 3.4); g.fillStyle(PAL.oakDark, 1); g.fillRect(cx - 0.6, cy - 2, 1.2, 4); break;
    case 'wheat': g.lineBetween(cx, cy + 4, cx, cy - 3); for (let i = 0; i < 3; i++) { g.fillEllipse(cx - 1.4, cy - 2 + i * 2, 2.4, 1.4); g.fillEllipse(cx + 1.4, cy - 2 + i * 2, 2.4, 1.4); } break;
    case 'bread': g.fillEllipse(cx, cy + 0.5, 8, 4.6); g.fillStyle(PAL.oakDark, 0.6); g.fillRect(cx - 2, cy - 1, 1, 2); g.fillRect(cx + 1, cy - 1, 1, 2); break;
    case 'anvil': g.fillRect(cx - 4, cy - 2, 8, 2.5); g.fillRect(cx - 1.5, cy, 3, 2.4); g.fillRect(cx - 3, cy + 2.2, 6, 1.6); break;
    case 'scale': g.lineBetween(cx, cy - 4, cx, cy + 3); g.lineBetween(cx - 4, cy - 2.5, cx + 4, cy - 2.5); g.fillTriangle(cx - 5, cy + 1, cx - 3, cy + 1, cx - 4, cy - 2); g.fillTriangle(cx + 3, cy + 1, cx + 5, cy + 1, cx + 4, cy - 2); g.fillRect(cx - 2, cy + 3, 4, 1.2); break;
    case 'pick': g.lineBetween(cx - 3, cy + 4, cx + 2, cy - 2); g.lineStyle(1.8, gold, 1); g.beginPath(); g.arc(cx + 1, cy - 1, 4, Math.PI * 1.05, Math.PI * 1.75); g.strokePath(); break;
    case 'fish': g.fillEllipse(cx - 0.5, cy, 7, 3.6); g.fillTriangle(cx + 2.5, cy, cx + 5, cy - 2.4, cx + 5, cy + 2.4); break;
    case 'cloth': g.fillRect(cx - 4, cy - 3, 6, 6); g.fillStyle(shade(gold, 0.7), 1); g.fillRect(cx + 2, cy - 3, 2, 6); break;
    case 'axe': g.lineBetween(cx - 2, cy + 4, cx + 2, cy - 4); g.fillTriangle(cx + 1, cy - 3, cx + 5, cy - 4, cx + 4, cy); break;
    case 'tankard': g.fillRect(cx - 3, cy - 3, 5, 7); g.lineStyle(1.4, gold, 1); g.strokeCircle(cx + 3, cy, 2); g.fillStyle(0xffffff, 0.9); g.fillEllipse(cx - 0.5, cy - 3.4, 6, 2.2); break;
    case 'crate': g.fillRect(cx - 4, cy - 3, 8, 6); g.lineStyle(1, PAL.oakDark, 1); g.lineBetween(cx - 4, cy - 3, cx + 4, cy + 3); g.lineBetween(cx + 4, cy - 3, cx - 4, cy + 3); break;
    case 'ship': g.fillTriangle(cx - 1, cy - 5, cx - 1, cy + 1, cx + 4, cy + 1); g.fillRect(cx - 5, cy + 1.5, 10, 2); break;
    default: break;
  }
}

/** Render a building into a texture and return anchors for lights, smoke and effects. */
export function drawBuilding(scene: Phaser.Scene, key: string, s: BuildingSpec): BuildingArt {
  const hw = TILE_W / 2, hh = TILE_H / 2;
  const pad = 16;
  const towerH = s.tower ? 46 : 0;
  const top = s.h + s.roofH + (s.chimney ? 16 : 0) + towerH + pad + (s.roof === 'none' ? 34 : 0);
  const width = (s.w + s.d) * hw + pad * 2;
  const height = (s.w + s.d) * hh + top + pad;
  const ox = s.d * hw + pad, oy = top;
  const P = (gx: number, gy: number, z = 0): Pt => ({ x: ox + (gx - gy) * hw, y: oy + (gx + gy) * hh - z });
  const g = scene.add.graphics();
  const r = rng(s.seed);
  const windows: Pt[] = [];
  const chimneys: Pt[] = [];
  let forge: Pt | undefined;
  const { w, d, h } = s;

  // Soft contact shadow cast to the lower right (sun from upper left).
  for (let i = 4; i >= 0; i--) {
    g.fillStyle(0x000000, 0.06);
    const e = i * 0.12;
    g.fillPoints([P(-e * 0.3, -e * 0.3), P(w + e + 0.3, -e * 0.4), P(w + e + 0.35, d + e + 0.25), P(-e * 0.4, d + e + 0.3)], true);
  }

  if (s.roof === 'none') {
    drawSpecial(g, s, P, windows, r);
  } else {
    const plinth = s.plinth ?? 0;
    const leftQ: [Pt, Pt, Pt, Pt] = [P(0, d, h), P(w, d, h), P(w, d, plinth), P(0, d, plinth)];
    const rightQ: [Pt, Pt, Pt, Pt] = [P(w, d, h), P(w, 0, h), P(w, 0, plinth), P(w, d, plinth)];
    if (plinth) {
      paintWall(g, [P(0, d, plinth), P(w, d, plinth), P(w, d, 0), P(0, d, 0)], 'stone', PAL.stone, 0.92, w, plinth * 2, s.seed + 7);
      paintWall(g, [P(w, d, plinth), P(w, 0, plinth), P(w, 0, 0), P(w, d, 0)], 'stone', PAL.stone, 0.7, d, plinth * 2, s.seed + 8);
    }
    paintWall(g, leftQ, s.wall, s.wallColor, 0.97, w, h, s.seed);
    paintWall(g, rightQ, s.wall, s.wallColor, 0.74, d, h, s.seed + 1);
    // Corner quoins catch the light.
    g.lineStyle(2, mix(s.wallColor, 0xffffff, 0.25), 0.6);
    const c1 = P(w, d, plinth), c2 = P(w, d, h);
    g.lineBetween(c1.x, c1.y, c2.x, c2.y);

    if (s.columns) {
      for (let i = 0; i <= w * 2; i++) {
        const a = P(i / 2, d + 0.12, plinth), b = P(i / 2, d + 0.12, h - 2);
        g.fillStyle(0x000000, 0.18);
        g.fillRect(a.x - 1, b.y, 5, a.y - b.y);
        g.fillStyle(0xf3efe5, 1);
        g.fillRect(a.x - 2.5, b.y, 5, a.y - b.y);
        g.fillStyle(0xd9d3c4, 1);
        g.fillRect(a.x + 1, b.y, 1.5, a.y - b.y);
        g.fillStyle(0xf8f5ec, 1);
        g.fillRect(a.x - 3.5, b.y - 2, 7, 3);
        g.fillRect(a.x - 3.5, a.y - 2, 7, 3);
      }
    }

    // Windows: framed, shuttered, with a sill. Front-left face then right face.
    const win = (u: number, onRight: boolean) => {
      const zc = plinth + (h - plinth) * 0.56;
      const c = onRight ? P(w, d * (1 - u), zc) : P(w * u, d, zc);
      const k = onRight ? -0.5 : 0.5; // isometric slope of the face
      const ww = 4.2, wh = 7;
      const quad = (dx1: number, dy1: number, dx2: number, dy2: number) => [
        { x: c.x - dx1, y: c.y - dx1 * k - dy1 }, { x: c.x + dx2, y: c.y + dx2 * k - dy1 },
        { x: c.x + dx2, y: c.y + dx2 * k + dy2 }, { x: c.x - dx1, y: c.y - dx1 * k + dy2 },
      ];
      g.fillStyle(PAL.oakDark, 1);
      g.fillPoints(quad(ww + 1.4, wh / 2 + 1.4, ww + 1.4, wh / 2 + 1.4), true);
      g.fillStyle(0x1e2733, 1);
      g.fillPoints(quad(ww, wh / 2, ww, wh / 2), true);
      g.fillStyle(0xffd88a, 0.28);
      g.fillPoints(quad(ww - 1, wh / 2 - 1, ww - 1, wh / 2 - 1), true);
      g.lineStyle(1, PAL.oakDark, 1);
      g.lineBetween(c.x, c.y - wh / 2, c.x, c.y + wh / 2);
      g.lineBetween(c.x - ww, c.y - ww * k, c.x + ww, c.y + ww * k);
      // Shutters.
      if (!s.columns) {
        const sh = s.wall === 'brick' ? 0x2f5e3f : s.wall === 'stone' ? 0x5a3e2a : 0x2f6070;
        g.fillStyle(shade(sh, onRight ? 0.75 : 1), 1);
        g.fillPoints([{ x: c.x - ww - 4.5, y: c.y - (ww + 4.5) * k - wh / 2 - 1 }, { x: c.x - ww - 1.4, y: c.y - (ww + 1.4) * k - wh / 2 - 1 }, { x: c.x - ww - 1.4, y: c.y - (ww + 1.4) * k + wh / 2 + 1 }, { x: c.x - ww - 4.5, y: c.y - (ww + 4.5) * k + wh / 2 + 1 }], true);
        g.fillPoints([{ x: c.x + ww + 1.4, y: c.y + (ww + 1.4) * k - wh / 2 - 1 }, { x: c.x + ww + 4.5, y: c.y + (ww + 4.5) * k - wh / 2 - 1 }, { x: c.x + ww + 4.5, y: c.y + (ww + 4.5) * k + wh / 2 + 1 }, { x: c.x + ww + 1.4, y: c.y + (ww + 1.4) * k + wh / 2 + 1 }], true);
      }
      g.fillStyle(PAL.stoneLight, 1);
      g.fillPoints(quad(ww + 2, -wh / 2 - 1.4, ww + 2, wh / 2 + 3), true);
      windows.push({ x: c.x, y: c.y });
    };
    const nL = Math.min(s.windows, w + 1);
    if (nL >= 1) win(0.78, false);
    if (nL >= 2 && w > 1) win(0.16, false);
    if (s.windows >= 3) win(0.5, false);
    if (!s.forge) win(0.3, true);
    if (s.windows >= 2 && d > 1 && !s.forge) win(0.74, true);

    // Door.
    const dc = P(w * 0.45, d, plinth);
    const dw = s.door === 'barn' || s.door === 'double' || s.door === 'grand' ? 10 : 6;
    const dh = s.door === 'grand' ? 22 : s.door === 'barn' ? 18 : 14;
    const k = 0.5;
    g.fillStyle(PAL.stoneLight, 1);
    g.fillPoints([{ x: dc.x - dw - 3, y: dc.y - (dw + 3) * k + 1 }, { x: dc.x + dw + 3, y: dc.y + (dw + 3) * k + 1 }, { x: dc.x + dw + 3, y: dc.y + (dw + 3) * k + 4 }, { x: dc.x - dw - 3, y: dc.y - (dw + 3) * k + 4 }], true);
    g.fillStyle(PAL.oakDark, 1);
    g.fillPoints([{ x: dc.x - dw - 1.5, y: dc.y - (dw + 1.5) * k }, { x: dc.x + dw + 1.5, y: dc.y + (dw + 1.5) * k }, { x: dc.x + dw + 1.5, y: dc.y + (dw + 1.5) * k - dh - 1.5 }, { x: dc.x - dw - 1.5, y: dc.y - (dw + 1.5) * k - dh - 1.5 }], true);
    g.fillStyle(s.door === 'grand' ? 0x4a2c18 : 0x6b4325, 1);
    g.fillPoints([{ x: dc.x - dw, y: dc.y - dw * k }, { x: dc.x + dw, y: dc.y + dw * k }, { x: dc.x + dw, y: dc.y + dw * k - dh }, { x: dc.x - dw, y: dc.y - dw * k - dh }], true);
    g.lineStyle(1, 0x3a2414, 0.9);
    for (let i = -dw + 2.5; i < dw; i += 2.5) g.lineBetween(dc.x + i, dc.y + i * k, dc.x + i, dc.y + i * k - dh);
    if (s.door === 'barn') {
      g.lineStyle(1.6, PAL.plaster, 0.85);
      g.lineBetween(dc.x - dw, dc.y - dw * k - dh, dc.x + dw, dc.y + dw * k);
      g.lineBetween(dc.x + dw, dc.y + dw * k - dh, dc.x - dw, dc.y - dw * k);
    }
    g.fillStyle(PAL.goldBright, 1);
    g.fillCircle(dc.x + dw * 0.55, dc.y + dw * 0.55 * k - dh * 0.45, 1);

    // Awning over the door.
    if (s.awning) {
      const a1 = P(w * 0.18, d + 0.3, plinth + dh + 8), a2 = P(w * 0.74, d + 0.3, plinth + dh + 8);
      const b1 = P(w * 0.18, d, plinth + dh + 14), b2 = P(w * 0.74, d, plinth + dh + 14);
      const stripes = 7;
      for (let i = 0; i < stripes; i++) {
        const t1 = i / stripes, t2 = (i + 1) / stripes;
        const L = (p: Pt, q: Pt, t: number) => ({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
        g.fillStyle(i % 2 ? PAL.white : s.awning, 1);
        g.fillPoints([L(b1, b2, t1), L(b1, b2, t2), L(a1, a2, t2), L(a1, a2, t1)], true);
      }
      g.fillStyle(0x000000, 0.18);
      g.fillPoints([a1, a2, { x: a2.x, y: a2.y + 3 }, { x: a1.x, y: a1.y + 3 }], true);
    }

    // Forge: an open, glowing arch on the right face.
    if (s.forge) {
      const fc = P(w, d * 0.45, plinth);
      g.fillStyle(PAL.stoneDark, 1);
      g.fillPoints([{ x: fc.x - 9, y: fc.y + 4.5 }, { x: fc.x + 9, y: fc.y - 4.5 }, { x: fc.x + 9, y: fc.y - 22 }, { x: fc.x - 9, y: fc.y - 13 }], true);
      g.fillStyle(0x1a0e08, 1);
      g.fillPoints([{ x: fc.x - 7, y: fc.y + 3.5 }, { x: fc.x + 7, y: fc.y - 3.5 }, { x: fc.x + 7, y: fc.y - 18 }, { x: fc.x - 7, y: fc.y - 11 }], true);
      g.fillStyle(0xff7a2a, 0.9);
      g.fillEllipse(fc.x, fc.y - 3, 10, 5);
      g.fillStyle(0xffd27a, 0.9);
      g.fillEllipse(fc.x, fc.y - 3.5, 5, 2.5);
      forge = { x: fc.x, y: fc.y - 5 };
    }

    // Roof.
    const e = 0.2;
    const rh = s.roofH;
    if (s.roof === 'gable') {
      const r1 = P(-e, d / 2, h + rh), r2 = P(w + e, d / 2, h + rh);
      paintRoof(g, [P(-e, -e, h), P(w + e, -e, h), r2, r1], s.roofMat, s.roofColor, 0.72, w, s.seed + 3);
      // Gable end wall (right face triangle).
      g.fillStyle(shade(s.wallColor, 0.7), 1);
      g.fillPoints([P(w, d, h), P(w, 0, h), P(w, d / 2, h + rh - 2)], true);
      if (s.wall === 'timber') {
        g.lineStyle(2, shade(PAL.oakDark, 0.75), 1);
        const m = P(w, d / 2, h), t = P(w, d / 2, h + rh - 3);
        g.lineBetween(m.x, m.y, t.x, t.y);
      }
      paintRoof(g, [P(-e, d + e, h), P(w + e, d + e, h), r2, r1], s.roofMat, s.roofColor, 1, w, s.seed + 4);
      // Bargeboard and ridge.
      g.lineStyle(2.4, shade(PAL.oakDark, 0.9), 1);
      const b1 = P(w + e, d + e, h), b2 = P(w + e, -e, h);
      g.lineBetween(b1.x, b1.y, r2.x, r2.y);
      g.lineBetween(b2.x, b2.y, r2.x, r2.y);
      g.lineStyle(3, mix(s.roofColor, 0xffffff, 0.2), 1);
      g.lineBetween(r1.x, r1.y, r2.x, r2.y);
    } else if (s.roof === 'hip') {
      const inset = Math.min(w, d) / 2;
      const r1 = P(inset, d / 2, h + rh), r2 = P(Math.max(inset, w - inset), d / 2, h + rh);
      paintRoof(g, [P(-e, -e, h), P(w + e, -e, h), r2, r1], s.roofMat, s.roofColor, 0.72, w, s.seed + 3);
      paintRoof(g, [P(w + e, d + e, h), P(w + e, -e, h), r2, r2], s.roofMat, s.roofColor, 0.8, d, s.seed + 5);
      paintRoof(g, [P(-e, d + e, h), P(w + e, d + e, h), r2, r1], s.roofMat, s.roofColor, 1, w, s.seed + 4);
      g.lineStyle(2, mix(s.roofColor, 0xffffff, 0.22), 1);
      const c = P(w + e, d + e, h);
      g.lineBetween(c.x, c.y, r2.x, r2.y);
      g.lineBetween(r1.x, r1.y, r2.x, r2.y);
    }

    // Signboard on a wrought-iron bracket by the door.
    if (s.emblem !== 'none') {
      const sp = P(w * 0.08, d + 0.08, plinth + h * 0.62);
      g.lineStyle(1.4, 0x2a2a2e, 1);
      g.lineBetween(sp.x, sp.y, sp.x - 12, sp.y + 6 * -0.5 + 2);
      const bx = sp.x - 10, by = sp.y + 2;
      g.lineBetween(bx - 2, by - 2, bx - 2, by + 1);
      g.lineBetween(bx + 6, by - 2, bx + 6, by + 1);
      g.fillStyle(PAL.oakDark, 1);
      g.fillRoundedRect(bx - 6, by + 1, 16, 13, 2);
      g.fillStyle(PAL.oak, 1);
      g.fillRoundedRect(bx - 5, by + 2, 14, 11, 2);
      emblemShape(g, bx + 2, by + 7.5, s.emblem);
    }

    // Chimneys with a stone cap.
    const chim = (u: number) => {
      const c = P(w * u, d * 0.3, h + rh * 0.55);
      g.fillStyle(PAL.brickDark, 1);
      g.fillRect(c.x - 4, c.y - 18, 8, 18);
      g.fillStyle(PAL.brick, 1);
      g.fillRect(c.x - 4, c.y - 18, 5, 18);
      g.lineStyle(1, PAL.brickDark, 0.8);
      for (let y = c.y - 15; y < c.y; y += 4) g.lineBetween(c.x - 4, y, c.x + 4, y);
      g.fillStyle(PAL.stoneLight, 1);
      g.fillRect(c.x - 5, c.y - 20, 10, 3);
      chimneys.push({ x: c.x, y: c.y - 21 });
    };
    if (s.chimney === 'right' || s.chimney === 'both') chim(0.78);
    if (s.chimney === 'left' || s.chimney === 'both') chim(0.22);

    // Dovecote / cupola on the barn.
    if (s.dovecote) {
      const c = P(w / 2, d / 2, h + rh);
      g.fillStyle(PAL.plaster, 1);
      g.fillRect(c.x - 5, c.y - 10, 10, 10);
      g.fillStyle(0x2a1a10, 1);
      g.fillRect(c.x - 2, c.y - 7, 4, 4);
      g.fillStyle(PAL.thatchDark, 1);
      g.fillTriangle(c.x - 7, c.y - 9, c.x + 7, c.y - 9, c.x, c.y - 18);
    }

    // Clock tower with NEAR pennant on the Exchange.
    if (s.tower) {
      const c = P(w / 2, d / 2, h + rh - 4);
      g.fillStyle(shade(PAL.sandstone, 0.78), 1);
      g.fillRect(c.x - 9, c.y - 40, 9, 40);
      g.fillStyle(PAL.sandstone, 1);
      g.fillRect(c.x - 9 + 9, c.y - 40, 9, 40);
      g.fillStyle(PAL.white, 1);
      g.fillCircle(c.x, c.y - 28, 5.5);
      g.lineStyle(1.2, PAL.oakDark, 1);
      g.strokeCircle(c.x, c.y - 28, 5.5);
      g.lineBetween(c.x, c.y - 28, c.x, c.y - 32);
      g.lineBetween(c.x, c.y - 28, c.x + 3, c.y - 27);
      g.fillStyle(PAL.clay, 1);
      g.fillTriangle(c.x - 12, c.y - 40, c.x + 12, c.y - 40, c.x, c.y - 60);
      g.fillStyle(PAL.clayDark, 1);
      g.fillTriangle(c.x, c.y - 40, c.x + 12, c.y - 40, c.x, c.y - 60);
      g.fillStyle(0x2a2a2e, 1);
      g.fillRect(c.x - 0.8, c.y - 74, 1.6, 15);
      g.fillStyle(PAL.near, 1);
      g.fillTriangle(c.x + 0.8, c.y - 74, c.x + 14, c.y - 70, c.x + 0.8, c.y - 66);
      windows.push({ x: c.x, y: c.y - 14 });
    }

    // Porch with posts for the trading houses.
    if (s.porch) {
      const p1 = P(w * 0.05, d + 0.35, plinth + 18), p2 = P(w * 0.95, d + 0.35, plinth + 18);
      g.fillStyle(PAL.oakDark, 1);
      for (const t of [0.05, 0.5, 0.95]) {
        const a = P(w * t, d + 0.35, 0), b = P(w * t, d + 0.35, plinth + 18);
        g.fillRect(a.x - 1.2, b.y, 2.4, a.y - b.y);
      }
      g.fillStyle(shade(s.roofColor, 0.9), 1);
      g.fillPoints([P(w * 0.02, d + 0.45, plinth + 18), P(w * 0.98, d + 0.45, plinth + 18), P(w * 0.98, d, plinth + 24), P(w * 0.02, d, plinth + 24)], true);
      void p1; void p2;
    }
  }

  g.generateTexture(key, width, height);
  g.destroy();
  const crownY = oy - s.h - s.roofH - towerH;
  return { key, originX: ox, originY: oy, width, height, windows, chimneys, forge, crown: { x: ox + ((s.w - s.d) * hw) / 2, y: crownY } };
}

/** Mine entrance (rocky hill with timbered adit) and docks (pier with boathouse). */
function drawSpecial(g: Phaser.GameObjects.Graphics, s: BuildingSpec, P: (gx: number, gy: number, z?: number) => Pt, windows: Pt[], r: () => number) {
  const { w, d } = s;
  if (s.emblem === 'pick') {
    // Layered rock mass.
    const layers: Array<[number, number]> = [[0.78, 40], [0.9, 30], [1.02, 18]];
    layers.forEach(([lf, z], i) => {
      g.fillStyle(shade(PAL.stone, lf), 1);
      g.fillPoints([P(0 + i * 0.1, d), P(w, d), P(w, 0.3 + i * 0.15), P(w * 0.55, i * 0.2, z), P(0.1 + i * 0.12, d * 0.45, z * 0.6)], true);
    });
    for (let i = 0; i < 26; i++) {
      const p = P(r() * w, r() * d, r() * 30);
      g.fillStyle(shade(PAL.stone, 0.7 + r() * 0.5), 0.8);
      g.fillEllipse(p.x, p.y, 4 + r() * 7, 2 + r() * 4);
    }
    // Timber-framed adit.
    const m = P(w * 0.55, d, 0);
    g.fillStyle(0x0d0907, 1);
    g.fillEllipse(m.x - 4, m.y - 13, 24, 28);
    g.fillStyle(PAL.oak, 1);
    g.fillRect(m.x - 17, m.y - 30, 4, 28);
    g.fillRect(m.x + 6, m.y - 30, 4, 28);
    g.fillStyle(PAL.oakLight, 1);
    g.fillRect(m.x - 19, m.y - 33, 31, 5);
    g.fillStyle(0xffb347, 0.8);
    g.fillCircle(m.x + 14, m.y - 22, 2.2);
    windows.push({ x: m.x - 4, y: m.y - 14 }, { x: m.x + 14, y: m.y - 22 });
    // Rails leading out.
    g.lineStyle(1.4, 0x5a5048, 1);
    g.lineBetween(m.x - 7, m.y, m.x + 6, m.y + 16);
    g.lineBetween(m.x - 1, m.y - 2, m.x + 12, m.y + 13);
  } else {
    // Pier deck with planks and pilings.
    g.fillStyle(0x5c4128, 1);
    for (const [a, b] of [[-0.6, d], [w, d], [-0.6, 0.1]] as Array<[number, number]>) {
      const p = P(a, b, 0);
      g.fillRect(p.x - 1.5, p.y - 4, 3, 10);
    }
    g.fillStyle(0x8a6a46, 1);
    g.fillPoints([P(-0.7, 0, 5), P(w, 0, 5), P(w, d, 5), P(-0.7, d, 5)], true);
    g.lineStyle(1, 0x5c4128, 0.8);
    for (let i = 0; i <= 10; i++) {
      const a = P(-0.7 + ((w + 0.7) * i) / 10, 0, 5), b = P(-0.7 + ((w + 0.7) * i) / 10, d, 5);
      g.lineBetween(a.x, a.y, b.x, b.y);
    }
    // Boathouse.
    const q = (gx: number, gy: number, z = 0) => P(w - 1 + gx, gy, z + 5);
    paintWall(g, [q(0, 1, 26), q(1, 1, 26), q(1, 1, 0), q(0, 1, 0)], 'planks', 0x7a5a3a, 0.95, 1, 26, 31);
    paintWall(g, [q(1, 1, 26), q(1, 0, 26), q(1, 0, 0), q(1, 1, 0)], 'planks', 0x7a5a3a, 0.72, 1, 26, 32);
    paintRoof(g, [q(-0.15, -0.15, 26), q(1.15, -0.15, 26), q(1.15, 0.5, 38), q(-0.15, 0.5, 38)], 'shingle', 0x4f6f7f, 0.74, 1, 33);
    paintRoof(g, [q(-0.15, 1.15, 26), q(1.15, 1.15, 26), q(1.15, 0.5, 38), q(-0.15, 0.5, 38)], 'shingle', 0x4f6f7f, 1, 1, 34);
    const wpt = q(0.5, 1, 13);
    g.fillStyle(0x1e2733, 1);
    g.fillRect(wpt.x - 3, wpt.y - 4, 6, 7);
    windows.push(wpt);
    // Coiled rope and a lantern post.
    const lp = P(-0.4, d * 0.9, 5);
    g.fillStyle(0x3a2e24, 1);
    g.fillRect(lp.x - 1, lp.y - 22, 2, 22);
    g.fillStyle(0xffd27a, 1);
    g.fillRect(lp.x - 2, lp.y - 25, 4, 4);
    windows.push({ x: lp.x, y: lp.y - 23 });
    const rp = P(0.3, d * 0.6, 5);
    g.lineStyle(1.4, 0xc9a46c, 1);
    for (let i = 0; i < 3; i++) g.strokeEllipse(rp.x, rp.y - 1, 9 - i * 2.5, 4.5 - i * 1.2);
  }
}
