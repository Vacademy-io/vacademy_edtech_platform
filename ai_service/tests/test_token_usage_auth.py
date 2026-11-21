"""
/token-usage/** auth: every read needs a signed bearer token and is scoped to
the caller's institute (/v1/institute/...) or the caller themself (/v1/user/...);
platform staff keep access; POST /v1/record needs X-Internal-Service-Token.

No DB: TokenUsageService is replaced by a fake, real HS256 tokens are minted
with the configured secret, and the settings the guards read are stubbed.
"""
import base64
import os
import sys
import types
from types import SimpleNamespace

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

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from jose import jwt  # noqa: E402

from app import dependencies  # noqa: E402
from app.config import get_settings  # noqa: E402
from app.core import security  # noqa: E402
from app.db import db_dependency  # noqa: E402
from app.routers import token_usage  # noqa: E402

INST_A = "11111111-1111-1111-1111-111111111111"
INST_B = "22222222-2222-2222-2222-222222222222"
USER_1 = "user-1"
STAFF = "staff-id"
SVC = "svc-secret"

INSTITUTE_ROUTES = [
    f"/token-usage/v1/institute/{INST_A}",
    f"/token-usage/v1/institute/{INST_A}/summary",
    f"/token-usage/v1/institute/{INST_A}/daily",
    f"/token-usage/v1/institute/{INST_A}/activity-log",
    f"/token-usage/v1/institute/{INST_A}/activity-log/by-user",
]
USER_ROUTES = [
    f"/token-usage/v1/user/{USER_1}",
    f"/token-usage/v1/user/{USER_1}/summary",
    f"/token-usage/v1/user/{USER_1}/daily",
]
RECORD = "/token-usage/v1/record"
RECORD_BODY = {"api_provider": "openai", "request_type": "content", "prompt_tokens": 3,
               "completion_tokens": 4, "institute_id": INST_A}

_SUMMARY = {"total_prompt_tokens": 0, "total_completion_tokens": 0, "total_tokens": 0,
            "request_count": 0, "by_provider": None, "by_type": None}


class FakeService:
    calls = []

    def __init__(self, db):
        pass

    def get_institute_usage(self, *a, **k):
        return []

    def get_user_usage(self, *a, **k):
        return []

    def get_usage_summary(self, **k):
        return dict(_SUMMARY)

    def get_daily_usage(self, **k):
        return []

    def get_institute_activity_log(self, **k):
        return [], 0

    def get_institute_activity_log_by_user(self, **k):
        return [], 0

    def record_usage_and_deduct_credits(self, **k):
        FakeService.calls.append(k)
        return SimpleNamespace(id="rec-1")


def _token(authorities, user=USER_1, username="alice"):
    secret = get_settings().jwt_secret_key
    secret += "=" * (-len(secret) % 4)
    claims = {"sub": username, "username": username, "user": user,
              "is_root_user": True, "authorities": authorities}
    return "Bearer " + jwt.encode(claims, base64.b64decode(secret), algorithm="HS256")


def _member_of(inst, roles=("STUDENT",), user=USER_1):
    return {"Authorization": _token({inst: {"roles": list(roles), "permissions": []}}, user=user)}


@pytest.fixture
def client(monkeypatch):
    real = get_settings()
    stub = SimpleNamespace(jwt_secret_key=real.jwt_secret_key, jwt_algorithm=real.jwt_algorithm,
                           super_admin_user_ids=STAFF, internal_service_token=SVC)
    monkeypatch.setattr(security, "get_settings", lambda: stub)
    monkeypatch.setattr(dependencies, "get_settings", lambda: stub)
    monkeypatch.setattr(token_usage, "TokenUsageService", FakeService)
    monkeypatch.setattr(token_usage, "_admins_only", lambda: False)  # default scope 'institute'
    FakeService.calls = []
    app = FastAPI()
    app.include_router(token_usage.router)
    app.dependency_overrides[db_dependency] = lambda: None
    return TestClient(app)


# ── no / bad token ──────────────────────────────────────────────────────────

@pytest.mark.parametrize("path", INSTITUTE_ROUTES + USER_ROUTES)
def test_every_read_rejects_missing_or_bad_tokens(client, path):
    for headers in ({}, {"Authorization": "Bearer not-a-jwt"}, {"Authorization": "Basic abc"}):
        r = client.get(path, headers=headers)
        assert r.status_code == 401, (path, headers, r.status_code)


def test_record_without_internal_token_is_rejected(client):
    assert client.post(RECORD, json=RECORD_BODY).status_code == 401
    assert client.post(RECORD, json=RECORD_BODY,
                       headers={"X-Internal-Service-Token": "wrong"}).status_code == 401
    # A user JWT is not enough either.
    assert client.post(RECORD, json=RECORD_BODY, headers=_member_of(INST_A, ("ADMIN",))).status_code == 401
    assert FakeService.calls == []


def test_record_fails_closed_when_server_token_unset(client, monkeypatch):
    monkeypatch.setattr(dependencies, "get_settings", lambda: SimpleNamespace(internal_service_token=None))
    r = client.post(RECORD, json=RECORD_BODY, headers={"X-Internal-Service-Token": SVC})
    assert r.status_code == 503
    assert FakeService.calls == []


def test_record_with_internal_token_reaches_the_service(client):
    r = client.post(RECORD, json=RECORD_BODY, headers={"X-Internal-Service-Token": SVC})
    assert r.status_code == 200
    assert r.json() == {"success": True, "message": "Token usage recorded successfully", "record_id": "rec-1"}
    assert len(FakeService.calls) == 1
    call = FakeService.calls[0]
    assert call["institute_id"] == INST_A and call["total_tokens"] == 7


# ── institute routes ────────────────────────────────────────────────────────

@pytest.mark.parametrize("path", INSTITUTE_ROUTES)
def test_institute_routes_reject_other_institute(client, path):
    r = client.get(path, headers=_member_of(INST_B, ("ADMIN",)))
    assert r.status_code == 403


@pytest.mark.parametrize("path", INSTITUTE_ROUTES)
def test_institute_routes_allow_any_member(client, path):
    for roles in (("ADMIN",), ("TEACHER",), ("STUDENT",)):
        r = client.get(path, headers=_member_of(INST_A, roles))
        assert r.status_code == 200, (path, roles, r.text)


@pytest.mark.parametrize("path", INSTITUTE_ROUTES)
def test_own_unless_admin_keeps_institute_wide_usage_for_admins(client, monkeypatch, path):
    monkeypatch.setattr(token_usage, "_admins_only", lambda: True)
    for roles in (("TEACHER",), ("STUDENT",)):
        r = client.get(path, headers=_member_of(INST_A, roles))
        assert r.status_code == 403, (path, roles)
    assert client.get(path, headers=_member_of(INST_A, ("ADMIN",))).status_code == 200
    assert client.get(path, headers=_member_of(INST_B, user=STAFF)).status_code == 200


def test_own_unless_admin_leaves_self_routes_alone(client, monkeypatch):
    monkeypatch.setattr(token_usage, "_admins_only", lambda: True)
    for path in USER_ROUTES:
        assert client.get(path, headers=_member_of(INST_A, ("STUDENT",))).status_code == 200


@pytest.mark.parametrize("raw,expected", [("own_unless_admin", True), ("institute", False), (None, False)])
def test_admins_only_reads_the_credit_history_scope(monkeypatch, raw, expected):
    from app.services import platform_settings_service as pss

    monkeypatch.setattr(pss, "get_platform_setting", lambda key, default=None, db=None: raw)
    assert token_usage._admins_only() is expected


def test_admins_only_read_error_keeps_todays_rule(monkeypatch):
    from app.services import platform_settings_service as pss

    def boom(*a, **k):
        raise RuntimeError("db down")

    monkeypatch.setattr(pss, "get_platform_setting", boom)
    assert token_usage._admins_only() is False


@pytest.mark.parametrize("path", INSTITUTE_ROUTES)
def test_institute_routes_allow_platform_staff_from_any_institute(client, path):
    r = client.get(path, headers=_member_of(INST_B, user=STAFF))
    assert r.status_code == 200


def test_activity_log_response_shape_unchanged(client):
    r = client.get(INSTITUTE_ROUTES[3], params={"page": 2, "page_size": 10},
                   headers=_member_of(INST_A, ("ADMIN",)))
    assert r.status_code == 200
    assert r.json() == {"records": [], "page": 2, "page_size": 10, "total_count": 0, "total_pages": 0}


def test_validation_errors_still_400_for_authorised_callers(client):
    r = client.get(INSTITUTE_ROUTES[0], params={"start_date": "bad"}, headers=_member_of(INST_A))
    assert r.status_code == 400


# ── user routes ─────────────────────────────────────────────────────────────

@pytest.mark.parametrize("path", USER_ROUTES)
def test_user_routes_allow_self_without_client_id_header(client, path):
    # The learner app sends only Authorization (no clientId header).
    r = client.get(path, headers=_member_of(INST_A))
    assert r.status_code == 200, r.text


@pytest.mark.parametrize("path", USER_ROUTES)
def test_user_routes_reject_someone_else(client, path):
    r = client.get(path, headers=_member_of(INST_A, ("ADMIN",), user="user-2"))
    assert r.status_code == 403


@pytest.mark.parametrize("path", USER_ROUTES)
def test_user_routes_allow_platform_staff(client, path):
    r = client.get(path, headers=_member_of(INST_B, user=STAFF))
    assert r.status_code == 200


def test_token_without_user_claim_cannot_read_any_user(client):
    secret = get_settings().jwt_secret_key
    secret += "=" * (-len(secret) % 4)
    tok = jwt.encode({"sub": "alice", "authorities": {}}, base64.b64decode(secret), algorithm="HS256")
    r = client.get(USER_ROUTES[0], headers={"Authorization": f"Bearer {tok}"})
    assert r.status_code == 403
