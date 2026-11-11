'use client';
import { useEffect, useRef, useState } from 'react';
import { GAMES } from '@mon/engine';
import type { Me } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { gameAudio } from '@/lib/audio';
import { Drawer } from '../../ui';
import { IconDice } from '../../icons';

type DiceResult = { you: [number, number]; house: [number, number]; outcome: 'win' | 'lose' | 'push'; win: number; stake: number };
type CupsResult = { pick: number; coin: number; win: number; stake: number };

const PIPS: Record<number, Array<[number, number]>> = {
  1: [[2, 2]], 2: [[1, 1], [3, 3]], 3: [[1, 1], [2, 2], [3, 3]],
  4: [[1, 1], [3, 1], [1, 3], [3, 3]], 5: [[1, 1], [3, 1], [2, 2], [1, 3], [3, 3]], 6: [[1, 1], [3, 1], [1, 2], [3, 2], [1, 3], [3, 3]],
};

/** A bone die with pips, tumbling while it rolls. */
function Die({ value, rolling, tone }: { value: number; rolling: boolean; tone: 'you' | 'house' }) {
  return (
    <svg width="54" height="54" viewBox="0 0 40 40" className={rolling ? 'animate-[spin_.35s_linear_infinite]' : 'transition-transform duration-300'} aria-label={`die showing ${value}`}>
      <rect x="2" y="2" width="36" height="36" rx="8" fill={tone === 'you' ? '#f3e6c8' : '#e6d2b0'} stroke="#5a3d1c" strokeWidth="2" />
      <rect x="4" y="4" width="32" height="10" rx="6" fill="#fff" opacity=".35" />
      {PIPS[value].map(([x, y], i) => <circle key={i} cx={x * 10} cy={y * 10} r="3.4" fill={tone === 'you' ? '#7a1f14' : '#1a1208'} />)}
    </svg>
  );
}

/** A wooden cup; lifted, it shows whether the coin was underneath. */
function Cup({ lifted, coin, onClick, disabled, x }: { lifted: boolean; coin: boolean; onClick: () => void; disabled: boolean; x: number }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className="absolute bottom-0 h-28 w-24 transition-[left] duration-200 ease-in-out disabled:cursor-default" style={{ left: `${x}%`, transform: 'translateX(-50%)' }} aria-label="cup">
      <svg viewBox="0 0 60 80" className="absolute inset-0 h-full w-full overflow-visible">
        {coin && (<g><ellipse cx="30" cy="72" rx="11" ry="5" fill="#8a5f1c" /><ellipse cx="30" cy="70" rx="11" ry="5" fill="#f0c45a" /><text x="30" y="73" textAnchor="middle" fontSize="7" fontWeight="700" fill="#8a5f1c">N</text></g>)}
        <g style={{ transform: lifted ? 'translateY(-34px) rotate(-8deg)' : 'none', transformOrigin: '30px 40px', transition: 'transform .35s cubic-bezier(.3,1.4,.5,1)' }}>
          <path d="M14 10h32l7 64H7Z" fill="#8a5a33" stroke="#3b2513" strokeWidth="2" />
          <path d="M16 22h28M12 52h36" stroke="#5d3b20" strokeWidth="2.5" />
          <path d="M18 12l-5 60" stroke="#c49060" strokeWidth="3" opacity=".5" />
          <ellipse cx="30" cy="10" rx="16" ry="4" fill="#5d3b20" stroke="#3b2513" strokeWidth="2" />
        </g>
      </svg>
    </button>
  );
}

function Stake({ value, onChange, max }: { value: number; onChange: (v: number) => void; max: number }) {
  const options = [5, 10, 25, 50, 100].filter((v) => v <= GAMES.maxBet);
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="mr-1 text-xs uppercase tracking-wider text-muted">Stake</span>
      {options.map((v) => (
        <button key={v} type="button" disabled={v > max} onClick={() => onChange(v)} className={`rounded-full border px-3 py-1 text-sm num transition ${value === v ? 'border-brass bg-brass/25 text-brass-bright' : 'border-line/60 bg-black/20 hover:border-brass/60'} disabled:opacity-35`}>{v}g</button>
      ))}
    </div>
  );
}

const rnd = () => 1 + Math.floor(Math.random() * 6);

/** The Gilded Tankard: dice against the innkeeper and the shell game, for in-game gold. */
export function TavernPanel({ me, onClose }: { me: Me; onClose: () => void }) {
  const { run, busy } = useAction();
  const [game, setGame] = useState<'dice' | 'cups'>('dice');
  const [stake, setStake] = useState(10);
  const gold = Math.floor(me.player.gold);

  // Dice
  const [faces, setFaces] = useState<{ you: [number, number]; house: [number, number] }>({ you: [6, 6], house: [1, 1] });
  const [rolling, setRolling] = useState(false);
  const [dice, setDice] = useState<DiceResult | null>(null);
  const spin = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  useEffect(() => () => clearInterval(spin.current), []);
  const roll = async () => {
    setDice(null); setRolling(true);
    spin.current = setInterval(() => setFaces({ you: [rnd(), rnd()], house: [rnd(), rnd()] }), 80);
    const started = Date.now();
    const r = await run<DiceResult>({ type: 'game.dice', stake });
    await new Promise((ok) => setTimeout(ok, Math.max(0, 900 - (Date.now() - started))));
    clearInterval(spin.current); setRolling(false);
    if (r) { setFaces({ you: r.you, house: r.house }); setDice(r); if (r.outcome === 'win') gameAudio.fanfare(); }
  };

  // Cups
  const [order, setOrder] = useState([0, 1, 2]); // slot of each cup
  const [phase, setPhase] = useState<'ready' | 'shuffling' | 'pick' | 'reveal'>('ready');
  const [cups, setCups] = useState<CupsResult | null>(null);
  const shuffle = async () => {
    setCups(null); setPhase('shuffling');
    for (let i = 0; i < 9; i++) {
      await new Promise((ok) => setTimeout(ok, 210));
      setOrder((o) => { const n = o.slice(); const a = Math.floor(Math.random() * 3); const b = (a + 1 + Math.floor(Math.random() * 2)) % 3; [n[a], n[b]] = [n[b], n[a]]; return n; });
    }
    setPhase('pick');
  };
  const pick = async (cup: number) => {
    if (phase !== 'pick') return;
    const r = await run<CupsResult>({ type: 'game.cups', stake, pick: cup });
    if (!r) { setPhase('ready'); return; }
    setCups(r); setPhase('reveal');
    if (r.win) gameAudio.fanfare();
  };
  const slotX = (slot: number) => 18 + slot * 32;

  const tab = (id: 'dice' | 'cups', label: string) => (
    <button type="button" onClick={() => setGame(id)} className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold transition ${game === id ? 'bg-brass/25 text-brass-bright' : 'text-muted hover:text-parchment'}`}>{label}</button>
  );

  return (
    <Drawer title="The Gilded Tankard" subtitle="Tavern games for in-game gold · the house is backed by the richest city's treasury" icon={<IconDice />} onClose={onClose}>
      <div className="mb-4 flex gap-1 rounded-xl border border-line/60 bg-black/25 p-1">{tab('dice', '🎲 Merchant’s Dice')}{tab('cups', '🥤 Find the Coin')}</div>
      <div className="relative mb-4 overflow-hidden rounded-2xl border border-[#5a3d1c] p-4" style={{ background: 'radial-gradient(ellipse at 50% 30%, #2f5a35 0%, #1d3a22 60%, #12261a 100%)', boxShadow: 'inset 0 0 40px rgba(0,0,0,.6)' }}>
        <div className="pointer-events-none absolute inset-0 opacity-20" style={{ backgroundImage: 'repeating-linear-gradient(45deg, transparent 0 6px, rgba(255,255,255,.05) 6px 7px)' }} />
        {game === 'dice' ? (
          <div className="relative grid grid-cols-2 gap-4 text-center">
            <div><div className="mb-2 text-xs uppercase tracking-wider text-parchment-dim">You</div><div className="flex justify-center gap-2"><Die value={faces.you[0]} rolling={rolling} tone="you" /><Die value={faces.you[1]} rolling={rolling} tone="you" /></div><div className="num mt-2 text-2xl font-bold">{rolling ? '…' : faces.you[0] + faces.you[1]}</div></div>
            <div><div className="mb-2 text-xs uppercase tracking-wider text-parchment-dim">Innkeeper</div><div className="flex justify-center gap-2"><Die value={faces.house[0]} rolling={rolling} tone="house" /><Die value={faces.house[1]} rolling={rolling} tone="house" /></div><div className="num mt-2 text-2xl font-bold">{rolling ? '…' : faces.house[0] + faces.house[1]}</div></div>
            <div className="col-span-2 min-h-[28px] display text-lg">
              {dice && (dice.outcome === 'win' ? <span className="text-brass-bright">You win {dice.win}g!</span> : dice.outcome === 'push' ? <span className="text-parchment-dim">A tie: your {dice.stake}g comes back.</span> : <span className="text-ember">The house takes {dice.stake}g.</span>)}
            </div>
          </div>
        ) : (
          <div className="relative">
            <div className="relative mx-auto h-36 max-w-sm">
              {[0, 1, 2].map((c) => (
                <Cup key={c} x={slotX(order[c])} disabled={phase !== 'pick' || busy} onClick={() => pick(c)}
                  lifted={phase === 'reveal' && (c === cups?.coin || c === cups?.pick)} coin={phase === 'reveal' && c === cups?.coin} />
              ))}
            </div>
            <div className="mt-2 min-h-[28px] text-center display text-lg">
              {phase === 'ready' && <span className="text-parchment-dim">The coin goes under a cup…</span>}
              {phase === 'shuffling' && <span className="text-parchment-dim animate-pulse-soft">Watch closely…</span>}
              {phase === 'pick' && <span className="text-brass-bright">Pick a cup!</span>}
              {phase === 'reveal' && cups && (cups.win ? <span className="text-brass-bright">Found it! You win {cups.win}g.</span> : <span className="text-ember">Empty. The house takes {cups.stake}g.</span>)}
            </div>
          </div>
        )}
      </div>
      <Stake value={stake} onChange={setStake} max={gold} />
      <div className="mt-3 flex items-center gap-3">
        {game === 'dice'
          ? <button className="btn btn-gold flex-1 py-3" disabled={busy || rolling || stake > gold} onClick={roll}>Roll the dice · {stake}g</button>
          : <button className="btn btn-gold flex-1 py-3" disabled={busy || phase === 'shuffling' || phase === 'pick' || stake > gold} onClick={shuffle}>{phase === 'reveal' ? 'Play again' : 'Shuffle the cups'} · {stake}g</button>}
        <div className="text-right text-sm"><div className="text-xs text-muted">Your purse</div><b className="num text-brass-bright">{gold}g</b></div>
      </div>
      <p className="mt-4 text-xs text-muted">
        {game === 'dice'
          ? `Two dice each. Beat the innkeeper's total and win ${GAMES.dice.payout}× your stake; a tie returns it.`
          : `Pick the cup hiding the coin and win ${GAMES.cups.payout}× your stake.`}
        {' '}Bets {GAMES.minBet}–{GAMES.maxBet}g, in-game gold only. Stakes go into the richest city&apos;s treasury and winnings come out of it, so no gold is created. The house keeps a small edge.
      </p>
    </Drawer>
  );
}
