import { ed25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { base58, base64 } from '@scure/base';

/**
 * NEP-413 off-chain message signing ("signMessage").
 * payload = borsh({ tag: u32 = 2^31 + 413, message: string, nonce: [u8; 32], recipient: string, callbackUrl: Option<string> })
 * signature = ed25519(sha256(payload))
 */
export const NEP413_TAG = 2 ** 31 + 413;

function borshString(s: string): Uint8Array {
  const bytes = new TextEncoder().encode(s);
  const out = new Uint8Array(4 + bytes.length);
  new DataView(out.buffer).setUint32(0, bytes.length, true);
  out.set(bytes, 4);
  return out;
}

export function nep413Payload(message: string, nonce: Uint8Array, recipient: string, callbackUrl?: string): Uint8Array {
  if (nonce.length !== 32) throw new Error('nonce must be 32 bytes');
  const tag = new Uint8Array(4);
  new DataView(tag.buffer).setUint32(0, NEP413_TAG, true);
  const parts = [tag, borshString(message), nonce, borshString(recipient), callbackUrl ? new Uint8Array([1, ...borshString(callbackUrl)]) : new Uint8Array([0])];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export function parsePublicKey(pk: string): Uint8Array {
  const [curve, data] = pk.includes(':') ? pk.split(':') : ['ed25519', pk];
  if (curve !== 'ed25519') throw new Error('Only ed25519 keys are supported');
  const raw = base58.decode(data);
  if (raw.length !== 32) throw new Error('Invalid public key length');
  return raw;
}

export function decodeSignature(sig: string): Uint8Array {
  // Wallets return base64; some return base58 with or without an "ed25519:" prefix.
  const clean = sig.startsWith('ed25519:') ? sig.slice(8) : sig;
  try {
    const b = base64.decode(clean);
    if (b.length === 64) return b;
  } catch { /* fall through */ }
  const b = base58.decode(clean);
  if (b.length !== 64) throw new Error('Invalid signature length');
  return b;
}

export function verifyNep413(args: { message: string; nonce: Uint8Array; recipient: string; publicKey: string; signature: string; callbackUrl?: string }): boolean {
  try {
    const hash = sha256(nep413Payload(args.message, args.nonce, args.recipient, args.callbackUrl));
    return ed25519.verify(decodeSignature(args.signature), hash, parsePublicKey(args.publicKey));
  } catch {
    return false;
  }
}
