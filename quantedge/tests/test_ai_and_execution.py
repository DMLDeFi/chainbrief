import json
from types import SimpleNamespace

import pytest

from quantedge.ai.explainer import ClaudeExplainer, Explainer, numbers_grounded, signal_facts
from quantedge.execution.bybit_executor import BybitExecutor, ExecutionDisabled, fmt_step
from quantedge.exchange.bybit_rest import BybitError

from conftest import make_signal


class FakeMessages:
    def __init__(self, text, stop="end_turn"):
        self.text, self.stop, self.calls = text, stop, []

    def create(self, **kw):
        self.calls.append(kw)
        return SimpleNamespace(stop_reason=self.stop, content=[SimpleNamespace(type="text", text=self.text)])


def fake_client(text, stop="end_turn"):
    m = FakeMessages(text, stop)
    return SimpleNamespace(beta=SimpleNamespace(messages=m)), m


def test_grounding_guard(inst):
    s = make_signal(inst)
    facts = signal_facts(s)
    assert numbers_grounded(f"Score {facts['score']} with reward/risk {facts['reward_risk']}.", facts)
    assert not numbers_grounded("Historically this setup wins 87% of the time.", facts)
    assert not numbers_grounded("Target 123456.7", facts)


def test_claude_explanation_accepted_when_grounded(inst):
    s = make_signal(inst)
    f = signal_facts(s)
    client, m = fake_client(json.dumps({"explanation": f"Trend pullback scored {f['score']}.", "conflicts": []}))
    expl, conflicts, src = ClaudeExplainer("", client=client).explain_signal(s)
    assert src == "claude" and "scored" in expl
    kw = m.calls[0]
    assert kw["model"] == "claude-opus-5-5" and kw["output_config"]["format"]["type"] == "json_schema"
    assert kw["fallbacks"] == "default"


def test_claude_invented_numbers_fall_back(inst):
    s = make_signal(inst)
    client, _ = fake_client(json.dumps({"explanation": "Price will reach 999999 soon; 92% win rate.", "conflicts": []}))
    _, _, src = ClaudeExplainer("", client=client).explain_signal(s)
    assert src == "deterministic"


def test_refusal_and_no_key_fall_back(inst):
    s = make_signal(inst)
    client, _ = fake_client("", stop="refusal")
    assert ClaudeExplainer("", client=client).explain_signal(s)[2] == "deterministic"
    assert Explainer().explain_signal(s)[2] == "deterministic"


class FakeRest:
    def __init__(self, positions=None, fail_stop=False):
        self.posts, self._pos, self.fail_stop = [], positions or [], fail_stop

    async def positions(self, symbol=None):
        return [p for p in self._pos if symbol in (None, p["symbol"])]

    async def open_orders(self, symbol=None, order_link_id=None):
        return [{"orderLinkId": order_link_id}] if any(p[0] == "/v5/order/create" for p in self.posts) else []

    async def post(self, path, body):
        if path == "/v5/position/trading-stop" and self.fail_stop:
            raise BybitError(10001, "nope", path)
        if path == "/v5/position/set-leverage":
            raise BybitError(110043, "leverage not modified", path)
        self.posts.append((path, body))
        return {"orderId": "1"}


def test_execution_disabled_by_default(cfg, inst):
    ex = BybitExecutor(cfg, FakeRest(), lambda: None, lambda: False)
    with pytest.raises(ExecutionDisabled):
        ex.ensure_enabled()
    cfg.execution.enabled = True
    with pytest.raises(ExecutionDisabled, match="approval"):
        ex.ensure_enabled()
    ex2 = BybitExecutor(cfg, FakeRest(), lambda: {"approved": True, "gate_passed": False}, lambda: False)
    with pytest.raises(ExecutionDisabled):
        ex2.ensure_enabled()


@pytest.mark.asyncio
async def test_entry_has_exchange_side_protection(cfg, inst):
    cfg.execution.enabled = True
    rest = FakeRest()
    ex = BybitExecutor(cfg, rest, lambda: {"approved": True, "gate_passed": True}, lambda: False)
    s = make_signal(inst)
    await ex.place_entry(s, inst)
    body = next(b for p, b in rest.posts if p == "/v5/order/create")
    assert body["orderLinkId"] == s.signal_id and body["stopLoss"] and body["takeProfit"]
    assert body["tpslMode"] == "Full" and body["slTriggerBy"] == "MarkPrice"
    assert ("/v5/account/set-margin-mode", {"setMarginMode": "ISOLATED_MARGIN"}) in rest.posts


@pytest.mark.asyncio
async def test_duplicate_entry_refused(cfg, inst):
    cfg.execution.enabled = True
    rest = FakeRest(positions=[{"symbol": "BTCUSDT", "size": "0.01"}])
    ex = BybitExecutor(cfg, rest, lambda: {"approved": True, "gate_passed": True}, lambda: False)
    with pytest.raises(ExecutionDisabled, match="duplicate"):
        await ex.place_entry(make_signal(inst), inst)


@pytest.mark.asyncio
async def test_reconcile_protects_or_flattens(cfg, inst):
    s = make_signal(inst)
    rest = FakeRest(positions=[{"symbol": "BTCUSDT", "size": "0.01", "side": "Buy", "stopLoss": ""},
                               {"symbol": "ETHUSDT", "size": "1", "side": "Sell", "stopLoss": ""}])
    rep = await BybitExecutor(cfg, rest, lambda: None, lambda: False).reconcile({s.signal_id: s})
    assert "BTCUSDT" in rep.protected                       # stop attached from local plan
    assert "ETHUSDT" in rep.unknown_positions and "ETHUSDT" in rep.flattened
    rest2 = FakeRest(positions=[{"symbol": "BTCUSDT", "size": "0.01", "side": "Buy", "stopLoss": "0"}], fail_stop=True)
    rep2 = await BybitExecutor(cfg, rest2, lambda: None, lambda: False).reconcile({s.signal_id: s})
    assert rep2.flattened == ["BTCUSDT"]
    close = [b for p, b in rest2.posts if p == "/v5/order/create"][0]
    assert close["reduceOnly"] is True and close["side"] == "Sell"


def test_fmt_step():
    assert fmt_step(0.123456, 0.001) == "0.123"
    assert fmt_step(101234.56, 0.1) == "101234.5"
    assert fmt_step(15.0, 1) == "15"
