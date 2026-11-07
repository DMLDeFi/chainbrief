import hashlib
import hmac
import json

import pytest

from quantedge.db.repo import Repo
from quantedge.models import Direction
from quantedge.notify.channels import (SendResult, WhatsAppChannel, parse_whatsapp_statuses,
                                       verify_whatsapp_signature)
from quantedge.notify.formatter import event_message, signal_message
from quantedge.notify.service import NotificationService

from conftest import make_signal


class FakeChannel:
    name = "fake"

    def __init__(self, fail_times=0, retryable=True):
        self.sent, self.fail_times, self.retryable = [], fail_times, retryable

    async def send(self, to, text, kind="", template_params=None):
        if self.fail_times:
            self.fail_times -= 1
            return SendResult(False, error="boom", retryable=self.retryable)
        self.sent.append((to, text, kind, template_params))
        return SendResult(True, f"id-{len(self.sent)}")


def test_signal_template(inst):
    s = make_signal(inst)
    m = signal_message(s)
    for line in ("QUANTEDGE AI ELITE", "PAIR: BTC/USDT", "EXCHANGE: BYBIT", "DIRECTION: LONG", "LEVERAGE: 2.5X",
                 "MARGIN MODE: ISOLATED", "TAKE PROFIT:", "STOP LOSS:", "TARGET NET ROI: +10%", "SIGNAL QUALITY: 92/100",
                 "INVALIDATION CONDITION:", f"SIGNAL ID: {s.signal_id}", "Capital preservation comes first.",
                 "Always use the prescribed stop loss."):
        assert line in m
    assert "[PAPER]" in m and "(uncalibrated)" in m
    assert "NO QUALIFIED TRADE SETUPS TODAY" in event_message("NO_TRADE")


@pytest.mark.asyncio
async def test_same_signal_sent_once_per_recipient(inst):
    repo = Repo("sqlite://")
    tg, wa = FakeChannel(), FakeChannel()
    svc = NotificationService(repo, {"telegram": (tg, ["1", "2"]), "whatsapp": (wa, ["447000"])})
    s = make_signal(inst)
    a = await svc.publish_signal(s)
    b = await svc.publish_signal(s)       # retry / restart must not double-send
    assert a["sent"] == 3 and b["skipped_duplicate"] == 3
    assert len(tg.sent) == 2 and len(wa.sent) == 1
    assert wa.sent[0][3][0] == "BTC/USDT" and wa.sent[0][3][-1] == s.signal_id


@pytest.mark.asyncio
async def test_retry_then_failed_status(inst, monkeypatch):
    import quantedge.notify.service as svc_mod

    async def nosleep(_):
        return None
    monkeypatch.setattr(svc_mod.asyncio, "sleep", nosleep)
    repo = Repo("sqlite://")
    ok_after_one = FakeChannel(fail_times=1)
    never = FakeChannel(fail_times=99, retryable=False)
    svc = NotificationService(repo, {"a": (ok_after_one, ["x"]), "b": (never, ["y"])})
    r = await svc.dispatch("k1", "TEST", "hello")
    assert r == {"sent": 1, "failed": 1, "skipped_duplicate": 0}
    statuses = {n.channel: n.status for n in repo.notifications()}
    assert statuses == {"a": "sent", "b": "failed"}


def test_whatsapp_template_payload_and_webhook():
    ch = WhatsAppChannel("tok", "123")
    p = ch.payload("447000", "SIGNAL", ["BTC/USDT", "LONG"])
    assert p["type"] == "template" and p["template"]["name"] == "quantedge_signal"
    assert p["template"]["components"][0]["parameters"][1] == {"type": "text", "text": "LONG"}
    body = json.dumps({"entry": [{"changes": [{"value": {"statuses": [{"id": "wamid.1", "status": "delivered"}]}}]}]}).encode()
    sig = "sha256=" + hmac.new(b"appsecret", body, hashlib.sha256).hexdigest()
    assert verify_whatsapp_signature("appsecret", body, sig)
    assert not verify_whatsapp_signature("appsecret", body + b" ", sig)
    assert parse_whatsapp_statuses(json.loads(body)) == [("wamid.1", "delivered", None)]


def test_delivery_status_never_regresses():
    repo = Repo("sqlite://")
    nid = repo.claim_notification("k", "whatsapp", "r", "SIGNAL", None)
    repo.update_notification(nid, status="sent", provider_id="wamid.9")
    assert repo.update_delivery_by_provider_id("wamid.9", "read")
    repo.update_delivery_by_provider_id("wamid.9", "delivered")    # late, out-of-order webhook
    assert repo.notifications()[0].status == "read"
