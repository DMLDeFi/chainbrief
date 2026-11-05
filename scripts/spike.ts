/**
 * PayPal sandbox end-to-end spike.
 *
 *   1. Create an Orders v2 order (intent AUTHORIZE) and print the approval link
 *   2. Wait for you to approve it in the sandbox (as a sandbox *personal* buyer)
 *   3. Authorize the order
 *   4. Capture the authorization
 *   5. Create a Payouts v1 batch with two items (PAYOUT_TEST_EMAIL_1 / _2)
 *   6. Poll the batch until every item is in a final status
 *
 * Run:  npm run spike
 * Env (.env.local): PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYOUT_TEST_EMAIL_1, PAYOUT_TEST_EMAIL_2
 */
import { existsSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import {
  PayPalClient,
  PayPalError,
  PAYOUTS_SCOPE,
  getApprovalUrl,
  getFirstAuthorization,
  isFinalPayoutItemStatus,
  type PayoutBatch,
} from "../lib/paypal";

const ENV_FILE = ".env.local";
const POLL_INTERVAL_MS = 5_000;
const POLL_TIMEOUT_MS = 5 * 60_000;

if (existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);

function requireEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) {
    console.error(`Missing ${name}. Add it to ${ENV_FILE} (see .env.local.example).`);
    process.exit(1);
  }
  return v;
}

const clientId = requireEnv("PAYPAL_CLIENT_ID");
const clientSecret = requireEnv("PAYPAL_CLIENT_SECRET");
const email1 = requireEnv("PAYOUT_TEST_EMAIL_1");
const email2 = requireEnv("PAYOUT_TEST_EMAIL_2");

const paypal = new PayPalClient({
  clientId,
  clientSecret,
  baseUrl: process.env.PAYPAL_BASE_URL, // defaults to sandbox
  onResponse: (r) => {
    const retry = r.attempt > 1 ? ` (attempt ${r.attempt})` : "";
    const rid = r.requestId ? ` PayPal-Request-Id=${r.requestId}` : "";
    console.log(`  ← ${r.method} ${r.path} → HTTP ${r.status} in ${r.durationMs}ms${retry} debug_id=${r.debugId ?? "-"}${rid}`);
  },
});

if (!paypal.baseUrl.includes("sandbox")) {
  console.error(`Refusing to run the spike against a non-sandbox URL: ${paypal.baseUrl}`);
  process.exit(1);
}

function step(title: string) {
  console.log(`\n=== ${title} ===`);
}

function printPayoutsAuthHelp(err: PayPalError | null, hasScope: boolean) {
  console.error(`
──────────────────────────────────────────────────────────────────────
 Payouts is not enabled for this sandbox REST app.
${err ? ` PayPal said: HTTP ${err.status} ${err.errorName ?? ""} ${err.debugId ? `(debug_id ${err.debugId})` : ""}\n` : ""}\
 Token has payouts scope (${PAYOUTS_SCOPE}): ${hasScope ? "yes" : "NO"}

 To fix:
   1. Go to https://developer.paypal.com/dashboard/applications/sandbox
      (Developer Dashboard → Apps & Credentials, with the "Sandbox" toggle on).
   2. Click the app whose Client ID is ${clientId.slice(0, 8)}…
   3. Scroll to "Features" (older dashboards: "Sandbox App Settings" /
      "App feature options") and tick  ✅ Payouts.
   4. Click Save.
   5. Re-run this script. Scopes are baked into the access token when it is
      issued, so a NEW token is required — this script fetches a fresh one
      on every run, so just run it again (allow a minute or two to propagate).

 Also check: the sandbox *business* account that owns the app is the
 sender — it must have a balance (Sandbox Accounts → ⋯ → Edit → add funds
 if you get INSUFFICIENT_FUNDS), and the receiver emails must be different
 from that business account's email.
──────────────────────────────────────────────────────────────────────`);
}

function printBatch(batch: PayoutBatch) {
  const h = batch.batch_header;
  console.log(`  batch ${h.payout_batch_id}: batch_status=${h.batch_status}`);
  for (const item of batch.items ?? []) {
    const err = item.errors ? ` error=${item.errors.name}: ${item.errors.message}` : "";
    console.log(
      `    - ${item.payout_item.receiver} ${item.payout_item.amount.value} ${item.payout_item.amount.currency}` +
        ` → ${item.transaction_status ?? "(none yet)"}${isFinalPayoutItemStatus(item.transaction_status) ? " [final]" : ""}${err}`,
    );
  }
}

async function main() {
  const rl = createInterface({ input: stdin, output: stdout });
  const runId = Date.now().toString(36);

  // 0. Token
  step("OAuth token");
  const scopes = await paypal.getTokenScopes();
  const hasPayoutsScope = scopes.includes(PAYOUTS_SCOPE);
  console.log(`  token ok, ${scopes.length} scopes; payouts scope present: ${hasPayoutsScope ? "yes" : "NO"}`);
  await paypal.getAccessToken(); // second call is served from cache — no HTTP line printed
  console.log("  (second getAccessToken() served from cache)");

  // 1. Create order
  step("Create order (intent AUTHORIZE)");
  const order = await paypal.createAuthorizeOrder({
    amount: { currency_code: "USD", value: "10.00" },
    description: `Chainbrief spike ${runId}`,
    referenceId: `spike_${runId}`,
    brandName: "Chainbrief (sandbox)",
    requestId: `spike-${runId}-create-order`,
  });
  console.log(`  order ${order.id} status=${order.status}`);
  const approvalUrl = getApprovalUrl(order);
  if (!approvalUrl) throw new Error(`No approval link on order ${order.id}: ${JSON.stringify(order.links)}`);

  // 2. Wait for buyer approval
  step("Approve in sandbox");
  console.log(`  Open this link and log in with a sandbox PERSONAL account:\n\n    ${approvalUrl}\n`);
  console.log("  After approving, PayPal redirects to example.com — that's expected, just come back here.");
  for (;;) {
    await rl.question("  Press Enter once you've approved… ");
    const current = await paypal.getOrder(order.id);
    console.log(`  order status=${current.status}`);
    if (current.status === "APPROVED") break;
    if (current.status === "VOIDED" || current.status === "COMPLETED") {
      throw new Error(`Order ${order.id} is ${current.status}; start over.`);
    }
    console.log("  Not approved yet — finish approval in the browser and press Enter again.");
  }
  rl.close();

  // 3. Authorize
  step("Authorize order");
  const authorized = await paypal.authorizeOrder(order.id, { requestId: `spike-${runId}-authorize` });
  const auth = getFirstAuthorization(authorized);
  console.log(`  order status=${authorized.status}`);
  if (!auth) throw new Error("Authorize succeeded but no authorization was returned");
  console.log(`  authorization ${auth.id} status=${auth.status} amount=${auth.amount?.value} ${auth.amount?.currency_code} expires=${auth.expiration_time ?? "?"}`);

  // 4. Capture
  step("Capture authorization");
  const capture = await paypal.captureAuthorization(auth.id, {
    finalCapture: true,
    invoiceId: `spike_${runId}`,
    requestId: `spike-${runId}-capture`,
  });
  console.log(`  capture ${capture.id} status=${capture.status} amount=${capture.amount?.value} ${capture.amount?.currency_code}`);

  // 5. Payout batch
  step("Create payout batch (2 items)");
  if (!hasPayoutsScope) {
    console.log("  ⚠ token lacks the payouts scope — the next call will most likely be rejected.");
  }
  let payoutBatchId: string;
  try {
    const created = await paypal.createPayoutBatch({
      senderBatchId: `spike_${runId}`,
      emailSubject: "Chainbrief sandbox payout",
      emailMessage: "Test payout from the Chainbrief PayPal spike.",
      items: [
        { receiver: email1, amount: { value: "1.00", currency: "USD" }, note: "Spike item 1", senderItemId: `spike_${runId}_1` },
        { receiver: email2, amount: { value: "1.50", currency: "USD" }, note: "Spike item 2", senderItemId: `spike_${runId}_2` },
      ],
    });
    payoutBatchId = created.batch_header.payout_batch_id;
    console.log(`  batch ${payoutBatchId} batch_status=${created.batch_header.batch_status}`);
  } catch (err) {
    if (err instanceof PayPalError && err.isAuthorizationError) {
      printPayoutsAuthHelp(err, hasPayoutsScope);
      process.exitCode = 2;
      return;
    }
    throw err;
  }

  // 6. Poll
  step("Poll payout batch until every item is final");
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  for (;;) {
    const batch = await paypal.getPayoutBatch(payoutBatchId);
    printBatch(batch);
    const items = batch.items ?? [];
    const allFinal = items.length === 2 && items.every((i) => isFinalPayoutItemStatus(i.transaction_status));
    if (allFinal || batch.batch_header.batch_status === "DENIED" || batch.batch_header.batch_status === "CANCELED") {
      console.log(`\nDone. batch_status=${batch.batch_header.batch_status}`);
      if (items.some((i) => i.transaction_status === "UNCLAIMED")) {
        console.log("Note: UNCLAIMED means no sandbox account exists for that email (it would return after 30 days).");
      }
      break;
    }
    if (Date.now() > deadline) {
      console.log(`\nGave up after ${POLL_TIMEOUT_MS / 1000}s; items are still not final.`);
      process.exitCode = 3;
      break;
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}

main().catch((err) => {
  if (err instanceof PayPalError) {
    console.error(`\n✖ ${err.message}`);
    if (err.body && typeof err.body === "object") console.error(JSON.stringify(err.body, null, 2));
    if (err.path.startsWith("/v1/payments/payouts") && err.isAuthorizationError) printPayoutsAuthHelp(err, false);
  } else {
    console.error("\n✖", err);
  }
  process.exit(1);
});
