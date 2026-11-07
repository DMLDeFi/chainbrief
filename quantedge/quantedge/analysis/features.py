"""Per-timeframe feature extraction: indicators, momentum and volume intelligence.

``Series`` holds closed candles only.  ``build_features`` evaluates the final
closed bar.  ``MultiTimeframe`` aligns higher timeframes so that a higher-TF bar
is only visible once its close time is <= the evaluation time (no look-ahead).
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from ..models import Candle
from . import indicators as ind
from .structure import StructureState, analyze_structure

INTERVAL_MS = {"1": 60_000, "3": 180_000, "5": 300_000, "15": 900_000, "30": 1_800_000,
               "60": 3_600_000, "120": 7_200_000, "240": 14_400_000, "D": 86_400_000}


@dataclass
class Series:
    o: np.ndarray
    h: np.ndarray
    l: np.ndarray
    c: np.ndarray
    v: np.ndarray
    t: np.ndarray       # open time ms
    interval_ms: int

    @classmethod
    def from_candles(cls, candles: list[Candle]) -> "Series":
        cs = [k for k in candles if k.confirmed]
        if not cs:
            z = np.array([], float)
            return cls(z, z, z, z, z, z, candles[0].interval_ms if candles else 0)
        return cls(np.array([k.open for k in cs]), np.array([k.high for k in cs]),
                   np.array([k.low for k in cs]), np.array([k.close for k in cs]),
                   np.array([k.volume for k in cs]), np.array([k.start for k in cs], float),
                   cs[0].interval_ms)

    def __len__(self) -> int:
        return len(self.c)

    def upto(self, end_ms: float) -> "Series":
        """Bars whose *close* time is <= end_ms."""
        k = int(np.searchsorted(self.t + self.interval_ms, end_ms, side="right"))
        return Series(self.o[:k], self.h[:k], self.l[:k], self.c[:k], self.v[:k], self.t[:k], self.interval_ms)

    def tail(self, n: int) -> "Series":
        return Series(self.o[-n:], self.h[-n:], self.l[-n:], self.c[-n:], self.v[-n:], self.t[-n:], self.interval_ms)


def resample(base: Series, target_ms: int) -> Series:
    """Aggregate base bars into ``target_ms`` bars; incomplete final buckets are dropped."""
    if len(base) == 0:
        return base
    ratio = target_ms // base.interval_ms
    bucket = (base.t // target_ms).astype(np.int64)
    o, h, l, c, v, t = [], [], [], [], [], []
    start = 0
    for i in range(1, len(base) + 1):
        if i == len(base) or bucket[i] != bucket[start]:
            if i - start == ratio:
                o.append(base.o[start]); h.append(base.h[start:i].max()); l.append(base.l[start:i].min())
                c.append(base.c[i - 1]); v.append(base.v[start:i].sum()); t.append(bucket[start] * target_ms)
            start = i
    return Series(*(np.array(x, float) for x in (o, h, l, c, v, t)), target_ms)


@dataclass
class Features:
    close: float
    ema: dict[int, float]
    rsi: float
    rsi_prev: float
    macd: float
    macd_signal: float
    macd_hist: float
    macd_hist_prev: float
    atr: float
    atr_pct: float
    adx: float
    plus_di: float
    minus_di: float
    bb_width: float
    bb_width_pctile: float      # percentile of current width vs last 120 bars
    bb_upper: float
    bb_lower: float
    stoch_k: float
    stoch_d: float
    vwap: float
    rvol: float
    vol_accel: float            # mean(rvol last 3) / mean(rvol prior 10)
    vol_z: float
    atr_ratio: float            # ATR / ATR 50 bars ago (volatility expansion > 1)
    bull_div: bool
    bear_div: bool
    pv_divergence: bool         # price new extreme on falling volume
    exhaustion_long: bool
    exhaustion_short: bool
    failed_breakout_up: bool
    failed_breakout_down: bool
    structure: StructureState
    profile: dict = field(default_factory=dict)
    bars: int = 0
    bar_high: float = float("nan")
    bar_low: float = float("nan")
    bar_open: float = float("nan")
    low3: float = float("nan")
    high3: float = float("nan")

    @property
    def ema_stack(self) -> str:
        e = [self.ema.get(k) for k in (9, 21, 50, 100, 200)]
        if any(x is None or np.isnan(x) for x in e):
            return "unknown"
        if all(e[i] > e[i + 1] for i in range(4)):
            return "bull"
        if all(e[i] < e[i + 1] for i in range(4)):
            return "bear"
        return "mixed"


def _last(a) -> float:
    return float(a[-1]) if len(a) else float("nan")


def _divergence(c: np.ndarray, r: np.ndarray, lookback: int = 30) -> tuple[bool, bool]:
    """Regular divergence between the last two confirmed price pivots (right=2)."""
    if len(c) < lookback + 5:
        return False, False
    w, rw = c[-lookback:], r[-lookback:]
    lows = [i for i in range(2, len(w) - 2) if w[i] == w[i - 2:i + 3].min()]
    highs = [i for i in range(2, len(w) - 2) if w[i] == w[i - 2:i + 3].max()]
    bull = len(lows) >= 2 and w[lows[-1]] < w[lows[-2]] and rw[lows[-1]] > rw[lows[-2]] + 2
    bear = len(highs) >= 2 and w[highs[-1]] > w[highs[-2]] and rw[highs[-1]] < rw[highs[-2]] - 2
    return bool(bull), bool(bear)


def build_features(s: Series) -> Features | None:
    n = len(s)
    if n < 60:
        return None
    c = s.c
    emas = {k: _last(ind.ema(c, k)) for k in (9, 21, 50, 100, 200)}
    r = ind.rsi(c, 14)
    m, ms, mh = ind.macd(c)
    a = ind.atr(s.h, s.l, c, 14)
    ax, pdi, mdi = ind.adx(s.h, s.l, c, 14)
    _, bu, bl, bw = ind.bollinger(c, 20, 2.0)
    sk, sd = ind.stoch_rsi(c)
    vw = ind.vwap(s.h, s.l, c, s.v, s.t)
    rv = ind.relative_volume(s.v, 20)
    vz = ind.zscore(s.v, 20)
    bw_hist = bw[-120:][~np.isnan(bw[-120:])]
    pct = float((bw_hist < bw[-1]).mean()) if len(bw_hist) > 10 else float("nan")
    rv_valid = np.nan_to_num(rv, nan=1.0)
    accel = rv_valid[-3:].mean() / max(rv_valid[-13:-3].mean(), 1e-9)
    atr_ratio = float(a[-1] / a[-51]) if n > 70 and a[-51] > 0 else float("nan")
    bull_div, bear_div = _divergence(c, np.nan_to_num(r, nan=50.0))

    hi20, lo20 = s.h[-21:-1].max(), s.l[-21:-1].min()
    pv_div = bool((c[-1] >= c[-20:].max() or c[-1] <= c[-20:].min()) and s.v[-5:].mean() < s.v[-20:-5].mean() * 0.7)
    exh_long = bool(r[-1] > 75 and a[-1] > 0 and (c[-1] - emas[21]) / a[-1] > 3)
    exh_short = bool(r[-1] < 25 and a[-1] > 0 and (emas[21] - c[-1]) / a[-1] > 3)
    failed_up = bool(s.h[-2] > hi20 and c[-1] < hi20 or (s.h[-1] > hi20 and c[-1] < hi20))
    failed_dn = bool(s.l[-2] < lo20 and c[-1] > lo20 or (s.l[-1] < lo20 and c[-1] > lo20))

    st = analyze_structure(s.o, s.h, s.l, c)
    return Features(
        close=float(c[-1]), ema=emas, rsi=_last(r), rsi_prev=float(r[-2]), macd=_last(m),
        macd_signal=_last(ms), macd_hist=_last(mh), macd_hist_prev=float(mh[-2]),
        atr=_last(a), atr_pct=_last(a) / float(c[-1]), adx=_last(ax), plus_di=_last(pdi),
        minus_di=_last(mdi), bb_width=_last(bw), bb_width_pctile=pct, bb_upper=_last(bu),
        bb_lower=_last(bl), stoch_k=_last(sk), stoch_d=_last(sd), vwap=_last(vw),
        rvol=float(rv_valid[-1]), vol_accel=float(accel), vol_z=float(np.nan_to_num(vz[-1])),
        atr_ratio=atr_ratio, bull_div=bull_div, bear_div=bear_div, pv_divergence=pv_div,
        exhaustion_long=exh_long, exhaustion_short=exh_short, failed_breakout_up=failed_up,
        failed_breakout_down=failed_dn, structure=st,
        profile=ind.volume_profile(c[-200:], s.v[-200:]), bars=n,
        bar_high=float(s.h[-1]), bar_low=float(s.l[-1]), bar_open=float(s.o[-1]),
        low3=float(s.l[-3:].min()), high3=float(s.h[-3:].max()),
    )


class MultiTimeframe:
    """Holds base 5m bars plus native higher-TF series and evaluates them causally."""

    def __init__(self, series: dict[str, Series]):
        self.series = series

    def features_at(self, end_ms: float, lookback: int = 400) -> dict[str, Features | None]:
        out = {}
        for tf, s in self.series.items():
            sub = s.upto(end_ms)
            out[tf] = build_features(sub.tail(lookback)) if len(sub) else None
        return out
