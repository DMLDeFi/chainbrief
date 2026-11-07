"""Core domain objects shared across modules."""
from __future__ import annotations

import enum
import time
import uuid
from dataclasses import dataclass, field
from typing import Any


class Direction(str, enum.Enum):
    LONG = "LONG"
    SHORT = "SHORT"

    @property
    def sign(self) -> int:
        return 1 if self is Direction.LONG else -1


class Regime(str, enum.Enum):
    STRONG_BULL = "STRONG_BULLISH_TREND"
    WEAK_BULL = "WEAK_BULLISH_TREND"
    STRONG_BEAR = "STRONG_BEARISH_TREND"
    WEAK_BEAR = "WEAK_BEARISH_TREND"
    SIDEWAYS = "SIDEWAYS_CONSOLIDATION"
    HIGH_VOL = "HIGH_VOLATILITY"
    LOW_LIQUIDITY = "LOW_LIQUIDITY"
    UNSTABLE = "UNSTABLE_ABNORMAL"


class SignalStatus(str, enum.Enum):
    GENERATED = "GENERATED"
    PUBLISHED = "PUBLISHED"
    ENTRY_ZONE_REACHED = "ENTRY_ZONE_REACHED"
    FILLED = "FILLED"
    PARTIALLY_FILLED = "PARTIALLY_FILLED"
    TAKE_PROFIT = "TAKE_PROFIT"
    STOP_LOSS = "STOP_LOSS"
    EXPIRED = "EXPIRED"
    INVALIDATED = "INVALIDATED"
    CANCELLED = "CANCELLED"
    TIME_EXIT = "TIME_EXIT"

    @property
    def terminal(self) -> bool:
        return self in {SignalStatus.TAKE_PROFIT, SignalStatus.STOP_LOSS, SignalStatus.EXPIRED,
                        SignalStatus.INVALIDATED, SignalStatus.CANCELLED, SignalStatus.TIME_EXIT}


@dataclass(frozen=True)
class Candle:
    start: int          # ms epoch, open time
    open: float
    high: float
    low: float
    close: float
    volume: float       # base units
    turnover: float     # quote units
    interval_ms: int
    confirmed: bool = True

    @property
    def end(self) -> int:
        return self.start + self.interval_ms


@dataclass
class Instrument:
    symbol: str
    base_coin: str
    quote_coin: str
    status: str
    contract_type: str
    launch_time: int
    tick_size: float
    qty_step: float
    min_qty: float
    max_leverage: float
    funding_interval_min: int = 480
    min_notional: float = 5.0


@dataclass
class MarketSnapshot:
    symbol: str
    last: float
    bid: float
    ask: float
    mark: float
    index: float
    turnover_24h: float
    volume_24h: float
    open_interest_value: float
    funding_rate: float
    next_funding_ms: int
    price_24h_pct: float
    ts: float = field(default_factory=time.time)

    @property
    def mid(self) -> float:
        return (self.bid + self.ask) / 2 if self.bid and self.ask else self.last

    @property
    def spread_bps(self) -> float:
        if not self.bid or not self.ask or self.ask < self.bid:
            return float("inf")
        return (self.ask - self.bid) / self.mid * 1e4


@dataclass
class OrderBook:
    symbol: str
    bids: list[tuple[float, float]]   # (price, size) best first
    asks: list[tuple[float, float]]
    ts: float = field(default_factory=time.time)

    def depth_usdt(self, band: float) -> tuple[float, float]:
        if not self.bids or not self.asks:
            return 0.0, 0.0
        mid = (self.bids[0][0] + self.asks[0][0]) / 2
        bid_d = sum(p * s for p, s in self.bids if p >= mid * (1 - band))
        ask_d = sum(p * s for p, s in self.asks if p <= mid * (1 + band))
        return bid_d, ask_d


@dataclass
class TradePlan:
    """Fully costed trade parameters produced by the ROI engine."""
    direction: Direction
    entry: float
    stop: float
    take_profit: float
    qty: float
    notional: float
    margin: float
    leverage: float
    entry_fee: float
    exit_fee: float
    funding_cost: float
    slippage_cost: float
    gross_profit: float
    net_profit: float
    net_roi: float
    max_loss: float
    account_risk_pct: float
    reward_risk: float
    liquidation_price: float
    expected_hold_hours: float
    stop_fee: float = 0.0


@dataclass
class StageResult:
    stage: str
    passed: bool
    mandatory: bool = True
    reasons: list[str] = field(default_factory=list)
    details: dict[str, Any] = field(default_factory=dict)


@dataclass
class Signal:
    symbol: str
    direction: Direction
    strategy: str
    plan: TradePlan
    entry_zone: tuple[float, float]
    score: float
    component_scores: dict[str, float]
    regime: Regime
    trend_status: str
    volume_status: str
    liquidity_status: str
    rationale: str
    invalidation: str
    invalidation_price: float
    created_ms: int
    expires_ms: int
    signal_id: str = field(default_factory=lambda: "QE-" + uuid.uuid4().hex[:12].upper())
    status: SignalStatus = SignalStatus.GENERATED
    calibrated: bool = False
    paper: bool = True
