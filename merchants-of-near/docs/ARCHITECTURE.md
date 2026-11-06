# Architecture

## System overview

```mermaid
flowchart LR
  subgraph Browser
    UI[Next.js 16 UI<br/>HUD + 10 panels]
    PH[Phaser 3 isometric town]
    W[NEAR Connect wallet]
  end
  subgraph Server[Game server · Fastify 5]
    API[REST API<br/>auth · zod · rate limits · idempotency]
    ENG[[@mon/engine<br/>authoritative world]]
    WS[WebSocket stream]
    NS[NEAR service<br/>NEP-413 · certificates · tx verify · deed sync]
    AI[Dialogue layer<br/>Claude optional]
  end
  DB[(PostgreSQL / Prisma 7<br/>or JSON store)]
  NEAR[(NEAR testnet<br/>merchants-of-near contract)]

  UI -- /api same-origin --> API --> ENG
  ENG -- snapshots + feed --> WS -- read-only --> PH & UI
  API --> DB
  ENG -- ledger --> DB
  API --> NS -- RPC view / tx --> NEAR
  W -- signed txs (user pays gas) --> NEAR
  NS -- signed certificate --> UI
  API --> AI
```

## The world tick

`stepWorld()` advances one in-game hour:

1. Season and weather update. Weather is drawn per season and lasts 8–30 hours.
2. **Citizens** of Nearhaven take staples from the exchange. They buy food first, demand falls with price (elasticity 0.8), and spending is capped by the town purse. Need that the shelves can't cover is recorded as *shortage*.
3. **Port Aurora's** hinterland produces and consumes on its own schedule.
4. **Merchants act** (see below).
5. **Player businesses** run: auto-buy inputs, produce, auto-sell above the player's floor price.
6. Each market folds the hour's flows into its EMAs (demand, supply, production, consumption, shortage) and moves **pressure** toward its target.
7. Significant price moves (≥7% since the last report) become feed entries, each one explained by the stock change or the demand pressure behind it.
8. At dawn: wages, merchant P&L and expansion or downsizing, dividends, bankruptcy checks, loan collection, the banker's policy review, population growth or decline from how well the town was fed, a chance of a new economic event, and money recirculation (guild liquidity support, owner drawings).

The world runs one tick every `TICK_MS` (2 s). The RNG state lives inside the world, so a given seed always produces the same history (this is tested).

## Merchant agent loop

Each merchant runs perceive → produce → evaluate → act:

| Role | Production | Buying logic | Selling logic | Special |
|---|---|---|---|---|
| Farmer | wheat (season/weather/event yield) + livestock | — | sells into gluts, holds when the price is below its ask (patience 0.75) | storage cap forces sales at harvest |
| Bakers ×2 | 3 wheat → 2 bread | buy wheat only if the bread margin is above `0.06 + 0.22·greed` and the price is ≤ bid | ask adapts to inventory turnover | compete for wheat and for bread buyers |
| Blacksmith | tools *or* weapons, whichever has the better margin × scarcity | iron, coal, wood | as above | risk 0.7, so it borrows to expand and can default |
| Trader | — | scans all goods for cross-market gaps > 12%; sizes orders to marginal profit | sells cargo on arrival | 6-hour caravans; per-route memory of realised vs forecast revenue |
| Banker | — | — | — | credit score = f(leverage, earnings trend, defaults, repayments, reputation); tightens after defaults |
| Miner | iron/coal/stone split by relative price² | — | as above | mine collapse event |
| Fisher | fish | — | impatient: sells fast | storms ground the fleet |
| Weaver | livestock → 3 cloth | livestock | as above | |
| Woodcutter | wood | — | patient: stockpiles for winter | |

Reservation prices:

- **Ask floor** = unit cost (inputs at believed prices + labour) × (1.02 + 0.08·greed). The ask rises 3% after easy sales with low stock. It falls 1.5–4.5% when unsold stock piles up; less patient merchants cut further.
- **Bid** = believed price × (1.1 + 0.35·risk).
- **Beliefs** are an EMA of the market prices the merchant observes.

Every action appends to the merchant's `decisions` (action plus reasons) and `memory` (transactions). Both are shown in the UI and are the only facts the LLM layer may use.

Daily: pay wages (missing payroll means struggling, layoffs, and bankruptcy after three misses), hire when the 3-day average profit is above 1.5× wage and the treasury allows (scaled by risk), downsize when losing money, pay 40% of profit to investors.

## Money

The Nearhaven exchange and its households share one purse. Gold enters through a small outside income per citizen. It circulates through:

- the purse paying merchants for goods
- merchants buying inputs
- wages paid back to households
- merchant owner drawings (7% of gold above 300 per day, with 15% to the guild)
- market fees to the guild treasury, which pays mission rewards, seeds bankrupt merchants' successors and backstops exchange liquidity

The exchange refuses to buy what it cannot pay for. The engine tests check that player trades conserve total gold.

## Persistence

| Table | Purpose |
|---|---|
| `User`, `Session` | accounts (scrypt hashes) and session-token hashes |
| `WorldSnapshot` | the full world JSON (merchants, players, businesses, markets), saved every 12 game hours and on shutdown |
| `LedgerEntry` | append-only record of every gold or goods movement for every player |
| `IdempotencyKey` | stored action responses for replay safety |
| `NearChallenge` | single-use NEP-413 nonces |
| `ChainTransaction` | wallet transactions with verified status and the verification time |

## NEAR flows

**Login / link (NEP-413)**

1. The server issues a 32-byte nonce challenge.
2. The wallet signs `{message, nonce, recipient}`.
3. The server verifies the ed25519 signature over `sha256(borsh(payload))`.
4. The server calls `view_access_key` to confirm the public key is a full-access key of the account.
5. The challenge is deleted (single use).

**Claim a deed**

1. `POST /api/near/certificate/deed` checks that the player owns the business and has a linked account.
2. The server signs `merchants-of-near:deed:v1|account|token|kind|business|level|nonce|expiry` with the game authority key.
3. The wallet calls `claim_deed` with 0.01 NEAR for storage.
4. The contract verifies the certificate with `env::ed25519_verify`, rejects used nonces and expired certificates, and mints the deed to the predecessor account.
5. The client posts the transaction hash. The server fetches the outcome with `tx`, checks the signer and receiver, parses the `deed_claimed` NEP-297 event, and only then marks the business as deeded.

**Deed marketplace**

1. The owner calls `list_deed(price)`.
2. The buyer calls `buy_deed` with a deposit of at least the price.
3. In the same receipt the contract transfers price − 2.5% to the seller, refunds any excess and moves ownership.
4. The server syncs `get_deed` (on the purchase event, on demand, and every 60 s) and moves the business to the game profile linked to the new owner. If the new owner has no game profile, production pauses until they join.

**Badges**

`record_achievement` uses a game certificate; each (account, achievement) pair can be recorded once.

Only these ownership and settlement events touch the chain. Hourly trading, production and agent decisions stay off-chain, so play is instant and free.
