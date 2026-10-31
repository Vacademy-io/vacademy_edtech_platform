"""
Shared reads and helpers for the learner tools (`learners`, `learner_enroll`,
`learner_edit`).

Every SQL read is scoped to the pinned institute through
``student_session_institute_group_mapping`` — a user is "a learner of this
institute" only if they have a mapping row here (any status). The write
endpoints these tools call trust their request bodies, so this scoping is the
cross-tenant guard.

Confirm tokens: MCP has no confirmation card, so every learner write is two
calls — ``preview`` returns a token signed over the exact normalised request,
and the write refuses anything without a matching, unexpired token. The token
is stateless (HMAC), so it works across replicas without a store.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import logging
import re
import time
from datetime import date, datetime
from typing import Any, Dict, List, Optional, Tuple

from . import course_builder_data as cbd
from .assistant_tool_registry import ToolContext

logger = logging.getLogger(__name__)

#: How long a preview's confirm token stays valid.
CONFIRM_TTL_SECONDS = 15 * 60

USER_IDENTIFIER_KEY = "USER_IDENTIFIER"

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_DATE_FORMATS = ("%d/%m/%Y", "%m/%d/%Y", "%Y-%m-%d", "%d-%m-%Y")


def digits(value: Any) -> str:
    return re.sub(r"\D", "", str(value or ""))


def valid_email(value: Any) -> bool:
    return bool(_EMAIL_RE.match(str(value or "").strip()))


def valid_phone(value: Any) -> bool:
    return 7 <= len(digits(value)) <= 15


def parse_day(value: Any) -> Optional[str]:
    """A date in any of the CSV importer's formats → YYYY-MM-DD, else None."""
    raw = str(value or "").strip()
    if not raw:
        return None
    for fmt in _DATE_FORMATS:
        try:
            return datetime.strptime(raw, fmt).date().isoformat()
        except ValueError:
            continue
    return None


def not_future(day: str) -> bool:
    return date.fromisoformat(day) <= date.today()


# ── SQL reads (institute-scoped) ─────────────────────────────────────────

_FIND_SQL = """
SELECT DISTINCT ON (s.user_id)
       s.user_id, s.full_name, s.email, s.username, s.mobile_number, s.gender, s.date_of_birth,
       s.address_line, s.city, s.region, s.pin_code, s.fathers_name, s.mothers_name,
       s.parents_mobile_number, s.parents_email, s.parents_to_mother_mobile_number,
       s.parents_to_mother_email, s.linked_institute_name
FROM student s
WHERE s.user_id IN (SELECT m.user_id FROM student_session_institute_group_mapping m WHERE m.institute_id = :inst)
  AND {where}
ORDER BY s.user_id, s.updated_at DESC NULLS LAST
LIMIT :lim
"""

_SEARCH_WHERE = """(
       s.full_name ILIKE '%' || :q || '%' OR s.email ILIKE '%' || :q || '%'
    OR s.username ILIKE '%' || :q || '%'
    OR (:qd <> '' AND regexp_replace(COALESCE(s.mobile_number, ''), '\\D', '', 'g') LIKE '%' || :qd || '%'))"""

_ENROLMENTS_SQL = """
SELECT m.user_id, m.package_session_id, m.status, m.enrolled_date, m.expiry_date,
       p.id AS course_id, p.package_name, se.session_name, l.level_name
FROM student_session_institute_group_mapping m
JOIN package_session ps ON ps.id = m.package_session_id
JOIN package p ON p.id = ps.package_id
LEFT JOIN session se ON se.id = ps.session_id
LEFT JOIN level l ON l.id = ps.level_id
WHERE m.institute_id = :inst AND m.user_id = ANY(:ids)
ORDER BY m.created_at DESC
"""

PROFILE_FIELDS = (
    "full_name", "email", "username", "mobile_number", "gender", "date_of_birth", "address_line", "city",
    "region", "pin_code", "fathers_name", "mothers_name", "parents_mobile_number", "parents_email",
    "parents_to_mother_mobile_number", "parents_to_mother_email", "linked_institute_name",
)


def _profile(row: Dict[str, Any]) -> Dict[str, Any]:
    out = {"user_id": row["user_id"]}
    for f in PROFILE_FIELDS:
        v = row.get(f)
        if isinstance(v, (date, datetime)):
            v = v.date().isoformat() if isinstance(v, datetime) else v.isoformat()
        out[f] = v
    return out


def search_learners(ctx: ToolContext, query: str, limit: int = 10) -> List[Dict[str, Any]]:
    """Learners of this institute whose name / email / username / phone match."""
    q = str(query or "").strip()
    if not q:
        return []
    qd = digits(q) if len(digits(q)) >= 4 else ""
    rows = cbd._rows(ctx, _FIND_SQL.format(where=_SEARCH_WHERE),
                     {"inst": ctx.principal.institute_id, "q": q, "qd": qd, "lim": int(limit)})
    return [_profile(r) for r in rows]


def target_learner_id(args: Dict[str, Any]) -> str:
    """The learner a tool call names: `learner_id`, else the `user_id` the model sent (kept by the tool
    runner as `requested_user_id` — a client with a stale schema still sends user_id)."""
    return str(args.get("learner_id") or args.get("requested_user_id") or "").strip()


def missing_learner_error() -> Dict[str, Any]:
    return {"error": "missing_learner_id",
            "message": "Pass learner_id — the learner_id that learners(action='find') returned."}


def learner_profile(ctx: ToolContext, user_id: Any) -> Optional[Dict[str, Any]]:
    """One learner of THIS institute, else None."""
    uid = str(user_id or "").strip()
    if not uid:
        return None
    rows = cbd._rows(ctx, _FIND_SQL.format(where="s.user_id = :uid"),
                     {"inst": ctx.principal.institute_id, "uid": uid, "lim": 1})
    return _profile(rows[0]) if rows else None


def learners_by_ids(ctx: ToolContext, user_ids: List[str]) -> Dict[str, Dict[str, Any]]:
    if not user_ids:
        return {}
    rows = cbd._rows(ctx, _FIND_SQL.format(where="s.user_id = ANY(:ids)"),
                     {"inst": ctx.principal.institute_id, "ids": list(user_ids), "lim": len(user_ids)})
    return {r["user_id"]: _profile(r) for r in rows}


_MATCH_SQL = """
SELECT DISTINCT ON (s.user_id) s.user_id, s.full_name, LOWER(s.email) AS email,
       regexp_replace(COALESCE(s.mobile_number, ''), '\\D', '', 'g') AS phone
FROM student s
WHERE s.user_id IN (SELECT m.user_id FROM student_session_institute_group_mapping m WHERE m.institute_id = :inst)
  AND (LOWER(s.email) = ANY(:emails) OR regexp_replace(COALESCE(s.mobile_number, ''), '\\D', '', 'g') = ANY(:phones))
ORDER BY s.user_id, s.updated_at DESC NULLS LAST
"""


def match_existing(ctx: ToolContext, emails: List[str], phones: List[str]) -> List[Dict[str, Any]]:
    """This institute's learners with any of these emails (case-insensitive) or phone digits."""
    emails = [e.lower() for e in emails if e]
    phones = [p for p in phones if p]
    if not emails and not phones:
        return []
    return cbd._rows(ctx, _MATCH_SQL, {"inst": ctx.principal.institute_id, "emails": emails or [""],
                                       "phones": phones or [""]})


def enrolments(ctx: ToolContext, user_ids: List[str]) -> Dict[str, List[Dict[str, Any]]]:
    """Each learner's course enrolments in this institute, newest first."""
    if not user_ids:
        return {}
    rows = cbd._rows(ctx, _ENROLMENTS_SQL, {"inst": ctx.principal.institute_id, "ids": list(user_ids)})
    out: Dict[str, List[Dict[str, Any]]] = {}
    for r in rows:
        batch = " · ".join(x for x in (cbd._label(r.get("session_name")), cbd._label(r.get("level_name"))) if x)
        out.setdefault(r["user_id"], []).append({
            "course_id": r.get("course_id"), "course": r.get("package_name"), "batch_id": r.get("package_session_id"),
            "batch": batch or "Default batch", "status": r.get("status"),
            "enrolled_on": str(r["enrolled_date"])[:10] if r.get("enrolled_date") else None,
            "expires_on": str(r["expiry_date"])[:10] if r.get("expiry_date") else None,
        })
    return out


_ORG_SQL = "SELECT id FROM package_session WHERE id = ANY(:ids) AND is_org_associated = TRUE"


def org_associated_batches(ctx: ToolContext, batch_ids: List[str]) -> set:
    if not batch_ids:
        return set()
    return {r["id"] for r in cbd._rows(ctx, _ORG_SQL, {"ids": list(batch_ids)})}


# ── settings ─────────────────────────────────────────────────────────────

async def user_identifier(ctx: ToolContext) -> str:
    """'PHONE' when the institute identifies learners by mobile number, else 'EMAIL'."""
    data = await cbd.admin_core(ctx, "GET", "/admin-core-service/institute/setting/v1/get",
                                params={"instituteId": ctx.principal.institute_id, "settingKey": USER_IDENTIFIER_KEY})
    if isinstance(data, dict):
        data = data.get("data")
    return "PHONE" if str(data or "").strip().strip('"').upper() == "PHONE" else "EMAIL"


async def notification_toggles(ctx: ToolContext) -> Dict[str, bool]:
    """Course Settings → whether notify-learners / send-credentials may be used (both default on)."""
    data = await cbd.load_course_settings(ctx)
    block = (data.get("enrollmentNotifications") if isinstance(data, dict) and not cbd.is_error(data) else None) or {}
    return {"notify_learners": block.get("showNotifyLearners") is not False,
            "send_credentials": block.get("showSendCredentials") is not False}


async def custom_field_catalogue(ctx: ToolContext) -> List[Dict[str, Any]]:
    """The institute's active custom fields: [{field_id, label, type, options?, required}]."""
    from .assistant_tools_course_invites import catalogue_field_views
    raw = await cbd.admin_core(ctx, "GET", "/admin-core-service/common/custom-fields",
                               params={"instituteId": ctx.principal.institute_id})
    # Full Name / Email / Phone are the form's built-ins (locked) — they are profile columns, not custom fields.
    return [f for f in catalogue_field_views(raw) if not f.get("locked")]


def cf_column(label: str) -> str:
    """The CSV column the dashboard's template uses for a custom field."""
    return "cf_" + re.sub(r"[^a-z0-9]+", "_", str(label or "").lower())


ENROLMENT_EVENT = "LEARNER_BATCH_ENROLLMENT"


async def enrolment_automations(ctx: ToolContext, batch_ids: List[str],
                                event: str = ENROLMENT_EVENT) -> Dict[str, List[str]]:
    """
    batch id → names of the ACTIVE automations an enrolment into it fires. They run
    whatever the enrol options say, and usually send their own welcome message. Same
    rule as the wizard's "Linked workflows" panel and WorkflowTriggerService: a batch's
    own enrolment trigger replaces the institute-wide ones for that batch. (A global
    automation gated on the course by a condition node is still listed — it MAY fire.)
    ``event`` is the trigger: sub-org member adds fire SUB_ORG_MEMBER_ENROLLMENT instead.
    """
    data = await cbd.admin_core(
        ctx, "POST", "/admin-core-service/v1/workflow/institute/workflows-with-schedules/list",
        params={"pageNo": 0, "pageSize": 200},
        body={"institute_id": ctx.principal.institute_id, "workflow_statuses": ["ACTIVE"]})
    rows = data.get("content") if isinstance(data, dict) and not cbd.is_error(data) else None
    specific: Dict[str, List[str]] = {}
    general: List[str] = []
    for r in rows or []:
        if not isinstance(r, dict) or str(r.get("trigger_event_name") or "").upper() != event:
            continue
        if str(r.get("trigger_status") or "ACTIVE").upper() != "ACTIVE":
            continue
        name = r.get("workflow_name") or "Unnamed automation"
        if r.get("event_id"):
            specific.setdefault(str(r["event_id"]), []).append(name)
        else:
            general.append(name)
    return {b: list(dict.fromkeys(specific.get(b) or general)) for b in batch_ids}


# ── auth-service ─────────────────────────────────────────────────────────

async def auth_call(ctx: ToolContext, method: str, path: str, *, body: Any = None,
                    params: Optional[Dict[str, Any]] = None, timeout: float = 20.0) -> Any:
    """One JWT call to auth-service, with the caller's own token (so its own guards apply)."""
    import httpx
    from .assistant_tool_registry import _jwt_headers

    if not ctx.bearer_token:
        return cbd.err("no_auth", message="This action is unavailable right now (no session).")
    url = f"{cbd._settings().auth_service_base_url}{path}"
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.request(method, url, params=params, json=body, headers=_jwt_headers(ctx))
    except Exception as exc:  # noqa: BLE001
        logger.warning("learner tools %s %s failed: %s", method, path, exc)
        return cbd.err("request_failed", message="auth-service could not be reached.")
    if resp.status_code >= 300:
        logger.warning("learner tools %s %s -> %s", method, path, resp.status_code)
        return cbd.err("auth_rejected", status=resp.status_code, message=cbd._error_message(resp))
    if not resp.content:
        return ""
    try:
        return resp.json()
    except ValueError:
        return resp.text.strip()


async def login_credentials(ctx: ToolContext, user_ids: List[str]) -> Dict[str, Dict[str, Any]]:
    """
    user id → {username, password} for these users, with the CALLER's token: auth-service only
    returns the logins this caller may view one by one (its own guard), the rest are simply absent.
    """
    if not user_ids:
        return {}
    data = await auth_call(ctx, "POST", "/auth-service/v1/user/users-credential", body=list(user_ids), timeout=60.0)
    out: Dict[str, Dict[str, Any]] = {}
    for row in data if isinstance(data, list) else []:
        uid = row.get("user_id") or row.get("userId") if isinstance(row, dict) else None
        if uid:
            out[str(uid)] = {"username": row.get("username"), "password": row.get("password")}
    return out


# ── confirm tokens ───────────────────────────────────────────────────────

def _secret() -> bytes:
    return cbd._settings().resolve_mcp_encryption_key().encode()


def _digest(ctx: ToolContext, purpose: str, payload: Any, exp: int) -> str:
    material = json.dumps({"p": purpose, "i": ctx.principal.institute_id, "u": ctx.principal.user_id,
                           "x": exp, "b": payload}, sort_keys=True, separators=(",", ":"), default=str)
    return hmac.new(_secret(), material.encode(), hashlib.sha256).hexdigest()[:40]


def issue_token(ctx: ToolContext, purpose: str, payload: Any) -> str:
    exp = int(time.time()) + CONFIRM_TTL_SECONDS
    return f"{exp}.{_digest(ctx, purpose, payload, exp)}"


def check_token(ctx: ToolContext, purpose: str, payload: Any, token: Any) -> Optional[str]:
    """None when the token matches this exact payload and has not expired, else the reason."""
    raw = str(token or "").strip()
    if not raw:
        return "missing"
    exp_s, _, sig = raw.partition(".")
    if not exp_s.isdigit() or not sig:
        return "invalid"
    exp = int(exp_s)
    if exp < int(time.time()):
        return "expired"
    if not hmac.compare_digest(sig, _digest(ctx, purpose, payload, exp)):
        return "mismatch"
    return None


def token_error(reason: str, action: str) -> Dict[str, Any]:
    messages = {
        "missing": f"Run {action}(action='preview') first, show the admin the result, and pass its confirm_token.",
        "invalid": "That confirm_token is not valid. Run preview again.",
        "expired": "The preview expired (15 minutes). Run preview again and re-confirm with the admin.",
        "mismatch": "The request changed since the preview (or the learner data changed). Run preview again with "
                    "exactly these arguments and re-confirm with the admin.",
    }
    return cbd.err("confirm_required" if reason == "missing" else "confirm_token_" + reason,
                   message=messages.get(reason, messages["invalid"]))


__all__ = [
    "CONFIRM_TTL_SECONDS", "PROFILE_FIELDS", "digits", "valid_email", "valid_phone", "parse_day", "not_future",
    "search_learners", "target_learner_id", "missing_learner_error", "learner_profile", "learners_by_ids", "match_existing", "enrolments",
    "org_associated_batches", "user_identifier", "notification_toggles", "custom_field_catalogue", "cf_column",
    "ENROLMENT_EVENT", "enrolment_automations",
    "auth_call", "login_credentials", "issue_token", "check_token", "token_error",
]
