'use client';
import { useState } from 'react';
import { CITY_DEFS, MARKETS, type PublicSnapshot, type Resource } from '@mon/engine';
import { RESOURCE_DEFS, RESOURCES, ROLE_COLOR } from '@/lib/catalog';
import { useFetch } from '@/lib/hooks';
import { gold } from '@/lib/format';
import { Badge, Delta, Drawer, LineChart, Meter, Stat } from '../../ui';
import { IconChart, ResourceIcon } from '../../icons';
import { SupplyChains } from '../SupplyChains';

const PALETTE = ['#d9a84a', '#8fb35f', '#6aa3c8', '#d2643a', '#b98ab0', '#e2c98f'];

export function EconomyPanel({ world, onClose, onMerchant }: { world: PublicSnapshot; onClose: () => void; onMerchant: (id: string) => void }) {
  const { data: history } = useFetch<Record<string, Record<Resource, number[]>>>('/world/history', [world.day]);
  const [picked, setPicked] = useState<Resource[]>(['wheat', 'bread', 'iron']);
  const m = world.markets.nearhaven;
  const toggle = (r: Resource) => setPicked((p) => (p.includes(r) ? p.filter((x) => x !== r) : [...p, r].slice(-6)));
  const series = picked.map((r, i) => ({ name: r, color: PALETTE[i % PALETTE.length], data: (history?.nearhaven?.[r] ?? []).map((v) => v / RESOURCE_DEFS[r].basePrice) }));
  const n = series[0]?.data.length ?? 0;
  const merchantWorth = world.merchants.reduce((s, x) => s + x.netWorth, 0);

  return (
    <Drawer wide title="Economic Dashboard" subtitle="Every figure is read from the live simulation" icon={<IconChart />} onClose={onClose}>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
        <Stat label="Population" value={world.population} sub={`fed ${world.foodSatisfaction}% yesterday`} />
        <Stat label="Volume today" value={`${gold(m.volumeToday)}g`} />
        <Stat label="Guild treasury" value={`${gold(world.guildTreasury)}g`} sub="funds mission rewards" />
        <Stat label="AI merchant wealth" value={`${gold(merchantWorth)}g`} />
        <Stat label="Season" value={<span className="capitalize">{world.season}</span>} sub={<span className="capitalize">{world.weather}</span>} />
      </div>

      <div className="mt-4 overflow-x-auto rounded-xl border border-line/60">
        <table className="w-full text-xs">
          <thead><tr className="text-left text-muted">
            <th className="px-3 py-2 font-semibold">City</th><th className="px-2 py-2 text-right font-semibold">People</th><th className="px-2 py-2 text-right font-semibold">Exchange purse</th>
            {(['wheat', 'bread', 'iron', 'flour', 'steel', 'tools', 'ale', 'furniture'] as Resource[]).map((r) => <th key={r} className="px-2 py-2 text-right font-semibold"><ResourceIcon r={r} size={14} className="ml-auto" /></th>)}
          </tr></thead>
          <tbody>
            {MARKETS.map((id) => (
              <tr key={id} className="border-t border-line/40">
                <td className="px-3 py-1.5"><span className="display font-bold text-parchment">{CITY_DEFS[id].name}</span> <span className="text-muted">· {CITY_DEFS[id].title}</span></td>
                <td className="px-2 py-1.5 text-right tabular-nums">{(id === 'nearhaven' ? world.population : world.cities?.[id]?.population ?? CITY_DEFS[id].population).toLocaleString()}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{gold(world.markets[id].treasury)}g</td>
                {(['wheat', 'bread', 'iron', 'flour', 'steel', 'tools', 'ale', 'furniture'] as Resource[]).map((r) => {
                  const rel = world.markets[id].resources[r].price / RESOURCE_DEFS[r].basePrice;
                  return <td key={r} className={`px-2 py-1.5 text-right tabular-nums ${rel < 0.85 ? 'text-moss' : rel > 1.25 ? 'text-ember' : 'text-parchment-dim'}`}>{gold(world.markets[id].resources[r].price)}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="px-3 pb-2 pt-1 text-[11px] text-muted">Regional prices in gold. Green is cheap for that good, red is dear: each city&apos;s industry and needs show up as price gaps between them.</p>
      </div>

      <div className="mt-4"><SupplyChains world={world} /></div>

      {world.events.length > 0 && (
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {world.events.map((e) => (
            <div key={e.id} className="rounded-xl border border-ember/40 bg-ember/10 p-3">
              <div className="flex justify-between"><span className="display font-bold text-ember">{e.title}</span><span className="text-xs text-muted">{Math.ceil(e.endsInHours / 24)}d left</span></div>
              <p className="mt-1 text-xs text-parchment-dim">{e.description}</p>
            </div>
          ))}
        </div>
      )}

      <div className="panel mt-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="label">Daily closing price ÷ base price · Nearhaven</div>
          <div className="flex flex-wrap gap-1">{series.map((s) => <span key={s.name} className="flex items-center gap-1 text-[11px] capitalize"><span className="h-2 w-2 rounded-full" style={{ background: s.color }} />{s.name}</span>)}</div>
        </div>
        {n >= 2 ? <LineChart series={series} labels={Array.from({ length: n }, (_, i) => `D${world.day - n + i + 1}`)} /> : <p className="py-8 text-center text-sm text-muted">Price history builds up day by day as the town trades.</p>}
        <div className="mt-2 flex flex-wrap gap-1.5">
          {RESOURCES.map((r) => (
            <button key={r} onClick={() => toggle(r)} className={`flex items-center gap-1 rounded-full border px-2 py-1 text-[11px] ${picked.includes(r) ? 'border-brass bg-brass/10 text-brass' : 'border-line text-muted'}`}><ResourceIcon r={r} size={13} />{RESOURCE_DEFS[r].label}</button>
          ))}
        </div>
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wider text-muted">
              <th className="py-2 pl-2">Good</th><th className="text-right">Price</th><th className="text-right">24h</th><th className="pl-4">Supply level</th><th className="text-right">Produced/h</th><th className="text-right">Consumed/h</th><th className="text-right">Demand/h</th><th className="pr-2 text-right">Unmet/h</th>
            </tr>
          </thead>
          <tbody>
            {RESOURCES.map((r) => {
              const d = m.resources[r];
              const lvl = d.stock / RESOURCE_DEFS[r].refStock;
              return (
                <tr key={r} className="border-t border-line/40">
                  <td className="py-2 pl-2"><span className="flex items-center gap-2"><ResourceIcon r={r} size={18} />{RESOURCE_DEFS[r].label}</span></td>
                  <td className="num text-right font-bold">{gold(d.price)}</td>
                  <td className="text-right"><Delta value={(d.price - d.open) / d.open} /></td>
                  <td className="pl-4"><div className="flex items-center gap-2"><div className="w-20"><Meter value={lvl} max={2} color={lvl < 0.4 ? 'var(--color-ember)' : lvl > 1.4 ? 'var(--color-river)' : 'var(--color-moss)'} /></div><span className="num text-[11px] text-muted">{Math.round(lvl * 100)}%</span></div></td>
                  <td className="num text-right">{d.production.toFixed(2)}</td>
                  <td className="num text-right">{d.consumption.toFixed(2)}</td>
                  <td className="num text-right">{d.demand.toFixed(2)}</td>
                  <td className={`num pr-2 text-right ${d.shortage > 0.05 ? 'font-bold text-ember' : 'text-muted'}`}>{d.shortage.toFixed(2)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <h3 className="display mt-6 text-base font-bold">AI merchant health</h3>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {world.merchants.map((x) => (
          <button key={x.id} onClick={() => onMerchant(x.id)} className="flex items-center gap-3 rounded-xl border border-line/60 bg-black/20 px-3 py-2 text-left hover:border-brass-deep">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: ROLE_COLOR[x.role] }} />
            <span className="min-w-0 flex-1 truncate text-sm">{x.name}</span>
            <Badge tone={x.status === 'bankrupt' ? 'ember' : x.status === 'struggling' ? 'brass' : 'moss'}>{x.status}</Badge>
            <span className="num w-16 text-right text-sm">{gold(x.netWorth)}</span>
          </button>
        ))}
      </div>
    </Drawer>
  );
}
