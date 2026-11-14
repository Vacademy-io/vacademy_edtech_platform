"""
design_import end to end through the registry gate, with a real (SQLite)
mcp_design_import_part table for the 24 h uploads: client payloads only
(figma_url is refused), no credentials accepted, chunked uploads under one
import_id (parallel parts never lost), institute scoping, expiry (purged for
every institute), size caps, uploads never reachable through ai_task's
unauthenticated /task-status routes, the tool's own opt-in group (never in the
in-product assistant), and save_draft going through website_edit's own
create_site / create_page — only for callers who hold website_edit.
"""
import json
import sys
from datetime import timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import pytest  # noqa: E402
from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402

from app.models.ai_task import AiTask  # noqa: E402
from app.models.design_import import DesignImportPart  # noqa: E402
from app.schemas.auth import PinnedPrincipal  # noqa: E402
from app.services import assistant_tools_design_import as di  # noqa: E402
from app.services import assistant_tools_website_edit as edit_mod  # noqa: E402
from app.services.assistant_tool_registry import ToolContext, execute_tool  # noqa: E402

from test_figma_design_import import design_code, design_xml  # noqa: E402

VIEW = {"enabled_tools": ["design_import"]}                      # the tool's own group, without website_edit
EDIT = {"enabled_tools": ["design_import", "website_builder", "website_builder_edits"]}


@pytest.fixture
def db(tmp_path, monkeypatch):
    engine = create_engine(f"sqlite:///{tmp_path / 'ai.db'}", connect_args={"check_same_thread": False})
    AiTask.metadata.create_all(engine, tables=[AiTask.__table__])
    DesignImportPart.__table__.create(engine)              # Flyway V561 creates it in production
    monkeypatch.setattr(di, "_schema_ready", False)
    session = sessionmaker(bind=engine, expire_on_commit=False)()
    yield session
    session.close()


def parts(db, import_id=None):
    q = db.query(DesignImportPart)
    return q.filter(DesignImportPart.import_id == import_id).all() if import_id else q.all()


def stored(db):
    return {r.import_id for r in parts(db)}


def ctx(db, institute="inst-1"):
    p = PinnedPrincipal(user_id="user-1", institute_id=institute, roles=["ADMIN"], permissions=[], is_root_user=False)
    return ToolContext(db=db, principal=p, keys=(), bearer_token="jwt", via_mcp=True)  # MCP-only tool


async def call(db, args, setting=VIEW, institute="inst-1"):
    return json.loads(await execute_tool("design_import", args, ctx(db, institute), setting))


def payload(**kw):
    return {"action": "plan", "source": "client", "metadata_xml": design_xml(),
            "design_code": [{"node_id": "9:1", "code": design_code()}], **kw}


# ── source and credentials ───────────────────────────────────────────────
@pytest.mark.asyncio
async def test_figma_url_is_not_supported_and_says_what_to_do(db):
    out = await call(db, {"action": "plan", "source": "figma_url", "url": "https://www.figma.com/design/AbCdEfGhIjKl/x"})
    assert out["error"] == "figma_url_not_supported"
    assert "get_metadata" in out["message"] and "source='client'" in out["message"]
    # The white-label sentence for the AI to relay when it has no Figma tools (playbook carries it too).
    from app.services.figma_links import FIGMA_LINK_GUIDANCE_FOR_AI as FIGMA_LINK_GUIDANCE
    assert out["tell_admin"] == FIGMA_LINK_GUIDANCE and FIGMA_LINK_GUIDANCE in out["message"]
    assert "source='screenshot'" in out["message"]
    assert db.query(AiTask).count() == 0


@pytest.mark.asyncio
@pytest.mark.parametrize("key", ["figma_token", "access_token", "api_key", "Authorization", "pat"])
async def test_credentials_are_refused_and_never_echoed(db, key):
    out = await call(db, {**payload(), key: "figd_SECRET123"})
    assert out["error"] == "secret_not_accepted"
    assert "figd_SECRET123" not in json.dumps(out)
    assert db.query(AiTask).count() == 0


@pytest.mark.asyncio
@pytest.mark.parametrize("enabled", [["website_builder"], ["website_builder", "website_builder_edits"]])
async def test_the_tool_needs_its_own_group_not_the_website_ones(db, enabled):
    """Existing connections (website view / edit) do not get it: an admin turns it on."""
    out = await call(db, payload(), setting={"enabled_tools": enabled})
    assert out["error"] == "tool_not_permitted"


# ── plan + storage ───────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_plan_stores_the_upload_for_this_institute_and_returns_the_plan(db):
    out = await call(db, payload(url="https://www.figma.com/design/AbCdEfGhIjKl/Site?node-id=9-1&t=SHARE"))
    assert len(out["import_id"]) == 32 and out["expires_at"]
    assert out["tokens"]["palette"]["primary"] == "#8A2E00"
    assert [s["component"] for s in out["sections"]] == ["courseCatalog", "ctaBanner", "stepsProcess"]
    assert all("props_draft" not in s for s in out["sections"])        # the draft carries them once
    assert out["site_json_draft"]["pages"][0]["components"]
    assert out["design_url"] == "https://www.figma.com/design/AbCdEfGhIjKl/Site?node-id=9-1"   # share token dropped
    assert "DESIGN DATA" in out["rules"]
    (row,) = parts(db, out["import_id"])
    assert row.institute_id == "inst-1" and row.created_by == "user-1" and row.bytes > 0
    assert db.query(AiTask).count() == 0                               # never an ai_task row


@pytest.mark.asyncio
async def test_chunked_upload_plans_from_every_part(db):
    first = await call(db, {"action": "plan", "source": "client", "metadata_xml": design_xml(), "upload_only": True})
    assert "tokens" not in first and first["received"]["metadata_xml_documents"] == 1
    out = await call(db, {"action": "plan", "source": "client", "import_id": first["import_id"],
                          "design_code": [{"node_id": "9:1", "code": design_code()}]})
    assert out["import_id"] == first["import_id"]
    assert out["received"] == {**out["received"], "metadata_xml_documents": 1, "design_code_entries": 1}
    assert out["tokens"]["palette"]["text"] == "#1B1B1B"        # colours from part 2, sections from part 1
    assert out["sections"]
    assert len(parts(db, first["import_id"])) == 2 and out["expires_at"] == first["expires_at"]


@pytest.mark.asyncio
async def test_parallel_parts_of_one_import_are_all_kept(db):
    """AI apps send tool calls in parallel: each part is its own row, so none is lost."""
    import asyncio
    first = await call(db, {"action": "plan", "source": "client", "metadata_xml": design_xml(), "upload_only": True})
    more = [{"action": "plan", "source": "client", "import_id": first["import_id"], "upload_only": True,
             "design_code": [{"node_id": f"9:{i}", "code": design_code()}]} for i in range(1, 4)]
    await asyncio.gather(*(call(db, a) for a in more))
    payload_, _ = di._load_import(ctx(db), first["import_id"])
    assert sorted(c["node_id"] for c in payload_["design_code"]) == ["9:1", "9:2", "9:3"]


@pytest.mark.asyncio
async def test_too_many_frame_ids_are_reported_not_silently_dropped(db, monkeypatch):
    monkeypatch.setattr(di, "MAX_FRAME_IDS", 2)
    out = await call(db, payload(frame_ids=["9:1", "9:2", "9:3"], upload_only=True))
    assert "only the first 2 of 3" in out["warnings"][0]


@pytest.mark.asyncio
async def test_another_institute_cannot_read_an_import(db):
    out = await call(db, payload())
    other = await call(db, {"action": "plan", "source": "client", "import_id": out["import_id"],
                            "design_code": [{"node_id": "9:2", "code": "<div/>"}]}, institute="inst-2")
    assert other["error"] == "import_not_found"
    assert len(parts(db, out["import_id"])) == 1                       # nothing added to another's import
    saved = await call(db, {"action": "save_draft", "import_id": out["import_id"], "new_site_name": "x"},
                       setting=EDIT, institute="inst-2")
    assert saved["error"] == "import_not_found"


@pytest.mark.asyncio
async def test_imports_expire_after_24_hours(db):
    out = await call(db, payload())
    for row in parts(db, out["import_id"]):
        row.expires_at = row.expires_at - timedelta(hours=25)
    db.commit()
    again = await call(db, {"action": "plan", "source": "client", "import_id": out["import_id"]})
    assert again["error"] == "import_not_found"


@pytest.mark.asyncio
async def test_expired_imports_of_every_institute_are_purged_by_any_new_upload(db):
    """The 24 h promise holds without a scheduler and without the owner coming back."""
    old = await call(db, payload(), institute="inst-quiet")
    for row in parts(db, old["import_id"]):
        row.expires_at = row.expires_at - timedelta(hours=25)
    db.commit()
    new = await call(db, payload(upload_only=True), institute="inst-1")
    assert stored(db) == {new["import_id"]}


@pytest.mark.asyncio
async def test_expired_imports_are_purged_with_no_upload_at_all(db):
    """DB-2: the background purge drops expired parts even when nobody uploads again."""
    from contextlib import contextmanager
    old = await call(db, payload(), institute="inst-quiet")
    live = await call(db, payload(upload_only=True), institute="inst-1")
    for row in parts(db, old["import_id"]):
        row.expires_at = row.expires_at - timedelta(hours=25)
    db.commit()

    @contextmanager
    def session():
        yield db

    assert di.purge_expired_imports(session) >= 1
    assert stored(db) == {live["import_id"]}
    assert di.purge_expired_imports(session) == 0          # idempotent


def test_purge_is_a_no_op_without_the_flyway_table():
    from contextlib import contextmanager
    empty = sessionmaker(bind=create_engine("sqlite://"))()

    @contextmanager
    def session():
        yield empty

    assert di.purge_expired_imports(session) == 0


@pytest.mark.asyncio
async def test_each_institute_keeps_a_bounded_number_of_imports(db, monkeypatch):
    monkeypatch.setattr(di, "MAX_IMPORTS_PER_INSTITUTE", 3)
    ids = [(await call(db, payload(upload_only=True)))["import_id"] for _ in range(5)]
    other = (await call(db, payload(upload_only=True), institute="inst-2"))["import_id"]
    assert stored(db) == set(ids[-3:]) | {other}


@pytest.mark.asyncio
async def test_size_caps(db, monkeypatch):
    monkeypatch.setattr(di, "MAX_CALL_BYTES", 1000)
    out = await call(db, payload())
    assert out["error"] == "too_large" and "import_id" in out["message"]
    monkeypatch.setattr(di, "MAX_CALL_BYTES", 2 * 1024 * 1024)
    monkeypatch.setattr(di, "MAX_CODE_ENTRIES", 1)
    first = await call(db, payload())
    more = await call(db, {"action": "plan", "source": "client", "import_id": first["import_id"],
                           "design_code": [{"node_id": "9:1", "code": "<div/>"}]})
    assert more["error"] == "too_large"


@pytest.mark.asyncio
@pytest.mark.parametrize("bad,err", [
    ({"metadata_xml": 5}, "bad_request"),
    ({"design_code": [{"node_id": "javascript:1", "code": "x"}]}, "bad_request"),
    ({"frame_ids": ["../etc"]}, "bad_request"),
    ({"import_id": "not-an-id"}, "bad_request"),
    ({"metadata_xml": '<!DOCTYPE a [<!ENTITY b "c">]><frame id="1:1" name="&b;"/>'}, "bad_xml"),
])
async def test_bad_arguments(db, bad, err):
    args = payload(**bad)
    if "metadata_xml" in bad and "DOCTYPE" not in str(bad["metadata_xml"]):
        args.pop("design_code")
    out = await call(db, args)
    assert out["error"] == err


@pytest.mark.asyncio
async def test_nothing_to_plan_without_a_payload(db):
    out = await call(db, {"action": "plan", "source": "client"})
    assert out["error"] == "missing_argument"


# ── save_draft ───────────────────────────────────────────────────────────
@pytest.fixture
def writes(monkeypatch):
    rec = {"sites": [], "pages": []}

    async def _site(args, ctx):
        rec["sites"].append(args)
        return {"editor_url": "https://dash/x", "created_site": True}

    async def _page(args, ctx):
        rec["pages"].append(args)
        return {"editor_url": "https://dash/x"}

    monkeypatch.setattr(edit_mod, "_action_create_site", _site)
    monkeypatch.setattr(edit_mod, "_action_create_page", _page)
    return rec


@pytest.mark.asyncio
async def test_save_draft_needs_website_edit(db, writes):
    out = await call(db, payload())
    saved = await call(db, {"action": "save_draft", "import_id": out["import_id"], "new_site_name": "acme"}, setting=VIEW)
    assert saved["error"] == "tool_not_permitted" and "Website: edit drafts" in saved["message"]
    assert writes["sites"] == [] and writes["pages"] == []


@pytest.mark.asyncio
async def test_save_draft_creates_a_new_draft_site_with_the_design_source(db, writes):
    out = await call(db, payload(url="https://www.figma.com/design/AbCdEfGhIjKl/Site?node-id=9-1"))
    saved = await call(db, {"action": "save_draft", "import_id": out["import_id"], "new_site_name": "Acme"},
                       setting=EDIT)
    assert "error" not in saved, saved
    (site,) = writes["sites"]
    assert site["new_site_name"] == "Acme"
    page = site["pages"][0]
    assert page["design_source"] == {"kind": "figma", "node_id": "9:1", "frame": "Courses – desktop",
                                     "url": "https://www.figma.com/design/AbCdEfGhIjKl/Site?node-id=9-1"}
    assert site["theme"]["palette"]["primary"] == "#8A2E00" and site["theme"]["content_max_width"] == 1152
    assert site["header"]["type"] == "header" and site["footer"]["type"] == "footer"
    assert saved["settings_calls"] is not None and saved["data_needs"]
    assert "<" not in json.dumps(site, ensure_ascii=False).replace("<p>", "").replace("</p>", "")


@pytest.mark.asyncio
async def test_settings_calls_target_the_saved_site_never_the_default(db, writes, monkeypatch):
    """F3: set_catalog_settings / set_translations without tag_name would change the DEFAULT (live) site."""
    from app.services import figma_design_import as fdi
    calls = [{"tool": "website_edit", "action": "set_catalog_settings",
              "args": {"tag_name": fdi.SETTINGS_TAG_PLACEHOLDER, "catalog_settings": {"course_format_order": ["a"]}}},
             {"tool": "website_edit", "action": "set_translations",
              "args": {"tag_name": fdi.SETTINGS_TAG_PLACEHOLDER, "locale": "hi", "enable": True}}]
    real = di._run_plan

    def plan_with_calls(payload_):
        out = real(payload_)
        out["settings_calls"] = calls
        return out
    monkeypatch.setattr(di, "_run_plan", plan_with_calls)

    async def _site(args, ctx):
        writes["sites"].append(args)
        return {"editor_url": "https://dash/x", "created_site": True, "tag_name": "bv-new"}
    monkeypatch.setattr(edit_mod, "_action_create_site", _site)
    out = await call(db, payload())
    saved = await call(db, {"action": "save_draft", "import_id": out["import_id"], "new_site_name": "bv-new"},
                       setting=EDIT)
    assert [c["args"]["tag_name"] for c in saved["settings_calls"]] == ["bv-new", "bv-new"]
    saved = await call(db, {"action": "save_draft", "import_id": out["import_id"], "tag_name": "main-site"},
                       setting=EDIT)
    assert [c["args"]["tag_name"] for c in saved["settings_calls"]] == ["main-site", "main-site"]
    assert calls[0]["args"]["tag_name"] == fdi.SETTINGS_TAG_PLACEHOLDER      # the plan itself is untouched


def test_plan_settings_calls_never_omit_tag_name():
    from app.services import figma_design_import as fdi
    needs = [{"kind": "courseFormats", "design": {"formats": [{"key": "ebook", "label": "eBook"}]}}]
    for c in fdi._settings_calls(needs, {"languages": ["en", "hi"]}):
        assert c["args"]["tag_name"] == fdi.SETTINGS_TAG_PLACEHOLDER


@pytest.mark.asyncio
async def test_save_draft_into_an_existing_site_adds_pages_and_leaves_its_chrome_and_theme(db, writes):
    out = await call(db, payload())
    corrected = {"pages": [{"route": "courses", "title": "Courses", "components": [
        {"id": "c", "type": "courseCatalog", "enabled": True, "props": {"hero": {"enabled": True}}}]}]}
    saved = await call(db, {"action": "save_draft", "import_id": out["import_id"], "tag_name": "main-site",
                            "site_json": corrected}, setting=EDIT)
    assert "error" not in saved
    (page,) = writes["pages"]
    assert page["tag_name"] == "main-site" and page["page_type"] == "catalog"
    assert page["page"]["components"][0]["props"] == {"hero": {"enabled": True}}     # the caller's JSON wins
    assert page["design_source"]["node_id"] == "9:1"
    assert "theme" not in page                                                         # apply_theme defaults off
    assert "chrome_not_applied" in saved


@pytest.mark.asyncio
async def test_save_draft_keeps_a_camel_case_node_id_of_a_corrected_page(db, writes):
    out = await call(db, payload())
    corrected = {"pages": [{"route": "courses", "title": "Courses", "components": [],
                            "design_source": {"kind": "figma", "nodeId": "9:1", "frame": "Courses"}}]}
    saved = await call(db, {"action": "save_draft", "import_id": out["import_id"], "new_site_name": "Acme",
                            "site_json": corrected}, setting=EDIT)
    assert "error" not in saved, saved
    assert writes["sites"][0]["pages"][0]["design_source"]["node_id"] == "9:1"


@pytest.mark.asyncio
async def test_save_draft_argument_checks(db, writes):
    out = await call(db, payload())
    both = await call(db, {"action": "save_draft", "import_id": out["import_id"], "new_site_name": "a", "tag_name": "b"},
                      setting=EDIT)
    assert both["error"] == "missing_argument"
    none = await call(db, {"action": "save_draft", "import_id": out["import_id"], "new_site_name": "a",
                           "pages": ["nope"]}, setting=EDIT)
    assert none["error"] == "nothing_to_save"
    assert writes["sites"] == []


@pytest.mark.asyncio
async def test_a_failed_save_is_reported(db, monkeypatch):
    async def _fail(args, ctx):
        return {"error": "create_failed", "message": "exists"}
    monkeypatch.setattr(edit_mod, "_action_create_site", _fail)
    out = await call(db, payload())
    saved = await call(db, {"action": "save_draft", "import_id": out["import_id"], "new_site_name": "a"}, setting=EDIT)
    assert saved["error"] == "create_failed"


# ── side effects elsewhere ───────────────────────────────────────────────
@pytest.mark.asyncio
async def test_uploads_are_not_reachable_through_the_unauthenticated_task_status_routes(db):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from app.db import db_dependency
    from app.routers import ai_task_status

    out = await call(db, payload())
    app = FastAPI()
    app.include_router(ai_task_status.router)
    app.dependency_overrides[db_dependency] = lambda: db
    client = TestClient(app)
    for task_type in ("DESIGN_IMPORT", None):
        params = {"instituteId": "inst-1", **({"taskType": task_type} if task_type else {})}
        listed = client.get("/task-status/get-all", params=params)
        assert listed.status_code == 200 and listed.json() == []
    assert client.get("/task-status/get-raw-result", params={"taskId": out["import_id"]}).status_code == 404
    assert client.get("/task-status/get-status", params={"taskId": out["import_id"]}).status_code == 404


def test_the_in_product_assistant_never_offers_design_import():
    """MCP-only: the default in-product offer is what it was, and enabling the key there changes nothing."""
    from app.services.assistant_tool_registry import ASSISTANT_TOOLS, build_offered_tools
    p = PinnedPrincipal(user_id="u", institute_id="i", roles=["ADMIN"], permissions=[], is_root_user=False)
    offered = [t["function"]["name"] for t in build_offered_tools(p, None)]
    assert "design_import" not in offered and "website" in offered
    expected = [n for n, spec in ASSISTANT_TOOLS.items()
                if n != "design_import" and (spec.default_enabled or "ADMIN" in (spec.default_roles or []))]
    assert sorted(offered) == sorted(expected)
    on = [t["function"]["name"] for t in build_offered_tools(p, {"enabled_tools": ["design_import", "website_builder"]})]
    assert "design_import" not in on and "website" in on


def test_design_payloads_are_digested_in_the_mcp_audit_log():
    from app.mcp import repository as repo_mod
    logged = json.loads(repo_mod._audit_args_json({"action": "plan", "metadata_xml": "<x/>" * 10,
                                                   "design_code": [{"code": "abc"}]}))
    assert logged["action"] == "plan"
    assert set(logged["metadata_xml"]) == {"bytes", "sha256"} and set(logged["design_code"]) == {"bytes", "sha256"}


def test_refused_credentials_never_reach_the_mcp_audit_log():
    from app.mcp import repository as repo_mod
    logged = json.loads(repo_mod._audit_args_json({"action": "plan", "figma_token": "figd_SECRET123",
                                                   "nested": {"Authorization": "Bearer x"}, "apply_to_tokens": True}))
    assert "figd_SECRET123" not in json.dumps(logged) and "Bearer x" not in json.dumps(logged)
    assert logged["figma_token"] == "[redacted]" and logged["nested"]["Authorization"] == "[redacted]"
    assert logged["apply_to_tokens"] is True and logged["action"] == "plan"
    for key in ("figma_token", "access_token", "api_key", "Authorization", "pat", "client_secret", "password"):
        assert bool(repo_mod._AUDIT_SECRET_KEY_RE.search(key)) == bool(di._SECRET_ARG_RE.search(key)) is True, key
