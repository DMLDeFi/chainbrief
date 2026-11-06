'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useGame, refreshMe } from '@/lib/store';
import { signInWithNear } from '@/lib/near';
import { TownCanvas } from './TownCanvas';
import { Logo } from './icons';

/** Embers drifting up through the title frame (pure CSS, deterministic positions). */
const EMBERS = Array.from({ length: 14 }, (_, i) => ({ left: (i * 53) % 100, delay: (i * 0.73) % 9, dur: 7 + ((i * 37) % 6), size: 5 + (i % 3) * 2 }));

/** Cinematic main menu: the living town drifts behind an illuminated title. */
export function TitleScreen() {
  const { world, me, meLoaded } = useGame();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connectWallet = async () => {
    setBusy(true);
    setError(null);
    try {
      await signInWithNear();
      await refreshMe();
      router.push('/play');
    } catch (e) {
      setError((e as Error).message || 'Wallet connection was cancelled.');
    } finally {
      setBusy(false);
    }
  };

  const items: Array<{ label: string; href?: string; onClick?: () => void; primary?: boolean; near?: boolean; hint?: string }> = [
    { label: 'Start New Game', href: '/register', primary: true },
    { label: 'Continue Game', href: me ? '/play' : '/register?mode=login&next=/play', hint: meLoaded ? (me ? `as ${me.player.name}` : 'sign in to resume') : undefined },
    { label: 'Leaderboards', href: me ? '/play?panel=leaderboard' : '/register?mode=login&next=%2Fplay%3Fpanel%3Dleaderboard' },
    { label: 'Settings', href: me ? '/play?panel=settings' : '/register?mode=login&next=%2Fplay%3Fpanel%3Dsettings' },
    { label: busy ? 'Opening wallet…' : 'Connect NEAR Wallet', onClick: connectWallet, near: true },
  ];

  return (
    <section className="relative min-h-[100svh] overflow-hidden bg-ink sm:h-[100svh] sm:min-h-[640px]">
      <TownCanvas world={world} playerId={null} interactive={false} className="absolute inset-0" />
      {/* Cinematic grade: vignette, letterbox and warm haze so the title reads over the town. */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_55%_at_50%_48%,rgba(14,11,8,0.78),rgba(14,11,8,0.35)_70%,rgba(14,11,8,0.85))]" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-ink to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-ink to-transparent" />
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
        {EMBERS.map((e, i) => (
          <span key={i} className="ember" style={{ left: `${e.left}%`, animationDelay: `${e.delay}s`, animationDuration: `${e.dur}s`, width: e.size, height: e.size }} />
        ))}
      </div>

      <div className="relative z-10 flex min-h-[100svh] flex-col items-center justify-center px-5 py-10 text-center sm:h-full sm:min-h-0 sm:py-0">
        <div className="title-rise flex flex-col items-center">
          <span className="max-sm:hidden"><Logo size={64} /></span><span className="sm:hidden"><Logo size={48} /></span>
          <div className="mt-5 flex items-center gap-3 text-brass/80" aria-hidden>
            <span className="h-px w-12 bg-gradient-to-r from-transparent to-brass sm:w-24" />
            <span className="label !text-brass">Nearhaven · Anno 1426</span>
            <span className="h-px w-12 bg-gradient-to-l from-transparent to-brass sm:w-24" />
          </div>
          <h1 className="title-gold display mt-3 text-[2.6rem] font-bold leading-none sm:text-7xl md:text-8xl">MERCHANTS<br className="sm:hidden" /> OF NEAR</h1>
          <p className="display mt-5 max-w-2xl text-[0.8rem] tracking-[0.28em] text-parchment-dim sm:text-sm">BUILD YOUR WEALTH. SHAPE THE ECONOMY. RULE THE MARKET.</p>
        </div>

        <nav className="title-rise-late mt-8 flex sm:mt-10 w-full max-w-sm flex-col gap-2.5" aria-label="Main menu">
          {items.map((it) => {
            const cls = `plaque ${it.primary ? 'plaque-primary' : ''} ${it.near ? 'plaque-near' : ''}`;
            const body = (
              <>
                <span className="plaque-gem" aria-hidden />
                <span className="flex-1">{it.label}</span>
                {it.hint && <span className="text-[0.65rem] font-normal normal-case tracking-normal text-muted">{it.hint}</span>}
              </>
            );
            return it.href ? (
              <Link key={it.label} href={it.href} className={cls}>{body}</Link>
            ) : (
              <button key={it.label} type="button" onClick={it.onClick} disabled={busy} className={cls}>{body}</button>
            );
          })}
          {error && <p role="alert" className="mt-1 text-xs text-ember">{error}</p>}
          <Link href="/demo" className="mt-2 text-xs text-muted underline-offset-4 hover:text-brass hover:underline">or watch the 3-minute guided demo — no account needed</Link>
        </nav>

        {world && (
          <p className="mt-8 max-w-md text-[0.7rem] text-muted sm:absolute sm:bottom-6 sm:mt-0 sm:max-w-none">
            Live now · day {world.day}, {world.season} · {world.weather} · {world.population} citizens · {world.players} human merchant{world.players === 1 ? '' : 's'} · NEAR testnet
          </p>
        )}
      </div>
      <a href="#about" className="absolute bottom-6 right-6 z-10 hidden text-xs text-muted hover:text-brass sm:block">About the game ↓</a>
    </section>
  );
}
