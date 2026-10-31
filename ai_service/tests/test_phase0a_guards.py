"""
Phase 0a security guards (docs/AI_EVALUATION_PUBLIC_API.md, gates G2/G3/G5).

No DB, no HTTP: the platform-staff allowlist (super-admin, global credit and
model writes), the per-institute membership check
read from the JWT, the credit-endpoint gate, the BYO-key self check and the
copy-check rubric tenant check.
"""
import base64
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from jose import jwt

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import get_settings  # noqa: E402
from app.core import security  # noqa: E402
from app.repositories.copy_check_rubric_repository import (  # noqa: E402
    CopyCheckRubricRepository,
    RubricInstituteMismatch,
)
from app.routers import ai_models, api_keys, credits, super_admin  # noqa: E402
from app.schemas.auth import CustomUserDetails  # noqa: E402

INST_A = "11111111-1111-1111-1111-111111111111"
INST_B = "22222222-2222-2222-2222-222222222222"


def _token(authorities, user="user-1", username="alice"):
    secret = get_settings().jwt_secret_key
    secret += "=" * (-len(secret) % 4)
    claims = {"sub": username, "username": username, "user": user,
              "is_root_user": True, "authorities": authorities}
    return "Bearer " + jwt.encode(claims, base64.b64decode(secret), algorithm="HS256")


def _user(username="alice", is_root=False, roles=None):
    return CustomUserDetails(username=username, user_id="user-1",
                             is_root_user=is_root, roles=roles or [])


# ── G2: platform-staff allowlist (user ids) ────────────────────────────────

def _allow(monkeypatch, value):
    stub = SimpleNamespace(super_admin_user_ids=value)
    monkeypatch.setattr(security, "get_settings", lambda: stub)
    monkeypatch.setattr(super_admin, "get_settings", lambda: stub)


def test_super_admin_fails_closed_when_unset(monkeypatch):
    for value in (None, "", " , "):
        _allow(monkeypatch, value)
        with pytest.raises(HTTPException) as e:
            super_admin._require_super_admin(_user(is_root=True, roles=["ADMIN"]))
        assert e.value.status_code == 403


def test_super_admin_root_or_admin_role_is_not_enough(monkeypatch):
    _allow(monkeypatch, "staff-id")
    for user in (_user(is_root=True), _user(roles=["ADMIN"]), _user(roles=["ROOT_ADMIN"]), None):
        with pytest.raises(HTTPException):
            super_admin._require_super_admin(user)


def test_super_admin_matches_the_user_id_not_the_username(monkeypatch):
    _allow(monkeypatch, " staff-id , other-id ")
    super_admin._require_super_admin(
        CustomUserDetails(username="anything", user_id="staff-id"))
    # A username equal to (or a case variant of) an allowlisted value is not an id.
    for user in (CustomUserDetails(username="staff-id", user_id="user-9"),
                 CustomUserDetails(username="STAFF-ID", user_id="user-9"),
                 CustomUserDetails(username="x", user_id="STAFF-ID")):
        with pytest.raises(HTTPException):
            super_admin._require_super_admin(user)


def test_global_credit_and_model_writes_use_the_staff_allowlist(monkeypatch):
    _allow(monkeypatch, "staff-id")
    root_admin = _user(is_root=True, roles=["ROOT_ADMIN", "ADMIN"])
    staff = CustomUserDetails(username="s", user_id="staff-id")
    assert ai_models.check_root_admin(root_admin) is False
    assert ai_models.check_root_admin(staff) is True
    monkeypatch.setattr(credits, "_internal_token_matches", lambda t: t == "svc")
    with pytest.raises(HTTPException) as e:
        credits._authorize_credit_adjustment(root_admin, None, None, "grant")
    assert e.value.status_code == 403
    assert credits._authorize_credit_adjustment(staff, None, "ignored", "grant") == "staff-id"
    # admin_core's internal-token path is unchanged.
    assert credits._authorize_credit_adjustment(None, "svc", "actor-1", "grant") == "actor-1"


# ── G1 prep: JWT secret warning ─────────────────────────────────────────────

def test_jwt_secret_warnings(monkeypatch, caplog):
    from app import config
    monkeypatch.delenv("JWT_SECRET_KEY", raising=False)
    with caplog.at_level("WARNING"):
        config.get_settings.__wrapped__()
    assert "JWT_SECRET_KEY is not set" in caplog.text
    caplog.clear()
    monkeypatch.setenv("JWT_SECRET_KEY", config._LEGACY_JWT_SECRET_FALLBACK)
    with caplog.at_level("WARNING"):
        config.get_settings.__wrapped__()
    assert "is not set" not in caplog.text and "rotate" in caplog.text


# ── G3: institute membership from the JWT ───────────────────────────────────

def test_membership_reads_only_that_institutes_roles():
    auth = _token({INST_A: {"roles": ["ADMIN"], "permissions": []},
                   INST_B: {"roles": ["STUDENT"], "permissions": []}})
    security.require_institute_member(auth, INST_A, admin=True)
    security.require_institute_member(auth, INST_B)
    with pytest.raises(HTTPException) as e:
        security.require_institute_member(auth, INST_B, admin=True)
    assert e.value.status_code == 403


def test_membership_has_no_root_bypass_and_rejects_bad_tokens():
    root_elsewhere = _token({INST_B: {"roles": ["ADMIN"]}})  # is_root_user=True in claims
    for auth in (root_elsewhere, None, "Bearer not-a-jwt", "Basic abc"):
        with pytest.raises(HTTPException) as e:
            security.require_institute_member(auth, INST_A)
        assert e.value.status_code == 403


def test_credit_gate_internal_token_skips_membership(monkeypatch):
    monkeypatch.setattr(credits, "_internal_token_matches", lambda t: t == "svc")
    credits._require_user_or_internal(None, "svc", INST_A, None)


def test_credit_gate_requires_user_then_membership(monkeypatch):
    monkeypatch.setattr(credits, "_internal_token_matches", lambda t: False)
    with pytest.raises(HTTPException) as e:
        credits._require_user_or_internal(None, None, INST_A, None)
    assert e.value.status_code == 401
    auth = _token({INST_A: {"roles": ["TEACHER"]}})
    credits._require_user_or_internal(_user(), None, INST_A, auth)
    credits._require_user_or_internal(_user(), None, None, auth)  # no institute named
    with pytest.raises(HTTPException) as e:
        credits._require_user_or_internal(_user(), None, INST_B, auth)
    assert e.value.status_code == 403


def test_user_keys_only_for_the_tokens_own_user():
    auth = _token({}, user="user-1")
    api_keys._require_self(auth, "user-1")
    with pytest.raises(HTTPException) as e:
        api_keys._require_self(auth, "user-2")
    assert e.value.status_code == 403
    with pytest.raises(HTTPException) as e:
        api_keys._require_self(None, "user-1")
    assert e.value.status_code == 401


# ── G5 (tenant part): rubric store ──────────────────────────────────────────

class _FakeDb:
    def __init__(self, row):
        self.row, self.committed = row, False

    def query(self, _model):
        return self

    def filter_by(self, **_kw):
        return self

    def with_for_update(self):
        return self

    def first(self):
        return self.row

    def rollback(self):
        pass

    def add(self, row):
        self.row = row

    def commit(self):
        self.committed = True

    def refresh(self, _row):
        pass


def _row(institute_id):
    return SimpleNamespace(assessment_id="asmt-1", institute_id=institute_id,
                           rubric_version=1, rubric_json="{}", model_answers_json="{}")


def test_rubric_upsert_refuses_another_institutes_row():
    db = _FakeDb(_row(INST_A))
    with pytest.raises(RubricInstituteMismatch):
        CopyCheckRubricRepository(db).upsert("asmt-1", INST_B, {"q1": {}})
    assert db.committed is False and db.row.rubric_version == 1


def test_rubric_upsert_same_institute_still_full_replaces():
    db = _FakeDb(_row(INST_A))
    row = CopyCheckRubricRepository(db).upsert("asmt-1", INST_A, {"q1": {"x": 1}})
    assert row.rubric_version == 2 and row.rubric_json == '{"q1": {"x": 1}}'


def test_rubric_merge_refuses_another_institutes_row():
    db = _FakeDb(_row(INST_A))
    with pytest.raises(RubricInstituteMismatch):
        CopyCheckRubricRepository(db).merge_generated_rubrics("asmt-1", INST_B, {"q1": {}})
    assert db.committed is False


# ── Retired /evaluator-ai free tool: its anonymous routes are gone ──────────

def test_free_evaluator_routes_are_not_mounted():
    import importlib.util

    import app as app_pkg

    assert importlib.util.find_spec("app.routers.evaluation") is None
    factory = (Path(app_pkg.__file__).parent / "app_factory.py").read_text()
    assert "routers.evaluation " not in factory
    assert "evaluation_router" not in factory
    # The same paths must not come back under another router file either.
    routers_dir = Path(app_pkg.__file__).parent / "routers"
    for path in routers_dir.glob("*.py"):
        assert "/ai/evaluation-tool" not in path.read_text(), path.name


def test_task_status_refuses_retired_evaluation_rows():
    from app.routers import ai_task_status

    class _Db:
        def __init__(self, row):
            self.row = row

        def get(self, _model, _task_id):
            return self.row

    with pytest.raises(HTTPException) as exc:
        ai_task_status._get_task_or_404(_Db(SimpleNamespace(task_type="EVALUATION")), "t-1")
    assert exc.value.status_code == 404

    lecture = SimpleNamespace(task_type="LECTURE_PLANNER")
    assert ai_task_status._get_task_or_404(_Db(lecture), "t-2") is lecture
    with pytest.raises(HTTPException):
        ai_task_status._get_task_or_404(_Db(None), "t-3")
