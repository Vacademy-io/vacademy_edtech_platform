"""
`catalog_folder_edit`: live changes to the folders of a folder library — create
under an exact parent, update, move, delete (product decision 2026-11-25).

Pinned here, over a mocked admin-core: its own opt-in, MCP-only group (the
additive catalog_data_edit group does not grant it); every action is a dry run
unless dry_run=false with the dry run's plan_token; folders are named by id or
by their path, so titles that repeat across a library ('2026') are never
guessed; a delete removes the folder subtree only — never a product page or a
course — and returns what it removed; it only ever sends the four folder
calls.
"""
import copy
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import pytest  # noqa: E402
from app.mcp import adapter  # noqa: E402
from app.mcp.constants import MCP_ALLOWED_WRITE_TOOLS, MCP_EXPOSED_TOOLS, MCP_OPT_IN_GROUPS  # noqa: E402
from app.services import assistant_tools_catalog_data_edit as data_tool  # noqa: E402
from app.services import assistant_tools_catalog_folder_edit as tool  # noqa: E402
from app.services import assistant_tools_website_edit as edit_mod  # noqa: E402
from app.services import website_data  # noqa: E402
from app.services.assistant_tool_registry import ASSISTANT_TOOLS, build_offered_tools, is_tool_allowed  # noqa: E402
from test_catalog_data_edit_tool import Backend, _node, ctx, principal, setting  # noqa: E402


class FolderBackend(Backend):
    """The shared mocked admin-core plus folder moves and deletes (as CatalogueFolderService does them)."""

    async def __call__(self, ctx_, method, path, params=None, body=None, timeout=None):
        params = params or {}
        if path.endswith("/folder-library/node/move") and method == "POST":
            self.calls.append({"method": method, "path": path, "params": dict(params), "body": copy.deepcopy(body)})
            for lib, nodes in self.nodes.items():
                for n in nodes:
                    if n["id"] == params["nodeId"]:
                        n["parent_id"] = body.get("parent_id")
                        return self.tree(lib)
            return {"error": "fetch_failed", "status": 400}
        if path.endswith("/folder-library/node") and method == "DELETE":
            self.calls.append({"method": method, "path": path, "params": dict(params), "body": None})
            for lib, nodes in self.nodes.items():
                if any(n["id"] == params["nodeId"] for n in nodes):
                    doomed, queue = set(), [params["nodeId"]]
                    while queue:
                        cur = queue.pop()
                        doomed.add(cur)
                        queue.extend(n["id"] for n in nodes if n.get("parent_id") == cur)
                    self.nodes[lib] = [n for n in nodes if n["id"] not in doomed]
                    return {"deleted": len(doomed), "tree": self.tree(lib)}
            return {"error": "fetch_failed", "status": 400}
        return await super().__call__(ctx_, method, path, params=params, body=body, timeout=timeout)


@pytest.fixture
def backend(monkeypatch):
    be = FolderBackend()
    for mod in (website_data, data_tool, tool):
        monkeypatch.setattr(mod, "_admin_core_json", be)
    monkeypatch.setattr(data_tool, "_admin_base", lambda ctx_: "https://admin.test")
    monkeypatch.setattr(edit_mod, "_is_institute_asset", lambda url: url.startswith("https://cdn.vacademy.test/"))
    return be


async def run(args):
    return json.loads(await tool.execute_catalog_folder_edit(args, ctx()))


async def apply(args):
    plan = await run({**args, "dry_run": True})
    if "error" in plan or plan.get("nothing_to_do"):
        return plan
    return await run({**args, "dry_run": False, "plan_token": plan["plan_token"]})


def writes(be):
    return [c for c in be.calls if c["method"] != "GET"]


# ── gating ───────────────────────────────────────────────────────────────
def test_own_opt_in_mcp_only_group_not_granted_by_the_additive_one():
    spec = ASSISTANT_TOOLS["catalog_folder_edit"]
    assert spec.mode == "WRITE" and spec.key() == "website_folder_changes" and spec.mcp_only
    assert not spec.default_enabled and not spec.default_roles
    assert "website_folder_changes" in MCP_OPT_IN_GROUPS
    assert "catalog_folder_edit" in MCP_EXPOSED_TOOLS and "catalog_folder_edit" in MCP_ALLOWED_WRITE_TOOLS
    assert "LIVE" in MCP_ALLOWED_WRITE_TOOLS["catalog_folder_edit"]
    assert not is_tool_allowed("catalog_folder_edit", principal(), None)
    names = [t.name for t in adapter.list_tools_for(principal(), setting(["website_builder", "website_data_edits"]))]
    assert "catalog_data_edit" in names and "catalog_folder_edit" not in names
    tools = adapter.list_tools_for(principal(), setting(["website_builder", "website_folder_changes"]))
    t = next(t for t in tools if t.name == "catalog_folder_edit")
    assert set(t.input_schema["properties"]["action"]["enum"]) == set(tool.CATALOG_FOLDER_EDIT_ACTIONS)
    offered = build_offered_tools(principal(), {"enabled_tools": ["website_folder_changes"], "role_overrides": {}})
    assert "catalog_folder_edit" not in json.dumps(offered)
    entry = next(c for c in adapter.tool_catalog() if c["name"] == "catalog_folder_edit")
    assert (entry["key"], entry["area"], entry["level"], entry["risk"]) == (
        "website_folder_changes", "website", "edit", "live")
    assert entry["label"] == "Website: change folders"


def test_source_sends_only_the_four_folder_calls():
    src = Path(tool.__file__).read_text()
    calls = set(re.findall(r'_admin_core_json\(\s*ctx,\s*"([A-Z]+)",\s*f?"([^"]+)"', src))
    assert calls == set(tool.WRITE_ENDPOINTS.values()), calls
    for forbidden in ("/product-page/update", "/product-page/delete", "update-course", "enroll-invite",
                      "/folder-library/library\""):
        assert forbidden not in src


@pytest.mark.asyncio
async def test_every_action_is_a_dry_run_and_needs_its_token(backend):
    outs = [
        await run({"action": "create_folder", "library_id": "lib-1", "parent_path": ["Shastra"], "title": "Karma"}),
        await run({"action": "update_folder", "library_id": "lib-1", "folder_path": "Gita", "title": "Gita 2"}),
        await run({"action": "move_folder", "library_id": "lib-1", "folder_path": "Gita", "to_top_level": True}),
        await run({"action": "delete_folder", "library_id": "lib-1", "folder_path": "Gita"}),
    ]
    assert all(o["dry_run"] is True and o["plan_token"].startswith("cdp1.") for o in outs), outs
    assert writes(backend) == []
    refused = await run({"action": "delete_folder", "library_id": "lib-1", "folder_path": "Gita", "dry_run": False})
    assert refused["error"] == "plan_token_required" and writes(backend) == []
    # A token of one action never applies another.
    other = await run({"action": "delete_folder", "library_id": "lib-1", "folder_path": "Gita", "dry_run": False,
                       "plan_token": outs[1]["plan_token"]})
    assert other["error"] == "plan_changed" and writes(backend) == []


# ── create_folder ────────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_create_folder_under_an_exact_parent_even_when_titles_repeat(backend):
    backend.nodes["lib-1"] += [_node("y-a", "2026", None, parent="n-1"), _node("y-b", "2026", None, parent="n-3")]
    out = await apply({"action": "create_folder", "library_id": "lib-1", "parent_path": "Swasthya › 2026",
                       "title": "November", "image_url": "https://cdn.vacademy.test/inst-1/nov.png"})
    assert out["folder"]["path"] == "Swasthya › 2026 › November" and out["folder"]["status"] == "ACTIVE", out
    (call,) = writes(backend)
    assert call["method"] == "POST" and call["params"]["libraryId"] == "lib-1"
    assert call["body"] == {"node_type": "FOLDER", "status": "ACTIVE", "parent_id": "y-b", "title": "November",
                            "image_url": "https://cdn.vacademy.test/inst-1/nov.png"}
    assert out["folder"]["id"] == backend.nodes["lib-1"][-1]["id"]
    # The bare path '2026' names two folders: the caller is asked which, nothing is guessed.
    twice = await run({"action": "create_folder", "library_id": "lib-1", "parent_path": ["2026"], "title": "December"})
    assert twice["error"] == "ambiguous_folder" and len(twice["matches"]) == 2


@pytest.mark.asyncio
async def test_create_folder_refusals(backend):
    dup = await run({"action": "create_folder", "library_id": "lib-1", "parent_path": ["Shastra"], "title": " gita "})
    assert dup["error"] == "folder_exists" and dup["folder"]["id"] == "n-2"
    both = await run({"action": "create_folder", "library_id": "lib-1", "parent_path": ["Shastra"], "top_level": True,
                      "title": "X"})
    assert both["error"] == "missing_argument"
    bad = await run({"action": "create_folder", "library_id": "lib-1", "top_level": True, "title": "X",
                     "image_url": "https://elsewhere.test/a.png"})
    assert bad["error"] == "invalid_fields"
    hidden = await apply({"action": "create_folder", "library_id": "lib-1", "top_level": True, "title": "Later",
                          "hidden": True})
    assert hidden["folder"]["status"] == "HIDDEN" and writes(backend)[-1]["body"]["status"] == "HIDDEN"
    assert "parent_id" not in writes(backend)[-1]["body"]


# ── update_folder ────────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_update_folder_sends_only_what_changes_and_can_hide_it(backend):
    plan = await run({"action": "update_folder", "library_id": "lib-1", "folder_id": "n-2",
                      "title": "Bhagavad Gita", "visible": False})
    assert plan["changes"] == {"title": {"before": "Gita", "after": "Bhagavad Gita"},
                               "visible": {"before": True, "after": False}}
    assert any("live site" in w for w in plan["warnings"]) and any("hides everything" in w for w in plan["warnings"])
    out = await run({"action": "update_folder", "library_id": "lib-1", "folder_id": "n-2", "title": "Bhagavad Gita",
                     "visible": False, "dry_run": False, "plan_token": plan["plan_token"]})
    assert out["changed"] == ["title", "visible"], out
    (call,) = writes(backend)
    assert call["method"] == "PUT" and call["params"]["nodeId"] == "n-2"
    assert call["body"] == {"title": "Bhagavad Gita", "status": "HIDDEN"}
    same = await run({"action": "update_folder", "library_id": "lib-1", "folder_id": "n-2", "title": "Bhagavad Gita"})
    assert same["nothing_to_do"] is True and "plan_token" not in same
    clash = await run({"action": "update_folder", "library_id": "lib-1", "folder_id": "n-1", "title": "Swasthya"})
    assert clash["error"] == "folder_exists"


# ── move_folder ──────────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_move_folder_to_a_place_and_never_into_itself(backend):
    out = await apply({"action": "move_folder", "library_id": "lib-1", "folder_path": ["Shastra", "Gita"],
                       "to_top_level": True, "position": 1})
    assert out["moved_to"] == {"parent": "(top level)", "position": 1}, out
    (call,) = writes(backend)
    assert call["path"].endswith("/node/move") and call["body"] == {"parent_id": None, "index": 0}
    inside = await run({"action": "move_folder", "library_id": "lib-1", "folder_id": "n-1",
                        "to_parent_path": ["Shastra"]})
    assert inside["error"] == "invalid_move"
    backend.nodes["lib-1"].append(_node("n-9", "Child", None, parent="n-1"))
    into_child = await run({"action": "move_folder", "library_id": "lib-1", "folder_id": "n-1", "to_parent_id": "n-9"})
    assert into_child["error"] == "invalid_move"
    bad = await run({"action": "move_folder", "library_id": "lib-1", "folder_id": "n-3", "to_top_level": True,
                     "position": 0})
    assert bad["error"] == "invalid_argument"


# ── delete_folder ────────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_delete_folder_lists_everything_and_keeps_pages_and_courses(backend):
    plan = await run({"action": "delete_folder", "library_id": "lib-1", "folder_path": "Shastra"})
    assert plan["delete"]["items_removed"] == 3
    assert plan["delete"]["sub_folders"] == ["Shastra › Gita"]
    (page,) = plan["delete"]["product_pages_unhung"]
    assert page["code"] == "forbvy" and page["courses"] == 1 and page["in"] == "Shastra"
    assert "NOT deleted" in " ".join(plan["warnings"]) and "kept" in plan["keeps"]
    out = await run({"action": "delete_folder", "library_id": "lib-1", "folder_path": "Shastra", "dry_run": False,
                     "plan_token": plan["plan_token"]})
    assert out["deleted"]["items_removed"] == 3, out
    assert {r["id"] for r in out["removed_items"]} == {"n-1", "n-2", "n-4"}
    assert next(r for r in out["removed_items"] if r["id"] == "n-4")["product_page_id"] == "pp-1"
    (call,) = writes(backend)
    assert call["method"] == "DELETE" and call["params"] == {"instituteId": "inst-1", "nodeId": "n-1"}
    assert [p["id"] for p in backend.pages] == ["pp-1"], "the product page itself is untouched"
    assert {n["id"] for n in backend.nodes["lib-1"]} == {"n-3"}


@pytest.mark.asyncio
async def test_a_stale_plan_is_refused(backend):
    plan = await run({"action": "delete_folder", "library_id": "lib-1", "folder_path": "Shastra"})
    backend.nodes["lib-1"].append(_node("n-new", "Added meanwhile", None, parent="n-2"))
    out = await run({"action": "delete_folder", "library_id": "lib-1", "folder_path": "Shastra", "dry_run": False,
                     "plan_token": plan["plan_token"]})
    assert out["error"] == "plan_changed" and writes(backend) == []


@pytest.mark.asyncio
async def test_unknown_arguments_actions_and_secrets_are_refused(backend):
    out = await run({"action": "delete_folder", "library_id": "lib-1", "folder_path": "Gita", "cascade": False})
    assert out["error"] == "unknown_argument" and out["fields"] == ["cascade"]
    assert (await run({"action": "delete_product_page"}))["error"] == "unknown_action"
    assert (await run({"action": "create_folder", "access_token": "x"}))["error"] == "secret_not_accepted"
    assert writes(backend) == []


# ── review follow-ups: what a change exposes, renames, slugs, the delete snapshot ─────────
@pytest.mark.asyncio
async def test_renaming_a_folder_keyed_by_its_title_warns_about_links_and_tags(backend):
    plan = await run({"action": "update_folder", "library_id": "lib-1", "folder_id": "n-3", "title": "Health"})
    text = " ".join(plan["warnings"])
    assert "link key" in text and "title" in text and "course tag it filters by" in text
    keyed = await run({"action": "update_folder", "library_id": "lib-1", "folder_id": "n-1", "title": "Texts"})
    assert not any("link key" in w for w in keyed["warnings"]), "a folder with a slug keeps its key"


@pytest.mark.asyncio
async def test_showing_or_moving_out_of_a_hidden_folder_lists_what_appears(backend):
    for n in backend.nodes["lib-1"]:
        if n["id"] == "n-1":
            n["status"] = "HIDDEN"
    shown = await run({"action": "update_folder", "library_id": "lib-1", "folder_id": "n-1", "visible": True})
    text = " ".join(shown["warnings"])
    assert "1 sub-folder(s)" in text and "1 product page item(s)" in text and "For BVY" in text
    moved = await run({"action": "move_folder", "library_id": "lib-1", "folder_id": "n-2", "to_parent_id": "n-3"})
    assert any("leaves the HIDDEN 'Shastra'" in w for w in moved["warnings"])
    into = await run({"action": "move_folder", "library_id": "lib-1", "folder_id": "n-3", "to_parent_id": "n-1"})
    assert any("leave the site" in w for w in into["warnings"])
    assert any("stops being a top-level folder" in w for w in into["warnings"])


@pytest.mark.asyncio
async def test_create_with_a_slug_and_a_delete_snapshot_that_can_rebuild_it(backend):
    out = await apply({"action": "create_folder", "library_id": "lib-1", "parent_id": "n-3", "title": "Yoga",
                       "slug": "yoga", "tagline": "Breathe", "accent_color": "#AA00FF"})
    assert writes(backend)[-1]["body"]["slug"] == "yoga", out
    taken = await run({"action": "create_folder", "library_id": "lib-1", "top_level": True, "title": "Other",
                       "slug": "yoga"})
    assert taken["error"] == "slug_taken"
    bad = await run({"action": "create_folder", "library_id": "lib-1", "top_level": True, "title": "Other",
                     "slug": "Not A Slug"})
    assert bad["error"] == "invalid_argument"
    gone = await apply({"action": "delete_folder", "library_id": "lib-1", "folder_id": "n-3"})
    yoga = next(r for r in gone["removed_items"] if r.get("title") == "Yoga")
    assert yoga["slug"] == "yoga" and yoga["tagline"] == "Breathe" and yoga["accent_color"] == "#aa00ff"
    assert "children" not in yoga


def test_a_title_with_a_slash_is_one_path_segment():
    assert data_tool._path_segments("Current Affairs › Prelims/Mains") == ["Current Affairs", "Prelims/Mains"]
