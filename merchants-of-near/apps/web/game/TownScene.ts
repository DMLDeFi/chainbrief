import * as Phaser from 'phaser';
import type { FeedEntry, PublicSnapshot } from '@mon/engine';
import { BUILDINGS, MAP, PLAYER_STYLE, PLOTS, TILE_H, TILE_W, hash2, iso, tileKind, type BuildingDef } from './layout';
import { makeBuildingTexture, makeCharacterTexture, makeTileTextures, makeTreeTextures, type BuildingArt } from './textures';

export type Selection =
  | { type: 'merchant'; id: string }
  | { type: 'exchange' }
  | { type: 'plot'; plot: number; businessId?: string; ownerId?: string };

export interface TownCallbacks {
  onSelect: (s: Selection) => void;
  getPlayerId: () => string | null;
  getSettings: () => { weather: boolean; reducedMotion: boolean };
}

const ROLE_LOOK: Record<string, { tunic: number; hat: string }> = {
  farmer: { tunic: 0x6f8f3e, hat: 'straw' },
  baker: { tunic: 0xc98b4a, hat: 'toque' },
  blacksmith: { tunic: 0x5a4a44, hat: 'apron' },
  trader: { tunic: 0x2f5e8e, hat: 'hood' },
  banker: { tunic: 0x2c3550, hat: 'tophat' },
  miner: { tunic: 0x6b5d4a, hat: 'helmet' },
  fisher: { tunic: 0x3f7f8a, hat: 'cap' },
  weaver: { tunic: 0x9a5f8e, hat: 'scarf' },
  woodcutter: { tunic: 0x4d6b3a, hat: 'hood' },
};

interface Npc {
  sprite: Phaser.GameObjects.Image;
  shadow?: Phaser.GameObjects.Image;
  path: Array<{ x: number; y: number }>;
  speed: number;
  home: { x: number; y: number };
  merchantId?: string;
  wait: number;
  phase: number;
  label?: Phaser.GameObjects.Text;
}

const SEASON_GRASS: Record<string, number> = { spring: 0xffffff, summer: 0xf4f0c4, autumn: 0xe9cf98, winter: 0xffffff };
const SEASON_OAK: Record<string, number> = { spring: 0x86c45c, summer: 0x5d9c42, autumn: 0xd98a32, winter: 0xe9eef4 };

export class TownScene extends Phaser.Scene {
  private cb!: TownCallbacks;
  private snap: PublicSnapshot | null = null;
  private snapAt = 0;
  private grass: Phaser.GameObjects.Image[] = [];
  private water: Phaser.GameObjects.Image[] = [];
  private fields: Phaser.GameObjects.Image[] = [];
  private oaks: Phaser.GameObjects.Image[] = [];
  private glows: Array<{ img: Phaser.GameObjects.Image; seed: number }> = [];
  private smoke: Phaser.GameObjects.Particles.ParticleEmitter[] = [];
  private buildingImgs = new Map<string, Phaser.GameObjects.Image>();
  private playerArt = new Map<string, BuildingArt>();
  private closedSigns = new Map<string, Phaser.GameObjects.Text>();
  private npcs = new Map<string, Npc>();
  private citizens: Npc[] = [];
  private caravan!: Phaser.GameObjects.Image;
  private plotLayer: Phaser.GameObjects.GameObject[] = [];
  private plotKey = '';
  private nightOverlay!: Phaser.GameObjects.Rectangle;
  private warmOverlay!: Phaser.GameObjects.Rectangle;
  private rain!: Phaser.GameObjects.Particles.ParticleEmitter;
  private snow!: Phaser.GameObjects.Particles.ParticleEmitter;
  private clouds: Phaser.GameObjects.Image[] = [];
  private hoverLabel!: Phaser.GameObjects.Text;
  private dragDist = 0;
  private lastMerchantTrade = new Map<string, number>();
  private seenFeed = 0;
  private waterFrame = 0;
  private keys?: Record<string, Phaser.Input.Keyboard.Key>;

  constructor() {
    super('town');
  }

  init(data: { callbacks: TownCallbacks }) {
    this.cb = data.callbacks;
  }

  create() {
    makeTileTextures(this);
    makeTreeTextures(this);
    this.makeSnowTile();
    this.buildGround();
    this.buildDecorations();
    this.buildBuildings();
    this.buildStallsAndLamps();
    this.buildNpcs();
    this.buildAtmosphere();
    this.setupCamera();

    this.hoverLabel = this.add
      .text(0, 0, '', { fontFamily: 'Cinzel, serif', fontSize: '13px', color: '#f1e4c6', backgroundColor: 'rgba(20,15,11,0.85)', padding: { x: 8, y: 4 } })
      .setOrigin(0.5, 1)
      .setDepth(100000)
      .setVisible(false);

    this.time.addEvent({ delay: 650, loop: true, callback: () => this.shimmerWater() });
    this.scale.on('resize', () => this.layoutOverlays());
    this.layoutOverlays();
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

  private buildGround() {
    for (let gx = -4; gx < MAP + 4; gx++) {
      for (let gy = -4; gy < MAP + 4; gy++) {
        const { x, y } = iso(gx, gy);
        const inMap = gx >= 0 && gy >= 0 && gx < MAP && gy < MAP;
        const kind = inMap ? tileKind(gx, gy) : gx < 3 ? 'water' : 'grass';
        if (kind === 'water') {
          this.water.push(this.add.image(x, y, 'water0').setOrigin(0.5, 0).setDepth(-10000));
          continue;
        }
        const key = kind === 'grass' ? `grass${Math.floor(hash2(gx, gy) * 3)}` : kind === 'field' ? 'field-spring' : kind;
        const img = this.add.image(x, y, key).setOrigin(0.5, 0).setDepth(-10000);
        if (kind === 'grass') this.grass.push(img);
        if (kind === 'field') this.fields.push(img);
        if (!inMap) img.setAlpha(0.85);
      }
    }
  }

  private occupied(gx: number, gy: number) {
    if (tileKind(gx, gy) !== 'grass') return true;
    for (const b of BUILDINGS) if (gx >= b.gx - 1 && gx <= b.gx + b.w && gy >= b.gy - 1 && gy <= b.gy + b.d) return true;
    for (const p of PLOTS) if (gx >= p.gx - 1 && gx <= p.gx + 2 && gy >= p.gy - 1 && gy <= p.gy + 2) return true;
    return false;
  }

  private buildDecorations() {
    for (let gx = -3; gx < MAP + 3; gx++) {
      for (let gy = -3; gy < MAP + 3; gy++) {
        const inMap = gx >= 0 && gy >= 0 && gx < MAP && gy < MAP;
        if (inMap && this.occupied(gx, gy)) continue;
        if (!inMap && gx < 3) continue;
        const h = hash2(gx * 7 + 3, gy * 13 + 1);
        const forest = (gx > 21 && gy > 19) || gx > 27 || gy > 27 || gy < 1 || !inMap;
        const chance = forest ? 0.55 : 0.07;
        if (h > chance) {
          if (h > 0.97 && inMap) this.addProp(gx, gy, h > 0.985 ? 'rock' : 'bush');
          continue;
        }
        const { x, y } = iso(gx + 0.5, gy + 0.5);
        const jitterX = (hash2(gx, gy * 3) - 0.5) * 18;
        if (hash2(gy, gx) > 0.5) {
          this.add.image(x + jitterX, y + 4, 'pine').setOrigin(0.5, 0.94).setDepth(y + 4);
        } else {
          this.add.image(x + jitterX, y + 4, 'oak-trunk').setOrigin(0.5, 0.94).setDepth(y + 4);
          this.oaks.push(this.add.image(x + jitterX, y + 4, 'oak-canopy').setOrigin(0.5, 0.94).setDepth(y + 4.1).setTint(SEASON_OAK.spring));
        }
      }
    }
    // Mine rocks.
    for (const [gx, gy] of [[4, 2], [7, 2], [8, 4], [4, 6], [6, 7]]) this.addProp(gx, gy, 'rock');
  }

  private addProp(gx: number, gy: number, key: string) {
    const { x, y } = iso(gx + 0.5, gy + 0.5);
    this.add.image(x, y + 6, key).setOrigin(0.5, 0.8).setDepth(y + 6);
  }

  // ----------------------------------------------------------- buildings ---
  private placeBuilding(def: { gx: number; gy: number; w: number; d: number }, art: BuildingArt) {
    const n = iso(def.gx, def.gy);
    const img = this.add.image(n.x - art.originX, n.y - art.originY, art.key).setOrigin(0, 0);
    const south = iso(def.gx + def.w, def.gy + def.d);
    img.setDepth(south.y - 2);
    return img;
  }

  private addWindowGlows(art: BuildingArt, img: Phaser.GameObjects.Image) {
    for (const w of art.windows) {
      const g = this.add.image(img.x + w.x, img.y + w.y, 'glow').setBlendMode(Phaser.BlendModes.ADD).setDepth(img.depth + 1).setAlpha(0).setScale(0.55);
      this.glows.push({ img: g, seed: Math.random() * 10 });
    }
    if (art.chimney) {
      const em = this.add.particles(img.x + art.chimney.x, img.y + art.chimney.y, 'puff', {
        speedY: { min: -22, max: -12 },
        speedX: { min: 2, max: 9 },
        scale: { start: 0.5, end: 1.9 },
        alpha: { start: 0.42, end: 0 },
        tint: 0xd8d2c8,
        lifespan: 2600,
        frequency: 380,
      });
      em.setDepth(img.depth + 2);
      this.smoke.push(em);
    }
  }

  private buildBuildings() {
    for (const b of BUILDINGS) {
      const art = makeBuildingTexture(this, `b-${b.id}`, b.w, b.d, b.h, b.wall, b.roof, b.style, b.chimney);
      const img = this.placeBuilding(b, art);
      this.addWindowGlows(art, img);
      this.makeInteractive(img, b.label, () => this.cb.onSelect(b.merchant ? { type: 'merchant', id: b.merchant } : { type: 'exchange' }));
      this.buildingImgs.set(b.id, img);
    }
    // Pre-render player building styles.
    for (const [kind, s] of Object.entries(PLAYER_STYLE)) {
      this.playerArt.set(kind, makeBuildingTexture(this, `pb-${kind}`, 2, 2, s.h, s.wall, s.roof, s.style, s.chimney));
    }
  }

  private makeInteractive(obj: Phaser.GameObjects.Image, label: string, onClick: () => void) {
    obj.setInteractive({ pixelPerfect: true, alphaTolerance: 40, useHandCursor: true });
    obj.on('pointerover', () => {
      obj.setTint(0xfff1cf);
      this.hoverLabel.setText(label).setVisible(true);
    });
    obj.on('pointerout', () => {
      obj.clearTint();
      this.hoverLabel.setVisible(false);
      this.refreshClosedTints();
    });
    obj.on('pointerup', () => {
      if (this.dragDist < 8) onClick();
    });
  }

  private buildStallsAndLamps() {
    const stalls: Array<[number, number]> = [[13, 13], [17, 13], [13, 17.2], [17.3, 17], [13, 15.6], [17.4, 14.4]];
    for (const [gx, gy] of stalls) {
      const { x, y } = iso(gx + 0.5, gy + 0.5);
      this.add.image(x, y + 8, 'stall').setOrigin(0.5, 0.9).setDepth(y + 8);
    }
    const lamps: Array<[number, number]> = [[13, 12.5], [18, 12.5], [12.5, 18], [18, 18], [15.6, 9], [9.6, 15.6], [21, 15.6], [15.6, 21], [22, 8.6], [9.6, 21.6]];
    for (const [gx, gy] of lamps) {
      const { x, y } = iso(gx, gy);
      this.add.image(x, y, 'lamp').setOrigin(0.5, 1).setDepth(y);
      const g = this.add.image(x, y - 34, 'glow').setBlendMode(Phaser.BlendModes.ADD).setDepth(y + 1).setAlpha(0).setScale(0.85);
      this.glows.push({ img: g, seed: Math.random() * 10 });
    }
  }

  // ---------------------------------------------------------------- NPCs ---
  private buildNpcs() {
    for (const [role, look] of Object.entries(ROLE_LOOK)) makeCharacterTexture(this, `npc-${role}`, look.tunic, look.hat, role.length * 31);
    const tunics = [0x8a5a3a, 0x5d7a8a, 0x9a8a5a, 0x6a4a6a, 0x4a6a4a, 0xa0603a, 0x7a7068];
    for (let i = 0; i < 10; i++) makeCharacterTexture(this, `citizen-${i}`, tunics[i % tunics.length], 'none', 100 + i * 17);

    for (const b of BUILDINGS) {
      if (!b.merchant) continue;
      const role = b.merchant === 'baker2' ? 'baker' : b.merchant;
      const home = iso(b.door.gx + 0.5, b.door.gy + 0.5);
      const sprite = this.add.image(home.x, home.y, `npc-${role}`).setOrigin(0.5, 0.95).setDepth(home.y);
      sprite.setInteractive({ useHandCursor: true });
      sprite.on('pointerup', () => this.dragDist < 8 && this.cb.onSelect({ type: 'merchant', id: b.merchant! }));
      const label = this.add.text(home.x, home.y - 34, '', { fontFamily: 'Manrope Variable, sans-serif', fontSize: '10px', color: '#f1e4c6', backgroundColor: 'rgba(14,11,8,0.7)', padding: { x: 4, y: 1 } }).setOrigin(0.5, 1).setDepth(99000).setAlpha(0.9);
      this.npcs.set(b.merchant, { sprite, path: [], speed: 38, home, merchantId: b.merchant, wait: 0, phase: Math.random() * 6, label });
    }
    this.caravan = this.add.image(0, 0, 'caravan').setOrigin(0.5, 0.85).setVisible(false);
  }

  private roadPoint(): { x: number; y: number } {
    const r = Math.random();
    if (r < 0.35) return iso(15.5, 4 + Math.random() * 24);
    if (r < 0.7) return iso(4 + Math.random() * 24, 15.5);
    if (r < 0.85) return iso(13 + Math.random() * 5, 13 + Math.random() * 5);
    return iso(9.5, 9 + Math.random() * 16);
  }

  private syncCitizens(population: number) {
    const target = Math.max(8, Math.min(40, Math.round(population / 14)));
    while (this.citizens.length < target) {
      const p = this.roadPoint();
      const sprite = this.add.image(p.x, p.y, `citizen-${this.citizens.length % 10}`).setOrigin(0.5, 0.95).setScale(0.9);
      this.citizens.push({ sprite, path: [this.roadPoint()], speed: 18 + Math.random() * 14, home: p, wait: Math.random() * 3, phase: Math.random() * 6 });
    }
    while (this.citizens.length > target) this.citizens.pop()!.sprite.destroy();
  }

  /** Route from a merchant's door to the market square along the main roads. */
  private routeToMarket(b: BuildingDef) {
    const d = b.door;
    const pts: Array<[number, number]> = [];
    if (Math.abs(d.gx - 15) < Math.abs(d.gy - 15)) pts.push([15.5, d.gy + 0.5], [15.5, d.gy < 15 ? 13.2 : 17.6]);
    else pts.push([d.gx + 0.5, 15.5], [d.gx < 15 ? 13.2 : 17.6, 15.5]);
    return pts.map(([x, y]) => iso(x, y));
  }

  // --------------------------------------------------------- atmosphere ---
  private buildAtmosphere() {
    const big = 6000;
    const c = iso(MAP / 2, MAP / 2);
    this.warmOverlay = this.add.rectangle(c.x, c.y, big, big, 0xff8a3d, 0).setDepth(90000).setBlendMode(Phaser.BlendModes.MULTIPLY);
    this.nightOverlay = this.add.rectangle(c.x, c.y, big, big, 0x0c1633, 0).setDepth(90001);
    // Glows above the night layer so lit windows shine through darkness.
    for (const g of this.glows) g.img.setDepth(90002);
    this.rain = this.add.particles(0, 0, 'raindrop', {
      x: { min: -800, max: 800 },
      y: -420,
      speedY: { min: 520, max: 680 },
      speedX: { min: -120, max: -90 },
      lifespan: 1300,
      quantity: 6,
      frequency: 18,
      alpha: { start: 0.7, end: 0.3 },
      emitting: false,
    }).setDepth(90010);
    this.snow = this.add.particles(0, 0, 'snowflake', {
      x: { min: -800, max: 800 },
      y: -420,
      speedY: { min: 40, max: 80 },
      speedX: { min: -30, max: 30 },
      lifespan: 9000,
      quantity: 2,
      frequency: 45,
      scale: { min: 0.5, max: 1.2 },
      alpha: { start: 0.95, end: 0.6 },
      emitting: false,
    }).setDepth(90010);
    for (let i = 0; i < 5; i++) {
      const p = iso(Math.random() * MAP, Math.random() * MAP);
      this.clouds.push(this.add.image(p.x, p.y, 'cloudshadow').setDepth(89999).setScale(2 + Math.random() * 2).setAlpha(0));
    }
  }

  private layoutOverlays() { /* overlays are world-sized; nothing to do */ }

  private setupCamera() {
    const cam = this.cameras.main;
    const minP = iso(0, MAP), maxP = iso(MAP, 0), bottom = iso(MAP, MAP);
    cam.setBounds(minP.x - 300, -400, maxP.x - minP.x + 600, bottom.y + 700);
    const center = iso(15.5, 15.5);
    cam.centerOn(center.x, center.y);
    cam.setZoom(this.scale.width < 700 ? 0.7 : 1.05);
    cam.setBackgroundColor('#141d10');

    this.input.on('pointerdown', () => (this.dragDist = 0));
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (this.hoverLabel.visible) this.hoverLabel.setPosition(p.worldX, p.worldY - 14);
      if (!p.isDown) return;
      const dx = p.x - p.prevPosition.x, dy = p.y - p.prevPosition.y;
      this.dragDist += Math.abs(dx) + Math.abs(dy);
      cam.scrollX -= dx / cam.zoom;
      cam.scrollY -= dy / cam.zoom;
    });
    this.input.on('wheel', (_p: unknown, _o: unknown, _dx: number, dy: number) => {
      cam.setZoom(Phaser.Math.Clamp(cam.zoom * (dy > 0 ? 0.9 : 1.1), 0.45, 2.2));
    });
    if (this.input.keyboard) {
      this.keys = this.input.keyboard.addKeys('W,A,S,D,UP,DOWN,LEFT,RIGHT,Q,E') as Record<string, Phaser.Input.Keyboard.Key>;
    }
  }

  zoomBy(f: number) {
    const cam = this.cameras.main;
    cam.zoomTo(Phaser.Math.Clamp(cam.zoom * f, 0.45, 2.2), 250);
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
    this.cameras.main.pan(p.x, p.y - 20, 600, 'Sine.easeInOut');
  }

  // ----------------------------------------------------- live world sync ---
  setWorld(snap: PublicSnapshot) {
    this.snap = snap;
    this.snapAt = performance.now();
    if (this.sys.isActive()) this.applySnapshot(snap);
  }

  private applySnapshot(snap: PublicSnapshot) {
    const season = snap.season;
    for (const g of this.grass) {
      if (season === 'winter') g.setTexture('snowgrass');
      else {
        if (g.texture.key === 'snowgrass') g.setTexture(`grass${Math.floor(Math.random() * 3)}`);
        g.setTint(SEASON_GRASS[season]);
      }
    }
    for (const f of this.fields) f.setTexture(`field-${season}`);
    for (const o of this.oaks) o.setTint(SEASON_OAK[season]);
    this.syncCitizens(snap.population);
    this.syncMerchants(snap);
    this.syncPlots(snap);
    this.applyWeather(snap.weather);
    this.floatFeed(snap.feed);
    this.refreshClosedTints();
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
      // A new trade sends the merchant walking to the market square and back.
      const prev = this.lastMerchantTrade.get(m.id);
      if (prev !== undefined && m.lastTradeTick > prev && npc.path.length === 0 && m.role !== 'banker') {
        npc.path = [...this.routeToMarket(b), ...this.routeToMarket(b).reverse().slice(1), npc.home];
      }
      this.lastMerchantTrade.set(m.id, m.lastTradeTick);
      // Bankrupt shops get a sign.
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

  private refreshClosedTints() {
    if (!this.snap) return;
    for (const m of this.snap.merchants) {
      const b = BUILDINGS.find((x) => x.merchant === m.id);
      const img = b && this.buildingImgs.get(b.id);
      if (img && m.status === 'bankrupt') img.setTint(0x8a8078);
      else if (img && m.status === 'struggling') img.setTint(0xe8d8c8);
    }
  }

  private syncPlots(snap: PublicSnapshot) {
    const me = this.cb.getPlayerId();
    const key = snap.businesses.map((b) => `${b.id}:${b.plot}:${b.kind}:${b.ownerId}`).join('|') + `|${me}`;
    if (key === this.plotKey) return;
    this.plotKey = key;
    this.plotLayer.forEach((o) => o.destroy());
    this.plotLayer = [];
    PLOTS.forEach((pl, i) => {
      const biz = snap.businesses.find((b) => b.plot === i);
      if (!biz) {
        const p = iso(pl.gx + 1, pl.gy + 1);
        const g = this.add.graphics().setDepth(-9000);
        g.lineStyle(1.5, 0xf4c96b, 0.35);
        const n = iso(pl.gx, pl.gy), e = iso(pl.gx + 2, pl.gy), s = iso(pl.gx + 2, pl.gy + 2), w = iso(pl.gx, pl.gy + 2);
        g.strokePoints([n, e, s, w], true);
        const sign = this.add.image(p.x, p.y + 4, 'signpost').setOrigin(0.5, 1).setDepth(p.y + 4);
        this.makeInteractive(sign, 'Empty plot — open a business here', () => this.cb.onSelect({ type: 'plot', plot: i }));
        this.plotLayer.push(g, sign);
        return;
      }
      const art = this.playerArt.get(biz.kind)!;
      const img = this.placeBuilding({ gx: pl.gx, gy: pl.gy, w: 2, d: 2 }, art);
      this.makeInteractive(img, `${biz.owner}'s ${biz.kind} (Lv ${biz.level})`, () => this.cb.onSelect({ type: 'plot', plot: i, businessId: biz.id, ownerId: biz.ownerId }));
      this.plotLayer.push(img);
      if (biz.ownerId === me) {
        const f = iso(pl.gx + 0.2, pl.gy + 2);
        this.plotLayer.push(this.add.image(f.x, f.y, 'flag').setOrigin(0.1, 1).setDepth(img.depth + 1));
      }
    });
  }

  private applyWeather(weather: string) {
    const s = this.cb.getSettings();
    const enabled = s.weather && !s.reducedMotion;
    const rainy = enabled && (weather === 'rain' || weather === 'storm');
    this.rain.emitting = rainy;
    if (rainy) this.rain.frequency = weather === 'storm' ? 8 : 18;
    this.snow.emitting = enabled && weather === 'snow';
    const cloudy = weather === 'cloudy' || weather === 'rain' || weather === 'storm' || weather === 'snow';
    for (const c of this.clouds) this.tweens.add({ targets: c, alpha: cloudy ? 0.7 : 0.15, duration: 2000 });
  }

  private floatFeed(feed: FeedEntry[]) {
    for (const f of feed) {
      if (f.id <= this.seenFeed) continue;
      this.seenFeed = f.id;
      if (f.kind !== 'trade' || !f.actor || !f.resource) continue;
      const b = BUILDINGS.find((x) => x.merchant === f.actor);
      if (!b) continue;
      const qty = Number(f.data?.qty ?? 0);
      const sold = f.text.includes(' sold ');
      const p = iso(b.gx + b.w / 2, b.gy + b.d / 2);
      const t = this.add
        .text(p.x, p.y - b.h - 30, `${sold ? '−' : '+'}${qty} ${f.resource}`, { fontFamily: 'Manrope Variable, sans-serif', fontStyle: 'bold', fontSize: '12px', color: sold ? '#f4c96b' : '#9fe0a0', stroke: '#140f0b', strokeThickness: 3 })
        .setOrigin(0.5)
        .setDepth(99800);
      this.tweens.add({ targets: t, y: t.y - 36, alpha: 0, duration: 2200, ease: 'Sine.easeOut', onComplete: () => t.destroy() });
    }
  }

  private shimmerWater() {
    this.waterFrame ^= 1;
    for (let i = 0; i < this.water.length; i++) if ((i + this.waterFrame) % 3 === 0) this.water[i].setTexture(`water${(i + this.waterFrame) % 2}`);
  }

  /** 0 (day) … 1 (deep night), with smooth dawn and dusk. */
  private nightFactor(hour: number) {
    if (hour >= 21 || hour < 4) return 1;
    if (hour >= 4 && hour < 7) return 1 - (hour - 4) / 3;
    if (hour >= 18 && hour < 21) return (hour - 18) / 3;
    return 0;
  }

  update(time: number, delta: number) {
    const dt = delta / 1000;
    const cam = this.cameras.main;
    if (this.keys) {
      const k = this.keys;
      const sp = (480 * dt) / cam.zoom;
      if (k.A.isDown || k.LEFT.isDown) cam.scrollX -= sp;
      if (k.D.isDown || k.RIGHT.isDown) cam.scrollX += sp;
      if (k.W.isDown || k.UP.isDown) cam.scrollY -= sp;
      if (k.S.isDown || k.DOWN.isDown) cam.scrollY += sp;
      if (Phaser.Input.Keyboard.JustDown(k.Q)) this.zoomBy(0.85);
      if (Phaser.Input.Keyboard.JustDown(k.E)) this.zoomBy(1.18);
    }

    // Time of day, interpolated between server ticks.
    if (this.snap) {
      const frac = Math.min(1, (performance.now() - this.snapAt) / 2000);
      const hour = (this.snap.hour + frac) % 24;
      const n = this.nightFactor(hour);
      const duskness = hour >= 16 && hour < 21 ? 1 - Math.abs(hour - 18.5) / 2.5 : hour >= 4 && hour < 8 ? 1 - Math.abs(hour - 6) / 2 : 0;
      this.nightOverlay.setFillStyle(0x0c1633, 0.58 * n);
      const heat = this.snap.weather === 'heatwave' ? 0.12 : 0;
      this.warmOverlay.setFillStyle(this.snap.weather === 'storm' ? 0x8090a8 : 0xffa060, Math.max(0, duskness) * 0.3 + heat + (this.snap.weather === 'storm' ? 0.25 : 0));
      for (const g of this.glows) g.img.setAlpha(n * (0.75 + 0.25 * Math.sin(time / 260 + g.seed)));
      if (this.snap.weather === 'storm' && this.cb.getSettings().weather && !this.cb.getSettings().reducedMotion && Math.random() < 0.0015) cam.flash(180, 220, 230, 255);
    }

    // Weather emitters follow the view.
    const v = cam.worldView;
    this.rain.setPosition(v.centerX, v.y);
    this.snow.setPosition(v.centerX, v.y);
    for (const c of this.clouds) {
      c.x += 12 * dt;
      if (c.x > v.right + 600) c.x = v.x - 600;
    }

    const step = (npc: Npc, idle: boolean) => {
      if (npc.wait > 0) {
        npc.wait -= dt;
        return;
      }
      const target = npc.path[0];
      if (!target) {
        if (idle) {
          // Idle bob at the door.
          npc.phase += dt * 2;
          npc.sprite.y = npc.home.y + Math.sin(npc.phase) * 0.6;
        }
        return;
      }
      const dx = target.x - npc.sprite.x, dy = target.y - npc.sprite.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 2) {
        npc.path.shift();
        if (npc.path.length === 0 && !idle) npc.path.push(this.roadPoint());
        if (npc.path.length && npc.merchantId) npc.wait = 0.4;
        else if (!npc.merchantId) npc.wait = Math.random() * 2;
        return;
      }
      const s = Math.min(dist, npc.speed * dt);
      npc.sprite.x += (dx / dist) * s;
      npc.sprite.y += (dy / dist) * s;
      npc.sprite.setFlipX(dx < 0);
      npc.phase += dt * 10;
      npc.sprite.setAngle(Math.sin(npc.phase) * 4);
    };
    for (const npc of this.npcs.values()) {
      step(npc, true);
      npc.sprite.setDepth(npc.sprite.y + 1);
      npc.label?.setPosition(npc.sprite.x, npc.sprite.y - 32);
      if (!npc.path.length) npc.sprite.setAngle(0);
    }
    for (const c of this.citizens) {
      step(c, false);
      c.sprite.setDepth(c.sprite.y);
    }
  }
}
