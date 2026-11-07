"""Signal lifecycle tracking with a conservative execution model.

Used identically by live monitoring (bid/ask quotes) and the back-tester (bars),
so published statistics and simulated statistics follow the same rules:

* A LONG limit entry fills only when the *ask* trades below the limit (bar: low < entry);
  touching the zone is recorded as ENTRY_ZONE_REACHED but is not a fill.
* Take-profit requires a trade *through* the target (bid > TP / bar high > TP).
* Stops trigger at or beyond the level and fill at the worse of stop and the bar
  open (gaps), minus stop slippage.
* If stop and target are both inside one bar, the stop is assumed to hit first.
* A fill bar can stop out but cannot take profit (intra-bar order unknown).
* Unfilled signals expire or are invalidated and are never counted as trades.
* Partial fills: qty filled is capped by ``participation`` x bar volume.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

from ..config import CostConfig
from ..models import Direction, Signal, SignalStatus
from ..risk.roi import pnl

FUNDING_PERIOD_MS = 8 * 3_600_000


@dataclass
class TradeResult:
    signal_id: str
    symbol: str
    direction: str
    strategy: str
    regime: str
    score: float
    status: str
    filled_qty: float
    avg_entry: float
    exit_price: float
    entry_ts: int
    exit_ts: int
    net_pnl: float
    net_roi: float
    r_multiple: float
    fees: float
    funding: float
    slippage: float
    hold_hours: float
    mfe: float       # max favourable excursion, fraction of entry
    mae: float       # max adverse excursion, fraction of entry


@dataclass
class Tracked:
    signal: Signal
    status: SignalStatus = SignalStatus.PUBLISHED
    filled_qty: float = 0.0
    avg_entry: float = 0.0
    entry_ts: int = 0
    zone_reached_ts: int = 0
    funding_paid: float = 0.0
    last_funding_ms: int = 0
    mfe: float = 0.0
    mae: float = 0.0
    events: list[tuple[int, str, dict]] = field(default_factory=list)
    result: TradeResult | None = None

    def log(self, ts: int, kind: str, **data) -> None:
        self.events.append((ts, kind, data))


class TradeTracker:
    def __init__(self, costs: CostConfig, participation: float = 0.1, max_hold_hours: float = 96.0):
        self.costs = costs
        self.participation = participation
        self.max_hold_ms = int(max_hold_hours * 3_600_000)
        self.active: dict[str, Tracked] = {}
        self.closed: list[Tracked] = []

    def add(self, sig: Signal, ts: int) -> Tracked:
        t = Tracked(sig)
        t.log(ts, "PUBLISHED")
        self.active[sig.signal_id] = t
        return t

    def cancel(self, signal_id: str, ts: int, reason: str) -> Tracked | None:
        t = self.active.get(signal_id)
        if t is None:
            return None
        if t.filled_qty > 0:
            return None  # filled positions are closed only by TP/SL/time exit
        t.status = SignalStatus.CANCELLED
        t.log(ts, "CANCELLED", reason=reason)
        return self._finish(t, ts, 0.0)

    # ------------------------------------------------------------------ core
    def on_bar(self, symbol: str, ts: int, o: float, h: float, l: float, c: float, volume: float,
               funding_rate: float = 0.0) -> list[Tracked]:
        """Process one closed bar ending at ``ts``.  Returns trackers whose state changed."""
        changed = []
        for t in [x for x in self.active.values() if x.signal.symbol == symbol]:
            before = (t.status, t.filled_qty)
            self._step(t, ts, o, h, l, c, volume, funding_rate, bar=True)
            if (t.status, t.filled_qty) != before:
                changed.append(t)
        return changed

    def on_quote(self, symbol: str, ts: int, bid: float, ask: float, funding_rate: float = 0.0) -> list[Tracked]:
        """Live path: a quote is a degenerate bar; buys use ask, sells use bid."""
        changed = []
        for t in [x for x in self.active.values() if x.signal.symbol == symbol]:
            before = (t.status, t.filled_qty)
            s = t.signal.direction.sign
            entry_px = ask if s > 0 else bid      # price we would trade at to enter
            exit_px = bid if s > 0 else ask       # price we would trade at to exit
            self._step(t, ts, None, None, None, None, math.inf, funding_rate, bar=False,
                       entry_px=entry_px, exit_px=exit_px)
            if (t.status, t.filled_qty) != before:
                changed.append(t)
        return changed

    def _step(self, t: Tracked, ts: int, o, h, l, c, volume, funding_rate, *, bar: bool,
              entry_px: float | None = None, exit_px: float | None = None) -> None:
        sig, plan = t.signal, t.signal.plan
        s = sig.direction.sign
        if bar:
            fav_px, adv_px = (h, l) if s > 0 else (l, h)
            entry_cross = (l < plan.entry) if s > 0 else (h > plan.entry)
            zone_touch = (l <= sig.entry_zone[1]) if s > 0 else (h >= sig.entry_zone[0])
            tp_hit = (h > plan.take_profit) if s > 0 else (l < plan.take_profit)
            sl_hit = (l <= plan.stop) if s > 0 else (h >= plan.stop)
            close_px = c
        else:
            fav_px = adv_px = exit_px
            entry_cross = (entry_px < plan.entry) if s > 0 else (entry_px > plan.entry)
            zone_touch = (entry_px <= sig.entry_zone[1]) if s > 0 else (entry_px >= sig.entry_zone[0])
            tp_hit = (exit_px > plan.take_profit) if s > 0 else (exit_px < plan.take_profit)
            sl_hit = (exit_px <= plan.stop) if s > 0 else (exit_px >= plan.stop)
            close_px = exit_px

        # ---- not yet (fully) filled
        if t.filled_qty == 0:
            if ts >= sig.expires_ms:
                t.status = SignalStatus.EXPIRED
                t.log(ts, "EXPIRED")
                self._finish(t, ts, 0.0)
                return
            if s * (close_px - sig.invalidation_price) <= 0:
                t.status = SignalStatus.INVALIDATED
                t.log(ts, "INVALIDATED", price=close_px)
                self._finish(t, ts, 0.0)
                return
            if zone_touch and not t.zone_reached_ts:
                t.zone_reached_ts = ts
                t.status = SignalStatus.ENTRY_ZONE_REACHED
                t.log(ts, "ENTRY_ZONE_REACHED")
            if not entry_cross:
                return
            cap = self.participation * volume if bar else math.inf
            qty = min(plan.qty, cap)
            if qty <= 0:
                return
            t.filled_qty, t.avg_entry, t.entry_ts = qty, plan.entry, ts
            t.last_funding_ms = ts
            t.status = SignalStatus.FILLED if qty >= plan.qty - 1e-12 else SignalStatus.PARTIALLY_FILLED
            t.log(ts, t.status.value, qty=qty, price=plan.entry)
            if sl_hit:  # fill bar may stop out (conservative)
                self._exit_stop(t, ts, o if bar else None)
            return

        # ---- top up a partial fill on later bars that trade through again
        if t.status is SignalStatus.PARTIALLY_FILLED and entry_cross and bar:
            add = min(plan.qty - t.filled_qty, self.participation * volume)
            if add > 0:
                t.filled_qty += add
                if t.filled_qty >= plan.qty - 1e-12:
                    t.status = SignalStatus.FILLED
                t.log(ts, "FILL_ADDED", qty=add)

        # ---- funding accrual at 00/08/16 UTC
        nxt = (t.last_funding_ms // FUNDING_PERIOD_MS + 1) * FUNDING_PERIOD_MS
        while nxt <= ts:
            t.funding_paid += s * funding_rate * t.filled_qty * close_px
            t.last_funding_ms = nxt
            nxt += FUNDING_PERIOD_MS

        # ---- excursions
        t.mfe = max(t.mfe, s * (fav_px - t.avg_entry) / t.avg_entry)
        t.mae = max(t.mae, -s * (adv_px - t.avg_entry) / t.avg_entry)

        if sl_hit:
            self._exit_stop(t, ts, o if bar else None)
        elif tp_hit:
            self._exit(t, ts, plan.take_profit, SignalStatus.TAKE_PROFIT,
                       self.costs.maker_fee if self.costs.tp_is_maker else self.costs.taker_fee,
                       0.0 if self.costs.tp_is_maker else self.costs.exit_slippage)
        elif ts - t.entry_ts >= self.max_hold_ms:
            self._exit(t, ts, close_px, SignalStatus.TIME_EXIT, self.costs.taker_fee, self.costs.exit_slippage)

    def _exit_stop(self, t: Tracked, ts: int, bar_open: float | None) -> None:
        plan, s = t.signal.plan, t.signal.direction.sign
        px = plan.stop
        if bar_open is not None and s * (bar_open - plan.stop) < 0:  # gapped through the stop
            px = bar_open
        self._exit(t, ts, px, SignalStatus.STOP_LOSS, self.costs.taker_fee, self.costs.stop_slippage)

    def _exit(self, t: Tracked, ts: int, px: float, status: SignalStatus, fee_out: float, slip_out: float) -> None:
        plan = t.signal.plan
        fee_in = self.costs.maker_fee if self.costs.entry_is_maker else self.costs.taker_fee
        slip_in = 0.0 if self.costs.entry_is_maker else self.costs.entry_slippage
        p = pnl(t.signal.direction, t.filled_qty, t.avg_entry, px, plan.leverage, fee_in, fee_out,
                slip_in, slip_out, t.funding_paid)
        t.status = status
        t.log(ts, status.value, price=px, net=p.net)
        planned_loss_for_qty = plan.max_loss * t.filled_qty / plan.qty if plan.qty else 0
        t.result = TradeResult(
            t.signal.signal_id, t.signal.symbol, t.signal.direction.value, t.signal.strategy,
            t.signal.regime.value, t.signal.score, status.value, t.filled_qty, t.avg_entry, px,
            t.entry_ts, ts, p.net, p.roi, p.net / planned_loss_for_qty if planned_loss_for_qty else 0.0,
            p.entry_fee + p.exit_fee, p.funding, p.slippage, (ts - t.entry_ts) / 3_600_000, t.mfe, t.mae)
        self._finish(t, ts, p.net)

    def _finish(self, t: Tracked, ts: int, net: float) -> Tracked:
        self.active.pop(t.signal.signal_id, None)
        self.closed.append(t)
        return t
