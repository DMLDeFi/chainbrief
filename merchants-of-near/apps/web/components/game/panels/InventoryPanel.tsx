'use client';
import { useState } from 'react';
import { CITY_DEFS, findPath, freightCost, MARKETS, type MarketId, type PublicSnapshot, type Resource } from '@mon/engine';
import type { Me } from '@/lib/api';
import { RESOURCE_DEFS, RESOURCES } from '@/lib/catalog';
import { useAction } from '@/lib/hooks';
import { gold } from '@/lib/format';
import { Badge, Drawer, Empty, Meter, Stat } from '../../ui';
import { Coin, IconBag, ResourceIcon } from '../../icons';
import type { PanelId } from '../GameShell';

export function InventoryPanel({ world, me, onClose, onOpen }: { world: PublicSnapshot; me: Me; onClose: () => void; onOpen: (p: PanelId) => void }) {
  const p = me.player;
  const { run, busy } = useAction();
  const m = world.markets.nearhaven;
  const held = RESOURCES.filter((r) => (p.inventory[r] ?? 0) >= 0.01);
  const value = held.reduce((s, r) => s + (p.inventory[r] ?? 0) * m.resources[r].price * 0.9, 0);

  return (
    <Drawer title="Inventory & Finances" subtitle={`${p.name}'s warehouse ledger`} icon={<IconBag />} onClose={onClose}>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Gold" value={<span className="flex items-center gap-1"><Coin size={14} />{gold(p.gold)}</span>} accent="#f4c96b" />
        <Stat label="Net worth" value={gold(p.netWorth)} />
        <Stat label="Goods value" value={gold(value)} sub="at market, −10%" />
        <Stat label="Reputation" value={`${p.reputation}/100`} />
      </div>

      <div className="mt-5 flex items-end justify-between">
        <div>
          <div className="label">Warehouse</div>
          <div className="num text-sm">{p.used} / {p.capacity} units</div>
        </div>
        <button disabled={busy || p.gold < p.warehouseExpansionCost || p.warehouseLevel >= 8} onClick={() => run({ type: 'warehouse.expand' }, 'Warehouse expanded')} className="btn btn-ghost px-3 py-1.5 text-xs">
          Expand +60 · {p.warehouseExpansionCost}g
        </button>
      </div>
      <div className="mt-2"><Meter value={p.used} max={p.capacity} color={p.used / p.capacity > 0.9 ? 'var(--color-ember)' : 'var(--color-brass)'} /></div>

      <div className="mt-4 space-y-1.5">
        {held.length === 0 ? (
          <Empty>Your stalls are empty. Visit the <button className="text-brass underline" onClick={() => onOpen('market')}>Marketplace</button> to buy your first goods.</Empty>
        ) : (
          held.map((r) => <Row key={r} r={r} qty={p.inventory[r] ?? 0} basis={p.costBasis[r]} price={m.resources[r].price} busy={busy} onSell={(q) => run({ type: 'trade', side: 'sell', resource: r, qty: q }, `Sold ${q} ${r}`)} />)
        )}
      </div>

      <CityStores world={world} me={me} />

      <h3 className="display mt-6 text-base font-bold">Loans</h3>
      {p.loans.length === 0 ? (
        <p className="mt-1 text-sm text-muted">No debts. Banker Aldric would offer you up to <b className="text-parchment">{gold(p.credit.offer.maxAmount)}g</b> (risk score {Math.round(p.credit.offer.riskScore * 100)}). Visit him in the Merchants panel.</p>
      ) : (
        <div className="mt-2 space-y-2">
          {p.loans.map((l) => (
            <div key={l.id} className="flex items-center gap-3 rounded-xl border border-line/60 bg-black/20 px-3 py-2 text-sm">
              <div className="flex-1">
                <div className="font-semibold">{gold(l.outstanding)}g outstanding <span className="text-xs text-muted">of {gold(l.principal)} borrowed</span></div>
                <div className="text-[11px] text-muted">{(l.dailyRate * 100).toFixed(2)}%/day · {gold(l.installment)}g daily · {l.missed ? <span className="text-ember">{l.missed} missed</span> : 'on time'}</div>
              </div>
              <button disabled={busy || p.gold < Math.min(l.outstanding, 1)} onClick={() => run({ type: 'loan.repay', loanId: l.id, amount: Math.min(p.gold, l.outstanding) }, 'Repayment sent to the Silver Vault')} className="btn btn-gold px-3 py-1.5 text-xs">Repay</button>
            </div>
          ))}
        </div>
      )}

      <h3 className="display mt-6 text-base font-bold">Investments in AI merchants</h3>
      {p.investments.length === 0 ? (
        <p className="mt-1 text-sm text-muted">You hold no merchant shares. Investors earn 40% of a merchant&apos;s daily profit pro-rata — and lose everything if they go bankrupt.</p>
      ) : (
        <div className="mt-2 space-y-2">
          {p.investments.map((i) => (
            <div key={i.merchantId} className="flex items-center justify-between rounded-xl border border-line/60 bg-black/20 px-3 py-2 text-sm">
              <span className="font-semibold">{i.name} <Badge tone={i.status === 'bankrupt' ? 'ember' : 'moss'}>{i.status}</Badge></span>
              <span className="num">{i.shares.toFixed(2)} sh · {gold(i.value)}g</span>
            </div>
          ))}
        </div>
      )}
    </Drawer>
  );
}

function Row({ r, qty, basis, price, busy, onSell }: { r: Resource; qty: number; basis?: number; price: number; busy: boolean; onSell: (q: number) => void }) {
  const whole = Math.floor(qty);
  const pl = basis ? (price - basis) / basis : 0;
  return (
    <div className="flex items-center gap-3 rounded-xl border border-line/60 bg-black/20 px-3 py-2">
      <ResourceIcon r={r} size={26} />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold">{RESOURCE_DEFS[r].label} <span className="num text-muted">× {qty % 1 ? qty.toFixed(1) : qty}</span></div>
        <div className="num text-[11px] text-muted">market {gold(price)}{basis ? <> · cost {gold(basis)} · <span className={pl >= 0 ? 'text-moss' : 'text-ember'}>{(pl * 100).toFixed(0)}%</span></> : null}</div>
      </div>
      <div className="flex gap-1">
        {whole >= 1 && <button disabled={busy} onClick={() => onSell(Math.min(whole, Math.max(1, Math.ceil(whole / 2))))} className="btn btn-ghost px-2.5 py-1 text-xs">Sell ½</button>}
        {whole >= 1 && <button disabled={busy} onClick={() => onSell(Math.min(whole, 500))} className="btn btn-ghost px-2.5 py-1 text-xs">Sell all</button>}
      </div>
    </div>
  );
}

/** Depots in other cities, shipments on the road, and a form to move goods along the route network. */
function CityStores({ world, me }: { world: PublicSnapshot; me: Me }) {
  const p = me.player;
  const { run, busy } = useAction();
  const offices = MARKETS.filter((c) => c !== 'nearhaven' && (p.charters.includes(c) || p.marketAccess.includes(c)));
  const places: MarketId[] = ['nearhaven', ...offices];
  const storeOf = (c: MarketId) => (c === 'nearhaven' ? p.inventory : (p.depots[c] ?? {}));
  const [from, setFrom] = useState<MarketId>(offices[0] ?? 'nearhaven');
  const [to, setTo] = useState<MarketId>('nearhaven');
  const [r, setR] = useState<Resource>('wheat');
  const [qty, setQty] = useState(10);
  if (offices.length === 0) {
    return (
      <>
        <h3 className="display mt-6 text-base font-bold">Offices in other cities</h3>
        <p className="mt-1 text-sm text-muted">You trade only in Nearhaven so far. Open a trading office in another city from the Marketplace or the World map. Goldenvale opens from Level 1. You then get a depot there, and can ship goods between cities.</p>
      </>
    );
  }
  const path = from !== to ? findPath(from, to) : null;
  const have = Math.floor(storeOf(from)[r] ?? 0);
  const cost = from !== to ? freightCost(from, to, qty) : 0;
  return (
    <>
      <h3 className="display mt-6 text-base font-bold">Offices in other cities</h3>
      <div className="mt-2 space-y-2">
        {offices.map((c) => {
          const inv = storeOf(c); const used = Object.values(inv).reduce((a, v) => a + (v ?? 0), 0);
          const goods = RESOURCES.filter((x) => (inv[x] ?? 0) >= 1);
          return (
            <div key={c} className="rounded-xl border border-line/60 bg-black/20 px-3 py-2 text-sm">
              <div className="flex items-center justify-between"><span className="font-semibold">{CITY_DEFS[c].name} depot</span><span className="num text-xs text-muted">{Math.round(used)} / {p.depotCapacities[c as Exclude<MarketId, 'nearhaven'>] ?? p.depotCapacity}</span></div>
              <div className="mt-1 flex flex-wrap gap-2 text-xs text-parchment-dim">
                {goods.length ? goods.map((x) => <span key={x} className="flex items-center gap-1"><ResourceIcon r={x} size={14} />{Math.floor(inv[x] ?? 0)} {x} <span className="text-muted">@ {gold(world.markets[c].resources[x].price)}</span></span>) : <span className="text-muted">Empty</span>}
              </div>
            </div>
          );
        })}
      </div>
      {p.shipments.length > 0 && (
        <div className="mt-3 space-y-1.5">
          <div className="label">On the road</div>
          {p.shipments.map((s) => (
            <div key={s.id} className="flex items-center gap-2 rounded-lg border border-river/30 bg-river/5 px-3 py-1.5 text-xs">
              <ResourceIcon r={s.resource} size={16} />
              <span className="flex-1">{s.qty} {s.resource}: {CITY_DEFS[s.from].name} → {CITY_DEFS[s.to].name}</span>
              <span className="num text-river">arrives in {Math.max(0, s.arriveTick - world.tick)}h</span>
            </div>
          ))}
        </div>
      )}
      <div className="mt-3 rounded-xl border border-line/60 bg-black/20 p-3">
        <div className="label mb-2">Ship goods</div>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <label className="flex flex-col gap-1">From<select className="input !py-1.5" value={from} onChange={(e) => setFrom(e.target.value as MarketId)}>{places.map((c) => <option key={c} value={c}>{CITY_DEFS[c].name}</option>)}</select></label>
          <label className="flex flex-col gap-1">To<select className="input !py-1.5" value={to} onChange={(e) => setTo(e.target.value as MarketId)}>{places.map((c) => <option key={c} value={c}>{CITY_DEFS[c].name}</option>)}</select></label>
          <label className="flex flex-col gap-1">Good<select className="input !py-1.5" value={r} onChange={(e) => setR(e.target.value as Resource)}>{RESOURCES.map((x) => <option key={x} value={x}>{RESOURCE_DEFS[x].label} ({Math.floor(storeOf(from)[x] ?? 0)})</option>)}</select></label>
          <label className="flex flex-col gap-1">Quantity<input className="input num !py-1.5" type="number" min={1} max={500} value={qty} onChange={(e) => setQty(Math.max(1, Math.min(500, Math.floor(Number(e.target.value) || 1))))} /></label>
        </div>
        <p className="mt-2 text-[11px] text-muted">
          {from === to ? 'Choose two different cities.' : path ? <>Route: {path.cities.map((c) => CITY_DEFS[c].name).join(' → ')} · <b className="text-parchment">{path.hours}h</b> · freight <b className="text-parchment">{gold(cost)}g</b> · you have {have} here</> : 'No route.'}
        </p>
        <button disabled={busy || from === to || qty > have || p.gold < cost} onClick={() => run({ type: 'ship', from, to, resource: r, qty }, `Shipment of ${qty} ${r} is on its way to ${CITY_DEFS[to].name}`)} className="btn btn-gold mt-2 w-full py-1.5 text-sm">Send shipment</button>
      </div>
    </>
  );
}
