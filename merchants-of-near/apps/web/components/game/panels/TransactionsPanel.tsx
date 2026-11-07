'use client';
import { useState } from 'react';
import type { LedgerEntry } from '@mon/engine';
import type { Me } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { gold } from '@/lib/format';
import { Badge, Drawer, Empty, Tabs } from '../../ui';
import { IconExternal, IconScroll } from '../../icons';

interface ChainTx { hash: string; kind: string; status: string; reference: string | null; error: string | null; createdAt: string; verifiedAt: string | null; explorer: string }

const LABEL: Record<string, string> = {
  'player.register': 'Arrived in Nearhaven', 'trade.buy': 'Bought on exchange', 'trade.sell': 'Sold on exchange', 'business.buy': 'Opened business', 'business.hire': 'Hired worker',
  'business.upgrade': 'Upgraded business', 'business.wages': 'Wages & upkeep', 'business.rent': 'Warehouse rent', 'business.collect': 'Collected goods', 'warehouse.expand': 'Expanded warehouse',
  'mission.reward': 'Mission reward', 'loan.received': 'Loan received', 'loan.repayment': 'Loan repayment', 'investment.buy': 'Bought shares', 'investment.sell': 'Sold shares',
  'investment.dividend': 'Dividend', 'listing.create': 'Listed goods', 'listing.cancel': 'Cancelled listing', 'listing.buy': 'Bought from player', 'listing.sold': 'Sold to player',
  'deal.buy': 'Private deal (bought)', 'deal.sell': 'Private deal (sold)', 'deed.acquired': 'Deed acquired on NEAR', 'business.sell': 'Business sold output', 'business.buy_inputs': 'Business bought inputs',
};

export function TransactionsPanel({ me, onClose }: { me: Me; onClose: () => void }) {
  const [tab, setTab] = useState<'game' | 'chain'>('game');
  const { data: ledger } = useFetch<Array<LedgerEntry & { id: string }>>('/ledger');
  const { data: txs } = useFetch<ChainTx[]>('/near/txs');
  return (
    <Drawer wide title="Transaction History" subtitle="Server ledger of every gold movement, plus your NEAR transactions" icon={<IconScroll />} onClose={onClose}>
      <Tabs value={tab} onChange={setTab} options={[{ value: 'game', label: 'Game ledger' }, { value: 'chain', label: `On-chain (${txs?.length ?? 0})` }]} />
      {tab === 'game' ? (
        !ledger?.length ? <Empty>No transactions yet.</Empty> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead><tr className="text-left text-[10px] uppercase tracking-wider text-muted"><th className="py-2">When</th><th>Entry</th><th>Details</th><th className="text-right">Gold</th></tr></thead>
              <tbody>
                {ledger.map((e) => (
                  <tr key={e.id} className="border-t border-line/40">
                    <td className="num py-1.5 text-xs text-muted">D{Math.floor(e.tick / 24) + 1} {String(e.tick % 24).padStart(2, '0')}h</td>
                    <td>{LABEL[e.type] ?? e.type}</td>
                    <td className="text-xs text-muted">{e.items ? Object.entries(e.items).map(([r, q]) => `${q! > 0 ? '+' : ''}${q} ${r}`).join(', ') : ''}{typeof e.details?.avgPrice === 'number' ? ` @ ${gold(e.details.avgPrice as number)}` : ''}</td>
                    <td className={`num text-right font-bold ${e.goldDelta > 0 ? 'text-moss' : e.goldDelta < 0 ? 'text-ember' : 'text-muted'}`}>{e.goldDelta > 0 ? '+' : ''}{gold(e.goldDelta)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : !txs?.length ? (
        <Empty>No NEAR transactions yet. Claim a business deed or record an achievement from the Businesses or Progress panels.</Empty>
      ) : (
        <div className="space-y-2">
          {txs.map((t) => (
            <div key={t.hash} className="rounded-xl border border-line/60 bg-black/20 px-3 py-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold capitalize">{t.kind.replace('_', ' ')}</span>
                <Badge tone={t.status === 'success' ? 'moss' : t.status === 'failure' ? 'ember' : 'brass'}>{t.status}</Badge>
              </div>
              <a href={t.explorer} target="_blank" rel="noreferrer" className="num mt-1 flex items-center gap-1 break-all text-xs text-near hover:underline">{t.hash} <IconExternal size={12} /></a>
              <div className="mt-1 text-[11px] text-muted">submitted {new Date(t.createdAt).toLocaleString()}{t.verifiedAt ? ` · verified on-chain ${new Date(t.verifiedAt).toLocaleTimeString()}` : ''}{t.error ? ` · ${t.error}` : ''}</div>
            </div>
          ))}
        </div>
      )}
    </Drawer>
  );
}
