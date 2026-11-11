'use client';
import { GUILDS, SEASON, type PublicSnapshot } from '@mon/engine';
import type { Me } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { Badge, Drawer } from '../../ui';
import { IconCrown } from '../../icons';

type GuildRow = PublicSnapshot['guilds']['guilds'][number];

/** A guild's banner: a pennant in its colour with its initial. */
export function GuildBanner({ color, letter, size = 44 }: { color: string; letter: string; size?: number }) {
  return (
    <svg width={size} height={size * 1.25} viewBox="0 0 40 50" aria-hidden>
      <rect x="4" y="2" width="32" height="3" rx="1.5" fill="#8a5f1c" />
      <path d="M7 5h26v34l-13-8-13 8Z" fill={color} stroke="#1a1208" strokeWidth="1.5" />
      <path d="M7 5h26v6H7z" fill="#000" opacity=".18" />
      <text x="20" y="27" textAnchor="middle" fontFamily="Cinzel, serif" fontWeight="700" fontSize="15" fill="#1a1208">{letter}</text>
    </svg>
  );
}

/** Guilds and the season race: pick a side, then every profit, delivery and gift scores for it. */
export function GuildsPanel({ world, me, onClose }: { world: PublicSnapshot; me: Me; onClose: () => void }) {
  const g = world.guilds;
  const mine = me.player.guild;
  const { run, busy } = useAction();
  const lead = Math.max(1, ...g.guilds.map((x) => x.points));
  const ranked = g.guilds.slice().sort((a, b) => b.points - a.points);
  const myGuild = g.guilds.find((x) => x.id === mine.guild);
  const row = (x: GuildRow, i: number) => (
    <li key={x.id} className={`rounded-xl border p-3 ${x.id === mine.guild ? 'border-brass bg-brass/10' : 'border-line/60 bg-black/20'}`}>
      <div className="flex items-center gap-3">
        <span className="num w-5 text-center text-sm text-muted">{i + 1}</span>
        <GuildBanner color={x.color} letter={x.name.replace(/^(Guild of the |The )/, '')[0]} size={30} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2"><b>{x.name}</b><span className="text-xs text-muted">{x.trade}</span>{x.id === mine.guild && <Badge tone="moss">your guild</Badge>}</div>
          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-black/40"><div className="h-full rounded-full" style={{ width: `${(x.points / lead) * 100}%`, background: x.color }} /></div>
          <div className="mt-1 flex justify-between text-[11px] text-muted"><span>{x.members} member{x.members === 1 ? '' : 's'}{x.top.length ? ` · top: ${x.top.map((t) => t.name).join(', ')}` : ''}</span><span className="num">{x.points.toLocaleString('en-US')} pts</span></div>
        </div>
      </div>
    </li>
  );
  return (
    <Drawer wide title="Guilds" subtitle={`Season ${g.season} · ends in ${g.endsInDays} game days · the winning guild's members are crowned champions`} icon={<IconCrown />} onClose={onClose}>
      {mine.guild ? (
        <div className="mb-4 flex items-center gap-4 rounded-xl border border-brass/60 bg-brass/10 p-4">
          <GuildBanner color={myGuild!.color} letter={myGuild!.name.replace(/^(Guild of the |The )/, '')[0]} />
          <div className="flex-1">
            <div className="display text-lg font-bold">{myGuild!.name}</div>
            <div className="text-xs italic text-muted">“{myGuild!.motto}”</div>
            <div className="mt-1 text-sm">You have earned <b className="num text-brass-bright">{mine.seasonPoints.toLocaleString('en-US')}</b> points for your guild this season.</div>
          </div>
        </div>
      ) : (
        <p className="mb-3 text-sm text-parchment-dim">Choose a guild. From then on, trading profit (1 point per gold), delivered contracts (their reward), new businesses (50) and gifts to public works (half the gift) score for it. When the season ends after {SEASON.days} game days, the leading guild's members earn a champion title, XP and reputation, and the season's top merchant is crowned.</p>
      )}
      <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-muted">Season {g.season} standings</h3>
      <ol className="space-y-2">{ranked.map(row)}</ol>
      <h3 className="mb-2 mt-5 text-xs font-bold uppercase tracking-wider text-muted">{mine.guild ? (mine.canSwitch ? 'Change guild (once per season; your points stay behind)' : 'The guilds') : 'Join a guild'}</h3>
      <div className="grid gap-2 sm:grid-cols-2">
        {g.guilds.map((x) => (
          <div key={x.id} className="flex flex-col gap-2 rounded-xl border border-line/60 bg-black/20 p-3">
            <div className="flex items-center gap-3"><GuildBanner color={x.color} letter={x.name.replace(/^(Guild of the |The )/, '')[0]} size={32} /><div><b>{x.name}</b><div className="text-xs italic text-muted">“{x.motto}”</div></div></div>
            {x.id !== mine.guild && (!mine.guild || mine.canSwitch) && (
              <button className="btn btn-gold py-2 text-sm" disabled={busy} onClick={() => run({ type: 'guild.join', guild: x.id }, `You joined the ${GUILDS[x.id as keyof typeof GUILDS].name}`)}>Join</button>
            )}
          </div>
        ))}
      </div>
      {g.history.length > 0 && (
        <>
          <h3 className="mb-2 mt-5 text-xs font-bold uppercase tracking-wider text-muted">Past seasons</h3>
          <ul className="space-y-1 text-sm">{g.history.map((h) => (
            <li key={h.number} className="flex justify-between rounded-lg bg-black/20 px-3 py-1.5"><span>Season {h.number}: <b>{GUILDS[h.winner].name}</b></span><span className="text-muted">{h.topPlayer ? `Grand Merchant: ${h.topPlayer.name}` : ''}</span></li>
          ))}</ul>
        </>
      )}
      {mine.titles.length > 0 && <div className="mt-4 flex flex-wrap gap-1.5">{mine.titles.map((t) => <Badge key={t} tone="brass">🏆 {t}</Badge>)}</div>}
    </Drawer>
  );
}
