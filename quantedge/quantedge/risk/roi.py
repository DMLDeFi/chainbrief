"""Exact net-ROI engine.

Terminology (never mixed up in this module):

* price move      = (exit - entry) / entry                      (token %)
* position return = PnL / notional                              (position %)
* margin ROI      = net PnL / allocated margin                  (what the target refers to)
* account risk    = loss at stop / account equity               (what the risk budget refers to)

With linear USDT contracts, quantity Q, leverage L:
    notional N = Q * E,   margin M = N / L

LONG, effective fills E' = E(1+s_in), X' = X(1-s_out):
    net = Q(X' - E') - f_in Q E' - f_out Q X' - F
Setting net = r M = r Q E / L and solving for X':
    X' = (E'(1 + f_in) + r E / L + F/Q) / (1 - f_out),   X = X' / (1 - s_out)

SHORT, E' = E(1-s_in), X' = X(1+s_out):
    net = Q(E' - X') - f_in Q E' - f_out Q X' - F
    X' = (E'(1 - f_in) - r E / L - F/Q) / (1 + f_out),   X = X' / (1 + s_out)

F is the expected funding *cost* (positive = we pay).  Long pays when the rate
is positive, short pays when it is negative.  By default funding *income* is
not credited toward the target (conservative).

The TP is rounded to the tick *away* from entry, so the realised plan meets or
beats the target; the result is re-verified with ``pnl`` (the same function
used by the trade monitor and the back-tester).
"""
from __future__ import annotations

import math
from dataclasses import dataclass

from ..config import CostConfig, RiskConfig
from ..models import Direction, Instrument, TradePlan


class PlanRejected(Exception):
    pass


@dataclass
class PnL:
    gross: float
    entry_fee: float
    exit_fee: float
    funding: float
    slippage: float
    net: float
    margin: float
    roi: float


def round_to_step(x: float, step: float, mode: str) -> float:
    if step <= 0:
        return x
    q = x / step
    q = math.floor(q + 1e-9) if mode == "down" else math.ceil(q - 1e-9) if mode == "up" else round(q)
    # use repr-safe decimal places of the step
    dec = max(0, -int(math.floor(math.log10(step)))) if step < 1 else 0
    return round(q * step, dec + 2)


def funding_cost_per_unit(direction: Direction, mark: float, rate: float, n_intervals: int,
                          credit_income: bool) -> float:
    """Funding cost per unit quantity: positive means we pay."""
    per = rate * mark * n_intervals * (1 if direction is Direction.LONG else -1)
    return per if credit_income else max(per, 0.0)


def funding_intervals(hold_hours: float, now_ms: int, next_funding_ms: int, interval_hours: float) -> int:
    """Number of funding timestamps that fall inside [now, now + hold]."""
    if hold_hours <= 0:
        return 0
    end = now_ms + hold_hours * 3_600_000
    nxt = next_funding_ms if next_funding_ms > now_ms else now_ms + interval_hours * 3_600_000
    if nxt > end:
        return 0
    return 1 + int((end - nxt) // (interval_hours * 3_600_000))


def pnl(direction: Direction, qty: float, entry: float, exit_: float, leverage: float,
        fee_in: float, fee_out: float, slip_in: float, slip_out: float, funding: float) -> PnL:
    """Net P&L of a closed position.  ``entry``/``exit_`` are *order* prices; slippage
    is applied adversely.  ``funding`` is the total funding paid (negative = received)."""
    sg = direction.sign
    e_eff = entry * (1 + sg * slip_in)
    x_eff = exit_ * (1 - sg * slip_out)
    gross = sg * qty * (x_eff - e_eff)
    fin, fout = fee_in * qty * e_eff, fee_out * qty * x_eff
    slip = qty * (abs(e_eff - entry) + abs(x_eff - exit_))
    net = gross - fin - fout - funding
    margin = qty * entry / leverage
    return PnL(gross, fin, fout, funding, slip, net, margin, net / margin if margin else 0.0)


def solve_take_profit(direction: Direction, entry: float, leverage: float, target_roi: float,
                      fee_in: float, fee_out: float, slip_in: float, slip_out: float,
                      funding_per_unit: float) -> float:
    r_term = target_roi * entry / leverage
    if direction is Direction.LONG:
        e_eff = entry * (1 + slip_in)
        x_eff = (e_eff * (1 + fee_in) + r_term + funding_per_unit) / (1 - fee_out)
        return x_eff / (1 - slip_out)
    e_eff = entry * (1 - slip_in)
    x_eff = (e_eff * (1 - fee_in) - r_term - funding_per_unit) / (1 + fee_out)
    if x_eff <= 0:
        raise PlanRejected("short target unreachable")
    return x_eff / (1 + slip_out)


def liquidation_price(direction: Direction, entry: float, leverage: float, mmr: float) -> float:
    if direction is Direction.LONG:
        return entry * (1 - 1 / leverage + mmr)
    return entry * (1 + 1 / leverage - mmr)


def expected_hold_hours(distance: float, hourly_sigma: float) -> float:
    """Diffusion estimate: time for a driftless walk with per-hour s.d. sigma to
    travel ``distance`` is of order (distance / sigma)^2 hours."""
    if hourly_sigma <= 0:
        return float("inf")
    return (distance / hourly_sigma) ** 2


def build_plan(direction: Direction, entry: float, stop: float, *, equity: float,
               available_margin: float, leverage: float, target_roi: float,
               funding_rate: float, next_funding_ms: int, now_ms: int, hourly_sigma: float,
               instrument: Instrument, costs: CostConfig, risk: RiskConfig,
               risk_fraction: float | None = None, open_notional: float = 0.0) -> TradePlan:
    sg = direction.sign
    if leverage > risk.max_leverage + 1e-12:
        raise PlanRejected(f"leverage {leverage} exceeds max {risk.max_leverage}")
    if sg * (entry - stop) <= 0:
        raise PlanRejected("stop is on the wrong side of entry")
    tick = instrument.tick_size
    entry = round_to_step(entry, tick, "nearest")
    stop = round_to_step(stop, tick, "down" if direction is Direction.LONG else "up")
    stop_dist = abs(entry - stop) / entry
    if stop_dist > risk.max_stop_distance:
        raise PlanRejected(f"stop distance {stop_dist:.2%} > max {risk.max_stop_distance:.2%}")
    if stop_dist < risk.min_stop_distance:
        raise PlanRejected(f"stop distance {stop_dist:.2%} < min {risk.min_stop_distance:.2%}")

    liq = liquidation_price(direction, entry, leverage, risk.maintenance_margin_rate)
    if abs(entry - stop) > risk.liquidation_buffer * abs(entry - liq):
        raise PlanRejected("stop too close to liquidation price")

    fee_in = costs.maker_fee if costs.entry_is_maker else costs.taker_fee
    fee_out = costs.maker_fee if costs.tp_is_maker else costs.taker_fee
    slip_in = 0.0 if costs.entry_is_maker else costs.entry_slippage
    slip_out = 0.0 if costs.tp_is_maker else costs.exit_slippage

    # fixed-point: hold time -> funding -> TP -> hold time
    hold, tp, n_fund, f_unit = 0.0, entry, 0, 0.0
    for _ in range(6):
        n_fund = funding_intervals(hold, now_ms, next_funding_ms, costs.funding_interval_hours)
        f_unit = funding_cost_per_unit(direction, entry, funding_rate, n_fund, costs.credit_favourable_funding)
        tp = solve_take_profit(direction, entry, leverage, target_roi, fee_in, fee_out, slip_in, slip_out, f_unit)
        new_hold = expected_hold_hours(abs(tp - entry), hourly_sigma)
        if abs(new_hold - hold) < 1e-6:
            break
        hold = new_hold
    if hold > risk.max_expected_hold_hours:
        raise PlanRejected(f"expected holding period {hold:.0f}h > max {risk.max_expected_hold_hours:.0f}h")
    tp = round_to_step(tp, tick, "up" if direction is Direction.LONG else "down")

    # sizing from the loss at stop, including costs (stop = taker + stop slippage)
    rf = risk.risk_per_trade if risk_fraction is None else risk_fraction
    budget = equity * rf
    unit_loss = -pnl(direction, 1.0, entry, stop, leverage, fee_in, costs.taker_fee, slip_in,
                     costs.stop_slippage, f_unit).net
    if unit_loss <= 0:
        raise PlanRejected("non-positive loss per unit at stop")
    qty = round_to_step(budget / unit_loss, instrument.qty_step, "down")
    max_qty_margin = available_margin * 0.95 * leverage / entry
    max_qty_exposure = max(0.0, risk.max_total_exposure * equity - open_notional) / entry
    qty = min(qty, round_to_step(max_qty_margin, instrument.qty_step, "down"),
              round_to_step(max_qty_exposure, instrument.qty_step, "down"))
    if qty < instrument.min_qty or qty * entry < instrument.min_notional:
        raise PlanRejected("position below exchange minimum after risk/margin caps")

    win = pnl(direction, qty, entry, tp, leverage, fee_in, fee_out, slip_in, slip_out, f_unit * qty)
    loss = pnl(direction, qty, entry, stop, leverage, fee_in, costs.taker_fee, slip_in, costs.stop_slippage, f_unit * qty)
    if win.roi + 1e-9 < target_roi:
        raise PlanRejected(f"verification failed: net ROI {win.roi:.4%} < target")
    rr = win.net / -loss.net if loss.net < 0 else float("inf")
    if rr < risk.min_reward_risk:
        raise PlanRejected(f"net reward/risk {rr:.2f} < {risk.min_reward_risk}")

    return TradePlan(
        direction=direction, entry=entry, stop=stop, take_profit=tp, qty=qty,
        notional=qty * entry, margin=win.margin, leverage=leverage, entry_fee=win.entry_fee,
        exit_fee=win.exit_fee, funding_cost=win.funding, slippage_cost=win.slippage,
        gross_profit=win.gross, net_profit=win.net, net_roi=win.roi, max_loss=-loss.net,
        account_risk_pct=-loss.net / equity, reward_risk=rr, liquidation_price=liq,
        expected_hold_hours=hold, stop_fee=loss.exit_fee,
    )
