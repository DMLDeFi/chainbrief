"""Bybit v5 REST client (official endpoints only).

* Public market data needs no credentials.
* Private calls are HMAC-SHA256 signed:  sign = HMAC(secret, ts + key + recv_window + payload)
  where payload is the query string (GET) or the raw JSON body (POST).
* A token bucket keeps us well under Bybit's IP limit; retCode 10006 / HTTP 429 /
  5xx are retried with exponential backoff and jitter.
"""
from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import logging
import random
import time
from typing import Any
from urllib.parse import urlencode

import httpx

from ..models import Candle, Instrument, MarketSnapshot, OrderBook
from ..analysis.features import INTERVAL_MS

log = logging.getLogger(__name__)

MAINNET = "https://api.bybit.com"
TESTNET = "https://api-testnet.bybit.com"
RETRYABLE_RET_CODES = {10006, 10016, 10002}   # rate limit, server error, timestamp/recv window


class BybitError(Exception):
    def __init__(self, ret_code: int, msg: str, path: str):
        super().__init__(f"{path}: retCode={ret_code} {msg}")
        self.ret_code, self.msg, self.path = ret_code, msg, path


class TokenBucket:
    def __init__(self, rate: float, burst: int):
        self.rate, self.capacity = rate, burst
        self.tokens, self.t = float(burst), time.monotonic()
        self._lock = asyncio.Lock()

    async def take(self) -> None:
        async with self._lock:
            while True:
                now = time.monotonic()
                self.tokens = min(self.capacity, self.tokens + (now - self.t) * self.rate)
                self.t = now
                if self.tokens >= 1:
                    self.tokens -= 1
                    return
                await asyncio.sleep((1 - self.tokens) / self.rate)


def sign(secret: str, ts: str, key: str, recv_window: str, payload: str) -> str:
    return hmac.new(secret.encode(), (ts + key + recv_window + payload).encode(), hashlib.sha256).hexdigest()


class BybitREST:
    def __init__(self, api_key: str = "", api_secret: str = "", testnet: bool = False,
                 rate_per_s: float = 8.0, burst: int = 16, timeout: float = 10.0,
                 client: httpx.AsyncClient | None = None, max_retries: int = 5):
        self.key, self.secret = api_key, api_secret
        self.base = TESTNET if testnet else MAINNET
        self.bucket = TokenBucket(rate_per_s, burst)
        self.client = client or httpx.AsyncClient(base_url=self.base, timeout=timeout)
        self.max_retries = max_retries
        self.recv_window = "5000"
        self.time_offset_ms = 0
        self.last_ok = 0.0
        self.consecutive_failures = 0

    async def close(self) -> None:
        await self.client.aclose()

    @property
    def healthy(self) -> bool:
        return self.consecutive_failures < 3

    async def _request(self, method: str, path: str, params: dict | None = None, signed: bool = False) -> Any:
        params = {k: v for k, v in (params or {}).items() if v is not None}
        if signed and not (self.key and self.secret):
            raise BybitError(-1, "API credentials not configured", path)
        delay = 0.5
        for attempt in range(self.max_retries + 1):
            await self.bucket.take()
            headers = {"Content-Type": "application/json"}
            if method == "GET":
                qs = urlencode(sorted(params.items()))
                payload, url, body = qs, f"{path}?{qs}" if qs else path, None
            else:
                body = json.dumps(params, separators=(",", ":"))
                payload, url = body, path
            if signed:
                ts = str(int(time.time() * 1000) + self.time_offset_ms)
                headers.update({"X-BAPI-API-KEY": self.key, "X-BAPI-TIMESTAMP": ts,
                                "X-BAPI-RECV-WINDOW": self.recv_window,
                                "X-BAPI-SIGN": sign(self.secret, ts, self.key, self.recv_window, payload)})
            try:
                r = await self.client.request(method, url, content=body, headers=headers)
                if r.status_code == 429 or r.status_code >= 500:
                    raise httpx.HTTPStatusError(f"HTTP {r.status_code}", request=r.request, response=r)
                r.raise_for_status()
                data = r.json()
                rc = data.get("retCode", 0)
                if rc in RETRYABLE_RET_CODES:
                    if rc == 10002:
                        await self.sync_time()
                    raise BybitError(rc, data.get("retMsg", ""), path)
                if rc != 0:
                    self.consecutive_failures = 0
                    raise BybitError(rc, data.get("retMsg", ""), path)
                self.last_ok, self.consecutive_failures = time.time(), 0
                return data.get("result", {})
            except (httpx.TransportError, httpx.HTTPStatusError, BybitError) as e:
                if isinstance(e, BybitError) and e.ret_code not in RETRYABLE_RET_CODES:
                    raise
                self.consecutive_failures += 1
                if attempt == self.max_retries:
                    raise
                wait = delay * (2 ** attempt) * (0.8 + 0.4 * random.random())
                log.warning("bybit %s %s failed (%s); retry %d in %.1fs", method, path, e, attempt + 1, wait)
                await asyncio.sleep(wait)

    async def sync_time(self) -> None:
        try:
            r = await self.client.get("/v5/market/time")
            server_ms = int(r.json()["result"]["timeNano"]) // 1_000_000
            self.time_offset_ms = server_ms - int(time.time() * 1000)
        except Exception as e:  # pragma: no cover - best effort
            log.warning("time sync failed: %s", e)

    # ---------------- market data ----------------
    async def instruments(self, category: str = "linear") -> list[Instrument]:
        out, cursor = [], None
        while True:
            res = await self._request("GET", "/v5/market/instruments-info",
                                      {"category": category, "limit": 1000, "cursor": cursor})
            for it in res.get("list", []):
                out.append(parse_instrument(it))
            cursor = res.get("nextPageCursor")
            if not cursor:
                return out

    async def tickers(self, category: str = "linear") -> list[MarketSnapshot]:
        res = await self._request("GET", "/v5/market/tickers", {"category": category})
        return [parse_ticker(t) for t in res.get("list", [])]

    async def klines(self, symbol: str, interval: str, start_ms: int | None = None,
                     end_ms: int | None = None, limit: int = 1000, category: str = "linear") -> list[Candle]:
        res = await self._request("GET", "/v5/market/kline", {"category": category, "symbol": symbol,
                                  "interval": interval, "start": start_ms, "end": end_ms, "limit": limit})
        return parse_klines(res.get("list", []), interval, now_ms=int(time.time() * 1000))

    async def kline_history(self, symbol: str, interval: str, start_ms: int, end_ms: int) -> list[Candle]:
        """Paginate backwards from end_ms to start_ms; returns ascending, de-duplicated candles."""
        step = INTERVAL_MS[interval]
        out: dict[int, Candle] = {}
        cur_end = end_ms
        while cur_end > start_ms:
            batch = await self.klines(symbol, interval, start_ms, cur_end, 1000)
            if not batch:
                break
            for k in batch:
                out[k.start] = k
            first = batch[0].start
            if first <= start_ms or len(batch) < 2:
                break
            cur_end = first - step
        return [out[k] for k in sorted(out) if start_ms <= k < end_ms]

    async def orderbook(self, symbol: str, depth: int = 50, category: str = "linear") -> OrderBook:
        res = await self._request("GET", "/v5/market/orderbook", {"category": category, "symbol": symbol, "limit": depth})
        return OrderBook(symbol, [(float(p), float(s)) for p, s in res.get("b", [])],
                         [(float(p), float(s)) for p, s in res.get("a", [])])

    async def funding_history(self, symbol: str, start_ms: int | None = None, end_ms: int | None = None,
                              category: str = "linear") -> list[tuple[int, float]]:
        res = await self._request("GET", "/v5/market/funding/history", {"category": category, "symbol": symbol,
                                  "startTime": start_ms, "endTime": end_ms, "limit": 200})
        return sorted((int(x["fundingRateTimestamp"]), float(x["fundingRate"])) for x in res.get("list", []))

    async def open_interest(self, symbol: str, interval: str = "1h", limit: int = 48,
                            category: str = "linear") -> list[tuple[int, float]]:
        res = await self._request("GET", "/v5/market/open-interest", {"category": category, "symbol": symbol,
                                  "intervalTime": interval, "limit": limit})
        return sorted((int(x["timestamp"]), float(x["openInterest"])) for x in res.get("list", []))

    # ---------------- private ----------------
    async def fee_rate(self, symbol: str | None = None, category: str = "linear") -> list[dict]:
        res = await self._request("GET", "/v5/account/fee-rate", {"category": category, "symbol": symbol}, signed=True)
        return res.get("list", [])

    async def wallet_balance(self, account_type: str = "UNIFIED") -> dict:
        res = await self._request("GET", "/v5/account/wallet-balance", {"accountType": account_type}, signed=True)
        return (res.get("list") or [{}])[0]

    async def positions(self, symbol: str | None = None, category: str = "linear") -> list[dict]:
        res = await self._request("GET", "/v5/position/list", {"category": category, "symbol": symbol,
                                  "settleCoin": None if symbol else "USDT"}, signed=True)
        return res.get("list", [])

    async def open_orders(self, symbol: str | None = None, order_link_id: str | None = None,
                          category: str = "linear") -> list[dict]:
        res = await self._request("GET", "/v5/order/realtime", {"category": category, "symbol": symbol,
                                  "orderLinkId": order_link_id, "settleCoin": None if symbol else "USDT"}, signed=True)
        return res.get("list", [])

    async def executions(self, symbol: str, order_id: str | None = None, category: str = "linear") -> list[dict]:
        res = await self._request("GET", "/v5/execution/list", {"category": category, "symbol": symbol,
                                  "orderId": order_id}, signed=True)
        return res.get("list", [])

    async def post(self, path: str, body: dict) -> dict:
        return await self._request("POST", path, body, signed=True)


def parse_instrument(it: dict) -> Instrument:
    lot, pf, lev = it.get("lotSizeFilter", {}), it.get("priceFilter", {}), it.get("leverageFilter", {})
    return Instrument(
        symbol=it["symbol"], base_coin=it.get("baseCoin", ""), quote_coin=it.get("quoteCoin", ""),
        status=it.get("status", ""), contract_type=it.get("contractType", ""),
        launch_time=int(it.get("launchTime", 0) or 0), tick_size=float(pf.get("tickSize", 0) or 0),
        qty_step=float(lot.get("qtyStep", 0) or 0), min_qty=float(lot.get("minOrderQty", 0) or 0),
        max_leverage=float(lev.get("maxLeverage", 1) or 1),
        funding_interval_min=int(it.get("fundingInterval", 480) or 480),
        min_notional=float(lot.get("minNotionalValue", 5) or 5))


def _f(x: Any) -> float:
    try:
        return float(x)
    except (TypeError, ValueError):
        return 0.0


def parse_ticker(t: dict) -> MarketSnapshot:
    return MarketSnapshot(
        symbol=t["symbol"], last=_f(t.get("lastPrice")), bid=_f(t.get("bid1Price")), ask=_f(t.get("ask1Price")),
        mark=_f(t.get("markPrice")), index=_f(t.get("indexPrice")), turnover_24h=_f(t.get("turnover24h")),
        volume_24h=_f(t.get("volume24h")), open_interest_value=_f(t.get("openInterestValue")),
        funding_rate=_f(t.get("fundingRate")), next_funding_ms=int(_f(t.get("nextFundingTime"))),
        price_24h_pct=_f(t.get("price24hPcnt")))


def parse_klines(rows: list[list[str]], interval: str, now_ms: int) -> list[Candle]:
    """Bybit returns newest first.  The newest bar is unconfirmed if it has not closed yet."""
    step = INTERVAL_MS[interval]
    out = []
    for r in reversed(rows):
        st = int(r[0])
        out.append(Candle(st, float(r[1]), float(r[2]), float(r[3]), float(r[4]), float(r[5]), float(r[6]),
                          step, confirmed=st + step <= now_ms))
    return out
