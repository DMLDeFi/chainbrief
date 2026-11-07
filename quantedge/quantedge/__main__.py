"""Command-line entry point.

    python -m quantedge serve            # API + dashboard (+ engine if QE_START_ENGINE=true)
    python -m quantedge fetch  --symbols BTCUSDT,ETHUSDT --days 180 --out data/
    python -m quantedge backtest --data data/ [--walk-forward] [--monte-carlo]
    python -m quantedge backtest --synthetic          # offline pipeline demo (not evidence of edge)
    python -m quantedge hash-password
"""
from __future__ import annotations

import argparse
import asyncio
import getpass
import json
import logging
import os
import sys
import time
from pathlib import Path

from .config import load_config


def _json_default(o):
    return float(o) if hasattr(o, "__float__") else str(o)


async def _fetch(symbols: list[str], days: int, out: Path) -> None:
    from dataclasses import asdict
    from .exchange.bybit_rest import BybitREST
    cfg = load_config()
    rest = BybitREST(testnet=cfg.bybit_testnet)
    out.mkdir(parents=True, exist_ok=True)
    end = int(time.time() * 1000) // 300_000 * 300_000
    start = end - days * 86_400_000
    insts = {i.symbol: i for i in await rest.instruments()}
    for sym in symbols:
        if sym not in insts:
            print(f"skip {sym}: not listed")
            continue
        candles = await rest.kline_history(sym, "5", start, end)
        funding = []
        cur = start
        while cur < end:   # funding history is paged by 200 rows (~66 days at 8h)
            chunk = await rest.funding_history(sym, cur, min(end, cur + 60 * 86_400_000))
            funding += chunk
            cur += 60 * 86_400_000
        payload = {"instrument": asdict(insts[sym]), "candles": [asdict(c) for c in candles if c.confirmed],
                   "funding": sorted(set(funding))}
        (out / f"{sym}.json").write_text(json.dumps(payload))
        print(f"{sym}: {len(payload['candles'])} 5m bars, {len(funding)} funding prints")
    await rest.close()


def _load_dir(path: Path):
    from .backtest.engine import SymbolData
    from .models import Candle, Instrument
    data = {}
    for f in sorted(path.glob("*.json")):
        d = json.loads(f.read_text())
        data[f.stem] = SymbolData(Instrument(**d["instrument"]), [Candle(**c) for c in d["candles"]],
                                  [tuple(x) for x in d.get("funding", [])])
    return data


def _synthetic():
    from .backtest.engine import SymbolData
    from .backtest.synthetic import make_instrument, regime_walk
    syms = [("BTCUSDT", 60000), ("ETHUSDT", 3000), ("SOLUSDT", 150), ("XRPUSDT", 0.6)]
    return {s: SymbolData(make_instrument(s, p), regime_walk(288 * 150, p, seed=i + 1, base_volume=8e7 / p / 288))
            for i, (s, p) in enumerate(syms)}


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser("quantedge")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sv = sub.add_parser("serve")
    sv.add_argument("--host", default="0.0.0.0")
    sv.add_argument("--port", type=int, default=8000)
    fe = sub.add_parser("fetch")
    fe.add_argument("--symbols", required=True)
    fe.add_argument("--days", type=int, default=180)
    fe.add_argument("--out", default="data")
    bt = sub.add_parser("backtest")
    bt.add_argument("--data")
    bt.add_argument("--synthetic", action="store_true")
    bt.add_argument("--walk-forward", action="store_true")
    bt.add_argument("--monte-carlo", action="store_true")
    bt.add_argument("--out", default="backtest_report.json")
    sub.add_parser("hash-password")
    a = ap.parse_args(argv)
    logging.basicConfig(level=os.environ.get("QE_LOG_LEVEL", "INFO"),
                        format='{"ts":"%(asctime)s","lvl":"%(levelname)s","mod":"%(name)s","msg":"%(message)s"}')

    if a.cmd == "serve":
        import uvicorn
        from .api.app import create_app
        uvicorn.run(create_app(), host=a.host, port=a.port, log_level="info")
    elif a.cmd == "fetch":
        asyncio.run(_fetch([s.strip().upper() for s in a.symbols.split(",")], a.days, Path(a.out)))
    elif a.cmd == "backtest":
        from .backtest.engine import Backtester
        from .backtest.metrics import monte_carlo
        from .backtest.validation import walk_forward
        cfg = load_config()
        if a.synthetic:
            data = _synthetic()
            cfg.scanner.min_turnover_24h = 1e6
            print("WARNING: synthetic data exercises the pipeline only; results are not evidence of edge.")
        elif a.data:
            data = _load_dir(Path(a.data))
        else:
            ap.error("--data or --synthetic required")
        res = Backtester(cfg).run(data)
        report = {"signals": res.signals, "unfilled": res.unfilled, "rejections_by_stage": res.rejections,
                  "summary": {k: v for k, v in res.summary.items() if k != "equity_curve"}}
        if a.monte_carlo:
            report["monte_carlo"] = monte_carlo(res.trades, 10_000.0)
        if a.walk_forward:
            wf = walk_forward(cfg, data, {"trading.min_quality_score": [90.0, 93.0]}, train_days=60, test_days=30,
                              start_ms=res.start_ms, end_ms=res.end_ms)
            report["walk_forward"] = {"folds": wf["folds"],
                                      "oos": {k: v for k, v in wf["oos_summary"].items() if k != "equity_curve"}}
        Path(a.out).write_text(json.dumps(report, indent=2, default=_json_default))
        print(json.dumps(report["summary"] if res.trades else report, indent=2, default=_json_default)[:4000])
        print(f"full report: {a.out}")
    elif a.cmd == "hash-password":
        from .api.auth import hash_password
        pw = getpass.getpass("password: ")
        if len(pw) < 12:
            print("use at least 12 characters", file=sys.stderr)
            return 1
        print(hash_password(pw))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
