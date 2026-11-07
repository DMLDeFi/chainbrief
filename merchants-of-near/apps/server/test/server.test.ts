import { beforeEach, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import { ed25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { base58, base64 } from '@scure/base';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { FileStore } from '../src/store/file';
import { GameService } from '../src/game';
import { NearService } from '../src/near/service';
import { NearRpc } from '../src/near/rpc';
import { MerchantDialogue } from '../src/ai';
import { nep413Payload, verifyNep413 } from '../src/near/nep413';
import { CertificateAuthority, deedMessage } from '../src/near/certificates';

process.env.NODE_ENV = 'test';
const CONTRACT = 'game.mon.testnet';

/** Scriptable fake NEAR RPC: tests decide what the chain says. */
class FakeChain {
  keys = new Map<string, string>(); // `${account}|${pk}` -> permission
  txs = new Map<string, unknown>();
  deeds = new Map<string, unknown>();
  reachable = true;
  fetch = (async (_url: string, init: { body: string }) => {
    if (!this.reachable) throw new Error('ECONNREFUSED');
    const { method, params } = JSON.parse(init.body);
    const ok = (result: unknown) => new Response(JSON.stringify({ jsonrpc: '2.0', id: 'mon', result }));
    const err = (name: string) => new Response(JSON.stringify({ jsonrpc: '2.0', id: 'mon', error: { name: 'HANDLER_ERROR', cause: { name }, message: name } }));
    if (method === 'query' && params.request_type === 'view_access_key') {
      const perm = this.keys.get(`${params.account_id}|${params.public_key}`);
      return perm ? ok({ permission: perm, nonce: 1 }) : err('UNKNOWN_ACCESS_KEY');
    }
    if (method === 'query' && params.request_type === 'call_function') {
      const args = JSON.parse(Buffer.from(params.args_base64, 'base64').toString());
      const v = this.deeds.get(args.token_id) ?? null;
      return ok({ result: [...Buffer.from(JSON.stringify(v))] });
    }
    if (method === 'tx') {
      const t = this.txs.get(params.tx_hash);
      return t ? ok(t) : err('UNKNOWN_TRANSACTION');
    }
    return err('METHOD_NOT_FOUND');
  }) as unknown as typeof fetch;
}

const authority = CertificateAuthority.generate();

async function setup() {
  const config = loadConfig({ GAME_AUTHORITY_SECRET: authority.secretHex, NEAR_CONTRACT_ID: CONTRACT, ALLOW_FAST_FORWARD: 'true' } as NodeJS.ProcessEnv);
  const store = new FileStore(null);
  await store.init();
  const game = new GameService(store, { seed: 99, tickMs: 1000 });
  await game.init();
  const chain = new FakeChain();
  const near = new NearService(config.near, store, new NearRpc('http://fake', chain.fetch));
  const app = await buildApp({ config, store, game, near, dialogue: new MerchantDialogue(undefined, 'claude-opus-5-5') });
  return { app, game, chain, store };
}

type Ctx = Awaited<ReturnType<typeof setup>>;
let ctx: Ctx;
beforeEach(async () => {
  ctx = await setup();
});

async function register(username = 'alice', merchantName = 'Alice Vane') {
  const r = await ctx.app.inject({ method: 'POST', url: '/api/auth/register', payload: { username, password: 'correct horse', merchantName } });
  expect(r.statusCode).toBe(200);
  const cookie = r.cookies.find((c) => c.name === 'mon_session')!;
  expect(cookie.httpOnly).toBe(true);
  return { cookie: `mon_session=${cookie.value}`, id: r.json().user.id as string };
}
const act = (cookie: string, action: unknown, requestId: string = crypto.randomUUID()) =>
  ctx.app.inject({ method: 'POST', url: '/api/action', headers: { cookie }, payload: { requestId, action } });

describe('authentication', () => {
  it('registers, rejects duplicates and bad passwords, and protects /api/me', async () => {
    expect((await ctx.app.inject({ method: 'GET', url: '/api/me' })).statusCode).toBe(401);
    const { cookie } = await register();
    const me = await ctx.app.inject({ method: 'GET', url: '/api/me', headers: { cookie } });
    expect(me.json().player.gold).toBe(100);
    expect(me.json().player.name).toBe('Alice Vane');
    const dup = await ctx.app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'ALICE', password: 'correct horse' } });
    expect(dup.statusCode).toBe(409);
    const bad = await ctx.app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'alice', password: 'wrong password' } });
    expect(bad.statusCode).toBe(401);
    const good = await ctx.app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'alice', password: 'correct horse' } });
    expect(good.statusCode).toBe(200);
    const stored = await ctx.store.userByName('alice');
    expect(stored?.passwordHash).toMatch(/^scrypt\$/);
    expect(stored?.passwordHash).not.toContain('correct horse');
  });

  it('logout invalidates the session', async () => {
    const { cookie } = await register();
    await ctx.app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie } });
    expect((await ctx.app.inject({ method: 'GET', url: '/api/me', headers: { cookie } })).statusCode).toBe(401);
  });
});

describe('authoritative actions', () => {
  it('executes trades server-side and ignores client-supplied prices', async () => {
    const { cookie } = await register();
    const r = await act(cookie, { type: 'trade', side: 'buy', resource: 'wheat', qty: 10, price: 0.0001, total: 0 });
    expect(r.statusCode).toBe(200);
    const me = (await ctx.app.inject({ method: 'GET', url: '/api/me', headers: { cookie } })).json();
    expect(me.player.inventory.wheat).toBe(10);
    expect(me.player.gold).toBeLessThan(80); // paid the real market price
  });

  it('rejects malformed and out-of-range actions', async () => {
    const { cookie } = await register();
    expect((await act(cookie, { type: 'trade', side: 'buy', resource: 'wheat', qty: -5 })).statusCode).toBe(400);
    expect((await act(cookie, { type: 'trade', side: 'buy', resource: 'gold', qty: 1 })).statusCode).toBe(400);
    expect((await act(cookie, { type: 'mint', amount: 1e9 })).statusCode).toBe(400);
    expect((await act(cookie, { type: 'trade', side: 'buy', resource: 'weapons', qty: 50 })).statusCode).toBe(422);
  });

  it('is idempotent: a replayed requestId is applied once', async () => {
    const { cookie } = await register();
    const id = crypto.randomUUID();
    const a = await act(cookie, { type: 'trade', side: 'buy', resource: 'fish', qty: 5 }, id);
    const b = await act(cookie, { type: 'trade', side: 'buy', resource: 'fish', qty: 5 }, id);
    expect(a.statusCode).toBe(200);
    expect(b.json().replayed).toBe(true);
    const me = (await ctx.app.inject({ method: 'GET', url: '/api/me', headers: { cookie } })).json();
    expect(me.player.inventory.fish).toBe(5);
  });

  it('rate-limits action floods', async () => {
    const { cookie } = await register();
    const codes: number[] = [];
    for (let i = 0; i < 25; i++) codes.push((await act(cookie, { type: 'trade', side: 'buy', resource: 'wood', qty: 1 })).statusCode);
    expect(codes).toContain(429);
  });

  it("players cannot act on each other's businesses", async () => {
    const a = await register('alice', 'Alice Vane');
    const b = await register('bob', 'Bob Marl');
    const buy = await act(a.cookie, { type: 'business.buy', kind: 'farm' });
    const bizId = buy.json().data.id;
    const hack = await act(b.cookie, { type: 'business.upgrade', businessId: bizId });
    expect(hack.statusCode).toBe(422);
  });

  it('fast-forward advances the shared economy', async () => {
    const { cookie } = await register();
    const before = ctx.game.world.tick;
    const r = await ctx.app.inject({ method: 'POST', url: '/api/sim/fast-forward', headers: { cookie }, payload: { days: 2 } });
    expect(r.json().toTick).toBe(before + 48);
    expect(r.json().feed).toBeGreaterThan(0);
  });

  it('opens city charters, trades in that city and ships goods home', async () => {
    const { cookie } = await register();
    const id = (await ctx.app.inject({ method: 'GET', url: '/api/me', headers: { cookie } })).json().player.id;
    ctx.game.world.players[id].gold = 400; // a starting purse cannot cover a charter, grain and freight together
    expect((await act(cookie, { type: 'city.charter', city: 'atlantis' })).statusCode).toBe(400);
    expect((await act(cookie, { type: 'city.charter', city: 'kingsreach' })).statusCode).toBe(422); // needs Level 3
    expect((await act(cookie, { type: 'city.charter', city: 'goldenvale' })).statusCode).toBe(200);
    expect((await act(cookie, { type: 'trade', side: 'buy', resource: 'wheat', qty: 5, market: 'goldenvale' })).statusCode).toBe(200);
    const ship = await act(cookie, { type: 'ship', from: 'goldenvale', to: 'nearhaven', resource: 'wheat', qty: 5 });
    expect(ship.statusCode, ship.body).toBe(200);
    let me = (await ctx.app.inject({ method: 'GET', url: '/api/me', headers: { cookie } })).json();
    expect(me.player.charters).toContain('goldenvale');
    expect(me.player.shipments).toHaveLength(1);
    ctx.game.world.tick = ship.json().data.arriveTick - 1;
    await ctx.app.inject({ method: 'POST', url: '/api/sim/fast-forward', headers: { cookie }, payload: { days: 1 } });
    me = (await ctx.app.inject({ method: 'GET', url: '/api/me', headers: { cookie } })).json();
    expect(me.player.inventory.wheat).toBe(5);
    expect(me.player.shipments).toHaveLength(0);
  });

  it('buys land, builds in another city and sells a business through the API', async () => {
    const { cookie } = await register();
    const me0 = (await ctx.app.inject({ method: 'GET', url: '/api/me', headers: { cookie } })).json();
    ctx.game.world.players[me0.player.id].gold = 2000;
    expect((await act(cookie, { type: 'land.buy', city: 'goldenvale' })).statusCode).toBe(422); // no office yet
    expect((await act(cookie, { type: 'city.charter', city: 'goldenvale' })).statusCode).toBe(200);
    expect((await act(cookie, { type: 'land.buy', city: 'goldenvale' })).statusCode).toBe(200);
    const built = await act(cookie, { type: 'business.buy', kind: 'farm', city: 'goldenvale' });
    expect(built.statusCode, built.body).toBe(200);
    expect(built.json().data.city).toBe('goldenvale');
    let me = (await ctx.app.inject({ method: 'GET', url: '/api/me', headers: { cookie } })).json();
    expect(me.player.land).toHaveLength(0); // built on the plot it bought
    expect(me.player.businesses[0].sale.total).toBeGreaterThan(0);
    expect((await act(cookie, { type: 'business.sell', businessId: built.json().data.id })).statusCode).toBe(200);
    me = (await ctx.app.inject({ method: 'GET', url: '/api/me', headers: { cookie } })).json();
    expect(me.player.businesses).toHaveLength(0);
    expect((await act(cookie, { type: 'land.buy', city: 'atlantis' })).statusCode).toBe(400);
  });

  it('builds new industries, picks recipes and runs standing shipping orders', async () => {
    const { cookie } = await register();
    const id = (await ctx.app.inject({ method: 'GET', url: '/api/me', headers: { cookie } })).json().player.id;
    Object.assign(ctx.game.world.players[id], { gold: 5000, level: 5 });
    expect((await act(cookie, { type: 'business.buy', kind: 'spaceport' })).statusCode).toBe(400);
    const bakery = await act(cookie, { type: 'business.buy', kind: 'bakery' });
    expect(bakery.statusCode).toBe(200);
    expect((await act(cookie, { type: 'business.policy', businessId: bakery.json().data.id, policy: { recipe: 'bread from flour', autoCollect: true } })).statusCode).toBe(200);
    expect((await act(cookie, { type: 'business.policy', businessId: bakery.json().data.id, policy: { recipe: 'cake' } })).statusCode).toBe(422);
    expect((await act(cookie, { type: 'business.buy', kind: 'mill' })).statusCode).toBe(200);
    expect((await act(cookie, { type: 'city.charter', city: 'goldenvale' })).statusCode).toBe(200);
    const route = await act(cookie, { type: 'route.add', from: 'goldenvale', to: 'nearhaven', resource: 'flour', batch: 20 });
    expect(route.statusCode, route.body).toBe(200);
    expect((await act(cookie, { type: 'route.add', from: 'goldenvale', to: 'nearhaven', resource: 'flour', batch: 1 })).statusCode).toBe(400);
    let me = (await ctx.app.inject({ method: 'GET', url: '/api/me', headers: { cookie } })).json();
    expect(me.player.routes).toHaveLength(1);
    expect((await act(cookie, { type: 'route.toggle', routeId: route.json().data.id, active: false })).statusCode).toBe(200);
    expect((await act(cookie, { type: 'route.remove', routeId: route.json().data.id })).statusCode).toBe(200);
    me = (await ctx.app.inject({ method: 'GET', url: '/api/me', headers: { cookie } })).json();
    expect(me.player.routes).toHaveLength(0);
  });

  it('funds public works and reports each city\'s growth, labour and projects', async () => {
    const { cookie } = await register();
    const id = (await ctx.app.inject({ method: 'GET', url: '/api/me', headers: { cookie } })).json().player.id;
    Object.assign(ctx.game.world.players[id], { gold: 5000, level: 5 });
    expect((await act(cookie, { type: 'city.fund', city: 'goldenvale', project: 'granary', amount: 100 })).statusCode).toBe(422); // no office
    expect((await act(cookie, { type: 'city.charter', city: 'goldenvale' })).statusCode).toBe(200);
    expect((await act(cookie, { type: 'city.fund', city: 'goldenvale', project: 'castle', amount: 100 })).statusCode).toBe(400);
    const r = await act(cookie, { type: 'city.fund', city: 'goldenvale', project: 'granary', amount: 250 });
    expect(r.statusCode, r.body).toBe(200);
    const snap = (await ctx.app.inject({ method: 'GET', url: '/api/world' })).json();
    const vale = snap.cities.goldenvale;
    expect(vale.labor.supply).toBeGreaterThan(0);
    expect(vale.works.find((x: { kind: string }) => x.kind === 'granary').funded).toBeGreaterThanOrEqual(250);
    const me = (await ctx.app.inject({ method: 'GET', url: '/api/me', headers: { cookie } })).json();
    expect(me.player.patronage.goldenvale).toBe(250);
  });

  it('runs subsidiaries, acquisitions between players and banks through the API', async () => {
    const a = await register('tycoon', 'Ada Tycoon');
    const b = await register('owner', 'Ben Owner');
    const meA = (await ctx.app.inject({ method: 'GET', url: '/api/me', headers: { cookie: a.cookie } })).json();
    const meB = (await ctx.app.inject({ method: 'GET', url: '/api/me', headers: { cookie: b.cookie } })).json();
    Object.assign(ctx.game.world.players[meA.player.id], { gold: 30000, level: 7 });
    expect((await act(a.cookie, { type: 'company.name', name: 'Tycoon Holdings' })).statusCode).toBe(200);
    const sub = await act(a.cookie, { type: 'company.found', name: 'Tycoon Farms' });
    expect(sub.statusCode, sub.body).toBe(200);
    const farm = await act(b.cookie, { type: 'business.buy', kind: 'farm' });
    expect(farm.statusCode).toBe(200);
    expect((await act(b.cookie, { type: 'offer.make', businessId: farm.json().data.id, price: 300 })).statusCode).toBe(422); // own business
    const offer = await act(a.cookie, { type: 'offer.make', businessId: farm.json().data.id, price: 300 });
    expect(offer.statusCode, offer.body).toBe(200);
    const seen = (await ctx.app.inject({ method: 'GET', url: '/api/me', headers: { cookie: b.cookie } })).json();
    expect(seen.player.offersReceived).toHaveLength(1);
    expect((await act(b.cookie, { type: 'offer.respond', offerId: offer.json().data.id, accept: true })).statusCode).toBe(200);
    let me = (await ctx.app.inject({ method: 'GET', url: '/api/me', headers: { cookie: a.cookie } })).json();
    const bought = me.player.businesses.find((x: { id: string }) => x.id === farm.json().data.id);
    expect(bought).toBeTruthy();
    expect((await act(a.cookie, { type: 'company.assign', businessId: bought.id, companyId: sub.json().data.id })).statusCode).toBe(200);
    const bank = await act(a.cookie, { type: 'business.buy', kind: 'bank' });
    expect(bank.statusCode, bank.body).toBe(200);
    expect((await act(a.cookie, { type: 'bank.deposit', businessId: bank.json().data.id, amount: 1000 })).statusCode).toBe(200);
    me = (await ctx.app.inject({ method: 'GET', url: '/api/me', headers: { cookie: a.cookie } })).json();
    expect(me.player.company.name).toBe('Tycoon Holdings');
    expect(me.player.company.byCompany[sub.json().data.id].businesses).toBe(1);
    expect(me.player.rankTitle).toBe('Industrialist');
    void meB;
  });

  it('records every gold movement in the ledger', async () => {
    const { cookie } = await register();
    await act(cookie, { type: 'trade', side: 'buy', resource: 'wheat', qty: 3 });
    const ledger = (await ctx.app.inject({ method: 'GET', url: '/api/ledger', headers: { cookie } })).json();
    expect(ledger.map((e: { type: string }) => e.type)).toEqual(expect.arrayContaining(['player.register', 'trade.buy']));
  });
});

describe('NEAR wallet login (NEP-413)', () => {
  const sk = ed25519.utils.randomSecretKey();
  const pk = `ed25519:${base58.encode(ed25519.getPublicKey(sk))}`;
  const signChallenge = (ch: { message: string; nonce: string; recipient: string }) =>
    base64.encode(ed25519.sign(sha256(nep413Payload(ch.message, base64.decode(ch.nonce), ch.recipient)), sk));

  it('verifies a correctly signed challenge against an on-chain key', async () => {
    ctx.chain.keys.set(`alice.testnet|${pk}`, 'FullAccess');
    const ch = (await ctx.app.inject({ method: 'POST', url: '/api/near/challenge' })).json();
    const r = await ctx.app.inject({ method: 'POST', url: '/api/near/verify', payload: { accountId: 'alice.testnet', publicKey: pk, signature: signChallenge(ch), nonce: ch.nonce, message: ch.message } });
    expect(r.statusCode).toBe(200);
    expect(r.json().nearAccountId).toBe('alice.testnet');
    // Replay of the same challenge is rejected.
    const again = await ctx.app.inject({ method: 'POST', url: '/api/near/verify', payload: { accountId: 'alice.testnet', publicKey: pk, signature: signChallenge(ch), nonce: ch.nonce, message: ch.message } });
    expect(again.statusCode).toBe(401);
  });

  it('rejects a valid signature from a key the account does not own', async () => {
    const ch = (await ctx.app.inject({ method: 'POST', url: '/api/near/challenge' })).json();
    const r = await ctx.app.inject({ method: 'POST', url: '/api/near/verify', payload: { accountId: 'victim.testnet', publicKey: pk, signature: signChallenge(ch), nonce: ch.nonce, message: ch.message } });
    expect(r.statusCode).toBe(401);
    expect(r.json().error).toMatch(/not an access key/);
  });

  it('rejects tampered messages', async () => {
    ctx.chain.keys.set(`alice.testnet|${pk}`, 'FullAccess');
    const ch = (await ctx.app.inject({ method: 'POST', url: '/api/near/challenge' })).json();
    const r = await ctx.app.inject({ method: 'POST', url: '/api/near/verify', payload: { accountId: 'alice.testnet', publicKey: pk, signature: signChallenge(ch), nonce: ch.nonce, message: 'Transfer everything' } });
    expect(r.statusCode).toBe(401);
  });

  it('nep413 helper matches the specification layout', () => {
    const nonce = new Uint8Array(32).fill(1);
    const payload = nep413Payload('hi', nonce, 'app');
    expect(new DataView(payload.buffer).getUint32(0, true)).toBe(2147484061);
    expect(payload.length).toBe(4 + 4 + 2 + 32 + 4 + 3 + 1);
    const sig = base64.encode(ed25519.sign(sha256(payload), sk));
    expect(verifyNep413({ message: 'hi', nonce, recipient: 'app', publicKey: pk, signature: sig })).toBe(true);
    expect(verifyNep413({ message: 'hi', nonce, recipient: 'other', publicKey: pk, signature: sig })).toBe(false);
  });
});

describe('on-chain ownership & settlement', () => {
  const linkWallet = (playerId: string, account: string) => {
    ctx.game.world.players[playerId].nearAccountId = account;
    return ctx.store.setNearAccount(playerId, account);
  };
  const hash = () => base58.encode(crypto.randomBytes(32));
  const txResult = (signer: string, events: unknown[], fail = false) => ({
    status: fail ? { Failure: { ActionError: { kind: 'FunctionCallError' } } } : { SuccessValue: '' },
    transaction: { signer_id: signer, receiver_id: CONTRACT, actions: [{ FunctionCall: { method_name: 'claim_deed' } }] },
    receipts_outcome: [{ outcome: { logs: events.map((e) => `EVENT_JSON:${JSON.stringify({ standard: 'merchants_of_near', version: '1.0.0', ...(e as object) })}`), status: {} } }],
  });

  it('issues a deed certificate that verifies against the authority key', async () => {
    const { cookie, id } = await register();
    await linkWallet(id, 'alice.testnet');
    const biz = (await act(cookie, { type: 'business.buy', kind: 'farm' })).json().data;
    const cert = (await ctx.app.inject({ method: 'POST', url: '/api/near/certificate/deed', headers: { cookie }, payload: { businessId: biz.id } })).json();
    expect(cert.methodName).toBe('claim_deed');
    const a = cert.args;
    const msg = deedMessage('alice.testnet', a.token_id, a.kind, a.business_id, a.level, a.nonce, a.expires_at_ms);
    const pub = base58.decode(authority.publicKey.slice(8));
    expect(ed25519.verify(base64.decode(a.signature), new TextEncoder().encode(msg), pub)).toBe(true);
  });

  it('refuses certificates for businesses the player does not own', async () => {
    const a = await register('alice', 'Alice Vane');
    const b = await register('bob', 'Bob Marl');
    await linkWallet(b.id, 'bob.testnet');
    const biz = (await act(a.cookie, { type: 'business.buy', kind: 'farm' })).json().data;
    const r = await ctx.app.inject({ method: 'POST', url: '/api/near/certificate/deed', headers: { cookie: b.cookie }, payload: { businessId: biz.id } });
    expect(r.statusCode).toBe(422);
  });

  it('marks a deed only after the chain confirms the transaction', async () => {
    const { cookie, id } = await register();
    await linkWallet(id, 'alice.testnet');
    const biz = (await act(cookie, { type: 'business.buy', kind: 'farm' })).json().data;
    const h = hash();
    // Not yet on chain → pending, no deed.
    let r = (await ctx.app.inject({ method: 'POST', url: '/api/near/tx', headers: { cookie }, payload: { hash: h, kind: 'deed', reference: biz.id } })).json();
    expect(r.status).toBe('pending');
    expect(ctx.game.world.businesses[biz.id].deedTokenId).toBeUndefined();
    // Chain confirms.
    ctx.chain.txs.set(h, txResult('alice.testnet', [{ event: 'deed_claimed', data: [{ token_id: `deed-${biz.id}`, owner_id: 'alice.testnet' }] }]));
    r = (await ctx.app.inject({ method: 'POST', url: '/api/near/tx', headers: { cookie }, payload: { hash: h, kind: 'deed', reference: biz.id } })).json();
    expect(r.status).toBe('success');
    expect(r.explorer).toContain(h);
    expect(ctx.game.world.businesses[biz.id].deedTokenId).toBe(`deed-${biz.id}`);
  });

  it('records failed transactions as failures and RPC outages as pending', async () => {
    const { cookie, id } = await register();
    await linkWallet(id, 'alice.testnet');
    const h = hash();
    ctx.chain.txs.set(h, txResult('alice.testnet', [], true));
    expect((await ctx.app.inject({ method: 'POST', url: '/api/near/tx', headers: { cookie }, payload: { hash: h, kind: 'deed' } })).json().status).toBe('failure');
    ctx.chain.reachable = false;
    expect((await ctx.app.inject({ method: 'POST', url: '/api/near/tx', headers: { cookie }, payload: { hash: hash(), kind: 'deed' } })).json().status).toBe('pending');
  });

  it("rejects transactions signed by someone else's account", async () => {
    const { cookie, id } = await register();
    await linkWallet(id, 'alice.testnet');
    const h = hash();
    ctx.chain.txs.set(h, txResult('mallory.testnet', []));
    expect((await ctx.app.inject({ method: 'POST', url: '/api/near/tx', headers: { cookie }, payload: { hash: h, kind: 'deed' } })).json().status).toBe('failure');
  });

  it('moves a business in-game when its deed is bought on NEAR', async () => {
    const a = await register('alice', 'Alice Vane');
    const b = await register('bob', 'Bob Marl');
    await linkWallet(a.id, 'alice.testnet');
    await linkWallet(b.id, 'bob.testnet');
    const biz = (await act(a.cookie, { type: 'business.buy', kind: 'farm' })).json().data;
    ctx.game.world.businesses[biz.id].deedTokenId = `deed-${biz.id}`;
    ctx.chain.deeds.set(`deed-${biz.id}`, { token_id: `deed-${biz.id}`, owner_id: 'bob.testnet', kind: 'farm', business_id: biz.id, level: 1, listed_price: null, sales: 1 });
    const r = await ctx.app.inject({ method: 'POST', url: '/api/near/sync', headers: { cookie: b.cookie } });
    expect(r.json().changed).toBe(1);
    expect(ctx.game.world.businesses[biz.id].ownerId).toBe(b.id);
  });
});

describe('personal music stays private', () => {
  it('lists and serves local tracks only to viewers on this machine or LAN', async () => {
    const { isLocalViewer } = await import('../src/app');
    expect(isLocalViewer({ headers: { host: 'localhost:3000' }, socket: { remoteAddress: '127.0.0.1' } })).toBe(true);
    expect(isLocalViewer({ headers: { host: '192.168.101.3:3000', 'x-forwarded-for': '192.168.101.7' }, socket: { remoteAddress: '::1' } })).toBe(true);
    // Cloudflare quick tunnel: arrives on loopback but carries the public host and the visitor's IP.
    expect(isLocalViewer({ headers: { host: 'some-words.trycloudflare.com', 'cf-connecting-ip': '203.0.113.9', 'x-forwarded-for': '203.0.113.9' }, socket: { remoteAddress: '127.0.0.1' } })).toBe(false);
    expect(isLocalViewer({ headers: { host: 'localhost:4000', 'x-forwarded-for': '203.0.113.9' }, socket: { remoteAddress: '127.0.0.1' } })).toBe(false);
    expect(isLocalViewer({ headers: { host: 'mon.fly.dev' }, socket: { remoteAddress: '10.0.0.5' } })).toBe(false);

    const remote = await ctx.app.inject({ method: 'GET', url: '/api/audio/tracks', headers: { host: 'x.trycloudflare.com', 'cf-connecting-ip': '203.0.113.9' } });
    expect(remote.json()).toEqual([]);
    const file = await ctx.app.inject({ method: 'GET', url: '/audio/song.mp3', headers: { host: 'x.trycloudflare.com', 'cf-connecting-ip': '203.0.113.9' } });
    expect(file.statusCode).toBe(404);
  });
});
