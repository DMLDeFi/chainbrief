import * as Phaser from 'phaser';
import { TILE_H, TILE_W, iso } from './layout';
import { buildCharacter, type Look } from './art/characters';
import { findPath } from './pathfind';

/** Screen → grid (the inverse of `iso`). */
export const toGrid = (x: number, y: number) => ({ gx: (y / (TILE_H / 2) + x / (TILE_W / 2)) / 2, gy: (y / (TILE_H / 2) - x / (TILE_W / 2)) / 2 });

/** Somewhere the player can walk up to and enter. */
export interface Place<S> { gx: number; gy: number; label: string; select: S; /** How close counts as "at the door", in tiles (default 1.5). */ r?: number }

const SKINS = [0xf1c9a5, 0xe0b08a, 0xc68e62, 0xa06a44, 0x8a5a3a];
const HAIRS = [0x2a1c14, 0x6b4a2a, 0x9a5a2a, 0xd0b070, 0x1e1e1e];
const TUNICS = [0x7a1f2b, 0x2f4f8e, 0x3f6b3a, 0x5a2f6e, 0x8a5a1c];

/** A merchant's look from their id: everyone keeps the same face, with the gold cloak of a player. */
export function avatarLook(id: string): Look {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  const pick = <T,>(a: T[], s: number) => a[((h >>> s) & 0xff) % a.length];
  return {
    skin: pick(SKINS, 0), hair: pick(HAIRS, 8), tunic: pick(TUNICS, 16), trousers: 0x3a2e24, accent: 0xf0c45a,
    hat: (['beret', 'tophat', 'none', 'hood'] as Look['hat'][])[(h >>> 24) % 4], build: 1, height: 1.06,
    beard: ((h >>> 4) & 3) === 0, cape: 0xc9a227, tool: 'none', carry: 'coin',
  };
}

/**
 * The player's own merchant, walking the streets. Keys (WASD / arrows), the
 * on-screen joystick or a tap on the ground move them; the camera follows.
 * Walking up to a building offers to enter it.
 */
export class Avatar<S> {
  sprite!: Phaser.GameObjects.Sprite;
  private ring!: Phaser.GameObjects.Ellipse;
  private name!: Phaser.GameObjects.Text;
  private prompt!: Phaser.GameObjects.Text;
  private marker!: Phaser.GameObjects.Triangle;
  private t = 0;
  /** Waypoints of the current walk (from a tap or the minimap), screen coordinates. */
  private path: Array<{ x: number; y: number }> = [];
  private key = '';
  private target: { x: number; y: number } | null = null;
  private stuck = 0;
  /** Joystick vector from the page, each axis -1..1 (screen directions). */
  stick = { x: 0, y: 0 };
  /** Whether the camera follows the avatar (dragging the map turns it off until they move again). */
  following = true;
  near: Place<S> | null = null;
  moving = false;

  constructor(
    private scene: Phaser.Scene,
    private opts: {
      walkable: (gx: number, gy: number) => boolean;
      /** Draw order where the avatar stands (above buildings it is in front of). */
      depthAt: (gx: number, gy: number, y: number) => number;
      places: () => Array<Place<S>>;
      onEnter: (s: S) => void;
      onNear: (label: string | null) => void;
      start: { gx: number; gy: number };
      storageKey: string;
    },
  ) {}

  create(playerId: string, displayName: string) {
    const key = `avatar-${playerId}`;
    if (this.key === key) { this.name.setText(displayName); return; }
    if (!this.scene.textures.exists(key)) buildCharacter(this.scene, key, avatarLook(playerId));
    const saved = this.load();
    const p = iso(saved.gx, saved.gy);
    if (this.sprite) { this.sprite.destroy(); this.ring.destroy(); this.name.destroy(); this.prompt.destroy(); this.marker.destroy(); }
    this.key = key;
    this.ring = this.scene.add.ellipse(p.x, p.y, 30, 13, 0xf0c45a, 0.3).setStrokeStyle(2, 0xffe29a, 1);
    this.sprite = this.scene.add.sprite(p.x, p.y, key, 'idle0').setOrigin(0.5, 37 / 40).setScale(1.12);
    // A bobbing gold marker over your head: easy to spot in a crowd.
    this.marker = this.scene.add.triangle(p.x, p.y - 62, 0, 0, 12, 0, 6, 8, 0xf0c45a).setStrokeStyle(1.5, 0x5a3d1c).setDepth(99600);
    this.sprite.play(`${key}:idle`);
    this.name = this.scene.add.text(p.x, p.y - 46, displayName, { fontFamily: 'Cinzel, serif', fontSize: '11px', color: '#ffe29a', backgroundColor: 'rgba(26,18,11,0.85)', padding: { x: 6, y: 2 } }).setOrigin(0.5, 1).setDepth(99500);
    this.prompt = this.scene.add.text(p.x, p.y - 64, '', { fontFamily: 'Inter, sans-serif', fontSize: '12px', color: '#1a1208', backgroundColor: '#f0c45a', padding: { x: 8, y: 4 } })
      .setOrigin(0.5, 1).setDepth(99700).setVisible(false).setInteractive({ useHandCursor: true });
    this.prompt.on('pointerup', () => this.enter());
  }

  get ready() { return !!this.sprite; }

  /** Walk to a point on the map (from a tap). */
  walkTo(x: number, y: number) {
    const from = toGrid(this.sprite.x, this.sprite.y), to = toGrid(x, y);
    this.path = findPath(from, to, this.opts.walkable).map((g) => iso(g.gx, g.gy));
    this.target = this.path.shift() ?? null;
    this.stuck = 0;
    this.following = true;
  }

  enter() {
    if (this.near) this.opts.onEnter(this.near.select);
  }

  setVisible(on: boolean) {
    if (!this.sprite) return;
    for (const o of [this.sprite, this.ring, this.name, this.marker]) o.setVisible(on);
    if (!on) this.prompt.setVisible(false);
  }

  /** One frame. `keys` is the keyboard vector (already zero while the player types). */
  update(dt: number, keys: { x: number; y: number; run: boolean }) {
    if (!this.sprite || !this.sprite.visible) return;
    let vx = keys.x + this.stick.x, vy = keys.y + this.stick.y;
    const manual = Math.hypot(vx, vy) > 0.15;
    if (manual) { this.target = null; this.path = []; }
    else if (this.target) {
      vx = this.target.x - this.sprite.x;
      vy = this.target.y - this.sprite.y;
      if (Math.hypot(vx, vy) < 3) { this.target = this.path.shift() ?? null; vx = vy = 0; }
    }
    const len = Math.hypot(vx, vy);
    const speed = (keys.run || Math.hypot(this.stick.x, this.stick.y) > 0.9 ? 135 : 85) * dt;
    this.moving = false;
    if (len > 0.15) {
      // Isometric screens squash vertical distance, so vertical moves cover ground at the same pace.
      const dx = (vx / len) * speed, dy = (vy / len) * speed * (manual ? 0.75 : 1);
      const moved = this.tryMove(dx, dy) || this.tryMove(dx, 0) || this.tryMove(0, dy);
      if (moved) { this.moving = true; this.following = true; this.stuck = 0; }
      else if (this.target && (this.stuck += dt) > 0.4) { this.target = null; this.path = []; } // a wall in the way: stop trying
      if (Math.abs(dx) > 0.05) this.sprite.setFlipX(dx < 0);
    }
    const anim = this.moving ? (keys.run ? 'run' : 'walk') : 'idle';
    const animKey = `${this.key}:${anim}`;
    if (this.sprite.anims.currentAnim?.key !== animKey) this.sprite.play(animKey);
    const { x, y } = this.sprite;
    const g = toGrid(x, y);
    const depth = this.opts.depthAt(g.gx, g.gy, y);
    this.sprite.setDepth(depth + 1);
    this.ring.setPosition(x, y - 1).setDepth(depth + 0.5);
    this.name.setPosition(x, y - 46);
    this.t += dt;
    this.ring.setAlpha(0.75 + Math.sin(this.t * 4) * 0.25);
    this.marker.setPosition(x, y - 64 + Math.sin(this.t * 3) * 3).setVisible(!this.near);
    this.updateNear();
    this.prompt.setPosition(x, y - 62);
    if (this.moving) this.saveSoon();
  }

  private tryMove(dx: number, dy: number) {
    if (!dx && !dy) return false;
    const nx = this.sprite.x + dx, ny = this.sprite.y + dy;
    const g = toGrid(nx, ny);
    if (!this.opts.walkable(g.gx, g.gy)) return false;
    this.sprite.setPosition(nx, ny);
    return true;
  }

  private updateNear() {
    const g = toGrid(this.sprite.x, this.sprite.y);
    let best: Place<S> | null = null, bd = Infinity;
    for (const p of this.opts.places()) {
      const d = Math.hypot(p.gx - g.gx, p.gy - g.gy) / (p.r ?? 1.5);
      if (d < 1 && d < bd) { bd = d; best = p; }
    }
    if (best?.label !== this.near?.label) {
      this.near = best;
      this.opts.onNear(best ? best.label : null);
      this.prompt.setText(best ? `F · ${best.label}` : '').setVisible(!!best);
    } else this.near = best;
  }

  /** Where the avatar stands, in grid units (for the minimap). */
  grid() {
    return this.sprite ? toGrid(this.sprite.x, this.sprite.y) : null;
  }

  private saveAt = 0;
  private saveSoon() {
    const now = performance.now();
    if (now - this.saveAt < 1500) return;
    this.saveAt = now;
    try { localStorage.setItem(this.opts.storageKey, JSON.stringify(toGrid(this.sprite.x, this.sprite.y))); } catch { /* storage unavailable */ }
  }
  private load(): { gx: number; gy: number } {
    try {
      const v = JSON.parse(localStorage.getItem(this.opts.storageKey) ?? 'null');
      if (v && Number.isFinite(v.gx) && Number.isFinite(v.gy) && this.opts.walkable(v.gx, v.gy)) return v;
    } catch { /* storage unavailable */ }
    return this.opts.start;
  }
}

