'use client';
import { useMemo, useState } from 'react';
import { CITY_DEFS, CONTRACTS, RESOURCE_DEFS, TIME, type MarketId, type PublicSnapshot, type Resource } from '@mon/engine';
import type { Me } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { gold } from '@/lib/format';
import { Badge, Drawer, Empty, Tabs } from '../../ui';
import { ResourceIcon, IconScroll } from '../../icons';

type Job = PublicSnapshot['contracts'][number];
type T = 'board' | 'mine';

/** Time left, in game days and hours, from a tick count. */
function left(ticks: number) {
  if (ticks <= 0) return 'due now';
  const d = Math.floor(ticks / TIME.ticksPerDay), h = ticks % TIME.ticksPerDay;
  return d > 0 ? `${d}d ${h}h left` : `${h}h left`;
}

/** Delivery jobs: towns and merchants post them, players take them, deliver and get paid. */
export function ContractsPanel({ world, me, onClose }: { world: PublicSnapshot; me: Me; onClose: () => void }) {
  const p = me.player;
  const [tab, setTab] = useState<T>('board');
  const [city, setCity] = useState<MarketId | 'all'>('all');
  const { run, busy } = useAction();
  const jobs = world.contracts ?? [];
  const mine = jobs.filter((j) => j.status === 'taken' && j.takerId === me.user.id);
  const open = jobs.filter((j) => j.status === 'open' && (city === 'all' || j.city === city));
  const canTrade = (c: MarketId) => c === 'nearhaven' || p.charters.includes(c) || p.marketAccess.includes(c);
  const held = (c: MarketId, r: Resource) => Math.floor((c === 'nearhaven' ? p.inventory[r] : p.depots[c]?.[r]) ?? 0);
  const cities = useMemo(() => Array.from(new Set(jobs.map((j) => j.city))), [jobs]);

  const card = (j: Job, own: boolean) => {
    const r = RESOURCE_DEFS[j.resource];
    const have = held(j.city, j.resource);
    const ready = have >= j.qty;
    const access = canTrade(j.city);
    return (
      <li key={j.id} className={`rounded-xl border p-3 ${own ? (ready ? 'border-moss/70 bg-moss/10' : 'border-brass/50 bg-black/30') : 'border-line/60 bg-black/20'}`}>
        <div className="flex items-start gap-3">
          <ResourceIcon r={j.resource} size={34} />
          <div className="min-w-0 flex-1">
            <div className="font-semibold">Deliver {j.qty} {r.label.toLowerCase()}</div>
            <div className="text-xs text-muted">for {j.issuer} · {CITY_DEFS[j.city].name}</div>
            <div className="mt-1.5 flex flex-wrap gap-1.5 text-[11px]">
              <Badge tone="brass">{gold(j.reward)}g</Badge>
              <Badge tone="moss">+{j.rep} reputation</Badge>
              <Badge tone="river">+{j.xp} XP</Badge>
              {own ? <Badge tone={ready ? 'moss' : 'muted'}>{have}/{j.qty} in {j.city === 'nearhaven' ? 'warehouse' : 'depot'}</Badge> : <Badge tone="muted">{j.days} days to deliver</Badge>}
              {own && j.dueTick !== undefined && <Badge tone={j.dueTick - world.tick < TIME.ticksPerDay ? 'ember' : 'muted'}>{left(j.dueTick - world.tick)}</Badge>}
            </div>
          </div>
        </div>
        <div className="mt-2.5 flex gap-2">
          {own ? (
            <>
              <button className="btn btn-gold flex-1 py-2 text-sm" disabled={busy || !ready} onClick={() => run({ type: 'contract.deliver', contractId: j.id }, (d: Job) => `Delivered. ${CITY_DEFS[d.city].name} paid you ${gold(d.reward)}g`)}>
                {ready ? 'Deliver now' : `Need ${j.qty - have} more`}
              </button>
              <button className="btn btn-ghost py-2 text-sm" disabled={busy} onClick={() => run({ type: 'contract.abandon', contractId: j.id }, `Job abandoned (−${CONTRACTS.abandonRep} reputation)`)}>Abandon</button>
            </>
          ) : (
            <button className="btn btn-gold flex-1 py-2 text-sm" disabled={busy || !access || mine.length >= CONTRACTS.maxActive} onClick={() => run({ type: 'contract.accept', contractId: j.id }, 'Job accepted. Bring the goods before the deadline')}>
              {!access ? `Needs a trading office in ${CITY_DEFS[j.city].name}` : mine.length >= CONTRACTS.maxActive ? `You hold ${CONTRACTS.maxActive} jobs already` : 'Take the job'}
            </button>
          )}
        </div>
      </li>
    );
  };

  return (
    <Drawer wide title="Contracts" subtitle="Take the job. Deliver the goods. Get paid by the town, and earn reputation." icon={<IconScroll />} onClose={onClose}>
      <Tabs value={tab} onChange={setTab} options={[{ value: 'board', label: `Job board (${jobs.filter((j) => j.status === 'open').length})` }, { value: 'mine', label: `My jobs (${mine.length}/${CONTRACTS.maxActive})` }]} />
      {tab === 'board' ? (
        <>
          <div className="mb-3 flex flex-wrap gap-1.5">
            {(['all', ...cities] as const).map((c) => (
              <button key={c} onClick={() => setCity(c)} className={`rounded-lg border px-2.5 py-1 text-xs ${city === c ? 'border-brass bg-brass/20 text-brass-bright' : 'border-line/60 text-muted'}`}>
                {c === 'all' ? 'All cities' : CITY_DEFS[c].name}
              </button>
            ))}
          </div>
          {open.length === 0 ? <Empty>No open jobs here right now. New jobs are posted every morning.</Empty> : <ul className="space-y-2">{open.sort((a, b) => Number(canTrade(b.city)) - Number(canTrade(a.city)) || b.reward - a.reward).map((j) => card(j, false))}</ul>}
          <p className="mt-3 text-xs text-muted">Missing a deadline costs {CONTRACTS.failRep} reputation; abandoning a job costs {CONTRACTS.abandonRep}. Rewards are paid from the city's purse.</p>
        </>
      ) : mine.length === 0 ? (
        <Empty>You have no jobs yet. Take one from the job board, buy or make the goods, and deliver them to that city.</Empty>
      ) : (
        <ul className="space-y-2">{mine.map((j) => card(j, true))}</ul>
      )}
    </Drawer>
  );
}
