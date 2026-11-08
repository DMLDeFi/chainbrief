/**
 * Live testnet end-to-end: two fresh faucet accounts play the full ownership loop
 * against a running server (npm run dev) and the deployed contract.
 *
 *   NODE_USE_ENV_PROXY=1 npx tsx scripts/onchain-e2e.mts [http://localhost:3000]
 *
 * alice: registers → links wallet (NEP-413) → opens a farm → claims its deed on NEAR
 *        → lists the deed for 0.1 NEAR
 * bob:   registers → links wallet → buys the deed on NEAR → the server moves the farm to bob
 */
import crypto from 'node:crypto';
import { Account, JsonRpcProvider, KeyPair, actions, nearToYocto } from 'near-api-js';
import { sha256 } from '@noble/hashes/sha2.js';
import { base64 } from '@scure/base';
import { nep413Payload } from '../apps/server/src/near/nep413.ts';

const BASE = process.argv[2] ?? 'http://localhost:3000';
const RPC = 'https://rpc.testnet.near.org';
const provider = new JsonRpcProvider({ url: RPC });

class Player {
  cookie = '';
  key = KeyPair.fromRandom('ed25519');
  account!: Account;
  constructor(readonly accountId: string) {}
  async api<T = any>(path: string, body?: unknown): Promise<T> {
    const r = await fetch(`${BASE}/api${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), cookie: this.cookie },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = r.headers.get('set-cookie');
    if (set) this.cookie = set.split(';')[0];
    const data = await r.json();
    if (!r.ok) throw new Error(`${path} → ${r.status} ${JSON.stringify(data)}`);
    return data;
  }
  act = (action: Record<string, unknown>) => this.api('/action', { requestId: crypto.randomUUID(), action });
  async fund() {
    const r = await fetch('https://helper.nearprotocol.com/account', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ newAccountId: this.accountId, newAccountPublicKey: this.key.getPublicKey().toString() }) });
    if (!r.ok) throw new Error(`faucet: ${r.status}`);
    for (let i = 0; i < 20; i++) {
      try { await provider.query({ request_type: 'view_account', finality: 'final', account_id: this.accountId }); break; } catch { await new Promise((s) => setTimeout(s, 1500)); }
    }
    this.account = new Account(this.accountId, provider, this.key.toString() as never);
  }
  async linkWallet() {
    const ch = await this.api<{ message: string; nonce: string; recipient: string }>('/near/challenge', {});
    const sig = this.key.sign(sha256(nep413Payload(ch.message, base64.decode(ch.nonce), ch.recipient)));
    return this.api('/near/verify', { accountId: this.accountId, publicKey: this.key.getPublicKey().toString(), signature: base64.encode(sig.signature), nonce: ch.nonce, message: ch.message });
  }
  async call(receiverId: string, method: string, args: object, deposit: bigint, gas = 30_000_000_000_000n) {
    const tx = await this.account.signAndSendTransaction({ receiverId, actions: [actions.functionCall(method, args, gas, deposit)], waitUntil: 'FINAL' });
    return tx.transaction.hash as string;
  }
}

const ok = (msg: string) => console.log(`✓ ${msg}`);
const suffix = crypto.randomBytes(3).toString('hex');
const alice = new Player(`mon-alice-${suffix}.testnet`);
const bob = new Player(`mon-bob-${suffix}.testnet`);

const cfg = await alice.api<{ contractId: string; certificatesEnabled: boolean }>('/near/config');
if (!cfg.certificatesEnabled) throw new Error('Server has no contract configured');

await Promise.all([alice.fund(), bob.fund()]);
ok(`funded ${alice.accountId} and ${bob.accountId} from the testnet faucet`);
await alice.api('/auth/register', { username: `alice_${suffix}`, password: 'testnet-e2e-pass', merchantName: `Alice ${suffix.slice(0, 4)}` });
await bob.api('/auth/register', { username: `bob_${suffix}`, password: 'testnet-e2e-pass', merchantName: `Bob ${suffix.slice(0, 4)}` });
await alice.linkWallet();
await bob.linkWallet();
ok('both wallets linked via NEP-413 (signature + on-chain access-key check)');

const farm = (await alice.act({ type: 'business.buy', kind: 'farm' })).data;
ok(`alice opened ${farm.name} (${farm.id})`);

const cert = await alice.api('/near/certificate/deed', { businessId: farm.id });
const claimHash = await alice.call(cert.receiverId, cert.methodName, cert.args, BigInt(cert.deposit), BigInt(cert.gas));
const claim = await alice.api('/near/tx', { hash: claimHash, kind: 'deed', reference: farm.id });
if (claim.status !== 'success') throw new Error(`claim not verified: ${JSON.stringify(claim)}`);
ok(`deed claimed on-chain and verified by the server: ${claim.explorer}`);

const tokenId = cert.args.token_id as string;
const price = nearToYocto('0.1');
const listHash = await alice.call(cfg.contractId, 'list_deed', { token_id: tokenId, price: price.toString() }, 0n);
await alice.api('/near/tx', { hash: listHash, kind: 'deed_listing', reference: tokenId });
ok(`alice listed ${tokenId} for 0.1 NEAR: https://testnet.nearblocks.io/txns/${listHash}`);

const buyHash = await bob.call(cfg.contractId, 'buy_deed', { token_id: tokenId }, price);
const buy = await bob.api('/near/tx', { hash: buyHash, kind: 'deed_purchase', reference: tokenId });
if (buy.status !== 'success') throw new Error(`purchase not verified: ${JSON.stringify(buy)}`);
ok(`bob bought the deed on NEAR: ${buy.explorer}`);

await bob.api('/near/sync', {});
const bobView = await bob.api('/me');
const aliceView = await alice.api('/me');
const moved = bobView.player.businesses.some((b: { id: string }) => b.id === farm.id) && !aliceView.player.businesses.some((b: { id: string }) => b.id === farm.id);
if (!moved) throw new Error('business did not follow the deed');
ok(`the farm now belongs to bob in-game (followed on-chain ownership)`);

let deed: unknown = null;
for (let i = 0; i < 6 && !deed; i++) {
  deed = await provider.callFunction({ contractId: cfg.contractId, method: 'get_deed', args: { token_id: tokenId } }).catch(async () => { await new Promise((s) => setTimeout(s, 3000 * (i + 1))); return null; });
}
console.log('\nOn-chain deed:', JSON.stringify(deed));
console.log('ON-CHAIN E2E OK');
