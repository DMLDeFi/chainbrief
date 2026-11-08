import type { LedgerEntry, WorldState } from '@mon/engine';

export interface UserRecord {
  id: string;
  username: string;
  passwordHash: string | null;
  nearAccountId: string | null;
  createdAt: string;
}

export interface ChainTxRecord {
  hash: string;
  userId: string;
  accountId: string;
  kind: 'deed' | 'badge' | 'deed_purchase' | 'deed_listing' | 'other';
  status: 'pending' | 'success' | 'failure' | 'unverified';
  reference: string | null;
  error: string | null;
  createdAt: string;
  verifiedAt: string | null;
}

/** Persistence boundary. Implemented by PrismaStore (PostgreSQL) and FileStore (JSON, zero-setup). */
export interface Store {
  readonly kind: 'postgres' | 'file';
  init(): Promise<void>;
  loadWorld(): Promise<WorldState | null>;
  saveWorld(world: WorldState): Promise<void>;
  appendLedger(entries: LedgerEntry[]): Promise<void>;
  ledgerFor(playerId: string, limit: number): Promise<Array<LedgerEntry & { id: string }>>;

  createUser(u: UserRecord): Promise<void>;
  userByName(username: string): Promise<UserRecord | null>;
  userById(id: string): Promise<UserRecord | null>;
  userByNear(accountId: string): Promise<UserRecord | null>;
  setNearAccount(userId: string, accountId: string): Promise<void>;

  createSession(tokenHash: string, userId: string, expiresAt: Date): Promise<void>;
  sessionUser(tokenHash: string): Promise<UserRecord | null>;
  deleteSession(tokenHash: string): Promise<void>;

  getIdempotent(key: string): Promise<unknown | null>;
  putIdempotent(key: string, userId: string, response: unknown): Promise<void>;

  putChallenge(nonce: string, userId: string | null, expiresAt: Date): Promise<void>;
  /** Atomically consume a challenge (single use). */
  takeChallenge(nonce: string): Promise<{ userId: string | null; expiresAt: Date } | null>;

  upsertChainTx(tx: ChainTxRecord): Promise<void>;
  chainTx(hash: string): Promise<ChainTxRecord | null>;
  chainTxsFor(userId: string): Promise<ChainTxRecord[]>;
  close(): Promise<void>;
}
