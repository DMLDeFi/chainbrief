"""Strategy families.  Each turns closed-candle features into zero or more
*candidates*; candidates are not signals until the approval pipeline passes them.

* trend_pullback  — 4h/1h trend, 15m pullback into the EMA21–EMA50 band or an
                    open order block / FVG, resumed momentum on the trigger bar.
* breakout_retest — 1h close through a swing level, then a 1h retest that holds.
* sweep_reversal  — 1h liquidity sweep of a swing/equal level followed by a 15m
                    change of character or regular divergence.  Needs stronger
                    evidence (checked again in approval).
"""
from __future__ import annotations

from ..models import Direction
from .context import Candidate, EvalContext


def _sg(d: Direction) -> int:
    return d.sign


def trend_pullback(ctx: EvalContext) -> list[Candidate]:
    out = []
    try:
        f15, f1h, f4h = ctx.f("15"), ctx.f("60"), ctx.f("240")
    except KeyError:
        return out
    a = f15.atr
    for d in (Direction.LONG, Direction.SHORT):
        s = _sg(d)
        htf_ok = s * (f4h.close - f4h.ema[50]) > 0 and s * (f1h.close - f1h.ema[50]) > 0 and \
            s * (f1h.ema[21] - f1h.ema[50]) > 0
        if not htf_ok:
            continue
        band_lo, band_hi = sorted((f15.ema[21], f15.ema[50]))
        st = f15.structure
        # pullback: price came into band (or an aligned OB/FVG) and closed back beyond EMA21
        zones = [z for z in st.order_blocks + st.open_fvgs
                 if z.kind in (("ob_bull", "fvg_bull") if s > 0 else ("ob_bear", "fvg_bear"))]
        touched_band = (f15.low3 <= band_hi + 0.25 * a) if s > 0 else (f15.high3 >= band_lo - 0.25 * a)
        in_zone = any(z.contains(f15.close, 0.3 * a) for z in zones)
        resumed = s * (f15.close - f15.ema[21]) > 0 and s * (f15.macd_hist - f15.macd_hist_prev) > 0
        rsi_ok = (40 <= f15.rsi <= 65) if s > 0 else (35 <= f15.rsi <= 60)
        near_band = abs(f15.close - f15.ema[21]) <= 0.8 * a
        if not (resumed and rsi_ok and near_band and (touched_band or in_zone)):
            continue
        swing = st.last_low if s > 0 else st.last_high
        struct_stop = swing.price if swing else f15.close - s * 2 * a
        stop = struct_stop - s * 0.5 * a
        if s * (f15.close - stop) < 1.0 * a:          # keep stop outside normal noise
            stop = f15.close - s * 1.0 * a
        inval = f15.ema[50] - s * 0.5 * a
        out.append(Candidate(
            ctx.symbol, d, "trend_pullback", f15.close, stop, inval,
            [f"4h & 1h above/below EMA50 in {d.value.lower()} direction",
             "15m pullback into EMA21/50 band" + (" with aligned order block/FVG" if in_zone else ""),
             "15m close back beyond EMA21 with rising MACD histogram"],
            f"15m close {'below' if s > 0 else 'above'} {inval:.6g} (EMA50 -/+ 0.5 ATR) or structural swing broken",
            evidence={"in_zone": in_zone, "touched_band": touched_band}))
    return out


def breakout_retest(ctx: EvalContext) -> list[Candidate]:
    out = []
    try:
        f15, f1h = ctx.f("15"), ctx.f("60")
    except KeyError:
        return out
    st = f1h.structure
    if st.retest is None or st.retest_level is None:
        return out
    d = Direction.LONG if st.retest == "bull" else Direction.SHORT
    s = _sg(d)
    lvl, a1 = st.retest_level, f1h.atr
    if s * (f15.close - lvl) <= 0 or s * (f15.close - f15.ema[21]) <= 0:
        return out
    stop = lvl - s * 0.6 * a1
    out.append(Candidate(
        ctx.symbol, d, "breakout_retest", f15.close, stop, lvl - s * 0.3 * a1,
        [f"1h close broke swing level {lvl:.6g}", "1h retest held the level", "15m holding above/below EMA21"],
        f"1h close back {'below' if s > 0 else 'above'} {lvl - s * 0.3 * a1:.6g} (failed retest)",
        trigger_tf="60", evidence={"level": lvl}))
    return out


def sweep_reversal(ctx: EvalContext) -> list[Candidate]:
    out = []
    try:
        f15, f1h = ctx.f("15"), ctx.f("60")
    except KeyError:
        return out
    st = f1h.structure
    if st.sweep is None or st.sweep_level is None:
        return out
    d = Direction.LONG if st.sweep == "bull" else Direction.SHORT
    s = _sg(d)
    confirm = (f15.structure.choch == ("bull" if s > 0 else "bear")) or (f15.bull_div if s > 0 else f15.bear_div) \
        or (f1h.bull_div if s > 0 else f1h.bear_div)
    if not confirm:
        return out
    pool = st.equal_lows if s > 0 else st.equal_highs
    at_pool = any(abs(p - st.sweep_level) <= 0.3 * f1h.atr for p in pool)
    sr = [z for z in st.sr_zones if z.contains(st.sweep_level, 0.3 * f1h.atr)]
    extreme = f1h.bar_low if s > 0 else f1h.bar_high
    stop = extreme - s * 0.3 * f1h.atr
    out.append(Candidate(
        ctx.symbol, d, "sweep_reversal", f15.close, stop, st.sweep_level - s * 0.25 * f1h.atr,
        [f"1h swept liquidity at {st.sweep_level:.6g} and closed back inside",
         "15m change of character / divergence confirms rejection",
         *(["sweep took out equal highs/lows"] if at_pool else []),
         *(["sweep occurred at a multi-touch S/R zone"] if sr else [])],
        f"trade beyond sweep level {st.sweep_level:.6g} by 0.25 ATR(1h)",
        trigger_tf="60", evidence={"at_pool": at_pool, "at_sr": bool(sr)}))
    return out


STRATEGIES = {"trend_pullback": trend_pullback, "breakout_retest": breakout_retest,
              "sweep_reversal": sweep_reversal}


def generate(ctx: EvalContext) -> list[Candidate]:
    out: list[Candidate] = []
    for fn in STRATEGIES.values():
        out.extend(fn(ctx))
    return out
