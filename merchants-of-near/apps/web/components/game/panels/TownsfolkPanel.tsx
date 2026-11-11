'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { CITY_DEFS, type MarketId, type PublicSnapshot } from '@mon/engine';
import type { Me } from '@/lib/api';
import { TOPICS, citizenMood, citizenProfile, citizenSays, type Topic } from '@/lib/townsfolk';
import { Drawer } from '../../ui';
import { IconPeople } from '../../icons';

type Line = { who: 'them' | 'you'; text: string };

/** A chat with a townsperson: who they are, how they feel, and what they know. */
export function TownsfolkPanel({ world, me, index, city, portrait, onClose }: { world: PublicSnapshot; me: Me; index: number; city: MarketId; portrait: string | null; onClose: () => void }) {
  const c = useMemo(() => citizenProfile(index, city), [index, city]);
  const mood = citizenMood(c, world);
  const first = me.player.name.split(' ')[0];
  const [log, setLog] = useState<Line[]>([]);
  const asked = useRef<Record<string, number>>({});
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    asked.current = {};
    setLog([{ who: 'them', text: citizenSays(c, world, 'hello', 0, first) }]);
    // A new person: start the conversation over (the world may change while you talk).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c]);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end', behavior: 'smooth' }); }, [log]);

  const ask = (t: Exclude<Topic, 'hello'>, q: string) => {
    const n = asked.current[t] ?? 0;
    asked.current[t] = n + 1;
    setLog((l) => [...l, { who: 'you', text: q }, { who: 'them', text: citizenSays(c, world, t, n, first) }]);
  };

  const bar = Math.round(((mood.score + 1) / 2) * 100);
  return (
    <Drawer title={c.name} subtitle={`${cap(c.trade)} of ${CITY_DEFS[city].name} · ${c.age} years old`} icon={<IconPeople />} onClose={onClose}>
      <div className="mb-4 flex items-center gap-4 rounded-xl border border-line/60 bg-black/25 p-3">
        <div className="grid h-20 w-16 shrink-0 place-items-center overflow-hidden rounded-lg border border-[#5a3d1c]" style={{ background: 'radial-gradient(circle at 50% 35%, #3b5a38, #1a2a1a)' }}>
          {portrait ? <img src={portrait} alt="" className="h-[80px] w-[56px] object-contain" style={{ imageRendering: 'pixelated' }} /> : <span className="text-3xl">🧑</span>}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-sm"><span className="text-xl">{mood.emoji}</span><b>{mood.label}</b><span className="text-xs capitalize text-muted">· {c.temper}</span></div>
          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-black/40"><div className="h-full rounded-full transition-all" style={{ width: `${bar}%`, background: mood.score > 0.3 ? '#5fbf5a' : mood.score > 0 ? '#e0ad4f' : '#c2552f' }} /></div>
          <div className="mt-1 text-xs italic text-parchment-dim">“{mood.why}”</div>
        </div>
      </div>
      <div className="mb-3 max-h-[40vh] space-y-2 overflow-y-auto pr-1" aria-live="polite">
        {log.map((l, i) => (
          <div key={i} className={`flex ${l.who === 'you' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${l.who === 'you' ? 'rounded-br-sm bg-brass/25 text-parchment' : 'rounded-bl-sm border border-line/60 bg-black/30 text-parchment'}`}>{l.text}</div>
          </div>
        ))}
        <div ref={end} />
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        {TOPICS.map((t) => (
          <button key={t.id} type="button" onClick={() => ask(t.id, t.label)} className="rounded-lg border border-line/60 bg-black/20 px-3 py-2 text-left text-sm transition hover:border-brass/60 hover:bg-brass/10">{t.label}</button>
        ))}
      </div>
      <button type="button" onClick={onClose} className="btn btn-ghost mt-3 w-full py-2 text-sm">Farewell</button>
      <p className="mt-3 text-xs text-muted">Townsfolk know what everyone in town knows: prices on the exchanges, posted jobs, the races, the guild standings and the news. Their tips are worth checking, not guaranteed.</p>
    </Drawer>
  );
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
