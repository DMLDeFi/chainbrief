"""Technical indicators.

Every function is *causal*: the value at index ``i`` depends only on inputs
``[0..i]``.  ``tests/test_indicators.py`` verifies this property by recomputing
on truncated series.  Warm-up periods are returned as NaN rather than guessed.
"""
from __future__ import annotations

import numpy as np
from numpy.lib.stride_tricks import sliding_window_view as _win

Array = np.ndarray


def _as(a) -> Array:
    return np.asarray(a, dtype=float)


def sma(x, n: int) -> Array:
    x = _as(x)
    out = np.full_like(x, np.nan)
    if len(x) < n:
        return out
    c = np.cumsum(np.insert(x, 0, 0.0))
    out[n - 1:] = (c[n:] - c[:-n]) / n
    return out


def ema(x, n: int) -> Array:
    """EMA seeded with the SMA of the first ``n`` values (TradingView convention)."""
    x = _as(x)
    out = np.full_like(x, np.nan)
    if len(x) < n:
        return out
    k = 2.0 / (n + 1)
    out[n - 1] = x[:n].mean()
    for i in range(n, len(x)):
        out[i] = x[i] * k + out[i - 1] * (1 - k)
    return out


def rma(x, n: int) -> Array:
    """Wilder's smoothing, seeded with SMA; NaN inputs before the first valid are skipped."""
    x = _as(x)
    out = np.full_like(x, np.nan)
    valid = np.where(~np.isnan(x))[0]
    if len(valid) < n:
        return out
    s = valid[0]
    out[s + n - 1] = x[s:s + n].mean()
    for i in range(s + n, len(x)):
        out[i] = (out[i - 1] * (n - 1) + x[i]) / n
    return out


def rsi(close, n: int = 14) -> Array:
    c = _as(close)
    d = np.diff(c, prepend=np.nan)
    gain = np.where(d > 0, d, 0.0)
    loss = np.where(d < 0, -d, 0.0)
    gain[0] = loss[0] = np.nan
    ag, al = rma(gain, n), rma(loss, n)
    with np.errstate(divide="ignore", invalid="ignore"):
        rs = ag / al
        out = 100 - 100 / (1 + rs)
    out = np.where((al == 0) & (ag > 0), 100.0, out)
    out = np.where((al == 0) & (ag == 0), 50.0, out)
    out[np.isnan(ag)] = np.nan
    return out


def macd(close, fast: int = 12, slow: int = 26, signal: int = 9) -> tuple[Array, Array, Array]:
    c = _as(close)
    line = ema(c, fast) - ema(c, slow)
    sig = np.full_like(c, np.nan)
    valid = np.where(~np.isnan(line))[0]
    if len(valid) >= signal:
        sig_valid = ema(line[valid[0]:], signal)
        sig[valid[0]:] = sig_valid
    return line, sig, line - sig


def true_range(high, low, close) -> Array:
    h, l, c = _as(high), _as(low), _as(close)
    pc = np.roll(c, 1)
    tr = np.maximum(h - l, np.maximum(np.abs(h - pc), np.abs(l - pc)))
    tr[0] = h[0] - l[0]
    return tr


def atr(high, low, close, n: int = 14) -> Array:
    return rma(true_range(high, low, close), n)


def adx(high, low, close, n: int = 14) -> tuple[Array, Array, Array]:
    """Returns (ADX, +DI, -DI) using Wilder's method."""
    h, l = _as(high), _as(low)
    up = np.diff(h, prepend=np.nan)
    dn = -np.diff(l, prepend=np.nan)
    plus_dm = np.where((up > dn) & (up > 0), up, 0.0)
    minus_dm = np.where((dn > up) & (dn > 0), dn, 0.0)
    plus_dm[0] = minus_dm[0] = np.nan
    tr = true_range(h, l, close)
    tr[0] = np.nan
    atr_ = rma(tr, n)
    with np.errstate(divide="ignore", invalid="ignore"):
        pdi = 100 * rma(plus_dm, n) / atr_
        mdi = 100 * rma(minus_dm, n) / atr_
        dx = 100 * np.abs(pdi - mdi) / (pdi + mdi)
    dx = np.where((pdi + mdi) == 0, 0.0, dx)
    return rma(dx, n), pdi, mdi


def bollinger(close, n: int = 20, k: float = 2.0) -> tuple[Array, Array, Array, Array]:
    """Returns (mid, upper, lower, bandwidth) using population std (ddof=0)."""
    c = _as(close)
    mid = sma(c, n)
    sd = np.full_like(c, np.nan)
    if len(c) >= n:
        sd[n - 1:] = _win(c, n).std(axis=1)
    upper, lower = mid + k * sd, mid - k * sd
    with np.errstate(divide="ignore", invalid="ignore"):
        bw = (upper - lower) / mid
    return mid, upper, lower, bw


def stoch_rsi(close, rsi_n: int = 14, stoch_n: int = 14, k: int = 3, d: int = 3) -> tuple[Array, Array]:
    r = rsi(close, rsi_n)
    raw = np.full_like(r, np.nan)
    if len(r) >= stoch_n:
        w = _win(r, stoch_n)
        lo, hi = w.min(axis=1), w.max(axis=1)     # NaN-propagating: windows with NaN stay NaN
        cur = r[stoch_n - 1:]
        with np.errstate(invalid="ignore", divide="ignore"):
            val = np.where(hi == lo, 50.0, 100 * (cur - lo) / (hi - lo))
        raw[stoch_n - 1:] = np.where(np.isnan(lo) | np.isnan(hi), np.nan, val)
    kline = _nan_sma(raw, k)
    return kline, _nan_sma(kline, d)


def _nan_sma(x: Array, n: int) -> Array:
    out = np.full_like(x, np.nan)
    if len(x) >= n:
        out[n - 1:] = _win(x, n).mean(axis=1)    # NaN in window -> NaN
    return out


def vwap(high, low, close, volume, start_ms, session_ms: int = 86_400_000) -> Array:
    """Session VWAP that resets at each UTC day boundary (Bybit funding-day aligned)."""
    tp = (_as(high) + _as(low) + _as(close)) / 3
    v = _as(volume)
    sess = _as(start_ms) // session_ms
    out = np.full_like(tp, np.nan)
    pv = vv = 0.0
    for i in range(len(tp)):
        if i == 0 or sess[i] != sess[i - 1]:
            pv = vv = 0.0
        pv += tp[i] * v[i]
        vv += v[i]
        out[i] = pv / vv if vv > 0 else tp[i]
    return out


def volume_profile(close, volume, bins: int = 24) -> dict:
    """Close-based volume-at-price histogram over the supplied window.

    Without tick data this is an approximation; callers should treat it as a
    secondary feature only.  Returns POC and 70% value area.
    """
    c, v = _as(close), _as(volume)
    if len(c) < bins or v.sum() <= 0:
        return {"poc": float("nan"), "val": float("nan"), "vah": float("nan"), "reliable": False}
    hist, edges = np.histogram(c, bins=bins, weights=v)
    centers = (edges[:-1] + edges[1:]) / 2
    poc_i = int(hist.argmax())
    order = np.argsort(hist)[::-1]
    acc, chosen = 0.0, []
    for i in order:
        chosen.append(i)
        acc += hist[i]
        if acc >= 0.7 * hist.sum():
            break
    return {"poc": float(centers[poc_i]), "val": float(edges[min(chosen)]),
            "vah": float(edges[max(chosen) + 1]), "reliable": True}


def relative_volume(volume, n: int = 20) -> Array:
    """Volume divided by the mean of the *previous* n bars (excludes current bar)."""
    v = _as(volume)
    prev = np.roll(sma(v, n), 1)
    prev[0] = np.nan
    with np.errstate(divide="ignore", invalid="ignore"):
        return v / prev


def zscore(x, n: int = 20) -> Array:
    x = _as(x)
    out = np.full_like(x, np.nan)
    if len(x) > n:
        w = _win(x[:-1], n)                      # window i covers x[i : i+n], scored against x[i+n]
        m, sd = w.mean(axis=1), w.std(axis=1)
        cur = x[n:]
        with np.errstate(invalid="ignore", divide="ignore"):
            out[n:] = np.where(sd == 0, 0.0, (cur - m) / sd)
    return out
