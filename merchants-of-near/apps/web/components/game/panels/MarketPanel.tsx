'use client';
import { useEffect, useMemo, useState } from 'react';
import { CITY_DEFS, MARKET_DEFS, MARKETS, type MarketId, type PublicSnapshot, type Resource } from '@mon/engine';
import type { Me } from '@/lib/api';
import { RESOURCE_DEFS, RESOURCES, estimate } from '@/lib/catalog';
import { useAction, useFetch } from '@/lib/hooks';
import { fly, originOf } from '@/lib/fx';
import { gold } from '@/lib/format';
import { Badge, Delta, Drawer, Empty, Meter, Sparkline, Tabs } from '../../ui';
import { Coin, IconScale, ResourceIcon } from '../../icons';

type Tab = MarketId | 'players';

export function MarketPanel({ world, me, onClose, city = 'nearhaven' }: { world: PublicSnapshot; me: Me; onClose: () => void; city?: MarketId }) {
  const [tab, setTab] = useState<Tab>(city);
  useEffect(() => setTab(city), [city]);
  const [sel, setSel] = useState<Resource>('wheat');
  const p = me.player;
  const open = (c: MarketId) => c === 'nearhaven' || p.charters.includes(c) || p.marketAccess.includes(c);

  return (
    <Drawer wide title="Marketplace" subtitle="Six city exchanges. Prices are set by each city's supply, demand and every trade — including yours" icon={<IconScale />} onClose={onClose}>
      <div className="mb-4 flex flex-wrap gap-1.5" role="tablist" aria-label="Markets">
        {[...MARKETS, 'players' as const].map((c) => (
          <button key={c} role="tab" aria-selected={tab === c} onClick={() => setTab(c)}
            className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${tab === c ? 'border-brass bg-brass/15 text-brass-bright' : 'border-line/70 text-parchment-dim hover:border-brass-deep'}`}>
            {c === 'players' ? 'Player Market' : `${CITY_DEFS[c].name}${open(c) ? '' : ' 🔒'}`}
          </button>
        ))}
      </div>
      {tab === 'players' ? (
        <PlayerMarket world={world} me={me} />
      ) : (
        <>
          <p className="-mt-1 mb-3 text-xs text-muted"><b className="text-parchment-dim">{CITY_DEFS[tab].title}.</b> {MARKET_DEFS[tab].description}</p>
          <div className="grid gap-4 lg:grid-cols-[1.25fr_1fr]">
            <ResourceTable market={world.markets[tab]} sel={sel} onSel={setSel} other={world.markets[tab === 'nearhaven' ? 'goldenvale' : 'nearhaven']} />
            {open(tab) ? <TradeBox market={world.markets[tab]} marketId={tab} r={sel} me={me} /> : <CharterCard city={tab} me={me} />}
          </div>
        </>
      )}
    </Drawer>
  );
}

/** Locked city: what it takes to open a trading office (and depot) there. */
export function CharterCard({ city, me }: { city: MarketId; me: Me }) {
  const { run, busy } = useAction();
  const def = CITY_DEFS[city];
  const c = def.charter!;
  const p = me.player;
  const levelOk = p.level >= c.level, goldOk = p.gold >= c.cost;
  return (
    <div className="panel p-5 text-sm text-parchment-dim">
      <Badge tone="river">No office yet</Badge>
      <h3 className="display mt-3 text-lg text-parchment">{def.name}</h3>
      <p className="mt-2">To trade here you need a <b>trading office</b>. It gives you a depot of {p.depotCapacity} units in {def.name}: goods you buy here stay here until you ship them.</p>
      <ul className="mt-3 space-y-1 text-xs">
        <li className={levelOk ? 'text-moss' : 'text-ember'}>{levelOk ? '✓' : '✗'} Level {c.level} or higher (you are Level {p.level})</li>
        <li className={goldOk ? 'text-moss' : 'text-ember'}>{goldOk ? '✓' : '✗'} {c.cost} gold charter fee, paid to the city</li>
      </ul>
      <p className="mt-3 text-xs">Known for: {def.strengths.join(', ')}. Short of: {def.needs.join(', ')}.</p>
      <button disabled={busy || !levelOk || !goldOk} onClick={() => run({ type: 'city.charter', city }, `Trading office opened in ${def.name}`)} className="btn btn-gold mt-4 w-full py-2">Open trading office · {c.cost}g</button>
    </div>
  );
}

function ResourceTable({ market, other, sel, onSel }: { market: PublicSnapshot['markets']['nearhaven']; other: PublicSnapshot['markets']['nearhaven']; sel: Resource; onSel: (r: Resource) => void }) {
  return (
    <div className="space-y-1.5">
      <div className="grid grid-cols-[1fr_70px_64px_92px] gap-2 px-3 text-[10px] font-bold uppercase tracking-wider text-muted">
        <span>Good</span><span className="text-right">Price</span><span className="text-right">24h</span><span className="text-right">Supply</span>
      </div>
      {RESOURCES.map((r) => {
        const d = market.resources[r];
        const change = (d.price - d.open) / d.open;
        const supply = d.stock / RESOURCE_DEFS[r].refStock;
        const gap = (other.resources[r].price - d.price) / d.price;
        return (
          <button
            key={r}
            onClick={() => onSel(r)}
            className={`grid w-full grid-cols-[1fr_70px_64px_92px] items-center gap-2 rounded-xl border px-3 py-2 text-left transition ${sel === r ? 'border-brass bg-brass/10' : 'border-line/60 bg-black/20 hover:border-brass-deep'}`}
          >
            <span className="flex min-w-0 items-center gap-2.5">
              <ResourceIcon r={r} size={24} />
              <span className="min-w-0">
                <span className="block text-sm font-semibold">{RESOURCE_DEFS[r].label}</span>
                <span className="block"><Sparkline data={d.intraday} width={84} height={14} fill={false} color={change >= 0 ? '#8fb35f' : '#d2643a'} /></span>
              </span>
            </span>
            <span className="num text-right text-sm font-bold">{gold(d.price)}</span>
            <span className="text-right"><Delta value={change} /></span>
            <span className="flex flex-col items-end gap-1">
              <span className="num text-[11px] text-muted">{Math.round(d.stock)} {d.shortage > 0.05 ? <span className="text-ember">short</span> : Math.abs(gap) > 0.25 ? <span className="text-near">{gap > 0 ? '↗' : '↘'}</span> : null}</span>
              <Meter value={supply} max={2} color={supply < 0.4 ? 'var(--color-ember)' : supply > 1.4 ? 'var(--color-river)' : 'var(--color-moss)'} label="supply level" />
            </span>
          </button>
        );
      })}
    </div>
  );
}

function TradeBox({ market, marketId, r, me }: { market: PublicSnapshot['markets']['nearhaven']; marketId: MarketId; r: Resource; me: Me }) {
  const [qty, setQty] = useState(5);
  const { run, busy } = useAction();
  const p = me.player;
  const d = market.resources[r];
  // Goods bought in a city stay in that city: the home warehouse in Nearhaven, your office depot elsewhere.
  const home = marketId === 'nearhaven';
  const store = home ? p.inventory : (p.depots[marketId] ?? {});
  const held = Math.floor(store[r] ?? 0);
  const inbound = p.shipments.filter((s) => s.to === marketId).reduce((a, s) => a + s.qty, 0);
  const free = Math.floor(home ? p.capacity - p.used : (p.depotCapacities[marketId as Exclude<MarketId, 'nearhaven'>] ?? p.depotCapacity) - Object.values(store).reduce((a, v) => a + (v ?? 0), 0) - inbound);
  const buy = useMemo(() => estimate(market, r, 'buy', qty), [market, r, qty]);
  const sell = useMemo(() => estimate(market, r, 'sell', qty), [market, r, qty]);
  const basis = p.costBasis[r];
  const def = RESOURCE_DEFS[r];

  const trade = async (side: 'buy' | 'sell', origin = originOf()) => {
    const est = side === 'buy' ? buy : sell;
    // Slippage guard: reject if the price moves more than 6% against us before execution.
    const limitPrice = Number((side === 'buy' ? est.avg * 1.06 : est.avg * 0.94).toFixed(2));
    const res = await run<{ qty: number; avgPrice: number; total: number; realizedProfit: number }>(
      { type: 'trade', side, resource: r, qty, market: marketId, limitPrice },
      (t) => `${side === 'buy' ? 'Bought' : 'Sold'} ${t.qty} ${r} at ${gold(t.avgPrice)} (${gold(t.total)}g)${side === 'sell' && t.realizedProfit ? ` · P/L ${t.realizedProfit > 0 ? '+' : ''}${gold(t.realizedProfit)}` : ''}`,
    );
    // Only animate once the server has confirmed the trade.
    if (res) fly(side === 'buy' ? { kind: 'goods', resource: r, from: origin, count: Math.ceil(res.qty / 3) } : { kind: 'coins', from: origin, count: Math.ceil(res.qty / 3) });
    return res;
  };

  return (
    <div className="panel p-5">
      <div className="flex items-start gap-3">
        <div className="grid h-14 w-14 place-items-center rounded-xl border border-line bg-black/30"><ResourceIcon r={r} size={36} /></div>
        <div className="min-w-0 flex-1">
          <h3 className="display text-xl font-bold">{def.label}</h3>
          <p className="text-xs leading-snug text-muted">{def.description}</p>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2 text-center">
        <Mini label="Price" value={gold(d.price)} />
        <Mini label="Demand/h" value={d.demand.toFixed(1)} />
        <Mini label="Supply/h" value={d.supply.toFixed(1)} />
        <Mini label="Produced/h" value={d.production.toFixed(1)} />
        <Mini label="Consumed/h" value={d.consumption.toFixed(1)} />
        <Mini label="Pressure" value={`${d.pressure.toFixed(2)}×`} tone={d.pressure > 1.1 ? 'text-ember' : d.pressure < 0.9 ? 'text-river' : undefined} />
      </div>
      <div className="mt-4 rounded-xl border border-line/60 bg-black/25 p-3">
        <div className="mb-1 flex justify-between text-[11px] text-muted"><span>Last 48 hours</span><span>base {def.basePrice}g</span></div>
        <Sparkline data={d.intraday} width={300} height={54} />
      </div>
      <div className="mt-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="label">Quantity</span>
          <span className="text-xs text-muted">{home ? 'Warehouse' : `${CITY_DEFS[marketId].name} depot`}: <b className="text-parchment">{held}</b>{basis ? ` @ ${gold(basis)}` : ''} · space {free}</span>
        </div>
        <div className="flex items-center gap-2">
          {[1, 5, 10, 25].map((q) => (
            <button key={q} onClick={() => setQty(q)} className={`num rounded-lg border px-2.5 py-1.5 text-xs font-bold ${qty === q ? 'border-brass bg-brass/15 text-brass' : 'border-line text-parchment-dim'}`}>{q}</button>
          ))}
          <input aria-label="Quantity" type="number" min={1} max={500} value={qty} onChange={(e) => setQty(Math.max(1, Math.min(500, Math.floor(Number(e.target.value) || 1))))} className="input num !w-20 !py-1.5 text-center" />
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-line/60 bg-black/20 p-3">
          <div className="label">Buy cost ≈</div>
          <div className="num mt-1 flex items-center gap-1.5 text-lg font-bold"><Coin size={16} />{gold(buy.total)}</div>
          <div className="num text-[11px] text-muted">avg {gold(buy.avg)} · after {gold(buy.after)}</div>
          <button disabled={busy || !buy.feasible || buy.total > p.gold || qty > free} onClick={(e) => trade('buy', originOf(e.currentTarget))} className="btn btn-gold mt-3 w-full py-2">Buy {qty}</button>
        </div>
        <div className="rounded-xl border border-line/60 bg-black/20 p-3">
          <div className="label">Sell yields ≈</div>
          <div className="num mt-1 flex items-center gap-1.5 text-lg font-bold"><Coin size={16} />{gold(sell.total)}</div>
          <div className="num text-[11px] text-muted">avg {gold(sell.avg)}{basis ? <> · P/L <span className={sell.avg >= basis ? 'text-moss' : 'text-ember'}>{gold((sell.avg - basis) * qty)}</span></> : null}</div>
          <button disabled={busy || held < qty} onClick={(e) => trade('sell', originOf(e.currentTarget))} className="btn btn-ghost mt-3 w-full py-2">Sell {qty}</button>
        </div>
      </div>
      <p className="mt-3 text-[11px] leading-snug text-muted">Estimates use the live price curve. The exchange settles the real price server-side and rejects the trade if it moves more than 6% against you. Fee {(market.fee * 100).toFixed(0)}%.</p>
    </div>
  );
}

const Mini = ({ label, value, tone }: { label: string; value: string; tone?: string }) => (
  <div className="rounded-lg border border-line/50 bg-black/20 px-2 py-1.5">
    <div className="text-[9px] font-bold uppercase tracking-wider text-muted">{label}</div>
    <div className={`num text-sm font-bold ${tone ?? ''}`}>{value}</div>
  </div>
);

interface ListingRow { id: string; seller: string; sellerId: string; resource: Resource; qty: number; unitPrice: number; createdTick: number }

function PlayerMarket({ world, me }: { world: PublicSnapshot; me: Me }) {
  const { data, reload } = useFetch<ListingRow[]>('/market/listings', [world.tick]);
  const { run, busy } = useAction();
  const [r, setR] = useState<Resource>('wheat');
  const [qty, setQty] = useState(5);
  const [price, setPrice] = useState<number>(Number(world.markets.nearhaven.resources.wheat.price.toFixed(2)));
  const p = me.player;
  const locked = p.level < 2;
  const ref = world.markets.nearhaven.resources[r].price;

  return (
    <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
      <div>
        <p className="mb-3 text-xs text-muted">Real players only — goods are held in escrow by the server until a buyer pays. AI merchants never appear here.</p>
        {!data?.length ? (
          <Empty>No open listings yet. Be the first merchant to post goods.</Empty>
        ) : (
          <div className="space-y-1.5">
            {data.map((l) => {
              const mine = l.sellerId === me.user.id;
              const vs = (l.unitPrice - world.markets.nearhaven.resources[l.resource].price) / world.markets.nearhaven.resources[l.resource].price;
              return (
                <div key={l.id} className="flex items-center gap-3 rounded-xl border border-line/60 bg-black/20 px-3 py-2">
                  <ResourceIcon r={l.resource} size={24} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold">{l.qty} {RESOURCE_DEFS[l.resource].label}</div>
                    <div className="text-[11px] text-muted">by {l.seller}{mine ? ' (you)' : ''}</div>
                  </div>
                  <div className="text-right">
                    <div className="num text-sm font-bold">{gold(l.unitPrice)} <span className="text-[10px] text-muted">ea</span></div>
                    <Delta value={vs} />
                  </div>
                  {mine ? (
                    <button disabled={busy} onClick={async () => { await run({ type: 'listing.cancel', listingId: l.id }, 'Listing cancelled'); reload(); }} className="btn btn-ghost px-3 py-1.5 text-xs">Cancel</button>
                  ) : (
                    <button disabled={busy || p.gold < l.qty * l.unitPrice * 1.02} onClick={async () => { await run({ type: 'listing.buy', listingId: l.id }, `Bought ${l.qty} ${l.resource} from ${l.seller}`); reload(); }} className="btn btn-gold px-3 py-1.5 text-xs">Buy {gold(l.qty * l.unitPrice)}</button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
      <div className="panel p-4">
        <h3 className="display text-base font-bold">Post a listing</h3>
        {locked ? (
          <p className="mt-2 text-sm text-muted">Player listings unlock at <b className="text-parchment">Level 2 · Market Merchant</b>.</p>
        ) : (
          <div className="mt-3 space-y-3">
            <select className="input" value={r} onChange={(e) => { setR(e.target.value as Resource); setPrice(Number(world.markets.nearhaven.resources[e.target.value as Resource].price.toFixed(2))); }}>
              {RESOURCES.map((x) => <option key={x} value={x}>{RESOURCE_DEFS[x].label} — you have {Math.floor(p.inventory[x] ?? 0)}</option>)}
            </select>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs text-muted">Quantity<input type="number" className="input num mt-1" min={1} value={qty} onChange={(e) => setQty(Math.max(1, Math.floor(Number(e.target.value) || 1)))} /></label>
              <label className="text-xs text-muted">Unit price<input type="number" step="0.1" className="input num mt-1" value={price} onChange={(e) => setPrice(Number(e.target.value))} /></label>
            </div>
            <p className="text-[11px] text-muted">Allowed range {gold(ref * 0.3)}–{gold(ref * 3)}g (30–300% of market). Buyers pay a 2% fee.</p>
            <button disabled={busy || (p.inventory[r] ?? 0) < qty} onClick={async () => { await run({ type: 'listing.create', resource: r, qty, unitPrice: price }, 'Listing posted'); reload(); }} className="btn btn-gold w-full py-2">List {qty} {r}</button>
          </div>
        )}
      </div>
    </div>
  );
}
