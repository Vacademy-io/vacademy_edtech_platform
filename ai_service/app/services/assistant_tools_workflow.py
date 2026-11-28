"""
The ``workflows`` / ``workflows_edit`` tools — the institute's automations
(the workflow builder) for the Assistant and the MCP server.

Automations are declarative JSON (``{name, trigger|schedule, nodes[], edges[]}``)
persisted by ``WorkflowBuilderService``; the AI drafter's grounding document
(``GET /v1/workflow/ai-catalog``) already tells a model exactly which node
types, queries, trigger events and rules exist. So, as with the website tools,
NO model runs server-side here: the connected LLM reads the catalog and the
institute's real entities, composes the workflow JSON itself, and this module
normalises it, lints it against the audited failure modes, runs the backend
validator, and saves a DRAFT.

    workflows        list      the institute's automations with trigger/schedule + run summary
                     get       one automation as the builder JSON (nodes, edges, trigger, schedule)
                     runs      recent executions, or one execution's per-node log
                     catalog   the grounding document, in sections (rules, node types, queries, ...)
                     context   real ids to reference: batches, audiences, templates, sessions, invites
                     template  one message template in full (email HTML, or WhatsApp body + status)

    workflows_edit   validate                  normalise + lint + backend-validate a workflow; saves nothing
                     create_draft              the same, then save it as a DRAFT automation
                     update_draft              replace a DRAFT automation's definition (never a published one)
                     discard_draft             remove a DRAFT automation (never a published one)
                     create_email_template     a NEW email template (send nodes reference it by name)
                     create_whatsapp_template  a NEW WhatsApp template, submitted to Meta for approval
                     sync_whatsapp_templates   refresh WhatsApp template statuses from Meta

Why the write tool is allowed over MCP (which has no confirm card): every
action forces ``status=DRAFT``. A DRAFT never fires — ``WorkflowTriggerService``
and the scheduler only pick up ``workflow.status='ACTIVE'`` — and only the
admin can publish it, from the builder. ``update_draft``/``discard_draft``
refuse anything whose stored status is not DRAFT, so a live automation cannot be
changed or removed from here. The template actions are ADDITIVE: they create new
templates (a template sends nothing until an automation references it) and never
edit or remove an existing one — an existing template may be in use by a live
automation.
"""
from __future__ import annotations

import json
import logging
import re
import uuid
from typing import Any, Dict, List, Optional, Tuple

from .assistant_tool_registry import (
    ToolContext,
    ToolSpec,
    _admin_core_json,
    _batch_name_in_institute,
    _compact,
    _jwt_headers,
    _notification_json,
)

logger = logging.getLogger(__name__)

WORKFLOWS_TOOL_NAME = "workflows"
WORKFLOWS_GROUP_KEY = "workflows"
WORKFLOWS_ACTIONS = ("list", "get", "runs", "catalog", "context", "template")

WORKFLOWS_EDIT_TOOL_NAME = "workflows_edit"
WORKFLOWS_EDIT_GROUP_KEY = "workflows_edits"
WORKFLOWS_EDIT_ACTIONS = ("validate", "create_draft", "update_draft", "discard_draft",
                          "create_email_template", "create_whatsapp_template", "sync_whatsapp_templates")

#: Meta's template rules, checked here before the round trip so the model gets a
#: specific message (mirror of notification-service WhatsAppTemplateValidator).
WHATSAPP_CATEGORIES = ("UTILITY", "MARKETING")
WHATSAPP_BODY_MAX = 1024
WHATSAPP_NAME_RE = re.compile(r"^[a-z0-9_]{1,512}$")
_WA_PLACEHOLDER_RE = re.compile(r"\{\{\s*(\d+)\s*\}\}")
_EMAIL_PLACEHOLDER_RE = re.compile(r"\{\{\s*([A-Za-z_][A-Za-z0-9_ .-]*?)\s*\}\}")
_EMAIL_HTML_MAX = 60_000

CATALOG_SECTIONS = ("overview", "node_types", "queries", "triggers", "trigger_events", "query_keys", "all")
CONTEXT_KINDS = ("batches", "audiences", "templates", "live_sessions", "invites")

_MAX_LIST = 50
_MAX_RUNS = 25
_MAX_CONTEXT_ITEMS = 40

#: Node types the engine cannot run (no handler / stub). The catalog documents
#: them as "avoid"; here they are a hard lint error so a draft can never carry one.
DEAD_NODE_TYPES: Dict[str, str] = {
    "ROUTER": "has no handler — the engine cannot execute it",
    "SEND_PUSH_NOTIFICATION": "is a stub that logs and sends nothing",
}
#: Nodes that act for real even in the dashboard's Test Run.
UNSAFE_IN_DRY_RUN = ("SET_LEAD_STATUS", "COMBOT")
#: Prebuilt query keys that WRITE (mirror of admin_core MutatingQueryKeys).
MUTATING_QUERY_KEYS = (
    "createLiveSession", "createSessionSchedule", "createSessionParticipent",
    "upsertUserCustomField", "updateSSIGMRemaingDaysByOne",
)
NODE_TYPES = (
    "ACTION", "QUERY", "TRANSFORM", "TRIGGER", "ROUTER", "SEND_EMAIL", "SEND_WHATSAPP", "HTTP_REQUEST",
    "COMBOT", "DELAY", "FILTER", "AGGREGATE", "CONDITION", "LOOP", "MERGE", "SCHEDULE_TASK",
    "UPDATE_RECORD", "SEND_PUSH_NOTIFICATION", "CALL_AI", "SET_LEAD_STATUS",
)
#: trigger.event_applied_type → which `context` kind its event_ids come from.
APPLIED_TYPE_KIND = {
    "PACKAGE_SESSION": "batches",
    "AUDIENCE": "audiences",
    "LIVE_SESSION": "live_sessions",
    "ENROLL_INVITE": "invites",
}


# ──────────────────────────────────────────────────────────────────────────
# Schemas
# ──────────────────────────────────────────────────────────────────────────

WORKFLOWS_SCHEMA: Dict[str, Any] = {
    "type": "function",
    "function": {
        "name": WORKFLOWS_TOOL_NAME,
        "description": (
            "Read the institute's automations (workflows): event-driven or scheduled flows of nodes "
            "(QUERY, SEND_EMAIL, SEND_WHATSAPP, DELAY, CONDITION, ...) that message learners, leads and "
            "staff. Pick an `action`:\n"
            "- list (status?, search?, limit?): every automation with its trigger or schedule, status, "
            "last/next run.\n"
            "- get (workflow_id): one automation as builder JSON — nodes with their config, edges, "
            "trigger, schedule — plus a one-line step summary.\n"
            "- runs (workflow_id?, execution_id?, limit?): recent executions; with execution_id, that "
            "run's per-node log (status, timing, error). A run marked COMPLETED can still contain "
            "FAILED nodes — read the node log before saying it worked.\n"
            "- catalog (section?): the authoring contract the builder enforces. `overview` (default) "
            "has the workflow JSON shape and the hard generation rules; `node_types` each node's config; "
            "`queries` prebuilt query keys with their output keys and item field names; `triggers` the "
            "common trigger events and every #ctx key each event provides; `trigger_events` the full "
            "event list; `query_keys` every query's parameter contract; `all` everything.\n"
            "- context (kind?, search?): the REAL ids to reference — batches (package_session_id), "
            "audiences (lead campaigns), templates (ACTIVE email + APPROVED WhatsApp, with their "
            "placeholders; WhatsApp templates still DRAFT/PENDING/REJECTED are listed separately and "
            "cannot be sent yet), live_sessions, invites. Never invent an id or a template name: take "
            "them from here.\n"
            "- template (channel, name): one template in full — an email's subject and HTML, or a "
            "WhatsApp template's body, header, footer, buttons, sample values, status and rejection "
            "reason. Read it before reusing a template or writing templateVars for it.\n"
            "To build an automation: read catalog(overview) and the sections you need, fetch context for "
            "the ids and templates, create any missing template with workflows_edit(create_email_template "
            "| create_whatsapp_template), compose the workflow JSON, then use workflows_edit(validate) until "
            "it is clean and workflows_edit(create_draft) to save it as a draft the admin publishes."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "action": {"type": "string", "enum": list(WORKFLOWS_ACTIONS)},
                "workflow_id": {"type": "string", "description": "get / runs: an automation id (from `list`)."},
                "execution_id": {"type": "string", "description": "runs: one execution id (from `runs`) to get its per-node log."},
                "status": {"type": "string", "description": "list: ACTIVE, DRAFT, INACTIVE or ALL (default ALL)."},
                "search": {"type": "string", "description": "list: name filter. context: filter batches/templates/etc. by name."},
                "limit": {"type": "integer", "description": "list / runs: max rows (default 20, max 50)."},
                "section": {"type": "string", "enum": list(CATALOG_SECTIONS), "description": "catalog: which part of the contract (default overview)."},
                "kind": {"type": "string", "enum": list(CONTEXT_KINDS), "description": "context: one kind; omit for all kinds (capped)."},
                "channel": {"type": "string", "enum": ["EMAIL", "WHATSAPP"], "description": "template: which channel the name belongs to."},
                "name": {"type": "string", "description": "template: the template name (from context)."},
            },
            "required": ["action"],
        },
    },
}

WORKFLOWS_EDIT_SCHEMA: Dict[str, Any] = {
    "type": "function",
    "function": {
        "name": WORKFLOWS_EDIT_TOOL_NAME,
        "description": (
            "Create and edit DRAFT automations (workflows). Nothing here ever runs or goes live: every "
            "action saves status=DRAFT, and a draft fires only after the admin reviews it in the builder "
            "and presses Publish. Pick an `action`:\n"
            "- validate (workflow): normalise + lint + run the backend validator on a workflow JSON you "
            "composed. Saves nothing. Returns errors (must fix) and warnings (tell the admin).\n"
            "- create_draft (workflow): validate, then save as a new DRAFT. Returns the id and editor_url "
            "the admin reviews and publishes at. Refused while errors remain.\n"
            "- update_draft (workflow_id, workflow): replace a DRAFT automation's definition. Refused for "
            "ACTIVE/INACTIVE automations — published ones are edited in the dashboard.\n"
            "- discard_draft (workflow_id): remove a DRAFT automation (the undo for create_draft). Refused "
            "for anything that is not a DRAFT.\n"
            "- create_email_template (name, subject, html, placeholder_labels?): a NEW email template a "
            "SEND_EMAIL node can reference by name. Write {{placeholders}} in the subject/html for "
            "per-recipient values; the placeholder list is derived for you and becomes the node's "
            "templateVars keys. Plain {{var}} substitution only — no conditionals or loops. Names must be "
            "unique; existing templates are never changed (they may be in use by live automations).\n"
            "- create_whatsapp_template (name, body, category?, language?, sample_values?, variable_names?, "
            "header_text?, footer_text?, buttons?, submit?): a NEW WhatsApp template. Meta rules: name is "
            "lowercase letters/digits/underscores; variables are {{1}}, {{2}}, ... in order; the body "
            "cannot start or end with a variable; one sample value per variable; body <= 1024 chars; "
            "category UTILITY (transactional: confirmations, reminders, credentials — default) or "
            "MARKETING (promotions; Meta rate-limits repeats to one number). It is submitted to Meta "
            "(status PENDING) unless submit=false; approval usually takes minutes to hours — the "
            "automation can be drafted now but the admin should publish after it is APPROVED.\n"
            "- sync_whatsapp_templates: pull the latest template statuses from Meta (use it to check "
            "whether a PENDING template got APPROVED, or to see templates made in Meta Business Manager).\n"
            "`workflow` follows workflows(catalog) → workflowJsonShape: {name, description, workflow_type "
            "EVENT_DRIVEN|SCHEDULED, trigger{trigger_event_name, event_applied_type, event_ids[], "
            "idempotency_generation_setting} | schedule{schedule_type CRON, cron_expression, timezone}, "
            "nodes[{id, name, node_type, config, is_start_node}], edges[{source_node_id, target_node_id, "
            "label?, condition?}]}. Wire the flow with edges (routing is derived from them): a CONDITION "
            "node's true branch is the edge carrying `condition`, its false branch the edge labelled "
            "'false'. Use only ids and template names returned by workflows(context). Obey every rule in "
            "catalog.generationRules; the same rules are linted here."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "action": {"type": "string", "enum": list(WORKFLOWS_EDIT_ACTIONS)},
                "workflow_id": {"type": "string", "description": "update_draft / discard_draft: the DRAFT automation's id."},
                "workflow": {
                    "type": "object",
                    "description": "validate / create_draft / update_draft: the workflow JSON (builder shape, see workflows(catalog)).",
                },
                "name": {"type": "string", "description": "create_*_template: the template name. Email: any unique name, e.g. 'welcome_new_learner'. WhatsApp: lowercase letters, digits, underscores."},
                "subject": {"type": "string", "description": "create_email_template: subject line; may contain {{placeholders}}."},
                "html": {"type": "string", "description": "create_email_template: the HTML body with {{placeholders}}, e.g. {{fullName}}."},
                "placeholder_labels": {
                    "type": "object", "additionalProperties": {"type": "string"},
                    "description": "create_email_template: optional human labels per placeholder, e.g. {\"fullName\": \"Learner name\"} (shown in the builder's mapping UI).",
                },
                "body": {"type": "string", "description": "create_whatsapp_template: the message body with {{1}}, {{2}}, ... variables."},
                "category": {"type": "string", "enum": list(WHATSAPP_CATEGORIES), "description": "create_whatsapp_template: UTILITY (default) or MARKETING."},
                "language": {"type": "string", "description": "create_whatsapp_template: Meta language code, default en."},
                "sample_values": {"type": "array", "items": {"type": "string"}, "description": "create_whatsapp_template: one realistic example per {{n}} variable, in order (Meta reviews with these)."},
                "variable_names": {"type": "array", "items": {"type": "string"}, "description": "create_whatsapp_template: optional semantic names per variable, e.g. ['name', 'class_time']."},
                "header_text": {"type": "string", "description": "create_whatsapp_template: optional short text header (no variables)."},
                "footer_text": {"type": "string", "description": "create_whatsapp_template: optional footer line."},
                "buttons": {
                    "type": "array",
                    "description": "create_whatsapp_template: optional buttons (max 3): {type: QUICK_REPLY|URL|PHONE_NUMBER, text, url?, phone_number?}.",
                    "items": {"type": "object", "properties": {
                        "type": {"type": "string", "enum": ["QUICK_REPLY", "URL", "PHONE_NUMBER"]},
                        "text": {"type": "string"}, "url": {"type": "string"}, "phone_number": {"type": "string"},
                    }, "required": ["type", "text"]},
                },
                "submit": {"type": "boolean", "description": "create_whatsapp_template: submit to Meta for approval right away (default true)."},
            },
            "required": ["action"],
        },
    },
}


def _err(code: str, **extra: Any) -> Dict[str, Any]:
    return {"error": code, **extra}


def _s(v: Any) -> str:
    return str(v).strip() if v is not None else ""


def _limit(args: Dict[str, Any], default: int, cap: int) -> int:
    try:
        return max(1, min(int(args.get("limit") or default), cap))
    except (TypeError, ValueError):
        return default


# ──────────────────────────────────────────────────────────────────────────
# Backend loaders
# ──────────────────────────────────────────────────────────────────────────

async def load_workflow(ctx: ToolContext, workflow_id: str) -> Optional[Dict[str, Any]]:
    """The builder JSON of one automation IF it belongs to the pinned institute, else None.

    ``/edit`` itself is not institute-scoped, so the ownership check lives here and
    every action that takes a workflow_id goes through it.
    """
    workflow_id = _s(workflow_id)
    if not workflow_id or "/" in workflow_id:
        return None
    data = await _admin_core_json(ctx, "GET", f"/admin-core-service/v1/workflow/{workflow_id}/edit")
    if not isinstance(data, dict) or data.get("error"):
        return None
    if _s(data.get("institute_id")) != _s(ctx.principal.institute_id):
        logger.warning("workflows: %s is not in institute %s — refused", workflow_id, ctx.principal.institute_id)
        return None
    return data


async def list_workflows(ctx: ToolContext, status: Optional[str], search: Optional[str], limit: int) -> Dict[str, Any]:
    body: Dict[str, Any] = {"institute_id": ctx.principal.institute_id}
    if status and status != "ALL":
        body["workflow_statuses"] = [status]
    if search:
        body["search_name"] = search
    data = await _admin_core_json(
        ctx, "POST", "/admin-core-service/v1/workflow/institute/workflows-with-schedules/list",
        params={"pageNo": 0, "pageSize": limit}, body=body,
    )
    if not isinstance(data, dict) or data.get("error"):
        return _err("fetch_failed", message="Could not load the automations right now.")
    rows = []
    for r in data.get("content") or []:
        if not isinstance(r, dict):
            continue
        entry: Dict[str, Any] = {
            "id": r.get("workflow_id"),
            "name": r.get("workflow_name"),
            "description": r.get("workflow_description"),
            "status": r.get("workflow_status"),
            "type": r.get("workflow_type"),
            "updated_at": r.get("workflow_updated_at"),
        }
        if r.get("trigger_event_name"):
            entry["trigger"] = {
                "event": r.get("trigger_event_name"),
                "applied_type": r.get("event_applied_type"),
                "event_id": r.get("event_id"),
                "status": r.get("trigger_status"),
            }
        if r.get("schedule_id"):
            entry["schedule"] = {
                "type": r.get("schedule_type"),
                "cron": r.get("cron_expression"),
                "interval_minutes": r.get("interval_minutes"),
                "timezone": r.get("timezone"),
                "status": r.get("schedule_status"),
                "last_run_at": r.get("last_run_at"),
                "next_run_at": r.get("next_run_at"),
            }
        rows.append(entry)
    return {"workflows": rows, "total": data.get("total_elements", len(rows)), "status_filter": status or "ALL"}


def _email_template_entry(t: Dict[str, Any]) -> Dict[str, Any]:
    params = t.get("dynamicParameters")
    if params is None:
        params = t.get("dynamic_parameters")
    if isinstance(params, str):
        try:
            params = json.loads(params)
        except ValueError:
            params = None
    return {
        "name": t.get("name"),
        "channel": "EMAIL",
        "status": t.get("status"),
        "subject": t.get("subject"),
        "placeholders": sorted(params.keys()) if isinstance(params, dict) else [],
    }


def _whatsapp_template_entry(t: Dict[str, Any]) -> Dict[str, Any]:
    body_text = _s(t.get("bodyText") or t.get("body_text"))
    names = t.get("bodyVariableNames") or t.get("body_variable_names") or []
    samples = t.get("bodySampleValues") or t.get("body_sample_values") or []
    placeholders = re.findall(r"\{\{\s*([^}]+?)\s*\}\}", body_text)
    if not placeholders:
        placeholders = [str(n) for n in names] if names else [str(i + 1) for i in range(len(samples))]
    return {
        "name": t.get("name"),
        "channel": "WHATSAPP",
        "status": t.get("status"),
        "language": t.get("language") or t.get("languageCode"),
        "placeholders": placeholders,
        "body": body_text[:240] or None,
    }


async def load_templates(ctx: ToolContext) -> Dict[str, Any]:
    """Email templates (admin-core, any status) and WhatsApp templates (notification-service).

    ``email_loaded`` / ``whatsapp_loaded`` say whether the list could be fetched at
    all, so a backend hiccup degrades a "template missing" ERROR to a warning
    instead of blocking every save.
    """
    inst = ctx.principal.institute_id
    email: List[Dict[str, Any]] = []
    seen = set()
    email_loaded = False
    # The dashboard queries both spellings of the type; templates exist under either.
    for t in ("EMAIL", "email"):
        rows = await _admin_core_json(ctx, "GET", f"/admin-core-service/institute/template/v1/institute/{inst}/type/{t}")
        if isinstance(rows, list):
            email_loaded = True
            for r in rows:
                if isinstance(r, dict) and r.get("name") and r.get("name") not in seen:
                    seen.add(r["name"])
                    email.append(_email_template_entry(r))
    rows = await _notification_json(ctx, "GET", "/notification-service/v1/whatsapp-templates/list", params={"instituteId": inst})
    whatsapp = [_whatsapp_template_entry(r) for r in (rows if isinstance(rows, list) else []) if isinstance(r, dict) and r.get("name")]
    return {"email": email, "whatsapp": whatsapp, "email_loaded": email_loaded, "whatsapp_loaded": isinstance(rows, list)}


async def _raw_call(ctx: ToolContext, base_url: str, method: str, path: str, *,
                    params: Optional[Dict[str, Any]] = None, body: Optional[Dict[str, Any]] = None,
                    timeout: float = 30.0) -> Tuple[int, Any]:
    """
    One JWT-authenticated call that keeps the status AND the body.

    The shared ``_service_json`` folds every non-200 into ``fetch_failed`` — fine
    for reads, but template creation answers 201, and the template services put
    the reason a template was refused (a Meta rule, a duplicate name) in a 4xx
    body the model needs to relay. Returns (status, parsed body | text | None);
    status 0 means the call itself failed.
    """
    import httpx
    if not ctx.bearer_token:
        return 0, {"message": "no_auth"}
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.request(method, f"{base_url}{path}", params=params, json=body, headers=_jwt_headers(ctx))
    except Exception as e:  # noqa: BLE001
        logger.warning("workflows %s %s failed: %s", method, path, e)
        return 0, {"message": str(e)[:200]}
    if resp.status_code >= 400:
        logger.warning("workflows %s %s -> %s (%s)", method, path, resp.status_code, resp.text[:200])
    try:
        return resp.status_code, resp.json() if resp.text.strip() else None
    except ValueError:
        return resp.status_code, resp.text.strip()


def _backend_reason(data: Any, fallback: str) -> Dict[str, Any]:
    """The message/hint a template service put in its error body, or the fallback."""
    if isinstance(data, dict):
        return {k: v for k, v in {
            "message": data.get("message") or data.get("ex") or fallback,
            "hint": data.get("hint"),
            "field": data.get("field"),
            "code": data.get("code"),
        }.items() if v}
    return {"message": fallback}


def _admin_core_base() -> str:
    from ..config import get_settings
    return get_settings().admin_core_service_base_url


def _notification_base() -> str:
    from ..config import get_settings
    return get_settings().notification_service_base_url


async def load_email_template(ctx: ToolContext, name: str) -> Optional[Dict[str, Any]]:
    """One email template of the pinned institute in full (raw TemplateResponse), or None."""
    inst = ctx.principal.institute_id
    for t in ("EMAIL", "email"):
        rows = await _admin_core_json(ctx, "GET", f"/admin-core-service/institute/template/v1/institute/{inst}/type/{t}")
        for r in rows if isinstance(rows, list) else []:
            if isinstance(r, dict) and _s(r.get("name")) == name:
                return r
    return None


async def load_whatsapp_template_rows(ctx: ToolContext) -> Optional[List[Dict[str, Any]]]:
    """Raw WhatsApp template rows (every status) or None when the list could not be fetched."""
    rows = await _notification_json(ctx, "GET", "/notification-service/v1/whatsapp-templates/list",
                                    params={"instituteId": ctx.principal.institute_id})
    if not isinstance(rows, list):
        return None
    return [r for r in rows if isinstance(r, dict) and r.get("name")]


def _whatsapp_template_full(t: Dict[str, Any]) -> Dict[str, Any]:
    entry = _whatsapp_template_entry(t)
    entry.pop("body", None)
    out = {k: v for k, v in {
        **entry,
        "id": t.get("id"),
        "category": t.get("category"),
        "body": t.get("bodyText"),
        "header_type": t.get("headerType"),
        "header_text": t.get("headerText"),
        "footer_text": t.get("footerText"),
        "buttons": t.get("buttons"),
        "sample_values": t.get("bodySampleValues"),
        "variable_names": t.get("bodyVariableNames"),
        "rejection_reason": t.get("rejectionReason"),
        "submitted_at": t.get("submittedAt"),
        "approved_at": t.get("approvedAt"),
    }.items() if v not in (None, "", [], {})}
    out["usable"] = _s(t.get("status")).upper() == "APPROVED"
    return out


def _email_template_full(t: Dict[str, Any]) -> Dict[str, Any]:
    entry = _email_template_entry(t)
    content = _s(t.get("content"))
    if not entry.get("placeholders"):
        # Templates made outside the wizard often have empty dynamic_parameters;
        # the body still tells us what a send node has to supply.
        entry["placeholders"] = email_placeholders(_s(t.get("subject")), content)
    out = {k: v for k, v in {
        **entry,
        "id": t.get("id"),
        "content_type": t.get("contentType"),
        "html": content[:_EMAIL_HTML_MAX] + ("…" if len(content) > _EMAIL_HTML_MAX else ""),
        "category": t.get("templateCategory"),
    }.items() if v not in (None, "", [], {})}
    out["usable"] = _s(t.get("status")).upper() in ("ACTIVE", "")
    return out


def _humanize(key: str) -> str:
    """camelCase / snake_case placeholder → 'Camel Case' label (what the wizard does)."""
    label = re.sub(r"[_-]+", " ", key)
    label = re.sub(r"([a-z])([A-Z])", r"\1 \2", label)
    return " ".join(w[:1].upper() + w[1:] for w in label.split())


def email_placeholders(*texts: str) -> List[str]:
    """Distinct {{placeholders}} in order of first appearance across subject + body."""
    seen: List[str] = []
    for text in texts:
        for m in _EMAIL_PLACEHOLDER_RE.finditer(text or ""):
            key = m.group(1).strip()
            if key and key not in seen:
                seen.append(key)
    return seen


def whatsapp_body_problems(name: str, body: str, category: str, samples: List[str],
                           header_text: str, footer_text: str, buttons: List[Dict[str, Any]]) -> List[str]:
    """Meta's content rules (the ones notification-service enforces at submit), checked up front."""
    problems: List[str] = []
    if not WHATSAPP_NAME_RE.match(name or ""):
        problems.append("name must be lowercase letters, digits and underscores only (e.g. 'class_reminder_v1').")
    if category not in WHATSAPP_CATEGORIES:
        problems.append("category must be UTILITY or MARKETING (AUTHENTICATION is reserved for Meta-written OTP templates).")
    body = body or ""
    if not body.strip():
        problems.append("body is required.")
    else:
        if len(body) > WHATSAPP_BODY_MAX:
            problems.append(f"body is {len(body)} characters; Meta allows at most {WHATSAPP_BODY_MAX}.")
        indexes = [int(m.group(1)) for m in _WA_PLACEHOLDER_RE.finditer(body)]
        if indexes:
            expected = list(range(1, max(indexes) + 1))
            if sorted(set(indexes)) != expected:
                problems.append(f"body variables must be {{{{1}}}}, {{{{2}}}}, ... with no gaps (found {sorted(set(indexes))}).")
            stripped = body.strip()
            if _WA_PLACEHOLDER_RE.match(stripped):
                problems.append("body cannot start with a variable — put some words before it.")
            if re.search(r"\{\{\s*\d+\s*\}\}\s*$", stripped):
                problems.append("body cannot end with a variable — add a word or punctuation after it.")
            count = max(indexes)
            if len(samples) < count or any(not _s(x) for x in samples[:count]):
                problems.append(f"body has {count} variable(s); give one non-empty sample_values entry per variable, in order.")
        if re.search(r"\{\{\s*[A-Za-z]", body):
            problems.append("WhatsApp variables are positional ({{1}}, {{2}}); named placeholders like {{name}} are not allowed — put the meaning in variable_names.")
    if header_text and _WA_PLACEHOLDER_RE.search(header_text):
        problems.append("header_text cannot contain variables here — keep it plain text.")
    if len(header_text or "") > 60:
        problems.append("header_text must be at most 60 characters.")
    if len(footer_text or "") > 60:
        problems.append("footer_text must be at most 60 characters.")
    if len(buttons) > 3:
        problems.append("at most 3 buttons.")
    for b in buttons:
        btype = _s(b.get("type")).upper()
        if btype not in ("QUICK_REPLY", "URL", "PHONE_NUMBER"):
            problems.append(f"button type '{btype}' is not supported (QUICK_REPLY, URL, PHONE_NUMBER).")
        if not _s(b.get("text")):
            problems.append("every button needs text.")
        if btype == "URL" and not _s(b.get("url")).startswith("http"):
            problems.append("a URL button needs an absolute http(s) url.")
        if btype == "PHONE_NUMBER" and not _s(b.get("phone_number") or b.get("phoneNumber")):
            problems.append("a PHONE_NUMBER button needs phone_number.")
    return problems


_BATCHES_SQL = """
SELECT ps.id,
       TRIM(CONCAT(l.level_name, ' ', p.package_name, ' (', s.session_name, ')')) AS batch_name,
       ps.status,
       (SELECT COUNT(*) FROM student_session_institute_group_mapping ssigm
         WHERE ssigm.package_session_id = ps.id
           AND ssigm.institute_id = :inst AND ssigm.status = 'ACTIVE') AS enrolled
FROM package_session ps
JOIN package_institute pi ON ps.package_id = pi.package_id
JOIN package p ON ps.package_id = p.id
JOIN level l ON ps.level_id = l.id
JOIN session s ON ps.session_id = s.id
WHERE pi.institute_id = :inst
  AND ps.status NOT IN ('DELETED')
  AND LOWER(CONCAT(l.level_name, ' ', p.package_name, ' ', s.session_name)) LIKE :q
ORDER BY enrolled DESC
LIMIT :lim
"""


def load_batches(ctx: ToolContext, search: str = "", limit: int = _MAX_CONTEXT_ITEMS) -> List[Dict[str, Any]]:
    """Institute batches (package sessions) from the shared DB, busiest first."""
    from sqlalchemy import text as sql_text
    try:
        rows = ctx.db.execute(
            sql_text(_BATCHES_SQL),
            {"inst": ctx.principal.institute_id, "q": f"%{search.lower()}%", "lim": limit},
        ).fetchall()
    except Exception as e:  # noqa: BLE001
        logger.warning("workflows: batch lookup failed: %s", e)
        return []
    return [{"package_session_id": r[0], "name": r[1], "status": r[2], "enrolled": int(r[3] or 0)} for r in rows]


async def load_audiences(ctx: ToolContext) -> List[Dict[str, Any]]:
    from .website_data import load_campaigns
    rows = await load_campaigns(ctx, status="ACTIVE", with_counts=False)
    return [{"audience_id": c.get("id"), "name": c.get("name"), "type": c.get("type"), "objective": c.get("objective")} for c in rows]


async def load_live_sessions(ctx: ToolContext) -> List[Dict[str, Any]]:
    data = await _admin_core_json(ctx, "GET", "/admin-core-service/get-sessions/live",
                                  params={"instituteId": ctx.principal.institute_id})
    out: List[Dict[str, Any]] = []
    items = data if isinstance(data, list) else []
    for item in items:
        if not isinstance(item, dict):
            continue
        group = item.get("sessions") if isinstance(item.get("sessions"), list) else [item]
        for s in group:
            if not isinstance(s, dict):
                continue
            sid = s.get("sessionId") or s.get("session_id") or s.get("id")
            if sid:
                out.append({"live_session_id": sid, "title": s.get("title"), "subject": s.get("subject")})
    return out


async def load_invites(ctx: ToolContext) -> List[Dict[str, Any]]:
    data = await _admin_core_json(
        ctx, "POST", "/admin-core-service/learner-invitation/invitation-details",
        body={"institute_id": ctx.principal.institute_id, "page_no": 0, "page_size": 100},
    )
    rows = data.get("content") if isinstance(data, dict) else (data if isinstance(data, list) else [])
    out = []
    for r in rows or []:
        if isinstance(r, dict) and r.get("id"):
            out.append({"enroll_invite_id": r.get("id"), "name": r.get("name"),
                        "code": r.get("inviteCode") or r.get("invite_code"), "status": r.get("status")})
    return out


def editor_url(ctx: ToolContext, workflow_id: str) -> str:
    """The builder page for this automation on the institute's own admin portal."""
    from ..config import get_settings
    from ..mcp.institute_scope import admin_portal_base
    base = admin_portal_base(ctx.db, ctx.principal.institute_id, get_settings().admin_dashboard_url)
    return f"{base.rstrip('/')}/workflow/{workflow_id}/edit"


# ──────────────────────────────────────────────────────────────────────────
# Normalisation — what the model sent → what WorkflowBuilderService persists
# ──────────────────────────────────────────────────────────────────────────

def _pick(d: Dict[str, Any], *keys: str) -> Any:
    for k in keys:
        if k in d and d[k] is not None:
            return d[k]
    return None


def _as_dict(v: Any) -> Optional[Dict[str, Any]]:
    if isinstance(v, dict):
        return v
    if isinstance(v, str) and v.strip().startswith("{"):
        try:
            parsed = json.loads(v)
            return parsed if isinstance(parsed, dict) else None
        except ValueError:
            return None
    return None


def _routing_to_edges(node_id: str, routing: Any, edges: List[Dict[str, Any]], warnings: List[Dict[str, Any]]) -> None:
    """Express a node's config.routing[] as edges (the shape the builder derives routing from)."""
    if not isinstance(routing, list):
        return
    for route in routing:
        if not isinstance(route, dict):
            continue
        rtype = _s(route.get("type")).lower()
        if rtype in ("goto", "branch_true"):
            if route.get("targetNodeId"):
                edges.append({"source_node_id": node_id, "target_node_id": _s(route["targetNodeId"]),
                              "label": "true" if rtype == "branch_true" else None,
                              "condition": _s(route.get("condition")) or None})
        elif rtype == "branch_false":
            if route.get("targetNodeId"):
                edges.append({"source_node_id": node_id, "target_node_id": _s(route["targetNodeId"]), "label": "false"})
        elif rtype == "conditional":
            if route.get("trueNodeId"):
                edges.append({"source_node_id": node_id, "target_node_id": _s(route["trueNodeId"]),
                              "label": _s(route.get("label")) or "true", "condition": _s(route.get("condition")) or None})
            if route.get("falseNodeId"):
                edges.append({"source_node_id": node_id, "target_node_id": _s(route["falseNodeId"]), "label": "false"})
        elif rtype == "end":
            continue
        else:
            warnings.append({"node_id": node_id, "field": "config.routing",
                             "message": f"routing type '{rtype or '?'}' cannot be expressed through this tool and was dropped — wire the flow with edges."})


def normalize_workflow(
    raw: Any, *, institute_id: str, workflow_id: Optional[str] = None
) -> Tuple[Optional[Dict[str, Any]], List[Dict[str, Any]], List[Dict[str, Any]]]:
    """
    Coerce the model's workflow JSON into the builder DTO, forcing what the model
    may not decide (id, institute, status). Returns (dto, errors, warnings); dto is
    None when the payload is unusable.

    Accepts the drafter contract (``{"workflow": {...}}``), the builder shape
    (flat ``node_type``) and the canvas shape (``data.nodeType``), camelCase or
    snake_case — a model round-trip that fails only on spelling is a wasted turn.
    """
    errors: List[Dict[str, Any]] = []
    warnings: List[Dict[str, Any]] = []
    wf = _as_dict(raw)
    if wf is None:
        return None, [{"field": "workflow", "message": "workflow must be a JSON object", "severity": "ERROR"}], warnings
    if "nodes" not in wf and isinstance(wf.get("workflow"), dict):
        wf = wf["workflow"]

    # ---- nodes ---------------------------------------------------------------
    nodes: List[Dict[str, Any]] = []
    raw_nodes = wf.get("nodes")
    if not isinstance(raw_nodes, list) or not raw_nodes:
        errors.append({"field": "nodes", "message": "Workflow must have at least one node", "severity": "ERROR"})
        raw_nodes = []
    for i, n in enumerate(raw_nodes):
        n = _as_dict(n) or {}
        data = _as_dict(n.get("data")) or {}
        node_id = _s(_pick(n, "id") or _pick(data, "id"))
        if not node_id:
            errors.append({"field": f"nodes[{i}].id", "message": "Every node needs an id (edges reference it)", "severity": "ERROR"})
            node_id = f"node-{i}"
        node_type = _s(_pick(n, "node_type", "nodeType", "type") or _pick(data, "nodeType", "node_type", "type")).upper()
        config = _as_dict(_pick(n, "config") if n.get("config") is not None else _pick(data, "config")) or {}
        nodes.append({
            "id": node_id,
            "name": _s(_pick(n, "name", "label") or _pick(data, "label", "name")) or node_type.title(),
            "node_type": node_type,
            "config": dict(config),
            "position_x": _pick(n, "position_x", "positionX") or (_as_dict(n.get("position")) or {}).get("x") or 250,
            "position_y": _pick(n, "position_y", "positionY") or (_as_dict(n.get("position")) or {}).get("y") or 80 + 120 * i,
            "is_start_node": bool(_pick(n, "is_start_node", "isStartNode") or _pick(data, "isStartNode", "is_start_node")),
        })
    dupes = [n["id"] for n in nodes if sum(1 for m in nodes if m["id"] == n["id"]) > 1]
    if dupes:
        errors.append({"field": "nodes", "message": f"Duplicate node ids: {sorted(set(dupes))}", "severity": "ERROR"})

    # ---- edges (routing in config is folded into them, then dropped) ----------
    edges: List[Dict[str, Any]] = []
    for e in wf.get("edges") if isinstance(wf.get("edges"), list) else []:
        e = _as_dict(e) or {}
        src = _s(_pick(e, "source_node_id", "sourceNodeId", "source"))
        tgt = _s(_pick(e, "target_node_id", "targetNodeId", "target"))
        if not src or not tgt:
            errors.append({"field": "edges", "message": "Every edge needs source_node_id and target_node_id", "severity": "ERROR"})
            continue
        edges.append({"source_node_id": src, "target_node_id": tgt,
                      "label": _s(_pick(e, "label")) or None, "condition": _s(_pick(e, "condition")) or None})
    with_outgoing = {e["source_node_id"] for e in edges}
    for n in nodes:
        routing = n["config"].pop("routing", None)
        n["config"].pop("__preservedRouting", None)
        if n["id"] not in with_outgoing:
            _routing_to_edges(n["id"], routing, edges, warnings)

    # A CONDITION node's true branch must carry the predicate on its edge — that is
    # what applyEdgesAsRouting turns into a conditional route; without it the engine
    # fans out to BOTH branches (the dashboard does this same propagation on save).
    for n in nodes:
        if n["node_type"] != "CONDITION":
            continue
        out = [e for e in edges if e["source_node_id"] == n["id"]]
        cond = _s(n["config"].get("condition"))
        if not any(e.get("condition") for e in out):
            true_edges = [e for e in out if _s(e.get("label")).lower() != "false"]
            if cond and true_edges:
                true_edges[0]["condition"] = cond
                true_edges[0]["label"] = true_edges[0].get("label") or "true"
                if len(true_edges) == 2 and not _s(true_edges[1].get("label")):
                    true_edges[1]["label"] = "false"
            # No condition anywhere: lint_workflow reports the missing config.condition.
        for e in out:
            if e.get("condition") and not cond:
                n["config"]["condition"] = e["condition"]
                break

    for e in edges:
        e["id"] = str(uuid.uuid4())
        if not e.get("label"):
            e.pop("label", None)
        if not e.get("condition"):
            e.pop("condition", None)

    # ---- start / end flags -----------------------------------------------------
    if nodes and not any(n["is_start_node"] for n in nodes):
        start = next((n for n in nodes if n["node_type"] == "TRIGGER"), nodes[0])
        start["is_start_node"] = True
    with_outgoing = {e["source_node_id"] for e in edges}
    for n in nodes:
        n["is_end_node"] = n["id"] not in with_outgoing

    # ---- trigger / schedule / type --------------------------------------------
    trigger_in = _as_dict(wf.get("trigger"))
    schedule_in = _as_dict(wf.get("schedule"))
    trigger_node_cfg = next((n["config"] for n in nodes if n["node_type"] == "TRIGGER"), None)
    node_event = _s((trigger_node_cfg or {}).get("triggerEvent"))

    trigger: Optional[Dict[str, Any]] = None
    if trigger_in is not None:
        event_ids = _pick(trigger_in, "event_ids", "eventIds")
        if isinstance(event_ids, str):
            event_ids = [x.strip() for x in event_ids.split(",") if x.strip()]
        single = _s(_pick(trigger_in, "event_id", "eventId"))
        if not event_ids and single:
            event_ids = [single]
        idem = _pick(trigger_in, "idempotency_generation_setting", "idempotencyGenerationSetting")
        trigger = {
            "trigger_event_name": _s(_pick(trigger_in, "trigger_event_name", "triggerEventName", "event_name", "eventName")).upper() or None,
            "description": _s(_pick(trigger_in, "description")) or None,
            "event_applied_type": _s(_pick(trigger_in, "event_applied_type", "eventAppliedType")).upper() or None,
            "event_ids": [_s(x) for x in event_ids if _s(x)] if isinstance(event_ids, list) else None,
            "idempotency_generation_setting": _as_dict(idem) if idem is not None else None,
        }
    schedule: Optional[Dict[str, Any]] = None
    if schedule_in is not None:
        cron = _s(_pick(schedule_in, "cron_expression", "cronExpression"))
        interval = _pick(schedule_in, "interval_minutes", "intervalMinutes")
        schedule = {
            "schedule_type": _s(_pick(schedule_in, "schedule_type", "scheduleType")).upper() or ("INTERVAL" if interval and not cron else "CRON"),
            "cron_expression": cron or None,
            "interval_minutes": int(interval) if isinstance(interval, (int, float)) or (isinstance(interval, str) and interval.isdigit()) else None,
            "timezone": _s(_pick(schedule_in, "timezone")) or "Asia/Kolkata",
            "start_date": _s(_pick(schedule_in, "start_date", "startDate")) or None,
            "end_date": _s(_pick(schedule_in, "end_date", "endDate")) or None,
        }

    workflow_type = _s(_pick(wf, "workflow_type", "workflowType")).upper()
    if not workflow_type:
        if schedule:
            workflow_type = "SCHEDULED"
        elif trigger or (node_event and node_event != "SCHEDULED"):
            workflow_type = "EVENT_DRIVEN"
    if workflow_type not in ("SCHEDULED", "EVENT_DRIVEN"):
        errors.append({"field": "workflow_type", "message": "workflow_type must be EVENT_DRIVEN (with trigger) or SCHEDULED (with schedule)", "severity": "ERROR"})

    if workflow_type == "EVENT_DRIVEN":
        schedule = None
        # Backfill the trigger from the TRIGGER node, as the drafter does.
        if (trigger is None or not trigger.get("trigger_event_name")) and node_event and node_event != "SCHEDULED":
            trigger = {**(trigger or {}), "trigger_event_name": node_event.upper()}
        if trigger and trigger.get("trigger_event_name") and trigger_node_cfg is not None and not node_event:
            trigger_node_cfg["triggerEvent"] = trigger["trigger_event_name"]
    elif workflow_type == "SCHEDULED":
        trigger = None
        if trigger_node_cfg is not None and not node_event:
            trigger_node_cfg["triggerEvent"] = "SCHEDULED"

    dto: Dict[str, Any] = {
        "id": workflow_id,                      # None on create; the DRAFT's id on update
        "name": _s(wf.get("name")),
        "description": _s(wf.get("description")) or None,
        "status": "DRAFT",                       # forced: nothing authored here can go live
        "workflow_type": workflow_type or None,
        "institute_id": institute_id,            # forced: never the model's
        "nodes": nodes,
        "edges": edges,
        "trigger": {k: v for k, v in trigger.items() if v is not None} if trigger else None,
        "schedule": {k: v for k, v in schedule.items() if v is not None} if schedule else None,
    }
    return dto, errors, warnings


# ──────────────────────────────────────────────────────────────────────────
# Lint — the audited failure modes the backend validator does not catch
# ──────────────────────────────────────────────────────────────────────────

def _is_spel(v: Any) -> bool:
    return isinstance(v, str) and v.strip().startswith(("#", "T(", "{"))


def _literal_ids(v: Any) -> List[str]:
    """Literal entity ids in a param value (CSV string or list); SpEL yields none."""
    if isinstance(v, list):
        return [_s(x) for x in v if _s(x) and not _is_spel(x)]
    if isinstance(v, str) and not _is_spel(v):
        return [x.strip() for x in v.split(",") if x.strip()]
    return []


def lint_workflow(dto: Dict[str, Any]) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """Static checks on the normalised DTO. Pure — no backend calls."""
    errors: List[Dict[str, Any]] = []
    warnings: List[Dict[str, Any]] = []
    nodes = dto.get("nodes") or []
    edges = dto.get("edges") or []
    ids = {n["id"] for n in nodes}

    for n in nodes:
        t = n["node_type"]
        cfg = n.get("config") or {}
        if t not in NODE_TYPES:
            errors.append({"node_id": n["id"], "field": "node_type", "message": f"Unknown node type '{t}'", "severity": "ERROR"})
            continue
        if t in DEAD_NODE_TYPES:
            errors.append({"node_id": n["id"], "field": "node_type", "message": f"{t} {DEAD_NODE_TYPES[t]}", "severity": "ERROR"})
        if t in UNSAFE_IN_DRY_RUN:
            warnings.append({"node_id": n["id"], "field": "node_type",
                             "message": f"{t} acts for real even in the dashboard's Test Run — tell the admin."})
        if t == "QUERY":
            key = _s(cfg.get("prebuiltKey"))
            if not key:
                errors.append({"node_id": n["id"], "field": "config.prebuiltKey", "message": "QUERY node needs a prebuiltKey", "severity": "ERROR"})
            elif key in MUTATING_QUERY_KEYS:
                warnings.append({"node_id": n["id"], "field": "config.prebuiltKey",
                                 "message": f"'{key}' WRITES data when the automation is active (skipped only in Test Run) — the admin must know."})
            if cfg.get("resultKey"):
                warnings.append({"node_id": n["id"], "field": "config.resultKey",
                                 "message": "QUERY resultKey is ignored by the engine — downstream nodes must read the query's real output keys."})
        if t in ("SEND_EMAIL", "SEND_WHATSAPP", "COMBOT"):
            on = _s(cfg.get("on"))
            if not on:
                errors.append({"node_id": n["id"], "field": "config.on", "message": f"{t} needs `on`, a SpEL expression that yields a List of recipients", "severity": "ERROR"})
            elif not on.startswith(("#", "{", "T(")):
                errors.append({"node_id": n["id"], "field": "config.on", "message": "`on` must be SpEL, e.g. \"#ctx['students']\" or \"{#ctx['user']}\" for one person", "severity": "ERROR"})
            if t != "COMBOT" and not _s(cfg.get("templateName")):
                warnings.append({"node_id": n["id"], "field": "config.templateName",
                                 "message": "No templateName — only sends whose items already carry subject/body (e.g. respondentEmailRequests) will work."})
        if t == "DELAY":
            delay = cfg.get("delay")
            if not isinstance(delay, dict):
                errors.append({"node_id": n["id"], "field": "config.delay",
                               "message": "DELAY config must be nested: delay.{value,unit} or delay.{until:NEXT_DAY_OF_WEEK,dayOfWeek,time,timezone} (flat delayValue/delayUnit runs as a 0-delay)",
                               "severity": "ERROR"})
        if t == "CONDITION" and not _s(cfg.get("condition")):
            errors.append({"node_id": n["id"], "field": "config.condition", "message": "CONDITION node needs a SpEL condition", "severity": "ERROR"})

    # Reachability from the start node; every path ends (no unresolved targets).
    start = next((n["id"] for n in nodes if n.get("is_start_node")), None)
    if start:
        adj: Dict[str, List[str]] = {}
        for e in edges:
            adj.setdefault(e["source_node_id"], []).append(e["target_node_id"])
        seen, stack = set(), [start]
        while stack:
            cur = stack.pop()
            if cur in seen:
                continue
            seen.add(cur)
            stack.extend(adj.get(cur, []))
        for n in nodes:
            if n["id"] not in seen:
                errors.append({"node_id": n["id"], "field": "connections", "message": f"Node '{n['name']}' is not reachable from the start node", "severity": "ERROR"})
    for e in edges:
        if e["target_node_id"] not in ids or e["source_node_id"] not in ids:
            errors.append({"field": "edges", "message": f"Edge {e['source_node_id']} → {e['target_node_id']} references a node that does not exist", "severity": "ERROR"})

    trig = dto.get("trigger") or {}
    ev = _s(trig.get("trigger_event_name"))
    if dto.get("workflow_type") == "EVENT_DRIVEN":
        if ev == "INVITE_FORM_FILL":
            warnings.append({"field": "trigger", "message": "INVITE_FORM_FILL fires when the invite page is VIEWED, not on submit — every page view runs this automation."})
        if ev in ("LIVE_SESSION_START", "LIVE_SESSION_END"):
            warnings.append({"field": "trigger", "message": f"{ev} comes from a 5-minute scan, so it fires a few minutes after the fact."})
        if not trig.get("idempotency_generation_setting"):
            warnings.append({"field": "trigger.idempotency_generation_setting",
                             "message": "No idempotency setting: a retried event fires this automation twice. Per-person flows need CUSTOM_EXPRESSION including the person's id; periodic-scan events (LIVE_SESSION_*, MEMBERSHIP_EXPIRY) need EVENT_BASED."})
    sched = dto.get("schedule") or {}
    if dto.get("workflow_type") == "SCHEDULED":
        cron = _s(sched.get("cron_expression"))
        if sched.get("schedule_type") == "CRON" and cron and not 5 <= len(cron.split()) <= 7:
            errors.append({"field": "schedule.cron_expression", "message": f"'{cron}' is not a cron expression (expected Quartz 6 fields, e.g. '0 0 9 * * ?')", "severity": "ERROR"})
        if sched.get("schedule_type") == "INTERVAL":
            warnings.append({"field": "schedule", "message": "INTERVAL schedules degrade to an every-minute cron in the dispatcher — prefer a CRON expression."})
    return errors, warnings


def _template_check(dto: Dict[str, Any], templates: Dict[str, Any],
                    errors: List[Dict[str, Any]], warnings: List[Dict[str, Any]]) -> None:
    """templateName must be a real institute template of the right channel (L10)."""
    email = {t["name"]: t for t in templates.get("email") or []}
    whatsapp = {t["name"]: t for t in templates.get("whatsapp") or []}
    for n in dto.get("nodes") or []:
        name = _s((n.get("config") or {}).get("templateName"))
        if not name or _is_spel(name):
            continue
        if n["node_type"] == "SEND_EMAIL":
            t = email.get(name)
            if t is None and not templates.get("email_loaded", True):
                warnings.append({"node_id": n["id"], "field": "config.templateName",
                                 "message": f"Could not load the institute's email templates to confirm '{name}' exists — check it in the builder."})
            elif t is None:
                errors.append({"node_id": n["id"], "field": "config.templateName",
                               "message": f"Email template '{name}' does not exist for this institute — use a name from workflows(context, kind='templates') or ask the admin to create it.",
                               "severity": "ERROR"})
            elif _s(t.get("status")).upper() not in ("ACTIVE", ""):
                warnings.append({"node_id": n["id"], "field": "config.templateName", "message": f"Email template '{name}' is {t.get('status')}, not ACTIVE."})
        elif n["node_type"] in ("SEND_WHATSAPP", "COMBOT"):
            t = whatsapp.get(name)
            if t is None:
                warnings.append({"node_id": n["id"], "field": "config.templateName",
                                 "message": f"WhatsApp template '{name}' was not found in this institute's templates — confirm it is an APPROVED Meta template before publishing."})
            elif _s(t.get("status")).upper() != "APPROVED":
                warnings.append({"node_id": n["id"], "field": "config.templateName", "message": f"WhatsApp template '{name}' is {t.get('status')}, not APPROVED — Meta will reject sends."})


async def _entity_check(ctx: ToolContext, dto: Dict[str, Any],
                        errors: List[Dict[str, Any]], warnings: List[Dict[str, Any]]) -> None:
    """Every literal entity id must belong to the pinned institute (L11)."""
    from .website_data import get_campaign

    async def owned(kind: str, entity_id: str) -> Optional[bool]:
        # Exact lookups where one exists; list membership (capped) otherwise → None = unsure.
        if kind == "batches":
            return _batch_name_in_institute(ctx, entity_id) is not None
        if kind == "audiences":
            return (await get_campaign(ctx, entity_id)) is not None
        rows = await load_live_sessions(ctx) if kind == "live_sessions" else await load_invites(ctx)
        key = "live_session_id" if kind == "live_sessions" else "enroll_invite_id"
        return True if any(_s(r.get(key)) == entity_id for r in rows) else None

    trig = dto.get("trigger") or {}
    kind = APPLIED_TYPE_KIND.get(_s(trig.get("event_applied_type")))
    for eid in trig.get("event_ids") or []:
        if kind is None:
            continue
        ok = await owned(kind, eid)
        if ok is False:
            errors.append({"field": "trigger.event_ids", "message": f"'{eid}' is not a {kind[:-1].replace('_', ' ')} of this institute — take ids from workflows(context).", "severity": "ERROR"})
        elif ok is None:
            warnings.append({"field": "trigger.event_ids", "message": f"Could not confirm '{eid}' belongs to this institute — check it in the builder."})

    param_kinds = {"batchId": "batches", "packageSessionIds": "batches", "packageSessionId": "batches", "audienceId": "audiences"}
    for n in dto.get("nodes") or []:
        if n["node_type"] != "QUERY":
            continue
        params = (n.get("config") or {}).get("params") or {}
        if not isinstance(params, dict):
            continue
        for pname, pkind in param_kinds.items():
            for eid in _literal_ids(params.get(pname)):
                if await owned(pkind, eid) is False:
                    errors.append({"node_id": n["id"], "field": f"config.params.{pname}",
                                   "message": f"'{eid}' is not a {pkind[:-1].replace('_', ' ')} of this institute — take ids from workflows(context).",
                                   "severity": "ERROR"})


def _server_errors(raw: Any) -> List[Dict[str, Any]]:
    out = []
    for e in raw if isinstance(raw, list) else []:
        if isinstance(e, dict):
            out.append({k: v for k, v in {
                "node_id": e.get("nodeId") or e.get("node_id"),
                "field": e.get("field"),
                "message": e.get("message"),
                "severity": _s(e.get("severity")).upper() or "ERROR",
            }.items() if v})
    return out


def step_summary(dto: Dict[str, Any]) -> str:
    """'TRIGGER → QUERY → SEND_EMAIL' following goto edges from the start (branches in brackets)."""
    nodes = {n["id"]: n for n in dto.get("nodes") or []}
    adj: Dict[str, List[str]] = {}
    for e in dto.get("edges") or []:
        adj.setdefault(e["source_node_id"], []).append(e["target_node_id"])
    start = next((n["id"] for n in (dto.get("nodes") or []) if n.get("is_start_node")), None)
    parts: List[str] = []
    seen = set()
    cur = start
    while cur and cur not in seen and cur in nodes:
        seen.add(cur)
        parts.append(nodes[cur]["node_type"])
        nxt = adj.get(cur) or []
        if len(nxt) > 1:
            parts.append("[" + " | ".join(nodes[x]["node_type"] for x in nxt if x in nodes) + "]")
            break
        cur = nxt[0] if nxt else None
    return " → ".join(parts)


async def check_workflow(ctx: ToolContext, raw: Any, *, workflow_id: Optional[str] = None) -> Dict[str, Any]:
    """normalise → lint → templates → entity ownership → backend /validate. The one path every write shares."""
    dto, errors, warnings = normalize_workflow(raw, institute_id=ctx.principal.institute_id, workflow_id=workflow_id)
    if dto is None:
        return {"ok": False, "errors": errors, "warnings": warnings, "dto": None}
    lint_errors, lint_warnings = lint_workflow(dto)
    errors += lint_errors
    warnings += lint_warnings
    _template_check(dto, await load_templates(ctx), errors, warnings)
    await _entity_check(ctx, dto, errors, warnings)
    server = await _admin_core_json(ctx, "POST", "/admin-core-service/v1/workflow/validate", body=dto, timeout=30.0)
    if isinstance(server, dict) and server.get("error"):
        errors.append({"field": "workflow", "message": "The backend validator could not be reached — try again.", "severity": "ERROR"})
    else:
        for e in _server_errors(server):
            (errors if e.get("severity") == "ERROR" else warnings).append(e)
    # De-duplicate messages the lint and the validator both raise.
    def dedupe(items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        out, seen = [], set()
        for it in items:
            key = (it.get("node_id"), it.get("field"), it.get("message"))
            if key not in seen:
                seen.add(key)
                out.append(it)
        return out
    errors, warnings = dedupe(errors), dedupe(warnings)
    return {"ok": not errors, "errors": errors, "warnings": warnings, "dto": dto}


def _saved(ctx: ToolContext, dto: Dict[str, Any], workflow_id: str, warnings: List[Dict[str, Any]], created: bool) -> Dict[str, Any]:
    return {
        "workflow": {"id": workflow_id, "name": dto.get("name"), "status": "DRAFT", "type": dto.get("workflow_type"),
                     "steps": step_summary(dto), "node_count": len(dto.get("nodes") or [])},
        "created": created,
        "warnings": warnings,
        "editor_url": editor_url(ctx, workflow_id),
        "next": ("Saved as a DRAFT — it will not run until the admin opens editor_url, reviews every node "
                 "and presses Publish. Relay the warnings. To change it, call update_draft with the full workflow again."),
    }


# ──────────────────────────────────────────────────────────────────────────
# workflows — READ actions
# ──────────────────────────────────────────────────────────────────────────

async def _action_list(args: Dict[str, Any], ctx: ToolContext) -> Dict[str, Any]:
    status = _s(args.get("status")).upper() or "ALL"
    if status not in ("ALL", "ACTIVE", "DRAFT", "INACTIVE"):
        return _err("bad_request", message="status must be ACTIVE, DRAFT, INACTIVE or ALL")
    return await list_workflows(ctx, status, _s(args.get("search")) or None, _limit(args, 20, _MAX_LIST))


async def _action_get(args: Dict[str, Any], ctx: ToolContext) -> Dict[str, Any]:
    workflow_id = _s(args.get("workflow_id"))
    if not workflow_id:
        return _err("missing_argument", needs=["workflow_id"])
    wf = await load_workflow(ctx, workflow_id)
    if wf is None:
        return _err("unknown_workflow", message="No such automation for this institute.")
    nodes = []
    for n in wf.get("nodes") or []:
        if isinstance(n, dict):
            cfg = _as_dict(n.get("config")) or {}
            cfg.pop("routing", None)
            nodes.append({"id": n.get("id"), "name": n.get("name"), "node_type": n.get("node_type"),
                          "is_start_node": n.get("is_start_node"), "config": _compact(cfg, max_items=40, max_str=500)})
    edges = [{k: e.get(k) for k in ("source_node_id", "target_node_id", "label", "condition") if e.get(k)}
             for e in wf.get("edges") or [] if isinstance(e, dict)]
    shaped = {"nodes": [{**n, "is_start_node": bool(n.get("is_start_node"))} for n in nodes], "edges": edges}
    return {
        "workflow": {k: wf.get(k) for k in ("id", "name", "description", "status", "workflow_type")},
        "trigger": wf.get("trigger"),
        "schedule": wf.get("schedule"),
        "steps": step_summary(shaped),
        "nodes": nodes,
        "edges": edges,
        "editor_url": editor_url(ctx, workflow_id),
        "note": ("This is the builder JSON: send it back (edited) to workflows_edit(update_draft) if the "
                 "automation is a DRAFT. Published automations are edited in the dashboard."),
    }


async def _action_runs(args: Dict[str, Any], ctx: ToolContext) -> Dict[str, Any]:
    execution_id = _s(args.get("execution_id"))
    if execution_id:
        return await _run_log(ctx, execution_id)
    body: Dict[str, Any] = {"institute_id": ctx.principal.institute_id}  # newest first by default
    workflow_id = _s(args.get("workflow_id"))
    if workflow_id:
        if await load_workflow(ctx, workflow_id) is None:
            return _err("unknown_workflow", message="No such automation for this institute.")
        body["workflow_ids"] = [workflow_id]
    data = await _admin_core_json(ctx, "POST", "/admin-core-service/v1/workflow-execution/list",
                                  params={"pageNo": 0, "pageSize": _limit(args, 10, _MAX_RUNS)}, body=body)
    if not isinstance(data, dict) or data.get("error"):
        return _err("fetch_failed", message="Could not load executions right now.")
    runs = []
    for r in data.get("content") or []:
        if isinstance(r, dict):
            runs.append({k: v for k, v in {
                "execution_id": r.get("id"), "workflow_id": r.get("workflow_id"), "workflow": r.get("workflow_name"),
                "status": r.get("status"), "started_at": r.get("started_at"), "completed_at": r.get("completed_at"),
                "error": r.get("error_message"),
            }.items() if v not in (None, "")})
    return {"executions": runs, "total": data.get("total_elements", len(runs)),
            "note": "COMPLETED means the run finished, not that every node succeeded — pass an execution_id to see per-node status. Manual 'Run now' runs are not listed."}


def _execution_institute(ctx: ToolContext, execution_id: str) -> Optional[str]:
    """The institute an execution belongs to (shared DB) — the log endpoint is not scoped."""
    from sqlalchemy import text as sql_text
    try:
        row = ctx.db.execute(
            sql_text("SELECT w.institute_id FROM workflow_execution e JOIN workflow w ON w.id = e.workflow_id WHERE e.id = :id"),
            {"id": execution_id},
        ).first()
        return _s(row[0]) if row else None
    except Exception as e:  # noqa: BLE001
        logger.warning("workflows: execution ownership lookup failed: %s", e)
        return None


async def _run_log(ctx: ToolContext, execution_id: str) -> Dict[str, Any]:
    if "/" in execution_id or _execution_institute(ctx, execution_id) != _s(ctx.principal.institute_id):
        return _err("unknown_execution", message="No such execution for this institute.")
    data = await _admin_core_json(ctx, "GET", f"/admin-core-service/workflow/logs/execution/{execution_id}")
    if not isinstance(data, list):
        return _err("fetch_failed", message="Could not load the execution log right now.")
    nodes = []
    for r in data:
        if isinstance(r, dict):
            nodes.append({k: v for k, v in {
                "node_type": r.get("node_type"), "status": r.get("status"), "started_at": r.get("started_at"),
                "execution_time_ms": r.get("execution_time_ms"), "error": r.get("error_message"),
                "details": _compact(r.get("details"), max_items=8, max_str=200) if isinstance(r.get("details"), dict) else None,
            }.items() if v not in (None, "", {})})
    failed = [n for n in nodes if _s(n.get("status")).upper() in ("FAILED", "PARTIAL_SUCCESS")]
    return {"execution_id": execution_id, "nodes": nodes, "failed_nodes": len(failed)}


async def _action_catalog(args: Dict[str, Any], ctx: ToolContext) -> Dict[str, Any]:
    section = _s(args.get("section")).lower() or "overview"
    if section not in CATALOG_SECTIONS:
        return _err("bad_request", message=f"section must be one of {list(CATALOG_SECTIONS)}")
    if section == "trigger_events":
        data = await _admin_core_json(ctx, "GET", "/admin-core-service/v1/workflow/catalog/trigger-events")
        if not isinstance(data, list):
            return _err("fetch_failed", message="Could not load the trigger events right now.")
        return {"section": section, "trigger_events": _compact(data, max_items=80, max_str=400)}
    if section == "query_keys":
        data = await _admin_core_json(ctx, "GET", "/admin-core-service/v1/workflow/catalog/query-keys")
        if not isinstance(data, list):
            return _err("fetch_failed", message="Could not load the query keys right now.")
        return {"section": section, "query_keys": _compact(data, max_items=80, max_str=600)}
    cat = await _admin_core_json(ctx, "GET", "/admin-core-service/v1/workflow/ai-catalog", timeout=30.0)
    if not isinstance(cat, dict) or cat.get("error"):
        return _err("fetch_failed", message="Could not load the workflow catalog right now.")
    if section == "all":
        return {"section": section, **cat}
    if section == "node_types":
        return {"section": section, "nodeTypes": cat.get("nodeTypes"), "avoidNodeTypes": cat.get("avoidNodeTypes")}
    if section == "queries":
        return {"section": section, "readQueries": cat.get("readQueries"), "mutatingQueryKeys": cat.get("mutatingQueryKeys"),
                "mutatingQueryParams": cat.get("mutatingQueryParams"), "unsafeInDryRun": cat.get("unsafeInDryRun")}
    if section == "triggers":
        return {"section": section, "commonTriggers": cat.get("commonTriggers"), "triggerContextKeys": cat.get("triggerContextKeys"),
                "engineContextKeys": cat.get("engineContextKeys")}
    node_names = [n.get("type") for n in cat.get("nodeTypes") or [] if isinstance(n, dict)]
    query_names = [q.get("key") for q in cat.get("readQueries") or [] if isinstance(q, dict)]
    trigger_names = list((cat.get("triggerContextKeys") or {}).keys()) if isinstance(cat.get("triggerContextKeys"), dict) else []
    return {
        "section": "overview",
        "version": cat.get("version"),
        "workflowJsonShape": cat.get("workflowJsonShape"),
        "generationRules": cat.get("generationRules"),
        "avoidNodeTypes": cat.get("avoidNodeTypes"),
        "unsafeInDryRun": cat.get("unsafeInDryRun"),
        "engineContextKeys": cat.get("engineContextKeys"),
        "nodeTypeNames": node_names,
        "readQueryKeys": query_names,
        "triggerEventNames": trigger_names,
        "howToWire": ("Give each node an id and connect them with edges {source_node_id, target_node_id}; routing is "
                      "derived from edges. For a CONDITION node put the SpEL on the true edge as `condition` and label "
                      "the other edge 'false'. Leaf nodes end automatically."),
        "next": "Fetch catalog(node_types | queries | triggers) for details, and context for real ids and template names.",
    }


async def _action_context(args: Dict[str, Any], ctx: ToolContext) -> Dict[str, Any]:
    kind = _s(args.get("kind")).lower()
    search = _s(args.get("search")).lower()
    if kind and kind not in CONTEXT_KINDS:
        return _err("bad_request", message=f"kind must be one of {list(CONTEXT_KINDS)}")
    kinds = [kind] if kind else list(CONTEXT_KINDS)

    def matches(row: Dict[str, Any]) -> bool:
        return not search or search in json.dumps(row, default=str).lower()

    def cap(rows: List[Dict[str, Any]]) -> Dict[str, Any]:
        rows = [r for r in rows if matches(r)]
        return {"items": rows[:_MAX_CONTEXT_ITEMS], "total": len(rows)}

    out: Dict[str, Any] = {"institute_id": ctx.principal.institute_id}
    if "batches" in kinds:
        out["batches"] = {**cap(load_batches(ctx, search, _MAX_CONTEXT_ITEMS)),
                          "use": "package_session_id → trigger.event_ids (PACKAGE_SESSION) or QUERY params batchId / packageSessionIds"}
    if "audiences" in kinds:
        out["audiences"] = {**cap(await load_audiences(ctx)),
                            "use": "audience_id → trigger.event_ids (AUDIENCE) or QUERY params audienceId"}
    if "templates" in kinds:
        t = await load_templates(ctx)
        out["templates"] = {
            "email": cap([x for x in t["email"] if _s(x.get("status")).upper() in ("ACTIVE", "")]),
            "whatsapp": cap([x for x in t["whatsapp"] if _s(x.get("status")).upper() == "APPROVED"]),
            "whatsapp_pending": cap([{"name": x["name"], "status": x.get("status")} for x in t["whatsapp"]
                                     if _s(x.get("status")).upper() in ("DRAFT", "PENDING", "REJECTED")]),
            "use": ("templateName must be one of these names, on a node of the matching channel; templateVars keys "
                    "are the template's placeholders. whatsapp_pending templates cannot be sent until APPROVED — "
                    "workflows_edit(sync_whatsapp_templates) refreshes their status. Missing one? "
                    "workflows_edit(create_email_template | create_whatsapp_template)."),
        }
    if "live_sessions" in kinds:
        out["live_sessions"] = {**cap(await load_live_sessions(ctx)), "use": "live_session_id → trigger.event_ids (LIVE_SESSION)"}
    if "invites" in kinds:
        out["invites"] = {**cap(await load_invites(ctx)), "use": "enroll_invite_id → trigger.event_ids (ENROLL_INVITE)"}
    out["note"] = "Use only these ids and names. Empty lists mean the institute has none yet — ask the admin rather than inventing one."
    return out


async def _action_template(args: Dict[str, Any], ctx: ToolContext) -> Dict[str, Any]:
    channel = _s(args.get("channel")).upper()
    name = _s(args.get("name"))
    if channel not in ("EMAIL", "WHATSAPP") or not name:
        return _err("missing_argument", needs=[n for n, v in (("channel", channel in ("EMAIL", "WHATSAPP")), ("name", name)) if not v],
                    message="template needs channel (EMAIL | WHATSAPP) and name.")
    if channel == "EMAIL":
        t = await load_email_template(ctx, name)
        if t is None:
            return _err("unknown_template", message=f"No email template named '{name}' for this institute — see workflows(context, kind='templates').")
        full = _email_template_full(t)
        return {"template": full,
                "send_node_hint": {"node_type": "SEND_EMAIL", "config": {"templateName": name,
                                   "templateVars": {k: "<item field or #ctx SpEL>" for k in full.get("placeholders") or []}}}}
    rows = await load_whatsapp_template_rows(ctx)
    if rows is None:
        return _err("fetch_failed", message="Could not load WhatsApp templates right now.")
    match = next((r for r in rows if _s(r.get("name")) == name and _s(r.get("status")).upper() != "DELETED"), None)
    if match is None:
        return _err("unknown_template", message=f"No WhatsApp template named '{name}' for this institute — see workflows(context, kind='templates') or run workflows_edit(sync_whatsapp_templates).")
    full = _whatsapp_template_full(match)
    return {"template": full,
            "send_node_hint": {"node_type": "SEND_WHATSAPP", "config": {"templateName": name, "languageCode": full.get("language") or "en",
                               "templateVars": {k: "<item field or #ctx SpEL>" for k in full.get("placeholders") or []}}},
            "note": None if full["usable"] else f"Status is {full.get('status')}: sends will fail until Meta approves it."}


_ACTIONS = {"list": _action_list, "get": _action_get, "runs": _action_runs, "catalog": _action_catalog,
            "context": _action_context, "template": _action_template}


async def execute_workflows(args: Dict[str, Any], ctx: ToolContext) -> str:
    action = _s((args or {}).get("action"))
    handler = _ACTIONS.get(action)
    if handler is None:
        return json.dumps(_err("unknown_action", action=action, available=list(WORKFLOWS_ACTIONS)))
    result = await handler(args or {}, ctx)
    if isinstance(result, dict) and "action" not in result:
        result = {"action": action, **result}
    # The catalog's rules are long by design — never truncate them.
    return json.dumps(result, ensure_ascii=False, default=str)


# ──────────────────────────────────────────────────────────────────────────
# workflows_edit — WRITE actions (draft-only)
# ──────────────────────────────────────────────────────────────────────────

def _validation_result(check: Dict[str, Any], saved: bool) -> Dict[str, Any]:
    dto = check.get("dto") or {}
    out: Dict[str, Any] = {
        "valid": check["ok"],
        "errors": check["errors"],
        "warnings": check["warnings"],
        "saved": saved,
    }
    if dto:
        out["normalized"] = {"name": dto.get("name"), "type": dto.get("workflow_type"), "steps": step_summary(dto),
                             "node_count": len(dto.get("nodes") or []), "edge_count": len(dto.get("edges") or [])}
    out["next"] = ("Fix every error and call again." if not check["ok"]
                   else "No errors. Call create_draft (or update_draft) with this same workflow to save it as a draft.")
    return out


async def _action_validate(args: Dict[str, Any], ctx: ToolContext) -> Dict[str, Any]:
    if args.get("workflow") is None:
        return _err("missing_argument", action="validate", needs=["workflow"])
    check = await check_workflow(ctx, args.get("workflow"))
    return _validation_result(check, saved=False)


async def _action_create_draft(args: Dict[str, Any], ctx: ToolContext) -> Dict[str, Any]:
    if args.get("workflow") is None:
        return _err("missing_argument", action="create_draft", needs=["workflow"])
    check = await check_workflow(ctx, args.get("workflow"))
    if not check["ok"]:
        return {"error": "validation_failed", **_validation_result(check, saved=False)}
    dto = check["dto"]
    data = await _admin_core_json(ctx, "POST", "/admin-core-service/v1/workflow",
                                  params={"userId": ctx.principal.user_id}, body=dto, timeout=45.0)
    workflow_id = _s(data.get("id")) if isinstance(data, dict) and not data.get("error") else ""
    if not workflow_id:
        return _err("create_failed", message="The automation could not be saved.", status=(data or {}).get("status") if isinstance(data, dict) else None)
    return _saved(ctx, dto, workflow_id, check["warnings"], created=True)


async def _draft_or_error(ctx: ToolContext, workflow_id: str, action: str) -> Tuple[Optional[Dict[str, Any]], Optional[Dict[str, Any]]]:
    if not workflow_id:
        return None, _err("missing_argument", action=action, needs=["workflow_id"])
    existing = await load_workflow(ctx, workflow_id)
    if existing is None:
        return None, _err("unknown_workflow", message="No such automation for this institute.")
    status = _s(existing.get("status")).upper()
    if status != "DRAFT":
        return None, _err("not_a_draft", status=status,
                          message=f"This automation is {status}, and this tool only changes drafts. Published automations are edited in the dashboard.",
                          editor_url=editor_url(ctx, workflow_id))
    return existing, None


async def _action_update_draft(args: Dict[str, Any], ctx: ToolContext) -> Dict[str, Any]:
    workflow_id = _s(args.get("workflow_id"))
    if args.get("workflow") is None:
        return _err("missing_argument", action="update_draft", needs=[n for n, v in (("workflow_id", workflow_id), ("workflow", None)) if not v])
    _, denied = await _draft_or_error(ctx, workflow_id, "update_draft")
    if denied:
        return denied
    check = await check_workflow(ctx, args.get("workflow"), workflow_id=workflow_id)
    if not check["ok"]:
        return {"error": "validation_failed", **_validation_result(check, saved=False)}
    dto = check["dto"]
    data = await _admin_core_json(ctx, "PUT", f"/admin-core-service/v1/workflow/{workflow_id}",
                                  params={"userId": ctx.principal.user_id}, body=dto, timeout=45.0)
    if not isinstance(data, dict) or data.get("error"):
        return _err("update_failed", message="The draft could not be updated.")
    return _saved(ctx, dto, workflow_id, check["warnings"], created=False)


async def _action_discard_draft(args: Dict[str, Any], ctx: ToolContext) -> Dict[str, Any]:
    workflow_id = _s(args.get("workflow_id"))
    existing, denied = await _draft_or_error(ctx, workflow_id, "discard_draft")
    if denied:
        return denied
    data = await _admin_core_json(ctx, "DELETE", f"/admin-core-service/v1/workflow/{workflow_id}")
    # DELETE answers 204 No Content, which the shared helper reports as a non-200.
    ok = data in (None, "") or (isinstance(data, dict) and (not data.get("error") or data.get("status") == 204))
    if not ok:
        return _err("discard_failed", message="The draft could not be discarded.")
    return {"workflow": {"id": workflow_id, "name": (existing or {}).get("name")}, "discarded": True,
            "note": "The draft is gone from the automations list. Nothing that was live was touched."}


# ──────────────────────────────────────────────────────────────────────────
# Template creation — additive: a new template affects nothing until referenced
# ──────────────────────────────────────────────────────────────────────────

_HANDLEBARS_BLOCK_RE = re.compile(r"\{\{\s*[#/^]")


async def _action_create_email_template(args: Dict[str, Any], ctx: ToolContext) -> Dict[str, Any]:
    name, subject, html = _s(args.get("name")), _s(args.get("subject")), _s(args.get("html"))
    missing = [n for n, v in (("name", name), ("subject", subject), ("html", html)) if not v]
    if missing:
        return _err("missing_argument", action="create_email_template", needs=missing)
    if len(html) > _EMAIL_HTML_MAX:
        return _err("bad_request", message=f"html is {len(html)} characters; keep it under {_EMAIL_HTML_MAX}.")
    if _HANDLEBARS_BLOCK_RE.search(subject + html):
        return _err("bad_request", message="Only plain {{placeholder}} substitution is supported — no {{#if}}/{{/each}} blocks. Pre-render conditional parts as a single placeholder instead.")
    templates = await load_templates(ctx)
    if not templates.get("email_loaded"):
        return _err("fetch_failed", message="Could not load the existing templates to check the name — try again.")
    if any(t.get("name") == name for t in templates["email"]):
        return _err("template_exists", name=name,
                    message=f"An email template named '{name}' already exists. Existing templates are never changed from here — reuse it (workflows(template)) or pick a new name.")
    placeholders = email_placeholders(subject, html)
    labels_in = args.get("placeholder_labels") if isinstance(args.get("placeholder_labels"), dict) else {}
    dynamic_parameters = {k: _s(labels_in.get(k)) or _humanize(k) for k in placeholders}
    status, data = await _raw_call(
        ctx, _admin_core_base(), "POST", "/admin-core-service/institute/template/v1/create",
        body={
            "type": "EMAIL",
            "vendorId": "default",
            "instituteId": ctx.principal.institute_id,
            "name": name,
            "subject": subject,
            "content": html,
            "contentType": "text/html",
            "settingJson": {"variables": placeholders, "isDefault": False, "templateType": "utility", "createdVia": "mcp"},
            "dynamicParameters": dynamic_parameters,
            "canDelete": True,
            "status": "ACTIVE",
            "templateCategory": "NOTIFICATION",
        },
    )
    if status not in (200, 201) or not isinstance(data, dict):
        return _err("create_failed", status=status, **_backend_reason(data, "The email template could not be created."))
    return {
        "template": {"id": data.get("id"), "name": name, "channel": "EMAIL", "status": "ACTIVE",
                     "subject": subject, "placeholders": placeholders},
        "send_node_hint": {"node_type": "SEND_EMAIL", "config": {"templateName": name,
                           "templateVars": {k: "<item field or #ctx SpEL>" for k in placeholders}}},
        "next": ("The template is ready to reference from a SEND_EMAIL node (templateVars keys = placeholders). "
                 "The admin can review or edit it under Settings → Templates."),
    }


async def _action_create_whatsapp_template(args: Dict[str, Any], ctx: ToolContext) -> Dict[str, Any]:
    name = _s(args.get("name")).lower()
    body = _s(args.get("body"))
    if not name or not body:
        return _err("missing_argument", action="create_whatsapp_template", needs=[n for n, v in (("name", name), ("body", body)) if not v])
    category = _s(args.get("category")).upper() or "UTILITY"
    language = _s(args.get("language")) or "en"
    samples = [_s(x) for x in args.get("sample_values")] if isinstance(args.get("sample_values"), list) else []
    variable_names = [_s(x) for x in args.get("variable_names")] if isinstance(args.get("variable_names"), list) else []
    header_text, footer_text = _s(args.get("header_text")), _s(args.get("footer_text"))
    buttons = [b for b in args.get("buttons") if isinstance(b, dict)] if isinstance(args.get("buttons"), list) else []
    problems = whatsapp_body_problems(name, body, category, samples, header_text, footer_text, buttons)
    if problems:
        return _err("bad_request", problems=problems, message="Fix these before Meta will accept the template.")
    rows = await load_whatsapp_template_rows(ctx)
    if rows is None:
        return _err("fetch_failed", message="Could not load the existing WhatsApp templates to check the name — try again.")
    clash = next((r for r in rows if _s(r.get("name")) == name and _s(r.get("language") or "en") == language
                  and _s(r.get("status")).upper() != "DELETED"), None)
    if clash:
        return _err("template_exists", name=name, status=clash.get("status"),
                    message=f"A WhatsApp template named '{name}' ({language}) already exists with status {clash.get('status')}. Templates with Meta are locked — pick a new name.")
    count = max([int(m.group(1)) for m in _WA_PLACEHOLDER_RE.finditer(body)] or [0])
    payload: Dict[str, Any] = {
        "instituteId": ctx.principal.institute_id,
        "name": name,
        "language": language,
        "category": category,
        "headerType": "TEXT" if header_text else "NONE",
        "headerText": header_text or None,
        "bodyText": body,
        "footerText": footer_text or None,
        "bodySampleValues": samples[:count],
        "bodyVariableNames": variable_names[:count] if variable_names else None,
        "buttons": [{"type": _s(b.get("type")).upper(), "text": _s(b.get("text")), "url": _s(b.get("url")) or None,
                     "phoneNumber": _s(b.get("phone_number") or b.get("phoneNumber")) or None} for b in buttons] or None,
        "createdBy": ctx.principal.user_id,
    }
    status, data = await _raw_call(ctx, _notification_base(), "POST", "/notification-service/v1/whatsapp-templates", body=payload)
    if status not in (200, 201) or not isinstance(data, dict) or not data.get("id"):
        return _err("create_failed", status=status, **_backend_reason(data, "The WhatsApp template draft could not be created."))
    template_id = str(data["id"])
    result: Dict[str, Any] = {"template": _whatsapp_template_full(data)}
    if args.get("submit", True) is False:
        result["next"] = "Saved as a DRAFT with Meta not yet asked. Submit it from Settings → WhatsApp templates when ready."
        return result
    status, submitted = await _raw_call(ctx, _notification_base(), "POST", f"/notification-service/v1/whatsapp-templates/{template_id}/submit", timeout=60.0)
    if status != 200 or not isinstance(submitted, dict):
        reason = _backend_reason(submitted, "Meta did not accept the submission.")
        result["submitted"] = False
        result["submit_error"] = reason
        result["next"] = ("The draft is saved but NOT submitted: " + reason["message"]
                          + " Fix the content and create it again under a new name, or ask the admin to submit it from Settings → WhatsApp templates.")
        return result
    result["template"] = _whatsapp_template_full(submitted)
    result["submitted"] = True
    result["send_node_hint"] = {"node_type": "SEND_WHATSAPP", "config": {"templateName": name, "languageCode": language,
                                "templateVars": {str(i + 1): "<item field or #ctx SpEL>" for i in range(count)}}}
    result["next"] = ("Submitted to Meta (status PENDING). Approval usually takes minutes to a few hours; call "
                      "workflows_edit(sync_whatsapp_templates) to check. You can draft the automation now, but the admin "
                      "should publish only once the template is APPROVED — sends fail until then.")
    return result


async def _action_sync_whatsapp_templates(args: Dict[str, Any], ctx: ToolContext) -> Dict[str, Any]:
    status, data = await _raw_call(ctx, _notification_base(), "POST", "/notification-service/v1/whatsapp-templates/sync",
                                   params={"instituteId": ctx.principal.institute_id}, timeout=60.0)
    if status != 200:
        return _err("sync_failed", status=status, **_backend_reason(data, "Could not sync templates from Meta — is WhatsApp connected for this institute?"))
    rows = await load_whatsapp_template_rows(ctx) or []
    by_status: Dict[str, List[str]] = {}
    for r in rows:
        st = _s(r.get("status")).upper() or "UNKNOWN"
        if st != "DELETED":
            by_status.setdefault(st, []).append(_s(r.get("name")))
    return {"synced": (data or {}).get("synced") if isinstance(data, dict) else None,
            "templates_by_status": {k: sorted(v)[:_MAX_CONTEXT_ITEMS] for k, v in sorted(by_status.items())},
            "note": "Only APPROVED templates can be sent."}


_EDIT_ACTIONS = {"validate": _action_validate, "create_draft": _action_create_draft,
                 "create_email_template": _action_create_email_template,
                 "create_whatsapp_template": _action_create_whatsapp_template,
                 "sync_whatsapp_templates": _action_sync_whatsapp_templates,
                 "update_draft": _action_update_draft, "discard_draft": _action_discard_draft}


async def execute_workflows_edit(args: Dict[str, Any], ctx: ToolContext) -> str:
    action = _s((args or {}).get("action"))
    handler = _EDIT_ACTIONS.get(action)
    if handler is None:
        return json.dumps(_err("unknown_action", action=action, available=list(WORKFLOWS_EDIT_ACTIONS)))
    result = await handler(args or {}, ctx)
    if isinstance(result, dict) and "action" not in result:
        result = {"action": action, **result}
    return json.dumps(result, ensure_ascii=False, default=str)


# ──────────────────────────────────────────────────────────────────────────
# Registration
# ──────────────────────────────────────────────────────────────────────────

WORKFLOW_TOOLS: Dict[str, ToolSpec] = {
    WORKFLOWS_TOOL_NAME: ToolSpec(
        name=WORKFLOWS_TOOL_NAME,
        schema=WORKFLOWS_SCHEMA,
        executor=execute_workflows,
        required_permission=None,
        setting_key=WORKFLOWS_GROUP_KEY,
        default_enabled=False,
        default_roles=["ADMIN"],
        phase=2,
        mode="READ",
    ),
    WORKFLOWS_EDIT_TOOL_NAME: ToolSpec(
        name=WORKFLOWS_EDIT_TOOL_NAME,
        schema=WORKFLOWS_EDIT_SCHEMA,
        executor=execute_workflows_edit,
        required_permission=None,
        setting_key=WORKFLOWS_EDIT_GROUP_KEY,
        default_enabled=False,
        default_roles=None,
        phase=3,
        mode="WRITE",
    ),
}


def _register() -> None:
    """Self-register into the shared registry (see assistant_tool_registry._load_feature_tools)."""
    from .assistant_tool_registry import ASSISTANT_TOOLS, GROUP_LABELS
    ASSISTANT_TOOLS.update(WORKFLOW_TOOLS)
    GROUP_LABELS.update({WORKFLOWS_GROUP_KEY: "Automations: view", WORKFLOWS_EDIT_GROUP_KEY: "Automations: draft"})


_register()

__all__ = [
    "WORKFLOW_TOOLS", "WORKFLOWS_TOOL_NAME", "WORKFLOWS_GROUP_KEY", "WORKFLOWS_ACTIONS", "WORKFLOWS_SCHEMA",
    "WORKFLOWS_EDIT_TOOL_NAME", "WORKFLOWS_EDIT_GROUP_KEY", "WORKFLOWS_EDIT_ACTIONS", "WORKFLOWS_EDIT_SCHEMA",
    "execute_workflows", "execute_workflows_edit", "normalize_workflow", "lint_workflow", "check_workflow",
    "step_summary", "load_workflow", "editor_url", "email_placeholders", "whatsapp_body_problems",
]
