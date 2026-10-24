"""
The ``learner_edit`` tool — change a learner's details (name, phone, password,
address, parents, custom fields …) for the Assistant and the MCP server.

Admins ask for this all the time ("change Sarthak's phone number"): the model
finds the learner with learners(action='find'), asks which one when several
match, then previews and applies the change here.

Safety (MCP has no confirm card):

* two calls: ``preview`` shows every field's before → after and returns a
  confirm_token signed over the exact change and the learner's current values;
  ``apply`` refuses without a matching, unexpired token (so a change made in
  the dashboard in between forces a fresh preview);
* email and username are never changed (they are how learners log in and what
  integrations match on); the username is never even sent — a non-blank
  username makes auth-service rename the login;
* the target must be a learner of THIS institute — admin-core's
  /learner/info/v1/profile does not check that itself;
* only the changed fields are sent; admin-core and auth-service leave blank
  fields alone, which also means a field cannot be cleared from here;
* the password goes through auth-service's own update-password with the
  caller's token, so its access guard applies; it is never echoed back.
"""
from __future__ import annotations

import hashlib
import json
import logging
from typing import Any, Dict, List, Optional, Tuple

from . import course_builder_data as cbd
from . import learner_data as ld
from .assistant_tool_registry import ToolContext, ToolSpec

logger = logging.getLogger(__name__)

EDIT_TOOL_NAME = "learner_edit"
EDIT_GROUP_KEY = "learner_profile_edits"
EDIT_ACTIONS = ("preview", "apply")
PROFILE_PATH = "/admin-core-service/learner/info/v1/profile"
PASSWORD_PATH = "/auth-service/v1/user-operation/update-password"
CREDENTIALS_PATH = "/admin-core-service/learner-credentials/v1/send"

LOCKED_FIELDS = ("email", "username")
#: field → where it goes in the /profile request.
USER_FIELDS = ("full_name", "mobile_number", "gender", "date_of_birth", "address_line", "city", "region", "pin_code")
EXTRA_FIELDS = ("fathers_name", "mothers_name", "parents_mobile_number", "parents_email",
                "parents_to_mother_mobile_number", "parents_to_mother_email", "linked_institute_name")
EDITABLE_FIELDS = USER_FIELDS + EXTRA_FIELDS
_PHONE_FIELDS = ("mobile_number", "parents_mobile_number", "parents_to_mother_mobile_number")
_EMAIL_FIELDS = ("parents_email", "parents_to_mother_email")
_CHANNELS = ("EMAIL", "WHATSAPP")
GENDERS = ("MALE", "FEMALE", "OTHER")

EDIT_SCHEMA: Dict[str, Any] = {
    "type": "function",
    "function": {
        "name": EDIT_TOOL_NAME,
        "description": (
            "Change a learner's details: name, mobile number, password, gender, date of birth, address, city, "
            "state, PIN code, parents' names / phones / emails, school, and the institute's custom fields. Email "
            "and username can never be changed here. First find the learner with learners(action='find') — when "
            "several match, show them (name, email, phone, courses) and ask which one; never guess. Then:\n"
            "- preview (learner_id, changes?: {field: new value}, password?, custom_fields?: {label or field_id: "
            "value}): checks the change and shows each field's current → new value. Nothing is saved. Returns a "
            "confirm_token (valid 15 min).\n"
            "- apply (same arguments + confirm_token, send_credentials_via?: [EMAIL, WHATSAPP] — after a password "
            "change, sends the learner their login details; ask the admin): saves it.\n"
            f"changes keys: {', '.join(EDITABLE_FIELDS)}. gender: MALE | FEMALE | OTHER. date_of_birth: YYYY-MM-DD. "
            "Phone numbers with country code. A field cannot be blanked from here. The password is set to exactly "
            "what the admin gives (min 6 characters, no spaces) — never make one up unless asked, and do not repeat "
            "it back in the chat."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "action": {"type": "string", "enum": list(EDIT_ACTIONS)},
                # NOT `user_id`: the tool runner overwrites a top-level user_id with the CALLER's id, which
                # would point every edit at the admin's own account.
                "learner_id": {"type": "string", "description": "The learner's learner_id (from learners(action='find'))."},
                "changes": {"type": "object", "description": "{field: new value} — only the fields to change."},
                "password": {"type": "string", "description": "A new login password."},
                "custom_fields": {"type": "object", "description": "{label or field_id: value}."},
                "send_credentials_via": {"type": "array", "items": {"type": "string", "enum": list(_CHANNELS)}},
                "confirm_token": {"type": "string", "description": "apply: the token preview returned."},
            },
            "required": ["action", "learner_id"],
        },
    },
}

_CF_VALUES_SQL = """
SELECT DISTINCT ON (custom_field_id) custom_field_id, value FROM custom_field_values
WHERE source_type = 'USER' AND source_id = :uid AND custom_field_id = ANY(:ids)
ORDER BY custom_field_id, updated_at DESC NULLS LAST
"""

_PHONE_TAKEN_SQL = """
SELECT DISTINCT s.user_id, s.full_name FROM student s
WHERE s.user_id <> :uid
  AND regexp_replace(COALESCE(s.mobile_number, ''), '\\D', '', 'g') = :phone
  AND s.user_id IN (SELECT m.user_id FROM student_session_institute_group_mapping m WHERE m.institute_id = :inst)
LIMIT 3
"""


def _err(code: str, **extra: Any) -> Dict[str, Any]:
    return {"error": code, **extra}


def _same(a: Any, b: Any) -> bool:
    return str(a or "").strip().casefold() == str(b or "").strip().casefold()


async def _build(ctx: ToolContext, args: Dict[str, Any]) -> Tuple[Optional[Dict[str, Any]], Dict[str, Any], Optional[Dict[str, Any]]]:
    """(the change to apply, report context, problem)."""
    learner_id = ld.target_learner_id(args)
    if not learner_id:
        return None, {}, ld.missing_learner_error()
    learner = ld.learner_profile(ctx, learner_id)
    if not learner:
        return None, {}, _err("unknown_learner", message="No learner of this institute has that learner_id. Use "
                                                         "learners(action='find').")
    raw = args.get("changes") if isinstance(args.get("changes"), dict) else {}
    raw = {str(k).strip().lower(): v for k, v in raw.items()}
    for alias, field in (("phone", "mobile_number"), ("phone_number", "mobile_number"), ("mobile", "mobile_number"),
                         ("contact_number", "mobile_number"), ("name", "full_name"), ("state", "region"),
                         ("dob", "date_of_birth")):
        if alias in raw and field not in raw:
            raw[field] = raw.pop(alias)
    if "password" in raw and not args.get("password"):
        args = {**args, "password": raw.pop("password")}
    raw.pop("password", None)

    problems: List[str] = []
    locked = [f for f in LOCKED_FIELDS if f in raw]
    if locked:
        return None, {}, _err("field_locked", fields=locked,
                              message="Email and username cannot be changed from here — they are how the learner "
                                      "logs in. The admin can change them in the dashboard.")
    unknown = [k for k in raw if k not in EDITABLE_FIELDS]
    if unknown:
        problems.append(f"Unknown field(s): {', '.join(sorted(unknown))}. Editable: {', '.join(EDITABLE_FIELDS)}.")

    identifier = None
    changes: Dict[str, str] = {}
    warnings: List[str] = []
    for field, value in raw.items():
        if field not in EDITABLE_FIELDS:
            continue
        value = str(value if value is not None else "").strip()
        if not value:
            problems.append(f"{field}: a field cannot be cleared from here — give the new value.")
            continue
        if field in _PHONE_FIELDS and not ld.valid_phone(value):
            problems.append(f"{field}: '{value}' is not a valid phone number (include the country code).")
            continue
        if field in _EMAIL_FIELDS and not ld.valid_email(value):
            problems.append(f"{field}: '{value}' is not a valid email.")
            continue
        if field == "gender":
            value = value.upper()
            if value not in GENDERS:
                problems.append("gender must be MALE, FEMALE or OTHER.")
                continue
        if field == "date_of_birth":
            day = ld.parse_day(value)
            if not day or not ld.not_future(day):
                problems.append("date_of_birth must be a past date (YYYY-MM-DD).")
                continue
            value = day
        if field == "full_name" and len(value) > 200:
            problems.append("full_name is too long.")
            continue
        if field == "mobile_number" and ld.digits(value) == ld.digits(learner.get("mobile_number")):
            continue
        if _same(value, learner.get(field)):
            continue
        if field == "mobile_number":
            taken = cbd._rows(ctx, _PHONE_TAKEN_SQL, {"uid": learner["user_id"], "phone": ld.digits(value),
                                                      "inst": ctx.principal.institute_id})
            if taken:
                identifier = identifier or await ld.user_identifier(ctx)
                who = ", ".join(t.get("full_name") or t["user_id"] for t in taken)
                if identifier == "PHONE":
                    problems.append(f"mobile_number {value} already belongs to {who}; this institute signs learners "
                                    "in by mobile number, so it must be unique.")
                    continue
                warnings.append(f"{value} is also the mobile number of {who}.")
        changes[field] = value

    password = args.get("password")
    if password is not None:
        password = str(password)
        if len(password) < 6 or len(password) > 64 or any(c.isspace() for c in password):
            problems.append("password must be 6-64 characters with no spaces.")
            password = None

    custom: List[Dict[str, str]] = []
    cf_report: List[Dict[str, Any]] = []
    cf_raw = args.get("custom_fields") if isinstance(args.get("custom_fields"), dict) else {}
    if cf_raw:
        fields = await ld.custom_field_catalogue(ctx)
        current = {r["custom_field_id"]: r.get("value") for r in cbd._rows(
            ctx, _CF_VALUES_SQL, {"uid": learner["user_id"], "ids": [f["field_id"] for f in fields] or [""]})}
        for ref, value in cf_raw.items():
            ref_s = str(ref).strip()
            f = next((x for x in fields if x["field_id"] == ref_s), None) or \
                next((x for x in fields if str(x["label"]).strip().casefold() == ref_s.casefold()), None)
            if not f:
                problems.append(f"'{ref_s}' is not one of the institute's custom fields "
                                f"({', '.join(x['label'] for x in fields[:20])}).")
                continue
            value = str(value if value is not None else "").strip()
            if not value:
                problems.append(f"{f['label']}: a field cannot be cleared from here.")
                continue
            if f.get("options"):
                choice = next((o for o in f["options"] if _same(o, value)), None)
                if choice is None:
                    problems.append(f"{f['label']} must be one of: {', '.join(f['options'])}.")
                    continue
                value = choice
            if _same(value, current.get(f["field_id"])):
                continue
            custom.append({"custom_field_id": f["field_id"], "value": value})
            cf_report.append({"field": f["label"], "from": current.get(f["field_id"]), "to": value})

    channels = [str(c).strip().upper() for c in (args.get("send_credentials_via") or [])]
    bad = [c for c in channels if c not in _CHANNELS]
    if bad:
        problems.append(f"send_credentials_via takes EMAIL and/or WHATSAPP (not {', '.join(bad)}).")
    if channels and not password:
        problems.append("send_credentials_via is only for a password change.")

    if problems:
        return None, {}, _err("invalid_change", problems=problems, message="Nothing was saved.")
    if not changes and not custom and not password:
        return None, {}, _err("no_changes", message="Those values are already the learner's current details.")

    change = {"user_id": learner["user_id"], "changes": changes, "custom_fields": custom,
              "password_sha": hashlib.sha256(password.encode()).hexdigest() if password else None,
              "send_credentials_via": sorted(set(channels)),
              # The current values are signed too: an edit made elsewhere after the preview voids the token.
              "current": {f: learner.get(f) for f in changes}}
    rows = [{"field": f, "from": learner.get(f), "to": v} for f, v in changes.items()] + cf_report
    if password:
        rows.append({"field": "password", "from": "(hidden)", "to": "(new password, hidden)"})
    return change, {"learner": learner, "rows": rows, "warnings": warnings, "password": password}, None


def _profile_request(change: Dict[str, Any]) -> Dict[str, Any]:
    uid, changes = change["user_id"], change["changes"]
    if not changes and not change["custom_fields"]:
        return {}
    # user_details.id is ALWAYS sent: without it admin-core resolves the target to the CALLER (the admin)
    # and would write the change onto their own profile. Never email / username — see module docstring.
    body: Dict[str, Any] = {"user_details": {"id": uid, **{f: changes[f] for f in USER_FIELDS if f in changes}}}
    extra = {f: changes[f] for f in EXTRA_FIELDS if f in changes}
    if extra:
        body["learner_extra_details"] = extra
    if change["custom_fields"]:
        body["custom_field_values"] = [{"source_type": "USER", "source_id": uid, **cf}
                                       for cf in change["custom_fields"]]
    return body


def _who(learner: Dict[str, Any]) -> Dict[str, Any]:
    return {"learner_id": learner["user_id"], "full_name": learner.get("full_name"), "email": learner.get("email"),
            "mobile_number": learner.get("mobile_number")}


async def _action_preview(args: Dict[str, Any], ctx: ToolContext) -> Dict[str, Any]:
    change, context, problem = await _build(ctx, args)
    if problem:
        return problem
    return {"learner": _who(context["learner"]), "changes": context["rows"],
            "warnings": context["warnings"] or None,
            "confirm_token": ld.issue_token(ctx, EDIT_TOOL_NAME, change),
            "next": "Show the admin these changes (never the password itself) and ask them to confirm. On a clear "
                    "yes call learner_edit(action='apply') with the SAME arguments and this confirm_token."}


async def _action_apply(args: Dict[str, Any], ctx: ToolContext) -> Dict[str, Any]:
    change, context, problem = await _build(ctx, args)
    if problem:
        return problem
    reason = ld.check_token(ctx, EDIT_TOOL_NAME, change, args.get("confirm_token"))
    if reason:
        return ld.token_error(reason, EDIT_TOOL_NAME)
    learner, saved, failed = context["learner"], [], []
    body = _profile_request(change)
    if body:
        resp = await cbd.admin_core(ctx, "PUT", PROFILE_PATH, body=body)
        if cbd.is_error(resp):
            failed.append({"what": "profile", "message": resp.get("message")})
        else:
            saved += [r["field"] for r in context["rows"] if r["field"] != "password"]
    if context["password"]:
        resp = await ld.auth_call(ctx, "POST", PASSWORD_PATH,
                                  body={"user_id": learner["user_id"], "password": context["password"]})
        if cbd.is_error(resp):
            failed.append({"what": "password", "message": resp.get("message")})
        else:
            saved.append("password")
    out: Dict[str, Any] = {"learner": _who(learner), "saved": saved, "failed": failed or None,
                           "done": not failed}
    if "password" in saved and change["send_credentials_via"]:
        sent = await cbd.admin_core(ctx, "POST", CREDENTIALS_PATH, params={
            "instituteId": ctx.principal.institute_id, "userId": learner["user_id"],
            "channels": ",".join(change["send_credentials_via"])})
        out["credentials"] = (sent if isinstance(sent, dict) and not cbd.is_error(sent)
                              else {"error": "not_sent", "message": (sent or {}).get("message")
                                    if isinstance(sent, dict) else None})
    if failed and saved:
        out["note"] = "Part of the change was saved — tell the admin exactly which fields were and were not."
    return out


_ACTIONS = {"preview": _action_preview, "apply": _action_apply}


async def execute_learner_edit(args: Dict[str, Any], ctx: ToolContext) -> str:
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
        executor=execute_learner_edit,
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
    GROUP_LABELS.update({EDIT_GROUP_KEY: "Learners: edit details"})


_register()

__all__ = ["EDIT_TOOLS", "EDIT_TOOL_NAME", "EDIT_GROUP_KEY", "EDIT_ACTIONS", "EDIT_SCHEMA", "EDITABLE_FIELDS",
           "LOCKED_FIELDS", "execute_learner_edit"]
