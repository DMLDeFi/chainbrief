import type * as Phaser from 'phaser';
import { TILE_H, TILE_W } from './layout';

/** All art is generated procedurally at boot — no external or third-party assets. */

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
