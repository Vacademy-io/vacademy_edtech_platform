"""
course_structure_edit: change a course's depth / regroup it over MCP.

admin-core does the restructure in one transaction (CourseRestructureServiceIT covers its SQL on
Postgres). These tests pin the ai_service half: the full tree sent to admin-core for every direction
(down = mechanical merge, up = the LLM's outline), existing containers reused wherever possible,
every slide placed exactly once, nothing written without the preview's confirm_token, live courses
flagged, and the dashboard's drip settings re-pointed like admin-core re-points the rows.
"""
import json
import sys
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest  # noqa: E402
from app.schemas.auth import PinnedPrincipal  # noqa: E402
from app.services import course_builder_data as cbd  # noqa: E402
from app.services.assistant_tool_registry import ASSISTANT_TOOLS, ToolContext, is_tool_allowed  # noqa: E402
from app.services.assistant_tools_course_structure import execute_course_structure_edit  # noqa: E402


class _FakeDb:
    def execute(self, stmt, params=None):
        return SimpleNamespace(first=lambda: None, fetchall=lambda: [])

    def rollback(self):
        pass


def principal(user_id="admin-1"):
    return PinnedPrincipal(user_id=user_id, institute_id="inst-1", roles=["ADMIN"], permissions=[], is_root_user=False)


def ctx(user_id="admin-1"):
    return ToolContext(db=_FakeDb(), principal=principal(user_id), keys=(), bearer_token="jwt")


def slide(sid, title):
    return {"id": sid, "title": title, "type": "DOCUMENT", "status": "PUBLISHED"}


def depth3_tree():
    """Hidden DEFAULT subject + module; chapters Cells [s1, s2] and Tissues [s3]."""
    return [{"id": "sub", "name": "DEFAULT", "modules": [{"id": "mod", "name": "DEFAULT", "chapters": [
        {"id": "ch1", "name": "Cells", "slides": [slide("s1", "What is a cell"), slide("s2", "Organelles")]},
        {"id": "ch2", "name": "Tissues", "slides": [slide("s3", "Epithelium")]}]}]}]


def depth5_tree():
    return [
        {"id": "subA", "name": "Biology", "modules": [
            {"id": "m1", "name": "Basics", "chapters": [
                {"id": "ch1", "name": "Cells", "slides": [slide("s1", "What is a cell")]}]},
            {"id": "m2", "name": "Advanced", "chapters": [
                {"id": "ch2", "name": "Tissues", "slides": [slide("s2", "Epithelium")]}]}]},
        {"id": "subB", "name": "Chemistry", "modules": [
            {"id": "m3", "name": "Atoms", "chapters": [
                {"id": "ch3", "name": "Bonds", "slides": [slide("s3", "Covalent")]}]}]}]


class Backend:
    def __init__(self):
        self.calls = []
        self.course = {"id": "c1", "name": "Biology 101", "status": "DRAFT", "depth": 3}
        self.tree = depth3_tree()
        self.settings = {"other": True, "dripConditions": {"enabled": True, "conditions": [
            {"id": "d1", "level": "chapter", "level_id": "ch2", "drip_condition": [{"rules": [
                {"type": "date_based", "params": {"unlock_date": "2026-11-01"}}]}]},
            {"id": "d2", "level": "slide", "level_id": "s1", "drip_condition": [{"rules": [
                {"type": "prerequisite", "params": {"required_chapters": ["ch2"]}}]}]}]}}
        self.refuse = None

    async def admin_core(self, ctx_, method, path, *, params=None, body=None, timeout=30.0):
        self.calls.append({"method": method, "path": path, "body": body})
        if "/course/v1/restructure/" in path:
            if self.refuse:
                return {"error": "admin_core_rejected", "status": 510, "message": self.refuse}
            current_chapters = {c["id"]: c["name"] for s in self.tree for m in s["modules"] for c in m["chapters"]}
            kept = {c["id"] for s in body["subjects"] for m in s["modules"] for c in m["chapters"] if c.get("id")}
            removed = [{"level": "chapter", "id": cid, "name": n} for cid, n in current_chapters.items() if cid not in kept]
            first_kept = next(iter(kept), None)
            return {"dry_run": body["dry_run"], "depth_from": self.course["depth"], "depth_to": body["target_depth"],
                    "batches": 1, "learners_affected": 7, "slides_moved": 1,
                    "created": [{"level": "module", "id": "new", "name": "x"}], "renamed": [], "removed": removed,
                    "chapter_id_map": {r["id"]: first_kept for r in removed},
                    "drip_changes": ["row rule moved"] if removed else [], "warnings": [], "tree": body["subjects"]}
        if path.endswith("/institute/setting/v1/data"):
            return json.loads(json.dumps(self.settings))
        if path.endswith("/save-setting"):
            self.settings = body["setting_data"]
            return "ok"
        return "ok"

    def restructure_calls(self):
        return [c for c in self.calls if "/course/v1/restructure/" in c["path"]]


@pytest.fixture
def backend(monkeypatch):
    b = Backend()
    monkeypatch.setattr(cbd, "admin_core", b.admin_core)
    monkeypatch.setattr(cbd, "course_row", lambda c, cid: dict(b.course) if cid == "c1" else None)
    monkeypatch.setattr(cbd, "active_batch_id", lambda c, cid: "ps-1")
    monkeypatch.setattr(cbd, "course_tree", lambda c, cid, ps: json.loads(json.dumps(b.tree)))
    monkeypatch.setattr(cbd, "course_editor_url", lambda c, cid: f"https://dash/c/{cid}")
    return b


async def call(args, c=None):
    return json.loads(await execute_course_structure_edit({"course_id": "c1", **args}, c or ctx()))


def sent(b, i=-1):
    return b.restructure_calls()[i]["body"]


# ── registry ─────────────────────────────────────────────────────────────
def test_write_tool_is_off_by_default_with_its_own_group():
    spec = ASSISTANT_TOOLS["course_structure_edit"]
    assert spec.mode == "WRITE" and spec.key() == "course_structure_edits"
    assert not spec.default_enabled and not spec.default_roles
    assert not is_tool_allowed("course_structure_edit", principal(), {"enabled_tools": ["course_edits"],
                                                                      "role_overrides": {}})
    assert is_tool_allowed("course_structure_edit", principal(), {"enabled_tools": ["course_structure_edits"],
                                                                  "role_overrides": {}})


# ── going down: mechanical merge ─────────────────────────────────────────
async def test_3_to_2_merges_all_slides_into_the_existing_chapter(backend):
    out = await call({"action": "preview", "target_depth": 2})
    body = sent(backend)
    assert body["dry_run"] is True and body["target_depth"] == 2
    assert body["subjects"] == [{"id": "sub", "name": "DEFAULT", "modules": [{"id": "mod", "name": "DEFAULT",
                                 "chapters": [{"id": "ch1", "name": "DEFAULT", "slide_ids": ["s1", "s2", "s3"]}]}]}]
    assert out["after"] == {"slides": ["What is a cell", "Organelles", "Epithelium"]}
    assert out["removed"] == [{"level": "chapter", "name": "Tissues"}]
    assert out["confirm_token"] and "live_course" not in out
    assert backend.restructure_calls()[0]["path"] == "/admin-core-service/course/v1/restructure/inst-1/c1"


async def test_5_to_3_folds_subjects_and_modules_reusing_existing_containers(backend):
    backend.course["depth"], backend.tree = 5, depth5_tree()
    await call({"action": "preview", "target_depth": 3})
    (subject,) = sent(backend)["subjects"]
    (module,) = subject["modules"]
    assert subject["id"] == "subA" and subject["name"] == "DEFAULT"   # a current container takes the hidden role
    assert module["id"] == "m1" and module["name"] == "DEFAULT"
    assert [(c["id"], c["name"], c["slide_ids"]) for c in module["chapters"]] == [
        ("ch1", "Cells", ["s1"]), ("ch2", "Tissues", ["s2"]), ("ch3", "Bonds", ["s3"])]


# ── going up: the LLM's grouping ─────────────────────────────────────────
async def test_going_up_without_an_outline_asks_for_a_grouping_with_the_content(backend):
    out = await call({"action": "preview", "target_depth": 4})
    assert out["error"] == "outline_needed"
    assert [c["name"] for c in out["content"]["chapters"]] == ["Cells", "Tissues"]
    assert out["content"]["chapters"][0]["slides"][1] == {"id": "s2", "title": "Organelles"}
    assert not backend.restructure_calls()


async def test_3_to_4_first_new_module_takes_over_the_hidden_one(backend):
    outline = {"modules": [{"name": "Foundations", "chapters": [{"id": "ch1", "name": "Cells", "slide_ids": ["s1", "s2"]}]},
                           {"name": "Body systems", "chapters": [{"id": "ch2", "name": "Tissues", "slide_ids": ["s3"]}]}]}
    out = await call({"action": "preview", "target_depth": 4, "outline": outline})
    (subject,) = sent(backend)["subjects"]
    assert subject["id"] == "sub" and subject["name"] == "DEFAULT"
    assert [(m["id"], m["name"]) for m in subject["modules"]] == [("mod", "Foundations"), (None, "Body systems")]
    assert out["after"]["modules"][1] == {"name": "Body systems", "chapters": [{"name": "Tissues", "slides": ["Epithelium"]}]}


async def test_2_to_3_splits_slides_into_chapters(backend):
    backend.course["depth"] = 2
    backend.tree = [{"id": "sub", "name": "DEFAULT", "modules": [{"id": "mod", "name": "DEFAULT", "chapters": [
        {"id": "only", "name": "DEFAULT", "slides": [slide("s1", "A"), slide("s2", "B"), slide("s3", "C")]}]}]}]
    outline = {"chapters": [{"name": "Intro", "slide_ids": ["s1"]}, {"name": "Deep dive", "slide_ids": ["s2", "s3"]}]}
    await call({"action": "preview", "target_depth": 3, "outline": outline})
    chapters = sent(backend)["subjects"][0]["modules"][0]["chapters"]
    assert [(c["id"], c["name"]) for c in chapters] == [("only", "Intro"), (None, "Deep dive")]


async def test_outline_must_place_every_slide_once_and_use_this_courses_ids(backend):
    bad = {"modules": [{"name": "M", "chapters": [
        {"id": "ch1", "name": "Cells", "slide_ids": ["s1", "s1", "zz"]},
        {"id": "foreign", "name": "X", "slide_ids": []}]}]}
    out = await call({"action": "preview", "target_depth": 4, "outline": bad})
    text = " ".join(out["problems"])
    assert "zz" in text and "'What is a cell'" in text and "'Organelles'" in text and "foreign" in text
    assert not backend.restructure_calls()


async def test_same_depth_needs_an_outline_and_bad_depth_is_refused(backend):
    assert (await call({"action": "preview", "target_depth": 3}))["error"] == "nothing_to_change"
    assert (await call({"action": "preview", "target_depth": 6}))["error"] == "invalid_depth"
    assert (await call({"action": "preview", "target_depth": 2, "course_id": "nope"}))["error"] == "unknown_course"


# ── confirm, live, refusals ──────────────────────────────────────────────
async def test_apply_needs_the_token_of_the_identical_preview(backend):
    assert (await call({"action": "apply", "target_depth": 2}))["error"] == "confirm_required"
    token = (await call({"action": "preview", "target_depth": 2}))["confirm_token"]
    outline = {"chapters": [{"id": "ch1", "name": "Cells", "slide_ids": ["s2", "s1", "s3"]}]}
    changed = await call({"action": "apply", "target_depth": 3, "outline": outline, "confirm_token": token})
    assert changed["error"] == "confirm_token_mismatch"
    other = await call({"action": "apply", "target_depth": 2, "confirm_token": token}, ctx("admin-2"))
    assert other["error"] == "confirm_token_mismatch"
    assert all(c["body"]["dry_run"] for c in backend.restructure_calls())

    done = await call({"action": "apply", "target_depth": 2, "confirm_token": token})
    assert done["done"] is True and sent(backend)["dry_run"] is False
    assert {k: v for k, v in sent(backend).items() if k != "dry_run"} == \
           {k: v for k, v in sent(backend, 0).items() if k != "dry_run"}


async def test_live_courses_are_flagged_with_the_learners_affected(backend):
    backend.course["status"] = "ACTIVE"
    out = await call({"action": "preview", "target_depth": 2})
    assert "7 learner(s)" in out["live_course"] and "progress is kept" in out["live_course"]


async def test_admin_core_refusals_are_passed_through(backend):
    backend.refuse = "This content is shared with another course, so regrouping it here would change that course too"
    out = await call({"action": "preview", "target_depth": 2})
    assert out["error"] == "refused" and "shared with another course" in out["message"]
    assert "confirm_token" not in out


async def test_dashboard_drip_settings_follow_the_merge(backend):
    preview = await call({"action": "preview", "target_depth": 2})
    assert any("drip settings" in n for n in preview["drip_changes"])
    assert backend.settings["dripConditions"]["conditions"][0]["level_id"] == "ch2"   # preview wrote nothing
    await call({"action": "apply", "target_depth": 2, "confirm_token": preview["confirm_token"]})
    conds = backend.settings["dripConditions"]["conditions"]
    assert conds[0]["level_id"] == "ch1"                                               # the chapter rule moved
    assert conds[1]["drip_condition"][0]["rules"][0]["params"]["required_chapters"] == ["ch1"]
    assert backend.settings["other"] is True and backend.settings["dripConditions"]["enabled"] is True
