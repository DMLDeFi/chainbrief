"""Single evaluation path shared by the live engine and the back-tester."""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from ..analysis.features import Features
from ..analysis.regime import RegimeResult, classify
from ..models import Instrument, MarketSnapshot
from .approval import ApprovalEngine, Decision
from .context import EvalContext, Eligibility
from .strategies import generate


@dataclass
class SymbolEvaluation:
    symbol: str
    regime: RegimeResult
    decisions: list[Decision]

    @property
    def best_score(self) -> float | None:
        scores = [d.score for d in self.decisions if d.score]
        return max(scores) if scores else None


def evaluate_symbol(approval: ApprovalEngine, *, symbol: str, instrument: Instrument,
                    snapshot: MarketSnapshot, eligibility: Eligibility, tf: dict[str, Features | None],
                    now_ms: int, equity: float, available_margin: float, btc_1h_move: float = 0.0,
                    closes: dict[str, np.ndarray] | None = None) -> SymbolEvaluation:
    mark_dev = snapshot.mark / snapshot.index - 1 if snapshot.index else 0.0
    regime = classify(tf.get("240"), tf.get("D"), tf.get("60"), liquidity_ok=eligibility.eligible,
                      mark_index_dev=mark_dev, btc_1h_move=btc_1h_move, change_24h=snapshot.price_24h_pct)
    f1h = tf.get("60")
    ctx = EvalContext(symbol, instrument, snapshot, eligibility, tf, regime, now_ms, equity,
                      available_margin, btc_1h_move, hourly_sigma=f1h.atr if f1h else 0.0)
    if regime.no_trade or any(tf.get(k) is None for k in ("15", "60", "240", "D")):
        return SymbolEvaluation(symbol, regime, [])
    decisions = [approval.evaluate(ctx, c, closes) for c in generate(ctx)]
    return SymbolEvaluation(symbol, regime, decisions)
