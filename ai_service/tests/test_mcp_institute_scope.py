"""
Institute-scoped MCP server URLs (white-label).

The URL an admin pastes carries their institute; from it the server derives
where to send the browser for consent (the institute's own portal), which
institute a token is good for, and where the RFC 9728 document lives.
"""
import sys
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest  # noqa: E402

from app.mcp.institute_scope import (  # noqa: E402
    McpInstitutePathAdapter,
    admin_portal_base,
    institute_from_path_suffix,
    institute_from_resource,
    request_institute_id,
    scoped_server_url,
)

ISSUER = "https://backend.example.com/ai-service/mcp"
INST = "5325143a-df5a-4717-8381-d8b4820ec9bc"


# ── URL parsing ──────────────────────────────────────────────────────────
def test_scoped_url_round_trips():
    url = scoped_server_url(ISSUER, INST)
    assert url == f"{ISSUER}/i/{INST}"
    assert institute_from_resource(url, ISSUER) == INST
    assert institute_from_resource(url + "/", ISSUER) == INST
    assert institute_from_resource(url.replace("backend.example.com", "BACKEND.EXAMPLE.COM"), ISSUER) == INST


@pytest.mark.parametrize("resource", [
    None, "", ISSUER, ISSUER + "/",                      # bare endpoint → not scoped
    "https://other.example.com/ai-service/mcp/i/" + INST,  # someone else's host
    ISSUER + "/i/",                                      # empty id
    ISSUER + "/i/../etc",                                # junk
    ISSUER + "/x/" + INST,                               # wrong segment
])
def test_non_scoped_resources_yield_none(resource):
    assert institute_from_resource(resource, ISSUER) is None


def test_path_suffix_accepts_trailing_segments_and_rejects_junk():
    assert institute_from_path_suffix(f"/i/{INST}") == INST
    assert institute_from_path_suffix(f"/i/{INST}/") == INST
    assert institute_from_path_suffix("/i/abc") is None            # too short
    assert institute_from_path_suffix("/i/has space") is None
    assert institute_from_path_suffix("/other") is None


# ── portal lookup ────────────────────────────────────────────────────────
class _Db:
    def __init__(self, column=None, routing=()):
        self.column, self.routing = column, routing

    def execute(self, stmt, params=None):
        sql = str(stmt)
        if "admin_portal_base_url" in sql:
            return SimpleNamespace(first=lambda: (self.column,))
        if "institute_domain_routing" in sql:
            return SimpleNamespace(fetchall=lambda: list(self.routing))
        raise AssertionError(sql)


def test_admin_portal_prefers_the_column_then_routing_then_default():
    assert admin_portal_base(_Db(column="admin.shikshanation.com"), INST, "https://dash.vacademy.io") == "https://admin.shikshanation.com"
    assert admin_portal_base(_Db(column="https://admin.edzumo.com/"), INST, "https://dash.vacademy.io") == "https://admin.edzumo.com"
    assert admin_portal_base(_Db(routing=[("shikshanation.com", "admin")]), INST, "https://dash.vacademy.io") == "https://admin.shikshanation.com"
    assert admin_portal_base(_Db(routing=[("edzumo.com", "*")]), INST, "https://dash.vacademy.io") == "https://edzumo.com"
    assert admin_portal_base(_Db(), INST, "https://dash.vacademy.io/") == "https://dash.vacademy.io"
    assert admin_portal_base(None, INST, "https://dash.vacademy.io") == "https://dash.vacademy.io"


def test_admin_portal_lookup_failure_degrades_to_default():
    class _Broken:
        def execute(self, *a, **k):
            raise RuntimeError("db down")
    assert admin_portal_base(_Broken(), INST, "https://dash.vacademy.io") == "https://dash.vacademy.io"


# ── ASGI adapter ─────────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_adapter_pins_institute_rewrites_path_and_401_challenge():
    seen = {}

    async def inner(scope, receive, send):
        seen["path"] = scope["path"]
        seen["institute"] = request_institute_id.get()
        await send({"type": "http.response.start", "status": 401, "headers": [
            (b"www-authenticate", b'Bearer error="invalid_token", resource_metadata="https://backend.example.com/.well-known/oauth-protected-resource/ai-service/mcp"'),
        ]})
        await send({"type": "http.response.body", "body": b""})

    sent = []
    adapter = McpInstitutePathAdapter(inner, ISSUER)
    await adapter({"type": "http", "path": f"/ai-service/mcp/i/{INST}", "path_params": {"institute_id": INST}},
                  None, lambda m: sent.append(m) or _done())
    assert seen == {"path": "/", "institute": INST}
    www = dict(sent[0]["headers"])[b"www-authenticate"].decode()
    assert f'resource_metadata="https://backend.example.com/.well-known/oauth-protected-resource/ai-service/mcp/i/{INST}"' in www
    assert request_institute_id.get() is None        # reset after the request


@pytest.mark.asyncio
async def test_adapter_refuses_a_malformed_institute():
    async def inner(scope, receive, send):
        raise AssertionError("must not be called")
    sent = []
    await McpInstitutePathAdapter(inner, ISSUER)({"type": "http", "path": "/ai-service/mcp/i/x", "path_params": {"institute_id": "x"}},
                                                 None, lambda m: sent.append(m) or _done())
    assert sent[0]["status"] == 404


async def _done():
    return None
