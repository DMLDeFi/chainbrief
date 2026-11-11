'use client';
import { useEffect, useRef, useState, type RefObject } from 'react';
import type { MinimapBase } from '@/game/TownScene';
import type { TownHandle } from '../TownCanvas';

const COLORS: Record<string, string> = { w: '#2f6f9a', r: '#b89a6a', p: '#d6c39a', f: '#b3a64c', d: '#7a6a50', g: '#4f7f3a', s: '#d8c48a' };
const W = 200, H = 116;

/** An isometric map of the whole town: you (gold), the merchants (white) and what the camera sees. Click to walk there. */
export function Minimap({ town, label }: { town: RefObject<TownHandle | null>; label: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const baseImg = useRef<HTMLCanvasElement | null>(null);
  const geo = useRef({ s: 1, ox: 0, oy: 0 });
  const [open, setOpen] = useState(true);
  // Phones get a smaller map (CSS size; the drawing is the same).
  const [small, setSmall] = useState(false);
  useEffect(() => { setSmall(window.innerWidth < 768); }, []);

  useEffect(() => {
    try { if (localStorage.getItem('mon.minimap') === '0') setOpen(false); } catch { /* storage unavailable */ }
  }, []);
  useEffect(() => { try { localStorage.setItem('mon.minimap', open ? '1' : '0'); } catch { /* storage unavailable */ } }, [open]);

  useEffect(() => {
    if (!open) return;
    let key = '';
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const drawBase = (b: MinimapBase) => {
      const nx = b.x1 - b.x0 + 1, ny = b.y1 - b.y0 + 1;
      // Projected width is (nx+ny)·s and height (nx+ny)·s/2: fit both.
      const s = Math.min(W / (nx + ny), (H * 2) / (nx + ny));
      const ox = W / 2 - ((b.x0 + nx / 2) - (b.y0 + ny / 2)) * s;
      const oy = H / 2 - ((b.x0 + nx / 2) + (b.y0 + ny / 2)) * (s / 2);
      geo.current = { s, ox, oy };
      const c = baseImg.current ?? document.createElement('canvas');
      baseImg.current = c;
      c.width = W * dpr; c.height = H * dpr;
      const g = c.getContext('2d')!;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, W, H);
      const P = (gx: number, gy: number): [number, number] => [ox + (gx - gy) * s, oy + (gx + gy) * (s / 2)];
      const quad = (gx: number, gy: number, w: number, d: number, color: string) => {
        g.fillStyle = color;
        g.beginPath();
        g.moveTo(...P(gx, gy)); g.lineTo(...P(gx + w, gy)); g.lineTo(...P(gx + w, gy + d)); g.lineTo(...P(gx, gy + d));
        g.closePath(); g.fill();
      };
      let i = 0;
      for (let gy = b.y0; gy <= b.y1; gy++) for (let gx = b.x0; gx <= b.x1; gx++) quad(gx, gy, 1.04, 1.04, COLORS[b.cells[i++]] ?? COLORS.g);
      for (const k of b.blocks) quad(k.gx, k.gy, k.w, k.d, k.color);
    };
    const frame = () => {
      const t = town.current;
      const cv = canvas.current;
      if (!t || !cv) return;
      const b = t.minimapBase();
      if (!b) return;
      const k = `${b.x0},${b.y0},${b.x1},${b.y1},${b.blocks.length}`;
      if (k !== key) { key = k; drawBase(b); }
      const live = t.minimapLive();
      cv.width = W * dpr; cv.height = H * dpr;
      const g = cv.getContext('2d')!;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (baseImg.current) g.drawImage(baseImg.current, 0, 0, W, H);
      if (!live) return;
      const { s, ox, oy } = geo.current;
      const P = (gx: number, gy: number): [number, number] => [ox + (gx - gy) * s, oy + (gx + gy) * (s / 2)];
      // What the camera sees.
      g.strokeStyle = 'rgba(255,240,200,.85)'; g.lineWidth = 1;
      g.beginPath();
      live.view.forEach((v, j) => (j ? g.lineTo(...P(v.gx, v.gy)) : g.moveTo(...P(v.gx, v.gy))));
      g.closePath(); g.stroke();
      g.fillStyle = '#f6efe0';
      for (const m of live.merchants) { const [x, y] = P(m.gx, m.gy); g.beginPath(); g.arc(x, y, 1.6, 0, Math.PI * 2); g.fill(); }
      if (live.avatar) {
        const [x, y] = P(live.avatar.gx, live.avatar.gy);
        const pulse = 3.2 + Math.sin(performance.now() / 220) * 0.8;
        g.fillStyle = 'rgba(240,196,90,.35)'; g.beginPath(); g.arc(x, y, pulse + 2.5, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#f0c45a'; g.strokeStyle = '#1a1208'; g.lineWidth = 1.2;
        g.beginPath(); g.arc(x, y, 3, 0, Math.PI * 2); g.fill(); g.stroke();
      }
    };
    const id = setInterval(frame, 150);
    frame();
    return () => clearInterval(id);
  }, [open, town]);

  const click = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W, py = ((e.clientY - r.top) / r.height) * H;
    const { s, ox, oy } = geo.current;
    const u = (px - ox) / s, v = (py - oy) / (s / 2);
    town.current?.goTo((u + v) / 2, (v - u) / 2);
  };

  if (!open) {
    return <button type="button" onClick={() => setOpen(true)} className="panel-glass pointer-events-auto rounded-lg px-3 py-1.5 text-xs font-semibold text-parchment-dim hover:text-brass-bright">Show map</button>;
  }
  return (
    <div className="panel-glass pointer-events-auto overflow-hidden rounded-xl p-1.5">
      <div className="flex items-center justify-between px-1 pb-1 text-[10px] uppercase tracking-wider text-muted">
        <span className="display font-bold text-parchment-dim">{label}</span>
        <button type="button" onClick={() => setOpen(false)} className="hover:text-brass-bright" aria-label="Hide map">hide</button>
      </div>
      <canvas ref={canvas} onClick={click} style={{ width: small ? 140 : W, height: small ? 81 : H }} className="block cursor-crosshair rounded-lg bg-[#132416]" aria-label="Town minimap: click to walk there" />
    </div>
  );
}
