import * as Phaser from 'phaser';
import type { FeedEntry, PublicSnapshot } from '@mon/engine';
import { BUILDINGS, DECOR, MAP, PLOTS, TILE_H, TILE_W, hash2, iso, tileKind, type BuildingDef } from './layout';
import { makeTileTextures, makeTreeTextures } from './textures';
import { SPECS, drawBuilding, houseSpec, type BuildingArt } from './art/buildings';
import { LOOKS, buildCharacter, citizenLook } from './art/characters';
import { RESOURCE_COLOR, makePropTextures } from './art/props';

export type Selection =
  | { type: 'merchant'; id: string }
  | { type: 'exchange' }
  | { type: 'plot'; plot: number; businessId?: string; ownerId?: string };

export interface TownCallbacks {
  onSelect: (s: Selection) => void;
  getPlayerId: () => string | null;
  getSettings: () => { weather: boolean; reducedMotion: boolean };
}

type Anim = 'idle' | 'walk' | 'run' | 'work' | 'carry' | 'cheer' | 'sad' | 'sleep';

interface Npc {
  sprite: Phaser.GameObjects.Sprite;
  key: string;
  path: Array<{ x: number; y: number }>;
  speed: number;
  home: { x: number; y: number };
  merchantId?: string;
  wait: number;
  anim: Anim;
  carrying: boolean;
  cheerUntil: number;
  workTimer: number;
  working: boolean;
  label?: Phaser.GameObjects.Text;
  zzz?: number;
}

interface PlacedBuilding {
  img: Phaser.GameObjects.Image;
  art: BuildingArt;
  def: { gx: number; gy: number; w: number; d: number };
  extras: Phaser.GameObjects.GameObject[];
}

const SEASON_GRASS: Record<string, number> = { spring: 0xffffff, summer: 0xf4f0c4, autumn: 0xe9cf98, winter: 0xffffff };
const SEASON_OAK: Record<string, number> = { spring: 0x86c45c, summer: 0x5d9c42, autumn: 0xd98a32, winter: 0xe9eef4 };
const SEASON_LEAF: Record<string, number[] | null> = { spring: [0xf6c6d8, 0xffffff, 0xf3a6c0], summer: null, autumn: [0xd98a32, 0xb5452e, 0xe9b44a, 0x9a5a2a], winter: null };
/** Merchant workplaces: where they stand to work, relative to their building. */
const WORK_SPOT: Record<string, [number, number]> = {
  farmer: [21.2, 3.2], baker: [13.3, 12.6], baker2: [19.4, 18.3], blacksmith: [18.3, 10.6], trader: [24.4, 14.6], banker: [12.4, 19.6],
  miner: [7.4, 5.8], fisher: [3.6, 22.6], weaver: [12.6, 24.4], woodcutter: [25.4, 22.4],
};
const ZOOM_MIN = 0.45, ZOOM_MAX = 2.4;

export class TownScene extends Phaser.Scene {
  private cb!: TownCallbacks;
  private snap: PublicSnapshot | null = null;
  private snapAt = 0;
  private season = '';
  private ground!: Phaser.GameObjects.RenderTexture;
  private groundOrigin = { x: 0, y: 0 };
  private water: Phaser.GameObjects.Image[] = [];
  private trees: Array<{ img: Phaser.GameObjects.Image; seed: number; oak: boolean }> = [];
  private glows: Array<{ img: Phaser.GameObjects.Image; seed: number; base: number }> = [];
  private smoke: Phaser.GameObjects.Particles.ParticleEmitter[] = [];
  private buildings = new Map<string, PlacedBuilding>();
  private closedSigns = new Map<string, Phaser.GameObjects.Text>();
  private npcs = new Map<string, Npc>();
  private citizens: Npc[] = [];
  private caravan!: Phaser.GameObjects.Image;
  private plotLayer: Phaser.GameObjects.GameObject[] = [];
  private plotKey = '';
  private bizLevels = new Map<string, number>();
  private gradeOverlay!: Phaser.GameObjects.Rectangle;
  private nightOverlay!: Phaser.GameObjects.Rectangle;
  private rain!: Phaser.GameObjects.Particles.ParticleEmitter;
  private splash!: Phaser.GameObjects.Particles.ParticleEmitter;
  private snow!: Phaser.GameObjects.Particles.ParticleEmitter;
  private leaves!: Phaser.GameObjects.Particles.ParticleEmitter;
  private motes!: Phaser.GameObjects.Particles.ParticleEmitter;
  private sparks?: Phaser.GameObjects.Particles.ParticleEmitter;
  private anvilSparks?: Phaser.GameObjects.Particles.ParticleEmitter;
  private dust!: Phaser.GameObjects.Particles.ParticleEmitter;
  private fountainSpray!: Phaser.GameObjects.Particles.ParticleEmitter;
  private clouds: Phaser.GameObjects.Image[] = [];
  private fog: Phaser.GameObjects.Image[] = [];
  private birds: Array<{ img: Phaser.GameObjects.Image; vx: number; vy: number; t: number }> = [];
  private wealth: Phaser.GameObjects.GameObject[] = [];
  private wealthKey = '';
  private hoverLabel!: Phaser.GameObjects.Text;
  private dragDist = 0;
  private dragVel = { x: 0, y: 0 };
  private dragging = false;
  private zoomTarget = 1;
  private zoomAnchor: { sx: number; sy: number } | null = null;
  private cinematic = false;
  /** Director overrides for trailers and screenshots (cinema mode only). */
  private director: { hour: number | null; weather: string | null; season: string | null; scripted: boolean; labels: boolean } = { hour: null, weather: null, season: null, scripted: false, labels: true };
  private cineT = 0;
  private lastMerchantTrade = new Map<string, number>();
  private prevPrices: Record<string, number> = {};
  private seenFeed = 0;
  private nextPriceFx = 0;
  private labelSlot = new Map<string, number>();
  private lowQuality = false;
  private fpsAcc = { t: 0, n: 0, slow: 0 };
  private firstSnap = true;
  private waterFrame = 0;
  private keys?: Record<string, Phaser.Input.Keyboard.Key>;

  constructor() {
    super('town');
  }

  init(data: { callbacks: TownCallbacks; cinematic?: boolean }) {
    this.cb = data.callbacks;
    this.cinematic = !!data.cinematic;
  }

  /** Slow autonomous camera tour (used behind the title screen). */
  setCinematic(on: boolean) {
    this.cinematic = on;
  }

  /**
   * Cinema mode (`?cinema=1`): lets a capture script direct the town with the
   * game's own renderer — script the camera, pick the hour, weather and season.
   * It never touches the simulation; it only changes what this client draws.
   */
  direct(opts: Partial<{ hour: number | null; weather: string | null; season: string | null; scripted: boolean; labels: boolean }>) {
    Object.assign(this.director, opts);
    if (opts.season !== undefined) this.season = '';
    if (this.snap) this.applySnapshot(this.snap);
  }

  private get motionOk() {
    const s = this.cb.getSettings();
    return !s.reducedMotion;
  }

  create() {
    makeTileTextures(this);
    makeTreeTextures(this);
    makePropTextures(this);
    this.makeSnowTile();
    this.buildGround();
    this.buildBuildings();
    this.buildDecorations();
    this.buildMarketSquare();
    this.buildProps();
    this.buildNpcs();
    this.buildAtmosphere();
    this.setupCamera();

    this.hoverLabel = this.add
      .text(0, 0, '', { fontFamily: 'Cinzel, serif', fontSize: '13px', color: '#f6e7c1', backgroundColor: 'rgba(26,18,11,0.92)', padding: { x: 9, y: 5 } })
      .setOrigin(0.5, 1)
      .setDepth(100000)
      .setVisible(false);

    this.time.addEvent({ delay: 650, loop: true, callback: () => this.shimmerWater() });
    this.time.addEvent({ delay: 420, loop: true, callback: () => this.twinkleWater() });
    if (this.snap) this.applySnapshot(this.snap);
  }

  // -------------------------------------------------------------- ground ---
  private makeSnowTile() {
    const g = this.add.graphics();
    g.fillStyle(0xeef3f8, 1);
    g.fillPoints([{ x: 32, y: 0 }, { x: 64, y: 16 }, { x: 32, y: 32 }, { x: 0, y: 16 }], true);
    for (let i = 0; i < 40; i++) {
      const u = Math.random(), v = Math.random();
      g.fillStyle(i % 3 ? 0xd5e0ea : 0xffffff, 0.8);
      g.fillRect((u - v) * 32 + 32, (u + v) * 16, 2, 1);
    }
    g.generateTexture('snowgrass', TILE_W, TILE_H);
    g.destroy();
  }

  /** Static ground is baked into one render texture (one draw call instead of ~1,400). */
  private buildGround() {
    const R = 5;
    const left = iso(-R, MAP + R).x - TILE_W / 2, right = iso(MAP + R, -R).x + TILE_W / 2;
    const top = iso(-R, -R).y, bottom = iso(MAP + R, MAP + R).y + TILE_H;
    this.groundOrigin = { x: left, y: top };
    this.ground = this.add.renderTexture(left, top, right - left, bottom - top).setOrigin(0, 0).setDepth(-10000);
    for (let gx = -R; gx < MAP + R; gx++) {
      for (let gy = -R; gy < MAP + R; gy++) {
        const inMap = gx >= 0 && gy >= 0 && gx < MAP && gy < MAP;
        const kind = inMap ? tileKind(gx, gy) : gx < 3 ? 'water' : 'grass';
        if (kind === 'water') {
          const { x, y } = iso(gx, gy);
          this.water.push(this.add.image(x, y, 'water2-0').setOrigin(0.5, 0).setDepth(-9999));
        }
      }
    }
    this.paintGround('spring');
  }

  private paintGround(season: string) {
    const R = 5;
    this.ground.clear();
    const stamp = (key: string, gx: number, gy: number, tint = 0xffffff, alpha = 1) => {
      const { x, y } = iso(gx, gy);
      const img = this.make.image({ x: 0, y: 0, key, add: false }).setOrigin(0.5, 0).setTint(tint).setAlpha(alpha);
      this.ground.draw(img, x - this.groundOrigin.x, y - this.groundOrigin.y);
      img.destroy();
    };
    for (let gx = -R; gx < MAP + R; gx++) {
      for (let gy = -R; gy < MAP + R; gy++) {
        const inMap = gx >= 0 && gy >= 0 && gx < MAP && gy < MAP;
        const kind = inMap ? tileKind(gx, gy) : gx < 3 ? 'water' : 'grass';
        if (kind === 'water') continue;
        const h = hash2(gx, gy);
        // Atmospheric perspective: the land outside town fades into haze.
        const edge = inMap ? 0 : Math.min(1, Math.max(-gx, -gy, gx - MAP + 1, gy - MAP + 1) / R);
        const haze = Phaser.Display.Color.Interpolate.ColorWithColor(Phaser.Display.Color.ValueToColor(0xffffff), Phaser.Display.Color.ValueToColor(0x9fb0b8), 100, Math.round(edge * 70));
        const hazeTint = Phaser.Display.Color.GetColor(haze.r, haze.g, haze.b);
        if (kind === 'grass') {
          if (season === 'winter') stamp('snowgrass', gx, gy, hazeTint);
          else stamp(`grass${Math.floor(h * 3)}`, gx, gy, inMap ? SEASON_GRASS[season] : hazeTint);
        } else if (kind === 'plaza') stamp(`cobble${Math.floor(h * 3)}`, gx, gy, season === 'winter' ? 0xe8eef4 : 0xffffff);
        else if (kind === 'road') stamp('road2', gx, gy, season === 'winter' ? 0xdfe6ee : 0xffffff);
        else if (kind === 'field') stamp(`field-${season}`, gx, gy);
        else stamp(kind, gx, gy);
      }
    }
    // Soft ambient occlusion under buildings so they sit in the ground.
    const ao = (gx: number, gy: number, w: number, d: number) => {
      const c = iso(gx + w / 2, gy + d / 2);
      const img = this.make.image({ x: 0, y: 0, key: 'softblob', add: false }).setTint(0x000000).setAlpha(0.55).setScale((w + d) * 0.62, (w + d) * 0.62);
      this.ground.draw(img, c.x - this.groundOrigin.x, c.y - this.groundOrigin.y + 6);
      img.destroy();
    };
    for (const b of BUILDINGS) ao(b.gx, b.gy, b.w, b.d);
    for (const d of DECOR) ao(d.gx, d.gy, d.w, d.d);
  }

  private occupied(gx: number, gy: number) {
    if (tileKind(gx, gy) !== 'grass') return true;
    for (const b of [...BUILDINGS, ...DECOR]) if (gx >= b.gx - 1 && gx <= b.gx + b.w && gy >= b.gy - 1 && gy <= b.gy + b.d) return true;
    for (const p of PLOTS) if (gx >= p.gx - 1 && gx <= p.gx + 2 && gy >= p.gy - 1 && gy <= p.gy + 2) return true;
    for (const [sx, sy] of Object.values(WORK_SPOT)) if (Math.abs(gx + 0.5 - sx) < 1.2 && Math.abs(gy + 0.5 - sy) < 1.2) return true;
    return false;
  }

  private buildDecorations() {
    for (let gx = -4; gx < MAP + 4; gx++) {
      for (let gy = -4; gy < MAP + 4; gy++) {
        const inMap = gx >= 0 && gy >= 0 && gx < MAP && gy < MAP;
        if (inMap && this.occupied(gx, gy)) continue;
        if (!inMap && gx < 3) continue;
        const h = hash2(gx * 7 + 3, gy * 13 + 1);
        const forest = (gx > 21 && gy > 19) || gx > 27 || gy > 27 || gy < 1 || !inMap;
        const chance = forest ? 0.55 : 0.07;
        if (h > chance) {
          if (h > 0.96 && inMap) this.addProp(gx + 0.5, gy + 0.5, h > 0.985 ? 'rock' : 'bush');
          continue;
        }
        const { x, y } = iso(gx + 0.5, gy + 0.5);
        const jitterX = (hash2(gx, gy * 3) - 0.5) * 18;
        const scale = 0.85 + hash2(gy * 5, gx) * 0.35;
        const haze = inMap ? 0xffffff : 0xc4ced2;
        if (hash2(gy, gx) > 0.5) {
          const t = this.add.image(x + jitterX, y + 4, 'pine').setOrigin(0.5, 0.94).setDepth(y + 4).setScale(scale).setTint(haze);
          this.trees.push({ img: t, seed: h * 40, oak: false });
        } else {
          this.add.image(x + jitterX, y + 4, 'oak-trunk').setOrigin(0.5, 0.94).setDepth(y + 4).setScale(scale).setTint(haze);
          const c = this.add.image(x + jitterX, y + 4, 'oak-canopy').setOrigin(0.5, 0.94).setDepth(y + 4.1).setScale(scale).setTint(SEASON_OAK.spring);
          this.trees.push({ img: c, seed: h * 40, oak: true });
        }
      }
    }
    for (const [gx, gy] of [[4, 2], [7, 2], [8, 4], [4, 6], [6, 7]]) this.addProp(gx + 0.5, gy + 0.5, 'rock');
  }

  private addProp(gx: number, gy: number, key: string, opts: { flip?: boolean; scale?: number; originY?: number; tint?: number } = {}) {
    const { x, y } = iso(gx, gy);
    const img = this.add.image(x, y, key).setOrigin(0.5, opts.originY ?? 0.85).setDepth(y);
    if (opts.flip) img.setFlipX(true);
    if (opts.scale) img.setScale(opts.scale);
    if (opts.tint) img.setTint(opts.tint);
    return img;
  }

  // ----------------------------------------------------------- buildings ---
  private placeBuilding(def: { gx: number; gy: number; w: number; d: number }, art: BuildingArt) {
    const n = iso(def.gx, def.gy);
    const img = this.add.image(n.x - art.originX, n.y - art.originY, art.key).setOrigin(0, 0);
    const south = iso(def.gx + def.w, def.gy + def.d);
    img.setDepth(south.y - 2);
    return img;
  }

  private addLights(art: BuildingArt, img: Phaser.GameObjects.Image, extras: Phaser.GameObjects.GameObject[] = []) {
    for (const w of art.windows) {
      const g = this.add.image(img.x + w.x, img.y + w.y, 'glow').setBlendMode(Phaser.BlendModes.ADD).setDepth(90002).setAlpha(0).setScale(0.5).setTint(0xffc070);
      this.glows.push({ img: g, seed: Math.random() * 10, base: 0.85 });
      extras.push(g);
    }
    for (const c of art.chimneys) {
      const em = this.add.particles(img.x + c.x, img.y + c.y, 'puff2', {
        speedY: { min: -24, max: -14 },
        speedX: { min: 3, max: 11 },
        scale: { start: 0.3, end: 1.5 },
        alpha: { start: 0.4, end: 0 },
        tint: [0xd8d2c8, 0xc4bdb2, 0xe8e2d8],
        lifespan: 3000,
        frequency: 320,
        rotate: { min: 0, max: 360 },
      });
      em.setDepth(img.depth + 2);
      this.smoke.push(em);
      extras.push(em);
    }
  }

  private buildBuildings() {
    for (const b of BUILDINGS) {
      const spec = SPECS[b.id];
      const art = drawBuilding(this, `b-${b.id}`, spec);
      const img = this.placeBuilding(b, art);
      const placed: PlacedBuilding = { img, art, def: b, extras: [] };
      this.addLights(art, img, placed.extras);
      if (art.forge) {
        const fx = img.x + art.forge.x, fy = img.y + art.forge.y;
        const glow = this.add.image(fx, fy, 'glow').setBlendMode(Phaser.BlendModes.ADD).setDepth(img.depth + 1).setTint(0xff7a2a).setScale(0.9);
        this.glows.push({ img: glow, seed: 3, base: -1 });
        this.sparks = this.add.particles(fx, fy, 'spark', {
          speed: { min: 30, max: 90 }, angle: { min: 230, max: 310 }, gravityY: 160, lifespan: { min: 400, max: 900 },
          scale: { start: 0.9, end: 0 }, alpha: { start: 1, end: 0 }, frequency: 260, quantity: 2, blendMode: 'ADD', tint: [0xffd27a, 0xff9a3a, 0xffffff],
        }).setDepth(img.depth + 3);
      }
      this.makeInteractive(img, b.label, () => this.cb.onSelect(b.merchant ? { type: 'merchant', id: b.merchant } : { type: 'exchange' }));
      this.buildings.set(b.id, placed);
    }
    // Tavern and town houses.
    DECOR.forEach((d, i) => {
      const spec = d.id === 'tavern' ? SPECS.tavern : houseSpec(i);
      const art = drawBuilding(this, `d-${d.id}`, spec);
      const img = this.placeBuilding(d, art);
      this.addLights(art, img);
      img.setInteractive({ pixelPerfect: true, alphaTolerance: 40 });
      img.on('pointerover', () => this.hoverLabel.setText(d.label).setVisible(true));
      img.on('pointerout', () => this.hoverLabel.setVisible(false));
    });
    // Pre-render player building styles at each level.
    for (const kind of ['farm', 'bakery', 'blacksmith', 'textile', 'warehouse', 'trading']) {
      for (let lv = 1; lv <= 3; lv++) {
        const base = SPECS[`p-${kind}`];
        if (this.textures.exists(`pb-${kind}-${lv}`)) this.textures.remove(`pb-${kind}-${lv}`);
        metaCache.set(`pb-${kind}-${lv}`, drawBuilding(this, `pb-${kind}-${lv}`, { ...base, h: base.h + (lv - 1) * 6, windows: base.windows + (lv - 1), chimney: lv === 3 && !base.chimney ? 'left' : base.chimney }));
      }
    }
  }

  /** True when the press and release both happened on the town itself, not on a UI panel drawn over it. */
  private onCanvas(p: Phaser.Input.Pointer) {
    const c = this.sys.game.canvas;
    return p.downElement === c && (p.upElement === c || p.upElement == null);
  }

  private makeInteractive(obj: Phaser.GameObjects.Image, label: string | (() => string), onClick: () => void) {
    obj.setInteractive({ pixelPerfect: true, alphaTolerance: 40, useHandCursor: true });
    obj.on('pointerover', () => {
      obj.setTint(0xfff1cf);
      this.hoverLabel.setText(typeof label === 'string' ? label : label()).setVisible(true);
    });
    obj.on('pointerout', () => {
      obj.clearTint();
      this.hoverLabel.setVisible(false);
      this.refreshClosedTints();
    });
    obj.on('pointerup', (p: Phaser.Input.Pointer) => {
      if (this.dragDist < 8 && this.onCanvas(p)) onClick();
    });
  }

  private buildMarketSquare() {
    // Stalls ring the Exchange; the fountain anchors the north-east corner.
    const stalls: Array<[number, number, number]> = [[13.2, 13.4, 0], [13.1, 15.0, 1], [13.2, 16.8, 2], [16.4, 17.6, 3], [14.6, 17.7, 4], [17.7, 15.9, 5]];
    for (const [gx, gy, c] of stalls) this.addProp(gx, gy, `stall${c}`, { originY: 0.9 });
    const f = iso(17.5, 13.5);
    this.add.image(f.x, f.y + 10, 'fountain').setOrigin(0.5, 0.8).setDepth(f.y + 10);
    this.fountainSpray = this.add.particles(f.x, f.y - 22, 'px', {
      speedY: { min: -60, max: -40 }, speedX: { min: -22, max: 22 }, gravityY: 180, lifespan: 700, frequency: 30, quantity: 2,
      alpha: { start: 0.9, end: 0 }, tint: [0xbfe6ff, 0xffffff], scale: { start: 1.2, end: 0.6 },
    }).setDepth(f.y + 11);
    // Lamps along roads.
    const lamps: Array<[number, number]> = [[12.6, 12.6], [18.4, 12.6], [12.6, 18.4], [18.4, 18.4], [16.2, 9], [9.6, 16.2], [21, 16.2], [16.2, 21.6], [22, 8.6], [9.6, 21.6], [14.4, 7.6], [9.6, 11], [24, 15.6], [6.6, 15.6], [16.2, 26]];
    for (const [gx, gy] of lamps) {
      const { x, y } = iso(gx, gy);
      this.add.image(x, y, 'lamp2').setOrigin(0.5, 0.97).setDepth(y);
      const g = this.add.image(x, y - 34, 'glow').setBlendMode(Phaser.BlendModes.ADD).setDepth(90002).setAlpha(0).setScale(0.8).setTint(0xffc070);
      this.glows.push({ img: g, seed: Math.random() * 10, base: 1 });
      const pool = this.add.image(x, y + 2, 'softblob').setBlendMode(Phaser.BlendModes.ADD).setDepth(90002).setAlpha(0).setScale(1.3).setTint(0xffa040);
      this.glows.push({ img: pool, seed: Math.random() * 10, base: 0.5 });
    }
    // Banners around the Exchange in NEAR green and guild gold.
    for (const [gx, gy, tint] of [[13.6, 17.9, 0x00c27c], [17.9, 13.6, 0xd9a84a], [13.6, 13.6, 0xb5452e], [17.9, 17.9, 0x2f5e8e]] as Array<[number, number, number]>) {
      this.addProp(gx, gy, 'banner', { originY: 1, tint });
    }
  }

  /** Building-specific set dressing. */
  private buildProps() {
    const P = (k: string, gx: number, gy: number, o: { flip?: boolean; scale?: number; originY?: number } = {}) => this.addProp(gx, gy, k, o);
    // Farm: haystacks, scarecrow, fences, cart, well.
    P('haystack', 24.6, 6.4); P('haystack', 25.6, 7.3, { scale: 0.85 }); P('haystack', 26.8, 5.8, { scale: 0.9 });
    P('scarecrow', 23.5, 2.5, { originY: 0.95 });
    for (let i = 0; i < 7; i++) P('fence-a', 20 + i + 0.5, 0.9, { originY: 0.7 });
    for (let i = 0; i < 7; i++) P('fence-b', 19.9, 1 + i * 0.95 + 0.5, { originY: 0.7 });
    P('cart', 21.6, 7.6); P('sack', 23.9, 7.4); P('sack', 24.2, 7.8, { scale: 0.85 });
    P('well', 20.4, 6.0, { originY: 0.88 });
    // Bakery: bread table, flour sacks, barrels.
    P('breadtable', 12.9, 13.0); P('sack', 11.0, 12.4); P('sack', 10.8, 12.0, { scale: 0.8 }); P('barrel', 13.4, 10.6);
    P('breadtable', 20.0, 18.4); P('sack', 21.4, 18.6);
    // Smithy: anvil, weapon rack, barrels of quench water, coal sacks.
    P('anvil', 18.4, 10.0); P('weaponrack', 18.5, 12.3, { originY: 0.9 }); P('barrel', 21.4, 12.2); P('sack', 21.2, 12.6, { scale: 0.8 });
    // Trading post / warehouses: crate stacks, barrels, cart for loading.
    for (const [gx, gy] of [[24.2, 13.2], [24.4, 13.6], [27.3, 13.6], [27.3, 14.2]]) P('crate', gx, gy);
    const up = this.addProp(24.3, 13.4, 'crate'); up.y -= 11; up.setDepth(up.depth + 1);
    P('barrel', 27.4, 15.1); P('barrel', 27.7, 14.8); P('cart', 26.3, 15.4, { flip: true });
    // Bank: lanterns and banners by the vault.
    P('banner', 12.3, 18.2, { originY: 1 });
    // Mine: ore cart and rails, rocks.
    P('orecart', 7.6, 6.3); P('crate', 8.4, 5.4);
    // Docks: boats, nets, barrels of fish.
    P('boat', 2.4, 22.2, { originY: 0.5 }); P('boat', 1.6, 19.6, { originY: 0.5, flip: true, scale: 0.9 }); P('net', 6.6, 23.6, { originY: 0.9 }); P('barrel', 6.4, 21.4); P('crate', 6.8, 21.8);
    // Loom: drying line of dyed cloth.
    P('clothline', 12.8, 25.6, { originY: 0.95 }); P('sack', 12.3, 24.0);
    // Lumberyard: log piles and sawhorse cart.
    P('logs', 25.5, 23.4); P('logs', 25.8, 24.6, { scale: 0.9 }); P('logs', 23.1, 25.6); P('cart', 22.0, 24.2);
    // Tavern: barrels and benches by the door.
    P('barrel', 13.4, 16.4); P('barrel', 13.2, 17.4, { scale: 0.9 }); P('lantern', 12.9, 17.8, { originY: 1 });
    // Bridge across the river on the western road.
    for (let gx = 0; gx <= 3; gx++) {
      const { x, y } = iso(gx, 15);
      this.add.image(x, y, 'bridge').setOrigin(0.5, 0.15).setDepth(y + 8);
    }
  }

  // ---------------------------------------------------------------- NPCs ---
  private buildNpcs() {
    for (const [role, look] of Object.entries(LOOKS)) buildCharacter(this, `npc-${role}`, look);
    for (let i = 0; i < 12; i++) buildCharacter(this, `citizen-${i}`, citizenLook(i));

    for (const b of BUILDINGS) {
      if (!b.merchant) continue;
      const key = `npc-${b.merchant in LOOKS ? b.merchant : 'trader'}`;
      const spot = WORK_SPOT[b.merchant] ?? [b.door.gx + 0.5, b.door.gy + 0.5];
      const home = iso(spot[0], spot[1]);
      const sprite = this.add.sprite(home.x, home.y, key, 'idle0').setOrigin(0.5, 37 / 40).setDepth(home.y);
      sprite.setInteractive({ useHandCursor: true });
      sprite.on('pointerup', (p: Phaser.Input.Pointer) => this.dragDist < 8 && this.onCanvas(p) && this.cb.onSelect({ type: 'merchant', id: b.merchant! }));
      sprite.on('pointerover', () => sprite.setTint(0xfff1cf));
      sprite.on('pointerout', () => sprite.clearTint());
      if (b.merchant === 'blacksmith') {
        sprite.on('animationupdate', (_a: unknown, frame: Phaser.Animations.AnimationFrame) => {
          if (frame.textureFrame === 'work1' && this.anvilSparks && this.motionOk) this.anvilSparks.explode(7);
        });
      }
      const label = this.add
        .text(home.x, home.y - 40, '', { fontFamily: 'Cinzel, serif', fontSize: '10px', color: '#f6e7c1', backgroundColor: 'rgba(26,18,11,0.78)', padding: { x: 5, y: 2 } })
        .setOrigin(0.5, 1).setDepth(99000).setAlpha(0.92);
      const npc: Npc = { sprite, key, path: [], speed: 40, home, merchantId: b.merchant, wait: 0, anim: 'idle', carrying: false, cheerUntil: 0, workTimer: Math.random() * 4, working: false, label };
      this.npcs.set(b.merchant, npc);
      this.play(npc, 'idle');
    }
    const anvil = iso(18.4, 10.0);
    this.anvilSparks = this.add.particles(anvil.x + 2, anvil.y - 12, 'spark', {
      speed: { min: 40, max: 110 }, angle: { min: 200, max: 340 }, gravityY: 240, lifespan: { min: 250, max: 600 },
      scale: { start: 0.8, end: 0 }, blendMode: 'ADD', tint: [0xffe9a0, 0xffa040], emitting: false,
    }).setDepth(anvil.y + 5);
    this.caravan = this.add.image(0, 0, 'caravan').setOrigin(0.5, 0.85).setVisible(false);
  }

  private play(npc: Npc, anim: Anim) {
    if (npc.anim === anim && npc.sprite.anims.isPlaying) return;
    npc.anim = anim;
    const key = `${npc.key}:${anim}`;
    const frames = this.anims.get(key)?.frames.length ?? 1;
    npc.sprite.play({ key, startFrame: Math.floor(Math.random() * Math.min(2, frames)) });
  }

  private roadPoint(): { x: number; y: number } {
    const r = Math.random();
    if (r < 0.3) return iso(15.5, 4 + Math.random() * 24);
    if (r < 0.6) return iso(4 + Math.random() * 24, 15.5);
    if (r < 0.8) return iso(12.8 + Math.random() * 5.4, 12.8 + Math.random() * 5.4);
    if (r < 0.9) return iso(9.5, 9 + Math.random() * 16);
    return iso(7 + Math.random() * 19, 21.5);
  }

  private syncCitizens(population: number) {
    const target = Math.max(10, Math.min(44, Math.round(population / 12)));
    while (this.citizens.length < target) {
      const p = this.roadPoint();
      const key = `citizen-${this.citizens.length % 12}`;
      const sprite = this.add.sprite(p.x, p.y, key, 'idle0').setOrigin(0.5, 37 / 40).setScale(0.88);
      const c: Npc = { sprite, key, path: [this.roadPoint()], speed: 16 + Math.random() * 14, home: p, wait: Math.random() * 3, anim: 'idle', carrying: Math.random() < 0.3, cheerUntil: 0, workTimer: 0, working: false };
      this.citizens.push(c);
      this.play(c, 'idle');
    }
    while (this.citizens.length > target) this.citizens.pop()!.sprite.destroy();
  }

  /** Route from a merchant's workplace to the market square along the main roads. */
  private routeToMarket(b: BuildingDef) {
    const d = b.door;
    const pts: Array<[number, number]> = [[d.gx + 0.5, d.gy + 0.5]];
    if (Math.abs(d.gx - 15) < Math.abs(d.gy - 15)) pts.push([15.5, d.gy + 0.5], [15.5, d.gy < 15 ? 12.8 : 18.2]);
    else pts.push([d.gx + 0.5, 15.5], [d.gx < 15 ? 12.8 : 18.2, 15.5]);
    return pts.map(([x, y]) => iso(x, y));
  }

  // --------------------------------------------------------- atmosphere ---
  private buildAtmosphere() {
    const big = 8000;
    const c = iso(MAP / 2, MAP / 2);
    this.gradeOverlay = this.add.rectangle(c.x, c.y, big, big, 0xff8a3d, 0).setDepth(90000).setBlendMode(Phaser.BlendModes.MULTIPLY);
    this.nightOverlay = this.add.rectangle(c.x, c.y, big, big, 0x0c1633, 0).setDepth(90001);
    this.rain = this.add.particles(0, 0, 'raindrop', {
      x: { min: -900, max: 900 }, y: -460, speedY: { min: 560, max: 720 }, speedX: { min: -150, max: -110 },
      lifespan: 1300, quantity: 6, frequency: 18, alpha: { start: 0.65, end: 0.25 }, emitting: false,
    }).setDepth(90010);
    this.splash = this.add.particles(0, 0, 'px', {
      x: { min: -700, max: 700 }, y: { min: -350, max: 350 }, speed: { min: 10, max: 30 }, angle: { min: 200, max: 340 },
      lifespan: 300, quantity: 3, frequency: 30, alpha: { start: 0.7, end: 0 }, tint: 0xcfe6ff, emitting: false,
    }).setDepth(89990);
    this.snow = this.add.particles(0, 0, 'snowflake', {
      x: { min: -900, max: 900 }, y: -460, speedY: { min: 40, max: 80 }, speedX: { min: -30, max: 30 },
      lifespan: 9000, quantity: 2, frequency: 45, scale: { min: 0.5, max: 1.2 }, alpha: { start: 0.95, end: 0.6 }, emitting: false,
    }).setDepth(90010);
    this.leaves = this.add.particles(0, 0, 'leaf', {
      x: { min: -900, max: 900 }, y: -460, speedY: { min: 30, max: 60 }, speedX: { min: 20, max: 60 }, rotate: { start: 0, end: 720 },
      lifespan: 12000, frequency: 260, scale: { min: 0.6, max: 1.1 }, alpha: { start: 0.95, end: 0.7 }, emitting: false,
    }).setDepth(90005);
    this.motes = this.add.particles(0, 0, 'px', {
      x: { min: -800, max: 800 }, y: { min: -400, max: 400 }, speed: { min: 2, max: 8 }, lifespan: 6000, frequency: 160,
      alpha: { start: 0, end: 0.55, ease: 'Sine.easeInOut' }, scale: { min: 0.6, max: 1.2 }, blendMode: 'ADD', tint: 0xfff2c0, emitting: false,
    }).setDepth(90003);
    this.dust = this.add.particles(0, 0, 'puff2', {
      speed: { min: 12, max: 40 }, angle: { min: 180, max: 360 }, lifespan: 1400, scale: { start: 0.4, end: 1.8 },
      alpha: { start: 0.55, end: 0 }, tint: [0xc8b28a, 0xb09870], emitting: false,
    }).setDepth(99700);
    for (const e of [this.rain, this.snow, this.leaves, this.motes, this.splash]) e.stop();
    for (let i = 0; i < 6; i++) {
      const p = iso(Math.random() * MAP, Math.random() * MAP);
      this.clouds.push(this.add.image(p.x, p.y, 'cloudshadow').setDepth(89999).setScale(2 + Math.random() * 2).setAlpha(0));
    }
    for (let i = 0; i < 9; i++) {
      const p = iso(Math.random() * MAP, Math.random() * MAP);
      this.fog.push(this.add.image(p.x, p.y, 'softblob').setDepth(89998).setScale(7 + Math.random() * 5, 4 + Math.random() * 3).setAlpha(0).setTint(0xdfe6ea));
    }
    for (let i = 0; i < 5; i++) {
      const p = iso(Math.random() * MAP, Math.random() * MAP);
      this.birds.push({ img: this.add.image(p.x, p.y - 200, 'bird0').setDepth(90020).setScale(0.9 + Math.random() * 0.4), vx: 50 + Math.random() * 30, vy: -8 + Math.random() * 16, t: Math.random() * 10 });
    }
  }

  private setupCamera() {
    const cam = this.cameras.main;
    const minP = iso(0, MAP), maxP = iso(MAP, 0), bottom = iso(MAP, MAP);
    cam.setBounds(minP.x - 300, -460, maxP.x - minP.x + 600, bottom.y + 760);
    const center = iso(15.5, 15.5);
    cam.centerOn(center.x, center.y);
    const z = this.scale.width < 700 ? 0.72 : 1.05;
    cam.setZoom(z);
    this.zoomTarget = z;
    cam.setBackgroundColor('#141d10');

    this.input.on('pointerdown', () => {
      this.dragDist = 0;
      this.dragging = true;
      this.dragVel = { x: 0, y: 0 };
    });
    this.input.on('pointerup', () => (this.dragging = false));
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (this.hoverLabel.visible) this.hoverLabel.setPosition(p.worldX, p.worldY - 14);
      if (!p.isDown) return;
      // Pinch zoom on touch devices.
      const p1 = this.input.pointer1, p2 = this.input.pointer2;
      if (p1?.isDown && p2?.isDown) {
        const d = Phaser.Math.Distance.Between(p1.x, p1.y, p2.x, p2.y);
        const pd = Phaser.Math.Distance.Between(p1.prevPosition.x, p1.prevPosition.y, p2.prevPosition.x, p2.prevPosition.y);
        if (pd > 0) this.setZoomTarget(this.zoomTarget * (d / pd), (p1.x + p2.x) / 2, (p1.y + p2.y) / 2);
        this.dragDist += 20;
        return;
      }
      const dx = p.x - p.prevPosition.x, dy = p.y - p.prevPosition.y;
      this.dragDist += Math.abs(dx) + Math.abs(dy);
      cam.scrollX -= dx / cam.zoom;
      cam.scrollY -= dy / cam.zoom;
      this.dragVel = { x: dx / cam.zoom, y: dy / cam.zoom };
    });
    this.input.on('wheel', (p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
      this.setZoomTarget(this.zoomTarget * (dy > 0 ? 0.88 : 1.13), p.x, p.y);
    });
    if (this.input.keyboard) {
      // enableCapture=false: never swallow keystrokes meant for the page's text fields.
      this.keys = this.input.keyboard.addKeys('W,A,S,D,UP,DOWN,LEFT,RIGHT,Q,E', false) as Record<string, Phaser.Input.Keyboard.Key>;
    }
  }

  /** Smooth zoom that keeps the point under the cursor fixed. */
  private setZoomTarget(z: number, sx?: number, sy?: number) {
    this.zoomTarget = Phaser.Math.Clamp(z, ZOOM_MIN, ZOOM_MAX);
    this.zoomAnchor = sx === undefined || sy === undefined ? null : { sx, sy };
  }

  zoomBy(f: number) {
    this.setZoomTarget(this.zoomTarget * f);
  }

  focusOn(target: Selection) {
    let p = iso(15.5, 15.5);
    if (target.type === 'merchant') {
      const b = BUILDINGS.find((x) => x.merchant === target.id);
      if (b) p = iso(b.gx + b.w / 2, b.gy + b.d / 2);
    } else if (target.type === 'plot') {
      const pl = PLOTS[target.plot];
      if (pl) p = iso(pl.gx + 1, pl.gy + 1);
    }
    this.dragVel = { x: 0, y: 0 };
    this.zoomAnchor = null;
    if (this.zoomTarget < 1.15) this.zoomTarget = 1.25;
    this.cameras.main.pan(p.x, p.y - 24, this.motionOk ? 800 : 1, 'Cubic.easeInOut');
  }

  // ----------------------------------------------------- live world sync ---
  setWorld(snap: PublicSnapshot) {
    this.snap = snap;
    this.snapAt = performance.now();
    if (this.sys.isActive()) this.applySnapshot(snap);
  }

  private applySnapshot(snap: PublicSnapshot) {
    const season = this.director.season ?? snap.season;
    if (season !== this.season) {
      this.season = season;
      this.paintGround(season);
      for (const t of this.trees) if (t.oak) t.img.setTint(SEASON_OAK[season]);
      for (const t of this.trees) if (!t.oak) t.img.setTint(season === 'winter' ? 0xdfe8ee : 0xffffff);
    }
    this.syncCitizens(snap.population);
    this.syncMerchants(snap);
    this.syncWealth(snap);
    this.syncPlots(snap);
    this.applyWeather(snap);
    this.floatFeed(snap.feed);
    this.priceIndicators(snap);
    this.refreshClosedTints();
    this.firstSnap = false;
  }

  private syncMerchants(snap: PublicSnapshot) {
    for (const m of snap.merchants) {
      const npc = this.npcs.get(m.id);
      const b = BUILDINGS.find((x) => x.merchant === m.id);
      if (!npc || !b) continue;
      npc.label?.setText(m.status === 'bankrupt' ? `${m.name} · closed` : m.name);
      const away = !!m.travel;
      npc.sprite.setVisible(m.status !== 'bankrupt' && !away);
      npc.label?.setVisible(m.status !== 'bankrupt' && !away);
      // A new trade sends the merchant carrying goods to the market square and back.
      const prev = this.lastMerchantTrade.get(m.id);
      if (prev !== undefined && m.lastTradeTick > prev && npc.path.length === 0 && m.role !== 'banker') {
        const r = this.routeToMarket(b);
        npc.path = [...r, ...r.slice().reverse().slice(1), npc.home];
        npc.carrying = true;
      }
      this.lastMerchantTrade.set(m.id, m.lastTradeTick);
      let sign = this.closedSigns.get(m.id);
      if (m.status === 'bankrupt' && !sign) {
        const p = iso(b.door.gx + 0.5, b.door.gy);
        sign = this.add.text(p.x, p.y - 10, 'CLOSED', { fontFamily: 'Cinzel, serif', fontSize: '11px', color: '#ffd2c0', backgroundColor: '#6b2418', padding: { x: 5, y: 2 } }).setOrigin(0.5).setDepth(99500);
        this.closedSigns.set(m.id, sign);
      } else if (m.status !== 'bankrupt' && sign) {
        sign.destroy();
        this.closedSigns.delete(m.id);
      }
      if (m.role === 'trader') {
        if (m.travel) {
          const progress = Phaser.Math.Clamp(1 - (m.travel.arriveTick - snap.tick) / 6, 0, 1);
          const out = m.travel.to === 'aurora';
          const gx = out ? 26 + progress * 10 : 36 - progress * 10;
          const p = iso(gx, 15.5);
          this.caravan.setVisible(true).setPosition(p.x, p.y).setDepth(p.y).setFlipX(!out).setAlpha(gx > 31 ? Math.max(0, 1 - (gx - 31) / 3) : 1);
        } else this.caravan.setVisible(false);
      }
    }
  }

  /** Prosperous merchants' premises visibly improve: flower boxes, banners, lanterns. */
  private syncWealth(snap: PublicSnapshot) {
    const ranked = snap.merchants.filter((m) => m.status !== 'bankrupt').sort((a, b) => b.netWorth - a.netWorth);
    const tier = new Map<string, number>();
    ranked.forEach((m, i) => tier.set(m.id, i < 3 ? 2 : i < Math.ceil(ranked.length / 2) ? 1 : 0));
    const key = ranked.map((m) => `${m.id}:${tier.get(m.id)}`).join('|');
    if (key === this.wealthKey) return;
    const changed = this.wealthKey !== '';
    this.wealthKey = key;
    this.wealth.forEach((o) => o.destroy());
    this.wealth = [];
    for (const m of ranked) {
      const t = tier.get(m.id) ?? 0;
      const b = BUILDINGS.find((x) => x.merchant === m.id);
      const placed = b && this.buildings.get(b.id);
      if (!placed || t === 0 || placed.art.windows.length === 0 || b.id === 'mine' || b.id === 'docks') continue;
      const { img, art } = placed;
      for (const w of art.windows.slice(0, 3)) this.wealth.push(this.add.image(img.x + w.x, img.y + w.y + 7, 'flowerbox').setDepth(img.depth + 0.5));
      if (t >= 2) {
        const p = iso(b.gx + b.w + 0.15, b.gy + b.d + 0.15);
        this.wealth.push(this.add.image(p.x, p.y, 'banner').setOrigin(0.5, 1).setDepth(p.y + 1).setTint(0xd9a84a));
        const crown = this.add.text(img.x + art.crown.x, img.y + art.crown.y - 8, '♛', { fontFamily: 'serif', fontSize: '16px', color: '#f4c96b', stroke: '#3a2414', strokeThickness: 3 }).setOrigin(0.5, 1).setDepth(99400);
        this.wealth.push(crown);
        if (changed && this.motionOk) this.tweens.add({ targets: crown, scale: { from: 1.8, to: 1 }, duration: 600, ease: 'Back.easeOut' });
      }
    }
  }

  private refreshClosedTints() {
    if (!this.snap) return;
    for (const m of this.snap.merchants) {
      const b = BUILDINGS.find((x) => x.merchant === m.id);
      const img = b && this.buildings.get(b.id)?.img;
      if (img && m.status === 'bankrupt') img.setTint(0x8a8078);
      else if (img && m.status === 'struggling') img.setTint(0xe8d8c8);
    }
  }

  private syncPlots(snap: PublicSnapshot) {
    const me = this.cb.getPlayerId();
    const key = snap.businesses.map((b) => `${b.id}:${b.plot}:${b.kind}:${b.ownerId}:${b.level}`).join('|') + `|${me}`;
    if (key === this.plotKey) return;
    this.plotKey = key;
    this.plotLayer.forEach((o) => o.destroy());
    this.plotLayer = [];
    PLOTS.forEach((pl, i) => {
      const biz = snap.businesses.find((b) => b.plot === i);
      if (!biz) {
        const p = iso(pl.gx + 1, pl.gy + 1);
        const g = this.add.graphics().setDepth(-9000);
        g.fillStyle(0xf4c96b, 0.07);
        const n = iso(pl.gx, pl.gy), e = iso(pl.gx + 2, pl.gy), s = iso(pl.gx + 2, pl.gy + 2), w = iso(pl.gx, pl.gy + 2);
        g.fillPoints([n, e, s, w], true);
        g.lineStyle(1.5, 0xf4c96b, 0.4);
        g.strokePoints([n, e, s, w], true);
        const sign = this.add.image(p.x, p.y + 4, 'signpost').setOrigin(0.5, 1).setDepth(p.y + 4);
        this.makeInteractive(sign, 'Empty plot — open a business here', () => this.cb.onSelect({ type: 'plot', plot: i }));
        this.plotLayer.push(g, sign);
        return;
      }
      const lv = Math.max(1, Math.min(3, biz.level));
      const key = `pb-${biz.kind}-${lv}`;
      const art = drawBuildingMeta(this, key);
      const img = this.placeBuilding({ gx: pl.gx, gy: pl.gy, w: 2, d: 2 }, art);
      this.makeInteractive(img, `${biz.owner}'s ${biz.kind} (Lv ${biz.level})`, () => this.cb.onSelect({ type: 'plot', plot: i, businessId: biz.id, ownerId: biz.ownerId }));
      this.plotLayer.push(img);
      const extras: Phaser.GameObjects.GameObject[] = [];
      this.addLights(art, img, extras);
      this.plotLayer.push(...extras);
      if (lv >= 2) for (const w of art.windows.slice(0, 2)) this.plotLayer.push(this.add.image(img.x + w.x, img.y + w.y + 7, 'flowerbox').setDepth(img.depth + 0.5));
      if (biz.ownerId === me) {
        const f = iso(pl.gx + 0.2, pl.gy + 2);
        this.plotLayer.push(this.add.image(f.x, f.y, 'flag').setOrigin(0.1, 1).setDepth(img.depth + 1));
      }
      // Construction / upgrade animation for businesses that are new or levelled up since last snapshot.
      const prevLv = this.bizLevels.get(biz.id);
      if (!this.firstSnap && (prevLv === undefined || prevLv < biz.level)) this.construct(img, pl);
    });
    this.bizLevels = new Map(snap.businesses.map((b) => [b.id, b.level]));
  }

  private construct(img: Phaser.GameObjects.Image, pl: { gx: number; gy: number }) {
    const c = iso(pl.gx + 1, pl.gy + 1);
    const scaffold = this.add.image(c.x, c.y + 8, 'scaffold').setOrigin(0.5, 1).setDepth(img.depth + 2).setAlpha(0.95);
    const finalY = img.y;
    if (this.motionOk) {
      img.setAlpha(0.2);
      img.y = finalY + 26;
      this.tweens.add({ targets: img, y: finalY, alpha: 1, duration: 2200, ease: 'Cubic.easeOut' });
      for (let i = 0; i < 6; i++) this.time.delayedCall(i * 320, () => this.dust.explode(5, c.x + (Math.random() - 0.5) * 60, c.y + (Math.random() - 0.5) * 20));
    }
    this.tweens.add({ targets: scaffold, alpha: 0, delay: 2400, duration: 700, onComplete: () => scaffold.destroy() });
    const t = this.add.text(c.x, c.y - 70, '⚒ Construction complete', { fontFamily: 'Cinzel, serif', fontSize: '12px', color: '#f4c96b', stroke: '#140f0b', strokeThickness: 4 }).setOrigin(0.5).setDepth(99800).setAlpha(0);
    this.tweens.add({ targets: t, alpha: 1, delay: 2000, duration: 300, yoyo: true, hold: 1600, onComplete: () => t.destroy() });
  }

  private applyWeather(snap: PublicSnapshot) {
    const weather = this.director.weather ?? snap.weather;
    const s = this.cb.getSettings();
    const enabled = s.weather && !s.reducedMotion;
    const rainy = enabled && (weather === 'rain' || weather === 'storm');
    const toggle = (e: Phaser.GameObjects.Particles.ParticleEmitter, on: boolean) => {
      if (on && !e.emitting) e.start();
      else if (!on && e.emitting) e.stop();
    };
    this.rain.frequency = weather === 'storm' ? 8 : 18;
    toggle(this.rain, rainy);
    toggle(this.splash, rainy);
    toggle(this.snow, enabled && weather === 'snow');
    const leafCols = SEASON_LEAF[this.director.season ?? snap.season];
    if (leafCols) this.leaves.setParticleTint(leafCols[0]);
    toggle(this.leaves, enabled && !!leafCols && !rainy);
    const cloudy = weather === 'cloudy' || weather === 'rain' || weather === 'storm' || weather === 'snow';
    for (const c of this.clouds) this.tweens.add({ targets: c, alpha: cloudy ? 0.7 : 0.18, duration: 2000 });
    if (!enabled) {
      for (const e of this.smoke) e.frequency = 900;
      this.sparks?.stop();
      this.fountainSpray.stop();
    } else {
      for (const e of this.smoke) e.frequency = 320;
      if (this.sparks && !this.sparks.emitting) this.sparks.start();
      if (!this.fountainSpray.emitting) this.fountainSpray.start();
    }
  }

  private floatFeed(feed: FeedEntry[]) {
    const fresh = feed.filter((f) => f.id > this.seenFeed);
    if (fresh.length) this.seenFeed = fresh[fresh.length - 1].id;
    if (this.firstSnap) return;
    const now = this.time.now;
    for (const f of fresh) {
      if (f.kind === 'expansion' && f.actor && f.severity === 'good') {
        const npc = this.npcs.get(f.actor);
        if (npc) npc.cheerUntil = this.time.now + 4500;
      }
      if (f.kind !== 'trade' || !f.actor || !f.resource) continue;
      const b = BUILDINGS.find((x) => x.merchant === f.actor);
      if (!b) continue;
      const qty = Number(f.data?.qty ?? 0);
      const sold = f.text.includes(' sold ');
      const p = iso(b.gx + b.w / 2, b.gy + b.d / 2);
      const ex = iso(15.5, 15.5);
      const art = this.buildings.get(b.id)?.art;
      const topY = p.y - (art ? art.originY - art.crown.y : 60);
      // Stagger labels per building so simultaneous trades don't overprint each other.
      const slot = Math.max(now, this.labelSlot.get(b.id) ?? 0);
      this.labelSlot.set(b.id, slot + 750);
      this.time.delayedCall(slot - now, () => {
        if (this.motionOk && !this.lowQuality) this.flyGoods(f.resource!, sold ? p : ex, sold ? ex : p, Math.min(3, Math.max(1, Math.round(qty / 5))));
        if (this.cinematic) return;
        const t = this.add
          .text(p.x, topY - 10, `${sold ? '−' : '+'}${qty} ${f.resource}`, { fontFamily: 'Manrope Variable, sans-serif', fontStyle: 'bold', fontSize: '12px', color: sold ? '#f4c96b' : '#9fe0a0', stroke: '#140f0b', strokeThickness: 3 })
          .setOrigin(0.5)
          .setDepth(99800);
        this.tweens.add({ targets: t, y: t.y - 36, alpha: 0, duration: 2200, ease: 'Sine.easeOut', onComplete: () => t.destroy() });
      });
    }
  }

  /** Goods tokens arc between a workshop and the Exchange; gold coins fly back the other way. */
  private flyGoods(resource: string, from: { x: number; y: number }, to: { x: number; y: number }, n: number) {
    const key = RESOURCE_COLOR[resource] ? `good-${resource}` : 'coin';
    const arc = (k: string, a: { x: number; y: number }, b: { x: number; y: number }, i: number) => {
      const img = this.add.image(a.x, a.y - 30, k).setDepth(99750).setScale(0.9);
      const h = 70 + Math.hypot(b.x - a.x, b.y - a.y) * 0.18;
      const state = { t: 0 };
      this.tweens.add({
        targets: state, t: 1, delay: i * 110, duration: 1100, ease: 'Sine.easeInOut',
        onUpdate: () => {
          const t = state.t;
          img.setPosition(a.x + (b.x - a.x) * t, a.y - 30 + (b.y - a.y) * t - Math.sin(t * Math.PI) * h);
          img.setScale(0.9 + Math.sin(t * Math.PI) * 0.35);
        },
        onComplete: () => {
          this.tweens.add({ targets: img, alpha: 0, scale: 1.6, duration: 220, onComplete: () => img.destroy() });
        },
      });
    };
    for (let i = 0; i < n; i++) arc(key, from, to, i);
    this.time.delayedCall(700, () => arc('coin', to, from, 0));
  }

  /** ▲/▼ markers over the Exchange for the biggest price moves since the last tick. */
  private priceIndicators(snap: PublicSnapshot) {
    const m = snap.markets?.nearhaven;
    if (!m) return;
    const moves: Array<{ r: string; pct: number }> = [];
    for (const [r, v] of Object.entries(m.resources)) {
      const prev = this.prevPrices[r];
      if (prev && prev > 0) moves.push({ r, pct: (v.price - prev) / prev });
      this.prevPrices[r] = v.price;
    }
    if (this.firstSnap || this.cinematic || this.time.now < this.nextPriceFx) return;
    this.nextPriceFx = this.time.now + 3200;
    moves.sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct));
    const ex = this.buildings.get('exchange');
    if (!ex) return;
    const top = { x: ex.img.x + ex.art.crown.x, y: ex.img.y + ex.art.crown.y - 30 };
    moves.filter((x) => Math.abs(x.pct) >= 0.01).slice(0, 2).forEach((mv, i) => {
      const up = mv.pct > 0;
      const c = this.add.container(top.x + (i ? 70 : -70), top.y).setDepth(99850).setAlpha(0);
      const arrow = this.add.image(-24, 0, up ? 'arrow-up' : 'arrow-down');
      const txt = this.add.text(-14, 0, `${mv.r} ${up ? '+' : ''}${(mv.pct * 100).toFixed(1)}%`, { fontFamily: 'Manrope Variable, sans-serif', fontStyle: 'bold', fontSize: '12px', color: up ? '#9fe0a0' : '#ffb0a0', stroke: '#140f0b', strokeThickness: 4 }).setOrigin(0, 0.5);
      c.add([arrow, txt]);
      this.tweens.add({ targets: c, alpha: 1, y: top.y - 14, duration: 400, delay: i * 300, ease: 'Back.easeOut' });
      this.tweens.add({ targets: c, alpha: 0, y: top.y - 40, delay: 1900 + i * 300, duration: 600, onComplete: () => c.destroy() });
    });
  }

  private shimmerWater() {
    this.waterFrame ^= 1;
    for (let i = 0; i < this.water.length; i++) if ((i + this.waterFrame) % 3 === 0) this.water[i].setTexture(`water2-${(i + this.waterFrame) % 2}`);
  }

  private twinkleWater() {
    if (!this.motionOk || !this.water.length) return;
    const w = this.water[Math.floor(Math.random() * this.water.length)];
    const s = this.add.image(w.x + (Math.random() - 0.5) * 30, w.y + 8 + Math.random() * 16, 'spark').setBlendMode(Phaser.BlendModes.ADD).setDepth(-9990).setAlpha(0).setTint(0xdff4ff);
    this.tweens.add({ targets: s, alpha: 0.9, scale: { from: 0.4, to: 1.3 }, duration: 380, yoyo: true, onComplete: () => s.destroy() });
  }

  /** 0 (day) … 1 (deep night), with smooth dawn and dusk. */
  private nightFactor(hour: number) {
    if (hour >= 21 || hour < 4) return 1;
    if (hour >= 4 && hour < 7) return 1 - (hour - 4) / 3;
    if (hour >= 18 && hour < 21) return (hour - 18) / 3;
    return 0;
  }

  private updateCamera(dt: number) {
    const cam = this.cameras.main;
    const typing = typeof document !== 'undefined' && !!document.activeElement?.closest('input, textarea, select, [contenteditable="true"]');
    if (this.keys && !typing) {
      const k = this.keys;
      const sp = (480 * dt) / cam.zoom;
      if (k.A.isDown || k.LEFT.isDown) cam.scrollX -= sp;
      if (k.D.isDown || k.RIGHT.isDown) cam.scrollX += sp;
      if (k.W.isDown || k.UP.isDown) cam.scrollY -= sp;
      if (k.S.isDown || k.DOWN.isDown) cam.scrollY += sp;
      if (Phaser.Input.Keyboard.JustDown(k.Q)) this.zoomBy(0.85);
      if (Phaser.Input.Keyboard.JustDown(k.E)) this.zoomBy(1.18);
    }
    if (this.cinematic) {
      // Slow drift past the points of interest.
      this.cineT += dt * 0.045;
      const a = this.cineT;
      const p = iso(15.5 + Math.cos(a) * 6, 15.5 + Math.sin(a * 0.8) * 6);
      cam.centerOn(cam.midPoint.x + (p.x - cam.midPoint.x) * 0.02, cam.midPoint.y + (p.y - cam.midPoint.y) * 0.02);
      this.zoomTarget = (this.scale.width < 700 ? 0.8 : 1.15) + Math.sin(a * 1.3) * 0.08;
    }
    // Drag inertia.
    if (!this.dragging && (Math.abs(this.dragVel.x) > 0.05 || Math.abs(this.dragVel.y) > 0.05)) {
      cam.scrollX -= this.dragVel.x;
      cam.scrollY -= this.dragVel.y;
      const decay = Math.pow(0.0025, dt);
      this.dragVel.x *= decay;
      this.dragVel.y *= decay;
    }
    // Eased zoom anchored at the cursor.
    if (Math.abs(cam.zoom - this.zoomTarget) > 0.0005) {
      const before = this.zoomAnchor ? cam.getWorldPoint(this.zoomAnchor.sx, this.zoomAnchor.sy) : null;
      const z = cam.zoom + (this.zoomTarget - cam.zoom) * Math.min(1, dt * (this.motionOk ? 10 : 60));
      cam.setZoom(z);
      if (before && this.zoomAnchor) {
        cam.preRender();
        const after = cam.getWorldPoint(this.zoomAnchor.sx, this.zoomAnchor.sy);
        cam.scrollX += before.x - after.x;
        cam.scrollY += before.y - after.y;
      }
    }
  }

  update(time: number, delta: number) {
    const dt = Math.min(0.1, delta / 1000);
    const cam = this.cameras.main;
    if (!this.director.scripted) this.updateCamera(dt);
    if (!this.director.scripted) this.adaptQuality(delta);
    const motion = this.motionOk;
    let hour = 12;
    let night = 0;

    // Time of day, interpolated between server ticks, with sunrise/sunset grading.
    if (this.snap) {
      const frac = Math.min(1, (performance.now() - this.snapAt) / 2000);
      hour = this.director.hour ?? (this.snap.hour + frac) % 24;
      night = this.nightFactor(hour);
      const dusk = hour >= 16 && hour < 21 ? 1 - Math.abs(hour - 18.5) / 2.5 : 0;
      const dawn = hour >= 4 && hour < 8 ? 1 - Math.abs(hour - 6) / 2 : 0;
      this.nightOverlay.setFillStyle(0x0c1633, 0.56 * night);
      const w = this.director.weather ?? this.snap.weather;
      const gradeColor = w === 'storm' ? 0x8090a8 : dawn > dusk ? 0xffa58a : 0xff9a50;
      const heat = w === 'heatwave' ? 0.14 : 0;
      this.gradeOverlay.setFillStyle(w === 'heatwave' ? 0xffb060 : gradeColor, Math.max(dawn, dusk) * 0.32 + heat + (w === 'storm' ? 0.25 : w === 'rain' ? 0.12 : 0));
      for (const g of this.glows) {
        if (g.base < 0) g.img.setAlpha(0.55 + 0.25 * Math.sin(time / 120 + g.seed) + night * 0.2);
        else g.img.setAlpha(night * g.base * (0.8 + 0.2 * Math.sin(time / 260 + g.seed)));
      }
      if (w === 'storm' && this.cb.getSettings().weather && motion && Math.random() < 0.0015) cam.flash(180, 220, 230, 255);
      // Fog at dawn, at night and in wet weather.
      const fogA = Math.max(dawn * 0.5, night * 0.22, w === 'rain' || w === 'storm' ? 0.3 : w === 'cloudy' ? 0.15 : 0);
      for (const f of this.fog) f.alpha += (fogA - f.alpha) * Math.min(1, dt);
      // Day: dust motes in the sunlight. Night: fireflies.
      const wantMotes = motion && !this.lowQuality && w !== 'rain' && w !== 'storm' && w !== 'snow';
      if (wantMotes && !this.motes.emitting) this.motes.start();
      else if (!wantMotes && this.motes.emitting) this.motes.stop();
      this.motes.setParticleTint(night > 0.5 ? 0xc8ff8a : 0xfff2c0);
    }

    // Weather emitters follow the view.
    const v = cam.worldView;
    for (const e of [this.rain, this.snow, this.leaves]) e.setPosition(v.centerX, v.y);
    this.motes.setPosition(v.centerX, v.centerY);
    this.splash.setPosition(v.centerX, v.centerY);
    for (const c of this.clouds) {
      c.x += 12 * dt;
      if (c.x > v.right + 600) c.x = v.x - 600;
    }
    for (const f of this.fog) {
      f.x += 6 * dt;
      if (f.x > v.right + 700) f.x = v.x - 700;
    }
    // Birds by day.
    for (const b of this.birds) {
      b.t += dt;
      b.img.setVisible(night < 0.5 && motion && !this.lowQuality);
      b.img.x += b.vx * dt;
      b.img.y += b.vy * dt + Math.sin(b.t * 2) * 0.2;
      b.img.setTexture(Math.floor(b.t * 6) % 2 ? 'bird1' : 'bird0');
      if (b.img.x > v.right + 100) {
        b.img.x = v.x - 100;
        b.img.y = v.y + Math.random() * v.height * 0.5;
      }
    }
    // Wind sways the trees (gentle, stronger in storms).
    if (motion && !this.lowQuality) {
      const gw = this.director.weather ?? this.snap?.weather;
      const gust = gw === 'storm' ? 4 : gw === 'rain' ? 2.2 : 1.1;
      for (const t of this.trees) t.img.setAngle(Math.sin(time / 900 + t.seed) * gust);
    }

    // Merchants: sleep at night, work at their station by day, carry goods to market after trades,
    // run when an event has the town on edge, cheer when they expand, slump when struggling.
    const tension = (this.snap?.events.length ?? 0) > 0;
    const statusOf = (id: string) => this.snap?.merchants.find((m) => m.id === id)?.status;
    for (const npc of this.npcs.values()) {
      const moving = this.stepNpc(npc, dt, true, tension ? 1.8 : 1);
      if (!moving) {
        const st = npc.merchantId ? statusOf(npc.merchantId) : undefined;
        const asleep = (hour >= 22 || hour < 5) && npc.merchantId !== 'banker';
        if (time < npc.cheerUntil) this.play(npc, 'cheer');
        else if (asleep) this.play(npc, 'sleep');
        else if (st === 'struggling') this.play(npc, 'sad');
        else {
          npc.workTimer -= dt;
          if (npc.workTimer <= 0) {
            npc.working = !npc.working;
            npc.workTimer = npc.working ? 4 + Math.random() * 5 : 2 + Math.random() * 3;
          }
          this.play(npc, npc.working ? 'work' : 'idle');
        }
        // Zzz bubbles.
        if (npc.anim === 'sleep' && motion && time > (npc.zzz ?? 0)) {
          npc.zzz = time + 1600;
          const z = this.add.text(npc.sprite.x + 6, npc.sprite.y - 34, 'z', { fontFamily: 'Cinzel, serif', fontSize: '11px', color: '#dfe8ff', stroke: '#140f0b', strokeThickness: 3 }).setDepth(99600);
          this.tweens.add({ targets: z, x: z.x + 10, y: z.y - 22, alpha: 0, scale: 1.6, duration: 1800, onComplete: () => z.destroy() });
        }
      }
      npc.sprite.setDepth(npc.sprite.y + 1);
      npc.label?.setPosition(npc.sprite.x, npc.sprite.y - 40);
      npc.label?.setAlpha(cam.zoom > 0.7 && !this.cinematic && this.director.labels ? 0.92 : 0);
    }
    for (const c of this.citizens) {
      const moving = this.stepNpc(c, dt, false, 1);
      if (!moving) this.play(c, 'idle');
      c.sprite.setDepth(c.sprite.y);
      // Citizens head indoors late at night.
      c.sprite.setAlpha(night > 0.8 ? 0.0 : 1);
    }
  }

  /**
   * Keep 60 FPS on weaker devices: if frames run long for a few seconds, drop the
   * purely decorative effects (motes, fog, sway, birds, dense particles).
   */
  private adaptQuality(delta: number) {
    if (this.lowQuality) return;
    const a = this.fpsAcc;
    a.t += delta;
    a.n++;
    if (a.t < 1000) return;
    const fps = (a.n * 1000) / a.t;
    a.t = 0;
    a.n = 0;
    a.slow = fps < 40 ? a.slow + 1 : 0;
    if (a.slow < 4) return;
    this.lowQuality = true;
    this.motes.stop();
    this.motes.setVisible(false);
    for (const f of this.fog) f.setVisible(false);
    for (const e of this.smoke) e.frequency = 700;
    this.trees.forEach((t) => t.img.setAngle(0));
    this.birds.forEach((b) => b.img.setVisible(false));
  }

  /** Advance along a path; returns whether the character is moving. */
  private stepNpc(npc: Npc, dt: number, isMerchant: boolean, speedMul: number) {
    if (npc.wait > 0) {
      npc.wait -= dt;
      return false;
    }
    const target = npc.path[0];
    if (!target) return false;
    const dx = target.x - npc.sprite.x, dy = target.y - npc.sprite.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 2) {
      npc.path.shift();
      if (isMerchant) {
        // Goods are handed over at the market; the walk home is empty-handed.
        if (npc.carrying && npc.path.length && Math.abs(npc.sprite.y - iso(15.5, 15.5).y) < 80) npc.carrying = false;
        if (npc.path.length === 0) npc.carrying = false;
        npc.wait = npc.path.length ? 0.25 : 0;
      } else {
        if (npc.path.length === 0) npc.path.push(this.roadPoint());
        npc.wait = Math.random() * 2.2;
      }
      return npc.path.length > 0 && npc.wait === 0;
    }
    const run = speedMul > 1;
    const s = Math.min(dist, npc.speed * speedMul * dt);
    npc.sprite.x += (dx / dist) * s;
    npc.sprite.y += (dy / dist) * s;
    npc.sprite.setFlipX(dx < 0);
    this.play(npc, npc.carrying ? 'carry' : run ? 'run' : 'walk');
    return true;
  }
}

/** Re-read the anchors of a pre-rendered player building texture. */
const metaCache = new Map<string, BuildingArt>();
function drawBuildingMeta(scene: Phaser.Scene, key: string): BuildingArt {
  const hit = metaCache.get(key);
  if (hit && scene.textures.exists(key)) return hit;
  const [, kind, lv] = key.split('-');
  const base = SPECS[`p-${kind}`];
  const level = Number(lv);
  if (scene.textures.exists(key)) scene.textures.remove(key);
  const art = drawBuilding(scene, key, { ...base, h: base.h + (level - 1) * 6, windows: base.windows + (level - 1), chimney: level === 3 && !base.chimney ? 'left' : base.chimney });
  metaCache.set(key, art);
  return art;
}
