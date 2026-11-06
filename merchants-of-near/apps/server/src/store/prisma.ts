import { PrismaPg } from '@prisma/adapter-pg';
import type { LedgerEntry, WorldState } from '@mon/engine';
import { PrismaClient, Prisma } from '../generated/prisma/client';
import type { ChainTxRecord, Store, UserRecord } from './types';

const toUser = (u: { id: string; username: string; passwordHash: string | null; nearAccountId: string | null; createdAt: Date }): UserRecord => ({
  ...u,
  createdAt: u.createdAt.toISOString(),
});

/** PostgreSQL persistence through Prisma (driver adapter, no native query engine). */
export class PrismaStore implements Store {
  readonly kind = 'postgres' as const;
  private db: PrismaClient;
  constructor(url: string) {
    this.db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  }
  async init() {
    await this.db.$queryRaw`SELECT 1`;
  }
  async loadWorld() {
    const row = await this.db.worldSnapshot.findUnique({ where: { id: 'main' } });
    return row ? (row.data as unknown as WorldState) : null;
  }
  async saveWorld(w: WorldState) {
    const data = { ...w, ledger: [] } as unknown as Prisma.InputJsonValue;
    await this.db.worldSnapshot.upsert({ where: { id: 'main' }, create: { id: 'main', tick: w.tick, data }, update: { tick: w.tick, data } });
  }
  async appendLedger(entries: LedgerEntry[]) {
    if (!entries.length) return;
    await this.db.ledgerEntry.createMany({
      data: entries.map((e) => ({
        playerId: e.playerId,
        tick: e.tick,
        type: e.type,
        goldDelta: new Prisma.Decimal(e.goldDelta),
        items: (e.items ?? undefined) as Prisma.InputJsonValue | undefined,
        details: e.details as Prisma.InputJsonValue,
      })),
    });
  }
  async ledgerFor(playerId: string, limit: number) {
    const rows = await this.db.ledgerEntry.findMany({ where: { playerId }, orderBy: { id: 'desc' }, take: limit });
    return rows.map((r) => ({
      id: r.id.toString(),
      playerId: r.playerId,
      tick: r.tick,
      type: r.type,
      goldDelta: Number(r.goldDelta),
      items: (r.items ?? undefined) as LedgerEntry['items'],
      details: r.details as Record<string, unknown>,
    }));
  }
  async createUser(u: UserRecord) {
    try {
      await this.db.user.create({ data: { id: u.id, username: u.username, passwordHash: u.passwordHash, nearAccountId: u.nearAccountId } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new Error('username_taken');
      throw e;
    }
  }
  async userByName(username: string) {
    const u = await this.db.user.findFirst({ where: { username: { equals: username, mode: 'insensitive' } } });
    return u ? toUser(u) : null;
  }
  async userById(id: string) {
    const u = await this.db.user.findUnique({ where: { id } });
    return u ? toUser(u) : null;
  }
  async userByNear(accountId: string) {
    const u = await this.db.user.findUnique({ where: { nearAccountId: accountId } });
    return u ? toUser(u) : null;
  }
  async setNearAccount(userId: string, accountId: string) {
    try {
      await this.db.user.update({ where: { id: userId }, data: { nearAccountId: accountId } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new Error('near_account_taken');
      throw e;
    }
  }
  async createSession(tokenHash: string, userId: string, expiresAt: Date) {
    await this.db.session.create({ data: { tokenHash, userId, expiresAt } });
  }
  async sessionUser(tokenHash: string) {
    const s = await this.db.session.findUnique({ where: { tokenHash }, include: { user: true } });
    if (!s || s.expiresAt < new Date()) return null;
    return toUser(s.user);
  }
  async deleteSession(tokenHash: string) {
    await this.db.session.deleteMany({ where: { tokenHash } });
  }
  async getIdempotent(key: string) {
    const r = await this.db.idempotencyKey.findUnique({ where: { key } });
    return r?.response ?? null;
  }
  async putIdempotent(key: string, userId: string, response: unknown) {
    await this.db.idempotencyKey.upsert({ where: { key }, create: { key, userId, response: response as Prisma.InputJsonValue }, update: {} });
  }
  async putChallenge(nonce: string, userId: string | null, expiresAt: Date) {
    await this.db.nearChallenge.create({ data: { nonce, userId, expiresAt } });
  }
  async takeChallenge(nonce: string) {
    // deleteMany returns a count, so concurrent consumers cannot both succeed.
    const row = await this.db.nearChallenge.findUnique({ where: { nonce } });
    if (!row) return null;
    const { count } = await this.db.nearChallenge.deleteMany({ where: { nonce } });
    return count === 1 ? { userId: row.userId, expiresAt: row.expiresAt } : null;
  }
  async upsertChainTx(tx: ChainTxRecord) {
    const data = { ...tx, createdAt: new Date(tx.createdAt), verifiedAt: tx.verifiedAt ? new Date(tx.verifiedAt) : null };
    await this.db.chainTransaction.upsert({ where: { hash: tx.hash }, create: data, update: data });
  }
  async chainTx(hash: string) {
    const t = await this.db.chainTransaction.findUnique({ where: { hash } });
    return t ? this.toTx(t) : null;
  }
  async chainTxsFor(userId: string) {
    const rows = await this.db.chainTransaction.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 100 });
    return rows.map((t) => this.toTx(t));
  }
  private toTx(t: { hash: string; userId: string; accountId: string; kind: string; status: string; reference: string | null; error: string | null; createdAt: Date; verifiedAt: Date | null }): ChainTxRecord {
    return { ...t, kind: t.kind as ChainTxRecord['kind'], status: t.status as ChainTxRecord['status'], createdAt: t.createdAt.toISOString(), verifiedAt: t.verifiedAt?.toISOString() ?? null };
  }
  async close() {
    await this.db.$disconnect();
  }
}
