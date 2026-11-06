'use client';
import { useState } from 'react';
import type { PublicSnapshot } from '@mon/engine';
import { api, type Me } from '@/lib/api';
import { useAction, useFastForwardEnabled } from '@/lib/hooks';
import { toast } from '@/lib/store';
import { gold } from '@/lib/format';
import type { Selection } from '@/game/TownScene';
import type { PanelId } from './GameShell';

interface Step {
  title: string;
  body: (w: PublicSnapshot, me: Me) => React.ReactNode;
  cta?: string;
  run?: () => Promise<void> | void;
}

/** A guided, judge-friendly walkthrough. Every button performs a real action against the live server. */
export function DemoGuide({ world, me, onOpen, onFocus, onMerchant, onClose }: { world: PublicSnapshot; me: Me; onOpen: (p: PanelId | null) => void; onFocus: (s: Selection) => void; onMerchant: (id: string) => void; onClose: () => void }) {
  const [i, setI] = useState(0);
  const [before, setBefore] = useState<number | null>(null);
  const { run, busy } = useAction();
  const wheat = world.markets.nearhaven.resources.wheat.price;

  const ffEnabled = useFastForwardEnabled();
  const allSteps: Step[] = [
    {
      title: 'Welcome to Nearhaven',
      body: (w) => <>You are a street trader with <b>100 gold</b>. It is day {w.day}, {w.season}. {w.population} citizens eat, build and buy — and ten AI merchants run the economy around you. Nothing here is scripted.</>,
      cta: 'Show me the market square',
      run: () => onFocus({ type: 'exchange' }),
    },
    {
      title: 'Autonomous merchants',
      body: () => <>Each merchant has its own gold, inventory, personality, goals and memory. Open Farmer John: his <b>decision log</b> shows why he sold or held wheat — computed every hour by a deterministic agent, no LLM required.</>,
      cta: 'Inspect Farmer John',
      run: () => onMerchant('farmer'),
    },
    {
      title: 'Trade — and move the price',
      body: () => <>Wheat trades at <b>{gold(wheat)}g</b>. Buying walks up the exchange&apos;s supply curve, so your own order changes the price everyone sees.</>,
      cta: 'Buy 10 wheat',
      run: async () => {
        setBefore(wheat);
        onOpen('market');
        await run({ type: 'trade', side: 'buy', resource: 'wheat', qty: 10 }, (t: { avgPrice: number }) => `Bought 10 wheat at ${gold(t.avgPrice)}g`);
      },
    },
    {
      title: 'The engine re-prices',
      body: () => <>{before ? <>Wheat went from <b>{gold(before)}g</b> to <b>{gold(wheat)}g</b> because supply on the shelves fell. </> : null}Prices respond to stock, demand pressure, unmet citizen demand, seasons, weather and events. Sell your wheat back — the round trip costs you the fee, so prices can&apos;t be farmed.</>,
      cta: 'Sell the wheat',
      run: async () => {
        const held = Math.floor(me.player.inventory.wheat ?? 0);
        if (held > 0) await run({ type: 'trade', side: 'sell', resource: 'wheat', qty: held }, 'Sold the wheat back');
      },
    },
    {
      title: 'Merchants react to the market',
      body: () => <>The Market Chronicle on the right is generated from real state changes. Filter by <b>AI decisions</b> to see Trader Selene spotting price gaps with Port Aurora, the banker approving or refusing loans, merchants expanding or going bankrupt.</>,
      cta: 'Open the economic dashboard',
      run: () => onOpen('economy'),
    },
    {
      title: 'Fast-forward time',
      body: () => <>Simulate three days in a second. Watch harvests, shortages and events ripple through every price and every merchant&apos;s balance sheet.</>,
      cta: 'Simulate 3 days',
      run: async () => {
        try {
          const r = await api<{ feed: number }>('/sim/fast-forward', { body: { days: 3 } });
          toast(`72 hours simulated · ${r.feed} economic events`, 'good');
          onOpen('economy');
        } catch (e) {
          toast((e as Error).message, 'bad');
        }
      },
    },
    {
      title: 'Own a business',
      body: (_w, m) => <>A farm costs 85g and produces wheat every hour, paying wages each dawn. You have <b>{gold(m.player.gold)}g</b>. Businesses have workers, upgrades, inventory and a full profit & loss.</>,
      cta: 'Open businesses',
      run: () => onOpen('business'),
    },
    {
      title: 'Ownership on NEAR',
      body: () => <>Connect a NEAR testnet wallet, then <b>Claim deed</b> on your business: the game signs a certificate, your wallet signs the transaction, and the contract verifies both. Deeds can be sold for NEAR — and the business follows the deed in-game. Transaction hashes link to NearBlocks.</>,
      cta: 'Open NEAR wallet',
      run: () => onOpen('wallet'),
    },
  ];
  // Public servers disable fast-forward; skip that step rather than show an error.
  const steps = ffEnabled === false ? allSteps.filter((x) => x.title !== 'Fast-forward time') : allSteps;
  const s = steps[i];

  return (
    <div className="pointer-events-auto fixed bottom-6 left-1/2 z-40 w-[min(560px,calc(100vw-24px))] -translate-x-1/2 animate-rise max-md:bottom-20">
      <div className="panel border-brass/60 p-5 shadow-[var(--shadow-glow)]">
        <div className="flex items-center justify-between">
          <span className="label text-brass">Guided demo · step {i + 1} of {steps.length}</span>
          <button onClick={onClose} className="text-xs text-muted hover:text-parchment">End demo</button>
        </div>
        <h3 className="display mt-2 text-xl font-bold">{s.title}</h3>
        <p className="mt-1.5 text-sm leading-relaxed text-parchment-dim">{s.body(world, me)}</p>
        <div className="mt-4 flex items-center gap-2">
          <div className="flex flex-1 gap-1">{steps.map((_, j) => <span key={j} className={`h-1 flex-1 rounded-full ${j <= i ? 'bg-brass' : 'bg-line'}`} />)}</div>
          {i > 0 && <button onClick={() => setI(i - 1)} className="btn btn-ghost px-3 py-1.5 text-sm">Back</button>}
          {s.cta && <button disabled={busy} onClick={() => void s.run?.()} className="btn btn-gold px-4 py-1.5 text-sm">{s.cta}</button>}
          {i < steps.length - 1 ? <button onClick={() => setI(i + 1)} className="btn btn-ghost px-3 py-1.5 text-sm">Next →</button> : <button onClick={onClose} className="btn btn-ghost px-3 py-1.5 text-sm">Finish</button>}
        </div>
      </div>
    </div>
  );
}
