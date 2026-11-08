'use client';
import { useState } from 'react';
import type { Me } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { gold } from '@/lib/format';
import { Badge, Drawer, Empty, Tabs } from '../../ui';
import { IconCrown } from '../../icons';

interface Board {
  wealth: Row[]; trading: Row[]; achievements: Row[];
  businesses: Array<{ id: string; name: string; kind: string; owner: string; level: number; profit: number; revenue: number; deed: string | null }>;
  aiMerchants: Array<{ id: string; name: string; role: string; status: string; netWorth: number }>;
}
interface Row { id: string; name: string; level: number; title: string; netWorth: number; achievements: number; reputation: number; nearAccountId: string | null; volume: number }
type T = 'wealth' | 'trading' | 'achievements' | 'businesses' | 'ai';

export function LeaderboardPanel({ me, onClose }: { me: Me; onClose: () => void }) {
  const [tab, setTab] = useState<T>('wealth');
  const { data } = useFetch<Board>('/leaderboard');
  const medal = (i: number) => (i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}`);
  const rows = data ? (tab === 'wealth' ? data.wealth : tab === 'trading' ? data.trading : data.achievements) : [];
  return (
    <Drawer wide title="Leaderboards" subtitle="Human players only — AI merchants are ranked separately" icon={<IconCrown />} onClose={onClose}>
      <Tabs value={tab} onChange={setTab} options={[{ value: 'wealth', label: 'Wealth' }, { value: 'trading', label: 'Trading volume' }, { value: 'achievements', label: 'Achievements' }, { value: 'businesses', label: 'Businesses' }, { value: 'ai', label: 'AI merchants' }]} />
      {!data ? <div className="skeleton h-60 rounded-xl" /> : tab === 'businesses' ? (
        data.businesses.length === 0 ? <Empty>No player businesses yet.</Empty> : (
          <ol className="space-y-1.5">{data.businesses.map((b, i) => (
            <li key={b.id} className="flex items-center gap-3 rounded-xl border border-line/60 bg-black/20 px-3 py-2">
              <span className="num w-7 text-center">{medal(i)}</span>
              <span className="flex-1"><b>{b.name}</b> <span className="text-xs text-muted">Lv {b.level}</span> {b.deed && <Badge tone="near">deed</Badge>}</span>
              <span className={`num font-bold ${b.profit >= 0 ? 'text-moss' : 'text-ember'}`}>{gold(b.profit)}g</span>
            </li>
          ))}</ol>
        )
      ) : tab === 'ai' ? (
        <ol className="space-y-1.5">{data.aiMerchants.map((m, i) => (
          <li key={m.id} className="flex items-center gap-3 rounded-xl border border-line/60 bg-black/20 px-3 py-2">
            <span className="num w-7 text-center">{i + 1}</span>
            <span className="flex-1">{m.name} <Badge tone="river">AI</Badge> {m.status !== 'active' && <Badge tone="ember">{m.status}</Badge>}</span>
            <span className="num font-bold">{gold(m.netWorth)}g</span>
          </li>
        ))}</ol>
      ) : rows.length === 0 ? <Empty>No players yet.</Empty> : (
        <ol className="space-y-1.5">{rows.map((r, i) => (
          <li key={r.id} className={`flex items-center gap-3 rounded-xl border px-3 py-2 ${r.id === me.user.id ? 'border-brass bg-brass/10' : 'border-line/60 bg-black/20'}`}>
            <span className="num w-7 text-center">{medal(i)}</span>
            <span className="min-w-0 flex-1">
              <span className="font-semibold">{r.name}</span>{r.id === me.user.id && <span className="text-xs text-brass"> (you)</span>}
              <span className="block text-[11px] text-muted">Lv {r.level} {r.title} · rep {r.reputation}{r.nearAccountId ? ` · ${r.nearAccountId}` : ''}</span>
            </span>
            <span className="num font-bold">{tab === 'wealth' ? `${gold(r.netWorth)}g` : tab === 'trading' ? `${gold(r.volume)}g` : `${r.achievements} 🏅`}</span>
          </li>
        ))}</ol>
      )}
    </Drawer>
  );
}
