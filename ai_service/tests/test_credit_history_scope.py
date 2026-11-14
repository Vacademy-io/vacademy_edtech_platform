"""
security.credit_history_scope on GET /credits/v1/institutes/{id}/transactions.

Default ('institute', no ai_platform_settings row) = today: any member gets the
institute's whole ledger through CreditService.get_transaction_history.
'own_unless_admin' = institute ADMINs and platform staff still get the whole
ledger; any other member gets only rows with user_id = their id, same shape.
"""
import base64
import os
import sys
import types
from datetime import datetime
from decimal import Decimal
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

from app.config import get_settings  # noqa: E402
from app.core import security  # noqa: E402
from app.core.security import get_current_user  # noqa: E402
from app.routers import credits  # noqa: E402
from app.schemas.auth import CustomUserDetails  # noqa: E402
from app.schemas.credits import TransactionHistoryResponse  # noqa: E402
from app.services import platform_settings_service as pss  # noqa: E402

INST_A = "11111111-1111-1111-1111-111111111111"
INST_B = "22222222-2222-2222-2222-222222222222"
URL = f"/credits/v1/institutes/{INST_A}/transactions"
KEY = "security.credit_history_scope"


def _token(authorities, user="user-1"):
    secret = get_settings().jwt_secret_key
    secret += "=" * (-len(secret) % 4)
    claims = {"sub": "alice", "user": user, "is_root_user": True, "authorities": authorities}
    return "Bearer " + jwt.encode(claims, base64.b64decode(secret), algorithm="HS256")


def _headers(roles, user="user-1", inst=INST_A):
    return {"Authorization": _token({inst: {"roles": list(roles)}}, user=user)}


class _Result:
    def __init__(self, scalar=None, rows=()):
        self._scalar, self._rows = scalar, list(rows)

    def scalar(self):
        return self._scalar

    def fetchall(self):
        return self._rows


class FakeDB:
    def __init__(self):
        self.statements = []

    def execute(self, stmt, params=None):
        sql = str(stmt)
        self.statements.append((sql, dict(params or {})))
        if "COUNT(*)" in sql:
            return _Result(scalar=1)
        row = SimpleNamespace(
            id="tx-1", institute_id=INST_A, transaction_type="USAGE_DEDUCTION",
            amount=Decimal("-1.5"), balance_after=Decimal("98.5"), description="d",
            request_type="content", model_name="m", granted_by=None,
            user_id=(params or {}).get("user_id"), user_role="TEACHER",
            subject_user_id=None, created_at=datetime(2026, 10, 1, 12, 0, 0),
        )
        return _Result(rows=[row])


class FakeService:
    def __init__(self):
        self.db = FakeDB()
        self.full_calls = []

    def get_transaction_history(self, institute_id, request):
        self.full_calls.append((institute_id, request.page, request.page_size))
        return TransactionHistoryResponse(transactions=[], total_count=0, page=request.page,
                                          page_size=request.page_size, total_pages=0)


@pytest.fixture
def env(monkeypatch):
    real = get_settings()
    stub = SimpleNamespace(jwt_secret_key=real.jwt_secret_key, jwt_algorithm=real.jwt_algorithm,
                           super_admin_user_ids="staff-id")
    monkeypatch.setattr(security, "get_settings", lambda: stub)
    # Settings cache: never touch a DB; tests set overrides directly.
    monkeypatch.setattr(pss, "_refresh_if_stale", lambda db=None: None)
    monkeypatch.setattr(pss._cache, "values", {})
    svc = FakeService()
    app = FastAPI()
    app.include_router(credits.router)
    app.dependency_overrides[credits.get_credit_service] = lambda: svc
    caller = {"user": CustomUserDetails(username="alice", user_id="user-1")}
    app.dependency_overrides[get_current_user] = lambda: caller["user"]
    return SimpleNamespace(client=TestClient(app), svc=svc, caller=caller)


def _own_queries(svc):
    return [(sql, p) for sql, p in svc.db.statements if "credit_transactions" in sql]


def test_setting_is_registered_with_institute_default():
    spec = pss.SETTING_SPECS[KEY]
    assert spec.type == "enum" and spec.default() == "institute"
    assert set(spec.options) == {"institute", "own_unless_admin"}
    assert pss._coerce(spec, "OWN_UNLESS_ADMIN") == "own_unless_admin"
    with pytest.raises(ValueError):
        pss._coerce(spec, "everyone")


def test_default_scope_is_todays_full_ledger_for_any_member(env):
    for roles in (("STUDENT",), ("TEACHER",), ("ADMIN",)):
        r = env.client.get(URL, params={"page": 2, "page_size": 5}, headers=_headers(roles))
        assert r.status_code == 200
    assert env.svc.full_calls == [(INST_A, 2, 5)] * 3
    assert _own_queries(env.svc) == []


def test_unreadable_setting_falls_back_to_institute(env, monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("settings down")
    monkeypatch.setattr(pss, "get_platform_setting", boom)
    r = env.client.get(URL, headers=_headers(("STUDENT",)))
    assert r.status_code == 200 and len(env.svc.full_calls) == 1


def test_other_institute_is_still_403(env):
    pss._cache.values[KEY] = "own_unless_admin"
    r = env.client.get(URL, headers=_headers(("ADMIN",), inst=INST_B))
    assert r.status_code == 403
    assert env.svc.full_calls == [] and _own_queries(env.svc) == []


def test_own_scope_admin_and_staff_keep_full_ledger(env):
    pss._cache.values[KEY] = "own_unless_admin"
    assert env.client.get(URL, headers=_headers(("ADMIN", "TEACHER"))).status_code == 200
    env.caller["user"] = CustomUserDetails(username="ops", user_id="staff-id")
    assert env.client.get(URL, headers=_headers(("STUDENT",), user="staff-id")).status_code == 200
    assert len(env.svc.full_calls) == 2
    assert _own_queries(env.svc) == []


def test_own_scope_non_admin_gets_only_own_rows_same_shape(env):
    pss._cache.values[KEY] = "own_unless_admin"
    r = env.client.get(URL, params={"page": 3, "page_size": 10}, headers=_headers(("TEACHER",)))
    assert r.status_code == 200
    body = r.json()
    assert set(body) == {"transactions", "total_count", "page", "page_size", "total_pages"}
    assert body["total_count"] == 1 and body["page"] == 3 and body["page_size"] == 10
    assert body["transactions"][0]["user_id"] == "user-1"
    assert env.svc.full_calls == []
    queries = _own_queries(env.svc)
    assert len(queries) == 2
    for sql, params in queries:
        assert "user_id = :user_id" in sql and "institute_id = :institute_id" in sql
        assert params["user_id"] == "user-1" and params["institute_id"] == INST_A
    assert queries[1][1]["offset"] == 20 and queries[1][1]["limit"] == 10


def test_own_scope_uses_the_signed_token_user_not_the_lookup(env):
    pss._cache.values[KEY] = "own_unless_admin"
    env.caller["user"] = CustomUserDetails(username="alice", user_id="someone-else")
    env.client.get(URL, headers=_headers(("STUDENT",), user="user-1"))
    assert all(p["user_id"] == "user-1" for _, p in _own_queries(env.svc))


def test_own_scope_without_a_user_id_matches_nothing(env):
    # No token and an 'unknown' fallback id -> a sentinel that matches no row,
    # never the full ledger.
    pss._cache.values[KEY] = "own_unless_admin"
    out = credits._own_transactions_only(
        CustomUserDetails(username="x", user_id="unknown"), None, INST_A)
    assert out == credits._NO_USER
