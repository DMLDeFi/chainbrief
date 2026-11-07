"""Score calibration against realised outcomes.

Outcomes are recorded in R-multiples (net P&L / planned max loss) for *filled
and completed* signals only.  Unfilled signals are never counted.  A score
bucket is "calibrated" once it holds ``min_samples`` outcomes; it is then only
acceptable if the one-sided 95% lower confidence bound of its mean R is > 0.
Until calibration exists, signals are labelled UNCALIBRATED; in live mode
(``require_calibration=True``) they are rejected.
"""
from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

BUCKETS = [(0, 80), (80, 90), (90, 93), (93, 96), (96, 100.01)]


@dataclass
class Assessment:
    calibrated: bool
    acceptable: bool
    n: int
    mean_r: float
    lower_r: float
    win_rate: float
    reason: str = ""


def bucket_of(score: float) -> tuple[float, float]:
    for lo, hi in BUCKETS:
        if lo <= score < hi:
            return lo, hi
    return BUCKETS[-1]


def mean_lower_bound(r: np.ndarray, z: float = 1.645) -> float:
    if len(r) < 2:
        return float("-inf")
    return float(r.mean() - z * r.std(ddof=1) / math.sqrt(len(r)))


class Calibrator:
    def __init__(self, min_samples: int = 50, require_calibration: bool = False):
        self.min_samples = min_samples
        self.require = require_calibration
        self.outcomes: list[tuple[float, float]] = []   # (score, R)

    def add(self, score: float, r_multiple: float) -> None:
        self.outcomes.append((float(score), float(r_multiple)))

    def load(self, rows: list[tuple[float, float]]) -> None:
        self.outcomes = [(float(a), float(b)) for a, b in rows]

    def assess(self, score: float) -> Assessment:
        lo, hi = bucket_of(score)
        r = np.array([o for s, o in self.outcomes if lo <= s < hi], float)
        n = len(r)
        if n < self.min_samples:
            ok = not self.require
            return Assessment(False, ok, n, float(r.mean()) if n else float("nan"), float("nan"),
                              float((r > 0).mean()) if n else float("nan"),
                              "" if ok else f"score bucket {lo}-{hi:.0f} uncalibrated ({n}/{self.min_samples} outcomes)")
        lb = mean_lower_bound(r)
        ok = lb > 0
        return Assessment(True, ok, n, float(r.mean()), lb, float((r > 0).mean()),
                          "" if ok else f"bucket {lo}-{hi:.0f} lower-bound expectancy {lb:+.2f}R <= 0")

    def table(self) -> list[dict]:
        out = []
        for lo, hi in BUCKETS:
            r = np.array([o for s, o in self.outcomes if lo <= s < hi], float)
            out.append({"bucket": f"{lo}-{min(hi, 100):.0f}", "n": len(r),
                        "win_rate": float((r > 0).mean()) if len(r) else None,
                        "mean_r": float(r.mean()) if len(r) else None,
                        "lower_r": mean_lower_bound(r) if len(r) > 1 else None})
        return out
