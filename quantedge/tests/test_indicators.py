import numpy as np
import pandas as pd
import pytest

from quantedge.analysis import indicators as ind
from quantedge.analysis.features import Series, build_features, resample
from quantedge.backtest.synthetic import regime_walk

rng = np.random.default_rng(0)
C = 100 * np.exp(np.cumsum(rng.normal(0, 0.01, 500)))
H = C * (1 + np.abs(rng.normal(0, 0.004, 500)))
L = C * (1 - np.abs(rng.normal(0, 0.004, 500)))
V = rng.uniform(100, 1000, 500)
T = np.arange(500) * 300_000.0


def test_sma_matches_pandas():
    np.testing.assert_allclose(ind.sma(C, 20)[19:], pd.Series(C).rolling(20).mean().values[19:])


def test_ema_recurrence_and_seed():
    e = ind.ema(C, 10)
    assert np.isnan(e[:9]).all()
    assert e[9] == pytest.approx(C[:10].mean())
    k = 2 / 11
    assert e[10] == pytest.approx(C[10] * k + e[9] * (1 - k))


def test_rsi_bounds_and_wilder():
    r = ind.rsi(C, 14)
    v = r[~np.isnan(r)]
    assert ((v >= 0) & (v <= 100)).all()
    up = ind.rsi(np.arange(1, 50, dtype=float), 14)
    assert up[-1] == 100.0


def test_bollinger_matches_pandas_population_std():
    mid, up, lo, _ = ind.bollinger(C, 20, 2)
    sd = pd.Series(C).rolling(20).std(ddof=0).values
    np.testing.assert_allclose(up[19:], mid[19:] + 2 * sd[19:])


def test_zscore_uses_only_prior_window():
    z = ind.zscore(V, 20)
    i = 100
    w = V[i - 20:i]
    assert z[i] == pytest.approx((V[i] - w.mean()) / w.std())


def test_relative_volume_excludes_current_bar():
    rv = ind.relative_volume(V, 20)
    assert rv[50] == pytest.approx(V[50] / V[30:50].mean())


def test_stoch_rsi_range():
    k, d = ind.stoch_rsi(C)
    v = k[~np.isnan(k)]
    assert len(v) > 100 and v.min() >= 0 and v.max() <= 100


@pytest.mark.parametrize("fn", [
    lambda n: ind.ema(C[:n], 21), lambda n: ind.rsi(C[:n]), lambda n: ind.macd(C[:n])[2],
    lambda n: ind.atr(H[:n], L[:n], C[:n]), lambda n: ind.adx(H[:n], L[:n], C[:n])[0],
    lambda n: ind.bollinger(C[:n])[1], lambda n: ind.stoch_rsi(C[:n])[0],
    lambda n: ind.vwap(H[:n], L[:n], C[:n], V[:n], T[:n]), lambda n: ind.zscore(V[:n]),
])
def test_no_lookahead(fn):
    """Values on a truncated series equal the prefix of the full series."""
    full = fn(500)
    for n in (120, 250, 499):
        part = fn(n)
        np.testing.assert_allclose(part, full[:n], equal_nan=True)


def test_resample_drops_incomplete_and_upto_is_causal():
    base = Series.from_candles(regime_walk(1000, 100))
    h1 = resample(base, 3_600_000)
    assert len(h1) == 1000 // 12
    assert h1.h[0] == base.h[:12].max() and h1.c[0] == base.c[11]
    t = base.t[0] + 3_600_000 * 5 + 300_000 * 3      # 3 bars into the 6th hour
    assert len(h1.upto(t)) == 5                      # partial hour is invisible


def test_features_not_affected_by_future_bars():
    base = Series.from_candles(regime_walk(3000, 100))
    t = base.t[2000] + 300_000
    f_a = build_features(base.upto(t).tail(300))
    longer = Series.from_candles(regime_walk(3000, 100))  # same seed: identical history
    f_b = build_features(longer.upto(t).tail(300))
    assert f_a.close == f_b.close == base.c[2000]
    assert f_a.rsi == f_b.rsi and f_a.structure.trend == f_b.structure.trend
