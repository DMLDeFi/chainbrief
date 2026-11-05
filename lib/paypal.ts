/**
 * Minimal PayPal REST client (sandbox by default).
 *
 * Covers:
 *   - OAuth2 client-credentials token, cached in memory until shortly before expiry
 *   - Orders v2: create (intent AUTHORIZE), get, authorize
 *   - Payments v2: capture an authorization
 *   - Payouts v1: create batch, get batch status
 *
 * Every write (POST) carries a PayPal-Request-Id header. Pass your own
 * `requestId` to make a call safely retryable across process restarts;
 * otherwise a fresh UUID is generated per logical call and reused for the
 * client's internal retries (network errors / 429 / 5xx).
 */
import { randomUUID } from "node:crypto";

export const PAYPAL_SANDBOX_BASE_URL = "https://api-m.sandbox.paypal.com";
export const PAYOUTS_SCOPE = "https://uri.paypal.com/payments/payouts";

// ---------- Types (only the fields we use; PayPal returns more) ----------

export interface Money {
  currency_code: string;
  value: string;
}

export interface Link {
  href: string;
  rel: string;
  method?: string;
}

export interface Order {
  id: string;
  status: "CREATED" | "SAVED" | "APPROVED" | "VOIDED" | "COMPLETED" | "PAYER_ACTION_REQUIRED";
  intent?: "CAPTURE" | "AUTHORIZE";
  links?: Link[];
  purchase_units?: Array<{
    reference_id?: string;
    amount?: Money;
    payments?: {
      authorizations?: Authorization[];
      captures?: Capture[];
    };
  }>;
}

export interface Authorization {
  id: string;
  status: string; // CREATED | CAPTURED | DENIED | PARTIALLY_CAPTURED | VOIDED | PENDING
  amount?: Money;
  expiration_time?: string;
  links?: Link[];
}

export interface Capture {
  id: string;
  status: string; // COMPLETED | DECLINED | PARTIALLY_REFUNDED | PENDING | REFUNDED | FAILED
  amount?: Money;
  final_capture?: boolean;
  links?: Link[];
}

export interface CreateOrderInput {
  amount: Money;
  description?: string;
  referenceId?: string;
  returnUrl?: string;
  cancelUrl?: string;
  brandName?: string;
  requestId?: string;
}

export interface PayoutItemInput {
  receiver: string; // email for recipient_type EMAIL
  amount: { value: string; currency: string };
  note?: string;
  senderItemId?: string;
  recipientType?: "EMAIL" | "PHONE" | "PAYPAL_ID";
}

export interface CreatePayoutInput {
  senderBatchId?: string;
  emailSubject?: string;
  emailMessage?: string;
  items: PayoutItemInput[];
  requestId?: string;
}

export type PayoutBatchStatus = "DENIED" | "PENDING" | "PROCESSING" | "SUCCESS" | "CANCELED";

export type PayoutItemStatus =
  | "SUCCESS"
  | "FAILED"
  | "PENDING"
  | "UNCLAIMED"
  | "RETURNED"
  | "ONHOLD"
  | "BLOCKED"
  | "REFUNDED"
  | "REVERSED";

export interface PayoutBatchHeader {
  payout_batch_id: string;
  batch_status: PayoutBatchStatus;
  sender_batch_header?: { sender_batch_id?: string };
  time_created?: string;
  time_completed?: string;
  amount?: { value: string; currency: string };
  fees?: { value: string; currency: string };
}

export interface PayoutItem {
  payout_item_id: string;
  transaction_id?: string;
  transaction_status?: PayoutItemStatus;
  payout_batch_id: string;
  payout_item_fee?: { value: string; currency: string };
  payout_item: {
    recipient_type?: string;
    amount: { value: string; currency: string };
    receiver: string;
    note?: string;
    sender_item_id?: string;
  };
  errors?: { name?: string; message?: string };
  links?: Link[];
}

export interface CreatePayoutResponse {
  batch_header: PayoutBatchHeader;
  links?: Link[];
}

export interface PayoutBatch {
  batch_header: PayoutBatchHeader;
  items?: PayoutItem[];
  links?: Link[];
}

/** Item states that will not change on their own in the near term. */
export const FINAL_PAYOUT_ITEM_STATUSES: ReadonlySet<PayoutItemStatus> = new Set([
  "SUCCESS",
  "FAILED",
  "RETURNED",
  "BLOCKED",
  "REFUNDED",
  "REVERSED",
  // UNCLAIMED: receiver has no PayPal account for that email. It only moves to
  // RETURNED after 30 days, so for a spike/poller we treat it as final.
  "UNCLAIMED",
]);

export interface ResponseLogEntry {
  method: string;
  path: string;
  status: number;
  debugId: string | null;
  requestId: string | null;
  attempt: number;
  durationMs: number;
}

export interface PayPalClientOptions {
  clientId: string;
  clientSecret: string;
  baseUrl?: string;
  /** Called after every HTTP response (including the token call and retries). */
  onResponse?: (entry: ResponseLogEntry) => void;
  /** Max attempts for retryable failures (network, 429, 5xx). Default 3. */
  maxAttempts?: number;
  fetchImpl?: typeof fetch;
}

// ---------- Errors ----------

export interface PayPalErrorBody {
  name?: string;
  message?: string;
  debug_id?: string;
  details?: Array<{ issue?: string; description?: string; field?: string }>;
  links?: Link[];
  // OAuth endpoint shape
  error?: string;
  error_description?: string;
}

export class PayPalError extends Error {
  readonly status: number;
  readonly method: string;
  readonly path: string;
  readonly body: PayPalErrorBody | string | null;
  readonly debugId: string | null;

  constructor(method: string, path: string, status: number, body: PayPalErrorBody | string | null, debugId: string | null) {
    const b = typeof body === "object" && body ? body : null;
    const label = b?.name ?? b?.error ?? `HTTP ${status}`;
    const msg = b?.message ?? b?.error_description ?? (typeof body === "string" ? body.slice(0, 300) : "");
    const issues = b?.details?.map((d) => d.issue).filter(Boolean).join(", ");
    super(`${method} ${path} -> ${status} ${label}: ${msg}${issues ? ` [${issues}]` : ""}${debugId ? ` (debug_id ${debugId})` : ""}`);
    this.name = "PayPalError";
    this.status = status;
    this.method = method;
    this.path = path;
    this.body = body;
    this.debugId = debugId;
  }

  /** PayPal's error `name` (e.g. AUTHORIZATION_ERROR), or OAuth `error`. */
  get errorName(): string | undefined {
    if (typeof this.body === "object" && this.body) return this.body.name ?? this.body.error;
    return undefined;
  }

  get issues(): string[] {
    if (typeof this.body === "object" && this.body?.details) {
      return this.body.details.map((d) => d.issue ?? "").filter(Boolean);
    }
    return [];
  }

  /**
   * True when PayPal rejected the call because the app/token lacks permission
   * (as opposed to bad input or funds). For Payouts this almost always means
   * the Payouts feature isn't enabled on the REST app.
   */
  get isAuthorizationError(): boolean {
    const n = this.errorName;
    return (
      this.status === 401 ||
      this.status === 403 ||
      n === "AUTHORIZATION_ERROR" ||
      n === "NOT_AUTHORIZED" ||
      n === "PERMISSION_DENIED" ||
      n === "AUTHENTICATION_FAILURE" ||
      n === "invalid_client"
    );
  }
}

// ---------- Client ----------

interface CachedToken {
  accessToken: string;
  expiresAt: number; // epoch ms
  scopes: string[];
  appId?: string;
}

const TOKEN_EXPIRY_SKEW_MS = 60_000;

export class PayPalClient {
  private readonly clientId: string;
  private readonly clientSecret: string;
  readonly baseUrl: string;
  private readonly onResponse?: (entry: ResponseLogEntry) => void;
  private readonly maxAttempts: number;
  private readonly fetchImpl: typeof fetch;

  private token: CachedToken | null = null;
  private tokenInFlight: Promise<CachedToken> | null = null;

  constructor(opts: PayPalClientOptions) {
    if (!opts.clientId || !opts.clientSecret) {
      throw new Error("PayPalClient: clientId and clientSecret are required");
    }
    this.clientId = opts.clientId;
    this.clientSecret = opts.clientSecret;
    this.baseUrl = (opts.baseUrl ?? PAYPAL_SANDBOX_BASE_URL).replace(/\/+$/, "");
    this.onResponse = opts.onResponse;
    this.maxAttempts = Math.max(1, opts.maxAttempts ?? 3);
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  // ----- OAuth -----

  /** Returns a cached access token, fetching a new one if missing/near expiry. */
  async getAccessToken(forceRefresh = false): Promise<string> {
    return (await this.getToken(forceRefresh)).accessToken;
  }

  /** Scopes granted on the current token (useful to check Payouts is enabled). */
  async getTokenScopes(): Promise<string[]> {
    return (await this.getToken()).scopes;
  }

  invalidateToken(): void {
    this.token = null;
  }

  private async getToken(forceRefresh = false): Promise<CachedToken> {
    if (!forceRefresh && this.token && Date.now() < this.token.expiresAt - TOKEN_EXPIRY_SKEW_MS) {
      return this.token;
    }
    // Deduplicate concurrent refreshes.
    if (!this.tokenInFlight) {
      this.tokenInFlight = this.fetchToken().finally(() => {
        this.tokenInFlight = null;
      });
    }
    this.token = await this.tokenInFlight;
    return this.token;
  }

  private async fetchToken(): Promise<CachedToken> {
    const path = "/v1/oauth2/token";
    const basic = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString("base64");
    const started = Date.now();
    const res = await this.fetchImpl(this.baseUrl + path, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: "grant_type=client_credentials",
    });
    const debugId = res.headers.get("paypal-debug-id");
    this.onResponse?.({ method: "POST", path, status: res.status, debugId, requestId: null, attempt: 1, durationMs: Date.now() - started });
    const body = await parseBody(res);
    if (!res.ok) throw new PayPalError("POST", path, res.status, body as PayPalErrorBody, debugId);

    const data = body as { access_token: string; expires_in: number; scope?: string; app_id?: string };
    return {
      accessToken: data.access_token,
      expiresAt: Date.now() + data.expires_in * 1000,
      scopes: (data.scope ?? "").split(/\s+/).filter(Boolean),
      appId: data.app_id,
    };
  }

  // ----- Core request -----

  private async request<T>(
    method: "GET" | "POST",
    path: string,
    opts: { body?: unknown; requestId?: string; headers?: Record<string, string> } = {},
  ): Promise<T> {
    const isWrite = method !== "GET";
    // One idempotency key per logical call, reused across every retry below.
    const requestId = isWrite ? (opts.requestId ?? randomUUID()) : null;
    let refreshedAfter401 = false;

    for (let attempt = 1; ; attempt++) {
      const token = await this.getAccessToken();
      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        ...opts.headers,
      };
      if (isWrite) {
        headers["Content-Type"] = "application/json";
        headers["PayPal-Request-Id"] = requestId!;
      }

      const started = Date.now();
      let res: Response;
      try {
        res = await this.fetchImpl(this.baseUrl + path, {
          method,
          headers,
          body: isWrite ? JSON.stringify(opts.body ?? {}) : undefined,
        });
      } catch (err) {
        if (attempt < this.maxAttempts) {
          await sleep(backoffMs(attempt));
          continue;
        }
        throw err;
      }

      const debugId = res.headers.get("paypal-debug-id");
      this.onResponse?.({ method, path, status: res.status, debugId, requestId, attempt, durationMs: Date.now() - started });
      const body = await parseBody(res);

      if (res.ok) return body as T;

      // Expired/revoked token: refresh once and retry (same PayPal-Request-Id).
      if (res.status === 401 && !refreshedAfter401) {
        refreshedAfter401 = true;
        this.invalidateToken();
        continue;
      }
      if ((res.status === 429 || res.status >= 500) && attempt < this.maxAttempts) {
        const retryAfter = Number(res.headers.get("retry-after"));
        await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : backoffMs(attempt));
        continue;
      }
      throw new PayPalError(method, path, res.status, body as PayPalErrorBody | string | null, debugId);
    }
  }

  // ----- Orders v2 -----

  /** POST /v2/checkout/orders with intent AUTHORIZE. */
  async createAuthorizeOrder(input: CreateOrderInput): Promise<Order> {
    const body = {
      intent: "AUTHORIZE",
      purchase_units: [
        {
          reference_id: input.referenceId ?? "default",
          description: input.description,
          amount: input.amount,
        },
      ],
      payment_source: {
        paypal: {
          experience_context: {
            brand_name: input.brandName,
            user_action: "PAY_NOW",
            shipping_preference: "NO_SHIPPING",
            return_url: input.returnUrl ?? "https://example.com/paypal/return",
            cancel_url: input.cancelUrl ?? "https://example.com/paypal/cancel",
          },
        },
      },
    };
    return this.request<Order>("POST", "/v2/checkout/orders", {
      body,
      requestId: input.requestId,
      headers: { Prefer: "return=representation" },
    });
  }

  /** GET /v2/checkout/orders/{id} */
  async getOrder(orderId: string): Promise<Order> {
    return this.request<Order>("GET", `/v2/checkout/orders/${encodeURIComponent(orderId)}`);
  }

  /** POST /v2/checkout/orders/{id}/authorize — order must be APPROVED by the buyer. */
  async authorizeOrder(orderId: string, opts: { requestId?: string } = {}): Promise<Order> {
    return this.request<Order>("POST", `/v2/checkout/orders/${encodeURIComponent(orderId)}/authorize`, {
      body: {},
      requestId: opts.requestId,
      headers: { Prefer: "return=representation" },
    });
  }

  // ----- Payments v2 -----

  /** POST /v2/payments/authorizations/{id}/capture. Omit `amount` to capture the full authorized amount. */
  async captureAuthorization(
    authorizationId: string,
    opts: { amount?: Money; finalCapture?: boolean; invoiceId?: string; requestId?: string } = {},
  ): Promise<Capture> {
    const body: Record<string, unknown> = { final_capture: opts.finalCapture ?? true };
    if (opts.amount) body.amount = opts.amount;
    if (opts.invoiceId) body.invoice_id = opts.invoiceId;
    return this.request<Capture>("POST", `/v2/payments/authorizations/${encodeURIComponent(authorizationId)}/capture`, {
      body,
      requestId: opts.requestId,
      headers: { Prefer: "return=representation" },
    });
  }

  // ----- Payouts v1 -----

  /** POST /v1/payments/payouts */
  async createPayoutBatch(input: CreatePayoutInput): Promise<CreatePayoutResponse> {
    if (input.items.length === 0) throw new Error("createPayoutBatch: at least one item is required");
    const senderBatchId = input.senderBatchId ?? `batch_${Date.now()}_${randomUUID().slice(0, 8)}`;
    const body = {
      sender_batch_header: {
        sender_batch_id: senderBatchId,
        email_subject: input.emailSubject ?? "You have a payout!",
        email_message: input.emailMessage,
      },
      items: input.items.map((item, i) => ({
        recipient_type: item.recipientType ?? "EMAIL",
        amount: item.amount,
        receiver: item.receiver,
        note: item.note,
        sender_item_id: item.senderItemId ?? `${senderBatchId}_item_${i + 1}`,
      })),
    };
    // sender_batch_id is itself idempotent at PayPal; we still send PayPal-Request-Id.
    return this.request<CreatePayoutResponse>("POST", "/v1/payments/payouts", {
      body,
      requestId: input.requestId ?? senderBatchId,
    });
  }

  /** GET /v1/payments/payouts/{payout_batch_id} */
  async getPayoutBatch(payoutBatchId: string, opts: { page?: number; pageSize?: number } = {}): Promise<PayoutBatch> {
    const q = new URLSearchParams({ fields: "batch_header,items", total_required: "true" });
    if (opts.page) q.set("page", String(opts.page));
    if (opts.pageSize) q.set("page_size", String(opts.pageSize));
    return this.request<PayoutBatch>("GET", `/v1/payments/payouts/${encodeURIComponent(payoutBatchId)}?${q}`);
  }
}

// ---------- Helpers ----------

/** Buyer approval URL from an order's HATEOAS links. */
export function getApprovalUrl(order: Order): string | undefined {
  // With payment_source.paypal.experience_context PayPal returns rel "payer-action";
  // older application_context flows return rel "approve".
  return order.links?.find((l) => l.rel === "payer-action" || l.rel === "approve")?.href;
}

export function getFirstAuthorization(order: Order): Authorization | undefined {
  return order.purchase_units?.[0]?.payments?.authorizations?.[0];
}

export function isFinalPayoutItemStatus(status: string | undefined): boolean {
  return !!status && FINAL_PAYOUT_ITEM_STATUSES.has(status as PayoutItemStatus);
}

async function parseBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function backoffMs(attempt: number): number {
  return Math.min(8000, 500 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 250);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
