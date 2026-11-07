import fs from 'node:fs/promises';
import path from 'node:path';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import httpProxy from '@fastify/http-proxy';
import { z } from 'zod';
import {
  catalog,
  leaderboards,
  merchantDetail,
  playerView,
  publicSnapshot,
  RESOURCE_DEFS,
  MARKET_DEFS,
  CITY_DEFS,
  ROUTES,
  evaluateDeal,
  acquisitionTargets,
} from '@mon/engine';
import type { ServerConfig } from './config';
import type { Store, UserRecord } from './store/types';
import { GameService, ActionSchema } from './game';
import { hashPassword, hashToken, newId, newSessionToken, TokenBucket, verifyPassword } from './auth';
import { NearService } from './near/service';
import { MerchantDialogue } from './ai';

const COOKIE = 'mon_session';
const SESSION_DAYS = 14;

declare module 'fastify' {
  interface FastifyRequest {
    user?: UserRecord | null;
  }
}

export interface AppDeps {
  config: ServerConfig;
  store: Store;
  game: GameService;
  near: NearService;
  dialogue: MerchantDialogue;
}

export async function buildApp(deps: AppDeps) {
  const { config, store, game, near, dialogue } = deps;
  const app = Fastify({ logger: process.env.NODE_ENV === 'test' ? false : { level: 'info' }, trustProxy: true, bodyLimit: 64 * 1024 });
  await app.register(cookie);
  // Page and asset requests proxied to Next.js are not API calls; only /api and /ws are limited.
  await app.register(rateLimit, { global: true, max: 600, timeWindow: '1 minute', allowList: (req) => !req.url.startsWith('/api') && !req.url.startsWith('/ws') });
  await app.register(websocket);

  const actionBucket = new TokenBucket(15, 6); // burst 15, 6 actions/sec sustained
  const chatBucket = new TokenBucket(5, 0.2);
  let lastFastForward = 0;

  app.addHook('preHandler', async (req) => {
    const header = req.headers.authorization;
    const token = req.cookies[COOKIE] ?? (header?.startsWith('Bearer ') ? header.slice(7) : undefined);
    req.user = token ? await store.sessionUser(hashToken(token)) : null;
  });

  const requireUser = (req: FastifyRequest, reply: FastifyReply): UserRecord | null => {
    if (!req.user) {
      void reply.code(401).send({ error: 'Sign in required' });
      return null;
    }
    return req.user;
  };

  const parse = <T>(schema: z.ZodType<T>, body: unknown, reply: FastifyReply): T | null => {
    const r = schema.safeParse(body);
    if (!r.success) {
      void reply.code(400).send({ error: 'Invalid request', issues: r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) });
      return null;
    }
    return r.data;
  };

  async function startSession(reply: FastifyReply, userId: string) {
    const { token, hash } = newSessionToken();
    await store.createSession(hash, userId, new Date(Date.now() + SESSION_DAYS * 864e5));
    reply.setCookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: config.cookieSecure, path: '/', maxAge: SESSION_DAYS * 86400 });
    return token;
  }

  // ------------------------------------------------------------ public ---
  app.get('/api/health', async () => ({ ok: true, tick: game.world.tick, store: store.kind, llm: dialogue.enabled, near: near.publicConfig().certificatesEnabled }));
  app.get('/api/catalog', async () => ({ ...catalog, RESOURCE_DEFS, MARKET_DEFS, CITY_DEFS, ROUTES, fastForward: config.allowFastForward, maxFastForwardDays: config.maxFastForwardDays }));
  // Local music: audio files the player dropped into apps/web/public/audio/
  // (gitignored, never committed). Only names with safe audio extensions are listed.
  const audioDir = process.env.AUDIO_DIR ?? path.resolve(process.cwd(), '../web/public/audio');
  // Those files are the owner's personal music, so they are offered only to
  // viewers on this machine or its local network, never to visitors arriving
  // through a public tunnel or host.
  app.addHook('onRequest', async (req, reply) => {
    if (req.url.startsWith('/audio/') && !isLocalViewer(req)) return reply.code(404).send({ error: 'Not found' });
  });
  app.get('/api/audio/tracks', async (req) => {
    if (!isLocalViewer(req)) return [];
    try {
      const files = await fs.readdir(audioDir);
      return files.filter((f) => /\.(mp3|m4a|aac|ogg|oga|wav|webm)$/i.test(f) && !f.startsWith('.')).sort().map((f) => `/audio/${encodeURIComponent(f)}`);
    } catch {
      return [];
    }
  });
  app.get('/api/world', async () => publicSnapshot(game.world, 0));
  app.get('/api/world/history', async () => {
    const out: Record<string, Record<string, number[]>> = {};
    for (const [id, m] of Object.entries(game.world.markets)) out[id] = m.history as Record<string, number[]>;
    return out;
  });
  app.get('/api/leaderboard', async () => leaderboards(game.world));
  app.get<{ Params: { id: string } }>('/api/merchants/:id', async (req, reply) => {
    const d = merchantDetail(game.world, req.params.id, req.user?.id);
    return d ?? reply.code(404).send({ error: 'Unknown merchant' });
  });
  app.get('/api/market/listings', async () =>
    Object.values(game.world.listings)
      .filter((l) => l.status === 'open')
      .map((l) => ({ ...l, seller: game.world.players[l.sellerId]?.name ?? '?' })),
  );

  // -------------------------------------------------------------- auth ---
  const Creds = z.object({
    username: z.string().regex(/^[a-zA-Z0-9_]{3,20}$/, '3-20 letters, numbers or _'),
    password: z.string().min(8).max(128),
    merchantName: z.string().min(3).max(20).optional(),
  });
  app.post('/api/auth/register', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = parse(Creds, req.body, reply);
    if (!body) return;
    if (await store.userByName(body.username)) return reply.code(409).send({ error: 'Username taken' });
    const id = newId('u');
    const name = body.merchantName ?? body.username;
    // Validate the merchant name with the engine before creating the account.
    const user: UserRecord = { id, username: body.username, passwordHash: await hashPassword(body.password), nearAccountId: null, createdAt: new Date().toISOString() };
    const reg = game.ensurePlayer(id, name);
    if (!reg.ok) return reply.code(400).send({ error: reg.error });
    try {
      await store.createUser(user);
    } catch {
      delete game.world.players[id];
      return reply.code(409).send({ error: 'Username taken' });
    }
    await startSession(reply, id);
    return { ok: true, user: { id, username: user.username } };
  });

  app.post('/api/auth/login', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = parse(Creds.pick({ username: true, password: true }), req.body, reply);
    if (!body) return;
    const user = await store.userByName(body.username);
    if (!user || !(await verifyPassword(body.password, user.passwordHash))) return reply.code(401).send({ error: 'Wrong username or password' });
    await startSession(reply, user.id);
    return { ok: true, user: { id: user.id, username: user.username } };
  });

  // One-click guest profile for demos and judges. Credentials are random and never shown.
  app.post('/api/auth/guest', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = parse(z.object({ merchantName: z.string().min(3).max(20).optional() }), req.body ?? {}, reply);
    if (!body) return;
    const id = newId('u');
    const suffix = id.slice(-4).replace(/[^a-zA-Z0-9]/g, 'x');
    const name = body.merchantName ?? `Guest ${suffix}`;
    const reg = game.ensurePlayer(id, name);
    if (!reg.ok) return reply.code(400).send({ error: reg.error });
    const user: UserRecord = { id, username: `guest_${id.slice(2, 14).replace(/[^a-zA-Z0-9_]/g, '_')}`, passwordHash: null, nearAccountId: null, createdAt: new Date().toISOString() };
    await store.createUser(user);
    await startSession(reply, id);
    return { ok: true, user: { id, username: user.username } };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const token = req.cookies[COOKIE];
    if (token) await store.deleteSession(hashToken(token));
    reply.clearCookie(COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/me', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const view = playerView(game.world, user.id);
    if (!view) return reply.code(404).send({ error: 'No merchant profile' });
    return { user: { id: user.id, username: user.username, nearAccountId: user.nearAccountId }, player: view };
  });

  app.get('/api/acquisitions', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    return acquisitionTargets(game.world, user.id);
  });

  app.get('/api/ledger', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    await game.persist();
    return store.ledgerFor(user.id, 200);
  });

  // ----------------------------------------------------------- actions ---
  const ActionBody = z.object({ requestId: z.string().uuid(), action: ActionSchema });
  app.post('/api/action', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    if (!actionBucket.take(user.id)) return reply.code(429).send({ error: 'Slow down, merchant — too many actions' });
    const body = parse(ActionBody, req.body, reply);
    if (!body) return;
    // Idempotency: a retried request returns the original result and is never applied twice.
    const key = `${user.id}:${body.requestId}`;
    const prior = await store.getIdempotent(key);
    if (prior) return { ...(prior as object), replayed: true };
    const result = game.apply(user.id, body.action);
    const response = result.ok ? { ok: true, data: result.data } : { ok: false, error: result.error };
    await store.putIdempotent(key, user.id, response);
    if (!result.ok) return reply.code(422).send(response);
    return response;
  });

  // Deal preview: lets the player see the merchant's fair price before committing.
  const DealPreview = z.object({ merchantId: z.string(), side: z.enum(['buy', 'sell']), resource: z.enum(Object.keys(RESOURCE_DEFS) as [string, ...string[]]), qty: z.number().int().min(1).max(200), unitPrice: z.number().positive() });
  app.post('/api/deal/preview', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const body = parse(DealPreview, req.body, reply);
    if (!body) return;
    const r = evaluateDeal(game.world, user.id, body as never);
    return r.ok ? r.data : reply.code(422).send({ error: r.error });
  });

  app.post<{ Params: { id: string } }>('/api/merchants/:id/chat', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    if (!chatBucket.take(user.id)) return reply.code(429).send({ error: 'The merchant needs a moment' });
    const body = parse(z.object({ message: z.string().min(1).max(500), context: z.string().max(300).optional() }), req.body, reply);
    if (!body) return;
    const m = game.world.merchants[req.params.id];
    if (!m) return reply.code(404).send({ error: 'Unknown merchant' });
    return dialogue.reply(game.world, m, user.id, body.message, body.context);
  });

  app.post('/api/sim/fast-forward', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    if (!config.allowFastForward) return reply.code(403).send({ error: 'Fast-forward is disabled on this server' });
    const body = parse(z.object({ days: z.number().int().min(1).max(config.maxFastForwardDays) }), req.body, reply);
    if (!body) return;
    if (Date.now() - lastFastForward < 5000) return reply.code(429).send({ error: 'Fast-forward is cooling down' });
    lastFastForward = Date.now();
    const r = game.fastForward(body.days);
    return { ok: true, ...r };
  });

  // -------------------------------------------------------------- NEAR ---
  app.get('/api/near/config', async () => near.publicConfig());

  app.post('/api/near/challenge', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req) => near.challenge(req.user?.id ?? null));

  const Verify = z.object({ accountId: z.string(), publicKey: z.string(), signature: z.string(), nonce: z.string(), message: z.string().max(500) });
  app.post('/api/near/verify', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = parse(Verify, req.body, reply);
    if (!body) return;
    const v = await near.verifyLogin(body);
    if (!v.ok) return reply.code(401).send({ error: v.error });
    const existing = await store.userByNear(body.accountId);
    if (req.user) {
      // Link the wallet to the signed-in profile (the challenge must belong to this user).
      if (v.challengeUserId !== req.user.id) return reply.code(401).send({ error: 'Challenge was issued to a different session' });
      if (existing && existing.id !== req.user.id) return reply.code(409).send({ error: 'This NEAR account is linked to another merchant' });
      await store.setNearAccount(req.user.id, body.accountId);
      const p = game.world.players[req.user.id];
      if (p) p.nearAccountId = body.accountId;
      return { ok: true, linked: body.accountId };
    }
    // Wallet-only login: find or create the profile owned by this account.
    let user = existing;
    if (!user) {
      const id = newId('u');
      const base = body.accountId.split('.')[0].replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 14) || 'merchant';
      let name = base.length >= 3 ? base : `${base}_merchant`;
      if (Object.values(game.world.players).some((p) => p.name.toLowerCase() === name.toLowerCase())) name = `${name.slice(0, 14)}_${id.slice(-4)}`;
      const reg = game.ensurePlayer(id, name);
      if (!reg.ok) return reply.code(400).send({ error: reg.error });
      user = { id, username: `near_${id.slice(2, 12)}`, passwordHash: null, nearAccountId: body.accountId, createdAt: new Date().toISOString() };
      await store.createUser(user);
      game.world.players[id].nearAccountId = body.accountId;
    }
    await startSession(reply, user.id);
    return { ok: true, user: { id: user.id, username: user.username }, nearAccountId: body.accountId };
  });

  const certRoute = (fn: (userId: string, body: Record<string, string>) => unknown, schema: z.ZodType<Record<string, string>>) => async (req: FastifyRequest, reply: FastifyReply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const body = parse(schema, req.body, reply);
    if (!body) return;
    try {
      return fn(user.id, body);
    } catch (e) {
      return reply.code(422).send({ error: (e as Error).message });
    }
  };
  app.post('/api/near/certificate/deed', certRoute((uid, b) => near.deedCertificate(game.world, uid, b.businessId), z.object({ businessId: z.string().max(64) })));
  app.post('/api/near/certificate/badge', certRoute((uid, b) => near.badgeCertificate(game.world, uid, b.achievementId), z.object({ achievementId: z.string().max(48) })));

  const TxBody = z.object({ hash: z.string(), kind: z.enum(['deed', 'badge', 'deed_purchase', 'deed_listing', 'other']), reference: z.string().max(80).nullable().optional() });
  app.post('/api/near/tx', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    if (!user.nearAccountId) return reply.code(400).send({ error: 'Connect a NEAR wallet first' });
    const body = parse(TxBody, req.body, reply);
    if (!body) return;
    try {
      const rec = await near.submitTx(game.world, user.id, user.nearAccountId, body.hash, body.kind, body.reference ?? null);
      return { ...rec, explorer: `${near.publicConfig().explorerTx}${rec.hash}` };
    } catch (e) {
      return reply.code(422).send({ error: (e as Error).message });
    }
  });

  app.get('/api/near/txs', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const explorer = near.publicConfig().explorerTx;
    return (await store.chainTxsFor(user.id)).map((t) => ({ ...t, explorer: `${explorer}${t.hash}` }));
  });

  app.post('/api/near/sync', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    try {
      return { ok: true, changed: await near.syncAll(game.world) };
    } catch (e) {
      return reply.code(503).send({ error: (e as Error).message });
    }
  });

  // --------------------------------------------------------- websocket ---
  app.get('/ws', { websocket: true }, (socket) => {
    socket.send(JSON.stringify({ type: 'snapshot', data: publicSnapshot(game.world, 0) }));
    const off = game.subscribe((msg) => {
      if (socket.readyState === 1) socket.send(JSON.stringify(msg));
    });
    socket.on('close', off);
    socket.on('message', () => { /* the stream is read-only; actions go through the authenticated REST API */ });
  });

  // Single-origin production deployment: everything that isn't /api or /ws is
  // served by the Next.js app running alongside this process.
  if (config.webOrigin) {
    await app.register(httpProxy, { upstream: config.webOrigin, prefix: '/', websocket: false });
  }

  app.setErrorHandler((err, _req, reply) => {
    if ((err as { statusCode?: number }).statusCode === 429) return reply.code(429).send({ error: 'Too many requests' });
    app.log.error(err);
    return reply.code((err as { statusCode?: number }).statusCode ?? 500).send({ error: 'Server error' });
  });

  return app;
}

const PRIVATE_IP = /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|::1$|fc|fd|fe80:|::ffff:(127|10|192\.168)\.)/i;
const LOCAL_HOST = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\]|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|[\w-]+\.local)$/i;

/**
 * True when a request comes from this machine or its LAN, and not through a
 * tunnel, CDN or public host. Every hop (socket, X-Forwarded-For,
 * CF-Connecting-IP) must be a private address and the Host must be a local
 * name. Used only to keep the owner's personal music private, not for auth.
 */
export function isLocalViewer(req: { headers: Record<string, string | string[] | undefined>; socket?: { remoteAddress?: string } }) {
  const h = (k: string) => {
    const v = req.headers[k];
    return Array.isArray(v) ? v.join(',') : v;
  };
  const ips = [req.socket?.remoteAddress, h('cf-connecting-ip'), ...(h('x-forwarded-for')?.split(',') ?? []), h('x-real-ip')]
    .map((ip) => ip?.trim())
    .filter((ip): ip is string => !!ip);
  if (!ips.every((ip) => PRIVATE_IP.test(ip))) return false;
  const host = (h('x-forwarded-host')?.split(',')[0] ?? h('host') ?? '').trim().replace(/:\d+$/, '');
  return LOCAL_HOST.test(host);
}
