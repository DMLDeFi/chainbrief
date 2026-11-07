"""Event-driven back-tester that runs the *production* signal pipeline.

Data in: per-symbol ascending 5-minute candles (Bybit kline), optional funding
history.  Higher timeframes are built by ``resample`` and exposed through
``Series.upto`` so that only bars closed at the evaluation instant are visible.

Execution realism:
* evaluation on each closed 15m bar; orders become live after ``delay_bars``
  further 5m bars (execution delay)
* fills / exits follow ``TradeTracker`` (trade-through, gap-aware stops,
  stop-first ambiguity, partial fills capped by bar volume participation)
* fees, slippage, spread (half-spread added to entry slippage) and funding
* the same ``RiskEngine`` daily limits and lockouts as live
* delisted contracts: pass their candles; the series simply ends and any open
  trade is closed at the last bar as TIME_EXIT (recorded, never dropped)
"""
from __future__ import annotations

import copy
import logging
from dataclasses import dataclass, field

import numpy as np

from ..analysis.features import INTERVAL_MS, Series, build_features, resample
from ..config import AppConfig
from ..models import Candle, Instrument, MarketSnapshot, SignalStatus
from ..monitor.tracker import TradeResult, TradeTracker
from ..risk.engine import RiskEngine
from ..signals.approval import ApprovalEngine
from ..signals.calibration import Calibrator
from ..signals.context import Eligibility
from ..signals.pipeline import evaluate_symbol
from .metrics import summarize

log = logging.getLogger(__name__)
M5 = INTERVAL_MS["5"]
M15 = INTERVAL_MS["15"]
TFS = {"5": INTERVAL_MS["5"], "15": M15, "60": INTERVAL_MS["60"], "240": INTERVAL_MS["240"], "D": INTERVAL_MS["D"]}


@dataclass
class SymbolData:
    instrument: Instrument
    candles_5m: list[Candle]
    funding: list[tuple[int, float]] = field(default_factory=list)   # (ts, rate)
    spread_bps: float = 2.0
    depth_usdt: float = 500_000.0


@dataclass
class BacktestResult:
    trades: list[TradeResult]
    signals: int
    rejections: dict[str, int]
    unfilled: int
    summary: dict
    start_ms: int
    end_ms: int
    equity_end: float


class Backtester:
    def __init__(self, cfg: AppConfig, start_equity: float = 10_000.0, delay_bars: int = 1,
                 lookback: int = 300, warmup_days: int = 60):
        self.cfg = copy.deepcopy(cfg)
        self.start_equity = start_equity
        self.delay_bars = delay_bars
        self.lookback = lookback
        self.warmup_ms = warmup_days * INTERVAL_MS["D"]

    def run(self, data: dict[str, SymbolData], start_ms: int | None = None, end_ms: int | None = None,
            progress: bool = False) -> BacktestResult:
        cfg = copy.deepcopy(self.cfg)
        half_spread = float(np.median([d.spread_bps for d in data.values()])) / 2e4
        cfg.costs.entry_slippage += half_spread      # crossing half the spread on entry
        cfg.costs.exit_slippage += half_spread
        cfg.costs.stop_slippage += half_spread
        risk = RiskEngine(cfg.risk, cfg.trading.max_daily_signals)
        approval = ApprovalEngine(cfg, risk, Calibrator(require_calibration=False))
        costs = copy.deepcopy(cfg.costs)
        tracker = TradeTracker(costs)
        equity = self.start_equity

        series: dict[str, dict[str, Series]] = {}
        for sym, d in data.items():
            base = Series.from_candles(d.candles_5m)
            series[sym] = {tf: (base if tf == "5" else resample(base, ms)) for tf, ms in TFS.items()}
        all_t = sorted({int(t) for s in series.values() for t in s["5"].t})
        if not all_t:
            raise ValueError("no candles")
        first = all_t[0] + self.warmup_ms
        start_ms = max(start_ms or first, first)
        end_ms = end_ms or all_t[-1] + M5
        funding_idx = {s: d.funding for s, d in data.items()}
        btc = "BTCUSDT" if "BTCUSDT" in series else None

        rejections: dict[str, int] = {}
        n_signals = 0
        pending: list[tuple[int, object]] = []   # (activate_ms, signal)
        results: list[TradeResult] = []
        bar_cache: dict[str, dict[int, int]] = {s: {int(t): i for i, t in enumerate(v["5"].t)} for s, v in series.items()}

        fcache: dict[tuple, object] = {}
        t = (start_ms // M15) * M15
        while t < end_ms:
            t += M5
            bar_close = t
            # 1) activate delayed signals and feed this 5m bar to the tracker
            for item in [p for p in pending if p[0] <= bar_close]:
                pending.remove(item)
                tracker.add(item[1], bar_close)
            for sym, sv in series.items():
                i = bar_cache[sym].get(bar_close - M5)
                if i is None:
                    continue
                b = sv["5"]
                rate = _funding_at(funding_idx[sym], bar_close)
                for tr in tracker.on_bar(sym, bar_close, b.o[i], b.h[i], b.l[i], b.c[i], b.v[i], rate):
                    if tr.status.terminal:
                        if tr.result is not None:
                            results.append(tr.result)
                            equity += tr.result.net_pnl
                            risk.record_close(tr.signal.signal_id, tr.result.net_pnl)
                        else:
                            risk.release(tr.signal.signal_id)
            if bar_close % M15:
                continue
            # 2) evaluate every symbol on the closed 15m bar
            btc_move = 0.0
            if btc:
                h1 = series[btc]["60"].upto(bar_close)
                if len(h1) >= 2:
                    btc_move = h1.c[-1] / h1.c[-2] - 1
            closes = {s: sv["60"].upto(bar_close).c[-200:] for s, sv in series.items()}
            for sym, sv in series.items():
                if bar_cache[sym].get(bar_close - M5) is None:
                    continue
                tf = {}
                for k, s in sv.items():
                    sub = s.upto(bar_close)
                    hit = fcache.get((sym, k))           # features only change when a new bar closes
                    if hit is None or hit[0] != len(sub):
                        hit = (len(sub), build_features(sub.tail(self.lookback)))
                        fcache[(sym, k)] = hit
                    tf[k] = hit[1]
                if tf["15"] is None:
                    continue
                d = data[sym]
                snap = _synthetic_snapshot(sym, sv, bar_close, d, _funding_at(funding_idx[sym], bar_close))
                el = Eligibility(snap.turnover_24h >= cfg.scanner.min_turnover_24h and d.spread_bps <= cfg.scanner.max_spread_bps,
                                 [] if snap.turnover_24h >= cfg.scanner.min_turnover_24h else ["turnover below minimum"],
                                 d.spread_bps, d.depth_usdt, d.depth_usdt, snap.turnover_24h, 1.0, True)
                margin_used = sum(e.notional for e in risk.state.open.values()) / cfg.trading.leverage
                ev = evaluate_symbol(approval, symbol=sym, instrument=d.instrument, snapshot=snap,
                                     eligibility=el, tf=tf, now_ms=bar_close, equity=equity,
                                     available_margin=equity - margin_used, btc_1h_move=btc_move, closes=closes)
                for dec in ev.decisions:
                    if dec.approved and dec.signal is not None:
                        sig = dec.signal
                        sig.status = SignalStatus.PUBLISHED
                        risk.register_open(sig.signal_id, sym, sig.direction, sig.plan.notional,
                                           sig.plan.max_loss, sig.strategy, now=bar_close / 1000)
                        pending.append((bar_close + self.delay_bars * M5, sig))
                        n_signals += 1
                    else:
                        key = next((s.stage for s in dec.stages if not s.passed), "unknown")
                        rejections[key] = rejections.get(key, 0) + 1
        # close anything still open at the end of data (never silently dropped)
        for tr in list(tracker.active.values()):
            sv = series[tr.signal.symbol]["5"]
            if tr.filled_qty > 0:
                tracker._exit(tr, int(sv.t[-1] + M5), float(sv.c[-1]), SignalStatus.TIME_EXIT,
                              costs.taker_fee, costs.exit_slippage)
                results.append(tr.result)
                equity += tr.result.net_pnl
            else:
                tracker.cancel(tr.signal.signal_id, int(end_ms), "end of data")
        unfilled = sum(1 for x in tracker.closed if x.result is None)
        days = (end_ms - start_ms) / INTERVAL_MS["D"]
        return BacktestResult(results, n_signals, rejections, unfilled,
                              summarize(results, self.start_equity, days), start_ms, end_ms, equity)


def _funding_at(hist: list[tuple[int, float]], ts: int) -> float:
    if not hist:
        return 0.0001   # Bybit base rate per 8h when no history supplied
    idx = np.searchsorted([h[0] for h in hist], ts, side="right") - 1
    return hist[max(0, idx)][1]


def _synthetic_snapshot(sym: str, sv: dict[str, Series], ts: int, d: SymbolData, rate: float) -> MarketSnapshot:
    b = sv["5"].upto(ts)
    px = float(b.c[-1])
    half = px * d.spread_bps / 2e4
    day = b.tail(288)
    turnover = float((day.c * day.v).sum())
    chg = float(px / day.o[0] - 1) if len(day) else 0.0
    return MarketSnapshot(sym, px, px - half, px + half, px, px, turnover, float(day.v.sum()), 0.0, rate,
                          ((ts // (8 * 3_600_000)) + 1) * 8 * 3_600_000, chg, ts=ts / 1000)
