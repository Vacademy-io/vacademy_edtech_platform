"""
`workflows` / `workflows_edit`: draft-only, model-free automation authoring.

The connected LLM composes the workflow JSON; these tools normalise it into the
builder DTO, lint it against the audited failure modes, run the backend
validator and save a DRAFT. So the tests pin down: the normaliser accepts the
shapes a model plausibly emits and forces what it may not decide (institute,
status, id); the lint catches dead nodes / flat delays / unreachable nodes /
foreign ids / missing templates; nothing is saved while errors remain; the
saved payload is always a DRAFT of the pinned institute; and nothing that is
not a DRAFT can be updated or discarded.
"""
import json
import sys
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest  # noqa: E402
from app.schemas.auth import PinnedPrincipal  # noqa: E402
from app.services import assistant_tools_workflow as wf_mod  # noqa: E402
from app.services import assistant_tool_registry as registry  # noqa: E402
from app.services import website_data  # noqa: E402
from app.services.assistant_tool_registry import ASSISTANT_TOOLS, ToolContext, is_tool_allowed  # noqa: E402
from app.services.assistant_tools_workflow import (  # noqa: E402
    email_placeholders,
    execute_workflows,
    execute_workflows_edit,
    lint_workflow,
    normalize_workflow,
    step_summary,
    whatsapp_body_problems,
)

INST = "inst-1"


def principal(roles=("ADMIN",)):
    return PinnedPrincipal(user_id="user-1", institute_id=INST, roles=list(roles), permissions=[], is_root_user=False)


class _FakeDb:
    """Answers the SQL lookups the tools make against the shared DB."""
    def __init__(self):
        self.batches = [("ps-1", "Class 12 NEET 2027 (default)", "ACTIVE", 40), ("ps-2", "Class 11 Foundation (default)", "ACTIVE", 12)]
        self.executions = {"exec-1": INST, "exec-other": "inst-2"}

    def execute(self, stmt, params=None):
        sql = str(stmt)
        params = params or {}
        if "FROM workflow_execution e JOIN workflow w" in sql:
            inst = self.executions.get(params.get("id"))
            return SimpleNamespace(first=lambda: (inst,) if inst else None)
        if "FROM package_session ps" in sql and "LIMIT :lim" in sql:
            q = str(params.get("q") or "%%").strip("%")
            rows = [b for b in self.batches if q in b[1].lower()]
            return SimpleNamespace(fetchall=lambda: rows[: params.get("lim", 50)])
        if "WHERE ps.id = :psid" in sql:
            hit = next((b for b in self.batches if b[0] == params.get("psid")), None)
            return SimpleNamespace(first=lambda: (hit[1],) if hit else None)
        if "admin_portal_base_url" in sql:
            return SimpleNamespace(first=lambda: ("admin.acme.edu",))
        return SimpleNamespace(first=lambda: None, fetchall=lambda: [])


def ctx(roles=("ADMIN",)):
    return ToolContext(db=_FakeDb(), principal=principal(roles), keys=(), bearer_token="jwt")


DRAFT_WF = {
    "id": "wf-draft", "name": "Lead thank-you", "status": "DRAFT", "workflow_type": "EVENT_DRIVEN", "institute_id": INST,
    "nodes": [
        {"id": "n-trigger", "name": "Trigger", "node_type": "TRIGGER", "config": {"triggerEvent": "AUDIENCE_LEAD_SUBMISSION"}, "is_start_node": True},
        {"id": "n-email", "name": "Send email", "node_type": "SEND_EMAIL",
         "config": {"templateName": "lead_thank_you", "on": "{#ctx['user']}", "forEach": {"operation": "SEND_EMAIL", "eval": "#ctx['item']"}}},
    ],
    "edges": [{"id": "e1", "source_node_id": "n-trigger", "target_node_id": "n-email"}],
    "trigger": {"trigger_event_name": "AUDIENCE_LEAD_SUBMISSION", "event_applied_type": "AUDIENCE"},
}
ACTIVE_WF = {**DRAFT_WF, "id": "wf-live", "name": "Live one", "status": "ACTIVE"}
FOREIGN_WF = {**DRAFT_WF, "id": "wf-foreign", "institute_id": "inst-2"}

EMAIL_TEMPLATES = [
    {"id": "t1", "name": "lead_thank_you", "status": "ACTIVE", "subject": "Thanks {{name}}", "dynamicParameters": {"name": "string"},
     "content": "<p>Hi {{name}}</p>", "contentType": "text/html"},
    {"id": "t2", "name": "old_promo", "status": "INACTIVE", "dynamicParameters": {}},
]
WHATSAPP_TEMPLATES = [
    {"id": "w1", "name": "welcome_wa", "status": "APPROVED", "language": "en", "category": "UTILITY",
     "bodyText": "Hi {{1}}, welcome to {{2}}", "bodySampleValues": ["Riya", "Acme"]},
    {"id": "w2", "name": "pending_wa", "status": "PENDING", "bodyText": "Hello"},
]
CAMPAIGN = {"id": "camp-1", "campaign_name": "Admissions 2027", "status": "ACTIVE", "campaign_type": "WEBSITE",
            "campaign_objective": "LEAD_GENERATION", "institute_id": INST, "institute_custom_fields": []}


class _Backend:
    """A stand-in for the admin-core / notification calls, recording every write."""
    def __init__(self):
        self.calls = []
        self.created = []
        self.updated = []
        self.deleted = []
        self.validate_errors = []      # what POST /validate answers
        self.workflows = {"wf-draft": DRAFT_WF, "wf-live": ACTIVE_WF, "wf-foreign": FOREIGN_WF}
        self.raw = []                  # (method, path, params, body) through _raw_call
        self.email_created = []
        self.wa_created = []
        self.wa_submitted = []
        self.submit_fails = None       # set to an error dict to make /submit answer 400

    async def admin_core(self, ctx_, method, path, params=None, body=None, timeout=None):
        self.calls.append((method, path, params, body))
        if path.endswith("/workflow/validate"):
            return list(self.validate_errors)
        if path == "/admin-core-service/v1/workflow" and method == "POST":
            self.created.append(body)
            return {**body, "id": "wf-new"}
        if path.startswith("/admin-core-service/v1/workflow/") and path.endswith("/edit"):
            wf = self.workflows.get(path.split("/")[-2])
            return wf if wf else {"error": "fetch_failed", "status": 404}
        if path.startswith("/admin-core-service/v1/workflow/") and method == "PUT":
            self.updated.append((path.split("/")[-1], body))
            return {**body}
        if path.startswith("/admin-core-service/v1/workflow/") and method == "DELETE":
            self.deleted.append(path.split("/")[-1])
            return {"error": "fetch_failed", "status": 204}
        if path.endswith("/workflows-with-schedules/list"):
            return {"content": [
                {"workflow_id": "wf-live", "workflow_name": "Live one", "workflow_status": "ACTIVE", "workflow_type": "EVENT_DRIVEN",
                 "trigger_event_name": "AUDIENCE_LEAD_SUBMISSION", "event_applied_type": "AUDIENCE", "trigger_status": "ACTIVE"},
                {"workflow_id": "wf-sched", "workflow_name": "Daily report", "workflow_status": "ACTIVE", "workflow_type": "SCHEDULED",
                 "schedule_id": "s1", "schedule_type": "CRON", "cron_expression": "0 0 9 * * ?", "timezone": "Asia/Kolkata",
                 "next_run_at": "2026-09-20T09:00:00"},
            ], "total_elements": 2}
        if path.endswith("/workflow-execution/list"):
            return {"content": [{"id": "exec-1", "workflow_id": body.get("workflow_ids", ["wf-live"])[0], "workflow_name": "Live one",
                                 "status": "COMPLETED", "started_at": "2026-09-19T08:00:00"}], "total_elements": 1}
        if path.endswith("/workflow/logs/execution/exec-1"):
            return [{"node_type": "TRIGGER", "status": "SUCCESS", "execution_time_ms": 3},
                    {"node_type": "SEND_EMAIL", "status": "FAILED", "error_message": "template missing", "execution_time_ms": 20}]
        if path.endswith("/workflow/ai-catalog"):
            return {"version": "2026-09-11", "workflowJsonShape": {"name": "string"}, "generationRules": ["rule one " * 80],
                    "nodeTypes": [{"type": "TRIGGER"}, {"type": "SEND_EMAIL"}], "readQueries": [{"key": "fetch_students_by_batch"}],
                    "mutatingQueryKeys": ["createLiveSession"], "commonTriggers": [], "triggerContextKeys": {"AUDIENCE_LEAD_SUBMISSION": "user, customFields"},
                    "avoidNodeTypes": {"ROUTER": "no handler"}}
        if path.endswith("/catalog/trigger-events"):
            return [{"key": "AUDIENCE_LEAD_SUBMISSION", "label": "Audience Lead Submission"}]
        if "/institute/template/v1/institute/" in path:
            return EMAIL_TEMPLATES if path.endswith("/type/EMAIL") else []
        if path.endswith("/audience/campaigns"):
            return {"content": [CAMPAIGN], "total_elements": 1}
        if f"/open/v1/audience/campaign/{INST}/camp-1" in path:
            return CAMPAIGN
        if "/open/v1/audience/campaign/" in path:
            return {"error": "fetch_failed", "status": 404}
        if path.endswith("/get-sessions/live"):
            return [{"sessions": [{"sessionId": "ls-1", "title": "Physics live", "subject": "Physics"}]}]
        if path.endswith("/learner-invitation/invitation-details"):
            return {"content": [{"id": "inv-1", "name": "Sept intake", "inviteCode": "SEPT26", "status": "ACTIVE"}]}
        raise AssertionError(f"unexpected admin-core call {method} {path}")

    async def notification(self, ctx_, method, path, params=None, body=None, timeout=None):
        self.calls.append((method, path, params, body))
        if path.endswith("/whatsapp-templates/list"):
            return WHATSAPP_TEMPLATES + [{**c, "status": "DRAFT"} for c in self.wa_created]
        raise AssertionError(f"unexpected notification call {method} {path}")

    async def raw_call(self, ctx_, base_url, method, path, params=None, body=None, timeout=None):
        self.raw.append((method, path, params, body))
        if path.endswith("/institute/template/v1/create"):
            self.email_created.append(body)
            return 201, {**body, "id": f"t-new-{len(self.email_created)}"}
        if path == "/notification-service/v1/whatsapp-templates" and method == "POST":
            row = {**body, "id": f"w-new-{len(self.wa_created) + 1}", "status": "DRAFT"}
            self.wa_created.append(row)
            return 200, row
        if path.endswith("/submit"):
            if self.submit_fails:
                return 400, self.submit_fails
            tid = path.split("/")[-2]
            self.wa_submitted.append(tid)
            row = next(r for r in self.wa_created if r["id"] == tid)
            return 200, {**row, "status": "PENDING", "submittedAt": "2026-09-21T10:00:00Z"}
        if path.endswith("/whatsapp-templates/sync"):
            return 200, {"synced": 3, "instituteId": params["instituteId"]}
        raise AssertionError(f"unexpected raw call {method} {path}")


@pytest.fixture
def backend(monkeypatch):
    b = _Backend()
    monkeypatch.setattr(wf_mod, "_admin_core_json", b.admin_core)
    monkeypatch.setattr(wf_mod, "_notification_json", b.notification)
    monkeypatch.setattr(website_data, "_admin_core_json", b.admin_core)
    monkeypatch.setattr(wf_mod, "_raw_call", b.raw_call)
    return b


async def run(tool, args, c=None):
    return json.loads(await tool(args, c or ctx()))


def good_workflow(**over):
    wf = {
        "name": "Thank-you on lead",
        "description": "Email every new lead",
        "workflow_type": "EVENT_DRIVEN",
        "trigger": {"trigger_event_name": "AUDIENCE_LEAD_SUBMISSION", "event_applied_type": "AUDIENCE", "event_ids": ["camp-1"],
                    "idempotency_generation_setting": {"strategy": "CUSTOM_EXPRESSION", "customExpression": "'wf_' + #ctx['responseId']"}},
        "nodes": [
            {"id": "t", "name": "Trigger", "node_type": "TRIGGER", "config": {"triggerEvent": "AUDIENCE_LEAD_SUBMISSION"}, "is_start_node": True},
            {"id": "e", "name": "Thank you", "node_type": "SEND_EMAIL",
             "config": {"templateName": "lead_thank_you", "on": "{#ctx['user']}", "forEach": {"operation": "SEND_EMAIL", "eval": "#ctx['item']"},
                        "templateVars": {"name": "#ctx['user'].fullName"}}},
        ],
        "edges": [{"source_node_id": "t", "target_node_id": "e"}],
    }
    wf.update(over)
    return wf


# ── registration + gating ────────────────────────────────────────────────
def test_tools_are_registered_and_gated_by_their_own_groups():
    assert ASSISTANT_TOOLS["workflows"].mode == "READ"
    assert ASSISTANT_TOOLS["workflows_edit"].mode == "WRITE"
    assert registry.GROUP_LABELS["workflows_edits"] == "Automations: draft"
    p = principal()
    assert is_tool_allowed("workflows", p, {"enabled_tools": ["workflows"]})
    assert not is_tool_allowed("workflows_edit", p, {"enabled_tools": ["workflows"]})
    assert is_tool_allowed("workflows_edit", p, {"enabled_tools": ["workflows_edits"]})
    # Unconfigured institute: reads default on for admins, the write tool never.
    assert is_tool_allowed("workflows", p, None)
    assert not is_tool_allowed("workflows_edit", p, None)


# ── normaliser ───────────────────────────────────────────────────────────
def test_normaliser_forces_identity_and_draft_status():
    raw = good_workflow(id="model-invented", institute_id="inst-other", status="ACTIVE")
    dto, errors, _ = normalize_workflow(raw, institute_id=INST)
    assert not errors
    assert dto["id"] is None and dto["institute_id"] == INST and dto["status"] == "DRAFT"
    dto2, _, _ = normalize_workflow(raw, institute_id=INST, workflow_id="wf-draft")
    assert dto2["id"] == "wf-draft"


def test_normaliser_accepts_canvas_shape_and_drafter_wrapper():
    raw = {"workflow": {
        "name": "Canvas", "workflowType": "SCHEDULED",
        "schedule": {"cronExpression": "0 0 9 * * ?", "timezone": "Asia/Kolkata"},
        "nodes": [
            {"id": "a", "data": {"label": "Start", "nodeType": "TRIGGER", "config": {}, "isStartNode": True}, "position": {"x": 1, "y": 2}},
            {"id": "b", "data": {"label": "Fetch", "nodeType": "QUERY", "config": {"prebuiltKey": "fetch_students_by_batch", "params": {}}}},
        ],
        "edges": [{"source": "a", "target": "b"}],
    }}
    dto, errors, _ = normalize_workflow(raw, institute_id=INST)
    assert not errors
    assert [n["node_type"] for n in dto["nodes"]] == ["TRIGGER", "QUERY"]
    assert dto["nodes"][0]["is_start_node"] and dto["nodes"][0]["position_x"] == 1
    assert dto["edges"][0]["source_node_id"] == "a" and dto["edges"][0]["target_node_id"] == "b"
    assert dto["schedule"] == {"schedule_type": "CRON", "cron_expression": "0 0 9 * * ?", "timezone": "Asia/Kolkata"}
    assert dto["trigger"] is None
    assert dto["nodes"][0]["config"]["triggerEvent"] == "SCHEDULED"
    assert dto["nodes"][1]["is_end_node"] is True


def test_normaliser_folds_config_routing_into_edges_and_wires_conditions():
    raw = {
        "name": "Branchy", "workflow_type": "EVENT_DRIVEN",
        "nodes": [
            {"id": "t", "name": "Trigger", "node_type": "TRIGGER",
             "config": {"triggerEvent": "LEARNER_BATCH_ENROLLMENT", "routing": [{"type": "goto", "targetNodeId": "c"}]}},
            {"id": "c", "name": "Has email?", "node_type": "CONDITION",
             "config": {"condition": "#ctx['user'].email != null",
                        "routing": [{"type": "conditional", "condition": "#ctx['user'].email != null", "trueNodeId": "e", "falseNodeId": "w"}]}},
            {"id": "e", "name": "Email", "node_type": "SEND_EMAIL", "config": {"on": "{#ctx['user']}", "templateName": "lead_thank_you", "routing": [{"type": "end"}]}},
            {"id": "w", "name": "WhatsApp", "node_type": "SEND_WHATSAPP", "config": {"on": "{#ctx['user']}", "templateName": "welcome_wa", "routing": [{"type": "end"}]}},
        ],
    }
    dto, errors, warnings = normalize_workflow(raw, institute_id=INST)
    assert not errors and not warnings
    # trigger backfilled from the TRIGGER node, start flag defaulted onto it
    assert dto["trigger"]["trigger_event_name"] == "LEARNER_BATCH_ENROLLMENT"
    assert dto["nodes"][0]["is_start_node"] is True
    # routing became edges; the true edge carries the predicate, the false edge the label
    edges = {(e["source_node_id"], e["target_node_id"]): e for e in dto["edges"]}
    assert set(edges) == {("t", "c"), ("c", "e"), ("c", "w")}
    assert edges[("c", "e")]["condition"] == "#ctx['user'].email != null"
    assert edges[("c", "w")]["label"] == "false" and "condition" not in edges[("c", "w")]
    assert all("routing" not in n["config"] for n in dto["nodes"])
    assert step_summary(dto) == "TRIGGER → CONDITION → [SEND_EMAIL | SEND_WHATSAPP]"


def test_normaliser_propagates_condition_onto_plain_edges_like_the_dashboard():
    raw = good_workflow()
    raw["nodes"].insert(1, {"id": "c", "name": "Gate", "node_type": "CONDITION", "config": {"condition": "#ctx['user'] != null"}})
    raw["nodes"].append({"id": "x", "name": "Other", "node_type": "SEND_EMAIL", "config": {"on": "{#ctx['user']}", "templateName": "lead_thank_you"}})
    raw["edges"] = [{"source_node_id": "t", "target_node_id": "c"}, {"source_node_id": "c", "target_node_id": "e"},
                    {"source_node_id": "c", "target_node_id": "x"}]
    dto, errors, _ = normalize_workflow(raw, institute_id=INST)
    assert not errors
    out = [e for e in dto["edges"] if e["source_node_id"] == "c"]
    assert out[0]["condition"] == "#ctx['user'] != null" and out[0]["label"] == "true"
    assert out[1]["label"] == "false"


def test_normaliser_rejects_garbage():
    dto, errors, _ = normalize_workflow("not json", institute_id=INST)
    assert dto is None and errors[0]["severity"] == "ERROR"
    dto, errors, _ = normalize_workflow({"name": "x", "nodes": []}, institute_id=INST)
    assert any(e["field"] == "nodes" for e in errors)
    dto, errors, _ = normalize_workflow({"name": "x", "nodes": [{"node_type": "TRIGGER"}]}, institute_id=INST)
    assert any("id" in e["field"] for e in errors)
    assert any(e["field"] == "workflow_type" for e in errors)


# ── lint ─────────────────────────────────────────────────────────────────
def test_lint_catches_the_audited_failure_modes():
    raw = good_workflow()
    raw["nodes"] += [
        {"id": "r", "name": "Router", "node_type": "ROUTER", "config": {}},
        {"id": "p", "name": "Push", "node_type": "SEND_PUSH_NOTIFICATION", "config": {}},
        {"id": "d", "name": "Wait", "node_type": "DELAY", "config": {"delayValue": 3, "delayUnit": "DAYS"}},
        {"id": "q", "name": "Create", "node_type": "QUERY", "config": {"prebuiltKey": "createLiveSession", "resultKey": "x"}},
        {"id": "z", "name": "Weird", "node_type": "TELEPORT", "config": {}},
        {"id": "o", "name": "Orphan", "node_type": "SEND_EMAIL", "config": {"on": "#ctx['students']", "templateName": "lead_thank_you"}},
    ]
    raw["edges"] += [{"source_node_id": "e", "target_node_id": "r"}, {"source_node_id": "r", "target_node_id": "p"},
                     {"source_node_id": "p", "target_node_id": "d"}, {"source_node_id": "d", "target_node_id": "q"},
                     {"source_node_id": "q", "target_node_id": "z"}]
    dto, errors, _ = normalize_workflow(raw, institute_id=INST)
    assert not errors
    errors, warnings = lint_workflow(dto)
    msgs = " | ".join(e["message"] for e in errors)
    assert "ROUTER has no handler" in msgs
    assert "SEND_PUSH_NOTIFICATION is a stub" in msgs
    assert "DELAY config must be nested" in msgs
    assert "Unknown node type 'TELEPORT'" in msgs
    assert "not reachable from the start node" in msgs
    wmsgs = " | ".join(w["message"] for w in warnings)
    assert "WRITES data" in wmsgs and "resultKey is ignored" in wmsgs


def test_lint_flags_missing_on_bad_cron_and_missing_idempotency():
    raw = good_workflow()
    raw["nodes"][1]["config"].pop("on")
    raw["trigger"].pop("idempotency_generation_setting")
    dto, _, _ = normalize_workflow(raw, institute_id=INST)
    errors, warnings = lint_workflow(dto)
    assert any(e["field"] == "config.on" for e in errors)
    assert any("idempotency" in w["field"] for w in warnings)
    sched = {"name": "S", "workflow_type": "SCHEDULED", "schedule": {"cron_expression": "every morning"},
             "nodes": [{"id": "t", "node_type": "TRIGGER", "config": {}}]}
    dto, _, _ = normalize_workflow(sched, institute_id=INST)
    errors, _ = lint_workflow(dto)
    assert any(e["field"] == "schedule.cron_expression" for e in errors)


# ── validate ─────────────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_validate_saves_nothing_and_merges_backend_errors(backend):
    backend.validate_errors = [{"nodeId": "e", "field": "templateVars", "message": "bad var", "severity": "ERROR"},
                               {"nodeId": None, "field": "nodes", "message": "only one start", "severity": "WARNING"}]
    res = await run(execute_workflows_edit, {"action": "validate", "workflow": good_workflow()})
    assert res["valid"] is False and res["saved"] is False
    assert {"node_id": "e", "field": "templateVars", "message": "bad var", "severity": "ERROR"} in res["errors"]
    assert any(w["message"] == "only one start" for w in res["warnings"])
    assert res["normalized"]["steps"] == "TRIGGER → SEND_EMAIL"
    assert not backend.created and not backend.updated and not backend.deleted
    # The backend saw the forced identity, not the model's.
    validate_body = next(b for m, p, _, b in backend.calls if p.endswith("/workflow/validate"))
    assert validate_body["institute_id"] == INST and validate_body["status"] == "DRAFT"


@pytest.mark.asyncio
async def test_validate_checks_templates_and_institute_ownership(backend):
    wf = good_workflow()
    wf["nodes"][1]["config"]["templateName"] = "does_not_exist"
    wf["trigger"]["event_ids"] = ["camp-nope"]
    wf["nodes"].append({"id": "w", "name": "WA", "node_type": "SEND_WHATSAPP", "config": {"on": "{#ctx['user']}", "templateName": "pending_wa"}})
    wf["nodes"].append({"id": "q", "name": "Roster", "node_type": "QUERY", "config": {"prebuiltKey": "fetch_students_by_batch", "params": {"batchId": "ps-1,ps-nope"}}})
    wf["edges"] += [{"source_node_id": "e", "target_node_id": "w"}, {"source_node_id": "w", "target_node_id": "q"}]
    res = await run(execute_workflows_edit, {"action": "validate", "workflow": wf})
    emsgs = " | ".join(e["message"] for e in res["errors"])
    assert "Email template 'does_not_exist' does not exist" in emsgs
    assert "'camp-nope' is not a audience" in emsgs or "'camp-nope' is not an audience" in emsgs or "camp-nope" in emsgs
    assert "'ps-nope' is not a batch" in emsgs
    assert "ps-1" not in emsgs
    wmsgs = " | ".join(w["message"] for w in res["warnings"])
    assert "'pending_wa' is PENDING" in wmsgs


# ── create_draft ─────────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_create_draft_refuses_while_errors_remain(backend):
    wf = good_workflow()
    wf["nodes"].append({"id": "r", "name": "R", "node_type": "ROUTER", "config": {}})
    wf["edges"].append({"source_node_id": "e", "target_node_id": "r"})
    res = await run(execute_workflows_edit, {"action": "create_draft", "workflow": wf})
    assert res["error"] == "validation_failed" and res["saved"] is False
    assert not backend.created


@pytest.mark.asyncio
async def test_create_draft_saves_a_draft_of_the_pinned_institute(backend):
    res = await run(execute_workflows_edit, {"action": "create_draft", "workflow": good_workflow(status="ACTIVE", institute_id="inst-2")})
    assert res["workflow"]["id"] == "wf-new" and res["workflow"]["status"] == "DRAFT" and res["created"] is True
    assert res["editor_url"] == "https://admin.acme.edu/workflow/wf-new/edit"
    assert len(backend.created) == 1
    body = backend.created[0]
    assert body["status"] == "DRAFT" and body["institute_id"] == INST and body["id"] is None
    assert body["trigger"]["event_ids"] == ["camp-1"]
    assert body["nodes"][0]["is_start_node"] is True and body["nodes"][1]["is_end_node"] is True
    # POST carries the caller as userId, from the principal.
    _, _, params, _ = next(c for c in backend.calls if c[0] == "POST" and c[1] == "/admin-core-service/v1/workflow")
    assert params == {"userId": "user-1"}


# ── update / discard: drafts only ────────────────────────────────────────
@pytest.mark.asyncio
async def test_update_draft_refuses_published_and_foreign_workflows(backend):
    res = await run(execute_workflows_edit, {"action": "update_draft", "workflow_id": "wf-live", "workflow": good_workflow()})
    assert res["error"] == "not_a_draft" and res["status"] == "ACTIVE"
    res = await run(execute_workflows_edit, {"action": "update_draft", "workflow_id": "wf-foreign", "workflow": good_workflow()})
    assert res["error"] == "unknown_workflow"
    res = await run(execute_workflows_edit, {"action": "update_draft", "workflow_id": "../x", "workflow": good_workflow()})
    assert res["error"] == "unknown_workflow"
    assert not backend.updated


@pytest.mark.asyncio
async def test_update_draft_replaces_a_draft_in_place(backend):
    res = await run(execute_workflows_edit, {"action": "update_draft", "workflow_id": "wf-draft", "workflow": good_workflow(name="Renamed")})
    assert res["workflow"] == {"id": "wf-draft", "name": "Renamed", "status": "DRAFT", "type": "EVENT_DRIVEN",
                               "steps": "TRIGGER → SEND_EMAIL", "node_count": 2}
    wid, body = backend.updated[0]
    assert wid == "wf-draft" and body["id"] == "wf-draft" and body["status"] == "DRAFT" and body["institute_id"] == INST


@pytest.mark.asyncio
async def test_discard_draft_only_removes_drafts(backend):
    res = await run(execute_workflows_edit, {"action": "discard_draft", "workflow_id": "wf-live"})
    assert res["error"] == "not_a_draft" and not backend.deleted
    res = await run(execute_workflows_edit, {"action": "discard_draft", "workflow_id": "wf-draft"})
    assert res["discarded"] is True and backend.deleted == ["wf-draft"]


@pytest.mark.asyncio
async def test_unknown_edit_action_is_refused(backend):
    res = await run(execute_workflows_edit, {"action": "publish", "workflow_id": "wf-draft"})
    assert res["error"] == "unknown_action" and "publish" not in res["available"]


# ── reads ────────────────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_list_and_get(backend):
    res = await run(execute_workflows, {"action": "list"})
    assert [w["id"] for w in res["workflows"]] == ["wf-live", "wf-sched"]
    assert res["workflows"][0]["trigger"]["event"] == "AUDIENCE_LEAD_SUBMISSION"
    assert res["workflows"][1]["schedule"]["cron"] == "0 0 9 * * ?"
    body = next(b for _, p, _, b in backend.calls if p.endswith("/workflows-with-schedules/list"))
    assert body == {"institute_id": INST}

    res = await run(execute_workflows, {"action": "get", "workflow_id": "wf-draft"})
    assert res["workflow"]["status"] == "DRAFT" and res["steps"] == "TRIGGER → SEND_EMAIL"
    assert res["nodes"][1]["config"]["templateName"] == "lead_thank_you"
    assert res["editor_url"].endswith("/workflow/wf-draft/edit")
    res = await run(execute_workflows, {"action": "get", "workflow_id": "wf-foreign"})
    assert res["error"] == "unknown_workflow"


@pytest.mark.asyncio
async def test_runs_are_institute_scoped_and_expose_node_failures(backend):
    res = await run(execute_workflows, {"action": "runs", "workflow_id": "wf-live"})
    assert res["executions"][0]["execution_id"] == "exec-1" and res["executions"][0]["status"] == "COMPLETED"
    res = await run(execute_workflows, {"action": "runs", "execution_id": "exec-1"})
    assert res["failed_nodes"] == 1 and res["nodes"][1]["error"] == "template missing"
    res = await run(execute_workflows, {"action": "runs", "execution_id": "exec-other"})
    assert res["error"] == "unknown_execution"
    res = await run(execute_workflows, {"action": "runs", "workflow_id": "wf-foreign"})
    assert res["error"] == "unknown_workflow"


@pytest.mark.asyncio
async def test_catalog_sections_never_truncate_the_rules(backend):
    res = await run(execute_workflows, {"action": "catalog"})
    assert res["section"] == "overview"
    assert len(res["generationRules"][0]) > 500          # the long rule survives whole
    assert res["nodeTypeNames"] == ["TRIGGER", "SEND_EMAIL"] and res["readQueryKeys"] == ["fetch_students_by_batch"]
    assert res["triggerEventNames"] == ["AUDIENCE_LEAD_SUBMISSION"]
    res = await run(execute_workflows, {"action": "catalog", "section": "trigger_events"})
    assert res["trigger_events"][0]["key"] == "AUDIENCE_LEAD_SUBMISSION"
    res = await run(execute_workflows, {"action": "catalog", "section": "nope"})
    assert res["error"] == "bad_request"


@pytest.mark.asyncio
async def test_context_lists_real_ids_and_only_usable_templates(backend):
    res = await run(execute_workflows, {"action": "context"})
    assert res["batches"]["items"][0] == {"package_session_id": "ps-1", "name": "Class 12 NEET 2027 (default)", "status": "ACTIVE", "enrolled": 40}
    assert res["audiences"]["items"] == [{"audience_id": "camp-1", "name": "Admissions 2027", "type": "WEBSITE", "objective": "LEAD_GENERATION"}]
    assert [t["name"] for t in res["templates"]["email"]["items"]] == ["lead_thank_you"]        # INACTIVE dropped
    assert [t["name"] for t in res["templates"]["whatsapp"]["items"]] == ["welcome_wa"]          # PENDING not sendable
    assert res["templates"]["whatsapp_pending"]["items"] == [{"name": "pending_wa", "status": "PENDING"}]
    assert res["templates"]["whatsapp"]["items"][0]["placeholders"] == ["1", "2"]
    assert res["templates"]["email"]["items"][0]["placeholders"] == ["name"]
    assert res["live_sessions"]["items"] == [{"live_session_id": "ls-1", "title": "Physics live", "subject": "Physics"}]
    assert res["invites"]["items"][0]["enroll_invite_id"] == "inv-1"
    res = await run(execute_workflows, {"action": "context", "kind": "batches", "search": "foundation"})
    assert [b["package_session_id"] for b in res["batches"]["items"]] == ["ps-2"] and "audiences" not in res


# ── templates: read ──────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_template_read_returns_full_content_and_a_node_hint(backend):
    res = await run(execute_workflows, {"action": "template", "channel": "EMAIL", "name": "lead_thank_you"})
    assert res["template"]["html"] == "<p>Hi {{name}}</p>" and res["template"]["usable"] is True
    assert res["send_node_hint"]["config"]["templateName"] == "lead_thank_you"
    assert list(res["send_node_hint"]["config"]["templateVars"]) == ["name"]

    res = await run(execute_workflows, {"action": "template", "channel": "WHATSAPP", "name": "welcome_wa"})
    assert res["template"]["body"] == "Hi {{1}}, welcome to {{2}}" and res["template"]["placeholders"] == ["1", "2"]
    assert res["send_node_hint"]["config"]["languageCode"] == "en"
    res = await run(execute_workflows, {"action": "template", "channel": "WHATSAPP", "name": "pending_wa"})
    assert res["template"]["usable"] is False and "PENDING" in res["note"]
    res = await run(execute_workflows, {"action": "template", "channel": "EMAIL", "name": "nope"})
    assert res["error"] == "unknown_template"
    res = await run(execute_workflows, {"action": "template", "name": "x"})
    assert res["error"] == "missing_argument"


# ── templates: pure helpers ──────────────────────────────────────────────
def test_email_placeholders_are_distinct_and_ordered():
    assert email_placeholders("Hi {{ fullName }}", "<p>{{fullName}} — {{class_time}} {{ Full Name }}</p>") == ["fullName", "class_time", "Full Name"]


def test_whatsapp_rules_mirror_meta():
    ok = whatsapp_body_problems("class_reminder", "Hi {{1}}, your class is at {{2}}.", "UTILITY", ["Riya", "5pm"], "", "", [])
    assert ok == []
    bad = whatsapp_body_problems("Class Reminder", "{{1}} your class {{3}}", "AUTHENTICATION", ["Riya"], "", "", [{"type": "URL", "text": "Join"}])
    text = " ".join(bad)
    assert "lowercase" in text and "AUTHENTICATION" in text and "no gaps" in text
    assert "start with a variable" in text and "sample_values" in text and "absolute http" in text
    assert "named placeholders" in " ".join(whatsapp_body_problems("x", "Hi {{name}}, welcome.", "UTILITY", [], "", "", []))


# ── templates: create email ──────────────────────────────────────────────
@pytest.mark.asyncio
async def test_create_email_template_derives_placeholders_and_saves_active(backend):
    res = await run(execute_workflows_edit, {
        "action": "create_email_template", "name": "class_reminder",
        "subject": "Your class {{className}} starts soon",
        "html": "<p>Hi {{fullName}},</p><p>{{className}} starts at {{startTime}}.</p>",
        "placeholder_labels": {"startTime": "Class start time"},
    })
    assert res["template"] == {"id": "t-new-1", "name": "class_reminder", "channel": "EMAIL", "status": "ACTIVE",
                               "subject": "Your class {{className}} starts soon", "placeholders": ["className", "fullName", "startTime"]}
    assert list(res["send_node_hint"]["config"]["templateVars"]) == ["className", "fullName", "startTime"]
    body = backend.email_created[0]
    assert body["instituteId"] == INST and body["status"] == "ACTIVE" and body["type"] == "EMAIL" and body["contentType"] == "text/html"
    assert body["dynamicParameters"] == {"className": "Class Name", "fullName": "Full Name", "startTime": "Class start time"}
    assert body["settingJson"]["variables"] == ["className", "fullName", "startTime"]


@pytest.mark.asyncio
async def test_create_email_template_never_touches_an_existing_one(backend):
    res = await run(execute_workflows_edit, {"action": "create_email_template", "name": "lead_thank_you", "subject": "s", "html": "<p>x</p>"})
    assert res["error"] == "template_exists" and not backend.email_created
    res = await run(execute_workflows_edit, {"action": "create_email_template", "name": "cond", "subject": "s", "html": "{{#if a}}x{{/if}}"})
    assert res["error"] == "bad_request" and not backend.email_created
    res = await run(execute_workflows_edit, {"action": "create_email_template", "name": "x"})
    assert res["error"] == "missing_argument" and set(res["needs"]) == {"subject", "html"}


# ── templates: create WhatsApp ───────────────────────────────────────────
@pytest.mark.asyncio
async def test_create_whatsapp_template_drafts_then_submits_to_meta(backend):
    res = await run(execute_workflows_edit, {
        "action": "create_whatsapp_template", "name": "Class_Reminder",
        "body": "Hi {{1}}, your {{2}} class starts at {{3}}. See you there!",
        "sample_values": ["Riya", "Physics", "5:00 PM"], "variable_names": ["name", "subject", "time"],
        "footer_text": "Acme Coaching", "buttons": [{"type": "URL", "text": "Join", "url": "https://acme.edu/join"}],
    })
    assert res["submitted"] is True and res["template"]["status"] == "PENDING" and res["template"]["usable"] is False
    assert res["template"]["name"] == "class_reminder" and res["template"]["placeholders"] == ["1", "2", "3"]
    assert res["send_node_hint"]["config"] == {"templateName": "class_reminder", "languageCode": "en",
                                               "templateVars": {"1": "<item field or #ctx SpEL>", "2": "<item field or #ctx SpEL>", "3": "<item field or #ctx SpEL>"}}
    draft = backend.wa_created[0]
    assert draft["instituteId"] == INST and draft["category"] == "UTILITY" and draft["language"] == "en"
    assert draft["bodySampleValues"] == ["Riya", "Physics", "5:00 PM"] and draft["bodyVariableNames"] == ["name", "subject", "time"]
    assert draft["headerType"] == "NONE" and draft["footerText"] == "Acme Coaching"
    assert draft["buttons"] == [{"type": "URL", "text": "Join", "url": "https://acme.edu/join", "phoneNumber": None}]
    assert backend.wa_submitted == ["w-new-1"]


@pytest.mark.asyncio
async def test_create_whatsapp_template_refuses_bad_content_and_duplicates_before_calling_meta(backend):
    res = await run(execute_workflows_edit, {"action": "create_whatsapp_template", "name": "x", "body": "{{1}} hello"})
    assert res["error"] == "bad_request" and any("start with a variable" in p for p in res["problems"])
    res = await run(execute_workflows_edit, {"action": "create_whatsapp_template", "name": "welcome_wa", "body": "Hello there {{1}}.", "sample_values": ["Riya"]})
    assert res["error"] == "template_exists" and res["status"] == "APPROVED"
    assert not backend.wa_created and not backend.wa_submitted


@pytest.mark.asyncio
async def test_create_whatsapp_template_relays_metas_reason_when_submit_fails(backend):
    backend.submit_fails = {"message": "WhatsApp is not connected for this institute.", "hint": "Add the Meta token in Settings.", "code": "NOT_CONFIGURED"}
    res = await run(execute_workflows_edit, {"action": "create_whatsapp_template", "name": "fee_due", "body": "Hi {{1}}, your fee is due.", "sample_values": ["Riya"]})
    assert res["submitted"] is False and res["template"]["status"] == "DRAFT"
    assert res["submit_error"] == {"message": "WhatsApp is not connected for this institute.", "hint": "Add the Meta token in Settings.", "code": "NOT_CONFIGURED"}
    assert "NOT submitted" in res["next"]
    res = await run(execute_workflows_edit, {"action": "create_whatsapp_template", "name": "fee_due_2", "body": "Hi {{1}}, your fee is due.", "sample_values": ["Riya"], "submit": False})
    assert "submitted" not in res and res["template"]["status"] == "DRAFT" and backend.wa_submitted == []


@pytest.mark.asyncio
async def test_sync_whatsapp_templates_groups_by_status(backend):
    res = await run(execute_workflows_edit, {"action": "sync_whatsapp_templates"})
    assert res["synced"] == 3
    assert res["templates_by_status"] == {"APPROVED": ["welcome_wa"], "PENDING": ["pending_wa"]}
    _, _, params, _ = backend.raw[0]
    assert params == {"instituteId": INST}
