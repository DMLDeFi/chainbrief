'use client';
import { useEffect, useState } from 'react';
import { onFly, type FlyEvent } from '@/lib/fx';
import { Coin, ResourceIcon } from '../icons';

interface Token { id: number; kind: FlyEvent['kind']; resource?: string; from: { x: number; y: number }; to: { x: number; y: number }; delay: number }

let seq = 0;

/** Renders flying item and coin tokens between UI elements along a curved path. */
export function FlyLayer({ reducedMotion }: { reducedMotion: boolean }) {
  const [tokens, setTokens] = useState<Token[]>([]);
  useEffect(() => onFly((e) => {
    if (reducedMotion) return;
    const target = document.querySelector(e.kind === 'goods' ? '[data-fly-target="inventory"]' : '[data-fly-target="gold"]');
    if (!target) return;
    const r = target.getBoundingClientRect();
    const to = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    const n = Math.max(1, Math.min(6, e.count));
    const fresh = Array.from({ length: n }, (_, i) => ({ id: ++seq, kind: e.kind, resource: e.resource, from: { x: e.from.x + (Math.random() - 0.5) * 30, y: e.from.y + (Math.random() - 0.5) * 12 }, to, delay: i * 70 }));
    setTokens((t) => [...t, ...fresh]);
    window.setTimeout(() => {
      target.classList.remove('gold-pulse');
      void (target as HTMLElement).offsetWidth;
      target.classList.add('gold-pulse');
    }, 760 + n * 70);
  }), [reducedMotion]);

  return (
    <>
      {tokens.map((t) => (
        <FlyToken key={t.id} t={t} onDone={() => setTokens((all) => all.filter((x) => x.id !== t.id))} />
      ))}
    </>
  );
}

function FlyToken({ t, onDone }: { t: Token; onDone: () => void }) {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!el) return;
    const dx = t.to.x - t.from.x, dy = t.to.y - t.from.y;
    const lift = -Math.min(160, 60 + Math.abs(dx) * 0.25);
    const frames: Keyframe[] = [];
    for (let i = 0; i <= 12; i++) {
      const s = i / 12;
      const e = s < 0.5 ? 2 * s * s : 1 - Math.pow(-2 * s + 2, 2) / 2;
      const x = dx * e, y = dy * e + lift * Math.sin(Math.PI * s);
      const scale = 1 + Math.sin(Math.PI * s) * 0.5 - s * 0.35;
      frames.push({ transform: `translate(${x}px, ${y}px) scale(${scale}) rotate(${s * 30}deg)`, opacity: i === 12 ? 0.2 : 1 });
    }
    const a = el.animate(frames, { duration: 780, delay: t.delay, easing: 'linear', fill: 'both' });
    a.onfinish = onDone;
    return () => a.cancel();
  }, [el, t, onDone]);
  return (
    <div ref={setEl} className="fly-token" style={{ left: t.from.x - 13, top: t.from.y - 13 }}>
      <div className="grid h-[26px] w-[26px] place-items-center rounded-full border border-brass bg-walnut shadow-[0_0_12px_rgba(244,201,107,0.55)]">
        {t.kind === 'goods' && t.resource ? <ResourceIcon r={t.resource} size={18} /> : <Coin size={18} />}
      </div>
    </div>
  );
}
