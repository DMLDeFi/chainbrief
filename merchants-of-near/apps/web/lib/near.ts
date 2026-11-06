'use client';
import type { NearConnector } from '@hot-labs/near-connect';
import { api } from './api';

/**
 * NEAR wallet integration via NEAR Connect (@hot-labs/near-connect), the
 * sandboxed wallet connector featured in NEAR's web-login docs. Private keys
 * never leave the user's wallet: the game only receives account ids, public
 * keys, NEP-413 signatures and transaction hashes.
 */
export interface NearConfig {
  networkId: 'testnet' | 'mainnet';
  rpcUrl: string;
  contractId: string | null;
  gameAuthority: string | null;
  recipient: string;
  explorerTx: string;
  certificatesEnabled: boolean;
  mintDeposit: string;
  gas: string;
}

let connector: NearConnector | null = null;
let config: NearConfig | null = null;

export async function nearConfig(): Promise<NearConfig> {
  if (!config) config = await api<NearConfig>('/near/config');
  return config;
}

async function getConnector(): Promise<NearConnector> {
  if (connector) return connector;
  const cfg = await nearConfig();
  const { NearConnector } = await import('@hot-labs/near-connect');
  connector = new NearConnector({ network: cfg.networkId, features: { signMessage: true, signAndSendTransaction: true }, footerBranding: null });
  return connector;
}

const b64ToBytes = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

/** Connect a wallet and prove account ownership with a NEP-413 signed challenge. Works for login and for linking. */
export async function signInWithNear(): Promise<{ accountId: string }> {
  const c = await getConnector();
  const challenge = await api<{ message: string; nonce: string; recipient: string }>('/near/challenge', { body: {} });
  const wallet = await c.connect();
  const signed = await wallet.signMessage({ message: challenge.message, recipient: challenge.recipient, nonce: b64ToBytes(challenge.nonce) });
  await api('/near/verify', {
    body: { accountId: signed.accountId, publicKey: signed.publicKey, signature: signed.signature, nonce: challenge.nonce, message: challenge.message },
  });
  return { accountId: signed.accountId };
}

export async function disconnectWallet() {
  if (!connector) return;
  try {
    await connector.disconnect();
  } catch { /* already disconnected */ }
}

export interface ContractCall {
  receiverId: string;
  methodName: string;
  args: Record<string, unknown>;
  deposit: string;
  gas: string;
}

export interface SubmittedTx {
  hash: string;
  status: 'pending' | 'success' | 'failure' | 'unverified';
  error: string | null;
  explorer: string;
}

/**
 * Ask the user's wallet to sign and send a contract call, then hand the
 * resulting hash to the server, which verifies the outcome on-chain.
 */
export async function sendContractCall(call: ContractCall, kind: string, reference?: string): Promise<SubmittedTx> {
  const c = await getConnector();
  const wallet = await c.wallet();
  const outcome = (await wallet.signAndSendTransaction({
    receiverId: call.receiverId,
    actions: [{ type: 'FunctionCall', params: { methodName: call.methodName, args: call.args, gas: call.gas, deposit: call.deposit } }],
  })) as unknown as { transaction?: { hash?: string }; transaction_outcome?: { id?: string } };
  const hash = outcome?.transaction?.hash ?? outcome?.transaction_outcome?.id;
  if (!hash) throw new Error('Wallet did not return a transaction hash');
  return api<SubmittedTx>('/near/tx', { body: { hash, kind, reference: reference ?? null } });
}

/** Read-only contract view straight from NEAR RPC (no wallet needed). */
export async function viewContract<T>(method: string, args: Record<string, unknown>): Promise<T> {
  const cfg = await nearConfig();
  if (!cfg.contractId) throw new Error('Contract not configured');
  const res = await fetch(cfg.rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'mon',
      method: 'query',
      params: { request_type: 'call_function', finality: 'final', account_id: cfg.contractId, method_name: method, args_base64: btoa(JSON.stringify(args)) },
    }),
  });
  const body = await res.json();
  if (body.error) throw new Error(body.error.cause?.name ?? body.error.message ?? 'RPC error');
  return JSON.parse(new TextDecoder().decode(new Uint8Array(body.result.result))) as T;
}
