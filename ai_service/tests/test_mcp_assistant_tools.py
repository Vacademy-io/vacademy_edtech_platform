"""
The tools the in-product assistant had first (batches, tests, live classes, fees, announcements, enrolment
changes), now also served over MCP from the same registry specs.

Covered here: each is listed only when its MCP group is on (all new groups, so they start off), the MCP door
reads its own groups and wording, identity comes from the principal and never from arguments, calls carry the
connection's platform token and never echo it, and the two card writes become a preview → confirm_token two-step
over MCP while the in-product assistant keeps its confirmation card.
"""
from __future__ import annotations

import json
import sys
import types
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import httpx  # noqa: E402
import pytest  # noqa: E402

from app.mcp import adapter  # noqa: E402
from app.mcp.access import normalize_setting, setting_for_tool_gate  # noqa: E402
from app.mcp.constants import (  # noqa: E402
    MCP_ALLOWED_WRITE_TOOLS,
    MCP_EXPOSED_TOOLS,
    MCP_OPT_IN_GROUPS,
    MCP_TOOL_PLACEMENT,
)
from app.schemas.auth import PinnedPrincipal  # noqa: E402
from app.services import assistant_tool_registry as registry  # noqa: E402
from app.services import crm_data as cd  # noqa: E402
from app.services import learner_data as ld  # noqa: E402
from app.services.assistant_tool_registry import ASSISTANT_TOOLS, ToolContext, execute_tool  # noqa: E402
from crm_fakes import FakeDb, confirm_db  # noqa: E402

TOKEN = "platform-jwt-for-this-connection"
INST = "inst-1"

#: tool → its settings group on the MCP door.
MOVED = {
    "find_batch": "batch_data",
    "list_batch_learners": "batch_data",
    "list_recent_enrollments": "batch_data",
    "find_assessment": "assessments",
    "get_assessment_results": "assessments",
    "get_assessment_leaderboard": "assessments",
    "get_class_schedule": "schedule",
    "get_fee_dues": "payments",
    "get_payment_history": "payments",
    "get_subscription_plans": "payments",
    "search_fee_records": "payments",
    "get_collections_summary": "payments",
    "list_announcements": "announcements",
    "send_announcement": "announcement_sends",
    "manage_enrollment": "learner_enrolment_changes",
}
WRITES = ("manage_enrollment", "send_announcement")


def principal(user_id="admin-1", roles=("ADMIN",)):
    return PinnedPrincipal(user_id=user_id, institute_id=INST, roles=list(roles), permissions=[],
                           is_root_user=False)


def setting(enabled_tools, role_overrides=None):
    return normalize_setting({"enabled": True, "allowed_roles": ["ADMIN", "TEACHER"],
                              "enabled_tools": list(enabled_tools), "role_overrides": role_overrides or {}})


def listed(enabled, roles=("ADMIN",)):
    return {t.name for t in adapter.list_tools_for(principal(roles=roles), setting(enabled))}


# ── a stand-in for the backend services (httpx) ──────────────────────────
class _Resp:
    def __init__(self, status, body):
        self.status_code, self._body = status, body
        self.text = json.dumps(body)

    def json(self):
        return self._body


class Backend:
    """Records every HTTP call the tools make and answers 200 with ``body`` (or ``status``)."""

    def __init__(self):
        self.calls = []
        self.status = 200
        self.body = {"content": [{"user_id": "learner-9", "full_name": "A Learner"}], "totalElements": 1}

    def client(self):
        backend = self

        class _Client:
            def __init__(self, *a, **kw):
                pass

            async def __aenter__(self):
                return self

            async def __aexit__(self, *a):
                return False

            async def request(self, method, url, params=None, json=None, headers=None):
                backend.calls.append({"method": method, "url": url, "params": params or {}, "body": json,
                                      "headers": dict(headers or {})})
                return _Resp(backend.status, backend.body)

            async def post(self, url, params=None, json=None, headers=None):
                return await self.request("POST", url, params=params, json=json, headers=headers)

            async def get(self, url, params=None, headers=None):
                return await self.request("GET", url, params=params, headers=headers)

        return _Client

    def to(self, fragment):
        return [c for c in self.calls if fragment in c["url"]]


@pytest.fixture
def backend(monkeypatch):
    b = Backend()
    monkeypatch.setattr(httpx, "AsyncClient", b.client())
    return b


@pytest.fixture
def plan(monkeypatch):
    """The institute's plan features (app/services/entitlements.py stand-in); every feature on by default."""
    state = {"on": None}

    class _Ent:
        def on(self, key):
            return state["on"] is None or key in state["on"]

    fake = types.ModuleType("app.services.entitlements")
    fake.entitlements = lambda db, institute_id: _Ent()
    monkeypatch.setitem(sys.modules, "app.services.entitlements", fake)
    return state


async def call(name, arguments, enabled, *, db=None, user_id="admin-1", client_id="client-1"):
    result = await adapter.call_tool(name=name, arguments=arguments, principal=principal(user_id=user_id),
                                     platform_token=TOKEN, db=db, mcp_setting=setting(enabled), client_id=client_id)
    text = "".join(getattr(c, "text", "") for c in result.content)
    return result, json.loads(text)


# ── listed and gated over MCP ────────────────────────────────────────────
def test_each_tool_is_exposed_in_its_own_mcp_group():
    for name, group in MOVED.items():
        assert name in MCP_EXPOSED_TOOLS, name
        assert ASSISTANT_TOOLS[name].key(via_mcp=True) == group, name
        assert name in listed([group]), name
        assert name not in listed([]), name


def test_the_new_groups_start_off_for_every_institute():
    """No group of these tools was ever an MCP group before, so no saved MCP setting switches them on."""
    older = {s.key(via_mcp=True) for s in adapter.exposed_specs() if s.name not in MOVED}
    assert not set(MOVED.values()) & older
    everything_before = setting(sorted(older))
    assert not listed(sorted(older)) & set(MOVED)
    gate = setting_for_tool_gate(everything_before, principal())
    assert not [n for n in MOVED if registry.is_tool_allowed(n, principal(), gate, via_mcp=True)]


def test_the_assistant_groups_do_not_switch_them_on_over_mcp():
    """The doors keep separate groups: the assistant's learner_data / learner_edits are not MCP groups of these."""
    assert not listed(["learner_data", "learner_edits"]) & set(MOVED)
    # announcements is the view; sending is a group of its own over MCP (it is one group in the assistant).
    shown = listed(["announcements"])
    assert "list_announcements" in shown and "send_announcement" not in shown
    # And the in-product assistant still reads its own groups.
    assert registry.is_tool_allowed("send_announcement", principal(), {"enabled_tools": ["announcements"]})
    assert registry.is_tool_allowed("manage_enrollment", principal(), {"enabled_tools": ["learner_edits"]})
    assert not registry.is_tool_allowed("manage_enrollment", principal(),
                                        {"enabled_tools": ["learner_enrolment_changes"]})


def test_find_batch_comes_with_any_group_whose_tools_take_batch_ids():
    for group in ("batch_data", "payments", "assessments", "announcements", "announcement_sends",
                  "learner_enrolment_changes"):
        assert "find_batch" in listed([group]), group
    assert "find_batch" not in listed(["schedule", "learners"])


def test_role_overrides_apply_to_the_new_groups():
    s = {"TEACHER": {"enabled_tools": ["assessments"]}}
    teacher = {t.name for t in adapter.list_tools_for(principal(roles=("TEACHER",)), setting([], s))}
    assert {"find_assessment", "get_assessment_results", "get_assessment_leaderboard"} <= teacher
    assert "get_fee_dues" not in teacher


def test_writes_are_opt_in_allow_listed_and_risk_rated():
    for name, risk in (("manage_enrollment", "live"), ("send_announcement", "outbound")):
        spec = ASSISTANT_TOOLS[name]
        group = spec.key(via_mcp=True)
        assert spec.mode == "WRITE" and name in MCP_ALLOWED_WRITE_TOOLS and "confirm" in MCP_ALLOWED_WRITE_TOOLS[name]
        assert group in MCP_OPT_IN_GROUPS
        assert MCP_TOOL_PLACEMENT[group]["risk"] == risk and MCP_TOOL_PLACEMENT[group]["level"] == "edit"
        tool = next(t for t in adapter.list_tools_for(principal(), setting([group])) if t.name == name)
        assert tool.annotations.read_only_hint is False and tool.annotations.destructive_hint is True
    assert "update_learner_profile" not in MCP_EXPOSED_TOOLS  # learner_edit does that job over MCP


def test_only_the_exposed_card_writes_have_an_mcp_confirmation():
    exposed_card_writes = {n for n in registry.WRITE_PERFORMERS if n in MCP_EXPOSED_TOOLS}
    assert set(registry.MCP_WRITE_CONFIRM) == exposed_card_writes == set(WRITES)
    assert registry.MCP_WRITE_CONFIRM["send_announcement"] == "single_use"
    assert registry.MCP_WRITE_CONFIRM["manage_enrollment"] == "edit_token"
    assert cd.cap_for(registry.mcp_write_purpose("send_announcement")) == 10


def test_plan_features_hide_and_refuse_the_tools_like_the_crm_ones(plan):
    gated = {"find_assessment": "assessments.tests", "get_class_schedule": "live_classes.sessions",
             "list_announcements": "communications.announcements", "get_fee_dues": "finance.fees"}
    enabled = sorted({MOVED[n] for n in gated})
    plan["on"] = set()
    shown = {t.name for t in adapter.list_tools_for(principal(), setting(enabled), db=FakeDb())}
    assert not shown & set(gated)
    plan["on"] = set(gated.values())
    shown = {t.name for t in adapter.list_tools_for(principal(), setting(enabled), db=FakeDb())}
    assert set(gated) <= shown


@pytest.mark.asyncio
async def test_a_tool_outside_the_plan_is_refused_before_it_calls_anything(plan, backend):
    plan["on"] = {"finance.fees"}
    result, out = await call("find_assessment", {"name": "Unit test"}, ["assessments"], db=FakeDb())
    assert result.is_error and out["error"] == "module_not_enabled" and out["feature"] == "assessments.tests"
    assert backend.calls == []
    # Money reads need fees or memberships, like crm_collections.
    _, out = await call("get_collections_summary", {}, ["payments"], db=FakeDb())
    assert "error" not in out and len(backend.calls) == 1


# ── wording an app outside the dashboard can follow ──────────────────────
DASHBOARD_ONLY = ("page context", "confirmation card", "press confirm", "this page", "click", "find_learner",
                  "on the card")


def _all_text(schema):
    return json.dumps(schema).lower()


def test_mcp_wording_has_no_dashboard_only_phrases():
    for name in MOVED:
        text = _all_text(ASSISTANT_TOOLS[name].schema_for(via_mcp=True))
        for phrase in DASHBOARD_ONLY:
            assert phrase not in text, (name, phrase)
    for name in ("list_batch_learners", "get_fee_dues", "get_payment_history", "get_subscription_plans",
                 "manage_enrollment", "send_announcement"):
        assert "learners(action=" in _all_text(ASSISTANT_TOOLS[name].schema_for(via_mcp=True)), name


def test_the_mcp_tool_shows_the_mcp_wording_and_the_assistant_keeps_its_own():
    tools = {t.name: t for t in adapter.list_tools_for(principal(), setting(list(set(MOVED.values()))))}
    for name in WRITES:
        spec = ASSISTANT_TOOLS[name]
        assert "confirm_token" in tools[name].input_schema["properties"]
        assert "confirm_token" in tools[name].description
        assert "confirm_token" not in spec.schema["function"]["parameters"]["properties"]
        assert "confirmation card" in spec.schema["function"]["description"]
    offered = registry.build_offered_tools(principal(), {"enabled_tools": ["learner_edits", "announcements"]})
    by_name = {s["function"]["name"]: s for s in offered}
    assert by_name["manage_enrollment"] is ASSISTANT_TOOLS["manage_enrollment"].schema
    catalog = {c["name"]: c for c in adapter.tool_catalog()}
    assert catalog["send_announcement"]["description"] == tools["send_announcement"].description


# ── identity, token and institute ────────────────────────────────────────
#: (tool, arguments, its MCP group, where the institute must appear in the request)
READ_CALLS = (
    ("get_fee_dues", {"target_user_id": "learner-9"}, "payments", ("params", "instituteId")),
    ("get_payment_history", {"target_user_id": "learner-9"}, "payments", ("body", "institute_id")),
    ("get_subscription_plans", {"target_user_id": "learner-9"}, "payments", ("body", "institute_id")),
    ("search_fee_records", {"statuses": ["OVERDUE"]}, "payments", ("params", "instituteId")),
    ("get_collections_summary", {}, "payments", ("body", "instituteId")),
    ("get_collections_summary", {"start_date": "2026-11-01", "end_date": "2026-11-10"}, "payments",
     ("body", "institute_id")),
    ("list_batch_learners", {"package_session_id": "b-1"}, "batch_data", ("body", "institute_ids")),
    ("list_recent_enrollments", {"start_date": "2026-11-01", "end_date": "2026-11-10"}, "batch_data",
     ("body", "institute_ids")),
    ("find_assessment", {"name": "Unit"}, "assessments", ("params", "instituteId")),
    ("get_assessment_results", {"assessment_id": "a-1"}, "assessments", ("params", "instituteId")),
    ("get_assessment_leaderboard", {"assessment_id": "a-1"}, "assessments", ("params", "instituteId")),
    ("get_class_schedule", {"scope": "upcoming"}, "schedule", ("params", "instituteId")),
    ("list_announcements", {"scope": "past"}, "announcements", ("url", f"/institute/{INST}/past")),
)
SPOOF = {"user_id": "someone-else", "institute_id": "inst-evil", "instituteId": "inst-evil",
         "institute_ids": ["inst-evil"], "clientId": "inst-evil"}


@pytest.mark.asyncio
@pytest.mark.parametrize("name,args,group,where", READ_CALLS)
async def test_reads_use_the_connection_token_and_the_principals_institute(backend, name, args, group, where):
    result, out = await call(name, {**args, **SPOOF}, [group])
    assert not result.is_error, out
    assert backend.calls, name
    for c in backend.calls:
        assert c["headers"] == {"Authorization": f"Bearer {TOKEN}", "clientId": INST}
        sent = json.dumps([c["url"], c["params"], c["body"]])
        assert "inst-evil" not in sent and "someone-else" not in sent, sent
        kind, key = where
        if kind == "url":
            assert key in c["url"]
        else:
            value = (c[kind] or {}).get(key)
            assert value in (INST, [INST]), (name, kind, key, value)
    assert TOKEN not in json.dumps(out)


@pytest.mark.asyncio
async def test_mine_is_always_the_connected_user(backend):
    await call("get_class_schedule", {"scope": "mine", "user_id": "someone-else"}, ["schedule"])
    assert backend.calls[0]["params"] == {"userId": "admin-1"}


@pytest.mark.asyncio
async def test_find_batch_reads_only_this_institutes_batches(backend):
    class _Db(FakeDb):
        def execute(self, stmt, params=None):
            self.statements.append((str(stmt), params))
            return types.SimpleNamespace(fetchall=lambda: [("b-1", "Class 10 (2026)", "ACTIVE", 12)],
                                         first=lambda: None)

    db = _Db()
    _, out = await call("find_batch", {"query": "class 10", **SPOOF}, ["batch_data"], db=db)
    assert out["matches"][0]["package_session_id"] == "b-1"
    assert db.statements[-1][1]["inst"] == INST


@pytest.mark.asyncio
async def test_a_backend_error_is_reported_without_the_token_or_body(backend):
    backend.status, backend.body = 500, {"echo": f"Bearer {TOKEN}"}
    result, out = await call("get_fee_dues", {"target_user_id": "learner-9"}, ["payments"])
    assert result.is_error and out == {"error": "fetch_failed", "status": 500}


@pytest.mark.asyncio
async def test_without_a_platform_token_nothing_is_called(backend):
    result = await adapter.call_tool(name="get_fee_dues", arguments={"target_user_id": "learner-9"},
                                     principal=principal(), platform_token=None, db=None,
                                     mcp_setting=setting(["payments"]))
    assert result.is_error and "no_auth" in result.content[0].text and backend.calls == []


# ── manage_enrollment: preview → confirm_token over MCP ──────────────────
@pytest.fixture
def enrolment(monkeypatch):
    """learner-9 is in batch b-1 of this institute; b-2 is another batch here; b-org is sold to organisations."""
    state = {"status": "ACTIVE", "expires_on": "2026-12-01"}
    names = {"b-1": "Class 10 (2026)", "b-2": "Class 10 Evening (2026)", "b-org": "Partner batch (2026)"}
    monkeypatch.setattr(registry, "_target_in_institute", lambda ctx, uid: uid == "learner-9")
    monkeypatch.setattr(registry, "_batch_name_in_institute", lambda ctx, bid: names.get(bid))
    monkeypatch.setattr(ld, "enrolments", lambda ctx, ids: {
        "learner-9": [{"batch_id": "b-1", "course": "Class 10", "batch": "2026", **state}]} if "learner-9" in ids
        else {})
    monkeypatch.setattr(ld, "org_associated_batches", lambda ctx, ids: {b for b in ids if b == "b-org"})
    monkeypatch.setattr(ld, "learner_profile", lambda ctx, uid: {"user_id": uid, "full_name": "A Learner"})

    def no_card(*a, **kw):
        raise AssertionError("no confirmation card row over MCP")

    from app.repositories import chat_message_repository as cmr
    monkeypatch.setattr(cmr.ChatMessageRepository, "create_message", no_card)
    return state


EXTEND = {"target_user_id": "learner-9", "operation": "ADD_EXPIRY", "new_state": "31-12-2026",
          "current_package_session_id": "b-1"}
ENROLMENT_GROUP = ["learner_enrolment_changes"]


@pytest.mark.asyncio
async def test_enrolment_change_previews_then_applies_only_with_its_token(backend, enrolment):
    result, preview = await call("manage_enrollment", {**EXTEND, **SPOOF}, ENROLMENT_GROUP, db=FakeDb())
    assert not result.is_error and preview["applied"] is False and preview["confirm_token"]
    assert preview["enrolment_now"]["status"] == "ACTIVE" and preview["enrolment_now"]["expires_on"] == "2026-12-01"
    assert preview["learner"] == {"learner_id": "learner-9", "full_name": "A Learner"}
    assert backend.calls == []

    result, done = await call("manage_enrollment", {**EXTEND, **SPOOF, "confirm_token": preview["confirm_token"]},
                              ENROLMENT_GROUP, db=FakeDb())
    assert not result.is_error and done["applied"] is True
    [write] = backend.to("/institute_learner-operation/v1/update")
    assert write["headers"] == {"Authorization": f"Bearer {TOKEN}", "clientId": INST}
    assert write["body"] == {"operation": "ADD_EXPIRY", "requests": [{
        "user_id": "learner-9", "new_state": "31-12-2026", "institute_id": INST,
        "current_package_session_id": "b-1"}]}
    assert TOKEN not in json.dumps([preview, done])


@pytest.mark.asyncio
@pytest.mark.parametrize("token", [None, "", "123.abc", "9999999999.0000000000000000000000000000000000000000"])
async def test_enrolment_change_without_a_valid_token_changes_nothing(backend, enrolment, token):
    args = {**EXTEND, **({"confirm_token": token} if token is not None else {})}
    _, out = await call("manage_enrollment", args, ENROLMENT_GROUP, db=FakeDb())
    if token:
        assert out["error"].startswith("confirm_token_")
    else:
        assert out["applied"] is False  # a fresh preview
    assert backend.to("/institute_learner-operation") == []


@pytest.mark.asyncio
async def test_a_token_is_bound_to_the_change_the_enrolment_the_user_and_the_connection(backend, enrolment):
    _, preview = await call("manage_enrollment", EXTEND, ENROLMENT_GROUP, db=FakeDb())
    token = preview["confirm_token"]
    _, other_date = await call("manage_enrollment", {**EXTEND, "new_state": "31-01-2027", "confirm_token": token},
                               ENROLMENT_GROUP, db=FakeDb())
    _, other_user = await call("manage_enrollment", {**EXTEND, "confirm_token": token}, ENROLMENT_GROUP,
                               db=FakeDb(), user_id="admin-2")
    _, other_app = await call("manage_enrollment", {**EXTEND, "confirm_token": token}, ENROLMENT_GROUP,
                              db=FakeDb(), client_id="client-2")
    enrolment["status"] = "INACTIVE"  # changed in the dashboard after the preview
    _, drifted = await call("manage_enrollment", {**EXTEND, "confirm_token": token}, ENROLMENT_GROUP, db=FakeDb())
    for out in (other_date, other_user, other_app, drifted):
        assert out["error"] == "confirm_token_mismatch", out
    assert backend.to("/institute_learner-operation") == []


@pytest.mark.asyncio
async def test_enrolment_change_refusals(backend, enrolment):
    _, out = await call("manage_enrollment", {**EXTEND, "current_package_session_id": "b-2"}, ENROLMENT_GROUP,
                        db=FakeDb())
    assert out["error"] == "not_enrolled_in_batch"
    _, out = await call("manage_enrollment", {**EXTEND, "target_user_id": "stranger"}, ENROLMENT_GROUP, db=FakeDb())
    assert out["error"] == "not_found"
    move = {**EXTEND, "operation": "UPDATE_BATCH", "new_state": "b-org"}
    _, out = await call("manage_enrollment", move, ENROLMENT_GROUP, db=FakeDb())
    assert out["error"] == "organisation_batch"
    _, out = await call("manage_enrollment", {**move, "new_state": "b-elsewhere"}, ENROLMENT_GROUP, db=FakeDb())
    assert out["error"] == "unknown_batch"
    _, out = await call("manage_enrollment", {**move, "new_state": "b-2"}, ENROLMENT_GROUP, db=FakeDb())
    assert out["change"]["to_batch"] == "Class 10 Evening (2026)" and out["confirm_token"]
    # A group switched off after the preview refuses the apply.
    result, out = await call("manage_enrollment", {**move, "new_state": "b-2", "confirm_token": out["confirm_token"]},
                             ["batch_data"], db=FakeDb())
    assert result.is_error and out["error"] == "tool_not_permitted" and "Settings → AI access" in out["message"]
    assert backend.to("/institute_learner-operation") == []


@pytest.mark.asyncio
async def test_a_refused_write_says_nothing_changed(backend, enrolment):
    _, preview = await call("manage_enrollment", EXTEND, ENROLMENT_GROUP, db=FakeDb())
    backend.status, backend.body = 400, {"detail": "nope"}
    result, out = await call("manage_enrollment", {**EXTEND, "confirm_token": preview["confirm_token"]},
                             ENROLMENT_GROUP, db=FakeDb())
    assert result.is_error and out["error"] == "write_failed" and out["applied"] is False and out["status"] == 400


@pytest.mark.asyncio
async def test_the_assistant_door_keeps_the_card_and_ignores_a_token(backend, enrolment, monkeypatch):
    """A confirm_token (even a valid MCP one) never runs a write in the product: only the card's Confirm does."""
    _, preview = await call("manage_enrollment", EXTEND, ENROLMENT_GROUP, db=FakeDb())
    rows = []
    from app.repositories import chat_message_repository as cmr
    monkeypatch.setattr(cmr.ChatMessageRepository, "create_message",
                        lambda self, **kw: rows.append(kw) or types.SimpleNamespace(id="m-1"))
    ctx = ToolContext(db=FakeDb(), principal=principal(), keys=(), bearer_token=TOKEN, session_id="s-1")
    raw = await execute_tool("manage_enrollment", {**EXTEND, "confirm_token": preview["confirm_token"]}, ctx,
                             {"enabled_tools": ["learner_edits"]}, in_product=True)
    out = json.loads(raw)
    assert out["status"] == "awaiting_user_confirmation" and "confirm_token" not in out
    assert ctx.pending_action and ctx.pending_action["tool"] == "manage_enrollment"
    assert len(rows) == 1 and rows[0]["metadata"]["status"] == "PENDING"
    assert backend.to("/institute_learner-operation") == []


# ── send_announcement: single-use confirmation over MCP ──────────────────
ANNOUNCE = {"title": "Holiday", "message": "The institute is closed on Friday.", "target_batch_ids": ["b-1"],
            "target_user_ids": ["learner-9"], "push": True}
ANNOUNCE_GROUP = ["announcement_sends"]


@pytest.mark.asyncio
async def test_announcement_previews_then_sends_once(backend, enrolment, plan):
    db = confirm_db()
    spoof = {**SPOOF, "createdBy": "someone-else", "instituteId": "inst-evil"}
    result, preview = await call("send_announcement", {**ANNOUNCE, **spoof}, ANNOUNCE_GROUP, db=db)
    assert not result.is_error and preview["applied"] is False and preview["confirm_token"].startswith("vcc_")
    assert preview["recipients"][0] == "batch “Class 10 (2026)”"
    assert preview["recipients"][1].startswith("1 specific learner (")
    assert [n["learner_id"] for n in preview["learners"]] == ["learner-9"]
    assert preview["channels"] == "in-app alert + push notification" and "_summary" not in preview
    assert backend.calls == []

    args = {**ANNOUNCE, **spoof, "confirm_token": preview["confirm_token"]}
    result, sent = await call("send_announcement", args, ANNOUNCE_GROUP, db=db)
    assert not result.is_error and sent["applied"] is True
    [post] = backend.to("/notification-service/v1/announcements")
    assert post["headers"] == {"Authorization": f"Bearer {TOKEN}", "clientId": INST}
    body = post["body"]
    assert (body["instituteId"], body["createdBy"]) == (INST, "admin-1")
    assert body["recipients"] == [{"recipientType": "PACKAGE_SESSION", "recipientId": "b-1"},
                                  {"recipientType": "USER", "recipientId": "learner-9"}]
    assert "inst-evil" not in json.dumps(body) and "someone-else" not in json.dumps(body)

    _, again = await call("send_announcement", args, ANNOUNCE_GROUP, db=db)
    assert again["error"] == "confirm_token_used"
    assert len(backend.to("/notification-service/v1/announcements")) == 1
    assert TOKEN not in json.dumps([preview, sent, again])


@pytest.mark.asyncio
async def test_announcement_token_is_bound_to_the_text_and_recipients(backend, enrolment, plan):
    db = confirm_db()
    _, preview = await call("send_announcement", ANNOUNCE, ANNOUNCE_GROUP, db=db)
    token = preview["confirm_token"]
    for changed in ({"message": "Closed on Saturday."}, {"target_batch_ids": []}, {"push": False}):
        _, out = await call("send_announcement", {**ANNOUNCE, **changed, "confirm_token": token}, ANNOUNCE_GROUP,
                            db=db)
        assert out["error"] == "confirm_token_mismatch", changed
    _, out = await call("send_announcement", {**ANNOUNCE, "confirm_token": token}, ANNOUNCE_GROUP, db=db,
                        user_id="admin-2")
    assert out["error"] == "confirm_token_invalid"
    assert backend.to("/notification-service") == []


@pytest.mark.asyncio
async def test_announcement_targets_must_belong_to_the_institute(backend, enrolment, plan):
    db = confirm_db()
    _, out = await call("send_announcement", {**ANNOUNCE, "target_batch_ids": ["b-elsewhere"]}, ANNOUNCE_GROUP, db=db)
    assert out["error"] == "unknown_batch"
    _, out = await call("send_announcement", {**ANNOUNCE, "target_user_ids": ["stranger"]}, ANNOUNCE_GROUP, db=db)
    assert out["error"] == "unknown_user"
    assert backend.calls == []


@pytest.mark.asyncio
async def test_announcement_sends_are_capped_per_hour(backend, enrolment, plan, monkeypatch):
    monkeypatch.setitem(cd.CAPS, registry.mcp_write_purpose("send_announcement"), 1)
    db = confirm_db()
    for i, expect in ((1, True), (2, False)):
        args = {**ANNOUNCE, "title": f"Notice {i}"}
        _, preview = await call("send_announcement", args, ANNOUNCE_GROUP, db=db)
        _, out = await call("send_announcement", {**args, "confirm_token": preview["confirm_token"]},
                            ANNOUNCE_GROUP, db=db)
        assert (out.get("applied") is True) is expect, out
    assert out["error"] == "rate_limited"
    assert len(backend.to("/notification-service/v1/announcements")) == 1


@pytest.mark.asyncio
async def test_announcement_in_the_product_still_shows_the_card(backend, enrolment, plan, monkeypatch):
    rows = []
    from app.repositories import chat_message_repository as cmr
    monkeypatch.setattr(cmr.ChatMessageRepository, "create_message",
                        lambda self, **kw: rows.append(kw) or types.SimpleNamespace(id="m-1"))
    ctx = ToolContext(db=FakeDb(), principal=principal(), keys=(), bearer_token=TOKEN, session_id="s-1")
    raw = await execute_tool("send_announcement", {**ANNOUNCE, "confirm_token": "vcc_" + "x" * 40}, ctx,
                             {"enabled_tools": ["announcements"]}, in_product=True)
    assert json.loads(raw)["status"] == "awaiting_user_confirmation" and len(rows) == 1
    assert backend.calls == []


@pytest.mark.asyncio
async def test_a_card_write_without_an_mcp_confirmation_is_refused_over_mcp(backend, enrolment):
    """update_learner_profile is not exposed; even reached over MCP its executor refuses instead of writing."""
    ctx = ToolContext(db=FakeDb(), principal=principal(), keys=(), bearer_token=TOKEN, via_mcp=True)
    raw = await execute_tool("update_learner_profile", {"target_user_id": "learner-9", "full_name": "New Name"}, ctx,
                             {"enabled_tools": ["learner_edits"]})
    assert json.loads(raw)["error"] == "tool_not_available"
    assert backend.calls == []


@pytest.mark.asyncio
async def test_making_inactive_always_sends_the_inactive_status(backend, enrolment):
    args = {"target_user_id": "learner-9", "operation": "MAKE_INACTIVE", "current_package_session_id": "b-1"}
    _, preview = await call("manage_enrollment", args, ENROLMENT_GROUP, db=FakeDb())
    assert preview["change"]["new_state"] == "INACTIVE"
    await call("manage_enrollment", {**args, "confirm_token": preview["confirm_token"]}, ENROLMENT_GROUP, db=FakeDb())
    [write] = backend.to("/institute_learner-operation/v1/update")
    assert write["body"]["requests"][0]["new_state"] == "INACTIVE"


@pytest.mark.asyncio
@pytest.mark.parametrize("status", ["TERMINATED", "DELETED", "TERMINATE", "anything"])
async def test_a_status_change_sets_only_active_or_inactive(backend, enrolment, status):
    args = {"target_user_id": "learner-9", "operation": "UPDATE_STATUS", "new_state": status,
            "current_package_session_id": "b-1"}
    _, out = await call("manage_enrollment", args, ENROLMENT_GROUP, db=FakeDb())
    assert out["error"] == "bad_status"
    assert backend.calls == []


def test_payment_references_are_masked_to_their_last_four():
    assert registry._masked_reference("pay_ABCDEF123456") == "******3456"
    assert registry._masked_reference(None) is None
