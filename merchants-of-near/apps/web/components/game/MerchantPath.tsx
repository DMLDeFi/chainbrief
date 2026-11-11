'use client';
import { useEffect, useState } from 'react';
import type { Me } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { gameAudio } from '@/lib/audio';
import type { PanelId } from './GameShell';

type Path = Me['player']['path'];

/**
 * The Merchant's Path: a newcomer's first steps, always on screen until done.
 * It shows the next step with a button that opens the right screen, ticks steps
 * off as they happen, and pays each small reward when claimed.
 */
export function MerchantPath({ me, onOpen }: { me: Me; onOpen: (p: PanelId) => void }) {
  const path: Path = me.player.path;
  const { run, busy } = useAction();
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState(false);
  const doneCount = path.steps.filter((s) => s.done).length;
  const ready = path.steps.filter((s) => s.done && !s.claimed);
  const next = path.steps.find((s) => s.id === path.next);

  useEffect(() => {
    try { setHidden(localStorage.getItem(`mon.path.hidden.${me.user.id}`) === '1'); } catch { /* storage unavailable */ }
  }, [me.user.id]);
  // A step just finished: a little chime.
  const [seen, setSeen] = useState(doneCount);
  useEffect(() => {
    if (doneCount > seen) gameAudio.bell();
    setSeen(doneCount);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doneCount]);

  if (path.complete || hidden) return null;
  const hide = () => { setHidden(true); try { localStorage.setItem(`mon.path.hidden.${me.user.id}`, '1'); } catch { /* storage unavailable */ } };
  const claim = (id: string) => run<{ gold: number; xp: number; title: string; complete: boolean }>({ type: 'milestone.claim', milestone: id }, (d) => (d.complete ? `The Merchant's Path is complete! +${d.gold}g` : `${d.title}: +${d.gold}g, +${d.xp} XP`)).then((d) => d?.complete && gameAudio.fanfare());
  const pct = (doneCount / path.steps.length) * 100;

  return (
    <section className="panel-glass pointer-events-auto w-[300px] overflow-hidden rounded-xl text-sm max-md:w-[calc(100vw-16px)]" aria-label="The Merchant's Path">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-3 px-3 pb-2 pt-2.5 text-left" aria-expanded={open}>
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-brass/60 bg-brass/15 text-base">🧭</span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between"><b className="display text-[13px] text-brass-bright">The Merchant&apos;s Path</b><span className="num text-[11px] text-muted">{doneCount}/{path.steps.length}</span></span>
          <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-black/40"><span className="block h-full rounded-full bg-brass transition-all duration-700" style={{ width: `${pct}%` }} /></span>
        </span>
        {ready.length > 0 && <span className="grid h-5 min-w-5 place-items-center rounded-full bg-moss px-1.5 text-[11px] font-bold text-ink animate-pulse-soft">{ready.length}</span>}
      </button>
      {!open && next && (
        <div className="flex items-center gap-2 border-t border-line/40 px-3 py-2">
          <div className="min-w-0 flex-1"><div className="font-semibold">{next.title}</div><div className="text-xs text-parchment-dim">{next.hint}</div></div>
          <button type="button" className="btn btn-gold shrink-0 px-3 py-1 text-xs" onClick={() => onOpen(next.panel as PanelId)}>Go</button>
        </div>
      )}
      {!open && !next && ready.length > 0 && (
        <div className="border-t border-line/40 px-3 py-2 text-xs text-parchment-dim">Every step done. Claim your rewards!</div>
      )}
      {open && (
        <ol className="max-h-[50vh] space-y-1 overflow-y-auto border-t border-line/40 p-2">
          {path.steps.map((s, i) => (
            <li key={s.id} className={`flex items-center gap-2 rounded-lg px-2 py-1.5 ${s.id === path.next ? 'bg-brass/10 ring-1 ring-brass/50' : ''}`}>
              <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border text-xs font-bold ${s.claimed ? 'border-moss bg-moss/80 text-ink' : s.done ? 'border-moss text-moss' : 'border-line text-muted'}`}>{s.done ? '✓' : i + 1}</span>
              <div className="min-w-0 flex-1">
                <div className={`font-semibold ${s.claimed ? 'text-muted line-through decoration-1' : ''}`}>{s.title}</div>
                {!s.claimed && <div className="text-[11px] text-parchment-dim">{s.hint}</div>}
              </div>
              {s.done && !s.claimed ? (
                <button type="button" disabled={busy} onClick={() => claim(s.id)} className="btn btn-gold shrink-0 px-2 py-0.5 text-[11px]">+{s.gold}g</button>
              ) : !s.done ? (
                <button type="button" onClick={() => onOpen(s.panel as PanelId)} className="shrink-0 text-[11px] text-brass hover:text-brass-bright">Go →</button>
              ) : null}
            </li>
          ))}
          <li className="flex justify-between px-2 pt-1 text-[11px] text-muted">
            <span>Rewards come from the guild treasury.</span>
            <button type="button" onClick={hide} className="hover:text-parchment">Hide for good</button>
          </li>
        </ol>
      )}
    </section>
  );
}
