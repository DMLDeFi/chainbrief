import crypto from 'node:crypto';
import { ed25519 } from '@noble/curves/ed25519.js';
import { base58, base64, hex } from '@scure/base';

/**
 * The game's certificate authority. It signs short-lived statements such as
 * "account X owns business Y at level Z"; the NEAR contract verifies them with
 * env::ed25519_verify before minting. This key is NOT a NEAR account key: it can
 * only vouch for game facts, never move funds. Message formats must match
 * contract/src/lib.rs exactly.
 */
export class CertificateAuthority {
  private secret: Uint8Array;
  readonly publicKey: string;
  constructor(secretHex: string) {
    this.secret = hex.decode(secretHex.trim().toLowerCase());
    if (this.secret.length !== 32) throw new Error('GAME_AUTHORITY_SECRET must be 32 bytes of hex');
    this.publicKey = `ed25519:${base58.encode(ed25519.getPublicKey(this.secret))}`;
  }
  sign(message: string): string {
    return base64.encode(ed25519.sign(new TextEncoder().encode(message), this.secret));
  }
  static generate(): { secretHex: string; publicKey: string } {
    const secret = ed25519.utils.randomSecretKey();
    return { secretHex: hex.encode(secret), publicKey: `ed25519:${base58.encode(ed25519.getPublicKey(secret))}` };
  }
}

export const deedMessage = (account: string, tokenId: string, kind: string, businessId: string, level: number, nonce: string, expiresAtMs: number) =>
  `merchants-of-near:deed:v1|${account}|${tokenId}|${kind}|${businessId}|${level}|${nonce}|${expiresAtMs}`;

export const badgeMessage = (account: string, achievementId: string, nonce: string, expiresAtMs: number) =>
  `merchants-of-near:badge:v1|${account}|${achievementId}|${nonce}|${expiresAtMs}`;

export const certNonce = () => crypto.randomBytes(12).toString('base64url');
