import hashlib
import hmac
import json

import pytest
from fastapi.testclient import TestClient

from quantedge.api.app import create_app
from quantedge.api.auth import hash_password, issue_token, read_token
from quantedge.db.repo import Repo
from quantedge.risk.engine import RiskEngine


class StubEngine:
    def __init__(self, cfg):
        from quantedge.monitor.tracker import TradeTracker
        from quantedge.signals.calibration import Calibrator
        self.risk = RiskEngine(cfg.risk, 2)
        self.tracker = TradeTracker(cfg.costs)
        self.calibrator = Calibrator()
        self.scanner = type("S", (), {"rows": {}})()
        self.persisted = 0

    def persist(self):
        self.persisted += 1

    def status(self):
        return {"halted": self.risk.state.halted, "exchange_healthy": True}


@pytest.fixture
def client(cfg):
    cfg.notify.whatsapp_app_secret = "appsecret"
    cfg.notify.whatsapp_verify_token = "vt"
    repo = Repo("sqlite://")
    pw = hash_password("correct horse battery")
    repo.upsert_user("admin", pw, "admin")
    repo.upsert_user("op", pw, "operator")
    repo.upsert_user("view", pw, "viewer")
    app = create_app(cfg, repo, StubEngine(cfg))
    return TestClient(app), repo, app


def tok(c, user):
    return {"Authorization": "Bearer " + c.post("/auth/login", json={"username": user, "password": "correct horse battery"}).json()["token"]}


def test_token_tamper_and_expiry():
    t = issue_token("k", "a", "admin")
    assert read_token("k", t)["u"] == "a"
    assert read_token("other", t) is None
    assert read_token("k", issue_token("k", "a", "admin", ttl_s=-1)) is None


def test_login_and_roles(client):
    c, repo, app = client
    assert c.get("/api/overview").status_code == 401
    assert c.post("/auth/login", json={"username": "admin", "password": "wrong"}).status_code == 401
    v, o, a = tok(c, "view"), tok(c, "op"), tok(c, "admin")
    assert c.get("/api/overview", headers=v).status_code == 200
    assert c.post("/api/risk/halt", json={"reason": "x"}, headers=v).status_code == 403
    assert c.post("/api/risk/halt", json={"reason": "x"}, headers=o).json() == {"halted": True}
    assert app.state.engine.risk.state.halted
    assert c.post("/api/risk/resume", headers=o).status_code == 403
    assert c.post("/api/risk/resume", headers=a).status_code == 200
    actions = [x["action"] for x in c.get("/api/audit", headers=a).json()]
    assert "emergency_halt" in actions and "resume" in actions


def test_settings_bounds(client):
    c, _, app = client
    a = tok(c, "admin")
    assert c.put("/api/settings", json={"values": {"trading.leverage": 5}}, headers=a).status_code == 400
    assert c.put("/api/settings", json={"values": {"risk.max_daily_loss": 0.05}}, headers=a).status_code == 400
    assert c.put("/api/settings", json={"values": {"trading.min_quality_score": 50}}, headers=a).status_code == 400
    r = c.put("/api/settings", json={"values": {"trading.min_quality_score": 95}}, headers=a)
    assert r.status_code == 200 and app.state.cfg.trading.min_quality_score == 95


def test_execution_cannot_be_approved_without_validation(client):
    c, repo, _ = client
    a = tok(c, "admin")
    r = c.post("/api/execution/approval", json={"approve": True}, headers=a)
    assert r.status_code == 409
    v = c.get("/api/validation", headers=a).json()
    assert v["approved"] is False and v["checks"]["sample_size"]["pass"] is False


def test_whatsapp_webhook(client):
    c, repo, _ = client
    assert c.get("/webhooks/whatsapp", params={"hub.mode": "subscribe", "hub.verify_token": "vt", "hub.challenge": "42"}).text == "42"
    assert c.get("/webhooks/whatsapp", params={"hub.mode": "subscribe", "hub.verify_token": "no", "hub.challenge": "1"}).status_code == 403
    nid = repo.claim_notification("k", "whatsapp", "r", "SIGNAL", None)
    repo.update_notification(nid, status="sent", provider_id="wamid.X")
    body = json.dumps({"entry": [{"changes": [{"value": {"statuses": [{"id": "wamid.X", "status": "delivered"}]}}]}]}).encode()
    assert c.post("/webhooks/whatsapp", content=body).status_code == 401
    sig = "sha256=" + hmac.new(b"appsecret", body, hashlib.sha256).hexdigest()
    r = c.post("/webhooks/whatsapp", content=body, headers={"X-Hub-Signature-256": sig, "Content-Type": "application/json"})
    assert r.json() == {"updated": 1} and repo.notifications()[0].status == "delivered"


def test_health_and_dashboard(client):
    c, _, _ = client
    assert c.get("/health").json()["status"] == "ok"
    assert "QuantEdge" in c.get("/dashboard/").text


def test_requires_auth_secret(cfg):
    cfg.auth_secret = ""
    with pytest.raises(RuntimeError):
        create_app(cfg, Repo("sqlite://"))
