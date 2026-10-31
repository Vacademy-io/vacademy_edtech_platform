"""
The ``audience_forms`` tool — read-only access to lead campaigns (Audience
Manager) for the Assistant and the MCP server.

Lead capture is its own feature with its own owners, so it is its own toggle
("Lead forms: view") rather than a corner of the website tool. The website tool
only ever POINTS a page at a campaign; what a campaign is, which fields its form
has and who has submitted live here. Actions:

    list    campaigns with status, objective, field count, leads received, last lead,
            and which website pages use them
    get     one campaign with its form fields and public form URL
    leads   recent leads for one campaign (capped; contact details masked unless the
            caller may see them)
"""
from __future__ import annotations

import json
import logging
from typing import Any, Dict, List, Optional

from .assistant_tool_registry import ToolContext, ToolSpec, _admin_core_json, _compact
from .catalogue_summary import collect_capture_surfaces
from .website_data import campaign_lead_stats, get_campaign, list_catalogues, load_campaigns

logger = logging.getLogger(__name__)

AUDIENCE_TOOL_NAME = "audience_forms"
AUDIENCE_GROUP_KEY = "audience_forms"
AUDIENCE_ACTIONS = ("list", "get", "leads")

_MAX_LEADS = 25


AUDIENCE_SCHEMA: Dict[str, Any] = {
    "type": "function",
    "function": {
        "name": AUDIENCE_TOOL_NAME,
        "description": (
            "Read the institute's lead campaigns (Audience Manager) — the forms that website "
            "enquiry sections, popups and registration pages submit into. Pick an `action`:\n"
            "- list (status?): every campaign with objective, form field count, leads received, last "
            "lead, and which website pages use it.\n"
            "- get (audience_id): one campaign with its form fields (label, type, required) and its "
            "public form URL.\n"
            "- leads (audience_id, days?, limit?): the most recent leads — name, when, from which page, "
            "conversion status. Contact details are included only when the caller may see them.\n"
            "Campaign ids come from `list`; never invent one."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "action": {"type": "string", "enum": list(AUDIENCE_ACTIONS)},
                "audience_id": {"type": "string", "description": "Campaign id (from `list`)."},
                "status": {"type": "string", "description": "list: ACTIVE (default), PAUSED, COMPLETED, ARCHIVED or ALL."},
                "days": {"type": "integer", "description": "leads: only leads from the last N days."},
                "limit": {"type": "integer", "description": "leads: max rows (default 10, max 25)."},
            },
            "required": ["action"],
        },
    },
}


def _err(code: str, **extra: Any) -> Dict[str, Any]:
    return {"error": code, **extra}


async def _site_usage(ctx: ToolContext) -> Dict[str, List[str]]:
    """campaign id → ['site/route (Lead Form)', …] across every website of the institute."""
    rows = await list_catalogues(ctx)
    usage: Dict[str, List[str]] = {}
    for r in rows if isinstance(rows, list) else []:
        if not isinstance(r, dict):
            continue
        raw = r.get("catalogue_json")
        try:
            config = json.loads(raw) if isinstance(raw, str) and len(raw) < 3_000_000 else (raw if isinstance(raw, dict) else None)
        except ValueError:
            config = None
        if not isinstance(config, dict):
            continue
        tag = str(r.get("tag_name") or "")
        for s in collect_capture_surfaces(config):
            if s["audience_id"]:
                usage.setdefault(s["audience_id"], []).append(
                    f"{tag}/{s['page_route'] or '(every page)'} ({s['section_label']}: {s['label']})"
                )
    return usage


async def _action_list(args: Dict[str, Any], ctx: ToolContext) -> Dict[str, Any]:
    status = str(args.get("status") or "ACTIVE").upper()
    campaigns = await load_campaigns(ctx, status=None if status == "ALL" else status)
    usage = await _site_usage(ctx)
    for c in campaigns:
        used = usage.get(str(c.get("id") or ""))
        if used:
            c["used_on"] = used[:8]
    return {"campaigns": campaigns, "count": len(campaigns), "status_filter": status}


def _cf(cf: Dict[str, Any], snake: str, camel: str) -> Any:
    """The nested custom_field is serialised camelCase on the wire (its DTO is
    declared snake_case, but the deployed shape is camelCase); accept both."""
    v = cf.get(snake)
    return v if v is not None else cf.get(camel)


def _form_fields(campaign: Dict[str, Any]) -> List[Dict[str, Any]]:
    fields = []
    for f in campaign.get("institute_custom_fields") or []:
        if not isinstance(f, dict):
            continue
        cf = f.get("custom_field") or {}
        required = f.get("is_mandatory")
        if required is None:
            required = _cf(cf, "is_mandatory", "isMandatory")
        order = f.get("individual_order")
        if order is None:
            order = _cf(cf, "form_order", "formOrder")
        fields.append({k: v for k, v in {
            "id": cf.get("id") or f.get("field_id"),
            "label": _cf(cf, "field_name", "fieldName"),
            "type": _cf(cf, "field_type", "fieldType"),
            "required": bool(required),
            "order": order,
            "status": f.get("status"),
        }.items() if v not in (None, "")})
    fields.sort(key=lambda x: (x.get("order") is None, x.get("order") or 0))
    return fields


async def _action_get(args: Dict[str, Any], ctx: ToolContext) -> Dict[str, Any]:
    audience_id = str(args.get("audience_id") or "").strip()
    if not audience_id:
        return _err("missing_argument", needs=["audience_id"])
    campaign = await get_campaign(ctx, audience_id)
    if campaign is None:
        return _err("unknown_campaign", message="No such campaign for this institute.")
    stats = await campaign_lead_stats(ctx, audience_id)
    from ..config import get_settings
    return {
        "id": campaign.get("id"),
        "name": campaign.get("campaign_name"),
        "status": campaign.get("status"),
        "type": campaign.get("campaign_type"),
        "objective": campaign.get("campaign_objective"),
        "description": campaign.get("description"),
        "fields": _form_fields(campaign),
        "public_form_url": f"{get_settings().learner_dashboard_url.rstrip('/')}/audience-response?instituteId={ctx.principal.institute_id}&audienceId={audience_id}",
        **stats,
        "note": "Fields are edited in Audience Manager; every website form using this campaign renders these same fields.",
    }


async def _action_leads(args: Dict[str, Any], ctx: ToolContext) -> Dict[str, Any]:
    audience_id = str(args.get("audience_id") or "").strip()
    if not audience_id:
        return _err("missing_argument", needs=["audience_id"])
    campaign = await get_campaign(ctx, audience_id)
    if campaign is None:
        return _err("unknown_campaign", message="No such campaign for this institute.")
    limit = max(1, min(int(args.get("limit") or 10), _MAX_LEADS))
    body: Dict[str, Any] = {
        "audience_id": audience_id,
        "conversion_status_filter": "ALL",
        "sort_by": "SUBMITTED_AT",
        "sort_direction": "DESC",
        "page": 0,
        "size": limit,
    }
    days = args.get("days")
    if days:
        from datetime import datetime, timedelta, timezone
        since = datetime.now(timezone.utc) - timedelta(days=int(days))
        body["submitted_from_local"] = since.strftime("%Y-%m-%dT%H:%M:%S")
    data = await _admin_core_json(
        ctx, "POST", "/admin-core-service/v1/audience/leads",
        params={"pageNo": 0, "pageSize": limit}, body=body,
    )
    if not isinstance(data, dict) or data.get("error"):
        return _err("fetch_failed", message="Could not load leads right now.")

    # Contact details reach the model only for callers who could see them in
    # Audience Manager anyway (admins); other roles get names and timing. Not
    # is_root_user: it is set for ordinary users and says nothing about this institute.
    roles = {str(r).upper() for r in (ctx.principal.roles or [])}
    show_contact = "ADMIN" in roles
    leads: List[Dict[str, Any]] = []
    for row in data.get("content") or []:
        if not isinstance(row, dict):
            continue
        user = row.get("user") or {}
        entry: Dict[str, Any] = {
            "response_id": row.get("response_id"),
            "name": row.get("parent_name") or user.get("full_name") or user.get("fullName"),
            "submitted_at": row.get("submitted_at_local"),
            "source": row.get("source_id") or row.get("source_type"),
            "status": row.get("conversion_status") or row.get("overall_status"),
            "lead_tier": row.get("lead_tier"),
            "assigned_to": row.get("assigned_counselor_name"),
        }
        if show_contact:
            entry["email"] = row.get("parent_email") or user.get("email")
            entry["phone"] = row.get("parent_mobile") or user.get("mobile_number") or user.get("mobileNumber")
        leads.append({k: v for k, v in entry.items() if v not in (None, "")})
    return {
        "campaign": {"id": audience_id, "name": campaign.get("campaign_name")},
        "total": data.get("total_elements", data.get("totalElements")),
        "leads": leads,
        "contact_details_included": show_contact,
    }


_ACTIONS = {"list": _action_list, "get": _action_get, "leads": _action_leads}


async def execute_audience_forms(args: Dict[str, Any], ctx: ToolContext) -> str:
    action = str((args or {}).get("action") or "").strip()
    handler = _ACTIONS.get(action)
    if handler is None:
        return json.dumps(_err("unknown_action", action=action, available=list(AUDIENCE_ACTIONS)))
    result = await handler(args or {}, ctx)
    if isinstance(result, dict) and "action" not in result:
        result = {"action": action, **result}
    return json.dumps(_compact(result, max_items=60, max_str=300), ensure_ascii=False, default=str)


AUDIENCE_TOOLS: Dict[str, ToolSpec] = {
    AUDIENCE_TOOL_NAME: ToolSpec(
        name=AUDIENCE_TOOL_NAME,
        schema=AUDIENCE_SCHEMA,
        executor=execute_audience_forms,
        required_permission=None,
        setting_key=AUDIENCE_GROUP_KEY,
        default_enabled=False,
        default_roles=["ADMIN"],
        phase=2,
        mode="READ",
    ),
}


def _register() -> None:
    """Self-register into the shared registry (see assistant_tool_registry._load_feature_tools)."""
    from .assistant_tool_registry import ASSISTANT_TOOLS, GROUP_LABELS
    ASSISTANT_TOOLS.update(AUDIENCE_TOOLS)
    GROUP_LABELS.update({AUDIENCE_GROUP_KEY: "Lead forms: view"})


_register()

__all__ = ["AUDIENCE_TOOLS", "AUDIENCE_TOOL_NAME", "AUDIENCE_GROUP_KEY", "AUDIENCE_ACTIONS",
           "AUDIENCE_SCHEMA", "execute_audience_forms", "AUDIENCE_EDIT_TOOLS", "AUDIENCE_EDIT_TOOL_NAME",
           "AUDIENCE_EDIT_GROUP_KEY", "AUDIENCE_EDIT_ACTIONS", "execute_audience_forms_edit"]


# ──────────────────────────────────────────────────────────────────────────
# audience_forms_edit — WRITE: create a campaign, change its form, test it
# ──────────────────────────────────────────────────────────────────────────
AUDIENCE_EDIT_TOOL_NAME = "audience_forms_edit"
AUDIENCE_EDIT_GROUP_KEY = "audience_forms_edits"
AUDIENCE_EDIT_ACTIONS = ("create", "update_fields", "send_test_lead")

FIELD_TYPES = ("TEXT", "NUMBER", "EMAIL", "PHONE", "DROPDOWN", "CHECKBOX", "DATE", "TEXTAREA")
DEFAULT_FIELDS = [
    {"label": "Full Name", "type": "TEXT", "required": True},
    {"label": "Email", "type": "TEXT", "required": True},
    {"label": "Phone Number", "type": "TEXT", "required": False},
]

AUDIENCE_EDIT_SCHEMA: Dict[str, Any] = {
    "type": "function",
    "function": {
        "name": AUDIENCE_EDIT_TOOL_NAME,
        "description": (
            "Change lead campaigns (Audience Manager). Pick an `action`:\n"
            "- create (name, fields?, objective?, description?): a new WEBSITE lead campaign. Default "
            "fields: Full Name, Email, Phone Number. Returns the id to use with "
            "website_edit(action='link_lead_form').\n"
            "- update_fields (audience_id, fields): add fields to the form or change existing ones "
            "(matched by label). Existing fields are never removed here — that stays in Audience "
            "Manager. Get the current list with audience_forms(action='get').\n"
            "- send_test_lead (audience_id): submit one test lead through the real public pipeline to "
            "prove the campaign receives submissions.\n"
            "These change the CRM directly (a campaign is not a draft) — confirm with the admin first."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "action": {"type": "string", "enum": list(AUDIENCE_EDIT_ACTIONS)},
                "audience_id": {"type": "string"},
                "name": {"type": "string", "description": "create: campaign name, e.g. 'Admissions 2027'."},
                "description": {"type": "string"},
                "objective": {"type": "string", "description": "create: LEAD_GENERATION (default) or EVENT_REGISTRATION."},
                "fields": {
                    "type": "array",
                    "description": "Form fields in order.",
                    "items": {"type": "object", "properties": {
                        "label": {"type": "string"},
                        "type": {"type": "string", "enum": list(FIELD_TYPES)},
                        "required": {"type": "boolean"},
                        "options": {"type": "array", "items": {"type": "string"}, "description": "DROPDOWN only."},
                    }, "required": ["label"]},
                },
            },
            "required": ["action"],
        },
    },
}


def _field_payload(ctx: ToolContext, field: Dict[str, Any], order: int, existing: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """One InstituteCustomFieldDTO (snake_case, as the Java DTOs declare)."""
    label = str(field.get("label") or "").strip()
    ftype = str(field.get("type") or "TEXT").upper()
    ftype = ftype if ftype in FIELD_TYPES else "TEXT"
    required = bool(field.get("required", False))
    config: Dict[str, Any] = {}
    if ftype == "DROPDOWN" and field.get("options"):
        config["options"] = [str(o) for o in field["options"]]
    # The nested DTO is read camelCase by the deployed service (what the
    # dashboard sends) while its declaration says snake_case; send both
    # spellings — unknown properties are ignored, so this is safe either way.
    cfg_text = json.dumps(config) if config else "{}"
    custom_field: Dict[str, Any] = {
        "field_name": label, "fieldName": label,
        "field_type": ftype, "fieldType": ftype,
        "default_value": "", "defaultValue": "",
        "config": cfg_text,
        "form_order": order, "formOrder": order,
        "is_mandatory": required, "isMandatory": required,
        "status": "ACTIVE",
    }
    if existing:
        # Keep the ids so the sync updates in place rather than recreating.
        ecf = existing.get("custom_field") or {}
        if ecf.get("id"):
            custom_field["id"] = ecf["id"]
        key = _cf(ecf, "field_key", "fieldKey")
        if key:
            custom_field["field_key"] = key
            custom_field["fieldKey"] = key
    out: Dict[str, Any] = {
        "institute_id": ctx.principal.institute_id,
        "type": "AUDIENCE_FORM",
        "group_name": "",
        "individual_order": order,
        "group_internal_order": 0,
        "is_mandatory": required,
        "status": "ACTIVE",
        "custom_field": custom_field,
    }
    if existing:
        for k in ("id", "field_id"):
            if existing.get(k):
                out[k] = existing[k]
    return out


async def _action_create(args: Dict[str, Any], ctx: ToolContext) -> Dict[str, Any]:
    name = str(args.get("name") or "").strip()
    if not name:
        return _err("missing_argument", action="create", needs=["name"])
    fields_in = args.get("fields") if isinstance(args.get("fields"), list) and args.get("fields") else DEFAULT_FIELDS
    fields = [_field_payload(ctx, f, i + 1) for i, f in enumerate(fields_in) if isinstance(f, dict) and str(f.get("label") or "").strip()]
    if not fields:
        return _err("bad_request", message="At least one field with a label is needed.")
    objective = str(args.get("objective") or "LEAD_GENERATION").upper()
    data = await _admin_core_json(
        ctx, "POST", "/admin-core-service/v1/audience/campaign",
        body={
            "institute_id": ctx.principal.institute_id,
            "campaign_name": name,
            "campaign_type": "WEBSITE",
            "campaign_objective": objective,
            "description": str(args.get("description") or "Created by the AI assistant"),
            "status": "ACTIVE",
            "institute_custom_fields": fields,
        },
        timeout=30.0,
    )
    if data is None or (isinstance(data, dict) and data.get("error")):
        return _err("create_failed", message="The campaign could not be created.")
    audience_id = str(data).strip('"') if not isinstance(data, dict) else str(data.get("id") or "")
    return {
        "campaign": {"id": audience_id, "name": name, "status": "ACTIVE", "objective": objective},
        "fields": [{"label": f["custom_field"]["field_name"], "type": f["custom_field"]["field_type"],
                    "required": f["is_mandatory"]} for f in fields],
        "next": f"Use website_edit(action='link_lead_form', audience_id='{audience_id}') to send a form's enquiries here.",
    }


async def _action_update_fields(args: Dict[str, Any], ctx: ToolContext) -> Dict[str, Any]:
    audience_id = str(args.get("audience_id") or "").strip()
    fields_in = args.get("fields") if isinstance(args.get("fields"), list) else None
    if not audience_id or not fields_in:
        return _err("missing_argument", action="update_fields", needs=[n for n, v in (("audience_id", audience_id), ("fields", fields_in)) if not v])
    campaign = await get_campaign(ctx, audience_id)
    if campaign is None:
        return _err("unknown_campaign", message="No such campaign for this institute.")
    existing = [f for f in campaign.get("institute_custom_fields") or [] if isinstance(f, dict)]
    existing.sort(key=lambda f: (f.get("individual_order") is None, f.get("individual_order") or 0))

    # ADDITIVE: the server syncs the full list, so start from every existing
    # field (unchanged, same order), update the ones named by label, append the
    # rest. Removing a field is a job for Audience Manager, not a chat.
    merged: List[Dict[str, Any]] = []
    requested = {}
    for f in fields_in:
        if isinstance(f, dict) and str(f.get("label") or "").strip():
            requested[str(f["label"]).strip().lower()] = f
    if not requested:
        return _err("bad_request", message="At least one field with a label is needed.")
    added, changed = [], []
    for f in existing:
        ecf = f.get("custom_field") or {}
        stored_label = _cf(ecf, "field_name", "fieldName")
        label = str(stored_label or "").strip().lower()
        if label in requested:
            # Keep the field's stored label (case) when only its type/required changes.
            change = {**requested.pop(label), "label": stored_label}
            merged.append(_field_payload(ctx, change, len(merged) + 1, f))
            changed.append(merged[-1]["custom_field"]["field_name"])
        else:
            required = f.get("is_mandatory")
            if required is None:
                required = _cf(ecf, "is_mandatory", "isMandatory")
            merged.append(_field_payload(ctx, {
                "label": stored_label,
                "type": _cf(ecf, "field_type", "fieldType"),
                "required": required,
            }, len(merged) + 1, f))
    for f in requested.values():
        merged.append(_field_payload(ctx, f, len(merged) + 1))
        added.append(merged[-1]["custom_field"]["field_name"])
    body = {k: v for k, v in campaign.items() if k != "institute_custom_fields"}
    body["institute_id"] = ctx.principal.institute_id
    body["institute_custom_fields"] = merged
    data = await _admin_core_json(ctx, "PUT", f"/admin-core-service/v1/audience/campaign/{audience_id}", body=body, timeout=30.0)
    if isinstance(data, dict) and data.get("error"):
        return _err("update_failed", message="The campaign's fields could not be updated.")
    return {
        "campaign": {"id": audience_id, "name": campaign.get("campaign_name")},
        "fields": [{"label": f["custom_field"]["field_name"], "type": f["custom_field"]["field_type"],
                    "required": f["is_mandatory"]} for f in merged],
        "added": added,
        "changed": changed,
        "note": "Every website form using this campaign now renders these fields. Fields are never removed from here.",
    }


async def _action_send_test_lead(args: Dict[str, Any], ctx: ToolContext) -> Dict[str, Any]:
    audience_id = str(args.get("audience_id") or "").strip()
    if not audience_id:
        return _err("missing_argument", action="send_test_lead", needs=["audience_id"])
    campaign = await get_campaign(ctx, audience_id)
    if campaign is None:
        return _err("unknown_campaign", message="No such campaign for this institute.")
    import time
    stamp = int(time.time())
    # The exact endpoint + shape the live site submits through — the editor's
    # "Send test lead" button does the same.
    data = await _admin_core_json(
        ctx, "POST", "/admin-core-service/open/v1/audience/lead/submit-catalogue",
        body={
            "institute_id": ctx.principal.institute_id,
            "audience_id": audience_id,
            "full_name": "TEST LEAD — sent by the AI assistant",
            "email": f"test-lead-{stamp}@test.vacademy.io",
            "mobile_number": "",
            "source_type": "TEST_SUBMISSION",
            "source_id": "assistant-test-lead",
        },
    )
    if isinstance(data, dict) and data.get("error"):
        return _err("submit_failed", message="The test submission was rejected — the campaign is not receiving leads.",
                    status=data.get("status"))
    stats = await campaign_lead_stats(ctx, audience_id)
    return {"campaign": {"id": audience_id, "name": campaign.get("campaign_name")},
            "delivered": True, **stats,
            "note": "The test lead appears in Audience Manager → Recent Leads; delete it there if you like."}


_EDIT_ACTIONS = {"create": _action_create, "update_fields": _action_update_fields, "send_test_lead": _action_send_test_lead}


async def execute_audience_forms_edit(args: Dict[str, Any], ctx: ToolContext) -> str:
    action = str((args or {}).get("action") or "").strip()
    handler = _EDIT_ACTIONS.get(action)
    if handler is None:
        return json.dumps(_err("unknown_action", action=action, available=list(AUDIENCE_EDIT_ACTIONS)))
    result = await handler(args or {}, ctx)
    if isinstance(result, dict) and "action" not in result:
        result = {"action": action, **result}
    return json.dumps(result, ensure_ascii=False, default=str)


AUDIENCE_EDIT_TOOLS: Dict[str, ToolSpec] = {
    AUDIENCE_EDIT_TOOL_NAME: ToolSpec(
        name=AUDIENCE_EDIT_TOOL_NAME,
        schema=AUDIENCE_EDIT_SCHEMA,
        executor=execute_audience_forms_edit,
        required_permission=None,
        setting_key=AUDIENCE_EDIT_GROUP_KEY,
        default_enabled=False,
        default_roles=None,
        phase=3,
        mode="WRITE",
    ),
}


def _register_edit() -> None:
    from .assistant_tool_registry import ASSISTANT_TOOLS, GROUP_LABELS
    ASSISTANT_TOOLS.update(AUDIENCE_EDIT_TOOLS)
    GROUP_LABELS.update({AUDIENCE_EDIT_GROUP_KEY: "Lead forms: edit"})


_register_edit()
