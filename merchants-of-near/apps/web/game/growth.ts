import { MAP } from './layout';

/**
 * Town growth. Beyond the original town map, each city grows outward in
 * districts along its main roads: north, east and south (the west is the
 * river). A district has a cross street, four building plots and twelve homes.
 *
 * Districts open as the city grows: with its population (one district for
 * every 20% it has grown beyond its founding size) and whenever players need
 * more land than the town has (outskirts plots are drawn in the districts).
 */
export type Arm = 'N' | 'E' | 'S';
export interface District {
  id: string;
  name: string;
  arm: Arm;
  depth: number;
  /** Inclusive tile bounds. */
  x0: number; y0: number; x1: number; y1: number;
  roads: Set<string>;
  plots: Array<{ gx: number; gy: number }>;
  houses: Array<{ gx: number; gy: number }>;
  lamps: Array<{ gx: number; gy: number }>;
  center: { gx: number; gy: number };
}

export const DEPTH = 5;
export const MAX_DEPTH = 3;
export const PLOTS_PER_DISTRICT = 4;
const ORDER: Arm[] = ['N', 'E', 'S'];
const NAMES: Record<Arm, string[]> = {
  N: ['Northgate', 'Upper Northgate', 'High Moor'],
  E: ['East Ward', 'Tanners Row', 'Far Eastfield'],
  S: ['Southfields', 'Millbrook', 'Southmarch'],
};

/** Local (u along the cross street, v outward) to town tiles, for one arm. */
function toGrid(arm: Arm, u: number, v: number) {
  if (arm === 'N') return { gx: 15 + u, gy: -v };
  if (arm === 'S') return { gx: 15 + u, gy: MAP - 1 + v };
  return { gx: MAP - 1 + v, gy: 15 + u };
}
/** A w×d rectangle in local coordinates, as its top-left tile in town coordinates. */
function rect(arm: Arm, u0: number, v0: number) {
  const a = toGrid(arm, u0, v0), b = toGrid(arm, u0 + 1, v0 + 1);
  return { gx: Math.min(a.gx, b.gx), gy: Math.min(a.gy, b.gy) };
}

function makeDistrict(arm: Arm, depth: number): District {
  const v0 = DEPTH * (depth - 1) + 1, v1 = DEPTH * depth, street = v0 + 2;
  const roads = new Set<string>();
  const add = (u: number, v: number) => { const g = toGrid(arm, u, v); roads.add(`${g.gx},${g.gy}`); };
  for (let v = v0; v <= v1; v++) add(0, v);
  for (let u = -7; u <= 7; u++) add(u, street);
  const plots = [rect(arm, -5, v0), rect(arm, 3, v0), rect(arm, -5, v1 - 1), rect(arm, 3, v1 - 1)];
  const houses = [-2, 1, 6].flatMap((u) => [v0, v0 + 1, v1 - 1, v1].map((v) => toGrid(arm, u, v)));
  const lamps = [toGrid(arm, -1, street - 1), toGrid(arm, -1, street + 1)].map((g) => ({ gx: g.gx + 0.5, gy: g.gy + 0.5 }));
  const c1 = toGrid(arm, -7, v0), c2 = toGrid(arm, 7, v1);
  const mid = toGrid(arm, 0, street);
  return {
    id: `${arm}${depth}`, name: NAMES[arm][depth - 1], arm, depth,
    x0: Math.min(c1.gx, c2.gx), x1: Math.max(c1.gx, c2.gx), y0: Math.min(c1.gy, c2.gy), y1: Math.max(c1.gy, c2.gy),
    roads, plots, houses, lamps, center: { gx: mid.gx + 0.5, gy: mid.gy + 0.5 },
  };
}

/** Every district a town can grow, in the order they open. */
export const ALL_DISTRICTS: District[] = Array.from({ length: MAX_DEPTH }, (_, d) => ORDER.map((arm) => makeDistrict(arm, d + 1))).flat();

/** How many districts a city has, from its population and the land players hold. */
export function districtCount(opts: { population: number; founding: number; highestPlot: number; drawnTownPlots: number }): number {
  const byPopulation = Math.floor(Math.max(0, opts.population / Math.max(1, opts.founding) - 1) / 0.2 + 1e-9);
  const extra = opts.highestPlot + 1 - opts.drawnTownPlots;
  const byLand = extra > 0 ? Math.ceil(extra / PLOTS_PER_DISTRICT) : 0;
  return Math.min(ALL_DISTRICTS.length, Math.max(byPopulation, byLand));
}

/** The road continues out of town to the edge of the furthest district on each arm. */
export function growthTile(open: District[], gx: number, gy: number): 'road' | 'grass' | null {
  for (const d of open) {
    if (gx < d.x0 || gx > d.x1 || gy < d.y0 || gy > d.y1) continue;
    return d.roads.has(`${gx},${gy}`) ? 'road' : 'grass';
  }
  return null;
}

/** Tile bounds the ground must cover: the town, its districts, and a five-tile ring of countryside. */
export function growthExtent(open: District[]) {
  const ring = 5;
  let x0 = 0, y0 = 0, x1 = MAP - 1, y1 = MAP - 1;
  for (const d of open) { x0 = Math.min(x0, d.x0); y0 = Math.min(y0, d.y0); x1 = Math.max(x1, d.x1); y1 = Math.max(y1, d.y1); }
  return { x0: x0 - ring, y0: y0 - ring, x1: x1 + ring, y1: y1 + ring };
}

/** Chebyshev distance from a tile to the developed area (0 inside the town or a district). */
export function distToDeveloped(open: District[], gx: number, gy: number): number {
  const box = (x0: number, y0: number, x1: number, y1: number) => Math.max(x0 - gx, gx - x1, y0 - gy, gy - y1, 0);
  let best = box(0, 0, MAP - 1, MAP - 1);
  for (const d of open) best = Math.min(best, box(d.x0, d.y0, d.x1, d.y1));
  return best;
}
