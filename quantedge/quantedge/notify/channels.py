"""Official-API notification channels: Telegram Bot API and WhatsApp Cloud API."""
from __future__ import annotations

import hashlib
import hmac
import logging
from dataclasses import dataclass

import httpx

log = logging.getLogger(__name__)


@dataclass
class SendResult:
    ok: bool
    provider_id: str | None = None
    error: str | None = None
    retryable: bool = False


class TelegramChannel:
    name = "telegram"

    def __init__(self, token: str, client: httpx.AsyncClient | None = None):
        self.base = f"https://api.telegram.org/bot{token}"
        self.client = client or httpx.AsyncClient(timeout=10)

    async def send(self, chat_id: str, text: str, kind: str = "", template_params: list[str] | None = None) -> SendResult:
        # Telegram caps messages at 4096 chars; signals are well below that, but guard anyway.
        try:
            r = await self.client.post(f"{self.base}/sendMessage", json={
                "chat_id": chat_id, "text": text[:4096], "disable_web_page_preview": True})
            data = r.json()
            if data.get("ok"):
                return SendResult(True, str(data["result"]["message_id"]))
            retry = r.status_code == 429 or r.status_code >= 500
            return SendResult(False, error=data.get("description", f"HTTP {r.status_code}"), retryable=retry)
        except httpx.HTTPError as e:
            return SendResult(False, error=str(e), retryable=True)

    async def get_updates(self, offset: int, timeout: int = 25) -> list[dict]:
        r = await self.client.get(f"{self.base}/getUpdates", params={"offset": offset, "timeout": timeout},
                                  timeout=timeout + 10)
        data = r.json()
        return data.get("result", []) if data.get("ok") else []


# WhatsApp business-initiated messages must use pre-approved templates.  These are the
# template names/parameter orders this application expects to exist in WhatsApp Manager.
WA_TEMPLATES = {
    "SIGNAL": "quantedge_signal",            # {{1}} pair {{2}} direction {{3}} entry {{4}} tp {{5}} sl {{6}} risk {{7}} score {{8}} id
    "ENTRY_CONFIRMED": "quantedge_update",   # {{1}} title {{2}} pair {{3}} details {{4}} id
    "PARTIAL_FILL": "quantedge_update",
    "TAKE_PROFIT": "quantedge_update",
    "STOP_LOSS": "quantedge_update",
    "CANCELLED": "quantedge_update",
    "EXPIRED": "quantedge_update",
    "INVALIDATED": "quantedge_update",
    "TIME_EXIT": "quantedge_update",
    "DAILY_REPORT": "quantedge_report",      # {{1}} title {{2}} summary
    "WEEKLY_REPORT": "quantedge_report",
    "NO_TRADE": "quantedge_report",
    "DAILY_LOSS_LIMIT": "quantedge_report",
    "EMERGENCY": "quantedge_report",
}


class WhatsAppChannel:
    name = "whatsapp"

    def __init__(self, token: str, phone_number_id: str, api_version: str = "v21.0", language: str = "en",
                 client: httpx.AsyncClient | None = None):
        self.url = f"https://graph.facebook.com/{api_version}/{phone_number_id}/messages"
        self.headers = {"Authorization": f"Bearer {token}"}
        self.language = language
        self.client = client or httpx.AsyncClient(timeout=10)

    def payload(self, to: str, kind: str, params: list[str]) -> dict:
        tmpl = WA_TEMPLATES.get(kind, "quantedge_report")
        return {"messaging_product": "whatsapp", "to": to, "type": "template",
                "template": {"name": tmpl, "language": {"code": self.language},
                             "components": [{"type": "body", "parameters": [
                                 {"type": "text", "text": p[:1024].replace("\n", " · ")} for p in params]}]}}

    async def send(self, to: str, text: str, kind: str = "", template_params: list[str] | None = None) -> SendResult:
        params = template_params or [kind.replace("_", " "), text[:1000]]
        try:
            r = await self.client.post(self.url, headers=self.headers, json=self.payload(to, kind, params))
            data = r.json()
            if r.status_code < 300 and data.get("messages"):
                return SendResult(True, data["messages"][0]["id"])
            err = data.get("error", {})
            retry = r.status_code == 429 or r.status_code >= 500 or err.get("code") in (4, 80007, 130429, 131048)
            return SendResult(False, error=f"{err.get('code')}: {err.get('message', r.text[:200])}", retryable=retry)
        except httpx.HTTPError as e:
            return SendResult(False, error=str(e), retryable=True)


def verify_whatsapp_signature(app_secret: str, body: bytes, header: str | None) -> bool:
    """Meta signs webhook payloads with X-Hub-Signature-256: sha256=<hmac(app_secret, body)>."""
    if not app_secret or not header or not header.startswith("sha256="):
        return False
    expected = hmac.new(app_secret.encode(), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, header[7:])


def parse_whatsapp_statuses(payload: dict) -> list[tuple[str, str, str | None]]:
    """Extract (message_id, status, error) tuples from a Cloud API webhook payload."""
    out = []
    for entry in payload.get("entry", []):
        for ch in entry.get("changes", []):
            for st in ch.get("value", {}).get("statuses", []):
                err = (st.get("errors") or [{}])[0].get("title")
                out.append((st.get("id"), st.get("status"), err))
    return out
