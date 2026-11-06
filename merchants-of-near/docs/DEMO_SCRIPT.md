# Demo script — Merchants of NEAR (≈ 5 minutes)

Setup before judging: `npm run dev` (see README). For the on-chain step, deploy the contract
to testnet once (`scripts/deploy-contract.sh`) and have a NEAR **testnet** wallet with a few
test NEAR (e.g. MyNearWallet or Meteor on testnet).

Open **http://localhost:3000**.

## 1 · The pitch (30 s) — landing page
- "Game economies are painted backdrops. NPCs sell fixed goods at fixed prices; nothing you do ripples outward."
- Point at the live price ticker under the hero: those prices come from the running simulation, not a mock.
- Click **Play the 3-minute demo**. A guest merchant is created and the guided tour starts.

## 2 · A player enters the town (20 s)
- HUD: 100 gold, Level 1 Street Trader, day/time, season, weather, population.
- Drag to pan, scroll to zoom. Night falls and windows light up; weather particles follow the real world state.

## 3 · Five autonomous merchants operating (45 s)
- Tour step 2 → **Inspect Farmer John**: personality bars, objectives, inventory, ask prices.
- The **Decision log** shows why he acted ("Sold 15 wheat — warehouse nearly full"). Point out these are computed every hour by the deterministic agent — no LLM call.
- Back to *All merchants*: Baker Mara, Smith Brunhild, Trader Selene, Banker Aldric (plus miner, fisher, weaver, woodcutter, a rival baker).
- Optional: **Talk to** a merchant. Without an API key the reply comes from its decision log; with one, Claude voices it, grounded in the same facts.

## 4 · The player buys and sells goods (40 s)
- Tour step 3 → **Buy 10 wheat**. The toast shows the executed price; the Marketplace shows the new price and supply bar.
- Tour step 4 → **Sell the wheat**: the round trip loses the 3% fee — prices can't be farmed.
- Mention: the client sends only `{resource, qty, limitPrice}`; the server computes the price, checks gold, warehouse space, slippage, and records the ledger entry.

## 5 · The engine adjusts prices; merchants react (40 s)
- Market Chronicle (right): filter **Prices** — e.g. "Wheat prices rose 9.8% as wheat supply fell 11.7%". Filter **AI decisions** — Selene spotting a Port Aurora price gap and sending a caravan, the banker reviewing its loan book, expansions/bankruptcies.
- Every line is generated from an actual state change on the server.

## 6 · Fast-forward (30 s)
- Tour step 6 → **Simulate 3 days** (or the HUD **Fast-forward** menu, up to 14 days).
- Economy dashboard: daily price history ÷ base price, supply levels, production vs consumption, unmet demand, active events (drought, festival, bandits…), merchant health.
- Show a seasonal effect: autumn harvest gluts wheat (price falls), winter scarcity raises it; bread follows wheat.

## 7 · Business ownership (30 s)
- Tour step 7 → Businesses → buy a **Farm** (85g). It produces every hour, auto-sells above your floor price, pays wages at dawn.
- Fast-forward a day: the P&L chart and lifetime profit appear. Hire/upgrade options, policies, collect to warehouse.

## 8 · A real NEAR transaction (60 s)
- Wallet panel → **Connect NEAR wallet** → the wallet signs a one-time NEP-413 message; the server checks the signature *and* that the key is an access key of the account on-chain.
- Businesses → your farm → **Claim deed**: the server issues an ed25519 certificate for "this account owns this business"; the wallet signs `claim_deed`; the contract verifies the certificate.
- Transactions panel → *On-chain* tab: the hash links to NearBlocks; status is `success` only after the server reads the outcome from NEAR RPC (it shows `pending`/`failure` otherwise — never faked).
- Wallet panel: the deed appears from a live `deeds_of` view call. List it for sale; a second account can **Buy** it — NEAR moves to the seller and the business moves to the buyer in-game.

## 9 · Close (20 s)
- Leaderboards: human players only; AI merchants are ranked separately and labelled.
- "AI makes the world alive; NEAR makes what you build in it yours."
