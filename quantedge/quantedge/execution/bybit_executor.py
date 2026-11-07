"""Optional automated execution (Phase 10).  DISABLED by default.

Live orders are possible only when ALL of these hold:
1. ``QE_EXECUTION__ENABLED=true`` in the environment, and
2. an administrator has recorded an approval (``kv_state['execution_approval']``)
   that references a passing deployment-gate report, and
3. the risk engine is not halted.

Safety properties:
* isolated margin and 2.5x leverage are set per symbol before any order
* every entry carries exchange-side TP and SL (``tpslMode=Full``, SL triggered by mark price)
* ``orderLinkId`` = signal id, so a retried request cannot create a second order
* existing exposure on the symbol blocks a new entry (duplicate prevention)
* ``reconcile`` finds positions without a stop, attaches one, and if that fails
  flattens the position with a reduce-only market order (no unprotected positions)

API keys must be created with Trade permission only — never Withdraw.
"""
from __future__ import annotations

import logging
import math
from dataclasses import dataclass, field

from ..config import AppConfig
from ..exchange.bybit_rest import BybitError, BybitREST
from ..models import Direction, Instrument, Signal

log = logging.getLogger(__name__)
OK_NOOP_CODES = {110043, 110026, 110025}   # leverage / margin mode / position mode already set


class ExecutionDisabled(Exception):
    pass


def _decimals(step: float) -> int:
    return max(0, -int(math.floor(math.log10(step)))) if step < 1 else 0


def fmt_step(x: float, step: float) -> str:
    return f"{math.floor(x / step + 1e-9) * step:.{_decimals(step)}f}"


@dataclass
class ReconcileReport:
    exchange_positions: dict[str, dict] = field(default_factory=dict)
    unknown_positions: list[str] = field(default_factory=list)      # on exchange, not tracked locally
    missing_positions: list[str] = field(default_factory=list)      # tracked locally, not on exchange
    protected: list[str] = field(default_factory=list)
    flattened: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)


class BybitExecutor:
    def __init__(self, cfg: AppConfig, rest: BybitREST, approval_lookup, risk_halted):
        self.cfg, self.rest = cfg, rest
        self.approval_lookup = approval_lookup    # () -> dict | None
        self.risk_halted = risk_halted            # () -> bool

    def ensure_enabled(self) -> None:
        if not self.cfg.execution.enabled:
            raise ExecutionDisabled("execution disabled in configuration")
        appr = self.approval_lookup()
        if not appr or not appr.get("approved") or not appr.get("gate_passed"):
            raise ExecutionDisabled("no administrator approval backed by a passing validation gate")
        if self.risk_halted():
            raise ExecutionDisabled("risk engine halted")

    async def prepare_symbol(self, inst: Instrument) -> None:
        lev = f"{self.cfg.trading.leverage:g}"
        try:
            if self.cfg.execution.account_type == "UNIFIED":
                await self.rest.post("/v5/account/set-margin-mode", {"setMarginMode": "ISOLATED_MARGIN"})
            else:
                await self.rest.post("/v5/position/switch-isolated", {"category": "linear", "symbol": inst.symbol,
                                     "tradeMode": 1, "buyLeverage": lev, "sellLeverage": lev})
        except BybitError as e:
            if e.ret_code not in OK_NOOP_CODES:
                raise
        try:
            await self.rest.post("/v5/position/set-leverage", {"category": "linear", "symbol": inst.symbol,
                                 "buyLeverage": lev, "sellLeverage": lev})
        except BybitError as e:
            if e.ret_code not in OK_NOOP_CODES:
                raise

    async def place_entry(self, sig: Signal, inst: Instrument) -> dict:
        self.ensure_enabled()
        positions = await self.rest.positions(sig.symbol)
        if any(float(p.get("size", 0) or 0) > 0 for p in positions):
            raise ExecutionDisabled(f"existing position on {sig.symbol}; duplicate entry refused")
        existing = await self.rest.open_orders(sig.symbol, order_link_id=sig.signal_id)
        if existing:
            return existing[0]   # idempotent: the order was already placed
        await self.prepare_symbol(inst)
        p = sig.plan
        body = {
            "category": "linear", "symbol": sig.symbol,
            "side": "Buy" if sig.direction is Direction.LONG else "Sell",
            "orderType": "Limit", "qty": fmt_step(p.qty, inst.qty_step),
            "price": fmt_step(p.entry, inst.tick_size), "timeInForce": "GTC", "positionIdx": 0,
            "orderLinkId": sig.signal_id,
            "takeProfit": fmt_step(p.take_profit, inst.tick_size), "stopLoss": fmt_step(p.stop, inst.tick_size),
            "tpslMode": "Full", "tpTriggerBy": "LastPrice", "slTriggerBy": "MarkPrice",
            "tpOrderType": "Market", "slOrderType": "Market",
        }
        ack = await self.rest.post("/v5/order/create", body)
        orders = await self.rest.open_orders(sig.symbol, order_link_id=sig.signal_id)
        if not orders:
            # either filled instantly or rejected — check executions / position
            pos = await self.rest.positions(sig.symbol)
            if not any(float(x.get("size", 0) or 0) > 0 for x in pos):
                raise BybitError(-2, "order acknowledged but neither open nor filled", "/v5/order/create")
        return {"ack": ack, "orders": orders}

    async def cancel(self, sig: Signal) -> None:
        await self.rest.post("/v5/order/cancel", {"category": "linear", "symbol": sig.symbol,
                             "orderLinkId": sig.signal_id})

    async def fills(self, sig: Signal, order_id: str) -> tuple[float, float]:
        """(filled qty, average price) from the execution list — handles partial fills."""
        ex = await self.rest.executions(sig.symbol, order_id)
        qty = sum(float(e["execQty"]) for e in ex)
        avg = sum(float(e["execQty"]) * float(e["execPrice"]) for e in ex) / qty if qty else 0.0
        return qty, avg

    async def reconcile(self, tracked: dict[str, Signal]) -> ReconcileReport:
        """Compare exchange positions with locally tracked signals and enforce stops."""
        rep = ReconcileReport()
        try:
            positions = await self.rest.positions()
        except BybitError as e:
            rep.errors.append(str(e))
            return rep
        local_syms = {s.symbol: s for s in tracked.values()}
        for p in positions:
            size = float(p.get("size", 0) or 0)
            if size <= 0:
                continue
            sym = p["symbol"]
            rep.exchange_positions[sym] = p
            if sym not in local_syms:
                rep.unknown_positions.append(sym)
            sl = float(p.get("stopLoss", 0) or 0)
            if sl > 0:
                rep.protected.append(sym)
                continue
            sig = local_syms.get(sym)
            try:
                if sig is None:
                    raise BybitError(-3, "no local plan for unprotected position", sym)
                await self.rest.post("/v5/position/trading-stop", {
                    "category": "linear", "symbol": sym, "positionIdx": 0, "tpslMode": "Full",
                    "stopLoss": str(sig.plan.stop), "takeProfit": str(sig.plan.take_profit),
                    "slTriggerBy": "MarkPrice"})
                rep.protected.append(sym)
            except BybitError as e:
                rep.errors.append(f"{sym}: could not attach stop ({e}); flattening")
                try:
                    await self.rest.post("/v5/order/create", {
                        "category": "linear", "symbol": sym, "side": "Sell" if p.get("side") == "Buy" else "Buy",
                        "orderType": "Market", "qty": p["size"], "reduceOnly": True, "positionIdx": 0})
                    rep.flattened.append(sym)
                except BybitError as e2:
                    rep.errors.append(f"{sym}: FLATTEN FAILED ({e2}) — manual intervention required")
        rep.missing_positions = [s for s in local_syms if s not in rep.exchange_positions]
        return rep
