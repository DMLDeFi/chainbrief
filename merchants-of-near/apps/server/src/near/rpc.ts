/**
 * Minimal NEAR JSON-RPC client. Every on-chain fact the server relies on
 * (access keys, transaction outcomes, deed ownership) is read from the chain —
 * nothing is assumed or simulated.
 */
export class NearRpcError extends Error {
  constructor(message: string, readonly kind: 'unreachable' | 'rpc' | 'not_found') {
    super(message);
  }
}

export type Fetch = typeof fetch;

export class NearRpc {
  constructor(private url: string, private fetchImpl: Fetch = fetch) {}

  async call<T>(method: string, params: unknown): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchImpl(this.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 'mon', method, params }),
        signal: AbortSignal.timeout(10000),
      });
    } catch (e) {
      throw new NearRpcError(`NEAR RPC unreachable (${(e as Error).message})`, 'unreachable');
    }
    if (!res.ok) throw new NearRpcError(`NEAR RPC HTTP ${res.status}`, 'unreachable');
    const body = (await res.json()) as { result?: T; error?: { name?: string; cause?: { name?: string }; message?: string; data?: unknown } };
    if (body.error) {
      const name = body.error.cause?.name ?? body.error.name ?? 'RPC_ERROR';
      const kind = /UNKNOWN_TRANSACTION|UNKNOWN_ACCESS_KEY|UNKNOWN_ACCOUNT/.test(name) ? 'not_found' : 'rpc';
      throw new NearRpcError(`${name}: ${body.error.message ?? JSON.stringify(body.error.data ?? '')}`, kind);
    }
    return body.result as T;
  }

  /** Returns the access key permission if `publicKey` is a key of `accountId`. */
  async viewAccessKey(accountId: string, publicKey: string): Promise<{ permission: unknown } | null> {
    try {
      const r = await this.call<{ permission: unknown; error?: string }>('query', { request_type: 'view_access_key', finality: 'final', account_id: accountId, public_key: publicKey });
      if ((r as { error?: string }).error) return null;
      return r;
    } catch (e) {
      if (e instanceof NearRpcError && e.kind === 'not_found') return null;
      throw e;
    }
  }

  async viewFunction<T>(contractId: string, method: string, args: Record<string, unknown>): Promise<T> {
    const r = await this.call<{ result: number[] }>('query', {
      request_type: 'call_function',
      finality: 'final',
      account_id: contractId,
      method_name: method,
      args_base64: Buffer.from(JSON.stringify(args)).toString('base64'),
    });
    return JSON.parse(Buffer.from(r.result).toString('utf8')) as T;
  }

  /** Transaction outcome, waiting for final execution. */
  async txStatus(hash: string, senderId: string): Promise<TxOutcome> {
    const r = await this.call<RawTx>('tx', { tx_hash: hash, sender_account_id: senderId, wait_until: 'EXECUTED_OPTIMISTIC' });
    return parseOutcome(r);
  }
}

interface RawTx {
  status: { SuccessValue?: string; Failure?: unknown } | string;
  transaction: { signer_id: string; receiver_id: string; actions: Array<Record<string, { method_name?: string; args?: string; deposit?: string }> | string> };
  receipts_outcome?: Array<{ outcome: { logs: string[]; status: { Failure?: unknown } | Record<string, unknown> } }>;
  transaction_outcome?: { outcome: { logs: string[] } };
}

export interface TxOutcome {
  success: boolean;
  failure?: string;
  signerId: string;
  receiverId: string;
  methods: string[];
  events: Array<{ event: string; data: unknown[] }>;
  returnValue?: unknown;
}

export function parseOutcome(r: RawTx): TxOutcome {
  const st = r.status;
  const receiptFailure = r.receipts_outcome?.find((ro) => ro.outcome.status && 'Failure' in ro.outcome.status);
  const failure = typeof st === 'object' && st.Failure ? JSON.stringify(st.Failure) : receiptFailure ? JSON.stringify((receiptFailure.outcome.status as { Failure: unknown }).Failure) : undefined;
  const success = typeof st === 'object' && 'SuccessValue' in st && !failure;
  const methods: string[] = [];
  for (const a of r.transaction.actions) {
    if (typeof a === 'object' && a.FunctionCall?.method_name) methods.push(a.FunctionCall.method_name);
  }
  const events: TxOutcome['events'] = [];
  for (const ro of r.receipts_outcome ?? []) {
    for (const log of ro.outcome.logs) {
      if (!log.startsWith('EVENT_JSON:')) continue;
      try {
        const e = JSON.parse(log.slice(11));
        if (e.standard === 'merchants_of_near') events.push({ event: e.event, data: e.data });
      } catch { /* ignore malformed */ }
    }
  }
  let returnValue: unknown;
  if (typeof st === 'object' && st.SuccessValue) {
    try { returnValue = JSON.parse(Buffer.from(st.SuccessValue, 'base64').toString('utf8')); } catch { /* not JSON */ }
  }
  return { success, failure, signerId: r.transaction.signer_id, receiverId: r.transaction.receiver_id, methods, events, returnValue };
}
