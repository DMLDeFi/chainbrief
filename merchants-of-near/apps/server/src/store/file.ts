import fs from 'node:fs/promises';
import path from 'node:path';
import type { LedgerEntry, WorldState } from '@mon/engine';
import type { ChainTxRecord, Store, UserRecord } from './types';

interface Db {
  users: UserRecord[];
  sessions: Array<{ tokenHash: string; userId: string; expiresAt: string }>;
  idem: Record<string, { userId: string; response: unknown; at: number }>;
  challenges: Record<string, { userId: string | null; expiresAt: string }>;
  txs: ChainTxRecord[];
  ledger: Array<LedgerEntry & { id: string }>;
}

/**
 * Zero-setup store: in-memory with periodic JSON snapshots to DATA_DIR.
 * Used for local play and tests when DATABASE_URL is not set. `dir: null` keeps
 * everything in memory only.
 */
export class FileStore implements Store {
  readonly kind = 'file' as const;
  private db: Db = { users: [], sessions: [], idem: {}, challenges: {}, txs: [], ledger: [] };
  private world: WorldState | null = null;
  private seq = 0;
  /** Writes are serialised so concurrent flushes never race on the temp file. */
  private chain: Promise<void> = Promise.resolve();
  constructor(private dir: string | null) {}

  private write(file: string, data: string): Promise<void> {
    const dir = this.dir;
    if (!dir) return Promise.resolve();
    this.chain = this.chain
      .then(async () => {
        const tmp = path.join(dir, `${file}.${process.pid}.tmp`);
        await fs.writeFile(tmp, data);
        await fs.rename(tmp, path.join(dir, file));
      })
      .catch((e) => console.error('file store write failed', e));
    return this.chain;
  }

  async init() {
    if (!this.dir) return;
    await fs.mkdir(this.dir, { recursive: true });
    try {
      this.db = { ...this.db, ...JSON.parse(await fs.readFile(path.join(this.dir, 'db.json'), 'utf8')) };
      this.seq = this.db.ledger.length;
    } catch { /* first run */ }
    try {
      this.world = JSON.parse(await fs.readFile(path.join(this.dir, 'world.json'), 'utf8'));
    } catch { /* first run */ }
  }
  private flush() {
    return this.write('db.json', JSON.stringify(this.db));
  }
  async loadWorld() { return this.world ? structuredClone(this.world) : null; }
  async saveWorld(w: WorldState) {
    this.world = structuredClone({ ...w, ledger: [] });
    await this.write('world.json', JSON.stringify(this.world));
    await this.flush();
  }
  async appendLedger(entries: LedgerEntry[]) {
    for (const e of entries) this.db.ledger.push({ ...e, id: String(++this.seq) });
    if (this.db.ledger.length > 50000) this.db.ledger.splice(0, this.db.ledger.length - 50000);
  }
  async ledgerFor(playerId: string, limit: number) {
    return this.db.ledger.filter((e) => e.playerId === playerId).slice(-limit).reverse();
  }
  async createUser(u: UserRecord) {
    if (this.db.users.some((x) => x.username.toLowerCase() === u.username.toLowerCase())) throw new Error('username_taken');
    this.db.users.push(u);
    await this.flush();
  }
  async userByName(username: string) { return this.db.users.find((u) => u.username.toLowerCase() === username.toLowerCase()) ?? null; }
  async userById(id: string) { return this.db.users.find((u) => u.id === id) ?? null; }
  async userByNear(a: string) { return this.db.users.find((u) => u.nearAccountId === a) ?? null; }
  async setNearAccount(userId: string, accountId: string) {
    if (this.db.users.some((u) => u.nearAccountId === accountId && u.id !== userId)) throw new Error('near_account_taken');
    const u = this.db.users.find((x) => x.id === userId);
    if (u) u.nearAccountId = accountId;
    await this.flush();
  }
  async createSession(tokenHash: string, userId: string, expiresAt: Date) {
    this.db.sessions.push({ tokenHash, userId, expiresAt: expiresAt.toISOString() });
    await this.flush();
  }
  async sessionUser(tokenHash: string) {
    const s = this.db.sessions.find((x) => x.tokenHash === tokenHash);
    if (!s || new Date(s.expiresAt) < new Date()) return null;
    return this.userById(s.userId);
  }
  async deleteSession(tokenHash: string) { this.db.sessions = this.db.sessions.filter((s) => s.tokenHash !== tokenHash); await this.flush(); }
  async getIdempotent(key: string) { return this.db.idem[key]?.response ?? null; }
  async putIdempotent(key: string, userId: string, response: unknown) {
    this.db.idem[key] = { userId, response, at: Date.now() };
    const keys = Object.keys(this.db.idem);
    if (keys.length > 20000) for (const k of keys.slice(0, 5000)) delete this.db.idem[k];
  }
  async putChallenge(nonce: string, userId: string | null, expiresAt: Date) { this.db.challenges[nonce] = { userId, expiresAt: expiresAt.toISOString() }; }
  async takeChallenge(nonce: string) {
    const c = this.db.challenges[nonce];
    if (!c) return null;
    delete this.db.challenges[nonce];
    return { userId: c.userId, expiresAt: new Date(c.expiresAt) };
  }
  async upsertChainTx(tx: ChainTxRecord) {
    const i = this.db.txs.findIndex((t) => t.hash === tx.hash);
    if (i >= 0) this.db.txs[i] = tx;
    else this.db.txs.push(tx);
    await this.flush();
  }
  async chainTx(hash: string) { return this.db.txs.find((t) => t.hash === hash) ?? null; }
  async chainTxsFor(userId: string) { return this.db.txs.filter((t) => t.userId === userId).reverse(); }
  async close() { await this.flush(); }
}
