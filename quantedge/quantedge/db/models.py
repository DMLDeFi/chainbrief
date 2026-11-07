"""SQLAlchemy schema.  PostgreSQL in production, SQLite for tests/dev."""
from __future__ import annotations

import time

from sqlalchemy import JSON, BigInteger, Boolean, Float, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


def now_ms() -> int:
    return int(time.time() * 1000)


class Base(DeclarativeBase):
    pass


class SignalRow(Base):
    __tablename__ = "signals"
    signal_id: Mapped[str] = mapped_column(String(32), primary_key=True)
    symbol: Mapped[str] = mapped_column(String(32), index=True)
    direction: Mapped[str] = mapped_column(String(8))
    strategy: Mapped[str] = mapped_column(String(32))
    status: Mapped[str] = mapped_column(String(24), index=True)
    score: Mapped[float] = mapped_column(Float)
    components: Mapped[dict] = mapped_column(JSON)
    plan: Mapped[dict] = mapped_column(JSON)
    entry_low: Mapped[float] = mapped_column(Float)
    entry_high: Mapped[float] = mapped_column(Float)
    regime: Mapped[str] = mapped_column(String(32))
    trend_status: Mapped[str] = mapped_column(String(64))
    volume_status: Mapped[str] = mapped_column(String(64))
    liquidity_status: Mapped[str] = mapped_column(String(128))
    rationale: Mapped[str] = mapped_column(Text)
    invalidation: Mapped[str] = mapped_column(Text)
    invalidation_price: Mapped[float] = mapped_column(Float)
    created_ms: Mapped[int] = mapped_column(BigInteger, index=True)
    expires_ms: Mapped[int] = mapped_column(BigInteger)
    paper: Mapped[bool] = mapped_column(Boolean, default=True)
    calibrated: Mapped[bool] = mapped_column(Boolean, default=False)
    explanation: Mapped[str] = mapped_column(Text, default="")
    updated_ms: Mapped[int] = mapped_column(BigInteger, default=now_ms, onupdate=now_ms)


class SignalEventRow(Base):
    __tablename__ = "signal_events"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    signal_id: Mapped[str] = mapped_column(String(32), index=True)
    ts: Mapped[int] = mapped_column(BigInteger)
    kind: Mapped[str] = mapped_column(String(32))
    data: Mapped[dict] = mapped_column(JSON, default=dict)


class TradeRow(Base):
    __tablename__ = "trades"
    signal_id: Mapped[str] = mapped_column(String(32), primary_key=True)
    symbol: Mapped[str] = mapped_column(String(32), index=True)
    direction: Mapped[str] = mapped_column(String(8))
    strategy: Mapped[str] = mapped_column(String(32))
    regime: Mapped[str] = mapped_column(String(32))
    score: Mapped[float] = mapped_column(Float)
    status: Mapped[str] = mapped_column(String(24))
    filled_qty: Mapped[float] = mapped_column(Float)
    avg_entry: Mapped[float] = mapped_column(Float)
    exit_price: Mapped[float] = mapped_column(Float)
    entry_ts: Mapped[int] = mapped_column(BigInteger)
    exit_ts: Mapped[int] = mapped_column(BigInteger, index=True)
    net_pnl: Mapped[float] = mapped_column(Float)
    net_roi: Mapped[float] = mapped_column(Float)
    r_multiple: Mapped[float] = mapped_column(Float)
    fees: Mapped[float] = mapped_column(Float)
    funding: Mapped[float] = mapped_column(Float)
    slippage: Mapped[float] = mapped_column(Float)
    hold_hours: Mapped[float] = mapped_column(Float)
    mfe: Mapped[float] = mapped_column(Float)
    mae: Mapped[float] = mapped_column(Float)
    paper: Mapped[bool] = mapped_column(Boolean, default=True)


class RejectionRow(Base):
    __tablename__ = "rejections"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    ts: Mapped[int] = mapped_column(BigInteger, index=True)
    symbol: Mapped[str] = mapped_column(String(32), index=True)
    strategy: Mapped[str] = mapped_column(String(32))
    direction: Mapped[str] = mapped_column(String(8))
    stage: Mapped[str] = mapped_column(String(48))
    reasons: Mapped[list] = mapped_column(JSON)
    score: Mapped[float] = mapped_column(Float, default=0.0)


class NotificationRow(Base):
    __tablename__ = "notifications"
    __table_args__ = (UniqueConstraint("idempotency_key", "channel", "recipient", name="uq_notification"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    idempotency_key: Mapped[str] = mapped_column(String(96), index=True)
    channel: Mapped[str] = mapped_column(String(16))
    recipient: Mapped[str] = mapped_column(String(64))
    signal_id: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    kind: Mapped[str] = mapped_column(String(32))
    status: Mapped[str] = mapped_column(String(16), default="pending")   # pending/sent/delivered/read/failed
    provider_message_id: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    created_ms: Mapped[int] = mapped_column(BigInteger, default=now_ms)
    updated_ms: Mapped[int] = mapped_column(BigInteger, default=now_ms, onupdate=now_ms)


class AuditRow(Base):
    __tablename__ = "audit_log"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    ts: Mapped[int] = mapped_column(BigInteger, default=now_ms, index=True)
    actor: Mapped[str] = mapped_column(String(64))
    action: Mapped[str] = mapped_column(String(64))
    details: Mapped[dict] = mapped_column(JSON, default=dict)


class KVRow(Base):
    __tablename__ = "kv_state"
    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[dict] = mapped_column(JSON)
    updated_ms: Mapped[int] = mapped_column(BigInteger, default=now_ms, onupdate=now_ms)


class UserRow(Base):
    __tablename__ = "users"
    username: Mapped[str] = mapped_column(String(64), primary_key=True)
    password_hash: Mapped[str] = mapped_column(String(256))
    role: Mapped[str] = mapped_column(String(16))     # admin / operator / viewer
    active: Mapped[bool] = mapped_column(Boolean, default=True)
