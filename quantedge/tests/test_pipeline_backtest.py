"""End-to-end: production pipeline inside the back-tester, approval gates, validation."""
import copy

import numpy as np
import pytest

from quantedge.analysis.features import Series, build_features, resample
from quantedge.analysis.regime import classify
from quantedge.backtest.engine import Backtester, SymbolData
from quantedge.backtest.metrics import max_consecutive_losses, monte_carlo, summarize
from quantedge.backtest.synthetic import make_instrument, regime_walk
from quantedge.backtest.validation import deployment_gate
from quantedge.models import Direction, MarketSnapshot, Regime
from quantedge.monitor.tracker import TradeResult
from quantedge.risk.engine import RiskEngine
from quantedge.signals.approval import ApprovalEngine
from quantedge.signals.calibration import Calibrator
from quantedge.signals.context import Candidate, Eligibility, EvalContext

DAY = 288


@pytest.fixture(scope="module")
def data():
    syms = [("BTCUSDT", 60000), ("ETHUSDT", 3000)]
    return {s: SymbolData(make_instrument(s, p), regime_walk(DAY * 75, p, seed=i + 1, base_volume=5e7 / p / 288))
            for i, (s, p) in enumerate(syms)}


@pytest.fixture(scope="module")
def loose_run(data):
    from quantedge.config import AppConfig
    cfg = AppConfig()
    cfg.scanner.min_turnover_24h = 1e6
    cfg.trading.min_quality_score = 55.0      # loosened ONLY to exercise the trade path in tests
    return Backtester(cfg).run(data)


def test_strict_threshold_is_selective(data):
    from quantedge.config import AppConfig
    cfg = AppConfig()
    cfg.scanner.min_turnover_24h = 1e6
    res = Backtester(cfg).run(data)
    assert sum(res.rejections.values()) > 0
    assert res.signals <= sum(res.rejections.values())   # rejects far more than it accepts


def test_backtest_accounting_is_consistent(loose_run):
    res = loose_run
    assert len(res.trades) > 0, "loosened run should produce trades"
    assert res.equity_end == pytest.approx(10_000 + sum(t.net_pnl for t in res.trades))
    for t in res.trades:
        assert t.filled_qty > 0
        if t.status == "STOP_LOSS":
            assert t.r_multiple < 0
        if t.status == "TAKE_PROFIT":
            assert t.net_roi >= 0.0999
    s = res.summary
    assert s["trades"] == len(res.trades)
    assert 0 <= s["max_drawdown"] < 0.05
    # never exceeds the daily ceiling
    days = {}
    for t in res.trades:
        d = t.entry_ts // 86_400_000
        days[d] = days.get(d, 0) + 1
    assert max(days.values()) <= 2


def test_monte_carlo_and_metrics(loose_run):
    mc = monte_carlo(loose_run.trades, 10_000, runs=200)
    assert mc["final_equity_p5"] <= mc["final_equity_p50"] <= mc["final_equity_p95"]
    assert max_consecutive_losses([1, -1, -1, 2, -1, -1, -1]) == 3


def _trade(i, pnl, regime="A", sym=None):
    return TradeResult(f"s{i}", sym or f"S{i % 12}", "LONG", "trend_pullback", regime, 92, "X", 1, 1, 1,
                       i * 1000, i * 1000 + 1, pnl, pnl / 100, pnl / 25, 0, 0, 0, 1, 0, 0)


def test_deployment_gate_requires_sample_and_expectancy():
    few = [_trade(i, 40) for i in range(50)]
    assert not deployment_gate(few, 10_000).approved
    rng = np.random.default_rng(3)
    good = [_trade(i, float(40 if rng.random() < 0.5 else -25), regime=["A", "B", "C"][i % 3]) for i in range(330)]
    g = deployment_gate(good, 10_000, max_dd=0.2)
    assert g.checks["sample_size"][0] and g.checks["positive_expectancy"][0]
    high_wr_negative = [_trade(i, 5 if i % 10 else -100, regime=["A", "B", "C"][i % 3]) for i in range(330)]
    g2 = deployment_gate(high_wr_negative, 10_000, max_dd=1.0)
    assert not g2.approved and not g2.checks["positive_expectancy"][0]   # 90% win rate is not enough


def test_calibrator():
    c = Calibrator(min_samples=10, require_calibration=True)
    assert not c.assess(92).acceptable
    for _ in range(20):
        c.add(92, 1.0)
        c.add(92, -0.5)
    a = c.assess(92)
    assert a.calibrated and a.acceptable and a.mean_r == pytest.approx(0.25)
    for _ in range(40):
        c.add(95, -1.0)
        c.add(95, 0.5)
    assert not c.assess(95).acceptable


def _ctx(cfg, fresh=True, regime=None):
    base = Series.from_candles(regime_walk(DAY * 70, 100, seed=5))
    t = base.t[-1] + 300_000
    tf = {k: build_features(s.upto(t).tail(300)) for k, s in
          {"5": base, "15": resample(base, 900_000), "60": resample(base, 3_600_000),
           "240": resample(base, 14_400_000), "D": resample(base, 86_400_000)}.items()}
    px = tf["15"].close
    snap = MarketSnapshot("BTCUSDT", px, px * 0.9999, px * 1.0001, px, px, 1e9, 1e7, 1e8, 0.0001, int(t) + 3_600_000, 0.0)
    el = Eligibility(fresh, [] if fresh else ["stale market data"], 1.0, 1e6, 1e6, 1e9, 1.0, fresh)
    reg = regime or classify(tf["240"], tf["D"], tf["60"])
    return EvalContext("BTCUSDT", make_instrument("BTCUSDT", px), snap, el, tf, reg, int(t), 10_000, 10_000,
                       hourly_sigma=tf["60"].atr), tf


def test_mandatory_gate_overrides_everything(cfg):
    from quantedge.analysis.regime import RegimeResult
    ctx, tf = _ctx(cfg, fresh=False, regime=RegimeResult(Regime.STRONG_BULL, 1.0))
    eng = ApprovalEngine(cfg, RiskEngine(cfg.risk, 2))
    c = Candidate("BTCUSDT", Direction.LONG, "trend_pullback", tf["15"].close, tf["15"].close * 0.98,
                  tf["15"].close * 0.97, ["x"], "y")
    d = eng.evaluate(ctx, c)
    assert not d.approved and d.stages[-1].stage == "1_market_eligibility"


def test_no_trade_regime_rejects(cfg):
    from quantedge.analysis.regime import RegimeResult
    ctx, tf = _ctx(cfg, regime=RegimeResult(Regime.UNSTABLE, 1.0, ["test"]))
    eng = ApprovalEngine(cfg, RiskEngine(cfg.risk, 2))
    c = Candidate("BTCUSDT", Direction.LONG, "trend_pullback", tf["15"].close, tf["15"].close * 0.98,
                  tf["15"].close * 0.97, ["x"], "y")
    d = eng.evaluate(ctx, c)
    assert not d.approved and d.stages[-1].stage == "2_market_regime"


def test_backtest_does_not_mutate_config(data):
    from quantedge.config import AppConfig
    cfg = AppConfig()
    before = copy.deepcopy(cfg.costs)
    Backtester(cfg).run({"BTCUSDT": data["BTCUSDT"]}, end_ms=data["BTCUSDT"].candles_5m[0].start + 62 * 86_400_000)
    assert cfg.costs == before


def test_summary_empty():
    assert summarize([], 10_000)["trades"] == 0
