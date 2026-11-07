'use client';
import { useState } from 'react';
import { api, type Me } from '@/lib/api';
import { ACHIEVEMENT_LIST, LEVELS } from '@/lib/catalog';
import { useAction } from '@/lib/hooks';
import { nearConfig, sendContractCall } from '@/lib/near';
import { toast } from '@/lib/store';
import { Badge, Drawer, Meter, Tabs } from '../../ui';
import { Coin, IconMedal } from '../../icons';

export function AchievementsPanel({ me, onClose }: { me: Me; onClose: () => void }) {
  const p = me.player;
  const [tab, setTab] = useState<'missions' | 'levels' | 'achievements'>('missions');
  const { run, busy } = useAction();
  const [minting, setMinting] = useState<string | null>(null);

  const mint = async (id: string) => {
    setMinting(id);
    try {
      const cfg = await nearConfig();
      if (!cfg.certificatesEnabled) throw new Error('On-chain badges are not configured on this server yet');
      if (!me.user.nearAccountId) throw new Error('Connect your NEAR wallet first');
      const cert = await api<{ receiverId: string; methodName: string; args: Record<string, unknown>; deposit: string; gas: string }>('/near/certificate/badge', { body: { achievementId: id } });
      const tx = await sendContractCall(cert, 'badge', id);
      toast(`Badge transaction ${tx.status}`, tx.status === 'success' ? 'good' : 'info');
    } catch (e) {
      toast((e as Error).message, 'bad');
    } finally {
      setMinting(null);
    }
  };

  const Mission = ({ m }: { m: (typeof p.daily)[number] }) => (
    <div className={`rounded-xl border p-3 ${m.completed && !m.claimed ? 'border-brass bg-brass/10' : 'border-line/60 bg-black/20'}`}>
      <div className="flex items-center justify-between">
        <span className="font-semibold">{m.def.title}</span>
        <span className="flex items-center gap-2 text-xs text-muted"><span className="flex items-center gap-0.5"><Coin size={12} />{m.def.rewardGold}</span> · {m.def.rewardXp} XP</span>
      </div>
      <p className="text-xs text-muted">{m.def.description}</p>
      <div className="mt-2 flex items-center gap-2">
        <Meter value={m.progress} max={m.def.target} />
        <span className="num shrink-0 text-[11px]">{Math.floor(m.progress)}/{m.def.target}</span>
        {m.claimed ? <Badge tone="moss">claimed</Badge> : <button disabled={!m.completed || busy} onClick={() => run({ type: 'mission.claim', missionId: m.def.id }, `Reward claimed: ${m.def.rewardGold}g + ${m.def.rewardXp} XP`)} className="btn btn-gold shrink-0 px-2.5 py-1 text-xs">Claim</button>}
      </div>
    </div>
  );

  return (
    <Drawer wide title="Progress" subtitle={`Level ${p.level} · ${p.levelTitle} · ${p.xp} XP · reputation ${p.reputation}`} icon={<IconMedal />} onClose={onClose}>
      <Tabs value={tab} onChange={setTab} options={[{ value: 'missions', label: 'Missions' }, { value: 'levels', label: 'Ranks' }, { value: 'achievements', label: `Achievements (${Object.keys(p.achievements).length}/${ACHIEVEMENT_LIST.length})` }]} />
      {tab === 'missions' && (
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2"><div className="label">Daily missions</div>{p.daily.map((m) => <Mission key={m.def.id} m={m} />)}</div>
          <div className="space-y-2"><div className="label">Weekly challenges</div>{p.weekly.map((m) => <Mission key={m.def.id} m={m} />)}<p className="text-[11px] text-muted">Rewards are paid from the guild treasury, which is funded by market fees — no gold is minted.</p></div>
        </div>
      )}
      {tab === 'levels' && (
        <ol className="space-y-2">
          {LEVELS.map((l) => {
            const reached = p.level >= l.level;
            const next = p.level + 1 === l.level;
            return (
              <li key={l.level} className={`rounded-xl border p-3 ${reached ? 'border-brass/60 bg-brass/10' : next ? 'border-line bg-black/30' : 'border-line/40 bg-black/10 opacity-70'}`}>
                <div className="flex items-center justify-between"><span className="display font-bold">{l.level}. {l.title}</span>{reached ? <Badge tone="moss">reached</Badge> : next ? <Badge>next</Badge> : null}</div>
                {l.level > 1 && (
                  <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
                    <Req label="XP" have={p.xp} need={l.xp} />
                    <Req label="Net worth" have={p.netWorth} need={l.netWorth} />
                    <Req label="Businesses" have={p.businesses.length} need={l.businesses} />
                    {l.cities ? <Req label="Cities" have={p.citiesWithBusiness} need={l.cities} /> : null}
                    <Req label="Reputation" have={p.reputation} need={l.reputation} />
                  </div>
                )}
                <div className="mt-2 text-[11px] text-muted">Unlocks: {l.unlocks.join(' · ')}</div>
              </li>
            );
          })}
        </ol>
      )}
      {tab === 'achievements' && (
        <div className="grid gap-2 sm:grid-cols-2">
          {ACHIEVEMENT_LIST.map((a) => {
            const got = p.achievements[a.id] !== undefined;
            return (
              <div key={a.id} className={`rounded-xl border p-3 ${got ? 'border-brass/60 bg-brass/10' : 'border-line/50 bg-black/15 opacity-75'}`}>
                <div className="flex items-center justify-between"><span className="font-semibold">{got ? '🏅' : '🔒'} {a.title}</span><span className="text-xs text-muted">{a.xp} XP</span></div>
                <p className="text-xs text-muted">{a.description}</p>
                {got && <button disabled={minting === a.id} onClick={() => mint(a.id)} className="btn btn-near mt-2 px-2.5 py-1 text-xs">{minting === a.id ? 'Waiting for wallet…' : 'Record on NEAR'}</button>}
              </div>
            );
          })}
        </div>
      )}
    </Drawer>
  );
}

function Req({ label, have, need }: { label: string; have: number; need: number }) {
  const ok = have >= need;
  return <div><div className="text-muted">{label}</div><div className={`num font-bold ${ok ? 'text-moss' : ''}`}>{Math.floor(have)} / {need}</div></div>;
}
