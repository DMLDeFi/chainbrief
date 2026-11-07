'use client';
import { useMemo, useState } from 'react';
import { CITY_DEFS, findPath, MARKETS, RESOURCES, ROUTES, type CityArchetype, type MarketId, type PublicSnapshot } from '@mon/engine';
import type { Me } from '@/lib/api';
import { RESOURCE_DEFS } from '@/lib/catalog';
import { gold } from '@/lib/format';
import { Badge, Delta } from '../ui';
import { IconClose, ResourceIcon } from '../icons';
import { CharterCard } from './panels/MarketPanel';

const W = 1000, H = 640;
const pt = (c: MarketId) => ({ x: CITY_DEFS[c].pos.x * 10, y: CITY_DEFS[c].pos.y * 6.4 });
function rng(seed: number) { let s = seed; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

/** Curved route between two cities (a gentle arc, so parallel routes don't overlap). */
function routePath(a: MarketId, b: MarketId, bend = 0.12) {
  const p = pt(a), q = pt(b);
  const mx = (p.x + q.x) / 2, my = (p.y + q.y) / 2, dx = q.x - p.x, dy = q.y - p.y;
  return { d: `M${p.x},${p.y} Q${mx - dy * bend},${my + dx * bend} ${q.x},${q.y}`, c: { x: mx - dy * bend, y: my + dx * bend } };
}
function quadAt(p: { x: number; y: number }, c: { x: number; y: number }, q: { x: number; y: number }, t: number) {
  const u = 1 - t; return { x: u * u * p.x + 2 * u * t * c.x + t * t * q.x, y: u * u * p.y + 2 * u * t * c.y + t * t * q.y };
}
const ROUTE_STYLE = {
  road: { stroke: '#b8895a', dash: '10 6', width: 3.2 },
  pass: { stroke: '#c9c1b4', dash: '3 6', width: 3 },
  river: { stroke: '#6fb3d9', dash: '', width: 4 },
  sea: { stroke: '#8fc7e8', dash: '2 9', width: 2.6 },
} as const;

/** Small skyline emblem for each kind of city. */
function Emblem({ kind, size = 1 }: { kind: CityArchetype; size?: number }) {
  const g = '#f4c96b', d = '#2a1d12', s = '#efe2c2';
  const shapes: Record<CityArchetype, React.ReactNode> = {
    capital: (<g><rect x="-16" y="-6" width="32" height="14" fill={s} /><rect x="-20" y="-16" width="8" height="24" fill={s} /><rect x="12" y="-16" width="8" height="24" fill={s} /><path d="M-22 -16h12l-6 -9zM10 -16h12l-6 -9z" fill="#3b5a8a" /><rect x="-5" y="-20" width="10" height="14" fill={s} /><path d="M-7 -20h14l-7 -10z" fill={g} /><rect x="-3" y="1" width="6" height="7" fill={d} /></g>),
    industrial: (<g><path d="M-20 8v-12l8 -5v5l8 -5v5l8 -5v17z" fill="#a8573a" /><rect x="6" y="-20" width="5" height="28" fill="#6b4a3a" /><rect x="13" y="-14" width="5" height="22" fill="#6b4a3a" /><circle cx="9" cy="-24" r="4" fill="#9c958c" opacity=".7" /><circle cx="14" cy="-29" r="5" fill="#9c958c" opacity=".5" /></g>),
    agricultural: (<g><path d="M-18 8v-10l9 -8l9 8v10z" fill="#a0522d" /><path d="M-20 -1l11 -11l11 11" stroke={d} strokeWidth="2" fill="none" /><rect x="6" y="-8" width="9" height="16" fill={s} /><path d="M10 -8l0 -8M4 -14l12 4M4 -10l12 -4" stroke={d} strokeWidth="1.6" /><rect x="-12" y="1" width="6" height="7" fill={g} /></g>),
    port: (<g><rect x="-6" y="-20" width="8" height="28" fill={s} /><path d="M-8 -20h12l-6 -6z" fill="#b5452e" /><circle cx="-2" cy="-15" r="2.4" fill={g} /><path d="M6 6h16l-3 4h-10z" fill="#6b4325" /><path d="M13 6v-16l7 12z" fill={s} /><path d="M-24 10q6 -4 12 0t12 0t12 0t12 0" stroke="#8fc7e8" strokeWidth="2" fill="none" /></g>),
    mining: (<g><path d="M-22 8l12 -22l8 10l6 -8l14 20z" fill="#8c857c" /><path d="M-13 -9l3 -5l3 4z" fill="#f6f6f6" /><path d="M-6 8v-8h10v8" fill={d} /><path d="M-8 0h14" stroke="#b07a48" strokeWidth="2" /><path d="M10 -6l8 8M18 -6l-8 8" stroke={g} strokeWidth="2" /></g>),
    merchant: (<g><rect x="-18" y="-4" width="36" height="12" fill={s} /><path d="M-20 -4h40l-20 -12z" fill="#b4562f" /><rect x="-3" y="-24" width="6" height="12" fill={s} /><path d="M-5 -24h10l-5 -6z" fill="#b4562f" /><path d="M-14 8v-8M-6 8v-8M6 8v-8M14 8v-8" stroke="#c9b895" strokeWidth="2" /><circle cx="0" cy="-19" r="2" fill="#00ec97" /></g>),
  };
  return <g transform={`scale(${size})`}>{shapes[kind]}</g>;
}

export function WorldMap({ world, me, onClose, onVisit, viewCity }: { world: PublicSnapshot; me: Me; onClose: () => void; onVisit: (c: MarketId) => void; viewCity: MarketId }) {
  const [sel, setSel] = useState<MarketId>(viewCity);
  const p = me.player;
  const hasOffice = (c: MarketId) => c === 'nearhaven' || p.charters.includes(c) || p.marketAccess.includes(c);

  // Deterministic terrain: forests, fields and mountains, kept clear of cities.
  const terrain = useMemo(() => {
    const r = rng(1426);
    const near = (x: number, y: number, d: number) => MARKETS.some((c) => Math.hypot(pt(c).x - x, pt(c).y - y) < d);
    const trees: Array<[number, number, number]> = [];
    for (let i = 0; i < 520; i++) {
      const x = r() * W, y = r() * H;
      const inSea = y > 380 + (x < 520 ? Math.max(0, 260 - x * 0.5) * -0.4 : 999) && x < 560 && y > 420 - x * 0.08;
      if (inSea || near(x, y, 60) || (x > 820 && y < 380)) continue;
      const cluster = Math.sin(x / 70) * Math.cos(y / 55) > 0.15;
      if (cluster) trees.push([x, y, 4 + r() * 4]);
    }
    const mountains: Array<[number, number, number]> = [];
    for (let i = 0; i < 46; i++) { const x = 760 + r() * 240, y = 40 + r() * 330; if (!near(x, y, 40)) mountains.push([x, y, 22 + r() * 30]); }
    const fields: Array<[number, number, number, string]> = [];
    const gv = pt('goldenvale');
    for (let i = 0; i < 40; i++) { const a = r() * Math.PI * 2, d = 45 + r() * 90; fields.push([gv.x + Math.cos(a) * d, gv.y + Math.sin(a) * d * 0.7, r() * 40 - 20, ['#d9b45a', '#c9a24a', '#a8b85a', '#e3c46a'][i % 4]]); }
    return { trees, mountains, fields };
  }, []);

  const routes = useMemo(() => ROUTES.map((rt, i) => ({ ...rt, ...routePath(rt.a, rt.b, i % 2 ? 0.1 : -0.1) })), []);
  const routeFor = (a: MarketId, b: MarketId) => routes.find((x) => (x.a === a && x.b === b) || (x.a === b && x.b === a));

  // Caravans and shipments on the road, placed along their path by progress.
  const traffic = (world.traffic ?? []).map((t) => {
    const path = findPath(t.from, t.to);
    if (!path) return null;
    const progress = Math.max(0, Math.min(1, 1 - (t.arriveTick - world.tick) / path.hours));
    let acc = 0; const target = progress * path.hours;
    for (let i = 0; i < path.cities.length - 1; i++) {
      const a = path.cities[i], b = path.cities[i + 1], rt = routeFor(a, b)!;
      if (acc + rt.hours >= target || i === path.cities.length - 2) {
        const local = Math.max(0, Math.min(1, (target - acc) / rt.hours));
        const forward = rt.a === a;
        const P = pt(rt.a), Q = pt(rt.b);
        return { ...t, pos: quadAt(P, rt.c, Q, forward ? local : 1 - local) };
      }
      acc += rt.hours;
    }
    return null;
  }).filter(Boolean) as Array<NonNullable<PublicSnapshot['traffic']>[number] & { pos: { x: number; y: number } }>;

  const def = CITY_DEFS[sel];
  const m = world.markets[sel];
  const home = world.markets.nearhaven;
  const diffs = RESOURCES.map((r) => ({ r, d: (m.resources[r].price - home.resources[r].price) / home.resources[r].price })).sort((a, b) => a.d - b.d);
  const pop = world.cities?.[sel]?.population ?? def.population;
  const path = sel !== 'nearhaven' ? findPath('nearhaven', sel) : null;

  return (
    <div className="panel-glass pointer-events-auto relative flex h-full w-full flex-col overflow-hidden rounded-2xl bg-[#0d1410]/95 backdrop-blur-sm animate-rise md:flex-row" role="dialog" aria-label="World map">
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div className="px-4 pt-4 md:absolute md:left-4 md:top-4 md:z-10 md:p-0">
          <div className="display text-xl font-bold text-brass-bright">The Realm of Nearhaven</div>
          <div className="text-xs text-muted">Six cities · {ROUTES.length} trade routes · {traffic.length} caravans on the road</div>
        </div>
        <button onClick={onClose} className="btn btn-ghost absolute right-3 top-3 z-10 h-9 w-9 !p-0 md:hidden" aria-label="Close map"><IconClose size={18} /></button>
        <svg viewBox={`0 0 ${W} ${H}`} className="min-h-0 w-full flex-1" preserveAspectRatio="xMidYMid meet">
          <defs>
            <radialGradient id="land" cx="55%" cy="40%" r="75%"><stop offset="0" stopColor="#5f7a43" /><stop offset=".7" stopColor="#4a6436" /><stop offset="1" stopColor="#34482a" /></radialGradient>
            <linearGradient id="sea" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#1f4f6b" /><stop offset="1" stopColor="#173a52" /></linearGradient>
            <pattern id="waves" width="40" height="18" patternUnits="userSpaceOnUse"><path d="M0 9q10 -6 20 0t20 0" stroke="#3d7fa3" strokeWidth="1.2" fill="none" opacity=".5" /></pattern>
            <filter id="soft"><feGaussianBlur stdDeviation="1.4" /></filter>
          </defs>
          <rect width={W} height={H} fill="url(#land)" />
          {/* Sea along the south-west, with the coast Port Aurora sits on. */}
          <path d="M0 330 C90 360 120 430 150 470 C190 520 300 560 420 590 C480 605 540 640 560 640 L0 640 Z" fill="url(#sea)" />
          <path d="M0 330 C90 360 120 430 150 470 C190 520 300 560 420 590 C480 605 540 640 560 640 L0 640 Z" fill="url(#waves)" />
          <path d="M0 330 C90 360 120 430 150 470 C190 520 300 560 420 590 C480 605 540 640 560 640" stroke="#d9c79a" strokeWidth="3" fill="none" opacity=".55" />
          {/* The Silverrun: from the northern hills past Goldenvale, joined by Nearhaven's branch, into the sea at Port Aurora. */}
          <path d="M250 0 C270 80 300 140 300 192 C300 260 340 320 350 400 C355 440 230 450 165 470" stroke="#6fb3d9" strokeWidth="7" fill="none" opacity=".85" />
          <path d="M460 333 C430 370 390 380 352 405" stroke="#6fb3d9" strokeWidth="5" fill="none" opacity=".85" />
          {terrain.fields.map(([x, y, rot, c], i) => <rect key={`f${i}`} x={x - 14} y={y - 9} width="28" height="18" fill={c} opacity=".75" transform={`rotate(${rot} ${x} ${y})`} />)}
          {terrain.trees.map(([x, y, s], i) => <g key={`t${i}`}><circle cx={x + 1.5} cy={y + 2} r={s} fill="#1f3320" opacity=".5" /><circle cx={x} cy={y} r={s} fill={i % 3 ? '#2f5a33' : '#3d6b3a'} /></g>)}
          {terrain.mountains.sort((a, b) => a[1] - b[1]).map(([x, y, s], i) => (
            <g key={`m${i}`}><path d={`M${x - s} ${y + s * 0.6} L${x} ${y - s * 0.8} L${x + s} ${y + s * 0.6} Z`} fill={i % 2 ? '#7d766c' : '#8c857c'} /><path d={`M${x} ${y - s * 0.8} L${x + s} ${y + s * 0.6} L${x + s * 0.2} ${y + s * 0.6} Z`} fill="#5f5850" opacity=".6" /><path d={`M${x - s * 0.28} ${y - s * 0.38} L${x} ${y - s * 0.8} L${x + s * 0.28} ${y - s * 0.38} Z`} fill="#f2f2ee" /></g>
          ))}
          {/* Trade routes */}
          {routes.map((rt) => {
            const st = ROUTE_STYLE[rt.kind];
            const active = rt.a === sel || rt.b === sel;
            return (
              <g key={rt.name}>
                <path d={rt.d} stroke="#140f0b" strokeWidth={st.width + 3} fill="none" opacity=".35" strokeDasharray={st.dash} />
                <path d={rt.d} stroke={st.stroke} strokeWidth={active ? st.width + 1.5 : st.width} fill="none" strokeDasharray={st.dash} opacity={active ? 1 : 0.8} />
                <text x={rt.c.x * 0.5 + (pt(rt.a).x + pt(rt.b).x) * 0.25} y={rt.c.y * 0.5 + (pt(rt.a).y + pt(rt.b).y) * 0.25 - 6} fontSize="11" fill="#efe2c2" opacity={active ? 0.95 : 0.55} textAnchor="middle" style={{ fontFamily: 'var(--font-sans)' }}>{rt.name} · {rt.hours}h</text>
              </g>
            );
          })}
          {/* Caravans */}
          {traffic.map((t) => (
            <g key={t.id} transform={`translate(${t.pos.x} ${t.pos.y})`}>
              <circle r="7" fill={t.kind === 'merchant' ? '#f4c96b' : '#00ec97'} stroke="#140f0b" strokeWidth="2" />
              <title>{t.kind === 'merchant' ? `${t.name}'s caravan to ${CITY_DEFS[t.to].name}` : `${t.name}'s shipment to ${CITY_DEFS[t.to].name}`}</title>
            </g>
          ))}
          {/* Cities */}
          {MARKETS.map((c) => {
            const q = pt(c), d = CITY_DEFS[c];
            const size = 0.9 + Math.min(1.1, (world.cities?.[c]?.population ?? d.population) / 2600);
            const isSel = sel === c;
            return (
              <g key={c} transform={`translate(${q.x} ${q.y})`} className="cursor-pointer" onClick={() => setSel(c)} role="button" aria-label={d.name}>
                <ellipse cx="0" cy="12" rx={34 * size} ry={11 * size} fill="#140f0b" opacity=".45" filter="url(#soft)" />
                <circle r={30 * size} fill={isSel ? 'rgba(244,201,107,0.22)' : 'rgba(20,15,11,0.35)'} stroke={isSel ? '#f4c96b' : 'rgba(244,201,107,0.4)'} strokeWidth={isSel ? 2.5 : 1.2} />
                <Emblem kind={d.archetype} size={size * 1.15} />
                {hasOffice(c) && c !== 'nearhaven' && <g transform={`translate(${24 * size} ${-26 * size})`}><path d="M0 0v16" stroke="#2a1d12" strokeWidth="2" /><path d="M1 0l12 4l-12 4z" fill="#f4c96b" /></g>}
                <text y={44 * size} textAnchor="middle" fontSize="17" fontWeight="700" fill="#f6e7c1" stroke="#140f0b" strokeWidth="4" paintOrder="stroke" style={{ fontFamily: 'var(--font-display)' }}>{d.name}</text>
                <text y={44 * size + 15} textAnchor="middle" fontSize="11" fill="#c9b895" stroke="#140f0b" strokeWidth="3" paintOrder="stroke" style={{ fontFamily: 'var(--font-sans)' }}>{d.title}</text>
              </g>
            );
          })}
        </svg>
        <div className="flex flex-wrap gap-x-3 gap-y-1 px-4 pb-2 text-[11px] text-muted md:absolute md:bottom-3 md:left-4 md:p-0">
          <span className="flex items-center gap-1"><span className="inline-block h-0.5 w-5 bg-[#b8895a]" />Road</span>
          <span className="flex items-center gap-1"><span className="inline-block h-0.5 w-5 bg-[#6fb3d9]" />River</span>
          <span className="flex items-center gap-1"><span className="inline-block h-0.5 w-5 border-t-2 border-dotted border-[#c9c1b4]" />Mountain pass</span>
          <span className="flex items-center gap-1"><span className="inline-block h-0.5 w-5 border-t-2 border-dotted border-[#8fc7e8]" />Sea lane</span>
          <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-full bg-[#f4c96b]" />Merchant caravan</span>
          <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-full bg-[#00ec97]" />Player shipment</span>
        </div>
      </div>

      {/* City card */}
      <aside className="panel-glass m-3 flex max-h-[46vh] w-auto flex-col overflow-hidden md:max-h-none md:w-[360px]">
        <div className="flex items-start gap-3 border-b border-line/70 p-4">
          <div className="min-w-0 flex-1">
            <div className="label !text-brass">{def.title}</div>
            <h2 className="display text-2xl font-bold">{def.name}</h2>
            <div className="text-xs text-muted">Population {pop.toLocaleString()} · {path ? `${path.hours}h from Nearhaven via ${path.cities.length - 1} route${path.cities.length > 2 ? 's' : ''}` : 'Your home city'}</div>
          </div>
          <button onClick={onClose} className="btn btn-ghost h-9 w-9 !p-0 max-md:hidden" aria-label="Close map"><IconClose size={18} /></button>
        </div>
        <div className="scroll-thin min-h-0 flex-1 space-y-4 overflow-y-auto p-4 text-sm">
          <p className="text-parchment-dim">{world.markets[sel].name}. {def.strengths.join(', ')}.</p>
          <div className="flex flex-wrap gap-1.5">{def.needs.map((n) => <Badge key={n} tone="ember">needs {n.toLowerCase()}</Badge>)}</div>
          {sel !== 'nearhaven' && (
            <div>
              <div className="label mb-1.5">Prices vs Nearhaven</div>
              <div className="grid grid-cols-2 gap-1.5">
                {[...diffs.slice(0, 3), ...diffs.slice(-3)].map(({ r, d }) => (
                  <div key={r} className="flex items-center gap-1.5 rounded-lg border border-line/50 bg-black/20 px-2 py-1 text-xs">
                    <ResourceIcon r={r} size={16} /><span className="min-w-0 flex-1 truncate">{RESOURCE_DEFS[r].label}</span><span className="num">{gold(m.resources[r].price)}</span><Delta value={d} className="whitespace-nowrap !text-[10px]" />
                  </div>
                ))}
              </div>
              <p className="mt-1.5 text-[11px] text-muted">Cheaper here than at home (left) and dearer (right). Price gaps are what caravans profit from.</p>
            </div>
          )}
          {hasOffice(sel) ? (
            <div className="rounded-xl border border-moss/40 bg-moss/10 p-3 text-xs text-parchment-dim">
              {sel === 'nearhaven' ? 'Your home city: your warehouse and businesses are here.' : <>You have a trading office here. Trade from the Marketplace ({world.markets[sel].name}) and ship goods from the Inventory panel.</>}
            </div>
          ) : (
            <CharterCard city={sel} me={me} />
          )}
          <button onClick={() => onVisit(sel)} className="btn btn-gold w-full py-2">{`Trade at the ${world.markets[sel].name}`}</button>
        </div>
      </aside>
    </div>
  );
}
