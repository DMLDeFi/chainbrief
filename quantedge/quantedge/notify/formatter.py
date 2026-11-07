"""Message formatting.  All numbers come from the signal/plan objects; nothing is invented here."""
from __future__ import annotations

import time

from ..models import Signal

RULE = "━━━━━━━━━━━━━━━━━━━━"


def fmt_price(x: float) -> str:
    if x == 0:
        return "0"
    mag = abs(x)
    dec = 2 if mag >= 1000 else 3 if mag >= 100 else 4 if mag >= 1 else 6 if mag >= 0.01 else 8
    return f"{x:,.{dec}f}"


def ts_str(ms: int) -> str:
    return time.strftime("%Y-%m-%d %H:%M UTC", time.gmtime(ms / 1000))


def pair(symbol: str) -> str:
    return symbol[:-4] + "/USDT" if symbol.endswith("USDT") else symbol


def signal_message(s: Signal, explanation: str | None = None) -> str:
    p = s.plan
    lines = [
        RULE, "QUANTEDGE AI ELITE", "<PRIVATE_SIGNAL>" + ("  [PAPER]" if s.paper else ""), RULE, "",
        f"PAIR: {pair(s.symbol)}", "EXCHANGE: BYBIT", f"DIRECTION: {s.direction.value}",
        f"LEVERAGE: {p.leverage:g}X", "MARGIN MODE: ISOLATED", "",
        f"ENTRY PRICE: {fmt_price(p.entry)}",
        f"ENTRY ZONE: {fmt_price(s.entry_zone[0])} – {fmt_price(s.entry_zone[1])}", "",
        f"TAKE PROFIT: {fmt_price(p.take_profit)}", f"STOP LOSS: {fmt_price(p.stop)}", "",
        f"TARGET NET ROI: +{p.net_roi * 100:.0f}%",
        f"EXPECTED RISK: {p.account_risk_pct * 100:.2f}% of account equity", "",
        f"SIGNAL QUALITY: {s.score:.0f}/100" + ("" if s.calibrated else " (uncalibrated)"), "",
        f"MARKET REGIME: {s.regime.value.replace('_', ' ')}",
        f"TREND CONFIRMATION: {s.trend_status}",
        f"VOLUME CONFIRMATION: {s.volume_status}",
        f"LIQUIDITY: {s.liquidity_status}", "",
        "WHY THIS TRADE?", explanation or s.rationale, "",
        "INVALIDATION CONDITION:", s.invalidation, "",
        f"SIGNAL ID: {s.signal_id}", f"TIME: {ts_str(s.created_ms)}", "",
        RULE, "Capital preservation comes first.", "Always use the prescribed stop loss.", RULE,
    ]
    return "\n".join(lines)


EVENT_TITLES = {
    "ENTRY_CONFIRMED": "ENTRY CONFIRMED", "PARTIAL_FILL": "PARTIAL ENTRY", "TAKE_PROFIT": "TAKE PROFIT REACHED",
    "STOP_LOSS": "STOP LOSS REACHED", "EXPIRED": "SIGNAL EXPIRED", "CANCELLED": "SIGNAL CANCELLED",
    "INVALIDATED": "SIGNAL INVALIDATED", "TIME_EXIT": "TIME EXIT", "MARKET_CHANGED": "MARKET CONDITIONS CHANGED",
    "DAILY_LOSS_LIMIT": "DAILY LOSS LIMIT REACHED", "NO_TRADE": "NO QUALIFIED TRADE SETUPS TODAY",
    "EMERGENCY": "EMERGENCY RISK ALERT",
}


def event_message(kind: str, *, signal_id: str | None = None, symbol: str | None = None,
                  direction: str | None = None, lines: list[str] | None = None, ts_ms: int | None = None) -> str:
    title = EVENT_TITLES.get(kind, kind.replace("_", " "))
    out = [RULE, f"QUANTEDGE AI ELITE — {title}", RULE]
    if symbol:
        out.append(f"PAIR: {pair(symbol)}" + (f"  {direction}" if direction else ""))
    out += lines or []
    if signal_id:
        out.append(f"SIGNAL ID: {signal_id}")
    out.append(f"TIME: {ts_str(ts_ms or int(time.time() * 1000))}")
    out.append(RULE)
    return "\n".join(out)


def outcome_lines(result) -> list[str]:
    return [f"EXIT PRICE: {fmt_price(result.exit_price)}", f"FILLED QTY: {result.filled_qty:g} @ {fmt_price(result.avg_entry)}",
            f"NET P&L: {result.net_pnl:+,.2f} USDT", f"NET ROI ON MARGIN: {result.net_roi * 100:+.2f}%",
            f"R-MULTIPLE: {result.r_multiple:+.2f}R", f"FEES: {result.fees:,.2f}  FUNDING: {result.funding:+,.2f}",
            f"HOLD: {result.hold_hours:.1f}h  MFE {result.mfe * 100:.2f}%  MAE {result.mae * 100:.2f}%"]


def report_message(title: str, summary: dict, extra: list[str] | None = None) -> str:
    if not summary.get("trades"):
        body = ["Completed trades: 0"]
    else:
        body = [f"Completed trades: {summary['trades']}", f"Win rate: {summary['win_rate']:.1%}",
                f"Profit factor: {summary['profit_factor']:.2f}", f"Expectancy: {summary['expectancy_r']:+.2f}R",
                f"Net P&L: {summary['net_pnl']:+,.2f} USDT", f"Max drawdown: {summary['max_drawdown']:.2%}"]
    return "\n".join([RULE, f"QUANTEDGE AI ELITE — {title}", RULE, *body, *(extra or []), RULE])
