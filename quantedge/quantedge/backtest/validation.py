"""Walk-forward validation, robustness checks and the live-deployment gate."""
from __future__ import annotations

import copy
import itertools
from dataclasses import dataclass, field

from ..analysis.features import INTERVAL_MS
from ..config import AppConfig
from ..monitor.tracker import TradeResult
from .engine import Backtester, SymbolData
from .metrics import max_drawdown, summarize

DAY = INTERVAL_MS["D"]


def _set(cfg: AppConfig, dotted: str, value) -> None:
    obj = cfg
    *path, leaf = dotted.split(".")
    for p in path:
        obj = getattr(obj, p)
    setattr(obj, leaf, value)


def objective(summary: dict, min_trades: int) -> float:
    """Lower-bound expectancy in R, penalised when the sample is too small."""
    if summary.get("trades", 0) < min_trades:
        return float("-inf")
    return summary["expectancy_r_lower95"]


@dataclass
class Fold:
    train: tuple[int, int]
    test: tuple[int, int]
    params: dict
    train_summary: dict
    test_summary: dict
    test_trades: list[TradeResult] = field(default_factory=list)


def walk_forward(cfg: AppConfig, data: dict[str, SymbolData], grid: dict[str, list],
                 train_days: int, test_days: int, start_ms: int, end_ms: int,
                 min_train_trades: int = 10, start_equity: float = 10_000.0) -> dict:
    """Anchored-window walk-forward: optimise on [t, t+train), evaluate untouched on
    [t+train, t+train+test), roll forward by ``test_days``.  Only out-of-sample
    trades are aggregated."""
    folds: list[Fold] = []
    keys = list(grid)
    combos = [dict(zip(keys, v)) for v in itertools.product(*grid.values())] or [{}]
    t = start_ms
    while t + (train_days + test_days) * DAY <= end_ms:
        tr = (t, t + train_days * DAY)
        te = (tr[1], tr[1] + test_days * DAY)
        best, best_score, best_sum = combos[0], float("-inf"), {}
        for params in combos:
            c = copy.deepcopy(cfg)
            for k, v in params.items():
                _set(c, k, v)
            res = Backtester(c, start_equity).run(data, *tr)
            sc = objective(res.summary, min_train_trades)
            if sc > best_score:
                best, best_score, best_sum = params, sc, res.summary
        c = copy.deepcopy(cfg)
        for k, v in best.items():
            _set(c, k, v)
        test = Backtester(c, start_equity).run(data, *te)
        folds.append(Fold(tr, te, best, best_sum, test.summary, test.trades))
        t += test_days * DAY
    oos = [x for f in folds for x in f.test_trades]
    return {"folds": [{"train": f.train, "test": f.test, "params": f.params,
                       "train_trades": f.train_summary.get("trades", 0),
                       "test": {k: v for k, v in f.test_summary.items() if k not in ("equity_curve", "by_symbol")}}
                      for f in folds],
            "oos_summary": summarize(oos, start_equity), "oos_trades": oos}


def parameter_robustness(cfg: AppConfig, data: dict[str, SymbolData], param: str, values: list,
                         start_ms: int, end_ms: int) -> list[dict]:
    """Sensitivity sweep: a robust strategy degrades gracefully around its chosen value."""
    out = []
    for v in values:
        c = copy.deepcopy(cfg)
        _set(c, param, v)
        s = Backtester(c).run(data, start_ms, end_ms).summary
        out.append({param: v, "trades": s.get("trades", 0), "expectancy_r": s.get("expectancy_r"),
                    "profit_factor": s.get("profit_factor"), "max_drawdown": s.get("max_drawdown")})
    return out


@dataclass
class GateResult:
    approved: bool
    checks: dict[str, tuple[bool, str]]


def deployment_gate(paper_trades: list[TradeResult], start_equity: float, *, min_trades: int = 300,
                    min_regimes: int = 3, min_symbols: int = 10, min_pf: float = 1.2,
                    max_dd: float = 0.06, max_single_symbol_share: float = 0.25) -> GateResult:
    """Live deployment is only considered when every check passes.  Win rate is
    reported but deliberately *not* a criterion."""
    s = summarize(paper_trades, start_equity) if paper_trades else {"trades": 0}
    n = s.get("trades", 0)
    regimes = s.get("by_regime", {})
    symbols = s.get("by_symbol", {})
    top_share = max((v["trades"] for v in symbols.values()), default=0) / n if n else 1.0
    checks = {
        "sample_size": (n >= min_trades, f"{n}/{min_trades} completed paper signals"),
        "regime_diversity": (sum(1 for v in regimes.values() if v["trades"] >= 20) >= min_regimes,
                             f"{len(regimes)} regimes seen (>=20 trades each required in {min_regimes})"),
        "symbol_diversity": (len(symbols) >= min_symbols and top_share <= max_single_symbol_share,
                             f"{len(symbols)} symbols, top symbol {top_share:.0%} of trades"),
        "positive_expectancy": (n > 1 and s["expectancy_r_lower95"] > 0,
                                f"lower-95% expectancy {s.get('expectancy_r_lower95', float('nan')):+.3f}R"),
        "profit_factor": (n > 0 and s["profit_factor"] >= min_pf, f"PF {s.get('profit_factor', 0):.2f} (>= {min_pf})"),
        "drawdown": (n > 0 and s["max_drawdown"] <= max_dd, f"max DD {s.get('max_drawdown', 0):.2%} (<= {max_dd:.0%})"),
    }
    return GateResult(all(v[0] for v in checks.values()), checks)


__all__ = ["walk_forward", "parameter_robustness", "deployment_gate", "max_drawdown"]
