'use client';
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { MARKET_DEFS, type MarketId, type PublicSnapshot } from '@mon/engine';
import type { MinimapBase, MinimapLive, Selection, TownScene } from '@/game/TownScene';

export interface TownHandle {
  focus: (s: Selection) => void;
  zoom: (f: number) => void;
  setWalkMode: (on: boolean) => void;
  setJoystick: (x: number, y: number) => void;
  enter: () => void;
  findAvatar: () => void;
  goTo: (gx: number, gy: number) => void;
  minimapBase: () => MinimapBase | null;
  minimapLive: () => MinimapLive | null;
}

interface Props {
  world: PublicSnapshot | null;
  playerId: string | null;
  playerName?: string | null;
  /** The avatar is at a door (its label), or walked away (null). */
  onNear?: (label: string | null) => void;
  onSelect?: (s: Selection) => void;
  settings?: { weather: boolean; reducedMotion: boolean };
  interactive?: boolean;
  className?: string;
  /** Which city's town to show (default Nearhaven). Changing it rebuilds the town. */
  city?: MarketId;
}

/** Mounts the Phaser town (client-only) and streams world snapshots into it. */
export const TownCanvas = forwardRef<TownHandle, Props>(function TownCanvas({ world, playerId, playerName, onNear, onSelect, settings, interactive = true, className, city = 'nearhaven' }, ref) {
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<TownScene | null>(null);
  const latest = useRef({ world, playerId, playerName, onNear, onSelect, settings });
  latest.current = { world, playerId, playerName, onNear, onSelect, settings };

  useImperativeHandle(ref, () => ({
    focus: (s) => scene.current?.focusOn(s),
    zoom: (f) => scene.current?.zoomBy(f),
    setWalkMode: (on) => scene.current?.setWalkMode(on),
    setJoystick: (x, y) => scene.current?.setJoystick(x, y),
    enter: () => scene.current?.enterNearby(),
    findAvatar: () => scene.current?.findAvatar(),
    goTo: (gx, gy) => scene.current?.goTo(gx, gy),
    minimapBase: () => (scene.current?.sys.isActive() ? scene.current.minimapBase() : null),
    minimapLive: () => (scene.current?.sys.isActive() ? scene.current.minimapLive() : null),
  }));

  useEffect(() => {
    let game: import('phaser').Game | null = null;
    let cancelled = false;
    (async () => {
      const mod = await import('phaser');
      const Phaser = ((mod as unknown as { default?: typeof mod }).default ?? mod) as typeof mod;
      const { TownScene } = await import('@/game/TownScene');
      const { setCityLayout } = await import('@/game/layout');
      if (cancelled || !host.current) return;
      setCityLayout(city, MARKET_DEFS[city].name);
      const s = new TownScene();
      game = new Phaser.Game({
        type: pickRenderer(Phaser),
        parent: host.current,
        backgroundColor: '#1d2a1a',
        scale: { mode: Phaser.Scale.RESIZE, width: host.current.clientWidth, height: host.current.clientHeight },
        render: { antialias: true, pixelArt: false, powerPreference: 'high-performance' },
        input: { mouse: { preventDefaultWheel: true } },
        banner: false,
        audio: { noAudio: true }, // game audio is handled by lib/audio.ts
        scene: [],
      });
      game.scene.add('town', s, true, {
        callbacks: {
          onSelect: (sel: Selection) => latest.current.onSelect?.(sel),
          getPlayerId: () => latest.current.playerId,
          getPlayerName: () => latest.current.playerName ?? null,
          onNear: (label: string | null) => latest.current.onNear?.(label),
          getSettings: () => latest.current.settings ?? { weather: true, reducedMotion: false },
        },
        cinematic: !interactive,
      });
      scene.current = s;
      // Cinema mode (?cinema=1): expose the scene so trailer/screenshot scripts can direct it.
      if (new URLSearchParams(location.search).has('cinema')) (window as unknown as { __monTown?: TownScene }).__monTown = s;
      if (latest.current.world) s.setWorld(latest.current.world);
      if (!interactive) game.input.enabled = false;
    })();
    return () => {
      cancelled = true;
      scene.current = null;
      game?.destroy(true);
    };
  }, [interactive, city]);

  useEffect(() => {
    if (world) scene.current?.setWorld(world);
  }, [world]);

  return <div ref={host} className={className ?? 'absolute inset-0'} />;
});

/**
 * WebGL on a software rasteriser (no GPU: some VMs, remote desktops, headless
 * browsers) blocks the page for a minute or more while the town's textures are
 * uploaded. Such browsers name a software renderer (SwiftShader, llvmpipe), so
 * we fall back to the canvas renderer there. A real graphics card always gets
 * WebGL, which is much faster for a large town. `?renderer=webgl|canvas` forces one.
 */
function pickRenderer(Phaser: typeof import('phaser')): number {
  const forced = new URLSearchParams(location.search).get('renderer');
  if (forced === 'webgl') return Phaser.WEBGL;
  if (forced === 'canvas') return Phaser.CANVAS;
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl');
    if (!gl) return Phaser.CANVAS;
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    if (/swiftshader|llvmpipe|softpipe|software/i.test(name)) return Phaser.CANVAS;
  } catch {
    return Phaser.CANVAS;
  }
  return Phaser.AUTO;
}
