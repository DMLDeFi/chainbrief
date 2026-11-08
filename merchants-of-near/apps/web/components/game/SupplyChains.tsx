'use client';
import { useMemo, useState } from 'react';
import { BUSINESS_DEFS, CITY_DEFS, MARKETS, RESOURCE_DEFS, RESOURCES, type PublicSnapshot, type Resource } from '@mon/engine';
import { gold } from '@/lib/format';
import { ResourceIcon } from '../icons';

interface Edge { from: Resource; to: Resource; by: string }

/** Every recipe in the game as a graph: raw goods on the left, finished goods on the right. */
function buildGraph() {
  const edges: Edge[] = [];
  const makers = new Map<Resource, Set<string>>();
  for (const d of Object.values(BUSINESS_DEFS)) for (const rc of d.recipes) {
    for (const out of Object.keys(rc.outputs) as Resource[]) {
      if (!makers.has(out)) makers.set(out, new Set());
      makers.get(out)!.add(d.name);
      for (const inp of Object.keys(rc.inputs) as Resource[]) if (!edges.some((e) => e.from === inp && e.to === out && e.by === d.name)) edges.push({ from: inp, to: out, by: d.name });
    }
  }
  const depth = new Map<Resource, number>();
  const depthOf = (r: Resource, seen = new Set<Resource>()): number => {
    if (depth.has(r)) return depth.get(r)!;
    if (seen.has(r)) return 0;
    seen.add(r);
    const ins = edges.filter((e) => e.to === r);
    const d = ins.length ? 1 + Math.max(...ins.map((e) => depthOf(e.from, seen))) : 0;
    depth.set(r, d);
    return d;
  };
  for (const r of RESOURCES) depthOf(r);
  const cols: Resource[][] = [[], [], []];
  for (const r of RESOURCES) cols[Math.min(2, depth.get(r) ?? 0)].push(r);
  return { edges, cols, makers };
}

export function SupplyChains({ world }: { world: PublicSnapshot }) {
  const { edges, cols, makers } = useMemo(buildGraph, []);
  const [focus, setFocus] = useState<Resource | null>(null);
  const W = 900, rowH = 46, top = 34, colX = [20, 340, 660], nodeW = 220;
  const H = top + Math.max(...cols.map((c) => c.length)) * rowH + 10;
  const pos = new Map<Resource, { x: number; y: number }>();
  cols.forEach((c, ci) => c.forEach((r, i) => pos.set(r, { x: colX[ci], y: top + i * rowH })));
  const spread = (r: Resource) => {
    const prices = MARKETS.map((c) => ({ c, p: world.markets[c].resources[r].price }));
    prices.sort((a, b) => a.p - b.p);
    return { lo: prices[0], hi: prices[prices.length - 1] };
  };
  const lit = (e: Edge) => !focus || e.from === focus || e.to === focus;
  return (
    <div className="panel overflow-x-auto p-3">
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <div className="label">Supply chains</div>
        <div className="text-[11px] text-muted">Each line is a recipe. Click a good to trace it. Prices: cheapest → dearest city right now.</div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="min-w-[760px]" role="img" aria-label="Production chains between goods">
        {['Raw', 'Processed', 'Finished'].map((t, i) => <text key={t} x={colX[i]} y={16} fontSize="11" fontWeight="700" fill="#c9a24a" letterSpacing="1.5">{t.toUpperCase()}</text>)}
        {edges.map((e, i) => {
          const a = pos.get(e.from)!, b = pos.get(e.to)!;
          const x1 = a.x + nodeW, y1 = a.y + 17, x2 = b.x, y2 = b.y + 17, mx = (x1 + x2) / 2;
          return <path key={i} d={`M${x1} ${y1} C${mx} ${y1} ${mx} ${y2} ${x2} ${y2}`} fill="none" stroke={lit(e) ? '#d9a84a' : '#5a4a35'} strokeOpacity={lit(e) ? 0.85 : 0.35} strokeWidth={lit(e) ? 1.8 : 1}><title>{`${RESOURCE_DEFS[e.from].label} → ${RESOURCE_DEFS[e.to].label} (${e.by})`}</title></path>;
        })}
        {RESOURCES.map((r) => {
          const q = pos.get(r)!;
          const s = spread(r);
          const on = focus === r;
          return (
            <g key={r} transform={`translate(${q.x} ${q.y})`} onClick={() => setFocus(on ? null : r)} className="cursor-pointer">
              <rect width={nodeW} height={36} rx={8} fill={on ? '#3a2e1a' : '#1a140e'} stroke={on ? '#f4c96b' : 'rgba(217,168,74,0.35)'} />
              <foreignObject x={6} y={8} width={20} height={20}><ResourceIcon r={r} size={20} /></foreignObject>
              <text x={32} y={15} fontSize="12" fontWeight="700" fill="#f6e7c1">{RESOURCE_DEFS[r].label}</text>
              <text x={32} y={29} fontSize="9.5" fill="#b9a982">{CITY_DEFS[s.lo.c].name} {gold(s.lo.p)}g → {CITY_DEFS[s.hi.c].name} {gold(s.hi.p)}g</text>
              {makers.get(r) && <text x={nodeW - 6} y={15} fontSize="9" textAnchor="end" fill="#7fb7d6">{[...makers.get(r)!].join(', ')}</text>}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
