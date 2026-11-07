import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from quantedge.config import AppConfig, CostConfig, RiskConfig  # noqa: E402
from quantedge.models import (Direction, Instrument, Regime, Signal, TradePlan)  # noqa: E402
from quantedge.risk.roi import build_plan  # noqa: E402


@pytest.fixture
def inst():
    return Instrument("BTCUSDT", "BTC", "USDT", "Trading", "LinearPerpetual", 0, 0.1, 0.001, 0.001, 100.0)


def make_plan(inst, direction=Direction.LONG, entry=100_000.0, stop=None, **kw) -> TradePlan:
    stop = stop or (entry * 0.98 if direction is Direction.LONG else entry * 1.02)
    args = dict(equity=10_000, available_margin=10_000, leverage=2.5, target_roi=0.10, funding_rate=0.0001,
                next_funding_ms=3_600_000, now_ms=0, hourly_sigma=entry * 0.01, instrument=inst,
                costs=CostConfig(), risk=RiskConfig())
    args.update(kw)
    return build_plan(direction, entry, stop, **args)


def make_signal(inst, direction=Direction.LONG, created=0, expires=10**13, **kw) -> Signal:
    plan = make_plan(inst, direction, **kw)
    zone = (plan.entry * 0.999, plan.entry) if direction is Direction.LONG else (plan.entry, plan.entry * 1.001)
    inval = plan.stop * (1.005 if direction is Direction.LONG else 0.995)
    return Signal(inst.symbol, direction, "trend_pullback", plan, zone, 92.0, {"structure": 90}, Regime.STRONG_BULL,
                  "4/4", "RVOL 1.5x", "spread 1bp", "test rationale", "test invalidation", inval, created, expires)


@pytest.fixture
def cfg():
    return AppConfig(auth_secret="x" * 32)
