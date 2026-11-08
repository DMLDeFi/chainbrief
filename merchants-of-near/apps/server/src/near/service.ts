import crypto from 'node:crypto';
import { invalidateBizIndex, pushFeed, type WorldState } from '@mon/engine';
import type { ServerConfig } from '../config';
import type { ChainTxRecord, Store } from '../store/types';
import { CertificateAuthority, badgeMessage, certNonce, deedMessage } from './certificates';
import { verifyNep413 } from './nep413';
import { NearRpc, NearRpcError } from './rpc';

const ACCOUNT_RE = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;
export const isAccountId = (a: string) => a.length >= 2 && a.length <= 64 && ACCOUNT_RE.test(a);
const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const CERT_TTL_MS = 10 * 60 * 1000;
export const MINT_DEPOSIT_YOCTO = '10000000000000000000000'; // 0.01 NEAR
export const CALL_GAS = '30000000000000'; // 30 Tgas

export interface OnChainDeed {
  token_id: string;
  owner_id: string;
  kind: string;
  business_id: string;
  level: number;
  listed_price: string | null;
  sales: number;
}

/**
 * NEAR integration: wallet login (NEP-413), certificates for deeds and badges,
 * and verification of transactions the player's wallet submitted. Transaction
 * status is always read back from the chain — the server never marks a
 * transaction successful on the client's word.
 */
export class NearService {
  readonly rpc: NearRpc;
  readonly authority?: CertificateAuthority;
  constructor(private cfg: ServerConfig['near'], private store: Store, rpc?: NearRpc) {
    this.rpc = rpc ?? new NearRpc(cfg.rpcUrl);
    if (cfg.authoritySecretHex) this.authority = new CertificateAuthority(cfg.authoritySecretHex);
  }

  publicConfig() {
    return {
      networkId: this.cfg.networkId,
      rpcUrl: this.cfg.rpcUrl,
      contractId: this.cfg.contractId ?? null,
      gameAuthority: this.authority?.publicKey ?? null,
      recipient: this.cfg.recipient,
      explorerTx: this.cfg.explorerTx,
      certificatesEnabled: !!(this.authority && this.cfg.contractId),
      mintDeposit: MINT_DEPOSIT_YOCTO,
      gas: CALL_GAS,
    };
  }

  async challenge(userId: string | null) {
    const nonce = crypto.randomBytes(32);
    const nonceB64 = nonce.toString('base64');
    await this.store.putChallenge(nonceB64, userId, new Date(Date.now() + CHALLENGE_TTL_MS));
    return { message: `Sign in to Merchants of NEAR\nNonce: ${nonce.toString('hex').slice(0, 16)}`, nonce: nonceB64, recipient: this.cfg.recipient };
  }

  /**
   * Verify a NEP-413 signed message: the signature must be valid for the exact
   * challenge we issued (single use, 5-minute expiry) and the public key must be
   * a full-access key of the claimed account *on-chain*.
   */
  async verifyLogin(input: { accountId: string; publicKey: string; signature: string; nonce: string; message: string }): Promise<{ ok: true; challengeUserId: string | null } | { ok: false; error: string }> {
    if (!isAccountId(input.accountId)) return { ok: false, error: 'Invalid NEAR account id' };
    const ch = await this.store.takeChallenge(input.nonce);
    if (!ch) return { ok: false, error: 'Unknown or already-used challenge' };
    if (ch.expiresAt < new Date()) return { ok: false, error: 'Challenge expired' };
    const nonce = Buffer.from(input.nonce, 'base64');
    const valid = verifyNep413({ message: input.message, nonce, recipient: this.cfg.recipient, publicKey: input.publicKey, signature: input.signature });
    if (!valid) return { ok: false, error: 'Signature does not match the challenge' };
    try {
      const key = await this.rpc.viewAccessKey(input.accountId, input.publicKey);
      if (!key) return { ok: false, error: 'That public key is not an access key of this account' };
      if (key.permission !== 'FullAccess') return { ok: false, error: 'Sign in with a full-access key' };
    } catch (e) {
      return { ok: false, error: `Could not verify the key on-chain: ${(e as Error).message}` };
    }
    return { ok: true, challengeUserId: ch.userId };
  }

  private requireCerts(): CertificateAuthority {
    if (!this.authority || !this.cfg.contractId) throw new Error('On-chain certificates are not configured on this server (set GAME_AUTHORITY_SECRET and NEAR_CONTRACT_ID)');
    return this.authority;
  }

  /** Build a wallet-ready `claim_deed` call for a business the player owns. */
  deedCertificate(world: WorldState, playerId: string, businessId: string) {
    const ca = this.requireCerts();
    const p = world.players[playerId];
    const b = world.businesses[businessId];
    if (!p?.nearAccountId) throw new Error('Connect a NEAR wallet first');
    if (!b || b.ownerId !== playerId) throw new Error('You do not own that business');
    const tokenId = b.deedTokenId ?? `deed-${b.id}`;
    const nonce = certNonce();
    const expires = Date.now() + CERT_TTL_MS;
    const signature = ca.sign(deedMessage(p.nearAccountId, tokenId, b.kind, b.id, b.level, nonce, expires));
    return {
      receiverId: this.cfg.contractId!,
      methodName: 'claim_deed',
      args: { token_id: tokenId, kind: b.kind, business_id: b.id, level: b.level, nonce, expires_at_ms: expires, signature },
      deposit: MINT_DEPOSIT_YOCTO,
      gas: CALL_GAS,
    };
  }

  badgeCertificate(world: WorldState, playerId: string, achievementId: string) {
    const ca = this.requireCerts();
    const p = world.players[playerId];
    if (!p?.nearAccountId) throw new Error('Connect a NEAR wallet first');
    if (p.achievements[achievementId] === undefined) throw new Error('You have not earned that achievement');
    const nonce = certNonce();
    const expires = Date.now() + CERT_TTL_MS;
    return {
      receiverId: this.cfg.contractId!,
      methodName: 'record_achievement',
      args: { achievement_id: achievementId, nonce, expires_at_ms: expires, signature: ca.sign(badgeMessage(p.nearAccountId, achievementId, nonce, expires)) },
      deposit: MINT_DEPOSIT_YOCTO,
      gas: CALL_GAS,
    };
  }

  /**
   * Record and verify a transaction the player's wallet sent. The outcome is
   * fetched from NEAR RPC; if RPC is unreachable the record stays `pending`.
   */
  async submitTx(world: WorldState, userId: string, accountId: string, hash: string, kind: ChainTxRecord['kind'], reference: string | null): Promise<ChainTxRecord> {
    if (!/^[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(hash)) throw new Error('Invalid transaction hash');
    const existing = await this.store.chainTx(hash);
    if (existing && existing.userId !== userId) throw new Error('Transaction already registered by another player');
    const rec: ChainTxRecord = existing ?? { hash, userId, accountId, kind, status: 'pending', reference, error: null, createdAt: new Date().toISOString(), verifiedAt: null };
    if (rec.status === 'success') return rec;
    try {
      const out = await this.rpc.txStatus(hash, accountId);
      if (out.signerId !== accountId) throw new Error('Transaction was not signed by your connected account');
      if (this.cfg.contractId && out.receiverId !== this.cfg.contractId) throw new Error('Transaction was not sent to the game contract');
      rec.status = out.success ? 'success' : 'failure';
      rec.error = out.failure ?? null;
      rec.verifiedAt = new Date().toISOString();
      if (out.success) this.applyEvents(world, userId, accountId, out.events);
    } catch (e) {
      if (e instanceof NearRpcError) {
        rec.status = 'pending'; // not yet visible, or RPC unreachable: never assume success
        rec.error = e.message;
      } else {
        rec.status = 'failure';
        rec.error = (e as Error).message;
      }
    }
    await this.store.upsertChainTx(rec);
    return rec;
  }

  /** Apply verified on-chain events to game state. */
  private applyEvents(world: WorldState, userId: string, accountId: string, events: Array<{ event: string; data: unknown[] }>) {
    for (const e of events) {
      const d = (e.data?.[0] ?? {}) as Record<string, string>;
      if (e.event === 'deed_claimed' && d.owner_id === accountId) {
        const b = Object.values(world.businesses).find((x) => `deed-${x.id}` === d.token_id || x.deedTokenId === d.token_id);
        if (b && b.ownerId === userId) {
          b.deedTokenId = d.token_id;
          b.chainOwner = accountId;
          pushFeed(world, { kind: 'player', actor: userId, text: `${world.players[userId]?.name} secured the deed to ${b.name} on NEAR (${d.token_id}).`, severity: 'good' });
        }
      }
      if (e.event === 'deed_sold' && d.buyer_id === accountId) void this.syncDeed(world, d.token_id);
    }
  }

  /**
   * Follow on-chain ownership: if a deed has changed hands on NEAR, the business
   * moves to the game profile linked to the new owner account.
   */
  async syncDeed(world: WorldState, tokenId: string): Promise<{ changed: boolean; owner?: string }> {
    if (!this.cfg.contractId) return { changed: false };
    const deed = await this.rpc.viewFunction<OnChainDeed | null>(this.cfg.contractId, 'get_deed', { token_id: tokenId });
    if (!deed) return { changed: false };
    const b = world.businesses[deed.business_id];
    if (!b) return { changed: false, owner: deed.owner_id };
    const current = world.players[b.ownerId];
    if (current?.nearAccountId === deed.owner_id) return { changed: false, owner: deed.owner_id };
    const newOwner = Object.values(world.players).find((p) => p.nearAccountId === deed.owner_id);
    if (!newOwner) {
      // Held by an account with no game profile yet: production pauses until they join.
      b.chainOwner = deed.owner_id;
      return { changed: false, owner: deed.owner_id };
    }
    const from = current?.name ?? 'unknown';
    b.ownerId = newOwner.id;
    invalidateBizIndex(world);
    b.name = `${newOwner.name}'s ${b.kind[0].toUpperCase()}${b.kind.slice(1)}`;
    b.deedTokenId = tokenId;
    b.chainOwner = deed.owner_id;
    world.ledger.push({ tick: world.tick, playerId: newOwner.id, type: 'deed.acquired', goldDelta: 0, details: { tokenId, from } });
    pushFeed(world, { kind: 'player', actor: newOwner.id, text: `Deed ${tokenId} changed hands on NEAR: ${newOwner.name} now owns the former business of ${from}.`, severity: 'good' });
    return { changed: true, owner: deed.owner_id };
  }

  async syncAll(world: WorldState): Promise<number> {
    let changed = 0;
    for (const b of Object.values(world.businesses)) {
      if (!b.deedTokenId) continue;
      try {
        if ((await this.syncDeed(world, b.deedTokenId)).changed) changed += 1;
      } catch { /* RPC unavailable: try again next cycle */ }
    }
    return changed;
  }
}
