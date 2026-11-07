"""Repository: the only place that talks SQL."""
from __future__ import annotations

from dataclasses import asdict
from typing import Any

from sqlalchemy import create_engine, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker

from ..models import Signal
from ..monitor.tracker import TradeResult
from .models import (AuditRow, Base, KVRow, NotificationRow, RejectionRow, SignalEventRow, SignalRow,
                     TradeRow, UserRow, now_ms)


class Repo:
    def __init__(self, url: str):
        kw: dict[str, Any] = {"future": True, "pool_pre_ping": True}
        if url.startswith("sqlite"):
            kw["connect_args"] = {"check_same_thread": False}
            if url in ("sqlite://", "sqlite:///:memory:"):
                from sqlalchemy.pool import StaticPool
                kw["poolclass"] = StaticPool
        self.engine = create_engine(url, **kw)
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(self.engine, expire_on_commit=False)

    # ---------------- signals ----------------
    def save_signal(self, s: Signal, explanation: str = "") -> None:
        with self.Session.begin() as db:
            db.merge(SignalRow(
                signal_id=s.signal_id, symbol=s.symbol, direction=s.direction.value, strategy=s.strategy,
                status=s.status.value, score=s.score, components=s.component_scores,
                plan={k: (v.value if hasattr(v, "value") else v) for k, v in asdict(s.plan).items()},
                entry_low=s.entry_zone[0], entry_high=s.entry_zone[1], regime=s.regime.value,
                trend_status=s.trend_status, volume_status=s.volume_status,
                liquidity_status=s.liquidity_status, rationale=s.rationale, invalidation=s.invalidation,
                invalidation_price=s.invalidation_price, created_ms=s.created_ms, expires_ms=s.expires_ms,
                paper=s.paper, calibrated=s.calibrated, explanation=explanation))

    def set_status(self, signal_id: str, status: str) -> None:
        with self.Session.begin() as db:
            row = db.get(SignalRow, signal_id)
            if row:
                row.status = status

    def add_event(self, signal_id: str, ts: int, kind: str, data: dict | None = None) -> None:
        with self.Session.begin() as db:
            db.add(SignalEventRow(signal_id=signal_id, ts=ts, kind=kind, data=data or {}))

    def signals(self, status: list[str] | None = None, limit: int = 200) -> list[SignalRow]:
        with self.Session() as db:
            q = select(SignalRow).order_by(SignalRow.created_ms.desc()).limit(limit)
            if status:
                q = q.where(SignalRow.status.in_(status))
            return list(db.scalars(q))

    def signal(self, signal_id: str) -> tuple[SignalRow | None, list[SignalEventRow]]:
        with self.Session() as db:
            ev = list(db.scalars(select(SignalEventRow).where(SignalEventRow.signal_id == signal_id)
                                 .order_by(SignalEventRow.ts)))
            return db.get(SignalRow, signal_id), ev

    def signals_since(self, ts_ms: int) -> int:
        with self.Session() as db:
            return db.scalar(select(func.count()).select_from(SignalRow).where(SignalRow.created_ms >= ts_ms)) or 0

    # ---------------- trades ----------------
    def save_trade(self, t: TradeResult, paper: bool = True) -> None:
        with self.Session.begin() as db:
            db.merge(TradeRow(**asdict(t), paper=paper))

    def trades(self, since_ms: int = 0, paper: bool | None = None) -> list[TradeRow]:
        with self.Session() as db:
            q = select(TradeRow).where(TradeRow.exit_ts >= since_ms).order_by(TradeRow.exit_ts)
            if paper is not None:
                q = q.where(TradeRow.paper == paper)
            return list(db.scalars(q))

    @staticmethod
    def to_result(r: TradeRow) -> TradeResult:
        return TradeResult(**{k: getattr(r, k) for k in TradeResult.__dataclass_fields__})

    # ---------------- rejections ----------------
    def add_rejection(self, ts: int, symbol: str, strategy: str, direction: str, stage: str,
                      reasons: list[str], score: float = 0.0) -> None:
        with self.Session.begin() as db:
            db.add(RejectionRow(ts=ts, symbol=symbol, strategy=strategy, direction=direction, stage=stage,
                                reasons=reasons, score=score))

    def rejections(self, limit: int = 200) -> list[RejectionRow]:
        with self.Session() as db:
            return list(db.scalars(select(RejectionRow).order_by(RejectionRow.ts.desc()).limit(limit)))

    def rejection_counts(self, since_ms: int) -> dict[str, int]:
        with self.Session() as db:
            rows = db.execute(select(RejectionRow.stage, func.count()).where(RejectionRow.ts >= since_ms)
                              .group_by(RejectionRow.stage)).all()
            return {a: b for a, b in rows}

    # ---------------- notifications ----------------
    def claim_notification(self, key: str, channel: str, recipient: str, kind: str,
                           signal_id: str | None) -> int | None:
        """Insert a pending notification; returns None if this exact message was already claimed
        (unique constraint) — the database is the arbiter of de-duplication."""
        try:
            with self.Session.begin() as db:
                row = NotificationRow(idempotency_key=key, channel=channel, recipient=recipient, kind=kind,
                                      signal_id=signal_id)
                db.add(row)
                db.flush()
                return row.id
        except IntegrityError:
            with self.Session.begin() as db:
                row = db.scalar(select(NotificationRow).where(
                    NotificationRow.idempotency_key == key, NotificationRow.channel == channel,
                    NotificationRow.recipient == recipient))
                if row is not None and row.status == "failed" and row.attempts < 5:
                    row.status = "pending"
                    return row.id
            return None

    def update_notification(self, nid: int, *, status: str, provider_id: str | None = None,
                            error: str | None = None) -> None:
        with self.Session.begin() as db:
            row = db.get(NotificationRow, nid)
            if row:
                row.status, row.attempts = status, row.attempts + 1
                row.provider_message_id = provider_id or row.provider_message_id
                row.error = error

    def update_delivery_by_provider_id(self, provider_id: str, status: str, error: str | None = None) -> bool:
        order = {"pending": 0, "sent": 1, "delivered": 2, "read": 3, "failed": 4}
        with self.Session.begin() as db:
            row = db.scalar(select(NotificationRow).where(NotificationRow.provider_message_id == provider_id))
            if not row:
                return False
            if order.get(status, 0) >= order.get(row.status, 0):
                row.status, row.error = status, error or row.error
            return True

    def notifications(self, limit: int = 200) -> list[NotificationRow]:
        with self.Session() as db:
            return list(db.scalars(select(NotificationRow).order_by(NotificationRow.id.desc()).limit(limit)))

    # ---------------- audit / kv / users ----------------
    def audit(self, actor: str, action: str, details: dict | None = None) -> None:
        with self.Session.begin() as db:
            db.add(AuditRow(actor=actor, action=action, details=details or {}, ts=now_ms()))

    def audit_log(self, limit: int = 200) -> list[AuditRow]:
        with self.Session() as db:
            return list(db.scalars(select(AuditRow).order_by(AuditRow.id.desc()).limit(limit)))

    def kv_get(self, key: str, default: Any = None) -> Any:
        with self.Session() as db:
            row = db.get(KVRow, key)
            return row.value if row else default

    def kv_set(self, key: str, value: Any) -> None:
        with self.Session.begin() as db:
            db.merge(KVRow(key=key, value=value))

    def upsert_user(self, username: str, password_hash: str, role: str) -> None:
        with self.Session.begin() as db:
            db.merge(UserRow(username=username, password_hash=password_hash, role=role, active=True))

    def user(self, username: str) -> UserRow | None:
        with self.Session() as db:
            return db.get(UserRow, username)

    def session(self) -> Session:
        return self.Session()
