"""AI-assisted explanation and review layer.

The numerical engine decides; this layer only *explains*.  It never feeds back
into entries, exits, sizing or risk.

* ``deterministic_*`` functions build explanations purely from engine facts and
  are always available (and used when no API key is configured).
* ``ClaudeExplainer`` asks Claude to rewrite the same facts concisely, using
  structured JSON output.  Every number in the model's text must also appear in
  the supplied facts (within rounding); otherwise the output is discarded and
  the deterministic text is used.  This is the "never invent prices or
  performance" guard.
"""
from __future__ import annotations

import json
import logging
import re
from typing import Any

from ..models import Signal

log = logging.getLogger(__name__)

NUM_RE = re.compile(r"[-+]?\d[\d,]*\.?\d*(?:e[-+]?\d+)?%?", re.I)


def signal_facts(s: Signal, rejected_components: dict | None = None) -> dict[str, Any]:
    p = s.plan
    return {
        "symbol": s.symbol, "direction": s.direction.value, "strategy": s.strategy,
        "regime": s.regime.value, "score": round(s.score, 1),
        "component_scores": {k: round(v, 1) for k, v in s.component_scores.items()},
        "entry": p.entry, "take_profit": p.take_profit, "stop": p.stop,
        "target_net_roi_pct": round(p.net_roi * 100, 2), "account_risk_pct": round(p.account_risk_pct * 100, 3),
        "reward_risk": round(p.reward_risk, 2), "expected_hold_hours": round(p.expected_hold_hours, 1),
        "trend": s.trend_status, "volume": s.volume_status, "liquidity": s.liquidity_status,
        "evidence": s.rationale.split("; "), "invalidation": s.invalidation,
    }


def deterministic_signal_explanation(s: Signal) -> str:
    comps = sorted(s.component_scores.items(), key=lambda kv: kv[1], reverse=True)
    strongest = ", ".join(k.replace("_", " ") for k, _ in comps[:2])
    weakest = comps[-1][0].replace("_", " ")
    return (f"{s.strategy.replace('_', ' ').title()} {s.direction.value.lower()} in a "
            f"{s.regime.value.replace('_', ' ').lower()} regime. " + s.rationale.rstrip(".") +
            f". Strongest evidence: {strongest}; weakest component: {weakest}. "
            f"Net reward/risk after costs {s.plan.reward_risk:.2f}.")


def deterministic_rejection_summary(stage_reasons: list[str]) -> str:
    if not stage_reasons:
        return "No rejection."
    return "Rejected — " + "; ".join(stage_reasons[:4])


def deterministic_trade_review(result, plan_hold_hours: float) -> list[str]:
    notes = []
    if result.status == "STOP_LOSS" and result.mfe > 0.02:
        notes.append(f"Trade was {result.mfe:.2%} in profit before stopping out — review exit management.")
    if result.status == "STOP_LOSS" and result.hold_hours < 1:
        notes.append("Stopped within the first hour — entry timing or stop placement may sit inside noise.")
    if result.status == "TAKE_PROFIT" and result.mae > 0.015:
        notes.append(f"Winner first moved {result.mae:.2%} against entry — entry could be refined.")
    if result.hold_hours > 2 * plan_hold_hours:
        notes.append(f"Held {result.hold_hours:.0f}h vs {plan_hold_hours:.0f}h expected — holding-time model underestimates.")
    if result.funding > 0 and result.net_pnl > 0 and result.funding > 0.2 * result.net_pnl:
        notes.append("Funding consumed more than 20% of the profit.")
    return notes or ["Outcome consistent with plan."]


def _numbers(text: str) -> list[float]:
    out = []
    for m in NUM_RE.findall(text):
        try:
            out.append(float(m.replace(",", "").rstrip("%")))
        except ValueError:
            continue
    return out


def numbers_grounded(text: str, facts: dict) -> bool:
    """True if every number in ``text`` appears in ``facts`` (relative tolerance 0.5%)."""
    allowed = _numbers(json.dumps(facts))
    for x in _numbers(text):
        if abs(x) < 10 and float(x).is_integer():   # small counts like "2 timeframes", "4h"
            continue
        if not any(abs(x - a) <= max(1e-9, 0.005 * abs(a)) for a in allowed):
            return False
    return True


SCHEMA = {
    "type": "object",
    "properties": {
        "explanation": {"type": "string"},
        "conflicts": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["explanation", "conflicts"],
    "additionalProperties": False,
}

SYSTEM = (
    "You explain decisions made by a quantitative crypto trading engine to its operators. "
    "Use only the facts provided in the user message. Do not introduce any price, percentage, "
    "statistic or historical performance figure that is not in the facts. Do not predict outcomes "
    "or describe the trade as likely to win. In 'explanation', write at most three sentences on why "
    "the setup was approved. In 'conflicts', list any facts that point against the trade (empty if none)."
)


class ClaudeExplainer:
    def __init__(self, api_key: str, model: str = "claude-opus-5-5", client=None):
        self.model = model
        if client is None:
            import anthropic
            client = anthropic.Anthropic(api_key=api_key, max_retries=2, timeout=60)
        self.client = client

    def explain_signal(self, s: Signal) -> tuple[str, list[str], str]:
        """Returns (explanation, conflicts, source) where source is 'claude' or 'deterministic'."""
        facts = signal_facts(s)
        fallback = deterministic_signal_explanation(s)
        try:
            resp = self.client.beta.messages.create(
                model=self.model,
                max_tokens=2000,
                system=SYSTEM,
                betas=["server-side-fallback-2026-07-01"],
                fallbacks="default",
                output_config={"effort": "low", "format": {"type": "json_schema", "schema": SCHEMA}},
                messages=[{"role": "user", "content": "Facts:\n" + json.dumps(facts, indent=1)}],
            )
        except Exception as e:  # network/API errors never block a signal
            log.warning("Claude explanation failed: %s", e)
            return fallback, [], "deterministic"
        if resp.stop_reason in ("refusal", "max_tokens"):
            return fallback, [], "deterministic"
        text = next((b.text for b in resp.content if getattr(b, "type", "") == "text"), "")
        try:
            data = json.loads(text)
        except json.JSONDecodeError:
            return fallback, [], "deterministic"
        expl, conflicts = data.get("explanation", ""), data.get("conflicts", [])
        if not expl or not numbers_grounded(expl + " " + " ".join(conflicts), facts):
            log.warning("discarding ungrounded AI explanation for %s", s.signal_id)
            return fallback, [], "deterministic"
        return expl, conflicts, "claude"


class Explainer:
    """Facade: uses Claude when configured, otherwise deterministic text."""

    def __init__(self, api_key: str = "", model: str = "claude-opus-5-5", client=None):
        self.claude = ClaudeExplainer(api_key, model, client) if (api_key or client) else None

    def explain_signal(self, s: Signal) -> tuple[str, list[str], str]:
        if self.claude is None:
            return deterministic_signal_explanation(s), [], "deterministic"
        return self.claude.explain_signal(s)
