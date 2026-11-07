# QuantEdge AI Elite

A highly selective signal engine for Bybit USDT perpetual futures. Capital preservation comes first.

> **Status: paper-trading software. Not validated.** No backtest on real Bybit history has been run
> yet (the build environment had no network access to Bybit). Nothing here is evidence of a
> profitable edge, and the 10% net-margin ROI is a *target*, never a promise. Live execution is
> disabled and locked behind a statistical deployment gate. See [CHECKLIST.md](CHECKLIST.md).

## What it does

1. **Scans** every Bybit USDT perpetual (`/v5/market/instruments-info`, `/v5/market/tickers`). It filters on liquidity, spread, order-book depth within ±0.5%, listing age, mark/index deviation and funding, and flags new listings, volume spikes and open-interest changes.
2. **Analyses** closed candles on 5m / 15m / 1h / 4h / 1D. The analysis covers indicators (RSI, MACD, EMA 9–200, VWAP, ATR, ADX, Bollinger, StochRSI and volume profile) and market structure (swings, HH/HL, BOS, CHoCH, sweeps, equal highs/lows, FVGs, order blocks, S/R zones and breakout-retest). Every structure concept has a written definition in `analysis/structure.py`.
3. **Classifies the regime** into one of eight states. Each state permits only certain strategy families: `STRONG/WEAK BULL/BEAR`, `SIDEWAYS`, `HIGH_VOL`, `LOW_LIQUIDITY` and `UNSTABLE`. The last three are no-trade.
4. **Generates candidates** from three families: trend pullback, breakout-retest and liquidity-sweep reversal.
5. **Approves** candidates through eight stages. A failed mandatory stage rejects the candidate regardless of score. A passing candidate must then score ≥ 90 on the weighted framework (structure 20, MTF 20, volume 15, momentum 15, liquidity 10, regime 10, R:R 10). It must also clear the calibration check.
6. **Plans the trade exactly.** The take-profit is solved so that the net P&L after fees, slippage and expected funding equals 10% of the allocated margin at 2.5x. Size comes from the stop distance so that the loss at the stop, including costs, is ≤ 0.25% of equity. The trade is rejected if that needs a stop that is too wide or too tight, a poor net R:R (< 1.5), a stop near liquidation or an expected hold of more than 72h.
7. **Publishes** the same verified signal to Telegram and WhatsApp through one de-duplicated notification service.
8. **Tracks** every signal through its lifecycle with conservative fill rules, and reports outcomes honestly.

At 2.5x the take-profit is about **4.2–4.3% away from entry**, not 4%. The extra covers taker fees in and out, slippage and funding. `tests/test_roi.py` proves the solved price is the smallest tick-aligned price that meets the target.

## Architecture

```
quantedge/
  config.py              all defaults from the spec; env-driven (QE_*), no secrets in code
  models.py              Candle, Instrument, MarketSnapshot, TradePlan, Signal, statuses
  exchange/
    bybit_rest.py        v5 REST: signing, token bucket, retry/backoff, time sync, pagination
    bybit_ws.py          v5 public WS: heartbeat, reconnect + resubscribe, ticker/book deltas,
                         kline confirm-only, staleness tracking
    scanner.py           universe discovery, new listings, liquidity/execution filters
  analysis/
    indicators.py        causal indicators (verified: no look-ahead)
    structure.py         market-structure definitions
    features.py          per-TF features, momentum/volume intelligence, causal resampling
    regime.py            regime classifier + strategy permission map
  signals/
    strategies.py        candidate generators
    protection.py        false-signal detectors (traps, stop hunts, spoofy volume, spread, funding)
    approval.py          8-stage approval + weighted score
    calibration.py       score -> realised R-multiple calibration
    pipeline.py          single evaluation path shared by live engine and back-tester
  risk/
    roi.py               exact net-ROI / sizing / liquidation maths
    engine.py            independent portfolio risk engine (daily loss, streaks, exposure,
                         correlation, duplicates, funding, outage, emergency halt)
  monitor/tracker.py     lifecycle + fill model (shared by live and back-test)
  backtest/              event-driven back-tester, metrics, walk-forward, Monte Carlo, gate
  notify/                formatter, Telegram + WhatsApp Cloud API channels, central service
  ai/explainer.py        advisory explanations (deterministic, or Claude with a grounding guard)
  execution/             Phase 10 executor, disabled and gated
  db/                    SQLAlchemy schema + repository (PostgreSQL / SQLite)
  api/                   FastAPI: auth, roles, audit, dashboard API, WhatsApp webhook
  dashboard/             React dashboard (vendored, no CDN at runtime)
  engine.py              live orchestration
```

**Design rules enforced in code**

- *One evaluation path.* The back-tester calls the same `evaluate_symbol`, `ApprovalEngine`, `RiskEngine`, `build_plan` and `TradeTracker` as live trading.
- *No look-ahead.* Only confirmed candles are used, and a higher-timeframe bar becomes visible only after it closes (`Series.upto`). Swing pivots need right-side confirmation. Tests recompute every indicator on truncated data.
- *The risk engine is independent.* Approval has to ask it for permission, and nothing can override a refusal. Admin settings are clamped to hard bounds; for example, leverage cannot exceed 2.5x and risk per trade cannot exceed 0.25%.
- *The AI layer is advisory only.* It never changes entries, exits, size or approval, so decisions stay reproducible. Any number in a Claude-written explanation must appear in the engine's facts, otherwise the text is discarded.
- *Fill realism.* A touch is not a fill. TP needs a trade *through* the target. A stop that gaps fills at the bar open. When TP and SL fall in the same bar, the stop is assumed to hit first. A fill bar cannot take profit. Partial fills are capped by volume participation. Unfilled signals are never counted as wins or losses.

## Install

```bash
cd quantedge
python -m venv .venv && . .venv/bin/activate
pip install -e ".[ai,dev]"
pytest -q                     # 94 tests, no network needed
```

### Run with Docker (PostgreSQL)

```bash
cp .env.example .env          # fill in secrets (see below)
python -m quantedge hash-password      # paste result into QE_ADMIN_PASSWORD_HASH
docker compose up -d --build
open http://127.0.0.1:8000/dashboard/
```

Put a TLS reverse proxy (Caddy, nginx) in front of port 8000. The compose file binds to localhost only. A `backup` service writes a nightly `pg_dump` to `./backups`. Pruning old dumps is left to the host's retention policy.

### Configuration

All settings are environment variables with the prefix `QE_`; nested sections use `__` (`QE_RISK__RISK_PER_TRADE=0.0025`). `.env.example` documents every secret. Key defaults (in `config.py`):

| Setting | Default |
|---|---|
| leverage / margin mode | 2.5x / isolated |
| target net margin ROI | 10% |
| risk per trade / daily loss limit | 0.25% / 0.75% |
| max open positions / max signals per day | 2 / 2 (a ceiling, never a quota) |
| min quality score | 90 |
| consecutive-loss lockout | 3 losses → locked until next UTC day |
| min 24h turnover / max spread / min depth | $20M / 6 bps / $150k each side within ±0.5% |
| fees (until account tier fetched) | taker 0.055%, maker 0.02%; taker assumed on both legs |
| slippage | 5 bps entry/exit, 15 bps stops (+ half-spread in back-tests) |

### External services

| Service | Used for | Notes |
|---|---|---|
| Bybit v5 REST + public WS | market data, fee tier, (optional) orders | Signal mode needs no key. If you add one, make it read-only or Trade-only. **Never enable Withdraw.** |
| Telegram Bot API | signals, outcomes, reports, admin commands (`/status /signals /halt /resume /report`) | Admin commands are accepted only from `QE_NOTIFY__TELEGRAM_ADMIN_IDS` |
| WhatsApp Cloud API | the same signals via approved templates | Create templates `quantedge_signal` (8 params), `quantedge_update` (4) and `quantedge_report` (2) in WhatsApp Manager. Point the webhook at `/webhooks/whatsapp` for delivery status. The X-Hub-Signature-256 header is verified. |
| Anthropic API (optional) | explanation text | Uses `claude-opus-5-5`. Without a key, deterministic explanations are used. |

## Backtesting and validation

```bash
python -m quantedge fetch --symbols BTCUSDT,ETHUSDT,SOLUSDT,XRPUSDT,DOGEUSDT --days 365 --out data/
python -m quantedge backtest --data data/ --monte-carlo --walk-forward
python -m quantedge backtest --synthetic        # exercises the pipeline only; NOT evidence of edge
```

The report includes win rate, profit factor, expectancy (and its lower 95% bound in R), max drawdown, Sharpe, Sortino, max consecutive losses, recovery factor, MFE/MAE, fees, funding, and breakdowns by regime, symbol and strategy. Walk-forward optimises on each training window and aggregates only untouched out-of-sample trades. Monte Carlo bootstraps the trade sequence.

**Deployment gate** (`backtest/validation.py`, shown on the Analytics page). All checks must pass before an admin *can* approve live execution:

- ≥ 300 completed paper signals
- ≥ 20 trades in each of at least 3 regimes
- ≥ 10 symbols, with no single symbol above 25% of trades
- lower 95% bound of expectancy > 0R
- profit factor ≥ 1.2
- max drawdown ≤ 6%

Win rate is deliberately not a criterion. A test shows that a 90%-win-rate system with negative expectancy fails the gate.

Delisted contracts: the back-tester handles them when you supply their historical candles. Bybit's public kline endpoint does not serve candles for delisted symbols, so you need a separate archive for survivorship-free tests.

## Security

- Secrets come only from the environment. `.env` is git-ignored.
- Dashboard login uses scrypt password hashes and HMAC-signed 12h tokens. Roles are `viewer`, `operator` (can halt and cancel) and `admin` (can resume, change settings and approve execution).
- Login attempts are rate-limited per IP.
- Every control action is written to `audit_log`.
- Webhook signatures are verified. Phone numbers are masked in the API.
- The executor refuses to trade unless `QE_EXECUTION__ENABLED=true` **and** an admin approval exists that references a passing gate **and** the risk engine is not halted.
