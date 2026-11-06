import path from 'node:path';
import dotenv from 'dotenv';

// Read apps/server/.env first, then the monorepo root .env.
dotenv.config({ path: [path.resolve(process.cwd(), '.env'), path.resolve(process.cwd(), '../../.env')], quiet: true });

const bool = (v: string | undefined, d: boolean) => (v === undefined ? d : ['1', 'true', 'yes'].includes(v.toLowerCase()));

export interface ServerConfig {
  port: number;
  host: string;
  tickMs: number;
  seed: number;
  databaseUrl?: string;
  dataDir: string;
  allowFastForward: boolean;
  maxFastForwardDays: number;
  cookieSecure: boolean;
  anthropicApiKey?: string;
  anthropicModel: string;
  near: {
    networkId: 'testnet' | 'mainnet';
    rpcUrl: string;
    contractId?: string;
    /** 32-byte ed25519 seed (hex) of the game certificate authority. Never sent to clients. */
    authoritySecretHex?: string;
    recipient: string;
    explorerTx: string;
  };
}

export function loadConfig(env = process.env): ServerConfig {
  const networkId = (env.NEAR_NETWORK_ID === 'mainnet' ? 'mainnet' : 'testnet') as 'testnet' | 'mainnet';
  return {
    port: Number(env.PORT ?? 4000),
    host: env.HOST ?? '0.0.0.0',
    tickMs: Number(env.TICK_MS ?? 2000),
    seed: Number(env.WORLD_SEED ?? 20260101),
    databaseUrl: env.DATABASE_URL || undefined,
    dataDir: env.DATA_DIR ?? './data',
    allowFastForward: bool(env.ALLOW_FAST_FORWARD, true),
    maxFastForwardDays: Number(env.MAX_FAST_FORWARD_DAYS ?? 14),
    cookieSecure: bool(env.COOKIE_SECURE, env.NODE_ENV === 'production'),
    anthropicApiKey: env.ANTHROPIC_API_KEY || undefined,
    anthropicModel: env.ANTHROPIC_MODEL ?? 'claude-opus-5-5',
    near: {
      networkId,
      rpcUrl: env.NEAR_RPC_URL ?? (networkId === 'mainnet' ? 'https://rpc.mainnet.near.org' : 'https://rpc.testnet.near.org'),
      contractId: env.NEAR_CONTRACT_ID || undefined,
      authoritySecretHex: env.GAME_AUTHORITY_SECRET || undefined,
      recipient: env.NEAR_SIGN_RECIPIENT ?? 'merchants-of-near',
      explorerTx: networkId === 'mainnet' ? 'https://nearblocks.io/txns/' : 'https://testnet.nearblocks.io/txns/',
    },
  };
}
