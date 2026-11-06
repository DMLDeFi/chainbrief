'use client';
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import type { PublicSnapshot } from '@mon/engine';
import type { Selection, TownScene } from '@/game/TownScene';

export interface TownHandle {
  focus: (s: Selection) => void;
  zoom: (f: number) => void;
}

interface Props {
  world: PublicSnapshot | null;
  playerId: string | null;
  onSelect?: (s: Selection) => void;
  settings?: { weather: boolean; reducedMotion: boolean };
  interactive?: boolean;
  className?: string;
}

/** Mounts the Phaser town (client-only) and streams world snapshots into it. */
export const TownCanvas = forwardRef<TownHandle, Props>(function TownCanvas({ world, playerId, onSelect, settings, interactive = true, className }, ref) {
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<TownScene | null>(null);
  const latest = useRef({ world, playerId, onSelect, settings });
  latest.current = { world, playerId, onSelect, settings };

  useImperativeHandle(ref, () => ({
    focus: (s) => scene.current?.focusOn(s),
    zoom: (f) => scene.current?.zoomBy(f),
  }));

  useEffect(() => {
    let game: import('phaser').Game | null = null;
    let cancelled = false;
    (async () => {
      const mod = await import('phaser');
      const Phaser = ((mod as unknown as { default?: typeof mod }).default ?? mod) as typeof mod;
      const { TownScene } = await import('@/game/TownScene');
      if (cancelled || !host.current) return;
      const s = new TownScene();
      game = new Phaser.Game({
        type: Phaser.AUTO,
        parent: host.current,
        backgroundColor: '#1d2a1a',
        scale: { mode: Phaser.Scale.RESIZE, width: host.current.clientWidth, height: host.current.clientHeight },
        render: { antialias: true, pixelArt: false, powerPreference: 'high-performance' },
        input: { mouse: { preventDefaultWheel: true } },
        banner: false,
        scene: [],
      });
      game.scene.add('town', s, true, {
        callbacks: {
          onSelect: (sel: Selection) => latest.current.onSelect?.(sel),
          getPlayerId: () => latest.current.playerId,
          getSettings: () => latest.current.settings ?? { weather: true, reducedMotion: false },
        },
      });
      scene.current = s;
      if (latest.current.world) s.setWorld(latest.current.world);
      if (!interactive) game.input.enabled = false;
    })();
    return () => {
      cancelled = true;
      scene.current = null;
      game?.destroy(true);
    };
  }, [interactive]);

  useEffect(() => {
    if (world) scene.current?.setWorld(world);
  }, [world]);

  return <div ref={host} className={className ?? 'absolute inset-0'} />;
});
