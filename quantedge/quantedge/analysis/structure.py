"""Market-structure primitives with explicit, testable definitions.

All functions take arrays of *closed* candles only and evaluate the final bar.
Swing pivots need ``right`` bars of confirmation, so a pivot at index ``i`` is
only known from index ``i + right`` onwards — this is the lag a human trader
also faces and the reason it introduces no look-ahead.

Definitions (ATR = Wilder ATR(14) at the evaluation bar):

* Swing high at i: high[i] > max(high[i-left:i]) and high[i] >= max(high[i+1:i+right+1]).
* Swing low  at i: mirror image.
* Bullish structure: last two confirmed swing highs ascending (HH) and last two
  swing lows ascending (HL).  Bearish: LH and LL.  Otherwise ``range``.
* Break of structure (BOS): close of the evaluation bar beyond the most recent
  confirmed swing *in the direction of* the prevailing structure.
* Change of character (CHoCH): close beyond the most recent confirmed swing
  *against* the prevailing structure.
* Equal highs/lows: two confirmed swing points within ``eq_tol_atr * ATR``.
* Liquidity sweep (bullish): bar low trades below a confirmed swing low within
  ``lookback`` bars, but the bar closes back above it.  Bearish is the mirror.
* Fair value gap (bullish) at i: low[i] > high[i-2] by at least ``fvg_min_atr * ATR``.
  It is *open* while no later low has traded back to high[i-2].
* Order block (bullish): the last bearish candle within 5 bars before a bar
  whose close broke a swing high with displacement >= ``disp_atr * ATR``
  (measured from that candle's low).  Zone = [low, high] of that candle.
* Support/resistance zone: cluster of >= 2 confirmed pivots whose prices lie
  within ``zone_atr * ATR`` of each other.
* Breakout-retest (bullish): within ``retest_window`` bars after a close above a
  resistance level L, a bar's low comes within ``retest_tol_atr * ATR`` of L
  (or below it) and that bar closes above L.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from .indicators import atr as _atr


@dataclass
class Pivot:
    index: int
    price: float
    kind: str          # "H" or "L"
    confirmed_at: int


@dataclass
class Zone:
    low: float
    high: float
    touches: int
    kind: str          # "support"/"resistance"/"demand"/"supply"/"ob_bull"/"ob_bear"/"fvg_bull"/"fvg_bear"
    index: int = -1

    def contains(self, price: float, pad: float = 0.0) -> bool:
        return self.low - pad <= price <= self.high + pad


@dataclass
class StructureState:
    trend: str                         # "bullish" | "bearish" | "range"
    swing_highs: list[Pivot]
    swing_lows: list[Pivot]
    bos: str | None                    # "bull" | "bear" | None
    choch: str | None
    sweep: str | None                  # "bull" (swept lows) | "bear" (swept highs)
    sweep_level: float | None
    equal_highs: list[float]
    equal_lows: list[float]
    open_fvgs: list[Zone]
    order_blocks: list[Zone]
    sr_zones: list[Zone]
    retest: str | None
    retest_level: float | None
    atr: float
    notes: list[str] = field(default_factory=list)

    @property
    def last_high(self) -> Pivot | None:
        return self.swing_highs[-1] if self.swing_highs else None

    @property
    def last_low(self) -> Pivot | None:
        return self.swing_lows[-1] if self.swing_lows else None


def find_pivots(high, low, left: int = 3, right: int = 3) -> list[Pivot]:
    h, l = np.asarray(high, float), np.asarray(low, float)
    n = len(h)
    out: list[Pivot] = []
    for i in range(left, n - right):
        if h[i] > h[i - left:i].max() and h[i] >= h[i + 1:i + right + 1].max():
            out.append(Pivot(i, float(h[i]), "H", i + right))
        if l[i] < l[i - left:i].min() and l[i] <= l[i + 1:i + right + 1].min():
            out.append(Pivot(i, float(l[i]), "L", i + right))
    return out


def classify_trend(highs: list[Pivot], lows: list[Pivot]) -> str:
    if len(highs) < 2 or len(lows) < 2:
        return "range"
    hh = highs[-1].price > highs[-2].price
    hl = lows[-1].price > lows[-2].price
    lh = highs[-1].price < highs[-2].price
    ll = lows[-1].price < lows[-2].price
    if hh and hl:
        return "bullish"
    if lh and ll:
        return "bearish"
    return "range"


def _equal_levels(pivots: list[Pivot], tol: float, recent: int = 6) -> list[float]:
    pts = pivots[-recent:]
    out = []
    for i in range(len(pts)):
        for j in range(i + 1, len(pts)):
            if abs(pts[i].price - pts[j].price) <= tol:
                out.append((pts[i].price + pts[j].price) / 2)
    return sorted(set(round(x, 12) for x in out))


def _fvgs(h, l, a, min_atr: float, max_age: int = 60) -> list[Zone]:
    n = len(h)
    zones: list[Zone] = []
    for i in range(max(2, n - max_age), n):
        if l[i] - h[i - 2] >= min_atr * a:
            top, bot = l[i], h[i - 2]
            if i + 1 >= n or l[i + 1:].min() > bot:
                zones.append(Zone(bot, top, 0, "fvg_bull", i))
        if l[i - 2] - h[i] >= min_atr * a:
            top, bot = l[i - 2], h[i]
            if i + 1 >= n or h[i + 1:].max() < top:
                zones.append(Zone(bot, top, 0, "fvg_bear", i))
    return zones


def _order_blocks(o, h, l, c, pivots: list[Pivot], a: float, disp_atr: float) -> list[Zone]:
    n = len(c)
    zones: list[Zone] = []
    highs = [p for p in pivots if p.kind == "H"]
    lows = [p for p in pivots if p.kind == "L"]
    for t in range(max(6, n - 80), n):
        prior_h = [p for p in highs if p.confirmed_at < t]
        prior_l = [p for p in lows if p.confirmed_at < t]
        if prior_h and c[t] > prior_h[-1].price and c[t - 1] <= prior_h[-1].price:
            for j in range(t - 1, max(t - 6, 0), -1):
                if c[j] < o[j]:
                    if c[t] - l[j] >= disp_atr * a and l[j + 1:].min() >= l[j]:
                        zones.append(Zone(float(l[j]), float(h[j]), 0, "ob_bull", j))
                    break
        if prior_l and c[t] < prior_l[-1].price and c[t - 1] >= prior_l[-1].price:
            for j in range(t - 1, max(t - 6, 0), -1):
                if c[j] > o[j]:
                    if h[j] - c[t] >= disp_atr * a and h[j + 1:].max() <= h[j]:
                        zones.append(Zone(float(l[j]), float(h[j]), 0, "ob_bear", j))
                    break
    return zones[-4:]


def _sr_zones(pivots: list[Pivot], tol: float, price: float) -> list[Zone]:
    pts = sorted(pivots[-40:], key=lambda p: p.price)
    zones: list[Zone] = []
    cluster: list[Pivot] = []
    for p in pts:
        if cluster and p.price - cluster[0].price > tol:
            if len(cluster) >= 2:
                lo, hi = min(x.price for x in cluster), max(x.price for x in cluster)
                zones.append(Zone(lo, hi, len(cluster), "support" if hi < price else "resistance"))
            cluster = []
        cluster.append(p)
    if len(cluster) >= 2:
        lo, hi = min(x.price for x in cluster), max(x.price for x in cluster)
        zones.append(Zone(lo, hi, len(cluster), "support" if hi < price else "resistance"))
    return zones


def analyze_structure(o, h, l, c, left: int = 3, right: int = 3, sweep_lookback: int = 30,
                      eq_tol_atr: float = 0.1, fvg_min_atr: float = 0.25, disp_atr: float = 1.5,
                      zone_atr: float = 0.5, retest_window: int = 12,
                      retest_tol_atr: float = 0.25) -> StructureState:
    o, h, l, c = (np.asarray(x, float) for x in (o, h, l, c))
    n = len(c)
    a_arr = _atr(h, l, c, 14)
    a = float(a_arr[-1]) if n and not np.isnan(a_arr[-1]) else float("nan")
    t = n - 1
    pivots = [p for p in find_pivots(h, l, left, right) if p.confirmed_at <= t]
    highs = [p for p in pivots if p.kind == "H"]
    lows = [p for p in pivots if p.kind == "L"]
    state = StructureState("range", highs, lows, None, None, None, None, [], [], [], [], [],
                           None, None, a)
    if n < 30 or np.isnan(a):
        state.notes.append("insufficient history")
        return state

    # trend from pivots confirmed *before* the evaluation bar, so a break on this bar
    # is judged against the structure that existed when it happened.
    hp = [p for p in highs if p.confirmed_at < t]
    lp = [p for p in lows if p.confirmed_at < t]
    trend = classify_trend(hp, lp)
    state.trend = trend
    if hp and c[t] > hp[-1].price >= c[t - 1]:
        state.bos = "bull" if trend == "bullish" else None
        state.choch = "bull" if trend == "bearish" else None
        if trend == "range":
            state.bos = "bull"
    if lp and c[t] < lp[-1].price <= c[t - 1]:
        state.bos = "bear" if trend == "bearish" else state.bos
        state.choch = "bear" if trend == "bullish" else state.choch
        if trend == "range":
            state.bos = "bear"

    # liquidity sweeps on the evaluation bar
    recent_lows = [p for p in lp if t - p.index <= sweep_lookback]
    recent_highs = [p for p in hp if t - p.index <= sweep_lookback]
    swept_l = [p.price for p in recent_lows if l[t] < p.price < c[t]]
    swept_h = [p.price for p in recent_highs if h[t] > p.price > c[t]]
    if swept_l and not swept_h:
        state.sweep, state.sweep_level = "bull", min(swept_l)
    elif swept_h and not swept_l:
        state.sweep, state.sweep_level = "bear", max(swept_h)

    state.equal_highs = _equal_levels(hp, eq_tol_atr * a)
    state.equal_lows = _equal_levels(lp, eq_tol_atr * a)
    state.open_fvgs = _fvgs(h, l, a, fvg_min_atr)
    state.order_blocks = _order_blocks(o, h, l, c, pivots, a, disp_atr)
    state.sr_zones = _sr_zones(pivots, zone_atr * a, float(c[t]))

    # breakout-retest relative to pivot levels broken within retest_window bars
    for p in reversed(hp[-5:]):
        brk = [k for k in range(max(p.confirmed_at + 1, t - retest_window), t) if c[k] > p.price >= c[k - 1]]
        if brk and l[t] <= p.price + retest_tol_atr * a and c[t] > p.price and c[brk[0]:t].min() > p.price - a:
            state.retest, state.retest_level = "bull", p.price
            break
    if state.retest is None:
        for p in reversed(lp[-5:]):
            brk = [k for k in range(max(p.confirmed_at + 1, t - retest_window), t) if c[k] < p.price <= c[k - 1]]
            if brk and h[t] >= p.price - retest_tol_atr * a and c[t] < p.price and c[brk[0]:t].max() < p.price + a:
                state.retest, state.retest_level = "bear", p.price
                break
    return state
