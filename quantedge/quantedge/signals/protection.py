"""False-signal protection.  Each detector returns a list of blocking flags.

These detectors are deliberately conservative: a flag rejects the candidate.
There is no news feed, so "news-driven dislocation" is inferred from price
behaviour alone (abnormal bar range vs ATR); this is a proxy, not news analysis.
"""
from __future__ import annotations

from ..models import Direction
from .context import Candidate, EvalContext


def detect(ctx: EvalContext, cand: Candidate) -> list[str]:
    flags: list[str] = []
    s = cand.direction.sign
    f5, f15, f1h = ctx.tf.get("5"), ctx.f("15"), ctx.f("60")
    snap, el = ctx.snapshot, ctx.eligibility

    # stop hunt / liquidity grab *against* us on the trigger bar: long wick in our direction
    rng = f15.bar_high - f15.bar_low
    if rng > 0:
        upper_wick = f15.bar_high - max(f15.close, f15.bar_open)
        lower_wick = min(f15.close, f15.bar_open) - f15.bar_low
        adverse_wick = upper_wick if s > 0 else lower_wick
        if adverse_wick / rng > 0.6 and rng > 1.5 * f15.atr:
            flags.append("trigger bar shows rejection wick against the trade (liquidity grab)")
        if rng > 3.0 * f15.atr:
            flags.append(f"trigger bar range {rng / f15.atr:.1f}x ATR (stop-hunt / dislocation risk)")

    # false breakout / bull & bear traps
    if s > 0 and (f15.failed_breakout_up or f1h.failed_breakout_up):
        flags.append("recent failed upside breakout (bull trap)")
    if s < 0 and (f15.failed_breakout_down or f1h.failed_breakout_down):
        flags.append("recent failed downside breakout (bear trap)")
    if cand.strategy == "breakout_retest" and f1h.rvol < 1.2:
        flags.append("breakout lacked relative volume (>=1.2x required)")

    # manipulative-looking volume: extreme volume with no price progress (absorption / wash)
    if f15.vol_z > 6 and rng < 0.5 * f15.atr:
        flags.append("extreme volume spike without price progress")
    if f5 is not None and f5.vol_z > 8:
        flags.append("5m volume z-score > 8 (possible manipulation)")

    # spread / funding / mark-index
    if el.spread_ratio > 2.0:
        flags.append(f"spread expanded {el.spread_ratio:.1f}x vs its recent median")
    if s * snap.funding_rate > 0.0003:
        flags.append(f"crowded funding {snap.funding_rate:+.4%} against entry side")
    if snap.index > 0 and abs(snap.mark / snap.index - 1) > 0.003:
        flags.append("mark/index divergence > 0.3%")

    # low-liquidity volatility spike
    if f5 is not None and f5.atr_ratio == f5.atr_ratio and f5.atr_ratio > 3 and el.turnover_24h < 5e7:
        flags.append("5m volatility spike on thin liquidity")

    # news-like dislocation proxy
    if f1h.bar_high - f1h.bar_low > 3.5 * f1h.atr:
        flags.append("1h bar > 3.5 ATR (news-driven dislocation proxy)")

    # momentum exhaustion in the entry direction
    if (cand.direction is Direction.LONG and f15.exhaustion_long) or (cand.direction is Direction.SHORT and f15.exhaustion_short):
        flags.append("momentum exhaustion in trade direction")
    return flags
