'use client';
import { useMemo, useState } from 'react';
import type { FeedEntry, PublicSnapshot } from '@mon/engine';
import { ResourceIcon } from '../icons';

const KIND_COLOR: Record<string, string> = {
  trade: '#d9a84a', price: '#e2a35a', event: '#d2643a', loan: '#9fb8d8', bankruptcy: '#d2643a', expansion: '#8fb35f', opportunity: '#00ec97', travel: '#6aa3c8', player: '#f4c96b', weather: '#9fb8d8', population: '#b98ab0', supply: '#d9a84a', demand: '#d9a84a', production: '#8fb35f',
};
const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'trade', label: 'Trades' },
  { id: 'price', label: 'Prices' },
  { id: 'ai', label: 'AI decisions' },
  { id: 'event', label: 'Events' },
] as const;

/** Live economic activity — every line is generated from a real state change on the server. */
export function Feed({ feed, world, compact, onMerchant }: { feed: FeedEntry[]; world: PublicSnapshot; compact: boolean; onMerchant: (id: string) => void }) {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['id']>('all');
  const [collapsed, setCollapsed] = useState(false);
  const merchants = useMemo(() => new Set(world.merchants.map((m) => m.id)), [world.merchants]);
  const items = useMemo(() => {
    const f = feed.filter((e) => {
      if (filter === 'all') return true;
      if (filter === 'ai') return ['opportunity', 'loan', 'expansion', 'bankruptcy', 'travel'].includes(e.kind);
      if (filter === 'event') return ['event', 'weather', 'population'].includes(e.kind);
      return e.kind === filter;
    });
    return f.slice(-80).reverse();
  }, [feed, filter]);

  return (
    <aside className={`panel-glass pointer-events-auto absolute right-3 top-20 z-20 flex w-[320px] flex-col overflow-hidden max-md:hidden ${collapsed ? '' : 'bottom-20'}`} aria-label="Economic activity feed">
      <div className="flex items-center justify-between border-b border-line/70 px-4 py-3">
        <div>
          <div className="display text-sm font-bold">Market Chronicle</div>
          <div className="text-[11px] text-muted">Live from {world.markets.nearhaven.name} · vol {world.markets.nearhaven.volumeToday.toFixed(0)}g today</div>
        </div>
        <button onClick={() => setCollapsed((c) => !c)} className="text-xs text-muted hover:text-parchment">{collapsed ? 'Show' : 'Hide'}</button>
      </div>
      {!collapsed && (
        <>
          <div className="flex gap-1 overflow-x-auto border-b border-line/50 px-3 py-2">
            {FILTERS.map((f) => (
              <button key={f.id} onClick={() => setFilter(f.id)} className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ${filter === f.id ? 'bg-brass text-ink' : 'text-parchment-dim hover:bg-white/5'}`}>{f.label}</button>
            ))}
          </div>
          <ol className="scroll-thin min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 py-2">
            {items.map((e) => (
              <li key={e.id} className="animate-fade">
                <button
                  disabled={!e.actor || !merchants.has(e.actor)}
                  onClick={() => e.actor && onMerchant(e.actor)}
                  className="flex w-full gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-white/[0.04] disabled:cursor-default disabled:hover:bg-transparent"
                >
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: KIND_COLOR[e.kind] ?? '#9a8a70' }} />
                  <span className={`min-w-0 flex-1 ${compact ? 'text-[11px]' : 'text-[12.5px]'} leading-snug ${e.severity === 'bad' ? 'text-[#f0b8a0]' : e.severity === 'good' ? 'text-[#cfe6b0]' : 'text-parchment-dim'}`}>
                    {e.text}
                    <span className="num ml-1.5 text-[10px] text-muted">D{Math.floor(e.tick / 24) + 1} {String(e.tick % 24).padStart(2, '0')}h</span>
                  </span>
                  {e.resource && <ResourceIcon r={e.resource} size={16} className="mt-0.5 shrink-0 opacity-80" />}
                </button>
              </li>
            ))}
          </ol>
        </>
      )}
    </aside>
  );
}
