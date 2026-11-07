# Development checklist

Legend: ✅ implemented and covered by automated tests · 🟡 implemented, not yet verified against the live service · ⬜ not done

## Phase 1 — Architecture and Bybit connectivity
- ✅ Config with all spec defaults, env-driven, no secrets in code
- ✅ v5 REST client: HMAC signing (test against spec formula), token bucket, retry on 10006/429/5xx, time sync, pagination
- ✅ v5 public WS client: subscribe chunking, ping every 20s, heartbeat-loss reconnect, ticker/order-book delta merge, kline `confirm` filter, staleness
- 🟡 Live connectivity. Blocked in the build environment (Bybit hosts refused by the sandbox proxy), so every exchange test uses mocks. **First task on a real host:** run `python -m quantedge fetch --symbols BTCUSDT --days 3`.

## Phase 2 — Scanner and historical data
- ✅ Universe discovery, new-listing detection, liquidity/spread/depth/listing-age/mark-index filters
- ✅ Volume-spike and OI-change tracking; correlation (risk engine)
- ✅ Historical kline pagination + funding history download (`fetch` command)
- 🟡 Open-interest history endpoint is wrapped but not yet used as a signal feature

## Phase 3 — Signal generation
- ✅ Causal indicators (no-look-ahead property test)
- ✅ Market-structure definitions with tests (pivots, trend, BOS, sweep, FVG)
- ✅ Multi-timeframe features, causal resampling
- ✅ Regime classifier + permission map (rule-based; an ML classifier is a future, out-of-sample-gated upgrade)
- ✅ Three strategy families, false-signal detectors, contradiction checks
- ✅ 8-stage approval, weighted score, mandatory gates override score
- ✅ Score calibration against realised R (required in live mode)
- ⬜ News feed. "News-driven dislocation" is a price-behaviour proxy only

## Phase 4 — Risk and exact ROI
- ✅ Exact TP solver for long/short incl. fees, slippage, funding; tick rounding verified minimal
- ✅ Stop-distance sizing incl. costs; margin/exposure caps; liquidation-distance guard; hold-time rejection
- ✅ Daily loss limit, consecutive-loss lockout, max positions, duplicates, correlation, funding, outage, emergency halt; state persisted

## Phase 5 — Notifications
- ✅ Spec signal template + event/report formats, NO QUALIFIED TRADE SETUPS TODAY
- ✅ Central service with DB-enforced de-duplication, retries, delivery-status tracking (WhatsApp webhook, signature-verified)
- 🟡 Telegram/WhatsApp tested with fakes only; WhatsApp templates must be created and approved in WhatsApp Manager

## Phase 6 — Monitoring and database
- ✅ Lifecycle tracker (zone reached, fill/partial, TP, SL, expiry, invalidation, time exit), MFE/MAE, funding accrual
- ✅ SQLAlchemy schema/repository (signals, events, trades, rejections, notifications, audit, kv, users)
- ⬜ Alembic migrations (schema is created with `create_all`; add Alembic before the first schema change in production)
- 🟡 Live partial fills from exchange executions are wired only in the executor; signal mode infers fills from quotes conservatively

## Phase 7 — Backtesting and paper trading
- ✅ Event-driven back-tester on the production pipeline; fees, funding, slippage, half-spread, execution delay, partial fills, gaps, stop-first ambiguity
- ✅ Metrics (win rate, PF, expectancy + lower bound, DD, Sharpe, Sortino, streaks, recovery, by regime/symbol/strategy), Monte Carlo, walk-forward, sensitivity sweep, deployment gate
- ⬜ **No real-data backtest has been run yet.** Results on synthetic data are pipeline checks only
- ⬜ 300+ paper signals across regimes (requires running the engine for weeks to months)

## Phase 8 — Dashboard
- ✅ Overview, Live Scanner, Signals (active/completed/expired/rejected + detail), Analytics (equity/drawdown, periods, strategies, regimes, calibration, gate), Risk Centre (emergency shutdown), Settings (bounded)
- ✅ Rendered in headless Chromium with no console errors; no horizontal scroll at 390px

## Phase 9 — Testing, security, deployment
- ✅ 94 unit/integration tests (`pytest -q`)
- ✅ Auth (scrypt + HMAC tokens), roles, audit log, login rate limit, health check, structured logs
- ✅ Dockerfile (non-root), docker-compose with PostgreSQL and nightly backups
- ⬜ External error monitoring (e.g. Sentry) not wired; logs are JSON lines on stdout
- ⬜ Redis not used. A single process holds the state, and de-duplication is enforced by PostgreSQL constraints. Redis becomes necessary only for multi-instance deployment

## Phase 10 — Automated execution (disabled)
- ✅ Isolated margin + 2.5x setup, entry with exchange-side TP/SL, idempotent orderLinkId, duplicate refusal, reconcile (attach stop or flatten), partial-fill accounting from executions
- ✅ Triple gate: config flag + admin approval backed by a passing validation gate + risk engine not halted
- 🟡 Never run against Bybit testnet. Do that before anything else on this phase
