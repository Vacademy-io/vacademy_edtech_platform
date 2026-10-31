"""
/super-admin/v1/metering/** (routers/metering_admin.py).

No database: a fake query layer stands in for MeteringQuery; the SQL of
coverage / parity is checked against a recording session. Covers the
router-level platform-staff guard on EVERY route (tenant admin -> 403, no
token -> 401), reason + actor on writes and the change-log entry, catalog /
role validation, 503 / empty answers while the tables are missing, and the
parity merge.
"""
from __future__ import annotations

import base64
import os
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))
os.environ.setdefault("OPENROUTER_API_KEY", "or-platform")

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from jose import jwt  # noqa: E402

from ai_service.app.config import get_settings  # noqa: E402
from ai_service.app.core import security  # noqa: E402
from ai_service.app.db import db_dependency  # noqa: E402
from ai_service.app.routers import metering_admin  # noqa: E402
from ai_service.app.services import metering_query as mq  # noqa: E402

STAFF = "staff-1"
INST = "11111111-1111-1111-1111-111111111111"
BASE = "/super-admin/v1/metering"


def _token(user, roles=("ADMIN",)):
    secret = get_settings().jwt_secret_key
    secret += "=" * (-len(secret) % 4)
    claims = {"sub": user, "username": user, "user": user, "is_root_user": True,
              "authorities": {INST: {"roles": list(roles), "permissions": []}}}
    return {"Authorization": "Bearer " + jwt.encode(claims, base64.b64decode(secret), algorithm="HS256")}


class FakeAdminQuery:
    def __init__(self):
        self.ready = True
        self.db = SimpleNamespace(commit=lambda: None, rollback=lambda: None)
        self.catalog = {"tutor_chat": {"use_case": "tutor_chat", "label": "AI tutor chat", "feature_group": "tutor",
                                       "label_template": None, "display_order": 10, "is_active": True},
                        "unknown": {"use_case": "unknown", "label": "Other AI usage", "feature_group": "platform",
                                    "label_template": None, "display_order": 999, "is_active": True}}
        self.roles = {"ADMIN": {"role_name": "ADMIN", "role_class": "ADMIN", "precedence": 10}}
        self.updates = []
        self.upserts = []

    def tables_ready(self):
        return self.ready

    def catalog_rows(self):
        return list(self.catalog.values())

    def catalog_row(self, uc):
        row = self.catalog.get(uc)
        return dict(row) if row else None

    def update_catalog(self, uc, fields, actor):
        self.updates.append((uc, fields, actor))
        self.catalog[uc].update(fields)

    def role_map(self):
        return list(self.roles.values())

    def unmapped_roles(self, days=30):
        return [{"role_name": "CONTENT_CREATOR", "events": 4}]

    def role_row(self, name):
        row = self.roles.get(name)
        return dict(row) if row else None

    def upsert_role(self, name, role_class, precedence, actor):
        self.upserts.append((name, role_class, precedence, actor))
        self.roles[name] = {"role_name": name, "role_class": role_class, "precedence": precedence}

    def coverage(self, days):
        return {"days": days, "events": 1, "ledger_rows": 1, "ledger_without_event": 0, "use_case_source": {},
                "role_source": {}, "unknown_use_case_events": 0, "null_actor_events": 0, "by_use_case": []}

    def parity(self, days):
        return {"rows": []}


@pytest.fixture
def env(monkeypatch):
    real = get_settings()
    stub = SimpleNamespace(jwt_secret_key=real.jwt_secret_key, jwt_algorithm=real.jwt_algorithm,
                           super_admin_user_ids=STAFF, internal_service_token="svc")
    monkeypatch.setattr(security, "get_settings", lambda: stub)
    fake = FakeAdminQuery()
    logged = []
    monkeypatch.setattr(metering_admin, "_change_log_ready", lambda db: True)
    monkeypatch.setattr(metering_admin, "_log_change",
                        lambda db, ready, table, key, old, new, reason, actor:
                        logged.append((table, key, old, new, reason, actor)))
    monkeypatch.setattr(metering_admin, "_check_template", lambda t, row: None)
    app = FastAPI()
    app.include_router(metering_admin.router)
    app.dependency_overrides[db_dependency] = lambda: None
    app.dependency_overrides[metering_admin.get_admin_query] = lambda: fake
    return SimpleNamespace(client=TestClient(app), fake=fake, logged=logged, app=app)


def _all_routes():
    out = []
    for r in metering_admin.router.routes:
        for m in r.methods:
            out.append((m, r.path.replace("{use_case}", "tutor_chat").replace("{role_name}", "TEACHER")))
    return out


def test_every_route_has_the_router_level_guard():
    deps = [d.dependency for d in metering_admin.router.dependencies]
    assert metering_admin._staff_only in deps
    assert len(_all_routes()) == 6


@pytest.mark.parametrize("method,path", _all_routes())
def test_tenant_admin_is_403_and_no_token_401(env, method, path):
    body = {"reason": "x", "role_class": "TEACHER", "precedence": 20, "label": "X"}
    r = env.client.request(method, path, json=body, headers=_token("tenant-admin"))
    assert r.status_code == 403, (method, path)
    r = env.client.request(method, path, json=body)
    assert r.status_code == 401, (method, path)
    assert env.fake.updates == [] and env.fake.upserts == []


def test_reads(env):
    h = _token(STAFF)
    assert [r["use_case"] for r in env.client.get(f"{BASE}/catalog", headers=h).json()["use_cases"]] == [
        "tutor_chat", "unknown"]
    body = env.client.get(f"{BASE}/role-map", headers=h).json()
    assert body["roles"][0]["role_name"] == "ADMIN" and body["unmapped"][0]["role_name"] == "CONTENT_CREATOR"
    assert env.client.get(f"{BASE}/coverage?days=7", headers=h).json()["days"] == 7
    assert env.client.get(f"{BASE}/parity?days=7", headers=h).json() == {"rows": []}
    assert env.client.get(f"{BASE}/parity?days=0", headers=h).status_code == 422


def test_patch_catalog_records_actor_and_reason(env):
    h = _token(STAFF)
    r = env.client.patch(f"{BASE}/catalog/tutor_chat", headers=h,
                         json={"label": " AI tutor ", "label_template": "{label} — {actor_name}",
                               "reason": "clearer"})
    assert r.status_code == 200
    assert r.json()["label"] == "AI tutor" and r.json()["label_template"] == "{label} — {actor_name}"
    uc, fields, actor = env.fake.updates[-1]
    assert uc == "tutor_chat" and actor == STAFF and "reason" not in fields
    table, key, old, new, reason, who = env.logged[-1]
    assert (table, key, reason, who) == ("ai_use_case_catalog", "tutor_chat", "clearer", STAFF)
    assert old["label"] == "AI tutor chat" and new["label"] == "AI tutor"


def test_patch_catalog_validation(env):
    h = _token(STAFF)
    assert env.client.patch(f"{BASE}/catalog/tutor_chat", headers=h, json={"label": "X", "reason": " "}).status_code == 422
    assert env.client.patch(f"{BASE}/catalog/tutor_chat", headers=h, json={"label": "X"}).status_code == 422
    assert env.client.patch(f"{BASE}/catalog/nope", headers=h, json={"label": "X", "reason": "r"}).status_code == 404
    assert env.client.patch(f"{BASE}/catalog/tutor_chat", headers=h, json={"reason": "r"}).status_code == 422
    assert env.client.patch(f"{BASE}/catalog/tutor_chat", headers=h,
                            json={"label": None, "reason": "r"}).status_code == 422
    assert env.client.patch(f"{BASE}/catalog/tutor_chat", headers=h,
                            json={"feature_group": "Bad Group", "reason": "r"}).status_code == 422
    assert env.client.patch(f"{BASE}/catalog/unknown", headers=h,
                            json={"is_active": False, "reason": "r"}).status_code == 422
    # billing fields are not writable here: extra keys are ignored, nothing to change -> 422
    assert env.client.patch(f"{BASE}/catalog/tutor_chat", headers=h,
                            json={"billing_policy": "CHARGE", "reason": "r"}).status_code == 422
    assert env.fake.updates == []


def test_put_role_normalises_and_validates(env):
    h = _token(STAFF)
    r = env.client.put(f"{BASE}/role-map/content creator", headers=h,
                       json={"role_class": "teacher", "precedence": 20, "reason": "creators author content"})
    assert r.status_code == 200
    assert r.json() == {"role_name": "CONTENT_CREATOR", "role_class": "TEACHER", "precedence": 20}
    assert env.fake.upserts[-1] == ("CONTENT_CREATOR", "TEACHER", 20, STAFF)
    table, key, old, new, reason, who = env.logged[-1]
    assert (table, key, old, who) == ("ai_role_class_map", "CONTENT_CREATOR", None, STAFF)
    assert env.client.put(f"{BASE}/role-map/X", headers=h,
                          json={"role_class": "OWNER", "precedence": 1, "reason": "r"}).status_code == 422
    assert env.client.put(f"{BASE}/role-map/X", headers=h,
                          json={"role_class": "STAFF", "precedence": 5000, "reason": "r"}).status_code == 422
    assert env.client.put(f"{BASE}/role-map/X", headers=h,
                          json={"role_class": "STAFF", "precedence": 1, "reason": ""}).status_code == 422


def test_tables_missing(env):
    env.fake.ready = False
    h = _token(STAFF)
    assert env.client.get(f"{BASE}/catalog", headers=h).json() == {"use_cases": []}
    assert env.client.get(f"{BASE}/role-map", headers=h).json() == {"roles": [], "unmapped": []}
    assert env.client.get(f"{BASE}/parity", headers=h).json() == {"rows": []}
    assert env.client.get(f"{BASE}/coverage", headers=h).json()["events"] == 0
    assert env.client.patch(f"{BASE}/catalog/tutor_chat", headers=h,
                            json={"label": "X", "reason": "r"}).status_code == 503
    assert env.client.put(f"{BASE}/role-map/X", headers=h,
                          json={"role_class": "STAFF", "precedence": 1, "reason": "r"}).status_code == 503


# ── SQL of coverage / parity ────────────────────────────────────────────────

class _R:
    def __init__(self, rows=None):
        self.rows = [SimpleNamespace(_mapping=r) for r in (rows or [])]

    def fetchall(self):
        return self.rows

    def fetchone(self):
        return self.rows[0] if self.rows else None


class RecordingDB:
    def __init__(self):
        self.sql = []

    def execute(self, clause, params=None):
        s = str(clause)
        self.sql.append((s, dict(params or {})))
        if "AS ledger_rows" in s and "GROUP BY 1" in s:
            return _R([{"day": "2026-10-14", "ledger_rows": 10, "ledger_credits": 12.5, "missing_events": 1}])
        if "AS event_rows" in s:
            return _R([{"day": "2026-10-14", "event_rows": 9, "event_credits": 11.0},
                       {"day": "2026-10-15", "event_rows": 1, "event_credits": 0.5}])
        if "AS ledger_rows" in s:
            return _R([{"ledger_rows": 10, "ledger_without_event": 1}])
        if "AS unknown_use_case_events" in s:
            return _R([{"events": 9, "unknown_use_case_events": 2, "null_actor_events": 3}])
        if "use_case_source" in s:
            return _R([{"k": "TOOL_KEY", "n": 5}, {"k": "REQUEST_TYPE", "n": 4}])
        if "role_source" in s:
            return _R([{"k": "JWT", "n": 6}])
        if "AS use_case" in s:
            return _R([{"use_case": "tutor_chat", "events": 9, "credits": 11}])
        raise AssertionError(s)


def test_parity_sql_and_merge():
    db = RecordingDB()
    out = mq.MeteringQuery(db).parity(7)
    assert out["rows"] == [
        {"day": "2026-10-15", "ledger_rows": 0, "ledger_credits": 0.0, "event_rows": 1, "event_credits": 0.5,
         "missing_events": 0},
        {"day": "2026-10-14", "ledger_rows": 10, "ledger_credits": 12.5, "event_rows": 9, "event_credits": 11.0,
         "missing_events": 1},
    ]
    ledger_sql, lp = db.sql[0]
    assert "transaction_type = 'USAGE_DEDUCTION'" in ledger_sql
    assert "(ct.created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata'" in ledger_sql
    assert lp["since_naive"].tzinfo is None
    event_sql, ep = db.sql[1]
    assert "e.billing_mode = 'CHARGED'" in event_sql and "AT TIME ZONE 'Asia/Kolkata'" in event_sql
    assert ep["since"].tzinfo is not None


def test_coverage_shape():
    out = mq.MeteringQuery(RecordingDB()).coverage(7)
    assert out == {"days": 7, "events": 9, "ledger_rows": 10, "ledger_without_event": 1,
                   "use_case_source": {"TOOL_KEY": 5, "REQUEST_TYPE": 4}, "role_source": {"JWT": 6},
                   "unknown_use_case_events": 2, "null_actor_events": 3,
                   "by_use_case": [{"use_case": "tutor_chat", "events": 9, "credits": 11.0}]}


def test_normalize_role():
    assert metering_admin.normalize_role(" content-creator ") == "CONTENT_CREATOR"
    assert metering_admin.normalize_role("School Admin") == "SCHOOL_ADMIN"
