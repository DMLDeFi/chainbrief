import numpy as np

from quantedge.config import RiskConfig
from quantedge.models import Direction
from quantedge.risk.engine import RiskEngine

DAY0 = 1_700_000_000.0


def eng():
    return RiskEngine(RiskConfig(), max_daily_signals=2)


def test_daily_loss_limit_halts():
    r = eng()
    assert r.check("A", Direction.LONG, 10_000, funding_rate=0, now=DAY0).allowed
    r.register_open("s1", "A", Direction.LONG, 1000, 25, now=DAY0)
    alerts = r.record_close("s1", -80.0)
    assert "DAILY_LOSS_LIMIT" in alerts
    d = r.check("B", Direction.LONG, 9_920, funding_rate=0, now=DAY0 + 10)
    assert not d.allowed and any("halted" in x or "daily loss" in x for x in d.reasons)


def test_daily_halt_clears_next_day_but_emergency_does_not():
    r = eng()
    r.roll(10_000, DAY0)
    r.register_open("s1", "A", Direction.LONG, 1000, 25, now=DAY0)
    r.record_close("s1", -80.0)
    assert r.check("B", Direction.LONG, 9_920, funding_rate=0, now=DAY0 + 86_400).allowed
    r.emergency_halt("test")
    assert not r.check("B", Direction.LONG, 9_920, funding_rate=0, now=DAY0 + 2 * 86_400).allowed
    r.resume()
    assert r.check("B", Direction.LONG, 9_920, funding_rate=0, now=DAY0 + 2 * 86_400).allowed


def test_signal_ceiling_positions_duplicates():
    r = eng()
    r.register_open("s1", "A", Direction.LONG, 1000, 25, "x", now=DAY0)
    assert not r.check("A", Direction.LONG, 10_000, funding_rate=0, now=DAY0, strategy="x").allowed  # same symbol
    r.register_open("s2", "B", Direction.LONG, 1000, 25, now=DAY0)
    d = r.check("C", Direction.SHORT, 10_000, funding_rate=0, now=DAY0)
    assert not d.allowed and any("ceiling" in x for x in d.reasons) and any("max open" in x for x in d.reasons)
    r.release("s1"); r.release("s2")
    assert any("duplicate" in x for x in r.check("A", Direction.LONG, 10_000, funding_rate=0, now=DAY0 + 60,
                                                strategy="x").reasons)


def test_consecutive_loss_lockout():
    r = RiskEngine(RiskConfig(max_daily_loss=1.0), max_daily_signals=10)
    for i in range(3):
        r.register_open(f"s{i}", f"S{i}", Direction.LONG, 100, 1, now=DAY0)
        alerts = r.record_close(f"s{i}", -1.0)
    assert "CONSECUTIVE_LOSS_LOCKOUT" in alerts
    assert not r.check("Z", Direction.LONG, 10_000, funding_rate=0, now=DAY0).allowed


def test_funding_and_correlation():
    r = eng()
    assert not r.check("A", Direction.LONG, 10_000, funding_rate=0.002, now=DAY0).allowed
    x = np.exp(np.cumsum(np.random.default_rng(1).normal(0, 0.01, 200)))
    r.register_open("s1", "A", Direction.LONG, 1000, 25, now=DAY0)
    d = r.check("B", Direction.LONG, 10_000, funding_rate=0, closes={"A": x, "B": x * 1.01}, now=DAY0)
    assert any("correlated" in s for s in d.reasons)


def test_snapshot_roundtrip():
    r = eng()
    r.register_open("s1", "A", Direction.SHORT, 1000, 25, now=DAY0)
    r2 = eng()
    r2.restore(r.snapshot())
    assert r2.state.open["s1"].direction is Direction.SHORT


def test_remaining_budget_scales_risk():
    r = RiskEngine(RiskConfig(max_open_positions=5), max_daily_signals=10)
    r.roll(10_000, DAY0)
    r.register_open("s1", "A", Direction.LONG, 1000, 25, now=DAY0)
    r.register_open("s2", "B", Direction.LONG, 1000, 25, now=DAY0)
    d = r.check("C", Direction.LONG, 10_000, funding_rate=0, now=DAY0)
    assert d.risk_fraction <= 0.0025 + 1e-12
