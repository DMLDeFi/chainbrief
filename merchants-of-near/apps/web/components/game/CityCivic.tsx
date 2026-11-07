'use client';
import { useState } from 'react';
import { CITY_DEFS, type MarketId, type PublicSnapshot } from '@mon/engine';
import type { Me } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { gold } from '@/lib/format';
import { Sparkline } from '../ui';

/** Population, labour and public works for one city, with a way to fund the works. */
export function CityCivic({ world, me, city }: { world: PublicSnapshot; me: Me; city: MarketId }) {
  const c = world.cities[city];
  const { run, busy } = useAction();
  const [open, setOpen] = useState<string | null>(null);
  if (!c?.works) return null;
  const canFund = city === 'nearhaven' || me.player.charters.includes(city) || me.player.marketAccess.includes(city);
  const pct = (x: number) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(2)}%`;
  const laborUse = c.labor.employed / Math.max(1, c.labor.supply);
  const factor = (label: string, v: number, good: boolean) => (
    <span className={`rounded-md border px-1.5 py-0.5 ${good ? 'border-moss/40 text-moss' : 'border-ember/40 text-ember'}`}>{label} {v}</span>
  );
  return (
    <div className="space-y-3 text-xs">
      <div className="rounded-xl border border-line/50 bg-black/20 p-3">
        <div className="flex items-baseline justify-between">
          <span className="label">People</span>
          <span className={`num font-semibold ${c.growth > 0 ? 'text-moss' : c.growth < 0 ? 'text-ember' : 'text-muted'}`}>{pct(c.growth)} / day</span>
        </div>
        <div className="mt-1 flex items-end justify-between gap-3">
          <div>
            <div className="num text-lg font-bold text-parchment">{c.population.toLocaleString('en')}</div>
            <div className="text-[11px] text-muted">housing for {c.cap.toLocaleString('en')}</div>
          </div>
          {c.popHistory.length > 2 && <Sparkline data={c.popHistory} width={110} height={30} />}
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5 text-[10.5px]">
          {factor('food', c.factors.food, c.factors.food >= 0.9)}
          {factor('jobs', c.factors.jobs, c.factors.jobs > 0.2)}
          {factor('works', c.factors.infrastructure, c.factors.infrastructure > 0)}
        </div>
        <p className="mt-1.5 text-[11px] text-muted">Cities grow when food is affordable, when your businesses give people work, and with every public work. Bigger cities buy more and push land prices up.</p>
      </div>

      <div className="rounded-xl border border-line/50 bg-black/20 p-3">
        <div className="flex items-baseline justify-between"><span className="label">Labour</span><span className="num">{c.labor.employed} / {c.labor.supply} hands</span></div>
        <div className="mt-1.5 h-1.5 overflow-hidden rounded bg-line/50"><div className={`h-full ${laborUse > 0.9 ? 'bg-ember' : laborUse > 0.7 ? 'bg-brass' : 'bg-moss'}`} style={{ width: `${Math.min(100, laborUse * 100)}%` }} /></div>
        <p className="mt-1.5 text-[11px] text-muted">{c.labor.wageFactor > 1 ? `Work is plentiful: wages here are ×${c.labor.wageFactor}.` : 'Plenty of people looking for work: normal wages.'} {laborUse >= 1 && 'Nobody is left to hire until the city grows.'}</p>
      </div>

      <div>
        <div className="label mb-1.5">Public works</div>
        <div className="space-y-1.5">
          {c.works.map((wk) => {
            const done = wk.level >= wk.max;
            const prog = done ? 1 : wk.funded / Math.max(1, wk.cost);
            const left = Math.max(0, Math.ceil(wk.cost - wk.funded));
            return (
              <div key={wk.kind} className="rounded-xl border border-line/50 bg-black/20 p-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-parchment">{wk.name}</span>
                  <span className="flex gap-0.5">{Array.from({ length: wk.max }, (_, i) => <span key={i} className={`h-1.5 w-3 rounded-sm ${i < wk.level ? 'bg-brass-bright' : 'bg-line/60'}`} />)}</span>
                </div>
                <div className="mt-0.5 text-[11px] text-muted">{wk.level > 0 ? `Now: ${wk.effect}.` : ''} {wk.next ? `Next: ${wk.next}.` : 'Complete.'}</div>
                {!done && (
                  <>
                    <div className="mt-1.5 flex items-center gap-2">
                      <div className="h-1.5 flex-1 overflow-hidden rounded bg-line/50"><div className="h-full bg-brass" style={{ width: `${prog * 100}%` }} /></div>
                      <span className="num text-[10.5px] text-parchment-dim">{gold(wk.funded)} / {gold(wk.cost)}g</span>
                    </div>
                    {wk.patrons.length > 0 && <div className="mt-1 text-[10.5px] text-muted">Patrons: {wk.patrons.map((x) => `${x.name} ${gold(x.amount)}g`).join(' · ')}</div>}
                    {canFund ? (
                      open === wk.kind ? (
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {[50, 250, 1000].filter((a) => a < left).concat([left]).map((a) => (
                            <button key={a} disabled={busy || me.player.gold < a || a < 10} onClick={() => run({ type: 'city.fund', city, project: wk.kind, amount: a }, `Gave ${a}g to ${CITY_DEFS[city].name}`)} className="btn btn-gold px-2 py-0.5 text-[11px]">{a === left ? `Finish · ${gold(a)}g` : `${a}g`}</button>
                          ))}
                        </div>
                      ) : (
                        <button onClick={() => setOpen(wk.kind)} className="btn btn-ghost mt-1.5 px-2 py-0.5 text-[11px]">Fund this project</button>
                      )
                    ) : null}
                  </>
                )}
              </div>
            );
          })}
        </div>
        {!canFund && <p className="mt-1.5 text-[11px] text-muted">Open a trading office here to fund its public works.</p>}
        <p className="mt-1.5 text-[11px] text-muted">Gifts pay builders in this city, earn reputation and XP, and make you its patron. The city also invests a little of its own surplus.</p>
      </div>
    </div>
  );
}
