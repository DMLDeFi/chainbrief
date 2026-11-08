'use client';
import { useEffect } from 'react';
import Link from 'next/link';
import { gameAudio } from '@/lib/audio';
import { useSearchParams } from 'next/navigation';
import { useGame } from '@/lib/store';
import { Coin, IconHouse, IconPeople, IconScale, IconWallet } from '@/components/icons';

const CARDS = [
  { icon: <IconScale />, title: 'Buy low, sell high', body: 'Prices move with supply and demand. Watch the harvest calendar, shortages and events — and remember your own orders move the price.' },
  { icon: <IconPeople />, title: 'Read the merchants', body: 'Every merchant is an AI agent with goals and a decision log. Negotiate private deals, invest in the promising ones, avoid the reckless.' },
  { icon: <IconHouse />, title: 'Build businesses', body: 'Farms, bakeries, forges, looms, warehouses and caravans produce every hour. Hire, upgrade and set their selling floors.' },
  { icon: <IconWallet />, title: 'Own it on NEAR', body: 'Claim deeds for your businesses and record achievements on-chain. Sell deeds to other players for NEAR.' },
];

export function Intro() {
  useEffect(() => gameAudio.init(), []);
  const next = useSearchParams().get('next') ?? '/play';
  const { me } = useGame();
  return (
    <main className="relative min-h-screen overflow-hidden px-6 py-16">
      <div className="absolute inset-0 bg-[radial-gradient(70%_60%_at_50%_0%,rgba(217,168,74,0.12),transparent)]" />
      <div className="relative mx-auto max-w-4xl animate-rise">
        <span className="label text-brass">Chapter I</span>
        <h1 className="display mt-3 text-4xl font-bold sm:text-5xl">The road to Nearhaven</h1>
        <div className="mt-6 max-w-2xl space-y-4 text-lg leading-relaxed text-parchment-dim">
          <p>The valley town of Nearhaven sits where the river meets the eastern road to Port Aurora. Farmers bring grain at dawn, the forge rings by noon, and by dusk the Exchange hall is loud with merchants who never stop calculating.</p>
          <p>You arrive{me ? <> as <b className="text-parchment">{me.player.name}</b></> : null} with a mule, an empty stall and <span className="inline-flex items-center gap-1 font-bold text-brass-bright"><Coin size={16} />100 gold</span>. Six ranks separate a Street Trader from a Master Merchant. The townsfolk will not wait for you — the economy keeps moving whether you trade or not.</p>
        </div>
        <div className="mt-10 grid gap-3 sm:grid-cols-2">
          {CARDS.map((c, i) => (
            <div key={c.title} className="panel flex gap-4 p-5" style={{ animationDelay: `${i * 80}ms` }}>
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-brass-deep/60 bg-brass/10 text-brass">{c.icon}</div>
              <div><h3 className="display font-bold">{c.title}</h3><p className="mt-1 text-sm text-parchment-dim">{c.body}</p></div>
            </div>
          ))}
        </div>
        <div className="mt-10 flex flex-wrap gap-3">
          <Link href={next} className="btn btn-gold px-6 py-3">Enter Nearhaven</Link>
          <Link href="/play?demo=1" className="btn btn-ghost px-6 py-3">Enter with the guided tour</Link>
        </div>
      </div>
    </main>
  );
}
