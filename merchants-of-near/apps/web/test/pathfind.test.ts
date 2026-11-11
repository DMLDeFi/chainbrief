import { describe, expect, it } from 'vitest';
import { findPath } from '../game/pathfind';

// A 20×20 yard with a wall from (10,0) to (10,15): the only way round is past its end.
const walkable = (gx: number, gy: number) => gx >= 0 && gy >= 0 && gx < 20 && gy < 20 && !(gx > 9.6 && gx < 10.4 && gy < 15);
const clearLine = (a: { gx: number; gy: number }, b: { gx: number; gy: number }) => {
  for (let k = 1; k < 100; k++) if (!walkable(a.gx + ((b.gx - a.gx) * k) / 100, a.gy + ((b.gy - a.gy) * k) / 100)) return false;
  return true;
};

describe('avatar pathfinding', () => {
  it('walks around a wall instead of into it, in a few straight legs', () => {
    const from = { gx: 3, gy: 3 }, to = { gx: 17, gy: 3 };
    const path = findPath(from, to, walkable);
    expect(path.length).toBeGreaterThan(1);
    expect(path.length).toBeLessThan(6);
    let at = from;
    for (const p of path) { expect(clearLine(at, p)).toBe(true); at = p; }
    expect(Math.hypot(at.gx - to.gx, at.gy - to.gy)).toBeLessThan(0.5);
    expect(Math.max(...path.map((p) => p.gy))).toBeGreaterThan(15); // it went past the wall's end
  });

  it('goes straight when nothing is in the way, and aims beside a tap on a wall', () => {
    expect(findPath({ gx: 2, gy: 2 }, { gx: 6, gy: 8 }, walkable)).toHaveLength(1);
    const p = findPath({ gx: 3, gy: 3 }, { gx: 10, gy: 5 }, walkable);
    const end = p[p.length - 1];
    expect(walkable(end.gx, end.gy)).toBe(true);
    expect(Math.hypot(end.gx - 10, end.gy - 5)).toBeLessThan(1.5);
  });
});
