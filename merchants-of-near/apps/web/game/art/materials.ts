import type * as Phaser from 'phaser';
import { mix, quadPt, rng, shade, type Pt } from './palette';

/**
 * Surface materials painted onto isometric faces. A face is a quad in screen
 * space; patterns are laid out in the face's own (u, v) coordinates so bricks,
 * planks and tiles follow the perspective of the wall they sit on.
 */
export type WallMaterial = 'brick' | 'stone' | 'timber' | 'planks' | 'plaster' | 'ashlar';
export type RoofMaterial = 'clay' | 'thatch' | 'slate' | 'shingle';

type G = Phaser.GameObjects.Graphics;
type Quad = [Pt, Pt, Pt, Pt];

function poly(g: G, pts: Pt[], color: number, alpha = 1) {
  g.fillStyle(color, alpha);
  g.fillPoints(pts, true);
}
function seg(g: G, q: Quad, u1: number, v1: number, u2: number, v2: number) {
  const a = quadPt(q, u1, v1), b = quadPt(q, u2, v2);
  g.lineBetween(a.x, a.y, b.x, b.y);
}
function cell(g: G, q: Quad, u1: number, v1: number, u2: number, v2: number, color: number, alpha = 1) {
  poly(g, [quadPt(q, u1, v1), quadPt(q, u2, v1), quadPt(q, u2, v2), quadPt(q, u1, v2)], color, alpha);
}

/**
 * Paint a wall face. `widthTiles`/`heightPx` set pattern density so bricks stay
 * the same size on every building. `light` is the face's light factor.
 */
export function paintWall(g: G, q: Quad, mat: WallMaterial, base: number, light: number, widthTiles: number, heightPx: number, seed: number) {
  const r = rng(seed);
  const col = shade(base, light);
  poly(g, q, col);
  const rows = Math.max(3, Math.round(heightPx / 5));
  const cols = Math.max(2, Math.round(widthTiles * 7));
  switch (mat) {
    case 'brick': {
      for (let i = 0; i < rows; i++) {
        const v1 = i / rows, v2 = (i + 1) / rows;
        const off = (i % 2) * 0.5;
        for (let j = -1; j < cols; j++) {
          const u1 = Math.max(0, (j + off) / cols), u2 = Math.min(1, (j + off + 0.92) / cols);
          if (u2 <= u1) continue;
          cell(g, q, u1, v1 + 0.08 / rows, u2, v2 - 0.08 / rows, shade(col, 0.88 + r() * 0.24));
        }
      }
      break;
    }
    case 'stone':
    case 'ashlar': {
      const rr = mat === 'ashlar' ? Math.max(2, Math.round(rows / 1.6)) : rows;
      for (let i = 0; i < rr; i++) {
        const v1 = i / rr, v2 = (i + 1) / rr;
        let u = 0;
        while (u < 1) {
          const w = (mat === 'ashlar' ? 1.6 : 0.8 + r() * 1.4) / cols;
          cell(g, q, u + 0.008, v1 + 0.06 / rr, Math.min(1, u + w) - 0.008, v2 - 0.06 / rr, shade(col, 0.82 + r() * 0.3));
          u += w;
        }
      }
      break;
    }
    case 'planks': {
      const n = Math.round(cols * 0.9);
      for (let j = 0; j < n; j++) cell(g, q, j / n + 0.004, 0, (j + 1) / n - 0.004, 1, shade(col, 0.86 + r() * 0.22));
      g.lineStyle(1, shade(col, 0.55), 0.35);
      for (let j = 1; j < n; j++) seg(g, q, j / n, 0, j / n, 1);
      break;
    }
    case 'timber':
    case 'plaster': {
      // Lime plaster with subtle mottling…
      for (let k = 0; k < 18; k++) {
        const u = r(), v = r();
        cell(g, q, u, v, Math.min(1, u + 0.08), Math.min(1, v + 0.12), shade(col, 0.94 + r() * 0.1), 0.6);
      }
      if (mat === 'timber') {
        // …crossed with dark oak framing.
        const beam = shade(0x5c3a20, light);
        g.lineStyle(2.2, beam, 1);
        seg(g, q, 0, 0.02, 1, 0.02);
        seg(g, q, 0, 0.98, 1, 0.98);
        seg(g, q, 0, 0.5, 1, 0.5);
        const posts = Math.max(2, Math.round(widthTiles * 2));
        for (let j = 0; j <= posts; j++) seg(g, q, j / posts, 0, j / posts, 1);
        g.lineStyle(1.6, beam, 0.9);
        for (let j = 0; j < posts; j++) {
          if (j % 2 === 0) seg(g, q, j / posts, 0.5, (j + 1) / posts, 0.98);
          else seg(g, q, j / posts, 0.98, (j + 1) / posts, 0.5);
        }
      }
      break;
    }
  }
  // Ambient occlusion: walls darken toward the ground, and a lit band under the eaves fades in.
  for (let i = 0; i < 6; i++) cell(g, q, 0, 0.82 + i * 0.03, 1, 0.85 + i * 0.03, 0x000000, 0.04 + i * 0.02);
  cell(g, q, 0, 0, 1, 0.07, 0x000000, 0.18);
}

/** Paint a roof slope. `v` runs from eave (0) to ridge (1). */
export function paintRoof(g: G, q: Quad, mat: RoofMaterial, base: number, light: number, widthTiles: number, seed: number) {
  const r = rng(seed);
  const col = shade(base, light);
  poly(g, q, col);
  const courses = mat === 'thatch' ? 7 : 9;
  if (mat === 'thatch') {
    g.lineStyle(1, shade(col, 0.7), 0.6);
    for (let k = 0; k < widthTiles * 60; k++) {
      const u = r(), v = r();
      seg(g, q, u, v, u + (r() - 0.5) * 0.02, Math.min(1, v + 0.12));
    }
    for (let i = 1; i < courses; i++) {
      g.lineStyle(1.4, shade(col, 0.62), 0.5);
      seg(g, q, 0, i / courses, 1, i / courses);
    }
  } else {
    const per = Math.round(widthTiles * (mat === 'slate' ? 9 : 7));
    for (let i = 0; i < courses; i++) {
      const v1 = i / courses, v2 = (i + 1) / courses;
      const off = (i % 2) * 0.5;
      for (let j = -1; j < per; j++) {
        const u1 = Math.max(0, (j + off) / per), u2 = Math.min(1, (j + off + 0.94) / per);
        if (u2 <= u1) continue;
        cell(g, q, u1, v1, u2, v2 - 0.12 / courses, shade(col, 0.84 + r() * 0.26));
      }
      // Shadow line under each course of tiles.
      g.lineStyle(1, shade(col, 0.5), 0.55);
      seg(g, q, 0, v1, 1, v1);
    }
    if (mat === 'clay') {
      // Rounded highlights on clay pantiles.
      g.lineStyle(1, mix(col, 0xffffff, 0.35), 0.35);
      for (let j = 0; j < per; j++) seg(g, q, (j + 0.3) / per, 0.02, (j + 0.3) / per, 0.98);
    }
  }
  // Eave shadow and moss/weathering speckle.
  cell(g, q, 0, 0, 1, 0.06, 0x000000, 0.25);
  for (let k = 0; k < widthTiles * 6; k++) {
    const u = r(), v = r() * 0.6;
    cell(g, q, u, v, Math.min(1, u + 0.03), Math.min(1, v + 0.04), mat === 'slate' ? 0x7f8c6a : 0x6d7a45, 0.18);
  }
}
