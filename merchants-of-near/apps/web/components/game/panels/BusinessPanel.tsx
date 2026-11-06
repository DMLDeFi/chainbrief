'use client';
import { useState } from 'react';
import type { BusinessKind, PublicSnapshot } from '@mon/engine';
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

export function BusinessPanel({ world, me, selection, onClose }: { world: PublicSnapshot; me: Me; selection: Selection | null; onClose: () => void }) {
  const p = me.player;
  const sel = selection?.type === 'plot' ? selection : null;
  const [focus, setFocus] = useState<string | null>(sel?.businessId ?? p.businesses[0]?.id ?? null);
  const other = sel?.businessId && sel.ownerId !== me.user.id ? world.businesses.find((b) => b.id === sel.businessId) : null;
  const current = p.businesses.find((b) => b.id === focus);

  return (
    <Drawer wide title="Businesses" subtitle="Produce goods, employ workers and grow an empire" icon={<IconHouse />} onClose={onClose}>
      {other && (
        <div className="mb-4 rounded-xl border border-line/60 bg-black/20 p-3 text-sm">
          This {other.kind} belongs to <b>{other.owner}</b> (level {other.level}). Deeded businesses can be bought from their owner on NEAR — see the Wallet panel.
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-[230px_1fr]">
        <div className="space-y-2">
          <div className="label">Your holdings</div>
          {p.businesses.length === 0 && <p className="text-xs text-muted">You own no businesses yet.</p>}
          {p.businesses.map((b) => {
            const last = b.history.at(-1);
            return (
              <button key={b.id} onClick={() => setFocus(b.id)} className={`w-full rounded-xl border px-3 py-2 text-left ${focus === b.id ? 'border-brass bg-brass/10' : 'border-line/60 bg-black/20 hover:border-brass-deep'}`}>
                <div className="flex items-center justify-between text-sm font-semibold"><span>{b.def.name}</span><span className="text-[10px] text-muted">Lv {b.level}</span></div>
                <div className="num text-[11px] text-muted">{b.workers} workers · {last ? <span className={last.profit >= 0 ? 'text-moss' : 'text-ember'}>{last.profit >= 0 ? '+' : ''}{gold(last.profit)}g yesterday</span> : 'new'}</div>
                {b.deedTokenId && <Badge tone="near">deed on NEAR</Badge>}
              </button>
            );
          })}
          <button onClick={() => setFocus(null)} className={`w-full rounded-xl border border-dashed px-3 py-2.5 text-left text-sm ${focus === null ? 'border-brass text-brass' : 'border-line text-parchment-dim hover:border-brass-deep'}`}>+ Open a new business</button>
        </div>
        <div>{current ? <Detail b={current} me={me} world={world} /> : <Catalog me={me} freePlots={12 - world.businesses.length} onBought={(id) => setFocus(id)} />}</div>
      </div>
    </Drawer>
  );
}

function Catalog({ me, freePlots, onBought }: { me: Me; freePlots: number; onBought: (id: string) => void }) {
  const { run, busy } = useAction();
  const p = me.player;
  return (
    <div>
      <p className="mb-3 text-xs text-muted">{freePlots} building plot{freePlots === 1 ? '' : 's'} left in town. Businesses run automatically every hour: they buy inputs, produce, sell output above your floor price and pay wages each dawn.</p>
      <div className="grid gap-2.5 sm:grid-cols-2">
        {(Object.keys(BUSINESS_DEFS) as BusinessKind[]).map((k) => {
          const d = BUSINESS_DEFS[k];
          const locked = p.level < d.requiredLevel;
          const recipe = d.recipes[0];
          return (
            <div key={k} className={`rounded-xl border p-3.5 ${locked ? 'border-line/40 bg-black/10 opacity-70' : 'border-line/70 bg-black/20'}`}>
              <div className="flex items-center justify-between">
                <h4 className="display font-bold">{d.name}</h4>
                <span className="num flex items-center gap-1 text-sm font-bold text-brass-bright"><Coin size={14} />{d.price}</span>
              </div>
              <p className="mt-1 text-xs leading-snug text-muted">{d.description}</p>
              {recipe && (
                <div className="mt-2 flex items-center gap-1.5 text-[11px] text-parchment-dim">
                  {Object.entries(recipe.inputs).map(([r, q]) => <span key={r} className="flex items-center gap-0.5">{q}<ResourceIcon r={r} size={14} /></span>)}
                  {Object.keys(recipe.inputs).length > 0 && <span>→</span>}
                  {Object.entries(recipe.outputs).map(([r, q]) => <span key={r} className="flex items-center gap-0.5">{q}<ResourceIcon r={r} size={14} /></span>)}
                </div>
              )}
              <div className="mt-2 text-[11px] text-muted">Wage {d.wage}g/worker/day · upkeep {d.upkeep}g</div>
              <button disabled={busy || locked || p.gold < d.price || freePlots <= 0} onClick={async () => { const b = await run<{ id: string }>({ type: 'business.buy', kind: k }, `${d.name} opened!`); if (b) onBought(b.id); }} className="btn btn-gold mt-3 w-full py-1.5 text-sm">
                {locked ? `Requires Lv ${d.requiredLevel} · ${LEVELS[d.requiredLevel - 1].title}` : p.gold < d.price ? `Need ${d.price}g` : 'Purchase'}
              </button>
            </div>
          );
        })}
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
  const out = (b.def.recipes.find((r) => r.name === (b.policy.product ?? r.name)) ?? b.def.recipes[0])?.outputs;
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
        <Badge tone={suspended ? 'ember' : 'moss'}>{suspended ? 'suspended' : 'operating'}</Badge>
      </div>
      {suspended && <p className="rounded-lg border border-ember/40 bg-ember/10 px-3 py-2 text-xs text-[#f0b8a0]">The deed is held on-chain by {b.chainOwner}. Production pauses until the deed holder plays.</p>}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Lifetime P/L" value={<span className={profit >= 0 ? 'text-moss' : 'text-ember'}>{gold(profit)}</span>} sub={`incl. ${gold(b.purchasePrice)}g purchase`} />
        <Stat label="Revenue" value={gold(b.totals.revenue)} />
        <Stat label="Expenses" value={gold(b.totals.expenses)} />
        <Stat label="Produced" value={b.totals.produced.toFixed(0)} sub={out ? Object.keys(out).join(', ') : 'storage & rent'} />
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
          <div className="text-[11px] text-muted">{b.def.wage}g per worker per day · signing fee {b.def.wage * 2}g</div>
          <div className="mt-3 flex gap-2">
            <button disabled={busy || b.workers >= b.maxWorkers} onClick={() => run({ type: 'business.hire', businessId: b.id }, 'Worker hired')} className="btn btn-gold flex-1 py-1.5 text-sm">Hire</button>
            <button disabled={busy || b.workers <= 0} onClick={() => run({ type: 'business.fire', businessId: b.id }, 'Worker dismissed')} className="btn btn-ghost flex-1 py-1.5 text-sm">Dismiss</button>
          </div>
          <div className="mt-4 label">Level {b.level} / 3</div>
          <button disabled={busy || b.upgradeCost == null || me.player.gold < (b.upgradeCost ?? 0)} onClick={() => run({ type: 'business.upgrade', businessId: b.id }, `Upgraded to level ${b.level + 1}`)} className="btn btn-ghost mt-2 w-full py-1.5 text-sm">
            {b.upgradeCost == null ? 'Fully upgraded' : `Upgrade · ${b.upgradeCost}g`}
          </button>
        </div>
        <div className="panel p-4">
          <div className="label mb-2">Stock · {used.toFixed(0)} / {b.capacity || '—'}</div>
          {b.capacity > 0 && <Meter value={used} max={b.capacity} />}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {Object.entries(b.inventory).filter(([, q]) => (q ?? 0) > 0.05).map(([r, q]) => <span key={r} className="flex items-center gap-1 rounded-md bg-black/30 px-2 py-0.5 text-xs"><ResourceIcon r={r} size={14} />{(q ?? 0).toFixed(1)}</span>)}
            {b.caravan && <span className="text-xs text-river">Caravan en route to {b.caravan.to}</span>}
          </div>
          <button disabled={busy || used < 1} onClick={() => run({ type: 'business.collect', businessId: b.id }, 'Goods moved to your warehouse')} className="btn btn-ghost mt-3 w-full py-1.5 text-sm">Collect to warehouse</button>
          {b.def.recipes.length > 0 && (
            <div className="mt-3 space-y-2 text-xs">
              <label className="flex items-center justify-between"><span>Auto-buy inputs</span><input type="checkbox" checked={b.policy.autoBuyInputs} onChange={(e) => run({ type: 'business.policy', businessId: b.id, policy: { autoBuyInputs: e.target.checked } })} /></label>
              <label className="flex items-center justify-between"><span>Auto-sell output</span><input type="checkbox" checked={b.policy.autoSell} onChange={(e) => run({ type: 'business.policy', businessId: b.id, policy: { autoSell: e.target.checked } })} /></label>
              <div className="flex items-center gap-2">
                <span className="shrink-0">Min sell price</span>
                <input className="input num !py-1" type="number" step="0.1" min={0} value={minPrice} onChange={(e) => setMinPrice(Number(e.target.value))} />
                <button className="btn btn-ghost px-2 py-1" onClick={() => run({ type: 'business.policy', businessId: b.id, policy: { minSellPrice: minPrice } }, 'Floor price set')}>Set</button>
              </div>
              {b.kind === 'blacksmith' && (
                <div className="flex items-center justify-between">
                  <span>Forge</span>
                  <select className="input !w-32 !py-1" value={b.policy.product} onChange={(e) => run({ type: 'business.policy', businessId: b.id, policy: { product: e.target.value } })}>
                    <option value="tools">Tools</option><option value="weapons">Weapons</option>
                  </select>
                </div>
              )}
              {out && <div className="text-muted">Market price of output: {Object.keys(out).map((r) => `${RESOURCE_DEFS[r as keyof typeof RESOURCE_DEFS].label} ${gold(world.markets.nearhaven.resources[r as keyof typeof RESOURCE_DEFS].price)}g`).join(', ')}</div>}
            </div>
          )}
        </div>
      </div>
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
