import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt) as (pw: string, salt: Buffer, len: number, opts: crypto.ScryptOptions) => Promise<Buffer>;
const PARAMS = { N: 16384, r: 8, p: 1 };

/** scrypt password hash in the form `scrypt$N$r$p$salt$hash` (base64). */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, 32, PARAMS);
  return `scrypt$${PARAMS.N}$${PARAMS.r}$${PARAMS.p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const [alg, n, r, p, salt, hash] = stored.split('$');
  if (alg !== 'scrypt') return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = await scrypt(password, Buffer.from(salt, 'base64'), expected.length, { N: Number(n), r: Number(r), p: Number(p) });
  return crypto.timingSafeEqual(expected, actual);
}

/** Opaque random session token; only its SHA-256 is stored server-side. */
export function newSessionToken(): { token: string; hash: string } {
  const token = crypto.randomBytes(32).toString('base64url');
  return { token, hash: hashToken(token) };
}
export const hashToken = (t: string) => crypto.createHash('sha256').update(t).digest('hex');
export const newId = (prefix: string) => `${prefix}_${crypto.randomBytes(9).toString('base64url')}`;

/** Simple per-key token bucket for action rate limiting. */
export class TokenBucket {
  private buckets = new Map<string, { tokens: number; at: number }>();
  constructor(private capacity: number, private refillPerSec: number) {}
  take(key: string, cost = 1): boolean {
    const now = Date.now();
    const b = this.buckets.get(key) ?? { tokens: this.capacity, at: now };
    b.tokens = Math.min(this.capacity, b.tokens + ((now - b.at) / 1000) * this.refillPerSec);
    b.at = now;
    if (b.tokens < cost) {
      this.buckets.set(key, b);
      return false;
    }
    b.tokens -= cost;
    this.buckets.set(key, b);
    if (this.buckets.size > 50000) this.buckets.clear();
    return true;
  }
}
