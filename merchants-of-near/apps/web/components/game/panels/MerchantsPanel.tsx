'use client';
import { useState } from 'react';
import { CITY_DEFS, type MerchantState, type PublicSnapshot, type Resource } from '@mon/engine';
import { api, type Me } from '@/lib/api';
import { Portrait } from '@/components/Portrait';
import { RESOURCE_DEFS, RESOURCES, ROLE_COLOR, ROLE_TITLE } from '@/lib/catalog';
import { useAction, useFetch } from '@/lib/hooks';
import { toast } from '@/lib/store';
import { cap, gold } from '@/lib/format';
import { Badge, Drawer, Empty, LineChart, Meter, Stat, Tabs } from '../../ui';
import { IconChat, IconPeople, ResourceIcon } from '../../icons';

type Detail = MerchantState & { netWorth: number; shareValue: number; debt: number; yourShares: number; yourRelationship: number; investorCount: number };

export function MerchantsPanel({ world, me, selected, onSelect, onBack, onClose }: { world: PublicSnapshot; me: Me; selected: string | null; onSelect: (id: string) => void; onBack: () => void; onClose: () => void }) {
  if (selected) return <Profile id={selected} world={world} me={me} onBack={onBack} onClose={onClose} />;
  return (
    <Drawer wide title="Merchants of Nearhaven" subtitle="Ten autonomous AI agents with their own money, goals and memory" icon={<IconPeople />} onClose={onClose}>
      <div className="grid gap-2.5 sm:grid-cols-2">
        {world.merchants.map((m) => (
          <button key={m.id} onClick={() => onSelect(m.id)} className="group rounded-xl border border-line/60 bg-black/20 p-3.5 text-left transition hover:border-brass-deep hover:bg-black/30">
            <div className="flex items-center gap-3">
              <span className="shrink-0"><Portrait id={m.id} role={m.role} size={42} mood={m.status} /></span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-semibold">{m.name}</span>
                  <Badge tone={m.status === 'bankrupt' ? 'ember' : m.status === 'struggling' ? 'brass' : 'moss'}>{m.status}</Badge>
                </div>
                <div className="truncate text-[11px] text-muted">{ROLE_TITLE[m.role]} · {m.title}</div>
              </div>
              <div className="text-right">
                <div className="num text-sm font-bold">{gold(m.netWorth)}</div>
                <div className="text-[10px] text-muted">net worth</div>
              </div>
            </div>
            {m.lastDecision && (
              <div className="mt-2.5 rounded-lg bg-black/25 px-2.5 py-1.5 text-[11.5px] leading-snug text-parchment-dim">
                <span className="text-brass">↳</span> {m.lastDecision.action}
                <span className="text-muted"> — {m.lastDecision.reasons[0]}</span>
              </div>
            )}
            {m.travel && <div className="mt-1.5 text-[11px] text-river">On the road to {CITY_DEFS[m.travel.to].name} · arrives in {Math.max(0, m.travel.arriveTick - world.tick)}h</div>}
          </button>
        ))}
      </div>
    </Drawer>
  );
}

function Profile({ id, world, me, onBack, onClose }: { id: string; world: PublicSnapshot; me: Me; onBack: () => void; onClose: () => void }) {
  const { data: m, reload } = useFetch<Detail>(`/merchants/${id}`, [world.tick]);
  const [tab, setTab] = useState<'mind' | 'deal' | 'finance'>('mind');
  if (!m) return <Drawer wide title="Loading…" onClose={onClose}><div className="skeleton h-64 rounded-xl" /></Drawer>;
  const color = ROLE_COLOR[m.role];
  return (
    <Drawer wide title={m.name} subtitle={`${ROLE_TITLE[m.role]} · ${m.title}${m.generation ? ` · generation ${m.generation + 1}` : ''}`} icon={<Portrait id={m.id} role={m.role} size={34} mood={m.status} />} onClose={onClose}>
      <button onClick={onBack} className="mb-3 text-xs text-muted hover:text-brass">← All merchants</button>
      <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
        <div className="space-y-4">
          <p className="text-sm leading-relaxed text-parchment-dim">{m.bio}</p>
          <div className="grid grid-cols-2 gap-2">
            <Stat label="Gold" value={gold(m.gold)} />
            <Stat label="Net worth" value={gold(m.netWorth)} />
            <Stat label="Workers" value={`${m.workers} / ${m.maxWorkers}`} sub={`${m.wage}g wage/day`} />
            <Stat label="Status" value={<span className={m.status === 'bankrupt' ? 'text-ember' : m.status === 'struggling' ? 'text-brass' : 'text-moss'}>{cap(m.status)}</span>} sub={m.debt ? `debt ${gold(m.debt)}g` : 'debt-free'} />
          </div>
          <div className="panel p-4">
            <div className="label mb-3">Personality</div>
            {(['greed', 'risk', 'patience', 'warmth'] as const).map((k) => (
              <div key={k} className="mb-2 grid grid-cols-[70px_1fr_34px] items-center gap-2 text-xs">
                <span className="capitalize text-parchment-dim">{k}</span>
                <Meter value={m.personality[k]} color={color} />
                <span className="num text-right text-muted">{Math.round(m.personality[k] * 100)}</span>
              </div>
            ))}
          </div>
          <div className="panel p-4">
            <div className="label mb-2">Objectives</div>
            <ul className="space-y-1 text-sm text-parchment-dim">{m.objectives.map((o) => <li key={o}>◆ {o}</li>)}</ul>
          </div>
          <div className="panel p-4">
            <div className="label mb-2">Inventory {m.travel ? '(caravan away)' : ''}</div>
            <div className="flex flex-wrap gap-2">
              {Object.entries(m.inventory).filter(([, q]) => (q ?? 0) >= 1).map(([r, q]) => (
                <span key={r} className="flex items-center gap-1.5 rounded-lg border border-line/60 bg-black/25 px-2 py-1 text-xs"><ResourceIcon r={r} size={16} />{Math.floor(q ?? 0)}</span>
              ))}
              {!Object.values(m.inventory).some((q) => (q ?? 0) >= 1) && <span className="text-xs text-muted">Empty shelves</span>}
            </div>
            {Object.keys(m.ask).length > 0 && <div className="mt-3 text-[11px] text-muted">Asking: {Object.entries(m.ask).map(([r, v]) => `${r} ≥ ${gold(v ?? 0)}`).join(' · ')}</div>}
            {Object.keys(m.bid).length > 0 && <div className="mt-1 text-[11px] text-muted">Bidding: {Object.entries(m.bid).map(([r, v]) => `${r} ≤ ${gold(v ?? 0)}`).join(' · ')}</div>}
          </div>
        </div>
        <div>
          <Tabs value={tab} onChange={setTab} options={[{ value: 'mind', label: 'Decisions & memory' }, { value: 'deal', label: m.role === 'banker' ? 'Credit' : 'Negotiate' }, { value: 'finance', label: 'Finances & shares' }]} />
          {tab === 'mind' && <Mind m={m} />}
          {tab === 'deal' && (m.role === 'banker' ? <Credit me={me} /> : <Negotiate m={m} me={me} onDone={reload} />)}
          {tab === 'finance' && <Finance m={m} me={me} onDone={reload} />}
          <Chat m={m} />
        </div>
      </div>
    </Drawer>
  );
}

function Mind({ m }: { m: Detail }) {
  const decisions = [...m.decisions].reverse().slice(0, 12);
  const memory = [...m.memory].reverse().slice(0, 10);
  return (
    <div className="space-y-4">
      <div>
        <div className="label mb-2">Decision log — why the agent acted</div>
        {decisions.length === 0 ? <Empty>No decisions yet.</Empty> : (
          <ol className="space-y-1.5">
            {decisions.map((d, i) => (
              <li key={i} className="rounded-lg border border-line/50 bg-black/20 px-3 py-2">
                <div className="flex justify-between gap-2 text-sm font-semibold"><span>{d.action}</span><span className="num shrink-0 text-[10px] text-muted">D{Math.floor(d.tick / 24) + 1} {d.tick % 24}h</span></div>
                <ul className="mt-0.5 text-[11.5px] text-muted">{d.reasons.map((r, j) => <li key={j}>· {r}</li>)}</ul>
              </li>
            ))}
          </ol>
        )}
      </div>
      <div>
        <div className="label mb-2">Transaction memory</div>
        <ul className="space-y-1 text-[12px] text-parchment-dim">
          {memory.map((x, i) => <li key={i} className="flex justify-between gap-2 border-b border-line/40 py-1"><span>{x.note}</span><span className="num shrink-0 text-[10px] text-muted">D{Math.floor(x.tick / 24) + 1}</span></li>)}
        </ul>
      </div>
    </div>
  );
}

function Negotiate({ m, me, onDone }: { m: Detail; me: Me; onDone: () => void }) {
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [r, setR] = useState<Resource>((Object.keys(m.ask)[0] as Resource) ?? 'wheat');
  const [qty, setQty] = useState(5);
  const [price, setPrice] = useState(3);
  const [preview, setPreview] = useState<{ accepted: boolean; counterPrice?: number; fairPrice: number; reasons: string[] } | null>(null);
  const [reply, setReply] = useState<string | null>(null);
  const { run, busy } = useAction();
  const rel = m.yourRelationship;

  const check = async () => {
    try {
      setPreview(await api('/deal/preview', { body: { merchantId: m.id, side, resource: r, qty, unitPrice: price } }));
    } catch (e) {
      toast((e as Error).message, 'bad');
    }
  };
  const propose = async () => {
    const res = await run<{ accepted: boolean; executed: boolean; counterPrice?: number; reasons: string[] }>({ type: 'deal', merchantId: m.id, side, resource: r, qty, unitPrice: price });
    if (!res) return;
    const outcome = res.executed ? `Deal accepted: ${qty} ${r} at ${price}g each.` : `Offer refused${res.counterPrice ? `; counter-offer ${res.counterPrice}g each` : ''}. ${res.reasons.join('. ')}`;
    toast(res.executed ? 'Deal struck!' : 'Offer refused', res.executed ? 'good' : 'bad');
    try {
      const said = await api<{ text: string }>(`/merchants/${m.id}/chat`, { body: { message: `I offer to ${side} ${qty} ${r} at ${price} gold each.`, context: outcome } });
      setReply(said.text);
    } catch { setReply(outcome); }
    onDone();
  };

  return (
    <div className="panel p-4">
      <p className="text-xs text-muted">Private deals skip the exchange fee and price impact. {m.name} compares your offer with the best market alternative, adjusted for greed, warmth and your relationship (<b className={rel >= 0 ? 'text-moss' : 'text-ember'}>{rel > 0 ? '+' : ''}{rel}</b>).</p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <select className="input" value={side} onChange={(e) => { setSide(e.target.value as 'buy' | 'sell'); setPreview(null); }}>
          <option value="buy">I buy from {m.name.split(' ')[0]}</option>
          <option value="sell">I sell to {m.name.split(' ')[0]}</option>
        </select>
        <select className="input" value={r} onChange={(e) => { setR(e.target.value as Resource); setPreview(null); }}>
          {RESOURCES.map((x) => <option key={x} value={x}>{RESOURCE_DEFS[x].label}</option>)}
        </select>
        <label className="text-xs text-muted">Quantity<input className="input num mt-1" type="number" min={1} max={200} value={qty} onChange={(e) => { setQty(Math.max(1, Math.min(200, Math.floor(Number(e.target.value) || 1)))); setPreview(null); }} /></label>
        <label className="text-xs text-muted">Price each<input className="input num mt-1" type="number" step="0.1" value={price} onChange={(e) => { setPrice(Number(e.target.value)); setPreview(null); }} /></label>
      </div>
      <div className="mt-3 flex gap-2">
        <button onClick={check} className="btn btn-ghost flex-1 py-2 text-sm">Sound them out</button>
        <button disabled={busy || m.status === 'bankrupt'} onClick={propose} className="btn btn-gold flex-1 py-2 text-sm">Make offer</button>
      </div>
      {preview && (
        <div className={`mt-3 rounded-lg border px-3 py-2 text-xs ${preview.accepted ? 'border-moss/50 text-moss' : 'border-ember/40 text-[#f0b8a0]'}`}>
          {preview.accepted ? 'They would accept this offer.' : preview.counterPrice ? `They would counter at ${gold(preview.counterPrice)}g.` : 'They would refuse.'}
          <div className="mt-1 text-muted">{preview.reasons.join(' · ')}</div>
          {preview.counterPrice && <button className="mt-1 text-brass underline" onClick={() => setPrice(preview.counterPrice!)}>Use {gold(preview.counterPrice)}g</button>}
        </div>
      )}
      {reply && <blockquote className="mt-3 border-l-2 border-brass pl-3 text-sm italic text-parchment-dim">“{reply}”</blockquote>}
      <p className="mt-2 text-[10px] text-muted">You hold {Math.floor(me.player.inventory[r] ?? 0)} {r}.</p>
    </div>
  );
}

function Credit({ me }: { me: Me }) {
  const [amount, setAmount] = useState(50);
  const { run, busy } = useAction();
  const offer = me.player.credit.offer;
  return (
    <div className="panel p-4">
      <p className="text-xs text-muted">Aldric scores every request on leverage, earnings trend, repayment history and reputation, then compares it with the vault&apos;s risk appetite (which tightens after defaults). Loans run 7 days; installments are collected automatically each dawn. Three missed payments is a default.</p>
      <div className="mt-3 grid grid-cols-3 gap-2">
        <Stat label="Credit limit" value={gold(offer.maxAmount)} />
        <Stat label="Risk score" value={Math.round(offer.riskScore * 100)} />
        <Stat label="Rate/day" value={`${(offer.dailyRate * 100).toFixed(2)}%`} />
      </div>
      <div className="mt-3 flex gap-2">
        <input className="input num" type="number" min={10} value={amount} onChange={(e) => setAmount(Math.max(10, Number(e.target.value) || 10))} />
        <button disabled={busy} onClick={() => run({ type: 'loan.request', amount }, `Loan of ${amount}g approved`)} className="btn btn-gold shrink-0 px-4">Request loan</button>
      </div>
      <p className="mt-2 text-[11px] text-muted">Repaid {me.player.credit.repaid} · defaulted {me.player.credit.defaults}</p>
    </div>
  );
}

function Finance({ m, me, onDone }: { m: Detail; me: Me; onDone: () => void }) {
  const [amount, setAmount] = useState(25);
  const { run, busy } = useAction();
  const h = m.history.slice(-30);
  return (
    <div className="space-y-3">
      <div className="panel p-4">
        <div className="label mb-2">Net worth & daily profit</div>
        <LineChart series={[{ name: 'Net worth', color: '#d9a84a', data: h.map((d) => d.netWorth) }, { name: 'Profit', color: '#8fb35f', data: h.map((d) => d.profit) }]} labels={h.map((d) => `D${d.day + 1}`)} height={150} />
        <div className="mt-2 grid grid-cols-3 gap-2 text-center text-xs">
          <div><div className="label">Revenue</div><div className="num font-bold">{gold(m.stats.revenue)}</div></div>
          <div><div className="label">Costs</div><div className="num font-bold">{gold(m.stats.costs)}</div></div>
          <div><div className="label">Trades</div><div className="num font-bold">{m.stats.trades}</div></div>
        </div>
      </div>
      <div className="panel p-4">
        <div className="label mb-2">Invest in {m.name}</div>
        {!m.acceptsInvestment ? <p className="text-sm text-muted">{m.name} does not take outside investors.</p> : (
          <>
            <p className="text-xs text-muted">Share price {gold(m.shareValue)}g · {m.investorCount} investor(s). Investors receive 40% of daily profit pro-rata. Bankruptcy wipes out all shares.</p>
            <p className="mt-1 text-xs">You hold <b>{m.yourShares.toFixed(2)}</b> shares (≈ {gold(m.yourShares * m.shareValue)}g).</p>
            <div className="mt-2 flex gap-2">
              <input className="input num" type="number" min={10} value={amount} onChange={(e) => setAmount(Math.max(10, Number(e.target.value) || 10))} />
              <button disabled={busy || me.player.gold < amount || m.status === 'bankrupt'} onClick={async () => { await run({ type: 'invest', merchantId: m.id, amount }, `Invested ${amount}g in ${m.name}`); onDone(); }} className="btn btn-gold shrink-0 px-4">Invest</button>
              {m.yourShares > 0 && <button disabled={busy} onClick={async () => { await run({ type: 'divest', merchantId: m.id }, 'Shares sold back'); onDone(); }} className="btn btn-ghost shrink-0 px-3">Sell shares</button>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Chat({ m }: { m: Detail }) {
  const [msg, setMsg] = useState('');
  const [log, setLog] = useState<Array<{ who: 'you' | 'them'; text: string; source?: string }>>([]);
  const [busy, setBusy] = useState(false);
  const send = async () => {
    if (!msg.trim()) return;
    const text = msg.trim();
    setMsg('');
    setLog((l) => [...l, { who: 'you', text }]);
    setBusy(true);
    try {
      const r = await api<{ text: string; source: string }>(`/merchants/${m.id}/chat`, { body: { message: text } });
      setLog((l) => [...l, { who: 'them', text: r.text, source: r.source }]);
    } catch (e) {
      toast((e as Error).message, 'bad');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="panel mt-4 p-4">
      <div className="label mb-2 flex items-center gap-1.5"><IconChat size={14} /> Talk to {m.name.split(' ')[0]}</div>
      <div className="max-h-48 space-y-2 overflow-y-auto">
        {log.map((l, i) => (
          <div key={i} className={`text-sm ${l.who === 'you' ? 'text-right text-parchment-dim' : 'text-parchment'}`}>
            <span className={`inline-block rounded-xl px-3 py-1.5 ${l.who === 'you' ? 'bg-brass/15' : 'bg-black/30'}`}>{l.text}</span>
            {l.source && <div className="mt-0.5 text-[9px] uppercase tracking-wider text-muted">{l.source === 'llm' ? 'voiced by Claude · facts from game state' : 'deterministic reply from decision log'}</div>}
          </div>
        ))}
      </div>
      <div className="mt-2 flex gap-2">
        <input className="input" placeholder="Ask about prices, the harvest, their plans…" value={msg} maxLength={300} onChange={(e) => setMsg(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()} />
        <button disabled={busy} onClick={send} className="btn btn-ghost shrink-0 px-4">Say</button>
      </div>
    </div>
  );
}
