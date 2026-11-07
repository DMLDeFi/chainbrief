"""Portfolio-level risk engine.

Independent of signal generation: the approval pipeline must *ask* this engine
for permission, and nothing (including the AI layer) can override a refusal.
State is per UTC day and survives restarts through ``snapshot``/``restore``.
"""
from __future__ import annotations

import threading
import time
from dataclasses import asdict, dataclass, field

import numpy as np

from ..config import RiskConfig
from ..models import Direction


@dataclass
class OpenExposure:
    signal_id: str
    symbol: str
    direction: Direction
    notional: float
    risk_amount: float


@dataclass
class RiskState:
    day: str = ""
    start_equity: float = 0.0
    realized_pnl: float = 0.0
    consecutive_losses: int = 0
    signals_today: int = 0
    halted: bool = False
    halt_reason: str = ""
    locked_until_day: str = ""
    open: dict[str, OpenExposure] = field(default_factory=dict)
    recent_keys: dict[str, float] = field(default_factory=dict)  # duplicate-prevention keys -> ts


@dataclass
class RiskDecision:
    allowed: bool
    reasons: list[str]
    risk_fraction: float


def utc_day(ts: float | None = None) -> str:
    return time.strftime("%Y-%m-%d", time.gmtime(ts if ts is not None else time.time()))


def correlation(a: np.ndarray, b: np.ndarray) -> float:
    n = min(len(a), len(b))
    if n < 30:
        return 0.0
    ra, rb = np.diff(np.log(a[-n:])), np.diff(np.log(b[-n:]))
    if ra.std() == 0 or rb.std() == 0:
        return 0.0
    return float(np.corrcoef(ra, rb)[0, 1])


class RiskEngine:
    def __init__(self, cfg: RiskConfig, max_daily_signals: int, duplicate_window_s: float = 6 * 3600):
        self.cfg = cfg
        self.max_daily_signals = max_daily_signals
        self.dup_window = duplicate_window_s
        self.state = RiskState()
        self._lock = threading.RLock()
        self.exchange_healthy = True

    # ---- day roll -------------------------------------------------------
    def roll(self, equity: float | None, now: float | None = None) -> None:
        with self._lock:
            d = utc_day(now)
            if self.state.day != d:
                self.state.day = d
                if equity is not None:
                    self.state.start_equity = equity
                self.state.realized_pnl = 0.0
                self.state.signals_today = 0
                if self.state.locked_until_day and self.state.locked_until_day <= d:
                    self.state.locked_until_day = ""
                    self.state.consecutive_losses = 0
                if self.state.halted and self.state.halt_reason.startswith("daily"):
                    self.state.halted, self.state.halt_reason = False, ""

    # ---- controls ---------------------------------------------------------
    def emergency_halt(self, reason: str) -> None:
        with self._lock:
            self.state.halted, self.state.halt_reason = True, f"emergency: {reason}"

    def resume(self) -> None:
        with self._lock:
            self.state.halted, self.state.halt_reason = False, ""

    @property
    def daily_loss_fraction(self) -> float:
        se = self.state.start_equity
        return -self.state.realized_pnl / se if se > 0 and self.state.realized_pnl < 0 else 0.0

    def remaining_daily_risk(self) -> float:
        return max(0.0, self.cfg.max_daily_loss - self.daily_loss_fraction
                   - sum(e.risk_amount for e in self.state.open.values()) / max(self.state.start_equity, 1e-9))

    # ---- pre-trade check --------------------------------------------------
    def check(self, symbol: str, direction: Direction, equity: float, *, funding_rate: float,
              closes: dict[str, np.ndarray] | None = None, now: float | None = None,
              strategy: str = "") -> RiskDecision:
        now = time.time() if now is None else now
        with self._lock:
            self.roll(equity, now)
            s, c = self.state, self.cfg
            reasons: list[str] = []
            if s.halted:
                reasons.append(f"trading halted ({s.halt_reason})")
            if not self.exchange_healthy:
                reasons.append("exchange connectivity unhealthy")
            if s.locked_until_day and s.locked_until_day > s.day:
                reasons.append(f"locked out until {s.locked_until_day}")
            if self.daily_loss_fraction >= c.max_daily_loss:
                reasons.append(f"daily loss limit reached ({self.daily_loss_fraction:.2%})")
            if s.consecutive_losses >= c.max_consecutive_losses:
                reasons.append(f"{s.consecutive_losses} consecutive losses")
            if s.signals_today >= self.max_daily_signals:
                reasons.append(f"daily signal ceiling ({self.max_daily_signals}) reached")
            if len(s.open) >= c.max_open_positions:
                reasons.append(f"max open positions ({c.max_open_positions})")
            if any(e.symbol == symbol for e in s.open.values()):
                reasons.append(f"already exposed to {symbol}")
            key = f"{symbol}:{direction.value}:{strategy}"
            if now - s.recent_keys.get(key, -1e18) < self.dup_window:
                reasons.append("duplicate of a recent signal")
            if abs(funding_rate) > c.max_abs_funding_rate:
                reasons.append(f"funding {funding_rate:.4%} beyond limit")
            exposure = sum(e.notional for e in s.open.values()) / max(equity, 1e-9)
            if exposure >= c.max_total_exposure:
                reasons.append(f"exposure {exposure:.2f}x at limit")
            if closes is not None and symbol in closes:
                for e in s.open.values():
                    if e.symbol in closes:
                        rho = correlation(closes[symbol], closes[e.symbol])
                        same_way = e.direction == direction
                        if (same_way and rho > c.max_correlation) or (not same_way and rho < -c.max_correlation):
                            reasons.append(f"correlated {rho:+.2f} with open {e.symbol}")
            rf = min(c.risk_per_trade, self.remaining_daily_risk())
            if rf < c.risk_per_trade * 0.5 and not reasons:
                reasons.append("insufficient remaining daily risk budget")
            return RiskDecision(not reasons, reasons, rf)

    # ---- lifecycle hooks ----------------------------------------------------
    def register_open(self, signal_id: str, symbol: str, direction: Direction, notional: float,
                      risk_amount: float, strategy: str = "", now: float | None = None) -> None:
        with self._lock:
            self.roll(None, now)
            self.state.open[signal_id] = OpenExposure(signal_id, symbol, direction, notional, risk_amount)
            self.state.signals_today += 1
            self.state.recent_keys[f"{symbol}:{direction.value}:{strategy}"] = time.time() if now is None else now

    def release(self, signal_id: str) -> None:
        """Signal ended without a fill (expired/cancelled)."""
        with self._lock:
            self.state.open.pop(signal_id, None)

    def record_close(self, signal_id: str, net_pnl: float) -> list[str]:
        """Returns alert strings for any limit that has just been breached."""
        alerts: list[str] = []
        with self._lock:
            self.state.open.pop(signal_id, None)
            self.state.realized_pnl += net_pnl
            self.state.consecutive_losses = self.state.consecutive_losses + 1 if net_pnl < 0 else 0
            if self.daily_loss_fraction >= self.cfg.max_daily_loss and not self.state.halted:
                self.state.halted, self.state.halt_reason = True, "daily loss limit reached"
                alerts.append("DAILY_LOSS_LIMIT")
            if self.state.consecutive_losses >= self.cfg.max_consecutive_losses:
                nxt = utc_day(time.time() + 86400)
                self.state.locked_until_day = nxt
                alerts.append("CONSECUTIVE_LOSS_LOCKOUT")
        return alerts

    def snapshot(self) -> dict:
        with self._lock:
            d = asdict(self.state)
            for v in d["open"].values():
                v["direction"] = v["direction"].value if isinstance(v["direction"], Direction) else v["direction"]
            return d

    def restore(self, d: dict) -> None:
        with self._lock:
            opens = {k: OpenExposure(**{**v, "direction": Direction(v["direction"])}) for k, v in d.get("open", {}).items()}
            self.state = RiskState(**{**d, "open": opens})
