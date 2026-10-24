"""
The ``sub_org_edit`` tool — set up and change sub-organisations, for the
Assistant and the MCP server.

Changes (each one ``preview`` → admin says yes → ``apply`` with the confirm_token)
    create     a new sub-org with its courses, payment option, seats, validity and roles —
               ``POST /institute/v1/sub-org/create-with-subscription``, exactly what the
               dashboard's 3-step "Create" wizard sends
    update     add courses, change seats / validity / roles / admin permissions —
               ``PATCH /institute/v1/sub-org/{id}/configuration`` (only the fields given)
    add_admin  make one person the sub-org's admin — ``POST /sub-org/v1/add-member`` with
               ROOT_ADMIN, like the dashboard's "Add admin user"

Safety (MCP has no confirm card):

* nothing is written without the confirm_token of a preview of the identical request
  (learner_data's HMAC tokens, 15 minutes);
* no delete / deactivate and no course removal (admin-core has neither); no payment-option
  swap (it re-bills the admin) — those stay in the dashboard;
* a sub-org must be a child of this institute; courses / payment options must be this
  institute's; add-member trusts its body, so these checks are the cross-tenant guard;
* never assumes a price, seat count, validity or admin role — the preview asks for each;
* a name already used by another sub-org, a create without courses (an empty shell the
  admin form then refuses) and a second admin (admin-core then picks "the" admin at
  random) are refused.
"""
from __future__ import annotations

import json
import logging
from typing import Any, Dict, List, Optional, Tuple

from . import course_builder_data as cbd
from . import learner_data as ld
from . import sub_org_data as sd
from .assistant_tool_registry import ToolContext, ToolSpec

logger = logging.getLogger(__name__)

EDIT_TOOL_NAME = "sub_org_edit"
EDIT_GROUP_KEY = "sub_org_edits"
EDIT_ACTIONS = ("preview", "apply")
CHANGES = ("create", "update", "add_admin")

MAX_COURSES = 30
MAX_SEATS = 100_000
MAX_VALIDITY_DAYS = 36_500

EDIT_SCHEMA: Dict[str, Any] = {
    "type": "function",
    "function": {
        "name": EDIT_TOOL_NAME,
        "description": (
            "Create a sub-organisation, change its set-up, or give it its admin. Never deletes or deactivates a "
            "sub-org and never removes a course from it (dashboard only). Every change is two calls: "
            "action='preview' (checks everything, saves nothing, returns what will happen + a confirm_token valid "
            "15 min) → show the admin and get a clear yes → action='apply' with the SAME arguments plus "
            "confirm_token. Pick `change`:\n"
            "- create: name, courses [{course_id, batch_id? (when the course has several batches)}] (at least one), "
            "payment_option_id (from sub_orgs(action='create_options') — ASK which; never pick a price), "
            "member_count (learner seats per course — ASK), validity_in_days (ASK), admin_roles [role names the "
            "sub-org's admin gets — ASK], team_roles? [roles that admin may give their own team], "
            "admin_permissions? (FULL default | CREATE_COURSE), vendor? (payment gateway, when the institute has "
            "several and the option is paid). Returns the sub-org and the admin's invite link.\n"
            "- update: sub_org_id + any of add_courses [{course_id, batch_id?}], member_count, validity_in_days, "
            "admin_roles, team_roles, admin_permissions. The preview shows before → after.\n"
            "- add_admin: sub_org_id + admin {full_name, email, mobile_number?}: makes that person the sub-org's "
            "admin on all its courses (an account is created when the email has none). Only when the sub-org has no "
            "admin yet. Alternative: send the admin the invite link from sub_orgs(action='get')."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "action": {"type": "string", "enum": list(EDIT_ACTIONS)},
                "change": {"type": "string", "enum": list(CHANGES)},
                "sub_org_id": {"type": "string", "description": "update / add_admin: from sub_orgs(action='list')."},
                "name": {"type": "string", "description": "create: the sub-organisation's name."},
                "courses": {"type": "array", "items": {"type": "object"},
                            "description": "create: [{course_id, batch_id?}]"},
                "add_courses": {"type": "array", "items": {"type": "object"},
                                "description": "update: courses to add, [{course_id, batch_id?}]"},
                "payment_option_id": {"type": "string", "description": "create: from create_options."},
                "member_count": {"type": "integer", "description": "Learner seats per course."},
                "validity_in_days": {"type": "integer"},
                "admin_roles": {"type": "array", "items": {"type": "string"}},
                "team_roles": {"type": "array", "items": {"type": "string"}},
                "admin_permissions": {"type": "array", "items": {"type": "string", "enum": list(sd.ADMIN_PERMISSIONS)}},
                "vendor": {"type": "string", "description": "create: payment gateway name (when several)."},
                "admin": {"type": "object", "description": "add_admin: {full_name, email, mobile_number?}"},
                "confirm_token": {"type": "string", "description": "apply: the token preview returned."},
            },
            "required": ["action", "change"],
        },
    },
}


def _err(code: str, **extra: Any) -> Dict[str, Any]:
    return {"error": code, **extra}


Plan = Dict[str, Any]  # {method, path, params, body, view}


# ── shared checks ────────────────────────────────────────────────────────

def _resolve_courses(ctx: ToolContext, specs: Any, field: str) -> Tuple[List[Dict[str, Any]], Optional[Dict[str, Any]]]:
    """[{course_id, batch_id?}] → [{batch_id, course_id, course, batch}] of this institute, or the first problem."""
    if not isinstance(specs, list) or not specs:
        return [], _err("missing_argument", needs=[field], message="Which course(s)? Pass [{course_id}].")
    if len(specs) > MAX_COURSES:
        return [], _err("too_many_courses", message=f"At most {MAX_COURSES} courses per call.")
    out, seen = [], set()
    for spec in specs:
        spec = spec if isinstance(spec, dict) else {"course_id": spec}
        course = cbd.course_row(ctx, str(spec.get("course_id") or ""))
        if not course:
            return [], _err("unknown_course", course_id=spec.get("course_id"),
                            message="No such course in this institute. Use courses(action='list').")
        batches = cbd.course_batches(ctx, course["id"])
        views = [{"batch_id": b["id"], "name": b["name"]} for b in batches]
        bid = str(spec.get("batch_id") or "")
        if not batches:
            return [], _err("no_batch", course=course.get("name"), message="This course has no active batch.")
        if bid:
            batch = next((b for b in batches if b["id"] == bid), None)
            if not batch:
                return [], _err("unknown_batch", course=course.get("name"), batches=views,
                                message="That batch_id is not a batch of this course.")
        elif len(batches) == 1:
            batch = batches[0]
        else:
            return [], _err("choose_batch", course=course.get("name"), batches=views,
                            message="This course has several batches (session × level). Ask the admin which one.")
        if batch["id"] in seen:
            continue
        seen.add(batch["id"])
        entry = {"batch_id": batch["id"], "course_id": course["id"], "course": course.get("name"),
                 "batch": batch["name"]}
        if course.get("status") != cbd.STATUS_ACTIVE:
            entry["warning"] = "Course not live yet."
        out.append(entry)
    return out, None


def _whole(value: Any, low: int, high: int) -> Optional[int]:
    """A whole number in [low, high] (an int, or digits as text), else None — 2.5 / True / '10 seats' are refused."""
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        n = value
    elif isinstance(value, str) and value.strip().isdigit():
        n = int(value.strip())
    else:
        return None
    return n if low <= n <= high else None


def _names(value: Any) -> Optional[List[str]]:
    """A list of non-blank names (deduplicated), or None when not a list."""
    if not isinstance(value, list):
        return None
    return list(dict.fromkeys(str(v).strip() for v in value if str(v or "").strip()))


async def _check_roles(ctx: ToolContext, field: str, roles: List[str]) -> Tuple[List[str], Optional[Dict[str, Any]]]:
    """→ (warnings, problem). Unknown role names are refused when the role list could be loaded."""
    available = await sd.roles(ctx)
    if available is not None:
        unknown = [r for r in roles if r not in available]
        if unknown:
            return [], _err("unknown_role", field=field, roles=unknown, available=available,
                            message="Not roles of this institute. Use the names sub_orgs(action='create_options') "
                                    "lists (or create the role in the dashboard first).")
    warnings = []
    if field == "admin_roles" and any(r.upper() == "ADMIN" for r in roles):
        warnings.append("admin_roles includes ADMIN: the sub-org's admin becomes an admin of the WHOLE institute "
                        "(every course, learner and setting), not only of their sub-org. Make sure the admin "
                        "wants that.")
    return warnings, None


def _check_permissions(value: Any) -> Tuple[Optional[List[str]], Optional[Dict[str, Any]]]:
    perms = _names(value)
    if perms is None:
        return None, _err("invalid_argument", field="admin_permissions",
                          message="admin_permissions is a list: FULL and/or CREATE_COURSE.")
    bad = [p for p in perms if p not in sd.ADMIN_PERMISSIONS]
    if bad:
        return None, _err("invalid_argument", field="admin_permissions", values=bad,
                          message="admin_permissions are FULL and / or CREATE_COURSE.")
    return perms, None


# ── create ───────────────────────────────────────────────────────────────

async def _plan_create(ctx: ToolContext, args: Dict[str, Any]) -> Tuple[Optional[Plan], Optional[Dict[str, Any]]]:
    name = " ".join(str(args.get("name") or "").split())
    questions = []
    if not name:
        questions.append({"field": "name", "ask": "What is the sub-organisation called?"})
    if not args.get("courses"):
        questions.append({"field": "courses", "ask": "Which course(s) does it get? (courses(action='list'))"})
    if not args.get("payment_option_id"):
        questions.append({"field": "payment_option_id",
                          "ask": "Which payment option does its admin pay through? (sub_orgs(action='create_options') "
                                 "lists them with prices)"})
    if args.get("member_count") in (None, ""):
        questions.append({"field": "member_count", "ask": "How many learner seats does it get (per course)?"})
    if args.get("validity_in_days") in (None, ""):
        questions.append({"field": "validity_in_days", "ask": "For how many days is the subscription valid?"})
    if not _names(args.get("admin_roles")):
        questions.append({"field": "admin_roles",
                          "ask": "Which role(s) should the sub-org's admin get? (create_options lists them)"})
    if questions:
        return None, _err("ask_admin", questions=questions,
                          message="Ask the admin for these (never assume a price, seat count, validity or role), "
                                  "then preview again. Nothing has been saved.")
    if not 2 <= len(name) <= 120:
        return None, _err("invalid_argument", field="name", message="The name must be 2-120 characters.")
    clash = sd.sub_orgs_named(ctx, name)
    if clash:
        return None, _err("name_taken", sub_org_id=clash[0]["id"],
                          message=f"This institute already has a sub-organisation called '{clash[0].get('name')}'. "
                                  "Pick another name, or change that one with change='update'.")
    courses, problem = _resolve_courses(ctx, args.get("courses"), "courses")
    if problem:
        return None, problem
    seats = _whole(args.get("member_count"), 1, MAX_SEATS)
    if seats is None:
        return None, _err("invalid_argument", field="member_count",
                          message=f"member_count is a whole number of seats (1-{MAX_SEATS}).")
    validity = _whole(args.get("validity_in_days"), 1, MAX_VALIDITY_DAYS)
    if validity is None:
        return None, _err("invalid_argument", field="validity_in_days",
                          message=f"validity_in_days is a whole number of days (1-{MAX_VALIDITY_DAYS}).")
    options = sd.payment_options(ctx)
    option = next((o for o in options if o["id"] == str(args.get("payment_option_id"))), None)
    if not option:
        return None, _err("unknown_payment_option", available=[sd.option_view(o) for o in options],
                          message="That payment_option_id is not an active payment option of this institute.")
    admin_roles = _names(args.get("admin_roles")) or []
    warnings, problem = await _check_roles(ctx, "admin_roles", admin_roles)
    if problem:
        return None, problem
    team_roles = _names(args.get("team_roles")) if args.get("team_roles") is not None else []
    if team_roles is None:
        return None, _err("invalid_argument", field="team_roles", message="team_roles is a list of role names.")
    if team_roles:
        _, problem = await _check_roles(ctx, "team_roles", team_roles)
        if problem:
            return None, problem
    perms, problem = _check_permissions(args.get("admin_permissions") if args.get("admin_permissions") is not None
                                        else ["FULL"])
    if problem:
        return None, problem

    ptype = str(option.get("type") or "").upper()
    body: Dict[str, Any] = {
        "sub_org_details": {"institute_name": name},
        "package_session_ids": [c["batch_id"] for c in courses],
        "payment_type": ptype,
        "member_count": seats,
        "validity_in_days": validity,
        "auth_roles": admin_roles,
        "admin_permissions": perms or ["FULL"],
    }
    if team_roles:
        body["allowed_team_roles"] = team_roles
    if ptype == "CPO":
        if not option.get("complex_payment_option_id"):
            return None, _err("invalid_payment_option", message="That instalment option has no plan behind it.")
        body["complex_payment_option_id"] = option["complex_payment_option_id"]
    else:
        body["payment_option_id"] = option["id"]
    if ptype in sd.GATEWAY_TYPES:
        gateways = await sd.vendors(ctx)
        wanted = str(args.get("vendor") or "").strip()
        if not gateways:
            return None, _err("no_payment_gateway",
                              message="This option is paid but the institute has no payment gateway set up. Pick a "
                                      "FREE / instalment option, or connect a gateway in Payment Settings first.")
        if wanted:
            gw = next((g for g in gateways if g["vendor"].casefold() == wanted.casefold()), None)
            if not gw:
                return None, _err("unknown_vendor", available=[g["vendor"] for g in gateways],
                                  message="That is not one of the institute's payment gateways.")
        elif len(gateways) == 1:
            gw = gateways[0]
        else:
            return None, _err("ask_admin", questions=[{"field": "vendor", "options": [g["vendor"] for g in gateways],
                                                       "ask": "Which payment gateway should the admin pay through?"}],
                              message="Ask the admin, then preview again with vendor.")
        body["vendor"], body["vendor_id"] = gw["vendor"], gw["vendor_id"]
        plan = (option.get("plans") or [{}])[0]
        body["currency"] = plan.get("currency") or "INR"
    view = {
        "name": name, "courses": courses, "payment_option": sd.option_view(option),
        "seats_per_course": seats, "validity_in_days": validity, "admin_roles": admin_roles,
        "team_roles": team_roles or "any role (no restriction)", "admin_permissions": body["admin_permissions"],
        **({"payment_gateway": body["vendor"]} if body.get("vendor") else {}),
        "after_creating": ("The sub-org has no admin yet. Then either give it one with change='add_admin', or send "
                           "the admin the invite link this returns (they pay through the option above when it is "
                           "paid)."),
    }
    if warnings:
        view["warnings"] = warnings
    return {"method": "POST", "path": sd.CREATE_PATH, "params": {"parentInstituteId": ctx.principal.institute_id},
            "body": body, "view": view}, None


# ── update ───────────────────────────────────────────────────────────────

_UPDATE_FIELDS = ("add_courses", "member_count", "validity_in_days", "admin_roles", "team_roles", "admin_permissions")


async def _plan_update(ctx: ToolContext, args: Dict[str, Any]) -> Tuple[Optional[Plan], Optional[Dict[str, Any]]]:
    org = sd.sub_org(ctx, args.get("sub_org_id"))
    if not org:
        return None, sd.unknown_sub_org_error(args.get("sub_org_id"))
    given = [f for f in _UPDATE_FIELDS if args.get(f) not in (None, "")]
    if args.get("payment_option_id"):
        return None, _err("not_supported", message="Changing the payment option re-bills the sub-org's admin — do it "
                                                   "from the dashboard (the sub-org's Edit dialog).")
    if not given:
        return None, _err("missing_argument", needs=list(_UPDATE_FIELDS), message="What should change?")
    invite_rows = sd.invites(ctx, org["id"])
    main = sd.org_invite(invite_rows)
    if not main:
        return None, _err("not_configurable", message="This sub-org was created without courses or a plan, so it has "
                                                      "no settings to change. Set it up in the dashboard.")
    setting = main.get("setting") or {}
    current_batches = sd.sub_org_batches(ctx, invite_rows)
    body: Dict[str, Any] = {}
    changes: List[Dict[str, Any]] = []
    warnings: List[str] = []

    if args.get("add_courses") not in (None, ""):
        courses, problem = _resolve_courses(ctx, args.get("add_courses"), "add_courses")
        if problem:
            return None, problem
        have = {b["batch_id"] for b in current_batches}
        new = [c for c in courses if c["batch_id"] not in have]
        if not new:
            return None, _err("nothing_to_add", message="The sub-org already has every course listed.")
        body["add_package_session_ids"] = [c["batch_id"] for c in new]
        changes.append({"field": "courses", "before": [f"{b['course']} ({b['batch']})" for b in current_batches],
                        "add": new})
        warnings.append("The sub-org's admin and team get the new course(s) at once; its learners are not enrolled "
                        "into them (use sub_org_enroll).")
    if args.get("member_count") not in (None, ""):
        seats = _whole(args.get("member_count"), 1, MAX_SEATS)
        if seats is None:
            return None, _err("invalid_argument", field="member_count",
                              message=f"member_count is a whole number of seats (1-{MAX_SEATS}).")
        used = sd.used_seats(ctx, org["id"], [b["batch_id"] for b in current_batches])
        busiest = max(used.values(), default=0)
        if seats < busiest:
            return None, _err("below_usage", used=busiest,
                              message=f"A course of this sub-org already has {busiest} learners — the cap cannot go "
                                      "below that. Remove learners in the dashboard first.")
        body["member_count"] = seats
        changes.append({"field": "seats_per_course", "before": sd.seat_cap(ctx, org["id"], main), "after": seats})
    if args.get("validity_in_days") not in (None, ""):
        validity = _whole(args.get("validity_in_days"), 1, MAX_VALIDITY_DAYS)
        if validity is None:
            return None, _err("invalid_argument", field="validity_in_days",
                              message=f"validity_in_days is a whole number of days (1-{MAX_VALIDITY_DAYS}).")
        body["validity_in_days"] = validity
        changes.append({"field": "validity_in_days", "before": main.get("learner_access_days"), "after": validity})
        warnings.append("The new validity applies to people who join from now on; existing plans keep their end date.")
    for field, key, label in (("admin_roles", "auth_roles", "AUTH_ROLES"),
                              ("team_roles", "allowed_team_roles", "ALLOWED_TEAM_ROLES")):
        if args.get(field) is None:
            continue
        names = _names(args.get(field))
        if names is None or (field == "admin_roles" and not names):
            return None, _err("invalid_argument", field=field,
                              message=f"{field} is a list of role names" +
                                      (" (at least one)." if field == "admin_roles" else "."))
        if names:
            more, problem = await _check_roles(ctx, field, names)
            if problem:
                return None, problem
            warnings += more
        body[key] = names
        changes.append({"field": field, "before": setting.get(label) or [], "after": names or "any role"})
    if args.get("admin_permissions") not in (None, ""):
        perms, problem = _check_permissions(args.get("admin_permissions"))
        if problem:
            return None, problem
        body["admin_permissions"] = perms
        changes.append({"field": "admin_permissions", "before": setting.get("ADMIN_PERMISSIONS") or ["FULL"],
                        "after": perms or ["FULL"]})
        warnings.append("New admin permissions apply to admins added from now on; the current admin keeps theirs.")
    if "admin_roles" in args and args.get("admin_roles") is not None:
        warnings.append("New admin roles apply to admins added from now on.")
    view = {"sub_org": org.get("name"), "sub_org_id": org["id"], "changes": changes}
    if warnings:
        view["notes"] = list(dict.fromkeys(warnings))
    return {"method": "PATCH", "path": sd.config_path(org["id"]),
            "params": {"parentInstituteId": ctx.principal.institute_id}, "body": body, "view": view}, None


# ── add_admin ────────────────────────────────────────────────────────────

async def _plan_add_admin(ctx: ToolContext, args: Dict[str, Any]) -> Tuple[Optional[Plan], Optional[Dict[str, Any]]]:
    org = sd.sub_org(ctx, args.get("sub_org_id"))
    if not org:
        return None, sd.unknown_sub_org_error(args.get("sub_org_id"))
    admin = args.get("admin") if isinstance(args.get("admin"), dict) else {}
    email = str(admin.get("email") or "").strip().lower()
    name = " ".join(str(admin.get("full_name") or "").split())
    phone = str(admin.get("mobile_number") or "").strip()
    problems = []
    if not ld.valid_email(email):
        problems.append("admin.email must be a valid email (it is their login).")
    if not name:
        problems.append("admin.full_name is required.")
    if phone and not ld.valid_phone(phone):
        problems.append(f"'{phone}' is not a valid mobile number.")
    if problems:
        return None, _err("invalid_admin", problems=problems)
    existing = sd.admins(ctx, org["id"])
    if existing:
        a = existing[0]
        return None, _err("admin_exists", admin={"name": a.get("full_name"), "email": a.get("email")},
                          message="This sub-org already has an admin. Adding a second one is done from the dashboard "
                                  "(the sub-org's members), so billing and seat checks keep one owner.")
    invite_rows = sd.invites(ctx, org["id"])
    main = sd.org_invite(invite_rows)
    courses = sd.sub_org_batches(ctx, invite_rows)
    if not main or not courses:
        return None, _err("no_courses", message="This sub-org has no courses yet — add some with change='update' first.")
    roles = (main.get("setting") or {}).get("AUTH_ROLES") or []
    if not roles:
        return None, _err("no_admin_roles", message="The sub-org has no admin roles set. Set admin_roles with "
                                                    "change='update' first.")
    body: Dict[str, Any] = {
        "user": {k: v for k, v in {"email": email, "full_name": name, "mobile_number": phone or None,
                                   "roles": [str(roles[0])]}.items() if v},
        "package_session_ids": [c["batch_id"] for c in courses],
        "sub_org_id": org["id"],
        "institute_id": ctx.principal.institute_id,  # forced — never model-supplied
        "status": "ACTIVE",
        "comma_separated_org_roles": sd.ROOT_ADMIN,
    }
    toggles = await ld.notification_toggles(ctx)
    automations = await ld.enrolment_automations(ctx, body["package_session_ids"], event=sd.SUB_ORG_ENROLMENT_EVENT)
    view = {
        "sub_org": org.get("name"), "admin": {"full_name": name, "email": email, **({"mobile_number": phone}
                                                                                   if phone else {})},
        "role": roles[0], "courses": [f"{c['course']} ({c['batch']})" for c in courses],
        "plan": {"payment_option": main.get("payment_option_name"), "payment_type": main.get("payment_type")},
        "emails": {"login_details_email": ("sent to them if this is a new account (Course Settings → "
                                           "'Send credentials' is on)" if toggles["send_credentials"]
                                           else "not sent (turned off in Course Settings)")},
        "notes": ["An email that already has a Vacademy account is used as is (its name and phone are kept).",
                  "Payments for the admin's plan are recorded from the dashboard."],
    }
    named = sorted({n for names in automations.values() for n in names})
    if named:
        view["emails"]["automations_that_run"] = named
    return {"method": "POST", "path": sd.ADD_MEMBER_PATH, "params": None, "body": body, "view": view}, None


_PLANNERS = {"create": _plan_create, "update": _plan_update, "add_admin": _plan_add_admin}


def _signed(change: str, plan: Plan) -> Dict[str, Any]:
    return {"change": change, "path": plan["path"], "body": plan["body"]}


# ── actions ──────────────────────────────────────────────────────────────

async def _build(args: Dict[str, Any], ctx: ToolContext) -> Tuple[str, Optional[Plan], Optional[Dict[str, Any]]]:
    change = str(args.get("change") or "").strip()
    planner = _PLANNERS.get(change)
    if planner is None:
        return change, None, _err("unknown_change", change=change, available=list(CHANGES))
    plan, problem = await planner(ctx, args)
    return change, plan, problem


async def _action_preview(args: Dict[str, Any], ctx: ToolContext) -> Dict[str, Any]:
    change, plan, problem = await _build(args, ctx)
    if problem:
        return {"change": change, **problem}
    return {"change": change, "preview": True, "will_do": plan["view"],
            "confirm_token": ld.issue_token(ctx, EDIT_TOOL_NAME, _signed(change, plan)),
            "next": ("Show the admin exactly this and ask them to confirm. On a clear yes call "
                     "sub_org_edit(action='apply') with the SAME arguments and this confirm_token.")}


async def _action_apply(args: Dict[str, Any], ctx: ToolContext) -> Dict[str, Any]:
    change, plan, problem = await _build(args, ctx)
    if problem:
        return {"change": change, **problem}
    reason = ld.check_token(ctx, EDIT_TOOL_NAME, _signed(change, plan), args.get("confirm_token"))
    if reason:
        return {"change": change, **ld.token_error(reason, EDIT_TOOL_NAME)}
    response = await cbd.admin_core(ctx, plan["method"], plan["path"], params=plan["params"], body=plan["body"],
                                    timeout=90.0)
    if cbd.is_error(response):
        return {"change": change, **_err("apply_failed", message="admin-core refused the change.",
                                         detail=response.get("message"))}
    out: Dict[str, Any] = {"change": change, "done": True, "manage_url": sd.manage_url(ctx)}
    data = response if isinstance(response, dict) else {}
    if change == "create":
        out.update(sub_org_id=data.get("sub_org_id"), invite_code=data.get("invite_code"),
                   invite_link=data.get("short_url"),
                   next=("Give it its admin with sub_org_edit(change='add_admin'), or send the admin this invite "
                         "link (it makes whoever uses it the sub-org's admin — share it only with them). Then add "
                         "learners with sub_org_enroll."))
    elif change == "update":
        out["applied"] = data.get("applied")
    else:
        user = data.get("user") if isinstance(data.get("user"), dict) else {}
        out.update(admin={"learner_id": user.get("id"), "email": user.get("email"), "username": user.get("username")},
                   message=data.get("message"),
                   next="They sign in to the admin dashboard with this email. To resend their login details use the "
                        "sub-org's 'Share credentials' in the dashboard.")
    return out


_ACTIONS = {"preview": _action_preview, "apply": _action_apply}


async def execute_sub_org_edit(args: Dict[str, Any], ctx: ToolContext) -> str:
    action = str((args or {}).get("action") or "").strip()
    handler = _ACTIONS.get(action)
    if handler is None:
        return json.dumps(_err("unknown_action", action=action, available=list(EDIT_ACTIONS)))
    result = await handler(args or {}, ctx)
    if isinstance(result, dict) and "action" not in result:
        result = {"action": action, **result}
    return json.dumps(result, ensure_ascii=False, default=str)


EDIT_TOOLS: Dict[str, ToolSpec] = {
    EDIT_TOOL_NAME: ToolSpec(
        name=EDIT_TOOL_NAME,
        schema=EDIT_SCHEMA,
        executor=execute_sub_org_edit,
        required_permission=None,
        setting_key=EDIT_GROUP_KEY,
        default_enabled=False,
        default_roles=None,
        phase=3,
        mode="WRITE",
    ),
}


def _register() -> None:
    from .assistant_tool_registry import ASSISTANT_TOOLS, GROUP_LABELS
    ASSISTANT_TOOLS.update(EDIT_TOOLS)
    GROUP_LABELS.update({EDIT_GROUP_KEY: "Sub-organisations: create and change"})


_register()

__all__ = ["EDIT_TOOLS", "EDIT_TOOL_NAME", "EDIT_GROUP_KEY", "EDIT_ACTIONS", "CHANGES", "EDIT_SCHEMA",
           "execute_sub_org_edit"]
