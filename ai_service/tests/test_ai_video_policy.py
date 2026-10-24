"""AI video policy: storage in institutes.setting_json, the super-admin
GET/PUT/DELETE endpoints, usage numbers, and the policy checks.

A fake session stands in for Postgres: it serves `SELECT setting_json` /
`UPDATE institutes` from an in-memory dict and records the usage queries.
"""
from __future__ import annotations

import json
import os
import sys
import types
from datetime import datetime, timezone

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

try:
    import boto3  # noqa: F401
except ImportError:  # pragma: no cover
    for _name in ("boto3", "botocore", "botocore.exceptions", "botocore.config"):
        sys.modules.setdefault(_name, types.ModuleType(_name))
    sys.modules["botocore.exceptions"].ClientError = Exception
    sys.modules["botocore.exceptions"].NoCredentialsError = Exception
    sys.modules["botocore.config"].Config = object

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.constants.ai_video_policy import AI_VIDEO_POLICY_KEY, DEFAULT_AI_VIDEO_POLICY, VIDEO_REQUEST_TYPES
from app.core.security import get_current_user
from app.db import db_dependency
from app.routers import super_admin as sa
from app.routers import super_admin_ai_video_policy as pol_router
from app.schemas.auth import CustomUserDetails
from app.services import ai_video_policy_service as svc

INST = "11111111-1111-1111-1111-111111111111"
OPS = "ops-user"
URL = f"/super-admin/v1/institutes/{INST}/ai-video-policy"
USAGE = {"month_credits_used": 120.5, "running_now": 1, "videos_this_month": 4}


class _Result:
    def __init__(self, row):
        self.row = row

    def first(self):
        return self.row

    def scalar(self):
        return self.row[0] if self.row else None


class FakeSettingsDB:
    def __init__(self, blobs):
        self.blobs = dict(blobs)        # institute id -> setting_json (str or None); absent = no institute
        self.commits = 0
        self.statements = []

    def execute(self, stmt, params=None):
        sql = " ".join(str(stmt).split())
        self.statements.append((sql, params))
        if sql.startswith("SELECT setting_json FROM institutes"):
            iid = params["id"]
            return _Result((self.blobs[iid],) if iid in self.blobs else None)
        if sql.startswith("UPDATE institutes SET setting_json"):
            self.blobs[params["id"]] = params["s"]
            return _Result(None)
        raise AssertionError(f"unexpected SQL: {sql}")

    def commit(self):
        self.commits += 1

    def rollback(self):
        pass

    def setting(self, iid=INST):
        raw = self.blobs.get(iid)
        return (json.loads(raw) if raw else {}).get("setting", {})


@pytest.fixture
def portal(monkeypatch):
    db = FakeSettingsDB({INST: json.dumps({"institute_id": INST, "setting": {
        "VIDEO_BRANDING": {"key": "VIDEO_BRANDING", "name": "Video Branding", "data": {"x": 1}}}})})
    user = {"id": OPS}
    monkeypatch.setattr(sa, "is_platform_staff", lambda u: bool(u) and u.user_id == OPS)
    monkeypatch.setattr(svc, "usage", lambda d, inst: dict(USAGE))
    app = FastAPI()
    app.include_router(pol_router.router)
    app.dependency_overrides[db_dependency] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: CustomUserDetails(username="u", user_id=user["id"])
    with TestClient(app) as client:
        yield client, db, user


def _full(**over):
    body = {"enabled": True, "allowed_qualities": ["standard", "premium"], "teacher_allowed": False,
            "max_minutes_per_video": 5, "monthly_credit_cap": 2000, "max_concurrent": 2,
            "reason": "Pilot limits"}
    body.update(over)
    return body


def test_get_returns_defaults_when_the_key_is_missing(portal):
    client, _, _ = portal
    r = client.get(URL)
    assert r.status_code == 200
    assert r.json() == {"policy": DEFAULT_AI_VIDEO_POLICY, "is_default": True, "usage": USAGE}


def test_get_never_404s_for_an_unknown_institute(portal):
    client, _, _ = portal
    r = client.get("/super-admin/v1/institutes/unknown/ai-video-policy")
    assert r.status_code == 200 and r.json()["is_default"] is True


def test_non_staff_is_refused(portal):
    client, db, user = portal
    user["id"] = "institute-admin"
    assert client.get(URL).status_code == 403
    assert client.put(URL, json=_full()).status_code == 403
    assert client.delete(URL).status_code == 403
    assert AI_VIDEO_POLICY_KEY not in db.setting()


def test_put_stores_the_policy_beside_other_settings(portal):
    client, db, _ = portal
    r = client.put(URL, json=_full())
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["is_default"] is False and body["usage"] == USAGE
    p = body["policy"]
    assert {k: p[k] for k in DEFAULT_AI_VIDEO_POLICY} == {
        "enabled": True, "allowed_qualities": ["standard", "premium"], "teacher_allowed": False,
        "max_minutes_per_video": 5, "monthly_credit_cap": 2000.0, "max_concurrent": 2}
    assert p["updated_by"] == OPS and p["reason"] == "Pilot limits" and p["updated_at"]
    stored = db.setting()
    assert stored["VIDEO_BRANDING"]["data"] == {"x": 1}                    # untouched
    assert stored[AI_VIDEO_POLICY_KEY]["key"] == AI_VIDEO_POLICY_KEY
    assert stored[AI_VIDEO_POLICY_KEY]["data"]["reason"] == "Pilot limits"
    assert any("FOR UPDATE" in sql for sql, _ in db.statements)
    assert client.get(URL).json()["policy"]["max_concurrent"] == 2


def test_put_absent_fields_keep_and_explicit_null_cap_clears(portal):
    client, _, _ = portal
    client.put(URL, json=_full())
    r = client.put(URL, json={"max_concurrent": 5, "reason": "More room"})
    p = r.json()["policy"]
    assert p["max_concurrent"] == 5 and p["monthly_credit_cap"] == 2000.0 and p["teacher_allowed"] is False
    r = client.put(URL, json={"monthly_credit_cap": None, "enabled": None, "reason": "Lift cap"})
    p = r.json()["policy"]
    assert p["monthly_credit_cap"] is None and p["enabled"] is True and p["reason"] == "Lift cap"


@pytest.mark.parametrize("over", [
    {"max_minutes_per_video": 0}, {"max_minutes_per_video": 31},
    {"max_concurrent": 0}, {"max_concurrent": 21},
    {"monthly_credit_cap": -1},
    {"allowed_qualities": ["super_ultra"]},
    {"allowed_qualities": []},                       # empty while enabled
    {"reason": "  "},
])
def test_put_validation(portal, over):
    client, db, _ = portal
    r = client.put(URL, json=_full(**over))
    assert r.status_code == 422, r.text
    assert AI_VIDEO_POLICY_KEY not in db.setting()


def test_put_requires_a_reason(portal):
    client, _, _ = portal
    body = _full()
    body.pop("reason")
    assert client.put(URL, json=body).status_code == 422


def test_put_allows_no_qualities_when_disabled(portal):
    client, _, _ = portal
    r = client.put(URL, json=_full(enabled=False, allowed_qualities=[]))
    assert r.status_code == 200 and r.json()["policy"]["allowed_qualities"] == []


def test_put_unknown_institute_is_404(portal):
    client, _, _ = portal
    assert client.put("/super-admin/v1/institutes/nope/ai-video-policy", json=_full()).status_code == 404


def test_delete_resets_to_defaults(portal):
    client, db, _ = portal
    client.put(URL, json=_full())
    r = client.delete(URL, params={"reason": "Pilot over"})
    assert r.status_code == 200
    assert r.json()["is_default"] is True and r.json()["policy"] == DEFAULT_AI_VIDEO_POLICY
    assert AI_VIDEO_POLICY_KEY not in db.setting() and "VIDEO_BRANDING" in db.setting()
    assert client.delete(URL).status_code == 200                         # idempotent


# ── service: normalising + checks ────────────────────────────────────────────

def test_normalize_tolerates_bad_stored_values():
    p = svc.normalize_policy({"enabled": "yes", "allowed_qualities": ["ULTRA", "bogus"], "max_minutes_per_video": 99,
                              "max_concurrent": "4", "monthly_credit_cap": -5})
    assert p["enabled"] is True and p["allowed_qualities"] == ["ultra"]
    assert p["max_minutes_per_video"] == 8 and p["max_concurrent"] == 4 and p["monthly_credit_cap"] is None


def test_load_policy_defaults_when_missing():
    db = FakeSettingsDB({INST: None})
    assert svc.load_policy(db, INST) == (DEFAULT_AI_VIDEO_POLICY, True)
    db = FakeSettingsDB({INST: json.dumps({"setting": {AI_VIDEO_POLICY_KEY: {"data": {"max_concurrent": 1}}}})})
    policy, is_default = svc.load_policy(db, INST)
    assert is_default is False and policy["max_concurrent"] == 1 and policy["enabled"] is True


def test_static_and_usage_checks():
    p = svc.normalize_policy(None)
    assert svc.static_block(p, quality="ultra", teacher_requested=True, duration="5-8 minutes") is None
    assert svc.static_block({**p, "max_minutes_per_video": 3}, quality="standard", teacher_requested=False,
                            duration="3-5 minutes")[0] == "TOO_LONG"
    assert svc.usage_block(p, expected_credits=10_000, month_used=10_000, running=2) is None   # no cap
    assert svc.usage_block(p, expected_credits=1, month_used=0, running=3)[0] == "TOO_MANY_RUNNING"


# ── service: usage queries ───────────────────────────────────────────────────

class _UsageDB:
    def __init__(self, row):
        self.row = row
        self.calls = []

    def execute(self, stmt, params=None):
        self.calls.append((" ".join(str(stmt).split()), params))
        return _Result(self.row)


def test_month_credits_are_net_of_refunds_since_the_utc_month_start():
    db = _UsageDB((100.0, 30.0))
    now = datetime(2026, 10, 13, 5, 0, tzinfo=timezone.utc)
    assert svc.month_credits_used(db, INST, now=now) == 70.0
    sql, params = db.calls[0]
    assert params["since"] == datetime(2026, 10, 1)                       # naive UTC (credit ledger)
    assert params["types"] == list(VIDEO_REQUEST_TYPES) and params["inst"] == INST
    assert "transaction_type = 'USAGE_DEDUCTION'" in sql and "transaction_type = 'REFUND'" in sql
    assert "batch_id IN" in sql
    # Only AI-video batches: image / TTS charges of other features share the request types.
    assert "EXISTS (SELECT 1 FROM ai_gen_video v WHERE v.video_id = ct.batch_id)" in sql
    assert svc.month_credits_used(_UsageDB((10.0, 30.0)), INST, now=now) == 0.0


def test_running_now_counts_recent_non_terminal_rows():
    db = _UsageDB((2,))
    now = datetime(2026, 10, 13, 12, 0, tzinfo=timezone.utc)
    assert svc.running_now(db, INST, now=now) == 2
    sql, params = db.calls[0]
    assert "metadata->>'institute_id' = :inst" in sql
    assert params["statuses"] == ["PENDING", "IN_PROGRESS"]
    assert params["since"] == datetime(2026, 10, 13, 6, 0, tzinfo=timezone.utc)
    # A live Standard run sits at COMPLETED/WORDS for its whole HTML stage.
    assert "status = 'COMPLETED' AND current_stage = ANY(:between)" in sql
    assert params["between"] == ["PENDING", "SCRIPT", "TTS", "WORDS"]
    assert params["since_between"] == datetime(2026, 10, 13, 11, 30, tzinfo=timezone.utc)


def test_videos_this_month():
    db = _UsageDB((7,))
    assert svc.videos_this_month(db, INST, now=datetime(2026, 10, 31, 23, 59, tzinfo=timezone.utc)) == 7
    assert db.calls[0][1]["since"] == datetime(2026, 10, 1, tzinfo=timezone.utc)
