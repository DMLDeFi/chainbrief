'use client';
import { useState } from 'react';
import { BUSINESS_DEFS, CITY_DEFS, LEVELS, MAX_LEVEL, type MarketId, type PublicSnapshot } from '@mon/engine';
import type { Me } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { gold } from '@/lib/format';
import { Badge, Drawer, Empty, LineChart, Stat, Tabs } from '../../ui';
import { IconEmpire } from '../../icons';

type Tab = 'overview' | 'companies' | 'acquisitions' | 'ranks';

/** The corporate empire: balance sheet, results, companies, takeovers and the climb through the ranks. */
export function EmpirePanel({ world, me, onClose }: { world: PublicSnapshot; me: Me; onClose: () => void }) {
  const p = me.player;
  const c = p.company;
  const [tab, setTab] = useState<Tab>('overview');
  return (
    <Drawer wide title={c.name} subtitle={`${p.rankTitle} · rank ${p.level} of ${MAX_LEVEL}${p.powerhouseTier > 1 ? ` · tier ${p.powerhouseTier}` : ''}`} icon={<IconEmpire />} onClose={onClose}>
      <Tabs<Tab> value={tab} onChange={setTab} options={[
        { value: 'overview', label: 'Overview' },
        { value: 'companies', label: `Companies${p.companies.length ? ` · ${p.companies.length}` : ''}` },
        { value: 'acquisitions', label: `Acquisitions${p.offersReceived.length ? ` · ${p.offersReceived.length} offer${p.offersReceived.length === 1 ? '' : 's'}` : ''}` },
        { value: 'ranks', label: 'Ranks' },
      ]} />
      <div>
        {tab === 'overview' && <Overview me={me} />}
        {tab === 'companies' && <Companies me={me} />}
        {tab === 'acquisitions' && <Acquisitions me={me} world={world} />}
        {tab === 'ranks' && <Ranks me={me} />}
      </div>
    </Drawer>
  );
}

function Overview({ me }: { me: Me }) {
  const p = me.player;
  const c = p.company;
  const r = c.results;
  const cities = Object.entries(c.byCity) as Array<[MarketId, typeof r]>;
  const h = c.history;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Stat label="Company value" value={`${gold(c.netWorth)}g`} sub="net worth" />
        <Stat label="Cash" value={`${gold(c.cash)}g`} sub={c.debt > 0 ? `${gold(c.debt)}g owed` : 'no debts'} />
        <Stat label="Profit, 7 days" value={<span className={r.profit7 >= 0 ? 'text-moss' : 'text-ember'}>{gold(r.profit7)}g</span>} sub={`yesterday ${gold(r.profit1)}g`} />
        <Stat label="Return, 30 days" value={<span className={c.monthlyReturn >= 0 ? 'text-moss' : 'text-ember'}>{c.monthlyReturn}%</span>} sub="profit vs. what you spent building" />
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="panel p-3 text-xs">
          <div className="label mb-2">Balance sheet</div>
          {([['Cash', c.balance.cash], ['Businesses', c.balance.businesses], ['Land', c.balance.land], ['Goods & shipments', c.balance.goods], ['Merchant shares', c.balance.investments]] as Array<[string, number]>).map(([k, v]) => (
            <div key={k} className="flex justify-between border-b border-line/30 py-1"><span className="text-parchment-dim">{k}</span><span className="num">{gold(v)}g</span></div>
          ))}
          <div className="flex justify-between border-b border-line/30 py-1"><span className="text-parchment-dim">Loans</span><span className="num text-ember">−{gold(c.balance.liabilities)}g</span></div>
          <div className="flex justify-between pt-1.5 font-bold"><span>Net worth</span><span className="num">{gold(c.netWorth)}g</span></div>
        </div>
        <div className="panel p-3 text-xs">
          <div className="label mb-2">Last 7 days</div>
          {([['Revenue', r.revenue7], ['Expenses', -r.expenses7], ['Profit', r.profit7]] as Array<[string, number]>).map(([k, v]) => (
            <div key={k} className="flex justify-between border-b border-line/30 py-1"><span className="text-parchment-dim">{k}</span><span className={`num ${v < 0 ? 'text-ember' : ''}`}>{gold(v)}g</span></div>
          ))}
          <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-parchment-dim">
            <span>Businesses <b className="num text-parchment">{r.businesses}</b></span>
            <span>Employees <b className="num text-parchment">{r.employees}</b></span>
            <span>Capacity <b className="num text-parchment">{c.capacity}</b></span>
            <span>Stock <b className="num text-parchment">{c.stockUnits}</b> units</span>
            <span>Property <b className="num text-parchment">{c.plots}</b> plots</span>
            <span>Cities <b className="num text-parchment">{p.citiesWithBusiness}</b> of 6</span>
          </div>
        </div>
      </div>
      {h.length > 1 && (
        <div className="panel p-3">
          <div className="label mb-1">Net worth</div>
          <LineChart series={[{ name: 'Net worth', color: '#d9a84a', data: h.map((x) => x.netWorth) }, { name: 'Cash', color: '#6aa3c8', data: h.map((x) => x.gold) }]} labels={h.map((x) => `D${x.day + 1}`)} height={130} />
        </div>
      )}
      <div className="overflow-x-auto rounded-xl border border-line/60">
        <table className="w-full text-xs">
          <thead><tr className="text-left text-muted"><th className="px-3 py-2">By city</th><th className="px-2 py-2 text-right">Businesses</th><th className="px-2 py-2 text-right">Employees</th><th className="px-2 py-2 text-right">Revenue 7d</th><th className="px-2 py-2 text-right">Profit 7d</th><th className="px-2 py-2 text-right">Assets</th></tr></thead>
          <tbody>
            {cities.length === 0 && <tr><td className="px-3 py-3 text-muted" colSpan={6}>No businesses yet.</td></tr>}
            {cities.map(([id, t]) => (
              <tr key={id} className="border-t border-line/40">
                <td className="px-3 py-1.5 display font-bold">{CITY_DEFS[id].name}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{t.businesses}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{t.employees}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{gold(t.revenue7)}g</td>
                <td className={`px-2 py-1.5 text-right tabular-nums ${t.profit7 >= 0 ? 'text-moss' : 'text-ember'}`}>{gold(t.profit7)}g</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{gold(t.assets)}g</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Companies({ me }: { me: Me }) {
  const p = me.player;
  const { run, busy } = useAction();
  const [name, setName] = useState(p.company.name);
  const [sub, setSub] = useState('');
  const groups = [{ id: 'parent', name: `${p.company.name} (parent)` }, ...p.companies];
  return (
    <div className="space-y-4 text-xs">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex-1"><span className="label">Parent company</span><input className="input mt-1 !py-1.5" value={name} maxLength={32} onChange={(e) => setName(e.target.value)} /></label>
        <button disabled={busy || name === p.company.name} onClick={() => run({ type: 'company.name', name }, 'Company renamed')} className="btn btn-ghost px-3 py-1.5">Rename</button>
      </div>
      <p className="text-muted">Each company is run separately: coordination overhead grows with the number of businesses <i>within</i> a company, so spreading a large empire over subsidiaries keeps upkeep down. Each subsidiary costs 300g to register and 4g a day to administer. Your rank allows {p.subsidiaryLimit} subsidiar{p.subsidiaryLimit === 1 ? 'y' : 'ies'}.</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {groups.map((g) => {
          const t = p.company.byCompany[g.id];
          return (
            <div key={g.id} className="rounded-xl border border-line/60 bg-black/20 p-3">
              <div className="flex items-center justify-between"><span className="display font-bold">{g.name}</span>{g.id !== 'parent' && <button disabled={busy} onClick={() => run({ type: 'company.dissolve', companyId: g.id }, 'Subsidiary dissolved')} className="text-[11px] text-muted hover:text-ember">dissolve</button>}</div>
              <div className="mt-1 text-parchment-dim">{t?.businesses ?? 0} businesses · {t?.employees ?? 0} employees · profit 7d <span className={(t?.profit7 ?? 0) >= 0 ? 'text-moss' : 'text-ember'}>{gold(t?.profit7 ?? 0)}g</span></div>
            </div>
          );
        })}
      </div>
      {p.subsidiaryLimit > p.companies.length ? (
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex-1"><span className="label">New subsidiary</span><input className="input mt-1 !py-1.5" placeholder="e.g. Vale Grain Company" value={sub} maxLength={32} onChange={(e) => setSub(e.target.value)} /></label>
          <button disabled={busy || sub.trim().length < 3 || p.gold < 300} onClick={async () => { if (await run({ type: 'company.found', name: sub }, 'Subsidiary founded')) setSub(''); }} className="btn btn-gold px-3 py-1.5">Found · 300g</button>
        </div>
      ) : <p className="text-muted">{p.subsidiaryLimit === 0 ? 'Subsidiaries open at rank 5, Trade Magnate.' : 'Rise in rank to run more subsidiaries.'}</p>}
      {p.companies.length > 0 && p.businesses.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-line/60">
          <table className="w-full">
            <thead><tr className="text-left text-muted"><th className="px-3 py-2">Business</th><th className="px-2 py-2">City</th><th className="px-2 py-2">Company</th></tr></thead>
            <tbody>
              {p.businesses.map((b) => (
                <tr key={b.id} className="border-t border-line/40">
                  <td className="px-3 py-1.5">{BUSINESS_DEFS[b.kind].name} <span className="text-muted">Lv {b.level}</span></td>
                  <td className="px-2 py-1.5">{CITY_DEFS[b.city].name}</td>
                  <td className="px-2 py-1.5">
                    <select disabled={busy} className="input !w-48 !py-0.5" value={b.companyId ?? ''} onChange={(e) => run({ type: 'company.assign', businessId: b.id, companyId: e.target.value || null }, 'Business moved')}>
                      <option value="">{p.company.name} (parent)</option>
                      {p.companies.map((co) => <option key={co.id} value={co.id}>{co.name}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Acquisitions({ me, world }: { me: Me; world: PublicSnapshot }) {
  const p = me.player;
  const { run, busy } = useAction();
  const [bids, setBids] = useState<Record<string, number>>({});
  const targets = world.businesses.filter((b) => b.ownerId !== me.user.id && !b.deeded);
  const canBuy = p.level >= 6;
  return (
    <div className="space-y-4 text-xs">
      {p.offersReceived.length > 0 && (
        <div>
          <div className="label mb-1.5">Offers for your businesses</div>
          {p.offersReceived.map((o) => (
            <div key={o.id} className="mb-1.5 flex flex-wrap items-center gap-2 rounded-xl border border-brass/40 bg-brass/10 px-3 py-2">
              <span><b>{o.buyer}</b> offers <b className="num">{gold(o.price)}g</b> for <b>{o.business}</b></span>
              <span className="text-muted">(its sale value is {gold(o.value)}g)</span>
              <span className="flex-1" />
              <button disabled={busy} onClick={() => run({ type: 'offer.respond', offerId: o.id, accept: true }, 'Sold')} className="btn btn-gold px-2.5 py-1">Accept</button>
              <button disabled={busy} onClick={() => run({ type: 'offer.respond', offerId: o.id, accept: false }, 'Declined')} className="btn btn-ghost px-2.5 py-1">Decline</button>
            </div>
          ))}
        </div>
      )}
      {p.offersMade.length > 0 && (
        <div>
          <div className="label mb-1.5">Your open offers</div>
          {p.offersMade.map((o) => (
            <div key={o.id} className="mb-1.5 flex items-center gap-2 rounded-xl border border-line/60 bg-black/20 px-3 py-2">
              <span>{gold(o.price)}g for <b>{o.business}</b> ({o.seller}) · held in escrow until answered or withdrawn</span>
              <span className="flex-1" />
              <button disabled={busy} onClick={() => run({ type: 'offer.cancel', offerId: o.id }, 'Offer withdrawn')} className="btn btn-ghost px-2.5 py-1">Withdraw</button>
            </div>
          ))}
        </div>
      )}
      <div>
        <div className="label mb-1.5">Businesses you could acquire</div>
        <p className="mb-2 text-muted">{canBuy ? 'Make an offer: the gold is held in escrow until the owner accepts or declines, or you withdraw it. You need a trading office in the business’s city. NEAR-deeded businesses trade on the deed marketplace instead.' : 'Acquisitions open at rank 6, Master Merchant.'}</p>
        {targets.length === 0 ? <Empty>No other player businesses in the world yet.</Empty> : (
          <div className="overflow-x-auto rounded-xl border border-line/60">
            <table className="w-full">
              <thead><tr className="text-left text-muted"><th className="px-3 py-2">Business</th><th className="px-2 py-2">Owner</th><th className="px-2 py-2">City</th><th className="px-2 py-2 text-right">Value</th><th className="px-3 py-2" /></tr></thead>
              <tbody>
                {targets.slice(0, 40).map((b) => {
                  const bid = bids[b.id] ?? Math.ceil(b.value);
                  return (
                    <tr key={b.id} className="border-t border-line/40">
                      <td className="px-3 py-1.5">{BUSINESS_DEFS[b.kind].name} <span className="text-muted">Lv {b.level}</span></td>
                      <td className="px-2 py-1.5">{b.owner}</td>
                      <td className="px-2 py-1.5">{CITY_DEFS[b.city].name}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{gold(b.value)}g</td>
                      <td className="px-3 py-1.5">
                        <div className="flex justify-end gap-1.5">
                          <input className="input num !w-24 !py-0.5" type="number" min={10} value={bid} onChange={(e) => setBids({ ...bids, [b.id]: Number(e.target.value) })} aria-label="Offer" />
                          <button disabled={busy || !canBuy || p.gold < bid} onClick={() => run({ type: 'offer.make', businessId: b.id, price: Math.round(bid) }, 'Offer sent')} className="btn btn-gold px-2 py-0.5">Offer</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Ranks({ me }: { me: Me }) {
  const p = me.player;
  const nw = p.company.netWorth;
  const req = (have: number, need: number, label: string) => <span className={have >= need ? 'text-moss' : 'text-parchment-dim'}>{label} {need.toLocaleString('en')}</span>;
  return (
    <div className="space-y-1.5 text-xs">
      {LEVELS.map((l) => {
        const done = p.level >= l.level, now = p.level === l.level;
        return (
          <div key={l.level} className={`rounded-xl border px-3 py-2 ${now ? 'border-brass bg-brass/10' : done ? 'border-moss/30 bg-moss/5' : 'border-line/50 bg-black/20'}`}>
            <div className="flex items-center justify-between gap-2">
              <span className="display font-bold">{l.level}. {l.title}</span>
              {now ? <Badge tone="brass">your rank</Badge> : done ? <Badge tone="moss">reached</Badge> : null}
            </div>
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
              {req(p.xp, l.xp, 'XP')}
              {req(nw, l.netWorth, 'net worth')}
              {req(p.businesses.length, l.businesses, 'businesses')}
              {req(p.reputation, l.reputation, 'reputation')}
              {l.cities ? req(p.citiesWithBusiness, l.cities, 'cities') : null}
            </div>
            <div className="mt-0.5 text-muted">Unlocks: {l.unlocks.join(', ')}</div>
          </div>
        );
      })}
      <div className="rounded-xl border border-near/30 bg-near/5 px-3 py-2">
        <div className="display font-bold text-near">Beyond: Powerhouse tiers</div>
        <div className="mt-0.5 text-muted">At rank 10 there is no ceiling: every doubling of net worth past 300,000g adds a tier (Economic Powerhouse II, III, …).{p.powerhouseTier > 0 ? ` You are at tier ${p.powerhouseTier}.` : ''}</div>
      </div>
    </div>
  );
}
