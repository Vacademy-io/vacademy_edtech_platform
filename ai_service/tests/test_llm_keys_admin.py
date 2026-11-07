"""Offline tests for the super-admin LLM key API (routers/llm_keys_admin.py).

Runs the real router against an in-memory SQLite copy of the two key tables
(plus ai_model_change_log): platform staff only, keys stored encrypted and
never returned, reason + actor recorded, PATCH active clears automatic
blocks, the test call is rate limited, and the API degrades to an empty list /
503 while the tables or the encryption secret are missing. No network.
"""
from __future__ import annotations

import functools
import json
import os
import sys
from pathlib import Path

os.environ.setdefault("OPENROUTER_API_KEY", "or-platform")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

import httpx  # noqa: E402
import pytest  # noqa: E402
from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import create_engine, event, text  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

from ai_service.app.config import get_settings  # noqa: E402
from ai_service.app.core.security import get_current_user  # noqa: E402
from ai_service.app.db import db_dependency  # noqa: E402
from ai_service.app.routers import llm_keys_admin  # noqa: E402
from ai_service.app.schemas.auth import CustomUserDetails  # noqa: E402
from ai_service.app.services import model_defaults_admin  # noqa: E402
from ai_service.app.services.llm_providers import key_pool  # noqa: E402

STAFF = "staff-1"
BASE = "/ai-service/super-admin/v1/llm/keys"

_DDL = [
    """CREATE TABLE llm_provider_keys (
        id varchar(64) PRIMARY KEY, provider varchar(32) NOT NULL, label varchar(120) NOT NULL,
        org_label varchar(120), key_ciphertext text NOT NULL, key_hint varchar(16) NOT NULL,
        monthly_budget_usd numeric NOT NULL DEFAULT 200, soft_limit_pct integer NOT NULL DEFAULT 95,
        weight integer NOT NULL DEFAULT 1, status varchar(16) NOT NULL DEFAULT 'active',
        cooldown_until timestamp, exhausted_until timestamp, last_error text, last_error_at timestamp,
        last_used_at timestamp, created_by varchar(64), created_at timestamp, updated_at timestamp)""",
    """CREATE TABLE llm_key_spend (
        key_id varchar(64) NOT NULL REFERENCES llm_provider_keys(id) ON DELETE CASCADE,
        period_month date NOT NULL, metered_usd numeric NOT NULL DEFAULT 0, calls bigint NOT NULL DEFAULT 0,
        errors bigint NOT NULL DEFAULT 0, input_tokens bigint NOT NULL DEFAULT 0,
        output_tokens bigint NOT NULL DEFAULT 0, cache_read_tokens bigint NOT NULL DEFAULT 0,
        cache_write_tokens bigint NOT NULL DEFAULT 0, updated_at timestamp,
        PRIMARY KEY (key_id, period_month))""",
    """CREATE TABLE ai_model_change_log (
        id integer PRIMARY KEY AUTOINCREMENT, table_name text NOT NULL, row_key text NOT NULL,
        old_value text, new_value text, reason text NOT NULL, actor text, created_at timestamp)""",
]


@pytest.fixture
def api(monkeypatch):
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)

    @event.listens_for(engine, "connect")
    def _fns(conn, _):
        conn.create_function("now", 0, lambda: "2026-10-15T00:00:00+00:00")
        conn.execute("PRAGMA foreign_keys=ON")

    with engine.begin() as c:
        for ddl in _DDL:
            c.execute(text(ddl))
    Session = sessionmaker(bind=engine, future=True)

    def _db():
        s = Session()
        try:
            yield s
        finally:
            s.close()

    state = {"user": CustomUserDetails(username="staff", user_id=STAFF), "tables": True, "log": True}
    app = FastAPI()
    app.include_router(llm_keys_admin.router, prefix="/ai-service")
    app.dependency_overrides[db_dependency] = _db
    app.dependency_overrides[get_current_user] = lambda: state["user"]

    settings = get_settings()
    monkeypatch.setattr(settings, "super_admin_user_ids", STAFF)
    monkeypatch.setattr(settings, "internal_service_token", "svc-secret")
    monkeypatch.setenv("LLM_KEY_ENCRYPTION_KEY", "llm-keys-only-secret")
    monkeypatch.setattr(llm_keys_admin, "_tables_ready", lambda db: state["tables"])
    monkeypatch.setattr(model_defaults_admin, "change_log_available", lambda db: state["log"])
    monkeypatch.setattr(llm_keys_admin, "_anthropic_routes", lambda: [])
    llm_keys_admin._last_test.clear()
    key_pool._reset_for_tests()
    state["client"] = TestClient(app)
    state["engine"] = engine
    yield state
    key_pool._reset_for_tests()


def _create(api, **over):
    body = {"provider": "anthropic", "label": "Org A main", "org_label": "org-A",
            "api_key": "sk-ant-api03-secretWXYZ", "reason": "first key"}
    body.update(over)
    return api["client"].post(BASE, json=body)


def test_non_staff_is_refused_everywhere(api):
    api["user"] = CustomUserDetails(username="admin", user_id="institute-admin", is_root_user=True, roles=["ADMIN"])
    c = api["client"]
    assert c.get(BASE).status_code == 403
    assert _create(api).status_code == 403
    assert c.patch(f"{BASE}/x", json={"reason": "r", "weight": 2}).status_code == 403
    assert c.post(f"{BASE}/x/test").status_code == 403
    assert c.delete(f"{BASE}/x", params={"reason": "r"}).status_code == 403


def test_unset_allowlist_fails_closed(api, monkeypatch):
    monkeypatch.setattr(get_settings(), "super_admin_user_ids", None)
    assert api["client"].get(BASE).status_code == 403


def test_create_stores_ciphertext_and_returns_no_secret(api):
    r = _create(api)
    assert r.status_code == 201, r.text
    view = r.json()
    assert view["key_hint"] == "…WXYZ" and view["status"] == "active" and view["created_by"] == STAFF
    assert view["monthly_budget_usd"] == 200 and view["soft_limit_pct"] == 95 and view["weight"] == 1
    assert view["month"]["metered_usd"] == 0 and view["month"]["calls"] == 0
    assert "secret" not in r.text and "api_key" not in view and "key_ciphertext" not in view
    with api["engine"].connect() as c:
        ct = c.execute(text("SELECT key_ciphertext FROM llm_provider_keys")).scalar()
        log = c.execute(text("SELECT table_name, row_key, new_value, reason, actor FROM ai_model_change_log")).fetchone()
    assert "secret" not in ct and key_pool.cipher().decrypt(ct) == "sk-ant-api03-secretWXYZ"
    assert log.table_name == "llm_provider_keys" and log.row_key == view["id"]
    assert log.reason == "first key" and log.actor == STAFF and "secret" not in str(log.new_value)
    # (SQLite turns CAST(.. AS JSONB) into a number, so the JSON body itself is checked on _audit.)
    audit = llm_keys_admin._audit({**view, "api_key": "sk-ant-x", "month": view["month"]})
    assert audit["key_hint"] == "…WXYZ" and "api_key" not in audit and "month" not in audit


def test_create_validation(api):
    assert _create(api, reason="  ").status_code == 422
    assert _create(api, provider="openai").status_code == 422
    assert _create(api, api_key="sk-ant with space").status_code == 422
    assert _create(api, soft_limit_pct=0).status_code == 422
    assert _create(api).status_code == 201
    assert _create(api, label="again").status_code == 409, "the same key twice is refused"


def test_create_needs_tables_and_a_secret(api, monkeypatch):
    api["tables"] = False
    assert _create(api).status_code == 503
    listed = api["client"].get(BASE).json()
    assert listed["keys"] == [] and listed["tables_ready"] is False
    api["tables"] = True
    # The service token alone (shared with other services) is not enough any more.
    monkeypatch.delenv("LLM_KEY_ENCRYPTION_KEY")
    assert _create(api).status_code == 503
    assert api["client"].get(BASE).json()["encryption_ready"] is False
    monkeypatch.setenv("LLM_KEY_ENCRYPTION_KEY", "svc-secret")  # == INTERNAL_SERVICE_TOKEN: refused
    assert _create(api).status_code == 503


def test_list_shows_this_months_spend(api):
    kid = _create(api).json()["id"]
    period = key_pool.current_period()
    with api["engine"].begin() as c:
        c.execute(text("INSERT INTO llm_key_spend (key_id, period_month, metered_usd, calls, errors, input_tokens, "
                       "output_tokens, cache_read_tokens, cache_write_tokens) VALUES "
                       "(:k, :pm, 12.5, 40, 2, 1000, 500, 300, 20)"), {"k": kid, "pm": period})
        c.execute(text("INSERT INTO llm_key_spend (key_id, period_month, metered_usd) VALUES (:k, '2020-01-01', 99)"),
                  {"k": kid})
    body = api["client"].get(BASE, params={"provider": "anthropic"}).json()
    assert body["period_month"] == period.isoformat() and body["encryption_ready"] is True
    assert body["anthropic_routes"] == []
    month = body["keys"][0]["month"]
    assert month == {"metered_usd": 12.5, "calls": 40, "errors": 2, "input_tokens": 1000, "output_tokens": 500,
                     "cache_read_tokens": 300, "cache_write_tokens": 20}


def test_patch_updates_and_reactivating_clears_blocks(api):
    kid = _create(api).json()["id"]
    with api["engine"].begin() as c:
        c.execute(text("UPDATE llm_provider_keys SET status='auth_failed', cooldown_until='2099-01-01', "
                       "exhausted_until='2099-01-01' WHERE id=:k"), {"k": kid})
    key_pool._local_until[kid] = 9e12
    c = api["client"]
    assert c.patch(f"{BASE}/{kid}", json={"weight": 3}).status_code == 422, "reason is required"
    r = c.patch(f"{BASE}/{kid}", json={"weight": 3, "monthly_budget_usd": 150, "reason": "rebalance"})
    assert r.status_code == 200 and r.json()["weight"] == 3 and r.json()["monthly_budget_usd"] == 150
    assert r.json()["status"] == "auth_failed"
    r = c.patch(f"{BASE}/{kid}", json={"status": "active", "reason": "key rotated at Anthropic"})
    view = r.json()
    assert view["status"] == "active" and view["cooldown_until"] is None and view["exhausted_until"] is None
    assert kid not in key_pool._local_until
    assert c.patch(f"{BASE}/{kid}", json={"status": "auth_failed", "reason": "x"}).status_code == 422
    assert c.patch(f"{BASE}/nope", json={"weight": 2, "reason": "x"}).status_code == 404
    assert c.patch(f"{BASE}/{kid}", json={"reason": "nothing"}).status_code == 422


def test_writes_without_change_log_table_still_work(api):
    api["log"] = False
    assert _create(api).status_code == 201
    with api["engine"].connect() as c:
        assert c.execute(text("SELECT COUNT(*) FROM ai_model_change_log")).scalar() == 0


def test_delete_removes_key_and_spend(api):
    kid = _create(api).json()["id"]
    with api["engine"].begin() as c:
        c.execute(text("INSERT INTO llm_key_spend (key_id, period_month) VALUES (:k, '2026-10-01')"), {"k": kid})
    c = api["client"]
    assert c.delete(f"{BASE}/{kid}").status_code == 422, "reason is required"
    assert c.delete(f"{BASE}/{kid}", params={"reason": "org closed"}).json() == {"deleted": True}
    assert c.get(BASE).json()["keys"] == []
    with api["engine"].connect() as conn:
        assert conn.execute(text("SELECT COUNT(*) FROM llm_key_spend")).scalar() == 0
    assert c.delete(f"{BASE}/{kid}", params={"reason": "again"}).status_code == 404


def test_key_test_call_is_tiny_and_rate_limited(api, monkeypatch):
    kid = _create(api).json()["id"]
    seen = []

    def handler(request):
        seen.append((str(request.url), json.loads(request.content), dict(request.headers)))
        return httpx.Response(200, json={"content": [{"type": "text", "text": "ok"}], "stop_reason": "end_turn"})

    monkeypatch.setattr(llm_keys_admin.httpx, "AsyncClient",
                        functools.partial(httpx.AsyncClient, transport=httpx.MockTransport(handler)))
    r = api["client"].post(f"{BASE}/{kid}/test")
    assert r.status_code == 200 and r.json()["ok"] is True and r.json()["model"] == "claude-haiku-5-5"
    url, body, headers = seen[0]
    assert url == "https://api.anthropic.com/v1/messages" and body["max_tokens"] == 8
    assert headers["x-api-key"] == "sk-ant-api03-secretWXYZ" and headers["anthropic-version"] == "2023-06-01"
    assert api["client"].post(f"{BASE}/{kid}/test").status_code == 429
    assert "secretWXYZ" not in r.text


def test_key_test_reports_vendor_error(api, monkeypatch):
    kid = _create(api).json()["id"]
    monkeypatch.setattr(llm_keys_admin.httpx, "AsyncClient", functools.partial(
        httpx.AsyncClient, transport=httpx.MockTransport(lambda r: httpx.Response(
            401, json={"type": "error", "error": {"type": "authentication_error", "message": "invalid x-api-key"}}))))
    out = api["client"].post(f"{BASE}/{kid}/test").json()
    assert out["ok"] is False and "401" in out["error"] and "invalid x-api-key" in out["error"]
