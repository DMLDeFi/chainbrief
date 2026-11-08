import { loadConfig } from './config';
import { FileStore } from './store/file';
import type { Store } from './store/types';
import { GameService } from './game';
import { NearService } from './near/service';
import { MerchantDialogue } from './ai';
import { buildApp } from './app';

const config = loadConfig();
// Load the Prisma store only when a database is configured, so the zero-setup
// JSON store works even if `prisma generate` has not run.
const store: Store = config.databaseUrl
  ? new (await import('./store/prisma')).PrismaStore(config.databaseUrl)
  : new FileStore(config.dataDir);
await store.init();
const game = new GameService(store, { seed: config.seed, tickMs: config.tickMs });
await game.init();
const near = new NearService(config.near, store);
const dialogue = new MerchantDialogue(config.anthropicApiKey, config.anthropicModel);
const app = await buildApp({ config, store, game, near, dialogue });

await app.listen({ port: config.port, host: config.host });
game.start();
app.log.info(`Merchants of NEAR server: store=${store.kind} llm=${dialogue.enabled ? config.anthropicModel : 'deterministic'} near=${config.near.networkId} contract=${config.near.contractId ?? '(not configured)'}`);

// Follow on-chain deed ownership once a minute.
const sync = setInterval(() => void near.syncAll(game.world).catch(() => undefined), 60_000);

const shutdown = async () => {
  clearInterval(sync);
  await game.stop();
  await app.close();
  await store.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
