"""
The CRM read tools in the in-product assistant (the dashboard panel).

Pinned here: which roles get them by default and what a saved setting does;
that they are offered on CRM pages, in conversations that already used them,
and through ``load_tools`` everywhere else; that the plan's CRM module gates
them; that a counsellor sees exactly what MCP shows them; that the outbound
CRM writes stay MCP-only and are refused in the assistant (the other writes are
confirmed on the assistant's card: test_assistant_crm_writes.py); and the
assistant loop end to end with a fake model.
"""
from __future__ import annotations

import json
import sys
import threading
from contextlib import nullcontext
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest  # noqa: E402

from app.services import assistant_tool_registry as reg  # noqa: E402  (load the registry first)
from app.services import assistant_service as asv  # noqa: E402
from app.services import crm_data as cd  # noqa: E402
from app.services.entitlements import LEGACY, MODE_MANAGED, Entitlements  # noqa: E402
from crm_fakes import CrmBackend, make_ctx, principal  # noqa: E402

CRM_READS = ("crm_leads", "crm_calls", "crm_meetings", "crm_messages", "crm_reports", "crm_collections")
CARD_WRITES = ("crm_lead_activity", "crm_lead_edit", "crm_lead_merge", "crm_lead_intake", "crm_team_edit",
               "crm_meetings_edit")
OUTBOUND = ("crm_dial", "crm_ai_campaign", "crm_send", "crm_payment_reminders")
CRM_WRITES = CARD_WRITES + OUTBOUND
LEADS_PAGE = "/audience-manager/recent-leads"
COURSES_PAGE = "/study-library/courses"


def names(schemas):
    return {s["function"]["name"] for s in schemas}


def crm_offered(schemas):
    return names(schemas) & set(CRM_READS)


def managed(*on):
    """Entitlements of a managed plan with exactly these module / feature rows on."""
    return Entitlements(mode=MODE_MANAGED, rows={k: True for k in on})


# ── which tools ──────────────────────────────────────────────────────────

def test_crm_reads_use_both_doors_and_outbound_writes_stay_mcp_only():
    for name in CRM_READS:
        spec = reg.ASSISTANT_TOOLS[name]
        assert spec.mode == "READ" and not spec.mcp_only and spec.topic == reg.CRM_TOPIC, name
    for name in CARD_WRITES:
        spec = reg.ASSISTANT_TOOLS[name]
        assert spec.mode == "WRITE" and not spec.mcp_only and spec.topic == reg.CRM_TOPIC and spec.card_bridge, name
    for name in OUTBOUND:
        spec = reg.ASSISTANT_TOOLS[name]
        assert spec.mode == "WRITE" and spec.mcp_only and spec.topic is None, name
    # every CRM tool is one of the two lists
    assert {n for n in reg.ASSISTANT_TOOLS if n.startswith("crm_")} == set(CRM_READS) | set(CRM_WRITES)


# ── settings defaults ────────────────────────────────────────────────────

@pytest.mark.parametrize("roles", [["ADMIN"], ["COUNSELLOR"], ["COUNSELOR"], ["Counsellor"], [" counsellor "],
                                   ["TEACHER", "COUNSELLOR"]])
def test_no_saved_setting_turns_crm_reads_on_for_admins_and_counsellors(roles):
    p = principal(roles=roles)
    for name in CRM_READS:
        assert reg.is_tool_allowed(name, p, None), (name, roles)


@pytest.mark.parametrize("roles", [["TEACHER"], ["EVALUATOR"], ["STUDENT"], []])
def test_no_saved_setting_leaves_crm_reads_off_for_other_roles(roles):
    p = principal(roles=roles)
    for name in CRM_READS:
        assert not reg.is_tool_allowed(name, p, None), (name, roles)
    assert crm_offered(reg.build_offered_tools(p, None, topics={reg.CRM_TOPIC})) == set()
    assert "load_tools" not in names(reg.build_offered_tools(p, None))


def test_a_saved_setting_is_the_whole_list_so_new_groups_start_off():
    saved = {"enabled_tools": ["search_help_knowledge"], "role_overrides": {"ADMIN": {"enabled_tools": ["learner_data"]}}}
    for roles in (["ADMIN"], ["COUNSELLOR"]):
        p = principal(roles=roles)
        assert not any(reg.is_tool_allowed(n, p, saved) for n in CRM_READS), roles
    # an admin switches groups on per role (or for everyone) in Assistant settings
    granted = {"enabled_tools": ["crm_reports"], "role_overrides": {"COUNSELLOR": {"enabled_tools": ["crm_leads"]}}}
    counsellor, teacher = principal(roles=["COUNSELLOR"]), principal(roles=["TEACHER"])
    assert reg.is_tool_allowed("crm_leads", counsellor, granted) and reg.is_tool_allowed("crm_reports", counsellor, granted)
    assert not reg.is_tool_allowed("crm_calls", counsellor, granted)
    assert reg.is_tool_allowed("crm_reports", teacher, granted) and not reg.is_tool_allowed("crm_leads", teacher, granted)


def test_crm_groups_are_labelled_for_the_settings_tab():
    for name in CRM_READS:
        assert reg.GROUP_LABELS.get(reg.ASSISTANT_TOOLS[name].key()), name


# ── offered by page ──────────────────────────────────────────────────────

@pytest.mark.parametrize("route", [
    "/audience-manager/recent-leads", "/audience-manager/list/campaign-users", "/audience-manager/reports",
    "/counsellors", "/counsellors/user-1", "/sales-dashboard", "/admissions/enquiries", "/admissions/dashboard",
    "/calling/call-queue", "/meetings/my-schedule", "/financial-management/collection-dashboard",
    "/financial-management/pay-installments", "/payment-dashboard", "/manage-payments",
    "/audience-manager/follow-ups/", "/audience-manager/reports?tab=utm",
])
def test_crm_pages_activate_the_crm_topic(route):
    assert reg.topics_for_route(route) == {reg.CRM_TOPIC}


@pytest.mark.parametrize("route", [
    "/study-library/courses", "/dashboard", "/manage-students/students-list", "/financial-management/fee-plans",
    "/audience-managerx", "/settings", "", None, "audience-manager/recent-leads", 42,
])
def test_other_pages_do_not(route):
    assert reg.topics_for_route(route) == set()


@pytest.mark.parametrize("roles", [["ADMIN"], ["COUNSELLOR"]])
def test_crm_reads_are_offered_on_crm_pages_only_and_load_tools_elsewhere(roles):
    p = principal(roles=roles)
    on_page = reg.build_offered_tools(p, None, topics=reg.topics_for_route(LEADS_PAGE), entitlements=LEGACY)
    elsewhere = reg.build_offered_tools(p, None, topics=reg.topics_for_route(COURSES_PAGE), entitlements=LEGACY)
    assert crm_offered(on_page) == set(CRM_READS) and "load_tools" not in names(on_page)
    assert crm_offered(elsewhere) == set() and "load_tools" in names(elsewhere)
    load = next(s for s in elsewhere if s["function"]["name"] == "load_tools")
    assert load["function"]["parameters"]["properties"]["topic"]["enum"] == ["crm"]


def test_conversation_keeps_a_topic_once_a_crm_tool_or_load_tools_was_called():
    assert asv.conversation_topics(COURSES_PAGE, []) == set()
    assert asv.conversation_topics(LEADS_PAGE, []) == {"crm"}
    assert asv.conversation_topics(COURSES_PAGE, [{"tool_name": "crm_reports"}]) == {"crm"}
    assert asv.conversation_topics(COURSES_PAGE, [{"tool_name": "load_tools", "topic": "crm"}]) == {"crm"}
    # a refused load, an unknown topic or an unrelated tool keeps nothing on
    assert asv.conversation_topics(COURSES_PAGE, [{"tool_name": "load_tools"}, {"tool_name": "load_tools", "topic": "x"},
                                                  {"tool_name": "find_learner"}, {"tool_name": None}, {}]) == set()


# ── the fallback: load_tools ─────────────────────────────────────────────

def test_load_tools_switches_crm_on_only_for_callers_who_may_use_it():
    admin = principal(roles=["ADMIN"])
    usable = reg.in_product_specs(admin, None, LEGACY)
    result, topic = asv.load_topic({"topic": "CRM "}, usable)
    assert topic == "crm" and set(json.loads(result)["tools"]) == set(CRM_READS)

    teacher = principal(roles=["TEACHER"])
    result, topic = asv.load_topic({"topic": "crm"}, reg.in_product_specs(teacher, None, LEGACY))
    assert topic is None and json.loads(result)["error"] == "topic_not_available"
    result, topic = asv.load_topic({"topic": "payroll"}, usable)
    assert topic is None and json.loads(result)["error"] == "topic_not_available"


def test_load_tools_schema_is_small():
    p = principal(roles=["ADMIN"])
    without = reg.build_offered_tools(p, None, entitlements=LEGACY)
    load = next(s for s in without if s["function"]["name"] == "load_tools")
    assert len(json.dumps(load)) < 1000
    crm = sum(len(json.dumps(reg.ASSISTANT_TOOLS[n].schema)) for n in CRM_READS)
    assert crm > 20 * len(json.dumps(load))


# ── the module gate ──────────────────────────────────────────────────────

def test_institutes_without_the_crm_module_never_get_crm_reads():
    p = principal(roles=["ADMIN"])
    no_crm = managed()
    offered = reg.build_offered_tools(p, None, topics={"crm"}, entitlements=no_crm)
    assert crm_offered(offered) == set() and "load_tools" not in names(offered)
    assert not any(s.topic for s in reg.in_product_specs(p, None, no_crm))
    # with the CRM module the reads that need only it come back; calls and collections need their own features
    leads_only = Entitlements(mode=MODE_MANAGED, rows={"crm": True, "crm.leads": True, "crm.calling": False,
                                                       "crm.ai_calling": False, "finance": False})
    assert crm_offered(reg.build_offered_tools(p, None, topics={"crm"}, entitlements=leads_only)) == {
        "crm_leads", "crm_meetings", "crm_messages", "crm_reports"}


async def test_execute_tool_refuses_a_crm_read_outside_the_plan(monkeypatch):
    monkeypatch.setattr(reg, "load_entitlements", lambda db, inst: managed())
    ctx = make_ctx(via_mcp=False)
    out = json.loads(await reg.execute_tool("crm_leads", {"action": "my_day"}, ctx, None, in_product=True))
    assert out["error"] == "module_not_enabled" and out["feature"] == "crm.leads"


def test_capabilities_and_prompt_follow_the_plan():
    svc = asv.AssistantAgentService(lambda: nullcontext(None))
    p = principal(roles=["ADMIN"])
    no_crm = managed()
    prompt = svc._build_system_prompt(p, None, entitlements=no_crm,
                                      usable_specs=reg.in_product_specs(p, None, no_crm))
    assert "CRM leads: view" not in prompt and cd.LEAD_CONTENT_RULE not in prompt
    assert "you have NO tools for them" in prompt


# ── scope: a counsellor sees what MCP shows them ─────────────────────────

class _Leads:
    """Two leads of inst-1; the scope predicate lets only c-1's through."""

    def __init__(self, backend):
        self.backend = backend
        backend.sql.on("", self.answer)

    def answer(self, params, sql):
        leads = {
            "r-1": {"lead_id": "r-1", "lead_user_id": "u-1", "owner_id": "c-1", "in_scope": True},
            "r-9": {"lead_id": "r-9", "lead_user_id": "u-9", "owner_id": "c-9", "in_scope": False},
        }
        if "COUNT(*) OVER ()" in sql:
            return [{"id": i, "opted_out": False, "total": 2, "opted_out_total": 0} for i in leads]
        if "cfc.cf_phone" in sql:
            from crm_fakes import lead_row
            return [lead_row(i, leads[i]["lead_user_id"], owner_id=leads[i]["owner_id"], tier=None, score=1,
                             next_followup_at=None, sla_due_at=None, first_response_at=None, cf_name=None,
                             cf_phone=None, cf_email=None, last_activity_at=None)
                    for i in params["ids"] if leads[i]["in_scope"]]
        return []


async def test_counsellor_scope_is_the_same_in_the_assistant_as_on_mcp(monkeypatch):
    backend = CrmBackend().install(monkeypatch)
    backend.lead_scope("COUNSELLOR_TREE", owner_ids=["c-1"])
    _Leads(backend)
    args = {"action": "list", "filter": {}}

    assistant_ctx = make_ctx("c-1", ("COUNSELLOR",), via_mcp=False)          # no MCP client, the dashboard JWT
    in_product = json.loads(await reg.execute_tool("crm_leads", dict(args), assistant_ctx, None, in_product=True))
    mcp_ctx = make_ctx("c-1", ("COUNSELLOR",), via_mcp=True)
    mcp_ctx.client_id = "client-1"
    over_mcp = json.loads(await reg.execute_tool("crm_leads", dict(args), mcp_ctx,
                                                 {"enabled_tools": ["crm_leads"], "role_overrides": {}}))

    assert "error" not in in_product, in_product
    assert in_product == over_mcp
    assert [lead["lead_id"] for p in in_product["people"] for lead in p["leads"]] == ["r-1"]
    owners = [params["scope_owners"] for _sql, params in backend.sql.matching("cfc.cf_phone")]
    assert owners == [["c-1"], ["c-1"]]
    # the scope comes from admin-core for the pinned caller, never from tool arguments
    scope_calls = backend.admin_core.called(cd.LEAD_SCOPE_PATH)
    assert len(scope_calls) == 2 and all(c["params"] == {"instituteId": "inst-1"} for c in scope_calls)


async def test_model_supplied_identity_never_widens_the_assistant_scope(monkeypatch):
    backend = CrmBackend().install(monkeypatch)
    backend.lead_scope("COUNSELLOR_TREE", owner_ids=["c-1"])
    _Leads(backend)
    ctx = make_ctx("c-1", ("COUNSELLOR",), via_mcp=False)
    # A stray user_id is refused (a lead goes as lead_id); a stray institute_id is replaced by the pinned one.
    out = json.loads(await reg.execute_tool("crm_leads", {"action": "list", "filter": {}, "user_id": "admin-1"},
                                            ctx, None, in_product=True))
    assert out["error"] == "use_lead_id"
    out = json.loads(await reg.execute_tool("crm_leads", {"action": "list", "filter": {}, "institute_id": "inst-2"},
                                            ctx, None, in_product=True))
    assert [lead["lead_id"] for p in out["people"] for lead in p["leads"]] == ["r-1"]
    assert all(c["params"].get("instituteId") in (None, "inst-1") for c in backend.admin_core.calls)


async def test_export_works_in_the_assistant_as_a_private_link(monkeypatch):
    """The dashboard panel opens absolute links in a new tab, so the same one-off download link works there."""
    from datetime import timedelta
    from app.services import assistant_tools_crm_leads as leads_mod
    from app.services import file_exports as fe
    backend = CrmBackend().install(monkeypatch)
    backend.lead_scope("COUNSELLOR_TREE", owner_ids=["c-1"])
    _Leads(backend)
    made = {}

    def fake_create(db, **kw):
        made.update(kw)
        return fe.ExportHandle(export_id="e-1", url="https://ai/exports/e-1/k", kind=kw["kind"], label="leads",
                               file_name=kw["file_name"], size_bytes=10,
                               expires_at=datetime.now(timezone.utc) + timedelta(minutes=15), max_downloads=2)

    monkeypatch.setattr(leads_mod, "create_export", fake_create)
    ctx = make_ctx("c-1", ("COUNSELLOR",), via_mcp=False)
    out = json.loads(await reg.execute_tool("crm_leads", {"action": "export", "filter": {}}, ctx, None, in_product=True))
    assert out["download_url"] == "https://ai/exports/e-1/k" and out["rows"] == 1
    assert made["user_id"] == "c-1" and made["institute_id"] == "inst-1"
    assert "r-9" not in made["content"]


# ── outbound writes: MCP only, refused in the assistant ──────────────────

async def test_outbound_crm_writes_are_never_offered_and_are_refused_in_the_assistant(monkeypatch):
    backend = CrmBackend().install(monkeypatch)
    every_group = {"enabled_tools": [reg.ASSISTANT_TOOLS[n].key() for n in CRM_READS + CRM_WRITES],
                   "role_overrides": {}}
    p = principal(roles=["ADMIN"])
    offered = names(reg.build_offered_tools(p, every_group, topics={"crm"}, entitlements=LEGACY))
    assert not offered & set(OUTBOUND) and set(CRM_READS) | set(CARD_WRITES) <= offered
    for name in OUTBOUND:
        for setting in (None, every_group):
            ctx = make_ctx(via_mcp=False)
            out = json.loads(await reg.execute_tool(name, {"action": "preview"}, ctx, setting, in_product=True))
            assert out["error"] == "tool_not_available" and "MCP" in out["message"], name
            assert "Assistant settings" not in out["message"]
    assert backend.admin_core.calls == [] and backend.sql.calls == []


def test_the_prompt_says_crm_is_read_only_and_shares_the_lead_content_rule():
    from app.mcp.server import SERVER_INSTRUCTIONS
    svc = asv.AssistantAgentService(lambda: nullcontext(None))
    p = principal(roles=["COUNSELLOR"])
    prompt = svc._build_system_prompt(p, None, entitlements=LEGACY, active_topics=set())
    assert cd.LEAD_CONTENT_RULE in prompt and cd.LEAD_CONTENT_RULE in SERVER_INSTRUCTIONS
    assert "only READ CRM data" in prompt and "`load_tools`" in prompt
    loaded = svc._build_system_prompt(p, None, entitlements=LEGACY, active_topics={"crm"})
    assert "`load_tools`" not in loaded
    # MCP-only groups are not presented as something an admin can switch on here; the card writes are
    for name in OUTBOUND:
        assert reg.GROUP_LABELS[reg.ASSISTANT_TOOLS[name].key()] not in prompt, name
    for name in CARD_WRITES:
        assert reg.GROUP_LABELS[reg.ASSISTANT_TOOLS[name].key()] in prompt, name


# ── the assistant loop, end to end with a fake model ─────────────────────

class _Store:
    def __init__(self):
        self.messages = []

    def add(self, session_id, message_type, content, metadata=None):
        msg = SimpleNamespace(id=len(self.messages) + 1, session_id=session_id, message_type=message_type,
                              content=content, meta_data=metadata, created_at=datetime.now(timezone.utc))
        self.messages.append(msg)
        return msg


class _Loop:
    """Patches everything around AssistantAgentService.stream; records what the model was offered."""

    def __init__(self, monkeypatch, roles=("ADMIN",), script=()):
        self.store = _Store()
        self.offered = []
        self.calls = []
        self.script = list(script)
        self.principal = principal(user_id="u-1", roles=roles)
        store, loop = self.store, self

        class SessionRepo:
            def __init__(self, db):
                pass

            def get_session_by_id(self, sid):
                return SimpleNamespace(id=sid, user_id="u-1", institute_id="inst-1",
                                       context_type=reg.ASSISTANT_CONTEXT_TYPE, status="ACTIVE")

            def update_last_active(self, sid):
                pass

        class MessageRepo:
            def __init__(self, db):
                pass

            def get_latest_message(self, sid):
                return store.messages[-1] if store.messages else None

            def get_conversation_history(self, sid, limit=10, message_types=None):
                types = message_types or ["user", "assistant"]
                return [m for m in store.messages if m.message_type in types][-limit:]

            def create_message(self, session_id, message_type, content, metadata=None):
                return store.add(session_id, message_type, content, metadata)

        class Llm:
            def __init__(self, resolver):
                pass

            async def chat_completion_stream(self, messages, tools=None, **kw):
                loop.offered.append(names(tools or []))
                step = loop.script.pop(0) if loop.script else "Done."
                if isinstance(step, tuple):
                    name, args = step
                    yield {"type": "tool_calls", "tool_calls": [
                        {"id": f"call-{len(loop.offered)}", "function": {"name": name, "arguments": json.dumps(args)}}]}
                else:
                    yield {"type": "token", "content": step}

        async def fake_execute(name, args, ctx, setting, *, in_product=False):
            loop.calls.append({"name": name, "in_product": in_product, "via_mcp": ctx.via_mcp,
                               "thread": threading.get_ident(), "bearer": ctx.bearer_token})
            return json.dumps({"ok": True})

        monkeypatch.setattr(asv, "ChatSessionRepository", SessionRepo)
        monkeypatch.setattr(asv, "ChatMessageRepository", MessageRepo)
        monkeypatch.setattr(asv, "ApiKeyResolver", lambda db: SimpleNamespace(resolve_keys=lambda **kw: ("k", "g", "m")))
        monkeypatch.setattr(asv, "_assistant_model_chain", lambda *a: (None, None))
        monkeypatch.setattr(asv, "load_assistant_tools_setting", lambda db, inst: None)
        monkeypatch.setattr(asv, "load_entitlements", lambda db, inst: LEGACY)
        monkeypatch.setattr(asv, "CreditService", lambda db: SimpleNamespace(
            check_credits=lambda req: SimpleNamespace(has_sufficient_credits=True)))
        monkeypatch.setattr(asv, "ChatLLMClient", Llm)
        monkeypatch.setattr(asv, "execute_tool", fake_execute)
        self.service = asv.AssistantAgentService(lambda: nullcontext(object()))

    async def turn(self, text, route):
        self.store.add("s-1", "user", text, {"page_context": {"route": route}})
        return [e async for e in self.service.stream("s-1", self.principal, bearer_token="jwt-of-the-caller")]

    def tool_calls(self):
        return [m.meta_data for m in self.store.messages if m.message_type == "tool_call"]


async def test_on_a_crm_page_the_first_call_already_has_the_crm_reads(monkeypatch):
    loop = _Loop(monkeypatch, script=[("crm_reports", {"action": "overview"}), "Here it is."])
    await loop.turn("How many leads this week?", LEADS_PAGE)
    assert set(CRM_READS) <= loop.offered[0] and "load_tools" not in loop.offered[0]
    main = threading.get_ident()
    assert loop.calls[0]["name"] == "crm_reports" and loop.calls[0]["in_product"] and not loop.calls[0]["via_mcp"]
    assert loop.calls[0]["bearer"] == "jwt-of-the-caller"
    assert loop.calls[0]["thread"] != main          # the CRM reads run off the event loop


async def test_off_a_crm_page_load_tools_brings_them_in_and_they_stay(monkeypatch):
    loop = _Loop(monkeypatch, script=[("load_tools", {"topic": "crm"}), ("crm_leads", {"action": "my_day"}),
                                      "You have 3 follow-ups."])
    events = await loop.turn("Who should I call today?", COURSES_PAGE)
    first, second = loop.offered[0], loop.offered[1]
    assert not first & set(CRM_READS) and "load_tools" in first
    assert set(CRM_READS) <= second and "load_tools" not in second
    assert [c["name"] for c in loop.calls] == ["crm_leads"]            # load_tools runs nothing
    assert loop.tool_calls()[0] == {"tool_name": "load_tools", "tool_call_id": "call-1", "topic": "crm"}
    assert any(e["event"] == "message" and e["data"]["type"] == "assistant" for e in events)

    # the next turn, still off a CRM page, offers them from the start
    loop.script = ["Sure."]
    await loop.turn("And tomorrow?", COURSES_PAGE)
    assert set(CRM_READS) <= loop.offered[-1]


async def test_a_conversation_never_about_leads_never_pays_for_crm_schemas(monkeypatch):
    loop = _Loop(monkeypatch, script=[("search_help_knowledge", {"query": "add a course"}), "Steps…"])
    await loop.turn("How do I add a course?", COURSES_PAGE)
    assert all(not offered & set(CRM_READS) for offered in loop.offered)
    assert loop.calls[0]["thread"] == threading.get_ident()           # other tools run as before


async def test_a_teacher_gets_no_crm_tools_and_no_load_tools(monkeypatch):
    loop = _Loop(monkeypatch, roles=("TEACHER",), script=["Hi."])
    await loop.turn("Show my leads", LEADS_PAGE)
    assert not loop.offered[0] & (set(CRM_READS) | {"load_tools"})


async def test_a_refused_load_tools_keeps_the_crm_reads_off(monkeypatch):
    loop = _Loop(monkeypatch, roles=("TEACHER",), script=[("load_tools", {"topic": "crm"}), "Not available."])
    await loop.turn("Show my leads", COURSES_PAGE)
    assert not loop.offered[1] & set(CRM_READS)
    assert loop.tool_calls()[0].get("topic") is None and loop.calls == []
