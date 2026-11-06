import type * as Phaser from 'phaser';
import { TILE_H, TILE_W, type BuildingStyle } from './layout';

/** All art is generated procedurally at boot — no external or third-party assets. */

const shade = (c: number, f: number) => {
  const r = Math.min(255, Math.round(((c >> 16) & 255) * f));
  const g = Math.min(255, Math.round(((c >> 8) & 255) * f));
  const b = Math.min(255, Math.round((c & 255) * f));
  return (r << 16) | (g << 8) | b;
};
const mix = (a: number, b: number, t: number) => {
  const ch = (s: number) => [(a >> s) & 255, (b >> s) & 255];
  const [r1, r2] = ch(16), [g1, g2] = ch(8), [b1, b2] = ch(0);
  return (Math.round(r1 + (r2 - r1) * t) << 16) | (Math.round(g1 + (g2 - g1) * t) << 8) | Math.round(b1 + (b2 - b1) * t);
};

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function diamond(g: Phaser.GameObjects.Graphics, ox: number, oy: number, color: number, alpha = 1) {
  g.fillStyle(color, alpha);
  g.fillPoints([
    { x: ox + TILE_W / 2, y: oy },
    { x: ox + TILE_W, y: oy + TILE_H / 2 },
    { x: ox + TILE_W / 2, y: oy + TILE_H },
    { x: ox, y: oy + TILE_H / 2 },
  ], true);
}

/** Speckle inside a diamond for texture. */
function speckle(g: Phaser.GameObjects.Graphics, rand: () => number, colors: number[], n: number, size = 1.5) {
  for (let i = 0; i < n; i++) {
    const u = rand(), v = rand();
    const x = (u - v) * (TILE_W / 2) + TILE_W / 2;
    const y = (u + v) * (TILE_H / 2);
    g.fillStyle(colors[Math.floor(rand() * colors.length)], 0.55 + rand() * 0.4);
    g.fillRect(x, y, size, size);
  }
}

export function makeTileTextures(scene: Phaser.Scene) {
  const g = scene.add.graphics();
  const tex = (key: string, w: number, h: number) => {
    g.generateTexture(key, w, h);
    g.clear();
  };
  // Grass (neutral, tinted per season at runtime).
  for (let v = 0; v < 3; v++) {
    const r = rng(11 + v);
    diamond(g, 0, 0, [0xbfd88f, 0xb5d085, 0xc6dc96][v]);
    speckle(g, r, [0x8fb35f, 0xd7e8a8, 0x9cc06a, 0x7aa04e], 70);
    tex(`grass${v}`, TILE_W, TILE_H);
  }
  // Dirt road.
  {
    const r = rng(3);
    diamond(g, 0, 0, 0xb08a5c);
    speckle(g, r, [0x8d6a43, 0xc8a273, 0x7a5a37], 90, 2);
    tex('road', TILE_W, TILE_H);
  }
  // Cobbled plaza.
  {
    diamond(g, 0, 0, 0xa89a86);
    const r = rng(5);
    for (let i = 0; i < 22; i++) {
      const u = r(), v = r();
      const x = (u - v) * 32 + 32, y = (u + v) * 16;
      g.fillStyle(r() > 0.5 ? 0xbcae98 : 0x958874, 1);
      g.fillEllipse(x, y, 7, 3.6);
    }
    g.lineStyle(1, 0x6d6252, 0.12);
    g.strokePoints([{ x: 32, y: 0 }, { x: 64, y: 16 }, { x: 32, y: 32 }, { x: 0, y: 16 }], true);
    tex('plaza', TILE_W, TILE_H);
  }
  // Water (two frames for shimmer).
  for (let f = 0; f < 2; f++) {
    const r = rng(20 + f);
    diamond(g, 0, 0, 0x4f8fb8);
    for (let i = 0; i < 9; i++) {
      const u = r(), v = r();
      g.fillStyle(0xbfe6ff, 0.35 + r() * 0.3);
      g.fillRect((u - v) * 32 + 32 - 4, (u + v) * 16, 8, 1);
    }
    tex(`water${f}`, TILE_W, TILE_H);
  }
  // Sand / riverbank.
  {
    diamond(g, 0, 0, 0xd8c38f);
    speckle(g, rng(9), [0xc4ad78, 0xe8d6a6], 60);
    tex('sand', TILE_W, TILE_H);
  }
  // Mine dirt.
  {
    diamond(g, 0, 0, 0x8d7b67);
    speckle(g, rng(13), [0x6f604f, 0xa48f78, 0x5d5044], 90, 2);
    tex('dirt', TILE_W, TILE_H);
  }
  // Wheat fields per season.
  const fieldColors: Record<string, [number, number]> = { spring: [0x8c6a42, 0x9ccc5a], summer: [0x8c6a42, 0xd8c050], autumn: [0x8c6a42, 0xe9b640], winter: [0x9a8a78, 0xe8eef2] };
  for (const [season, [soil, crop]] of Object.entries(fieldColors)) {
    diamond(g, 0, 0, soil);
    g.lineStyle(2, crop, 1);
    for (let i = 1; i < 8; i++) {
      const t = i / 8;
      g.lineBetween(t * 32, 16 - t * 16 + 1, 32 + t * 32, 32 - t * 16 - 1);
    }
    tex(`field-${season}`, TILE_W, TILE_H);
  }
  // Shadow blob, glow, particles.
  g.fillStyle(0x000000, 0.28);
  g.fillEllipse(16, 6, 30, 10);
  tex('shadow', 32, 12);
  for (let i = 12; i > 0; i--) {
    g.fillStyle(0xffd27a, 0.045);
    g.fillCircle(32, 32, i * 2.6);
  }
  tex('glow', 64, 64);
  g.fillStyle(0xffffff, 1);
  g.fillCircle(6, 6, 6);
  tex('puff', 12, 12);
  g.fillStyle(0xbfd8ff, 0.75);
  g.fillRect(0, 0, 1.5, 12);
  tex('raindrop', 2, 12);
  g.fillStyle(0xffffff, 0.95);
  g.fillCircle(3, 3, 2.4);
  tex('snowflake', 6, 6);
  g.fillStyle(0x000000, 0.18);
  g.fillEllipse(110, 50, 220, 90);
  tex('cloudshadow', 220, 100);
  g.fillStyle(0xffe08a, 1);
  g.fillCircle(4, 4, 4);
  g.fillStyle(0xb8862b, 1);
  g.fillCircle(4, 4, 2);
  tex('coin', 8, 8);
  g.destroy();
}

export function makeTreeTextures(scene: Phaser.Scene) {
  const g = scene.add.graphics();
  // Pine
  g.fillStyle(0x000000, 0.22);
  g.fillEllipse(20, 58, 26, 9);
  g.fillStyle(0x5b3f28, 1);
  g.fillRect(18, 44, 5, 14);
  const pine = [0x2f5d3a, 0x3a6e44, 0x47804f];
  for (let i = 0; i < 3; i++) {
    g.fillStyle(pine[i], 1);
    g.fillTriangle(20, 6 + i * 11, 4 + i * 1, 34 + i * 7, 36 - i * 1, 34 + i * 7);
  }
  g.generateTexture('pine', 40, 62);
  g.clear();
  // Oak (white canopy so it can be tinted per season).
  g.fillStyle(0x000000, 0.22);
  g.fillEllipse(22, 58, 30, 10);
  g.fillStyle(0x6b4a2e, 1);
  g.fillRect(19, 36, 6, 22);
  g.generateTexture('oak-trunk', 44, 62);
  g.clear();
  const blobs: Array<[number, number, number]> = [[22, 22, 15], [12, 30, 11], [32, 30, 11], [22, 34, 12], [16, 16, 9], [28, 16, 9]];
  for (const [x, y, r] of blobs) {
    g.fillStyle(0xdddddd, 1);
    g.fillCircle(x, y, r);
  }
  for (const [x, y, r] of blobs) {
    g.fillStyle(0xffffff, 1);
    g.fillCircle(x - r * 0.25, y - r * 0.3, r * 0.6);
  }
  g.generateTexture('oak-canopy', 44, 62);
  g.clear();
  // Bush / hay / crates / rock / lamp / stall
  g.fillStyle(0x6f9a4c, 1);
  g.fillCircle(10, 10, 8);
  g.fillCircle(18, 12, 7);
  g.fillStyle(0x8fbc62, 1);
  g.fillCircle(9, 8, 4);
  g.generateTexture('bush', 28, 22);
  g.clear();
  g.fillStyle(0x7a756e, 1);
  g.fillEllipse(14, 12, 26, 16);
  g.fillStyle(0x9a958c, 1);
  g.fillEllipse(11, 9, 14, 8);
  g.generateTexture('rock', 28, 22);
  g.clear();
  g.fillStyle(0x3a2e24, 1);
  g.fillRect(4, 8, 3, 30);
  g.fillStyle(0x2a211a, 1);
  g.fillRect(1, 4, 9, 6);
  g.fillStyle(0xffd27a, 1);
  g.fillRect(3, 5, 5, 3);
  g.generateTexture('lamp', 12, 40);
  g.clear();
  // Market stall with striped awning.
  g.fillStyle(0x000000, 0.2);
  g.fillEllipse(24, 40, 44, 12);
  g.fillStyle(0x7a5634, 1);
  g.fillRect(6, 18, 3, 22);
  g.fillRect(39, 18, 3, 22);
  g.fillStyle(0x9a7048, 1);
  g.fillRect(4, 28, 40, 8);
  for (let i = 0; i < 6; i++) {
    g.fillStyle(i % 2 ? 0xf1e4c6 : 0xb5452e, 1);
    g.fillTriangle(4 + i * 7, 18, 11 + i * 7, 18, 7.5 + i * 7, 24);
    g.fillRect(4 + i * 7, 12, 7, 6);
  }
  g.fillStyle(0xe2b74a, 1);
  g.fillCircle(14, 27, 3);
  g.fillStyle(0x8fb35f, 1);
  g.fillCircle(22, 27, 3);
  g.fillStyle(0xd2643a, 1);
  g.fillCircle(30, 27, 3);
  g.generateTexture('stall', 48, 44);
  g.clear();
  // Caravan cart with horse.
  g.fillStyle(0x000000, 0.22);
  g.fillEllipse(26, 30, 50, 10);
  g.fillStyle(0x6b4b2c, 1);
  g.fillRect(4, 12, 28, 12);
  g.fillStyle(0xe8dcc0, 1);
  g.fillEllipse(18, 12, 30, 16);
  g.fillStyle(0x3a2a1c, 1);
  g.fillCircle(10, 26, 4);
  g.fillCircle(26, 26, 4);
  g.fillStyle(0x7a5232, 1);
  g.fillRect(34, 14, 12, 8);
  g.fillRect(44, 9, 5, 8);
  g.fillRect(35, 22, 2, 7);
  g.fillRect(43, 22, 2, 7);
  g.generateTexture('caravan', 52, 34);
  g.clear();
  // Sign post for empty plots.
  g.fillStyle(0x5d4330, 1);
  g.fillRect(9, 10, 3, 22);
  g.fillStyle(0xc9a46c, 1);
  g.fillRect(1, 6, 20, 9);
  g.lineStyle(1, 0x5d4330, 1);
  g.strokeRect(1, 6, 20, 9);
  g.generateTexture('signpost', 22, 34);
  g.clear();
  // Gold flag (player marker).
  g.fillStyle(0x3a2e24, 1);
  g.fillRect(2, 0, 2, 30);
  g.fillStyle(0xf4c96b, 1);
  g.fillTriangle(4, 2, 18, 6, 4, 11);
  g.generateTexture('flag', 20, 32);
  g.destroy();
}

export interface BuildingArt {
  key: string;
  /** Offset from the texture's top-left to the footprint's north corner. */
  originX: number;
  originY: number;
  width: number;
  height: number;
  windows: Array<{ x: number; y: number }>;
  chimney?: { x: number; y: number };
}

/** Draw an isometric building with gabled roof; returns texture metadata. */
export function makeBuildingTexture(
  scene: Phaser.Scene,
  key: string,
  w: number,
  d: number,
  h: number,
  wall: number,
  roof: number,
  style: BuildingStyle,
  chimney = false,
): BuildingArt {
  const hw = TILE_W / 2, hh = TILE_H / 2;
  const roofH = style === 'mine' || style === 'dock' ? 0 : style === 'hall' ? 34 : style === 'bank' ? 22 : 26;
  const pad = 12;
  const width = (w + d) * hw + pad * 2;
  const top = h + roofH + (chimney ? 18 : 0) + pad + (style === 'hall' ? 24 : 0);
  const height = (w + d) * hh + top + pad;
  const ox = d * hw + pad; // north corner x
  const oy = top; // north corner y (ground)
  const P = (gx: number, gy: number, z = 0) => ({ x: ox + (gx - gy) * hw, y: oy + (gx + gy) * hh - z });
  const g = scene.add.graphics();
  const windows: Array<{ x: number; y: number }> = [];

  // Ground shadow + foundation.
  g.fillStyle(0x000000, 0.25);
  const s = (pt: { x: number; y: number }, dx: number, dy: number) => ({ x: pt.x + dx, y: pt.y + dy });
  g.fillPoints([s(P(0, 0), 6, 3), s(P(w, 0), 8, 3), s(P(w, d), 0, 6), s(P(0, d), -6, 3)], true);

  if (style === 'mine') {
    // Rocky hill with a timbered tunnel mouth.
    g.fillStyle(shade(wall, 0.8), 1);
    g.fillPoints([P(0, d), P(w, d), P(w, 0), P(w * 0.5, 0, h + 26), P(0, d * 0.4, h + 10)], true);
    g.fillStyle(shade(wall, 1.05), 1);
    g.fillPoints([P(0, d), P(w * 0.5, d * 0.5, h + 20), P(w * 0.5, 0, h + 26), P(0, d * 0.4, h + 10)], true);
    const m = P(w * 0.55, d, 0);
    g.fillStyle(0x1a1410, 1);
    g.fillEllipse(m.x - 8, m.y - 12, 26, 26);
    g.fillStyle(0x6b4a2e, 1);
    g.fillRect(m.x - 22, m.y - 28, 4, 26);
    g.fillRect(m.x + 3, m.y - 28, 4, 26);
    g.fillRect(m.x - 23, m.y - 30, 31, 5);
    windows.push({ x: m.x - 8, y: m.y - 12 });
  } else if (style === 'dock') {
    // Plank pier and a small boathouse.
    g.fillStyle(0x7a5a38, 1);
    g.fillPoints([P(-0.6, 0, 4), P(w, 0, 4), P(w, d, 4), P(-0.6, d, 4)], true);
    g.lineStyle(1, 0x5a4026, 0.8);
    for (let i = 0; i <= 6; i++) {
      const a = P(-0.6 + ((w + 0.6) * i) / 6, 0, 4), b = P(-0.6 + ((w + 0.6) * i) / 6, d, 4);
      g.lineBetween(a.x, a.y, b.x, b.y);
    }
    const hutW = w * 0.55, hutD = d * 0.55, hz = 26;
    const q = (gx: number, gy: number, z = 0) => P(w - hutW + gx, gy, z + 4);
    g.fillStyle(shade(wall, 0.9), 1);
    g.fillPoints([q(0, hutD), q(hutW, hutD), q(hutW, hutD, hz), q(0, hutD, hz)], true);
    g.fillStyle(shade(wall, 0.72), 1);
    g.fillPoints([q(hutW, 0), q(hutW, hutD), q(hutW, hutD, hz), q(hutW, 0, hz)], true);
    g.fillStyle(roof, 1);
    g.fillPoints([q(0, 0, hz), q(hutW, 0, hz), q(hutW, hutD, hz), q(0, hutD, hz)], true);
    windows.push(q(hutW * 0.5, hutD, hz * 0.5));
    // Moored boat.
    const b = P(-0.4, d * 0.7, 0);
    g.fillStyle(0x5d3e22, 1);
    g.fillEllipse(b.x - 6, b.y + 4, 30, 10);
    g.fillStyle(0xe8dcc0, 1);
    g.fillTriangle(b.x - 6, b.y - 22, b.x - 6, b.y, b.x + 8, b.y);
  } else {
    // Walls.
    const left = shade(wall, 0.92), right = shade(wall, 0.72);
    g.fillStyle(left, 1);
    g.fillPoints([P(0, d), P(w, d), P(w, d, h), P(0, d, h)], true);
    g.fillStyle(right, 1);
    g.fillPoints([P(w, 0), P(w, d), P(w, d, h), P(w, 0, h)], true);
    // Timber framing / stone courses.
    g.lineStyle(style === 'forge' || style === 'bank' ? 1 : 2, style === 'bank' ? 0xffffff : shade(wall, 0.45), style === 'bank' ? 0.25 : 0.55);
    if (style === 'bank' || style === 'hall') {
      for (let i = 0.5; i < w; i += 0.5) {
        const a = P(i, d, 2), b2 = P(i, d, h - 2);
        g.lineStyle(3, 0xffffff, 0.22);
        g.lineBetween(a.x, a.y, b2.x, b2.y);
      }
    } else {
      const a = P(0, d, h * 0.55), b2 = P(w, d, h * 0.55);
      g.lineBetween(a.x, a.y, b2.x, b2.y);
      const c = P(w, 0, h * 0.55), e = P(w, d, h * 0.55);
      g.lineBetween(c.x, c.y, e.x, e.y);
    }
    // Door on the front-left face.
    const dc = P(w * 0.35, d, 0);
    g.fillStyle(style === 'barn' || style === 'warehouse' ? 0x5a3a22 : 0x4a3020, 1);
    const doorW = style === 'barn' || style === 'warehouse' || style === 'hall' ? 18 : 10;
    const doorH = style === 'barn' || style === 'warehouse' || style === 'hall' ? 22 : 16;
    g.fillPoints([{ x: dc.x - doorW / 2, y: dc.y - doorW / 4 }, { x: dc.x + doorW / 2, y: dc.y + doorW / 4 }, { x: dc.x + doorW / 2, y: dc.y + doorW / 4 - doorH }, { x: dc.x - doorW / 2, y: dc.y - doorW / 4 - doorH }], true);
    if (style === 'barn') {
      g.lineStyle(2, 0xe8d6ad, 0.8);
      g.lineBetween(dc.x - doorW / 2, dc.y - doorW / 4 - doorH, dc.x + doorW / 2, dc.y + doorW / 4);
      g.lineBetween(dc.x + doorW / 2, dc.y + doorW / 4 - doorH, dc.x - doorW / 2, dc.y - doorW / 4);
    }
    // Windows.
    const win = (pt: { x: number; y: number }, onRight: boolean) => {
      g.fillStyle(0x2c2218, 1);
      const k = onRight ? -1 : 1;
      g.fillPoints([{ x: pt.x - 4, y: pt.y - 2 * k }, { x: pt.x + 4, y: pt.y + 2 * k }, { x: pt.x + 4, y: pt.y + 2 * k - 8 }, { x: pt.x - 4, y: pt.y - 2 * k - 8 }], true);
      g.fillStyle(0xffd88a, 0.35);
      g.fillPoints([{ x: pt.x - 3, y: pt.y - 1.5 * k - 1 }, { x: pt.x + 3, y: pt.y + 1.5 * k - 1 }, { x: pt.x + 3, y: pt.y + 1.5 * k - 7 }, { x: pt.x - 3, y: pt.y - 1.5 * k - 7 }], true);
      windows.push({ x: pt.x, y: pt.y - 4 });
    };
    const wz = Math.min(h - 6, h * 0.5 + 6);
    win(P(w * 0.75, d, wz), false);
    if (w > 2 || style === 'hall') win(P(w * 0.15, d, wz), false);
    win(P(w, d * 0.3, wz), true);
    win(P(w, d * 0.75, wz), true);

    // Roof: gable along the x axis.
    const r1 = P(0, d / 2, h + roofH), r2 = P(w, d / 2, h + roofH);
    const eave = 0.18;
    g.fillStyle(shade(roof, 0.85), 1);
    g.fillPoints([P(-eave, -eave, h), P(w + eave, -eave, h), { x: r2.x, y: r2.y }, { x: r1.x, y: r1.y }], true);
    g.fillStyle(right, 1);
    g.fillPoints([P(w, 0, h), P(w, d, h), r2], true);
    g.fillStyle(roof, 1);
    g.fillPoints([P(-eave, d + eave, h), P(w + eave, d + eave, h), r2, r1], true);
    // Shingle lines.
    g.lineStyle(1, shade(roof, 0.65), 0.7);
    for (let i = 1; i < 4; i++) {
      const t = i / 4;
      const a = { x: P(-eave, d + eave, h).x + (r1.x - P(-eave, d + eave, h).x) * t, y: P(-eave, d + eave, h).y + (r1.y - P(-eave, d + eave, h).y) * t };
      const b2 = { x: P(w + eave, d + eave, h).x + (r2.x - P(w + eave, d + eave, h).x) * t, y: P(w + eave, d + eave, h).y + (r2.y - P(w + eave, d + eave, h).y) * t };
      g.lineBetween(a.x, a.y, b2.x, b2.y);
    }
    g.lineStyle(2, shade(roof, 1.25), 0.8);
    g.lineBetween(r1.x, r1.y, r2.x, r2.y);
    if (style === 'hall') {
      // Bell tower with a NEAR-green pennant.
      const t = P(w / 2, d / 2, h + roofH);
      g.fillStyle(shade(wall, 0.9), 1);
      g.fillRect(t.x - 7, t.y - 22, 14, 22);
      g.fillStyle(roof, 1);
      g.fillTriangle(t.x - 10, t.y - 22, t.x + 10, t.y - 22, t.x, t.y - 38);
      g.fillStyle(0x3a2e24, 1);
      g.fillRect(t.x - 1, t.y - 52, 2, 16);
      g.fillStyle(0x00ec97, 1);
      g.fillTriangle(t.x + 1, t.y - 52, t.x + 15, t.y - 48, t.x + 1, t.y - 44);
      g.fillStyle(0xffd88a, 0.7);
      g.fillRect(t.x - 3, t.y - 16, 6, 7);
    }
    if (style === 'forge') {
      const a = P(w * 0.85, d + 0.35, 0);
      g.fillStyle(0x2b2b2e, 1);
      g.fillRect(a.x - 7, a.y - 9, 14, 5);
      g.fillRect(a.x - 3, a.y - 5, 6, 5);
    }
    if (style === 'warehouse' || style === 'barn') {
      const a = P(w + 0.25, d * 0.8, 0);
      g.fillStyle(0x8a6238, 1);
      g.fillRect(a.x - 4, a.y - 12, 12, 10);
      g.lineStyle(1, 0x5a3d20, 1);
      g.strokeRect(a.x - 4, a.y - 12, 12, 10);
    }
    if (style === 'mill') {
      for (let i = 0; i < 3; i++) {
        const a = P(w + 0.3, d * 0.2 + i * 0.25, 0);
        g.fillStyle(0xa87b4a, 1);
        g.fillEllipse(a.x + 4, a.y - 4 - i * 2, 18, 6);
        g.fillStyle(0xd9b98a, 1);
        g.fillCircle(a.x - 4, a.y - 4 - i * 2, 3);
      }
    }
  }

  let chimneyPt: { x: number; y: number } | undefined;
  if (chimney) {
    const c = P(w * 0.75, d * 0.3, h + roofH * 0.55);
    g.fillStyle(0x6e5a4a, 1);
    g.fillRect(c.x - 4, c.y - 16, 8, 16);
    g.fillStyle(0x4a3a2e, 1);
    g.fillRect(c.x - 5, c.y - 18, 10, 3);
    chimneyPt = { x: c.x, y: c.y - 18 };
  }
  g.generateTexture(key, width, height);
  g.destroy();
  return { key, originX: ox, originY: oy, width, height, windows, chimney: chimneyPt };
}

const SKIN = [0xf1c9a5, 0xd9a47a, 0xb07a52, 0x8a5a3a];

export function makeCharacterTexture(scene: Phaser.Scene, key: string, tunic: number, hat: string, seed: number) {
  const g = scene.add.graphics();
  const r = rng(seed);
  const skin = SKIN[Math.floor(r() * SKIN.length)];
  g.fillStyle(0x000000, 0.25);
  g.fillEllipse(10, 30, 14, 5);
  // Legs
  g.fillStyle(0x3b2d22, 1);
  g.fillRect(6, 21, 3, 8);
  g.fillRect(11, 21, 3, 8);
  // Body
  g.fillStyle(tunic, 1);
  g.fillRoundedRect(4, 11, 12, 12, 3);
  g.fillStyle(shade(tunic, 0.75), 1);
  g.fillRect(4, 19, 12, 2);
  if (hat === 'apron') {
    g.fillStyle(0xe8e0d0, 1);
    g.fillRect(6, 13, 8, 9);
  }
  // Head
  g.fillStyle(skin, 1);
  g.fillCircle(10, 8, 4.5);
  // Hats
  switch (hat) {
    case 'straw': g.fillStyle(0xe3c46a, 1); g.fillEllipse(10, 5, 16, 4); g.fillRect(7, 1, 6, 4); break;
    case 'toque': g.fillStyle(0xffffff, 1); g.fillRect(6, -0.5, 8, 5); g.fillCircle(10, 0, 4.5); break;
    case 'apron': g.fillStyle(0x2c2c30, 1); g.fillRect(5.5, 2, 9, 3); break;
    case 'hood': g.fillStyle(mix(tunic, 0x000000, 0.2), 1); g.fillCircle(10, 6, 5.5); g.fillStyle(skin, 1); g.fillCircle(10, 8, 3.5); break;
    case 'tophat': g.fillStyle(0x1d1d24, 1); g.fillRect(6.5, -4, 7, 8); g.fillRect(4.5, 3, 11, 2); g.fillStyle(0xd9a84a, 1); g.fillRect(6.5, 1, 7, 1); break;
    case 'helmet': g.fillStyle(0x8a7a52, 1); g.fillEllipse(10, 4.5, 11, 6); g.fillStyle(0xffe08a, 1); g.fillCircle(10, 3, 1.6); break;
    case 'cap': g.fillStyle(0x2f6f7f, 1); g.fillEllipse(10, 4, 10, 5); g.fillRect(10, 4, 6, 1.5); break;
    case 'scarf': g.fillStyle(0x8b4f87, 1); g.fillEllipse(10, 5, 11, 6); break;
    default: g.fillStyle([0x5d3f2a, 0x2c2218, 0xb08d57, 0x8a3b2a][Math.floor(r() * 4)], 1); g.fillEllipse(10, 5, 9, 5);
  }
  g.generateTexture(key, 20, 33);
  g.destroy();
}
