'use client';
import { useSyncExternalStore } from 'react';
/**
 * Game audio: an original, procedurally generated medieval soundtrack (Web
 * Audio API), optional local tracks, and sound effects.
 *
 * - The generated music is composed live from a seeded melody walk over modal
 *   scales and reacts to the world: slower and darker at night, Aeolian in
 *   winter, a tense drum during economic events.
 * - Local tracks: any audio files placed in apps/web/public/audio/ (gitignored)
 *   are listed by the server and played instead of the generated music.
 * - Browsers (especially mobile) only allow sound after a user gesture, so
 *   playback starts on the first tap/click/keypress.
 */

export interface AudioSettings {
  music: boolean;
  sfx: boolean;
  volume: number; // 0..1
  source: 'auto' | 'generated' | 'tracks';
}

export interface Mood {
  hour: number;
  season: string;
  weather: string;
  tension: boolean;
}

const KEY = 'mon.audio';
const DEFAULTS: AudioSettings = { music: true, sfx: true, volume: 0.55, source: 'auto' };

// Scale degrees as semitones from the root.
const DORIAN = [0, 2, 3, 5, 7, 9, 10];
const AEOLIAN = [0, 2, 3, 5, 7, 8, 10];
const MIXOLYDIAN = [0, 2, 4, 5, 7, 9, 10];
// Chord roots (scale degree index) for an 8-bar cycle: i – VII – VI – VII …
const PROGRESSION = [0, 6, 5, 6, 0, 3, 4, 0];

const midiToHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

class GameAudio {
  settings: AudioSettings = { ...DEFAULTS };
  unlocked = false;
  tracks: string[] = [];
  private ctx?: AudioContext;
  private master?: GainNode;
  private musicBus?: GainNode;
  private sfxBus?: GainNode;
  private echo?: { delay: DelayNode; fb: GainNode; wet: GainNode };
  private drone: OscillatorNode[] = [];
  private droneGain?: GainNode;
  private timer?: number;
  private nextNoteTime = 0;
  private step = 0;
  private melody = 7; // index into a two-octave scale
  private rng = 1234567;
  private mood: Mood = { hour: 12, season: 'spring', weather: 'clear', tension: false };
  private trackEl?: HTMLAudioElement;
  private trackIndex = 0;
  private trackSrc = '';
  /** Tracks the browser could not decode or load; they are skipped. */
  private failed = new Set<string>();
  /** What is audible right now, for the Settings panel. */
  nowPlaying = 'silent — click in the town to start';
  private listeners = new Set<() => void>();
  private started = false;

  constructor() {
    if (typeof window === 'undefined') return;
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) this.settings = { ...DEFAULTS, ...JSON.parse(raw) };
    } catch { /* storage unavailable */ }
  }

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit() {
    this.listeners.forEach((l) => l());
  }

  /** Attach gesture listeners and visibility handling once. */
  init() {
    if (this.started || typeof window === 'undefined') return;
    this.started = true;
    // Mobile browsers (iOS Safari especially) only allow audio from certain
    // gestures — a finger lifting (touchend/click), not touchstart/pointerdown.
    // Listen to all of them and keep trying until the engine is really running.
    const events = ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown'] as const;
    const kick = () => {
      void this.unlock().then(() => {
        if (this.ctx?.state === 'running') events.forEach((e) => window.removeEventListener(e, kick, true));
      });
    };
    events.forEach((e) => window.addEventListener(e, kick, true));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.pauseAll();
      else this.refresh();
    });
    void fetch('/api/audio/tracks')
      .then((r) => (r.ok ? r.json() : []))
      .then((t: string[]) => {
        this.tracks = Array.isArray(t) ? t : [];
        this.refresh();
        this.emit();
      })
      .catch(() => undefined);
  }

  async unlock() {
    if (this.ctx) {
      // Created earlier but still suspended (gesture didn't count): try again now.
      if (this.ctx.state !== 'running') {
        this.playSilence();
        await this.ctx.resume().catch(() => undefined);
        if ((this.ctx.state as string) === 'running') {
          this.refresh();
          this.emit();
        }
      } else if (this.usingTracks && this.trackEl?.paused) this.refresh();
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    this.ctx = new Ctor();
    this.playSilence();
    await this.ctx.resume().catch(() => undefined);
    const comp = this.ctx.createDynamicsCompressor();
    comp.connect(this.ctx.destination);
    this.master = this.ctx.createGain();
    this.master.gain.value = this.settings.volume;
    this.master.connect(comp);
    this.musicBus = this.ctx.createGain();
    this.musicBus.gain.value = 0;
    this.musicBus.connect(this.master);
    this.sfxBus = this.ctx.createGain();
    this.sfxBus.gain.value = 0.8;
    this.sfxBus.connect(this.master);
    // A soft feedback echo gives the plucked notes a hall-like tail.
    const delay = this.ctx.createDelay(1);
    delay.delayTime.value = 0.32;
    const fb = this.ctx.createGain();
    fb.gain.value = 0.32;
    const wet = this.ctx.createGain();
    wet.gain.value = 0.28;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2400;
    delay.connect(lp).connect(fb).connect(delay);
    lp.connect(wet).connect(this.musicBus);
    this.echo = { delay, fb, wet };
    this.unlocked = true; // engine built; sound flows once the context is running
    this.refresh();
    this.emit();
  }

  /** A one-sample silent buffer started inside the gesture wakes up iOS audio. */
  private playSilence() {
    if (!this.ctx) return;
    try {
      const src = this.ctx.createBufferSource();
      src.buffer = this.ctx.createBuffer(1, 1, 22050);
      src.connect(this.ctx.destination);
      src.start(0);
    } catch { /* ignore */ }
  }

  update(p: Partial<AudioSettings>) {
    this.settings = { ...this.settings, ...p };
    try { localStorage.setItem(KEY, JSON.stringify(this.settings)); } catch { /* ignore */ }
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(this.settings.volume, this.ctx.currentTime, 0.05);
    if (this.trackEl) this.trackEl.volume = this.settings.volume;
    this.refresh();
    this.emit();
  }

  setMood(m: Mood) {
    this.mood = m;
  }

  get playableTracks() {
    return this.tracks.filter((t) => !this.failed.has(t));
  }
  get usingTracks() {
    const n = this.playableTracks.length;
    return n > 0 && (this.settings.source === 'tracks' || this.settings.source === 'auto');
  }
  private setNowPlaying(label: string) {
    if (label !== this.nowPlaying) {
      this.nowPlaying = label;
      this.emit();
    }
  }

  /** Start or stop whichever music source the settings call for. */
  private refresh() {
    if (!this.unlocked || typeof document === 'undefined' || document.hidden) return;
    const wantMusic = this.settings.music;
    if (wantMusic && this.usingTracks) {
      this.stopGenerated();
      this.playTrack();
    } else if (wantMusic) {
      this.stopTrack();
      this.startGenerated();
      this.setNowPlaying(this.failed.size ? 'generated soundtrack (your tracks could not be played)' : 'generated soundtrack');
    } else {
      this.stopTrack();
      this.stopGenerated();
      this.setNowPlaying('music off');
    }
  }

  private pauseAll() {
    this.trackEl?.pause();
    this.stopGenerated();
  }

  // ---------------------------------------------------------- local tracks
  private playTrack() {
    const list = this.playableTracks;
    if (!list.length) return this.refresh();
    if (!this.trackEl) {
      this.trackEl = new Audio();
      this.trackEl.preload = 'auto';
      this.trackEl.addEventListener('ended', () => {
        this.trackIndex += 1;
        this.playTrack();
      });
      // A file the browser can't load or decode: skip it, and fall back to the
      // generated soundtrack if none are playable.
      this.trackEl.addEventListener('error', () => {
        console.warn(`[audio] could not play ${decodeURIComponent(this.trackSrc)} — skipping`);
        this.failed.add(this.trackSrc);
        this.trackSrc = '';
        this.refresh();
      });
    }
    const src = list[this.trackIndex % list.length];
    if (this.trackSrc !== src) {
      this.trackSrc = src;
      this.trackEl.src = src;
    }
    this.trackEl.volume = this.settings.volume;
    this.trackEl.play().then(
      () => this.setNowPlaying(`your track: ${decodeURIComponent(src.split('/').pop() ?? src)}`),
      (e: DOMException) => {
        if (e?.name === 'NotAllowedError') {
          // Autoplay blocked: retry on the next tap or click.
          this.setNowPlaying('waiting — click in the town to start');
          for (const ev of ['touchend', 'click', 'keydown']) window.addEventListener(ev, () => this.refresh(), { once: true });
        } else if (e?.name !== 'AbortError') {
          console.warn(`[audio] could not play ${decodeURIComponent(src)}: ${e?.message ?? e}`);
          this.failed.add(src);
          this.trackSrc = '';
          this.refresh();
        }
      },
    );
  }
  private stopTrack() {
    this.trackEl?.pause();
  }

  // ------------------------------------------------------ generated music
  private rand() {
    this.rng = (this.rng * 1103515245 + 12345) & 0x7fffffff;
    return this.rng / 0x7fffffff;
  }
  private night() {
    const h = this.mood.hour;
    return h >= 20 || h < 6;
  }
  private scale() {
    if (this.mood.tension) return AEOLIAN;
    if (this.mood.season === 'winter') return AEOLIAN;
    if (this.mood.season === 'summer') return MIXOLYDIAN;
    return DORIAN;
  }
  private root() {
    return this.mood.season === 'winter' ? 46 : 50; // Bb2 in winter, D3 otherwise
  }
  private tempo() {
    return this.night() ? 58 : this.mood.tension ? 92 : 76;
  }

  private startGenerated() {
    if (!this.ctx || !this.musicBus || this.timer !== undefined) return;
    const ctx = this.ctx;
    this.musicBus.gain.cancelScheduledValues(ctx.currentTime);
    this.musicBus.gain.setTargetAtTime(0.9, ctx.currentTime, 1.2);
    // Drone: root + fifth, slowly breathing.
    this.droneGain = ctx.createGain();
    this.droneGain.gain.value = 0.045;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 600;
    this.droneGain.connect(lp).connect(this.musicBus);
    for (const interval of [0, 7, 12]) {
      const o = ctx.createOscillator();
      o.type = interval === 12 ? 'sine' : 'triangle';
      o.frequency.value = midiToHz(this.root() - 12 + interval);
      o.detune.value = (interval - 6) * 1.5;
      o.connect(this.droneGain);
      o.start();
      this.drone.push(o);
    }
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.frequency.value = 0.07;
    lfoGain.gain.value = 0.02;
    lfo.connect(lfoGain).connect(this.droneGain.gain);
    lfo.start();
    this.drone.push(lfo);
    this.nextNoteTime = ctx.currentTime + 0.1;
    this.timer = window.setInterval(() => this.schedule(), 90);
  }

  private stopGenerated() {
    if (this.timer !== undefined) window.clearInterval(this.timer);
    this.timer = undefined;
    if (this.ctx && this.musicBus) this.musicBus.gain.setTargetAtTime(0, this.ctx.currentTime, 0.3);
    const ctx = this.ctx;
    const old = this.drone;
    this.drone = [];
    if (ctx) setTimeout(() => old.forEach((o) => { try { o.stop(); } catch { /* already stopped */ } }), 1500);
  }

  /** Lookahead scheduler: queue the notes of the next ~0.3 s. */
  private schedule() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const sixteenth = 60 / this.tempo() / 4;
    while (this.nextNoteTime < ctx.currentTime + 0.3) {
      this.playStep(this.step, this.nextNoteTime, sixteenth);
      this.nextNoteTime += sixteenth;
      this.step = (this.step + 1) % (16 * PROGRESSION.length);
    }
  }

  private playStep(step: number, t: number, sixteenth: number) {
    const scale = this.scale();
    const bar = Math.floor(step / 16);
    const beat = step % 16;
    const chordDeg = PROGRESSION[bar % PROGRESSION.length];
    const root = this.root();
    const note = (deg: number, octave = 0) => root + 12 * (octave + Math.floor(deg / 7)) + scale[((deg % 7) + 7) % 7];
    const night = this.night();

    // Bass on beat 1 and 3 (softer at night).
    if (beat === 0 || (beat === 8 && !night)) this.pluck(midiToHz(note(chordDeg, -1)), t, night ? 0.09 : 0.12, 1.6, 900);

    // Chord arpeggio on eighths.
    if (beat % 2 === 0 && !(night && beat % 4 !== 0)) {
      const tones = [chordDeg, chordDeg + 2, chordDeg + 4, chordDeg + 2];
      const deg = tones[(beat / 2) % tones.length];
      this.pluck(midiToHz(note(deg, 0)), t, 0.05, 0.9, 1800, true);
    }

    // Melody: a random walk biased to chord tones, phrased with rests.
    const density = night ? 0.22 : this.mood.tension ? 0.5 : 0.38;
    if (beat % 2 === 0 && this.rand() < density && bar % 8 !== 7) {
      const r = this.rand();
      this.melody += r < 0.35 ? -1 : r < 0.7 ? 1 : r < 0.82 ? -2 : r < 0.94 ? 2 : 0;
      this.melody = Math.max(3, Math.min(13, this.melody));
      // Snap toward the chord on strong beats.
      if (beat % 8 === 0) {
        const chordTones = [chordDeg, chordDeg + 2, chordDeg + 4, chordDeg + 7];
        this.melody = chordTones.reduce((a, b) => (Math.abs(b - this.melody) < Math.abs(a - this.melody) ? b : a));
      }
      const hz = midiToHz(note(this.melody, 1));
      if (!night && this.mood.season === 'summer' && this.rand() < 0.4) this.flute(hz, t, sixteenth * 4);
      else this.pluck(hz, t, 0.08, 1.2, 2600, true);
    }

    // Frame drum: market bustle by day, insistent during tension.
    if (!night || this.mood.tension) {
      if (beat === 0 || beat === 8) this.drum(t, 0.18, 110);
      if (this.mood.tension && (beat === 6 || beat === 14)) this.drum(t, 0.1, 160);
      if (!this.mood.tension && beat === 12 && this.rand() < 0.5) this.drum(t, 0.07, 180);
    }
  }

  private pluck(freq: number, t: number, gain: number, decay: number, cutoff: number, echo = false) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const o2 = ctx.createOscillator();
    o.type = 'triangle';
    o2.type = 'sawtooth';
    o.frequency.value = freq;
    o2.frequency.value = freq * 1.003;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(cutoff * 2, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(200, cutoff * 0.3), t + decay * 0.6);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    const g2 = ctx.createGain();
    g2.gain.value = 0.25;
    o.connect(f);
    o2.connect(g2).connect(f);
    f.connect(g).connect(this.musicBus!);
    if (echo && this.echo) g.connect(this.echo.delay);
    o.start(t);
    o2.start(t);
    o.stop(t + decay + 0.05);
    o2.stop(t + decay + 0.05);
  }

  private flute(freq: number, t: number, dur: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = freq;
    const vib = ctx.createOscillator();
    const vibG = ctx.createGain();
    vib.frequency.value = 5.2;
    vibG.gain.value = freq * 0.006;
    vib.connect(vibG).connect(o.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.05, t + 0.08);
    g.gain.setValueAtTime(0.05, t + dur * 0.7);
    g.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(g).connect(this.musicBus!);
    if (this.echo) g.connect(this.echo.delay);
    o.start(t);
    vib.start(t);
    o.stop(t + dur + 0.05);
    vib.stop(t + dur + 0.05);
  }

  private noise(t: number, dur: number) {
    const ctx = this.ctx!;
    const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.start(t);
    return src;
  }

  private drum(t: number, gain: number, freq: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(freq * 0.45, t + 0.18);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
    o.connect(g).connect(this.musicBus!);
    o.start(t);
    o.stop(t + 0.3);
    const n = this.noise(t, 0.06);
    const nf = ctx.createBiquadFilter();
    nf.type = 'bandpass';
    nf.frequency.value = 900;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(gain * 0.25, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
    n.connect(nf).connect(ng).connect(this.musicBus!);
  }

  // --------------------------------------------------------- sound effects
  private canSfx() {
    return this.unlocked && this.settings.sfx && !!this.ctx && !document.hidden;
  }
  private tone(freq: number, t: number, dur: number, gain: number, type: OscillatorType = 'triangle') {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.sfxBus!);
    o.start(t);
    o.stop(t + dur + 0.02);
  }
  /** Coins clinking: a trade went through. */
  coin() {
    if (!this.canSfx()) return;
    const t = this.ctx!.currentTime;
    this.tone(1975, t, 0.12, 0.12);
    this.tone(2637, t + 0.07, 0.18, 0.1);
  }
  /** Something failed. */
  thud() {
    if (!this.canSfx()) return;
    const t = this.ctx!.currentTime;
    this.tone(196, t, 0.18, 0.12, 'sine');
    this.tone(147, t + 0.08, 0.22, 0.1, 'sine');
  }
  /** Level up / achievement fanfare. */
  fanfare() {
    if (!this.canSfx()) return;
    const t = this.ctx!.currentTime;
    [62, 66, 69, 74].forEach((m, i) => this.tone(midiToHz(m + 12), t + i * 0.11, 0.5, 0.11));
  }
  /** Town bell: a new economic event. */
  bell() {
    if (!this.canSfx()) return;
    const t = this.ctx!.currentTime;
    for (const [ratio, g] of [[1, 0.12], [2.76, 0.05], [5.4, 0.03], [0.5, 0.06]] as const) this.tone(392 * ratio, t, 2.2, g, 'sine');
  }
}

export const gameAudio = new GameAudio();

// ------------------------------------------------------------------ React hook

const snap = () => ({ settings: gameAudio.settings, unlocked: gameAudio.unlocked, tracks: gameAudio.tracks, playable: gameAudio.playableTracks.length, nowPlaying: gameAudio.nowPlaying });
let snapshot = snap();
gameAudio.subscribe(() => {
  snapshot = snap();
});
export function useAudio() {
  return useSyncExternalStore(
    (fn) => gameAudio.subscribe(fn),
    () => snapshot,
    () => snapshot,
  );
}
