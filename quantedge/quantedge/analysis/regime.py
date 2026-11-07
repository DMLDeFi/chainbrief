"""Market-regime classification.

A deterministic, feature-based classifier (reproducible and auditable).  The
same feature vector is stored with every signal so that a statistical model
(e.g. gradient boosting on realised outcomes) can later be trained and compared
out-of-sample before it is ever allowed to replace these rules.

Priority order: UNSTABLE > LOW_LIQUIDITY > HIGH_VOL > trend/sideways.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from ..models import Regime
from .features import Features

# Which strategy families may run in each regime, and in which direction.
PERMITTED: dict[Regime, dict[str, set[str]]] = {
    Regime.STRONG_BULL: {"trend_pullback": {"LONG"}, "breakout_retest": {"LONG"}},
    Regime.WEAK_BULL: {"trend_pullback": {"LONG"}, "breakout_retest": {"LONG"}, "sweep_reversal": {"LONG", "SHORT"}},
    Regime.STRONG_BEAR: {"trend_pullback": {"SHORT"}, "breakout_retest": {"SHORT"}},
    Regime.WEAK_BEAR: {"trend_pullback": {"SHORT"}, "breakout_retest": {"SHORT"}, "sweep_reversal": {"LONG", "SHORT"}},
    Regime.SIDEWAYS: {"sweep_reversal": {"LONG", "SHORT"}},
    Regime.HIGH_VOL: {},        # NO-TRADE: costs and stop risk dominate
    Regime.LOW_LIQUIDITY: {},
    Regime.UNSTABLE: {},
}


@dataclass
class RegimeResult:
    regime: Regime
    confidence: float
    reasons: list[str] = field(default_factory=list)
    features: dict[str, float] = field(default_factory=dict)

    @property
    def no_trade(self) -> bool:
        return not PERMITTED[self.regime]

    def permits(self, strategy: str, direction: str) -> bool:
        return direction in PERMITTED[self.regime].get(strategy, set())


def _ok(x) -> bool:
    return x is not None and not (isinstance(x, float) and np.isnan(x))


def classify(f4h: Features | None, f1d: Features | None, f1h: Features | None, *,
             liquidity_ok: bool = True, mark_index_dev: float = 0.0,
             btc_1h_move: float = 0.0, change_24h: float = 0.0) -> RegimeResult:
    reasons: list[str] = []
    if f4h is None or f1d is None or f1h is None:
        return RegimeResult(Regime.UNSTABLE, 1.0, ["insufficient multi-timeframe history"])
    feats = {"adx4h": f4h.adx, "atr_pct4h": f4h.atr_pct, "atr_ratio1h": f1h.atr_ratio,
             "bbw_pct4h": f4h.bb_width_pctile, "mark_index_dev": mark_index_dev,
             "btc_1h_move": btc_1h_move, "chg24h": change_24h}

    if abs(mark_index_dev) > 0.005:
        reasons.append(f"mark/index deviation {mark_index_dev:.2%}")
    if abs(btc_1h_move) > 0.03:
        reasons.append(f"BTC moved {btc_1h_move:+.2%} in 1h")
    if _ok(f1h.atr_ratio) and f1h.atr_ratio > 2.5:
        reasons.append(f"1h ATR expanded {f1h.atr_ratio:.1f}x")
    if abs(change_24h) > 0.25:
        reasons.append(f"24h change {change_24h:+.1%}")
    if reasons:
        return RegimeResult(Regime.UNSTABLE, 0.9, reasons, feats)
    if not liquidity_ok:
        return RegimeResult(Regime.LOW_LIQUIDITY, 0.9, ["failed liquidity filters"], feats)
    if (_ok(f4h.atr_ratio) and f4h.atr_ratio > 1.8) or f4h.atr_pct > 0.045:
        return RegimeResult(Regime.HIGH_VOL, 0.8, [f"4h ATR {f4h.atr_pct:.2%} of price"], feats)

    e4, e1d = f4h.ema, f1d.ema
    bull_htf = f4h.close > e4[50] > e4[200] and f1d.close > e1d[50]
    bear_htf = f4h.close < e4[50] < e4[200] and f1d.close < e1d[50]
    di_bull, di_bear = f4h.plus_di > f4h.minus_di, f4h.minus_di > f4h.plus_di
    if bull_htf and di_bull and f4h.adx >= 25 and f4h.structure.trend != "bearish":
        return RegimeResult(Regime.STRONG_BULL, min(1.0, f4h.adx / 40), ["4h/1D EMAs aligned up, ADX>=25"], feats)
    if bear_htf and di_bear and f4h.adx >= 25 and f4h.structure.trend != "bullish":
        return RegimeResult(Regime.STRONG_BEAR, min(1.0, f4h.adx / 40), ["4h/1D EMAs aligned down, ADX>=25"], feats)
    if f4h.adx < 18:
        return RegimeResult(Regime.SIDEWAYS, 0.7, [f"4h ADX {f4h.adx:.1f} < 18"], feats)
    if f4h.close > e4[50] and di_bull:
        return RegimeResult(Regime.WEAK_BULL, 0.6, ["above 4h EMA50, +DI>-DI, trend not strong"], feats)
    if f4h.close < e4[50] and di_bear:
        return RegimeResult(Regime.WEAK_BEAR, 0.6, ["below 4h EMA50, -DI>+DI, trend not strong"], feats)
    return RegimeResult(Regime.SIDEWAYS, 0.5, ["no directional consensus"], feats)
