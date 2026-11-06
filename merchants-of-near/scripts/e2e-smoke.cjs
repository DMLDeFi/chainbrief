/**
 * Browser smoke test of the full game loop against running servers
 * (npm run dev). Registers, trades, opens a business, fast-forwards and
 * checks progression — all through the real UI.
 *   node scripts/e2e-smoke.cjs [http://localhost:3000]
 */
const { chromium } = require('playwright');
const BASE = process.argv[2] ?? 'http://localhost:3000';
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  // Headless CI renders WebGL in software (a few FPS), so give UI waits room.
  page.setDefaultTimeout(90000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const id = Date.now().toString(36).slice(-6);
  await page.goto(`${BASE}/register`);
  await page.getByLabel('Username').fill(`e2e_${id}`);
  await page.getByLabel('Password').fill('e2e-password');
  await page.getByPlaceholder('e.g. Elena Varro').fill(`Tester ${id.slice(-4)}`);
  await page.getByRole('button', { name: 'Create merchant' }).click();
  await page.waitForURL('**/intro**');
  await page.getByRole('link', { name: 'Enter Nearhaven', exact: true }).click();
  await page.waitForURL('**/play');
  await page.getByRole('button', { name: /Marketplace/ }).waitFor();
  const api = (path, body) => page.evaluate(async ([p, b]) => {
    const r = await fetch(`/api${p}`, { method: b ? 'POST' : 'GET', headers: b ? { 'content-type': 'application/json' } : {}, body: b ? JSON.stringify(b) : undefined });
    return { status: r.status, body: await r.json() };
  }, [path, body]);
  const act = (action) => api('/action', { requestId: crypto.randomUUID(), action });
  const step = async (name, fn) => { const r = await fn(); if (r.status >= 400) throw new Error(`${name}: ${JSON.stringify(r.body)}`); console.log('✓', name); return r; };

  await page.getByRole('button', { name: /Marketplace/ }).click();
  await page.getByRole('button', { name: 'Buy 5' }).click();
  await page.getByText(/Bought 5 wheat/).waitFor({ timeout: 10000 });
  console.log('✓ bought wheat through the UI');
  await step('sell wheat', () => act({ type: 'trade', side: 'sell', resource: 'wheat', qty: 5 }));
  await step('open a farm', () => act({ type: 'business.buy', kind: 'farm' }));
  await step('fast-forward 3 days', () => api('/sim/fast-forward', { days: 3 }));
  const me = await step('read player state', () => api('/me'));
  const p = me.body.player;
  if (!p.businesses.length || p.businesses[0].totals.produced <= 0) throw new Error('farm did not produce');
  if (!p.achievements.landowner) throw new Error('landowner achievement missing');
  console.log(`✓ farm produced ${p.businesses[0].totals.produced.toFixed(1)} wheat; net worth ${p.netWorth}; XP ${p.xp}`);
  if (errors.length) throw new Error(`page errors: ${errors.join('; ')}`);
  console.log('E2E OK');
  await browser.close();
})().catch((e) => { console.error('E2E FAILED:', e.message); process.exit(1); });
