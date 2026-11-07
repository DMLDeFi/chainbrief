import pytest

from quantedge.config import CostConfig, RiskConfig
from quantedge.models import Direction
from quantedge.risk.roi import (PlanRejected, funding_intervals, liquidation_price, pnl, round_to_step,
                                solve_take_profit)

from conftest import make_plan


@pytest.mark.parametrize("d", [Direction.LONG, Direction.SHORT])
def test_net_roi_meets_target_after_costs(inst, d):
    p = make_plan(inst, d)
    assert p.net_roi >= 0.10
    # rounding to one tick is the only slack: one tick less must fall short
    c = CostConfig()
    one_tick_worse = p.take_profit - d.sign * inst.tick_size
    worse = pnl(d, p.qty, p.entry, one_tick_worse, 2.5, c.taker_fee, c.taker_fee, c.entry_slippage,
                c.exit_slippage, p.funding_cost)
    assert worse.roi < 0.10


def test_solver_inverts_pnl_exactly():
    for d in Direction:
        tp = solve_take_profit(d, 50.0, 2.5, 0.10, 0.00055, 0.00055, 0.0005, 0.0005, 0.01)
        r = pnl(d, 1.0, 50.0, tp, 2.5, 0.00055, 0.00055, 0.0005, 0.0005, 0.01)
        assert r.roi == pytest.approx(0.10, abs=1e-12)


def test_not_a_naive_four_percent(inst):
    p = make_plan(inst, Direction.LONG)
    move = p.take_profit / p.entry - 1
    assert move > 0.04          # fees, slippage and funding push it beyond 10%/2.5x


def test_funding_raises_long_target_but_not_credited_for_short(inst):
    base = make_plan(inst, Direction.LONG, funding_rate=0.0)
    paid = make_plan(inst, Direction.LONG, funding_rate=0.0004)
    assert paid.take_profit > base.take_profit and paid.funding_cost > 0
    s0 = make_plan(inst, Direction.SHORT, funding_rate=0.0)
    s_recv = make_plan(inst, Direction.SHORT, funding_rate=0.0004)   # short receives: not credited
    assert s_recv.take_profit == s0.take_profit


def test_risk_at_stop_within_budget_and_sized_from_stop(inst):
    p = make_plan(inst, Direction.LONG)
    assert p.max_loss <= 10_000 * 0.0025 + 1e-9
    assert p.account_risk_pct <= 0.0025
    tight = make_plan(inst, Direction.LONG, stop=98_500.0)
    assert tight.qty > p.qty    # tighter stop -> larger position for the same risk


def test_rejects_wide_stop_and_wrong_side(inst):
    with pytest.raises(PlanRejected):
        make_plan(inst, Direction.LONG, stop=90_000.0)
    with pytest.raises(PlanRejected):
        make_plan(inst, Direction.LONG, stop=101_000.0)


def test_rejects_slow_targets(inst):
    with pytest.raises(PlanRejected, match="holding period"):
        make_plan(inst, Direction.LONG, hourly_sigma=10.0)


def test_rejects_poor_reward_risk(inst):
    with pytest.raises(PlanRejected):
        make_plan(inst, Direction.LONG, stop=96_500.0, risk=RiskConfig(min_reward_risk=1.5))


def test_margin_cap(inst):
    p = make_plan(inst, Direction.LONG, available_margin=100.0)
    assert p.margin <= 100.0


def test_leverage_limit(inst):
    with pytest.raises(PlanRejected):
        make_plan(inst, Direction.LONG, leverage=5.0)


def test_liquidation_and_helpers():
    assert liquidation_price(Direction.LONG, 100, 2.5, 0.005) == pytest.approx(60.5)
    assert liquidation_price(Direction.SHORT, 100, 2.5, 0.005) == pytest.approx(139.5)
    assert funding_intervals(0, 0, 3_600_000, 8) == 0
    assert funding_intervals(2, 0, 3_600_000, 8) == 1
    assert funding_intervals(20, 0, 3_600_000, 8) == 3
    assert round_to_step(1.23456, 0.01, "up") == 1.24
    assert round_to_step(1.23456, 0.01, "down") == 1.23
