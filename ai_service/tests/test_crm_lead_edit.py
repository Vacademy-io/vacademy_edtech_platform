"""
crm_lead_activity / crm_lead_edit / crm_lead_intake — the CRM lead writes over MCP.

Pinned here: every action's happy path and the exact admin-core requests it
sends (paths, params, JSON casing); that a counsellor cannot see or act on a
lead outside their scope and that ids of another institute are refused before
any write; that previews never write (no POST / PUT reaches admin-core); the
confirm-token rules (one lead = edit token bound to the lead's state, several
= single-use token carrying the exact targets; mismatch, replay, expiry); the
hourly caps on single-use writes; masking in lead lists; and that a status
change an automation listens to waits for a confirm while the rest of a
logged interaction is saved at once.
"""
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services import assistant_tool_registry as registry  # noqa: E402,F401  (loads the tool modules in order)
from app.services import crm_data as cd  # noqa: E402
from app.services import entitlements as ent  # noqa: E402
from app.services import institute_setting_reader as isr  # noqa: E402
from app.services import assistant_tools_crm_lead_edit as m  # noqa: E402
from crm_fakes import CrmBackend, confirm_db, lead_row, make_ctx  # noqa: E402

import pytest  # noqa: E402

TIMELINE = cd.TIMELINE_EVENT_PATH
STATUS_ONE = "/admin-core-service/v1/lead-status/lead/"
STATUS_BULK = "/admin-core-service/v1/lead-status/leads/bulk"
FOLLOWUP = "/admin-core-service/v1/lead-followup"
UUID = "3f2a9c1e-1b2c-4d5e-8f90-a1b2c3d4e5f6"


# ── fakes ────────────────────────────────────────────────────────────────

class Leads:
    """audience_response rows of this institute as crm_data's SELECTs see them (in_scope per row)."""

    def __init__(self, *rows):
        self.rows = {r["lead_id"]: r for r in rows}

    def __call__(self, p, sql):
        rows = list(self.rows.values())
        if "AS phone_digits" in sql:                                   # intake / duplicate check
            out = []
            for r in rows:
                d = "".join(c for c in str(r.get("parent_mobile") or "") if c.isdigit())
                e = str(r.get("parent_email") or "").lower()
                if d[-10:] in (p.get("tails") or []) or d in (p.get("shorts") or []) or e in (p.get("emails") or []):
                    out.append({**r, "phone_digits": d, "email_lc": e})
            return out
        if "ar.user_id = ANY(:uids)" in sql:                            # a person's other leads
            return [{"id": r["lead_id"]} for r in rows
                    if r.get("lead_user_id") in p["uids"] and r.get("audience_status") == "ACTIVE"]
        if "ar.id = :lid" in sql:
            return [r for r in rows if r["lead_id"] == p["lid"]]
        if "ar.user_id = :luid" in sql:
            return [r for r in rows if r.get("lead_user_id") == p["luid"]]
        if "ar.id = ANY(:lids)" in sql:
            return [r for r in rows if r["lead_id"] in p["lids"]]
        if "ptail" in p:
            return [r for r in rows if "".join(c for c in str(r.get("parent_mobile") or "") if c.isdigit())
                    .endswith(p["ptail"])]
        return []


STATUSES = [{"id": "st-new", "status_key": "NEW", "label": "New"},
            {"id": "st-int", "status_key": "INTERESTED", "label": "Interested"},
            {"id": "st-won", "status_key": "CONVERTED", "label": "Admitted"}]


def _statuses(p, sql):
    ids = [str(i).upper() for i in p["ids"]]
    return [s for s in STATUSES if s["id"].upper() in ids or s["status_key"] in ids]


@pytest.fixture
def backend(monkeypatch):
    b = CrmBackend().install(monkeypatch)
    b.leads = Leads(lead_row("r-1", "u-1", status_key="NEW", lead_status_id="st-new", owner_id="c-1"))
    b.sql.on("FROM audience_response ar", b.leads)
    b.sql.on("FROM lead_status st", _statuses)
    b.sql.on("LOWER(st.label) = LOWER(:label)",
             lambda p, sql: [s for s in STATUSES if s["label"].lower() == p["label"].lower()])
    b.sql.on("FROM workflow_trigger", [])
    b.sql.on("FROM institute_custom_fields icf", [
        {"id": "cf-course", "field_key": "course", "field_name": "Course interested in", "field_type": "dropdown",
         "config": json.dumps([{"label": "NEET", "name": "neet"}, {"label": "JEE", "name": "jee"}])},
        {"id": "cf-city", "field_key": "city", "field_name": "City", "field_type": "text", "config": None},
        {"id": "cf-phone", "field_key": "phone_number", "field_name": "Phone", "field_type": "phone", "config": None}])
    b.sql.on("FROM custom_field_values v", [{"custom_field_id": "cf-course", "value": "JEE"}])
    b.sql.on("FROM audience a WHERE", lambda p, sql: [
        {"id": i, "name": "NEET 2027", "status": "INACTIVE" if i == "list-off" else "ACTIVE", "sub_org_id": None}
        for i in p["ids"] if i in ("list-1", "list-2", "list-off")])
    b.admin_core.on("POST", TIMELINE, {"id": "ev-1"})
    b.admin_core.on("POST", FOLLOWUP, lambda mth, path, params, body: {"id": "fu-new", "status": "PENDING"})
    b.admin_core.on("POST", STATUS_ONE, "Lead status updated")
    b.admin_core.on("PUT", "/admin-core-service/v1/audience/lead/", "Lead profile updated")
    monkeypatch.setattr(isr, "load_institute_setting_data", lambda db, inst, key: None)
    return b


def admin(**kw):
    return make_ctx(**kw)


def counsellor(**kw):
    return make_ctx("c-1", ("COUNSELLOR",), **kw)


async def run(tool, ctx, **args):
    fn = {m.ACTIVITY_TOOL: m.execute_crm_lead_activity, m.EDIT_TOOL: m.execute_crm_lead_edit,
          m.INTAKE_TOOL: m.execute_crm_lead_intake}[tool]
    return json.loads(await fn(args, ctx))


def writes(backend):
    """Every admin-core call that could change something (lead-scope / roster reads are GETs)."""
    return [c for c in backend.admin_core.calls if c["method"] in ("POST", "PUT", "DELETE", "PATCH")]


def in_hours(h):
    return (datetime.now(timezone.utc) + timedelta(hours=h)).strftime("%Y-%m-%dT%H:%M:%SZ")


def automation(backend, *node_types):
    backend.sql.on("FROM workflow_trigger", [{"trigger_id": "t1", "event_id": None, "workflow_id": "w-1",
                                              "workflow_name": "Status → WhatsApp", "updated_at": None}])
    backend.sql.on("FROM workflow_node_mapping", [{"workflow_id": "w-1", "node_type": t, "n": 1} for t in node_types])


# ── the tool surface ─────────────────────────────────────────────────────

def test_specs_action_spec_and_schemas():
    for tool, actions in ((m.ACTIVITY_TOOL, m.ACTIVITY_ACTIONS), (m.EDIT_TOOL, m.EDIT_ACTIONS),
                          (m.INTAKE_TOOL, m.INTAKE_ACTIONS)):
        spec = registry.ASSISTANT_TOOLS[tool]
        assert spec.mcp_only and spec.mode == "WRITE" and spec.module_feature == "crm.leads"
        assert not spec.default_enabled and spec.default_roles is None and spec.required_permission is None
        params = spec.schema["function"]["parameters"]
        assert params["properties"]["action"]["enum"] == list(actions)
        assert "user_id" not in params["properties"] and "institute_id" not in params["properties"]
        desc = spec.schema["function"]["description"]
        assert "confirm_token" in desc
    assert set(m.ACTION_SPEC) == set(m.ACTIVITY_ACTIONS + m.EDIT_ACTIONS + m.INTAKE_ACTIONS)
    assert {a for a, s in m.ACTION_SPEC.items() if s["confirm"] == "none"} == {
        "add_note", "schedule_followup", "reschedule_followup"}
    assert registry.ASSISTANT_TOOLS[m.EDIT_TOOL].key() == "crm_lead_edits"
    assert "lead_content" in registry.ASSISTANT_TOOLS[m.ACTIVITY_TOOL].schema["function"]["description"]


async def test_unknown_action_and_identity_guard(backend):
    out = await run(m.EDIT_TOOL, admin(), action="delete_everything")
    assert out["error"] == "unknown_action" and out["available"] == list(m.EDIT_ACTIONS)
    out = await run(m.ACTIVITY_TOOL, admin(), action="add_note", note="x", requested_user_id="u-1")
    assert out["error"] == "use_lead_id" and writes(backend) == []


# ── crm_lead_activity ────────────────────────────────────────────────────

async def test_log_interaction_saves_note_answers_followup_and_status_in_one_call(backend):
    backend.lead_scope("ADMIN")
    out = await run(m.ACTIVITY_TOOL, admin(), action="log_interaction", lead_id="r-1", kind="CALL",
                    note="Spoke to her, wants NEET", outcome="Interested", answers={"Course interested in": "neet"},
                    next_followup_at=in_hours(48), status="interested")
    assert out["done"] is True and out["saved"]["followup"]["followup_id"] == "fu-new"
    assert out["saved"]["status"]["status"] == "INTERESTED" and "status_change_waiting" not in out
    note = backend.admin_core.called(TIMELINE, "POST")[0]["body"]
    assert note["type"] == "AUDIENCE_RESPONSE" and note["type_id"] == "r-1" and note["student_user_id"] == "u-1"
    assert note["action_type"] == "CALL_LOG" and note["title"] == "Call log: Interested"
    assert note["metadata"]["outcome"] == "Interested"
    fu = backend.admin_core.called(FOLLOWUP, "POST")[0]["body"]
    assert fu["audience_response_id"] == "r-1" and fu["institute_id"] == "inst-1"
    assert fu["schedule_time"].endswith(".000Z") and fu["content"] == "Spoke to her, wants NEET"
    prof = backend.admin_core.called("/admin-core-service/v1/audience/lead/r-1/profile", "PUT")[0]["body"]
    assert prof == {"custom_field_values": [{"custom_field_id": "cf-course", "source_type": "AUDIENCE_RESPONSE",
                                             "source_id": "r-1", "value": "NEET"}]}
    assert "user_details" not in prof
    st = backend.admin_core.called(STATUS_ONE + "r-1", "POST")[0]
    assert st["params"] == {"statusId": "st-int", "source": "MANUAL"}


async def test_log_interaction_status_waits_for_confirm_when_an_automation_listens(backend):
    backend.lead_scope("ADMIN")
    automation(backend, "SEND_WHATSAPP")
    ctx = admin()
    args = dict(action="log_interaction", lead_id="r-1", note="Wants to join", status="INTERESTED")
    out = await run(m.ACTIVITY_TOOL, ctx, **args)
    waiting = out["status_change_waiting"]
    assert waiting["to"]["status"] == "INTERESTED" and waiting["automations"][0]["contacts_people"] is True
    assert waiting["automations"][0]["channels"] == ["whatsapp"]
    assert len(backend.admin_core.called(TIMELINE, "POST")) == 1           # the note is saved at once
    assert backend.admin_core.called(STATUS_ONE) == []                      # the status is not
    done = await run(m.ACTIVITY_TOOL, admin(), **args, confirm_token=waiting["confirm_token"])
    assert done["applied"] is True and done["status"]["status_changed"] is True
    assert len(backend.admin_core.called(TIMELINE, "POST")) == 1           # nothing logged twice
    assert backend.admin_core.called(STATUS_ONE + "r-1", "POST")[0]["params"]["statusId"] == "st-int"
    # the lead moved on (someone else changed its status): the old token no longer fits
    backend.leads.rows["r-1"].update(lead_status_id="st-won", status_key="CONVERTED")
    again = await run(m.ACTIVITY_TOOL, admin(), **args, confirm_token=waiting["confirm_token"])
    assert again["error"] == "confirm_token_mismatch"
    expired = await run(m.ACTIVITY_TOOL, admin(), **args, confirm_token="1.deadbeef")
    assert expired["error"] == "confirm_token_expired"


async def test_log_interaction_validates_everything_before_writing(backend):
    backend.lead_scope("ADMIN")
    out = await run(m.ACTIVITY_TOOL, admin(), action="log_interaction", lead_id="r-1", kind="TELEGRAM",
                    answers={"Favourite colour": "blue"})
    assert out["error"] == "invalid_argument" and len(out["problems"]) == 3
    out = await run(m.ACTIVITY_TOOL, admin(), action="log_interaction", lead_id="r-1", note="x", status="WON")
    assert out["error"] == "unknown_status"
    out = await run(m.ACTIVITY_TOOL, admin(), action="log_interaction", lead_id="r-1", note="x",
                    answers={"Phone": "123"})                                # contact fields are not answers
    assert out["error"] == "invalid_argument"
    out = await run(m.ACTIVITY_TOOL, admin(), action="log_interaction", lead_id="r-1", note="x",
                    next_followup_at="2020-01-01T10:00")
    assert out["error"] == "invalid_argument" and "past" in out["message"]
    assert writes(backend) == []


async def test_log_interaction_with_a_call(backend):
    backend.lead_scope("ADMIN")
    backend.sql.on("FROM telephony_call_log tcl", lambda p, sql: [
        {"id": i, "counsellor_user_id": "c-1", "lead_id": {"call-1": "r-1", "call-x": "r-other"}[i],
         "lead_user_id": {"call-1": "u-1", "call-x": "u-9"}[i], "lead_in_scope": True}
        for i in p["ids"] if i in ("call-1", "call-x")])
    backend.sql.on("FROM call_disposition_catalog c", lambda p, sql: [
        {"disposition_key": "RNR", "label": "Ringing, no answer", "maps_to_lead_status_id": None}]
        if p["key"].upper() == "RNR" else [])
    backend.admin_core.on("POST", "/admin-core-service/v1/telephony/calls/", {"lead_status_synced": False})
    at = in_hours(3)
    out = await run(m.ACTIVITY_TOOL, admin(), action="log_interaction", lead_id="r-1", call_id="call-1",
                    disposition_key="rnr", note="No answer", next_followup_at=at)
    assert out["done"] and out["saved"]["call_outcome"]["disposition"] == "RNR"
    call = backend.admin_core.called("/admin-core-service/v1/telephony/calls/call-1/disposition", "POST")[0]
    assert call["params"] == {"instituteId": "inst-1"}
    assert call["body"]["disposition_key"] == "RNR" and call["body"]["notes"] == "No answer"
    assert call["body"]["callback_at_epoch_millis"] == int(
        datetime.fromisoformat(at.replace("Z", "+00:00")).timestamp() * 1000)
    assert backend.admin_core.called(TIMELINE, "POST")[0]["body"]["metadata"]["telephonyCallLogId"] == "call-1"
    n = len(writes(backend))
    assert (await run(m.ACTIVITY_TOOL, admin(), action="log_interaction", lead_id="r-1", call_id="call-x",
                      note="x"))["error"] == "call_not_for_lead"
    assert (await run(m.ACTIVITY_TOOL, admin(), action="log_interaction", lead_id="r-1", call_id="call-foreign",
                      note="x"))["error"] == "unknown_call"
    assert (await run(m.ACTIVITY_TOOL, admin(), action="log_interaction", lead_id="r-1", call_id="call-1",
                      disposition_key="WON_LOTTERY", note="x"))["error"] == "unknown_disposition"
    assert len(writes(backend)) == n


async def test_log_interaction_call_needs_the_calling_module(backend, monkeypatch):
    backend.lead_scope("ADMIN")
    monkeypatch.setattr(ent, "entitlements", lambda db, inst: ent.Entitlements(mode="MANAGED", rows={
        "crm": True, "crm.leads": True, "crm.calling": False}))
    out = await run(m.ACTIVITY_TOOL, admin(), action="log_interaction", lead_id="r-1", call_id="call-1", note="x")
    assert out["error"] == "module_not_enabled" and out["feature"] == "crm.calling" and writes(backend) == []


async def test_counsellor_cannot_touch_a_lead_outside_their_scope(backend):
    backend.lead_scope("COUNSELLOR_TREE", owner_ids=["c-1"])
    backend.leads.rows["r-1"]["in_scope"] = False
    ctx = counsellor()
    for tool, args in ((m.ACTIVITY_TOOL, dict(action="add_note", lead_id="r-1", note="hi")),
                       (m.ACTIVITY_TOOL, dict(action="log_interaction", lead_id="r-1", note="hi", status="NEW")),
                       (m.ACTIVITY_TOOL, dict(action="schedule_followup", lead_id="r-1", at=in_hours(5))),
                       (m.EDIT_TOOL, dict(action="set_status", lead_id="r-1", status="INTERESTED")),
                       (m.EDIT_TOOL, dict(action="set_status", lead_ids=["r-1"], status="INTERESTED")),
                       (m.EDIT_TOOL, dict(action="update_details", lead_id="r-1", changes={"name": "X"})),
                       (m.EDIT_TOOL, dict(action="set_tier", lead_ids=["r-1"], tier="HOT"))):
        out = await run(tool, ctx, **args)
        assert out["error"] == "out_of_scope", (tool, args, out)
    sql, params = backend.sql.matching("ar.id = :lid")[0]
    assert params["scope_owners"] == ["c-1"] and params["inst"] == "inst-1"
    assert writes(backend) == []


async def test_leads_of_another_institute_are_unknown(backend):
    backend.lead_scope("ADMIN")
    for tool, args in ((m.ACTIVITY_TOOL, dict(action="add_note", lead_id="r-foreign", note="hi")),
                       (m.EDIT_TOOL, dict(action="set_status", lead_ids=["r-1", "r-foreign"], status="NEW")),
                       (m.EDIT_TOOL, dict(action="tag", lead_ids=["r-foreign"], tag_ids=["tag-1"]))):
        out = await run(tool, admin(), **args)
        assert out["error"] in ("unknown_lead", "unknown_tag"), out
    assert writes(backend) == []


async def test_add_note(backend):
    backend.lead_scope("ADMIN")
    out = await run(m.ACTIVITY_TOOL, admin(), action="add_note", phone="98765 43210", note="Asked about fees",
                    kind="WHATSAPP")
    assert out["done"] and out["saved"]["event_id"] == "ev-1" and out["lead"]["phone"] == "******3210"
    body = backend.admin_core.called(TIMELINE, "POST")[0]["body"]
    assert body["metadata"]["channel"] == "WHATSAPP" and body["description"] == "Asked about fees"
    assert (await run(m.ACTIVITY_TOOL, admin(), action="add_note", lead_id="r-1"))["error"] == "missing_argument"


async def test_schedule_followup_reads_local_time_and_follows_the_settings(backend, monkeypatch):
    backend.lead_scope("ADMIN")
    local = (datetime.now(timezone(timedelta(hours=5, minutes=30))) + timedelta(days=2)).replace(
        hour=17, minute=0, second=0, microsecond=0)
    out = await run(m.ACTIVITY_TOOL, admin(), action="schedule_followup", lead_id="r-1",
                    at=local.strftime("%Y-%m-%dT%H:%M"), note="Call back about fees")
    assert out["done"] and out["followup"]["at_local"].startswith(local.strftime("%Y-%m-%d 17:00"))
    sent = backend.admin_core.called(FOLLOWUP, "POST")[0]["body"]
    assert sent["schedule_time"] == local.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")
    assert out["automations_when_due"] == []
    monkeypatch.setattr(isr, "load_institute_setting_data", lambda db, inst, key: {"followUpFields": {
        "enabled": True, "fieldsRequired": True, "notesRequired": True,
        "studentResponses": ["Interested", "Not interested"], "followUpModes": [], "nextActions": []}})
    out = await run(m.ACTIVITY_TOOL, admin(), action="schedule_followup", lead_id="r-1", at=in_hours(5))
    assert out["error"] == "invalid_argument" and len(out["problems"]) == 2
    ok = await run(m.ACTIVITY_TOOL, admin(), action="schedule_followup", lead_id="r-1", at=in_hours(5),
                   note="x", student_response="interested", next_action="Visit")
    assert ok["done"] and backend.admin_core.called(FOLLOWUP, "POST")[-1]["body"]["student_response"] == "Interested"
    assert "next_action" not in backend.admin_core.called(FOLLOWUP, "POST")[-1]["body"] and ok["notes"]
    assert (await run(m.ACTIVITY_TOOL, admin(), action="schedule_followup", lead_id="r-1",
                      at="2026-12-01"))["error"] == "invalid_argument"


def _followups(backend, **over):
    row = {"id": "fu-1", "created_by": "c-1", "status": "PENDING", "is_closed": False,
           "schedule_time": datetime(2026, 10, 20, 11, 30), "lead_id": "r-1", "lead_user_id": "u-1",
           "lead_in_scope": True, **over}
    backend.sql.on("FROM lead_followup lf", lambda p, sql: [row] if "fu-1" in p["ids"] else [])
    return row


async def test_reschedule_followup(backend):
    backend.lead_scope("ADMIN")
    _followups(backend, status="OVERDUE")
    backend.admin_core.on("PUT", FOLLOWUP + "/fu-1", {"id": "fu-1"})
    at = in_hours(30)
    out = await run(m.ACTIVITY_TOOL, admin(), action="reschedule_followup", followup_id="fu-1", at=at, note="moved")
    assert out["done"] and out["from"] == "2026-10-20T11:30:00Z" and "due" in out["note"]
    put = backend.admin_core.called(FOLLOWUP + "/fu-1", "PUT")[0]
    assert set(put["body"]) == {"schedule_time", "content"} and put["body"]["content"] == "moved"
    assert (await run(m.ACTIVITY_TOOL, admin(), action="reschedule_followup", followup_id="fu-9",
                      at=at))["error"] == "unknown_followup"
    _followups(backend, is_closed=True)
    assert (await run(m.ACTIVITY_TOOL, admin(), action="reschedule_followup", followup_id="fu-1",
                      at=at))["error"] == "followup_closed"


async def test_reschedule_someone_elses_followup_outside_scope_is_refused(backend):
    backend.lead_scope("COUNSELLOR_TREE", owner_ids=["c-1"])
    _followups(backend, created_by="c-9", lead_in_scope=False)
    out = await run(m.ACTIVITY_TOOL, counsellor(), action="reschedule_followup", followup_id="fu-1", at=in_hours(3))
    assert out["error"] == "out_of_scope" and writes(backend) == []


async def test_complete_followup_two_step_single_use(backend):
    backend.lead_scope("ADMIN")
    _followups(backend)
    backend.admin_core.on("PUT", FOLLOWUP + "/fu-1/close", {"id": "fu-1", "status": "COMPLETED"})
    ctx = admin(db=confirm_db())
    args = dict(action="complete_followup", followup_id="fu-1", outcome="Spoke, will visit Sunday",
                next_followup_at=in_hours(72), followup_note="Confirm the visit")
    shown = await run(m.ACTIVITY_TOOL, ctx, **args)
    assert shown["applied"] is False and shown["confirm_token"].startswith("vcc_")
    assert shown["outcome"]["_note"] == cd.LEAD_CONTENT_NOTE and "then_schedules" in shown
    assert writes(backend) == []                                            # the preview wrote nothing
    done = await run(m.ACTIVITY_TOOL, ctx, **args, confirm_token=shown["confirm_token"])
    assert done["completed"] and done["next_followup"]["followup_id"] == "fu-new"
    close = backend.admin_core.called(FOLLOWUP + "/fu-1/close", "PUT")[0]
    assert close["body"] == {"closer_reason": "Spoke, will visit Sunday"}
    replay = await run(m.ACTIVITY_TOOL, ctx, **args, confirm_token=shown["confirm_token"])
    assert replay["error"] == "confirm_token_used"
    other = await run(m.ACTIVITY_TOOL, ctx, **{**args, "outcome": "different"},
                      confirm_token=shown["confirm_token"])
    assert other["error"] == "confirm_token_mismatch"
    assert len(backend.admin_core.called(FOLLOWUP + "/fu-1/close")) == 1


# ── crm_lead_edit: set_status ────────────────────────────────────────────

async def test_set_status_one_lead_uses_an_edit_token_bound_to_its_state(backend):
    backend.lead_scope("ADMIN")
    ctx = admin()
    shown = await run(m.EDIT_TOOL, ctx, action="set_status", lead_id="r-1", status="Interested")
    assert shown["applied"] is False and not shown["confirm_token"].startswith("vcc_")
    assert shown["leads"][0]["from"] == "NEW" and shown["to"]["status"] == "INTERESTED"
    assert shown["definitions"]["first_response"] == cd.definition("first_response")
    assert writes(backend) == []
    done = await run(m.EDIT_TOOL, admin(), action="set_status", lead_id="r-1", status="Interested",
                     confirm_token=shown["confirm_token"])
    assert done["updated"] == 1 and done["done"]
    assert backend.admin_core.called(STATUS_ONE + "r-1", "POST")[0]["params"] == {"statusId": "st-int",
                                                                                  "source": "MANUAL"}
    backend.leads.rows["r-1"]["updated_at"] = datetime(2026, 10, 15, 9, 0)     # the lead changed meanwhile
    stale = await run(m.EDIT_TOOL, admin(), action="set_status", lead_id="r-1", status="Interested",
                      confirm_token=shown["confirm_token"])
    assert stale["error"] == "confirm_token_mismatch"
    other = await run(m.EDIT_TOOL, admin(), action="set_status", lead_id="r-1", status="NEW",
                      confirm_token=shown["confirm_token"])
    assert other["applied"] is False or other.get("error")                   # already NEW: nothing to do


def _people_leads(backend):
    backend.leads = Leads(
        lead_row("r-1", "u-1", status_key="NEW", lead_status_id="st-new"),
        lead_row("r-2", "u-1", list_id="list-2", status_key="NEW", lead_status_id="st-new"),   # same person
        lead_row("r-3", "u-2", status_key="NEW", lead_status_id="st-new", phone="+91 90000 11111"),
        lead_row("r-4", "u-2", list_id="list-9", status_key="NEW", lead_status_id="st-new", in_scope=False),
        lead_row("r-5", "u-3", status_key="INTERESTED", lead_status_id="st-int"))
    backend.sql.on("FROM audience_response ar", backend.leads)
    backend.admin_core.on("POST", STATUS_BULK, lambda mth, path, params, body: {
        "updated": len(body["response_ids"]), "unchanged": 0, "failed": 0, "errors": []})


async def test_set_status_many_moves_each_persons_visible_leads_with_a_single_use_token(backend):
    backend.lead_scope("COUNSELLOR_TREE", owner_ids=["c-1"])
    _people_leads(backend)
    ctx = counsellor(db=confirm_db())
    args = dict(action="set_status", lead_ids=["r-1", "r-3", "r-5"], status="INTERESTED")
    shown = await run(m.EDIT_TOOL, ctx, **args)
    assert shown["confirm_token"].startswith("vcc_") and shown["count"] == 3 and shown["unchanged"] == 1
    assert {x["lead_id"] for x in shown["leads"]} == {"r-1", "r-2", "r-3"}
    assert "other_lists_not_changed" in shown                                  # r-4 is outside the scope
    blob = json.dumps(shown)
    assert "98765" not in blob and "priya@example.com" not in blob and shown["leads"][0]["phone"].endswith("3210")
    assert writes(backend) == []
    # one of them changes before the confirm: it is left alone, the rest go through
    backend.leads.rows["r-3"].update(lead_status_id="st-won", status_key="CONVERTED")
    done = await run(m.EDIT_TOOL, ctx, **args, confirm_token=shown["confirm_token"])
    sent = backend.admin_core.called(STATUS_BULK, "POST")[0]["body"]
    assert sorted(sent["response_ids"]) == ["r-1", "r-2"] and sent["status_id"] == "st-int"
    assert sent["institute_id"] == "inst-1" and sent["source"] == "BULK_MANUAL"
    assert done["updated"] == 2 and done["not_changed_because_they_changed_since_preview"] == ["r-3"]
    replay = await run(m.EDIT_TOOL, ctx, **args, confirm_token=shown["confirm_token"])
    assert replay["error"] in ("confirm_token_used", "confirm_token_mismatch")
    assert len(backend.admin_core.called(STATUS_BULK)) == 1


async def test_set_status_and_tier_leave_opted_out_leads_alone(backend):
    # their automations can message or call the lead: never through the sibling expansion, never named
    backend.lead_scope("ADMIN")
    _people_leads(backend)
    backend.leads.rows["r-2"]["overall_status"] = "OPTED_OUT"           # r-1's sibling
    backend.leads.rows["r-5"]["overall_status"] = "OPTED_OUT"           # named directly
    shown = await run(m.EDIT_TOOL, admin(db=confirm_db()), action="set_status", lead_ids=["r-1", "r-5"],
                      status="INTERESTED")
    assert "leads" in shown, shown
    changed = {x["lead_id"] for x in shown["leads"]}
    assert "r-2" not in changed and "r-5" not in changed and "r-1" in changed
    assert writes(backend) == []
    tier = await run(m.EDIT_TOOL, admin(db=confirm_db()), action="set_tier", lead_ids=["r-5"], tier="HOT")
    assert "confirm_token" not in tier or not tier.get("people")


async def test_set_status_this_list_only_and_filter(backend):
    backend.lead_scope("ADMIN")
    _people_leads(backend)
    shown = await run(m.EDIT_TOOL, admin(db=confirm_db()), action="set_status", lead_ids=["r-1", "r-3"],
                      status="INTERESTED", this_list_only=True)
    assert {x["lead_id"] for x in shown["leads"]} == {"r-1", "r-3"}
    backend.sql.on("COUNT(*) OVER ()", [{"id": "r-1", "opted_out": False, "total": 2, "opted_out_total": 1}])
    shown = await run(m.EDIT_TOOL, admin(db=confirm_db()), action="set_status", filter={"status_keys": ["NEW"]},
                      status="INTERESTED", this_list_only=True)
    assert shown["count"] == 1 and shown["filter_matched"]["opted_out_dropped"] == 1
    bad = await run(m.EDIT_TOOL, admin(), action="set_status", filter={"colour": "red"}, status="NEW")
    assert bad["error"] == "invalid_filter"
    assert writes(backend) == []


async def test_set_status_cap_on_bulk_confirms(backend, monkeypatch):
    backend.lead_scope("ADMIN")
    _people_leads(backend)
    monkeypatch.setitem(cd.CAPS, "crm.crm_lead_edit.set_status", 1)
    ctx = admin(db=confirm_db())
    for ids in (["r-1", "r-3"], ["r-3", "r-5"]):
        args = dict(action="set_status", lead_ids=ids, status="CONVERTED", this_list_only=False)
        shown = await run(m.EDIT_TOOL, ctx, **args)
        out = await run(m.EDIT_TOOL, ctx, **args, confirm_token=shown["confirm_token"])
        last = out
    assert last["error"] == "rate_limited" and last["cap_per_hour"] == 1
    assert len(backend.admin_core.called(STATUS_BULK)) == 1


# ── crm_lead_edit: tier, details, tags ───────────────────────────────────

async def test_set_tier_per_person(backend):
    backend.lead_scope("ADMIN")
    _people_leads(backend)
    backend.leads.rows["r-5"]["profile_id"] = None
    backend.sql.on("FROM lead_tier lt", [{"id": "t-hot", "tier_key": "HOT", "label": "Hot", "institute_tiers": 3}])
    backend.admin_core.on("POST", "/admin-core-service/v1/audience/user-lead-profile/update-tier", {"id": "ulp"})
    ctx = admin(db=confirm_db())
    args = dict(action="set_tier", lead_ids=["r-1", "r-2", "r-3", "r-5"], tier="hot")
    shown = await run(m.EDIT_TOOL, ctx, **args)
    assert shown["people"] == 2 and shown["skipped"][0]["reason"].startswith("no lead profile")
    assert writes(backend) == []
    done = await run(m.EDIT_TOOL, ctx, **args, confirm_token=shown["confirm_token"])
    calls = backend.admin_core.called("/admin-core-service/v1/audience/user-lead-profile/update-tier", "POST")
    assert done["updated"] == 2 and sorted(c["params"]["userId"] for c in calls) == ["u-1", "u-2"]
    assert all(c["params"]["instituteId"] == "inst-1" and c["params"]["tier"] == "HOT" for c in calls)
    backend.sql.on("FROM lead_tier lt", [])
    assert (await run(m.EDIT_TOOL, ctx, action="set_tier", lead_id="r-1", tier="LUKEWARM"))["error"] == "unknown_tier"


async def test_update_details_one_lead(backend):
    backend.lead_scope("ADMIN")
    backend.admin_core.on("GET", "/admin-core-service/v1/audience/lead/r-1",
                          {"user": {"full_name": "Priya", "mobile_number": "+919876543210", "email": "p@x.com"}})
    backend.sql.on("AS elsewhere", [{"elsewhere": False}])
    ctx = admin()
    args = dict(action="update_details", lead_id="r-1", changes={"name": "Priya S", "phone": "+91 99999 00000"},
                guardian={"name": "Mrs Sharma"}, answers={"course": "NEET", "City": "Pune"})
    shown = await run(m.EDIT_TOOL, ctx, **args)
    assert {r["field"] for r in shown["changes"]} == {"name", "phone"}
    assert shown["changes"][0]["from"] == "Priya" and shown["guardian"][0]["to"] == "Mrs Sharma"
    assert shown["answers"]["_note"] == cd.LEAD_CONTENT_NOTE and len(shown["answers"]["items"]) == 2
    assert writes(backend) == []
    done = await run(m.EDIT_TOOL, admin(), **args, confirm_token=shown["confirm_token"])
    assert done["done"]
    body = backend.admin_core.called("/admin-core-service/v1/audience/lead/r-1/profile", "PUT")[0]["body"]
    # the person's own details go to their account (what lists show); the guardian to the lead record
    assert body["user_details"] == {"id": "u-1", "full_name": "Priya S", "mobile_number": "+919999900000"}
    assert body["parent_name"] == "Mrs Sharma" and "parent_mobile" not in body and "parent_email" not in body
    assert {v["custom_field_id"] for v in body["custom_field_values"]} == {"cf-course", "cf-city"}
    backend.admin_core.on("PUT", "/admin-core-service/v1/audience/lead/",
                          {"error": "admin_core_rejected", "status": 409, "message": "A lead already exists"})
    dup = await run(m.EDIT_TOOL, admin(), **args, confirm_token=shown["confirm_token"])
    assert dup["error"] == "duplicate_contact"
    assert (await run(m.EDIT_TOOL, admin(), action="update_details", lead_id="r-1",
                      changes={"email": ""}))["error"] == "invalid_argument"
    assert (await run(m.EDIT_TOOL, admin(), action="update_details", lead_ids=["r-1"],
                      changes={"name": "x"}))["error"] == "invalid_argument"


async def test_update_details_never_edits_an_account_another_institute_uses(backend):
    backend.lead_scope("ADMIN")
    backend.admin_core.on("GET", "/admin-core-service/v1/audience/lead/r-1",
                          {"user": {"full_name": "Priya", "mobile_number": "+919876543210", "email": "p@x.com"}})
    backend.sql.on("AS elsewhere", [{"elsewhere": True}])
    out = await run(m.EDIT_TOOL, admin(), action="update_details", lead_id="r-1", changes={"name": "Priya S"})
    assert out["error"] == "shared_account" and writes(backend) == []
    # the guardian contact on this institute's record is still editable
    shown = await run(m.EDIT_TOOL, admin(), action="update_details", lead_id="r-1", guardian={"phone": "9999900000"})
    assert shown["guardian"][0]["field"] == "phone" and "confirm_token" in shown


async def test_tag_and_untag_existing_tags_only(backend):
    backend.lead_scope("ADMIN")
    _people_leads(backend)
    backend.sql.on("FROM tags t", lambda p, sql: [{"id": t, "tag_name": "VIP", "is_default": False}
                                                  for t in p["ids"] if t == "tag-1"])
    backend.sql.on("FROM user_tags ut", [{"user_id": "u-2", "tag_id": "tag-1"}])
    backend.admin_core.on("POST", "/admin-core-service/tag-management/", {"successCount": 1, "skipCount": 0,
                                                                         "errorCount": 0})
    ctx = admin(db=confirm_db())
    assert (await run(m.EDIT_TOOL, ctx, action="tag", lead_ids=["r-1"], tag_ids=["tag-new"]))["error"] == "unknown_tag"
    args = dict(action="tag", lead_ids=["r-1", "r-3", "r-5"], tag_ids=["tag-1"])
    shown = await run(m.EDIT_TOOL, ctx, **args)
    assert shown["tags"] == [{"tag_id": "tag-1", "name": "VIP", "people": 2}] and writes(backend) == []
    await run(m.EDIT_TOOL, ctx, **args, confirm_token=shown["confirm_token"])
    add = backend.admin_core.called("/admin-core-service/tag-management/institutes/inst-1/tags/tag-1/users/add")[0]
    assert sorted(add["body"]) == ["u-1", "u-3"]                               # u-2 already had it
    one = await run(m.EDIT_TOOL, admin(), action="untag", lead_id="r-3", tag_ids=["tag-1"])
    assert not one["confirm_token"].startswith("vcc_")
    await run(m.EDIT_TOOL, admin(), action="untag", lead_id="r-3", tag_ids=["tag-1"],
              confirm_token=one["confirm_token"])
    rm = backend.admin_core.called("/admin-core-service/tag-management/institutes/inst-1/users/tags/deactivate")[0]
    assert rm["params"] == {"userIds": "u-2", "tagIds": "tag-1"}


# ── crm_lead_intake ──────────────────────────────────────────────────────

async def test_add_walk_in_lead(backend):
    backend.lead_scope("COUNSELLOR_TREE", owner_ids=["c-1"])
    backend.counsellors({"c-1": "Asha"}, assignable={"c-1": "Asha"})
    backend.admin_core.on("POST", "/admin-core-service/v1/audience/lead/submit", UUID)
    automation(backend, "SEND_EMAIL")
    ctx = counsellor(db=confirm_db())
    args = dict(action="add_lead", list_id="list-1", name="Ravi Kumar", phone="+91 91234 56789", source="WALK_IN",
                counsellor_id="me", status="interested", answers={"Course interested in": "JEE"})
    shown = await run(m.INTAKE_TOOL, ctx, **args)
    assert shown["confirm_token"].startswith("vcc_") and shown["owner"]["counsellor_id"] == "c-1"
    assert shown["automations"][0]["channels"] == ["email"] and writes(backend) == []
    sql, params = backend.sql.matching("AS phone_digits")[0]
    assert params["tails"] == ["9123456789"] and params["inst"] == "inst-1" and "scope_owners" in params
    done = await run(m.INTAKE_TOOL, ctx, **args, confirm_token=shown["confirm_token"])
    assert done["lead_id"] == UUID and done["done"]
    body = backend.admin_core.called("/admin-core-service/v1/audience/lead/submit", "POST")[0]["body"]
    assert body == {"audience_id": "list-1", "source_type": "WALK_IN",
                    "user_dto": {"full_name": "Ravi Kumar", "email": "", "mobile_number": "+919123456789"},
                    "counsellor_id": "c-1", "counsellor_name": "Asha", "lead_status_key": "INTERESTED",
                    "custom_field_values": {"cf-course": "JEE"}}
    assert (await run(m.INTAKE_TOOL, ctx, **args, confirm_token=shown["confirm_token"]))["error"] == "confirm_token_used"


async def test_add_lead_refuses_existing_and_opted_out_people_unless_re_enquiry(backend):
    backend.lead_scope("ADMIN")
    backend.admin_core.on("POST", "/admin-core-service/v1/audience/lead/submit", UUID)
    ctx = admin(db=confirm_db())
    args = dict(action="add_lead", list_id="list-2", name="Priya", phone="9876543210")
    out = await run(m.INTAKE_TOOL, ctx, **args)
    assert out["error"] == "already_lead" and out["matching_leads"][0]["lead_id"] == "r-1"
    assert out["matching_leads"][0]["phone"] == "******3210"
    backend.leads.rows["r-1"]["overall_status"] = "OPTED_OUT"
    assert (await run(m.INTAKE_TOOL, ctx, **args))["error"] == "opted_out"
    shown = await run(m.INTAKE_TOOL, ctx, **args, re_enquiry=True)
    assert shown["confirm_token"] and "warning" in shown and shown["re_enquiry_of"]
    by_email = await run(m.INTAKE_TOOL, ctx, action="add_lead", list_id="list-2", name="P", email="PRIYA@example.com")
    assert by_email["error"] == "opted_out"
    assert writes(backend) == []


async def test_add_lead_list_checks(backend):
    backend.lead_scope("ADMIN")
    ctx = admin(db=confirm_db())
    assert (await run(m.INTAKE_TOOL, ctx, action="add_lead", list_id="list-foreign", name="A",
                      phone="9000000001"))["error"] == "unknown_list"
    assert (await run(m.INTAKE_TOOL, ctx, action="add_lead", list_id="list-off", name="A",
                      phone="9000000001"))["error"] == "list_not_active"
    backend.counsellors({"c-1": "Asha"}, assignable={"c-1": "Asha"})
    out = await run(m.INTAKE_TOOL, ctx, action="add_lead", list_id="list-1", name="A", phone="9000000001",
                    counsellor_id="c-teacher")
    assert out["error"] == "invalid_argument" and "assign" in out["problems"][0]
    backend.lead_scope("AUDIENCE_LIST", allowed_audience_ids=["list-2"])
    out = await run(m.INTAKE_TOOL, make_ctx("u-9", ("CUSTOM",), db=confirm_db()), action="add_lead",
                    list_id="list-1", name="A", phone="9000000001")
    assert out["error"] == "out_of_scope"
    assert writes(backend) == []


async def test_import_leads(backend):
    backend.lead_scope("ADMIN")
    backend.admin_core.on("POST", "/admin-core-service/v1/audience/lead/bulk-submit", {
        "summary": {"total_requested": 2, "successful": 1, "failed": 0, "skipped": 1},
        "results": [{"index": 0, "status": "SUCCESS", "audience_response_id": "r-new", "message": None},
                    {"index": 1, "status": "SKIPPED", "message": "Duplicate"}]})
    ctx = admin(db=confirm_db())
    rows = [{"name": "A One", "phone": "9000000001"},
            {"name": "Dup", "phone": "+91 90000 00001"},                      # same phone as row 0
            {"name": "", "phone": "9000000002"},                                 # no name
            {"name": "Priya", "phone": "98765 43210"},                           # already a lead (r-1)
            {"name": "B Two", "email": "b@example.com", "answers": {"city": "Pune"}}]
    args = dict(action="import_leads", list_id="list-1", rows=rows)
    shown = await run(m.INTAKE_TOOL, ctx, **args)
    assert shown["will_add"] == 2 and [r["row"] for r in shown["rows"]] == [0, 4]
    assert {d["row"]: d["reason"] for d in shown["dropped"]}.keys() == {1, 2, 3}
    assert shown["rows"][0]["phone"] == "******0001"
    assert writes(backend) == []
    done = await run(m.INTAKE_TOOL, ctx, **args, confirm_token=shown["confirm_token"])
    body = backend.admin_core.called("/admin-core-service/v1/audience/lead/bulk-submit", "POST")[0]["body"]
    assert body["audience_id"] == "list-1" and len(body["rows"]) == 2
    assert all("audience_id" not in r and r["source_type"] == "MANUAL" for r in body["rows"])
    assert body["rows"][1]["custom_field_values"] == {"cf-city": "Pune"}
    assert [r["row"] for r in done["results"]] == [0, 4] and done["results"][0]["lead_id"] == "r-new"
    too_many = await run(m.INTAKE_TOOL, ctx, action="import_leads", list_id="list-1",
                         rows=[{"name": f"x{i}", "phone": f"90000{i:05d}"} for i in range(101)])
    assert too_many["error"] == "too_many"


async def test_import_never_re_adds_opted_out_people_and_bulk_re_enquiry_is_admin_only(backend):
    backend.lead_scope("ADMIN")
    backend.leads.rows["r-1"]["overall_status"] = "OPTED_OUT"
    ctx = admin(db=confirm_db())
    rows = [{"name": "Priya", "phone": "98765 43210"}, {"name": "New", "phone": "9000000009"}]
    shown = await run(m.INTAKE_TOOL, ctx, action="import_leads", list_id="list-1", rows=rows, re_enquiry=True)
    assert [r["row"] for r in shown["rows"]] == [1]
    assert "opted out" in shown["dropped"][0]["reason"]
    backend.lead_scope("COUNSELLOR_TREE", owner_ids=["c-1"])
    out = await run(m.INTAKE_TOOL, counsellor(db=confirm_db()), action="import_leads", list_id="list-1",
                    rows=rows, re_enquiry=True)
    assert out["error"] == "admin_only" and writes(backend) == []


async def test_import_cap(backend, monkeypatch):
    backend.lead_scope("ADMIN")
    backend.admin_core.on("POST", "/admin-core-service/v1/audience/lead/bulk-submit",
                          {"summary": {"successful": 1}, "results": []})
    monkeypatch.setitem(cd.CAPS, "crm.crm_lead_intake.import_leads", 1)
    ctx = admin(db=confirm_db())
    outs = []
    for phone in ("9000000005", "9000000006"):
        args = dict(action="import_leads", list_id="list-1", rows=[{"name": "N", "phone": phone}])
        shown = await run(m.INTAKE_TOOL, ctx, **args)
        outs.append(await run(m.INTAKE_TOOL, ctx, **args, confirm_token=shown["confirm_token"]))
    assert outs[0]["done"] and outs[1]["error"] == "rate_limited" and outs[1]["retry_after_s"] > 0
    assert len(backend.admin_core.called("/admin-core-service/v1/audience/lead/bulk-submit")) == 1


async def test_log_interaction_reports_a_refused_status_change(backend):
    backend.lead_scope("ADMIN")
    backend.admin_core.on("POST", STATUS_ONE, {"error": "admin_core_rejected", "status": 400, "message": "nope"})
    out = await run(m.ACTIVITY_TOOL, admin(), action="log_interaction", lead_id="r-1", note="x", status="INTERESTED")
    assert out["done"] is False and out["failed"][0]["what"] == "status"
    assert out["saved"]["activity"]["event_id"] == "ev-1"                     # the note itself was saved


# ── tag_lists ────────────────────────────────────────────────────────────

def _list_tags(backend, saved):
    backend.sql.on("a.tags_json FROM audience a", lambda p, sql: [
        {"id": i, "campaign_name": f"List {i}", "status": "ACTIVE", "tags_json": saved.get(i)} for i in p["ids"]
        if i in ("list-1", "list-2")])
    backend.admin_core.on("PUT", "/admin-core-service/v1/audience/campaign/",
                          lambda mth, path, params, body: {"audience_id": path.split("/")[-2], "tags": body["tags"]})


async def test_tag_lists_merges_previews_and_applies(backend):
    backend.lead_scope("ADMIN")
    _list_tags(backend, {"list-1": json.dumps({"channel": "Meta"}), "list-2": None})
    ctx = admin(db=confirm_db())
    args = dict(action="tag_lists", lists=[{"list_id": "list-1", "tags": {"State": "Maharashtra", "channel": None}},
                                           {"list_id": "list-2", "tags": {"course": "MBA"}}])
    shown = await run(m.EDIT_TOOL, ctx, **args)
    assert shown["applied"] is False and writes(backend) == []
    assert shown["lists"][0] == {"list_id": "list-1", "list": "List list-1", "tags_before": {"channel": "Meta"},
                                 "tags_after": {"state": "Maharashtra"}}
    assert shown["confirm_token"].startswith(cd.ONCE_PREFIX)
    done = await run(m.EDIT_TOOL, ctx, **args, confirm_token=shown["confirm_token"])
    calls = backend.admin_core.called("/admin-core-service/v1/audience/campaign/list-1/tags", "PUT")
    assert done["updated"] == 2 and done["done"] and calls[0]["body"] == {"tags": {"state": "Maharashtra"}}
    assert calls[0]["params"] == {"instituteId": "inst-1"}


async def test_tag_lists_one_list_replace_and_refusals(backend):
    backend.lead_scope("ADMIN")
    _list_tags(backend, {"list-1": json.dumps({"channel": "Meta", "course": "MBA"})})
    ctx = admin()
    args = dict(action="tag_lists", lists=[{"list_id": "list-1", "tags": {"state": "Goa"}}], replace=True)
    shown = await run(m.EDIT_TOOL, ctx, **args)
    assert shown["lists"][0]["tags_after"] == {"state": "Goa"} and not shown["confirm_token"].startswith(cd.ONCE_PREFIX)
    same = await run(m.EDIT_TOOL, ctx, action="tag_lists", lists=[{"list_id": "list-1", "tags": {"course": "MBA"}}])
    assert same["applied"] is False and same["skipped"][0]["reason"] == "already tagged like that"
    for bad in ({"lists": [{"list_id": "list-1", "tags": {"bad key!": "x"}}]},
                {"lists": [{"list_id": "list-1", "tags": {"state": "x" * 61}}]},
                {"lists": [{"list_id": "list-1", "tags": {"state": "a\nb"}}]},
                {"lists": [{"list_id": "list-1", "tags": {f"k{i}": "v" for i in range(11)}}]},
                {"lists": [{"list_id": "list-1"}]}):
        out = await run(m.EDIT_TOOL, ctx, action="tag_lists", **bad)
        assert out["error"] == "invalid_argument", bad
    assert (await run(m.EDIT_TOOL, ctx, action="tag_lists", lists=[{"list_id": "list-9", "tags": {"a": "b"}}])
            )["error"] == "unknown_list"
    backend.lead_scope("COUNSELLOR_TREE", owner_ids=["c-1"])
    out = await run(m.EDIT_TOOL, counsellor(), **args)
    assert out["error"] == "admin_only" and writes(backend) == []
