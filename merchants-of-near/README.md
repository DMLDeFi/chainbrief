# Merchants of NEAR

**An economic strategy game where every merchant is an autonomous AI agent and what you build is yours on NEAR.**

You arrive in the isometric trading town of Nearhaven with 100 gold. Ten AI merchants (a farmer, two
rival bakers, a blacksmith, a caravan trader, a banker, a miner, a fisher, a weaver and a woodcutter)
run a living economy around you. Each one has its own gold, inventory, costs, personality, goals and
memory, and decides every in-game hour what to produce, buy, sell, borrow or build. Prices come out of
what they, the townsfolk and you actually do. The businesses you found can become deeds held in your NEAR
wallet, and other players can buy those deeds for NEAR.

Built for the NEAR Hackathon 2026.

![Architecture](docs/architecture.svg)

---

## Quick start

Requirements: Node 20+ (tested on 22). Docker, Rust and the NEAR CLI are only needed for the optional parts.

```bash
npm install
```

```bash
npm run dev
```

Open http://localhost:3000. The game server runs on :4000 and Next.js proxies `/api` to it.

- **No configuration is required.** Without `DATABASE_URL` the server keeps state in `apps/server/data/` as JSON.
- Click **Play the 3-minute demo** for a guided tour with a guest merchant, or register an account.
- To configure anything, copy `.env.example` to `.env` (in the repo root) and edit it.

### Optional: PostgreSQL

```bash
docker compose up -d
```

```bash
echo "DATABASE_URL=postgresql://mon:mon@localhost:5432/merchants" >> .env
```

```bash
npm run db:push -w @mon/server
```

### Optional: Claude-voiced merchants

Set `ANTHROPIC_API_KEY` (from https://console.anthropic.com) in `.env`. Merchants then answer chat and
negotiation messages in character, using `claude-opus-5-5` by default (`ANTHROPIC_MODEL`). The prompt
contains only the merchant's real state and decision log, and the deterministic engine has already
decided the outcome. Without a key, or if the API fails, replies are built from the same decision log.

### Optional: NEAR testnet contract

The fastest path needs no NEAR CLI, only Rust and `cargo-near`:

```bash
cd contract && cargo near build non-reproducible-wasm && cd ..
```

```bash
node scripts/deploy-testnet.mjs
```

The deploy script creates a funded `mon-game-xxxxxx.testnet` account through the testnet faucet, deploys and initialises the contract in one transaction, and writes `NEAR_CONTRACT_ID` and a fresh `GAME_AUTHORITY_SECRET` into `.env`. That file is gitignored. The account key goes to `~/.near-credentials/testnet/`. Restart `npm run dev` afterwards.

If you prefer near-cli-rs, run `npm run keygen` and then `GAME_AUTHORITY_PUBLIC_KEY=ed25519:... scripts/deploy-contract.sh your-game.testnet`.

Players need a testnet wallet (MyNearWallet, Meteor, HOT, Intear… via NEAR Connect) with a little test NEAR.

Behind an HTTPS proxy, start Node with `NODE_USE_ENV_PROXY=1` (and `NODE_EXTRA_CA_CERTS=<bundle>` if the proxy re-signs TLS) so the server can reach NEAR RPC.

### Live testnet deployment (reference)

Contract **`mon-game-190cff.testnet`** — [deploy + init transaction](https://testnet.nearblocks.io/txns/6NnPfPTP5s2tdk84zLZ1dzQWiCPzcHKJoBe1ZkZGNsf).

`scripts/onchain-e2e.mts` ran the whole ownership loop against it with two fresh faucet accounts:

1. Both players linked their wallets with NEP-413.
2. Alice [claimed a deed](https://testnet.nearblocks.io/txns/623r1uf2QN1QQ9kUs7LRP6qgBFfrsiH1fUicgRatXyXZ) for her farm.
3. She [listed it for 0.1 NEAR](https://testnet.nearblocks.io/txns/DCUDaTxyvNPpSoz11yT4wnH6XMR2wmAPCWheYQtMz8pm).
4. Bob [bought it](https://testnet.nearblocks.io/txns/5DfjjjvT2AeJCqFFm3upXBZaKTx4z4nbVkMTwWvGR2Xu).
5. The server verified every transaction through RPC and moved the farm to Bob in-game.

The certificate secret for this deployment is not in the repository. To issue deeds yourself, deploy your own instance with the script above, which takes a minute.

### Deploy to Fly.io

One machine runs the game server and the Next.js app behind a single HTTPS origin. Follow [docs/DEPLOY_FLY.md](docs/DEPLOY_FLY.md): create the app and its volume, set the NEAR secrets, then run `fly deploy`.

---

## How to play

| | |
|---|---|
| **Trade** | Buy and sell 11 goods on the Nearhaven Exchange. Your orders move the price. Port Aurora unlocks at Level 4 or with a Trading Company. |
| **Read the merchants** | Open any merchant to see personality, objectives, inventory, ask/bid prices, decision log, transaction memory and P&L. Negotiate private deals, invest in their equity, chat. |
| **Build businesses** | Farm, Bakery, Textile Shop, Blacksmith, Warehouse, Trading Company. Each has a price, capacity, workers, wages, upkeep, inventory, upgrades, automation policies and a daily P&L. |
| **Finance** | Borrow from Banker Aldric (credit-scored), repay early or automatically, invest in merchants for dividends (and lose it all if they go bankrupt). |
| **Progress** | 6 ranks (Street Trader → Master Merchant) gated by XP, net worth, businesses and reputation; 14 achievements; 3 daily missions and 2 weekly challenges per player. |
| **Compete** | Leaderboards for wealth, trading volume, achievements and business profit (humans only), plus a separate AI-merchant ranking. Player-to-player marketplace with server escrow. |
| **Own it on NEAR** | Wallet login, business deeds, deed marketplace in NEAR, soulbound achievement badges. |
| **Fast-forward** | Simulate 1–14 days instantly from the HUD. |

**Music and sound:** the game ships with an original soundtrack composed live in the browser (Web Audio). Lute-like plucks, a drone and a frame drum change with the time of day, the season and active events. Sound effects cover trades, level-ups and new events. Sound starts on the first tap or click (a browser rule) and works on phones. To play your own music while testing locally, drop `.mp3`/`.m4a`/`.ogg`/`.wav` files into `apps/web/public/audio/`. That folder is gitignored and excluded from the Docker image, so personal tracks are never committed or deployed.

Controls: drag or WASD/arrow keys to pan, wheel or Q/E to zoom, number keys 1–0 open panels, Esc closes.

---

## Architecture

```
merchants-of-near/
├─ packages/engine     Pure TypeScript simulation: markets, agents, businesses, progression (shared by server and web)
├─ apps/server         Fastify 5 API + WebSocket, auth, persistence (Prisma/PostgreSQL or JSON), NEAR verification, Claude dialogue
├─ apps/web            Next.js 16 / React 19 / Tailwind 4 UI with a Phaser 3 isometric town
├─ contract            Rust NEAR contract (near-sdk 5.30): deeds, deed marketplace, achievement badges
├─ scripts             simulate.ts, keygen.ts, deploy-testnet.mjs, deploy-contract.sh, e2e-smoke.cjs, onchain-e2e.mts
└─ docs                architecture.svg, ARCHITECTURE.md, DEMO_SCRIPT.md
```

- **Authoritative server.** One `WorldState` lives in the server process. Ticks, fast-forwards and player actions all run synchronously on Node's single thread, so each action is atomic. The engine validates every precondition before it mutates anything. Every gold movement emits a ledger entry that is persisted.
- **Read-only real-time stream.** The WebSocket only broadcasts public snapshots (prices, merchants, weather, activity feed). All actions go through the authenticated REST API.
- **Hybrid AI.** Economic decisions are deterministic: a seeded RNG and an explicit utility/threshold logic per role. The optional LLM only phrases dialogue.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the economic model, the agent loop and the NEAR flows.

---

## The economic engine in brief

- **Price discovery:** `price = base × (refStock / stock)^elasticity × pressure`, clamped between 0.25× and 8× base. Every unit you buy or sell walks along this curve, so large orders have price impact and an immediate round trip always loses the fee. Demand **pressure** drifts toward `1 + 0.2·imbalance + 1.5·shortage`, where imbalance is buys vs sells and shortage is unmet citizen need.
- **Supply chains:** wheat → bread; iron + coal (+ wood) → tools or weapons; livestock → cloth. Citizens consume staples with price elasticity 0.8. Seasons and weather change yields (autumn harvest gluts, winter scarcity) and demand (firewood in winter).
- **Closed money loop:** the exchange shares one purse with the town's households. Merchants are paid out of it, and wages and merchant household spending flow back into it. The exchange can only pay coin it holds. Mission rewards come from a guild treasury funded by market fees, so no gold is minted for rewards.
- **Events:** drought, bumper harvest, mine collapse, festival, bandits, herring run, cattle murrain, royal commission. Each one changes production or demand multipliers for several days.
- **Port Aurora:** a second market with its own regional production and consumption. Trader Selene (and your Trading Company) buy where goods are cheap and sell where they are dear. Selene remembers how each route paid off and discounts future forecasts by it.
- **Failure:** a merchant who misses payroll three days running goes bankrupt. Its inventory is liquidated, creditors are paid what is possible, and investors are wiped out. After four days a successor reopens the business with guild capital.

`npm run sim -- 42 7` runs 42 days headless with seed 7 and prints daily prices, merchant health and the feed tail.

---

## Security & economy integrity

- Passwords are hashed with scrypt. Sessions use 256-bit random tokens stored only as SHA-256 hashes, sent in an httpOnly, SameSite=Lax cookie over a same-origin proxy.
- Every action is validated by a zod schema, then by the engine (ownership, gold, stock, warehouse space, level gates, price bounds). Clients never send prices or totals; any extra fields are ignored.
- Slippage protection: a client-side estimate becomes a `limitPrice`, and the server rejects the trade if the real price is worse.
- Idempotency: every action carries a UUID `requestId`. A replayed request returns the stored result and is never applied twice.
- Rate limiting: a global per-IP limit, stricter limits on auth, chat and NEAR routes, and a per-player action token bucket.
- P2P listings must be priced between 30% and 300% of market, so they can't be used to funnel gold between accounts. Goods are held in escrow, and double-buys are rejected.
- NEAR: NEP-413 challenges are single-use and expire after 5 minutes. The signing key must be a full-access key of the claimed account on-chain. Certificates bind account, business, level, nonce and expiry, and the contract rejects forged, replayed and expired ones. Transaction status is always read back from RPC: if RPC can't be reached the transaction stays `pending`, and a transaction signed by another account or sent to another contract is rejected.
- No private keys, seed phrases or API keys live in the repo or reach the browser.

---

## Testing

```bash
npm test                                  # 59 TypeScript tests (engine + server)
```

```bash
cd contract && cargo test                 # 9 contract unit tests
```

```bash
node scripts/e2e-smoke.cjs                # browser end-to-end game loop (needs `npm run dev` running)
```

```bash
npx tsx scripts/onchain-e2e.mts           # live testnet: wallet link → claim deed → list → buy → ownership sync
```

The tests cover:

- buying and selling, price impact, price floors and ceilings, no round-trip arbitrage, exchange liquidity
- supply and demand, shortage pressure, gluts, history
- merchant decisions: wheat buying when bread margins are healthy, pausing otherwise, selling into a glut, the blacksmith switching products, trader arbitrage
- bankruptcy, succession and investor wipe-out; the credit model, loan collection and defaults; negotiation
- business production and P&L, hiring and upgrade limits, missions, achievements, level gates, escrow and double-spend
- the full loop: register → trade → business → fast-forward → progression; economy stability over 28 days; determinism
- auth (hashing, sessions, logout), authorization, idempotency, rate limiting, malformed input
- NEP-413 verification (valid, wrong key, tampered, replayed), deed certificates
- on-chain transaction handling (pending → success, failure, RPC outage, wrong signer), and ownership transfer when a deed is sold on NEAR

The contract tests cover valid claims, forged, replayed and expired certificates, marketplace settlement and fees, underpayment, owner-only listing, and soulbound badge uniqueness.

---

## Status and honest limitations

- **NEAR:** the contract is deployed on testnet and the ownership loop has been verified live (see above). A fresh checkout runs with on-chain features marked "not configured" until you deploy your own instance and set `.env`. Server-side verification is also covered by unit tests against a scripted RPC.
- **Multiplayer:** asynchronous. All players share one live world (prices, merchants, plots and the P2P market) and receive real-time updates over WebSocket. There is no direct real-time chat or trading. The server runs as a single authoritative process; scaling out would mean sharding worlds per process.
- **Fast-forward** advances the shared world for everyone. Disable it with `ALLOW_FAST_FORWARD=false` for public servers.
- The world snapshot is saved every 12 in-game hours and on shutdown, and ledger entries are written immediately. A crash can lose up to about 24 seconds of world state.
- All art is procedural, generated at runtime. There are no third-party game assets.

## License

MIT
