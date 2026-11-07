import numpy as np

from quantedge.analysis.structure import analyze_structure, classify_trend, find_pivots


def zigzag(points, steps=6):
    xs = []
    for a, b in zip(points[:-1], points[1:]):
        xs.extend(np.linspace(a, b, steps, endpoint=False))
    xs.append(points[-1])
    c = np.array(xs, float)
    return c.copy(), c + 0.05, c - 0.05, c


def test_pivots_require_right_side_confirmation():
    o, h, l, c = zigzag([10, 12, 11, 13, 12, 14])
    piv = find_pivots(h, l, 3, 3)
    for p in piv:
        assert p.confirmed_at == p.index + 3
    # the last high (at the end) cannot be confirmed yet
    assert all(p.index < len(h) - 3 for p in piv)


def test_uptrend_is_bullish():
    o, h, l, c = zigzag([10, 12, 11, 13, 12, 14, 13, 15, 14, 16, 15, 17])
    highs = [p for p in find_pivots(h, l) if p.kind == "H"]
    lows = [p for p in find_pivots(h, l) if p.kind == "L"]
    assert classify_trend(highs, lows) == "bullish"


def test_downtrend_is_bearish_and_bos():
    o, h, l, c = zigzag([20, 18, 19, 17, 18, 16, 17, 15, 16, 14, 15])
    # final bar closes below the last confirmed swing low -> bearish BOS
    c2 = np.append(c, c[-1] - 3)
    h2 = np.append(h, c[-1] + 0.05)
    l2 = np.append(l, c2[-1] - 0.05)
    o2 = np.append(o, c[-1])
    st = analyze_structure(o2, h2, l2, c2)
    assert st.trend == "bearish"
    assert st.bos == "bear"


def test_liquidity_sweep_bull():
    o, h, l, c = zigzag([20, 18, 19, 17, 18, 16, 17, 18, 17.5, 18.5, 17.8, 18.2])
    t = len(c)
    recent = [p.price for p in find_pivots(h, l) if p.kind == "L" and t - p.index <= 30]
    last_low = recent[-1]
    o2 = np.append(o, 18.0)
    l2 = np.append(l, last_low - 0.3)    # wick below the swing low ...
    c2 = np.append(c, last_low + 0.5)    # ... close back above it
    h2 = np.append(h, 18.1)
    st = analyze_structure(o2, h2, l2, c2)
    expected = min(x for x in recent if l2[-1] < x < c2[-1])
    assert st.sweep == "bull" and abs(st.sweep_level - expected) < 1e-9
    # an old (out-of-lookback) low is never counted as swept
    assert st.sweep_level > 16.5


def test_fair_value_gap_detected_and_filled():
    o, h, l, c = zigzag([10, 10.5, 10.2, 10.6, 10.3, 10.7], steps=8)
    o = np.append(o, [10.7, 10.8, 12.0]); h = np.append(h, [10.8, 12.0, 12.5])
    l = np.append(l, [10.6, 10.8, 11.9]); c = np.append(c, [10.8, 11.9, 12.4])
    st = analyze_structure(o, h, l, c, fvg_min_atr=0.1)
    assert any(z.kind == "fvg_bull" for z in st.open_fvgs)
    o2 = np.append(o, 12.0); h2 = np.append(h, 12.1); l2 = np.append(l, 10.5); c2 = np.append(c, 11.0)
    st2 = analyze_structure(o2, h2, l2, c2, fvg_min_atr=0.1)
    assert not any(z.kind == "fvg_bull" and z.index == len(c) - 1 for z in st2.open_fvgs)
