"""AI subscription plans API (contract P-API) on a REAL Postgres 16 with the real
Flyway migrations V586 + V587 + V588 (the V588 freeze triggers and partial
unique indexes are part of what is tested), through SQLAlchemy + psycopg 3.

  super admin  /super-admin/v1/plans/**             routers/plans_admin.py
  tenant       /credits/v2/institutes/{id}/plan       routers/credits_plan.py
  internal     /internal/plans/v1/roll                routers/plans_internal.py

Covers: the auth matrix on every route (no token 401, institute admin 403 on
super-admin routes, platform staff OK; tenant view: other institute 403,
member OK without caps detail, admin with usage_pct; internal token), the V588
seed (24 features, AI Pro DRAFT), locked features, eligibility validation,
DRAFT editing and PUBLISHED immutability (409 from the API, the trigger in the
database), publish diff, one open subscription per institute (409, including
10 concurrent assignments), overrides, events, the roll job (renew, cancel at
period end, expiry, pending plan change, scheduled start, idempotency and 6
concurrent runs), simulate / pnl shapes, and that the tenant view never shows
USD or internal caps.

Needs a Postgres: AI_LIMITS_PG_URL (server URL, postgresql+psycopg://...) or
AI_LIMITS_PGDATA (a pgserver data directory); AI_LIMITS_PG_TEMPLATE optionally
names a template database (e.g. prodbase). Skipped otherwise. From the repo root:
  AI_LIMITS_PGDATA=<dir> <venv>/bin/python -m pytest ai_service/tests/test_plans_api.py -q -p no:cacheprovider
"""
from __future__ import annotations

import base64
import os
import sys
import threading
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))
os.environ.setdefault("OPENROUTER_API_KEY", "or-platform")

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from jose import jwt  # noqa: E402
from sqlalchemy import create_engine, text  # noqa: E402
from sqlalchemy.exc import DBAPIError  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402

from ai_service.app import config as app_config  # noqa: E402
from ai_service.app import dependencies as app_deps  # noqa: E402
from ai_service.app.config import get_settings  # noqa: E402
from ai_service.app.core import security  # noqa: E402
from ai_service.app.db import db_dependency  # noqa: E402
from ai_service.app.routers import credits_limits as cl  # noqa: E402
from ai_service.app.routers import credits_plan as cp  # noqa: E402
from ai_service.app.routers import plans_admin as pa  # noqa: E402
from ai_service.app.routers import plans_internal as pi  # noqa: E402

MIGRATIONS = Path(__file__).resolve().parents[2] / "admin_core_service/src/main/resources/db/migration"
UTC = timezone.utc
STAFF = "staff-1"
ADMIN = "admin-1"
MEMBER = "member-1"
SA = "/super-admin/v1/plans"
TOKEN = "svc-token"

STUBS = """
CREATE TABLE IF NOT EXISTS credit_transactions (id UUID PRIMARY KEY, institute_id VARCHAR(64), amount NUMERIC);
CREATE TABLE IF NOT EXISTS ai_token_usage (id UUID PRIMARY KEY, institute_id VARCHAR(64));
CREATE TABLE IF NOT EXISTS institutes (id VARCHAR(64) PRIMARY KEY, name VARCHAR(255));
CREATE TABLE IF NOT EXISTS ai_models (model_id VARCHAR(255) PRIMARY KEY, is_active BOOLEAN DEFAULT TRUE,
    output_price_per_1m NUMERIC, display_order INT);
CREATE TABLE IF NOT EXISTS ai_model_change_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), table_name TEXT NOT NULL, row_key TEXT NOT NULL,
    old_value JSONB, new_value JSONB, reason TEXT NOT NULL, actor TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
"""


def _migration(prefix: str) -> str:
    hits = sorted(MIGRATIONS.glob(f"{prefix}__*.sql"))
    if not hits:
        pytest.skip(f"{prefix} migration not in this checkout")
    return hits[0].read_text(encoding="utf-8")


def _server_url():
    url = os.environ.get("AI_LIMITS_PG_URL")
    if url:
        return url
    data = os.environ.get("AI_LIMITS_PGDATA")
    if not data:
        return None
    try:
        import pgserver  # noqa: PLC0415

        uri = pgserver.get_server(data, cleanup_mode=None).get_uri()
    except Exception:  # noqa: BLE001
        return None
    return uri.replace("postgresql://", "postgresql+psycopg://", 1)


@pytest.fixture(scope="module")
def pg():
    base = _server_url()
    if not base:
        pytest.skip("no Postgres: set AI_LIMITS_PG_URL or AI_LIMITS_PGDATA")
    try:
        import psycopg  # noqa: F401,PLC0415
    except Exception:  # noqa: BLE001
        pytest.skip("psycopg 3 not installed")
    name = f"plans_{uuid.uuid4().hex[:10]}"
    admin = create_engine(base, isolation_level="AUTOCOMMIT", future=True)
    template = os.environ.get("AI_LIMITS_PG_TEMPLATE")
    with admin.connect() as c:
        c.execute(text(f'CREATE DATABASE "{name}"' + (f' TEMPLATE "{template}"' if template else "")))
    url = base.replace("/postgres?", f"/{name}?") if "/postgres?" in base else base.rsplit("/", 1)[0] + f"/{name}"
    engine = create_engine(url, pool_size=20, max_overflow=10, future=True)
    with engine.begin() as c:
        c.exec_driver_sql(STUBS)
    for prefix in ("V586", "V587", "V588"):
        sql = _migration(prefix)
        raw = engine.raw_connection()  # one transaction, like Flyway; no parameter parsing ('%' in RAISE)
        try:
            cur = raw.cursor()
            cur.execute(sql)
            raw.commit()
        finally:
            raw.close()
    yield engine
    engine.dispose()
    with admin.connect() as c:
        c.execute(text(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))
    admin.dispose()


def _token(authorities, user):
    secret = get_settings().jwt_secret_key
    secret += "=" * (-len(secret) % 4)
    claims = {"sub": user, "username": user, "user": user, "user_id": user, "is_root_user": True,
              "authorities": authorities}
    return "Bearer " + jwt.encode(claims, base64.b64decode(secret), algorithm="HS256")


def _hdr(inst, roles=("ADMIN",), user=ADMIN):
    return {"Authorization": _token({inst: {"roles": list(roles), "permissions": []}}, user)}


class FakeEngine:
    def __init__(self):
        self.invalidated = []
        self.sim_calls = []
        self.pnl_calls = []

    def invalidate(self, institute_id=None):
        self.invalidated.append(institute_id)

    def simulate(self, db, plan_version_id, institute_id, days=30):
        self.sim_calls.append((plan_version_id, institute_id, days))
        return {"features": [{"feature_key": "tutor_chat", "included_credits": 10.0, "allowance_credits": 0.0,
                              "charged_credits": 2.0, "real_cost_usd": 0.05}],
                "revenue_minor": 500000, "margin_inr": 4990.0}

    def pnl(self, db, institute_id=None, period="current"):
        self.pnl_calls.append((institute_id, period))
        return [{"institute_id": institute_id or "x", "plan": "AI Pro", "period": period, "price_minor": 500000,
                 "included_list_credits": 0, "included_cost_usd": 0, "allowance_used": 0, "charged_credits": 0,
                 "real_cost_usd_total": 0, "margin_inr": 5000.0}]


@pytest.fixture
def env(pg, monkeypatch):
    real = get_settings()
    stub = SimpleNamespace(jwt_secret_key=real.jwt_secret_key, jwt_algorithm=real.jwt_algorithm,
                           super_admin_user_ids=STAFF, internal_service_token=TOKEN, client_secret=None,
                           client_name=getattr(real, "client_name", None),
                           auth_service_base_url=getattr(real, "auth_service_base_url", None))
    monkeypatch.setattr(security, "get_settings", lambda: stub)
    import ai_service.app.routers.super_admin as sa_mod
    monkeypatch.setattr(sa_mod, "get_settings", lambda: stub)
    monkeypatch.setattr(app_deps, "get_settings", lambda: stub)
    fake = FakeEngine()
    state = {"enabled": False}
    monkeypatch.setattr(pa, "get_plans_engine", lambda: fake)
    monkeypatch.setattr(pa, "plans_enabled", lambda: state["enabled"])
    monkeypatch.setattr(cp, "_default_chain_models", lambda db, key: ["z-ai/glm-5.3-flash"])
    pa.reset_for_tests()
    with pg.begin() as c:
        for t in ("ai_subscription_event", "ai_subscription_override", "ai_subscription_period",
                  "institute_ai_subscription", "ai_usage_counter", "ai_model_change_log"):
            c.execute(text(f"DELETE FROM {t}"))
    Session = sessionmaker(bind=pg, future=True)

    def _db():
        s = Session()
        try:
            yield s
        finally:
            s.close()

    app = FastAPI()
    app.include_router(pa.router)
    app.include_router(cp.router)
    app.include_router(pi.router)
    app.dependency_overrides[db_dependency] = _db
    app.dependency_overrides[app_config.get_settings] = lambda: stub
    return SimpleNamespace(client=TestClient(app), engine=pg, fake=fake, state=state, Session=Session)


STAFF_H = None


def staff():
    return _hdr("any-inst", roles=("ADMIN",), user=STAFF)


def _inst(env, name="Test Institute"):
    iid = str(uuid.uuid4())
    with env.engine.begin() as c:
        c.execute(text("INSERT INTO institutes (id, name) VALUES (:i, :n)"), {"i": iid, "n": name})
    return iid


def _q(env, sql, **params):
    with env.engine.begin() as c:
        return [dict(r._mapping) for r in c.execute(text(sql), params)]


GOOD_ITEMS = [
    {"feature_key": "tutor_chat", "mode": "INCLUDED", "roles_included": ["STUDENT"], "user_units_cap": 300,
     "inst_units_cap": 1000, "display_cap_text": "Learners only. 300 turns per learner"},
    {"feature_key": "learner_analytics", "mode": "INCLUDED", "inst_credits_cap": 1500, "user_credits_cap": 3,
     "user_cap_basis": "SUBJECT", "inst_cost_usd_cap": 2.5},
    {"feature_key": "image_generation", "mode": "ALLOWANCE", "model_policy": "ANY"},
    {"feature_key": "ai_calling", "mode": "CHARGED", "model_policy": "ANY"},
]


def _published(env, key=None, items=None, **terms):
    c = env.client
    key = key or f"p_{uuid.uuid4().hex[:8]}"
    r = c.post(f"{SA}/plans", json={"plan_key": key, "name": f"Plan {key}", "reason": "t"}, headers=staff())
    assert r.status_code == 200, r.text
    pid = r.json()["id"]
    r = c.post(f"{SA}/plans/{pid}/versions", json={"copy_latest": False, "reason": "t"}, headers=staff())
    assert r.status_code == 200, r.text
    vid = r.json()["id"]
    body = {"price_minor": 500000, "allowance_credits": 2000, "internal_cost_cap_usd": 13.95, "reason": "t", **terms}
    assert c.patch(f"{SA}/versions/{vid}", json=body, headers=staff()).status_code == 200
    r = c.put(f"{SA}/versions/{vid}/items", json={"items": items or GOOD_ITEMS, "reason": "t"}, headers=staff())
    assert r.status_code == 200, r.text
    r = c.post(f"{SA}/versions/{vid}/publish", json={"reason": "test"}, headers=staff())
    assert r.status_code == 200, r.text
    return pid, vid


def _assign(env, iid, vid, **kw):
    body = {"institute_id": iid, "plan_version_id": vid, "reason": "pilot", **kw}
    for k, v in list(body.items()):
        if isinstance(v, datetime):
            body[k] = v.isoformat()
    return env.client.post(f"{SA}/subscriptions", json=body, headers=staff())


# ── auth matrix ─────────────────────────────────────────────────────────────

ROUTES = [
    ("GET", "/features", None), ("PATCH", "/features/no_such_feature", {"label": "x"}),
    ("GET", "/plans", None), ("POST", "/plans", {"plan_key": "zz_auth", "name": "x"}),
    ("GET", "/plans/ai_pro", None), ("POST", "/plans/no_such_plan/versions", {}),
    ("PATCH", f"/versions/{uuid.uuid4()}", {"price_minor": 1}), ("PUT", f"/versions/{uuid.uuid4()}/items", {"items": []}),
    ("POST", f"/versions/{uuid.uuid4()}/publish", {}), ("POST", f"/versions/{uuid.uuid4()}/retire", {}),
    ("GET", "/subscriptions", None), ("POST", "/subscriptions", {"institute_id": "i", "plan_version_id": "v", "reason": "r"}),
    ("GET", f"/subscriptions/{uuid.uuid4()}", None), ("PATCH", f"/subscriptions/{uuid.uuid4()}", {"reason": "r"}),
    ("POST", f"/subscriptions/{uuid.uuid4()}/cancel", {"reason": "r"}),
    ("GET", f"/subscriptions/{uuid.uuid4()}/overrides", None),
    ("POST", f"/subscriptions/{uuid.uuid4()}/overrides", {"feature_key": "kb_qa", "reason": "r"}),
    ("DELETE", f"/subscriptions/{uuid.uuid4()}/overrides/{uuid.uuid4()}?reason=r", None),
    ("GET", f"/subscriptions/{uuid.uuid4()}/events", None),
    ("POST", "/simulate", {"plan_version_id": str(uuid.uuid4()), "institute_id": "i", "days": 30}),
    ("GET", "/pnl", None),
]


@pytest.mark.parametrize("method,path,body", ROUTES)
def test_super_admin_routes_need_platform_staff(env, method, path, body):
    c = env.client
    kw = {"json": body} if body is not None else {}
    assert c.request(method, SA + path, **kw).status_code == 401
    inst = str(uuid.uuid4())
    r = c.request(method, SA + path, headers=_hdr(inst, ("ADMIN",), ADMIN), **kw)
    assert r.status_code == 403, r.text
    r = c.request(method, SA + path, headers=staff(), **kw)
    assert r.status_code not in (401, 403), r.text


def test_internal_roll_needs_the_service_token(env):
    c = env.client
    assert c.post("/internal/plans/v1/roll").status_code == 401
    assert c.post("/internal/plans/v1/roll", headers={"X-Internal-Service-Token": "nope"}).status_code in (401, 403)
    assert c.post("/internal/plans/v1/roll", headers=staff()).status_code == 401   # a user token is not enough
    r = c.post("/internal/plans/v1/roll", headers={"X-Internal-Service-Token": TOKEN})
    assert r.status_code == 200 and r.json()["ok"] is True, r.text


def test_tenant_plan_auth(env):
    iid, other = _inst(env), _inst(env)
    c = env.client
    url = f"/credits/v2/institutes/{iid}/plan"
    assert c.get(url).status_code == 401
    assert c.get(url, headers=_hdr(other, ("ADMIN",))).status_code == 403
    r = c.get(url, headers=_hdr(iid, ("TEACHER",), MEMBER))
    assert r.status_code == 200 and r.json() == {"plan": None, "allowance": None, "features": []}
    assert c.get(url, headers=staff()).status_code == 200


# ── seed + feature catalogue ────────────────────────────────────────────────

def test_seed_features_and_draft_ai_pro(env):
    r = env.client.get(f"{SA}/features", headers=staff())
    assert r.status_code == 200
    feats = {f["feature_key"]: f for f in r.json()["features"]}
    assert len(feats) == 24
    assert feats["ai_calling"]["locked"] and feats["ai_calling"]["eligibility"] == "ALWAYS_CHARGED"
    assert feats["telephony"]["locked"]
    assert feats["image_generation"]["eligibility"] == "ALLOWANCE_ONLY"
    assert any(u["use_case"] == "tutor_chat" for u in feats["tutor_chat"]["use_cases"])
    # every catalog row is mapped to a known feature
    assert r.json()["unknown_feature_keys"] == []
    assert _q(env, "SELECT count(*) AS n FROM ai_use_case_catalog WHERE billing_feature_key IS NULL")[0]["n"] == 0
    r = env.client.get(f"{SA}/plans/ai_pro", headers=staff())
    assert r.status_code == 200
    v = r.json()["versions"]
    assert len(v) == 1 and v[0]["status"] == "DRAFT" and v[0]["price_minor"] == 500000
    assert {i["feature_key"]: i["mode"] for i in v[0]["items"]}["ai_calling"] == "CHARGED"
    plans = env.client.get(f"{SA}/plans", headers=staff()).json()["plans"]
    pro = next(p for p in plans if p["plan_key"] == "ai_pro")
    assert pro["live_version"] is None and pro["versions"][0]["item_count"] == 24


def test_feature_patch_locked_rules(env):
    c = env.client
    r = c.patch(f"{SA}/features/ai_calling", json={"label": "Calls", "reason": "t"}, headers=staff())
    assert r.status_code == 409 and "unlock_reason" in r.json()["detail"]
    r = c.patch(f"{SA}/features/ai_calling", json={"eligibility": "INCLUDABLE", "unlock_reason": "deal"},
                headers=staff())
    assert r.status_code == 409 and "ALWAYS_CHARGED" in r.json()["detail"]
    r = c.patch(f"{SA}/features/ai_calling", json={"label": "AI phone calls (voice bot)", "unlock_reason": "rename"},
                headers=staff())
    assert r.status_code == 200 and r.json()["label"] == "AI phone calls (voice bot)"
    assert r.json()["eligibility"] == "ALWAYS_CHARGED" and r.json()["locked"] is True
    log = _q(env, "SELECT * FROM ai_model_change_log WHERE table_name = 'ai_billing_feature' AND row_key = 'ai_calling'")
    assert log and log[-1]["actor"] == STAFF and "rename" in log[-1]["reason"]
    c.patch(f"{SA}/features/ai_calling", json={"label": "AI phone calls", "unlock_reason": "restore"}, headers=staff())
    assert c.patch(f"{SA}/features/kb_qa", json={"eligibility": "SOMETIMES"}, headers=staff()).status_code == 422
    assert c.patch(f"{SA}/features/kb_qa", json={}, headers=staff()).status_code == 422
    assert c.patch(f"{SA}/features/nope", json={"label": "x", "reason": "t"}, headers=staff()).status_code == 404
    r = c.patch(f"{SA}/features/copilot", json={"eligibility": "ALLOWANCE_ONLY", "reason": "t"}, headers=staff())
    assert r.status_code == 200 and r.json()["eligibility"] == "ALLOWANCE_ONLY"
    c.patch(f"{SA}/features/copilot", json={"eligibility": "INCLUDABLE", "reason": "restore"}, headers=staff())


# ── plans, versions, items, immutability ────────────────────────────────────

def test_plan_create_validation(env):
    c = env.client
    assert c.post(f"{SA}/plans", json={"plan_key": "Bad Key", "name": "x"}, headers=staff()).status_code == 422
    assert c.post(f"{SA}/plans", json={"plan_key": "ok_key_1", "name": " "}, headers=staff()).status_code == 422
    key = f"k_{uuid.uuid4().hex[:6]}"
    assert c.post(f"{SA}/plans", json={"plan_key": key, "name": "A", "reason": "t"}, headers=staff()).status_code == 200
    assert c.post(f"{SA}/plans", json={"plan_key": key, "name": "B", "reason": "t"}, headers=staff()).status_code == 409
    assert c.get(f"{SA}/plans/{uuid.uuid4()}", headers=staff()).status_code == 404


def test_items_validation(env):
    c = env.client
    key = f"v_{uuid.uuid4().hex[:6]}"
    pid = c.post(f"{SA}/plans", json={"plan_key": key, "name": "V", "reason": "t"}, headers=staff()).json()["id"]
    vid = c.post(f"{SA}/plans/{pid}/versions", json={"reason": "t"}, headers=staff()).json()["id"]

    def put(items):
        return c.put(f"{SA}/versions/{vid}/items", json={"items": items, "reason": "t"}, headers=staff())

    assert put([{"feature_key": "ai_calling", "mode": "INCLUDED"}]).status_code == 422
    assert put([{"feature_key": "telephony", "mode": "ALLOWANCE"}]).status_code == 422
    assert put([{"feature_key": "premium_tts", "mode": "ALLOWANCE"}]).status_code == 422       # ALWAYS_CHARGED
    assert put([{"feature_key": "image_generation", "mode": "INCLUDED"}]).status_code == 422   # ALLOWANCE_ONLY
    assert put([{"feature_key": "nope", "mode": "CHARGED"}]).status_code == 422
    assert put([{"feature_key": "kb_qa", "mode": "CHARGED"}, {"feature_key": "kb_qa", "mode": "CHARGED"}]).status_code == 422
    assert put([{"feature_key": "kb_qa", "mode": "INCLUDED", "model_policy": "ALLOWLIST"}]).status_code == 422
    assert put([{"feature_key": "kb_qa", "mode": "INCLUDED", "model_policy": "MAX_PRICE"}]).status_code == 422
    assert put([{"feature_key": "kb_qa", "mode": "INCLUDED", "over_cap_action": "BLOCK"}]).status_code == 422
    assert put([{"feature_key": "kb_qa", "mode": "INCLUDED", "on_model_violation": "BLOCK"}]).status_code == 422
    assert put([{"feature_key": "kb_qa", "mode": "INCLUDED", "roles_included": ["WIZARD"]}]).status_code == 422
    assert put([{"feature_key": "kb_qa", "mode": "INCLUDED", "inst_units_cap": -1}]).status_code == 422
    assert put([{"feature_key": "kb_qa", "mode": "SOMETIMES"}]).status_code == 422
    r = put([{"feature_key": "tutor_chat", "mode": "INCLUDED", "roles_included": ["student", "LEARNER"],
              "model_policy": "ALLOWLIST", "model_allowlist": ["z-ai/glm-5.3-flash"]}])
    assert r.status_code == 200, r.text
    item = r.json()["items"][0]
    assert item["roles_included"] == ["LEARNER"] and item["model_allowlist"] == ["z-ai/glm-5.3-flash"]
    # terms validation
    for bad in ({"price_minor": -1}, {"period_months": 0}, {"grace_behaviour": "MAYBE"}, {"currency": "rupees"},
                {"allowance_credits": -5}, {"price_minor": None}):
        assert c.patch(f"{SA}/versions/{vid}", json={**bad, "reason": "t"}, headers=staff()).status_code == 422, bad
    r = c.patch(f"{SA}/versions/{vid}", json={"internal_cost_cap_usd": None, "reason": "t"}, headers=staff())
    assert r.status_code == 200 and r.json()["internal_cost_cap_usd"] is None


def test_publish_requires_items_and_freezes(env):
    c = env.client
    key = f"f_{uuid.uuid4().hex[:6]}"
    pid = c.post(f"{SA}/plans", json={"plan_key": key, "name": "F", "reason": "t"}, headers=staff()).json()["id"]
    vid = c.post(f"{SA}/plans/{pid}/versions", json={"reason": "t"}, headers=staff()).json()["id"]
    r = c.post(f"{SA}/versions/{vid}/publish", json={"reason": "t"}, headers=staff())
    assert r.status_code == 422 and "at least one item" in r.json()["detail"]
    c.patch(f"{SA}/versions/{vid}", json={"allowance_credits": 2000, "internal_cost_cap_usd": 10, "reason": "t"}, headers=staff())
    assert c.put(f"{SA}/versions/{vid}/items", json={"items": GOOD_ITEMS, "reason": "t"}, headers=staff()).status_code == 200
    # eligibility tightened after the edit: publish re-validates
    c.patch(f"{SA}/features/tutor_chat", json={"eligibility": "ALLOWANCE_ONLY", "reason": "t"}, headers=staff())
    r = c.post(f"{SA}/versions/{vid}/publish", json={"reason": "t"}, headers=staff())
    assert r.status_code == 422 and r.json()["detail"]["problems"]
    c.patch(f"{SA}/features/tutor_chat", json={"eligibility": "INCLUDABLE", "reason": "restore"}, headers=staff())
    r = c.post(f"{SA}/versions/{vid}/publish", json={"reason": "launch"}, headers=staff())
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["status"] == "PUBLISHED" and out["published_by"] == STAFF
    assert out["diff"]["against_version_id"] is None and len(out["diff"]["items"]) == len(GOOD_ITEMS)
    # API refuses every change
    assert c.patch(f"{SA}/versions/{vid}", json={"price_minor": 1, "reason": "t"}, headers=staff()).status_code == 409
    assert c.put(f"{SA}/versions/{vid}/items", json={"items": GOOD_ITEMS[:1], "reason": "t"}, headers=staff()).status_code == 409
    assert c.post(f"{SA}/versions/{vid}/publish", json={"reason": "t"}, headers=staff()).status_code == 409
    # the database refuses too (trigger), whoever writes
    for sql in ("UPDATE ai_plan_version SET price_minor = 1 WHERE id = CAST(:v AS UUID)",
                "UPDATE ai_plan_item SET mode = 'CHARGED' WHERE plan_version_id = CAST(:v AS UUID)",
                "DELETE FROM ai_plan_item WHERE plan_version_id = CAST(:v AS UUID)",
                "UPDATE ai_plan_version SET status = 'DRAFT' WHERE id = CAST(:v AS UUID)"):
        with pytest.raises(DBAPIError):
            with env.engine.begin() as conn:
                conn.execute(text(sql), {"v": vid})
    # a new version copies the items and supersedes the published one
    r = c.post(f"{SA}/plans/{key}/versions", json={"reason": "t"}, headers=staff())
    assert r.status_code == 200
    v2 = r.json()
    assert v2["version_no"] == 2 and v2["status"] == "DRAFT" and v2["supersedes_version_id"] == vid
    assert len(v2["items"]) == len(GOOD_ITEMS) and v2["allowance_credits"] == 2000.0
    c.patch(f"{SA}/versions/{v2['id']}", json={"price_minor": 600000, "reason": "t"}, headers=staff())
    r = c.post(f"{SA}/versions/{v2['id']}/publish", json={"reason": "t"}, headers=staff())
    assert r.status_code == 200
    assert {"field": "price_minor", "old": 0, "new": 600000} in r.json()["diff"]["terms"]
    # retire
    r = c.post(f"{SA}/versions/{vid}/retire", json={"reason": "old"}, headers=staff())
    assert r.status_code == 200 and r.json()["status"] == "RETIRED"
    assert c.post(f"{SA}/versions/{vid}/retire", json={"reason": "t"}, headers=staff()).status_code == 409
    assert c.post(f"{SA}/versions/{v2['id']}/retire", json={"reason": "t"}, headers=staff()).status_code == 200
    detail = c.get(f"{SA}/plans/{pid}", headers=staff()).json()
    assert [v["status"] for v in detail["versions"]] == ["RETIRED", "RETIRED"]


# ── subscriptions ───────────────────────────────────────────────────────────

def test_subscription_lifecycle(env):
    c = env.client
    iid = _inst(env, "Acme School")
    _, vid = _published(env)
    draft = c.get(f"{SA}/plans/ai_pro", headers=staff()).json()["versions"][0]["id"]
    assert _assign(env, iid, draft).status_code == 422                      # DRAFT version
    assert _assign(env, "no-such-institute", vid).status_code == 404
    # source PAYMENT (paid plans) needs the V590 billing tables, absent from this fixture: 503, nothing written
    assert _assign(env, iid, vid, source="PAYMENT").status_code == 503
    assert _assign(env, iid, vid, source="BARTER").status_code == 422
    assert _assign(env, iid, vid, enforcement="MAYBE").status_code == 422
    r = c.post(f"{SA}/subscriptions", json={"institute_id": iid, "plan_version_id": vid}, headers=staff())
    assert r.status_code == 422                                              # reason required
    r = _assign(env, iid, vid)
    assert r.status_code == 200, r.text
    sub = r.json()
    assert sub["status"] == "ACTIVE" and sub["enforcement"] == "SHADOW" and sub["created_by"] == STAFF
    assert sub["current_period"]["allowance_credits"] == 2000.0
    assert sub["current_period"]["payment_status"] == "DUE"
    assert "SHADOW" in sub["note"]
    assert iid in env.fake.invalidated
    assert _assign(env, iid, vid).status_code == 409                        # one open subscription
    lst = c.get(f"{SA}/subscriptions", params={"institute_id": iid}, headers=staff()).json()["subscriptions"]
    assert len(lst) == 1 and lst[0]["institute_name"] == "Acme School" and lst[0]["current_period"]
    # LIVE while plans are switched off globally: allowed, with a note
    r = c.patch(f"{SA}/subscriptions/{sub['id']}", json={"enforcement": "LIVE", "reason": "go"}, headers=staff())
    assert r.status_code == 200 and r.json()["enforcement"] == "LIVE" and "switched off" in r.json()["note"]
    assert c.patch(f"{SA}/subscriptions/{sub['id']}", json={"reason": "x"}, headers=staff()).status_code == 422
    assert c.patch(f"{SA}/subscriptions/{sub['id']}", json={"enforcement": "LIVE"}, headers=staff()).status_code == 422
    assert c.patch(f"{SA}/subscriptions/{sub['id']}", json={"pending_plan_version_id": draft, "reason": "x"},
                   headers=staff()).status_code == 422
    r = c.patch(f"{SA}/subscriptions/{sub['id']}", json={"enforcement": "LIVE", "reason": "same"}, headers=staff())
    assert r.status_code == 200 and r.json()["changed"] == []
    detail = c.get(f"{SA}/subscriptions/{sub['id']}", headers=staff()).json()
    assert detail["periods"] and detail["current_period"] and detail["overrides"] == []
    # cancel immediately, then the institute can be assigned again
    r = c.post(f"{SA}/subscriptions/{sub['id']}/cancel", json={"reason": "churn", "immediate": True}, headers=staff())
    assert r.status_code == 200 and r.json()["status"] == "CANCELLED"
    assert c.patch(f"{SA}/subscriptions/{sub['id']}", json={"auto_renew": False, "reason": "x"},
                   headers=staff()).status_code == 409
    assert c.post(f"{SA}/subscriptions/{sub['id']}/cancel", json={"reason": "again"}, headers=staff()).status_code == 409
    r = _assign(env, iid, vid, source="COMPLIMENTARY")
    assert r.status_code == 200 and r.json()["current_period"]["payment_status"] == "COMPLIMENTARY"
    events = c.get(f"{SA}/subscriptions/{sub['id']}/events", headers=staff()).json()["events"]
    assert [e["event_type"] for e in events] == ["CANCELLED", "ENFORCEMENT_CHANGED", "CREATED"]
    assert all(e["actor"] == STAFF and e["reason"] for e in events)
    assert events[1]["from_state"] == {"enforcement": "SHADOW"} and events[1]["to_state"] == {"enforcement": "LIVE"}


def test_concurrent_assignments_one_wins(env):
    iid = _inst(env)
    _, vid = _published(env)
    results = []

    def go():
        results.append(_assign(env, iid, vid).status_code)

    threads = [threading.Thread(target=go) for _ in range(10)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert sorted(results) == [200] + [409] * 9, results
    n = _q(env, "SELECT count(*) AS n FROM institute_ai_subscription WHERE institute_id = :i", i=iid)[0]["n"]
    assert n == 1


def test_unique_index_violation_is_409(env, monkeypatch):
    """Even past the advisory-lock check (a row written by someone else), the partial unique index answers 409."""
    iid = _inst(env)
    _, vid = _published(env)
    assert _assign(env, iid, vid).status_code == 200
    real_one = pa.one

    def blind_one(db, sql, params=None):
        if "status IN ('SCHEDULED','TRIAL','ACTIVE','GRACE') LIMIT 1" in sql:
            return None
        return real_one(db, sql, params)

    monkeypatch.setattr(pa, "one", blind_one)
    r = _assign(env, iid, vid)
    assert r.status_code == 409 and "live subscription" in r.json()["detail"]


def test_scheduled_subscription_and_cancel(env):
    iid = _inst(env)
    _, vid = _published(env)
    start = datetime.now(UTC) + timedelta(days=3)
    r = _assign(env, iid, vid, start_at=start, period_count=2)
    assert r.status_code == 200
    s = r.json()
    assert s["status"] == "SCHEDULED" and s["current_period"] is None
    assert datetime.fromisoformat(s["end_at"]) == pa.add_months(start, 2)
    assert _assign(env, iid, vid).status_code == 409           # SCHEDULED counts as open
    r = env.client.post(f"{SA}/subscriptions/{s['id']}/cancel", json={"reason": "no"}, headers=staff())
    assert r.status_code == 200 and r.json()["status"] == "CANCELLED" and r.json()["immediate"] is True
    assert _assign(env, iid, vid, end_at=datetime.now(UTC) - timedelta(days=1)).status_code == 422
    assert _assign(env, iid, vid, start_at=datetime.now(UTC) - timedelta(days=400)).status_code == 422
    assert _assign(env, iid, vid, end_at=datetime.now(UTC) + timedelta(days=9), period_count=1).status_code == 422


def test_overrides(env):
    c = env.client
    iid = _inst(env)
    _, vid = _published(env)
    sid = _assign(env, iid, vid).json()["id"]
    url = f"{SA}/subscriptions/{sid}/overrides"
    assert c.post(url, json={"feature_key": "ai_calling", "mode": "INCLUDED", "reason": "x"}, headers=staff()).status_code == 422
    assert c.post(url, json={"feature_key": "kb_qa", "reason": "x"}, headers=staff()).status_code == 422
    assert c.post(url, json={"feature_key": "kb_qa", "mode": "INCLUDED"}, headers=staff()).status_code == 422
    r = c.post(url, json={"feature_key": "tutor_chat", "inst_units_cap": 5000, "reason": "big school"}, headers=staff())
    assert r.status_code == 200 and r.json()["inst_units_cap"] == 5000.0
    first = r.json()["id"]
    r = c.post(url, json={"feature_key": "tutor_chat", "inst_units_cap": 8000, "reason": "bigger"}, headers=staff())
    assert r.status_code == 200 and r.json()["replaced"][0]["id"] == first
    active = c.get(url, headers=staff()).json()["overrides"]
    assert len(active) == 1 and active[0]["inst_units_cap"] == 8000.0
    assert len(c.get(url, params={"include_inactive": True}, headers=staff()).json()["overrides"]) == 2
    oid = active[0]["id"]
    assert c.delete(f"{url}/{oid}", headers=staff()).status_code == 422          # reason
    assert c.delete(f"{url}/{oid}", params={"reason": "done"}, headers=staff()).status_code == 200
    assert c.delete(f"{url}/{oid}", params={"reason": "done"}, headers=staff()).status_code == 404
    kinds = [e["event_type"] for e in c.get(f"{SA}/subscriptions/{sid}/events", headers=staff()).json()["events"]]
    assert kinds == ["OVERRIDE_REMOVED", "OVERRIDE_ADDED", "OVERRIDE_ADDED", "CREATED"]


def test_every_plan_and_catalogue_write_needs_a_reason(env):
    c = env.client
    key = f"r_{uuid.uuid4().hex[:6]}"
    assert c.post(f"{SA}/plans", json={"plan_key": key, "name": "R"}, headers=staff()).status_code == 422
    pid = c.post(f"{SA}/plans", json={"plan_key": key, "name": "R", "reason": "t"}, headers=staff()).json()["id"]
    assert c.post(f"{SA}/plans/{pid}/versions", json={}, headers=staff()).status_code == 422
    vid = c.post(f"{SA}/plans/{pid}/versions", json={"reason": "t"}, headers=staff()).json()["id"]
    assert c.patch(f"{SA}/versions/{vid}", json={"price_minor": 1}, headers=staff()).status_code == 422
    assert c.put(f"{SA}/versions/{vid}/items", json={"items": GOOD_ITEMS}, headers=staff()).status_code == 422
    assert c.put(f"{SA}/versions/{vid}/items", json={"items": GOOD_ITEMS, "reason": "t"},
                 headers=staff()).status_code == 200
    for action in ("publish", "retire"):
        assert c.post(f"{SA}/versions/{vid}/{action}", headers=staff()).status_code == 422             # no body
        assert c.post(f"{SA}/versions/{vid}/{action}", json={"reason": " "}, headers=staff()).status_code == 422
    assert c.post(f"{SA}/versions/{vid}/publish", json={"reason": "launch"}, headers=staff()).status_code == 200
    log = _q(env, "SELECT reason FROM ai_model_change_log WHERE table_name = 'ai_plan_version' AND row_key = :k",
             k=vid)
    assert log and log[-1]["reason"] == "launch"
    assert c.patch(f"{SA}/features/copilot", json={"eligibility": "ALLOWANCE_ONLY"}, headers=staff()).status_code == 422
    feat = _q(env, "SELECT eligibility FROM ai_billing_feature WHERE feature_key = 'copilot'")
    assert feat[0]["eligibility"] == "INCLUDABLE"


def test_switching_renewal_off_keeps_the_current_period(env):
    """A renewing subscription in its 2nd period whose period row does not exist
    yet (no roll, no charge): cancel at period end / auto_renew off opens that
    period first, so the engine (which never lazily opens a later period of a
    non-renewing subscription) still covers it, and the roll ends it at its end."""
    iid = _inst(env)
    _, vid = _published(env)
    start = datetime.now(UTC) - timedelta(days=45)
    sid = _assign(env, iid, vid, start_at=start).json()["id"]
    with env.engine.begin() as conn:
        conn.execute(text("DELETE FROM ai_subscription_period WHERE subscription_id = CAST(:s AS UUID)"), {"s": sid})
    r = env.client.post(f"{SA}/subscriptions/{sid}/cancel", json={"reason": "moving", "immediate": False},
                        headers=staff())
    assert r.status_code == 200 and r.json()["cancel_at_period_end"] is True
    rows = _q(env, "SELECT period_start, period_end FROM ai_subscription_period WHERE subscription_id = CAST(:s AS UUID)",
              s=sid)
    now = datetime.now(UTC)
    assert len(rows) == 1 and rows[0]["period_start"] <= now < rows[0]["period_end"]
    assert rows[0]["period_start"] > start                        # the 2nd period, not the first
    # auto_renew off on another renewing subscription: same
    iid2 = _inst(env)
    sid2 = _assign(env, iid2, vid, start_at=start).json()["id"]
    with env.engine.begin() as conn:
        conn.execute(text("DELETE FROM ai_subscription_period WHERE subscription_id = CAST(:s AS UUID)"), {"s": sid2})
    r = env.client.patch(f"{SA}/subscriptions/{sid2}", json={"auto_renew": False, "reason": "one more month only"},
                         headers=staff())
    assert r.status_code == 200
    assert len(_q(env, "SELECT 1 FROM ai_subscription_period WHERE subscription_id = CAST(:s AS UUID)", s=sid2)) == 1
    # a non-renewal edit opens nothing
    iid3 = _inst(env)
    sid3 = _assign(env, iid3, vid, start_at=start).json()["id"]
    with env.engine.begin() as conn:
        conn.execute(text("DELETE FROM ai_subscription_period WHERE subscription_id = CAST(:s AS UUID)"), {"s": sid3})
    assert env.client.patch(f"{SA}/subscriptions/{sid3}", json={"grace_days": 3, "reason": "x"},
                            headers=staff()).status_code == 200
    assert _q(env, "SELECT 1 FROM ai_subscription_period WHERE subscription_id = CAST(:s AS UUID)", s=sid3) == []


# ── roll job ────────────────────────────────────────────────────────────────

def _roll(env, now, **kw):
    s = env.Session()
    try:
        return pi.roll(s, now=now, **kw)
    finally:
        s.close()


def _periods(env, sid):
    return _q(env, "SELECT * FROM ai_subscription_period WHERE subscription_id = CAST(:s AS UUID) "
                   "ORDER BY period_start", s=sid)


def test_roll_renews_idempotently_and_concurrently(env):
    iid = _inst(env)
    _, vid = _published(env)
    sid = _assign(env, iid, vid).json()["id"]
    assert _roll(env, datetime.now(UTC))["changed"] == []                     # nothing due
    later = datetime.now(UTC) + timedelta(days=40)
    reports = []

    def go():
        reports.append(_roll(env, later, institute_id=iid))

    threads = [threading.Thread(target=go) for _ in range(6)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert all(r["ok"] for r in reports), reports
    periods = _periods(env, sid)
    assert len(periods) == 2
    assert periods[1]["period_start"] == periods[0]["period_end"]
    assert periods[1]["period_end"] > later
    events = _q(env, "SELECT event_type, actor FROM ai_subscription_event WHERE subscription_id = CAST(:s AS UUID) "
                     "AND event_type = 'RENEWED'", s=sid)
    assert len(events) == 1 and events[0]["actor"] == pi.ACTOR
    again = _roll(env, later)
    assert again["changed"] == [] and len(_periods(env, sid)) == 2
    # many hours missed: catches up period by period
    far = datetime.now(UTC) + timedelta(days=100)
    rep = _roll(env, far)
    assert rep["counts"].get("RENEWED") == 2 and len(_periods(env, sid)) == 4


def test_roll_cancel_expire_pending_scheduled(env):
    c = env.client
    _, vid = _published(env)
    _, vid2 = _published(env)
    later = datetime.now(UTC) + timedelta(days=40)
    a, b, d, e = _inst(env), _inst(env), _inst(env), _inst(env)
    sa_ = _assign(env, a, vid).json()["id"]
    c.post(f"{SA}/subscriptions/{sa_}/cancel", json={"reason": "end of term"}, headers=staff())   # at period end
    sb = _assign(env, b, vid, auto_renew=False).json()["id"]
    sd = _assign(env, d, vid).json()["id"]
    c.patch(f"{SA}/subscriptions/{sd}", json={"pending_plan_version_id": vid2, "reason": "upgrade"}, headers=staff())
    se = _assign(env, e, vid, start_at=datetime.now(UTC) + timedelta(days=2)).json()["id"]
    dry = _roll(env, later, dry_run=True)
    assert dry["dry_run"] and dry["changed"]
    assert len(_periods(env, sd)) == 1 and _q(env, "SELECT status FROM institute_ai_subscription WHERE id = "
                                                   "CAST(:s AS UUID)", s=sa_)[0]["status"] == "ACTIVE"
    rep = _roll(env, later)
    assert rep["ok"], rep
    st = {r["id"]: r for r in _q(env, "SELECT id::text AS id, status, plan_version_id::text AS v, "
                                      "pending_plan_version_id, end_at FROM institute_ai_subscription")}
    assert st[sa_]["status"] == "CANCELLED"
    assert st[sb]["status"] == "EXPIRED"
    assert st[sd]["status"] == "ACTIVE" and st[sd]["v"] == vid2 and st[sd]["pending_plan_version_id"] is None
    assert _periods(env, sd)[-1]["plan_version_id"] == uuid.UUID(vid2)
    assert st[se]["status"] == "ACTIVE" and len(_periods(env, se)) == 1
    kinds = {r["event_type"] for r in _q(env, "SELECT event_type FROM ai_subscription_event WHERE actor = :a",
                                         a=pi.ACTOR)}
    assert {"CANCELLED", "EXPIRED", "PLAN_CHANGED", "RENEWED", "ACTIVATED"} <= kinds
    assert _roll(env, later)["changed"] == []
    # an end date reached expires the subscription
    f = _inst(env)
    sf = _assign(env, f, vid, end_at=datetime.now(UTC) + timedelta(days=10)).json()["id"]
    _roll(env, datetime.now(UTC) + timedelta(days=11))
    assert _q(env, "SELECT status FROM institute_ai_subscription WHERE id = CAST(:s AS UUID)", s=sf)[0]["status"] == "EXPIRED"


def test_roll_endpoint_shape(env):
    r = env.client.post("/internal/plans/v1/roll", params={"dry_run": True},
                        headers={"X-Internal-Service-Token": TOKEN})
    body = r.json()
    assert r.status_code == 200 and body["ok"] and body["dry_run"] is True
    assert {"checked", "changed", "errors", "counts", "now"} <= set(body)


# ── tenant view ─────────────────────────────────────────────────────────────

def _walk_keys(obj):
    if isinstance(obj, dict):
        for k, v in obj.items():
            yield k
            yield from _walk_keys(v)
    elif isinstance(obj, list):
        for v in obj:
            yield from _walk_keys(v)


def test_tenant_plan_view(env):
    c = env.client
    iid = _inst(env)
    _, vid = _published(env)
    sid = _assign(env, iid, vid).json()["id"]
    url = f"/credits/v2/institutes/{iid}/plan"
    # SHADOW: the tenant sees nothing; staff see it flagged
    assert c.get(url, headers=_hdr(iid, ("ADMIN",))).json()["plan"] is None
    s = c.get(url, headers=staff()).json()
    assert s["plan"]["effective"] is False and s["plan"]["enforcement"] == "SHADOW"
    c.patch(f"{SA}/subscriptions/{sid}", json={"enforcement": "LIVE", "reason": "go"}, headers=staff())
    assert c.get(url, headers=_hdr(iid, ("ADMIN",))).json()["plan"] is None       # plans still off globally
    env.state["enabled"] = True
    start = _periods(env, sid)[0]["period_start"]
    with env.engine.begin() as conn:
        conn.execute(text("INSERT INTO ai_usage_counter (institute_id, counter_key, period, window_start, "
                          "credits_used, count_used, cost_usd) VALUES (:i, :k, 'PLAN_PERIOD', :w, 10, 250, 0.4)"),
                     {"i": iid, "k": f"PLAN:{sid}|F:tutor_chat", "w": start})
        conn.execute(text("INSERT INTO ai_usage_counter (institute_id, counter_key, period, window_start, "
                          "credits_used, count_used, cost_usd) VALUES (:i, :k, 'PLAN_PERIOD', :w, 0, 0, 2.0)"),
                     {"i": iid, "k": f"PLAN:{sid}|F:learner_analytics", "w": start})
    admin = c.get(url, headers=_hdr(iid, ("ADMIN",))).json()
    assert admin["plan"]["name"].startswith("Plan ") and admin["plan"]["enforcement"] == "LIVE"
    assert "effective" not in admin["plan"] and "subscription_id" not in admin["plan"]
    assert admin["allowance"] == {"credits": 2000.0, "used": 0.0, "remaining": 2000.0}
    feats = {f["feature_key"]: f for f in admin["features"]}
    assert feats["tutor_chat"]["mode"] == "INCLUDED" and feats["tutor_chat"]["usage_pct"] == 25.0
    assert feats["tutor_chat"]["included_models"] == ["z-ai/glm-5.3-flash"]
    assert feats["tutor_chat"]["roles_included"] == ["LEARNER"]
    assert feats["learner_analytics"]["usage_pct"] == 80.0          # the tightest cap, figure not shown
    assert feats["image_generation"]["mode"] == "ALLOWANCE" and feats["image_generation"]["usage_pct"] is None
    assert feats["ai_calling"]["mode"] == "CHARGED"
    # tool keys per feature, so the admin app's cost previews can say "included in your plan"
    owners = {}
    for k, f in feats.items():
        assert isinstance(f["tool_keys"], list)
        for t in f["tool_keys"]:
            assert t not in owners, f"{t} billed as both {owners[t]} and {k}"   # one feature per tool
            owners[t] = k
    assert owners.get("tutor_avatar_minute", "tutor_avatar_minutes") == "tutor_avatar_minutes"  # engine override
    keys = set(_walk_keys(admin))
    assert not any("usd" in k or "cost" in k or k.endswith("_cap") for k in keys), keys
    member = c.get(url, headers=_hdr(iid, ("TEACHER",), MEMBER)).json()
    assert member["plan"]["name"] == admin["plan"]["name"] and member["allowance"] is None
    assert all(f["usage_pct"] is None for f in member["features"])
    assert "overall_fair_use_pct" not in member["plan"]
    # an override changes what the tenant sees
    c.post(f"{SA}/subscriptions/{sid}/overrides", json={"feature_key": "tutor_chat", "inst_units_cap": 500,
                                                       "reason": "deal"}, headers=staff())
    feats = {f["feature_key"]: f for f in c.get(url, headers=_hdr(iid, ("ADMIN",))).json()["features"]}
    assert feats["tutor_chat"]["usage_pct"] == 50.0


# ── pricing tools ───────────────────────────────────────────────────────────

def test_simulate_and_pnl_shapes(env, monkeypatch):
    c = env.client
    iid = _inst(env)
    _, vid = _published(env)
    r = c.post(f"{SA}/simulate", json={"plan_version_id": vid, "institute_id": iid, "days": 30}, headers=staff())
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["plan_version_id"] == vid and out["institute_id"] == iid and out["days"] == 30
    assert out["features"][0]["feature_key"] == "tutor_chat"
    assert env.fake.sim_calls == [(vid, iid, 30)]
    assert c.post(f"{SA}/simulate", json={"plan_version_id": vid, "institute_id": iid, "days": 400},
                  headers=staff()).status_code == 422
    assert c.post(f"{SA}/simulate", json={"plan_version_id": str(uuid.uuid4()), "institute_id": iid},
                  headers=staff()).status_code == 404
    r = c.get(f"{SA}/pnl", params={"period": "previous", "institute_id": iid}, headers=staff())
    assert r.status_code == 200 and r.json()["rows"][0]["margin_inr"] == 5000.0 and r.json()["period"] == "previous"
    assert env.fake.pnl_calls[-1] == (iid, "previous")
    assert c.get(f"{SA}/pnl", params={"period": "last-year"}, headers=staff()).status_code == 422
    monkeypatch.setattr(pa, "get_plans_engine", lambda: None)
    assert c.get(f"{SA}/pnl", headers=staff()).status_code == 503
    assert c.post(f"{SA}/simulate", json={"plan_version_id": vid, "institute_id": iid},
                  headers=staff()).status_code == 503


def test_period_arithmetic(monkeypatch):
    monkeypatch.setattr(pa, "get_plans_engine", lambda: None)       # the router's own arithmetic
    a = datetime(2026, 1, 31, 10, 0, tzinfo=UTC)
    assert pa.add_months(a, 1) == datetime(2026, 2, 28, 10, 0, tzinfo=UTC)
    assert pa.add_months(a, 2) == datetime(2026, 3, 31, 10, 0, tzinfo=UTC)
    assert pa.add_months(datetime(2028, 1, 31, tzinfo=UTC), 1).day == 29
    assert pa.period_bounds(a, 1, datetime(2026, 3, 15, tzinfo=UTC)) == (
        datetime(2026, 2, 28, 10, 0, tzinfo=UTC), datetime(2026, 3, 31, 10, 0, tzinfo=UTC))
    assert pa.period_bounds(a, 3, datetime(2026, 4, 30, 10, 0, tzinfo=UTC)) == (
        datetime(2026, 4, 30, 10, 0, tzinfo=UTC), datetime(2026, 7, 31, 10, 0, tzinfo=UTC))
    assert pa.period_bounds(a, 1, a - timedelta(days=1))[0] == a


def test_period_arithmetic_matches_the_engine():
    """Period rows the API / roll job create must start exactly where the engine looks for them."""
    try:
        from ai_service.app.services.metering import plans as engine
    except Exception:  # noqa: BLE001
        pytest.skip("plans engine not importable")
    import random

    rnd = random.Random(7)
    for _ in range(3000):
        anchor = datetime(2025, 1, 1, tzinfo=UTC) + timedelta(minutes=rnd.randrange(0, 60 * 24 * 900))
        at = anchor + timedelta(minutes=rnd.randrange(-60 * 24 * 40, 60 * 24 * 1500))
        pm = rnd.choice((1, 1, 2, 3, 6, 12))
        assert pa._own_window(anchor, pm, at) == engine.period_window(anchor, pm, at), (anchor, pm, at)


def test_publish_with_migration_schedules_the_move(env):
    c = env.client
    pid, v1 = _published(env)
    iid = _inst(env)
    sid = _assign(env, iid, v1).json()["id"]
    v2 = c.post(f"{SA}/plans/{pid}/versions", json={"reason": "t"}, headers=staff()).json()["id"]
    c.patch(f"{SA}/versions/{v2}", json={"migrate_existing_at_renewal": True, "price_minor": 550000, "reason": "t"}, headers=staff())
    r = c.post(f"{SA}/versions/{v2}/publish", json={"reason": "price rise"}, headers=staff())
    assert r.status_code == 200 and r.json()["subscriptions_scheduled_to_move"] == 1
    sub = c.get(f"{SA}/subscriptions/{sid}", headers=staff()).json()
    assert sub["pending_plan_version_id"] == v2 and sub["plan_version_id"] == v1
    ev = c.get(f"{SA}/subscriptions/{sid}/events", headers=staff()).json()["events"][0]
    assert ev["event_type"] == "PLAN_CHANGE_SCHEDULED" and ev["actor"] == STAFF
    rep = _roll(env, datetime.now(UTC) + timedelta(days=40))
    assert "PLAN_CHANGED" in rep["counts"]
    assert _periods(env, sid)[-1]["plan_version_id"] == uuid.UUID(v2)
    assert _periods(env, sid)[-1]["price_minor_snapshot"] == 550000


def test_roll_follows_a_period_the_engine_opened(env):
    """The engine opens a renewed period lazily on the pending version: the job then moves the subscription."""
    c = env.client
    _, v1 = _published(env)
    _, v2 = _published(env)
    iid = _inst(env)
    sid = _assign(env, iid, v1).json()["id"]
    c.patch(f"{SA}/subscriptions/{sid}", json={"pending_plan_version_id": v2, "reason": "upgrade"}, headers=staff())
    first = _periods(env, sid)[0]
    nxt_end = pa.add_months(first["period_start"], 2)
    with env.engine.begin() as conn:
        conn.execute(text("INSERT INTO ai_subscription_period (subscription_id, period_start, period_end, "
                          "plan_version_id, price_minor_snapshot, allowance_credits) VALUES "
                          "(CAST(:s AS UUID), :ps, :pe, CAST(:v AS UUID), 1, 2000)"),
                     {"s": sid, "ps": first["period_end"], "pe": nxt_end, "v": v2})
    later = first["period_end"] + timedelta(days=1)
    rep = _roll(env, later)
    assert rep["counts"] == {"PLAN_CHANGED": 1}, rep
    sub = c.get(f"{SA}/subscriptions/{sid}", headers=staff()).json()
    assert sub["plan_version_id"] == v2 and sub["pending_plan_version_id"] is None
    assert _roll(env, later)["changed"] == []
    assert len(_periods(env, sid)) == 2


def test_with_the_real_engine(env, monkeypatch):
    """The real services/metering/plans.py: index update on assign / cancel, simulate and pnl on Postgres."""
    try:
        from ai_service.app.services.metering import plans as engine
    except Exception:  # noqa: BLE001
        pytest.skip("plans engine not importable")
    engine.reset_for_tests()
    monkeypatch.setattr(pa, "get_plans_engine", lambda: engine)
    c = env.client
    iid = _inst(env)
    _, vid = _published(env)
    sid = _assign(env, iid, vid).json()["id"]
    with env.engine.begin() as conn:
        for i in range(3):
            conn.execute(text(
                "INSERT INTO ai_usage_event (occurred_at, institute_id, actor_kind, actor_user_id, actor_role_class, "
                "use_case, use_case_source, feature_group, surface, source_service, model_id, real_cost_usd, "
                "list_credits, credits_charged, billing_mode, charge_status) VALUES (now() - interval '1 day', :i, "
                "'USER', :u, 'LEARNER', 'tutor_chat', 'EXPLICIT', 'tutor', 'LEARNER_APP', 'ai_service', "
                "'z-ai/glm-5.3-flash', 0.002, 2, 2, 'CHARGED', 'CHARGED')"), {"i": iid, "u": f"learner-{i}"})
    assert iid in engine._index.ids            # noqa: SLF001 - updated at once on this process
    r = c.post(f"{SA}/simulate", json={"plan_version_id": vid, "institute_id": iid, "days": 7}, headers=staff())
    assert r.status_code == 200, r.text
    sim = r.json()
    r = c.get(f"{SA}/pnl", params={"institute_id": iid}, headers=staff())
    assert r.status_code == 200, r.text
    rows = r.json()["rows"]
    assert len(rows) == 1 and rows[0]["subscription_id"] == sid and rows[0]["price_minor"] == 500000
    assert {"margin_inr", "real_cost_usd_total", "included_list_credits", "allowance_used"} <= set(rows[0])
    assert sim["plan_version_id"] == vid and sim["days"] == 7 and "totals" in sim
    assert sim["totals"]["events"] == 3 and sim["totals"]["list_credits"] == 6
    assert [f["feature_key"] for f in sim["features"]] == ["tutor_chat"]
    url = f"/credits/v2/institutes/{iid}/plan"
    assert c.get(url, headers=staff()).json()["plan"]["subscription_id"] == sid
    c.post(f"{SA}/subscriptions/{sid}/cancel", json={"reason": "x", "immediate": True}, headers=staff())
    assert iid not in engine._index.ids        # noqa: SLF001
    engine.reset_for_tests()
