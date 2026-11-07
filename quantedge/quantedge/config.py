"""Central configuration.

All trading defaults from the specification live here.  Values are loaded from
environment variables (prefix ``QE_``) so that secrets never live in source.
Nested sections use ``__`` as a delimiter, e.g. ``QE_RISK__RISK_PER_TRADE=0.0025``.
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field, fields, is_dataclass
from typing import Any, get_type_hints


@dataclass
class TradingConfig:
    exchange: str = "bybit"
    category: str = "linear"            # Bybit v5 category for USDT perpetuals
    quote_coin: str = "USDT"
    leverage: float = 2.5
    target_net_roi: float = 0.10        # 10% net ROI on allocated margin
    margin_mode: str = "ISOLATED"
    max_daily_signals: int = 2          # ceiling, never a quota
    min_quality_score: float = 90.0
    signal_expiry_minutes: int = 240    # unfilled signals expire after this
    entry_zone_atr_frac: float = 0.15   # entry zone half-width as fraction of 15m ATR
    timeframes: tuple[str, ...] = ("5", "15", "60", "240", "D")
    execution_timeframe: str = "15"
    allow_long: bool = True
    allow_short: bool = True


@dataclass
class CostConfig:
    # Bybit non-VIP USDT perpetual defaults; replaced by /v5/account/fee-rate when keys exist.
    taker_fee: float = 0.00055
    maker_fee: float = 0.00020
    entry_is_maker: bool = False        # conservative: assume taker entry
    tp_is_maker: bool = False           # conservative: assume taker exit
    entry_slippage: float = 0.0005      # 5 bps
    exit_slippage: float = 0.0005
    stop_slippage: float = 0.0015       # stops fill worse than targets
    funding_interval_hours: float = 8.0
    credit_favourable_funding: bool = False  # never count funding income towards target


@dataclass
class RiskConfig:
    risk_per_trade: float = 0.0025      # 0.25% equity at planned stop (after costs)
    max_daily_loss: float = 0.0075      # 0.75%
    max_open_positions: int = 2
    max_leverage: float = 2.5
    max_consecutive_losses: int = 3     # lock out for the rest of the UTC day
    max_total_exposure: float = 1.0     # sum notional / equity
    max_correlation: float = 0.85       # reject if |rho| with an open position above this
    max_stop_distance: float = 0.06     # 6% price distance
    min_stop_distance: float = 0.004    # tighter than this is noise at our cost levels
    min_reward_risk: float = 1.5        # net reward / net risk
    max_expected_hold_hours: float = 72.0
    max_abs_funding_rate: float = 0.0005  # per interval
    liquidation_buffer: float = 0.5     # stop must sit at most 50% of the way to liquidation
    maintenance_margin_rate: float = 0.005


@dataclass
class ScannerConfig:
    min_turnover_24h: float = 20_000_000.0   # USDT
    max_spread_bps: float = 6.0
    min_depth_usdt: float = 150_000.0        # each side within depth_band
    depth_band: float = 0.005                # +-0.5% of mid
    min_listing_days: int = 30
    max_mark_index_deviation: float = 0.005  # 0.5% mark vs index
    min_history_bars_daily: int = 60
    stale_after_seconds: float = 15.0
    volume_spike_ratio: float = 3.0
    oi_change_alert: float = 0.10
    max_symbols: int = 400
    exclude: tuple[str, ...] = ()


@dataclass
class NotifyConfig:
    telegram_enabled: bool = False
    telegram_bot_token: str = ""
    telegram_chat_ids: tuple[str, ...] = ()
    telegram_admin_ids: tuple[str, ...] = ()
    whatsapp_enabled: bool = False
    whatsapp_token: str = ""
    whatsapp_phone_number_id: str = ""
    whatsapp_recipients: tuple[str, ...] = ()
    whatsapp_app_secret: str = ""
    whatsapp_verify_token: str = ""
    whatsapp_api_version: str = "v21.0"
    whatsapp_template_language: str = "en"


@dataclass
class ExecutionConfig:
    enabled: bool = False               # must also be approved by an admin at runtime
    testnet: bool = True
    account_type: str = "UNIFIED"       # UNIFIED or CONTRACT (classic)


@dataclass
class AppConfig:
    trading: TradingConfig = field(default_factory=TradingConfig)
    costs: CostConfig = field(default_factory=CostConfig)
    risk: RiskConfig = field(default_factory=RiskConfig)
    scanner: ScannerConfig = field(default_factory=ScannerConfig)
    notify: NotifyConfig = field(default_factory=NotifyConfig)
    execution: ExecutionConfig = field(default_factory=ExecutionConfig)
    database_url: str = "sqlite:///./quantedge.db"
    bybit_api_key: str = ""
    bybit_api_secret: str = ""
    bybit_testnet: bool = False
    auth_secret: str = ""               # HMAC key for dashboard session tokens
    admin_username: str = "admin"
    admin_password_hash: str = ""       # scrypt hash, see quantedge.api.auth.hash_password
    anthropic_api_key: str = ""
    ai_model: str = "claude-opus-5-5"
    paper_trading: bool = True
    min_paper_signals_for_live: int = 300


def _coerce(value: str, typ: Any) -> Any:
    if typ is bool:
        return value.strip().lower() in {"1", "true", "yes", "on"}
    if typ is int:
        return int(value)
    if typ is float:
        return float(value)
    if typ is str:
        return value
    if getattr(typ, "__origin__", None) is tuple:
        return tuple(v.strip() for v in value.split(",") if v.strip())
    return value


def _apply_env(obj: Any, prefix: str, env: dict[str, str]) -> None:
    hints = get_type_hints(type(obj))
    for f in fields(obj):
        key = f"{prefix}{f.name.upper()}"
        current = getattr(obj, f.name)
        if is_dataclass(current):
            _apply_env(current, key + "__", env)
        elif key in env:
            setattr(obj, f.name, _coerce(env[key], hints[f.name]))


def load_config(env: dict[str, str] | None = None) -> AppConfig:
    cfg = AppConfig()
    _apply_env(cfg, "QE_", dict(os.environ if env is None else env))
    if cfg.trading.leverage > cfg.risk.max_leverage:
        raise ValueError("trading.leverage exceeds risk.max_leverage")
    return cfg
