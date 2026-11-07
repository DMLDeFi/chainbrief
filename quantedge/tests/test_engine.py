"""Live engine wiring with a fake exchange (no network)."""
import time

import pytest

from quantedge.analysis.features import INTERVAL_MS, Series, resample
from quantedge.backtest.synthetic import make_instrument, regime_walk
from quantedge.db.repo import Repo
from quantedge.engine import Engine
from quantedge.models import Candle, MarketSnapshot, OrderBook
from quantedge.notify.service import NotificationService

from conftest import make_signal
from test_notify import FakeChannel


class FakeRest:
    healthy = True

    def __init__(self):
        now = int(time.time() * 1000) // 300_000 * 300_000
        start = now - 288 * 70 * 300_000
        start -= start % 86_400_000
        self.base = Series.from_candles(regime_walk(288 * 70, 60000, start_ms=start))

    async def instruments(self):
        return [make_instrument("BTCUSDT", 60000), make_instrument("ETHUSDT", 3000)]

    async def tickers(self):
        px = float(self.base.c[-1])
        return [MarketSnapshot(s, px, px - 1, px + 1, px, px, 5e9, 1e5, 1e9, 0.0001,
                               int(time.time() * 1000) + 3_600_000, 0.01) for s in ("BTCUSDT", "ETHUSDT")]

    async def klines(self, sym, tf, limit=400, **kw):
        s = self.base if tf == "5" else resample(self.base, INTERVAL_MS[tf])
        s = s.tail(limit)
        return [Candle(int(s.t[i]), s.o[i], s.h[i], s.l[i], s.c[i], s.v[i], s.v[i] * s.c[i], s.interval_ms)
                for i in range(len(s))]

    async def orderbook(self, sym, depth=50):
        px = float(self.base.c[-1])
        return OrderBook(sym, [(px - i, 50.0) for i in range(1, 30)], [(px + i, 50.0) for i in range(1, 30)])

    async def fee_rate(self, *a, **k):
        return []


@pytest.fixture
def engine(cfg):
    repo = Repo("sqlite://")
    ch = FakeChannel()
    eng = Engine(cfg, repo, NotificationService(repo, {"telegram": (ch, ["1"])}), rest=FakeRest())
    return eng, repo, ch


@pytest.mark.asyncio
async def test_scan_bootstrap_and_evaluate(engine):
    eng, repo, _ = engine
    await eng.refresh_universe()
    await eng.refresh_tickers()
    assert "BTCUSDT" in eng.watch and len(eng.candles.series("BTCUSDT", "D")) > 60
    assert any(t.startswith("kline.15.BTCUSDT") for t in eng.ws.topics)
    await eng.evaluate("BTCUSDT", int(time.time() * 1000))
    row = eng.scanner.rows["BTCUSDT"]
    assert row.regime                       # regime classified
    # every candidate either became a signal or was recorded as a rejection
    assert eng.last_eval["BTCUSDT"] > 0     # evaluation ran on the closed-bar timestamp
    assert all(r.stage for r in repo.rejections())


@pytest.mark.asyncio
async def test_publish_monitor_close_and_notify(engine, inst):
    eng, repo, ch = engine
    s = make_signal(inst, created=int(time.time() * 1000))
    await eng.publish(s)
    assert repo.signals()[0].signal_id == s.signal_id and len(ch.sent) == 1
    assert eng.risk.state.signals_today == 1

    def quote(bid, ask):
        eng.snapshots["BTCUSDT"] = MarketSnapshot("BTCUSDT", bid, bid, ask, bid, bid, 1e9, 1, 1, 0.0001, 0, 0)
        eng.ws.tickers["BTCUSDT"] = {"bid1Price": str(bid), "ask1Price": str(ask), "markPrice": str(bid),
                                     "indexPrice": str(bid)}
        eng.ws.last_update["BTCUSDT"] = time.time()

    e, tp = s.plan.entry, s.plan.take_profit
    quote(e - 2, e - 1)
    await eng.monitor_tick()
    assert repo.signal(s.signal_id)[0].status == "FILLED"
    quote(tp + 1, tp + 2)
    await eng.monitor_tick()
    row, events = repo.signal(s.signal_id)
    assert row.status == "TAKE_PROFIT" and [e.kind for e in events][-1] == "TAKE_PROFIT"
    trades = repo.trades()
    assert len(trades) == 1 and trades[0].net_roi >= 0.0999
    assert eng.equity == pytest.approx(10_000 + trades[0].net_pnl)
    kinds = [k for _, _, k, _ in ch.sent]
    assert kinds == ["SIGNAL", "ENTRY_CONFIRMED", "TAKE_PROFIT"]
    assert repo.kv_get("risk_state")["open"] == {}


@pytest.mark.asyncio
async def test_stale_quotes_never_produce_fills(engine, inst):
    eng, repo, _ = engine
    s = make_signal(inst, created=int(time.time() * 1000))
    await eng.publish(s)
    eng.ws.tickers["BTCUSDT"] = {"bid1Price": "1", "ask1Price": "1"}
    eng.ws.last_update["BTCUSDT"] = time.time() - 600
    await eng.monitor_tick()
    assert repo.signal(s.signal_id)[0].status == "PUBLISHED"


@pytest.mark.asyncio
async def test_no_trade_report_and_admin_commands(engine):
    eng, repo, ch = engine
    await eng.send_daily_report(int(time.time() * 1000) - 86_400_000)
    assert ch.sent[0][2] == "NO_TRADE" and "NO QUALIFIED TRADE SETUPS TODAY" in ch.sent[0][1]
    assert "HALTED" in await eng.handle_command("/halt testing", "tg:1")
    assert eng.status()["halted"] is True
    assert "halt" in [a.action for a in repo.audit_log()]
    await eng.handle_command("/resume", "tg:1")
    assert eng.status()["halted"] is False
