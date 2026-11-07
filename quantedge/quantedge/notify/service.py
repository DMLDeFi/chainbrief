"""Central notification service.

One call fans the *same* verified message out to every configured channel and
recipient.  De-duplication is enforced by a unique (idempotency_key, channel,
recipient) row in the database, so restarts or retries cannot double-send.
"""
from __future__ import annotations

import asyncio
import logging

from ..db.repo import Repo
from ..models import Signal
from .formatter import fmt_price, pair, signal_message

log = logging.getLogger(__name__)


class NotificationService:
    def __init__(self, repo: Repo, channels: dict[str, tuple[object, list[str]]], max_retries: int = 3):
        """``channels``: name -> (channel object, recipients)."""
        self.repo = repo
        self.channels = channels
        self.max_retries = max_retries

    async def dispatch(self, key: str, kind: str, text: str, *, signal_id: str | None = None,
                       template_params: list[str] | None = None) -> dict[str, int]:
        stats = {"sent": 0, "failed": 0, "skipped_duplicate": 0}
        jobs = []
        for cname, (chan, recipients) in self.channels.items():
            for rcpt in recipients:
                nid = self.repo.claim_notification(key, cname, rcpt, kind, signal_id)
                if nid is None:
                    stats["skipped_duplicate"] += 1
                    continue
                jobs.append(self._send(nid, chan, rcpt, text, kind, template_params))
        for ok in await asyncio.gather(*jobs):
            stats["sent" if ok else "failed"] += 1
        return stats

    async def _send(self, nid: int, chan, rcpt: str, text: str, kind: str, params) -> bool:
        delay = 1.0
        for attempt in range(self.max_retries):
            res = await chan.send(rcpt, text, kind, params)
            if res.ok:
                self.repo.update_notification(nid, status="sent", provider_id=res.provider_id)
                return True
            if not res.retryable or attempt == self.max_retries - 1:
                self.repo.update_notification(nid, status="failed", error=res.error)
                log.error("notification %s via %s failed: %s", nid, chan.name, res.error)
                return False
            await asyncio.sleep(delay)
            delay *= 2
        return False

    async def publish_signal(self, s: Signal, explanation: str | None = None) -> dict[str, int]:
        p = s.plan
        params = [pair(s.symbol), s.direction.value, fmt_price(p.entry), fmt_price(p.take_profit),
                  fmt_price(p.stop), f"{p.account_risk_pct * 100:.2f}%", f"{s.score:.0f}/100", s.signal_id]
        return await self.dispatch(f"{s.signal_id}:SIGNAL", "SIGNAL", signal_message(s, explanation),
                                   signal_id=s.signal_id, template_params=params)

    async def publish_event(self, key: str, kind: str, text: str, *, signal_id: str | None = None,
                            title: str = "", symbol: str = "", details: str = "") -> dict[str, int]:
        params = [title or kind.replace("_", " "), pair(symbol) if symbol else "-", details or "-", signal_id or "-"] \
            if signal_id else [title or kind.replace("_", " "), details or text[:900]]
        return await self.dispatch(key, kind, text, signal_id=signal_id, template_params=params)
