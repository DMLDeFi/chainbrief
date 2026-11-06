'use client';
import { useState } from 'react';
import Link from 'next/link';
import type { PublicSnapshot } from '@mon/engine';
import type { Me } from '@/lib/api';
import { api } from '@/lib/api';
import { toast } from '@/lib/store';
import { cap, gold, hourLabel, timeOfDay } from '@/lib/format';
import { Coin, IconFast, Logo, WeatherIcon } from '../icons';
import type { PanelId } from './GameShell';

export function Hud({ world, me, onOpen, connected }: { world: PublicSnapshot; me: Me; onOpen: (p: PanelId) => void; connected: boolean }) {
  const p = me.player;
  const [ffOpen, setFfOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const next = p.nextLevel;
  const xpPct = next ? Math.min(1, p.xp / next.xp) : 1;

  const fastForward = async (days: number) => {
    setFfOpen(false);
    setBusy(true);
    try {
      const r = await api<{ fromTick: number; toTick: number; feed: number }>('/sim/fast-forward', { body: { days } });
      toast(`Simulated ${days} day${days > 1 ? 's' : ''}: ${r.toTick - r.fromTick} hours, ${r.feed} economic events`, 'good');
    } catch (e) {
      toast((e as Error).message, 'bad');
    } finally {
      setBusy(false);
    }
  };

  return (
    <header className="pointer-events-none absolute inset-x-0 top-0 z-[35] flex items-start justify-between gap-2 p-3 max-sm:p-2">
      {/* Identity */}
      <div className="panel-glass pointer-events-auto flex items-center gap-3 px-3 py-2">
        <Link href="/" aria-label="Home" className="max-sm:hidden"><Logo size={34} /></Link>
        <button className="text-left" onClick={() => onOpen('achievements')}>
          <div className="flex items-center gap-2">
            <span className="display max-w-[110px] truncate text-sm font-bold sm:max-w-none">{p.name}</span>
            <span className="whitespace-nowrap rounded-md bg-brass/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-brass">Lv {p.level}<span className="max-sm:hidden"> · {p.levelTitle}</span></span>
          </div>
          <div className="mt-1 flex items-center gap-2">
            <div className="h-1.5 w-36 overflow-hidden rounded-full bg-black/50 max-sm:w-16">
              <div className="h-full rounded-full bg-gradient-to-r from-brass-deep to-brass-bright transition-[width] duration-700" style={{ width: `${xpPct * 100}%` }} />
            </div>
            <span className="num whitespace-nowrap text-[10px] text-muted">{p.xp}{next ? ` / ${next.xp}` : ''} XP</span>
          </div>
        </button>
      </div>

      {/* World clock */}
      <div className="panel-glass pointer-events-auto hidden items-center gap-4 px-4 py-2 lg:flex">
        <div>
          <div className="label">Day {world.day}</div>
          <div className="num display text-base font-bold">{hourLabel(world.hour)} <span className="text-xs font-normal text-muted">{timeOfDay(world.hour)}</span></div>
        </div>
        <div className="h-8 w-px bg-line" />
        <div className="flex items-center gap-2">
          <WeatherIcon w={world.weather} size={22} />
          <div>
            <div className="label">{cap(world.season)}</div>
            <div className="text-sm font-semibold">{cap(world.weather)}</div>
          </div>
        </div>
        <div className="h-8 w-px bg-line" />
        <button onClick={() => onOpen('economy')} className="text-left">
          <div className="label">Population</div>
          <div className="num text-sm font-semibold">{world.population} <span className={`text-xs ${world.foodSatisfaction >= 90 ? 'text-moss' : world.foodSatisfaction < 60 ? 'text-ember' : 'text-muted'}`}>· fed {world.foodSatisfaction}%</span></div>
        </button>
        {world.events.length > 0 && (
          <>
            <div className="h-8 w-px bg-line" />
            <div className="flex gap-1.5">
              {world.events.map((e) => (
                <span key={e.id} title={e.description} className="rounded-full border border-ember/50 bg-ember/15 px-2.5 py-1 text-xs font-bold text-ember animate-pulse-soft">{e.title}</span>
              ))}
            </div>
          </>
        )}
        {!connected && <span className="text-xs text-ember">reconnecting…</span>}
      </div>

      {/* Wealth + fast-forward */}
      <div className="pointer-events-auto flex items-start gap-2">
        <button onClick={() => onOpen('inventory')} className="panel-glass flex items-center gap-3 px-3 py-2 text-left">
          <Coin size={22} className="max-sm:hidden" />
          <div>
            <div className="num display text-lg font-bold leading-none text-brass-bright">{gold(p.gold)}</div>
            <div className="num mt-1 whitespace-nowrap text-[10px] text-muted">net worth {gold(p.netWorth)}</div>
          </div>
        </button>
        <div className="relative">
          <button disabled={busy} onClick={() => setFfOpen((v) => !v)} className="btn btn-gold h-[50px] px-4 max-sm:px-3" aria-haspopup="menu" aria-expanded={ffOpen}>
            <IconFast size={18} /> <span className="hidden sm:inline">{busy ? 'Simulating…' : 'Fast-forward'}</span>
          </button>
          {ffOpen && (
            <div role="menu" className="panel absolute right-0 mt-2 w-56 p-2 animate-rise">
              <div className="label px-2 pb-2 pt-1">Simulate the economy</div>
              {[1, 3, 7, 14].map((d) => (
                <button role="menuitem" key={d} onClick={() => fastForward(d)} className="flex w-full items-center justify-between rounded-lg px-2 py-2 text-sm hover:bg-white/5">
                  <span>{d} day{d > 1 ? 's' : ''}</span>
                  <span className="num text-xs text-muted">{d * 24} hours</span>
                </button>
              ))}
              <p className="px-2 pt-2 text-[11px] leading-snug text-muted">Advances the shared world: every merchant decides, produces and trades each simulated hour.</p>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
