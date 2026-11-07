import type * as Phaser from 'phaser';
import { PAL, mix, rng, shade } from './palette';

/**
 * Character sprite sheets. Every character is drawn once into a single texture
 * strip (one atlas per look) holding all animation frames:
 *
 *   idle0 idle1 | walk0..3 | work0 work1 | carry0..3 | cheer0 cheer1 | sad0 sad1 | sleep0
 *
 * Frames are 28×40 px, feet at (14, 37). Animations are registered with Phaser's
 * animation manager so NPCs breathe, walk, run (walk at 2× rate), work, carry
 * goods, celebrate, slump in frustration and doze.
 */
export const FRAME_W = 28;
export const FRAME_H = 40;
export const FOOT = { x: 14, y: 37 };

export interface Look {
  skin: number;
  hair: number;
  tunic: number;
  trousers: number;
  accent: number;
  hat: 'straw' | 'toque' | 'cap' | 'hood' | 'tophat' | 'helmet' | 'scarf' | 'none' | 'beret' | 'kerchief';
  /** Body width multiplier (stocky vs slender). */
  build: number;
  /** Height multiplier. */
  height: number;
  beard?: boolean;
  apron?: number;
  cape?: number;
  tool?: 'pitchfork' | 'paddle' | 'hammer' | 'ledger' | 'pick' | 'net' | 'shuttle' | 'axe' | 'none';
  carry: 'sack' | 'crate' | 'basket' | 'bread' | 'fish' | 'cloth' | 'logs' | 'coin';
}

export const LOOKS: Record<string, Look> = {
  farmer: { skin: 0xe0b08a, hair: 0x6b4a2a, tunic: 0x6f8f3e, trousers: 0x6b4a2e, accent: 0xd9b45a, hat: 'straw', build: 1.12, height: 1, beard: true, tool: 'pitchfork', carry: 'sack' },
  baker: { skin: 0xf1c9a5, hair: 0x9a5a2a, tunic: 0xe2a35a, trousers: 0x5c4030, accent: 0xffffff, hat: 'toque', build: 1.08, height: 0.96, apron: 0xf4efe4, tool: 'paddle', carry: 'bread' },
  baker2: { skin: 0xd9a47a, hair: 0xd0d0cc, tunic: 0xb8862b, trousers: 0x4a3a2a, accent: 0xffffff, hat: 'toque', build: 1.2, height: 0.94, apron: 0xe9e2d0, beard: true, tool: 'paddle', carry: 'bread' },
  blacksmith: { skin: 0xc68e62, hair: 0x2a1c14, tunic: 0x5a4a44, trousers: 0x3a3030, accent: 0xd9a84a, hat: 'kerchief', build: 1.25, height: 1.05, apron: 0x6b4a2e, tool: 'hammer', carry: 'crate' },
  trader: { skin: 0xe8c09a, hair: 0x2a1a14, tunic: 0x2f5e8e, trousers: 0x3a3a48, accent: 0xd9a84a, hat: 'hood', build: 0.92, height: 1.02, cape: 0x1f3f5f, tool: 'none', carry: 'crate' },
  banker: { skin: 0xf1d0b0, hair: 0x8a8a8a, tunic: 0x2c3550, trousers: 0x1d2234, accent: 0xd9a84a, hat: 'tophat', build: 0.95, height: 1.06, cape: 0x4a1e2a, tool: 'ledger', carry: 'coin' },
  miner: { skin: 0xb07a52, hair: 0x3a2a1a, tunic: 0x6b5d4a, trousers: 0x4a4038, accent: 0xffe08a, hat: 'helmet', build: 1.18, height: 0.97, beard: true, tool: 'pick', carry: 'sack' },
  fisher: { skin: 0xd9a47a, hair: 0x1e1e1e, tunic: 0x3f7f8a, trousers: 0x2f4a55, accent: 0xe8dcc0, hat: 'cap', build: 1, height: 1, tool: 'net', carry: 'fish' },
  weaver: { skin: 0xf1c9a5, hair: 0x5a2a1a, tunic: 0x9a5f8e, trousers: 0x5a3a55, accent: 0xe9c46a, hat: 'scarf', build: 0.9, height: 0.98, apron: 0xe6dcc8, tool: 'shuttle', carry: 'cloth' },
  woodcutter: { skin: 0xc68e62, hair: 0x7a3a1a, tunic: 0x4d6b3a, trousers: 0x4a3a28, accent: 0xa0522d, hat: 'hood', build: 1.22, height: 1.07, beard: true, tool: 'axe', carry: 'logs' },
};

const SKINS = [0xf1c9a5, 0xe0b08a, 0xc68e62, 0xa06a44, 0x8a5a3a];
const HAIRS = [0x2a1c14, 0x6b4a2a, 0x9a5a2a, 0xd0b070, 0x1e1e1e, 0x8a8a8a];
const CLOTH = [0x8a5a3a, 0x5d7a8a, 0x9a8a5a, 0x6a4a6a, 0x4a6a4a, 0xa0603a, 0x7a7068, 0xb5452e, 0x3f6a8a];
const HATS: Look['hat'][] = ['none', 'none', 'beret', 'cap', 'kerchief', 'none', 'scarf'];

export function citizenLook(i: number): Look {
  const r = rng(500 + i * 13);
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
  return {
    skin: pick(SKINS), hair: pick(HAIRS), tunic: pick(CLOTH), trousers: shade(pick(CLOTH), 0.7), accent: pick(CLOTH),
    hat: pick(HATS), build: 0.88 + r() * 0.3, height: 0.88 + r() * 0.16, beard: r() > 0.75, apron: r() > 0.8 ? 0xe9e2d0 : undefined,
    tool: 'none', carry: pick(['basket', 'sack', 'crate', 'bread', 'fish'] as Look['carry'][]),
  };
}

type G = Phaser.GameObjects.Graphics;
type Pose = { bob: number; legA: number; legB: number; armA: number; armB: number; lean: number; carry: boolean; cheer: boolean; sad: boolean; sleep: boolean; workArm?: number };

const FRAMES: Array<[string, Pose]> = [
  ['idle0', { bob: 0, legA: 0, legB: 0, armA: 0, armB: 0, lean: 0, carry: false, cheer: false, sad: false, sleep: false }],
  ['idle1', { bob: -0.7, legA: 0, legB: 0, armA: 0.5, armB: -0.5, lean: 0, carry: false, cheer: false, sad: false, sleep: false }],
  ['walk0', { bob: 0, legA: 3, legB: -3, armA: -3, armB: 3, lean: 0.5, carry: false, cheer: false, sad: false, sleep: false }],
  ['walk1', { bob: -1.2, legA: 0, legB: 0, armA: 0, armB: 0, lean: 0.5, carry: false, cheer: false, sad: false, sleep: false }],
  ['walk2', { bob: 0, legA: -3, legB: 3, armA: 3, armB: -3, lean: 0.5, carry: false, cheer: false, sad: false, sleep: false }],
  ['walk3', { bob: -1.2, legA: 0, legB: 0, armA: 0, armB: 0, lean: 0.5, carry: false, cheer: false, sad: false, sleep: false }],
  ['work0', { bob: 0, legA: 1, legB: -1, armA: 0, armB: 0, lean: 0.6, carry: false, cheer: false, sad: false, sleep: false, workArm: -9 }],
  ['work1', { bob: 0.6, legA: 1, legB: -1, armA: 0, armB: 0, lean: 1.4, carry: false, cheer: false, sad: false, sleep: false, workArm: 4 }],
  ['carry0', { bob: 0, legA: 2.5, legB: -2.5, armA: 0, armB: 0, lean: 0.3, carry: true, cheer: false, sad: false, sleep: false }],
  ['carry1', { bob: -1, legA: 0, legB: 0, armA: 0, armB: 0, lean: 0.3, carry: true, cheer: false, sad: false, sleep: false }],
  ['carry2', { bob: 0, legA: -2.5, legB: 2.5, armA: 0, armB: 0, lean: 0.3, carry: true, cheer: false, sad: false, sleep: false }],
  ['carry3', { bob: -1, legA: 0, legB: 0, armA: 0, armB: 0, lean: 0.3, carry: true, cheer: false, sad: false, sleep: false }],
  ['cheer0', { bob: -3, legA: 1.5, legB: -1.5, armA: 0, armB: 0, lean: 0, carry: false, cheer: true, sad: false, sleep: false }],
  ['cheer1', { bob: 0, legA: 0, legB: 0, armA: 0, armB: 0, lean: 0, carry: false, cheer: true, sad: false, sleep: false }],
  ['sad0', { bob: 1, legA: 0, legB: 0, armA: 1, armB: -1, lean: 1.5, carry: false, cheer: false, sad: true, sleep: false }],
  ['sad1', { bob: 1.4, legA: 0, legB: 0, armA: 1.5, armB: -1.5, lean: 2, carry: false, cheer: false, sad: true, sleep: false }],
  ['sleep0', { bob: 1.6, legA: 0, legB: 0, armA: 0, armB: 0, lean: 2.2, carry: false, cheer: false, sad: false, sleep: true }],
];
const FRAME_INDEX = Object.fromEntries(FRAMES.map(([n], i) => [n, i]));

function drawCarry(g: G, cx: number, cy: number, kind: Look['carry']) {
  switch (kind) {
    case 'sack': g.fillStyle(0xc9a46c, 1); g.fillEllipse(cx, cy, 11, 9); g.fillStyle(0x9a7a4a, 1); g.fillRect(cx - 1.5, cy - 5.5, 3, 2.5); break;
    case 'crate': g.fillStyle(0x9a6a3c, 1); g.fillRect(cx - 5.5, cy - 4.5, 11, 9); g.lineStyle(1, 0x5c3a20, 1); g.strokeRect(cx - 5.5, cy - 4.5, 11, 9); g.lineBetween(cx - 5.5, cy - 4.5, cx + 5.5, cy + 4.5); break;
    case 'basket': g.fillStyle(0xb08850, 1); g.fillEllipse(cx, cy + 1, 11, 7); g.fillStyle(0xd2643a, 1); g.fillCircle(cx - 2, cy - 2, 2); g.fillStyle(0x8fb35f, 1); g.fillCircle(cx + 2, cy - 2, 2); break;
    case 'bread': g.fillStyle(0xb08850, 1); g.fillEllipse(cx, cy + 1.5, 12, 6); g.fillStyle(0xd08a45, 1); g.fillEllipse(cx - 2, cy - 1, 6, 3.5); g.fillEllipse(cx + 2.5, cy - 0.5, 6, 3.5); break;
    case 'fish': g.fillStyle(0x7a5a3a, 1); g.fillRect(cx - 5, cy - 2, 10, 6); g.fillStyle(0x8fc3e0, 1); g.fillEllipse(cx - 1, cy - 2, 7, 2.6); g.fillEllipse(cx + 2, cy - 3, 7, 2.6); break;
    case 'cloth': g.fillStyle(0x9b6fb5, 1); g.fillRect(cx - 5.5, cy - 3.5, 11, 4); g.fillStyle(0xe9c46a, 1); g.fillRect(cx - 5.5, cy + 0.5, 11, 3.5); break;
    case 'logs': g.fillStyle(0x8a5a33, 1); g.fillRect(cx - 6, cy - 3, 12, 3); g.fillRect(cx - 6, cy, 12, 3); g.fillStyle(0xe2b989, 1); g.fillCircle(cx + 6, cy - 1.5, 1.5); g.fillCircle(cx + 6, cy + 1.5, 1.5); break;
    case 'coin': g.fillStyle(0x6b3a2a, 1); g.fillEllipse(cx, cy, 9, 8); g.fillStyle(PAL.goldBright, 1); g.fillCircle(cx - 1, cy - 3, 1.6); g.fillCircle(cx + 2, cy - 3.5, 1.6); break;
  }
}

function drawFrame(g: G, ox: number, look: Look, p: Pose) {
  const cx = ox + FOOT.x + p.lean;
  const groundY = FOOT.y;
  const bw = 5.2 * look.build; // half body width
  const hs = look.height;
  const hipY = groundY - 9 * hs + p.bob * 0.4;
  const shoulderY = hipY - 10 * hs + p.bob * 0.3;
  const headY = shoulderY - 4.6 + p.bob * 0.2 + (p.sad ? 1.6 : 0) + (p.sleep ? 2.2 : 0);
  const headX = cx + (p.sleep ? 2.4 : p.sad ? 1.2 : 0);
  const outline = 0x1a120c;

  // Contact shadow.
  g.fillStyle(0x000000, 0.28);
  g.fillEllipse(ox + FOOT.x, groundY + 0.5, 15 * look.build, 4.5);

  // Cape behind body.
  if (look.cape) {
    g.fillStyle(shade(look.cape, 0.85), 1);
    g.fillPoints([{ x: cx - bw - 1, y: shoulderY }, { x: cx + bw + 1, y: shoulderY }, { x: cx + bw + 2.5, y: hipY + 6 }, { x: cx - bw - 2.5, y: hipY + 6 }], true);
  }
  // Legs.
  const leg = (x: number, swing: number, color: number) => {
    g.fillStyle(outline, 1);
    g.fillRoundedRect(x - 1.9 + swing * 0.3, hipY - 0.5, 3.8, groundY - hipY + 0.5, 1.4);
    g.fillStyle(color, 1);
    g.fillRoundedRect(x - 1.4 + swing * 0.3, hipY, 2.8, groundY - hipY - 1.6, 1.2);
    g.fillStyle(0x2a1a10, 1);
    g.fillRoundedRect(x - 2 + swing, groundY - 2.4, 4.2, 2.6, 1);
  };
  leg(cx - 2, p.legB, shade(look.trousers, 0.82));
  leg(cx + 2, p.legA, look.trousers);

  // Torso with shading and belt.
  g.fillStyle(outline, 1);
  g.fillRoundedRect(cx - bw - 0.6, shoulderY - 0.6, bw * 2 + 1.2, hipY - shoulderY + 3.2, 3);
  g.fillStyle(look.tunic, 1);
  g.fillRoundedRect(cx - bw, shoulderY, bw * 2, hipY - shoulderY + 2, 2.6);
  g.fillStyle(shade(look.tunic, 0.78), 1);
  g.fillRoundedRect(cx + bw * 0.25, shoulderY + 0.6, bw * 0.75, hipY - shoulderY + 1.4, 2);
  g.fillStyle(mix(look.tunic, 0xffffff, 0.2), 1);
  g.fillRect(cx - bw + 0.8, shoulderY + 1, 1.2, hipY - shoulderY - 1);
  if (look.apron) {
    g.fillStyle(look.apron, 1);
    g.fillRoundedRect(cx - bw * 0.7, shoulderY + 2.6, bw * 1.4, hipY - shoulderY + 1.6, 1.6);
  }
  g.fillStyle(0x3a2414, 1);
  g.fillRect(cx - bw, hipY - 1.6, bw * 2, 1.8);
  g.fillStyle(look.accent, 1);
  g.fillRect(cx - 1, hipY - 1.6, 2, 1.8);

  // Arms.
  const arm = (side: number, swing: number, raised: number | undefined, color: number) => {
    const sx = cx + side * (bw + 0.6);
    const ex = sx + side * 0.6 + swing * 0.5;
    const ey = raised !== undefined ? shoulderY + raised : shoulderY + 8.2;
    g.lineStyle(3.6, outline, 1);
    g.lineBetween(sx, shoulderY + 1.4, ex, ey);
    g.lineStyle(2.6, color, 1);
    g.lineBetween(sx, shoulderY + 1.4, ex, ey);
    g.fillStyle(look.skin, 1);
    g.fillCircle(ex, ey + 0.6, 1.5);
    return { x: ex, y: ey };
  };
  if (p.cheer) {
    arm(-1, 0, -10, shade(look.tunic, 0.9));
    arm(1, 0, -10, look.tunic);
  } else if (p.carry) {
    // Goods held at the chest with both hands.
    arm(-1, 2, 4.5, shade(look.tunic, 0.9));
    arm(1, -2, 4.5, look.tunic);
    drawCarry(g, cx, shoulderY + 3.5, look.carry);
  } else {
    arm(-1, p.armB, undefined, shade(look.tunic, 0.88));
    const hand = arm(1, p.armA, p.workArm, look.tunic);
    // Tools in the working hand.
    if (look.tool && look.tool !== 'none' && !p.sleep && !p.sad) {
      const tx = hand.x, ty = hand.y;
      const up = p.workArm !== undefined && p.workArm < 0;
      g.lineStyle(1.4, 0x6b4325, 1);
      switch (look.tool) {
        case 'hammer': g.lineBetween(tx, ty, tx + (up ? 3 : 4), ty + (up ? -6 : 4)); g.fillStyle(0x8c95a0, 1); g.fillRect(tx + (up ? 1 : 3), ty + (up ? -8 : 3), 5, 3); break;
        case 'pick': g.lineBetween(tx, ty, tx + 3, ty + (up ? -7 : 5)); g.lineStyle(1.6, 0x8c95a0, 1); g.lineBetween(tx - 1, ty + (up ? -7 : 5), tx + 7, ty + (up ? -6 : 4)); break;
        case 'axe': g.lineBetween(tx, ty, tx + 3, ty + (up ? -7 : 5)); g.fillStyle(0xb8c0ca, 1); g.fillTriangle(tx + 2, ty + (up ? -8 : 4), tx + 6, ty + (up ? -9 : 3), tx + 5, ty + (up ? -5 : 7)); break;
        case 'pitchfork': g.lineBetween(tx, ty + 6, tx + 1, ty - 10); g.lineStyle(1, 0x8c95a0, 1); for (const dx of [-1.5, 0.5, 2.5]) g.lineBetween(tx + dx, ty - 10, tx + dx, ty - 14); break;
        case 'paddle': g.lineBetween(tx, ty + 5, tx + 1, ty - 9); g.fillStyle(0xc9a46c, 1); g.fillEllipse(tx + 1, ty - 11, 5, 4); break;
        case 'ledger': g.fillStyle(0x6b2a2a, 1); g.fillRect(tx - 1, ty - 2, 5, 6); g.fillStyle(PAL.goldBright, 1); g.fillRect(tx - 1, ty - 2, 1, 6); break;
        case 'net': g.lineStyle(0.8, 0xe8dcc0, 0.9); g.strokeCircle(tx + 3, ty + 2, 3); g.lineBetween(tx + 1, ty, tx + 5, ty + 4); break;
        case 'shuttle': g.fillStyle(0xd9b45a, 1); g.fillEllipse(tx + 2, ty + 1, 6, 2.4); break;
      }
    }
  }

  // Head.
  g.fillStyle(outline, 1);
  g.fillCircle(headX, headY, 5.4);
  g.fillStyle(look.skin, 1);
  g.fillCircle(headX, headY, 4.8);
  g.fillStyle(shade(look.skin, 0.86), 1);
  g.fillCircle(headX + 1.4, headY + 0.8, 3.4);
  g.fillStyle(look.skin, 1);
  g.fillCircle(headX - 0.4, headY - 0.3, 3.8);
  // Hair.
  g.fillStyle(look.hair, 1);
  g.fillEllipse(headX - 0.4, headY - 3.4, 9.4, 4.4);
  g.fillRect(headX - 4.6, headY - 3.2, 1.8, 4);
  if (look.beard) {
    g.fillStyle(look.hair, 1);
    g.fillEllipse(headX + 0.4, headY + 3.4, 7, 4.2);
  }
  // Face.
  if (p.sleep) {
    g.lineStyle(0.9, 0x2a1a10, 1);
    g.lineBetween(headX + 0.6, headY - 0.2, headX + 2.2, headY - 0.2);
    g.lineBetween(headX - 2.6, headY - 0.2, headX - 1, headY - 0.2);
  } else {
    g.fillStyle(0x1a120c, 1);
    g.fillCircle(headX + 1.6, headY - 0.4, 0.75);
    g.fillCircle(headX - 1.6, headY - 0.4, 0.75);
    g.fillStyle(0xffffff, 0.8);
    g.fillCircle(headX + 1.8, headY - 0.7, 0.3);
    g.fillStyle(0xd27a6a, 0.35);
    g.fillCircle(headX + 2.8, headY + 1.4, 1.2);
    g.fillCircle(headX - 2.6, headY + 1.4, 1.2);
    g.lineStyle(0.9, 0x6a2a1a, 1);
    if (p.cheer) {
      g.beginPath(); g.arc(headX, headY + 1.6, 1.8, 0.1, Math.PI - 0.1); g.strokePath();
    } else if (p.sad) {
      g.beginPath(); g.arc(headX, headY + 3.6, 1.6, Math.PI + 0.3, -0.3); g.strokePath();
      g.lineStyle(0.8, 0x2a1a10, 1);
      g.lineBetween(headX - 2.6, headY - 2.2, headX - 0.8, headY - 1.5);
      g.lineBetween(headX + 2.6, headY - 2.2, headX + 0.8, headY - 1.5);
    } else if (!look.beard) {
      g.lineBetween(headX - 0.8, headY + 2.2, headX + 1, headY + 2.2);
    }
  }
  // Hats.
  const hx = headX, hy = headY;
  switch (look.hat) {
    case 'straw': g.fillStyle(0xe3c46a, 1); g.fillEllipse(hx, hy - 3.4, 15, 4.2); g.fillStyle(0xd4b25a, 1); g.fillRoundedRect(hx - 3.6, hy - 8, 7.2, 5, 2); g.fillStyle(0xb5452e, 1); g.fillRect(hx - 3.6, hy - 4.6, 7.2, 1.2); break;
    case 'toque': g.fillStyle(0xffffff, 1); g.fillRect(hx - 4, hy - 7, 8, 4.5); g.fillCircle(hx - 2.2, hy - 8.6, 3); g.fillCircle(hx + 2.2, hy - 8.6, 3); g.fillCircle(hx, hy - 10, 3); g.fillStyle(0xdedede, 1); g.fillRect(hx - 4, hy - 3.4, 8, 1.4); break;
    case 'cap': g.fillStyle(0x2f6f7f, 1); g.fillEllipse(hx, hy - 4.2, 10, 5); g.fillRect(hx, hy - 4, 7, 1.8); break;
    case 'hood': g.fillStyle(look.cape ?? shade(look.tunic, 0.75), 1); g.fillEllipse(hx - 0.6, hy - 1.6, 12, 11); g.fillStyle(look.skin, 1); g.fillCircle(hx + 0.4, hy + 0.2, 3.6); g.fillStyle(0x1a120c, 1); g.fillCircle(hx + 1.8, hy - 0.4, 0.75); g.fillCircle(hx - 1.2, hy - 0.4, 0.75); break;
    case 'tophat': g.fillStyle(0x1d1d24, 1); g.fillRect(hx - 3.6, hy - 13, 7.2, 9); g.fillRect(hx - 6, hy - 4.6, 12, 2.2); g.fillStyle(PAL.gold, 1); g.fillRect(hx - 3.6, hy - 6.6, 7.2, 1.4); break;
    case 'helmet': g.fillStyle(0x8a7a52, 1); g.fillEllipse(hx, hy - 3.8, 11.4, 6.6); g.fillStyle(0xffe08a, 1); g.fillCircle(hx + 1, hy - 5.4, 1.8); g.fillStyle(0xffffff, 0.8); g.fillCircle(hx + 1.4, hy - 5.8, 0.6); break;
    case 'scarf': g.fillStyle(0x8b4f87, 1); g.fillEllipse(hx - 0.4, hy - 3.6, 11, 6); g.fillTriangle(hx - 5, hy - 2, hx - 7, hy + 4, hx - 3, hy + 1); break;
    case 'beret': g.fillStyle(look.accent, 1); g.fillEllipse(hx - 1, hy - 4.6, 10, 4.2); break;
    case 'kerchief': g.fillStyle(0x7a2a1a, 1); g.fillEllipse(hx, hy - 4, 10, 4.2); g.fillTriangle(hx - 4.8, hy - 3.6, hx - 7.4, hy - 1.2, hx - 4, hy - 1); break;
    default: break;
  }
}

/** Build one sprite-sheet texture per look and register its animations. */
export function buildCharacter(scene: Phaser.Scene, key: string, look: Look) {
  const g = scene.add.graphics();
  FRAMES.forEach(([, pose], i) => drawFrame(g, i * FRAME_W, look, pose));
  g.generateTexture(key, FRAMES.length * FRAME_W, FRAME_H);
  g.destroy();
  const tex = scene.textures.get(key);
  FRAMES.forEach(([name], i) => tex.add(name, 0, i * FRAME_W, 0, FRAME_W, FRAME_H));
  const anim = (name: string, frames: string[], frameRate: number, repeat = -1) => {
    const k = `${key}:${name}`;
    if (!scene.anims.exists(k)) scene.anims.create({ key: k, frames: frames.map((f) => ({ key, frame: f })), frameRate, repeat });
  };
  anim('idle', ['idle0', 'idle1'], 1.6);
  anim('walk', ['walk0', 'walk1', 'walk2', 'walk3'], 8);
  anim('run', ['walk0', 'walk1', 'walk2', 'walk3'], 14);
  anim('work', ['work0', 'work1'], 3.2);
  anim('carry', ['carry0', 'carry1', 'carry2', 'carry3'], 7);
  anim('cheer', ['cheer0', 'cheer1'], 5);
  anim('sad', ['sad0', 'sad1'], 1.2);
  anim('sleep', ['sleep0'], 1);
}

export const frameIndex = FRAME_INDEX;
