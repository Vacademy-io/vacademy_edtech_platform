"""
AI usage limits API (contract N5): tenant admin /credits/v2/institutes/{id}/limits/**
(routers/credits_limits.py), super admin /super-admin/v1/metering/limits/**
(routers/metering_limits_admin.py) and the "limits" addition to
/credits/v2/me/usage.

No database: an in-memory fake stands in for LimitsQuery and a fake limits
engine for services/metering/limits.py. Real HS256 tokens are minted with the
configured secret; the platform-staff allowlist is stubbed. The SQL of
LimitsQuery is exercised against Postgres separately (see the final answer of
unit L3); here only its pure helpers are.

Covers: the auth matrix on every route (no token 401, non-admin 403, admin of
another institute 403, admin OK, platform staff OK without membership), the
super-admin guard, PLATFORM / locked rows untouchable by tenants, ENFORCE only
when tenant_may_enforce, validation errors, audit + reason + actor on writes,
preview / effective / usage shapes, me/usage numbers hidden from learners
unless show_numbers_to_learners, and me/usage unchanged (no query, no key) for
an institute without a policy.
"""
from __future__ import annotations

import base64
import copy
import os
import sys
import uuid
from datetime import datetime, timezone
from decimal import Decimal
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
from ai_service.app.routers import credits_limits as cl  # noqa: E402
from ai_service.app.routers import credits_v2  # noqa: E402
from ai_service.app.routers import metering_limits_admin as mla  # noqa: E402
from ai_service.app.services import metering_query as mq  # noqa: E402

INST_A = "11111111-1111-1111-1111-111111111111"
INST_B = "22222222-2222-2222-2222-222222222222"
ADMIN = "admin-1"
TEACHER = "teacher-1"
STAFF = "staff-1"
BASE = f"/credits/v2/institutes/{INST_A}/limits"
SA = "/super-admin/v1/metering/limits"


def _token(authorities, user):
    secret = get_settings().jwt_secret_key
    secret += "=" * (-len(secret) % 4)
    claims = {"sub": user, "username": user, "user": user, "is_root_user": True, "authorities": authorities}
    return "Bearer " + jwt.encode(claims, base64.b64decode(secret), algorithm="HS256")


def _hdr(inst=INST_A, roles=("ADMIN",), user=ADMIN):
    return {"Authorization": _token({inst: {"roles": list(roles), "permissions": []}}, user)}


#: The router's own dependency (the module attribute is monkeypatched below).
ENGINE_DEP = cl.get_limits_engine


# ── fakes ───────────────────────────────────────────────────────────────────

class FakeDB:
    def __init__(self):
        self.commits = 0
        self.rollbacks = 0

    def commit(self):
        self.commits += 1

    def rollback(self):
        self.rollbacks += 1

    def execute(self, *a, **k):  # anything reaching real SQL is a test bug
        raise AssertionError("unexpected SQL in a fake-store test")


class FakeLimits:
    """In-memory LimitsQuery."""

    def __init__(self):
        self.db = FakeDB()
        self.ready = True
        self.policies = {}
        self.rows = {}
        self.counter_rows = []
        self.known_roles = {"EVALUATOR", "TEACHER"}
        self.names = {"u-9": "Priya Sharma"}
        self.roles_of = {"u-9": {"role_class": "TEACHER", "raw_roles": ["evaluator"]}}
        self.groups = ["tutor", "video", "content"]
        self.use_cases = {
            "tutor_chat": {"use_case": "tutor_chat", "feature_group": "tutor", "label": "AI tutor chat",
                           "limit_eligible": True, "is_active": True},
            "platform_internal": {"use_case": "platform_internal", "feature_group": "platform",
                                  "label": "Internal", "limit_eligible": False, "is_active": True},
        }

    def tables_ready(self):
        return self.ready

    def policy_row(self, iid, for_update=False):
        return copy.deepcopy(self.policies.get(iid))

    def save_policy(self, iid, values, actor, reason):
        row = {"institute_id": iid, **values, "updated_by": actor, "updated_at": datetime.now(timezone.utc),
               "reason": reason}
        self.policies[iid] = row
        return copy.deepcopy(row)

    def list_rows(self, iid, include_inactive=False):
        return [copy.deepcopy(r) for r in self.rows.values() if r["institute_id"] == iid
                and (include_inactive or (r["is_active"] and r["effective_to"] is None))]

    def get_row(self, iid, rid, for_update=False):
        r = self.rows.get(rid)
        return copy.deepcopy(r) if r and r["institute_id"] == iid else None

    def _key(self, r):
        return (r["institute_id"], r["subject_kind"], r.get("subject_value") or "", r["per_member"],
                r["scope_kind"], r.get("scope_value") or "", r["period"], r["metric"], r["origin"])

    def insert_row(self, iid, f, actor):
        now = datetime.now(timezone.utc)
        row = {"id": str(uuid.uuid4()), "institute_id": iid, "subject_kind": f["subject_kind"],
               "subject_value": f.get("subject_value"), "per_member": f.get("per_member", True),
               "scope_kind": f["scope_kind"], "scope_value": f.get("scope_value"), "period": f["period"],
               "metric": f["metric"], "soft_limit": f.get("soft_limit"), "hard_limit": f.get("hard_limit"),
               "origin": f["origin"], "locked": f.get("locked", False), "effective_from": now,
               "effective_to": None, "is_active": True, "reason": f.get("reason"), "created_by": actor,
               "created_at": now, "updated_by": actor, "updated_at": now}
        if any(self._key(o) == self._key(row) for o in self.rows.values()
               if o["is_active"] and o["effective_to"] is None):
            return None
        self.rows[row["id"]] = row
        return copy.deepcopy(row)

    def update_row(self, iid, rid, fields, actor, reason):
        r = self.rows.get(rid)
        if not r or r["institute_id"] != iid or not r["is_active"]:
            return None
        r.update(fields, reason=reason, updated_by=actor)
        return copy.deepcopy(r)

    def deactivate_row(self, iid, rid, actor, reason):
        r = self.rows.get(rid)
        if not r or r["institute_id"] != iid or not r["is_active"]:
            return None
        r.update(is_active=False, effective_to=datetime.now(timezone.utc), reason=reason, updated_by=actor)
        return copy.deepcopy(r)

    def use_case_row(self, uc):
        return self.use_cases.get(uc)

    def feature_groups(self):
        return list(self.groups)

    def role_known(self, iid, role):
        return role in self.known_roles

    def user_names(self, iid, ids):
        return {u: self.names[u] for u in ids if u in self.names}

    def user_roles(self, iid, uid):
        got = self.roles_of.get(uid)
        return (got["role_class"], got["raw_roles"]) if got else (None, [])

    def users_roles(self, iid, ids):
        return {u: self.roles_of[u] for u in ids if u in self.roles_of}

    def counters(self, iid, period, ws):
        self.counter_query = (iid, period, ws)
        return [dict(c) for c in self.counter_rows if c["period"] == period]

    def overview(self, since):
        out = []
        for iid, p in self.policies.items():
            rows = [r for r in self.rows.values() if r["institute_id"] == iid and r["is_active"]]
            out.append({"institute_id": iid, "institute_name": "Inst " + iid[:4], "mode": p["mode"],
                        "tenant_may_enforce": p["tenant_may_enforce"], "timezone": p["timezone"],
                        "updated_at": p["updated_at"],
                        "rows": sum(r["origin"] == "TENANT" for r in rows),
                        "platform_rows": sum(r["origin"] == "PLATFORM" for r in rows),
                        "would_block_7d": 4, "blocked_7d": 1, "overrun_7d": 2})
        return out

    # helpers for tests
    def add(self, **kw):
        f = {"subject_kind": "INSTITUTE", "scope_kind": "ALL", "period": "MONTH", "metric": "CREDITS",
             "hard_limit": Decimal("100"), "origin": "TENANT", "per_member": True, **kw}
        return self.insert_row(kw.pop("institute_id", INST_A), f, "seed")


class FakeEngine:
    def __init__(self):
        self.calls = []
        self.policies = set()
        self.preview_error = None
        self.policy = {"mode": "SHADOW", "show_numbers_to_learners": False}
        self.items = [{
            "row": {"id": "r1", "subject_kind": "USER", "scope_kind": "USE_CASE", "scope_value": "tutor_chat",
                    "period": "DAY", "metric": "CREDITS"},
            "scope": "USER", "period": "DAY", "used": Decimal("12.5"), "soft": 15.0, "hard": 20.0,
            "resets_at": "2026-10-16T00:00:00+05:30", "decision": "OK", "why": "Your own limit",
        }]

    def has_policy(self, iid):
        self.calls.append(("has_policy", iid))
        return iid in self.policies

    def get_policy(self, db, iid):
        self.calls.append(("get_policy", iid))
        return self.policy

    def effective_limits(self, db, iid, user_id=None, role_class=None, raw_roles=None):
        self.calls.append(("effective", iid, user_id, role_class, raw_roles))
        return self.items

    def notify_changed(self, db, iid, rebuild=True, active=None):
        self.calls.append(("notify", iid, rebuild, active))
        return {}

    def preview_impact(self, db, iid, proposed_rows, days=30):
        self.calls.append(("preview", iid, proposed_rows, days))
        if self.preview_error:
            raise ValueError(self.preview_error)
        return {"events_considered": 10, "would_block": 2, "would_warn": 1, "affected_users": 1,
                "by_use_case": [{"use_case": "tutor_chat", "would_block": Decimal("2")}], "by_user": []}


class FakeQuery:
    def tables_ready(self):
        return True

    def summary(self, scope, days, group_by, metric):
        return mq.empty_summary(group_by, days, metric)


@pytest.fixture
def env(monkeypatch):
    real = get_settings()
    stub = SimpleNamespace(jwt_secret_key=real.jwt_secret_key, jwt_algorithm=real.jwt_algorithm,
                           super_admin_user_ids=STAFF, internal_service_token="svc", client_secret=None)
    monkeypatch.setattr(security, "get_settings", lambda: stub)
    import ai_service.app.routers.super_admin as sa_mod
    monkeypatch.setattr(sa_mod, "get_settings", lambda: stub)
    fake = FakeLimits()
    engine = FakeEngine()
    audit = []
    monkeypatch.setattr(cl, "change_log_ready", lambda db: True)
    import ai_service.app.services.model_defaults_admin as mda
    monkeypatch.setattr(mda, "_log_change", lambda db, t, k, o, n, r, a: audit.append((t, k, o, n, r, a)))
    monkeypatch.setattr(mq.MeteringQuery, "catalog",
                        lambda self: {"tutor_chat": {"label": "AI tutor chat", "feature_group": "tutor"}})
    monkeypatch.setattr(cl, "get_limits_engine", lambda: engine)
    monkeypatch.setattr(cl, "enforce_globally_enabled", lambda: True)

    app = FastAPI()
    app.include_router(cl.router)
    app.include_router(mla.router)
    app.include_router(credits_v2.router)
    app.dependency_overrides[db_dependency] = lambda: fake.db
    app.dependency_overrides[cl.get_limits_query] = lambda: fake
    app.dependency_overrides[ENGINE_DEP] = lambda: engine
    app.dependency_overrides[credits_v2.get_metering_query] = lambda: FakeQuery()
    return SimpleNamespace(client=TestClient(app), fake=fake, engine=engine, audit=audit)


ROW = {"subject_kind": "ROLE_CLASS", "subject_value": "TEACHER", "scope_kind": "USE_CASE",
       "scope_value": "tutor_chat", "period": "DAY", "metric": "CREDITS", "soft_limit": 15,
       "hard_limit": 20, "reason": "keep tutor spend in check"}

TENANT_ROUTES = [
    ("get", BASE, None),
    ("put", f"{BASE}/policy", {"mode": "SHADOW", "reason": "try it"}),
    ("post", f"{BASE}/rows", ROW),
    ("patch", f"{BASE}/rows/{uuid.uuid4()}", {"hard_limit": 5, "reason": "x"}),
    ("delete", f"{BASE}/rows/{uuid.uuid4()}?reason=x", None),
    ("post", f"{BASE}/preview", {"rows": []}),
    ("get", f"{BASE}/effective?user_id=u-9", None),
    ("get", f"{BASE}/usage?period=DAY", None),
]


def _call(client, method, url, body, headers=None):
    kw = {"headers": headers or {}}
    if body is not None:
        kw["json"] = body
    return getattr(client, method)(url, **kw) if method != "delete" else client.request(
        "DELETE", url, **kw)


# ── auth matrix ─────────────────────────────────────────────────────────────

@pytest.mark.parametrize("method,url,body", TENANT_ROUTES)
def test_no_token_is_401(env, method, url, body):
    assert _call(env.client, method, url, body).status_code == 401


@pytest.mark.parametrize("method,url,body", TENANT_ROUTES)
def test_non_admin_member_is_403(env, method, url, body):
    r = _call(env.client, method, url, body, _hdr(roles=("TEACHER",), user=TEACHER))
    assert r.status_code == 403


@pytest.mark.parametrize("method,url,body", TENANT_ROUTES)
def test_admin_of_another_institute_is_403(env, method, url, body):
    r = _call(env.client, method, url, body, _hdr(inst=INST_B, roles=("ADMIN",)))
    assert r.status_code == 403


@pytest.mark.parametrize("method,url,body", TENANT_ROUTES)
def test_admin_and_staff_pass_the_guard(env, method, url, body):
    for headers in (_hdr(), _hdr(inst=INST_B, roles=("STUDENT",), user=STAFF)):
        r = _call(env.client, method, url, body, headers)
        # past auth: 200, 404 for the random row ids, 409 for the second identical row
        assert r.status_code in (200, 404, 409), (method, url, r.status_code, r.text)


SA_ROUTES = [
    ("get", f"{SA}/overview", None),
    ("get", f"{SA}/{INST_A}/policy", None),
    ("put", f"{SA}/{INST_A}/policy", {"mode": "ENFORCE", "reason": "x"}),
    ("get", f"{SA}/{INST_A}/rows", None),
    ("post", f"{SA}/{INST_A}/rows", ROW),
    ("patch", f"{SA}/{INST_A}/rows/{uuid.uuid4()}", {"hard_limit": 1, "reason": "x"}),
    ("delete", f"{SA}/{INST_A}/rows/{uuid.uuid4()}?reason=x", None),
    ("get", f"{SA}/{INST_A}/usage", None),
    ("get", f"{SA}/{INST_A}/effective", None),
    ("post", f"{SA}/{INST_A}/preview", {"rows": []}),
]


@pytest.mark.parametrize("method,url,body", SA_ROUTES)
def test_super_admin_routes_are_staff_only(env, method, url, body):
    assert _call(env.client, method, url, body).status_code == 401
    assert _call(env.client, method, url, body, _hdr()).status_code == 403  # institute admin
    r = _call(env.client, method, url, body, _hdr(user=STAFF))
    assert r.status_code in (200, 404), (url, r.text)


def test_super_admin_guard_is_router_level():
    deps = [d.dependency for d in mla.router.dependencies]
    assert mla._staff_only in deps


# ── GET "" ──────────────────────────────────────────────────────────────────

def test_get_without_policy_is_default_off(env):
    r = env.client.get(BASE, headers=_hdr())
    assert r.status_code == 200
    assert r.json() == {
        "policy": {"mode": "OFF", "tenant_may_enforce": False, "timezone": "Asia/Kolkata",
                   "notify_admins_on_soft": True, "show_numbers_to_learners": False},
        "rows": [], "platform_rows": [], "enforce_globally_enabled": True}


def test_get_splits_tenant_and_platform_rows_with_labels(env):
    env.fake.add(subject_kind="USER", subject_value="u-9", scope_kind="USE_CASE", scope_value="tutor_chat",
                 period="DAY", hard_limit=Decimal("20"))
    env.fake.add(origin="PLATFORM", locked=True, hard_limit=Decimal("5000"))
    env.fake.add(institute_id=INST_B, hard_limit=Decimal("1"))  # other institute: never shown
    body = env.client.get(BASE, headers=_hdr()).json()
    assert len(body["rows"]) == 1 and len(body["platform_rows"]) == 1
    row = body["rows"][0]
    assert set(row) == {"id", "subject_kind", "subject_value", "subject_label", "per_member", "scope_kind",
                        "scope_value", "scope_label", "period", "metric", "soft_limit", "hard_limit",
                        "origin", "locked", "is_active", "reason", "created_by", "created_at", "updated_at"}
    assert row["subject_label"] == "Priya Sharma" and row["scope_label"] == "AI tutor chat"
    assert row["hard_limit"] == 20.0
    plat = body["platform_rows"][0]
    assert plat["locked"] is True and plat["subject_label"] == "Whole institute"
    assert plat["scope_label"] == "All AI features"


def test_tables_missing_reads_default_and_writes_503(env):
    env.fake.ready = False
    assert env.client.get(BASE, headers=_hdr()).json()["policy"]["mode"] == "OFF"
    assert env.client.post(f"{BASE}/rows", json=ROW, headers=_hdr()).status_code == 503
    assert env.client.put(f"{BASE}/policy", json={"mode": "SHADOW", "reason": "x"},
                          headers=_hdr()).status_code == 503
    assert env.client.get(f"{BASE}/usage", headers=_hdr()).json() == []
    assert env.client.get(f"{BASE}/effective", headers=_hdr()).json() == []


# ── policy + ENFORCE gating ─────────────────────────────────────────────────

def test_tenant_policy_shadow_then_enforce_needs_unlock(env):
    h = _hdr()
    r = env.client.put(f"{BASE}/policy", json={"mode": "shadow", "show_numbers_to_learners": True,
                                               "reason": "preview first"}, headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["mode"] == "SHADOW" and r.json()["show_numbers_to_learners"] is True
    table, key, old, new, reason, actor = env.audit[-1]
    assert (table, key, old, reason, actor) == ("institute_ai_limits_policy", INST_A, None, "preview first", ADMIN)
    assert new["mode"] == "SHADOW"

    r = env.client.put(f"{BASE}/policy", json={"mode": "ENFORCE", "reason": "go"}, headers=h)
    assert r.status_code == 403
    assert env.fake.policies[INST_A]["mode"] == "SHADOW"

    env.fake.policies[INST_A]["tenant_may_enforce"] = True
    r = env.client.put(f"{BASE}/policy", json={"mode": "ENFORCE", "reason": "go"}, headers=h)
    assert r.status_code == 200 and r.json()["mode"] == "ENFORCE"


def test_tenant_cannot_change_tenant_may_enforce_or_timezone(env):
    r = env.client.put(f"{BASE}/policy", json={"mode": "OFF", "tenant_may_enforce": True,
                                               "timezone": "UTC", "reason": "x"}, headers=_hdr())
    assert r.status_code == 200
    p = env.fake.policies[INST_A]
    assert p["tenant_may_enforce"] is False and p["timezone"] == "Asia/Kolkata"


def test_tenant_cannot_lift_a_platform_enforce(env):
    env.fake.policies[INST_A] = {"institute_id": INST_A, "mode": "ENFORCE", "tenant_may_enforce": False,
                                 "timezone": "Asia/Kolkata", "notify_admins_on_soft": True,
                                 "show_numbers_to_learners": False}
    r = env.client.put(f"{BASE}/policy", json={"mode": "OFF", "reason": "nope"}, headers=_hdr())
    assert r.status_code == 403
    # keeping the mode and changing a display flag is fine
    r = env.client.put(f"{BASE}/policy", json={"mode": "ENFORCE", "notify_admins_on_soft": False,
                                               "reason": "quiet"}, headers=_hdr())
    assert r.status_code == 200 and env.fake.policies[INST_A]["notify_admins_on_soft"] is False


def test_policy_validation(env):
    h = _hdr()
    assert env.client.put(f"{BASE}/policy", json={"mode": "MAYBE", "reason": "x"}, headers=h).status_code == 422
    assert env.client.put(f"{BASE}/policy", json={"mode": "OFF", "reason": "  "}, headers=h).status_code == 422
    assert env.client.put(f"{BASE}/policy", json={"mode": "OFF"}, headers=h).status_code == 422


def test_super_admin_policy_any_mode_and_unlock(env):
    h = _hdr(user=STAFF)
    r = env.client.put(f"{SA}/{INST_A}/policy", json={"mode": "ENFORCE", "tenant_may_enforce": True,
                                                       "timezone": "Asia/Dubai", "reason": "plan"}, headers=h)
    assert r.status_code == 200, r.text
    assert (r.json()["mode"], r.json()["tenant_may_enforce"], r.json()["timezone"]) == ("ENFORCE", True,
                                                                                          "Asia/Dubai")
    assert env.audit[-1][5] == STAFF
    assert env.client.put(f"{SA}/{INST_A}/policy", json={"timezone": "Mars/Base", "reason": "x"},
                          headers=h).status_code == 422
    got = env.client.get(f"{SA}/{INST_A}/policy", headers=h).json()
    assert got["mode"] == "ENFORCE" and got["exists"] is True and "enforce_globally_enabled" in got


# ── rows: create / validate ─────────────────────────────────────────────────

def test_tenant_creates_a_row_with_audit(env):
    r = env.client.post(f"{BASE}/rows", json=ROW, headers=_hdr())
    assert r.status_code == 200, r.text
    row = r.json()
    assert row["origin"] == "TENANT" and row["locked"] is False and row["per_member"] is True
    assert row["subject_label"] == "Each teacher" and row["scope_label"] == "AI tutor chat"
    assert (row["soft_limit"], row["hard_limit"]) == (15.0, 20.0)
    stored = env.fake.rows[row["id"]]
    assert stored["created_by"] == ADMIN and stored["reason"] == ROW["reason"]
    table, key, old, new, reason, actor = env.audit[-1]
    assert (table, key, old, reason, actor) == ("ai_usage_limit", row["id"], None, ROW["reason"], ADMIN)
    assert env.fake.db.commits == 1
    # same subject/scope/period/metric again -> 409
    assert env.client.post(f"{BASE}/rows", json=ROW, headers=_hdr()).status_code == 409


@pytest.mark.parametrize("patch,code", [
    ({"subject_kind": "GROUP"}, 422),
    ({"subject_kind": "INSTITUTE"}, 422),                       # INSTITUTE with a subject_value
    ({"subject_kind": "ROLE_CLASS", "subject_value": "WIZARD"}, 422),
    ({"subject_kind": "ROLE", "subject_value": "made_up_role"}, 422),
    ({"subject_kind": "USER", "subject_value": None}, 422),
    ({"subject_kind": "USER", "subject_value": "a|b"}, 422),
    ({"scope_kind": "EVERYTHING"}, 422),
    ({"scope_kind": "ALL"}, 422),                               # ALL with a scope_value
    ({"scope_kind": "GROUP", "scope_value": "nope"}, 422),
    ({"scope_value": "no_such_use_case"}, 422),
    ({"scope_value": "platform_internal"}, 422),                # not limit_eligible
    ({"period": "YEAR"}, 422),
    ({"period": "PLAN_PERIOD"}, 422),
    ({"metric": "TOKENS"}, 422),
    ({"metric": "COST_USD"}, 403),                              # dollars: platform only
    ({"soft_limit": 30, "hard_limit": 20}, 422),
    ({"hard_limit": -1}, 422),
    ({"soft_limit": None, "hard_limit": None}, 422),            # ROLE_CLASS needs a number
    ({"hard_limit": 1e12}, 422),
    ({"reason": ""}, 422),
    ({"origin": "PLATFORM"}, 403),
    ({"locked": True}, 403),
])
def test_row_validation(env, patch, code):
    body = {**ROW, **patch}
    r = env.client.post(f"{BASE}/rows", json=body, headers=_hdr())
    assert r.status_code == code, (patch, r.text)
    assert not env.fake.rows


def test_row_variants_that_are_valid(env):
    h = _hdr()
    ok = [
        {"subject_kind": "INSTITUTE", "subject_value": None, "scope_kind": "ALL", "scope_value": None,
         "period": "MONTH", "metric": "CREDITS", "hard_limit": 5000},
        {"subject_kind": "ROLE", "subject_value": "evaluator", "scope_kind": "GROUP", "scope_value": "tutor",
         "period": "WEEK", "metric": "COUNT", "soft_limit": 50, "per_member": False},
        # a USER row with no numbers = exemption from the role cap
        {"subject_kind": "USER", "subject_value": "u-9", "scope_kind": "USE_CASE", "scope_value": "tutor_chat",
         "period": "DAY", "metric": "CREDITS"},
        {"subject_kind": "ROLE_CLASS", "subject_value": "system", "scope_kind": "ALL", "period": "DAY",
         "metric": "CREDITS", "hard_limit": 0},
    ]
    for b in ok:
        r = env.client.post(f"{BASE}/rows", json={**b, "reason": "ok"}, headers=h)
        assert r.status_code == 200, (b, r.text)
    rows = sorted(env.fake.rows.values(), key=lambda r: r["subject_kind"])
    by_kind = {r["subject_kind"]: r for r in rows}
    assert by_kind["ROLE"]["subject_value"] == "EVALUATOR" and by_kind["ROLE"]["per_member"] is False
    assert by_kind["ROLE_CLASS"]["subject_value"] == "SYSTEM"
    assert by_kind["INSTITUTE"]["per_member"] is True
    assert by_kind["USER"]["hard_limit"] is None and by_kind["USER"]["soft_limit"] is None


def test_super_admin_creates_platform_locked_and_cost_rows(env):
    h = _hdr(user=STAFF)
    r = env.client.post(f"{SA}/{INST_A}/rows", json={**ROW, "metric": "COST_USD"}, headers=h)
    assert r.status_code == 200, r.text
    assert (r.json()["origin"], r.json()["locked"], r.json()["metric"]) == ("PLATFORM", True, "COST_USD")
    r = env.client.post(f"{SA}/{INST_A}/rows", json={**ROW, "origin": "TENANT"}, headers=h)
    assert (r.json()["origin"], r.json()["locked"]) == ("TENANT", False)
    assert env.client.post(f"{SA}/{INST_A}/rows", json={**ROW, "origin": "X"}, headers=h).status_code == 422
    assert env.client.post(f"{SA}/{INST_A}/rows", json={**ROW, "period": "PLAN_PERIOD"},
                           headers=h).status_code == 422


# ── rows: patch / delete protection ─────────────────────────────────────────

def test_tenant_cannot_touch_platform_or_locked_rows(env):
    plat = env.fake.add(origin="PLATFORM", locked=True)
    locked_tenant = env.fake.add(subject_kind="ROLE_CLASS", subject_value="TEACHER", locked=True)
    h = _hdr()
    for row in (plat, locked_tenant):
        assert env.client.patch(f"{BASE}/rows/{row['id']}", json={"hard_limit": 1, "reason": "x"},
                                headers=h).status_code == 403
        assert env.client.delete(f"{BASE}/rows/{row['id']}?reason=x", headers=h).status_code == 403
        assert env.fake.rows[row["id"]]["is_active"] is True
        assert env.fake.rows[row["id"]]["hard_limit"] == Decimal("100")
    # staff through the TENANT API get tenant rights too
    assert env.client.patch(f"{BASE}/rows/{plat['id']}", json={"hard_limit": 1, "reason": "x"},
                            headers=_hdr(user=STAFF)).status_code == 403
    # ... and full rights through the super-admin API
    r = env.client.patch(f"{SA}/{INST_A}/rows/{plat['id']}", json={"hard_limit": 1, "locked": False,
                                                                    "reason": "fair use"},
                         headers=_hdr(user=STAFF))
    assert r.status_code == 200 and r.json()["hard_limit"] == 1.0 and r.json()["locked"] is False


def test_tenant_patch_and_delete_own_row(env):
    row = env.fake.add(soft_limit=Decimal("50"))
    h = _hdr()
    r = env.client.patch(f"{BASE}/rows/{row['id']}", json={"hard_limit": 40, "reason": "x"}, headers=h)
    assert r.status_code == 422  # soft 50 > hard 40
    r = env.client.patch(f"{BASE}/rows/{row['id']}", json={"hard_limit": 80, "reason": "raise"}, headers=h)
    assert r.status_code == 200 and r.json()["hard_limit"] == 80.0 and r.json()["soft_limit"] == 50.0
    assert env.audit[-1][0] == "ai_usage_limit" and env.audit[-1][2]["hard_limit"] == 100.0
    r = env.client.patch(f"{BASE}/rows/{row['id']}", json={"soft_limit": None, "reason": "no warning"},
                         headers=h)
    assert r.status_code == 200 and r.json()["soft_limit"] is None
    assert env.client.patch(f"{BASE}/rows/{row['id']}", json={"reason": "nothing"},
                            headers=h).status_code == 422
    assert env.client.delete(f"{BASE}/rows/{row['id']}", headers=h).status_code == 422  # reason required
    r = env.client.delete(f"{BASE}/rows/{row['id']}?reason=not%20needed", headers=h)
    assert r.status_code == 200 and r.json()["is_active"] is False
    assert env.fake.rows[row["id"]]["effective_to"] is not None
    assert env.client.delete(f"{BASE}/rows/{row['id']}?reason=again", headers=h).status_code == 404
    assert env.client.get(BASE, headers=h).json()["rows"] == []
    assert len(env.client.get(f"{BASE}?include_inactive=true", headers=h).json()["rows"]) == 1


def test_row_of_another_institute_is_404(env):
    other = env.fake.add(institute_id=INST_B)
    h = _hdr()
    assert env.client.patch(f"{BASE}/rows/{other['id']}", json={"hard_limit": 1, "reason": "x"},
                            headers=h).status_code == 404
    assert env.client.delete(f"{BASE}/rows/{other['id']}?reason=x", headers=h).status_code == 404
    assert env.client.patch(f"{BASE}/rows/not-a-uuid", json={"hard_limit": 1, "reason": "x"},
                            headers=h).status_code == 404


# ── preview / effective / usage ─────────────────────────────────────────────

def test_preview_validates_and_passes_proposed_rows(env):
    body = {"rows": [{k: v for k, v in ROW.items() if k != "reason"}], "days": 14}
    r = env.client.post(f"{BASE}/preview", json=body, headers=_hdr())
    assert r.status_code == 200, r.text
    out = r.json()
    assert set(out) >= {"events_considered", "would_block", "would_warn", "affected_users", "by_use_case",
                        "by_user"}
    assert out["by_use_case"][0]["would_block"] == 2.0
    _, iid, proposed, days = env.engine.calls[-1]
    assert iid == INST_A and days == 14
    assert proposed[0]["origin"] == "TENANT" and proposed[0]["hard_limit"] == 20.0
    assert proposed[0]["subject_value"] == "TEACHER" and proposed[0]["institute_id"] == INST_A
    bad = {"rows": [{**body["rows"][0], "metric": "COST_USD"}]}
    assert env.client.post(f"{BASE}/preview", json=bad, headers=_hdr()).status_code == 403
    assert env.client.post(f"{BASE}/preview", json={"rows": [], "days": 365},
                           headers=_hdr()).status_code == 422


def test_effective_resolves_the_users_roles(env):
    r = env.client.get(f"{BASE}/effective?user_id=u-9", headers=_hdr())
    assert r.status_code == 200
    items = r.json()
    assert isinstance(items, list)
    assert set(items[0]) >= {"row", "scope", "period", "used", "soft", "hard", "resets_at", "decision", "why"}
    assert items[0]["used"] == 12.5
    # the engine takes the user's roles from their latest event itself
    assert env.engine.calls[-1] == ("effective", INST_A, "u-9", None, None)


def test_engine_missing_is_503_for_preview_and_effective(env):
    env.client.app.dependency_overrides[ENGINE_DEP] = lambda: None
    assert env.client.get(f"{BASE}/effective?user_id=u-9", headers=_hdr()).status_code == 503
    assert env.client.post(f"{BASE}/preview", json={"rows": []}, headers=_hdr()).status_code == 503


def test_usage_labels_counters_and_finds_the_binding_limit(env):
    env.fake.policies[INST_A] = {"institute_id": INST_A, "mode": "SHADOW", "tenant_may_enforce": False,
                                 "timezone": "Asia/Kolkata", "notify_admins_on_soft": True,
                                 "show_numbers_to_learners": False}
    env.fake.add(period="DAY", hard_limit=Decimal("100"), soft_limit=Decimal("80"))
    env.fake.add(subject_kind="ROLE_CLASS", subject_value="TEACHER", scope_kind="USE_CASE",
                 scope_value="tutor_chat", period="DAY", hard_limit=Decimal("20"))
    env.fake.add(subject_kind="USER", subject_value="u-9", scope_kind="USE_CASE", scope_value="tutor_chat",
                 period="DAY", hard_limit=Decimal("40"))
    env.fake.add(subject_kind="ROLE", subject_value="EVALUATOR", scope_kind="USE_CASE",
                 scope_value="tutor_chat", period="DAY", metric="COST_USD", hard_limit=Decimal("1"),
                 origin="PLATFORM", locked=True)
    ws = datetime(2026, 10, 14, 18, 30, tzinfo=timezone.utc)
    env.fake.counter_rows = [
        {"counter_key": "I|ALL", "period": "DAY", "window_start": ws, "credits_used": Decimal("90"),
         "count_used": Decimal("30"), "cost_usd": Decimal("0.5")},
        {"counter_key": "U:u-9|UC:tutor_chat", "period": "DAY", "window_start": ws,
         "credits_used": Decimal("30"), "count_used": Decimal("10"), "cost_usd": Decimal("0.25")},
        {"counter_key": "weird", "period": "DAY", "window_start": ws, "credits_used": 1, "count_used": 1,
         "cost_usd": 0},
    ]
    r = env.client.get(f"{BASE}/usage?period=DAY", headers=_hdr())
    assert r.status_code == 200, r.text
    items = {i["key"]: i for i in r.json()}
    inst = items["I|ALL"]
    assert inst["label"] == "Whole institute · All AI features"
    assert (inst["soft"], inst["hard"], inst["pct"], inst["unit"]) == (80.0, 100.0, 90.0, "credits")
    assert "cost_usd" not in inst  # tenant: no vendor dollars
    user = items["U:u-9|UC:tutor_chat"]
    # The USER row (40) out-ranks the TEACHER class row (20); the PLATFORM dollar
    # cap via the EVALUATOR role also applies (0.25 of 1 = 25%), 30/40 = 75% binds.
    assert user["label"] == "Priya Sharma · AI tutor chat"
    assert (user["hard"], user["pct"], user["metric"]) == (40.0, 75.0, "CREDITS")
    assert items["weird"]["label"] == "weird" and items["weird"]["hard"] is None
    iid, period, ws_arg = env.fake.counter_query
    assert period == "DAY" and ws_arg.tzinfo is not None
    # staff (super-admin API) see the vendor cost
    sa = {i["key"]: i for i in env.client.get(f"{SA}/{INST_A}/usage?period=DAY",
                                               headers=_hdr(user=STAFF)).json()}
    assert sa["I|ALL"]["cost_usd"] == 0.5
    assert env.client.get(f"{BASE}/usage?period=YEAR", headers=_hdr()).status_code == 422


def test_platform_cost_cap_binds_and_hides_numbers_from_tenant(env):
    env.fake.add(subject_kind="ROLE", subject_value="EVALUATOR", scope_kind="USE_CASE",
                 scope_value="tutor_chat", period="DAY", metric="COST_USD", hard_limit=Decimal("0.5"),
                 origin="PLATFORM", locked=True)
    env.fake.counter_rows = [{"counter_key": "U:u-9|UC:tutor_chat", "period": "DAY",
                              "window_start": datetime.now(timezone.utc), "credits_used": 1,
                              "count_used": 1, "cost_usd": Decimal("0.45")}]
    item = env.client.get(f"{BASE}/usage", headers=_hdr()).json()[0]
    assert item["metric"] == "COST_USD" and item["pct"] == 90.0
    assert item["hard"] is None and item["soft"] is None
    sa = env.client.get(f"{SA}/{INST_A}/usage", headers=_hdr(user=STAFF)).json()[0]
    assert sa["hard"] == 0.5


def test_overview_shape(env):
    env.fake.policies[INST_A] = {"institute_id": INST_A, "mode": "SHADOW", "tenant_may_enforce": False,
                                 "timezone": "Asia/Kolkata", "notify_admins_on_soft": True,
                                 "show_numbers_to_learners": False, "updated_at": None}
    env.fake.add()
    env.fake.add(origin="PLATFORM", locked=True)
    body = env.client.get(f"{SA}/overview", headers=_hdr(user=STAFF)).json()
    inst = body["institutes"][0]
    assert set(inst) >= {"institute_id", "institute_name", "mode", "tenant_may_enforce", "rows",
                         "platform_rows", "would_block_7d", "blocked_7d", "overrun_7d"}
    assert (inst["rows"], inst["platform_rows"], inst["would_block_7d"]) == (1, 1, 4)


# ── me/usage ────────────────────────────────────────────────────────────────

ME = f"/credits/v2/me/usage?institute_id={INST_A}"


def test_me_usage_unchanged_without_a_policy(env):
    r = env.client.get(ME, headers=_hdr(roles=("STUDENT",), user="learner-1"))
    assert r.status_code == 200
    assert "limits" not in r.json()
    assert env.engine.calls == [("has_policy", INST_A)]  # in-memory check only, nothing else


def test_me_usage_hides_numbers_from_learners(env):
    env.engine.policies.add(INST_A)
    r = env.client.get(ME, headers=_hdr(roles=("STUDENT",), user="learner-1"))
    lim = r.json()["limits"]
    assert lim == [{"scope": "USER", "scope_label": "AI tutor chat", "period": "DAY", "used": None,
                    "soft": None, "hard": None, "unit": "credits", "resets_at": "2026-10-16T00:00:00+05:30",
                    "decision": "OK"}]
    assert env.engine.calls[-1] == ("effective", INST_A, "learner-1", "LEARNER", ["STUDENT"])


def test_me_usage_shows_numbers_to_admins_and_when_the_institute_allows(env):
    env.engine.policies.add(INST_A)
    lim = env.client.get(ME, headers=_hdr()).json()["limits"][0]
    assert (lim["used"], lim["soft"], lim["hard"]) == (12.5, 15.0, 20.0)
    env.engine.policy = {"mode": "ENFORCE", "show_numbers_to_learners": True}
    lim = env.client.get(ME, headers=_hdr(roles=("STUDENT",), user="learner-1")).json()["limits"][0]
    assert (lim["used"], lim["hard"]) == (12.5, 20.0)


def test_me_usage_policy_off_and_engine_errors_fail_open(env):
    env.engine.policies.add(INST_A)
    env.engine.policy = {"mode": "OFF"}
    assert env.client.get(ME, headers=_hdr()).json()["limits"] == []
    env.engine.policy = {"mode": "SHADOW"}

    def boom(*a, **k):
        raise RuntimeError("db down")
    env.engine.effective_limits = boom
    r = env.client.get(ME, headers=_hdr())
    assert r.status_code == 200 and r.json()["limits"] == []


def test_me_usage_without_engine_is_unchanged(env, monkeypatch):
    monkeypatch.setattr(cl, "get_limits_engine", lambda: None)
    r = env.client.get(ME, headers=_hdr())
    assert r.status_code == 200 and "limits" not in r.json()


# ── pure helpers ────────────────────────────────────────────────────────────

def test_parse_counter_key_and_labels():
    assert mq.parse_counter_key("I|ALL") == {"subject_kind": "INSTITUTE", "subject_value": None,
                                             "scope_kind": "ALL", "scope_value": None}
    assert mq.parse_counter_key("RC:TEACHER|G:tutor")["subject_kind"] == "ROLE_CLASS"
    assert mq.parse_counter_key("R:EVALUATOR|UC:lesson_video") == {
        "subject_kind": "ROLE", "subject_value": "EVALUATOR", "scope_kind": "USE_CASE",
        "scope_value": "lesson_video"}
    assert mq.parse_counter_key("U:abc:def|ALL")["subject_value"] == "abc:def"
    assert mq.counter_label("RC:TEACHER|G:tutor") == "Teacher · AI tutor"
    assert mq.counter_label("R:CONTENT_CREATOR|ALL") == "Content creator · All AI features"


def test_window_start_in_policy_timezone():
    now = datetime(2026, 10, 15, 20, 0, tzinfo=timezone.utc)   # 01:30 IST on the 16th (a Friday)
    assert mq.limits_window_start("DAY", "Asia/Kolkata", now) == datetime(2026, 10, 15, 18, 30,
                                                                          tzinfo=timezone.utc)
    assert mq.limits_window_start("WEEK", "Asia/Kolkata", now) == datetime(2026, 10, 11, 18, 30,
                                                                           tzinfo=timezone.utc)
    assert mq.limits_window_start("MONTH", "Asia/Kolkata", now) == datetime(2026, 9, 30, 18, 30,
                                                                            tzinfo=timezone.utc)
    assert mq.limits_window_start("DAY", "UTC", now) == datetime(2026, 10, 15, tzinfo=timezone.utc)


def test_governing_rows_precedence():
    rows = [
        {"id": "a", "subject_kind": "ROLE_CLASS", "subject_value": "TEACHER", "per_member": True,
         "scope_kind": "ALL", "scope_value": None, "origin": "TENANT", "hard_limit": 10},
        {"id": "b", "subject_kind": "ROLE", "subject_value": "EVALUATOR", "per_member": True,
         "scope_kind": "ALL", "scope_value": None, "origin": "TENANT", "hard_limit": 30},
        {"id": "c", "subject_kind": "ROLE", "subject_value": "MENTOR", "per_member": True,
         "scope_kind": "ALL", "scope_value": None, "origin": "TENANT", "hard_limit": None},
        {"id": "d", "subject_kind": "ROLE_CLASS", "subject_value": "TEACHER", "per_member": False,
         "scope_kind": "ALL", "scope_value": None, "origin": "TENANT", "hard_limit": 500},
        {"id": "e", "subject_kind": "ROLE_CLASS", "subject_value": "TEACHER", "per_member": True,
         "scope_kind": "ALL", "scope_value": None, "origin": "PLATFORM", "hard_limit": 1000},
    ]
    user = {"subject_kind": "USER", "subject_value": "u", "scope_kind": "ALL", "scope_value": None}
    one_role = {"role_class": "TEACHER", "raw_roles": ["Evaluator"]}
    assert [r["id"] for r in cl.governing_rows(user, rows, one_role)] == ["b", "e"]
    # several roles with rows: the most permissive (NULL = unlimited) wins
    two = {"role_class": "TEACHER", "raw_roles": ["EVALUATOR", "mentor"]}
    assert [r["id"] for r in cl.governing_rows(user, rows, two)] == ["c", "e"]
    no_role_rows = {"role_class": "TEACHER", "raw_roles": ["COURSE_CREATOR"]}
    assert [r["id"] for r in cl.governing_rows(user, rows, no_role_rows)] == ["a", "e"]
    pool = {"subject_kind": "ROLE_CLASS", "subject_value": "TEACHER", "scope_kind": "ALL", "scope_value": None}
    assert [r["id"] for r in cl.governing_rows(pool, rows)] == ["d"]


# ── engine notifications, preview edits, me/usage selection ─────────────────

def _notes(env):
    return [c for c in env.engine.calls if c[0] == "notify"]


def test_writes_notify_the_engine(env):
    h = _hdr()
    r = env.client.post(f"{BASE}/rows", json=ROW, headers=h)
    assert _notes(env)[-1] == ("notify", INST_A, False, None)  # no live policy: no rebuild
    env.client.put(f"{BASE}/policy", json={"mode": "SHADOW", "reason": "go"}, headers=h)
    assert _notes(env)[-1] == ("notify", INST_A, True, True)   # turned on: rebuild windows
    env.client.put(f"{BASE}/policy", json={"mode": "SHADOW", "notify_admins_on_soft": False,
                                           "reason": "quiet"}, headers=h)
    assert _notes(env)[-1] == ("notify", INST_A, False, True)  # still on, same timezone
    env.client.patch(f"{BASE}/rows/{r.json()['id']}", json={"hard_limit": 25, "reason": "x"}, headers=h)
    assert _notes(env)[-1] == ("notify", INST_A, True, None)   # live: the new row's windows rebuilt
    env.client.put(f"{BASE}/policy", json={"mode": "OFF", "reason": "stop"}, headers=h)
    assert _notes(env)[-1] == ("notify", INST_A, False, False)
    env.client.put(f"{SA}/{INST_A}/policy", json={"mode": "ENFORCE", "timezone": "UTC", "reason": "x"},
                   headers=_hdr(user=STAFF))
    assert _notes(env)[-1] == ("notify", INST_A, True, True)


def test_scope_value_is_stored_lower_case(env):
    r = env.client.post(f"{BASE}/rows", json={**ROW, "scope_value": "Tutor_Chat"}, headers=_hdr())
    assert r.status_code == 200 and r.json()["scope_value"] == "tutor_chat"


def test_preview_can_replace_and_remove_own_rows_only(env):
    own = env.fake.add()
    plat = env.fake.add(origin="PLATFORM", locked=True)
    h = _hdr()
    body = {"rows": [{"id": own["id"], "subject_kind": "INSTITUTE", "scope_kind": "ALL", "period": "MONTH",
                      "metric": "CREDITS", "hard_limit": 50},
                     {"id": own["id"], "is_active": False}]}
    r = env.client.post(f"{BASE}/preview", json=body, headers=h)
    assert r.status_code == 200, r.text
    proposed = env.engine.calls[-1][2]
    assert proposed[0]["id"] == own["id"] and proposed[0]["hard_limit"] == 50.0
    assert proposed[1] == {"id": own["id"], "is_active": False, "institute_id": INST_A}
    assert env.client.post(f"{BASE}/preview", json={"rows": [{"id": plat["id"], "is_active": False}]},
                           headers=h).status_code == 403
    assert env.client.post(f"{BASE}/preview", json={"rows": [{"is_active": False}]},
                           headers=h).status_code == 422
    assert env.client.post(f"{BASE}/preview", json={"rows": [{"id": str(uuid.uuid4()), "is_active": False}]},
                           headers=h).status_code == 422
    assert env.client.post(f"{BASE}/preview", json={"rows": [{"subject_kind": "INSTITUTE"}]},
                           headers=h).status_code == 422  # incomplete row
    # the super admin may remove a platform row in a preview, and proposes PLATFORM rows by default
    r = env.client.post(f"{SA}/{INST_A}/preview", json={"rows": [
        {"id": plat["id"], "is_active": False},
        {"subject_kind": "INSTITUTE", "scope_kind": "ALL", "period": "DAY", "metric": "COST_USD",
         "hard_limit": 3}]}, headers=_hdr(user=STAFF))
    assert r.status_code == 200
    assert env.engine.calls[-1][2][1]["origin"] == "PLATFORM" and env.engine.calls[-1][2][1]["locked"] is True


def test_preview_engine_validation_error_is_422(env):
    env.engine.preview_error = "proposed row 1: soft_limit must be <= hard_limit"
    r = env.client.post(f"{BASE}/preview", json={"rows": []}, headers=_hdr())
    assert r.status_code == 422 and "soft_limit" in r.json()["detail"]


def test_me_usage_leaves_out_overridden_rows_and_uses_engine_labels(env):
    env.engine.policies.add(INST_A)
    env.engine.items = env.engine.items + [{
        "row": {"subject_kind": "ROLE_CLASS", "scope_kind": "ALL", "period": "DAY", "metric": "COUNT"},
        "scope": "ROLE_CLASS", "period": "DAY", "used": 3, "soft": None, "hard": 5, "selected": False,
        "decision": "OVERRIDDEN"},
        {"row": {"subject_kind": "INSTITUTE", "scope_kind": "GROUP", "scope_value": "tutor", "period": "WEEK",
                 "metric": "COUNT"},
         "scope": "INSTITUTE", "scope_label": "Tutor features", "metric": "COUNT", "period": "WEEK", "used": 3,
         "hard": 5, "selected": True, "decision": "OK"}]
    lim = env.client.get(ME, headers=_hdr()).json()["limits"]
    assert [x["scope"] for x in lim] == ["USER", "INSTITUTE"]
    assert lim[1]["scope_label"] == "Tutor features" and lim[1]["unit"] == "requests"


def test_usage_reports_the_window_in_the_policy_timezone(env):
    env.fake.counter_rows = [{"counter_key": "I|ALL", "period": "MONTH", "window_start": None,
                              "credits_used": 1, "count_used": 1, "cost_usd": 0}]
    item = env.client.get(f"{BASE}/usage?period=MONTH", headers=_hdr()).json()[0]
    assert item["window_start"].endswith("T00:00:00+05:30") and item["window_start"][8:10] == "01"
    assert item["resets_at"].endswith("T00:00:00+05:30") and item["resets_at"][8:10] == "01"


def test_tenant_may_enforce_still_cannot_lift_platform_rows(env):
    """tenant_may_enforce lets an institute enforce ITS rows; the mode also
    switches PLATFORM rows, so with one present the tenant may not lower it."""
    env.fake.policies[INST_A] = {"institute_id": INST_A, "mode": "ENFORCE", "tenant_may_enforce": True,
                                 "timezone": "Asia/Kolkata", "notify_admins_on_soft": True,
                                 "show_numbers_to_learners": False}
    # without platform rows the tenant owns the mode (unchanged behaviour)
    r = env.client.put(f"{BASE}/policy", json={"mode": "SHADOW", "reason": "trial"}, headers=_hdr())
    assert r.status_code == 200
    r = env.client.put(f"{BASE}/policy", json={"mode": "ENFORCE", "reason": "back on"}, headers=_hdr())
    assert r.status_code == 200
    r = env.client.post(f"{SA}/{INST_A}/rows", json=dict(ROW, origin="PLATFORM", locked=True, reason="cap"),
                        headers=_hdr(user=STAFF))
    assert r.status_code in (200, 201), r.text
    for mode in ("OFF", "SHADOW"):
        r = env.client.put(f"{BASE}/policy", json={"mode": mode, "reason": "lift platform cap"}, headers=_hdr())
        assert r.status_code == 403, (mode, r.text)
    assert env.fake.policies[INST_A]["mode"] == "ENFORCE"
    # flags can still change, and the super admin may still lower it
    r = env.client.put(f"{BASE}/policy", json={"mode": "ENFORCE", "show_numbers_to_learners": True,
                                               "reason": "show"}, headers=_hdr())
    assert r.status_code == 200
    r = env.client.put(f"{SA}/{INST_A}/policy", json={"mode": "OFF", "reason": "support"},
                       headers=_hdr(user=STAFF))
    assert r.status_code == 200 and env.fake.policies[INST_A]["mode"] == "OFF"
