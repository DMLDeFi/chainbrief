"""Build the notification service from configuration."""
from __future__ import annotations

from ..config import AppConfig
from ..db.repo import Repo
from .channels import TelegramChannel, WhatsAppChannel
from .service import NotificationService


def build_notifier(cfg: AppConfig, repo: Repo) -> tuple[NotificationService, TelegramChannel | None]:
    n = cfg.notify
    channels: dict = {}
    tg = None
    if n.telegram_enabled and n.telegram_bot_token:
        tg = TelegramChannel(n.telegram_bot_token)
        channels["telegram"] = (tg, list(n.telegram_chat_ids))
    if n.whatsapp_enabled and n.whatsapp_token and n.whatsapp_phone_number_id:
        channels["whatsapp"] = (WhatsAppChannel(n.whatsapp_token, n.whatsapp_phone_number_id,
                                                n.whatsapp_api_version, n.whatsapp_template_language),
                                list(n.whatsapp_recipients))
    return NotificationService(repo, channels), tg
