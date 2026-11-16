"""Offline tests for services/vendor_balances.py: each vendor's response shape, each key sent
only to its own vendor with that vendor's auth header, errors that never echo a key or a
vendor body, and the cache. No network: httpx.MockTransport answers every request."""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

import httpx  # noqa: E402

from ai_service.app.services import vendor_balances as vb  # noqa: E402

OR_KEY, OR_MGMT, FAL_KEY, RP_KEY = "sk-or-aaaa1111", "sk-or-mgmt9999", "fal-bbbb2222", "rp-cccc3333"


def _client(handler):
    return httpx.Client(transport=httpx.MockTransport(handler))


def _by_vendor(rows):
    return {r["vendor"]: r for r in rows}


def test_parsers():
    assert vb.parse_openrouter_credits({"data": {"total_credits": 100.5, "total_usage": 25.75}}) == {
        "balance": 74.75, "currency": "USD"}
    assert vb.parse_fal_billing({"username": "t", "credits": {"current_balance": 24.5, "currency": "usd"}}) == {
        "balance": 24.5, "currency": "USD"}
    rp = vb.parse_runpod_myself({"data": {"myself": {"clientBalance": 12.3, "currentSpendPerHr": 0.4}}})
    assert rp == {"balance": 12.3, "currency": "USD", "spend_per_hour": 0.4}
    capped = vb.parse_openrouter_key({"data": {"limit": 100, "limit_remaining": 74.5}})
    assert capped["balance"] == 74.5 and capped["kind"] == vb.KEY_LIMIT
    uncapped = vb.parse_openrouter_key({"data": {"limit": None, "limit_remaining": None}})
    assert uncapped["status"] == "not_set_up" and "management key" in uncapped["message"] and "_KEY" not in uncapped["message"]


def test_parsers_reject_missing_figures():
    for parse, payload in [
        (vb.parse_openrouter_credits, {"data": {}}),
        (vb.parse_fal_billing, {"username": "t"}),
        (vb.parse_runpod_myself, {"errors": [{"message": "x"}]}),
        (vb.parse_runpod_myself, {"data": {"myself": {"clientBalance": None}}}),
    ]:
        try:
            parse(payload)
        except ValueError:
            continue
        raise AssertionError(f"{parse.__name__} accepted {payload}")


def test_each_key_goes_only_to_its_vendor():
    seen = []

    def handler(request: httpx.Request):
        seen.append((request.url.host, request.headers.get("authorization")))
        if request.url.host == "openrouter.ai":
            assert request.url.path == "/api/v1/credits"
            return httpx.Response(200, json={"data": {"total_credits": 50, "total_usage": 20}})
        if request.url.host == "api.fal.ai":
            assert request.url.params.get("expand") == "credits"
            return httpx.Response(200, json={"credits": {"current_balance": 8, "currency": "USD"}})
        if request.url.host == "api.runpod.io":
            assert "clientBalance" in json.loads(request.content)["query"]
            return httpx.Response(200, json={"data": {"myself": {"clientBalance": 3.5, "currentSpendPerHr": 0}}})
        raise AssertionError(f"unexpected host {request.url.host}")

    env = {"OPENROUTER_API_KEY": OR_KEY, "OPENROUTER_MANAGEMENT_KEY": OR_MGMT,
           "FAL_API_KEY": FAL_KEY, "RUNPOD_API_KEY": RP_KEY}
    rows = _by_vendor(vb.fetch_all(env, _client(handler)))
    assert sorted(seen) == sorted([
        ("openrouter.ai", f"Bearer {OR_MGMT}"),
        ("api.fal.ai", f"Key {FAL_KEY}"),
        ("api.runpod.io", f"Bearer {RP_KEY}"),
    ])
    assert rows["OpenRouter"]["balance"] == 30 and rows["OpenRouter"]["account"] == "account"
    assert rows["fal.ai"]["balance"] == 8 and rows["fal.ai"]["account"] == "key …2222"
    assert rows["RunPod"]["balance"] == 3.5
    assert all(r["status"] == "ok" for r in rows.values())


def test_without_management_key_uses_each_key_limit():
    def handler(request: httpx.Request):
        assert request.url.path == "/api/v1/key"
        cap = request.headers["authorization"].endswith("1111")
        return httpx.Response(200, json={"data": {"limit": 10 if cap else None, "limit_remaining": 4 if cap else None}})

    rows = vb.openrouter_rows(_client(handler), {"OPENROUTER_API_KEY": f"{OR_KEY}, sk-or-dddd4444"})
    assert [(r["account"], r["status"], r["balance"]) for r in rows] == [
        ("key …1111", "ok", 4), ("key …4444", "not_set_up", None)]


def test_missing_keys_are_not_set_up():
    rows = _by_vendor(vb.fetch_all({}, _client(lambda r: (_ for _ in ()).throw(AssertionError("no call")))))
    assert {v: r["status"] for v, r in rows.items()} == {
        "OpenRouter": "not_set_up", "fal.ai": "not_set_up", "RunPod": "not_set_up"}


def test_errors_never_echo_key_or_body():
    secret_body = "account owner@example.com balance details"

    def handler(request: httpx.Request):
        if request.url.host == "api.fal.ai":
            return httpx.Response(403, text=secret_body)
        if request.url.host == "api.runpod.io":
            raise httpx.ConnectTimeout("timed out", request=request)
        return httpx.Response(200, text="not json")

    env = {"OPENROUTER_MANAGEMENT_KEY": OR_MGMT, "FAL_API_KEY": FAL_KEY, "RUNPOD_API_KEY": RP_KEY}
    rows = _by_vendor(vb.fetch_all(env, _client(handler)))
    assert rows["fal.ai"]["message"] == "fal.ai refused our key, so the balance could not be read. The key may be expired or revoked."
    assert rows["RunPod"]["message"] == "RunPod took too long to answer. Try again later."
    assert rows["OpenRouter"]["message"] == "OpenRouter answered, but not in the format we expected."
    dumped = json.dumps(list(rows.values()))
    for leaked in (OR_MGMT, FAL_KEY, RP_KEY, secret_body):
        assert leaked not in dumped
    assert all(r["status"] == "error" and r["balance"] is None for r in rows.values())


def test_cache_and_refresh_floor():
    calls, now = [], [1000.0]
    cache = vb.BalanceCache(fetch=lambda: calls.append(1) or [{"n": len(calls)}], clock=lambda: now[0])
    assert cache.get() == [{"n": 1}]
    now[0] += 10
    assert cache.get(refresh=True) == [{"n": 1}], "refresh inside the floor uses the cache"
    now[0] += vb.MIN_REFRESH_SECONDS
    assert cache.get(refresh=True) == [{"n": 2}]
    now[0] += 60
    assert cache.get() == [{"n": 2}]
    now[0] += vb.CACHE_SECONDS
    assert cache.get() == [{"n": 3}]
