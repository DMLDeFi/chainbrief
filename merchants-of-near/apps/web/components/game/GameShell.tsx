'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useGame } from '@/lib/store';
import { useSettings } from '@/lib/hooks';
import { gameAudio } from '@/lib/audio';
import type { Selection } from '@/game/TownScene';
import { TownCanvas, type TownHandle } from '../TownCanvas';
import { FlyLayer } from './FlyLayer';
import { IconBag, IconChart, IconCrown, IconGear, IconHouse, IconMedal, IconPeople, IconScale, IconScroll, IconWallet, IconPlus, IconMinus } from '../icons';
import { Hud } from './Hud';
import { Feed } from './Feed';
import { Toasts } from './Toasts';
import { MarketPanel } from './panels/MarketPanel';
import { InventoryPanel } from './panels/InventoryPanel';
import { MerchantsPanel } from './panels/MerchantsPanel';
import { BusinessPanel } from './panels/BusinessPanel';
import { EconomyPanel } from './panels/EconomyPanel';
import { TransactionsPanel } from './panels/TransactionsPanel';
import { LeaderboardPanel } from './panels/LeaderboardPanel';
import { AchievementsPanel } from './panels/AchievementsPanel';
import { WalletPanel } from './panels/WalletPanel';
import { SettingsPanel } from './panels/SettingsPanel';
import { DemoGuide } from './DemoGuide';

export type PanelId = 'market' | 'inventory' | 'merchants' | 'business' | 'economy' | 'ledger' | 'leaderboard' | 'achievements' | 'wallet' | 'settings';

const DOCK: Array<{ id: PanelId; label: string; icon: React.ReactNode; key: string }> = [
  { id: 'market', label: 'Marketplace', icon: <IconScale />, key: '1' },
  { id: 'inventory', label: 'Inventory', icon: <IconBag />, key: '2' },
  { id: 'merchants', label: 'Merchants', icon: <IconPeople />, key: '3' },
  { id: 'business', label: 'Businesses', icon: <IconHouse />, key: '4' },
  { id: 'economy', label: 'Economy', icon: <IconChart />, key: '5' },
  { id: 'ledger', label: 'Transactions', icon: <IconScroll />, key: '6' },
  { id: 'leaderboard', label: 'Leaderboard', icon: <IconCrown />, key: '7' },
  { id: 'achievements', label: 'Progress', icon: <IconMedal />, key: '8' },
  { id: 'wallet', label: 'NEAR Wallet', icon: <IconWallet />, key: '9' },
  { id: 'settings', label: 'Settings', icon: <IconGear />, key: '0' },
];

export function GameShell() {
  const { world, me, meLoaded, feed, connected } = useGame();
  const router = useRouter();
  const params = useSearchParams();
  const [settings, setSettings] = useSettings();
  const [panel, setPanel] = useState<PanelId | null>((params.get('panel') as PanelId) ?? null);
  const [merchantId, setMerchantId] = useState<string | null>(null);
  const [plotSel, setPlotSel] = useState<Selection | null>(null);
  const [demo, setDemo] = useState(params.get('demo') === '1');
  const town = useRef<TownHandle>(null);

  useEffect(() => {
    if (meLoaded && !me) router.replace(`/register?next=${encodeURIComponent(`/play${demo ? '?demo=1' : ''}`)}`);
  }, [meLoaded, me, router, demo]);

  // Soundtrack follows the world: time of day, season, weather and active events.
  useEffect(() => gameAudio.init(), []);
  useEffect(() => {
    if (world) gameAudio.setMood({ hour: world.hour, season: world.season, weather: world.weather, tension: world.events.length > 0 });
  }, [world]);
  const lastEvent = useRef<number>(-1);
  useEffect(() => {
    const ev = feed.filter((f) => f.kind === 'event' && f.severity === 'bad').at(-1);
    if (!ev) return;
    if (lastEvent.current !== -1 && ev.id > lastEvent.current) gameAudio.bell();
    lastEvent.current = ev.id;
  }, [feed]);
  const lastLevel = useRef<number | null>(null);
  const achievements = me ? Object.keys(me.player.achievements).length : 0;
  const lastAch = useRef<number | null>(null);
  useEffect(() => {
    if (!me) return;
    if ((lastLevel.current !== null && me.player.level > lastLevel.current) || (lastAch.current !== null && achievements > lastAch.current)) gameAudio.fanfare();
    lastLevel.current = me.player.level;
    lastAch.current = achievements;
  }, [me, achievements]);

  const open = useCallback((id: PanelId | null) => setPanel((p) => (p === id ? null : id)), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input,textarea,select')) return;
      if (e.key === 'Escape') setPanel(null);
      const d = DOCK.find((x) => x.key === e.key);
      if (d) open(d.id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const onSelect = useCallback((s: Selection) => {
    if (s.type === 'merchant') {
      setMerchantId(s.id);
      setPanel('merchants');
    } else if (s.type === 'exchange') setPanel('market');
    else {
      setPlotSel(s);
      setPanel('business');
    }
    town.current?.focus(s);
  }, []);

  const showMerchant = (id: string) => {
    setMerchantId(id);
    setPanel('merchants');
    town.current?.focus({ type: 'merchant', id });
  };

  if (!me || !world) {
    return (
      <main className="fixed inset-0 grid place-items-center bg-ink">
        <div className="text-center">
          <div className="display text-2xl text-brass animate-pulse-soft">Opening the gates of Nearhaven…</div>
          <div className="mt-2 text-sm text-muted">{connected ? 'Loading your ledger' : 'Connecting to the world server'}</div>
        </div>
      </main>
    );
  }

  return (
    <main className="fixed inset-0 overflow-hidden bg-ink" data-cinema={params.has('cinema') ? '' : undefined}>
      <TownCanvas ref={town} world={world} playerId={me.user.id} onSelect={onSelect} settings={settings} />
      <div className="vignette absolute inset-0" />

      <Hud world={world} me={me} onOpen={open} connected={connected} />

      {/* Dock */}
      <nav className="pointer-events-auto absolute left-3 top-1/2 z-20 flex -translate-y-1/2 flex-col gap-1.5 max-md:bottom-3 max-md:left-1/2 max-md:top-auto max-md:-translate-x-1/2 max-md:translate-y-0 max-md:flex-row max-md:overflow-x-auto max-md:max-w-[calc(100vw-24px)]" aria-label="Game panels">
        {DOCK.map((d) => (
          <button
            key={d.id}
            onClick={() => open(d.id)}
            data-fly-target={d.id === 'inventory' ? 'inventory' : undefined}
            title={`${d.label} (${d.key})`}
            aria-pressed={panel === d.id}
            className={`group relative grid h-11 w-11 shrink-0 place-items-center rounded-xl border transition ${panel === d.id ? 'border-brass bg-brass text-ink shadow-[var(--shadow-glow)]' : 'panel-glass text-parchment-dim hover:text-brass-bright'}`}
          >
            {d.icon}
            <span className="pointer-events-none absolute left-14 hidden whitespace-nowrap rounded-md bg-walnut px-2 py-1 text-xs font-semibold text-parchment opacity-0 shadow-lg transition group-hover:opacity-100 md:block">{d.label} <span className="text-muted">· {d.key}</span></span>
          </button>
        ))}
      </nav>

      {/* Zoom controls */}
      <div className="absolute bottom-4 right-4 z-20 flex flex-col gap-1.5 max-md:bottom-20">
        <button className="panel-glass grid h-10 w-10 place-items-center text-parchment-dim hover:text-brass" onClick={() => town.current?.zoom(1.2)} aria-label="Zoom in"><IconPlus size={18} /></button>
        <button className="panel-glass grid h-10 w-10 place-items-center text-parchment-dim hover:text-brass" onClick={() => town.current?.zoom(0.83)} aria-label="Zoom out"><IconMinus size={18} /></button>
      </div>

      <FlyLayer reducedMotion={settings.reducedMotion} />
      {settings.feed && <Feed feed={feed} world={world} compact={settings.compactFeed} onMerchant={showMerchant} />}

      {/* Panel area */}
      {panel && (
        <div className="pointer-events-none absolute inset-y-0 left-16 z-30 flex items-stretch py-20 pl-2 pr-4 max-md:inset-x-0 max-md:left-0 max-md:px-2 max-md:pb-20 max-md:pt-24 md:right-[340px]">
          {panel === 'market' && <MarketPanel world={world} me={me} onClose={() => setPanel(null)} />}
          {panel === 'inventory' && <InventoryPanel world={world} me={me} onClose={() => setPanel(null)} onOpen={open} />}
          {panel === 'merchants' && <MerchantsPanel world={world} me={me} selected={merchantId} onSelect={showMerchant} onBack={() => setMerchantId(null)} onClose={() => setPanel(null)} />}
          {panel === 'business' && <BusinessPanel world={world} me={me} selection={plotSel} onClose={() => { setPanel(null); setPlotSel(null); }} />}
          {panel === 'economy' && <EconomyPanel world={world} onClose={() => setPanel(null)} onMerchant={showMerchant} />}
          {panel === 'ledger' && <TransactionsPanel me={me} onClose={() => setPanel(null)} />}
          {panel === 'leaderboard' && <LeaderboardPanel me={me} onClose={() => setPanel(null)} />}
          {panel === 'achievements' && <AchievementsPanel me={me} onClose={() => setPanel(null)} />}
          {panel === 'wallet' && <WalletPanel me={me} onClose={() => setPanel(null)} />}
          {panel === 'settings' && <SettingsPanel settings={settings} onChange={setSettings} onClose={() => setPanel(null)} onDemo={() => { setDemo(true); setPanel(null); }} />}
        </div>
      )}

      {demo && <DemoGuide world={world} me={me} onOpen={(p) => setPanel(p)} onFocus={(s) => town.current?.focus(s)} onMerchant={showMerchant} onClose={() => setDemo(false)} />}
      <Toasts />
    </main>
  );
}
