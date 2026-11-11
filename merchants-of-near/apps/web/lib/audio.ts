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

// The epic score's harmony, as semitones from the root (D minor by default).
// First half, brooding: i – VI – III – VII. Second half, heroic: i – VI – iv – V.
const CHORDS_A = [[0, 3, 7], [-4, 0, 3], [3, 7, 10], [-2, 2, 5]];
const CHORDS_B = [[0, 3, 7], [-4, 0, 3], [5, 8, 12], [7, 11, 14]];
const EPIC_BARS = 16;
// The horn theme (original), two notes a bar over the heroic half; null holds the note before.
const HORN_THEME: Array<number | null> = [7, 12, 10, 7, 5, 3, 0, null, 5, 8, 12, 10, 7, 11, 14, null, null];

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
  private hall?: ConvolverNode;
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
    // Arriving from the title screen or intro page (same document), the player has
    // already clicked, so the browser allows sound now: start without waiting for another click.
    const nav = navigator as Navigator & { userActivation?: { hasBeenActive: boolean } };
    if (nav.userActivation?.hasBeenActive) kick();
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
  //
  // An original epic score, composed for the game and played live: low strings,
  // a cello ostinato, war drums, a horn theme, choir and harp, in a large hall.
  // A 16-bar cycle: a brooding first half, then the full heroic theme. Night is
  // hushed (strings, choir, harp); events make it faster and darker.
  private rand() {
    this.rng = (this.rng * 1103515245 + 12345) & 0x7fffffff;
    return this.rng / 0x7fffffff;
  }
  private night() {
    const h = this.mood.hour;
    return h >= 20 || h < 6;
  }
  private root() {
    // D minor; winter sinks to B-flat minor.
    return this.mood.season === 'winter' ? 46 : 50;
  }
  private tempo() {
    return this.night() ? 54 : this.mood.tension ? 84 : 66;
  }

  /** A generated hall: decaying stereo noise as the reverb's impulse response. */
  private buildHall() {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * 3.4);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const t = i / ctx.sampleRate;
        d[i] = (Math.random() * 2 - 1) * Math.exp(-t * 1.9) * (t < 0.02 ? t / 0.02 : 1);
      }
    }
    const conv = ctx.createConvolver();
    conv.buffer = ir;
    // Keep the hall's low end tight so the drums don't turn to mud.
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 160;
    const wet = ctx.createGain();
    wet.gain.value = 0.42;
    conv.connect(hp).connect(wet).connect(this.musicBus!);
    this.hall = conv;
  }
  /** Route a voice to the music bus, with some of it sent into the hall. */
  private out(node: AudioNode, send = 0.5) {
    node.connect(this.musicBus!);
    if (this.hall && send > 0) {
      const g = this.ctx!.createGain();
      g.gain.value = send;
      node.connect(g).connect(this.hall);
    }
  }

  private startGenerated() {
    if (!this.ctx || !this.musicBus || this.timer !== undefined) return;
    const ctx = this.ctx;
    if (!this.hall) this.buildHall();
    this.musicBus.gain.cancelScheduledValues(ctx.currentTime);
    this.musicBus.gain.setTargetAtTime(0.9, ctx.currentTime, 1.2);
    // A low organ-like pedal on the root and fifth, breathing slowly underneath everything.
    this.droneGain = ctx.createGain();
    this.droneGain.gain.value = 0.018;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 420;
    this.droneGain.connect(lp);
    this.out(lp, 0.6);
    for (const interval of [0, 7]) {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = midiToHz(this.root() - 24 + interval);
      o.connect(this.droneGain);
      o.start();
      this.drone.push(o);
    }
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.frequency.value = 0.05;
    lfoGain.gain.value = 0.015;
    lfo.connect(lfoGain).connect(this.droneGain.gain);
    lfo.start();
    this.drone.push(lfo);
    this.nextNoteTime = ctx.currentTime + 0.1;
    this.step = 0;
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
      this.step = (this.step + 1) % (16 * EPIC_BARS);
    }
  }

  private playStep(step: number, t: number, sixteenth: number) {
    const bar = Math.floor(step / 16);
    const beat = step % 16;
    const heroic = bar >= 8 || this.mood.tension; // the second half of the cycle
    const chord = (heroic ? CHORDS_B : CHORDS_A)[Math.floor((bar % 8) / 2)];
    const root = this.root();
    const night = this.night();
    const tense = this.mood.tension;
    const barLen = sixteenth * 16;

    // Strings: the chord swells in every two bars, across two octaves.
    if (beat === 0 && bar % 2 === 0) {
      const dur = barLen * 2;
      for (const n of chord) this.strings(midiToHz(root + n), t, dur, night ? 0.022 : 0.03);
      for (const n of chord.slice(1)) this.strings(midiToHz(root + 12 + n), t, dur, night ? 0.012 : heroic ? 0.02 : 0.014);
      this.strings(midiToHz(root - 12 + chord[0]), t, dur, 0.016, 600);
    }
    // Choir: an "aah" on the heroic half, and softly through the night.
    if (beat === 0 && bar % 2 === 0 && (heroic || night)) {
      for (const n of [chord[1], chord[2]]) this.choir(midiToHz(root + 12 + n), t + 0.05, barLen * 2, night ? 0.018 : 0.026);
    }
    // Cello ostinato: driving eighths (sixteenths when the town is on edge).
    if (!night && (tense ? true : beat % 2 === 0)) {
      const pattern = [0, 0, 12, 0, 7, 0, 12, 7];
      const idx = (tense ? beat : beat / 2) % pattern.length;
      const n = root - 12 + chord[0] + pattern[Math.floor(idx)];
      this.cello(midiToHz(n), t, sixteenth * (tense ? 0.9 : 1.7), heroic ? 0.05 : 0.038);
    }
    // War drums.
    if (!night || tense) {
      if (beat === 0) this.taiko(t, heroic ? 0.42 : 0.3, 58);
      if (beat === 10 && heroic) this.taiko(t, 0.22, 66);
      if (beat === 12) this.taiko(t, heroic ? 0.3 : 0.18, 62);
      if (tense && (beat === 4 || beat === 6 || beat === 14)) this.taiko(t, 0.16, 74);
      // A timpani roll into each half of the cycle.
      if ((bar === 7 || bar === 15) && beat >= 8) this.taiko(t, 0.05 + (beat - 8) * 0.025, 92);
    }
    // Horns: the heroic theme, two notes a bar (a distant call at night).
    if (heroic && (beat === 0 || beat === 8)) {
      const phrase = HORN_THEME[(bar % 8) * 2 + (beat === 8 ? 1 : 0)];
      if (phrase !== null && (!night || bar % 4 === 0)) {
        const hold = HORN_THEME[(bar % 8) * 2 + (beat === 8 ? 2 : 1)] === null ? 2 : 1;
        this.horn(midiToHz(root + 12 + phrase), t, sixteenth * 8 * hold, night ? 0.035 : 0.06);
        if (!night) this.horn(midiToHz(root + phrase), t, sixteenth * 8 * hold, 0.03); // doubled an octave down
      }
    }
    // Brass stabs when an event has the town on edge.
    if (tense && beat === 0) for (const n of chord) this.horn(midiToHz(root + n), t, sixteenth * 3, 0.03);
    // Harp: arpeggios at night, and gently in the brooding half by day.
    if ((night || !heroic) && beat % 2 === 0 && this.rand() < (night ? 0.7 : 0.35)) {
      const tones = [chord[0], chord[1], chord[2], chord[0] + 12, chord[2], chord[1] + 12];
      const n = tones[(beat / 2) % tones.length];
      this.pluck(midiToHz(root + 12 + n), t, night ? 0.05 : 0.035, 1.4, 2400, true);
    }
    // Summer days: a wooden flute answers the horns now and then.
    if (!night && !tense && this.mood.season === 'summer' && heroic && beat === 4 && this.rand() < 0.3) {
      this.flute(midiToHz(root + 24 + chord[2]), t, sixteenth * 6);
    }
  }

  /** Ensemble strings: detuned saws, slow bow-like swell and release. */
  private strings(freq: number, t: number, dur: number, gain: number, cutoff = 2200) {
    const ctx = this.ctx!;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = cutoff;
    f.Q.value = 0.5;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + Math.min(1.4, dur * 0.35));
    g.gain.setValueAtTime(gain, t + dur * 0.75);
    g.gain.linearRampToValueAtTime(0, t + dur + 0.6);
    f.connect(g);
    this.out(g, 0.7);
    for (const det of [-9, 0, 8]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = freq;
      o.detune.value = det;
      o.connect(f);
      o.start(t);
      o.stop(t + dur + 0.7);
    }
  }

  /** A short, bowed cello note for the ostinato. */
  private cello(freq: number, t: number, dur: number, gain: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = freq;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(1500, t);
    f.frequency.exponentialRampToValueAtTime(500, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.08);
    o.connect(f).connect(g);
    this.out(g, 0.35);
    o.start(t);
    o.stop(t + dur + 0.1);
  }

  /** French horn: a filtered brass tone that blooms open, with a little vibrato. */
  private horn(freq: number, t: number, dur: number, gain: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const o2 = ctx.createOscillator();
    o.type = 'sawtooth';
    o2.type = 'square';
    o.frequency.value = freq;
    o2.frequency.value = freq * 0.998;
    const vib = ctx.createOscillator();
    const vibG = ctx.createGain();
    vib.frequency.value = 4.6;
    vibG.gain.setValueAtTime(0, t);
    vibG.gain.linearRampToValueAtTime(freq * 0.004, t + dur * 0.6);
    vib.connect(vibG);
    vibG.connect(o.frequency);
    vibG.connect(o2.frequency);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.Q.value = 1.2;
    f.frequency.setValueAtTime(freq * 1.5, t);
    f.frequency.linearRampToValueAtTime(freq * 4.5, t + 0.25);
    f.frequency.linearRampToValueAtTime(freq * 3, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.12);
    g.gain.setValueAtTime(gain, t + dur * 0.8);
    g.gain.linearRampToValueAtTime(0, t + dur + 0.25);
    const g2 = ctx.createGain();
    g2.gain.value = 0.35;
    o.connect(f);
    o2.connect(g2).connect(f);
    f.connect(g);
    this.out(g, 0.8);
    for (const x of [o, o2, vib]) { x.start(t); x.stop(t + dur + 0.3); }
  }

  /** Choir "aah": a buzzy source shaped by two vowel formants. */
  private choir(freq: number, t: number, dur: number, gain: number) {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 1.2);
    g.gain.setValueAtTime(gain, t + dur * 0.7);
    g.gain.linearRampToValueAtTime(0, t + dur + 0.8);
    this.out(g, 1);
    const formants: Array<[number, number]> = [[750, 1], [1150, 0.55], [2600, 0.18]];
    const filters = formants.map(([fq, amp]) => {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = fq;
      bp.Q.value = 7;
      const a = ctx.createGain();
      a.gain.value = amp * 3;
      bp.connect(a).connect(g);
      return bp;
    });
    for (const det of [-12, 0, 11]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = freq;
      o.detune.value = det;
      const vib = ctx.createOscillator();
      const vg = ctx.createGain();
      vib.frequency.value = 4.8 + det * 0.03;
      vg.gain.value = freq * 0.005;
      vib.connect(vg).connect(o.frequency);
      for (const bp of filters) o.connect(bp);
      for (const x of [o, vib]) { x.start(t); x.stop(t + dur + 0.9); }
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
    f.connect(g);
    this.out(g, 0.6);
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
    g.gain.linearRampToValueAtTime(0.04, t + 0.08);
    g.gain.setValueAtTime(0.04, t + dur * 0.7);
    g.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(g);
    this.out(g, 0.8);
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

  /** A war drum: a deep pitched thump with a skin slap, ringing out in the hall. */
  private taiko(t: number, gain: number, freq: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(freq * 2.2, t);
    o.frequency.exponentialRampToValueAtTime(freq, t + 0.06);
    o.frequency.exponentialRampToValueAtTime(freq * 0.8, t + 0.6);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
    o.connect(g);
    this.out(g, 0.55);
    o.start(t);
    o.stop(t + 1);
    const n = this.noise(t, 0.12);
    const nf = ctx.createBiquadFilter();
    nf.type = 'lowpass';
    nf.frequency.value = 1400;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(gain * 0.5, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    n.connect(nf).connect(ng);
    this.out(ng, 0.5);
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
