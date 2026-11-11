/**
 * A* over half-tile cells, then shortened to the fewest straight legs, so a tap
 * or a minimap click walks around buildings rather than into them.
 */
export function findPath(from: { gx: number; gy: number }, to: { gx: number; gy: number }, walkable: (gx: number, gy: number) => boolean) {
  const C = 0.5;
  const cell = (v: number) => Math.round(v / C - 0.5);
  const centre = (i: number) => (i + 0.5) * C;
  const free = (i: number, j: number) => walkable(centre(i), centre(j));
  let ti = cell(to.gx), tj = cell(to.gy);
  // A tap on a wall or the river: aim for the nearest open cell instead.
  if (!free(ti, tj)) {
    let best: [number, number] | null = null, bd = Infinity;
    for (let r = 1; r <= 8 && !best; r++) for (let a = -r; a <= r; a++) for (const [i, j] of [[ti + a, tj - r], [ti + a, tj + r], [ti - r, tj + a], [ti + r, tj + a]]) {
      if (free(i, j)) { const d = Math.hypot(i - cell(from.gx), j - cell(from.gy)); if (d < bd) { bd = d; best = [i, j]; } }
    }
    if (!best) return [];
    [ti, tj] = best;
  }
  const si = cell(from.gx), sj = cell(from.gy);
  const key = (i: number, j: number) => i * 4096 + j;
  const h = (i: number, j: number) => Math.hypot(i - ti, j - tj);
  const g = new Map<number, number>([[key(si, sj), 0]]);
  const came = new Map<number, number>();
  const open: Array<[number, number, number]> = [[h(si, sj), si, sj]];
  const closed = new Set<number>();
  let found = false;
  for (let n = 0; open.length && n < 9000; n++) {
    // A small open list: a linear scan for the best is plenty.
    let b = 0;
    for (let k = 1; k < open.length; k++) if (open[k][0] < open[b][0]) b = k;
    const [, i, j] = open.splice(b, 1)[0];
    const kk = key(i, j);
    if (closed.has(kk)) continue;
    closed.add(kk);
    if (i === ti && j === tj) { found = true; break; }
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const ni = i + di, nj = j + dj, nk = key(ni, nj);
      if (closed.has(nk) || !free(ni, nj)) continue;
      if (di && dj && (!free(i + di, j) || !free(i, j + dj))) continue; // no cutting corners
      const cost = (g.get(kk) ?? 0) + (di && dj ? Math.SQRT2 : 1);
      if (cost < (g.get(nk) ?? Infinity)) { g.set(nk, cost); came.set(nk, kk); open.push([cost + h(ni, nj), ni, nj]); }
    }
  }
  if (!found) return [];
  const cells: Array<{ gx: number; gy: number }> = [];
  for (let k: number | undefined = key(ti, tj); k !== undefined; k = came.get(k)) cells.unshift({ gx: centre(Math.floor(k / 4096)), gy: centre(k % 4096) });
  cells.shift(); // the start cell
  if (!cells.length) return [];
  // Keep only the corners: drop a waypoint when the straight line past it is clear.
  const clear = (a: { gx: number; gy: number }, b: { gx: number; gy: number }) => {
    const d = Math.hypot(b.gx - a.gx, b.gy - a.gy), steps = Math.ceil(d / 0.15);
    for (let k = 1; k < steps; k++) if (!walkable(a.gx + ((b.gx - a.gx) * k) / steps, a.gy + ((b.gy - a.gy) * k) / steps)) return false;
    return true;
  };
  const out: Array<{ gx: number; gy: number }> = [];
  let at = from;
  for (let k = 0; k < cells.length; k++) {
    if (k === cells.length - 1 || !clear(at, cells[k + 1])) { out.push(cells[k]); at = cells[k]; }
  }
  return out;
}
