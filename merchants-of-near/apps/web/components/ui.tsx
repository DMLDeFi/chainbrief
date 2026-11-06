'use client';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { IconClose } from './icons';

export function Sparkline({ data, width = 120, height = 32, color = '#d9a84a', fill = true }: { data: number[]; width?: number; height?: number; color?: string; fill?: boolean }) {
  const id = useId();
  if (data.length < 2) return <svg width={width} height={height} />;
  const min = Math.min(...data), max = Math.max(...data);
  const span = max - min || 1;
  const pts = data.map((v, i) => [(i / (data.length - 1)) * width, height - 2 - ((v - min) / span) * (height - 4)]);
  const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join('');
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="overflow-visible">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity="0.35" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {fill && <path d={`${d}L${width},${height}L0,${height}Z`} fill={`url(#${id})`} />}
      <path d={d} stroke={color} strokeWidth="1.6" fill="none" strokeLinejoin="round" />
      <circle cx={pts.at(-1)![0]} cy={pts.at(-1)![1]} r="2.4" fill={color} />
    </svg>
  );
}

/** Larger chart with axis labels for the economy dashboard. */
export function LineChart({ series, height = 180, labels }: { series: Array<{ name: string; color: string; data: number[] }>; height?: number; labels?: string[] }) {
  const width = 560;
  const all = series.flatMap((s) => s.data);
  if (all.length < 2) return <div className="skeleton h-40 rounded-lg" />;
  const min = Math.min(...all) * 0.95, max = Math.max(...all) * 1.05;
  const n = Math.max(...series.map((s) => s.data.length));
  const x = (i: number) => 36 + (i / Math.max(1, n - 1)) * (width - 46);
  const y = (v: number) => 10 + (1 - (v - min) / (max - min || 1)) * (height - 34);
  const ticks = [0, 0.5, 1].map((t) => min + (max - min) * t);
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label={series.map((s) => s.name).join(', ')}>
      {ticks.map((t) => (
        <g key={t}>
          <line x1="36" x2={width - 10} y1={y(t)} y2={y(t)} stroke="#4a3a2a" strokeDasharray="3 4" />
          <text x="30" y={y(t) + 4} textAnchor="end" fontSize="10" fill="#9a8a70">{t.toFixed(t < 10 ? 1 : 0)}</text>
        </g>
      ))}
      {labels && labels.map((l, i) => (i % Math.ceil(labels.length / 6) === 0 ? <text key={i} x={x(i)} y={height - 6} fontSize="10" fill="#9a8a70" textAnchor="middle">{l}</text> : null))}
      {series.map((s) => (
        <path key={s.name} d={s.data.map((v, i) => `${i ? 'L' : 'M'}${x(i)},${y(v)}`).join('')} stroke={s.color} strokeWidth="2" fill="none" strokeLinejoin="round" />
      ))}
    </svg>
  );
}

export function Delta({ value, className = '' }: { value: number; className?: string }) {
  const up = value > 0.0005, down = value < -0.0005;
  return (
    <span className={`num text-xs font-bold ${up ? 'text-moss' : down ? 'text-ember' : 'text-muted'} ${className}`}>
      {up ? '▲' : down ? '▼' : '•'} {Math.abs(value * 100).toFixed(1)}%
    </span>
  );
}

export function Meter({ value, max = 1, color = 'var(--color-brass)', label }: { value: number; max?: number; color?: string; label?: string }) {
  const pct = Math.max(0, Math.min(1, value / max));
  return (
    <div className="w-full" aria-label={label}>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-black/40">
        <div className="h-full rounded-full transition-[width] duration-700" style={{ width: `${pct * 100}%`, background: color }} />
      </div>
    </div>
  );
}

export function Stat({ label, value, sub, accent }: { label: string; value: ReactNode; sub?: ReactNode; accent?: string }) {
  return (
    <div className="rounded-xl border border-line/70 bg-black/20 px-3 py-2.5">
      <div className="label">{label}</div>
      <div className="num mt-1 text-lg font-bold" style={accent ? { color: accent } : undefined}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted">{sub}</div>}
    </div>
  );
}

export function Drawer({ title, subtitle, icon, onClose, children, wide }: { title: string; subtitle?: string; icon?: ReactNode; onClose: () => void; children: ReactNode; wide?: boolean }) {
  return (
    <div className={`panel-glass ornate relative pointer-events-auto flex max-h-full w-full flex-col overflow-hidden animate-rise ${wide ? 'max-w-[860px]' : 'max-w-[560px]'}`} role="dialog" aria-label={title}>
      <div className="relative flex items-center gap-3 border-b border-line/70 bg-[linear-gradient(180deg,rgba(244,201,107,0.07),transparent)] px-5 py-4">
        {icon && <div className="grid h-9 w-9 place-items-center rounded-lg border border-brass-deep/60 bg-brass/10 text-brass">{icon}</div>}
        <div className="min-w-0 flex-1">
          <h2 className="display truncate text-lg font-bold text-parchment">{title}</h2>
          {subtitle && <p className="truncate text-xs text-muted">{subtitle}</p>}
        </div>
        <button onClick={onClose} className="btn btn-ghost h-9 w-9 !p-0" aria-label="Close panel"><IconClose size={18} /></button>
      </div>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: Array<{ value: T; label: string }> }) {
  return (
    <div className="mb-4 inline-flex rounded-xl border border-line bg-black/30 p-1">
      {options.map((o) => (
        <button key={o.value} onClick={() => onChange(o.value)} className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${value === o.value ? 'bg-brass text-ink shadow' : 'text-parchment-dim hover:text-parchment'}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-dashed border-line px-4 py-8 text-center text-sm text-muted">{children}</div>;
}

export function Badge({ children, tone = 'brass' }: { children: ReactNode; tone?: 'brass' | 'moss' | 'ember' | 'river' | 'near' | 'muted' }) {
  const c = { brass: 'text-brass border-brass/40 bg-brass/10', moss: 'text-moss border-moss/40 bg-moss/10', ember: 'text-ember border-ember/40 bg-ember/10', river: 'text-river border-river/40 bg-river/10', near: 'text-near border-near/40 bg-near/10', muted: 'text-muted border-line bg-black/20' }[tone];
  return <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${c}`}>{children}</span>;
}

/** Number that counts smoothly to its new value (gold purse, net worth). */
export function CountUp({ value, format, duration = 700 }: { value: number; format: (n: number) => string; duration?: number }) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  const shownRef = useRef(value);
  useEffect(() => {
    const start = performance.now();
    from.current = shownRef.current;
    const reduce = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce || from.current === value) { shownRef.current = value; setShown(value); return; }
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - start) / duration);
      const e = 1 - Math.pow(1 - k, 3);
      shownRef.current = from.current + (value - from.current) * e;
      setShown(shownRef.current);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return <>{format(shown)}</>;
}
