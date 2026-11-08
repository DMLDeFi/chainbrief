'use client';
import { useState } from 'react';
import { CITY_DEFS, INDUSTRIES, INDUSTRY_OF, landDef, MARKETS, RESOURCES, type BusinessKind, type MarketId, type PublicSnapshot } from '@mon/engine';
import { api, type Me } from '@/lib/api';
import { BUSINESS_DEFS, LEVELS, RESOURCE_DEFS } from '@/lib/catalog';
import { useAction } from '@/lib/hooks';
import { nearConfig, sendContractCall } from '@/lib/near';
import { refreshMe, toast } from '@/lib/store';
import { gold } from '@/lib/format';
import type { Selection } from '@/game/TownScene';
import { Badge, Drawer, Empty, LineChart, Meter, Stat } from '../../ui';
import { Coin, IconHouse, ResourceIcon } from '../../icons';

type OwnedBiz = Me['player']['businesses'][number];

export function BusinessPanel({ world, me, selection, onClose, city: viewCity = 'nearhaven' }: { world: PublicSnapshot; me: Me; selection: Selection | null; onClose: () => void; city?: MarketId }) {
  const p = me.player;
  const sel = selection?.type === 'plot' ? selection : null;
  const [focus, setFocus] = useState<string | null>(sel ? sel.businessId ?? null : p.businesses[0]?.id ?? null);
  const other = sel?.businessId && sel.ownerId !== me.user.id ? world.businesses.find((b) => b.id === sel.businessId) : null;
  const current = focus && focus !== 'property' ? p.businesses.find((b) => b.id === focus) : undefined;
  const byCity = MARKETS.map((c) => [c, p.businesses.filter((b) => b.city === c)] as const).filter(([, list]) => list.length > 0);
  const companyProfit = p.businesses.reduce((s, b) => s + (b.history.at(-1)?.profit ?? 0), 0);

  return (
    <Drawer wide title="Businesses & Property" subtitle="Build across the realm, invest in land and grow an empire" icon={<IconHouse />} onClose={onClose}>
      {other && (
        <div className="mb-4 rounded-xl border border-line/60 bg-black/20 p-3 text-sm">
          This {other.kind} belongs to <b>{other.owner}</b> (level {other.level}). Deeded businesses can be bought from their owner on NEAR — see the Wallet panel.
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
        <div className="space-y-2">
          <div className="flex items-baseline justify-between">
            <span className="label">Your company</span>
            {p.businesses.length > 0 && <span className={`num text-[11px] ${companyProfit >= 0 ? 'text-moss' : 'text-ember'}`}>{companyProfit >= 0 ? '+' : ''}{gold(companyProfit)}g yesterday</span>}
          </div>
          {p.businesses.length === 0 && <p className="text-xs text-muted">You own no businesses yet.</p>}
          {byCity.map(([c, list]) => (
            <div key={c} className="space-y-1.5">
              <div className="pt-1 text-[10px] font-bold uppercase tracking-[0.14em] text-brass">{CITY_DEFS[c].name}</div>
              {list.map((b) => {
                const last = b.history.at(-1);
                return (
                  <button key={b.id} onClick={() => setFocus(b.id)} className={`w-full rounded-xl border px-3 py-2 text-left ${focus === b.id ? 'border-brass bg-brass/10' : 'border-line/60 bg-black/20 hover:border-brass-deep'}`}>
                    <div className="flex items-center justify-between text-sm font-semibold"><span>{b.def.name}</span><LevelPips level={b.level} max={b.maxLevel} /></div>
                    <div className="num text-[11px] text-muted">{b.workers} workers · {last ? <span className={last.profit >= 0 ? 'text-moss' : 'text-ember'}>{last.profit >= 0 ? '+' : ''}{gold(last.profit)}g yesterday</span> : 'new'}</div>
                    {b.idle && <div className="text-[10px] font-semibold uppercase tracking-wide text-ember">⚠ {b.idle === 'inputs-too-dear' ? 'inputs too dear' : b.idle === 'no-inputs' ? 'nothing to sell' : b.idle === 'store-full' ? 'store full' : 'stock full'}</div>}
                    {b.deedTokenId && <Badge tone="near">deed on NEAR</Badge>}
                  </button>
                );
              })}
            </div>
          ))}
          {p.overhead > 1 && <p className="text-[11px] text-muted">Company overhead: upkeep ×{p.overhead.toFixed(2)} for running {p.businesses.length} businesses.</p>}
          <button onClick={() => setFocus('property')} className={`w-full rounded-xl border px-3 py-2.5 text-left text-sm ${focus === 'property' ? 'border-brass bg-brass/10 text-brass' : 'border-line/60 bg-black/20 text-parchment-dim hover:border-brass-deep'}`}>
            Land & property{p.land.length > 0 && <span className="text-muted"> · {p.land.length} plot{p.land.length === 1 ? '' : 's'}</span>}
          </button>
          <button onClick={() => setFocus(null)} className={`w-full rounded-xl border border-dashed px-3 py-2.5 text-left text-sm ${focus === null ? 'border-brass text-brass' : 'border-line text-parchment-dim hover:border-brass-deep'}`}>+ Open a new business</button>
        </div>
        <div>
          {current ? <Detail b={current} me={me} world={world} /> : focus === 'property' ? <Property me={me} world={world} /> : <Catalog me={me} world={world} initialCity={(sel?.city as MarketId | undefined) ?? viewCity} onBought={(id) => setFocus(id)} />}
        </div>
      </div>
    </Drawer>
  );
}

export function LevelPips({ level, max }: { level: number; max: number }) {
  return (
    <span className="flex gap-0.5" aria-label={`Level ${level} of ${max}`}>
      {Array.from({ length: max }, (_, i) => <span key={i} className={`h-1.5 w-2.5 rounded-sm ${i < level ? 'bg-brass-bright' : 'bg-line/60'}`} />)}
    </span>
  );
}

function fitLabel(a: number) {
  if (a === 1) return null;
  if (a <= 0) return <Badge tone="ember">not possible here</Badge>;
  const pct = Math.round(Math.abs(a - 1) * 100);
  return <Badge tone={a > 1 ? 'moss' : 'ember'}>{a > 1 ? `+${pct}% here` : `−${pct}% here`}</Badge>;
}

function Catalog({ me, world, onBought, initialCity }: { me: Me; world: PublicSnapshot; onBought: (id: string) => void; initialCity: MarketId }) {
  const { run, busy } = useAction();
  const p = me.player;
  const [city, setCity] = useState<MarketId>(initialCity);
  const quotes = p.quotes[city];
  const land = world.cityLand[city];
  const free = land.plots - land.taken;
  const ld = landDef(city);
  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-1.5">
        {MARKETS.map((c) => {
          const open = !!p.quotes[c];
          return (
            <button key={c} onClick={() => setCity(c)} className={`rounded-lg border px-2.5 py-1 text-xs ${city === c ? 'border-brass bg-brass/15 text-brass-bright' : 'border-line/60 text-parchment-dim hover:border-brass-deep'}`}>
              {CITY_DEFS[c].name}{!open && ' 🔒'}
            </button>
          );
        })}
      </div>
      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Plots free" value={`${free} / ${land.plots}`} />
        <Stat label="Land price" value={`${gold(land.price)}g`} sub={`prosperity ×${land.prosperity}`} />
        <Stat label="Building costs" value={`×${ld.build}`} sub="vs Nearhaven" />
        <Stat label="Local wages" value={`×${ld.wages}`} sub="vs Nearhaven" />
      </div>
      {!quotes ? (
        <Empty>Open a trading office in {CITY_DEFS[city].name} (World Map or Marketplace) before building there.</Empty>
      ) : (
        <>
          <p className="mb-3 text-xs text-muted">
            Businesses run automatically every hour on the {world.markets[city].name}: they buy inputs, produce, sell above your floor price and pay local wages each dawn.
            {quotes.farm.grant && ' The guild grants your first Nearhaven plot for free.'}
            {quotes.farm.ownLand && ' You own a vacant plot here, so you only pay for the building.'}
          </p>
          {INDUSTRIES.map((ind) => (
          <div key={ind.id} className="mb-4">
          <div className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-brass">{ind.label}</div>
          <div className="grid gap-2.5 sm:grid-cols-2">
            {(Object.keys(BUSINESS_DEFS) as BusinessKind[]).filter((k) => INDUSTRY_OF[k] === ind.id).map((k) => {
              const d = BUSINESS_DEFS[k];
              const q = quotes[k];
              const impossible = q.affinity <= 0;
              const locked = p.level < d.requiredLevel || impossible;
              const recipe = d.recipes[0];
              return (
                <div key={k} className={`rounded-xl border p-3.5 ${locked ? 'border-line/40 bg-black/10 opacity-70' : 'border-line/70 bg-black/20'}`}>
                  <div className="flex items-center justify-between gap-2">
                    <h4 className="display font-bold">{d.name}</h4>
                    <span className="num flex items-center gap-1 text-sm font-bold text-brass-bright"><Coin size={14} />{gold(q.total)}</span>
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
                    <span>{gold(q.build)}g building{q.land > 0 ? ` + ${gold(q.land)}g land` : q.grant ? ' · free starter plot' : q.ownLand ? ' · on your plot' : ''}</span>
                    {fitLabel(q.affinity)}
                  </div>
                  <p className="mt-1 text-xs leading-snug text-muted">{d.description}</p>
                  {d.recipes.length > 1 && <div className="mt-1 text-[11px] text-river">{d.recipes.length} recipes: {d.recipes.map((x) => x.name).join(' · ')}</div>}
                  {recipe && (
                    <div className="mt-2 flex items-center gap-1.5 text-[11px] text-parchment-dim">
                      {Object.entries(recipe.inputs).map(([r, n]) => <span key={r} className="flex items-center gap-0.5">{n}<ResourceIcon r={r} size={14} /></span>)}
                      {Object.keys(recipe.inputs).length > 0 && <span>→</span>}
                      {Object.entries(recipe.outputs).map(([r, n]) => <span key={r} className="flex items-center gap-0.5">{n}<ResourceIcon r={r} size={14} /></span>)}
                    </div>
                  )}
                  <div className="mt-2 text-[11px] text-muted">Wage {gold(d.wage * ld.wages)}g/worker/day · upkeep {d.upkeep}g × level</div>
                  <button disabled={busy || locked || p.gold < q.total || q.plotsFree <= 0} onClick={async () => { const b = await run<{ id: string }>({ type: 'business.buy', kind: k, city }, `${d.name} opened in ${CITY_DEFS[city].name}!`); if (b) onBought(b.id); }} className="btn btn-gold mt-3 w-full py-1.5 text-sm">
                    {impossible ? `Not possible in ${CITY_DEFS[city].name}` : locked ? `Requires Lv ${d.requiredLevel} · ${LEVELS[d.requiredLevel - 1].title}` : q.plotsFree <= 0 ? 'No plots left here' : p.gold < q.total ? `Need ${gold(q.total)}g` : `Build in ${CITY_DEFS[city].name}`}
                  </button>
                </div>
              );
            })}
          </div>
          </div>
          ))}
        </>
      )}
    </div>
  );
}

function Property({ me, world }: { me: Me; world: PublicSnapshot }) {
  const { run, busy } = useAction();
  const p = me.player;
  const held = (c: MarketId) => p.land.filter((l) => l.city === c);
  const built = (c: MarketId) => p.businesses.filter((b) => b.city === c).length;
  const totalValue = p.land.reduce((s, l) => s + l.value, 0);
  const dailyTax = p.land.reduce((s, l) => s + l.tax, 0);
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Stat label="Vacant land" value={`${p.land.length} plot${p.land.length === 1 ? '' : 's'}`} sub={`worth ${gold(totalValue)}g`} />
        <Stat label="Land tax" value={`${gold(dailyTax)}g/day`} sub="1% of value, plus built plots" />
        <Stat label="Arrears" value={<span className={p.taxArrears > 0 ? 'text-ember' : ''}>{gold(p.taxArrears)}g</span>} sub={p.taxArrears > 0 ? 'unpaid tax: vacant land can be repossessed' : 'all paid'} />
      </div>
      <p className="text-xs text-muted">Land is bought from the city, so the money goes into its purse. Prices rise as a city fills up and as it prospers, and fall back when owners sell. Holding land costs tax. You can build on a plot you own, or sell it back at today&apos;s value less 5%.</p>
      <div className="overflow-x-auto rounded-xl border border-line/60">
        <table className="w-full text-xs">
          <thead><tr className="text-left text-muted"><th className="px-3 py-2">City</th><th className="px-2 py-2 text-right">Plots taken</th><th className="px-2 py-2 text-right">Next plot</th><th className="px-2 py-2 text-right">Yours</th><th className="px-3 py-2" /></tr></thead>
          <tbody>
            {MARKETS.map((c) => {
              const l = world.cityLand[c];
              const mine = held(c);
              const open = !!p.quotes[c];
              return (
                <tr key={c} className="border-t border-line/40">
                  <td className="px-3 py-2"><span className="display font-bold text-parchment">{CITY_DEFS[c].name}</span><div className="text-[10px] text-muted">{CITY_DEFS[c].title}</div></td>
                  <td className="px-2 py-2 text-right tabular-nums">{l.taken} / {l.plots}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{gold(l.price)}g</td>
                  <td className="px-2 py-2 text-right tabular-nums">{mine.length} vacant · {built(c)} built</td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-1.5">
                      <button disabled={busy || !open || l.taken >= l.plots || p.gold < l.price} onClick={() => run({ type: 'land.buy', city: c }, `Bought a plot in ${CITY_DEFS[c].name}`)} className="btn btn-gold px-2.5 py-1 text-[11px]">{open ? 'Buy plot' : '🔒 office'}</button>
                      <button disabled={busy || mine.length === 0} onClick={() => run({ type: 'land.sell', city: c }, `Sold a plot in ${CITY_DEFS[c].name}`)} className="btn btn-ghost px-2.5 py-1 text-[11px]">Sell{mine.length ? ` · ${gold(mine[0].value * 0.95)}g` : ''}</button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Detail({ b, me, world }: { b: OwnedBiz; me: Me; world: PublicSnapshot }) {
  const { run, busy } = useAction();
  const [minPrice, setMinPrice] = useState(b.policy.minSellPrice);
  const [deedBusy, setDeedBusy] = useState(false);
  const h = b.history.slice(-20);
  const profit = b.totals.revenue - b.totals.expenses;
  const used = Object.values(b.inventory).reduce((s, q) => s + (q ?? 0), 0);
  const recipe = b.def.recipes.find((r) => r.name === b.policy.recipe) ?? (b.kind === 'blacksmith' ? b.def.recipes.find((r) => r.name === (b.policy.product ?? 'tools')) : undefined) ?? b.def.recipes[0];
  const out = recipe?.outputs;
  const suspended = !!b.chainOwner && b.chainOwner !== me.user.nearAccountId;

  const claimDeed = async () => {
    setDeedBusy(true);
    try {
      const cfg = await nearConfig();
      if (!cfg.certificatesEnabled) throw new Error('On-chain deeds are not configured on this server yet (see README → NEAR setup)');
      if (!me.user.nearAccountId) throw new Error('Connect your NEAR wallet in the Wallet panel first');
      const cert = await api<{ receiverId: string; methodName: string; args: Record<string, unknown>; deposit: string; gas: string }>('/near/certificate/deed', { body: { businessId: b.id } });
      toast('Approve the transaction in your wallet…', 'info');
      const tx = await sendContractCall(cert, 'deed', b.id);
      toast(tx.status === 'success' ? 'Deed confirmed on NEAR!' : `Transaction ${tx.status}: ${tx.error ?? 'awaiting confirmation'}`, tx.status === 'success' ? 'good' : 'info');
      await refreshMe();
    } catch (e) {
      toast((e as Error).message, 'bad');
    } finally {
      setDeedBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="display text-xl font-bold">{b.name}</h3>
          <p className="text-xs text-muted">{b.def.description}</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Badge tone={suspended ? 'ember' : 'moss'}>{suspended ? 'suspended' : 'operating'}</Badge>
          <span className="text-[11px] text-muted">{CITY_DEFS[b.city].name}{b.affinity !== 1 && <> · <span className={b.affinity > 1 ? 'text-moss' : 'text-ember'}>{b.affinity > 1 ? '+' : '−'}{Math.round(Math.abs(b.affinity - 1) * 100)}% {b.affinity > 1 ? 'local advantage' : 'poor fit'}</span></>}</span>
        </div>
      </div>
      {b.idle === 'inputs-too-dear' && <p className="rounded-lg border border-ember/40 bg-ember/10 px-3 py-2 text-xs text-[#f0b8a0]">Paused buying: inputs on the {world.markets[b.city].name} cost more than the output is worth. Ship cheaper inputs into your {CITY_DEFS[b.city].name} {b.city === 'nearhaven' ? 'warehouse' : 'depot'}, turn off auto-sell to sell elsewhere, or dismiss workers to save wages.</p>}
      {b.idle === 'full' && <p className="rounded-lg border border-ember/40 bg-ember/10 px-3 py-2 text-xs text-[#f0b8a0]">Production stopped: the stock room is full. Collect goods, turn on auto-sell, or upgrade for more capacity.</p>}
      {b.idle === 'store-full' && <p className="rounded-lg border border-ember/40 bg-ember/10 px-3 py-2 text-xs text-[#f0b8a0]">Production stopped: your {CITY_DEFS[b.city].name} {b.city === 'nearhaven' ? 'warehouse' : 'depot'} is full, so output cannot be collected. Ship goods out with a standing order, build a warehouse here, or turn on auto-sell.</p>}
      {suspended && <p className="rounded-lg border border-ember/40 bg-ember/10 px-3 py-2 text-xs text-[#f0b8a0]">The deed is held on-chain by {b.chainOwner}. Production pauses until the deed holder plays.</p>}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Lifetime P/L" value={<span className={profit >= 0 ? 'text-moss' : 'text-ember'}>{gold(profit)}</span>} sub={`incl. ${gold(b.purchasePrice + (b.landCost ?? 0))}g to open`} />
        <Stat label="Revenue" value={gold(b.totals.revenue)} />
        <Stat label="Expenses" value={gold(b.totals.expenses)} />
        <Stat label={b.kind === 'shop' ? 'Sold' : 'Produced'} value={b.totals.produced.toFixed(0)} sub={b.kind === 'shop' ? `${b.policy.product ?? 'goods'} sold` : out ? Object.keys(out).join(', ') : 'storage & rent'} />
      </div>
      {h.length > 1 && (
        <div className="panel p-3">
          <div className="label mb-1">Daily profit & loss</div>
          <LineChart series={[{ name: 'Revenue', color: '#8fb35f', data: h.map((d) => d.revenue) }, { name: 'Expenses', color: '#d2643a', data: h.map((d) => d.expenses) }, { name: 'Profit', color: '#d9a84a', data: h.map((d) => d.profit) }]} labels={h.map((d) => `D${d.day + 1}`)} height={140} />
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="panel p-4">
          <div className="label mb-2">Workforce</div>
          <div className="num text-2xl font-bold">{b.workers} <span className="text-sm text-muted">/ {b.maxWorkers}</span></div>
          <div className="text-[11px] text-muted">{gold(b.def.wage * landDef(b.city).wages * (world.cities[b.city]?.labor?.wageFactor ?? 1))}g per worker per day in {CITY_DEFS[b.city].name}{(world.cities[b.city]?.labor?.wageFactor ?? 1) > 1 ? ` (labour is short: ×${world.cities[b.city].labor.wageFactor})` : ''} · {world.cities[b.city]?.labor ? `${world.cities[b.city].labor.supply - world.cities[b.city].labor.employed} hands free` : ''} · signing fee {b.def.wage * 2}g</div>
          <div className="mt-3 flex gap-2">
            <button disabled={busy || b.workers >= b.maxWorkers} onClick={() => run({ type: 'business.hire', businessId: b.id }, 'Worker hired')} className="btn btn-gold flex-1 py-1.5 text-sm">Hire</button>
            <button disabled={busy || b.workers <= 0} onClick={() => run({ type: 'business.fire', businessId: b.id }, 'Worker dismissed')} className="btn btn-ghost flex-1 py-1.5 text-sm">Dismiss</button>
          </div>
          <div className="mt-4 flex items-center justify-between"><span className="label">Level {b.level} / {b.maxLevel}</span><LevelPips level={b.level} max={b.maxLevel} /></div>
          <button disabled={busy || b.upgradeCost == null || me.player.gold < (b.upgradeCost ?? 0) || me.player.level < b.upgradeNeedsLevel} onClick={() => run({ type: 'business.upgrade', businessId: b.id }, `Upgraded to level ${b.level + 1}`)} className="btn btn-ghost mt-2 w-full py-1.5 text-sm">
            {b.upgradeCost == null ? 'Fully upgraded' : me.player.level < b.upgradeNeedsLevel ? `Level ${b.level + 1} needs player Lv ${b.upgradeNeedsLevel}` : `Upgrade to Lv ${b.level + 1} · ${gold(b.upgradeCost)}g`}
          </button>
          {b.level < b.maxLevel && <p className="mt-1 text-[11px] text-muted">Next level: {b.def.maxWorkers[b.level]} workers, {b.def.capacity[b.level] || b.def.storageBonus?.[b.level] || 0} {b.kind === 'warehouse' ? 'storage' : 'capacity'}, ×{b.def.efficiency[b.level]} efficiency.</p>}
        </div>
        <div className="panel p-4">
          <div className="label mb-2">Stock · {used.toFixed(0)} / {b.capacity || '—'}</div>
          {b.capacity > 0 && <Meter value={used} max={b.capacity} />}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {Object.entries(b.inventory).filter(([, q]) => (q ?? 0) > 0.05).map(([r, q]) => <span key={r} className="flex items-center gap-1 rounded-md bg-black/30 px-2 py-0.5 text-xs"><ResourceIcon r={r} size={14} />{(q ?? 0).toFixed(1)}</span>)}
            {b.caravan && <span className="text-xs text-river">Caravan en route to {b.caravan.to}</span>}
          </div>
          <button disabled={busy || used < 1} onClick={() => run({ type: 'business.collect', businessId: b.id }, b.city === 'nearhaven' ? 'Goods moved to your warehouse' : `Goods moved to your ${CITY_DEFS[b.city].name} depot`)} className="btn btn-ghost mt-3 w-full py-1.5 text-sm">{b.city === 'nearhaven' ? 'Collect to warehouse' : `Collect to ${CITY_DEFS[b.city].name} depot`}</button>
          {b.def.recipes.length > 0 && (
            <div className="mt-3 space-y-2 text-xs">
              <label className="flex items-center justify-between"><span>Use my stock in {CITY_DEFS[b.city].name} first (my other businesses here, then my store)</span><input type="checkbox" checked={!!b.policy.supplyFromStore} onChange={(e) => run({ type: 'business.policy', businessId: b.id, policy: { supplyFromStore: e.target.checked } })} /></label>
              <label className="flex items-center justify-between"><span>Auto-buy inputs (only while profitable)</span><input type="checkbox" checked={b.policy.autoBuyInputs} onChange={(e) => run({ type: 'business.policy', businessId: b.id, policy: { autoBuyInputs: e.target.checked } })} /></label>
              <label className="flex items-center justify-between"><span>Auto-sell output</span><input type="checkbox" checked={b.policy.autoSell} onChange={(e) => run({ type: 'business.policy', businessId: b.id, policy: { autoSell: e.target.checked } })} /></label>
              <div className="flex items-center gap-2">
                <span className="shrink-0">Min sell price</span>
                <input className="input num !py-1" type="number" step="0.1" min={0} value={minPrice} onChange={(e) => setMinPrice(Number(e.target.value))} />
                <button className="btn btn-ghost px-2 py-1" onClick={() => run({ type: 'business.policy', businessId: b.id, policy: { minSellPrice: minPrice } }, 'Floor price set')}>Set</button>
              </div>
              {b.def.recipes.length > 1 && (
                <div className="flex items-center justify-between gap-2">
                  <span>Recipe</span>
                  <select className="input !w-48 !py-1" value={recipe?.name} onChange={(e) => run({ type: 'business.policy', businessId: b.id, policy: { recipe: e.target.value } })}>
                    {b.def.recipes.map((rc) => <option key={rc.name} value={rc.name}>{rc.name} — {Object.entries(rc.inputs).map(([r, q]) => `${q} ${r}`).join(' + ') || 'no inputs'} → {Object.entries(rc.outputs).map(([r, q]) => `${q} ${r}`).join(', ')}</option>)}
                  </select>
                </div>
              )}
              {!b.policy.autoSell && <label className="flex items-center justify-between"><span>Auto-collect output to my {CITY_DEFS[b.city].name} store</span><input type="checkbox" checked={!!b.policy.autoCollect} onChange={(e) => run({ type: 'business.policy', businessId: b.id, policy: { autoCollect: e.target.checked } })} /></label>}
              {out && <div className="text-muted">Market price of output: {Object.keys(out).map((r) => `${RESOURCE_DEFS[r as keyof typeof RESOURCE_DEFS].label} ${gold(world.markets[b.city].resources[r as keyof typeof RESOURCE_DEFS].price)}g in ${CITY_DEFS[b.city].name}`).join(', ')}</div>}
            </div>
          )}
        </div>
      </div>
      {b.kind === 'shop' && <ShopBox b={b} world={world} />}
      {b.kind === 'bank' && <BankBox b={b} />}
      {b.idle === 'no-land' && <p className="rounded-lg border border-ember/40 bg-ember/10 px-3 py-2 text-xs text-[#f0b8a0]">No rent: you own no vacant land in {CITY_DEFS[b.city].name}. Buy plots in the Land &amp; property tab and this agency lets them out at 2% of their value a day.</p>}
      <SellBox b={b} />
      <div className="rounded-xl border border-near/30 bg-near/5 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="display font-bold text-near">Deed on NEAR</div>
            <p className="text-xs text-muted">{b.deedTokenId ? `Token ${b.deedTokenId} — ownership is enforced on-chain and tradeable for NEAR.` : 'Mint a verifiable ownership deed. The game signs a certificate; your wallet signs and pays (0.01 NEAR storage).'}</p>
          </div>
          {b.deedTokenId ? (
            <Badge tone="near">verified</Badge>
          ) : (
            <button disabled={deedBusy} onClick={claimDeed} className="btn btn-near shrink-0 px-4 py-2 text-sm">{deedBusy ? 'Waiting…' : 'Claim deed'}</button>
          )}
        </div>
      </div>
      {b.history.length === 0 && <Empty>Financial history appears after the first full day of trading.</Empty>}
    </div>
  );
}

function SellBox({ b }: { b: OwnedBiz }) {
  const { run, busy } = useAction();
  const [confirm, setConfirm] = useState(false);
  const offer = b.sale.total * 0.9;
  const deeded = !!b.deedTokenId || !!b.chainOwner;
  return (
    <div className="panel p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="label mb-1">Value & sale</div>
          <div className="num text-lg font-bold">{gold(b.sale.total)}g</div>
          <div className="text-[11px] text-muted">{gold(b.sale.assets)}g buildings · {gold(b.sale.goodwill)}g goodwill (20 days of recent profit) · {gold(b.sale.land)}g land</div>
        </div>
        {deeded ? (
          <p className="max-w-[220px] text-[11px] text-muted">This business is a NEAR deed. Sell it on the deed marketplace in the Wallet panel.</p>
        ) : confirm ? (
          <div className="flex gap-2">
            <button disabled={busy} onClick={async () => { await run({ type: 'business.sell', businessId: b.id }, `Sold ${b.name}`); setConfirm(false); }} className="btn btn-gold px-3 py-1.5 text-sm">Confirm · {gold(offer)}g</button>
            <button onClick={() => setConfirm(false)} className="btn btn-ghost px-3 py-1.5 text-sm">Keep it</button>
          </div>
        ) : (
          <button disabled={busy || !!b.caravan} onClick={() => setConfirm(true)} className="btn btn-ghost px-3 py-1.5 text-sm">Sell to local investors · {gold(offer)}g</button>
        )}
      </div>
    </div>
  );
}

function ShopBox({ b, world }: { b: OwnedBiz; world: PublicSnapshot }) {
  const { run, busy } = useAction();
  const m = world.markets[b.city];
  return (
    <div className="panel p-4 text-xs">
      <div className="label mb-2">What this shop sells</div>
      <div className="flex flex-wrap items-center gap-2">
        <select disabled={busy} className="input !w-44 !py-1" value={b.policy.product ?? ''} onChange={(e) => run({ type: 'business.policy', businessId: b.id, policy: { product: e.target.value } }, 'Shop restocked')}>
          <option value="" disabled>Choose a good…</option>
          {RESOURCES.map((r) => <option key={r} value={r}>{RESOURCE_DEFS[r].label} · {gold(m.resources[r].price)}g here</option>)}
        </select>
        <span className="text-muted">Restocks from your {CITY_DEFS[b.city].name} {b.city === 'nearhaven' ? 'warehouse' : 'depot'} and sells over the counter for the exchange price plus {Math.round((0.12 + 0.02 * (b.level - 1)) * 100)}% paid by households. Ship goods in with a standing order (Inventory panel).</span>
      </div>
      {b.idle === 'no-inputs' && <p className="mt-2 text-ember">Nothing to sell: your store here has none of this good.</p>}
    </div>
  );
}

function BankBox({ b }: { b: OwnedBiz }) {
  const { run, busy } = useAction();
  const [amt, setAmt] = useState(1000);
  const capital = b.capital ?? 0;
  return (
    <div className="panel p-4 text-xs">
      <div className="label mb-2">Capital · {gold(capital)} / {gold(b.capacity)}g</div>
      <p className="mb-2 text-muted">Deposited capital is lent to {CITY_DEFS[b.city].name}’s households and traders. It earns about 0.4% a day (more in a big city, with more clerks and a higher level), paid from the city’s purse. When food is dear, some loans go bad. Capital counts in full towards your net worth and is returned to you if you sell the bank.</p>
      <div className="flex flex-wrap items-center gap-2">
        <input className="input num !w-28 !py-1" type="number" min={1} value={amt} onChange={(e) => setAmt(Number(e.target.value))} aria-label="Amount" />
        <button disabled={busy || amt < 1} onClick={() => run({ type: 'bank.deposit', businessId: b.id, amount: Math.round(amt) }, 'Capital deposited')} className="btn btn-gold px-3 py-1">Deposit</button>
        <button disabled={busy || amt < 1 || capital < amt} onClick={() => run({ type: 'bank.deposit', businessId: b.id, amount: -Math.round(amt) }, 'Capital withdrawn')} className="btn btn-ghost px-3 py-1">Withdraw</button>
      </div>
      {b.idle === 'no-capital' && <p className="mt-2 text-ember">No capital deposited: the bank earns nothing.</p>}
    </div>
  );
}
