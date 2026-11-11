/**
 * Serverless runtime (Vercel): the game server runs inside the website's API
 * route instead of as a long-lived process.
 *
 * - The world lives in Postgres (DATABASE_URL, e.g. a free Neon database).
 * - Every request takes a database-wide lock, so instances take turns.
 * - Real time drives the simulation: each request first runs the ticks that
 *   are due since the last one (catchUp). With nobody online the world pauses
 *   and resumes when the next player arrives.
 * - Player actions are saved before the response is sent; time passing alone
 *   is saved every few ticks.
 * - There is no WebSocket stream; clients poll /api/world.
 */
import { loadConfig, type ServerConfig } from './config';
import { PrismaStore } from './store/prisma';
import { GameService } from './game';
import { NearService } from './near/service';
import { MerchantDialogue } from './ai';
import { buildApp } from './app';

type App = Awaited<ReturnType<typeof buildApp>>;
interface Runtime { config: ServerConfig; store: PrismaStore; game: GameService; near: NearService; app: App }

const SAVE_EVERY_TICKS = 5;
const NEAR_SYNC_MS = 5 * 60_000;

let booting: Promise<Runtime> | null = null;
let stamp: string | null = null; // when this instance last saw the saved world written
let unsavedTicks = 0;
let lastNearSync = 0;
let queue: Promise<unknown> = Promise.resolve(); // one request at a time inside this instance

async function boot(): Promise<Runtime> {
  // Fast-forward moves the shared world for every player, so it stays off unless asked for.
  const env = { ...process.env, ALLOW_FAST_FORWARD: process.env.ALLOW_FAST_FORWARD ?? 'false' };
  const config = loadConfig(env);
  if (!config.databaseUrl) throw new Error('DATABASE_URL is not set: add a Postgres database (Vercel → Storage → Neon) and redeploy.');
  const store = new PrismaStore(config.databaseUrl);
  await store.init();
  const game = new GameService(store, { seed: config.seed, tickMs: config.tickMs, manual: true });
  await game.init();
  if (!(await store.worldStamp())) await game.flush(true); // a brand-new database: save the first world
  stamp = await store.worldStamp();
  const near = new NearService(config.near, store);
  const dialogue = new MerchantDialogue(config.anthropicApiKey, config.anthropicModel);
  const app = await buildApp({ config, store, game, near, dialogue, serverless: true });
  await app.ready();
  return { config, store, game, near, app };
}

/** Handle one HTTP request (a Fetch API Request from a Next.js route handler). */
export async function handle(request: Request): Promise<Response> {
  let rt: Runtime;
  try {
    rt = await (booting ??= boot());
  } catch (e) {
    booting = null;
    return Response.json({ error: (e as Error).message }, { status: 503 });
  }
  const body = request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.text();
  const run = async () => {
    try {
      return await rt.store.withLock(() => serve(rt, request, body));
    } catch (e) {
      // Shown in Vercel's runtime logs, and to the player, so a failure can be diagnosed.
      console.error('[merchants-of-near] request failed', request.method, new URL(request.url).pathname, e);
      return Response.json({ error: `Server error: ${(e as Error).message ?? e}`.slice(0, 300) }, { status: 500 });
    }
  };
  const next = queue.then(run, run);
  queue = next.catch(() => undefined);
  return next;
}

async function serve(rt: Runtime, request: Request, body: string | undefined): Promise<Response> {
  const { game, store, app } = rt;
  // Another instance may have saved a newer world since we last looked.
  const saved = await store.worldStamp();
  if (saved && saved !== stamp) {
    await game.reload();
    stamp = saved;
    unsavedTicks = 0;
  }
  const beforeTick = game.world.tick;
  unsavedTicks += game.catchUp(Date.now());

  const url = new URL(request.url);
  const headers: Record<string, string> = {};
  request.headers.forEach((v, k) => { headers[k] = v; });
  const res = await app.inject({ method: request.method as 'GET', url: url.pathname + url.search, headers, payload: body });

  // Player actions (anything but a read) are saved now; time alone every few ticks.
  const write = request.method !== 'GET' && request.method !== 'HEAD';
  if (write || unsavedTicks >= SAVE_EVERY_TICKS || (game.world.tick !== beforeTick && game.world.tick % 24 === 0)) {
    await game.flush(true);
    stamp = await store.worldStamp();
    unsavedTicks = 0;
  } else {
    await game.flush(false); // ledger entries are always written
  }
  // Follow on-chain deed ownership now and then.
  if (rt.config.near.contractId && Date.now() - lastNearSync > NEAR_SYNC_MS) {
    lastNearSync = Date.now();
    if (await rt.near.syncAll(game.world).catch(() => false)) {
      await game.flush(true);
      stamp = await store.worldStamp();
    }
  }

  const out = new Headers();
  for (const [k, v] of Object.entries(res.headers)) {
    if (v === undefined || k === 'content-length' || k === 'transfer-encoding' || k === 'connection') continue;
    if (Array.isArray(v)) v.forEach((x) => out.append(k, String(x)));
    else out.set(k, String(v));
  }
  return new Response(res.statusCode === 204 || request.method === 'HEAD' ? null : new Uint8Array(res.rawPayload), { status: res.statusCode, headers: out });
}
