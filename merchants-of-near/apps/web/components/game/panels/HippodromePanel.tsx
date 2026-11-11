'use client';
import { useEffect, useRef, useState } from 'react';
import { GAMES, type PublicSnapshot } from '@mon/engine';
import type { Me } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { gameAudio } from '@/lib/audio';
import { Badge, Drawer } from '../../ui';
import { IconHorse } from '../../icons';

type Races = PublicSnapshot['races'];
type Last = NonNullable<Races['last']>;

/** A small galloping horse with its jockey in the stable's colours. */
function Runner({ color, gallop }: { color: string; gallop: boolean }) {
  return (
    <svg width="38" height="26" viewBox="0 0 38 26" className={gallop ? 'animate-[bounce_.3s_ease-in-out_infinite]' : ''} aria-hidden>
      <path d="M6 14c2-4 8-5 14-4l6-5 4 1-2 3 3 4-3 1-2-2-3 2c0 3-2 5-5 5H9c-2 0-4-2-3-5Z" fill="#6b4226" stroke="#2c1a0d" strokeWidth="1.2" />
      <path d="M9 19l-3 6M13 19l1 6M20 19l-2 6M23 18l3 6" stroke="#2c1a0d" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M5 13c-3 0-4 2-5 4" stroke="#2c1a0d" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="17" cy="5" r="2.6" fill={color} stroke="#1a1208" strokeWidth=".8" />
      <path d="M14 7h6l1 5h-8Z" fill={color} stroke="#1a1208" strokeWidth=".8" />
    </svg>
  );
}

/** Replays a finished race: each horse's finishing time follows its place, with a little jostling on the way. */
function Track({ result, horses, onDone }: { result: Last | null; horses: Races['race']['horses']; onDone: () => void }) {
  const [t, setT] = useState(result ? 0 : -1);
  const raf = useRef(0);
  useEffect(() => {
    if (!result) { setT(-1); return; }
    const start = performance.now();
    const D = 5200;
    const step = (now: number) => {
      const k = Math.min(1, (now - start) / D);
      setT(k);
      if (k < 1) raf.current = requestAnimationFrame(step); else onDone();
    };
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result?.id]);
  const list = result ? result.horses : horses;
  const place = (i: number) => (result ? result.order.indexOf(i) : 0);
  const pos = (i: number) => {
    if (!result || t < 0) return 0;
    const finish = 0.72 + place(i) * 0.055; // the winner arrives first
    const p = Math.min(1, t / finish);
    const wobble = Math.sin(t * 18 + i * 1.7) * 0.025 * (1 - p);
    return Math.max(0, Math.min(1, p + wobble));
  };
  return (
    <div className="relative overflow-hidden rounded-2xl border border-[#5a3d1c]" style={{ background: 'linear-gradient(180deg,#6aa84f 0%,#4f8a3a 100%)' }}>
      <div className="absolute inset-y-0 right-[7%] w-1.5" style={{ backgroundImage: 'repeating-linear-gradient(180deg,#fff 0 6px,#111 6px 12px)' }} />
      {list.map((h, i) => (
        <div key={h.name} className="relative flex h-10 items-center border-b border-black/15 last:border-0" style={{ background: i % 2 ? 'rgba(0,0,0,.06)' : 'transparent' }}>
          <div className="absolute left-0 top-0 h-full w-1" style={{ background: h.color }} />
          <div className="absolute" style={{ left: `calc(${pos(i) * 86}% + 4px)` }}><Runner color={h.color} gallop={t >= 0 && t < 1 && pos(i) < 1} /></div>
          {result && t >= 1 && <span className="absolute right-2 rounded bg-black/55 px-1.5 text-xs font-bold num text-parchment">{place(i) + 1}</span>}
        </div>
      ))}
      {t >= 1 && result && <div className="absolute inset-x-0 top-1 text-center display text-sm font-bold text-[#1a1208] drop-shadow">🏆 {result.horses[result.winner].name}</div>}
    </div>
  );
}

/** The Hippodrome: a race every half game-day; bet on a horse at posted odds. */
export function HippodromePanel({ world, me, onClose }: { world: PublicSnapshot; me: Me; onClose: () => void }) {
  const { run, busy } = useAction();
  const { race, last } = world.races;
  const [horse, setHorse] = useState<number | null>(null);
  const [stake, setStake] = useState(10);
  const gold = Math.floor(me.player.gold);
  const hoursLeft = Math.max(0, race.startTick - world.tick);
  const myBets = race.bets.filter((b) => b.playerId === me.player.id);

  // Replay a race the moment it finishes (and once on opening, for the last result).
  const [replay, setReplay] = useState<Last | null>(last);
  const seen = useRef(last?.id);
  useEffect(() => {
    if (last && last.id !== seen.current) { seen.current = last.id; setReplay(last); gameAudio.bell(); }
  }, [last]);
  const mine = (r: Last) => r.payouts.filter((p) => p.playerId === me.player.id);

  return (
    <Drawer wide title="The Hippodrome" subtitle={`Race ${race.number} · bets close in ${hoursLeft} game hour${hoursLeft === 1 ? '' : 's'} · in-game gold only`} icon={<IconHorse />} onClose={onClose}>
      <Track result={replay} horses={race.horses} onDone={() => { if (replay && mine(replay).some((p) => p.win > 0)) gameAudio.fanfare(); }} />
      {replay && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted">Race {replay.number}:</span><b style={{ color: replay.horses[replay.winner].color }}>{replay.horses[replay.winner].name}</b><span className="num text-muted">at {replay.horses[replay.winner].odds}×</span>
          {mine(replay).map((p, i) => <Badge key={i} tone={p.win > 0 ? 'moss' : 'ember'}>{p.win > 0 ? `you won ${p.win}g` : `lost ${p.stake}g on ${replay.horses[p.horse].name}`}</Badge>)}
        </div>
      )}
      <h3 className="mb-2 mt-5 text-xs font-bold uppercase tracking-wider text-muted">Race {race.number}: the field</h3>
      <ul className="grid gap-1.5 sm:grid-cols-2">
        {race.horses.map((h, i) => {
          const pool = race.bets.filter((b) => b.horse === i).reduce((s, b) => s + b.stake, 0);
          return (
            <li key={h.name}>
              <button type="button" onClick={() => setHorse(i)} className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2 text-left transition ${horse === i ? 'border-brass bg-brass/15' : 'border-line/60 bg-black/20 hover:border-brass/50'}`}>
                <span className="h-6 w-6 rounded-full border-2 border-black/50" style={{ background: h.color }} />
                <span className="min-w-0 flex-1"><b className="block truncate">{h.name}</b><span className="text-[11px] text-muted">{pool ? `${pool}g backed` : 'no bets yet'}{myBets.some((b) => b.horse === i) ? ' · yours' : ''}</span></span>
                <span className="num text-lg font-bold text-brass-bright">{h.odds}×</span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-xs uppercase tracking-wider text-muted">Stake</span>
        {[5, 10, 25, 50, 100].map((v) => (
          <button key={v} type="button" disabled={v > gold} onClick={() => setStake(v)} className={`rounded-full border px-3 py-1 text-sm num ${stake === v ? 'border-brass bg-brass/25 text-brass-bright' : 'border-line/60 bg-black/20'} disabled:opacity-35`}>{v}g</button>
        ))}
      </div>
      <button className="btn btn-gold mt-3 w-full py-3" disabled={busy || horse === null || stake > gold || myBets.length >= 3 || hoursLeft === 0}
        onClick={() => horse !== null && run({ type: 'game.race', horse, stake }, `${stake}g on ${race.horses[horse].name}. Good luck!`)}>
        {horse === null ? 'Pick a horse' : myBets.length >= 3 ? 'Three bets per race at most' : `Bet ${stake}g on ${race.horses[horse].name} · pays ${Math.floor(stake * race.horses[horse].odds)}g`}
      </button>
      {race.bets.length > 0 && (
        <>
          <h3 className="mb-2 mt-5 text-xs font-bold uppercase tracking-wider text-muted">Bets on race {race.number} · pool {race.pool}g</h3>
          <ul className="space-y-1 text-sm">{race.bets.slice(-8).reverse().map((b, i) => (
            <li key={i} className="flex justify-between rounded-lg bg-black/20 px-3 py-1.5"><span>{b.name}</span><span className="text-muted">{b.stake}g on <b style={{ color: race.horses[b.horse].color }}>{race.horses[b.horse].name}</b></span></li>
          ))}</ul>
        </>
      )}
      <p className="mt-4 text-xs text-muted">A race runs every {GAMES.race.everyTicks} game hours. Each horse wins as often as its odds say, less a small house edge. Bets {GAMES.minBet}–{GAMES.maxBet}g, up to three per race. Stakes and winnings pass through the richest city&apos;s treasury.</p>
    </Drawer>
  );
}
