"""Performance statistics on completed (filled) trades only."""
from __future__ import annotations

import math
from collections import defaultdict
from dataclasses import asdict

import numpy as np

from ..monitor.tracker import TradeResult


def max_drawdown(equity: np.ndarray) -> float:
    if len(equity) == 0:
        return 0.0
    peak = np.maximum.accumulate(equity)
    return float(((peak - equity) / peak).max())


def max_consecutive_losses(pnls: list[float]) -> int:
    best = cur = 0
    for p in pnls:
        cur = cur + 1 if p < 0 else 0
        best = max(best, cur)
    return best


def summarize(trades: list[TradeResult], start_equity: float, days: float | None = None) -> dict:
    trades = sorted(trades, key=lambda t: t.exit_ts)
    n = len(trades)
    if n == 0:
        return {"trades": 0, "note": "no completed trades"}
    pnl = np.array([t.net_pnl for t in trades])
    r = np.array([t.r_multiple for t in trades])
    roi = np.array([t.net_roi for t in trades])
    wins, losses = pnl[pnl > 0], pnl[pnl < 0]
    equity = start_equity + np.cumsum(pnl)
    curve = np.concatenate([[start_equity], equity])
    mdd = max_drawdown(curve)
    ret = pnl / np.concatenate([[start_equity], equity[:-1]])
    sharpe = float(ret.mean() / ret.std(ddof=1) * math.sqrt(n)) if n > 1 and ret.std(ddof=1) > 0 else float("nan")
    downside = ret[ret < 0]
    sortino = float(ret.mean() / downside.std(ddof=1) * math.sqrt(n)) if len(downside) > 1 and downside.std(ddof=1) > 0 else float("nan")
    # per-day annualised Sharpe when duration is known
    if days and days > 0 and n > 1:
        per_year = n / days * 365
        sharpe_ann = float(ret.mean() / ret.std(ddof=1) * math.sqrt(per_year)) if ret.std(ddof=1) > 0 else float("nan")
    else:
        sharpe_ann = float("nan")
    net = float(pnl.sum())
    out = {
        "trades": n,
        "win_rate": float((pnl > 0).mean()),
        "profit_factor": float(wins.sum() / -losses.sum()) if len(losses) else float("inf"),
        "expectancy": float(pnl.mean()),
        "expectancy_r": float(r.mean()),
        "expectancy_r_lower95": float(r.mean() - 1.645 * r.std(ddof=1) / math.sqrt(n)) if n > 1 else float("nan"),
        "net_pnl": net,
        "return_pct": net / start_equity,
        "avg_net_roi": float(roi.mean()),
        "max_drawdown": mdd,
        "sharpe_per_trade_sqrtN": sharpe,
        "sharpe_annualised": sharpe_ann,
        "sortino_sqrtN": sortino,
        "max_consecutive_losses": max_consecutive_losses(list(pnl)),
        "recovery_factor": float(net / (mdd * start_equity)) if mdd > 0 else float("inf"),
        "avg_hold_hours": float(np.mean([t.hold_hours for t in trades])),
        "avg_mfe": float(np.mean([t.mfe for t in trades])),
        "avg_mae": float(np.mean([t.mae for t in trades])),
        "fees": float(sum(t.fees for t in trades)),
        "funding": float(sum(t.funding for t in trades)),
        "by_regime": _group(trades, "regime"),
        "by_symbol": _group(trades, "symbol"),
        "by_strategy": _group(trades, "strategy"),
        "equity_curve": [float(x) for x in curve],
    }
    return out


def _group(trades: list[TradeResult], key: str) -> dict:
    g: dict[str, list[TradeResult]] = defaultdict(list)
    for t in trades:
        g[getattr(t, key)].append(t)
    out = {}
    for k, ts in g.items():
        p = np.array([t.net_pnl for t in ts])
        out[k] = {"trades": len(ts), "win_rate": float((p > 0).mean()), "net_pnl": float(p.sum()),
                  "expectancy_r": float(np.mean([t.r_multiple for t in ts]))}
    return out


def monte_carlo(trades: list[TradeResult], start_equity: float, runs: int = 2000,
                seed: int = 7, ruin_dd: float = 0.10) -> dict:
    """Bootstrap the trade sequence (with replacement) to estimate the
    distribution of outcomes and drawdowns."""
    if not trades:
        return {"runs": 0}
    rng = np.random.default_rng(seed)
    pnl = np.array([t.net_pnl for t in trades])
    n = len(pnl)
    finals, dds = np.empty(runs), np.empty(runs)
    for i in range(runs):
        seq = rng.choice(pnl, size=n, replace=True)
        curve = np.concatenate([[start_equity], start_equity + np.cumsum(seq)])
        finals[i] = curve[-1]
        dds[i] = max_drawdown(curve)
    return {"runs": runs, "final_equity_p5": float(np.percentile(finals, 5)),
            "final_equity_p50": float(np.percentile(finals, 50)),
            "final_equity_p95": float(np.percentile(finals, 95)),
            "max_dd_p50": float(np.percentile(dds, 50)), "max_dd_p95": float(np.percentile(dds, 95)),
            "prob_loss": float((finals < start_equity).mean()),
            f"prob_dd_over_{int(ruin_dd * 100)}pct": float((dds > ruin_dd).mean())}


def trades_to_dicts(trades: list[TradeResult]) -> list[dict]:
    return [asdict(t) for t in trades]
