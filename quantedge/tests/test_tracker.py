import pytest

from quantedge.config import CostConfig
from quantedge.models import Direction, SignalStatus
from quantedge.monitor.tracker import TradeTracker

from conftest import make_signal

M = 300_000


def setup(inst, d=Direction.LONG, **kw):
    tr = TradeTracker(CostConfig(), participation=1.0)
    s = make_signal(inst, d, **kw)
    t = tr.add(s, 0)
    return tr, s, t


def test_touch_is_not_a_fill(inst):
    tr, s, t = setup(inst)
    e = s.plan.entry
    tr.on_bar("BTCUSDT", M, e + 50, e + 100, e, e + 50, 10)          # low == entry: touch only
    assert t.filled_qty == 0 and t.status is SignalStatus.ENTRY_ZONE_REACHED
    tr.on_bar("BTCUSDT", 2 * M, e + 50, e + 100, e - 1, e + 50, 10)  # trades through
    assert t.status is SignalStatus.FILLED


def test_take_profit_requires_trade_through(inst):
    tr, s, t = setup(inst)
    e, tp = s.plan.entry, s.plan.take_profit
    tr.on_bar("BTCUSDT", M, e, e + 10, e - 1, e, 10)
    tr.on_bar("BTCUSDT", 2 * M, e, tp, e, tp, 10)                     # high == tp: not through
    assert t.status is SignalStatus.FILLED
    tr.on_bar("BTCUSDT", 3 * M, tp, tp + 1, tp - 5, tp, 10)
    assert t.status is SignalStatus.TAKE_PROFIT
    assert t.result.net_roi >= 0.0999


def test_gap_through_stop_fills_at_open(inst):
    tr, s, t = setup(inst)
    e, sl = s.plan.entry, s.plan.stop
    tr.on_bar("BTCUSDT", M, e, e + 10, e - 1, e, 10)
    gap_open = sl - 500
    tr.on_bar("BTCUSDT", 2 * M, gap_open, gap_open + 10, gap_open - 10, gap_open, 10)
    assert t.status is SignalStatus.STOP_LOSS and t.result.exit_price == gap_open
    assert t.result.r_multiple < -1.0


def test_same_bar_tp_and_sl_assumes_stop(inst):
    tr, s, t = setup(inst)
    e = s.plan.entry
    tr.on_bar("BTCUSDT", M, e, e + 10, e - 1, e, 10)
    tr.on_bar("BTCUSDT", 2 * M, e, s.plan.take_profit + 10, s.plan.stop - 10, e, 10)
    assert t.status is SignalStatus.STOP_LOSS


def test_fill_bar_cannot_take_profit(inst):
    tr, s, t = setup(inst)
    e = s.plan.entry
    tr.on_bar("BTCUSDT", M, e, s.plan.take_profit + 100, e - 1, e, 10)
    assert t.status is SignalStatus.FILLED


def test_unfilled_signal_expires_without_result(inst):
    tr, s, t = setup(inst, expires=5 * M)
    e = s.plan.entry
    for k in range(1, 7):
        tr.on_bar("BTCUSDT", k * M, e + 100, e + 200, e + 50, e + 100, 10)
    assert t.status is SignalStatus.EXPIRED and t.result is None


def test_invalidation_before_fill(inst):
    tr, s, t = setup(inst)
    px = s.invalidation_price - 1
    tr.on_bar("BTCUSDT", M, s.plan.entry + 10, s.plan.entry + 20, s.plan.entry + 5, px, 10)
    # close below invalidation without trading through entry? low is above entry, so no fill
    assert t.status is SignalStatus.INVALIDATED


def test_partial_fill_and_top_up(inst):
    tr = TradeTracker(CostConfig(), participation=0.5)
    s = make_signal(inst)
    t = tr.add(s, 0)
    e = s.plan.entry
    vol = s.plan.qty                      # participation 0.5 caps the fill at half the planned qty
    tr.on_bar("BTCUSDT", M, e, e + 10, e - 1, e, vol)
    assert t.status is SignalStatus.PARTIALLY_FILLED and t.filled_qty == pytest.approx(s.plan.qty / 2)
    tr.on_bar("BTCUSDT", 2 * M, e, e + 10, e - 1, e, vol * 4)
    assert t.status is SignalStatus.FILLED


def test_quote_path_uses_bid_ask(inst):
    tr, s, t = setup(inst)
    e = s.plan.entry
    tr.on_quote("BTCUSDT", M, e - 2, e)          # ask == entry: no fill
    assert t.filled_qty == 0
    tr.on_quote("BTCUSDT", 2 * M, e - 3, e - 1)  # ask below entry: fill
    assert t.status is SignalStatus.FILLED


def test_funding_accrues_for_long(inst):
    tr, s, t = setup(inst)
    e = s.plan.entry
    tr.on_bar("BTCUSDT", M, e, e + 10, e - 1, e, 10)
    tr.on_bar("BTCUSDT", 8 * 3_600_000 + M, e, e + 10, e - 0.5, e, 10, funding_rate=0.0001)
    assert t.funding_paid == pytest.approx(0.0001 * t.filled_qty * e)


def test_short_lifecycle(inst):
    tr, s, t = setup(inst, Direction.SHORT)
    e = s.plan.entry
    tr.on_bar("BTCUSDT", M, e, e + 1, e - 10, e, 10)
    assert t.status is SignalStatus.FILLED
    tp = s.plan.take_profit
    tr.on_bar("BTCUSDT", 2 * M, e, e, tp - 1, tp, 10)
    assert t.status is SignalStatus.TAKE_PROFIT and t.result.net_pnl > 0
