"""Live orchestration: scan -> evaluate -> approve -> publish -> monitor -> report.

Runs as a set of asyncio tasks inside the API process (or standalone via
``python -m quantedge run``).  Signal-only by default; the executor is invoked
only when execution is explicitly enabled and approved.
"""
from __future__ import annotations

import asyncio
import logging
import time
from collections import defaultdict, deque

import numpy as np

from .ai.explainer import Explainer, deterministic_trade_review
from .analysis.features import INTERVAL_MS, Series, build_features
from .config import AppConfig
from .db.repo import Repo
from .exchange.bybit_rest import BybitREST
from .exchange.bybit_ws import PUBLIC_LINEAR, PUBLIC_LINEAR_TESTNET, BybitWS
from .exchange.scanner import Scanner, ScanRow
from .models import Candle, MarketSnapshot, OrderBook, SignalStatus
from .monitor.tracker import TradeTracker, Tracked
from .notify.formatter import event_message, outcome_lines, report_message
from .notify.service import NotificationService
from .risk.engine import RiskEngine
from .signals.approval import ApprovalEngine
from .signals.calibration import Calibrator
from .signals.pipeline import evaluate_symbol
from .backtest.metrics import summarize

log = logging.getLogger(__name__)
TFS = ("5", "15", "60", "240", "D")
EVENT_KIND = {SignalStatus.FILLED: "ENTRY_CONFIRMED", SignalStatus.PARTIALLY_FILLED: "PARTIAL_FILL",
              SignalStatus.TAKE_PROFIT: "TAKE_PROFIT", SignalStatus.STOP_LOSS: "STOP_LOSS",
              SignalStatus.EXPIRED: "EXPIRED", SignalStatus.INVALIDATED: "INVALIDATED",
              SignalStatus.CANCELLED: "CANCELLED", SignalStatus.TIME_EXIT: "TIME_EXIT"}


class CandleStore:
    def __init__(self, maxlen: int = 400):
        self.data: dict[tuple[str, str], deque[Candle]] = defaultdict(lambda: deque(maxlen=maxlen))

    def load(self, sym: str, tf: str, candles: list[Candle]) -> None:
        d = self.data[(sym, tf)]
        d.clear()
        d.extend(c for c in candles if c.confirmed)

    def add(self, sym: str, tf: str, c: Candle) -> bool:
        d = self.data[(sym, tf)]
        if d and c.start <= d[-1].start:
            return False
        d.append(c)
        return True

    def series(self, sym: str, tf: str) -> Series:
        return Series.from_candles(list(self.data[(sym, tf)]))


class Engine:
    def __init__(self, cfg: AppConfig, repo: Repo, notifier: NotificationService | None = None,
                 rest: BybitREST | None = None, explainer: Explainer | None = None):
        self.cfg, self.repo = cfg, repo
        self.rest = rest or BybitREST(cfg.bybit_api_key, cfg.bybit_api_secret, cfg.bybit_testnet)
        self.ws = BybitWS(PUBLIC_LINEAR_TESTNET if cfg.bybit_testnet else PUBLIC_LINEAR, on_kline=self.on_kline)
        self.scanner = Scanner(cfg.scanner)
        self.candles = CandleStore()
        self.risk = RiskEngine(cfg.risk, cfg.trading.max_daily_signals)
        self.calibrator = Calibrator(require_calibration=not cfg.paper_trading)
        self.approval = ApprovalEngine(cfg, self.risk, self.calibrator)
        self.tracker = TradeTracker(cfg.costs)
        self.notifier = notifier
        self.explainer = explainer or Explainer(cfg.anthropic_api_key, cfg.ai_model)
        self.snapshots: dict[str, MarketSnapshot] = {}
        self.watch: list[str] = []
        self.equity = float(repo.kv_get("paper_equity", {"value": 10_000.0})["value"])
        self.started = time.time()
        self.last_eval: dict[str, int] = {}
        self._tasks: list[asyncio.Task] = []
        self._eval_lock = asyncio.Lock()

    # ------------------------------------------------------------------ lifecycle
    async def start(self) -> None:
        snap = self.repo.kv_get("risk_state")
        if snap:
            self.risk.restore(snap)
        self.calibrator.load([(t.score, t.r_multiple) for t in self.repo.trades()])
        await self.refresh_universe()
        await self.refresh_fees()
        self._tasks = [asyncio.create_task(c) for c in (
            self.ws.run(), self._loop(self.refresh_universe, 3600), self._loop(self.refresh_tickers, 30),
            self._loop(self.monitor_tick, 2), self._loop(self.health_tick, 15), self._daily_reports())]
        await self.refresh_tickers()

    async def stop(self) -> None:
        for t in self._tasks:
            t.cancel()
        await self.ws.stop()
        self.persist()

    async def _loop(self, fn, every: float) -> None:
        while True:
            try:
                await fn()
            except asyncio.CancelledError:
                raise
            except Exception:
                log.exception("%s failed", fn.__name__)
            await asyncio.sleep(every)

    def persist(self) -> None:
        self.repo.kv_set("risk_state", self.risk.snapshot())
        self.repo.kv_set("paper_equity", {"value": self.equity})

    # ------------------------------------------------------------------ data
    async def refresh_universe(self) -> None:
        new = self.scanner.update_universe(await self.rest.instruments())
        for sym in new:
            self.repo.audit("system", "new_listing", {"symbol": sym})
            log.info("new perpetual listed: %s (excluded until it has %d days of history)", sym,
                     self.cfg.scanner.min_listing_days)

    async def refresh_fees(self) -> None:
        if not (self.cfg.bybit_api_key and self.cfg.bybit_api_secret):
            return
        try:
            rows = await self.rest.fee_rate("BTCUSDT")
            if rows:
                self.cfg.costs.taker_fee = float(rows[0]["takerFeeRate"])
                self.cfg.costs.maker_fee = float(rows[0]["makerFeeRate"])
                log.info("account fee tier: taker %.4f%% maker %.4f%%", self.cfg.costs.taker_fee * 100,
                         self.cfg.costs.maker_fee * 100)
        except Exception as e:
            log.warning("fee-rate lookup failed, using defaults: %s", e)

    async def refresh_tickers(self) -> None:
        snaps = await self.rest.tickers()
        for s in snaps:
            self.snapshots[s.symbol] = s
        watch = [s.symbol for s in self.scanner.prefilter(snaps)][:60]
        for sym in watch:
            spike, oi = self.scanner.record_metrics(self.snapshots[sym])
            self.scanner.rows.setdefault(sym, ScanRow(sym, False, [], 0, 0, 0, 0))
            r = self.scanner.rows[sym]
            s = self.snapshots[sym]
            r.turnover_24h, r.spread_bps, r.funding_rate, r.change_24h = s.turnover_24h, s.spread_bps, s.funding_rate, s.price_24h_pct
            r.volume_spike, r.oi_change = spike, oi
        added = [s for s in watch if s not in self.watch]
        for sym in added:
            await self.bootstrap_symbol(sym)
        for sym in set(watch) | {"BTCUSDT", "ETHUSDT"}:
            self.ws.subscribe([f"kline.{tf}.{sym}" for tf in TFS] + [f"tickers.{sym}"])
        self.watch = watch

    async def bootstrap_symbol(self, sym: str) -> None:
        for tf in TFS:
            try:
                self.candles.load(sym, tf, await self.rest.klines(sym, tf, limit=400))
            except Exception as e:
                log.warning("kline bootstrap %s %s failed: %s", sym, tf, e)

    async def on_kline(self, sym: str, tf: str, c: Candle) -> None:
        if not self.candles.add(sym, tf, c):
            return
        if tf == self.cfg.trading.execution_timeframe and sym in self.watch:
            await self.evaluate(sym, c.end)

    def live_snapshot(self, sym: str) -> MarketSnapshot | None:
        base = self.snapshots.get(sym)
        t = self.ws.tickers.get(sym)
        if base is None:
            return None
        if t and not self.ws.is_stale(sym, self.cfg.scanner.stale_after_seconds):
            f = lambda k, d: float(t.get(k) or d)  # noqa: E731
            base = MarketSnapshot(sym, f("lastPrice", base.last), f("bid1Price", base.bid), f("ask1Price", base.ask),
                                  f("markPrice", base.mark), f("indexPrice", base.index),
                                  f("turnover24h", base.turnover_24h), f("volume24h", base.volume_24h),
                                  f("openInterestValue", base.open_interest_value), f("fundingRate", base.funding_rate),
                                  int(f("nextFundingTime", base.next_funding_ms)), f("price24hPcnt", base.price_24h_pct),
                                  ts=self.ws.last_update.get(sym, time.time()))
        return base

    # ------------------------------------------------------------------ evaluation
    async def evaluate(self, sym: str, now_ms: int) -> None:
        async with self._eval_lock:
            if self.last_eval.get(sym) == now_ms:
                return
            self.last_eval[sym] = now_ms
            snap = self.live_snapshot(sym)
            inst = self.scanner.instruments.get(sym)
            if snap is None or inst is None:
                return
            try:
                book: OrderBook | None = await self.rest.orderbook(sym, 50)
            except Exception:
                book = None
            el = self.scanner.evaluate(snap, book)
            tf = {k: build_features(self.candles.series(sym, k)) for k in TFS}
            btc = self.candles.series("BTCUSDT", "60")
            btc_move = float(btc.c[-1] / btc.c[-2] - 1) if len(btc) > 2 else 0.0
            closes = {s: self.candles.series(s, "60").c for s in set(self.watch) | {o.symbol for o in self.risk.state.open.values()}}
            margin_used = sum(e.notional for e in self.risk.state.open.values()) / self.cfg.trading.leverage
            ev = evaluate_symbol(self.approval, symbol=sym, instrument=inst, snapshot=snap, eligibility=el, tf=tf,
                                 now_ms=now_ms, equity=self.equity, available_margin=self.equity - margin_used,
                                 btc_1h_move=btc_move, closes=closes)
            row = self.scanner.rows.get(sym)
            if row:
                row.eligible, row.reasons, row.regime = el.eligible, el.reasons, ev.regime.regime.value
                row.candidate_score = ev.best_score
                f4 = tf.get("240")
                row.trend = f4.ema_stack if f4 else ""
            for dec in ev.decisions:
                if dec.approved and dec.signal:
                    await self.publish(dec.signal)
                else:
                    failed = next((s for s in dec.stages if not s.passed), None)
                    self.repo.add_rejection(now_ms, sym, dec.candidate.strategy, dec.candidate.direction.value,
                                            failed.stage if failed else "unknown", dec.rejection_reasons, dec.score)

    async def publish(self, sig) -> None:
        sig.status = SignalStatus.PUBLISHED
        expl, conflicts, source = self.explainer.explain_signal(sig)
        # The AI layer is advisory only: decisions stay reproducible (identical in back-tests),
        # and the deterministic contradiction checks in stage 4 already reject conflicting evidence.
        if conflicts:
            expl += " Noted counter-evidence: " + "; ".join(conflicts)
        self.risk.register_open(sig.signal_id, sig.symbol, sig.direction, sig.plan.notional, sig.plan.max_loss,
                                sig.strategy, now=sig.created_ms / 1000)
        self.repo.save_signal(sig, explanation=f"[{source}] {expl}")
        self.repo.add_event(sig.signal_id, sig.created_ms, "PUBLISHED", {"score": sig.score})
        self.tracker.add(sig, sig.created_ms)
        self.persist()
        if self.notifier:
            await self.notifier.publish_signal(sig, expl)

    # ------------------------------------------------------------------ monitoring
    async def monitor_tick(self) -> None:
        now = int(time.time() * 1000)
        for sym in {t.signal.symbol for t in self.tracker.active.values()}:
            if self.ws.is_stale(sym, self.cfg.scanner.stale_after_seconds):
                continue    # never infer fills from stale quotes
            snap = self.live_snapshot(sym)
            if snap is None:
                continue
            for tr in self.tracker.on_quote(sym, now, snap.bid, snap.ask, snap.funding_rate):
                await self.on_change(tr, now)

    async def on_change(self, tr: Tracked, now: int) -> None:
        sig = tr.signal
        self.repo.set_status(sig.signal_id, tr.status.value)
        self.repo.add_event(sig.signal_id, now, tr.status.value, {"qty": tr.filled_qty})
        kind = EVENT_KIND.get(tr.status)
        lines: list[str] = []
        if tr.status.terminal:
            if tr.result is not None:
                self.repo.save_trade(tr.result, paper=sig.paper)
                self.calibrator.add(sig.score, tr.result.r_multiple)
                self.equity += tr.result.net_pnl
                alerts = self.risk.record_close(sig.signal_id, tr.result.net_pnl)
                lines = outcome_lines(tr.result) + ["REVIEW: " + n for n in
                                                    deterministic_trade_review(tr.result, sig.plan.expected_hold_hours)]
                for a in alerts:
                    await self.alert(a, [f"Daily realised P&L: {self.risk.state.realized_pnl:+,.2f} USDT",
                                         "New actionable signals are suspended."])
            else:
                self.risk.release(sig.signal_id)
            self.persist()
        elif tr.status in (SignalStatus.FILLED, SignalStatus.PARTIALLY_FILLED):
            lines = [f"FILLED: {tr.filled_qty:g} @ {tr.avg_entry:g}", f"TP {sig.plan.take_profit:g} / SL {sig.plan.stop:g}"]
        if kind and self.notifier:
            await self.notifier.publish_event(
                f"{sig.signal_id}:{kind}", kind,
                event_message(kind, signal_id=sig.signal_id, symbol=sig.symbol, direction=sig.direction.value,
                              lines=lines, ts_ms=now),
                signal_id=sig.signal_id, symbol=sig.symbol, details=" | ".join(lines[:4]))

    async def alert(self, kind: str, lines: list[str]) -> None:
        self.repo.audit("risk", kind, {"lines": lines})
        if self.notifier:
            key = f"{kind}:{self.risk.state.day}"
            await self.notifier.publish_event(key, kind if kind != "CONSECUTIVE_LOSS_LOCKOUT" else "EMERGENCY",
                                              event_message(kind, lines=lines), details=" ".join(lines))

    async def health_tick(self) -> None:
        healthy = self.rest.healthy and (self.ws.connected or time.time() - self.started < 60)
        if healthy != self.risk.exchange_healthy:
            self.risk.exchange_healthy = healthy
            self.repo.audit("system", "exchange_health", {"healthy": healthy})
            if not healthy:
                await self.alert("EMERGENCY", ["Exchange connectivity degraded; new signals paused."])

    # ------------------------------------------------------------------ reports
    async def _daily_reports(self) -> None:
        while True:
            now = time.time()
            nxt = (now // 86400 + 1) * 86400 + 300     # 00:05 UTC
            await asyncio.sleep(nxt - now)
            try:
                await self.send_daily_report(int((nxt - 300 - 86400) * 1000))
                if time.gmtime(nxt).tm_wday == 0:
                    await self.send_report("WEEKLY PERFORMANCE", int((nxt - 300 - 7 * 86400) * 1000), "WEEKLY_REPORT")
            except Exception:
                log.exception("daily report failed")

    async def send_daily_report(self, day_start_ms: int) -> None:
        n = self.repo.signals_since(day_start_ms)
        rej = self.repo.rejection_counts(day_start_ms)
        if n == 0 and self.notifier:
            await self.notifier.publish_event(
                f"NO_TRADE:{day_start_ms}", "NO_TRADE",
                event_message("NO_TRADE", lines=[f"Candidates evaluated and rejected: {sum(rej.values())}",
                                                 "Filtering standards were not relaxed."]),
                details=f"{sum(rej.values())} candidates rejected")
        await self.send_report("DAILY PERFORMANCE", day_start_ms, "DAILY_REPORT",
                               [f"Signals published: {n}", f"Rejections: {sum(rej.values())}"])

    async def send_report(self, title: str, since_ms: int, kind: str, extra: list[str] | None = None) -> None:
        trades = [Repo.to_result(t) for t in self.repo.trades(since_ms)]
        s = summarize(trades, self.equity - sum(t.net_pnl for t in trades))
        if self.notifier:
            await self.notifier.publish_event(f"{kind}:{since_ms}", kind, report_message(title, s, extra),
                                              title=title, details=f"{s.get('trades', 0)} trades")

    # ------------------------------------------------------------------ admin
    def status(self) -> dict:
        st = self.risk.state
        return {"equity": self.equity, "day": st.day, "realized_pnl_today": st.realized_pnl,
                "daily_loss_pct": self.risk.daily_loss_fraction, "halted": st.halted, "halt_reason": st.halt_reason,
                "locked_until": st.locked_until_day, "consecutive_losses": st.consecutive_losses,
                "signals_today": st.signals_today, "open": len(st.open), "active_signals": len(self.tracker.active),
                "exchange_healthy": self.risk.exchange_healthy, "ws_connected": self.ws.connected,
                "ws_reconnects": self.ws.reconnects, "watching": len(self.watch),
                "paper_trading": self.cfg.paper_trading, "execution_enabled": self.cfg.execution.enabled}

    async def telegram_commands(self, channel, admin_ids: tuple[str, ...]) -> None:
        """Long-poll Telegram for admin commands from whitelisted chat ids only."""
        offset = 0
        while True:
            try:
                for u in await channel.get_updates(offset):
                    offset = u["update_id"] + 1
                    msg = u.get("message") or {}
                    chat = str(msg.get("chat", {}).get("id", ""))
                    text = (msg.get("text") or "").strip()
                    if chat not in admin_ids or not text.startswith("/"):
                        continue
                    reply = await self.handle_command(text, actor=f"telegram:{chat}")
                    await channel.send(chat, reply)
            except asyncio.CancelledError:
                raise
            except Exception:
                log.exception("telegram polling failed")
                await asyncio.sleep(5)

    async def handle_command(self, text: str, actor: str) -> str:
        cmd, _, arg = text.partition(" ")
        cmd = cmd.split("@")[0].lower()
        if cmd == "/status":
            return "\n".join(f"{k}: {v}" for k, v in self.status().items())
        if cmd == "/signals":
            act = list(self.tracker.active.values())
            return "\n".join(f"{t.signal.signal_id} {t.signal.symbol} {t.signal.direction.value} {t.status.value}"
                             for t in act) or "No active signals."
        if cmd == "/halt":
            self.risk.emergency_halt(arg or "manual")
            self.repo.audit(actor, "halt", {"reason": arg})
            self.persist()
            return "Trading HALTED. No new signals will be issued."
        if cmd == "/resume":
            self.risk.resume()
            self.repo.audit(actor, "resume", {})
            self.persist()
            return "Trading resumed (daily limits still apply)."
        if cmd == "/report":
            trades = [Repo.to_result(t) for t in self.repo.trades()]
            return report_message("ALL-TIME PERFORMANCE", summarize(trades, 10_000.0))
        return "Commands: /status /signals /halt <reason> /resume /report"


def closes_matrix(store: CandleStore, symbols: list[str], tf: str = "60") -> dict[str, np.ndarray]:
    return {s: store.series(s, tf).c for s in symbols}


__all__ = ["Engine", "CandleStore", "INTERVAL_MS"]
