"""Site assistant staff gate: built-in staff roles and custom institute roles are
staff (the Tutor Mode rule, tutor.roles.is_staff); learners are not, root or not.
Offline: the pinned principal is faked."""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

import pytest
from fastapi import HTTPException
from starlette.requests import Request

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import app.core.security as security  # noqa: E402
from app.schemas.auth import PinnedPrincipal  # noqa: E402
from app.site_assistant import service as svc  # noqa: E402


def _request() -> Request:
    return Request({
        "type": "http", "method": "GET", "path": "/", "query_string": b"",
        "headers": [(b"authorization", b"Bearer tok"), (b"clientid", b"inst-a")],
    })


def _principal(monkeypatch, roles, *, is_root=True):
    async def fake_resolve(token, client_id, settings):
        return PinnedPrincipal(user_id="u-1", institute_id=client_id, roles=list(roles), is_root_user=is_root)

    monkeypatch.setattr(security, "resolve_pinned_principal", fake_resolve)


@pytest.mark.parametrize("roles", [["ADMIN"], ["TEACHER"], ["Academic Coordinator"]])
def test_staff_roles_and_custom_roles_pass(monkeypatch, roles):
    _principal(monkeypatch, roles)
    staff = asyncio.run(svc.staff_from_request(_request()))
    assert staff.institute_id == "inst-a"


def test_custom_role_is_not_a_site_assistant_admin(monkeypatch):
    _principal(monkeypatch, ["Academic Coordinator"])
    staff = asyncio.run(svc.staff_from_request(_request()))
    assert staff.is_admin is False


@pytest.mark.parametrize("roles", [["STUDENT"], ["STUDENT", "Academic Coordinator"], []])
def test_learners_and_roleless_root_users_are_refused(monkeypatch, roles):
    _principal(monkeypatch, roles)
    with pytest.raises(HTTPException) as exc:
        asyncio.run(svc.staff_from_request(_request()))
    assert exc.value.status_code == 403
