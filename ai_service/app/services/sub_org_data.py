"""
Shared reads and helpers for the sub-organisation tools (`sub_orgs`,
`sub_org_edit`, `sub_org_enroll`).

A sub-org is its own ``institutes`` row linked to the parent through
``institute_suborg`` (institute_id = parent, suborg_id = child). Its courses are
not stored on it: they are the batches its ACTIVE ``tag='SUB_ORG'`` invites link
to (``package_session_learner_invitation_to_payment_option``). The org-level
invite is the one carrying ``setting_json.setting.SUB_ORG_SETTING`` (AUTH_ROLES,
MEMBER_COUNT, ALLOWED_TEAM_ROLES, ADMIN_PERMISSIONS) — the oldest such, like
admin-core's ``findOrgLevelSubOrgInvite``.

Every read is scoped to the pinned institute through ``institute_suborg``. The
member endpoints these tools call (``/sub-org/v1/add-member``) check neither the
caller nor that the sub-org belongs to the institute, so this scoping is the
cross-tenant guard — same rule as learner_data.

Seats: admin-core's own seat check reads ``payment_plan.member_count`` of the
ROOT_ADMIN's plan, which is empty (unlimited) whenever the sub-org reuses a shared
institute option or a CPO — i.e. every sub-org the dashboard creates — while the
cap the admin typed lives in ``SUB_ORG_SETTING.MEMBER_COUNT``. The tools enforce
the cap the admin sees: MEMBER_COUNT, else the admin plan's member_count. Usage is
counted exactly like admin-core (per batch, ACTIVE, ROOT_ADMIN excluded, stamped
sub_org_id OR a user plan from one of the sub-org's invites).
"""
from __future__ import annotations

import json
import logging
from typing import Any, Dict, List, Optional

from . import course_builder_data as cbd
from .assistant_tool_registry import ToolContext

logger = logging.getLogger(__name__)

ROOT_ADMIN = "ROOT_ADMIN"
LEARNER = "LEARNER"
SUB_ORG_ENROLMENT_EVENT = "SUB_ORG_MEMBER_ENROLLMENT"
ADMIN_PERMISSIONS = ("FULL", "CREATE_COURSE")
#: auth-service's seeded roles the dashboard hides from the role pickers.
LEGACY_ROLE_NAMES = ("Admin", "User", "Moderator", "Guest")
PAYMENT_TYPES = ("FREE", "ONE_TIME", "SUBSCRIPTION", "CPO")
GATEWAY_TYPES = ("ONE_TIME", "SUBSCRIPTION")

LIST_PATH = "/admin-core-service/institute/v1/sub-org/get-all-with-details"
CREATE_PATH = "/admin-core-service/institute/v1/sub-org/create-with-subscription"
ADD_MEMBER_PATH = "/admin-core-service/sub-org/v1/add-member"
VENDORS_PATH = "/admin-core-service/open/v1/institute/payment-setting/vendors"


def config_path(sub_org_id: str) -> str:
    return f"/admin-core-service/institute/v1/sub-org/{sub_org_id}/configuration"


def manage_url(ctx: ToolContext) -> str:
    return f"{cbd.admin_base(ctx)}/manage-custom-teams"


# ── the sub-org itself ───────────────────────────────────────────────────

_SUB_ORG_SQL = """
SELECT iso.suborg_id AS id, COALESCE(i.name, iso.name) AS name, iso.status, iso.created_at
FROM institute_suborg iso
LEFT JOIN institutes i ON i.id = iso.suborg_id
WHERE iso.institute_id = :inst AND iso.suborg_id = :sid
ORDER BY iso.created_at DESC
LIMIT 1
"""

_NAMES_SQL = """
SELECT iso.suborg_id AS id, COALESCE(i.name, iso.name) AS name
FROM institute_suborg iso
LEFT JOIN institutes i ON i.id = iso.suborg_id
WHERE iso.institute_id = :inst AND LOWER(TRIM(COALESCE(i.name, iso.name))) = :name
LIMIT 5
"""


def sub_org(ctx: ToolContext, sub_org_id: Any) -> Optional[Dict[str, Any]]:
    """The sub-org if it is a child of the pinned institute, else None."""
    sid = str(sub_org_id or "").strip()
    if not sid:
        return None
    rows = cbd._rows(ctx, _SUB_ORG_SQL, {"inst": ctx.principal.institute_id, "sid": sid})
    return rows[0] if rows else None


def sub_orgs_named(ctx: ToolContext, name: str) -> List[Dict[str, Any]]:
    """This institute's sub-orgs with this exact name (case / outer spaces ignored)."""
    return cbd._rows(ctx, _NAMES_SQL, {"inst": ctx.principal.institute_id, "name": str(name or "").strip().lower()})


def unknown_sub_org_error(sub_org_id: Any) -> Dict[str, Any]:
    return cbd.err("unknown_sub_org", sub_org_id=sub_org_id,
                   message="No sub-organisation of this institute has that sub_org_id. Use sub_orgs(action='list').")


# ── its invites and courses ──────────────────────────────────────────────

_INVITES_SQL = """
SELECT ei.id, ei.name, ei.invite_code, ei.short_url, ei.setting_json, ei.learner_access_days, ei.created_at,
       b.package_session_id, po.id AS payment_option_id, po.name AS payment_option_name, po.type AS payment_type
FROM enroll_invite ei
LEFT JOIN package_session_learner_invitation_to_payment_option b
       ON b.enroll_invite_id = ei.id AND b.status = 'ACTIVE'
LEFT JOIN payment_option po ON po.id = b.payment_option_id
WHERE ei.sub_org_id = :sid AND ei.institute_id = :inst AND ei.tag = 'SUB_ORG' AND ei.status = 'ACTIVE'
ORDER BY ei.created_at ASC
"""

_BATCHES_SQL = """
SELECT ps.id AS batch_id, p.id AS course_id, p.package_name AS course, p.status AS course_status,
       se.session_name, l.level_name
FROM package_session ps
JOIN package p ON p.id = ps.package_id
LEFT JOIN session se ON se.id = ps.session_id
LEFT JOIN level l ON l.id = ps.level_id
WHERE ps.id = ANY(:ids)
"""


def sub_org_setting(setting_json: Any) -> Dict[str, Any]:
    """setting_json → its SUB_ORG_SETTING block ({} when missing / unreadable)."""
    raw = setting_json
    if isinstance(raw, str):
        if not raw.strip():
            return {}
        try:
            raw = json.loads(raw)
        except ValueError:
            return {}
    block = ((raw or {}).get("setting") or {}).get("SUB_ORG_SETTING") if isinstance(raw, dict) else None
    return block if isinstance(block, dict) else {}


def invites(ctx: ToolContext, sub_org_id: str) -> List[Dict[str, Any]]:
    """The sub-org's ACTIVE SUB_ORG invites, oldest first, each with the batches it links to."""
    rows = cbd._rows(ctx, _INVITES_SQL, {"sid": sub_org_id, "inst": ctx.principal.institute_id})
    out: Dict[str, Dict[str, Any]] = {}
    for r in rows:
        inv = out.setdefault(r["id"], {**{k: r.get(k) for k in (
            "id", "name", "invite_code", "short_url", "learner_access_days", "payment_option_id",
            "payment_option_name", "payment_type")}, "setting": sub_org_setting(r.get("setting_json")),
            "has_setting": bool(str(r.get("setting_json") or "").strip()), "batch_ids": []})
        if r.get("package_session_id") and r["package_session_id"] not in inv["batch_ids"]:
            inv["batch_ids"].append(r["package_session_id"])
        if not inv.get("payment_option_id") and r.get("payment_option_id"):
            inv.update(payment_option_id=r["payment_option_id"], payment_option_name=r.get("payment_option_name"),
                       payment_type=r.get("payment_type"))
    return list(out.values())


def org_invite(invite_rows: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """The org-level invite: the oldest one carrying settings, else the oldest (admin-core's rule)."""
    with_setting = [i for i in invite_rows if i["has_setting"]]
    return (with_setting or invite_rows or [None])[0]


def batches(ctx: ToolContext, batch_ids: List[str]) -> List[Dict[str, Any]]:
    """Batch ids → [{batch_id, course_id, course, batch, course_status}] in the given order."""
    if not batch_ids:
        return []
    rows = {r["batch_id"]: r for r in cbd._rows(ctx, _BATCHES_SQL, {"ids": list(batch_ids)})}
    out = []
    for bid in batch_ids:
        r = rows.get(bid)
        if not r:
            continue
        name = " · ".join(x for x in (cbd._label(r.get("session_name")), cbd._label(r.get("level_name"))) if x)
        out.append({"batch_id": bid, "course_id": r.get("course_id"), "course": r.get("course"),
                    "batch": name or "Default batch", "course_status": r.get("course_status")})
    return out


def sub_org_batches(ctx: ToolContext, invite_rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Every batch any of the sub-org's SUB_ORG invites links to — the sub-org's courses."""
    ids: List[str] = []
    for inv in invite_rows:
        ids += [b for b in inv["batch_ids"] if b not in ids]
    return batches(ctx, ids)


# ── seats ────────────────────────────────────────────────────────────────

_USED_SQL = """
SELECT m.package_session_id AS batch_id, COUNT(*) AS used
FROM student_session_institute_group_mapping m
LEFT JOIN user_plan up ON up.id = m.user_plan_id
WHERE m.package_session_id = ANY(:ps) AND m.status = 'ACTIVE'
  AND (m.comma_separated_org_roles IS NULL OR m.comma_separated_org_roles NOT LIKE '%ROOT_ADMIN%')
  AND (m.sub_org_id = :sid OR up.enroll_invite_id IN (SELECT ei.id FROM enroll_invite ei WHERE ei.sub_org_id = :sid))
GROUP BY m.package_session_id
"""

_ADMIN_PLAN_CAP_SQL = """
SELECT pp.member_count
FROM student_session_institute_group_mapping m
JOIN user_plan up ON up.id = m.user_plan_id
JOIN payment_plan pp ON pp.id = up.plan_id
WHERE m.sub_org_id = :sid AND m.comma_separated_org_roles LIKE '%ROOT_ADMIN%' AND pp.member_count IS NOT NULL
ORDER BY m.created_at ASC
LIMIT 1
"""


def _int(value: Any) -> Optional[int]:
    try:
        n = int(value)
    except (TypeError, ValueError):
        return None
    return n if n > 0 else None


def seat_cap(ctx: ToolContext, sub_org_id: str, org: Optional[Dict[str, Any]]) -> Optional[int]:
    """Learner seats per batch: SUB_ORG_SETTING.MEMBER_COUNT, else the admin plan's member_count, else None."""
    cap = _int(((org or {}).get("setting") or {}).get("MEMBER_COUNT"))
    if cap:
        return cap
    rows = cbd._rows(ctx, _ADMIN_PLAN_CAP_SQL, {"sid": sub_org_id})
    return _int(rows[0].get("member_count")) if rows else None


def used_seats(ctx: ToolContext, sub_org_id: str, batch_ids: List[str]) -> Dict[str, int]:
    if not batch_ids:
        return {}
    rows = cbd._rows(ctx, _USED_SQL, {"ps": list(batch_ids), "sid": sub_org_id})
    used = {r["batch_id"]: int(r.get("used") or 0) for r in rows}
    return {b: used.get(b, 0) for b in batch_ids}


# ── people ───────────────────────────────────────────────────────────────

_ADMINS_SQL = """
SELECT DISTINCT ON (m.user_id) m.user_id, s.full_name, s.email, s.mobile_number, m.status
FROM student_session_institute_group_mapping m
LEFT JOIN student s ON s.user_id = m.user_id
WHERE m.sub_org_id = :sid AND m.institute_id = :inst AND m.comma_separated_org_roles LIKE '%ADMIN%'
  AND m.status IN ('ACTIVE', 'INVITED', 'PENDING_FOR_APPROVAL')
ORDER BY m.user_id, s.updated_at DESC NULLS LAST
"""

_MEMBERS_SQL = """
SELECT DISTINCT ON (m.user_id, m.package_session_id)
       m.user_id, s.full_name, s.email, s.mobile_number, m.package_session_id, m.status,
       m.comma_separated_org_roles AS org_roles, m.enrolled_date, m.expiry_date
FROM student_session_institute_group_mapping m
LEFT JOIN user_plan up ON up.id = m.user_plan_id
LEFT JOIN student s ON s.user_id = m.user_id
WHERE m.institute_id = :inst AND m.status = ANY(:statuses)
  AND (m.sub_org_id = :sid OR up.enroll_invite_id IN (SELECT ei.id FROM enroll_invite ei WHERE ei.sub_org_id = :sid))
  AND (m.comma_separated_org_roles IS NULL OR m.comma_separated_org_roles NOT LIKE '%ADMIN%')
  AND (:q = '' OR s.full_name ILIKE '%' || :q || '%' OR s.email ILIKE '%' || :q || '%')
ORDER BY m.user_id, m.package_session_id, s.updated_at DESC NULLS LAST
LIMIT :lim
"""

_ACTIVE_IN_BATCHES_SQL = """
SELECT m.user_id, m.package_session_id, m.sub_org_id, m.comma_separated_org_roles AS org_roles
FROM student_session_institute_group_mapping m
WHERE m.institute_id = :inst AND m.user_id = ANY(:ids) AND m.package_session_id = ANY(:ps) AND m.status = 'ACTIVE'
"""


def admins(ctx: ToolContext, sub_org_id: str) -> List[Dict[str, Any]]:
    """The sub-org's admins (ROOT_ADMIN / ADMIN mappings), one row per person."""
    return cbd._rows(ctx, _ADMINS_SQL, {"sid": sub_org_id, "inst": ctx.principal.institute_id})


def members(ctx: ToolContext, sub_org_id: str, *, statuses: List[str], query: str = "",
            limit: int = 500) -> List[Dict[str, Any]]:
    """Learner rows (one per person × batch) — stamped with the sub-org OR enrolled through one of its invites."""
    return cbd._rows(ctx, _MEMBERS_SQL, {"sid": sub_org_id, "inst": ctx.principal.institute_id,
                                         "statuses": list(statuses), "q": str(query or "").strip(),
                                         "lim": int(limit)})


def active_enrolments(ctx: ToolContext, user_ids: List[str], batch_ids: List[str]) -> List[Dict[str, Any]]:
    """ACTIVE mappings of these users in these batches, in this institute (any sub-org or none)."""
    if not user_ids or not batch_ids:
        return []
    return cbd._rows(ctx, _ACTIVE_IN_BATCHES_SQL, {"inst": ctx.principal.institute_id, "ids": list(user_ids),
                                                   "ps": list(batch_ids)})


# ── what a new sub-org can be set up with ────────────────────────────────

_OPTIONS_SQL = """
SELECT po.id, po.name, po.type, po.complex_payment_option_id, po.require_approval
FROM payment_option po
WHERE po.source = 'INSTITUTE' AND po.source_id = :inst AND po.status = 'ACTIVE'
  AND po.type IN ('FREE', 'ONE_TIME', 'SUBSCRIPTION', 'CPO')
ORDER BY po.created_at DESC NULLS LAST
LIMIT 100
"""

_PLANS_SQL = """
SELECT payment_option_id, name, actual_price, elevated_price, currency, validity_in_days, member_count
FROM payment_plan
WHERE payment_option_id = ANY(:ids) AND status = 'ACTIVE'
ORDER BY validity_in_days NULLS LAST
"""


def payment_options(ctx: ToolContext) -> List[Dict[str, Any]]:
    """The institute's ACTIVE payment options a sub-org admin can pay through (Payment Settings + CPO mirrors)."""
    rows = cbd._rows(ctx, _OPTIONS_SQL, {"inst": ctx.principal.institute_id})
    ids = [r["id"] for r in rows]
    plans: Dict[str, List[Dict[str, Any]]] = {}
    for p in cbd._rows(ctx, _PLANS_SQL, {"ids": ids}) if ids else []:
        plans.setdefault(p.pop("payment_option_id"), []).append(p)
    return [{**r, "plans": plans.get(r["id"], [])} for r in rows]


def option_view(opt: Dict[str, Any]) -> Dict[str, Any]:
    return {"payment_option_id": opt["id"], "name": opt.get("name"), "payment_type": opt.get("type"),
            "plans": [{"name": p.get("name"), "price": p.get("actual_price"), "currency": p.get("currency"),
                       "validity_days": p.get("validity_in_days")} for p in opt.get("plans") or []],
            **({"note": "Instalment plan (CPO): the sub-org admin is billed on its schedule."}
               if opt.get("type") == "CPO" else {})}


async def vendors(ctx: ToolContext) -> List[Dict[str, str]]:
    """The institute's payment gateways: [{vendor, vendor_id}]."""
    data = await cbd.admin_core(ctx, "GET", VENDORS_PATH, params={"instituteId": ctx.principal.institute_id})
    if not isinstance(data, list):
        return []
    return [{"vendor": str(v.get("vendor")), "vendor_id": str(v.get("vendor_id") or "")}
            for v in data if isinstance(v, dict) and v.get("vendor")]


async def roles(ctx: ToolContext) -> Optional[List[str]]:
    """The institute's auth-service role names (legacy seeds hidden, like the dashboard); None when unreachable."""
    from . import learner_data as ld
    data = await ld.auth_call(ctx, "GET", f"/auth-service/v1/institute/{ctx.principal.institute_id}/roles")
    if not isinstance(data, list):
        return None
    names = [str(r.get("name")) for r in data if isinstance(r, dict) and r.get("name")]
    return [n for n in dict.fromkeys(names) if n not in LEGACY_ROLE_NAMES]


__all__ = [
    "ROOT_ADMIN", "LEARNER", "SUB_ORG_ENROLMENT_EVENT", "ADMIN_PERMISSIONS", "PAYMENT_TYPES", "GATEWAY_TYPES",
    "LIST_PATH", "CREATE_PATH", "ADD_MEMBER_PATH", "VENDORS_PATH", "config_path", "manage_url",
    "sub_org", "sub_orgs_named", "unknown_sub_org_error", "sub_org_setting", "invites", "org_invite", "batches",
    "sub_org_batches", "seat_cap", "used_seats", "admins", "members", "active_enrolments", "payment_options",
    "option_view", "vendors", "roles",
]
