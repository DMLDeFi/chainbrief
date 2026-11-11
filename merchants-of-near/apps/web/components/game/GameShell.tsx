'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useGame } from '@/lib/store';
import { useSettings } from '@/lib/hooks';
import { gameAudio } from '@/lib/audio';
import type { Selection } from '@/game/TownScene';
import { TownCanvas, type TownHandle } from '../TownCanvas';
import { FlyLayer } from './FlyLayer';
import { Minimap } from './Minimap';
import { MerchantPath } from './MerchantPath';
import { Joystick } from './Joystick';
import { IconBag, IconChart, IconCrown, IconGear, IconHouse, IconMedal, IconPeople, IconScale, IconScroll, IconWallet, IconPlus, IconMinus, IconMap, IconEmpire, IconDice, IconHorse, IconWalk } from '../icons';
import { TavernPanel } from './panels/TavernPanel';
import { HippodromePanel } from './panels/HippodromePanel';
import { TownsfolkPanel } from './panels/TownsfolkPanel';
import { ContractsPanel } from './panels/ContractsPanel';
import { GuildsPanel } from './panels/GuildsPanel';
import { EmpirePanel } from './panels/EmpirePanel';
import { WorldMap } from './WorldMap';
import { CITY_DEFS, CITY_IDS, type MarketId } from '@mon/engine';
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

export type PanelId = 'world' | 'empire' | 'contracts' | 'guilds' | 'tavern' | 'hippodrome' | 'townsfolk' | 'market' | 'inventory' | 'merchants' | 'business' | 'economy' | 'ledger' | 'leaderboard' | 'achievements' | 'wallet' | 'settings';

const DOCK: Array<{ id: PanelId; label: string; icon: React.ReactNode; key: string }> = [
  { id: 'world', label: 'World Map', icon: <IconMap />, key: 'm' },
  { id: 'empire', label: 'Empire', icon: <IconEmpire />, key: 'e' },
  { id: 'contracts', label: 'Contracts', icon: <IconScroll />, key: 'j' },
  { id: 'guilds', label: 'Guilds', icon: <IconCrown />, key: 'g' },
  { id: 'tavern', label: 'Tavern', icon: <IconDice />, key: 't' },
  { id: 'hippodrome', label: 'Hippodrome', icon: <IconHorse />, key: 'h' },
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
  const [marketCity, setMarketCity] = useState<MarketId>('nearhaven');
  // The town on screen: Nearhaven by default, any city after visiting it from the world map.
  const [viewCity, setViewCity] = useState<MarketId>(() => {
    const c = params.get('city');
    return c && (CITY_IDS as readonly string[]).includes(c) ? (c as MarketId) : 'nearhaven';
  });
  const walk = useCallback((c: MarketId) => {
    setViewCity(c);
    setMarketCity(c);
    setPanel(null);
    const u = new URL(location.href);
    if (c === 'nearhaven') u.searchParams.delete('city'); else u.searchParams.set('city', c);
    history.replaceState(null, '', u);
  }, []);
  const [panel, setPanel] = useState<PanelId | null>((params.get('panel') as PanelId) ?? null);
  const [merchantId, setMerchantId] = useState<string | null>(null);
  const [citizen, setCitizen] = useState<{ index: number; portrait: string | null } | null>(null);
  const [plotSel, setPlotSel] = useState<Selection | null>(null);
  const [demo, setDemo] = useState(params.get('demo') === '1');
  const town = useRef<TownHandle>(null);
  // Walk mode: the keys, the joystick and taps move your merchant and the camera follows.
  const [walking, setWalking] = useState(true);
  const [near, setNear] = useState<string | null>(null);
  const [touch, setTouch] = useState(false);
  useEffect(() => {
    try { if (localStorage.getItem('mon.walk') === '0') setWalking(false); } catch { /* storage unavailable */ }
    const mq = window.matchMedia('(pointer: coarse)');
    setTouch(mq.matches);
    const on = () => setTouch(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  useEffect(() => {
    town.current?.setWalkMode(walking);
    try { localStorage.setItem('mon.walk', walking ? '1' : '0'); } catch { /* storage unavailable */ }
  }, [walking]);

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
      if (e.key === 'c') { setWalking((w) => !w); return; }
      if (e.key === 'f') { town.current?.enter(); return; }
      const d = DOCK.find((x) => x.key === e.key);
      if (d) open(d.id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  useEffect(() => {
    if (panel !== 'townsfolk') town.current?.holdCitizen(null);
  }, [panel]);

  const viewCityRef = useRef(viewCity);
  viewCityRef.current = viewCity;
  const onSelect = useCallback((s: Selection) => {
    if (s.type === 'place') { setPanel('tavern'); return; }
    if (s.type === 'citizen') {
      town.current?.holdCitizen(s.index);
      setCitizen({ index: s.index, portrait: town.current?.portrait(s.index) ?? null });
      setPanel('townsfolk');
      return;
    }
    if (s.type === 'merchant') {
      setMerchantId(s.id);
      setPanel('merchants');
    } else if (s.type === 'exchange') { setMarketCity(viewCityRef.current); setPanel('market'); }
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
      <TownCanvas ref={town} world={world} playerId={me.user.id} playerName={me.player.name} onNear={setNear} onSelect={onSelect} settings={settings} city={viewCity} />
      {viewCity !== 'nearhaven' && (
        <div className="pointer-events-auto absolute bottom-6 left-1/2 z-20 flex -translate-x-1/2 items-center gap-3 rounded-full border border-brass/50 bg-[#140f0b]/90 px-4 py-2 text-sm shadow-lg max-md:bottom-24">
          <span className="display font-bold text-brass-bright">{CITY_DEFS[viewCity].name}</span>
          <span className="text-xs text-muted max-sm:hidden">{CITY_DEFS[viewCity].title}</span>
          <button onClick={() => walk('nearhaven')} className="btn btn-ghost px-2.5 py-0.5 text-xs">Back to Nearhaven</button>
          <button onClick={() => setPanel('world')} className="btn btn-ghost px-2.5 py-0.5 text-xs">World map</button>
        </div>
      )}
      <div className="vignette absolute inset-0" />

      <Hud world={world} me={me} onOpen={open} connected={connected} />

      {/* New merchants: the first steps, until they are all done */}
      {!panel && !demo && (
        <div className="pointer-events-none absolute left-16 top-24 z-20 max-md:left-2 max-md:top-[5.5rem] max-md:[&>section]:w-[calc(100vw-172px)]">
          <MerchantPath me={me} onOpen={open} />
        </div>
      )}

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

      {/* Minimap */}
      <div className="pointer-events-none absolute bottom-4 left-16 z-20 max-md:left-auto max-md:right-2 max-md:top-[7.5rem] max-md:bottom-auto">
        <Minimap town={town} label={CITY_DEFS[viewCity].name} />
      </div>

      {/* At a door: enter */}
      {near && walking && (
        <button onClick={() => town.current?.enter()} className="pointer-events-auto absolute bottom-20 left-1/2 z-20 -translate-x-1/2 rounded-full border border-[#8a5f1c] bg-brass px-5 py-2 text-sm font-bold text-ink shadow-[var(--shadow-glow)] animate-pulse-soft max-md:bottom-[15rem] max-md:max-w-[80vw] max-md:truncate">
          <span className="mr-2 rounded bg-ink/20 px-1.5 py-0.5 text-xs max-md:hidden">F</span>{near}
        </button>
      )}

      {/* Touch: thumbstick */}
      {touch && walking && !panel && (
        <div className="absolute bottom-24 left-4 z-20">
          <Joystick onMove={(x, y) => town.current?.setJoystick(x, y)} />
        </div>
      )}

      {/* Zoom controls */}
      <div className="absolute bottom-4 right-4 z-20 flex flex-col gap-1.5 max-md:bottom-20">
        <button className={`panel-glass grid h-10 w-10 place-items-center ${walking ? 'text-brass-bright' : 'text-parchment-dim'} hover:text-brass`} onClick={() => { setWalking((w) => !w); if (!walking) town.current?.findAvatar(); }} title={walking ? 'Walking: keys move your merchant (C for free camera)' : 'Free camera: keys pan the map (C to walk)'} aria-pressed={walking} aria-label="Walk with your merchant"><IconWalk size={18} /></button>
        <button className="panel-glass grid h-10 w-10 place-items-center text-parchment-dim hover:text-brass" onClick={() => town.current?.zoom(1.2)} aria-label="Zoom in"><IconPlus size={18} /></button>
        <button className="panel-glass grid h-10 w-10 place-items-center text-parchment-dim hover:text-brass" onClick={() => town.current?.zoom(0.83)} aria-label="Zoom out"><IconMinus size={18} /></button>
      </div>

      <FlyLayer reducedMotion={settings.reducedMotion} />
      {settings.feed && <Feed feed={feed} world={world} compact={settings.compactFeed} onMerchant={showMerchant} />}

      {/* Panel area */}
      {panel && (
        <div className="pointer-events-none absolute inset-y-0 left-16 z-30 flex items-stretch py-20 pl-2 pr-4 max-md:inset-x-0 max-md:left-0 max-md:px-2 max-md:pb-20 max-md:pt-24 md:right-[340px]">
          {panel === 'world' && <WorldMap world={world} me={me} viewCity={marketCity} onClose={() => setPanel(null)} onVisit={(c) => { setMarketCity(c); setPanel('market'); }} onWalk={walk} />}
          {panel === 'empire' && <EmpirePanel world={world} me={me} onClose={() => setPanel(null)} />}
          {panel === 'contracts' && <ContractsPanel world={world} me={me} onClose={() => setPanel(null)} />}
          {panel === 'townsfolk' && citizen && <TownsfolkPanel world={world} me={me} index={citizen.index} city={viewCity} portrait={citizen.portrait} onClose={() => setPanel(null)} />}
          {panel === 'tavern' && <TavernPanel me={me} onClose={() => setPanel(null)} />}
          {panel === 'hippodrome' && <HippodromePanel world={world} me={me} onClose={() => setPanel(null)} />}
          {panel === 'guilds' && <GuildsPanel world={world} me={me} onClose={() => setPanel(null)} />}
          {panel === 'market' && <MarketPanel world={world} me={me} city={marketCity} onClose={() => setPanel(null)} />}
          {panel === 'inventory' && <InventoryPanel world={world} me={me} onClose={() => setPanel(null)} onOpen={open} />}
          {panel === 'merchants' && <MerchantsPanel world={world} me={me} selected={merchantId} onSelect={showMerchant} onBack={() => setMerchantId(null)} onClose={() => setPanel(null)} />}
          {panel === 'business' && <BusinessPanel world={world} me={me} city={viewCity} selection={plotSel} onClose={() => { setPanel(null); setPlotSel(null); }} />}
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
