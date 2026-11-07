"""
The ``learners`` tool — read-only lookups behind enrolling and editing
learners, for the Assistant and the MCP server.

Actions
    find              learners matching a name / email / phone / username, with their courses
    get               one learner's full profile + enrolments (what learner_edit can change)
    enroll_options    for courses: their batches and the invites a learner can be enrolled through
    enroll_template   the institute's bulk-enrol CSV columns (same as the dashboard's template)

Everything is scoped to the pinned institute; a user with no enrolment in it
is invisible here.
"""
from __future__ import annotations

import json
import logging
from typing import Any, Dict, List

from . import course_builder_data as cbd
from . import learner_data as ld
from .assistant_tool_registry import ToolContext, ToolSpec

logger = logging.getLogger(__name__)

LEARNERS_TOOL_NAME = "learners"
LEARNERS_GROUP_KEY = "learners"
LEARNERS_ACTIONS = ("find", "get", "enroll_options", "enroll_template")

_MAX_COURSES = 10

#: Profile columns of the bulk-enrol CSV, in the dashboard template's order.
#: (key, label, sample). email / mobile_number are required per USER_IDENTIFIER.
TEMPLATE_COLUMNS = (
    ("email", "Email", "student@example.com"),
    ("full_name", "Full name", "John Doe"),
    ("mobile_number", "Mobile number (with country code)", "+91 9876543210"),
    ("username", "Username (no spaces; default: email)", ""),
    ("password", "Password (default: generated)", ""),
    ("address_line", "Address", ""),
    ("pin_code", "PIN code", ""),
    ("payment_date", "Payment date (DD/MM/YYYY)", "15/01/2025"),
    ("transaction_id", "Transaction ID", ""),
    ("gender", "Gender (MALE / FEMALE / OTHER)", "MALE"),
    ("date_of_birth", "Date of birth (YYYY-MM-DD)", "2000-01-15"),
    ("city", "City", ""),
    ("region", "State / region", ""),
    ("linked_institute_name", "School / college", ""),
    ("fathers_name", "Father's name", ""),
    ("mothers_name", "Mother's name", ""),
    ("parents_mobile_number", "Father's mobile", ""),
    ("parents_email", "Father's email", ""),
    ("parents_to_mother_mobile_number", "Mother's mobile", ""),
    ("parents_to_mother_email", "Mother's email", ""),
)

LEARNERS_SCHEMA: Dict[str, Any] = {
    "type": "function",
    "function": {
        "name": LEARNERS_TOOL_NAME,
        "description": (
            "Look up the institute's learners, and what is needed to enrol or edit them. Read-only. Pick an "
            "`action`:\n"
            "- find (query): learners whose name, email, phone or username matches, with their courses. When "
            "several match, list them (name, email, phone, courses) and ask the admin which one — never guess.\n"
            "- get (learner_id): one learner's full profile and enrolments — the fields learner_edit can change.\n"
            "- enroll_options (course_ids: [..], max 10): each course's batches and the invites a learner can be "
            "enrolled through (name, price / payment type, default or not). Ask the admin which invite to use "
            "when a course has more than one. Batches sold to organisations are marked enrollable=false (enrol "
            "those from the dashboard). Also says whether the welcome email / login-details email may be sent, "
            "and which automations run on enrolment (they may send their own welcome message).\n"
            "- enroll_template: the bulk-enrol CSV columns (same as the dashboard's template) as a header + "
            "sample row — hand it to the admin as a .csv file to fill in, then pass the rows (or the CSV text) "
            "to learner_enroll."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "action": {"type": "string", "enum": list(LEARNERS_ACTIONS)},
                "query": {"type": "string", "description": "find: name, email, phone or username (part is fine)."},
                # NOT `user_id`: the tool runner overwrites a top-level user_id with the CALLER's id.
                "learner_id": {"type": "string", "description": "get: the learner's learner_id (from find)."},
                "course_ids": {"type": "array", "items": {"type": "string"},
                               "description": "enroll_options: course ids from courses(action='list')."},
            },
            "required": ["action"],
        },
    },
}


def _err(code: str, **extra: Any) -> Dict[str, Any]:
    return {"error": code, **extra}


def _brief(p: Dict[str, Any], enrolments: List[Dict[str, Any]]) -> Dict[str, Any]:
    return {"learner_id": p["user_id"], "full_name": p.get("full_name"), "email": p.get("email"),
            "mobile_number": p.get("mobile_number"), "username": p.get("username"),
            "courses": [{"course": e["course"], "batch": e["batch"], "status": e["status"]} for e in enrolments[:8]]}


async def _action_find(args: Dict[str, Any], ctx: ToolContext) -> Dict[str, Any]:
    query = str(args.get("query") or "").strip()
    if len(query) < 2:
        return _err("missing_argument", action="find", needs=["query (at least 2 characters)"])
    matches = ld.search_learners(ctx, query, limit=10)
    enrolled = ld.enrolments(ctx, [m["user_id"] for m in matches])
    out = [_brief(m, enrolled.get(m["user_id"], [])) for m in matches]
    note = None
    if len(out) > 1:
        note = "Several learners match — show them to the admin and ask which one they mean."
    elif not out:
        note = "No learner of this institute matches. Try part of the name, the email or the phone number."
    return {"matches": out, "count": len(out), "more_may_exist": len(out) == 10, "note": note}


async def _action_get(args: Dict[str, Any], ctx: ToolContext) -> Dict[str, Any]:
    learner_id = ld.target_learner_id(args)
    if not learner_id:
        return ld.missing_learner_error()
    profile = ld.learner_profile(ctx, learner_id)
    if not profile:
        return _err("unknown_learner", message="No learner of this institute has that learner_id. Use "
                                               "learners(action='find').")
    learner = {"learner_id": profile["user_id"], **{k: v for k, v in profile.items() if k != "user_id"}}
    return {"learner": learner, "enrolments": ld.enrolments(ctx, [profile["user_id"]]).get(profile["user_id"], []),
            "custom_fields_available": [{"field_id": f["field_id"], "label": f["label"], "type": f["type"],
                                         **({"options": f["options"]} if f.get("options") else {})}
                                        for f in await ld.custom_field_catalogue(ctx)],
            "editable": "learner_edit can change every field above except email and username, plus the password "
                        "and custom fields."}


def invite_view(inv: Dict[str, Any]) -> Dict[str, Any]:
    plans = [{"name": p.get("name"), "price": p.get("actual_price"), "currency": p.get("currency") or inv.get("currency"),
              "validity_days": p.get("validity_in_days")} for p in inv.get("plans") or []]
    return {"invite_id": inv["id"], "name": inv.get("name"), "is_default": bool(inv.get("is_default")),
            "payment_type": inv.get("payment_type") or "FREE", "payment_option": inv.get("payment_option_name"),
            "plans": plans, "access_days": inv.get("learner_access_days"),
            **({"note": "Instalment plan: fee bills follow the plan's own schedule (instalment overrides are set "
                        "from the dashboard)."} if (inv.get("payment_type") or "").upper() == "CPO" else {})}


def enrollable_invites(ctx: ToolContext, batch_id: str) -> List[Dict[str, Any]]:
    """Invites of this institute a learner may be enrolled through into this batch (the dashboard's picker)."""
    out = []
    for inv in cbd.invites_for_batches(ctx, [batch_id]):
        if str(inv.get("status") or "").upper() != "ACTIVE":
            continue
        # Enrolling through a bare SUB_ORG invite makes the learner a ROOT_ADMIN; the dashboard hides them too.
        if str(inv.get("tag") or "").strip().upper() == "SUB_ORG":
            continue
        out.append(inv)
    return out


async def _action_enroll_options(args: Dict[str, Any], ctx: ToolContext) -> Dict[str, Any]:
    ids = [str(x) for x in (args.get("course_ids") or []) if x]
    if not ids:
        return _err("missing_argument", action="enroll_options", needs=["course_ids"])
    if len(ids) > _MAX_COURSES:
        return _err("too_many_courses", message=f"At most {_MAX_COURSES} courses per call.")
    courses, unknown = [], []
    for cid in dict.fromkeys(ids):
        course = cbd.course_row(ctx, cid)
        if not course:
            unknown.append(cid)
            continue
        batches = cbd.course_batches(ctx, cid)
        org = ld.org_associated_batches(ctx, [b["id"] for b in batches])
        views = []
        for b in batches:
            view = {"batch_id": b["id"], "name": b["name"], "enrolled": b.get("enrolled", 0)}
            if b["id"] in org:
                view.update(enrollable=False, reason="Sold to organisations — enrol from the dashboard.")
            else:
                view.update(enrollable=True, invites=[invite_view(i) for i in enrollable_invites(ctx, b["id"])])
                if not view["invites"]:
                    view["note"] = "No active invite — create one with course_invites_edit(create_invite) first."
            views.append(view)
        entry = {"course_id": cid, "name": course.get("name"), "status": course.get("status"), "batches": views}
        if course.get("status") != cbd.STATUS_ACTIVE:
            entry["warning"] = "This course is not live yet; learners enrolled now see it only once it is approved."
        courses.append(entry)
    toggles = await ld.notification_toggles(ctx)
    automations = await ld.enrolment_automations(
        ctx, [b["batch_id"] for c in courses for b in c["batches"] if b.get("enrollable")])
    for c in courses:
        for b in c["batches"]:
            if automations.get(b["batch_id"]):
                b["automations_on_enrolment"] = automations[b["batch_id"]]
    return {"courses": courses, "unknown_course_ids": unknown or None,
            "options_allowed": {"send_welcome_email": toggles["notify_learners"],
                                "send_credentials": toggles["send_credentials"]},
            "user_identifier": await ld.user_identifier(ctx)}


async def _action_enroll_template(args: Dict[str, Any], ctx: ToolContext) -> Dict[str, Any]:
    identifier = await ld.user_identifier(ctx)
    required = {"full_name", "mobile_number" if identifier == "PHONE" else "email"}
    columns = [{"column": key, "label": label, "required": key in required} for key, label, _ in TEMPLATE_COLUMNS]
    samples = [sample for _, _, sample in TEMPLATE_COLUMNS]
    for f in await ld.custom_field_catalogue(ctx):
        col = {"column": ld.cf_column(f["label"]), "label": f["label"], "required": bool(f.get("required")),
               "custom_field_id": f["field_id"]}
        if f.get("options"):
            col["options"] = f["options"]
        columns.append(col)
        samples.append("")
    header = ",".join(c["column"] for c in columns)
    sample = ",".join(f'"{s}"' if "," in s else s for s in samples)
    return {"columns": columns, "csv": f"{header}\n{sample}\n", "file_name": "bulk_enroll_template.csv",
            "user_identifier": identifier,
            "notes": [
                f"Required: {', '.join(sorted(required))}. Learners are identified by "
                f"{'mobile number' if identifier == 'PHONE' else 'email'}.",
                "Every row is enrolled into the SAME courses chosen in learner_enroll.",
                "A row whose email / mobile already belongs to a learner of this institute enrols that learner; "
                "their profile is not changed (use learner_edit for that).",
                "transaction_id: the first non-empty value applies to the whole upload, like the dashboard.",
                "Delete the sample row before uploading.",
            ]}


_ACTIONS = {
    "find": _action_find,
    "get": _action_get,
    "enroll_options": _action_enroll_options,
    "enroll_template": _action_enroll_template,
}


async def execute_learners(args: Dict[str, Any], ctx: ToolContext) -> str:
    action = str((args or {}).get("action") or "").strip()
    handler = _ACTIONS.get(action)
    if handler is None:
        return json.dumps(_err("unknown_action", action=action, available=list(LEARNERS_ACTIONS)))
    result = await handler(args or {}, ctx)
    if isinstance(result, dict) and "action" not in result:
        result = {"action": action, **result}
    return json.dumps(result, ensure_ascii=False, default=str)


LEARNERS_TOOLS: Dict[str, ToolSpec] = {
    LEARNERS_TOOL_NAME: ToolSpec(
        name=LEARNERS_TOOL_NAME,
        schema=LEARNERS_SCHEMA,
        executor=execute_learners,
        required_permission=None,
        setting_key=LEARNERS_GROUP_KEY,
        default_enabled=False,
        default_roles=["ADMIN"],
        phase=2,
        mode="READ",
    ),
}


def _register() -> None:
    from .assistant_tool_registry import ASSISTANT_TOOLS, GROUP_LABELS
    ASSISTANT_TOOLS.update(LEARNERS_TOOLS)
    GROUP_LABELS.update({LEARNERS_GROUP_KEY: "Learners: view"})


_register()

__all__ = ["LEARNERS_TOOLS", "LEARNERS_TOOL_NAME", "LEARNERS_GROUP_KEY", "LEARNERS_ACTIONS", "LEARNERS_SCHEMA",
           "TEMPLATE_COLUMNS", "execute_learners", "enrollable_invites", "invite_view"]
