"""Ultra-selective, eight-stage signal approval.

Mandatory stages short-circuit: a candidate that fails any of them is rejected
no matter how high its score would have been.  The weighted score is computed
only for candidates that pass every mandatory gate, and must be >= the
threshold (default 90).  The score is a *quality rank*, not a win probability;
``Calibrator`` maps it to realised outcomes once enough history exists.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np

from ..config import AppConfig
from ..models import Direction, Regime, Signal, StageResult, TradePlan
from ..risk.engine import RiskEngine
from ..risk.roi import PlanRejected, build_plan
from . import protection
from .calibration import Calibrator
from .context import Candidate, EvalContext

WEIGHTS = {"structure": 0.20, "mtf": 0.20, "volume": 0.15, "momentum": 0.15,
           "liquidity": 0.10, "regime": 0.10, "risk_reward": 0.10}
assert abs(sum(WEIGHTS.values()) - 1.0) < 1e-12


@dataclass
class Decision:
    candidate: Candidate
    approved: bool
    stages: list[StageResult] = field(default_factory=list)
    score: float = 0.0
    components: dict[str, float] = field(default_factory=dict)
    plan: TradePlan | None = None
    signal: Signal | None = None

    @property
    def rejection_reasons(self) -> list[str]:
        return [f"{s.stage}: {r}" for s in self.stages if not s.passed for r in s.reasons]


def _clip(x: float) -> float:
    return float(max(0.0, min(100.0, x)))


def _lin(x: float, lo: float, hi: float) -> float:
    """0 at lo, 100 at hi (works for hi < lo too)."""
    if math.isnan(x) or hi == lo:
        return 0.0
    return _clip((x - lo) / (hi - lo) * 100)


def tf_aligned(f, s: int) -> bool:
    return s * (f.close - f.ema[50]) > 0 and s * (f.ema[21] - f.ema[50]) > 0


def score_components(ctx: EvalContext, c: Candidate, plan: TradePlan) -> dict[str, float]:
    s = c.direction.sign
    f15, f1h, f4h, f1d = ctx.f("15"), ctx.f("60"), ctx.f("240"), ctx.f("D")
    want = "bull" if s > 0 else "bear"
    want_trend = "bullish" if s > 0 else "bearish"

    st1h = f1h.structure
    structure = 40.0 * (st1h.trend == want_trend) + 20.0 * (st1h.trend == "range")
    event = st1h.bos == want or st1h.retest == want or st1h.sweep == want or f15.structure.choch == want \
        or f15.structure.bos == want
    structure += 30.0 * event
    zones = [z for z in f15.structure.order_blocks + f15.structure.open_fvgs + f15.structure.sr_zones
             if z.contains(c.entry, 0.5 * f15.atr)]
    structure += 30.0 if zones else (15.0 if c.evidence.get("at_pool") else 0.0)

    mtf = sum(25.0 for f in (f1d, f4h, f1h, f15) if tf_aligned(f, s))
    if c.strategy == "sweep_reversal":   # reversal: lower TFs flip first; require 4h/D not strongly against
        mtf = 25.0 * tf_aligned(f15, s) + 25.0 * (f1h.structure.choch == want or tf_aligned(f1h, s)) \
            + 25.0 * (not (tf_aligned(f4h, -s) and f4h.adx > 25)) + 25.0 * (not (tf_aligned(f1d, -s) and f1d.adx > 25))

    trig = f1h if c.trigger_tf == "60" else f15
    volume = 0.5 * _lin(trig.rvol, 0.8, 2.0) + 0.3 * _lin(trig.vol_accel, 0.8, 1.6) + 20.0 * (not trig.pv_divergence)

    rsi_mid = 55 if s > 0 else 45
    momentum = 30.0 * (s * (f15.macd_hist - f15.macd_hist_prev) > 0) + 20.0 * (s * f1h.macd_hist > 0)
    momentum += 25.0 * max(0.0, 1 - abs(f15.rsi - rsi_mid) / 20)
    stoch_extreme = (f15.stoch_k > 90) if s > 0 else (f15.stoch_k < 10)
    momentum += 15.0 * (not stoch_extreme)
    opposite_div = f15.bear_div if s > 0 else f15.bull_div
    momentum += 10.0 * (not opposite_div)

    el = ctx.eligibility
    liquidity = 0.4 * _lin(el.spread_bps, 6.0, 1.0) + 0.3 * _lin(math.log10(max(el.turnover_24h, 1)), 7.3, 8.7) \
        + 0.3 * _lin(math.log10(max(min(el.depth_bid, el.depth_ask), 1)), 5.2, 6.3)

    reg = ctx.regime
    regime = {Regime.STRONG_BULL: 100, Regime.STRONG_BEAR: 100, Regime.WEAK_BULL: 75,
              Regime.WEAK_BEAR: 75, Regime.SIDEWAYS: 70}.get(reg.regime, 0) * (0.6 + 0.4 * reg.confidence)

    rr = _lin(plan.reward_risk, 1.5, 3.0)
    return {"structure": _clip(structure), "mtf": _clip(mtf), "volume": _clip(volume),
            "momentum": _clip(momentum), "liquidity": _clip(liquidity), "regime": _clip(regime),
            "risk_reward": _clip(rr)}


def contradictions(ctx: EvalContext, c: Candidate) -> list[str]:
    s = c.direction.sign
    f15, f1h, f4h = ctx.f("15"), ctx.f("60"), ctx.f("240")
    out = []
    if (f1h.bear_div if s > 0 else f1h.bull_div):
        out.append("1h divergence against direction")
    if c.strategy != "sweep_reversal" and tf_aligned(f4h, -s):
        out.append("4h trend opposes direction")
    if (f1h.structure.choch == ("bear" if s > 0 else "bull")):
        out.append("1h change of character against direction")
    if s * (f15.close - f15.vwap) < 0 and c.strategy == "trend_pullback" and s * (f1h.close - f1h.vwap) < 0:
        out.append("price on wrong side of VWAP on 15m and 1h")
    return out


class ApprovalEngine:
    def __init__(self, cfg: AppConfig, risk: RiskEngine, calibrator: Calibrator | None = None):
        self.cfg, self.risk = cfg, risk
        self.calibrator = calibrator or Calibrator()

    def evaluate(self, ctx: EvalContext, c: Candidate, closes: dict[str, np.ndarray] | None = None) -> Decision:
        t, rc = self.cfg.trading, self.cfg.risk
        dec = Decision(c, False)
        s = c.direction.sign

        def stage(name: str, ok: bool, reasons: list[str], mandatory: bool = True, **details) -> bool:
            dec.stages.append(StageResult(name, ok, mandatory, [] if ok else reasons, details))
            return ok

        # 1 — market eligibility
        el = ctx.eligibility
        if not stage("1_market_eligibility", el.eligible and el.data_fresh,
                     el.reasons or ["stale market data"], spread_bps=el.spread_bps):
            return dec
        if (c.direction is Direction.LONG and not t.allow_long) or (c.direction is Direction.SHORT and not t.allow_short):
            stage("1_market_eligibility", False, [f"{c.direction.value} disabled in config"])
            return dec
        # 2 — regime
        reg = ctx.regime
        if not stage("2_market_regime", reg.permits(c.strategy, c.direction.value),
                     [f"{c.strategy}/{c.direction.value} not permitted in {reg.regime.value}"] + reg.reasons,
                     regime=reg.regime.value):
            return dec
        # 3 — directional confirmation
        f4h, f1d, f1h = ctx.f("240"), ctx.f("D"), ctx.f("60")
        if c.strategy == "sweep_reversal":
            dir_ok = not (tf_aligned(f4h, -s) and f4h.adx > 25) and not (tf_aligned(f1d, -s) and f1d.adx > 25)
        else:
            dir_ok = tf_aligned(f4h, s) and s * (f1d.close - f1d.ema[50]) > 0 and s * (f1h.close - f1h.ema[50]) > 0
        if not stage("3_directional_confirmation", dir_ok, ["higher timeframes do not support direction"]):
            return dec
        # 4 — technical confirmation (structure + momentum + no contradictions + false-signal filters)
        flags = protection.detect(ctx, c)
        contra = contradictions(ctx, c)
        if not stage("4_technical_confirmation", not flags and not contra, flags + contra):
            return dec
        # 5 — volume
        trig = f1h if c.trigger_tf == "60" else ctx.f("15")
        min_rvol = 1.3 if c.strategy == "sweep_reversal" else 1.0
        if not stage("5_volume_confirmation", trig.rvol >= min_rvol and not trig.pv_divergence,
                     [f"relative volume {trig.rvol:.2f} < {min_rvol}" if trig.rvol < min_rvol else "price/volume divergence"]):
            return dec
        # 6 — entry validation: price still near the planned entry, invalidation not already hit
        px = ctx.snapshot.ask if s > 0 else ctx.snapshot.bid
        f15 = ctx.f("15")
        drift = s * (px - c.entry) / f15.atr if f15.atr > 0 else 99
        inval_hit = s * (px - c.invalidation_price) <= 0
        if not stage("6_entry_validation", drift <= 0.5 and not inval_hit,
                     ["price ran away from entry (>0.5 ATR)" if drift > 0.5 else "invalidation already breached"]):
            return dec
        # 7 — risk validation (portfolio engine + exact ROI plan)
        rd = self.risk.check(c.symbol, c.direction, ctx.equity, funding_rate=ctx.snapshot.funding_rate,
                             closes=closes, now=ctx.now_ms / 1000, strategy=c.strategy)
        if not stage("7_risk_validation", rd.allowed, rd.reasons):
            return dec
        try:
            plan = build_plan(c.direction, c.entry, c.stop, equity=ctx.equity,
                              available_margin=ctx.available_margin, leverage=t.leverage,
                              target_roi=t.target_net_roi, funding_rate=ctx.snapshot.funding_rate,
                              next_funding_ms=ctx.snapshot.next_funding_ms, now_ms=ctx.now_ms,
                              hourly_sigma=ctx.hourly_sigma, instrument=ctx.instrument,
                              costs=self.cfg.costs, risk=rc, risk_fraction=rd.risk_fraction)
        except PlanRejected as e:
            stage("7_risk_validation", False, [str(e)])
            return dec
        if not stage("7_risk_validation", plan.account_risk_pct <= rc.risk_per_trade + 1e-9,
                     ["planned loss exceeds risk budget"], plan=plan.__dict__):
            return dec
        dec.plan = plan
        # 8 — final approval: weighted score + calibration evidence
        comps = score_components(ctx, c, plan)
        score = round(sum(WEIGHTS[k] * v for k, v in comps.items()), 2)
        dec.score, dec.components = score, comps
        cal = self.calibrator.assess(score)
        ok = score >= t.min_quality_score and cal.acceptable
        reasons = []
        if score < t.min_quality_score:
            weakest = sorted(comps.items(), key=lambda kv: kv[1])[:2]
            reasons.append(f"quality score {score:.1f} < {t.min_quality_score} (weakest: "
                           + ", ".join(f"{k} {v:.0f}" for k, v in weakest) + ")")
        if not cal.acceptable:
            reasons.append(cal.reason)
        if not stage("8_final_approval", ok, reasons, score=score, calibration=cal.__dict__):
            return dec
        dec.approved = True
        zone_half = t.entry_zone_atr_frac * f15.atr
        # long: buy at or below entry; short: sell at or above entry
        zone = (c.entry - zone_half, c.entry) if s > 0 else (c.entry, c.entry + zone_half)
        dec.signal = Signal(
            symbol=c.symbol, direction=c.direction, strategy=c.strategy, plan=plan,
            entry_zone=(min(zone), max(zone)), score=score, component_scores=comps,
            regime=reg.regime, trend_status=_trend_status(ctx, s), volume_status=f"RVOL {trig.rvol:.2f}x",
            liquidity_status=f"spread {el.spread_bps:.1f}bps, depth ${min(el.depth_bid, el.depth_ask) / 1e3:,.0f}k",
            rationale="; ".join(c.rationale), invalidation=c.invalidation,
            invalidation_price=c.invalidation_price, created_ms=ctx.now_ms,
            expires_ms=ctx.now_ms + t.signal_expiry_minutes * 60_000,
            calibrated=cal.calibrated, paper=self.cfg.paper_trading)
        return dec


def _trend_status(ctx: EvalContext, s: int) -> str:
    names = [("D", "1D"), ("240", "4H"), ("60", "1H"), ("15", "15M")]
    aligned = [lbl for k, lbl in names if tf_aligned(ctx.f(k), s)]
    return f"{len(aligned)}/4 aligned ({', '.join(aligned) or 'none'})"
