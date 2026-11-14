"""
Course builder over MCP: `courses`, `course_edit`, `course_drip_edit`, `course_invites_edit`.

The connected LLM writes the course; these tools only validate and persist. So
the tests pin down: the pure pieces (outline → structure with hidden DEFAULT
levels, slide specs → the exact admin-core payloads, payment specs → the
dashboard's payment-option shape, drip rule validation); every write is DRAFT
or additive; nothing is ever written to a course that is live; and the
institute-wide drip switches are never flipped.
"""
import json
import sys
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest  # noqa: E402
from app.schemas.auth import PinnedPrincipal  # noqa: E402
from app.services import course_builder_data as cbd  # noqa: E402
from app.services import course_content as cc  # noqa: E402
from app.services.assistant_tool_registry import ASSISTANT_TOOLS, ToolContext, is_tool_allowed  # noqa: E402
from app.services.assistant_tools_course_drip import (  # noqa: E402
    execute_course_drip_edit,
    upsert_conditions,
    validate_rule,
)
from app.services.assistant_tools_course_edit import execute_course_edit  # noqa: E402
from app.services.assistant_tools_course_invites import (  # noqa: E402
    build_payment_option,
    execute_course_invites_edit,
    field_key_for,
    form_fields_payload,
)
from app.services.assistant_tools_courses import execute_courses  # noqa: E402


class _FakeDb:
    def execute(self, stmt, params=None):
        return SimpleNamespace(first=lambda: None, fetchall=lambda: [])

    def rollback(self):
        pass


def principal(roles=("ADMIN",)):
    return PinnedPrincipal(user_id="user-1", institute_id="inst-1", roles=list(roles), permissions=[], is_root_user=False)


def ctx():
    return ToolContext(db=_FakeDb(), principal=principal(), keys=(), bearer_token="jwt")


GOOD_HTML = "<!DOCTYPE html><html><head><style>p{}</style></head><body><h1>Photosynthesis</h1>" + (
    "<p>Plants turn light, water and carbon dioxide into glucose and oxygen inside their chloroplasts. " * 20
) + "</p></body></html>"


# ── fake backend ─────────────────────────────────────────────────────────
def _mapping(cf_id, key, label, ftype="text", config="", required=False, order=None):
    """A custom-field mapping as admin-core returns it (snake_case outside, camelCase inside)."""
    return {"id": f"map-{cf_id}", "status": "ACTIVE", "is_mandatory": required, "individual_order": order,
            "custom_field": {"id": cf_id, "fieldKey": key, "fieldName": label, "fieldType": ftype, "config": config,
                             "isMandatory": required}}


class Backend:
    """Records admin-core calls and answers them like admin-core does."""

    def __init__(self):
        self.calls = []
        self.course = {"id": "course-1", "name": "Biology 101", "status": "DRAFT", "depth": 3,
                       "created_by_user_id": "user-1", "about_the_course": "<p>About</p>", "why_learn": "",
                       "who_should_learn": "", "tags": "bio", "course_preview_image_media_id": "",
                       "course_banner_media_id": ""}
        self.tree = [{"id": "sub-1", "name": "DEFAULT", "modules": [{"id": "mod-1", "name": "DEFAULT", "chapters": [
            {"id": "ch-1", "name": "Cells", "order": 1, "status": "ACTIVE",
             "slides": [{"id": "sl-1", "title": "What is a cell", "type": "DOCUMENT", "source_id": "doc-1",
                         "status": "DRAFT", "order": 1}]},
        ]}]}]
        self.settings = {"otherSetting": {"keep": True},
                         "dripConditions": {"enabled": False, "applyConfiguredRules": False, "conditions": [
                             {"id": "drip-old", "level": "chapter", "level_id": "other-course-ch", "enabled": True,
                              "drip_condition": []}]}}
        self.vendors = [{"vendor": "RAZORPAY", "vendor_id": "RAZORPAY"}]
        self.invites = [{"id": "inv-default", "name": "Biology 101", "status": "ACTIVE", "tag": "DEFAULT",
                         "is_default": True, "short_url": "https://l.ink/a", "link_id": "link-1",
                         "links": [{"link_id": "link-1", "package_session_id": "ps-1"}], "batch_ids": ["ps-1"],
                         "payment_option_id": "po-inst", "payment_type": "FREE", "plans": []}]
        self.batches = [{"id": "ps-1", "name": "Default batch", "session": None, "session_id": None,
                         "level": None, "level_id": None, "start_date": None, "enrolled": 0}]
        self.sessions_levels = {"sessions": [{"id": "sess-2026", "name": "2026-27"}],
                                "levels": [{"id": "lvl-9", "name": "Class 9"}]}
        self.counter = 0
        self.catalogue = [_mapping("cf-name", "full_name", "Full Name", required=True)]
        self.feature_fields = [_mapping("cf-name", "full_name", "Full Name", required=True, order=0),
                               _mapping("cf-email", "email", "Email", required=True, order=1),
                               _mapping("cf-class", "class_inst_inst-1", "Class", "dropdown",
                                        '[{"id":1,"value":"9","label":"9"},{"id":2,"value":"10","label":"10"}]',
                                        order=2)]
        self.full_invite = {
            "id": "inv-default", "name": "Biology 101", "start_date": "2026-09-01", "end_date": None,
            "invite_code": "ABC123", "status": "ACTIVE", "institute_id": "inst-1", "vendor": "RAZORPAY",
            "vendor_id": "RAZORPAY", "currency": "INR", "tag": "DEFAULT", "learner_access_days": 90,
            "is_bundled": False, "short_url": "https://l.ink/a", "sub_org_id": None,
            "availability_status": "AVAILABLE", "gtm_container_id": None,
            "web_page_meta_data_json": json.dumps({"course": "Biology 101", "description": "<p>Old</p>",
                                                   "aboutCourse": "<p>About</p>", "tags": ["bio"],
                                                   "coursePreview": "file-old", "courseMedia": {"type": "", "id": ""},
                                                   "includePaymentPlans": True}),
            "setting_json": json.dumps({"postformfillConfiguration": {"showLoginButton": True},
                                        "setting": {"AUTOPAY_SETTING": {"ENABLED": True}}}),
            "institute_custom_fields": self.feature_fields,
            "package_session_to_payment_options": [
                {"id": "link-1", "package_session_id": "ps-1", "enroll_invite_id": "inv-default", "status": "ACTIVE",
                 "payment_option": {"id": "po-inst", "name": "Free", "payment_plans": []}}],
        }
        self.slide_dto = {"id": "sl-1", "title": "What is a cell", "status": "DRAFT", "source_type": "DOCUMENT",
                          "new_slide": False, "is_loaded": True,
                          "document_slide": {"id": "doc-1", "type": "HTML", "data": "<html>cell</html>",
                                             "published_data": None, "total_pages": 1}}

    def _id(self, prefix):
        self.counter += 1
        return f"{prefix}-{self.counter}"

    async def admin_core(self, ctx_, method, path, *, params=None, body=None, timeout=30.0):
        self.calls.append({"method": method, "path": path, "params": params or {}, "body": body})
        if path.endswith("/add-course/inst-1"):
            self.created_name = body["course_name"]
            return "course-new"
        if path.endswith("/course/v1/copy-content"):
            return {"copiedSubjects": 1, "copiedModules": 1, "copiedChapters": 1, "copiedSlides": 1, "warnings": []}
        if path.endswith("/course-new/batches"):
            return [{"id": b} for b in getattr(self, "new_batch_ids", ["ps-new"])]
        if path.endswith("/add-subject"):
            return {"id": self._id("sub"), "subject_name": body["subject_name"]}
        if path.endswith("/add-module"):
            return {"id": self._id("mod")}
        if path.endswith("/add-chapter"):
            return {"id": self._id("ch")}
        if "/slide/" in path and method == "POST":
            return body["id"]
        if path.endswith("/institute/setting/v1/data"):
            return json.loads(json.dumps(self.settings))
        if path.endswith("/save-setting"):
            self.settings = body["setting_data"]
            return "ok"
        if path.endswith("/v1/payment-option") and method == "POST":
            return {**body, "id": self._id("po")}
        if path.endswith("/v1/enroll-invite") and method == "POST":
            return self._id("inv")
        if "/course/v1/update-course/" in path and method == "PUT":
            for col in ("course_preview_image_media_id", "course_banner_media_id", "course_media_id"):
                self.course[col] = body.get(col)
            return "Course updated successfully"
        if path.endswith("/v1/enroll-invite/inst-1/inv-default"):
            return json.loads(json.dumps(self.full_invite))
        if path.endswith("/common/custom-fields/feature-fields"):
            if method == "POST":
                self.feature_fields = body
                return "synced"
            return json.loads(json.dumps(self.feature_fields))
        if "/v1/enroll-invite/inst-1/" in path:
            return {"short_url": "https://l.ink/new", "invite_code": "ABC123", "availability_status": "AVAILABLE"}
        if path.endswith("/slide/v1/slide") and method == "GET":
            return json.loads(json.dumps(self.slide_dto))
        if path.endswith("/common/custom-fields"):
            return json.loads(json.dumps(self.catalogue))
        return "ok"


@pytest.fixture
def backend(monkeypatch):
    b = Backend()
    monkeypatch.setattr(cbd, "admin_core", b.admin_core)
    def _course_row(c, cid):
        if cid == b.course["id"]:
            return dict(b.course)
        if cid == "course-new":
            return {**b.course, "id": "course-new", "name": getattr(b, "created_name", None)}
        return None
    monkeypatch.setattr(cbd, "course_row", _course_row)
    monkeypatch.setattr(cbd, "active_batch_id", lambda c, cid: "ps-1")
    monkeypatch.setattr(cbd, "course_tree", lambda c, cid, ps: json.loads(json.dumps(b.tree)))
    monkeypatch.setattr(cbd, "invites_for_batches",
                        lambda c, ps: [dict(i) for i in b.invites if set(i["batch_ids"]) & set(ps)])
    monkeypatch.setattr(cbd, "invites_for_batch", lambda c, ps: [dict(i) for i in b.invites if ps in i["batch_ids"]])
    monkeypatch.setattr(cbd, "invite_row", lambda c, iid, ps: next((dict(i) for i in b.invites if i["id"] == iid), None))
    def _batches(c, cid):
        if cid == "course-new":
            return [{"id": x, "name": f"batch {x}", "session": None, "level": None, "enrolled": 0}
                    for x in getattr(b, "new_batch_ids", ["ps-new"])]
        return [dict(x) for x in b.batches]
    monkeypatch.setattr(cbd, "course_batches", _batches)
    monkeypatch.setattr(cbd, "institute_sessions_levels", lambda c: b.sessions_levels)
    monkeypatch.setattr(cbd, "enrolled_count", lambda c, ps: 0)

    async def _vendors(c):
        return b.vendors
    monkeypatch.setattr(cbd, "payment_vendors", _vendors)

    def _chapter(c, chapter_id):
        if chapter_id != "ch-1":
            return None
        return {"chapter_id": "ch-1", "chapter_name": "Cells", "module_id": "mod-1", "subject_id": "sub-1",
                "package_session_id": "ps-1", "course_id": "course-1", "course_status": b.course["status"],
                "course_depth": 3}
    monkeypatch.setattr(cbd, "chapter_context", _chapter)

    def _slide(c, slide_id):
        if slide_id != "sl-1":
            return None
        return {**_chapter(c, "ch-1"), "slide_id": "sl-1", "title": "What is a cell", "source_type": "DOCUMENT",
                "source_id": "doc-1", "slide_status": "DRAFT", "slide_order": 1}
    monkeypatch.setattr(cbd, "slide_context", _slide)
    monkeypatch.setattr(cbd, "course_editor_url", lambda c, cid: f"https://dash/c/{cid}")
    b.existing_field_keys = {}

    def _update_body(c, cid):
        if cid != b.course["id"]:
            return None
        return {"id": cid, "package_name": b.course["name"], "thumbnail_file_id": None,
                "is_course_published_to_catalaouge": True,
                "course_preview_image_media_id": b.course.get("course_preview_image_media_id"),
                "course_banner_media_id": b.course.get("course_banner_media_id"),
                "course_media_id": b.course.get("course_media_id"), "why_learn_html": "<p>Why</p>",
                "who_should_learn_html": None, "about_the_course_html": b.course["about_the_course"],
                "tags": ["bio"], "course_depth": 3, "course_html_description_html": "<p>Desc</p>"}
    monkeypatch.setattr(cbd, "course_update_body", _update_body)
    monkeypatch.setattr(cbd, "custom_fields_by_keys",
                        lambda c, keys: {k: b.existing_field_keys[k] for k in keys if k in b.existing_field_keys})

    async def _public_url(c, fid):
        return f"https://cdn/{fid}" if fid else None
    import app.services.assistant_tool_registry as registry
    monkeypatch.setattr(registry, "_media_public_url", _public_url)
    return b


async def edit(args):
    return json.loads(await execute_course_edit(args, ctx()))


async def drip(args):
    return json.loads(await execute_course_drip_edit(args, ctx()))


async def invites(args):
    return json.loads(await execute_course_invites_edit(args, ctx()))


async def read(args):
    return json.loads(await execute_courses(args, ctx()))


# ── registry / gating ────────────────────────────────────────────────────
def test_read_tool_on_for_admins_writes_off_by_default():
    assert ASSISTANT_TOOLS["courses"].mode == "READ"
    assert is_tool_allowed("courses", principal(), {"enabled_tools": ["courses"], "role_overrides": {}})
    for name, group in (("course_edit", "course_edits"), ("course_drip_edit", "course_drip_edits"),
                        ("course_invites_edit", "course_invite_edits")):
        spec = ASSISTANT_TOOLS[name]
        assert spec.mode == "WRITE" and spec.key() == group
        assert not spec.default_enabled and not spec.default_roles
        assert not is_tool_allowed(name, principal(), None)
        assert is_tool_allowed(name, principal(), {"enabled_tools": [group], "role_overrides": {}})


# ── pure: outline ────────────────────────────────────────────────────────
def test_depth_3_outline_gets_hidden_default_subject_and_module():
    out, problem = cc.normalize_outline({"course": {"name": "Bio"}, "chapters": [
        {"name": "Cells", "slides": [{"type": "document", "title": "Intro"}, "Intro"]}]})
    assert problem is None and out["depth"] == 3
    assert out["subjects"][0]["name"] == "DEFAULT" and out["subjects"][0]["modules"][0]["name"] == "DEFAULT"
    titles = [s["title"] for s in out["subjects"][0]["modules"][0]["chapters"][0]["slides"]]
    assert titles == ["Intro", "Intro (part 2)"]  # unique within a chapter


def test_depth_2_folds_everything_into_one_hidden_chapter():
    out, _ = cc.normalize_outline({"course": {"name": "Bio", "depth": 2}, "slides": ["A", "B"]})
    chapter = out["subjects"][0]["modules"][0]["chapters"]
    assert len(chapter) == 1 and chapter[0]["name"] == "DEFAULT" and len(chapter[0]["slides"]) == 2


def test_depth_4_and_5_keep_real_levels():
    out4, _ = cc.normalize_outline({"course": {"name": "X", "depth": 4},
                                    "modules": [{"name": "M1", "chapters": [{"name": "C1"}]}]})
    assert out4["subjects"][0]["name"] == "DEFAULT" and out4["subjects"][0]["modules"][0]["name"] == "M1"
    out5, _ = cc.normalize_outline({"course": {"name": "X", "depth": 5}, "subjects": [
        {"name": "S1", "modules": [{"name": "M1", "chapters": [{"name": "C1"}]}]}]})
    assert out5["subjects"][0]["name"] == "S1"
    _, problem = cc.normalize_outline({"course": {"name": "X", "depth": 5}, "chapters": [{"name": "C"}]})
    assert "subjects" in problem


# ── pure: slides ─────────────────────────────────────────────────────────
def test_document_slide_is_draft_html_and_placeholders_are_removed():
    html = GOOD_HTML.replace("<h1>", '<img data-img-prompt="a leaf" src="placeholder.png"><img src="https://evil.example/x.png"><h1>')
    req, report = cc.build_slide_request({"type": "document", "title": "Leaf", "html": html}, slide_order=2)
    body = req["body"]
    assert req["path"].endswith("/add-update-document-slide")
    assert body["status"] == "DRAFT" and body["new_slide"] is True and body["slide_order"] == 2
    assert body["document_slide"]["type"] == "HTML" and body["document_slide"]["published_data"] is None
    assert "data-img-prompt" not in body["document_slide"]["data"] and "evil.example" not in body["document_slide"]["data"]
    assert report["image_placeholders_removed"] == 1 and report["images_removed"] == 1


def test_thin_document_warns_and_empty_is_rejected():
    _, report = cc.build_slide_request({"type": "document", "title": "T", "html": "<p>short</p>"}, slide_order=1)
    assert "warning" in report
    req, report = cc.build_slide_request({"type": "document", "title": "T", "html": ""}, slide_order=1)
    assert req is None and report["problem"]


def test_video_must_be_youtube():
    ok, _ = cc.build_slide_request({"type": "video", "title": "V", "url": "https://youtu.be/dQw4w9WgXcQ"}, slide_order=1)
    assert ok["body"]["video_slide"]["embedded_type"] == "YOUTUBE"
    bad, report = cc.build_slide_request({"type": "video", "title": "V", "url": "https://vimeo.com/1"}, slide_order=1)
    assert bad is None and "YouTube" in report["problem"]


def test_quiz_keeps_every_question_type_and_answers_by_option_id():
    req, report = cc.build_slide_request({"type": "quiz", "title": "Q", "questions": [
        {"type": "MCQM", "question": "Pick two", "options": ["a", "b", "c"], "correct": [0, 2], "explanation": "x"},
        {"type": "TRUE_FALSE", "question": "Sky is blue", "correct": [0], "explanation": "y"},
        {"type": "ONE_WORD", "question": "H2O is?", "answer": "water", "explanation": "z"},
        {"type": "NUMERIC", "question": "2+2", "answer": 4, "explanation": "w"},
        {"type": "LONG_ANSWER", "question": "Explain", "answer": "model answer"},
    ]}, slide_order=1)
    qs = req["body"]["quiz_slide"]["questions"]
    assert [q["question_type"] for q in qs] == ["MCQM", "TRUE_FALSE", "ONE_WORD", "NUMERIC", "LONG_ANSWER"]
    mcqm = qs[0]
    assert json.loads(mcqm["auto_evaluation_json"]) == {"correctAnswers": [mcqm["options"][0]["id"], mcqm["options"][2]["id"]]}
    assert [o["text"]["content"] for o in qs[1]["options"]] == ["True", "False"]
    assert json.loads(qs[2]["auto_evaluation_json"]) == {"data": {"answer": "water"}}
    assert qs[3]["question_response_type"] == "NUMERIC" and qs[4]["evaluation_type"] == "MANUAL"
    assert report["warning"]  # the long answer has no explanation


@pytest.mark.parametrize("question, needle", [
    ({"type": "MCQS", "question": "q", "options": ["a", "b"], "correct": [0, 1]}, "exactly one"),
    ({"type": "MCQS", "question": "q", "options": ["a"], "correct": [0]}, "2-6 options"),
    ({"type": "MCQS", "question": "q", "options": ["a", "b"], "correct": [5]}, "option indexes"),
    ({"type": "NUMERIC", "question": "q", "answer": "four"}, "number"),
    ({"type": "ESSAY", "question": "q"}, "type must be"),
])
def test_bad_questions_are_named(question, needle):
    req, report = cc.build_slide_request({"type": "quiz", "title": "Q", "questions": [question]}, slide_order=1)
    assert req is None and needle in report["problem"]


def test_pdf_needs_media_file_id_and_assignment_needs_instructions():
    req, report = cc.build_slide_request({"type": "pdf", "title": "P", "file_id": "https://x/y.pdf"}, slide_order=1)
    assert req is None and "import_pdf" in report["problem"]
    req, _ = cc.build_slide_request({"type": "pdf", "title": "P", "file_id": "file-9"}, slide_order=1)
    assert req["body"]["document_slide"] == {**req["body"]["document_slide"], "type": "PDF", "data": "file-9"}
    req, _ = cc.build_slide_request({"type": "assignment", "title": "A", "instructions_html": "<p>Do it</p>",
                                     "end_date": "2026-11-01"}, slide_order=1)
    assert req["body"]["assignment_slide"]["end_date"] == "2026-11-01T00:00:00Z"


# ── course_edit ──────────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_create_course_builds_a_draft_off_catalogue_with_hidden_levels(backend):
    out = await edit({"action": "create_course", "course": {"name": "Plants", "about_html": "<p>About</p>"},
                      "chapters": [
                          {"name": "Leaves", "slides": [{"type": "document", "title": "Leaf", "html": GOOD_HTML},
                                                        {"type": "quiz", "title": "Leaf quiz"}]},
                          {"name": "Roots", "slides": ["Root intro"]},
                      ]})
    add_course = next(c for c in backend.calls if c["path"].endswith("/add-course/inst-1"))["body"]
    assert add_course["status"] == "DRAFT" and add_course["is_course_published_to_catalaouge"] is False
    assert add_course["new_course"] and add_course["force_new_course"] and add_course["contain_levels"] is False
    subjects = [c for c in backend.calls if c["path"].endswith("/add-subject")]
    modules = [c for c in backend.calls if c["path"].endswith("/add-module")]
    assert [s["body"]["subject_name"] for s in subjects] == ["DEFAULT"]
    assert [m["body"]["module_name"] for m in modules] == ["DEFAULT"]
    slides = [c for c in backend.calls if "/slide/" in c["path"]]
    assert len(slides) == 1 and slides[0]["body"]["status"] == "DRAFT"
    assert slides[0]["params"]["packageSessionId"] == "ps-new" and slides[0]["params"]["instituteId"] == "inst-1"
    assert [t["title"] for t in out["todo"]] == ["Leaf quiz", "Root intro"]
    assert out["course"] == {"id": "course-new", "name": "Plants", "status": "DRAFT", "depth": 3, "batch_id": "ps-new"}
    assert out["batches"] == [{"id": "ps-new", "name": "batch ps-new", "session": None, "level": None}]
    assert "default_invites" in out
    assert not out["failures"]


@pytest.mark.asyncio
async def test_invalid_inline_slide_creates_nothing(backend):
    out = await edit({"action": "create_course", "course": {"name": "Plants"}, "chapters": [
        {"name": "Leaves", "slides": [{"type": "video", "title": "V", "url": "https://example.com/v"}]}]})
    assert out["error"] == "invalid_slides" and not backend.calls


@pytest.mark.asyncio
async def test_slide_writes_refused_on_courses_that_are_not_draft(backend):
    backend.course["status"] = "ACTIVE"
    out = await edit({"action": "add_slide", "chapter_id": "ch-1",
                      "slide": {"type": "document", "title": "New", "html": GOOD_HTML}})
    assert out["error"] == "course_not_draft" and not backend.calls
    out = await edit({"action": "discard_slide", "slide_id": "sl-1"})
    assert out["error"] == "not_draft"


@pytest.mark.asyncio
async def test_add_slide_appends_as_draft_and_rejects_duplicate_titles(backend):
    out = await edit({"action": "add_slide", "chapter_id": "ch-1",
                      "slide": {"type": "video", "title": "Cells on video", "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"}})
    assert out["slide"]["status"] == "DRAFT" and out["slide"]["position"] == 2
    body = backend.calls[-1]["body"]
    assert body["slide_order"] == 2 and body["video_slide"]["url"].startswith("https://www.youtube.com")
    dup = await edit({"action": "add_slide", "chapter_id": "ch-1",
                      "slide": {"type": "document", "title": "what is a CELL", "html": GOOD_HTML}})
    assert dup["error"] == "duplicate_title"


@pytest.mark.asyncio
async def test_update_slide_keeps_ids_and_type(backend):
    out = await edit({"action": "update_slide", "slide_id": "sl-1",
                      "slide": {"type": "quiz", "title": "x", "questions": []}})
    assert out["error"] == "type_mismatch"
    out = await edit({"action": "update_slide", "slide_id": "sl-1",
                      "slide": {"type": "document", "title": "What is a cell", "html": GOOD_HTML}})
    body = backend.calls[-1]["body"]
    assert out["slide"]["status"] == "DRAFT"
    assert body["id"] == "sl-1" and body["new_slide"] is False and body["document_slide"]["id"] == "doc-1"


@pytest.mark.asyncio
async def test_reorder_needs_every_slide(backend):
    out = await edit({"action": "reorder", "chapter_id": "ch-1", "slide_ids": ["sl-1", "sl-x"]})
    assert out["error"] == "bad_request" and out["current_order"] == ["sl-1"]


# ── drip ─────────────────────────────────────────────────────────────────
def test_rule_validation_mirrors_dashboard():
    assert validate_rule({"type": "relative_date", "params": {"unlock_on_day": 0}})[1]
    assert validate_rule({"type": "relative_date", "params": {"unlock_on_day": 3, "unlock_time": "9:00"}})[1]
    assert validate_rule({"type": "prerequisite", "params": {"threshold": 80}})[1]
    assert validate_rule({"type": "completion_based", "params": {"metric": "average_of_last_n", "threshold": 50}})[1]
    rule, problem = validate_rule({"type": "sequential", "params": {"threshold": 100}})
    assert problem is None and rule == {"type": "sequential", "params": {"requires_previous": True, "threshold": 100}}


def test_upsert_replaces_rules_on_the_same_item_only():
    old = [{"level": "chapter", "level_id": "a", "id": "1"}, {"level": "chapter", "level_id": "b", "id": "2"}]
    new = [{"level": "chapter", "level_id": "a", "id": "3"}]
    assert [c["id"] for c in upsert_conditions(old, new)] == ["2", "3"]


@pytest.mark.asyncio
async def test_set_rules_preserves_the_rest_of_the_setting_and_never_flips_switches(backend):
    out = await drip({"action": "set_rules", "course_id": "course-1", "items": [
        {"level": "chapter", "id": "ch-1", "rules": [{"type": "sequential", "params": {"threshold": 80}}]}]})
    saved = backend.settings
    assert saved["otherSetting"] == {"keep": True}
    assert saved["dripConditions"]["enabled"] is False and saved["dripConditions"]["applyConfiguredRules"] is False
    ids = [(c["level"], c["level_id"]) for c in saved["dripConditions"]["conditions"]]
    assert ids == [("chapter", "other-course-ch"), ("chapter", "ch-1")]
    assert any("switched OFF" in n for n in out["notes"]) and any("Progress rules" in n for n in out["notes"])


@pytest.mark.asyncio
async def test_drip_refuses_live_courses_and_foreign_items(backend):
    out = await drip({"action": "set_rules", "course_id": "course-1", "items": [
        {"level": "chapter", "id": "not-mine", "rules": [{"type": "sequential", "params": {}}]}]})
    assert out["error"] == "invalid_rules"
    backend.course["status"] = "ACTIVE"
    out = await drip({"action": "schedule", "course_id": "course-1"})
    assert out["error"] == "course_is_live" and not any(c["path"].endswith("/save-setting") for c in backend.calls)


@pytest.mark.asyncio
async def test_schedule_releases_chapters_day_by_day(backend):
    out = await drip({"action": "schedule", "course_id": "course-1", "start_day": 2, "interval_days": 7})
    assert out["schedule"] == [{"name": "Cells", "day": 2}]
    rule = backend.settings["dripConditions"]["conditions"][-1]["drip_condition"][0]["rules"][0]
    assert rule == {"type": "relative_date", "params": {"unlock_on_day": 2, "anchor": "enrollment", "unlock_time": "00:00"}}


# ── invites & payment ────────────────────────────────────────────────────
def test_payment_specs_become_dashboard_shaped_options():
    one, problem = build_payment_option(ctx(), {"type": "ONE_TIME", "price": 999, "strike_price": 1999,
                                                "currency": "inr"}, "Bio")
    assert problem is None and one["type"] == "ONE_TIME" and one["source"] == "INSTITUTE"
    assert one["payment_plans"][0]["actual_price"] == 999 and one["payment_plans"][0]["elevated_price"] == 1999
    assert one["payment_plans"][0]["validity_in_days"] is None  # lifetime
    sub, _ = build_payment_option(ctx(), {"type": "SUBSCRIPTION", "currency": "USD", "plans": [
        {"name": "Monthly", "price": 10, "validity_days": 30}, {"name": "Yearly", "price": 100, "validity_days": 365}]}, "Bio")
    assert [p["validity_in_days"] for p in sub["payment_plans"]] == [30, 365]
    assert json.loads(sub["payment_option_metadata_json"])["config"]["subscription"]["customIntervals"][1]["value"] == 365
    assert build_payment_option(ctx(), {"type": "ONE_TIME", "price": 10}, "Bio")[1].startswith("payment.currency")
    assert "FREE" in build_payment_option(ctx(), {"type": "ONE_TIME", "price": 0, "currency": "INR"}, "Bio")[1]


def test_form_starts_with_institute_defaults_and_adds_new_fields():
    defaults = [{"status": "ACTIVE", "is_mandatory": True, "custom_field": {"id": "cf-1", "fieldKey": "full_name",
                                                                             "fieldName": "Full Name", "fieldType": "text"}}]
    fields, problem = form_fields_payload(ctx(), defaults, [
        {"label": "Full Name"}, {"label": "Class", "type": "dropdown", "options": ["9", "10"], "required": True}])
    assert problem is None
    assert [f["custom_field"]["fieldName"] for f in fields] == ["Full Name", "Class"]
    assert fields[0]["custom_field"]["id"] == "cf-1" and fields[1]["custom_field"]["id"] == ""
    assert json.loads(fields[1]["custom_field"]["config"])[1]["value"] == "10"


@pytest.mark.asyncio
async def test_create_invite_creates_plan_then_untagged_invite_then_default(backend):
    out = await invites({"action": "create_invite", "course_id": "course-1", "make_default": True,
                         "payment": {"type": "ONE_TIME", "price": 4999, "currency": "INR"}})
    paths = [c["path"] for c in backend.calls]
    po = paths.index("/admin-core-service/v1/payment-option")
    inv = paths.index("/admin-core-service/v1/enroll-invite")
    default = paths.index("/admin-core-service/v1/enroll-invite/update-default-enroll-invite-config")
    assert po < inv < default
    invite_body = backend.calls[inv]["body"]
    assert invite_body["tag"] == "" and invite_body["vendor"] == "RAZORPAY" and invite_body["currency"] == "INR"
    assert invite_body["package_session_to_payment_options"][0]["package_session_id"] == "ps-1"
    assert out["invite"]["link"] == "https://l.ink/new" and out["invite"]["is_default"] is True
    assert out["payment"]["plans"][0]["price"] == 4999


@pytest.mark.asyncio
async def test_create_invite_never_assumes_a_price_and_needs_a_gateway_for_paid(backend):
    out = await invites({"action": "create_invite", "course_id": "course-1"})
    assert out["error"] == "missing_argument" and not backend.calls
    backend.vendors = []
    out = await invites({"action": "create_invite", "course_id": "course-1",
                         "payment": {"type": "ONE_TIME", "price": 10, "currency": "INR"}})
    assert out["error"] == "no_payment_gateway"
    assert not any(c["path"].endswith("/v1/payment-option") for c in backend.calls)
    out = await invites({"action": "create_invite", "course_id": "course-1", "payment": {"type": "FREE"}})
    assert out["invite"]["id"] and out["payment"]["type"] == "FREE"


@pytest.mark.asyncio
async def test_live_course_invites_are_only_ever_added(backend):
    backend.course["status"] = "ACTIVE"
    out = await invites({"action": "make_default", "course_id": "course-1", "invite_id": "inv-default"})
    assert out["error"] == "course_is_live"
    out = await invites({"action": "create_payment_plan", "course_id": "course-1", "invite_id": "inv-default",
                         "payment": {"type": "FREE"}})
    assert out["error"] == "course_is_live"
    out = await invites({"action": "create_invite", "course_id": "course-1", "make_default": True,
                         "payment": {"type": "FREE"}})
    assert out["invite"]["is_default"] is False
    assert not any("update-default" in c["path"] for c in backend.calls)


@pytest.mark.asyncio
async def test_create_payment_plan_replaces_the_link_on_a_draft_course_invite(backend):
    out = await invites({"action": "create_payment_plan", "course_id": "course-1", "invite_id": "inv-default",
                         "payment": {"type": "ONE_TIME", "price": 500, "currency": "INR"}})
    swap = backend.calls[-1]
    assert swap["path"].endswith("/enroll-invite-payment-option")
    assert swap["body"][0]["update_payment_options"][0]["old_package_session_payment_option_id"] == "link-1"
    assert out["invite"]["id"] == "inv-default"


# ── read tool ────────────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_get_folds_hidden_levels_and_schema_has_the_contract(backend):
    out = await read({"action": "get", "course_id": "course-1"})
    assert out["chapters"][0]["name"] == "Cells" and "subjects" not in out
    assert out["chapters"][0]["slides"][0]["type"] == "document" and out["writable"] is True
    schema = await read({"action": "schema"})
    assert set(schema["slides"]) == set(cc.SLIDE_TYPES) | {"status"} and schema["workflow"]
    assert (await read({"action": "get", "course_id": "nope"}))["error"] == "unknown_course"


@pytest.mark.asyncio
async def test_drip_read_reports_switches_in_plain_language(backend):
    backend.settings["dripConditions"]["conditions"].append({
        "id": "d1", "level": "chapter", "level_id": "ch-1", "enabled": True,
        "drip_condition": [{"target": "chapter", "behavior": "lock", "is_enabled": True,
                            "rules": [{"type": "relative_date", "params": {"unlock_on_day": 3}}]}]})
    out = await read({"action": "drip", "course_id": "course-1"})
    assert out["institute_drip_enabled"] is False
    assert out["rules"] == [{"level": "chapter", "id": "ch-1", "name": "Cells", "applies_to": "chapter",
                             "behavior": "lock", "enabled": True,
                             "rules": ["unlocks on day 3 after enrollment at 00:00"]}]


# ── regressions found by the end-to-end run ──────────────────────────────
@pytest.mark.asyncio
async def test_create_course_reports_the_name_admin_core_saved(backend, monkeypatch):
    """admin-core uniquifies a name already used by a DRAFT/ACTIVE course ("X (2)")."""
    real = cbd.course_row
    monkeypatch.setattr(cbd, "course_row", lambda c, cid: {**(real(c, cid) or {}), "name": "Plants (2)"}
                        if cid == "course-new" else real(c, cid))
    out = await edit({"action": "create_course", "course": {"name": "Plants"}, "chapters": [{"name": "Leaves"}]})
    assert out["course"]["name"] == "Plants (2)"


@pytest.mark.asyncio
async def test_a_slide_rejected_mid_create_is_reported_not_fatal(backend, monkeypatch):
    original = backend.admin_core

    async def flaky(ctx_, method, path, **kw):
        if "/slide/" in path:
            backend.calls.append({"method": method, "path": path, "params": kw.get("params") or {}, "body": kw.get("body")})
            return {"error": "admin_core_rejected", "status": 500, "message": "boom"}
        return await original(ctx_, method, path, **kw)

    monkeypatch.setattr(cbd, "admin_core", flaky)
    out = await edit({"action": "create_course", "course": {"name": "Plants"}, "chapters": [
        {"name": "Leaves", "slides": [{"type": "document", "title": "Leaf", "html": GOOD_HTML}]}]})
    assert out["course"]["id"] == "course-new" and out["chapters"][0]["slides"] == []
    assert out["failures"] == ["slide 'Leaf': boom"]
    assert out["todo"] == [{"chapter_id": out["chapters"][0]["id"], "chapter": "Leaves", "position": 1,
                            "type": "document", "title": "Leaf", "retry": True}]


# ── slide status: DRAFT unless asked; publish on request ─────────────────
@pytest.mark.asyncio
async def test_slides_are_draft_unless_the_admin_asks_for_published(backend):
    out = await edit({"action": "add_slide", "chapter_id": "ch-1",
                      "slide": {"type": "document", "title": "Draft one", "html": GOOD_HTML}})
    body = backend.calls[-1]["body"]
    assert out["slide"]["status"] == "DRAFT" and body["status"] == "DRAFT"
    assert body["document_slide"]["published_data"] is None

    out = await edit({"action": "add_slide", "chapter_id": "ch-1",
                      "slide": {"type": "document", "title": "Public one", "html": GOOD_HTML, "status": "public"}})
    body = backend.calls[-1]["body"]
    assert out["slide"]["status"] == "PUBLISHED" and body["status"] == "PUBLISHED"
    assert body["document_slide"]["published_data"] == body["document_slide"]["data"]

    out = await edit({"action": "add_slide", "chapter_id": "ch-1", "status": "PUBLISHED",
                      "slide": {"type": "video", "title": "Live video", "url": "https://youtu.be/dQw4w9WgXcQ"}})
    body = backend.calls[-1]["body"]
    assert out["slide"]["status"] == "PUBLISHED" and body["video_slide"]["published_url"] == "https://youtu.be/dQw4w9WgXcQ"

    out = await edit({"action": "add_slide", "chapter_id": "ch-1",
                      "slide": {"type": "document", "title": "Odd", "html": GOOD_HTML, "status": "archived"}})
    assert out["error"] == "invalid_slide" and "DRAFT or PUBLISHED" in out["message"]


@pytest.mark.asyncio
async def test_create_course_status_per_call_and_per_slide(backend):
    out = await edit({"action": "create_course", "status": "PUBLISHED", "course": {"name": "Plants"}, "chapters": [
        {"name": "Leaves", "slides": [
            {"type": "document", "title": "Leaf", "html": GOOD_HTML},
            {"type": "document", "title": "Leaf draft", "html": GOOD_HTML, "status": "DRAFT"}]}]})
    slides = [c["body"] for c in backend.calls if "/slide/" in c["path"]]
    assert [b["status"] for b in slides] == ["PUBLISHED", "DRAFT"]
    assert [s["status"] for s in out["chapters"][0]["slides"]] == ["PUBLISHED", "DRAFT"]
    assert out["course"]["status"] == "DRAFT"  # the COURSE itself always starts as a draft


@pytest.mark.asyncio
async def test_update_slide_in_a_draft_course_defaults_to_draft(backend):
    out = await edit({"action": "update_slide", "slide_id": "sl-1",
                      "slide": {"type": "document", "title": "What is a cell", "html": GOOD_HTML}})
    assert out["slide"]["status"] == "DRAFT" and backend.calls[-1]["body"]["status"] == "DRAFT"
    out = await edit({"action": "update_slide", "slide_id": "sl-1", "status": "PUBLISHED",
                      "slide": {"type": "document", "title": "What is a cell", "html": GOOD_HTML}})
    assert out["slide"]["status"] == "PUBLISHED"
    assert backend.calls[-1]["body"]["document_slide"]["published_data"]


@pytest.mark.asyncio
async def test_publish_slides_sends_the_dashboards_publish_request(backend):
    out = await edit({"action": "publish_slides", "course_id": "course-1"})
    save = backend.calls[-1]
    assert save["path"].endswith("/add-update-document-slide")
    body = save["body"]
    assert body["status"] == "PUBLISHED" and body["new_slide"] is False and body["notify"] is False
    assert body["document_slide"]["published_data"] == "<html>cell</html>" == body["document_slide"]["data"]
    assert save["params"]["chapterId"] == "ch-1" and save["params"]["packageSessionId"] == "ps-1"
    assert out["published"] == [{"id": "sl-1", "title": "What is a cell", "chapter": "Cells"}]
    assert "not live yet" in out["note"]


@pytest.mark.asyncio
async def test_publish_slides_skips_published_and_rejects_foreign_ids(backend):
    backend.tree[0]["modules"][0]["chapters"][0]["slides"][0]["status"] = "PUBLISHED"
    out = await edit({"action": "publish_slides", "course_id": "course-1"})
    assert out["published"] == [] and out["already_published"] == ["What is a cell"]
    assert not any(c["method"] == "POST" for c in backend.calls)
    out = await edit({"action": "publish_slides", "course_id": "course-1", "slide_ids": ["not-mine"]})
    assert out["error"] == "unknown_slide"
    out = await edit({"action": "publish_slides", "course_id": "course-1", "chapter_id": "nope"})
    assert out["error"] == "unknown_chapter"


@pytest.mark.asyncio
async def test_publish_slides_on_a_live_course_says_learners_see_it(backend):
    backend.course["status"] = "ACTIVE"
    out = await edit({"action": "publish_slides", "course_id": "course-1", "slide_ids": ["sl-1"]})
    assert out["published"] and "learners can see these slides now" in out["note"]


def test_publish_body_refuses_empty_content():
    from app.services.assistant_tools_course_edit import publish_body
    body, reason = publish_body({"id": "s", "document_slide": {"id": "d", "type": "HTML"}}, "DOCUMENT", 1)
    assert body is None and "no content" in reason
    body, reason = publish_body({"id": "s", "status": "DRAFT", "is_loaded": True,
                                 "quiz_slide": {"id": "q", "questions": []}}, "QUIZ", 2)
    assert body["status"] == "PUBLISHED" and body["new_slide"] is False and "is_loaded" not in body
    assert publish_body({"id": "s"}, "HTML_VIDEO", 1)[0] is None


@pytest.mark.asyncio
async def test_review_warns_about_draft_slides_once_the_course_is_past_draft(backend):
    backend.course["status"] = "IN_REVIEW"
    out = await read({"action": "review", "course_id": "course-1"})
    assert out["summary"]["draft_slides"] == 1
    assert any("still DRAFT" in f["issue"] for f in out["findings"])


# ── sessions × levels (batches) ──────────────────────────────────────────
def test_no_sessions_or_levels_is_the_simple_default_batch():
    spec, problem = cc.normalize_batches({})
    assert problem is None and spec == {"contain_levels": False, "sessions": [], "batches": []}


def test_levels_without_sessions_use_the_default_session():
    spec, _ = cc.normalize_batches({"levels": ["Class 9", "class 9", {"id": "lvl-10"}]})
    assert spec["contain_levels"] is True and len(spec["sessions"]) == 1
    session = spec["sessions"][0]
    assert session["id"] == "DEFAULT" and session["new_session"] is True
    new, existing = session["levels"]
    assert new["new_level"] is True and new["level_name"] == "Class 9"
    # Reusing a level by id must NOT send its name: admin-core renames the level to it.
    assert existing == {**existing, "id": "lvl-10", "new_level": False, "level_name": ""}
    assert spec["batches"] == ["Class 9", "level lvl-10"]


def test_sessions_cross_levels_and_sessions_without_levels():
    spec, _ = cc.normalize_batches({
        "sessions": [{"name": "2026-27", "start_date": "2026-06-01"}, {"id": "sess-old", "levels": ["Class 11"]}],
        "levels": ["Class 9", "Class 10"]})
    first, second = spec["sessions"]
    assert first["session_name"] == "2026-27" and first["new_session"] and first["start_date"] == "2026-06-01"
    assert [l["level_name"] for l in first["levels"]] == ["Class 9", "Class 10"]  # top-level levels applied
    assert second == {**second, "id": "sess-old", "new_session": False, "session_name": ""}
    assert [l["level_name"] for l in second["levels"]] == ["Class 11"]
    assert spec["batches"] == ["2026-27 · Class 9", "2026-27 · Class 10", "session sess-old · Class 11"]
    spec, _ = cc.normalize_batches({"sessions": ["2027-28"]})
    assert spec["sessions"][0]["levels"][0]["id"] == "DEFAULT" and spec["batches"] == ["2027-28"]


@pytest.mark.parametrize("args, needle", [
    ({"levels": ["DEFAULT"]}, "reserved"),
    ({"sessions": [{"name": "A"}, {"name": "a"}]}, "listed twice"),
    ({"sessions": [{"name": "A", "start_date": "June"}]}, "YYYY-MM-DD"),
    ({"levels": [{}]}, "needs a name or an id"),
    ({"sessions": "2026"}, "must be a list"),
])
def test_bad_batches_are_named(args, needle):
    spec, problem = cc.normalize_batches(args)
    assert spec is None and needle in problem


@pytest.mark.asyncio
async def test_create_course_with_batches_maps_content_to_every_batch(backend):
    backend.new_batch_ids = ["ps-a", "ps-b"]
    out = await edit({"action": "create_course", "course": {"name": "Maths"},
                      "sessions": [{"id": "sess-2026"}], "levels": [{"id": "lvl-9"}, "Class 10"],
                      "chapters": [{"name": "Algebra"}]})
    add_course = next(c for c in backend.calls if c["path"].endswith("/add-course/inst-1"))["body"]
    assert add_course["contain_levels"] is True
    assert add_course["sessions"][0]["id"] == "sess-2026" and add_course["sessions"][0]["new_session"] is False
    assert [l["id"] or l["level_name"] for l in add_course["sessions"][0]["levels"]] == ["lvl-9", "Class 10"]
    subject = next(c for c in backend.calls if c["path"].endswith("/add-subject"))
    chapter = next(c for c in backend.calls if c["path"].endswith("/add-chapter"))
    assert subject["params"]["commaSeparatedPackageSessionIds"] == "ps-a,ps-b"
    assert chapter["params"]["commaSeparatedPackageSessionIds"] == "ps-a,ps-b"
    assert [b["id"] for b in out["batches"]] == ["ps-a", "ps-b"]


@pytest.mark.asyncio
async def test_create_course_refuses_another_institutes_session_or_level(backend):
    out = await edit({"action": "create_course", "course": {"name": "Maths"},
                      "sessions": [{"id": "someone-elses-session"}], "chapters": [{"name": "Algebra"}]})
    assert out["error"] == "unknown_session" and not backend.calls
    out = await edit({"action": "create_course", "course": {"name": "Maths"},
                      "levels": [{"id": "foreign-level"}], "chapters": [{"name": "Algebra"}]})
    assert out["error"] == "unknown_level" and not backend.calls


def _two_batches(backend):
    backend.batches = [
        {"id": "ps-9", "name": "2026-27 · Class 9", "session": "2026-27", "level": "Class 9", "enrolled": 3},
        {"id": "ps-10", "name": "2026-27 · Class 10", "session": "2026-27", "level": "Class 10", "enrolled": 1}]


@pytest.mark.asyncio
async def test_multi_batch_course_invite_needs_a_batch_choice(backend):
    _two_batches(backend)
    out = await invites({"action": "create_invite", "course_id": "course-1", "payment": {"type": "FREE"}})
    assert out["error"] == "choose_batch" and [b["name"] for b in out["batches"]] == ["2026-27 · Class 9", "2026-27 · Class 10"]
    assert not backend.calls
    out = await invites({"action": "create_invite", "course_id": "course-1", "payment": {"type": "FREE"},
                         "batch_ids": ["ps-10"]})
    body = next(c for c in backend.calls if c["path"] == "/admin-core-service/v1/enroll-invite")["body"]
    assert [l["package_session_id"] for l in body["package_session_to_payment_options"]] == ["ps-10"]
    assert body["is_bundled"] is False and out["invite"]["batches"][0]["level"] == "Class 10"
    out = await invites({"action": "create_invite", "course_id": "course-1", "payment": {"type": "FREE"},
                         "batch_ids": ["ps-9", "ps-10"], "make_default": True})
    body = [c for c in backend.calls if c["path"] == "/admin-core-service/v1/enroll-invite"][-1]["body"]
    assert body["is_bundled"] is True and len(body["package_session_to_payment_options"]) == 2
    defaults = [c["params"]["packageSessionId"] for c in backend.calls if "update-default" in c["path"]]
    assert defaults == ["ps-9", "ps-10"] and out["invite"]["bundled"] is True
    out = await invites({"action": "create_invite", "course_id": "course-1", "payment": {"type": "FREE"},
                         "batch_ids": ["ps-other"]})
    assert out["error"] == "unknown_batch"


@pytest.mark.asyncio
async def test_bundled_invite_swap_and_default_cover_every_batch(backend):
    _two_batches(backend)
    backend.invites = [{"id": "inv-b", "name": "Both", "status": "ACTIVE", "tag": "", "is_default": False,
                        "short_url": "https://l.ink/b", "link_id": "l-9", "payment_option_id": "po-1",
                        "links": [{"link_id": "l-9", "package_session_id": "ps-9"},
                                  {"link_id": "l-10", "package_session_id": "ps-10"}],
                        "batch_ids": ["ps-9", "ps-10"], "plans": []}]
    await invites({"action": "create_payment_plan", "course_id": "course-1", "invite_id": "inv-b",
                   "payment": {"type": "ONE_TIME", "price": 100, "currency": "INR"}})
    swap = backend.calls[-1]["body"][0]["update_payment_options"]
    assert [(u["old_package_session_payment_option_id"], u["new_package_session_payment_option"]["package_session_id"])
            for u in swap] == [("l-9", "ps-9"), ("l-10", "ps-10")]
    out = await invites({"action": "make_default", "course_id": "course-1", "invite_id": "inv-b", "batch_ids": ["ps-10"]})
    assert [c["params"]["packageSessionId"] for c in backend.calls if "update-default" in c["path"]] == ["ps-10"]
    assert [b["name"] for b in out["default_invite"]["default_for"]] == ["2026-27 · Class 10"]


@pytest.mark.asyncio
async def test_get_lists_batches_and_sessions_levels_action(backend):
    _two_batches(backend)
    out = await read({"action": "get", "course_id": "course-1"})
    assert [b["name"] for b in out["batches"]] == ["2026-27 · Class 9", "2026-27 · Class 10"]
    assert out["course"]["enrolled_learners"] == 4 and out["course"]["batch_id"] == "ps-9"
    assert (await read({"action": "get", "course_id": "course-1", "batch_id": "nope"}))["error"] == "unknown_batch"
    out = await read({"action": "sessions_levels"})
    assert out["sessions"][0]["name"] == "2026-27" and out["levels"][0]["id"] == "lvl-9"
    schema = await read({"action": "schema"})
    assert "session × level" in schema["batches"]


@pytest.mark.asyncio
async def test_add_chapter_maps_to_every_batch(backend):
    _two_batches(backend)
    out = await edit({"action": "add_chapter", "course_id": "course-1", "name": "Genetics"})
    call = next(c for c in backend.calls if c["path"].endswith("/add-chapter"))
    assert out["chapter"]["name"] == "Genetics" and call["params"]["commaSeparatedPackageSessionIds"] == "ps-9,ps-10"


# ── editing an invite: form fields & page ────────────────────────────────
def _catalogue(b):
    b.catalogue = [_mapping("cf-name", "full_name", "Full Name", required=True),
                   _mapping("cf-email", "email", "Email", required=True),
                   _mapping("cf-class", "class_inst_inst-1", "Class", "dropdown", '[{"id":1,"value":"9","label":"9"}]'),
                   _mapping("cf-city", "city_inst_inst-1", "City", "dropdown",
                            '[{"id":1,"value":"Pune","label":"Pune"}]')]


def _saved_fields(b):
    return next(c for c in reversed(b.calls) if c["method"] == "POST" and c["path"].endswith("/feature-fields"))


def test_field_key_mirrors_admin_core():
    assert field_key_for("City / Town", "i1") == "city_town_inst_i1"
    assert field_key_for("10th marks", "i1") == "field_10th_marks_inst_i1"
    assert field_key_for("x", "i1") == "x_field_inst_i1"


@pytest.mark.asyncio
async def test_update_form_fields_binds_existing_fields_by_id_only(backend):
    _catalogue(backend)
    out = await invites({"action": "update_form_fields", "course_id": "course-1", "invite_id": "inv-default",
                         "add": [{"field_id": "City", "required": True}], "remove": ["cf-class"],
                         "required": {"Email": False}, "order": ["cf-city"]})
    assert "error" not in out, out
    body = _saved_fields(backend)["body"]
    assert _saved_fields(backend)["params"] == {"instituteId": "inst-1", "type": "ENROLL_INVITE",
                                                "typeId": "inv-default"}
    assert [f["custom_field"] for f in body] == [{"id": "cf-city"}, {"id": "cf-name"}, {"id": "cf-email"}]
    assert [f["is_mandatory"] for f in body] == [True, True, False]
    assert [f["individual_order"] for f in body] == [0, 1, 2]
    assert [f["label"] for f in out["form_fields"]] == ["City", "Full Name", "Email"]


@pytest.mark.asyncio
async def test_update_form_fields_refuses_built_ins_unknowns_and_saves_nothing(backend):
    _catalogue(backend)
    out = await invites({"action": "update_form_fields", "course_id": "course-1", "invite_id": "inv-default",
                         "remove": ["Email"], "add": [{"field_id": "Favourite colour"}], "required": {"cf-class": "yes"}})
    assert out["error"] == "invalid_form_fields" and len(out["problems"]) == 3
    assert "built-in" in out["problems"][0] and "Settings" in out["problems"][1]
    assert not any(c["method"] == "POST" and c["path"].endswith("/feature-fields") for c in backend.calls)


@pytest.mark.asyncio
async def test_form_fields_and_page_are_editable_on_a_live_course(backend):
    backend.course["status"] = "ACTIVE"
    out = await invites({"action": "update_form_fields", "course_id": "course-1", "invite_id": "inv-default",
                         "required": {"Class": True}})
    assert "error" not in out and any("live" in n for n in out["notes"])
    out = await invites({"action": "update_invite", "course_id": "course-1", "invite_id": "inv-default",
                         "redirect_path": "/study-library/courses"})
    assert out["changed"] == ["redirect_path"] and any("live" in n for n in out["notes"])


@pytest.mark.asyncio
async def test_update_invite_patches_only_what_was_asked(backend):
    out = await invites({"action": "update_invite", "course_id": "course-1", "invite_id": "inv-default",
                         "name": "Biology — Early bird", "end_date": "2026-12-31",
                         "landing": {"description_html": "<p>New</p>", "tags": ["bio", "neet"]},
                         "redirect_path": "/study-library/courses?tab=new",
                         "success_page": {"content": "<p>Welcome!</p>", "show_login_button": False}})
    assert "error" not in out, out
    put = next(c for c in backend.calls if c["method"] == "PUT")
    body = put["body"]
    assert put["path"] == "/admin-core-service/v1/enroll-invite/enroll-invite"
    assert body["name"] == "Biology — Early bird" and body["end_date"] == "2026-12-31"
    # untouched columns go back exactly as read (the PUT nulls whatever it is not sent)
    for k in ("start_date", "status", "vendor", "vendor_id", "currency", "learner_access_days", "is_bundled"):
        assert body[k] == backend.full_invite[k], k
    meta = json.loads(body["web_page_meta_data_json"])
    assert meta["description"] == "<p>New</p>" and meta["aboutCourse"] == "<p>About</p>"
    assert meta["tags"] == ["bio", "neet"] and meta["coursePreview"] == "file-old"
    settings = json.loads(body["setting_json"])
    assert settings["setting"] == {"AUTOPAY_SETTING": {"ENABLED": True}}
    assert settings["postformfillConfiguration"] == {"showLoginButton": False, "redirectPath": "/study-library/courses?tab=new",
                                                     "content": "<p>Welcome!</p>"}
    # payment links keep their ids; the form is not re-synced and is sent by id only
    assert body["package_session_to_payment_options"] == [
        {"id": "link-1", "package_session_id": "ps-1", "enroll_invite_id": "inv-default", "status": "ACTIVE",
         "payment_option": {"id": "po-inst"}}]
    assert body["institute_id"] is None
    assert [f["custom_field"] for f in body["institute_custom_fields"]] == [{"id": "cf-name"}, {"id": "cf-email"},
                                                                            {"id": "cf-class"}]
    assert "availability_status" not in body


@pytest.mark.asyncio
@pytest.mark.parametrize("path", ["https://evil.example/x", "//evil.example", "study-library", "/a b"])
async def test_redirect_must_be_a_learner_app_path(backend, path):
    out = await invites({"action": "update_invite", "course_id": "course-1", "invite_id": "inv-default",
                         "redirect_path": path})
    assert out["error"] == "bad_request"
    assert not any(c["method"] == "PUT" for c in backend.calls)


@pytest.mark.asyncio
async def test_update_invite_images_store_media_ids(backend, monkeypatch):
    backend.course["course_banner_media_id"] = "file-banner"

    async def _fetch(url, **kw):
        return b"png", "image/png", "png"

    async def _upload(c, content, name, ctype):
        return "file-new"
    monkeypatch.setattr(cbd, "fetch_public_file", _fetch)
    monkeypatch.setattr(cbd, "upload_to_media", _upload)
    out = await invites({"action": "update_invite", "course_id": "course-1", "invite_id": "inv-default",
                         "images": {"preview": {"image_url": "https://example.com/p.png"}, "banner": "course",
                                    "media": {"youtube": "https://youtu.be/dQw4w9WgXcQ"}}})
    assert "error" not in out, out
    meta = json.loads(next(c for c in backend.calls if c["method"] == "PUT")["body"]["web_page_meta_data_json"])
    assert meta["coursePreview"] == "file-new" and meta["coursePreviewBlob"] == "https://cdn/file-new"
    assert meta["courseBanner"] == "file-banner"
    assert meta["courseMedia"] == {"type": "youtube", "id": "https://youtu.be/dQw4w9WgXcQ"}


@pytest.mark.asyncio
async def test_bad_image_is_refused_before_anything_is_imported(backend, monkeypatch):
    imported = []

    async def _fetch(url, **kw):
        imported.append(url)
        return b"png", "image/png", "png"
    monkeypatch.setattr(cbd, "fetch_public_file", _fetch)
    out = await invites({"action": "update_invite", "course_id": "course-1", "invite_id": "inv-default",
                         "images": {"preview": {"image_url": "https://example.com/p.png"},
                                    "banner": {"file_id": "https://example.com/b.png"}}})
    assert out["error"] == "bad_request" and not imported
    assert not any(c["method"] == "PUT" for c in backend.calls)


@pytest.mark.asyncio
async def test_create_invite_reuses_an_existing_field_instead_of_overwriting_it(backend):
    backend.existing_field_keys = {"city_inst_inst-1": {"id": "cf-city", "field_key": "city_inst_inst-1",
                                                        "field_name": "City", "field_type": "dropdown",
                                                        "config": '[{"id":1,"value":"Pune","label":"Pune"}]'}}
    out = await invites({"action": "create_invite", "course_id": "course-1", "payment": {"type": "FREE"},
                         "form_fields": [{"label": "City", "type": "text"}, {"label": "School"}]})
    body = next(c for c in backend.calls if c["path"] == "/admin-core-service/v1/enroll-invite")["body"]
    city = next(f for f in body["institute_custom_fields"] if f["custom_field"]["fieldName"] == "City")
    school = next(f for f in body["institute_custom_fields"] if f["custom_field"]["fieldName"] == "School")
    assert city["custom_field"]["id"] == "cf-city" and city["custom_field"]["fieldType"] == "dropdown"
    assert school["custom_field"]["id"] == ""
    assert any("City" in n for n in out["notes"])


@pytest.mark.asyncio
async def test_get_invite_shows_fields_available_fields_images_and_redirect(backend):
    _catalogue(backend)
    backend.full_invite["setting_json"] = json.dumps({"postformfillConfiguration": {"redirectPath": "/dashboard"}})
    out = await read({"action": "get_invite", "course_id": "course-1", "invite_id": "inv-default"})
    inv = out["invite"]
    assert [f["field_id"] for f in inv["form_fields"]] == ["cf-name", "cf-email", "cf-class"]
    assert inv["form_fields"][0]["locked"] is True and inv["form_fields"][2]["options"] == ["9", "10"]
    assert [f["field_id"] for f in inv["available_fields"]] == ["cf-city"]
    assert inv["redirect_path"] == "/dashboard"
    assert inv["images"]["preview"] == {"file_id": "file-old", "url": "https://cdn/file-old"}


# ── course media ─────────────────────────────────────────────────────────
def _put(b, fragment):
    return [c for c in b.calls if c["method"] == "PUT" and fragment in c["path"]]


@pytest.mark.asyncio
async def test_update_media_changes_only_media_and_fills_empty_invite_slots(backend):
    backend.course["status"] = "ACTIVE"
    out = await edit({"action": "update_media", "course_id": "course-1",
                      "media": {"preview": {"file_id": "file-preview-1"}, "banner": {"file_id": "file-banner-1"},
                                "intro": {"youtube": "https://youtu.be/dQw4w9WgXcQ"}}})
    assert "error" not in out, out
    body = _put(backend, "/update-course/course-1")[0]["body"]
    assert body["course_preview_image_media_id"] == "file-preview-1"
    assert json.loads(body["course_media_id"]) == {"type": "youtube", "id": "https://youtu.be/dQw4w9WgXcQ"}
    # every other column goes back as stored (the endpoint nulls whatever it is not sent)
    assert body["package_name"] == "Biology 101" and body["why_learn_html"] == "<p>Why</p>"
    assert body["is_course_published_to_catalaouge"] is True and body["tags"] == ["bio"]
    assert body["course_html_description_html"] == "<p>Desc</p>" and body["course_depth"] == 3
    # the default invite had its own preview: kept. Banner and intro were empty: filled.
    meta = json.loads(_put(backend, "/enroll-invite/enroll-invite")[0]["body"]["web_page_meta_data_json"])
    assert meta["coursePreview"] == "file-old"
    assert meta["courseBanner"] == "file-banner-1" and meta["courseBannerBlob"] == "https://cdn/file-banner-1"
    assert meta["courseMedia"] == {"type": "youtube", "id": "https://youtu.be/dQw4w9WgXcQ"}
    assert out["invites_updated"] == ["Biology 101"] and any("live" in n for n in out["notes"])


@pytest.mark.asyncio
async def test_update_media_leaves_invites_alone_when_their_slots_are_set(backend):
    out = await edit({"action": "update_media", "course_id": "course-1",
                      "media": {"preview": {"file_id": "file-preview-1"}}})
    assert out["invites_updated"] == [] and not _put(backend, "/enroll-invite/enroll-invite")


@pytest.mark.asyncio
async def test_bad_media_is_refused_before_anything_is_imported_or_created(backend, monkeypatch):
    imported = []

    async def _fetch(url, **kw):
        imported.append(url)
        return b"png", "image/png", "png"
    monkeypatch.setattr(cbd, "fetch_public_file", _fetch)
    out = await edit({"action": "create_course", "course": {"name": "Plants"}, "chapters": [{"name": "Leaves"}],
                      "media": {"preview": {"image_url": "https://example.com/p.png"},
                                "banner": {"youtube": "https://youtu.be/dQw4w9WgXcQ"}}})
    assert out["error"] == "invalid_media" and not imported
    assert not any(c["path"].endswith("/add-course/inst-1") for c in backend.calls)
    out = await edit({"action": "update_media", "course_id": "course-1", "media": {"thumbnail": "none"}})
    assert out["error"] == "invalid_media" and not _put(backend, "/update-course/")


@pytest.mark.asyncio
async def test_create_course_imports_media_and_stores_file_ids(backend, monkeypatch):
    async def _fetch(url, **kw):
        return b"png", "image/png", "png"

    async def _upload(c, content, name, ctype):
        return "file-imported-1"
    monkeypatch.setattr(cbd, "fetch_public_file", _fetch)
    monkeypatch.setattr(cbd, "upload_to_media", _upload)
    out = await edit({"action": "create_course", "course": {"name": "Plants"}, "chapters": [{"name": "Leaves"}],
                      "media": {"preview": {"image_url": "https://example.com/p.png"}}})
    assert "error" not in out, out
    body = next(c for c in backend.calls if c["path"].endswith("/add-course/inst-1"))["body"]
    assert body["course_preview_image_media_id"] == "file-imported-1" and body["course_banner_media_id"] == ""
    assert out["media"] == ["preview"]


@pytest.mark.asyncio
async def test_review_suggests_a_preview_image(backend):
    out = await read({"action": "review", "course_id": "course-1"})
    assert any("preview image" in f["issue"] for f in out["findings"])
    backend.course["course_preview_image_media_id"] = "file-p"
    out = await read({"action": "review", "course_id": "course-1"})
    assert not any("preview image" in f["issue"] for f in out["findings"])


# ── create_course: instructor + copy from an existing course ────────────
@pytest.mark.asyncio
async def test_create_course_makes_the_creator_its_instructor(backend):
    await edit({"action": "create_course", "course": {"name": "Plants"}, "chapters": [{"name": "Leaves"}]})
    body = next(c for c in backend.calls if c["path"].endswith("/add-course/inst-1"))["body"]
    assert [f["user"]["id"] for f in body["add_faculty_to_course"]] == ["user-1"]
    assert body["add_faculty_to_course"][0]["new_user"] is False
    # With sessions/levels admin-core reads the instructors per level instead.
    backend.calls.clear()
    await edit({"action": "create_course", "course": {"name": "Plants"}, "chapters": [{"name": "Leaves"}],
                "levels": [{"id": "lvl-9"}]})
    body = next(c for c in backend.calls if c["path"].endswith("/add-course/inst-1"))["body"]
    levels = [lv for sess in body["sessions"] for lv in sess["levels"]]
    assert levels and all([f["user"]["id"] for f in lv["add_faculty_to_course"]] == ["user-1"] for lv in levels)


@pytest.mark.asyncio
async def test_copy_from_seeds_the_course_then_appends_new_chapters(backend):
    out = await edit({"action": "create_course", "course": {"name": "Biology 102"},
                      "copy_from": {"course_id": "course-1"},
                      "chapters": [{"name": "Tissues", "slides": ["Intro"]}]})
    assert "error" not in out, out
    copy = next(c for c in backend.calls if c["path"].endswith("/copy-content"))["body"]
    assert copy == {"sourcePackageSessionId": "ps-1", "targetPackageSessionIds": ["ps-new"], "mode": "VALUE"}
    add_course = next(c for c in backend.calls if c["path"].endswith("/add-course/inst-1"))["body"]
    assert add_course["course_depth"] == 3      # the source's depth
    # The new chapter goes into the copy's hidden module, after the copied chapter — no second DEFAULT subject.
    assert not [c for c in backend.calls if c["path"].endswith(("/add-subject", "/add-module"))]
    chapter = next(c for c in backend.calls if c["path"].endswith("/add-chapter"))
    assert chapter["params"]["moduleId"] == "mod-1" and chapter["body"]["chapter_order"] == 2
    order = [c["path"] for c in backend.calls]
    assert order.index(next(p for p in order if p.endswith("/copy-content"))) < \
        order.index(next(p for p in order if p.endswith("/add-chapter")))
    assert out["copied"]["from"]["course"] == "Biology 101"
    assert [c["id"] for c in out["copied"]["chapter_list"]] == ["ch-1"]
    assert [t["title"] for t in out["todo"]] == ["Intro"]


@pytest.mark.asyncio
async def test_copy_from_alone_needs_no_outline(backend):
    out = await edit({"action": "create_course", "course": {"name": "Biology 102"}, "copy_from": "course-1"})
    assert "error" not in out, out
    assert out["copied"]["chapters"] == 1 and out["chapters"] == []
    assert not [c for c in backend.calls if c["path"].endswith(("/add-subject", "/add-module", "/add-chapter"))]


@pytest.mark.asyncio
async def test_depth_2_copy_appends_slides_to_the_copied_chapter(backend):
    backend.course["depth"] = 2
    out = await edit({"action": "create_course", "course": {"name": "Short"}, "copy_from": {"course_id": "course-1"},
                      "slides": [{"type": "document", "title": "More", "html": GOOD_HTML}]})
    assert "error" not in out, out
    assert not [c for c in backend.calls if c["path"].endswith("/add-chapter")]
    slide = next(c for c in backend.calls if "/slide/" in c["path"])
    assert slide["params"]["chapterId"] == "ch-1" and slide["body"]["slide_order"] == 2


@pytest.mark.asyncio
@pytest.mark.parametrize("copy_from, extra, code", [
    ({"course_id": "nope"}, {}, "unknown_course"),
    ({"course_id": "course-1"}, {"course": {"name": "X", "depth": 5}}, "depth_mismatch"),
    ({"course_id": "course-1", "batch_id": "ps-x"}, {}, "unknown_batch"),
])
async def test_bad_copy_from_creates_nothing(backend, copy_from, extra, code):
    out = await edit({"action": "create_course", "course": {"name": "X"}, "copy_from": copy_from, **extra})
    assert out["error"] == code and not backend.calls


@pytest.mark.asyncio
async def test_copy_from_a_course_with_several_batches_asks_which(backend):
    backend.batches.append({**backend.batches[0], "id": "ps-2", "name": "2026-27 · Class 9"})
    out = await edit({"action": "create_course", "course": {"name": "X"}, "copy_from": {"course_id": "course-1"}})
    assert out["error"] == "pick_source_batch" and [b["id"] for b in out["batches"]] == ["ps-1", "ps-2"]
    assert not backend.calls
    out = await edit({"action": "create_course", "course": {"name": "X"},
                      "copy_from": {"course_id": "course-1", "batch_id": "ps-2"}})
    assert next(c for c in backend.calls if c["path"].endswith("/copy-content"))["body"]["sourcePackageSessionId"] \
        == "ps-2"


@pytest.mark.asyncio
async def test_a_failed_copy_reports_the_draft_course(backend, monkeypatch):
    real = backend.admin_core

    async def _fail(c, method, path, **kw):
        if path.endswith("/copy-content"):
            return {"error": "admin_core_error", "message": "boom"}
        return await real(c, method, path, **kw)
    monkeypatch.setattr(cbd, "admin_core", _fail)
    out = await edit({"action": "create_course", "course": {"name": "X"}, "copy_from": "course-1",
                      "chapters": [{"name": "Extra"}]})
    assert out["error"] == "copy_failed" and out["course_id"] == "course-new"
    assert not [c for c in backend.calls if c["path"].endswith("/add-chapter")]
