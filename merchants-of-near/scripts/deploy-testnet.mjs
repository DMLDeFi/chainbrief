/**
 * Zero-CLI testnet deployment with near-api-js.
 *
 *   node scripts/deploy-testnet.mjs [account-prefix]
 *
 * 1. Uses GAME_AUTHORITY_SECRET from .env (or generates one and writes it there).
 * 2. Creates a funded `<prefix>-<random>.testnet` account through the testnet faucet.
 * 3. Deploys contract/target/near/merchants_of_near.wasm and calls `new` in the same transaction.
 * 4. Writes NEAR_CONTRACT_ID to .env and the account key to ~/.near-credentials/testnet/
 *    (the standard NEAR CLI location — never inside the repository).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Account, JsonRpcProvider, KeyPair, actions, teraToGas } from 'near-api-js';
import { ed25519 } from '@noble/curves/ed25519.js';
import { base58, hex } from '@scure/base';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envPath = path.join(root, '.env');
const RPC = process.env.NEAR_RPC_URL ?? 'https://rpc.testnet.near.org';
const wasmPath = path.join(root, 'contract/target/near/merchants_of_near.wasm');

function readEnv() {
  return fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : fs.readFileSync(path.join(root, '.env.example'), 'utf8');
}
function setEnv(text, key, value) {
  const re = new RegExp(`^${key}=.*$`, 'm');
  return re.test(text) ? text.replace(re, `${key}=${value}`) : `${text.trimEnd()}\n${key}=${value}\n`;
}

let env = readEnv();
let secret = env.match(/^GAME_AUTHORITY_SECRET=([0-9a-f]{64})$/m)?.[1];
if (!secret) {
  secret = hex.encode(ed25519.utils.randomSecretKey());
  env = setEnv(env, 'GAME_AUTHORITY_SECRET', secret);
}
const authority = `ed25519:${base58.encode(ed25519.getPublicKey(hex.decode(secret)))}`;

if (!fs.existsSync(wasmPath)) throw new Error(`Build the contract first: cd contract && cargo near build non-reproducible-wasm (${wasmPath} missing)`);
const code = fs.readFileSync(wasmPath);

const accountId = `${process.argv[2] ?? 'mon-game'}-${crypto.randomBytes(3).toString('hex')}.testnet`;
const keyPair = KeyPair.fromRandom('ed25519');
console.log(`Creating ${accountId} via the testnet faucet…`);
const res = await fetch('https://helper.nearprotocol.com/account', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ newAccountId: accountId, newAccountPublicKey: keyPair.getPublicKey().toString() }),
});
if (!res.ok) throw new Error(`Faucet refused: ${res.status} ${await res.text()}`);

const credDir = path.join(os.homedir(), '.near-credentials', 'testnet');
fs.mkdirSync(credDir, { recursive: true });
fs.writeFileSync(path.join(credDir, `${accountId}.json`), JSON.stringify({ account_id: accountId, public_key: keyPair.getPublicKey().toString(), private_key: keyPair.toString() }), { mode: 0o600 });

const provider = new JsonRpcProvider({ url: RPC });
// Wait until the faucet's account creation is visible.
for (let i = 0; i < 20; i++) {
  try {
    await provider.query({ request_type: 'view_account', finality: 'final', account_id: accountId });
    break;
  } catch {
    await new Promise((r) => setTimeout(r, 1500));
  }
}
const account = new Account(accountId, provider, keyPair.toString());
console.log(`Deploying ${(code.length / 1024).toFixed(0)} KB and initialising with game authority ${authority}…`);
const tx = await account.signAndSendTransaction({
  receiverId: accountId,
  actions: [actions.deployContract(code), actions.functionCall('new', { owner_id: accountId, game_authority: authority }, teraToGas(100), 0n)],
  waitUntil: 'FINAL',
});
const hash = tx.transaction.hash;
const status = tx.status;
if (typeof status === 'object' && 'Failure' in status) throw new Error(`Deploy failed: ${JSON.stringify(status.Failure)} (tx ${hash})`);

env = setEnv(env, 'NEAR_CONTRACT_ID', accountId);
env = setEnv(env, 'NEAR_NETWORK_ID', 'testnet');
fs.writeFileSync(envPath, env, { mode: 0o600 });

const cfg = await provider.callFunction({ contractId: accountId, method: 'get_config', args: {} }).catch(() => null);
console.log(`\nDeployed ${accountId}`);
console.log(`Transaction: https://testnet.nearblocks.io/txns/${hash}`);
console.log(`get_config: ${JSON.stringify(cfg)}`);
console.log(`NEAR_CONTRACT_ID and GAME_AUTHORITY_SECRET are in ${envPath} (gitignored). Restart the server.`);
