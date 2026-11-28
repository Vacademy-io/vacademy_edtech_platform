"""Tutor Mode staff gate: roles only, never is_root_user.

Most production users carry is_root_user=true, learners included, so a root
shortcut let learners compile teaching plans (spending institute credits) and
read quiz answer keys. Staff now means a staff role in the clientId
institute's JWT authorities entry; learner routes keep working for enrolled
learners.

No DB, no network: the real pinning path (security.resolve_pinned_principal)
runs on a stubbed token verification + JWT decode, and the routers' data
helpers are stubbed, so the HTTP contract is exercised end to end.
"""
from __future__ import annotations

import os
import sys
import types
from types import SimpleNamespace

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

try:  # the routers import s3_service → boto3; stub it where it isn't installed
    import boto3  # noqa: F401
except ImportError:  # pragma: no cover - depends on the test venv
    for _name in ("boto3", "botocore", "botocore.exceptions", "botocore.config"):
        sys.modules.setdefault(_name, types.ModuleType(_name))
    sys.modules["botocore.exceptions"].ClientError = Exception
    sys.modules["botocore.exceptions"].NoCredentialsError = Exception
    sys.modules["botocore.config"].Config = object

from fastapi import FastAPI
from fastapi.testclient import TestClient

import app.core.security as security
from app.db import db_dependency
from app.routers import tutor as tutor_router
from app.routers import tutor_ws
from app.schemas.auth import CustomUserDetails
from app.services.tutor.roles import is_staff

INST = "inst-a"
OTHER_INST = "inst-b"
USER = "user-1"
SLIDE = "slide-1"
PKG = "pkg-1"
BATCH = "ps-1"
CHAPTER = "ch-1"

# What a teaching-plan preview exposes: the quiz answer key.
PLAN_WITH_KEY = {"slide_id": SLIDE, "quiz": [{"question": "2+2?", "answer": "4"}]}


@pytest.fixture()
def env(monkeypatch):
    state = SimpleNamespace(
        is_root=False,
        authorities={INST: {"roles": ["STUDENT"], "permissions": []}},
        enrolled=set(),
        compiler_built=[],
    )

    async def fake_verify(auth_header, client_id, settings):
        return CustomUserDetails(username="u", user_id=USER, is_root_user=state.is_root)

    def fake_decode(token, settings):
        return {"user": USER, "authorities": state.authorities}

    monkeypatch.setattr(security, "_verify_and_fetch_user", fake_verify)
    monkeypatch.setattr(security, "_decode_jwt_token", fake_decode)

    # tutor.py collaborators: every slide / package belongs to INST.
    monkeypatch.setattr(tutor_router, "slide_belongs_to_institute", lambda db, sid, inst: inst == INST)
    monkeypatch.setattr(tutor_router, "package_belongs_to_institute", lambda db, pid, inst: inst == INST)
    monkeypatch.setattr(tutor_router, "list_package_slides", lambda db, pid: [{"slide_id": SLIDE, "source_type": "QUIZ"}])
    monkeypatch.setattr(tutor_router, "_preflight", lambda *a, **k: None)

    def fake_compiler(db, caller, package_id, payload, *, force):
        state.compiler_built.append(caller.user_id)
        return SimpleNamespace()
    monkeypatch.setattr(tutor_router, "_compiler", fake_compiler)
    monkeypatch.setattr(tutor_router, "_sse", lambda compiler, slide_ids: {"compiled": slide_ids})
    monkeypatch.setattr(tutor_router.plan_store, "latest_ready_plan", lambda db, sid: dict(PLAN_WITH_KEY))
    monkeypatch.setattr(tutor_router.plan_store, "latest_plan", lambda db, sid: dict(PLAN_WITH_KEY))
    monkeypatch.setattr(tutor_router.plan_store, "plan_view", lambda db, plan: plan)

    # tutor_ws.py collaborators (learner REST).
    monkeypatch.setattr(tutor_ws.svc, "learner_is_enrolled",
                        lambda db, *, user_id, package_session_id, institute_id:
                        (user_id, package_session_id, institute_id) in state.enrolled)
    monkeypatch.setattr(tutor_ws.svc, "chapter_slides",
                        lambda db, *, package_session_id, chapter_id: [{"slide_id": SLIDE}])
    monkeypatch.setattr(tutor_ws.svc, "package_of_session", lambda db, ps: (PKG,) if ps == BATCH else None)
    monkeypatch.setattr(tutor_ws, "package_belongs_to_institute", lambda db, pid, inst: inst == INST)

    app = FastAPI()
    app.include_router(tutor_router.router)
    app.include_router(tutor_ws.router)
    app.dependency_overrides[db_dependency] = lambda: object()
    with TestClient(app) as client:
        state.client = client
        yield state


def _headers(institute: str = INST):
    return {"Authorization": "Bearer t", "clientId": institute}


def _compile(env, institute: str = INST):
    return env.client.post("/tutor/v1/compile", json={"package_id": PKG, "slide_ids": [SLIDE]},
                           headers=_headers(institute))


def _plan(env, institute: str = INST):
    return env.client.get(f"/tutor/v1/slides/{SLIDE}/plan", headers=_headers(institute))


def _learner_slides(env, institute: str = INST):
    return env.client.get(f"/tutor/v1/learner/chapters/{CHAPTER}/slides",
                          params={"package_session_id": BATCH}, headers=_headers(institute))


# ── the helper itself ────────────────────────────────────────────────────────

def test_is_root_never_grants_staff():
    assert not is_staff([], is_root=True)
    assert not is_staff(["STUDENT"], is_root=True)
    assert not is_staff(["LEARNER"], is_root=True)
    assert is_staff(["TEACHER"], is_root=False)
    assert is_staff(["ADMIN_NON_ROOT"])


# ── (1) root learner is refused on staff routes ──────────────────────────────

@pytest.mark.parametrize("roles", [["STUDENT"], ["LEARNER"], []])
def test_root_learner_cannot_compile(env, roles):
    env.is_root = True
    env.authorities = {INST: {"roles": roles, "permissions": []}}
    r = _compile(env)
    assert r.status_code == 403
    assert not env.compiler_built


@pytest.mark.parametrize("roles", [["STUDENT"], ["LEARNER"]])
def test_root_learner_cannot_read_answer_keys(env, roles):
    env.is_root = True
    env.authorities = {INST: {"roles": roles, "permissions": []}}
    r = _plan(env)
    assert r.status_code == 403
    assert "answer" not in r.text


def test_root_learner_refused_on_other_staff_routes(env):
    env.is_root = True
    env.authorities = {INST: {"roles": ["STUDENT"], "permissions": []}}
    for r in (
        env.client.post("/tutor/v1/compile/estimate", json={"package_id": PKG, "slide_ids": [SLIDE]},
                        headers=_headers()),
        env.client.post(f"/tutor/v1/slides/{SLIDE}/recompile", json={}, headers=_headers()),
        env.client.get(f"/tutor/v1/packages/{PKG}/plans", headers=_headers()),
        env.client.get(f"/tutor/v1/slides/{SLIDE}/plan", params={"latest": "true"}, headers=_headers()),
        env.client.get("/tutor/v1/insights", headers=_headers()),
    ):
        assert r.status_code == 403, r.request.url


def test_root_user_without_institute_roles_is_not_staff(env):
    # A root user with no authorities entry for the institute passes the pin
    # with roles=[]; that alone must not reach staff routes.
    env.is_root = True
    env.authorities = {OTHER_INST: {"roles": ["ADMIN"], "permissions": []}}
    assert _compile(env).status_code == 403
    assert _plan(env).status_code == 403


# ── (2) staff of the institute pass ──────────────────────────────────────────

@pytest.mark.parametrize("roles", [["ADMIN"], ["TEACHER"], ["CONTENT CREATOR"], ["STUDENT", "COURSE_CREATOR"]])
@pytest.mark.parametrize("is_root", [False, True])
def test_institute_staff_pass(env, roles, is_root):
    env.is_root = is_root
    env.authorities = {INST: {"roles": roles, "permissions": []}}
    r = _compile(env)
    assert r.status_code == 200
    assert r.json() == {"compiled": [SLIDE]}
    assert env.compiler_built == [USER]
    r = _plan(env)
    assert r.status_code == 200
    assert r.json()["quiz"][0]["answer"] == "4"


# ── (3) staff of a DIFFERENT institute are refused ───────────────────────────

def test_admin_of_other_institute_rejected_non_root(env):
    env.authorities = {OTHER_INST: {"roles": ["ADMIN"], "permissions": []}}
    assert _compile(env, INST).status_code == 403     # not a member of INST at all
    assert _plan(env, INST).status_code == 403
    assert not env.compiler_built


def test_admin_of_other_institute_learner_here_rejected(env):
    # ADMIN in B, only a learner in A, calling with clientId=A.
    env.is_root = True
    env.authorities = {OTHER_INST: {"roles": ["ADMIN"], "permissions": []},
                       INST: {"roles": ["STUDENT"], "permissions": []}}
    assert _compile(env, INST).status_code == 403
    assert _plan(env, INST).status_code == 403
    assert not env.compiler_built


# ── (4) learner live-session routes still accept enrolled learners ───────────

@pytest.mark.parametrize("is_root", [False, True])
def test_enrolled_learner_keeps_learner_routes(env, is_root):
    env.is_root = is_root
    env.authorities = {INST: {"roles": ["STUDENT"], "permissions": []}}
    env.enrolled.add((USER, BATCH, INST))
    r = _learner_slides(env)
    assert r.status_code == 200
    assert r.json()["slides"] == [{"slide_id": SLIDE}]


def test_unenrolled_root_learner_no_longer_skips_enrolment(env):
    # Before the fix a root learner was "staff" here and skipped the enrolment check.
    env.is_root = True
    env.authorities = {INST: {"roles": ["STUDENT"], "permissions": []}}
    assert _learner_slides(env).status_code == 403


def test_staff_still_preview_learner_routes_without_enrolment(env):
    env.authorities = {INST: {"roles": ["TEACHER"], "permissions": []}}
    assert _learner_slides(env).status_code == 200


# ── (5) custom institute roles are staff (admin_core requireStaffAuthorities) ─

def test_custom_role_helper_rules():
    assert is_staff(["ACADEMIC COORDINATOR"], is_root=True)
    assert is_staff(["Academic Coordinator"])
    assert is_staff(["HR_MANAGER"])
    # a learner-side role beats a custom role; a known staff role beats both
    assert not is_staff(["STUDENT", "ACADEMIC COORDINATOR"], is_root=True)
    assert not is_staff(["PARENT", "ACADEMIC COORDINATOR"])
    assert not is_staff(["GUARDIAN"])
    assert is_staff(["STUDENT", "TEACHER"])


@pytest.mark.parametrize("is_root", [False, True])
def test_root_custom_role_staff_pass(env, is_root):
    env.is_root = is_root
    env.authorities = {INST: {"roles": ["ACADEMIC COORDINATOR"], "permissions": []}}
    assert _compile(env).status_code == 200
    assert env.compiler_built == [USER]
    assert _plan(env).status_code == 200
    # staff preview of a learner route needs no enrolment
    assert _learner_slides(env).status_code == 200


def test_learner_with_stray_custom_role_still_refused(env):
    env.is_root = True
    env.authorities = {INST: {"roles": ["STUDENT", "ACADEMIC COORDINATOR"], "permissions": []}}
    assert _compile(env).status_code == 403
    assert _plan(env).status_code == 403
    assert _learner_slides(env).status_code == 403   # not enrolled, not staff
    assert not env.compiler_built


def test_custom_role_of_other_institute_rejected(env):
    env.is_root = True
    env.authorities = {OTHER_INST: {"roles": ["ACADEMIC COORDINATOR"], "permissions": []},
                       INST: {"roles": ["STUDENT"], "permissions": []}}
    assert _compile(env, INST).status_code == 403
    assert not env.compiler_built
