import type * as Phaser from 'phaser';
import { TILE_H, TILE_W } from '../layout';
import { PAL, mix, rng, shade } from './palette';

type G = Phaser.GameObjects.Graphics;

/** Resource colours used for goods icons that fly around town. */
export const RESOURCE_COLOR: Record<string, [number, number]> = {
  wheat: [0xf0c45a, 0xc99a3c], bread: [0xd08a45, 0x8a5a2a], wood: [0xa06a3c, 0xe2b989], iron: [0xb8c0ca, 0x6b737d],
  coal: [0x2b2b30, 0x55555e], stone: [0x9a958c, 0x6f6860], tools: [0xb8c0ca, 0x8a5a33], livestock: [0xefe6d6, 0x8a6a4a],
  fish: [0x6aa3c8, 0xbfe6ff], cloth: [0x9b6fb5, 0xe9c46a], weapons: [0xc9d1da, 0x8a5a33],
  flour: [0xefe6d2, 0xb9a988], planks: [0xdeae72, 0x8a5e33], steel: [0xd4dde6, 0x7d8996], ale: [0xd99a35, 0xfff6e2], furniture: [0xa76b3c, 0x7d4c28],
};

function tex(g: G, key: string, w: number, h: number) {
  g.generateTexture(key, w, h);
  g.clear();
}
function shadow(g: G, cx: number, cy: number, w: number, h: number, a = 0.28) {
  g.fillStyle(0x000000, a);
  g.fillEllipse(cx, cy, w, h);
}
/** Small isometric box helper: top + two side faces. */
function box(g: G, cx: number, by: number, hw: number, hh: number, z: number, color: number) {
  g.fillStyle(shade(color, 0.95), 1);
  g.fillPoints([{ x: cx - hw, y: by - hh - z }, { x: cx, y: by - z }, { x: cx, y: by }, { x: cx - hw, y: by - hh }], true);
  g.fillStyle(shade(color, 0.72), 1);
  g.fillPoints([{ x: cx, y: by - z }, { x: cx + hw, y: by - hh - z }, { x: cx + hw, y: by - hh }, { x: cx, y: by }], true);
  g.fillStyle(mix(color, 0xffffff, 0.18), 1);
  g.fillPoints([{ x: cx - hw, y: by - hh - z }, { x: cx, y: by - 2 * hh - z }, { x: cx + hw, y: by - hh - z }, { x: cx, y: by - z }], true);
}

export function makePropTextures(scene: Phaser.Scene) {
  const g = scene.add.graphics();

  // ---- Ground upgrades: hand-laid cobbles and a rutted road with verges.
  for (let v = 0; v < 3; v++) {
    const r = rng(40 + v);
    g.fillStyle(0x8f8473, 1);
    g.fillPoints([{ x: 32, y: 0 }, { x: 64, y: 16 }, { x: 32, y: 32 }, { x: 0, y: 16 }], true);
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const u = (col + 0.5 + (row % 2) * 0.5 + (r() - 0.5) * 0.25) / 8, w = (row + 0.5) / 8;
        if (u > 1) continue;
        const x = (u - w) * 32 + 32, y = (u + w) * 16;
        const c = [0xb7aa94, 0xa89a84, 0xc2b59e, 0x9d907b][Math.floor(r() * 4)];
        g.fillStyle(0x5f5648, 0.5);
        g.fillEllipse(x + 0.6, y + 0.8, 7.4, 3.8);
        g.fillStyle(c, 1);
        g.fillEllipse(x, y, 7, 3.4);
        g.fillStyle(0xffffff, 0.16);
        g.fillEllipse(x - 1, y - 0.7, 3.4, 1.3);
      }
    }
    if (v === 2) { g.fillStyle(0x6f8f4a, 0.55); for (let i = 0; i < 5; i++) g.fillRect(14 + r() * 36, 8 + r() * 16, 2, 1); }
    tex(g, `cobble${v}`, TILE_W, TILE_H);
  }
  {
    const r = rng(48);
    g.fillStyle(0xa9845a, 1);
    g.fillPoints([{ x: 32, y: 0 }, { x: 64, y: 16 }, { x: 32, y: 32 }, { x: 0, y: 16 }], true);
    for (let i = 0; i < 70; i++) {
      const u = r(), v = r();
      g.fillStyle([0x8d6a43, 0xc8a273, 0x7a5a37, 0xb99566][Math.floor(r() * 4)], 0.7);
      g.fillEllipse((u - v) * 32 + 32, (u + v) * 16, 2 + r() * 2.5, 1 + r());
    }
    g.lineStyle(1.4, 0x7a5a37, 0.35);
    g.lineBetween(20, 10, 44, 22); g.lineBetween(26, 7, 50, 19);
    tex(g, 'road2', TILE_W, TILE_H);
  }
  // Water with depth gradient and specular streaks (two frames).
  for (let f = 0; f < 2; f++) {
    const r = rng(60 + f);
    g.fillStyle(0x2f6f8f, 1);
    g.fillPoints([{ x: 32, y: 0 }, { x: 64, y: 16 }, { x: 32, y: 32 }, { x: 0, y: 16 }], true);
    g.fillStyle(0x3d86a6, 0.6);
    g.fillPoints([{ x: 32, y: 3 }, { x: 58, y: 16 }, { x: 32, y: 29 }, { x: 6, y: 16 }], true);
    for (let i = 0; i < 6; i++) {
      const x = 12 + r() * 40, y = 8 + r() * 16;
      g.lineStyle(1, 0xbfe6ff, 0.45 + r() * 0.3);
      g.lineBetween(x + f * 2, y, x + 5 + f * 2, y + 0.5);
    }
    tex(g, `water2-${f}`, TILE_W, TILE_H);
  }

  // ---- Market stall with canopy and goods (several colourways).
  const canopies = [0xb5452e, 0x2f7d55, 0x2f5e8e, 0xd9a84a, 0x7d4f7a, 0xc96a2f];
  canopies.forEach((c, i) => {
    const r = rng(70 + i);
    shadow(g, 28, 46, 46, 12);
    // Counter.
    box(g, 28, 46, 20, 10, 12, 0x8a5a33);
    // Goods on the counter.
    for (let k = 0; k < 7; k++) {
      const gx = 14 + k * 4 + r() * 2, gy = 30 + Math.abs(k - 3) * 1.5;
      const col = [0xd2643a, 0x8fb35f, 0xf0c45a, 0xd08a45, 0x9b6fb5, 0x6aa3c8][Math.floor(r() * 6)];
      g.fillStyle(shade(col, 0.75), 1); g.fillCircle(gx + 0.6, gy + 0.6, 2.4);
      g.fillStyle(col, 1); g.fillCircle(gx, gy, 2.2);
    }
    // Posts.
    g.fillStyle(PAL.oakDark, 1);
    g.fillRect(8, 14, 2, 30); g.fillRect(46, 14, 2, 30); g.fillRect(27, 4, 2, 18);
    // Striped canopy.
    for (let s = 0; s < 8; s++) {
      g.fillStyle(s % 2 ? PAL.white : c, 1);
      const x0 = 4 + s * 6;
      g.fillPoints([{ x: x0, y: 16 + Math.abs(s - 4) * -1.6 }, { x: x0 + 6, y: 16 + Math.abs(s - 3) * -1.6 }, { x: x0 + 6, y: 22 }, { x: x0, y: 22 }], true);
    }
    g.fillStyle(shade(c, 0.7), 1);
    for (let s = 0; s < 8; s++) g.fillTriangle(4 + s * 6, 22, 10 + s * 6, 22, 7 + s * 6, 25);
    g.fillStyle(0x000000, 0.15);
    g.fillRect(6, 22, 44, 3);
    tex(g, `stall${i}`, 56, 52);
  });

  // ---- Fountain: two-tier basin.
  {
    shadow(g, 40, 44, 74, 26, 0.3);
    g.fillStyle(PAL.stoneDark, 1); g.fillEllipse(40, 38, 70, 30);
    g.fillStyle(PAL.stone, 1); g.fillEllipse(40, 34, 70, 30);
    g.fillStyle(PAL.stoneLight, 1); g.fillEllipse(40, 33, 64, 26);
    g.fillStyle(0x2f6f8f, 1); g.fillEllipse(40, 34, 56, 21);
    g.fillStyle(0x5aa3c6, 0.7); g.fillEllipse(36, 32, 34, 10);
    g.fillStyle(PAL.stoneDark, 1); g.fillRect(36, 12, 8, 22);
    g.fillStyle(PAL.stoneLight, 1); g.fillRect(36, 12, 4, 22);
    g.fillStyle(PAL.stone, 1); g.fillEllipse(40, 13, 26, 9);
    g.fillStyle(0x5aa3c6, 1); g.fillEllipse(40, 12, 20, 6);
    g.fillStyle(PAL.stoneLight, 1); g.fillRect(38, 2, 4, 10); g.fillCircle(40, 3, 3);
    tex(g, 'fountain', 80, 54);
  }
  // ---- Well with a little roof.
  {
    shadow(g, 18, 38, 30, 10);
    g.fillStyle(PAL.stoneDark, 1); g.fillEllipse(18, 33, 24, 11);
    g.fillRect(6, 25, 24, 8);
    g.fillStyle(PAL.stone, 1); g.fillEllipse(18, 25, 24, 11);
    g.fillStyle(0x16242c, 1); g.fillEllipse(18, 25, 17, 7);
    g.fillStyle(PAL.oakDark, 1); g.fillRect(7, 6, 2, 20); g.fillRect(27, 6, 2, 20);
    g.lineStyle(1.4, PAL.oak, 1); g.lineBetween(8, 12, 28, 12);
    g.fillStyle(PAL.clay, 1); g.fillTriangle(3, 9, 33, 9, 18, 0);
    g.fillStyle(PAL.clayDark, 1); g.fillTriangle(18, 9, 33, 9, 18, 0);
    g.fillStyle(0x7a5a3a, 1); g.fillRect(15, 14, 6, 5);
    tex(g, 'well', 36, 42);
  }
  // ---- Bridge (spans one tile along the gy axis; repeated across the river).
  {
    g.fillStyle(0x3a2a1a, 1);
    g.fillRect(10, 18, 3, 14); g.fillRect(51, 18, 3, 14);
    g.fillStyle(0x9a7048, 1);
    g.fillPoints([{ x: 0, y: 16 }, { x: 32, y: 0 }, { x: 64, y: 16 }, { x: 32, y: 32 }], true);
    g.lineStyle(1, 0x6b4a2a, 0.9);
    for (let i = 1; i < 8; i++) g.lineBetween(i * 4, 16 - i * 2, 32 + i * 4, 32 - i * 2);
    g.fillStyle(0x6b4a2a, 1);
    g.fillPoints([{ x: 0, y: 16 }, { x: 32, y: 32 }, { x: 32, y: 35 }, { x: 0, y: 19 }], true);
    g.fillPoints([{ x: 32, y: 32 }, { x: 64, y: 16 }, { x: 64, y: 19 }, { x: 32, y: 35 }], true);
    // Railings.
    g.lineStyle(1.6, 0x5c3a20, 1);
    g.lineBetween(2, 11, 34, -5 + 16 - 11 + 16); // left rail (back)
    g.lineBetween(30, 27, 62, 11);
    for (const [x, y] of [[2, 16], [16, 9], [30, 32], [46, 24], [62, 16]] as Array<[number, number]>) g.lineBetween(x, y, x, y - 6);
    tex(g, 'bridge', 64, 40);
  }

  // ---- Farm props.
  {
    shadow(g, 16, 26, 30, 9);
    g.fillStyle(0xb8903c, 1); g.fillEllipse(16, 18, 28, 20);
    g.fillStyle(0xdcb55c, 1); g.fillEllipse(14, 14, 24, 16);
    g.lineStyle(1, 0x9a7a3c, 0.7);
    for (let i = 0; i < 9; i++) g.lineBetween(5 + i * 2.6, 20 - (i % 3), 7 + i * 2.6, 8 + (i % 2) * 2);
    tex(g, 'haystack', 32, 30);
  }
  {
    g.fillStyle(PAL.oakDark, 1); g.fillRect(12, 6, 2, 30); g.fillRect(4, 14, 18, 2);
    g.fillStyle(0x7a4a8a, 1); g.fillRect(8, 15, 10, 10);
    g.fillStyle(0xdcb55c, 1); g.fillCircle(13, 9, 4.6);
    g.fillStyle(0xc9a45c, 1); g.fillEllipse(13, 5, 14, 3); g.fillRect(10, 1, 6, 4);
    g.fillStyle(0xdcb55c, 1); g.fillTriangle(4, 15, 2, 20, 6, 17); g.fillTriangle(22, 15, 24, 20, 20, 17);
    tex(g, 'scarecrow', 26, 38);
  }
  {
    // Fence segment along gx (down-right).
    g.fillStyle(PAL.oakDark, 1);
    for (const x of [1, 15, 29]) g.fillRect(x, 3 + x / 2, 2, 11);
    g.lineStyle(2, PAL.oak, 1);
    g.lineBetween(1, 7, 31, 22); g.lineBetween(1, 11, 31, 26);
    tex(g, 'fence-a', 33, 30);
    g.fillStyle(PAL.oakDark, 1);
    for (const x of [1, 15, 29]) g.fillRect(x, 17 - x / 2, 2, 11);
    g.lineStyle(2, PAL.oak, 1);
    g.lineBetween(1, 21, 31, 6); g.lineBetween(1, 25, 31, 10);
    tex(g, 'fence-b', 33, 30);
  }
  // ---- Containers.
  {
    shadow(g, 12, 23, 22, 7);
    box(g, 12, 24, 10, 5, 11, 0x9a6a3c);
    g.lineStyle(1, PAL.oakDark, 0.9);
    g.lineBetween(2, 8, 12, 24); g.lineBetween(12, 13, 22, 8); g.lineBetween(12, 13, 12, 24);
    g.lineBetween(2, 14, 12, 19); g.lineBetween(12, 19, 22, 14);
    tex(g, 'crate', 24, 28);
  }
  {
    shadow(g, 10, 24, 18, 6);
    g.fillStyle(0x6b4325, 1); g.fillRoundedRect(2, 5, 16, 19, 5);
    g.fillStyle(0x8a5a33, 1); g.fillRoundedRect(2, 5, 10, 19, 5);
    g.fillStyle(0x3a3a40, 1); g.fillRect(2, 8, 16, 1.6); g.fillRect(2, 19, 16, 1.6);
    g.fillStyle(0x5c3a20, 1); g.fillEllipse(10, 5.5, 16, 5);
    g.fillStyle(0x8a5a33, 1); g.fillEllipse(10, 5, 13, 3.6);
    tex(g, 'barrel', 20, 28);
  }
  {
    shadow(g, 10, 18, 18, 6);
    g.fillStyle(0xb89a6a, 1); g.fillEllipse(10, 12, 16, 13);
    g.fillStyle(0xd8c08a, 1); g.fillEllipse(8.5, 10.5, 11, 9);
    g.fillStyle(0x9a7a4a, 1); g.fillRect(8, 3, 4, 3);
    tex(g, 'sack', 20, 22);
  }
  // ---- Smithy props.
  {
    shadow(g, 14, 22, 24, 7);
    g.fillStyle(0x6b4325, 1); g.fillRect(9, 13, 10, 9);
    g.fillStyle(0x3a3f48, 1); g.fillRect(4, 8, 20, 5); g.fillTriangle(24, 8, 28, 9, 24, 12);
    g.fillStyle(0x5d6470, 1); g.fillRect(4, 8, 20, 1.6);
    g.fillStyle(0x3a3f48, 1); g.fillRect(10, 12, 8, 2);
    tex(g, 'anvil', 30, 26);
  }
  {
    g.fillStyle(PAL.oakDark, 1); g.fillRect(2, 6, 2, 26); g.fillRect(26, 6, 2, 26); g.fillRect(2, 8, 26, 2); g.fillRect(2, 24, 26, 2);
    for (let i = 0; i < 4; i++) {
      const x = 6 + i * 6;
      g.fillStyle(0xc9d1da, 1); g.fillRect(x, 1 + (i % 2) * 2, 2, 20);
      g.fillStyle(0x8a5a33, 1); g.fillRect(x - 1, 20 + (i % 2) * 2, 4, 2); g.fillRect(x, 22, 2, 5);
    }
    tex(g, 'weaponrack', 30, 34);
  }
  // ---- Bakery props: bread table.
  {
    shadow(g, 16, 24, 30, 8);
    box(g, 16, 24, 14, 7, 9, 0x8a5a33);
    for (let i = 0; i < 6; i++) {
      const x = 7 + i * 3.6, y = 9 + Math.abs(i - 2.5) * 1.2;
      g.fillStyle(0x8a5a2a, 1); g.fillEllipse(x + 0.6, y + 0.8, 6, 3.6);
      g.fillStyle(0xd08a45, 1); g.fillEllipse(x, y, 6, 3.4);
      g.fillStyle(0xf6d39a, 0.8); g.fillRect(x - 1, y - 1, 2, 0.8);
    }
    tex(g, 'breadtable', 32, 28);
  }
  // ---- Lumber: log pile and sawhorse.
  {
    shadow(g, 18, 26, 34, 9);
    for (let row = 0; row < 3; row++) {
      for (let k = 0; k < 3 - row; k++) {
        const x = 8 + k * 9 + row * 4.5, y = 21 - row * 7;
        g.fillStyle(0x6b4325, 1); g.fillRect(x - 6, y - 3.5, 12, 7);
        g.fillStyle(0xe2b989, 1); g.fillCircle(x + 6, y, 3.6);
        g.lineStyle(0.8, 0xa06a3c, 1); g.strokeCircle(x + 6, y, 1.8);
      }
    }
    tex(g, 'logs', 36, 30);
  }
  // ---- Cart.
  {
    shadow(g, 22, 28, 40, 10);
    box(g, 22, 22, 16, 8, 8, 0x8a5a33);
    g.fillStyle(0xc9a46c, 1); g.fillEllipse(18, 9, 10, 6); g.fillEllipse(26, 10, 10, 6);
    g.fillStyle(0x3a2414, 1); g.fillCircle(12, 24, 6); g.fillCircle(32, 24, 6);
    g.fillStyle(0x8a5a33, 1); g.fillCircle(12, 24, 4.5); g.fillCircle(32, 24, 4.5);
    g.fillStyle(0x3a2414, 1); g.fillCircle(12, 24, 1.4); g.fillCircle(32, 24, 1.4);
    g.lineStyle(2, PAL.oakDark, 1); g.lineBetween(38, 16, 46, 20);
    tex(g, 'cart', 48, 32);
  }
  // ---- Docks: rowing boat and fishing net.
  {
    g.fillStyle(0x000000, 0.2); g.fillEllipse(24, 16, 44, 12);
    g.fillStyle(0x5c3a20, 1); g.fillEllipse(24, 12, 42, 13);
    g.fillStyle(0x8a5a33, 1); g.fillEllipse(24, 10, 38, 10);
    g.fillStyle(0x3a2414, 1); g.fillEllipse(24, 10, 30, 6);
    g.fillStyle(0x8a5a33, 1); g.fillRect(16, 8, 3, 5); g.fillRect(30, 8, 3, 5);
    g.lineStyle(1.4, 0xc9a46c, 1); g.lineBetween(10, 4, 34, 16);
    tex(g, 'boat', 48, 22);
  }
  {
    g.fillStyle(PAL.oakDark, 1); g.fillRect(2, 2, 2, 24); g.fillRect(30, 2, 2, 24);
    g.lineStyle(0.8, 0xe8dcc0, 0.85);
    for (let i = 0; i < 6; i++) { g.lineBetween(3, 4 + i * 3.5, 31, 4 + i * 3.5 + Math.sin(i) * 1.5); g.lineBetween(4 + i * 5, 4, 5 + i * 5, 22); }
    tex(g, 'net', 34, 28);
  }
  // ---- Loom: drying line with dyed cloth.
  {
    g.fillStyle(PAL.oakDark, 1); g.fillRect(1, 2, 2, 28); g.fillRect(43, 2, 2, 28);
    g.lineStyle(1, 0xcfc6b0, 1); g.lineBetween(2, 5, 44, 5);
    const cols = [0x9b6fb5, 0xe9c46a, 0xb5452e, 0x2f7d55, 0x2f5e8e];
    cols.forEach((c, i) => {
      g.fillStyle(c, 1); g.fillRect(5 + i * 8, 5, 7, 13 + (i % 2) * 3);
      g.fillStyle(shade(c, 0.8), 1); g.fillRect(10 + i * 8, 5, 2, 13 + (i % 2) * 3);
    });
    tex(g, 'clothline', 46, 32);
  }
  // ---- Mine ore cart on rails.
  {
    shadow(g, 14, 22, 24, 7);
    g.fillStyle(0x4a4038, 1); g.fillPoints([{ x: 3, y: 9 }, { x: 25, y: 9 }, { x: 22, y: 19 }, { x: 6, y: 19 }], true);
    g.fillStyle(0x2b2b30, 1); g.fillEllipse(14, 9, 20, 6);
    g.fillStyle(0x55555e, 1); g.fillCircle(10, 7, 2); g.fillCircle(16, 6, 2.2);
    g.fillStyle(0x1a1a1e, 1); g.fillCircle(8, 20, 2.6); g.fillCircle(20, 20, 2.6);
    tex(g, 'orecart', 28, 26);
  }
  // ---- Banner on a pole (tinted per merchant colours at runtime).
  {
    g.fillStyle(0x2a2a2e, 1); g.fillRect(2, 0, 2, 44);
    g.fillStyle(0xffffff, 1); g.fillPoints([{ x: 4, y: 3 }, { x: 18, y: 3 }, { x: 18, y: 24 }, { x: 11, y: 20 }, { x: 4, y: 24 }], true);
    g.fillStyle(0xdddddd, 1); g.fillRect(4, 3, 14, 2);
    g.fillStyle(PAL.goldBright, 1); g.fillCircle(3, 0.5, 2);
    tex(g, 'banner', 20, 44);
  }
  // ---- Flower box (wealthy windows) and a gold emblem plaque.
  {
    g.fillStyle(PAL.oakDark, 1); g.fillRect(0, 5, 14, 4);
    const cols = [0xd2643a, 0xf4c96b, 0xe05a8a, 0xffffff];
    for (let i = 0; i < 6; i++) { g.fillStyle(0x4a7a3a, 1); g.fillCircle(2 + i * 2, 4, 2); g.fillStyle(cols[i % 4], 1); g.fillCircle(2 + i * 2, 3, 1.2); }
    tex(g, 'flowerbox', 14, 10);
  }
  // ---- Hanging lantern on a bracket.
  {
    g.fillStyle(0x2a2a2e, 1); g.fillRect(0, 2, 10, 1.4); g.fillRect(8, 2, 1.4, 4);
    g.fillStyle(0x2a2a2e, 1); g.fillRect(5, 6, 7, 8);
    g.fillStyle(PAL.amber, 1); g.fillRect(6, 7, 5, 6);
    tex(g, 'lantern', 14, 16);
  }
  // ---- Ornate street lamp.
  {
    shadow(g, 7, 41, 10, 3);
    g.fillStyle(0x2a2a2e, 1); g.fillRect(5, 10, 3, 31); g.fillRect(3, 38, 7, 3);
    g.fillRect(1, 7, 11, 2); g.fillTriangle(1, 7, 12, 7, 6.5, 2);
    g.fillStyle(PAL.amber, 1); g.fillRect(2.5, 9, 8, 6);
    g.fillStyle(0xfff0c0, 1); g.fillRect(5, 10, 3, 4);
    g.fillStyle(0x2a2a2e, 1); g.fillRect(6, 9, 1, 6);
    tex(g, 'lamp2', 14, 42);
  }
  // ---- Construction scaffolding.
  {
    g.lineStyle(2, 0xb07a48, 1);
    for (const x of [6, 30, 54, 78]) g.lineBetween(x, 6, x, 70);
    for (const y of [20, 40, 60]) g.lineBetween(4, y, 80, y);
    g.lineStyle(1.4, 0x8a5a33, 1);
    g.lineBetween(6, 60, 30, 40); g.lineBetween(30, 40, 54, 20); g.lineBetween(54, 60, 78, 40);
    g.fillStyle(0xc9a46c, 1); g.fillRect(4, 38, 78, 3); g.fillRect(4, 18, 78, 3);
    tex(g, 'scaffold', 84, 72);
  }
  // ---- Particles and small FX.
  {
    g.fillStyle(0xffffff, 1); g.fillCircle(8, 8, 8); tex(g, 'puff2', 16, 16);
    g.fillStyle(0xffffff, 1); g.fillRect(0, 0, 2, 2); tex(g, 'px', 2, 2);
    g.fillStyle(0xffd27a, 1); g.fillCircle(2, 2, 2); tex(g, 'spark', 4, 4);
    // Falling leaf.
    g.fillStyle(0xffffff, 1); g.fillEllipse(4, 3, 8, 4); tex(g, 'leaf', 8, 6);
    // Bird (two wing frames).
    g.lineStyle(1.4, 0x1a1a1e, 1); g.beginPath(); g.moveTo(0, 4); g.lineTo(4, 1); g.lineTo(6, 4); g.lineTo(8, 1); g.lineTo(12, 4); g.strokePath(); tex(g, 'bird0', 12, 6);
    g.lineStyle(1.4, 0x1a1a1e, 1); g.beginPath(); g.moveTo(0, 1); g.lineTo(4, 4); g.lineTo(6, 3); g.lineTo(8, 4); g.lineTo(12, 1); g.strokePath(); tex(g, 'bird1', 12, 6);
    // Soft radial blobs for light pools and fog.
    for (let i = 12; i > 0; i--) { g.fillStyle(0xffffff, 0.06); g.fillEllipse(64, 32, (128 * i) / 12, (64 * i) / 12); }
    tex(g, 'softblob', 128, 64);
    // Price arrows.
    g.fillStyle(0x6fd07a, 1); g.fillTriangle(7, 0, 14, 9, 0, 9); g.fillRect(4, 9, 6, 5); tex(g, 'arrow-up', 14, 14);
    g.fillStyle(0xe5624a, 1); g.fillTriangle(7, 14, 14, 5, 0, 5); g.fillRect(4, 0, 6, 5); tex(g, 'arrow-down', 14, 14);
    // Zzz bubble.
    g.fillStyle(0xffffff, 1); g.fillCircle(2, 2, 2); tex(g, 'dot', 4, 4);
  }
  // ---- Goods tokens per resource (for flying-trade animations).
  for (const [res, [c1, c2]] of Object.entries(RESOURCE_COLOR)) {
    g.fillStyle(0x000000, 0.35); g.fillCircle(9, 10, 8);
    g.fillStyle(0x2a1a10, 1); g.fillCircle(8, 8, 8);
    g.fillStyle(PAL.gold, 1); g.fillCircle(8, 8, 7);
    g.fillStyle(c1, 1); g.fillCircle(8, 8, 5.2);
    g.fillStyle(c2, 1); g.fillCircle(9.5, 9.5, 2.2);
    g.fillStyle(0xffffff, 0.5); g.fillCircle(6, 5.5, 1.6);
    tex(g, `good-${res}`, 18, 18);
  }
  g.fillStyle(PAL.goldBright, 1); g.fillCircle(7, 7, 6.5); g.fillStyle(PAL.gold, 1); g.fillCircle(7, 7, 5); g.fillStyle(0xfff3c4, 1); g.fillRect(5, 4, 2, 5);
  tex(g, 'coin', 14, 14);

  g.destroy();
}
