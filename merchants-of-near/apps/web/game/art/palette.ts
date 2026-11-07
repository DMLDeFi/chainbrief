/**
 * Merchants of NEAR — art direction palette and drawing helpers.
 * Every sprite in the game is drawn procedurally from these values, so the
 * world shares one consistent light direction (sun from the upper left), one
 * material language and one colour story: sandstone, oak, emerald, antique
 * gold, amber light and muted medieval stone.
 */
export const PAL = {
  sandstone: 0xe2c99a,
  sandstoneDark: 0xb89a6a,
  plaster: 0xeadfc4,
  oak: 0x8a5a33,
  oakDark: 0x5c3a20,
  oakLight: 0xb07a48,
  stone: 0x9b938a,
  stoneDark: 0x6f6860,
  stoneLight: 0xbdb6ab,
  brick: 0xa8573a,
  brickDark: 0x7a3a26,
  emerald: 0x2f7d55,
  emeraldDark: 0x1f5a3c,
  forest: 0x2d4f33,
  gold: 0xd9a84a,
  goldBright: 0xf4c96b,
  amber: 0xffb347,
  slate: 0x4a5566,
  slateLight: 0x667386,
  clay: 0xb4562f,
  clayDark: 0x86391e,
  thatch: 0xc9a45c,
  thatchDark: 0x9a7a3c,
  navy: 0x2b3a55,
  near: 0x00ec97,
  ink: 0x140f0b,
  white: 0xf6f0e2,
} as const;

export const shade = (c: number, f: number) => {
  const r = Math.max(0, Math.min(255, Math.round(((c >> 16) & 255) * f)));
  const g = Math.max(0, Math.min(255, Math.round(((c >> 8) & 255) * f)));
  const b = Math.max(0, Math.min(255, Math.round((c & 255) * f)));
  return (r << 16) | (g << 8) | b;
};

export const mix = (a: number, b: number, t: number) => {
  const ch = (s: number) => [(a >> s) & 255, (b >> s) & 255];
  const [r1, r2] = ch(16), [g1, g2] = ch(8), [b1, b2] = ch(0);
  return (Math.round(r1 + (r2 - r1) * t) << 16) | (Math.round(g1 + (g2 - g1) * t) << 8) | Math.round(b1 + (b2 - b1) * t);
};

/** Small deterministic RNG so generated art is identical on every load. */
export function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export interface Pt { x: number; y: number }
export const lerp = (a: Pt, b: Pt, t: number): Pt => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
/** Bilinear point inside a quad (a=top-left, b=top-right, c=bottom-right, d=bottom-left). */
export const quadPt = (q: [Pt, Pt, Pt, Pt], u: number, v: number): Pt => lerp(lerp(q[0], q[1], u), lerp(q[3], q[2], u), v);
