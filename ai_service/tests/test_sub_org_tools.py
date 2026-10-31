"""
Sub-organisations over MCP: `sub_orgs`, `sub_org_edit`, `sub_org_enroll`.

The connected LLM drives the conversation; these tools only validate and call the
admin-core endpoints the dashboard / learner app call. The tests pin down: the
requests are exactly the dashboard's (create-with-subscription, configuration,
add-member); nothing is written without the confirm_token of a preview of the
identical request; sub-orgs, courses, payment options and roles from outside the
institute are refused; price / seats / validity / roles are never assumed; learners
are added as LEARNER only, never past the seat cap, and never twice into a course.
"""
import json
import sys
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest  # noqa: E402
from app.schemas.auth import PinnedPrincipal  # noqa: E402
from app.services import course_builder_data as cbd  # noqa: E402
from app.services import learner_data as ld  # noqa: E402
from app.services import sub_org_data as sd  # noqa: E402
from app.services.assistant_tool_registry import ASSISTANT_TOOLS, ToolContext, is_tool_allowed  # noqa: E402
from app.services.assistant_tools_sub_org_edit import execute_sub_org_edit  # noqa: E402
from app.services.assistant_tools_sub_org_enroll import execute_sub_org_enroll  # noqa: E402
from app.services.assistant_tools_sub_orgs import execute_sub_orgs  # noqa: E402


class _FakeDb:
    def execute(self, stmt, params=None):
        return SimpleNamespace(first=lambda: None, fetchall=lambda: [])

    def rollback(self):
        pass


def principal():
    return PinnedPrincipal(user_id="admin-1", institute_id="inst-1", roles=["ADMIN"], permissions=[],
                           is_root_user=False)


def ctx():
    return ToolContext(db=_FakeDb(), principal=principal(), keys=(), bearer_token="jwt")


SETTING = {"setting": {"SUB_ORG_SETTING": {"AUTH_ROLES": ["Partner Admin"], "MEMBER_COUNT": 3,
                                           "ADMIN_PERMISSIONS": ["FULL"]}}}


class Backend:
    """Records admin-core / auth calls and answers like the real services."""

    def __init__(self):
        self.calls = []
        self.sub_orgs = {"so-1": {"id": "so-1", "name": "Delhi Centre", "status": "ACTIVE", "created_at": None},
                         "so-2": {"id": "so-2", "name": "Pune Centre", "status": "ACTIVE", "created_at": None}}
        self.invites = {"so-1": [{"id": "inv-org", "name": "Org", "invite_code": "ABC123", "short_url": "https://s/x",
                                  "learner_access_days": 365, "payment_option_id": "po-free",
                                  "payment_option_name": "Free plan", "payment_type": "FREE",
                                  "setting": SETTING["setting"]["SUB_ORG_SETTING"], "has_setting": True,
                                  "batch_ids": ["ps-1", "ps-2"]}],
                        "so-2": []}
        self.batch_rows = {"ps-1": {"batch_id": "ps-1", "course_id": "course-1", "course": "Biology",
                                    "batch": "Default batch", "course_status": "ACTIVE"},
                           "ps-2": {"batch_id": "ps-2", "course_id": "course-2", "course": "Chemistry",
                                    "batch": "Default batch", "course_status": "ACTIVE"},
                           "ps-3": {"batch_id": "ps-3", "course_id": "course-3", "course": "Physics",
                                    "batch": "Default batch", "course_status": "ACTIVE"}}
        self.courses = {"course-1": {"id": "course-1", "name": "Biology", "status": "ACTIVE"},
                        "course-2": {"id": "course-2", "name": "Chemistry", "status": "ACTIVE"},
                        "course-3": {"id": "course-3", "name": "Physics", "status": "ACTIVE"}}
        self.course_batch = {"course-1": [{"id": "ps-1", "name": "Default batch"}],
                             "course-2": [{"id": "ps-2", "name": "Default batch"}],
                             "course-3": [{"id": "ps-3", "name": "Default batch"}]}
        self.used = {"ps-1": 1, "ps-2": 0}
        self.admins = {"so-1": [{"user_id": "u-admin", "full_name": "Ravi", "email": "ravi@x.com",
                                 "status": "ACTIVE"}], "so-2": []}
        self.active = []
        self.options = [
            {"id": "po-free", "name": "Free plan", "type": "FREE", "complex_payment_option_id": None, "plans": []},
            {"id": "po-paid", "name": "Partner fee", "type": "ONE_TIME", "complex_payment_option_id": None,
             "plans": [{"name": "Yearly", "actual_price": 5000, "currency": "INR", "validity_in_days": 365}]},
            {"id": "po-cpo", "name": "Instalments", "type": "CPO", "complex_payment_option_id": "cpo-9", "plans": []},
        ]
        self.gateways = [{"vendor": "RAZORPAY", "vendor_id": "rz-1"}]
        self.roles = ["Partner Admin", "Mentor", "ADMIN"]
        self.learners = {"u-old": {"user_id": "u-old", "full_name": "Old Learner", "email": "old@x.com",
                                   "mobile_number": None}}
        self.toggles = {"notify_learners": True, "send_credentials": True}
        self.fields = [{"field_id": "cf-city", "label": "Home City", "type": "text", "required": False}]
        self.workflows = []
        self.fail_emails = set()

    async def admin_core(self, ctx_, method, path, *, params=None, body=None, timeout=30.0):
        self.calls.append({"method": method, "path": path, "params": params or {}, "body": body})
        if path == sd.LIST_PATH:
            return {"content": [{"suborg_id": s["id"], "name": s["name"], "status": "ACTIVE", "admin_user_id": None,
                                 "used_seats": 1, "total_seats": 3, "learner_count": 1, "invite_code": "ABC123"}
                                for s in self.sub_orgs.values()], "totalElements": len(self.sub_orgs)}
        if path == sd.VENDORS_PATH:
            return [dict(g) for g in self.gateways]
        if path == sd.CREATE_PATH:
            return {"sub_org_id": "so-new", "enroll_invite_id": "inv-new", "invite_code": "NEW001",
                    "short_url": "https://s/new"}
        if path.endswith("/configuration"):
            return {"sub_org_id": path.split("/")[-2], "applied": {k: v for k, v in body.items()}}
        if path == sd.ADD_MEMBER_PATH:
            if body["user"]["email"] in self.fail_emails:
                return cbd.err("admin_core_rejected", status=400, message="Member limit exceeded for this batch.")
            return {"user": {"id": "u-" + body["user"]["email"].split("@")[0], "email": body["user"]["email"]},
                    "message": "ok"}
        if path.endswith("/workflows-with-schedules/list"):
            return {"content": [dict(w) for w in self.workflows]}
        return "ok"

    async def auth_call(self, ctx_, method, path, *, body=None, params=None, timeout=20.0):
        self.calls.append({"method": method, "path": path, "params": params or {}, "body": body})
        if path.endswith("/roles"):
            return [{"name": n} for n in self.roles + ["Guest"]]
        if path.endswith("/users-credential"):
            return [{"user_id": i, "username": i, "password": "pw"} for i in body]
        return "ok"

    def writes(self, path):
        return [c for c in self.calls if c["path"] == path]


@pytest.fixture
def backend(monkeypatch):
    b = Backend()
    monkeypatch.setattr(cbd, "admin_core", b.admin_core)
    monkeypatch.setattr(cbd, "_rows", lambda c, sql, params: [])
    monkeypatch.setattr(cbd, "admin_base", lambda c: "https://dash")
    monkeypatch.setattr(cbd, "course_row", lambda c, cid: dict(b.courses[cid]) if cid in b.courses else None)
    monkeypatch.setattr(cbd, "course_batches", lambda c, cid: [dict(x) for x in b.course_batch.get(cid, [])])
    monkeypatch.setattr(ld, "auth_call", b.auth_call)
    monkeypatch.setattr(sd, "sub_org", lambda c, sid: dict(b.sub_orgs[sid]) if sid in b.sub_orgs else None)
    monkeypatch.setattr(sd, "sub_orgs_named", lambda c, name: [
        dict(s) for s in b.sub_orgs.values() if s["name"].lower() == name.strip().lower()])
    monkeypatch.setattr(sd, "invites", lambda c, sid: [dict(i, batch_ids=list(i["batch_ids"]))
                                                       for i in b.invites.get(sid, [])])
    monkeypatch.setattr(sd, "batches", lambda c, ids: [dict(b.batch_rows[i]) for i in ids if i in b.batch_rows])
    monkeypatch.setattr(sd, "used_seats", lambda c, sid, ids: {i: b.used.get(i, 0) for i in ids})
    monkeypatch.setattr(sd, "admins", lambda c, sid: [dict(a) for a in b.admins.get(sid, [])])
    monkeypatch.setattr(sd, "members", lambda c, sid, **kw: [])
    monkeypatch.setattr(sd, "active_enrolments", lambda c, ids, ps: [
        dict(a) for a in b.active if a["user_id"] in ids and a["package_session_id"] in ps])
    monkeypatch.setattr(sd, "payment_options", lambda c: [dict(o) for o in b.options])

    async def _toggles(c):
        return dict(b.toggles)

    async def _fields(c):
        return [dict(f) for f in b.fields]
    monkeypatch.setattr(ld, "notification_toggles", _toggles)
    monkeypatch.setattr(ld, "custom_field_catalogue", _fields)
    monkeypatch.setattr(ld, "learners_by_ids", lambda c, ids: {i: dict(b.learners[i]) for i in ids if i in b.learners})
    monkeypatch.setattr(ld, "match_existing", lambda c, emails, phones: [
        {"user_id": p["user_id"], "full_name": p["full_name"], "email": p["email"]}
        for p in b.learners.values() if p["email"] in emails])
    return b


async def read(args):
    return json.loads(await execute_sub_orgs(args, ctx()))


async def edit(args):
    return json.loads(await execute_sub_org_edit(args, ctx()))


async def enroll(args, answered=True):
    if answered:
        args = {**args, "options": {"credentials_file": False, **(args.get("options") or {})}}
    return json.loads(await execute_sub_org_enroll(args, ctx()))


CREATE = {"change": "create", "name": "Mumbai Centre", "courses": [{"course_id": "course-1"}],
          "payment_option_id": "po-free", "member_count": 25, "validity_in_days": 365,
          "admin_roles": ["Partner Admin"]}


# ── registry / gating ────────────────────────────────────────────────────
def test_read_tool_is_admin_scoped_and_writes_are_opt_in():
    from app.mcp import adapter
    from app.mcp.constants import MCP_ALLOWED_WRITE_TOOLS, MCP_OPT_IN_GROUPS
    assert ASSISTANT_TOOLS["sub_orgs"].mode == "READ"
    assert is_tool_allowed("sub_orgs", principal(), {"enabled_tools": ["sub_orgs"], "role_overrides": {}})
    for name, group in (("sub_org_edit", "sub_org_edits"), ("sub_org_enroll", "sub_org_enrollments")):
        spec = ASSISTANT_TOOLS[name]
        assert spec.mode == "WRITE" and spec.key() == group and not spec.default_enabled and not spec.default_roles
        assert not is_tool_allowed(name, principal(), None)
        assert not is_tool_allowed(name, principal(), {"enabled_tools": ["sub_orgs"], "role_overrides": {}})
        assert is_tool_allowed(name, principal(), {"enabled_tools": [group], "role_overrides": {}})
        assert group in MCP_OPT_IN_GROUPS and "confirm" in MCP_ALLOWED_WRITE_TOOLS[name]
        entry = next(c for c in adapter.tool_catalog() if c["name"] == name)
        assert (entry["area"], entry["level"], entry["risk"], entry["opt_in"]) == ("sub_orgs", "edit", "live", True)


# ── sub_orgs (read) ──────────────────────────────────────────────────────
async def test_list_filters_by_name(backend):
    out = await read({"action": "list", "query": "delhi"})
    assert [s["sub_org_id"] for s in out["sub_orgs"]] == ["so-1"]
    call = backend.writes(sd.LIST_PATH)[0]
    assert call["params"]["parentInstituteId"] == "inst-1"


async def test_get_shows_courses_seats_and_admin_and_refuses_strangers(backend):
    out = await read({"action": "get", "sub_org_id": "so-1"})
    assert [c["course"] for c in out["courses"]] == ["Biology", "Chemistry"]
    assert out["seats_per_course"] == 3 and out["courses"][0]["seats_left"] == 2
    assert out["admins"][0]["email"] == "ravi@x.com" and out["settings"]["admin_roles"] == ["Partner Admin"]
    assert out["invite"]["invite_code"] == "ABC123"
    assert (await read({"action": "get", "sub_org_id": "so-other"}))["error"] == "unknown_sub_org"


async def test_create_options_hide_legacy_roles(backend):
    out = await read({"action": "create_options"})
    assert "Guest" not in out["admin_roles_available"] and "Partner Admin" in out["admin_roles_available"]
    assert [o["payment_option_id"] for o in out["payment_options"]] == ["po-free", "po-paid", "po-cpo"]


# ── sub_org_edit: create ─────────────────────────────────────────────────
async def test_create_asks_for_everything_it_must_not_assume(backend):
    out = await edit({"action": "preview", "change": "create", "name": "Mumbai Centre",
                      "courses": [{"course_id": "course-1"}]})
    assert out["error"] == "ask_admin"
    assert {q["field"] for q in out["questions"]} == {"payment_option_id", "member_count", "validity_in_days",
                                                      "admin_roles"}
    assert not backend.writes(sd.CREATE_PATH)


async def test_create_preview_then_apply_sends_the_dashboard_body(backend):
    prev = await edit({"action": "preview", **CREATE})
    assert prev["will_do"]["seats_per_course"] == 25 and prev["confirm_token"]
    assert not backend.writes(sd.CREATE_PATH)
    done = await edit({"action": "apply", **CREATE, "confirm_token": prev["confirm_token"]})
    assert done["done"] and done["sub_org_id"] == "so-new" and done["invite_link"] == "https://s/new"
    call = backend.writes(sd.CREATE_PATH)[0]
    assert call["params"] == {"parentInstituteId": "inst-1"}
    assert call["body"] == {"sub_org_details": {"institute_name": "Mumbai Centre"}, "package_session_ids": ["ps-1"],
                            "payment_type": "FREE", "member_count": 25, "validity_in_days": 365,
                            "auth_roles": ["Partner Admin"], "admin_permissions": ["FULL"],
                            "payment_option_id": "po-free"}


async def test_apply_needs_the_token_of_the_identical_preview(backend):
    prev = await edit({"action": "preview", **CREATE})
    assert (await edit({"action": "apply", **CREATE}))["error"] == "confirm_required"
    changed = await edit({"action": "apply", **CREATE, "member_count": 50, "confirm_token": prev["confirm_token"]})
    assert changed["error"] == "confirm_token_mismatch"
    assert not backend.writes(sd.CREATE_PATH)


async def test_create_refuses_taken_names_foreign_options_and_unknown_roles(backend):
    assert (await edit({"action": "preview", **CREATE, "name": "delhi centre"}))["error"] == "name_taken"
    assert (await edit({"action": "preview", **CREATE, "payment_option_id": "po-x"}))["error"] == \
           "unknown_payment_option"
    assert (await edit({"action": "preview", **CREATE, "admin_roles": ["Wizard"]}))["error"] == "unknown_role"
    assert (await edit({"action": "preview", **CREATE, "courses": [{"course_id": "nope"}]}))["error"] == \
           "unknown_course"
    assert (await edit({"action": "preview", **CREATE, "member_count": 2.5}))["error"] == "invalid_argument"


async def test_create_warns_when_the_admin_role_is_institute_admin(backend):
    prev = await edit({"action": "preview", **CREATE, "admin_roles": ["ADMIN"]})
    assert "WHOLE institute" in prev["will_do"]["warnings"][0]


async def test_cpo_and_paid_options_send_the_right_payment_fields(backend):
    prev = await edit({"action": "preview", **CREATE, "payment_option_id": "po-cpo"})
    await edit({"action": "apply", **CREATE, "payment_option_id": "po-cpo", "confirm_token": prev["confirm_token"]})
    body = backend.writes(sd.CREATE_PATH)[-1]["body"]
    assert body["payment_type"] == "CPO" and body["complex_payment_option_id"] == "cpo-9"
    assert "payment_option_id" not in body
    prev = await edit({"action": "preview", **CREATE, "payment_option_id": "po-paid"})
    await edit({"action": "apply", **CREATE, "payment_option_id": "po-paid", "confirm_token": prev["confirm_token"]})
    body = backend.writes(sd.CREATE_PATH)[-1]["body"]
    assert (body["vendor"], body["vendor_id"], body["currency"]) == ("RAZORPAY", "rz-1", "INR")
    backend.gateways.append({"vendor": "STRIPE", "vendor_id": "st-1"})
    ask = await edit({"action": "preview", **CREATE, "payment_option_id": "po-paid"})
    assert ask["error"] == "ask_admin" and ask["questions"][0]["field"] == "vendor"


# ── sub_org_edit: update / add_admin ─────────────────────────────────────
async def test_update_adds_only_new_courses_and_keeps_seats_above_usage(backend):
    prev = await edit({"action": "preview", "change": "update", "sub_org_id": "so-1",
                       "add_courses": [{"course_id": "course-1"}, {"course_id": "course-3"}]})
    assert [c["course"] for c in prev["will_do"]["changes"][0]["add"]] == ["Physics"]
    await edit({"action": "apply", "change": "update", "sub_org_id": "so-1",
                "add_courses": [{"course_id": "course-1"}, {"course_id": "course-3"}],
                "confirm_token": prev["confirm_token"]})
    call = backend.writes(sd.config_path("so-1"))[0]
    assert call["method"] == "PATCH" and call["body"] == {"add_package_session_ids": ["ps-3"]}
    assert call["params"] == {"parentInstituteId": "inst-1"}
    backend.used["ps-1"] = 4
    low = await edit({"action": "preview", "change": "update", "sub_org_id": "so-1", "member_count": 3})
    assert low["error"] == "below_usage"
    swap = await edit({"action": "preview", "change": "update", "sub_org_id": "so-1", "payment_option_id": "po-paid"})
    assert swap["error"] == "not_supported"
    assert (await edit({"action": "preview", "change": "update", "sub_org_id": "so-other",
                        "member_count": 9}))["error"] == "unknown_sub_org"


async def test_add_admin_is_root_admin_on_every_course_and_only_once(backend):
    assert (await edit({"action": "preview", "change": "add_admin", "sub_org_id": "so-1",
                        "admin": {"full_name": "Neha", "email": "neha@x.com"}}))["error"] == "admin_exists"
    backend.admins["so-1"] = []
    args = {"change": "add_admin", "sub_org_id": "so-1", "admin": {"full_name": "Neha", "email": "Neha@X.com"}}
    prev = await edit({"action": "preview", **args})
    await edit({"action": "apply", **args, "confirm_token": prev["confirm_token"]})
    body = backend.writes(sd.ADD_MEMBER_PATH)[0]["body"]
    assert body == {"user": {"email": "neha@x.com", "full_name": "Neha", "roles": ["Partner Admin"]},
                    "package_session_ids": ["ps-1", "ps-2"], "sub_org_id": "so-1", "institute_id": "inst-1",
                    "status": "ACTIVE", "comma_separated_org_roles": "ROOT_ADMIN"}


# ── sub_org_enroll ───────────────────────────────────────────────────────
CSV = ("email,full_name,mobile_number,cf_home_city\n"
       "asha@x.com,Asha Verma,+91 91234 56789,Delhi\n")


async def test_preview_asks_about_the_credentials_file_first(backend):
    out = await enroll({"action": "preview", "sub_org_id": "so-1", "csv": CSV}, answered=False)
    assert out["error"] == "ask_admin" and out["questions"][0]["option"] == "credentials_file"


async def test_csv_preview_then_enroll_adds_learners_only(backend):
    prev = await enroll({"action": "preview", "sub_org_id": "so-1", "csv": CSV})
    assert prev["summary"] == {"learners": 1, "to_add": 1, "fully_skipped": 0}
    assert prev["seats"][0] == {"course": "Biology (Default batch)", "used": 1, "adding": 1, "cap": 3, "left_after": 1}
    assert "Send credentials" in prev["emails"]["login_details_email"]
    assert not backend.writes(sd.ADD_MEMBER_PATH)
    done = await enroll({"action": "enroll", "sub_org_id": "so-1", "csv": CSV, "confirm_token": prev["confirm_token"]})
    assert done["summary"] == {"added": 1, "failed": 0, "skipped": 0}
    body = backend.writes(sd.ADD_MEMBER_PATH)[0]["body"]
    assert body == {"user": {"email": "asha@x.com", "full_name": "Asha Verma", "mobile_number": "+91 91234 56789"},
                    "package_session_ids": ["ps-1", "ps-2"], "sub_org_id": "so-1", "institute_id": "inst-1",
                    "status": "ACTIVE", "comma_separated_org_roles": "LEARNER",
                    "custom_field_values": [{"custom_field_id": "cf-city", "value": "Delhi"}]}


async def test_enroll_needs_the_token_and_refuses_strangers(backend):
    assert (await enroll({"action": "enroll", "sub_org_id": "so-1", "csv": CSV}))["error"] == "confirm_required"
    assert (await enroll({"action": "preview", "sub_org_id": "so-x", "csv": CSV}))["error"] == "unknown_sub_org"
    assert (await enroll({"action": "preview", "sub_org_id": "so-2", "csv": CSV}))["error"] == "no_courses"
    out = await enroll({"action": "preview", "sub_org_id": "so-1", "csv": CSV, "batch_ids": ["ps-3"]})
    assert out["error"] == "unknown_batch"
    assert not backend.writes(sd.ADD_MEMBER_PATH)


async def test_rows_are_validated_and_nothing_is_sent_on_errors(backend):
    bad = ("email,full_name\n"
           "student@example.com,John Doe\n"
           ",No Email\n"
           "dup@x.com,A\n"
           "dup@x.com,B\n")
    out = await enroll({"action": "preview", "sub_org_id": "so-1", "csv": bad})
    assert out["error"] == "invalid_learners"
    text = " ".join(out["problems"])
    assert "sample value" in text and "email is required" in text and "repeats" in text
    # add-member has no parent fields: a column it would silently drop is refused.
    extra = await enroll({"action": "preview", "sub_org_id": "so-1", "csv": "email,full_name,fathers_name\na@x.com,A,Raj\n"})
    assert "unknown column(s) fathers_name" in " ".join(extra["problems"])
    assert not backend.writes(sd.ADD_MEMBER_PATH)


async def test_seat_cap_is_enforced_per_course(backend):
    rows = "email,full_name\n" + "".join(f"l{i}@x.com,L {i}\n" for i in range(3))
    out = await enroll({"action": "preview", "sub_org_id": "so-1", "csv": rows})
    assert out["error"] == "seats_exceeded" and out["seats"][0]["course"] == "Biology (Default batch)"
    assert out["seats"][0]["left_after"] == -1
    # Narrowed to the empty course, the same three fit.
    ok = await enroll({"action": "preview", "sub_org_id": "so-1", "csv": rows, "batch_ids": ["ps-2"]})
    assert ok["summary"]["to_add"] == 3 and ok["confirm_token"]


async def test_learners_already_in_a_course_are_skipped_there(backend):
    backend.active = [{"user_id": "u-old", "package_session_id": "ps-1", "sub_org_id": "so-1"},
                      {"user_id": "u-old", "package_session_id": "ps-2", "sub_org_id": None}]
    out = await enroll({"action": "preview", "sub_org_id": "so-1", "learners": [{"learner_id": "u-old"}]})
    row = out["learners"][0]
    assert row["add_to"] == [] and {s["reason"] for s in row["skipped"]} == {
        "already in this sub-org", "already enrolled in this course outside this sub-org (change it from the dashboard)"}
    assert out["summary"]["to_add"] == 0 and "confirm_token" not in out
    # A CSV row with that learner's email is the same person.
    backend.active = backend.active[:1]
    out = await enroll({"action": "preview", "sub_org_id": "so-1", "csv": "email,full_name\nold@x.com,Old\n"})
    assert out["learners"][0]["add_to"] == ["Chemistry (Default batch)"]


async def test_a_failed_row_does_not_stop_the_others(backend):
    csv_text = "email,full_name\na@x.com,A\nb@x.com,B\n"
    backend.fail_emails = {"b@x.com"}
    prev = await enroll({"action": "preview", "sub_org_id": "so-1", "csv": csv_text, "batch_ids": ["ps-2"]})
    done = await enroll({"action": "enroll", "sub_org_id": "so-1", "csv": csv_text, "batch_ids": ["ps-2"],
                         "confirm_token": prev["confirm_token"]})
    assert done["summary"] == {"added": 1, "failed": 1, "skipped": 0}
    failed = next(r for r in done["results"] if r["status"] == "FAILED")
    assert failed["email"] == "b@x.com" and "Member limit" in failed["message"]


async def test_credentials_file_is_a_link_never_the_passwords(backend, monkeypatch):
    import app.services.file_exports as fe
    from datetime import datetime, timedelta, timezone
    saved = {}

    def _create(db, **kw):
        saved.update(kw)
        return fe.ExportHandle(export_id="x", url="https://ai/ai-service/exports/x/key", kind=kw["kind"],
                               label="learner logins", file_name=kw["file_name"], size_bytes=10,
                               expires_at=datetime.now(timezone.utc) + timedelta(minutes=30), max_downloads=3)
    monkeypatch.setattr(fe, "create_export", _create)

    async def _logins(c, ids):
        return {i: {"username": i, "password": "Secret-" + i} for i in ids}
    monkeypatch.setattr(ld, "login_credentials", _logins)
    args = {"sub_org_id": "so-1", "csv": CSV, "options": {"credentials_file": True}}
    prev = await enroll({"action": "preview", **args})
    done = await enroll({"action": "enroll", **args, "confirm_token": prev["confirm_token"]})
    assert "Secret-" not in json.dumps(done)
    assert done["credentials_file"]["download_url"] == "https://ai/ai-service/exports/x/key"
    assert saved["source_tool"] == "sub_org_enroll" and "Secret-u-asha" in saved["content"]


async def test_runs_through_execute_tool_with_the_callers_identity(backend):
    from app.services.assistant_tool_registry import execute_tool
    setting = {"enabled_tools": ["sub_orgs", "sub_org_enrollments"], "role_overrides": {}}
    prev = json.loads(await execute_tool("sub_org_enroll", {
        "action": "preview", "sub_org_id": "so-1", "csv": CSV, "options": {"credentials_file": False},
        "institute_id": "inst-evil", "user_id": "someone"}, ctx(), setting))
    assert prev.get("confirm_token"), prev
    done = json.loads(await execute_tool("sub_org_enroll", {
        "action": "enroll", "sub_org_id": "so-1", "csv": CSV, "options": {"credentials_file": False},
        "confirm_token": prev["confirm_token"]}, ctx(), setting))
    assert done["summary"]["added"] == 1
    assert backend.writes(sd.ADD_MEMBER_PATH)[0]["body"]["institute_id"] == "inst-1"
