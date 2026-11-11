import { describe, expect, it } from 'vitest';
import { advanceWorld, createWorld, publicSnapshot, type PublicSnapshot } from '@mon/engine';
import { TOPICS, bestSpread, citizenMood, citizenProfile, citizenSays } from '../lib/townsfolk';

const snap = (): PublicSnapshot => { const w = createWorld(42); advanceWorld(w, 30); return publicSnapshot(w) as PublicSnapshot; };

describe('townsfolk', () => {
  it('gives every citizen a stable identity per city', () => {
    expect(citizenProfile(3, 'nearhaven')).toEqual(citizenProfile(3, 'nearhaven'));
    expect(citizenProfile(3, 'nearhaven').name).not.toBe(citizenProfile(3, 'kingsreach').name);
    const names = new Set(Array.from({ length: 40 }, (_, i) => citizenProfile(i, 'nearhaven').name));
    expect(names.size).toBeGreaterThan(30);
  });

  it('feels the town: hunger and bad events lower the mood', () => {
    const w = snap();
    const c = citizenProfile(1, 'nearhaven');
    const fed = citizenMood(c, { ...w, foodSatisfaction: 100, events: [], weather: 'clear' });
    const hungry = citizenMood(c, { ...w, foodSatisfaction: 40, events: [{ id: 1, kind: 'bandits', title: 'Bandits on the Roads', description: '', endsInHours: 30 }], weather: 'storm' } as PublicSnapshot);
    expect(hungry.score).toBeLessThan(fed.score);
    expect(hungry.why).toMatch(/Bread is short/);
  });

  it('answers every topic, and its price tip matches the real markets', () => {
    const w = snap();
    const c = citizenProfile(5, 'nearhaven');
    expect(citizenSays(c, w, 'hello', 0, 'Ada')).toContain('Ada');
    for (const t of TOPICS) expect(citizenSays(c, w, t.id).length).toBeGreaterThan(20);
    const s = bestSpread(w, 'nearhaven');
    if (s) {
      expect(w.markets[s.buyAt as 'nearhaven'].resources[s.resource as 'wheat'].price).toBeCloseTo(s.buy, 5);
      expect(s.sell / s.buy).toBeGreaterThan(1.25);
    }
  });
});
