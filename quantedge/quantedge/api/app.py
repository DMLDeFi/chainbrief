"""FastAPI application: dashboard API, admin controls, webhooks, health."""
from __future__ import annotations

import asyncio
import logging
import os
import time
from contextlib import asynccontextmanager
from dataclasses import asdict
from pathlib import Path

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request
from fastapi.responses import FileResponse, PlainTextResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from ..backtest.metrics import summarize
from ..backtest.validation import deployment_gate
from ..config import AppConfig, load_config
from ..db.repo import Repo
from ..notify.channels import parse_whatsapp_statuses, verify_whatsapp_signature
from .auth import has_role, issue_token, read_token, verify_password

log = logging.getLogger(__name__)
DASHBOARD = Path(__file__).resolve().parent.parent / "dashboard"

# runtime-editable settings, with hard bounds the API refuses to exceed
SETTINGS_BOUNDS = {
    "trading.leverage": (1.0, 2.5), "trading.target_net_roi": (0.02, 0.20),
    "trading.min_quality_score": (85.0, 100.0), "trading.max_daily_signals": (0, 2),
    "risk.risk_per_trade": (0.0005, 0.0025), "risk.max_daily_loss": (0.001, 0.0075),
    "risk.max_open_positions": (0, 2), "risk.max_consecutive_losses": (1, 5),
}


class Login(BaseModel):
    username: str
    password: str


class HaltBody(BaseModel):
    reason: str = Field("manual", max_length=200)


class SettingsBody(BaseModel):
    values: dict[str, float]


class ApprovalBody(BaseModel):
    approve: bool
    note: str = Field("", max_length=500)


def create_app(cfg: AppConfig | None = None, repo: Repo | None = None, engine=None) -> FastAPI:
    cfg = cfg or load_config()
    if not cfg.auth_secret:
        raise RuntimeError("QE_AUTH_SECRET must be set (random 32+ bytes)")
    repo = repo or Repo(cfg.database_url)
    if cfg.admin_password_hash:
        repo.upsert_user(cfg.admin_username, cfg.admin_password_hash, "admin")
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        if app.state.engine is None and os.environ.get("QE_START_ENGINE", "").lower() == "true":
            from ..engine import Engine
            from ..notify.factory import build_notifier
            notifier, tg = build_notifier(cfg, repo)
            eng = Engine(cfg, repo, notifier)
            app.state.engine = eng
            await eng.start()
            if tg is not None and cfg.notify.telegram_admin_ids:
                eng._tasks.append(asyncio.create_task(eng.telegram_commands(tg, cfg.notify.telegram_admin_ids)))
        yield
        if app.state.engine is not None and hasattr(app.state.engine, "stop"):
            await app.state.engine.stop()

    app = FastAPI(title="QuantEdge AI Elite", version="0.1.0", lifespan=lifespan)
    app.state.cfg, app.state.repo, app.state.engine = cfg, repo, engine
    login_attempts: dict[str, list[float]] = {}

    def claims(authorization: str | None = Header(None)) -> dict:
        if not authorization or not authorization.startswith("Bearer "):
            raise HTTPException(401, "missing token")
        c = read_token(cfg.auth_secret, authorization[7:])
        if c is None:
            raise HTTPException(401, "invalid or expired token")
        return c

    def role(needed: str):
        def dep(c: dict = Depends(claims)) -> dict:
            if not has_role(c, needed):
                raise HTTPException(403, f"{needed} role required")
            return c
        return dep

    # ---------------- public ----------------
    @app.get("/health")
    def health() -> dict:
        eng = app.state.engine
        db_ok = True
        try:
            repo.kv_get("ping")
        except Exception:
            db_ok = False
        return {"status": "ok" if db_ok else "degraded", "db": db_ok, "engine": eng is not None,
                "exchange_healthy": getattr(getattr(eng, "risk", None), "exchange_healthy", None),
                "time": int(time.time() * 1000)}

    @app.post("/auth/login")
    def login(body: Login, request: Request) -> dict:
        ip = request.client.host if request.client else "?"
        recent = [t for t in login_attempts.get(ip, []) if time.time() - t < 300]
        if len(recent) >= 10:
            raise HTTPException(429, "too many attempts")
        login_attempts[ip] = recent + [time.time()]
        u = repo.user(body.username)
        if not u or not u.active or not verify_password(body.password, u.password_hash):
            repo.audit(body.username, "login_failed", {"ip": ip})
            raise HTTPException(401, "invalid credentials")
        repo.audit(u.username, "login", {"ip": ip})
        return {"token": issue_token(cfg.auth_secret, u.username, u.role), "role": u.role}

    @app.get("/")
    def root():
        return RedirectResponse("/dashboard/")

    if DASHBOARD.exists():
        app.mount("/dashboard", StaticFiles(directory=DASHBOARD, html=True), name="dashboard")

    # ---------------- WhatsApp webhook (delivery status) ----------------
    @app.get("/webhooks/whatsapp")
    def wa_verify(mode: str = Query(alias="hub.mode", default=""), token: str = Query(alias="hub.verify_token", default=""),
                  challenge: str = Query(alias="hub.challenge", default="")):
        if mode == "subscribe" and cfg.notify.whatsapp_verify_token and token == cfg.notify.whatsapp_verify_token:
            return PlainTextResponse(challenge)
        raise HTTPException(403, "verification failed")

    @app.post("/webhooks/whatsapp")
    async def wa_status(request: Request, x_hub_signature_256: str | None = Header(None)) -> dict:
        body = await request.body()
        if not verify_whatsapp_signature(cfg.notify.whatsapp_app_secret, body, x_hub_signature_256):
            raise HTTPException(401, "bad signature")
        n = 0
        for mid, status, err in parse_whatsapp_statuses(await request.json()):
            n += repo.update_delivery_by_provider_id(mid, status, err)
        return {"updated": n}

    # ---------------- read (viewer) ----------------
    @app.get("/api/overview")
    def overview(c: dict = Depends(role("viewer"))) -> dict:
        trades = [Repo.to_result(t) for t in repo.trades()]
        eng = app.state.engine
        s = summarize(trades, 10_000.0)
        active = repo.signals(status=["PUBLISHED", "ENTRY_ZONE_REACHED", "FILLED", "PARTIALLY_FILLED"])
        return {"status": eng.status() if eng else None, "active_signals": len(active),
                "total_signals": len(repo.signals(limit=100_000)),
                "wins": sum(1 for t in trades if t.net_pnl > 0), "losses": sum(1 for t in trades if t.net_pnl < 0),
                "net_pnl": s.get("net_pnl", 0.0), "max_drawdown": s.get("max_drawdown", 0.0),
                "current_drawdown": _current_dd(s.get("equity_curve", [10_000.0])),
                "paper": cfg.paper_trading}

    @app.get("/api/scanner")
    def scanner(c: dict = Depends(role("viewer"))) -> list[dict]:
        eng = app.state.engine
        if not eng:
            return []
        return [asdict(r) for r in sorted(eng.scanner.rows.values(), key=lambda r: -r.turnover_24h)]

    @app.get("/api/signals")
    def signals(status: str | None = None, c: dict = Depends(role("viewer"))) -> list[dict]:
        rows = repo.signals(status=status.split(",") if status else None)
        return [_row(r) for r in rows]

    @app.get("/api/signals/{signal_id}")
    def signal_detail(signal_id: str, c: dict = Depends(role("viewer"))) -> dict:
        row, events = repo.signal(signal_id)
        if row is None:
            raise HTTPException(404, "not found")
        return {**_row(row), "events": [{"ts": e.ts, "kind": e.kind, "data": e.data} for e in events]}

    @app.get("/api/rejections")
    def rejections(limit: int = 200, c: dict = Depends(role("viewer"))) -> list[dict]:
        return [{"ts": r.ts, "symbol": r.symbol, "strategy": r.strategy, "direction": r.direction,
                 "stage": r.stage, "reasons": r.reasons, "score": r.score} for r in repo.rejections(min(limit, 1000))]

    @app.get("/api/analytics")
    def analytics(c: dict = Depends(role("viewer"))) -> dict:
        trades = [Repo.to_result(t) for t in repo.trades()]
        s = summarize(trades, 10_000.0)
        buckets: dict[str, dict[str, float]] = {"daily": {}, "weekly": {}, "monthly": {}}
        for t in trades:
            g = time.gmtime(t.exit_ts / 1000)
            for k, key in (("daily", time.strftime("%Y-%m-%d", g)), ("weekly", time.strftime("%G-W%V", g)),
                           ("monthly", time.strftime("%Y-%m", g))):
                buckets[k][key] = buckets[k].get(key, 0.0) + t.net_pnl
        eng = app.state.engine
        cal = eng.calibrator.table() if eng else []
        return {"summary": s, "periods": buckets, "calibration": cal}

    @app.get("/api/risk")
    def risk(c: dict = Depends(role("viewer"))) -> dict:
        eng = app.state.engine
        out = {"limits": asdict(cfg.risk), "leverage": cfg.trading.leverage}
        if eng:
            out["state"] = eng.risk.snapshot()
            out["status"] = eng.status()
        return out

    @app.get("/api/settings")
    def get_settings(c: dict = Depends(role("viewer"))) -> dict:
        n = cfg.notify
        return {"trading": asdict(cfg.trading), "risk": asdict(cfg.risk), "costs": asdict(cfg.costs),
                "bounds": SETTINGS_BOUNDS,
                "telegram": {"enabled": n.telegram_enabled, "recipients": len(n.telegram_chat_ids)},
                "whatsapp": {"enabled": n.whatsapp_enabled, "recipients": len(n.whatsapp_recipients)},
                "execution": {"enabled": cfg.execution.enabled, "approval": repo.kv_get("execution_approval")}}

    @app.get("/api/notifications")
    def notifications(c: dict = Depends(role("viewer"))) -> list[dict]:
        return [{"id": n.id, "key": n.idempotency_key, "channel": n.channel, "recipient": _mask(n.recipient),
                 "kind": n.kind, "status": n.status, "error": n.error, "attempts": n.attempts,
                 "created_ms": n.created_ms} for n in repo.notifications()]

    @app.get("/api/validation")
    def validation(c: dict = Depends(role("viewer"))) -> dict:
        g = deployment_gate([Repo.to_result(t) for t in repo.trades(paper=True)], 10_000.0,
                            min_trades=cfg.min_paper_signals_for_live)
        return {"approved": g.approved, "checks": {k: {"pass": v[0], "detail": v[1]} for k, v in g.checks.items()}}

    # ---------------- control (operator / admin) ----------------
    @app.post("/api/risk/halt")
    def halt(body: HaltBody, c: dict = Depends(role("operator"))) -> dict:
        eng = _need_engine(app)
        eng.risk.emergency_halt(body.reason)
        eng.persist()
        repo.audit(c["u"], "emergency_halt", {"reason": body.reason})
        return {"halted": True}

    @app.post("/api/risk/resume")
    def resume(c: dict = Depends(role("admin"))) -> dict:
        eng = _need_engine(app)
        eng.risk.resume()
        eng.persist()
        repo.audit(c["u"], "resume", {})
        return {"halted": False}

    @app.post("/api/signals/{signal_id}/cancel")
    def cancel(signal_id: str, c: dict = Depends(role("operator"))) -> dict:
        eng = _need_engine(app)
        tr = eng.tracker.cancel(signal_id, int(time.time() * 1000), f"cancelled by {c['u']}")
        if tr is None:
            raise HTTPException(409, "signal not active or already filled")
        eng.risk.release(signal_id)
        repo.set_status(signal_id, "CANCELLED")
        repo.audit(c["u"], "cancel_signal", {"signal_id": signal_id})
        return {"cancelled": signal_id}

    @app.put("/api/settings")
    def put_settings(body: SettingsBody, c: dict = Depends(role("admin"))) -> dict:
        applied = {}
        for k, v in body.values.items():
            if k not in SETTINGS_BOUNDS:
                raise HTTPException(400, f"{k} is not editable")
            lo, hi = SETTINGS_BOUNDS[k]
            if not lo <= v <= hi:
                raise HTTPException(400, f"{k}={v} outside allowed range [{lo}, {hi}]")
            section, field = k.split(".")
            obj = getattr(cfg, section)
            cur = getattr(obj, field)
            setattr(obj, field, type(cur)(v))
            applied[k] = getattr(obj, field)
        eng = app.state.engine
        if eng:
            eng.risk.max_daily_signals = cfg.trading.max_daily_signals
        repo.audit(c["u"], "settings_change", applied)
        return {"applied": applied}

    @app.post("/api/execution/approval")
    def execution_approval(body: ApprovalBody, c: dict = Depends(role("admin"))) -> dict:
        g = deployment_gate([Repo.to_result(t) for t in repo.trades(paper=True)], 10_000.0,
                            min_trades=cfg.min_paper_signals_for_live)
        if body.approve and not g.approved:
            raise HTTPException(409, "validation gate has not passed; live execution cannot be approved")
        rec = {"approved": body.approve, "gate_passed": g.approved, "by": c["u"], "note": body.note,
               "ts": int(time.time() * 1000)}
        repo.kv_set("execution_approval", rec)
        repo.audit(c["u"], "execution_approval", rec)
        return rec

    @app.get("/api/audit")
    def audit(c: dict = Depends(role("admin"))) -> list[dict]:
        return [{"ts": a.ts, "actor": a.actor, "action": a.action, "details": a.details} for a in repo.audit_log()]

    return app


def _need_engine(app: FastAPI):
    if app.state.engine is None:
        raise HTTPException(503, "engine not running")
    return app.state.engine


def _mask(s: str) -> str:
    return s[:3] + "***" + s[-2:] if len(s) > 6 else "***"


def _current_dd(curve: list[float]) -> float:
    if not curve:
        return 0.0
    peak = max(curve)
    return (peak - curve[-1]) / peak if peak else 0.0


def _row(r) -> dict:
    return {"signal_id": r.signal_id, "symbol": r.symbol, "direction": r.direction, "strategy": r.strategy,
            "status": r.status, "score": r.score, "components": r.components, "plan": r.plan,
            "entry_zone": [r.entry_low, r.entry_high], "regime": r.regime, "trend": r.trend_status,
            "volume": r.volume_status, "liquidity": r.liquidity_status, "rationale": r.rationale,
            "invalidation": r.invalidation, "created_ms": r.created_ms, "expires_ms": r.expires_ms,
            "paper": r.paper, "calibrated": r.calibrated, "explanation": r.explanation}
