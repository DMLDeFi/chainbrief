"""Bybit v5 public WebSocket client.

* Subscribes in chunks of 10 topics per request.
* Sends ``{"op":"ping"}`` every 20 s (Bybit closes idle sockets after ~30 s).
* Reconnects with exponential backoff and re-subscribes everything.
* Merges ticker snapshot/delta messages and order-book snapshot/delta updates.
* Exposes per-symbol last-update timestamps so callers can reject stale data.
"""
from __future__ import annotations

import asyncio
import json
import logging
import random
import time
from collections import defaultdict
from typing import Awaitable, Callable

from ..analysis.features import INTERVAL_MS
from ..models import Candle

log = logging.getLogger(__name__)

PUBLIC_LINEAR = "wss://stream.bybit.com/v5/public/linear"
PUBLIC_LINEAR_TESTNET = "wss://stream-testnet.bybit.com/v5/public/linear"

KlineHandler = Callable[[str, str, Candle], Awaitable[None]]


class LocalBook:
    def __init__(self) -> None:
        self.bids: dict[float, float] = {}
        self.asks: dict[float, float] = {}
        self.update_id = 0
        self.ts = 0.0

    def apply(self, msg_type: str, data: dict) -> None:
        if msg_type == "snapshot":
            self.bids, self.asks = {}, {}
        for p, s in data.get("b", []):
            p, s = float(p), float(s)
            if s == 0:
                self.bids.pop(p, None)
            else:
                self.bids[p] = s
        for p, s in data.get("a", []):
            p, s = float(p), float(s)
            if s == 0:
                self.asks.pop(p, None)
            else:
                self.asks[p] = s
        self.update_id = int(data.get("u", self.update_id))
        self.ts = time.time()

    def top(self, n: int = 50) -> tuple[list[tuple[float, float]], list[tuple[float, float]]]:
        return (sorted(self.bids.items(), reverse=True)[:n], sorted(self.asks.items())[:n])


class BybitWS:
    def __init__(self, url: str = PUBLIC_LINEAR, ping_interval: float = 20.0,
                 on_kline: KlineHandler | None = None, connect: Callable | None = None):
        self.url = url
        self.ping_interval = ping_interval
        self.topics: set[str] = set()
        self.tickers: dict[str, dict] = defaultdict(dict)
        self.books: dict[str, LocalBook] = defaultdict(LocalBook)
        self.last_update: dict[str, float] = {}
        self.on_kline = on_kline
        self._connect = connect
        self._ws = None
        self._stop = asyncio.Event()
        self.connected = False
        self.reconnects = 0
        self.last_message = 0.0

    def subscribe(self, topics: list[str]) -> None:
        new = [t for t in topics if t not in self.topics]
        self.topics.update(new)
        if self._ws is not None and new:
            asyncio.ensure_future(self._send_subs(new))

    async def _send_subs(self, topics: list[str]) -> None:
        for i in range(0, len(topics), 10):
            await self._ws.send(json.dumps({"op": "subscribe", "args": topics[i:i + 10],
                                            "req_id": f"sub{i}"}))

    def is_stale(self, symbol: str, max_age: float) -> bool:
        return time.time() - self.last_update.get(symbol, 0.0) > max_age

    async def stop(self) -> None:
        self._stop.set()
        if self._ws is not None:
            await self._ws.close()

    async def run(self) -> None:
        if self._connect is None:
            import websockets
            self._connect = lambda url: websockets.connect(url, ping_interval=None, max_size=2 ** 23)
        backoff = 1.0
        while not self._stop.is_set():
            try:
                async with self._connect(self.url) as ws:
                    self._ws, self.connected, backoff = ws, True, 1.0
                    await self._send_subs(sorted(self.topics))
                    pinger = asyncio.create_task(self._pinger(ws))
                    try:
                        async for raw in ws:
                            self.handle(raw)
                    finally:
                        pinger.cancel()
            except asyncio.CancelledError:
                raise
            except Exception as e:
                log.warning("ws error: %s", e)
            self.connected, self._ws = False, None
            if self._stop.is_set():
                break
            self.reconnects += 1
            wait = min(60.0, backoff) * (0.8 + 0.4 * random.random())
            log.info("ws reconnecting in %.1fs", wait)
            await asyncio.sleep(wait)
            backoff *= 2

    async def _pinger(self, ws) -> None:
        while True:
            await asyncio.sleep(self.ping_interval)
            await ws.send(json.dumps({"op": "ping"}))
            if time.time() - self.last_message > 3 * self.ping_interval:
                log.warning("ws heartbeat lost; forcing reconnect")
                await ws.close()
                return

    def handle(self, raw: str | bytes) -> None:
        self.last_message = time.time()
        msg = json.loads(raw)
        topic = msg.get("topic")
        if not topic:
            if msg.get("op") == "subscribe" and not msg.get("success", True):
                log.error("subscribe failed: %s", msg.get("ret_msg"))
            return
        kind, *rest = topic.split(".")
        data = msg.get("data")
        if kind == "tickers":
            sym = rest[-1]
            if msg.get("type") == "snapshot":
                self.tickers[sym] = dict(data)
            else:
                self.tickers[sym].update(data)
            self.last_update[sym] = time.time()
        elif kind == "orderbook":
            sym = rest[-1]
            self.books[sym].apply(msg.get("type", "delta"), data)
            self.last_update[sym] = time.time()
        elif kind == "kline" and self.on_kline:
            interval, sym = rest[0], rest[1]
            for k in data:
                if not k.get("confirm"):
                    continue    # never act on an open candle
                c = Candle(int(k["start"]), float(k["open"]), float(k["high"]), float(k["low"]),
                           float(k["close"]), float(k["volume"]), float(k["turnover"]),
                           INTERVAL_MS[interval], True)
                asyncio.ensure_future(self.on_kline(sym, interval, c))
