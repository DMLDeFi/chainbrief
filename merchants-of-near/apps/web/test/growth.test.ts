import { describe, expect, it } from 'vitest';
import { ALL_DISTRICTS, districtCount, distToDeveloped, growthTile, PLOTS_PER_DISTRICT } from '../game/growth';
import { MAP } from '../game/layout';

describe('town growth districts', () => {
  it('opens one district for every 20% a city has grown', () => {
    const base = { founding: 400, highestPlot: 5, drawnTownPlots: 12 };
    expect(districtCount({ ...base, population: 400 })).toBe(0);
    expect(districtCount({ ...base, population: 479 })).toBe(0);
    expect(districtCount({ ...base, population: 480 })).toBe(1);
    expect(districtCount({ ...base, population: 861 })).toBe(5);
    expect(districtCount({ ...base, population: 100000 })).toBe(ALL_DISTRICTS.length);
  });

  it('opens districts for outskirts land even when the population is flat', () => {
    const base = { founding: 400, population: 400, drawnTownPlots: 12 };
    expect(districtCount({ ...base, highestPlot: 11 })).toBe(0);
    expect(districtCount({ ...base, highestPlot: 12 })).toBe(1);
    expect(districtCount({ ...base, highestPlot: 12 + PLOTS_PER_DISTRICT })).toBe(2);
  });

  it('lays districts outside the original map with no overlapping plots or homes', () => {
    const taken = new Set<string>();
    for (const d of ALL_DISTRICTS) {
      expect(d.x1 < 0 || d.y1 < 0 || d.x0 >= MAP || d.y0 >= MAP).toBe(true);
      expect(d.x0).toBeGreaterThanOrEqual(3); // never in the river
      for (const p of d.plots) for (const [ox, oy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        const k = `${p.gx + ox},${p.gy + oy}`;
        expect(taken.has(k) || d.roads.has(k)).toBe(false);
        taken.add(k);
      }
      for (const h of d.houses) {
        const k = `${h.gx},${h.gy}`;
        expect(taken.has(k) || d.roads.has(k)).toBe(false);
        taken.add(k);
      }
    }
  });

  it('connects each district to the town by its main road', () => {
    const open = ALL_DISTRICTS.slice(0, 3);
    expect(growthTile(open, 15, -1)).toBe('road'); // north, on the gx=15 road
    expect(growthTile(open, MAP, 15)).toBe('road'); // east, on the gy=15 road
    expect(growthTile(open, 15, MAP)).toBe('road'); // south
    expect(growthTile([], 15, -1)).toBeNull();
    expect(distToDeveloped(open, 15, -3)).toBe(0);
    expect(distToDeveloped([], 15, -3)).toBe(3);
  });
});
