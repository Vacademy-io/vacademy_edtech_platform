"""Staff router for the caption service: platform staff only (SUPER_ADMIN_USER_IDS),
never root users or institute admins; the probe takes at most 10 ids.
No DB, no network: the service calls are stubbed."""
from __future__ import annotations

import sys
import types
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

try:  # routers import s3_service -> boto3; stub it where it isn't installed
    import boto3  # noqa: F401
except ImportError:  # pragma: no cover
    for _name in ("boto3", "botocore", "botocore.exceptions", "botocore.config"):
        sys.modules.setdefault(_name, types.ModuleType(_name))
    sys.modules["botocore.exceptions"].ClientError = Exception
    sys.modules["botocore.exceptions"].NoCredentialsError = Exception
    sys.modules["botocore.config"].Config = object

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.config import get_settings  # noqa: E402
from app.core.security import get_current_user  # noqa: E402
from app.routers import youtube_captions_admin as router_mod  # noqa: E402
from app.schemas.auth import CustomUserDetails  # noqa: E402
from app.services.course_knowledge import caption_requeue  # noqa: E402
from app.services.youtube_captions import service as yt_service  # noqa: E402
from app.services.youtube_captions.service import Config  # noqa: E402

STAFF = "staff-user-1"
BASE = "/super-admin/v1/youtube-captions"


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(get_settings(), "super_admin_user_ids", STAFF)
    state = {"user": CustomUserDetails(username="s", user_id=STAFF, is_root_user=False), "probe": []}
    app = FastAPI()
    app.include_router(router_mod.router)
    app.dependency_overrides[get_current_user] = lambda: state["user"]

    async def fake_probe(ids, routes, language=None, **kw):
        state["probe"].append((list(ids), list(routes), language))
        return [{"video_id": i, "route": r, "outcome": "OK"} for i in ids for r in routes]

    monkeypatch.setattr(yt_service, "probe", fake_probe)
    monkeypatch.setattr(yt_service, "health_snapshot", lambda include_db=False: {"pod": "p", "proxy_configured": True})
    monkeypatch.setattr(yt_service, "load_config", lambda: Config(canary_video_ids=("aaaaaaaaaaa", "bbbbbbbbbbb")))
    monkeypatch.setattr(caption_requeue, "run_on_demand",
                        lambda **kw: {"dry_run": kw["dry_run"], "selected": 2, "queued": 0, "limit": kw["limit"]})
    return TestClient(app), state


@pytest.mark.parametrize("user", [
    CustomUserDetails(username="root", user_id="u-root", is_root_user=True),
    CustomUserDetails(username="admin", user_id="u-admin", is_root_user=False, roles=["ADMIN"]),
    None,
])
def test_non_staff_get_403_everywhere(client, user):
    c, state = client
    state["user"] = user
    assert c.get(f"{BASE}/health").status_code == 403
    assert c.post(f"{BASE}/probe", json={"video_ids": ["aaaaaaaaaaa"]}).status_code == 403
    assert c.post(f"{BASE}/requeue", json={"dry_run": True}).status_code == 403
    assert state["probe"] == []


def test_staff_health(client):
    c, _ = client
    r = c.get(f"{BASE}/health")
    assert r.status_code == 200 and r.json() == {"pod": "p", "proxy_configured": True}


def test_probe_defaults_to_canary_and_caps_ids(client):
    c, state = client
    r = c.post(f"{BASE}/probe", json={})
    assert r.status_code == 200 and state["probe"][-1][0] == ["aaaaaaaaaaa", "bbbbbbbbbbb"]
    assert state["probe"][-1][1] == ["direct", "proxy", "supadata"]
    r = c.post(f"{BASE}/probe", json={"video_ids": [f"id{i:09d}" for i in range(11)]})
    assert r.status_code == 422
    r = c.post(f"{BASE}/probe", json={"video_ids": [f"id{i:09d}" for i in range(10)], "routes": ["proxy"],
                                      "language": "hi"})
    assert r.status_code == 200 and len(r.json()["results"]) == 10 and state["probe"][-1][2] == "hi"
    assert c.post(f"{BASE}/probe", json={"routes": ["bogus"]}).status_code == 422


def test_requeue_defaults_to_dry_run_and_bounds_limit(client):
    c, _ = client
    r = c.post(f"{BASE}/requeue", json={})
    assert r.status_code == 200 and r.json()["dry_run"] is True and r.json()["limit"] == 300
    assert c.post(f"{BASE}/requeue", json={"limit": 2001}).status_code == 422
    assert c.post(f"{BASE}/requeue", json={"limit": 2000, "dry_run": False}).json()["dry_run"] is False
