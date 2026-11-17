"""
search_help_knowledge over both doors: the in-product assistant and the MCP server.

One registry tool serves both. Pinned here:

  * MCP lists it only when the institute's MCP settings switch its group on, as a
    plain View area (not always on, not opt-in);
  * the embedding key is resolved on the server (the same resolver the assistant
    uses); keys in tool arguments are never read, and no key reaches the reply;
  * with no key, or a key lookup that fails, the reply is the "temporarily
    unavailable" note, not an error;
  * over MCP each result carries a full link on the institute's own admin portal
    (white-label domains included); with no portal on record it carries the path
    and says so;
  * the caller's roles reach the search as the role filter, in both doors;
  * the in-product assistant still gets exactly the relative-path results.

The vector search itself is stubbed here (a fake RAGService); the real SQL runs in
test_mcp_help_knowledge_pg.py when a Postgres with pgvector is configured.
"""
import json
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest  # noqa: E402
from mcp.types import CallToolResult  # noqa: E402

from app.mcp import adapter  # noqa: E402
from app.mcp.access import normalize_setting  # noqa: E402
from app.mcp.constants import MCP_EXPOSED_TOOLS, MCP_OPT_IN_GROUPS  # noqa: E402
from app.schemas.auth import PinnedPrincipal  # noqa: E402
from app.services import api_key_resolver, rag_service  # noqa: E402
from app.services import assistant_tool_registry as registry  # noqa: E402

TOOL = "search_help_knowledge"
SERVER_KEY = "server-side-embedding-key"
CALLER_KEY = "key-from-the-tool-arguments"

ARTICLES = [
    {"content_text": "1. Open Courses. 2. Click Create course.", "source_id": "create-course",
     "metadata": {"task": "Create a course", "route_path": "/study-library/courses", "role": "any"},
     "similarity_score": 0.81},
    {"content_text": "1. Open Settings. 2. Pick Payment.", "source_id": "payment-settings",
     "metadata": {"task": "Set up payments", "route_path": "/settings?selectedTab=payment", "role": "ADMIN"},
     "similarity_score": 0.74},
    {"content_text": "1. Open the video. 2. Edit it.", "source_id": "edit-video",
     "metadata": {"task": "Edit a video", "route_path": "/vim/edit/$videoId", "role": "any"},
     "similarity_score": 0.52},
]


def principal(roles=("ADMIN",)):
    return PinnedPrincipal(user_id="user-1", institute_id="inst-1", roles=list(roles), permissions=[],
                           is_root_user=False)


def mcp_setting(enabled_tools, role_overrides=None):
    return normalize_setting({"enabled": True, "allowed_roles": ["ADMIN", "TEACHER"],
                              "enabled_tools": list(enabled_tools), "role_overrides": role_overrides or {}})


class _Rows:
    def __init__(self, rows):
        self._rows = rows

    def first(self):
        return self._rows[0] if self._rows else None

    def fetchall(self):
        return list(self._rows)


class PortalDb:
    """Answers the two admin-portal statements; records every statement it sees."""

    def __init__(self, column=None, routing=()):
        self.column, self.routing, self.seen = column, list(routing), []

    def execute(self, stmt, params=None):
        sql = str(stmt)
        self.seen.append(sql)
        if "admin_portal_base_url" in sql:
            return _Rows([(self.column,)])
        if "institute_domain_routing" in sql:
            return _Rows(self.routing)
        raise AssertionError(f"unexpected statement: {sql}")


@pytest.fixture
def search(monkeypatch):
    """A fake vector search: records each call and the key the embedder would have used."""
    calls = []

    class FakeRag:
        def __init__(self, db, embedding_service):
            self.embedding_service = embedding_service

        async def search(self, *, query, institute_id, top_k, similarity_threshold, source_type, roles):
            key = self.embedding_service.api_key_resolver.resolve_keys(institute_id=institute_id)[0]
            calls.append({"query": query, "institute_id": institute_id, "source_type": source_type,
                          "roles": roles, "key": key})
            return [dict(a) for a in ARTICLES] if institute_id == registry.HELP_KNOWLEDGE_INSTITUTE_ID else []

    monkeypatch.setattr(rag_service, "RAGService", FakeRag)
    return calls


@pytest.fixture
def resolver(monkeypatch):
    """The server's key store, as the in-product assistant reads it."""
    seen = []
    state = {"keys": (SERVER_KEY, None, "model"), "raise": False}

    class FakeResolver:
        def __init__(self, db):
            pass

        def resolve_keys(self, institute_id, user_id=None, request_model=None, platform_default_key=None):
            seen.append({"institute_id": institute_id, "user_id": user_id})
            if state["raise"]:
                raise RuntimeError("store unreachable")
            return state["keys"]

    monkeypatch.setattr(api_key_resolver, "ApiKeyResolver", FakeResolver)
    resolver.seen, resolver.state = seen, state
    return resolver


async def call_mcp(db, arguments=None, roles=("ADMIN",), enabled=(TOOL,)):
    result = await adapter.call_tool(name=TOOL, arguments=arguments or {"query": "how do I create a course"},
                                     principal=principal(roles), platform_token="jwt", db=db,
                                     mcp_setting=mcp_setting(enabled))
    assert isinstance(result, CallToolResult)
    return json.loads(result.content[0].text), result


# ── listing and gating ───────────────────────────────────────────────────
def test_mcp_exposes_the_registry_tool_itself():
    assert TOOL in MCP_EXPOSED_TOOLS
    spec = next(s for s in adapter.exposed_specs() if s.name == TOOL)
    assert spec is registry.ASSISTANT_TOOLS[TOOL]  # one spec for both doors, not a copy
    assert spec.mode == "READ" and not spec.mcp_only


def test_mcp_lists_it_only_when_its_group_is_on():
    names = lambda conf, roles=("ADMIN",): [t.name for t in adapter.list_tools_for(principal(roles), conf)]  # noqa: E731
    assert TOOL not in names(normalize_setting(None))
    assert TOOL not in names(mcp_setting([]))
    assert TOOL not in names(mcp_setting(["institute_overview"]))
    assert TOOL in names(mcp_setting([TOOL]))
    per_role = mcp_setting([], {"TEACHER": {"enabled_tools": [TOOL]}})
    assert TOOL in names(per_role, ("TEACHER",)) and TOOL not in names(per_role, ("ADMIN",))
    tool = next(t for t in adapter.list_tools_for(principal(), mcp_setting([TOOL])) if t.name == TOOL)
    assert tool.annotations.read_only_hint is True and tool.input_schema["required"] == ["query"]


def test_catalog_shows_it_as_its_own_view_area_off_by_default():
    entry = next(c for c in adapter.tool_catalog() if c["name"] == TOOL)
    assert entry["key"] == TOOL and entry["label"] == "How-to help"
    assert entry["area"] == "help" and entry["level"] == "view"
    assert entry["always_on"] is False and entry["opt_in"] is False and TOOL not in MCP_OPT_IN_GROUPS
    assert "none of your institute's data" in entry["summary"]


def test_description_tells_the_ai_app_when_to_use_it_and_not_to_invent_steps():
    description = registry.ASSISTANT_TOOLS[TOOL].schema["function"]["description"]
    for phrase in ("how-to / where-to question", "where a feature lives", "steps", "url",
                   "no documented procedure", "never invent steps"):
        assert phrase in description, phrase


def test_server_instructions_send_how_to_questions_to_it():
    from app.mcp.server import SERVER_INSTRUCTIONS
    assert "How-to questions" in SERVER_INSTRUCTIONS and "`search_help_knowledge`" in SERVER_INSTRUCTIONS
    assert "never invent steps or links" in SERVER_INSTRUCTIONS


@pytest.mark.asyncio
async def test_mcp_call_is_refused_while_the_group_is_off(search, resolver):
    out, result = await call_mcp(PortalDb("https://admin.example.org"), enabled=())
    assert result.is_error and out["error"] == "tool_not_permitted"
    assert search == [] and resolver.seen == []


# ── the embedding key ────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_mcp_uses_the_server_key_never_one_from_the_arguments(search, resolver, caplog):
    caplog.set_level(logging.DEBUG)
    out, result = await call_mcp(PortalDb("https://admin.example.org"), arguments={
        "query": "how do I create a course", "api_key": CALLER_KEY, "openrouter_key": CALLER_KEY,
        "keys": [CALLER_KEY, CALLER_KEY, "model"],
    })
    assert not result.is_error
    assert resolver.seen == [{"institute_id": "inst-1", "user_id": "user-1"}]  # identity from the principal
    assert search and {c["key"] for c in search} == {SERVER_KEY}
    text = json.dumps(out) + caplog.text
    assert CALLER_KEY not in text and SERVER_KEY not in text


@pytest.mark.asyncio
@pytest.mark.parametrize("keys, fails", [((None, None, "model"), False), (("", None, "model"), False),
                                         ((), False), (None, True)])
async def test_no_key_answers_temporarily_unavailable(search, resolver, keys, fails):
    resolver.state.update(keys=keys, **{"raise": fails})
    out, result = await call_mcp(PortalDb("https://admin.example.org"))
    assert out == {"results": [], "note": "Help search is temporarily unavailable."}
    assert not result.is_error and search == []


@pytest.mark.asyncio
async def test_a_failing_search_answers_temporarily_unavailable(monkeypatch, resolver):
    class BrokenRag:
        def __init__(self, db, embedding_service):
            pass

        async def search(self, **_kw):
            raise RuntimeError("vector store down")

    monkeypatch.setattr(rag_service, "RAGService", BrokenRag)
    out, result = await call_mcp(PortalDb("https://admin.example.org"))
    assert out["note"] == "Help search is temporarily unavailable." and not result.is_error


# ── links on the institute's own admin portal ────────────────────────────
@pytest.mark.asyncio
async def test_mcp_results_link_to_the_institutes_admin_portal(search, resolver):
    out, _ = await call_mcp(PortalDb("https://dash.example-academy.com/"))
    assert out["admin_portal_url"] == "https://dash.example-academy.com"
    by_task = {r["task"]: r for r in out["results"]}
    assert by_task["Create a course"]["url"] == "https://dash.example-academy.com/study-library/courses"
    assert by_task["Create a course"]["route_path"] == "/study-library/courses"
    assert by_task["Set up payments"]["url"] == "https://dash.example-academy.com/settings?selectedTab=payment"
    # A route with a record placeholder cannot be linked; the path stays for the AI app to explain.
    assert "url" not in by_task["Edit a video"] and by_task["Edit a video"]["route_path"] == "/vim/edit/$videoId"
    assert "url" in out["note"]


@pytest.mark.asyncio
async def test_white_label_portal_without_a_scheme_and_from_domain_routing(search, resolver):
    out, _ = await call_mcp(PortalDb("admin.brandschool.in"))
    assert out["results"][0]["url"] == "https://admin.brandschool.in/study-library/courses"

    out, _ = await call_mcp(PortalDb(None, routing=[("brandschool.in", "admin")]))
    assert out["admin_portal_url"] == "https://admin.brandschool.in"
    assert out["results"][0]["url"] == "https://admin.brandschool.in/study-library/courses"


@pytest.mark.asyncio
@pytest.mark.parametrize("db", [PortalDb(None), PortalDb(""), None])
async def test_no_portal_on_record_links_to_the_platform_dashboard(search, resolver, db):
    from app.config import get_settings
    out, result = await call_mcp(db)
    assert not result.is_error
    base = get_settings().admin_dashboard_url.rstrip("/")
    assert out["admin_portal_url"] == base
    assert all(r["url"].startswith(base + "/") for r in out["results"] if "$" not in r["route_path"])


# ── the role filter ──────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_mcp_passes_the_principals_roles_as_the_role_filter(search, resolver):
    result = await adapter.call_tool(
        name=TOOL, arguments={"query": "how do I create a course"}, principal=principal(("TEACHER", "EVALUATOR")),
        platform_token="jwt", db=PortalDb("https://admin.example.org"),
        mcp_setting=mcp_setting([], {"TEACHER": {"enabled_tools": [TOOL]}}))
    assert not result.is_error
    assert [c["roles"] for c in search] == [["TEACHER", "EVALUATOR"]] * len(search)
    assert {c["institute_id"] for c in search} == {registry.HELP_KNOWLEDGE_INSTITUTE_ID, "inst-1"}
    assert {c["source_type"] for c in search} == {"help_knowledge"}


# ── the in-product assistant door ────────────────────────────────────────
@pytest.mark.asyncio
async def test_assistant_door_keeps_relative_paths_and_its_own_keys(search, resolver):
    db = PortalDb("https://admin.example.org")
    ctx = registry.ToolContext(db=db, principal=principal(("ADMIN",)), keys=("assistant-key", None, "model"))
    raw = await registry.execute_tool(TOOL, {"query": "how do I create a course", "api_key": CALLER_KEY}, ctx,
                                      None, in_product=True)
    out = json.loads(raw)
    assert set(out) == {"results"}
    assert [set(r) for r in out["results"]] == [{"task", "route_path", "steps", "similarity"}] * len(ARTICLES)
    assert out["results"][0]["route_path"] == "/study-library/courses"
    assert resolver.seen == [] and db.seen == []  # pre-resolved keys; no portal lookup
    assert {c["key"] for c in search} == {"assistant-key"} and {tuple(c["roles"]) for c in search} == {("ADMIN",)}


@pytest.mark.asyncio
async def test_assistant_door_says_no_match_without_inventing(monkeypatch, resolver):
    class EmptyRag:
        def __init__(self, db, embedding_service):
            pass

        async def search(self, **_kw):
            return []

    monkeypatch.setattr(rag_service, "RAGService", EmptyRag)
    ctx = registry.ToolContext(db=None, principal=principal(), keys=("assistant-key", None, "model"))
    out = json.loads(await registry.execute_tool(TOOL, {"query": "how do I fly"}, ctx, None, in_product=True))
    assert out["results"] == [] and "avoid inventing steps" in out["note"]
