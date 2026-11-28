"""The service-to-service draft routes used by the weekly planning email.

admin_core starts a draft for a teacher who answered the email from a signed link,
with no user JWT. These routes must refuse without the shared secret, must act as
the named teacher (never as an admin unless asked), and must not show one
institute's job to another.
"""
from __future__ import annotations

from types import SimpleNamespace
from typing import Any, Dict

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.db import db_dependency
from app.routers import engagement_plan as router_module
import app.dependencies as deps

SECRET = "s3cret"


@pytest.fixture()
def client(monkeypatch: pytest.MonkeyPatch):
    seen: Dict[str, Any] = {}

    async def fake_start(body, actor, db):
        seen["body"] = body
        seen["actor"] = actor
        return {"task_id": "t1", "status": "PROGRESS"}

    monkeypatch.setattr(router_module, "_start_job", fake_start)
    monkeypatch.setattr(deps, "get_settings", lambda: SimpleNamespace(internal_service_token=SECRET))

    class FakeRepo:
        def __init__(self, db):
            pass

        def get(self, task_id):
            if task_id != "t1":
                return None
            return SimpleNamespace(
                id="t1", task_type=router_module.JOB_TYPE, institute_id="inst-1", status="FAILED",
                status_message="Cancelled by user", dynamic_values_map="{}", result_json=None,
                created_at=None, updated_at=None,
            )

    monkeypatch.setattr(router_module, "AiTaskRepository", FakeRepo)
    app = FastAPI()
    app.include_router(router_module.router)
    app.dependency_overrides[db_dependency] = lambda: object()
    return TestClient(app), seen


BODY = {"institute_id": "inst-1", "topic": "Fractions", "start_date": "2026-11-23", "acting_user_id": "teacher-1"}
PREFIX = router_module.router.prefix


def test_start_refuses_without_the_secret(client):
    c, seen = client
    assert c.post(PREFIX + "/internal/draft/jobs", json=BODY).status_code == 401
    assert c.post(PREFIX + "/internal/draft/jobs", json=BODY,
                  headers={"X-Internal-Service-Token": "wrong"}).status_code in (401, 403)
    assert "actor" not in seen


def test_start_acts_as_the_named_teacher(client):
    c, seen = client
    r = c.post(PREFIX + "/internal/draft/jobs", json={**BODY, "acting_role": "SUPER_ADMIN"},
               headers={"X-Internal-Service-Token": SECRET})
    assert r.status_code == 200, r.text
    assert seen["actor"] == {"user_id": "teacher-1", "institute_id": "inst-1", "roles": ["TEACHER"]}
    assert seen["body"].topic == "Fractions"
    assert not hasattr(seen["body"], "acting_user_id")


def test_start_needs_an_institute(client):
    c, _ = client
    body = {k: v for k, v in BODY.items() if k != "institute_id"}
    r = c.post(PREFIX + "/internal/draft/jobs", json=body, headers={"X-Internal-Service-Token": SECRET})
    assert r.status_code == 400


def test_poll_is_scoped_to_the_institute(client):
    c, _ = client
    h = {"X-Internal-Service-Token": SECRET}
    assert c.get(PREFIX + "/internal/draft/jobs/t1?institute_id=inst-1", headers=h).json()["status"] == "CANCELLED"
    assert c.get(PREFIX + "/internal/draft/jobs/t1?institute_id=inst-2", headers=h).status_code == 404
    assert c.get(PREFIX + "/internal/draft/jobs/t1?institute_id=inst-1").status_code == 401
