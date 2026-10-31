"""
Learners over MCP: `learners`, `learner_enroll`, `learner_edit`.

The connected LLM drives the conversation; these tools only validate and call
the same admin-core endpoints the dashboard does. So the tests pin down: the
enrol request is exactly the dashboard wizard's (dry run first, institute
forced, explicit invite); nothing is written without the confirm_token of a
preview of the identical request; invites / batches / learners from outside the
institute (or not enrollable from the dashboard's picker) are refused; and a
learner edit never touches email / username, always names its target, and
never echoes the password.
"""
import json
import sys
import time
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest  # noqa: E402
from app.schemas.auth import PinnedPrincipal  # noqa: E402
from app.services import course_builder_data as cbd  # noqa: E402
from app.services import learner_data as ld  # noqa: E402
from app.services.assistant_tool_registry import ASSISTANT_TOOLS, ToolContext, is_tool_allowed  # noqa: E402
from app.services.assistant_tools_learner_edit import execute_learner_edit  # noqa: E402
from app.services.assistant_tools_learner_enroll import ASSIGN_PATH, execute_learner_enroll  # noqa: E402
from app.services.assistant_tools_learners import execute_learners  # noqa: E402


class _FakeDb:
    def execute(self, stmt, params=None):
        return SimpleNamespace(first=lambda: None, fetchall=lambda: [])

    def rollback(self):
        pass


def principal(user_id="admin-1"):
    return PinnedPrincipal(user_id=user_id, institute_id="inst-1", roles=["ADMIN"], permissions=[],
                           is_root_user=False)


def ctx(user_id="admin-1"):
    return ToolContext(db=_FakeDb(), principal=principal(user_id), keys=(), bearer_token="jwt")


def _invite(iid, name, tag=None, status="ACTIVE", ptype="FREE", batches=("ps-1",), plans=()):
    return {"id": iid, "name": name, "status": status, "tag": tag, "is_default": tag == "DEFAULT",
            "payment_type": ptype, "payment_option_name": name, "currency": "INR", "learner_access_days": None,
            "plans": list(plans), "batch_ids": list(batches)}


SARTHAK = {"user_id": "u-sarthak", "full_name": "Sarthak Rao", "email": "sarthak@x.com", "username": "sarthak",
           "mobile_number": "+91 98765 43210", "gender": "MALE", "date_of_birth": None, "address_line": None,
           "city": "Pune", "region": None, "pin_code": None, "fathers_name": None, "mothers_name": None,
           "parents_mobile_number": None, "parents_email": None, "parents_to_mother_mobile_number": None,
           "parents_to_mother_email": None, "linked_institute_name": None}


class Backend:
    """Records admin-core / auth calls and answers like the real services."""

    def __init__(self):
        self.calls = []
        self.courses = {"course-1": {"id": "course-1", "name": "Biology", "status": "ACTIVE"},
                        "course-2": {"id": "course-2", "name": "Chemistry", "status": "ACTIVE"},
                        "course-multi": {"id": "course-multi", "name": "Physics", "status": "ACTIVE"}}
        self.batches = {"course-1": [{"id": "ps-1", "name": "Default batch", "enrolled": 3}],
                        "course-2": [{"id": "ps-2", "name": "Default batch", "enrolled": 0}],
                        "course-multi": [{"id": "ps-m1", "name": "2026 · Class 9", "enrolled": 0},
                                         {"id": "ps-m2", "name": "2026 · Class 10", "enrolled": 0}]}
        self.invites = [
            _invite("inv-1", "Biology free", tag="DEFAULT"),
            _invite("inv-2", "Chemistry paid", ptype="ONE_TIME", batches=("ps-2",),
                    plans=[{"name": "Full", "actual_price": 999, "currency": "INR", "validity_in_days": 365}]),
            _invite("inv-2b", "Chemistry free", tag="DEFAULT", batches=("ps-2",)),
            _invite("inv-suborg", "Org admin", tag="SUB_ORG", batches=("ps-2",)),
            _invite("inv-old", "Closed", status="INACTIVE", batches=("ps-2",)),
            _invite("inv-m1", "Physics 9", batches=("ps-m1",)),
            _invite("inv-m2", "Physics 10", batches=("ps-m2",)),
        ]
        self.org_batches = set()
        self.identifier = "EMAIL"
        self.toggles = {"notify_learners": True, "send_credentials": True}
        self.learners = {"u-sarthak": dict(SARTHAK),
                         "u-sarthak2": {**SARTHAK, "user_id": "u-sarthak2", "full_name": "Sarthak Jain",
                                        "email": "sj@x.com", "mobile_number": "+91 90000 00002"}}
        self.fields = [{"field_id": "cf-city", "label": "Home City", "type": "text", "required": False},
                       {"field_id": "cf-batch", "label": "Batch Pref", "type": "dropdown", "required": False,
                        "options": ["Morning", "Evening"]}]
        self.cf_values = {}
        self.phone_owners = []
        self.dry_run_outcome = "SUCCESS"
        self.workflows = []

    async def admin_core(self, ctx_, method, path, *, params=None, body=None, timeout=30.0):
        self.calls.append({"method": method, "path": path, "params": params or {}, "body": body})
        if path == ASSIGN_PATH:
            results = []
            ids = list(body.get("user_ids") or []) + [f"dry-run-{u['email']}" for u in body.get("new_users") or []]
            for a in body["assignments"]:
                for uid in ids:
                    results.append({"user_id": uid, "user_email": None, "package_session_id": a["package_session_id"],
                                    "status": self.dry_run_outcome,
                                    "action_taken": "CREATED" if self.dry_run_outcome == "SUCCESS" else "NONE"})
            ok = sum(r["status"] == "SUCCESS" for r in results)
            return {"dry_run": body["options"]["dry_run"], "results": results,
                    "summary": {"total_requested": len(results), "successful": ok, "skipped": len(results) - ok,
                                "failed": 0, "re_enrolled": 0}}
        if path.endswith("/workflows-with-schedules/list"):
            return {"content": [dict(w) for w in self.workflows]}
        if path.endswith("/learner/info/v1/profile"):
            return "Done"
        if path.endswith("/learner-credentials/v1/send"):
            return {"sent_channels": params["channels"].split(","), "skipped_channels": []}
        return "ok"

    async def auth_call(self, ctx_, method, path, *, body=None, params=None, timeout=20.0):
        self.calls.append({"method": method, "path": path, "params": params or {}, "body": body})
        return "Password updated"

    def rows(self, ctx_, sql, params):
        if "custom_field_values" in sql:
            return [{"custom_field_id": k, "value": v} for k, v in self.cf_values.items()]
        if "regexp_replace" in sql and ":phone" in sql:
            return [o for o in self.phone_owners if ld.digits(o["phone"]) == params["phone"]]
        return []

    def assign_calls(self):
        return [c for c in self.calls if c["path"] == ASSIGN_PATH]


@pytest.fixture
def backend(monkeypatch):
    b = Backend()
    monkeypatch.setattr(cbd, "admin_core", b.admin_core)
    monkeypatch.setattr(cbd, "_rows", b.rows)
    monkeypatch.setattr(cbd, "course_row", lambda c, cid: dict(b.courses[cid]) if cid in b.courses else None)
    monkeypatch.setattr(cbd, "course_batches", lambda c, cid: [dict(x) for x in b.batches.get(cid, [])])
    monkeypatch.setattr(cbd, "invites_for_batches",
                        lambda c, ps: [dict(i) for i in b.invites if set(i["batch_ids"]) & set(ps)])
    monkeypatch.setattr(cbd, "admin_base", lambda c: "https://dash")
    monkeypatch.setattr(ld, "auth_call", b.auth_call)
    monkeypatch.setattr(ld, "org_associated_batches", lambda c, ids: {i for i in ids if i in b.org_batches})

    async def _identifier(c):
        return b.identifier

    async def _toggles(c):
        return dict(b.toggles)

    async def _fields(c):
        return [dict(f) for f in b.fields]
    monkeypatch.setattr(ld, "user_identifier", _identifier)
    monkeypatch.setattr(ld, "notification_toggles", _toggles)
    monkeypatch.setattr(ld, "custom_field_catalogue", _fields)
    monkeypatch.setattr(ld, "learner_profile", lambda c, uid: dict(b.learners[uid]) if uid in b.learners else None)
    monkeypatch.setattr(ld, "learners_by_ids", lambda c, ids: {i: dict(b.learners[i]) for i in ids if i in b.learners})
    monkeypatch.setattr(ld, "search_learners", lambda c, q, limit=10: [
        dict(p) for p in b.learners.values() if q.lower() in (p["full_name"] or "").lower()])
    monkeypatch.setattr(ld, "enrolments", lambda c, ids: {i: [{"course": "Biology", "batch": "Default batch",
                                                              "status": "ACTIVE"}] for i in ids})

    def _match(c, emails, phones):
        out = []
        for p in b.learners.values():
            if (p["email"] or "").lower() in emails or ld.digits(p["mobile_number"]) in phones:
                out.append({"user_id": p["user_id"], "full_name": p["full_name"], "email": p["email"],
                            "phone": ld.digits(p["mobile_number"])})
        return out
    monkeypatch.setattr(ld, "match_existing", _match)
    return b


ANSWERED = {"send_welcome_email": False, "send_credentials": False, "credentials_file": False}


async def enroll(args, c=None, answered=True):
    """`answered`: the admin has already given both email answers (only the email tests leave them out)."""
    if answered:
        args = {**args, "options": {**ANSWERED, **(args.get("options") or {})}}
    return json.loads(await execute_learner_enroll(args, c or ctx()))


async def edit(args, c=None):
    return json.loads(await execute_learner_edit(args, c or ctx()))


async def read(args):
    return json.loads(await execute_learners(args, ctx()))


NEW_ROW = {"full_name": "Asha Verma", "email": "asha@x.com", "mobile_number": "+91 91234 56789"}


# ── registry / gating ────────────────────────────────────────────────────
def test_read_tool_is_admin_scoped_and_writes_are_off_by_default():
    assert ASSISTANT_TOOLS["learners"].mode == "READ"
    assert is_tool_allowed("learners", principal(), {"enabled_tools": ["learners"], "role_overrides": {}})
    for name, group in (("learner_enroll", "learner_enrollments"), ("learner_edit", "learner_profile_edits")):
        spec = ASSISTANT_TOOLS[name]
        assert spec.mode == "WRITE" and spec.key() == group
        assert not spec.default_enabled and not spec.default_roles
        assert not is_tool_allowed(name, principal(), None)
        assert not is_tool_allowed(name, principal(), {"enabled_tools": ["learners"], "role_overrides": {}})
        assert is_tool_allowed(name, principal(), {"enabled_tools": [group], "role_overrides": {}})


# ── learners (read) ──────────────────────────────────────────────────────
async def test_find_lists_every_match_and_asks_which(backend):
    out = await read({"action": "find", "query": "sarthak"})
    assert out["count"] == 2
    assert {m["mobile_number"] for m in out["matches"]} == {"+91 98765 43210", "+91 90000 00002"}
    assert "ask" in out["note"]


async def test_enroll_options_hide_sub_org_and_inactive_invites_and_flag_org_batches(backend):
    backend.org_batches = {"ps-1"}
    out = await read({"action": "enroll_options", "course_ids": ["course-1", "course-2", "nope"]})
    bio, chem = out["courses"]
    assert bio["batches"][0]["enrollable"] is False and "invites" not in bio["batches"][0]
    assert [i["invite_id"] for i in chem["batches"][0]["invites"]] == ["inv-2", "inv-2b"]
    assert chem["batches"][0]["invites"][0]["plans"][0]["price"] == 999
    assert out["unknown_course_ids"] == ["nope"]


@pytest.mark.parametrize("identifier,required", [("EMAIL", "email"), ("PHONE", "mobile_number")])
async def test_template_matches_the_dashboard_columns(backend, identifier, required):
    backend.identifier = identifier
    out = await read({"action": "enroll_template"})
    cols = {c["column"]: c for c in out["columns"]}
    assert cols[required]["required"] and cols["full_name"]["required"]
    other = "mobile_number" if required == "email" else "email"
    assert not cols[other]["required"]
    assert cols["cf_home_city"]["custom_field_id"] == "cf-city"
    assert cols["cf_batch_pref"]["options"] == ["Morning", "Evening"]
    assert out["csv"].splitlines()[0].startswith("email,full_name,mobile_number,")


# ── learner_enroll ───────────────────────────────────────────────────────
async def test_preview_sends_the_dashboard_request_then_enroll_repeats_it_for_real(backend):
    args = {"learners": [{"learner_id": "u-sarthak"}, NEW_ROW],
            "courses": [{"course_id": "course-1"}, {"course_id": "course-2", "invite_id": "inv-2", "access_days": 30}],
            "options": {"send_welcome_email": True}}
    out = await enroll({"action": "preview", **args})
    assert out["dry_run"] and out["confirm_token"]
    assert out["summary"]["successful"] == 4
    assert [c["invite"]["invite_id"] for c in out["courses"]] == ["inv-1", "inv-2"]
    (call,) = backend.assign_calls()
    body = call["body"]
    assert body["institute_id"] == "inst-1"
    assert body["user_ids"] == ["u-sarthak"]
    assert body["new_users"][0]["email"] == "asha@x.com" and body["new_users"][0]["full_name"] == "Asha Verma"
    assert body["assignments"] == [
        {"package_session_id": "ps-1", "enroll_invite_id": "inv-1", "access_days": None},
        {"package_session_id": "ps-2", "enroll_invite_id": "inv-2", "access_days": 30}]
    assert body["options"] == {"duplicate_handling": "SKIP", "notify_learners": True, "send_credentials": False,
                               "dry_run": True}

    done = await enroll({"action": "enroll", **args, "confirm_token": out["confirm_token"]})
    assert done["done"] is True
    real = backend.assign_calls()[-1]["body"]
    assert real["options"]["dry_run"] is False
    assert {k: v for k, v in real.items() if k != "options"} == {k: v for k, v in body.items() if k != "options"}


async def test_enroll_needs_the_token_of_the_identical_preview(backend):
    args = {"learners": [{"learner_id": "u-sarthak"}], "courses": [{"course_id": "course-1"}]}
    assert (await enroll({"action": "enroll", **args}))["error"] == "confirm_required"
    token = (await enroll({"action": "preview", **args}))["confirm_token"]
    changed = {**args, "learners": [{"learner_id": "u-sarthak"}, {"learner_id": "u-sarthak2"}]}
    assert (await enroll({"action": "enroll", **changed, "confirm_token": token}))["error"] == "confirm_token_mismatch"
    assert (await enroll({"action": "enroll", **args, "confirm_token": "123.abc"}))["error"] == "confirm_token_expired"
    # Another admin cannot replay it either.
    other = await enroll({"action": "enroll", **args, "confirm_token": token}, ctx("admin-2"))
    assert other["error"] == "confirm_token_mismatch"
    assert all(c["body"]["options"]["dry_run"] for c in backend.assign_calls())


async def test_expired_token_is_refused(backend, monkeypatch):
    args = {"learners": [{"learner_id": "u-sarthak"}], "courses": [{"course_id": "course-1"}]}
    token = (await enroll({"action": "preview", **args}))["confirm_token"]
    real_time = time.time
    monkeypatch.setattr(ld.time, "time", lambda: real_time() + ld.CONFIRM_TTL_SECONDS + 5)
    assert (await enroll({"action": "enroll", **args, "confirm_token": token}))["error"] == "confirm_token_expired"


async def test_several_invites_need_a_choice_and_foreign_or_hidden_invites_are_refused(backend):
    base = {"action": "preview", "learners": [{"learner_id": "u-sarthak"}]}
    out = await enroll({**base, "courses": [{"course_id": "course-2"}]})
    assert out["error"] == "choose_invite" and {i["invite_id"] for i in out["invites"]} == {"inv-2", "inv-2b"}
    for bad in ("inv-suborg", "inv-old", "inv-1", "inv-other-institute"):
        out = await enroll({**base, "courses": [{"course_id": "course-2", "invite_id": bad}]})
        assert out["error"] == "unknown_invite", bad
    assert not backend.assign_calls()


async def test_multi_batch_course_needs_a_batch_and_org_batches_are_refused(backend):
    base = {"action": "preview", "learners": [{"learner_id": "u-sarthak"}]}
    assert (await enroll({**base, "courses": [{"course_id": "course-multi"}]}))["error"] == "choose_batch"
    ok = await enroll({**base, "courses": [{"course_id": "course-multi", "batch_id": "ps-m2"}]})
    assert ok["courses"][0]["invite"]["invite_id"] == "inv-m2"
    backend.org_batches = {"ps-1"}
    assert (await enroll({**base, "courses": [{"course_id": "course-1"}]}))["error"] == "org_batch_unsupported"


async def test_csv_rows_are_validated_like_the_dashboard_and_nothing_is_sent_on_errors(backend):
    csv_text = ("email,full_name,username,payment_date,cf_batch_pref,cf_shoe_size\n"
                "bad-email,Ravi,,,,\n"
                ",No Email,,,,\n"
                "k@x.com,,has space,32/13/2025,,\n"
                "z@x.com,Zed,,,Morning,42\n")
    out = await enroll({"action": "preview", "csv": csv_text, "courses": [{"course_id": "course-1"}]})
    assert out["error"] == "invalid_learners"
    text = " ".join(out["problems"])
    for needle in ("row 2: 'bad-email' is not a valid email", "row 3: email is required",
                   "row 4: full_name is required", "username cannot contain spaces", "payment_date '32/13/2025'",
                   "cf_shoe_size"):
        assert needle in text, needle
    assert not backend.assign_calls()


async def test_csv_maps_custom_fields_payment_and_transaction(backend):
    csv_text = ("email,full_name,payment_date,transaction_id,cf_batch_pref,gender\n"
                "z@x.com,Zed,15/01/2025,TXN-9,Morning,female\n")
    out = await enroll({"action": "preview", "csv": csv_text, "courses": [{"course_id": "course-1"}]})
    assert out["confirm_token"]
    body = backend.assign_calls()[0]["body"]
    user = body["new_users"][0]
    assert user["payment_date"] == "2025-01-15" and user["gender"] == "FEMALE"
    assert user["custom_field_values"] == [{"custom_field_id": "cf-batch", "value": "Morning"}]
    assert body["options"]["transaction_id"] == "TXN-9" and body["options"]["payment_date"] == "2025-01-15"


async def test_phone_institutes_need_mobile_not_email(backend):
    backend.identifier = "PHONE"
    out = await enroll({"action": "preview", "learners": [{"full_name": "No Phone", "email": "np@x.com"}],
                        "courses": [{"course_id": "course-1"}]})
    assert "mobile_number is required" in out["problems"][0]
    out = await enroll({"action": "preview", "learners": [{"full_name": "Phone Only", "mobile_number": "9123456780"}],
                        "courses": [{"course_id": "course-1"}]})
    assert out["confirm_token"] and backend.assign_calls()[0]["body"]["new_users"][0]["email"] == ""


async def test_rows_for_existing_learners_enrol_them_by_id(backend):
    out = await enroll({"action": "preview", "courses": [{"course_id": "course-1"}],
                        "learners": [{"full_name": "Sarthak R", "email": "SARTHAK@x.com"}, NEW_ROW]})
    assert out["learners"]["matched_existing"][0]["learner_id"] == "u-sarthak"
    body = backend.assign_calls()[0]["body"]
    assert body["user_ids"] == ["u-sarthak"] and [u["email"] for u in body["new_users"]] == ["asha@x.com"]


async def test_unknown_user_ids_and_duplicate_rows_are_refused(backend):
    out = await enroll({"action": "preview", "courses": [{"course_id": "course-1"}],
                        "learners": [{"user_id": "u-elsewhere"}, NEW_ROW, {**NEW_ROW, "full_name": "Asha again"}]})
    text = " ".join(out["problems"])
    assert "u-elsewhere" in text and "repeats" in text
    assert not backend.assign_calls()


async def test_re_enroll_and_disabled_notifications_are_refused(backend):
    base = {"action": "preview", "learners": [{"learner_id": "u-sarthak"}], "courses": [{"course_id": "course-1"}]}
    assert (await enroll({**base, "options": {"duplicate_handling": "RE_ENROLL"}}))["error"] == "invalid_option"
    backend.toggles["send_credentials"] = False
    with_new = {**base, "learners": [NEW_ROW]}
    assert (await enroll({**with_new, "options": {"send_credentials": True}}))["error"] == "option_disabled"
    assert (await enroll({**base, "options": {"payment_date": "2999-01-01"}}))["error"] == "invalid_option"
    assert not backend.assign_calls()


async def test_nothing_to_enrol_gives_no_token(backend):
    backend.dry_run_outcome = "SKIPPED"
    out = await enroll({"action": "preview", "learners": [{"learner_id": "u-sarthak"}],
                        "courses": [{"course_id": "course-1"}]})
    assert "confirm_token" not in out and out["summary"]["skipped"] == 1


async def test_too_many_learners(backend):
    rows = [{"full_name": f"L{i}", "email": f"l{i}@x.com"} for i in range(201)]
    out = await enroll({"action": "preview", "learners": rows, "courses": [{"course_id": "course-1"}]})
    assert out["error"] == "too_many_learners"


# ── learner_edit ─────────────────────────────────────────────────────────
def _profile_calls(b):
    return [c for c in b.calls if c["path"].endswith("/learner/info/v1/profile")]


async def test_edit_previews_before_after_then_sends_only_the_change(backend):
    args = {"learner_id": "u-sarthak", "changes": {"phone": "+91 99999 11111", "city": "Pune", "full_name": "Sarthak R."}}
    out = await edit({"action": "preview", **args})
    rows = {r["field"]: r for r in out["changes"]}
    assert rows["mobile_number"]["from"] == "+91 98765 43210" and rows["mobile_number"]["to"] == "+91 99999 11111"
    assert "city" not in rows  # unchanged values are dropped
    assert not _profile_calls(backend)

    done = await edit({"action": "apply", **args, "confirm_token": out["confirm_token"]})
    assert done["done"] is True
    (call,) = _profile_calls(backend)
    assert call["method"] == "PUT"
    assert call["body"] == {"user_details": {"id": "u-sarthak", "full_name": "Sarthak R.",
                                             "mobile_number": "+91 99999 11111"}}


async def test_parent_only_edit_still_names_the_learner(backend):
    """Without user_details.id admin-core would write onto the CALLER's own profile."""
    args = {"learner_id": "u-sarthak", "changes": {"fathers_name": "Mr Rao"}}
    token = (await edit({"action": "preview", **args}))["confirm_token"]
    await edit({"action": "apply", **args, "confirm_token": token})
    body = _profile_calls(backend)[0]["body"]
    assert body["user_details"] == {"id": "u-sarthak"}
    assert body["learner_extra_details"] == {"fathers_name": "Mr Rao"}


@pytest.mark.parametrize("field", ["email", "username"])
async def test_email_and_username_are_locked(backend, field):
    out = await edit({"action": "preview", "learner_id": "u-sarthak", "changes": {field: "new@x.com"}})
    assert out["error"] == "field_locked"


async def test_password_goes_through_auth_and_is_never_echoed(backend):
    args = {"learner_id": "u-sarthak", "password": "S3cret-pass", "send_credentials_via": ["email"]}
    out = await edit({"action": "preview", **args})
    assert "S3cret-pass" not in json.dumps(out)
    done = await edit({"action": "apply", **args, "confirm_token": out["confirm_token"]})
    assert "S3cret-pass" not in json.dumps(done)
    assert done["saved"] == ["password"] and not _profile_calls(backend)
    pwd = next(c for c in backend.calls if c["path"].endswith("/update-password"))
    assert pwd["body"] == {"user_id": "u-sarthak", "password": "S3cret-pass"}
    creds = next(c for c in backend.calls if c["path"].endswith("/learner-credentials/v1/send"))
    assert creds["params"] == {"instituteId": "inst-1", "userId": "u-sarthak", "channels": "EMAIL"}


async def test_edit_rejects_bad_values_and_strangers(backend):
    out = await edit({"action": "preview", "learner_id": "u-sarthak",
                      "changes": {"mobile_number": "12", "gender": "x", "pin_code": "", "nickname": "S"},
                      "password": "a b", "send_credentials_via": ["SMS"]})
    text = " ".join(out["problems"])
    for needle in ("not a valid phone", "gender", "cannot be cleared", "nickname", "password", "SMS"):
        assert needle in text, needle
    assert (await edit({"action": "preview", "learner_id": "u-other-institute",
                        "changes": {"city": "Goa"}}))["error"] == "unknown_learner"
    assert (await edit({"action": "preview", "learner_id": "u-sarthak",
                        "send_credentials_via": ["EMAIL"], "changes": {"city": "Goa"}}))["error"] == "invalid_change"


async def test_apply_needs_a_fresh_token_when_the_learner_changed_meanwhile(backend):
    args = {"learner_id": "u-sarthak", "changes": {"city": "Goa"}}
    assert (await edit({"action": "apply", **args}))["error"] == "confirm_required"
    token = (await edit({"action": "preview", **args}))["confirm_token"]
    backend.learners["u-sarthak"]["city"] = "Mumbai"  # edited in the dashboard after the preview
    assert (await edit({"action": "apply", **args, "confirm_token": token}))["error"] == "confirm_token_mismatch"
    assert not _profile_calls(backend)


async def test_duplicate_phone_blocks_phone_institutes_and_warns_others(backend):
    backend.phone_owners = [{"user_id": "u-x", "full_name": "Other Kid", "phone": "+91 88888 77777"}]
    args = {"action": "preview", "learner_id": "u-sarthak", "changes": {"mobile_number": "+918888877777"}}
    out = await edit(args)
    assert out["confirm_token"] and "Other Kid" in out["warnings"][0]
    backend.identifier = "PHONE"
    assert "must be unique" in " ".join((await edit(args))["problems"])


async def test_custom_fields_by_label_with_choice_validation(backend):
    backend.cf_values = {"cf-batch": "Morning"}
    bad = await edit({"action": "preview", "learner_id": "u-sarthak", "custom_fields": {"Batch Pref": "Night"}})
    assert "Morning, Evening" in bad["problems"][0]
    same = await edit({"action": "preview", "learner_id": "u-sarthak", "custom_fields": {"batch pref": "morning"}})
    assert same["error"] == "no_changes"
    args = {"learner_id": "u-sarthak", "custom_fields": {"batch pref": "evening"}}
    token = (await edit({"action": "preview", **args}))["confirm_token"]
    await edit({"action": "apply", **args, "confirm_token": token})
    body = _profile_calls(backend)[0]["body"]
    assert body["custom_field_values"] == [{"source_type": "USER", "source_id": "u-sarthak",
                                            "custom_field_id": "cf-batch", "value": "Evening"}]
    assert body["user_details"] == {"id": "u-sarthak"}


# ── enrolment emails: always the admin's call ────────────────────────────
def _wf(name, event_id=None, event="LEARNER_BATCH_ENROLLMENT", status="ACTIVE"):
    return {"workflow_name": name, "trigger_event_name": event, "event_id": event_id, "trigger_status": status}


async def test_preview_asks_about_both_emails_before_anything_runs(backend):
    out = await enroll({"action": "preview", "learners": [{"learner_id": "u-sarthak"}, NEW_ROW],
                        "courses": [{"course_id": "course-1"}]}, answered=False)
    assert out["error"] == "ask_admin"
    assert [q["option"] for q in out["questions"]] == ["send_welcome_email", "send_credentials",
                                                        "credentials_file"]
    assert not backend.assign_calls()


async def test_credentials_question_only_when_new_accounts_are_created(backend):
    out = await enroll({"action": "preview", "learners": [{"learner_id": "u-sarthak"}],
                        "courses": [{"course_id": "course-1"}],
                        "options": {"send_welcome_email": "yes", "credentials_file": False}},
                       answered=False)
    assert out["confirm_token"]
    assert out["emails"]["welcome_email"] == "will be sent"
    assert out["emails"]["login_details_email"].startswith("not applicable")
    assert backend.assign_calls()[0]["body"]["options"]["notify_learners"] is True


async def test_switches_off_in_course_settings_are_not_asked_and_cannot_be_forced(backend):
    backend.toggles = {"notify_learners": False, "send_credentials": False}
    base = {"action": "preview", "learners": [NEW_ROW], "courses": [{"course_id": "course-1"}]}
    out = await enroll({**base, "options": {"credentials_file": False}}, answered=False)
    assert out["confirm_token"]
    assert backend.assign_calls()[0]["body"]["options"] == {"duplicate_handling": "SKIP", "notify_learners": False,
                                                           "send_credentials": False, "dry_run": True}
    forced = await enroll({**base, "options": {"send_welcome_email": True, "credentials_file": False}},
                          answered=False)
    assert forced["error"] == "option_disabled"


async def test_preview_names_the_automations_that_email_anyway(backend):
    backend.workflows = [_wf("Global welcome"), _wf("Bio onboarding", event_id="ps-1"),
                         _wf("Paused one", status="INACTIVE"), _wf("Fee reminder", event="PAYMENT_DUE")]
    out = await enroll({"action": "preview", "learners": [{"learner_id": "u-sarthak"}],
                        "courses": [{"course_id": "course-1"}, {"course_id": "course-2", "invite_id": "inv-2"}]})
    runs = {r["course"]: r["automations"] for r in out["emails"]["automations_that_run_anyway"]}
    # A batch's own enrolment automation replaces the institute-wide one for that batch.
    assert runs == {"Biology": ["Bio onboarding"], "Chemistry": ["Global welcome"]}
    opts = await read({"action": "enroll_options", "course_ids": ["course-1"]})
    assert opts["courses"][0]["batches"][0]["automations_on_enrolment"] == ["Bio onboarding"]
    assert opts["options_allowed"] == {"send_welcome_email": True, "send_credentials": True}


# ── credentials file: link only, passwords never in the chat ─────────────
async def test_credentials_file_goes_into_a_link_and_never_into_the_result(backend, monkeypatch):
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
        return {"u-sarthak": {"username": "sarthak", "password": "=Pw-sarthak"},
                "dry-run-asha@x.com": {"username": "asha@x.com", "password": "Pw-asha"}}
    monkeypatch.setattr(ld, "login_credentials", _logins)

    args = {"learners": [{"learner_id": "u-sarthak"}, NEW_ROW],
            "courses": [{"course_id": "course-1"}, {"course_id": "course-2", "invite_id": "inv-2"}],
            "options": {"credentials_file": True}}
    preview = await enroll({"action": "preview", **args})
    assert "download link" in preview["credentials_file"]
    # The answer is covered by the token: a "no" preview cannot be used to enrol with a file, or vice versa.
    flipped = await enroll({"action": "enroll", **args, "options": {"credentials_file": False},
                            "confirm_token": preview["confirm_token"]})
    assert flipped["error"] == "confirm_token_mismatch"

    done = await enroll({"action": "enroll", **args, "confirm_token": preview["confirm_token"]})
    dumped = json.dumps(done)
    assert "Pw-sarthak" not in dumped and "Pw-asha" not in dumped
    assert done["credentials_file"]["download_url"] == "https://ai/ai-service/exports/x/key"
    assert done["credentials_file"]["learners"] == 2
    assert "do not open" in done["credentials_file"]["note"]
    assert saved["kind"] == "ENROLMENT_CREDENTIALS" and saved["source_tool"] == "learner_enroll"
    assert saved["metadata"] == {"learners": 2, "without_password": 0, "batch_ids": ["ps-1", "ps-2"]}

    lines = saved["content"].splitlines()
    assert lines[0] == "full_name,email,mobile_number,username,password,courses,account"
    sarthak = next(l for l in lines if "u-sarthak" in l or "Sarthak Rao" in l)
    assert "'=Pw-sarthak" in sarthak  # formula-looking cell neutralised
    assert sarthak.endswith(",Biology; Chemistry,existing")
    assert any(l.endswith(",new") and "Pw-asha" in l for l in lines)
    assert saved["institute_id"] == "inst-1" and saved["user_id"] == "admin-1"


async def test_no_file_when_nobody_was_enrolled(backend):
    backend.dry_run_outcome = "SKIPPED"
    from app.services.assistant_tools_learner_enroll import _credentials_file
    out = await _credentials_file(ctx(), {"results": [{"user_id": "u-sarthak", "status": "SKIPPED"}]},
                                  {"user_ids": ["u-sarthak"]}, {"courses": [], "learners": {}})
    assert out["status"] == "not_created"


# ── regression: the tool runner overwrites a top-level user_id with the CALLER ──
async def test_get_and_edit_target_the_learner_not_the_connected_admin(backend):
    """Through the real runner (execute_tool), which forces args['user_id'] = the caller. The admin is
    also a learner of the institute — exactly the live report: every lookup came back as the admin."""
    from app.services.assistant_tool_registry import execute_tool
    backend.learners["admin-1"] = {**SARTHAK, "user_id": "admin-1", "full_name": "ManshuAdmin",
                                   "email": "admin@x.com", "mobile_number": "919682419977"}
    setting = {"enabled_tools": ["learners", "learner_profile_edits"], "role_overrides": {}}
    got = json.loads(await execute_tool("learners", {"action": "get", "learner_id": "u-sarthak"}, ctx(), setting))
    assert got["learner"]["learner_id"] == "u-sarthak" and got["learner"]["full_name"] == "Sarthak Rao"
    prev = json.loads(await execute_tool("learner_edit", {"action": "preview", "learner_id": "u-sarthak",
                                                          "changes": {"mobile_number": "+91 97777 00000"}},
                                         ctx(), setting))
    assert prev["learner"]["learner_id"] == "u-sarthak"
    assert prev["changes"][0]["from"] == "+91 98765 43210"
    # A model with a stale schema that still sends user_id gets the learner it named — never the admin.
    old = json.loads(await execute_tool("learners", {"action": "get", "user_id": "u-sarthak"}, ctx(), setting))
    assert old["learner"]["learner_id"] == "u-sarthak"
    old_prev = json.loads(await execute_tool("learner_edit", {"action": "preview", "user_id": "u-sarthak",
                                                              "changes": {"mobile_number": "+91 97777 00000"}},
                                             ctx(), setting))
    assert old_prev["learner"]["learner_id"] == "u-sarthak" and old_prev.get("confirm_token")
    # …and applying that preview with user_id again goes through.
    done = json.loads(await execute_tool("learner_edit", {"action": "apply", "user_id": "u-sarthak",
                                                          "changes": {"mobile_number": "+91 97777 00000"},
                                                          "confirm_token": old_prev["confirm_token"]},
                                         ctx(), setting))
    assert "error" not in done, done
    # No id at all is a clear error, not "unknown learner".
    none = json.loads(await execute_tool("learners", {"action": "get"}, ctx(), setting))
    assert none["error"] == "missing_learner_id"
    none = json.loads(await execute_tool("learner_edit", {"action": "preview", "changes": {"full_name": "X"}},
                                         ctx(), setting))
    assert none["error"] == "missing_learner_id"


def test_no_mcp_tool_takes_a_top_level_user_id_or_institute_id():
    """execute_tool overwrites both with the pinned principal, so a tool that reads them as a TARGET silently
    acts on the caller. Targets must use other names (learner_id, target_user_id …)."""
    from app.mcp.constants import MCP_EXPOSED_TOOLS
    for name in MCP_EXPOSED_TOOLS:
        if name not in ASSISTANT_TOOLS:     # not registered (yet): test_mcp_adapter checks every exposed name exists
            continue
        props = ((ASSISTANT_TOOLS[name].schema.get("function") or {}).get("parameters") or {}).get("properties") or {}
        assert not {"user_id", "institute_id"} & set(props), name


# ── enrolment: passwords, sample values, what is sent ────────────────────
async def test_learners_without_a_password_get_one_after_enrolling(backend, monkeypatch):
    """auth-service reuses an existing Vacademy account (website form, OTP sign-up) as is — with no password."""
    import app.services.file_exports as fe
    from datetime import datetime, timedelta, timezone
    saved = {}

    def _create(db, **kw):
        saved.update(kw)
        return fe.ExportHandle(export_id="x", url="https://ai/x/k", kind=kw["kind"], label="learner logins",
                               file_name=kw["file_name"], size_bytes=1,
                               expires_at=datetime.now(timezone.utc) + timedelta(minutes=30), max_downloads=3)
    monkeypatch.setattr(fe, "create_export", _create)

    async def _logins(c, ids):
        return {"u-sarthak": {"username": "sarthak", "password": "Existing-1"},
                "dry-run-asha@x.com": {"username": "asha@x.com", "password": None}}
    monkeypatch.setattr(ld, "login_credentials", _logins)

    args = {"learners": [{"learner_id": "u-sarthak"}, NEW_ROW], "courses": [{"course_id": "course-1"}],
            "options": {"credentials_file": True}}
    token = (await enroll({"action": "preview", **args}))["confirm_token"]
    done = await enroll({"action": "enroll", **args, "confirm_token": token})

    sets = [c for c in backend.calls if c["path"].endswith("/update-password")]
    assert len(sets) == 1 and sets[0]["body"]["user_id"] == "dry-run-asha@x.com"   # the one with none
    new_pw = sets[0]["body"]["password"]
    assert len(new_pw) == 10 and new_pw not in json.dumps(done)                      # never in the chat
    assert "1 learner(s)" in done["passwords_set"]
    assert new_pw in saved["content"] and "Existing-1" in saved["content"]           # both in the file
    assert "not available" not in saved["content"]


async def test_template_sample_values_are_refused(backend):
    out = await enroll({"action": "preview", "courses": [{"course_id": "course-1"}],
                        "learners": [{"full_name": "Asha", "email": "asha@x.com", "mobile_number": "+91 9876543210"},
                                     {"full_name": "John Doe", "email": "student@example.com"}]})
    text = " ".join(out["problems"])
    assert "learner 1: mobile_number is the template's sample value" in text
    assert "learner 2: email is the template's sample value" in text
    assert not backend.assign_calls()


async def test_preview_shows_exactly_what_is_sent_for_new_learners(backend):
    out = await enroll({"action": "preview", "courses": [{"course_id": "course-1"}],
                        "learners": [{"full_name": "Asha Verma", "email": "asha@x.com"}]})
    assert out["learners"]["new_learner_details"] == [{"full_name": "Asha Verma", "email": "asha@x.com"}]
    assert "keeps its own details" in out["accounts_note"]
    assert "mobile_number" not in backend.assign_calls()[0]["body"]["new_users"][0]
