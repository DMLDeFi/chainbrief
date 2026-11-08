import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { addRoute, bankDeposit, buyBusiness, buyLand, charterCity, foundSubsidiary, fundProject, makeOffer, registerPlayer, setCompanyName, stepWorld, assignBusiness } from '@mon/engine';
import { FileStore } from '../src/store/file';
import { GameService } from '../src/game';

describe('persistence across a restart', () => {
  it('keeps every part of an empire built with all six phases', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mon-persist-'));
    const store = new FileStore(dir);
    await store.init();
    const game = new GameService(store, { seed: 5, tickMs: 1000 });
    await game.init();
    const w = game.world;
    registerPlayer(w, 'a', 'Ada Tycoon');
    registerPlayer(w, 'b', 'Ben Owner');
    const a = w.players.a;
    Object.assign(a, { gold: 60000, level: 8 });
    w.players.b.gold = 500;
    for (const c of ['goldenvale', 'kingsreach'] as const) charterCity(w, 'a', c);
    const farm = buyBusiness(w, 'a', 'farm', 'goldenvale');
    const bank = buyBusiness(w, 'a', 'bank', 'kingsreach');
    const theirs = buyBusiness(w, 'b', 'farm');
    if (!farm.ok || !bank.ok || !theirs.ok) throw new Error('setup');
    bankDeposit(w, 'a', bank.data.id, 3000);
    buyLand(w, 'a', 'kingsreach');
    setCompanyName(w, 'a', 'Ada Holdings');
    const sub = foundSubsidiary(w, 'a', 'Vale Grain');
    if (!sub.ok) throw new Error(sub.error);
    assignBusiness(w, 'a', farm.data.id, sub.data.id);
    addRoute(w, 'a', { from: 'goldenvale', to: 'kingsreach', resource: 'wheat', batch: 10 });
    fundProject(w, 'a', { city: 'goldenvale', project: 'roads', amount: 400 });
    const offer = makeOffer(w, 'a', { businessId: theirs.data.id, price: 300 });
    if (!offer.ok) throw new Error(offer.error);
    for (let i = 0; i < 30; i++) stepWorld(w);
    const before = JSON.parse(JSON.stringify(w));
    await game.stop(); // writes the world snapshot

    // A fresh process: new store and service reading the same files.
    const store2 = new FileStore(dir);
    await store2.init();
    const game2 = new GameService(store2, { seed: 999, tickMs: 1000 });
    await game2.init();
    const w2 = game2.world;
    expect(w2.tick).toBe(before.tick);
    expect(w2.players.a.gold).toBeCloseTo(before.players.a.gold, 2);
    expect(w2.players.a.companyName).toBe('Ada Holdings');
    expect(w2.players.a.companies).toHaveLength(1);
    expect(w2.players.a.routes).toHaveLength(1);
    expect(w2.players.a.land).toHaveLength(1);
    expect(w2.businesses[farm.data.id].companyId).toBe(sub.data.id);
    expect(w2.businesses[bank.data.id].capital).toBe(before.businesses[bank.data.id].capital);
    expect(w2.offers[offer.data.id]?.price).toBe(300);
    expect(w2.cities.goldenvale.projects.roads?.funded).toBeGreaterThanOrEqual(400);
    expect(w2.markets.kingsreach.price.steel).toBeCloseTo(before.markets.kingsreach.price.steel, 6);
    // And the restored world keeps running.
    expect(() => { for (let i = 0; i < 30; i++) stepWorld(w2); }).not.toThrow();
    await game2.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
