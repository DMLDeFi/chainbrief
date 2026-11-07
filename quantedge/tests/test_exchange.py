import hashlib
import hmac
import json

import httpx
import pytest
import respx

from quantedge.exchange.bybit_rest import BybitError, BybitREST, parse_klines, parse_ticker, sign
from quantedge.exchange.bybit_ws import BybitWS
from quantedge.exchange.scanner import Scanner
from quantedge.config import ScannerConfig
from quantedge.models import Instrument, OrderBook


def test_signature_matches_bybit_spec():
    ts, key, rw, payload = "1658384314791", "XXXXXXXXXX", "5000", "category=option&symbol=BTC-29JUL22-25000-C"
    want = hmac.new(b"secret", (ts + key + rw + payload).encode(), hashlib.sha256).hexdigest()
    assert sign("secret", ts, key, rw, payload) == want


def test_parse_klines_marks_open_candle_unconfirmed():
    rows = [["1700000300000", "2", "3", "1", "2.5", "10", "25"], ["1700000000000", "1", "2", "0.5", "2", "5", "10"]]
    out = parse_klines(rows, "5", now_ms=1_700_000_400_000)
    assert [c.start for c in out] == [1700000000000, 1700000300000]
    assert out[0].confirmed and not out[1].confirmed


@pytest.mark.asyncio
async def test_retries_rate_limit_then_succeeds():
    with respx.mock(base_url="https://api.bybit.com") as m:
        route = m.get("/v5/market/tickers").mock(side_effect=[
            httpx.Response(200, json={"retCode": 10006, "retMsg": "Too many visits!"}),
            httpx.Response(200, json={"retCode": 0, "result": {"list": [{"symbol": "BTCUSDT", "lastPrice": "1",
                                                                         "bid1Price": "0.9", "ask1Price": "1.1"}]}}),
        ])
        c = BybitREST(rate_per_s=1000, burst=1000)
        c.max_retries = 2
        import quantedge.exchange.bybit_rest as br
        orig = br.asyncio.sleep
        br.asyncio.sleep = lambda s: orig(0)
        try:
            res = await c.tickers()
        finally:
            br.asyncio.sleep = orig
        assert route.call_count == 2 and res[0].symbol == "BTCUSDT"


@pytest.mark.asyncio
async def test_non_retryable_error_raises_immediately():
    with respx.mock(base_url="https://api.bybit.com") as m:
        m.get("/v5/market/orderbook").mock(return_value=httpx.Response(200, json={"retCode": 10001, "retMsg": "bad"}))
        with pytest.raises(BybitError):
            await BybitREST().orderbook("XXX")


@pytest.mark.asyncio
async def test_private_call_requires_credentials():
    with pytest.raises(BybitError, match="credentials"):
        await BybitREST().wallet_balance()


def test_ws_ticker_delta_merge_book_and_kline_confirm():
    got = []

    async def on_k(sym, tf, c):
        got.append((sym, tf, c.close))

    ws = BybitWS(on_kline=on_k)
    ws.handle(json.dumps({"topic": "tickers.BTCUSDT", "type": "snapshot", "data": {"symbol": "BTCUSDT", "bid1Price": "1", "ask1Price": "2"}}))
    ws.handle(json.dumps({"topic": "tickers.BTCUSDT", "type": "delta", "data": {"bid1Price": "1.5"}}))
    assert ws.tickers["BTCUSDT"] == {"symbol": "BTCUSDT", "bid1Price": "1.5", "ask1Price": "2"}
    ws.handle(json.dumps({"topic": "orderbook.50.BTCUSDT", "type": "snapshot", "data": {"b": [["1", "5"]], "a": [["2", "3"]], "u": 1}}))
    ws.handle(json.dumps({"topic": "orderbook.50.BTCUSDT", "type": "delta", "data": {"b": [["1", "0"], ["0.9", "2"]], "a": [], "u": 2}}))
    bids, asks = ws.books["BTCUSDT"].top()
    assert bids == [(0.9, 2.0)] and asks == [(2.0, 3.0)]
    assert not ws.is_stale("BTCUSDT", 5)
    import asyncio

    async def run():
        k = {"start": 0, "open": "1", "high": "1", "low": "1", "close": "1", "volume": "1", "turnover": "1"}
        ws.handle(json.dumps({"topic": "kline.15.BTCUSDT", "data": [{**k, "confirm": False}]}))
        ws.handle(json.dumps({"topic": "kline.15.BTCUSDT", "data": [{**k, "close": "2", "confirm": True}]}))
        await asyncio.sleep(0)
    asyncio.run(run())
    assert got == [("BTCUSDT", "15", 2.0)]


def test_scanner_filters():
    sc = Scanner(ScannerConfig())
    now = 1_800_000_000_000
    new = Instrument("NEWUSDT", "NEW", "USDT", "Trading", "LinearPerpetual", now - 5 * 86_400_000, 0.01, 1, 1, 25)
    old = Instrument("OLDUSDT", "OLD", "USDT", "Trading", "LinearPerpetual", now - 400 * 86_400_000, 0.01, 1, 1, 25)
    sc.update_universe([old])
    assert sc.update_universe([old, new]) == ["NEWUSDT"]
    t = parse_ticker({"symbol": "OLDUSDT", "bid1Price": "100", "ask1Price": "100.01", "markPrice": "100",
                      "indexPrice": "100", "turnover24h": "5e7", "lastPrice": "100"})
    deep = OrderBook("OLDUSDT", [(100 - i * 0.01, 50) for i in range(50)], [(100.01 + i * 0.01, 50) for i in range(50)])
    assert sc.evaluate(t, deep, now).eligible
    thin = OrderBook("OLDUSDT", [(100, 1)], [(100.01, 1)])
    assert not sc.evaluate(t, thin, now).eligible
    tn = parse_ticker({"symbol": "NEWUSDT", "bid1Price": "1", "ask1Price": "1.0001", "markPrice": "1",
                       "indexPrice": "1", "turnover24h": "5e8", "lastPrice": "1"})
    el = sc.evaluate(tn, deep, now)
    assert not el.eligible and any("listed" in r for r in el.reasons)
    wide = parse_ticker({"symbol": "OLDUSDT", "bid1Price": "100", "ask1Price": "100.2", "markPrice": "100",
                         "indexPrice": "100", "turnover24h": "5e7", "lastPrice": "100"})
    assert any("spread" in r for r in sc.evaluate(wide, deep, now).reasons)
