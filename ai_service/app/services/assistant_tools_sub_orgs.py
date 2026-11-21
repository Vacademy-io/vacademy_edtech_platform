"""
The ``sub_orgs`` tool — read-only views of the institute's sub-organisations
(channel partners / centres, named by the institute's terminology), for the
Assistant and the MCP server.

Actions
    list             the sub-orgs (admin-core's Manage list: admin, plan status, seats, invite)
    get              one sub-org: its courses, seats used per course, admins, settings, invite link
    members          its learners (one row per learner, with their courses)
    create_options   what a new sub-org is set up with: payment options, gateways, roles, permissions
    enroll_template  the CSV columns sub_org_enroll takes

Everything is scoped to the pinned institute (see services/sub_org_data.py).
"""
from __future__ import annotations

import json
import logging
from typing import Any, Dict

from . import course_builder_data as cbd
from . import learner_data as ld
from . import sub_org_data as sd
from .assistant_tool_registry import ToolContext, ToolSpec

logger = logging.getLogger(__name__)

SUB_ORGS_TOOL_NAME = "sub_orgs"
SUB_ORGS_GROUP_KEY = "sub_orgs"
SUB_ORGS_ACTIONS = ("list", "get", "members", "create_options", "enroll_template")

_MAX_LIST = 200
_MAX_MEMBERS = 500

#: Columns of the sub-org bulk-enrol CSV — the profile fields /sub-org/v1/add-member takes.
#: (key, label, sample). Email is always required: it is the login the member endpoint matches on.
SUB_ORG_TEMPLATE_COLUMNS = (
    ("email", "Email", "student@example.com"),
    ("full_name", "Full name", "John Doe"),
    ("mobile_number", "Mobile number (with country code)", "+91 9876543210"),
    ("username", "Username (no spaces; default: email)", ""),
    ("password", "Password (default: generated)", ""),
    ("gender", "Gender (MALE / FEMALE / OTHER)", "MALE"),
    ("date_of_birth", "Date of birth (YYYY-MM-DD)", "2000-01-15"),
    ("address_line", "Address", ""),
    ("city", "City", ""),
    ("region", "State / region", ""),
    ("pin_code", "PIN code", ""),
)

SUB_ORGS_SCHEMA: Dict[str, Any] = {
    "type": "function",
    "function": {
        "name": SUB_ORGS_TOOL_NAME,
        "description": (
            "Look up the institute's sub-organisations (partner organisations / centres — call them by the "
            "institute's own term from whoami). Read-only. Pick an `action`:\n"
            "- list (query?): every sub-org with its admin, plan status, seats used / total and invite code. "
            "When several match a name, list them and ask which one.\n"
            "- get (sub_org_id): its courses (batches), seats used per course against the cap, admins, the "
            "settings it was created with (admin roles, team roles, admin permissions, validity, payment option) "
            "and the admin's invite link.\n"
            "- members (sub_org_id, query?, include_inactive?): its learners with their courses and status.\n"
            "- create_options: what sub_org_edit(change='create') needs — the institute's payment options (with "
            "prices), payment gateways, the roles a sub-org admin can be given and the admin permissions. The "
            "courses come from courses(action='list').\n"
            "- enroll_template: the CSV columns sub_org_enroll takes (with the institute's custom fields) as a "
            "header + sample row — hand it to the admin as a .csv file to fill in."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "action": {"type": "string", "enum": list(SUB_ORGS_ACTIONS)},
                "sub_org_id": {"type": "string", "description": "get / members: the sub_org_id from list."},
                "query": {"type": "string", "description": "list: part of the name. members: name or email."},
                "include_inactive": {"type": "boolean",
                                     "description": "members: also list terminated / expired learners."},
            },
            "required": ["action"],
        },
    },
}


def _err(code: str, **extra: Any) -> Dict[str, Any]:
    return {"error": code, **extra}


def _day(value: Any) -> Any:
    return str(value)[:10] if value else None


async def _action_list(args: Dict[str, Any], ctx: ToolContext) -> Dict[str, Any]:
    # admin-core's own list, with the caller's token: it applies the same visibility as the dashboard.
    data = await cbd.admin_core(ctx, "GET", sd.LIST_PATH, params={
        "parentInstituteId": ctx.principal.institute_id, "page": 0, "size": _MAX_LIST})
    if cbd.is_error(data):
        return _err("list_failed", message="The sub-organisations could not be loaded.", detail=data.get("message"))
    rows = data.get("content") if isinstance(data, dict) else data
    total = data.get("totalElements") if isinstance(data, dict) else None
    query = str(args.get("query") or "").strip().casefold()
    out = []
    for r in rows or []:
        if not isinstance(r, dict):
            continue
        if query and query not in str(r.get("name") or "").casefold():
            continue
        out.append({
            "sub_org_id": r.get("suborg_id"), "name": r.get("name"), "status": r.get("status"),
            "admin": ({"name": r.get("admin_name"), "email": r.get("admin_email"), "phone": r.get("admin_phone")}
                      if r.get("admin_user_id") else None),
            "plan_status": r.get("plan_status"),
            "learners": r.get("learner_count"),
            "seats": {"used": r.get("used_seats"), "total": r.get("total_seats")},
            "invite_code": r.get("invite_code"), "invite_link": r.get("short_url"),
            "city": r.get("city"), "created_on": _day(r.get("created_at")),
        })
    return {"sub_orgs": out, "count": len(out), "total": total,
            "more_may_exist": bool(total and total > _MAX_LIST) or None,
            "manage_url": sd.manage_url(ctx),
            "note": None if out else ("No sub-organisation matches." if query else
                                      "This institute has no sub-organisations yet — sub_org_edit(change='create') "
                                      "sets one up.")}


async def _action_get(args: Dict[str, Any], ctx: ToolContext) -> Dict[str, Any]:
    org = sd.sub_org(ctx, args.get("sub_org_id"))
    if not org:
        return sd.unknown_sub_org_error(args.get("sub_org_id"))
    invite_rows = sd.invites(ctx, org["id"])
    main = sd.org_invite(invite_rows)
    courses = sd.sub_org_batches(ctx, invite_rows)
    cap = sd.seat_cap(ctx, org["id"], main)
    used = sd.used_seats(ctx, org["id"], [c["batch_id"] for c in courses])
    setting = (main or {}).get("setting") or {}
    out: Dict[str, Any] = {
        "sub_org": {"sub_org_id": org["id"], "name": org.get("name"), "status": org.get("status"),
                    "created_on": _day(org.get("created_at"))},
        "courses": [{**{k: c[k] for k in ("course_id", "course", "batch_id", "batch")},
                     "learners": used.get(c["batch_id"], 0),
                     **({"seats_left": max(0, cap - used.get(c["batch_id"], 0))} if cap else {}),
                     **({"warning": "Course not live yet."} if c.get("course_status") != cbd.STATUS_ACTIVE else {})}
                    for c in courses],
        "seats_per_course": cap,
        "seats_note": ("Each course of the sub-org can hold this many learners (admins excluded)." if cap else
                       "No seat cap is set — any number of learners can be added."),
        "admins": [{"learner_id": a["user_id"], "name": a.get("full_name"), "email": a.get("email"),
                    "status": a.get("status")} for a in sd.admins(ctx, org["id"])],
        "settings": {
            "admin_roles": setting.get("AUTH_ROLES") or [],
            "team_roles": setting.get("ALLOWED_TEAM_ROLES") or [],
            "admin_permissions": setting.get("ADMIN_PERMISSIONS") or ["FULL"],
            "validity_in_days": (main or {}).get("learner_access_days"),
            "payment_option": ({"payment_option_id": main.get("payment_option_id"),
                                "name": main.get("payment_option_name"), "payment_type": main.get("payment_type")}
                               if main and main.get("payment_option_id") else None),
        },
        "invite": ({"invite_code": main.get("invite_code"), "invite_link": main.get("short_url"),
                    "note": "The sub-org's admin enrols through this link (it makes them the sub-org's admin) — "
                            "share it only with the admin, never with learners."} if main else None),
        "manage_url": sd.manage_url(ctx),
    }
    if not courses:
        out["warning"] = ("This sub-org has no courses yet — add some with sub_org_edit(change='update', "
                          "add_courses=…) before enrolling anyone.")
    if not setting.get("AUTH_ROLES"):
        out.setdefault("warnings", []).append(
            "No admin roles are set, so the invite link cannot make anyone the admin. Set admin_roles with "
            "sub_org_edit(change='update').")
    return out


async def _action_members(args: Dict[str, Any], ctx: ToolContext) -> Dict[str, Any]:
    org = sd.sub_org(ctx, args.get("sub_org_id"))
    if not org:
        return sd.unknown_sub_org_error(args.get("sub_org_id"))
    statuses = ["ACTIVE"] + (["INACTIVE", "TERMINATED", "INVITED", "PENDING_FOR_APPROVAL"]
                             if args.get("include_inactive") is True else [])
    rows = sd.members(ctx, org["id"], statuses=statuses, query=str(args.get("query") or ""), limit=_MAX_MEMBERS)
    names = {b["batch_id"]: b for b in sd.batches(ctx, list(dict.fromkeys(r["package_session_id"] for r in rows)))}
    people: Dict[str, Dict[str, Any]] = {}
    for r in rows:
        person = people.setdefault(r["user_id"], {"learner_id": r["user_id"], "full_name": r.get("full_name"),
                                                  "email": r.get("email"), "mobile_number": r.get("mobile_number"),
                                                  "courses": []})
        b = names.get(r["package_session_id"]) or {}
        person["courses"].append({"course": b.get("course"), "batch": b.get("batch"), "status": r.get("status"),
                                  "enrolled_on": _day(r.get("enrolled_date")),
                                  "expires_on": _day(r.get("expiry_date"))})
    out = list(people.values())
    return {"sub_org": org.get("name"), "members": out, "count": len(out),
            "more_may_exist": len(rows) >= _MAX_MEMBERS or None,
            "note": None if out else "No learners in this sub-org yet."}


async def _action_create_options(args: Dict[str, Any], ctx: ToolContext) -> Dict[str, Any]:
    options = sd.payment_options(ctx)
    role_names = await sd.roles(ctx)
    gateways = await sd.vendors(ctx)
    return {
        "payment_options": [sd.option_view(o) for o in options],
        "payment_note": ("The sub-org's admin pays through one of these (FREE, one-time, subscription or an "
                         "instalment plan). ASK the admin which one — never pick a price for them. New options are "
                         "made in Payment Settings." if options else
                         "This institute has no active payment option — create one in Payment Settings (or with "
                         "course_invites_edit) first."),
        "payment_gateways": [g["vendor"] for g in gateways],
        "admin_roles_available": role_names,
        "roles_note": ("admin_roles are the roles the sub-org's admin gets when they join (team_roles: the roles "
                       "that admin may give their own team). 'ADMIN' would make them an admin of the WHOLE "
                       "institute — say so if the admin picks it." if role_names is not None else
                       "The role list could not be loaded right now."),
        "admin_permissions_available": list(sd.ADMIN_PERMISSIONS),
        "needs": ["name", "courses (from courses(action='list'))", "payment_option_id", "member_count (learner "
                  "seats per course)", "validity_in_days", "admin_roles"],
    }


async def _action_enroll_template(args: Dict[str, Any], ctx: ToolContext) -> Dict[str, Any]:
    required = {"email", "full_name"}
    columns = [{"column": k, "label": label, "required": k in required} for k, label, _ in SUB_ORG_TEMPLATE_COLUMNS]
    samples = [s for _, _, s in SUB_ORG_TEMPLATE_COLUMNS]
    for f in await ld.custom_field_catalogue(ctx):
        col = {"column": ld.cf_column(f["label"]), "label": f["label"], "required": bool(f.get("required")),
               "custom_field_id": f["field_id"]}
        if f.get("options"):
            col["options"] = f["options"]
        columns.append(col)
        samples.append("")
    header = ",".join(c["column"] for c in columns)
    sample = ",".join(f'"{s}"' if "," in s else s for s in samples)
    return {"columns": columns, "csv": f"{header}\n{sample}\n", "file_name": "sub_org_learners_template.csv",
            "notes": ["Required: email and full_name (email is the learner's login).",
                      "Every row joins the SAME sub-org courses chosen in sub_org_enroll (all of them by default).",
                      "A row whose email already has an account enrols that account; its profile is not changed.",
                      "Delete the sample row before uploading."]}


_ACTIONS = {
    "list": _action_list,
    "get": _action_get,
    "members": _action_members,
    "create_options": _action_create_options,
    "enroll_template": _action_enroll_template,
}


async def execute_sub_orgs(args: Dict[str, Any], ctx: ToolContext) -> str:
    action = str((args or {}).get("action") or "").strip()
    handler = _ACTIONS.get(action)
    if handler is None:
        return json.dumps(_err("unknown_action", action=action, available=list(SUB_ORGS_ACTIONS)))
    result = await handler(args or {}, ctx)
    if isinstance(result, dict) and "action" not in result:
        result = {"action": action, **result}
    return json.dumps(result, ensure_ascii=False, default=str)


SUB_ORGS_TOOLS: Dict[str, ToolSpec] = {
    SUB_ORGS_TOOL_NAME: ToolSpec(
        name=SUB_ORGS_TOOL_NAME,
        schema=SUB_ORGS_SCHEMA,
        executor=execute_sub_orgs,
        required_permission=None,
        setting_key=SUB_ORGS_GROUP_KEY,
        default_enabled=False,
        default_roles=["ADMIN"],
        phase=2,
        mode="READ",
    ),
}


def _register() -> None:
    from .assistant_tool_registry import ASSISTANT_TOOLS, GROUP_LABELS
    ASSISTANT_TOOLS.update(SUB_ORGS_TOOLS)
    GROUP_LABELS.update({SUB_ORGS_GROUP_KEY: "Sub-organisations: view"})


_register()

__all__ = ["SUB_ORGS_TOOLS", "SUB_ORGS_TOOL_NAME", "SUB_ORGS_GROUP_KEY", "SUB_ORGS_ACTIONS", "SUB_ORGS_SCHEMA",
           "SUB_ORG_TEMPLATE_COLUMNS", "execute_sub_orgs"]
