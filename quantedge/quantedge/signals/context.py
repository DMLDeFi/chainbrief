"""Evaluation context handed to strategies, filters and the approval pipeline."""
from __future__ import annotations

from dataclasses import dataclass, field

from ..analysis.features import Features
from ..analysis.regime import RegimeResult
from ..models import Direction, Instrument, MarketSnapshot


@dataclass
class Eligibility:
    eligible: bool
    reasons: list[str] = field(default_factory=list)
    spread_bps: float = float("nan")
    depth_bid: float = 0.0
    depth_ask: float = 0.0
    turnover_24h: float = 0.0
    spread_ratio: float = 1.0     # current spread / rolling median spread
    data_fresh: bool = True


@dataclass
class EvalContext:
    symbol: str
    instrument: Instrument
    snapshot: MarketSnapshot
    eligibility: Eligibility
    tf: dict[str, Features | None]
    regime: RegimeResult
    now_ms: int
    equity: float
    available_margin: float
    btc_1h_move: float = 0.0
    hourly_sigma: float = 0.0     # 1h ATR in price units (diffusion speed proxy)

    def f(self, key: str) -> Features:
        v = self.tf.get(key)
        if v is None:
            raise KeyError(key)
        return v


@dataclass
class Candidate:
    symbol: str
    direction: Direction
    strategy: str
    entry: float
    stop: float
    invalidation_price: float
    rationale: list[str]
    invalidation: str
    trigger_tf: str = "15"
    evidence: dict = field(default_factory=dict)
