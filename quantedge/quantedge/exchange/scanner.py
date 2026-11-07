"""Universe discovery and liquidity / execution filters."""
from __future__ import annotations

import statistics
import time
from collections import defaultdict, deque
from dataclasses import dataclass, field

from ..config import ScannerConfig
from ..models import Instrument, MarketSnapshot, OrderBook
from ..signals.context import Eligibility

DAY_MS = 86_400_000


@dataclass
class ScanRow:
    symbol: str
    eligible: bool
    reasons: list[str]
    turnover_24h: float
    spread_bps: float
    funding_rate: float
    change_24h: float
    oi_change: float = 0.0
    volume_spike: float = 0.0
    new_listing: bool = False
    regime: str = ""
    candidate_score: float | None = None
    trend: str = ""


@dataclass
class Scanner:
    cfg: ScannerConfig
    instruments: dict[str, Instrument] = field(default_factory=dict)
    known: set[str] = field(default_factory=set)
    spread_hist: dict[str, deque] = field(default_factory=lambda: defaultdict(lambda: deque(maxlen=120)))
    turnover_hist: dict[str, deque] = field(default_factory=lambda: defaultdict(lambda: deque(maxlen=48)))
    oi_hist: dict[str, deque] = field(default_factory=lambda: defaultdict(lambda: deque(maxlen=48)))
    rows: dict[str, ScanRow] = field(default_factory=dict)

    def update_universe(self, instruments: list[Instrument]) -> list[str]:
        """Returns symbols that are newly listed since the previous refresh."""
        perps = {i.symbol: i for i in instruments
                 if i.contract_type == "LinearPerpetual" and i.quote_coin == "USDT"}
        new = [s for s in perps if self.known and s not in self.known]
        self.instruments = perps
        self.known |= set(perps)
        return new

    def static_filters(self, inst: Instrument, now_ms: int) -> list[str]:
        r = []
        if inst.status != "Trading":
            r.append(f"status {inst.status}")
        if inst.symbol in self.cfg.exclude:
            r.append("excluded by config")
        age_days = (now_ms - inst.launch_time) / DAY_MS if inst.launch_time else 1e9
        if age_days < self.cfg.min_listing_days:
            r.append(f"listed {age_days:.0f}d ago (< {self.cfg.min_listing_days}d)")
        if inst.max_leverage < 2.5:
            r.append("exchange max leverage < 2.5x")
        if inst.tick_size <= 0 or inst.qty_step <= 0:
            r.append("invalid contract filters")
        return r

    def evaluate(self, snap: MarketSnapshot, book: OrderBook | None, now_ms: int | None = None) -> Eligibility:
        now_ms = int(time.time() * 1000) if now_ms is None else now_ms
        inst = self.instruments.get(snap.symbol)
        reasons = [] if inst else ["not a USDT linear perpetual"]
        if inst:
            reasons += self.static_filters(inst, now_ms)
        sp = snap.spread_bps
        hist = self.spread_hist[snap.symbol]
        if sp != float("inf"):
            hist.append(sp)
        med = statistics.median(hist) if len(hist) >= 10 else sp
        ratio = sp / med if med and med > 0 and sp != float("inf") else 1.0
        if sp > self.cfg.max_spread_bps:
            reasons.append(f"spread {sp:.1f}bps > {self.cfg.max_spread_bps}")
        if snap.turnover_24h < self.cfg.min_turnover_24h:
            reasons.append(f"24h turnover ${snap.turnover_24h / 1e6:.1f}M < ${self.cfg.min_turnover_24h / 1e6:.0f}M")
        if snap.index > 0 and abs(snap.mark / snap.index - 1) > self.cfg.max_mark_index_deviation:
            reasons.append("mark/index deviation abnormal")
        bid_d = ask_d = 0.0
        fresh = time.time() - snap.ts <= self.cfg.stale_after_seconds
        if book is not None:
            bid_d, ask_d = book.depth_usdt(self.cfg.depth_band)
            fresh = fresh and time.time() - book.ts <= self.cfg.stale_after_seconds
            if min(bid_d, ask_d) < self.cfg.min_depth_usdt:
                reasons.append(f"depth ${min(bid_d, ask_d) / 1e3:.0f}k within {self.cfg.depth_band:.1%} < ${self.cfg.min_depth_usdt / 1e3:.0f}k")
        else:
            reasons.append("order book unavailable")
        if not fresh:
            reasons.append("stale market data")
        return Eligibility(not reasons, reasons, sp, bid_d, ask_d, snap.turnover_24h, ratio, fresh)

    def record_metrics(self, snap: MarketSnapshot, oi_value: float | None = None) -> tuple[float, float]:
        """Track hourly turnover/OI samples; returns (volume spike ratio, OI change)."""
        th = self.turnover_hist[snap.symbol]
        th.append(snap.turnover_24h)
        spike = th[-1] / statistics.mean(list(th)[:-1]) if len(th) > 5 and statistics.mean(list(th)[:-1]) > 0 else 1.0
        oh = self.oi_hist[snap.symbol]
        oh.append(oi_value if oi_value is not None else snap.open_interest_value)
        oi_chg = oh[-1] / oh[0] - 1 if len(oh) > 1 and oh[0] > 0 else 0.0
        return spike, oi_chg

    def prefilter(self, snaps: list[MarketSnapshot]) -> list[MarketSnapshot]:
        """Cheap ticker-only pass to decide which symbols deserve order-book / candle requests."""
        ok = [s for s in snaps if s.symbol in self.instruments
              and s.turnover_24h >= self.cfg.min_turnover_24h and s.spread_bps <= self.cfg.max_spread_bps * 1.5]
        ok.sort(key=lambda s: s.turnover_24h, reverse=True)
        return ok[: self.cfg.max_symbols]
