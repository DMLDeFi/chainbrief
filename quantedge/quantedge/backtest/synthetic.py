"""Synthetic regime-switching market data for tests and offline demos.

This is NOT a substitute for historical Bybit data: results on synthetic data
say nothing about real-world expectancy.  It exists so the full pipeline can be
exercised deterministically without network access.
"""
from __future__ import annotations

import numpy as np

from ..models import Candle, Instrument

M5 = 300_000


def make_instrument(symbol: str, price: float) -> Instrument:
    tick = 10 ** np.floor(np.log10(price) - 4)
    return Instrument(symbol, symbol.replace("USDT", ""), "USDT", "Trading", "LinearPerpetual", 0,
                      float(tick), 0.001 if price > 1000 else 0.1 if price > 1 else 10.0, 0.001, 50.0)


def regime_walk(n_bars: int, start_price: float = 100.0, seed: int = 1, start_ms: int = 1_699_920_000_000,
                regimes: list[tuple[int, float, float]] | None = None, base_volume: float = 5_000.0) -> list[Candle]:
    """``regimes`` is a list of (bars, drift_per_bar, vol_per_bar) segments, cycled."""
    rng = np.random.default_rng(seed)
    regimes = regimes or [(3000, 0.00012, 0.0025), (2000, 0.0, 0.002), (3000, -0.00012, 0.0028), (1500, 0.0, 0.004)]
    drift = np.empty(n_bars)
    vol = np.empty(n_bars)
    i = 0
    while i < n_bars:
        for bars, mu, sd in regimes:
            j = min(n_bars, i + bars)
            drift[i:j], vol[i:j] = mu, sd
            i = j
            if i >= n_bars:
                break
    # mean-reverting AR(1) component gives pullbacks inside trends
    ar = np.zeros(n_bars)
    eps = rng.standard_normal(n_bars)
    for k in range(1, n_bars):
        ar[k] = 0.97 * ar[k - 1] + eps[k]
    rets = drift + vol * (0.6 * eps + 0.4 * np.diff(ar, prepend=0.0))
    close = start_price * np.exp(np.cumsum(rets))
    open_ = np.concatenate([[start_price], close[:-1]])
    wick = np.abs(rng.standard_normal((2, n_bars))) * vol * close * 0.6
    high = np.maximum(open_, close) + wick[0]
    low = np.minimum(open_, close) - wick[1]
    volume = base_volume * np.exp(0.4 * rng.standard_normal(n_bars)) * (1 + 40 * np.abs(rets))
    return [Candle(start_ms + k * M5, float(open_[k]), float(high[k]), float(low[k]), float(close[k]),
                   float(volume[k]), float(volume[k] * close[k]), M5) for k in range(n_bars)]
