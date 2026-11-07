"""
The ``course_invites_edit`` tool — invite links and payment plans for a course,
for the Assistant and the MCP server.

In Vacademy a course has no price field: an INVITE links the course's batch to a
PAYMENT OPTION (one or more plans), and the course's DEFAULT invite is what the
catalogue and enroll flows use. So "make this course ₹999" means: a payment
option with a ₹999 plan, an invite linking it to the batch, and (optionally)
that invite made the default.

Safety (no confirm card over MCP) — everything here is ADDITIVE:

* payment options / plans are only ever CREATED, never edited, so a plan shared
  with other courses can never change under them;
* re-pointing an invite at a new plan and making an invite the default are
  allowed only while the course is NOT ACTIVE;
* an invite's own page and registration form CAN be edited on a live course.
  update_invite patches only what was asked and sends the rest of the invite
  back exactly as read (admin-core's update overwrites every column it is
  sent). update_form_fields only adds / removes / reorders / (un)requires the
  institute's EXISTING fields on THIS invite — never a field's label, type or
  options, which every form using that field shares.

Actions
    create_invite        new invite for a course (+ inline payment plan) → share link
    create_payment_plan  new payment option + plan, optionally attached to an invite of a non-live course
    make_default         make an invite the course's default (non-live courses)
    update_invite        name, dates, landing copy, images, redirect path, success page of an invite
    update_form_fields   add (existing) / remove / reorder / (un)require fields on an invite's form
"""
from __future__ import annotations

import json
import logging
import re
from datetime import date
from typing import Any, Dict, List, Optional, Tuple

from . import course_builder_data as cbd
from .assistant_tool_registry import ToolContext, ToolSpec

logger = logging.getLogger(__name__)

INVITES_EDIT_TOOL_NAME = "course_invites_edit"
INVITES_EDIT_GROUP_KEY = "course_invite_edits"
INVITES_EDIT_ACTIONS = ("create_invite", "create_payment_plan", "make_default", "update_invite",
                        "update_form_fields")

PAYMENT_TYPES = ("FREE", "ONE_TIME", "SUBSCRIPTION")
FIELD_TYPES = ("text", "number", "dropdown")
_CURRENCY_RE = re.compile(r"^[A-Z]{3}$")
_MAX_PRICE = 10_000_000
#: A learner-app path: one leading slash, no scheme / host (``//host`` would leave the app).
_REDIRECT_RE = re.compile(r"^/(?!/)[A-Za-z0-9\-._~/%?=&#+]{0,200}$")
#: The registration form's built-in fields — the dashboard does not let them be removed either.
SEEDED_FIELD_KEYS = ("full_name", "email", "phone_number")
_MAX_HTML = 20_000

PAYMENT_SPEC_DOC = (
    "PAYMENT = {type: FREE | ONE_TIME | SUBSCRIPTION, name?, currency (ISO, e.g. INR / USD — required unless FREE), "
    "require_approval?: bool (default false: learners get access as soon as they pay/register),\n"
    "  ONE_TIME: price, strike_price? (shown struck through), validity_days? (omit = lifetime access)\n"
    "  SUBSCRIPTION: plans: [{name, price, strike_price?, validity_days (e.g. 30, 90, 365)}] (1-6 plans)\n"
    "  FREE: validity_days? (omit = unlimited)}"
)

INVITES_EDIT_SCHEMA: Dict[str, Any] = {
    "type": "function",
    "function": {
        "name": INVITES_EDIT_TOOL_NAME,
        "description": (
            "Create invite links (the page learners enrol / pay through) and payment plans for a course. Never edits "
            "or deletes anything. Read courses(action='invites') and courses(action='payment_setup') first; never "
            "invent prices — ask the admin. Pick an `action`:\n"
            "- create_invite (course_id, payment: PAYMENT | payment_option_id, batch_ids? (required when the "
            "course has several batches — ask which session / level), name?, start_date?, end_date?, "
            "access_days?, landing?: {description_html, learning_outcome_html, about_html, target_audience_html, "
            "tags}, form_fields?: [{label, type: text|number|dropdown, required?, options?}], make_default?): a new "
            "invite. The registration form always starts with the institute's default fields (name, email, phone…); "
            "form_fields adds to them (a label the institute already has reuses that field as it is). Landing copy "
            "defaults to the course's own. Returns the shareable link.\n"
            "- create_payment_plan (payment: PAYMENT, invite_id?, course_id?): a new payment plan. With invite_id + "
            "course_id it replaces that invite's plan (only while the course is not live).\n"
            "- make_default (course_id, invite_id): the course's main enrolment link (only while the course is not "
            "live). Every new course already has a default invite at the institute's default price — make your new "
            "invite the default or the catalogue keeps using that one.\n"
            "- update_invite (course_id, invite_id, + any of: name, start_date, end_date, clear_end_date, landing (as "
            "above — only the keys you pass change), images: {preview?, banner?, media?} each {image_url} (public "
            "https, imported) | {file_id} | 'course' (the course's own) | 'none' — media also takes "
            "{youtube: url}, redirect_path (where learners land after enrolling: a learner-app path like "
            "/study-library/courses — ask the admin for it; '' resets to the default), success_page: {content?, "
            "show_login_button?}): edits the invite's page. Payment plan and form are untouched. Allowed on live "
            "courses — new visitors see the change at once.\n"
            "- update_form_fields (course_id, invite_id, + any of: add: [{field_id, required?}] (only the institute's "
            "existing fields — courses(action='get_invite') lists them as available_fields), remove: [field_id], "
            "required: {field_id: true|false}, order: [field_id, …] (unlisted fields keep their order after these)): "
            "this invite's registration form. A label works wherever a field_id does. Never creates, renames or "
            "changes the type / options of a field (every form using it shares that); Full Name, Email and Phone "
            "cannot be removed. Allowed on live courses.\n"
            + PAYMENT_SPEC_DOC
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "action": {"type": "string", "enum": list(INVITES_EDIT_ACTIONS)},
                "course_id": {"type": "string"},
                "invite_id": {"type": "string"},
                "payment": {"type": "object", "description": "PAYMENT (see description)."},
                "payment_option_id": {"type": "string", "description": "create_invite: reuse an existing plan from "
                                                                       "courses(action='payment_setup')."},
                "name": {"type": "string", "description": "create_invite / update_invite: invite name "
                                                          "(create default: course name)."},
                "start_date": {"type": "string", "description": "YYYY-MM-DD (create default: today)."},
                "end_date": {"type": "string", "description": "YYYY-MM-DD, optional (link closes after it)."},
                "access_days": {"type": "integer", "description": "Days of access after enrolling (FREE invites)."},
                "landing": {"type": "object"},
                "form_fields": {"type": "array", "items": {"type": "object"}},
                "make_default": {"type": "boolean", "description": "create_invite: also make it the default."},
                "clear_end_date": {"type": "boolean", "description": "update_invite: remove the end date."},
                "images": {"type": "object", "description": "update_invite: {preview?, banner?, media?}."},
                "redirect_path": {"type": "string", "description": "update_invite: learner-app path, e.g. "
                                                                   "/study-library/courses."},
                "success_page": {"type": "object", "description": "update_invite: {content?, show_login_button?}."},
                "add": {"type": "array", "items": {"type": "object"},
                        "description": "update_form_fields: [{field_id, required?}]."},
                "remove": {"type": "array", "items": {"type": "string"}, "description": "update_form_fields."},
                "required": {"type": "object", "description": "update_form_fields: {field_id: bool}."},
                "order": {"type": "array", "items": {"type": "string"}, "description": "update_form_fields."},
                "batch_ids": {"type": "array", "items": {"type": "string"},
                              "description": "Which batches (session × level, ids from courses(action='get')) the "
                                             "invite enrols into. Needed when the course has several; several make "
                                             "one bundled invite. make_default: limit to these batches."},
            },
            "required": ["action"],
        },
    },
}


def _err(code: str, **extra: Any) -> Dict[str, Any]:
    return cbd.err(code, **extra)


# ── payment option (pure) ────────────────────────────────────────────────

def _price(value: Any, label: str) -> Tuple[Optional[float], Optional[str]]:
    try:
        p = round(float(value), 2)
    except (TypeError, ValueError):
        return None, f"{label} must be a number"
    if p < 0 or p > _MAX_PRICE:
        return None, f"{label} must be between 0 and {_MAX_PRICE}"
    return p, None


def _days(value: Any) -> Tuple[Optional[int], Optional[str]]:
    if value in (None, ""):
        return None, None
    try:
        d = int(value)
    except (TypeError, ValueError):
        return None, "validity_days must be an integer"
    return (d, None) if 1 <= d <= 3650 else (None, "validity_days must be 1-3650")


def build_payment_option(ctx: ToolContext, spec: Any, fallback_name: str) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    """A PaymentOptionDTO for POST /v1/payment-option, or (None, problem). Mirrors the dashboard's plan editor."""
    if not isinstance(spec, dict):
        return None, "payment must be an object — " + PAYMENT_SPEC_DOC
    ptype = str(spec.get("type") or "").upper().replace("UPFRONT", "ONE_TIME")
    if ptype not in PAYMENT_TYPES:
        return None, f"payment.type must be one of {', '.join(PAYMENT_TYPES)}"
    name = str(spec.get("name") or "").strip()[:120] or (
        f"{fallback_name} — {'Free' if ptype == 'FREE' else 'One-time' if ptype == 'ONE_TIME' else 'Subscription'}")
    currency = str(spec.get("currency") or "").upper().strip()
    if ptype != "FREE" and not _CURRENCY_RE.match(currency):
        return None, "payment.currency is required (3-letter ISO code, e.g. INR, USD) — ask the admin"
    currency = currency or "INR"
    option: Dict[str, Any] = {
        "name": name, "status": "ACTIVE", "source": "INSTITUTE", "source_id": ctx.principal.institute_id,
        "tag": None, "type": ptype, "require_approval": bool(spec.get("require_approval", False)),
        "plan_change_allowed": False,
    }

    def plan(pname: str, price: float, strike: Optional[float], days: Optional[int]) -> Dict[str, Any]:
        return {"name": pname, "status": "ACTIVE", "validity_in_days": days, "actual_price": price,
                "elevated_price": strike if strike and strike > price else price, "currency": currency,
                "description": name, "tag": "free", "feature_json": "[]", "plan_change_allowed": False}

    if ptype == "FREE":
        days, problem = _days(spec.get("validity_days"))
        if problem:
            return None, problem
        option["payment_plans"] = [plan(name, 0.0, None, days)]
        option["payment_option_metadata_json"] = json.dumps({
            "currency": currency, "features": [], "freeData": {},
            "config": {"free": {"accessType": "unlimited" if days is None else "limited", "validityDays": days}}})
        return option, None

    if ptype == "ONE_TIME":
        price, problem = _price(spec.get("price"), "payment.price")
        if problem:
            return None, problem
        if price <= 0:
            return None, "a ONE_TIME price must be above 0 — use type FREE for free access"
        strike = None
        if spec.get("strike_price") not in (None, ""):
            strike, problem = _price(spec.get("strike_price"), "payment.strike_price")
            if problem:
                return None, problem
        days, problem = _days(spec.get("validity_days"))
        if problem:
            return None, problem
        full = strike if strike and strike > price else price
        discount = {"type": "fixed", "amount": str(round(full - price, 2))} if full > price else {"type": "none"}
        option["payment_plans"] = [plan(name, price, strike, days)]
        option["payment_option_metadata_json"] = json.dumps({
            "currency": currency, "features": [],
            "config": {"upfront": {"fullPrice": str(full), "accessType": "lifetime" if days is None else "limited",
                                   "validityDays": days},
                       "planDiscounts": {"upfront": discount}},
            "upfrontData": {"fullPrice": str(full), "planDiscounts": {"upfront": discount}}})
        return option, None

    raw = spec.get("plans")
    if not isinstance(raw, list) or not 1 <= len(raw) <= 6:
        return None, "SUBSCRIPTION needs plans: 1-6 × {name, price, validity_days}"
    plans, intervals, discounts = [], [], {}
    for i, p in enumerate(raw):
        if not isinstance(p, dict):
            return None, f"plan {i + 1} must be an object"
        price, problem = _price(p.get("price"), f"plan {i + 1} price")
        if problem:
            return None, problem
        days, problem = _days(p.get("validity_days"))
        if problem or days is None:
            return None, problem or f"plan {i + 1} needs validity_days (e.g. 30 for monthly)"
        strike = None
        if p.get("strike_price") not in (None, ""):
            strike, problem = _price(p.get("strike_price"), f"plan {i + 1} strike_price")
            if problem:
                return None, problem
        pname = str(p.get("name") or f"{days} days").strip()[:80]
        full = strike if strike and strike > price else price
        plans.append(plan(pname, price, strike, days))
        intervals.append({"value": days, "unit": "days", "price": str(full), "title": pname, "features": []})
        discounts[f"interval_{i}"] = ({"type": "fixed", "amount": str(round(full - price, 2))}
                                      if full > price else {"type": "none"})
    option["payment_plans"] = plans
    option["payment_option_metadata_json"] = json.dumps({
        "currency": currency, "features": [], "unit": "days",
        "config": {"unit": "days", "subscription": {"unit": "days", "customIntervals": intervals},
                   "planDiscounts": discounts}})
    return option, None


def describe_option(option: Dict[str, Any]) -> Dict[str, Any]:
    plans = option.get("payment_plans") or []
    return {
        "id": option.get("id"), "name": option.get("name"), "type": option.get("type"),
        "requires_approval": option.get("require_approval"),
        "plans": [{"name": p.get("name"), "price": p.get("actual_price"),
                   "strike_price": p.get("elevated_price") if (p.get("elevated_price") or 0) > (p.get("actual_price") or 0) else None,
                   "currency": p.get("currency"), "validity_days": p.get("validity_in_days")} for p in plans],
    }


# ── registration form (pure) ─────────────────────────────────────────────

def _snake(name: str) -> str:
    return re.sub(r"[^a-z0-9_]", "", re.sub(r"\s+", "_", name.strip().lower()))


def form_fields_payload(ctx: ToolContext, defaults: List[Dict[str, Any]], extra: Any) -> Tuple[List[Dict[str, Any]], Optional[str]]:
    """The invite's institute_custom_fields: the institute defaults (reused by id) + extra new fields."""
    fields: List[Dict[str, Any]] = []
    seen: set = set()
    for d in defaults:
        cf = d.get("custom_field") or {}
        key = cf.get("fieldKey") or cf.get("field_key") or _snake(cf.get("fieldName") or "")
        if not cf.get("id") or cf.get("isHidden") or str(d.get("status") or "ACTIVE") != "ACTIVE" or key in seen:
            continue
        # Catalogue keys carry `_inst_<institute>`; a new field's label is matched against the bare name.
        seen.update({key, _base_key(key), _snake(cf.get("fieldName") or "")})
        required = d.get("is_mandatory") if d.get("is_mandatory") is not None else bool(cf.get("isMandatory"))
        fields.append(_field(ctx, len(fields), cf.get("id"), key, cf.get("fieldName") or key,
                             cf.get("fieldType") or "text", cf.get("config") or "", bool(required)))
    if not fields:
        for key, label in (("full_name", "Full Name"), ("email", "Email"), ("phone_number", "Phone Number")):
            seen.add(key)
            fields.append(_field(ctx, len(fields), "", key, label, "text", "", True))
    for i, f in enumerate(extra or []):
        if not isinstance(f, dict) or not str(f.get("label") or "").strip():
            return [], f"form_fields[{i}] needs a label"
        label = str(f["label"]).strip()[:80]
        ftype = str(f.get("type") or "text").lower()
        if ftype not in FIELD_TYPES:
            return [], f"form_fields[{i}].type must be one of {', '.join(FIELD_TYPES)}"
        key = _snake(label)
        if not key or key in seen:
            continue  # already on the form
        seen.add(key)
        config = ""
        if ftype == "dropdown":
            opts = [str(o).strip() for o in (f.get("options") or []) if str(o).strip()]
            if len(opts) < 2:
                return [], f"form_fields[{i}] (dropdown) needs at least 2 options"
            config = json.dumps([{"id": n + 1, "value": o, "label": o} for n, o in enumerate(opts)])
        fields.append(_field(ctx, len(fields), "", key, label, ftype, config, bool(f.get("required", False))))
    return fields, None


def _base_key(key: str) -> str:
    return re.sub(r"_inst_.*$", "", key or "")


def field_key_for(label: str, institute_id: str) -> str:
    """admin-core's key for a new field (CustomFieldKeyGenerator) — the row it would reuse AND overwrite."""
    key = re.sub(r"_+", "_", re.sub(r"[^a-zA-Z0-9_]", "_", label.lower())).strip("_")
    if not key or key[0].isdigit():
        key = "field_" + key
    if len(key) < 2:
        key += "_field"
    return f"{key}_inst_{institute_id}"


def bind_existing_fields(ctx: ToolContext, fields: List[Dict[str, Any]]) -> List[str]:
    """
    New fields whose label the institute already has are bound to that field by
    id, keeping ITS type and options. Without this admin-core finds the row by
    key and overwrites its definition — on every other form that uses it.
    Returns a note per reused field.
    """
    fresh = {field_key_for(f["custom_field"]["fieldName"], ctx.principal.institute_id): f
             for f in fields if not f["custom_field"]["id"]}
    notes = []
    for key, row in cbd.custom_fields_by_keys(ctx, list(fresh)).items():
        cf = fresh[key]["custom_field"]
        cf.update({"id": row["id"], "fieldKey": key, "fieldName": row.get("field_name") or cf["fieldName"],
                   "fieldType": row.get("field_type") or cf["fieldType"], "config": row.get("config") or ""})
        notes.append(f"'{cf['fieldName']}' already exists in this institute, so its existing type and options were "
                     "used.")
    return notes


def _cf_value(cf: Dict[str, Any], camel: str, snake: str) -> Any:
    return cf.get(camel) if cf.get(camel) is not None else cf.get(snake)


def field_options(config: Any) -> Optional[List[str]]:
    """A choice field's options from its stored config (JSON list, {options: …} or "A,B")."""
    if not config:
        return None
    data: Any = config
    if isinstance(config, str):
        try:
            data = json.loads(config)
        except ValueError:
            return [o.strip() for o in config.split(",") if o.strip()] or None
    if isinstance(data, dict):
        data = data.get("options") or [o for o in str(data.get("coommaSepartedOptions") or "").split(",") if o]
    if not isinstance(data, list):
        return None
    out = [str(o.get("label") or o.get("value") or "") if isinstance(o, dict) else str(o) for o in data]
    return [o for o in out if o.strip()] or None


def field_view(mapping: Dict[str, Any]) -> Dict[str, Any]:
    """One form field as the model sees it."""
    cf = mapping.get("custom_field") or {}
    required = mapping.get("is_mandatory")
    if required is None:
        required = _cf_value(cf, "isMandatory", "is_mandatory")
    key = _cf_value(cf, "fieldKey", "field_key") or ""
    view: Dict[str, Any] = {"field_id": cf.get("id"), "label": _cf_value(cf, "fieldName", "field_name"),
                            "type": str(_cf_value(cf, "fieldType", "field_type") or "text").lower(),
                            "required": bool(required)}
    options = field_options(cf.get("config"))
    if options and view["type"] in ("dropdown", "radio", "multi_select", "checkbox"):
        view["options"] = options
    if any(key.startswith(k) for k in SEEDED_FIELD_KEYS):
        view["locked"] = True
    return view


def form_field_views(mappings: Any) -> List[Dict[str, Any]]:
    """An invite's ACTIVE fields in form order."""
    rows = [m for m in (mappings or []) if isinstance(m, dict) and str(m.get("status") or "ACTIVE") == "ACTIVE"
            and (m.get("custom_field") or {}).get("id")]
    rows.sort(key=lambda m: m.get("individual_order") if isinstance(m.get("individual_order"), int) else 10_000)
    return [field_view(m) for m in rows]


def catalogue_field_views(catalogue: Any) -> List[Dict[str, Any]]:
    """The institute's fields (Settings → Custom Fields) that can be put on a form."""
    out, seen = [], set()
    for m in catalogue if isinstance(catalogue, list) else []:
        cf = (m or {}).get("custom_field") or {}
        if not cf.get("id") or cf.get("isHidden") or str(m.get("status") or "ACTIVE") != "ACTIVE" or cf["id"] in seen:
            continue
        seen.add(cf["id"])
        out.append(field_view(m))
    return out


def _find_field(ref: Any, pool: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """A field by id, else by label (case-insensitive)."""
    ref = str(ref or "").strip()
    if not ref:
        return None
    return next((f for f in pool if f["field_id"] == ref), None) or \
        next((f for f in pool if str(f.get("label") or "").strip().casefold() == ref.casefold()), None)


def _field(ctx: ToolContext, order: int, cf_id: str, key: str, label: str, ftype: str, config: str,
           required: bool) -> Dict[str, Any]:
    return {
        "id": "", "institute_id": ctx.principal.institute_id, "type": "", "type_id": "",
        "individual_order": order, "is_mandatory": required,
        "custom_field": {
            "guestId": "", "id": cf_id or "", "fieldKey": key, "fieldName": label, "fieldType": ftype,
            "defaultValue": "", "config": config, "formOrder": order, "isMandatory": required,
            "isFilter": True, "isSortable": True, "createdAt": "", "updatedAt": "", "sessionId": "",
            "liveSessionId": "", "customFieldValue": "", "groupName": "", "status": "ACTIVE",
        },
    }


def _iso_day(value: Any) -> Tuple[Optional[str], Optional[str]]:
    if value in (None, ""):
        return None, None
    try:
        return date.fromisoformat(str(value)[:10]).isoformat(), None
    except ValueError:
        return None, "dates must be YYYY-MM-DD"


# ── shared steps ─────────────────────────────────────────────────────────

def _course_and_batches(ctx: ToolContext, course_id: Any) -> Tuple[Optional[Dict[str, Any]], List[Dict[str, Any]], Optional[Dict[str, Any]]]:
    """The course and its ACTIVE batches (session × level), or an error."""
    course = cbd.course_row(ctx, str(course_id or ""))
    if not course:
        return None, [], _err("unknown_course", message="No such course in this institute. Use courses(action='list').")
    batches = cbd.course_batches(ctx, course["id"])
    if not batches:
        return None, [], _err("no_batch", message="This course has no active batch to enrol into.")
    return course, batches, None


def _batch_view(b: Dict[str, Any]) -> Dict[str, Any]:
    return {"id": b["id"], "name": b["name"], "session": b.get("session"), "level": b.get("level")}


def pick_batches(batches: List[Dict[str, Any]], requested: Any) -> Tuple[Optional[List[str]], Optional[Dict[str, Any]]]:
    """
    Which batches an invite enrols into. A one-batch course needs no choice; a
    course with several sessions / levels needs `batch_ids` — guessing would
    sell the wrong class or year.
    """
    ids = [str(x) for x in (requested or []) if x]
    known = {b["id"] for b in batches}
    if ids:
        unknown = [i for i in ids if i not in known]
        if unknown:
            return None, _err("unknown_batch", message="Some batch_ids are not batches of this course.",
                              batch_ids=unknown, batches=[_batch_view(b) for b in batches])
        return list(dict.fromkeys(ids)), None
    if len(batches) == 1:
        return [batches[0]["id"]], None
    return None, _err("choose_batch",
                      message="This course has several batches (session × level). Ask the admin which one(s) this "
                              "invite is for and pass batch_ids; several batch_ids make ONE bundled invite that "
                              "enrols the learner into all of them.",
                      batches=[_batch_view(b) for b in batches])


async def _create_option(ctx: ToolContext, spec: Any, fallback_name: str,
                         vendors: Optional[List[Dict[str, str]]] = None) -> Tuple[Optional[Dict[str, Any]], Optional[Dict[str, Any]]]:
    option, problem = build_payment_option(ctx, spec, fallback_name)
    if problem:
        return None, _err("invalid_payment", message=problem)
    if option["type"] != "FREE":
        vendors = vendors if vendors is not None else await cbd.payment_vendors(ctx)
        if not vendors:
            return None, _err("no_payment_gateway",
                              message="This institute has no payment gateway set up, so paid plans cannot take payments. "
                                      "An admin connects one under Settings → Payment; until then only FREE works.")
    saved = await cbd.admin_core(ctx, "POST", "/admin-core-service/v1/payment-option", body=option)
    if cbd.is_error(saved) or not isinstance(saved, dict) or not saved.get("id"):
        return None, _err("save_failed", message="The payment plan could not be created.",
                          detail=saved.get("message") if isinstance(saved, dict) else None)
    return saved, None


async def _make_default(ctx: ToolContext, invite_id: str, batch: str) -> Any:
    return await cbd.admin_core(
        ctx, "PUT", "/admin-core-service/v1/enroll-invite/update-default-enroll-invite-config",
        params={"enrollInviteId": invite_id, "packageSessionId": batch},
    )


async def _invite_link(ctx: ToolContext, invite_id: str) -> Dict[str, Any]:
    full = await cbd.admin_core(ctx, "GET", f"/admin-core-service/v1/enroll-invite/{ctx.principal.institute_id}/{invite_id}")
    if not isinstance(full, dict) or cbd.is_error(full):
        return {}
    link = full.get("short_url")
    if not link and full.get("invite_code"):
        from .website_data import learner_portal_base
        base = learner_portal_base(ctx)
        if base:
            base = base if base.startswith("http") else f"https://{base}"
            link = (f"{base}/learner-invitation-response?instituteId={ctx.principal.institute_id}"
                    f"&inviteCode={full['invite_code']}")
    return {"link": link, "invite_code": full.get("invite_code"), "availability": full.get("availability_status")}


# ── actions ──────────────────────────────────────────────────────────────

async def _action_create_invite(args: Dict[str, Any], ctx: ToolContext) -> Dict[str, Any]:
    course, batches, error = _course_and_batches(ctx, args.get("course_id"))
    if error:
        return error
    batch_ids, error = pick_batches(batches, args.get("batch_ids"))
    if error:
        return error
    if not args.get("payment") and not args.get("payment_option_id"):
        return _err("missing_argument", action="create_invite", needs=["payment or payment_option_id"],
                    message="Ask the admin whether the course is free or paid (and the price) — never assume.")
    start, problem = _iso_day(args.get("start_date") or date.today().isoformat())
    end, problem2 = _iso_day(args.get("end_date"))
    if problem or problem2:
        return _err("bad_request", message=problem or problem2)
    if end and start and end < start:
        return _err("bad_request", message="end_date is before start_date")
    access_days = args.get("access_days")
    if access_days not in (None, ""):
        try:
            access_days = int(access_days)
        except (TypeError, ValueError):
            return _err("bad_request", message="access_days must be an integer")
        if not 1 <= access_days <= 3650:
            return _err("bad_request", message="access_days must be 1-3650")
    else:
        access_days = None

    defaults = await cbd.admin_core(ctx, "GET", "/admin-core-service/common/custom-fields",
                                    params={"instituteId": ctx.principal.institute_id})
    fields, problem = form_fields_payload(ctx, defaults if isinstance(defaults, list) else [], args.get("form_fields"))
    if problem:
        return _err("invalid_form_fields", message=problem)
    field_notes = bind_existing_fields(ctx, fields)

    vendors = await cbd.payment_vendors(ctx)
    if args.get("payment_option_id"):
        option_id = str(args["payment_option_id"])
        options = await cbd.admin_core(
            ctx, "POST", "/admin-core-service/v1/payment-option/get-payment-options",
            body={"source": "INSTITUTE", "source_id": ctx.principal.institute_id, "exclude_types": ["CPO"]})
        option = next((o for o in options if isinstance(o, dict) and o.get("id") == option_id), None) \
            if isinstance(options, list) else None
        if option is None:
            return _err("unknown_payment_option", message="No such payment plan; see courses(action='payment_setup').")
        if option.get("type") not in ("FREE", "DONATION") and not vendors:
            return _err("no_payment_gateway", message="No payment gateway is set up; only FREE plans can be used.")
    else:
        option, error = await _create_option(ctx, args["payment"], course["name"], vendors)
        if error:
            return error

    landing = args.get("landing") if isinstance(args.get("landing"), dict) else {}
    tags = landing.get("tags") if isinstance(landing.get("tags"), list) else \
        [t for t in (course.get("tags") or "").split(",") if t]
    meta = {
        "course": course["name"],
        "description": landing.get("description_html") or course.get("about_the_course") or "",
        "learningOutcome": landing.get("learning_outcome_html") or course.get("why_learn") or "",
        "aboutCourse": landing.get("about_html") or course.get("about_the_course") or "",
        "targetAudience": landing.get("target_audience_html") or course.get("who_should_learn") or "",
        "coursePreview": course.get("course_preview_image_media_id") or "",
        "courseBanner": course.get("course_banner_media_id") or "",
        "courseMedia": {"type": "", "id": ""},
        "tags": [str(t)[:40] for t in tags][:10],
        "showRelatedCourses": False, "includeInstituteLogo": True, "blendHeaderWithBackground": False,
        "restrictToSameBatch": False, "includePaymentPlans": True, "customHtml": "",
    }
    vendor = vendors[0] if vendors else {}
    currency = next((p.get("currency") for p in option.get("payment_plans") or [] if p.get("currency")), None) or "INR"
    name = str(args.get("name") or course["name"]).strip()[:120]
    invite_body = {
        "name": name, "start_date": start, "end_date": end, "status": "ACTIVE",
        "institute_id": ctx.principal.institute_id, "vendor": vendor.get("vendor"),
        "vendor_id": vendor.get("vendor_id") or vendor.get("vendor"), "currency": currency, "tag": "",
        "is_bundled": len(batch_ids) > 1, "learner_access_days": access_days,
        "web_page_meta_data_json": json.dumps(meta),
        "setting_json": json.dumps({"postformfillConfiguration": {"showLoginButton": True}}),
        "institute_custom_fields": fields,
        "package_session_to_payment_options": [
            {"package_session_id": bid, "payment_option": {"id": option["id"]}, "status": "ACTIVE"}
            for bid in batch_ids],
    }
    created = await cbd.admin_core(ctx, "POST", "/admin-core-service/v1/enroll-invite", body=invite_body)
    invite_id = created.strip().strip('"') if isinstance(created, str) else (
        created.get("id") if isinstance(created, dict) and not cbd.is_error(created) else None)
    if not invite_id:
        return _err("save_failed", message="The invite could not be created.",
                    detail=created.get("message") if isinstance(created, dict) else None,
                    payment_option_id=option.get("id"))
    made_default = False
    notes = list(field_notes)
    if args.get("make_default"):
        if course["status"] == cbd.STATUS_ACTIVE:
            notes.append("Not made the default: the course is live — change its default invite in the dashboard.")
        else:
            results = [await _make_default(ctx, invite_id, bid) for bid in batch_ids]
            made_default = not any(cbd.is_error(r) for r in results)
            if not made_default:
                notes.append("The invite was created but could not be made the default for every batch.")
    elif course["status"] != cbd.STATUS_ACTIVE:
        notes.append("This is not the course's default invite yet; call make_default if catalogue enrolments "
                     "should use this price.")
    link = await _invite_link(ctx, invite_id)
    by_id = {b["id"]: b for b in batches}
    return {
        "invite": {"id": invite_id, "name": name, "is_default": made_default, **link,
                   "batches": [_batch_view(by_id[b]) for b in batch_ids], "bundled": len(batch_ids) > 1,
                   "form_fields": [f["custom_field"]["fieldName"] for f in fields]},
        "payment": describe_option(option),
        "course": {"id": course["id"], "name": course["name"], "status": course["status"]},
        "notes": notes + ([] if course["status"] == cbd.STATUS_ACTIVE else [
            "Learners can only enrol once the course is approved and live (course_edit(submit_for_review))."]),
    }


async def _action_create_payment_plan(args: Dict[str, Any], ctx: ToolContext) -> Dict[str, Any]:
    if not args.get("payment"):
        return _err("missing_argument", action="create_payment_plan", needs=["payment"])
    invite_id = str(args.get("invite_id") or "").strip()
    course = invite = None
    if invite_id:
        course, batches, error = _course_and_batches(ctx, args.get("course_id"))
        if error:
            return error
        if course["status"] == cbd.STATUS_ACTIVE:
            return _err("course_is_live", message="This course is live; change its invite's plan in the dashboard. "
                                                  "You can still create a NEW invite with create_invite.")
        invite = cbd.invite_row(ctx, invite_id, [b["id"] for b in batches])
        if not invite:
            return _err("unknown_invite", message="No such invite for this course. Use courses(action='invites').")
    option, error = await _create_option(ctx, args["payment"], (course or {}).get("name") or "Course")
    if error:
        return error
    result: Dict[str, Any] = {"payment": describe_option(option)}
    if invite:
        swapped = await cbd.admin_core(
            ctx, "PUT", "/admin-core-service/v1/enroll-invite/enroll-invite-payment-option",
            # One replacement per batch the invite enrols into, so a bundled invite stays whole.
            body=[{"enroll_invite_id": invite_id, "update_payment_options": [{
                "old_package_session_payment_option_id": link["link_id"],
                "new_package_session_payment_option": {
                    "package_session_id": link["package_session_id"], "payment_option": {"id": option["id"]},
                    "enroll_invite_id": invite_id, "status": "ACTIVE"},
            } for link in invite["links"]]}],
        )
        if cbd.is_error(swapped):
            result["notes"] = ["The plan was created but could not be attached to the invite; attach it in the dashboard."]
        else:
            result["invite"] = {"id": invite_id, "name": invite["name"], "link": invite.get("short_url")}
            result["notes"] = [f"'{invite['name']}' now charges this plan (its previous plan is no longer offered on it)."]
    else:
        result["next"] = "Use payment_option_id with create_invite to put this plan on a new invite."
    return result


async def _action_make_default(args: Dict[str, Any], ctx: ToolContext) -> Dict[str, Any]:
    if not args.get("invite_id"):
        return _err("missing_argument", action="make_default", needs=["course_id", "invite_id"])
    course, batches, error = _course_and_batches(ctx, args.get("course_id"))
    if error:
        return error
    if course["status"] == cbd.STATUS_ACTIVE:
        return _err("course_is_live", message="This course is live; change its default invite in the dashboard.")
    invite = cbd.invite_row(ctx, str(args["invite_id"]), [b["id"] for b in batches])
    if not invite:
        return _err("unknown_invite", message="No such invite for this course. Use courses(action='invites').")
    # The default invite is per batch: by default make it the default of every batch it enrols into.
    targets = invite["batch_ids"]
    if args.get("batch_ids"):
        targets = [b for b in invite["batch_ids"] if b in {str(x) for x in args["batch_ids"]}]
        if not targets:
            return _err("bad_request", message="This invite does not enrol into any of those batches.")
    by_id = {b["id"]: b for b in batches}
    failed = []
    for bid in targets:
        if cbd.is_error(await _make_default(ctx, invite["id"], bid)):
            failed.append(by_id.get(bid, {}).get("name", bid))
    if len(failed) == len(targets):
        return _err("save_failed", message="The invite could not be made the default.")
    return {"default_invite": {"id": invite["id"], "name": invite["name"], "link": invite.get("short_url"),
                               "default_for": [_batch_view(by_id[b]) for b in targets if b in by_id
                                               and by_id[b]["name"] not in failed]},
            "failed_batches": failed,
            "course": {"id": course["id"], "name": course["name"]}}


# ── editing an invite (allowed on live courses) ──────────────────────────

_LIVE_NOTE = "The course is live: new visitors see this change right away."
_LANDING_KEYS = {"description_html": "description", "learning_outcome_html": "learningOutcome",
                 "about_html": "aboutCourse", "target_audience_html": "targetAudience"}
#: images slot → (meta key, the dashboard's cached-URL key, the course column 'course' copies)
_IMAGE_SLOTS = {"preview": ("coursePreview", "coursePreviewBlob", "course_preview_image_media_id"),
                "banner": ("courseBanner", "courseBannerBlob", "course_banner_media_id"),
                "media": ("courseMedia", "courseMediaBlob", "course_media_id")}


def _course_and_invite(ctx: ToolContext, args: Dict[str, Any], action: str) -> Tuple[Optional[Dict[str, Any]], Optional[Dict[str, Any]], Optional[Dict[str, Any]]]:
    if not args.get("invite_id"):
        return None, None, _err("missing_argument", action=action, needs=["course_id", "invite_id"])
    course, batches, error = _course_and_batches(ctx, args.get("course_id"))
    if error:
        return None, None, error
    invite = cbd.invite_row(ctx, str(args["invite_id"]).strip(), [b["id"] for b in batches])
    if not invite:
        return None, None, _err("unknown_invite", message="No such invite for this course. Use courses(action='invites').")
    return course, invite, None


def _json_obj(raw: Any) -> Dict[str, Any]:
    if isinstance(raw, dict):
        return dict(raw)
    try:
        data = json.loads(raw or "{}")
    except (TypeError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


async def _feature_fields(ctx: ToolContext, invite_id: str) -> Any:
    return await cbd.admin_core(ctx, "GET", "/admin-core-service/common/custom-fields/feature-fields",
                                params={"instituteId": ctx.principal.institute_id, "type": "ENROLL_INVITE",
                                        "typeId": invite_id})


def _mapping_payload(fields: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Fields by id ONLY: admin-core writes a sent label / type / options onto the
    shared definition, so none are sent — only this form's order and required flag.
    """
    return [{"individual_order": i, "is_mandatory": bool(f["required"]), "status": "ACTIVE",
             "custom_field": {"id": f["field_id"]}} for i, f in enumerate(fields)]


async def _action_update_form_fields(args: Dict[str, Any], ctx: ToolContext) -> Dict[str, Any]:
    add, remove, required, order = (args.get(k) for k in ("add", "remove", "required", "order"))
    if not any((add, remove, required, order)):
        return _err("missing_argument", action="update_form_fields", needs=["one of add, remove, required, order"])
    course, invite, error = _course_and_invite(ctx, args, "update_form_fields")
    if error:
        return error
    current = await _feature_fields(ctx, invite["id"])
    catalogue = await cbd.admin_core(ctx, "GET", "/admin-core-service/common/custom-fields",
                                     params={"instituteId": ctx.principal.institute_id})
    if cbd.is_error(current) or not isinstance(current, list):
        return _err("fetch_failed", message="This invite's form could not be read.")
    fields = form_field_views(current)
    available = catalogue_field_views(catalogue)
    problems: List[str] = []
    notes: List[str] = []

    for ref in remove if isinstance(remove, list) else ([remove] if remove else []):
        f = _find_field(ref, fields)
        if not f:
            problems.append(f"remove: '{ref}' is not on this form")
        elif f.get("locked"):
            problems.append(f"remove: '{f['label']}' is a built-in field and cannot be removed (it can be made optional)")
        else:
            fields.remove(f)

    for item in add if isinstance(add, list) else ([add] if add else []):
        ref = (item.get("field_id") or item.get("label")) if isinstance(item, dict) else item
        f = _find_field(ref, available)
        if not f:
            problems.append(f"add: '{ref}' is not one of the institute's fields (see available_fields from "
                            "courses(action='get_invite'); new fields are created in Settings → Custom Fields)")
        elif any(x["field_id"] == f["field_id"] for x in fields):
            notes.append(f"'{f['label']}' is already on the form.")
        else:
            want = item.get("required") if isinstance(item, dict) else None
            fields.append({**f, "required": f["required"] if want is None else bool(want)})

    if required is not None and not isinstance(required, dict):
        problems.append("required must be an object: {field_id: true|false}")
    for ref, value in (required or {}).items() if isinstance(required, dict) else []:
        f = _find_field(ref, fields)
        if not f:
            problems.append(f"required: '{ref}' is not on this form")
        elif not isinstance(value, bool):
            problems.append(f"required: '{ref}' must be true or false")
        else:
            f["required"] = value

    if order:
        listed: List[Dict[str, Any]] = []
        for ref in order if isinstance(order, list) else [order]:
            f = _find_field(ref, fields)
            if not f:
                problems.append(f"order: '{ref}' is not on this form")
            elif f not in listed:
                listed.append(f)
        fields = listed + [f for f in fields if f not in listed]

    if problems:
        return _err("invalid_form_fields", problems=problems, form_fields=fields)
    saved = await cbd.admin_core(
        ctx, "POST", "/admin-core-service/common/custom-fields/feature-fields",
        params={"instituteId": ctx.principal.institute_id, "type": "ENROLL_INVITE", "typeId": invite["id"]},
        body=_mapping_payload(fields))
    if cbd.is_error(saved):
        return _err("save_failed", message="The form could not be saved.",
                    detail=saved.get("message") if isinstance(saved, dict) else None)
    if course["status"] == cbd.STATUS_ACTIVE:
        notes.append(_LIVE_NOTE)
    return {"invite": {"id": invite["id"], "name": invite["name"], "link": invite.get("short_url")},
            "form_fields": fields, "notes": notes}


def _media_json(raw: Any) -> Dict[str, str]:
    """A course's / invite's intro media: {type: image|video|youtube, id}."""
    data = _json_obj(raw) if not isinstance(raw, dict) else raw
    return {"type": str(data.get("type") or ""), "id": str(data.get("id") or "")}


def _course_image(slot: str, course: Dict[str, Any]) -> Any:
    _, _, course_col = _IMAGE_SLOTS[slot]
    if slot == "media":
        return _media_json(course.get(course_col))
    return course.get(course_col) or ""


async def _image_value(ctx: ToolContext, slot: str, spec: Any, course: Dict[str, Any]) -> Tuple[Any, Optional[str]]:
    """The meta value for an image slot (a media file id; courseMedia is {type, id}), or (None, problem)."""
    if spec == "course":
        return _course_image(slot, course), None
    resolved, problem = await cbd.resolve_media(ctx, spec, f"images.{slot}", allow_youtube=slot == "media")
    if problem:
        return None, problem
    kind, value = resolved
    return ({"type": kind, "id": value} if slot == "media" else value), None


async def _set_image(ctx: ToolContext, meta: Dict[str, Any], slot: str, value: Any) -> None:
    from .assistant_tool_registry import _media_public_url
    meta_key, blob_key, _ = _IMAGE_SLOTS[slot]
    meta[meta_key] = value
    fid = value.get("id") if isinstance(value, dict) else value
    kind = value.get("type") if isinstance(value, dict) else "image"
    # The dashboard previews the cached URL; the learner page reads the id.
    meta[blob_key] = (fid if kind == "youtube" else (await _media_public_url(ctx, fid) if fid else "")) or ""


async def _read_invite(ctx: ToolContext, invite_id: str) -> Tuple[Optional[Dict[str, Any]], List[Dict[str, Any]], Optional[Dict[str, Any]]]:
    """The invite as admin-core returns it + its payment links, or an error."""
    full = await cbd.admin_core(ctx, "GET", f"/admin-core-service/v1/enroll-invite/{ctx.principal.institute_id}/{invite_id}")
    if cbd.is_error(full) or not isinstance(full, dict) or full.get("id") != invite_id:
        return None, [], _err("fetch_failed", message="The invite could not be read.")
    links = [m for m in full.get("package_session_to_payment_options") or [] if isinstance(m, dict)]
    if not links or not all(m.get("id") and (m.get("payment_option") or {}).get("id") for m in links):
        return None, [], _err("fetch_failed", message="This invite's payment links could not be read, so it was not changed.")
    return full, links, None


async def _save_invite(ctx: ToolContext, full: Dict[str, Any], links: List[Dict[str, Any]],
                       changes: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """
    PUT the invite back: everything as read, plus `changes`. admin-core's update
    overwrites every column it is sent, so nothing may be left out.
    """
    body: Dict[str, Any] = {k: v for k, v in full.items()
                            if k not in ("availability_status", "sub_org", "gtm_container_id")}
    body.update(changes)
    # The form is not changed here. admin-core re-syncs the fields only when
    # institute_id is sent, so it is left out — and the current fields go along by id
    # anyway, so even a re-sync would keep the form exactly as it is.
    body["institute_id"] = None
    body["institute_custom_fields"] = _mapping_payload(form_field_views(full.get("institute_custom_fields")))
    # Links sent WITH their ids stay as they are (without, admin-core deletes and recreates them).
    body["package_session_to_payment_options"] = [
        {"id": m["id"], "package_session_id": m.get("package_session_id"), "enroll_invite_id": full["id"],
         "status": "ACTIVE", "payment_option": {"id": m["payment_option"]["id"]}} for m in links]
    saved = await cbd.admin_core(ctx, "PUT", "/admin-core-service/v1/enroll-invite/enroll-invite", body=body)
    if cbd.is_error(saved):
        return _err("save_failed", message="The invite could not be saved.",
                    detail=saved.get("message") if isinstance(saved, dict) else None)
    return None


def _slot_empty(meta: Dict[str, Any], slot: str) -> bool:
    value = meta.get(_IMAGE_SLOTS[slot][0])
    return not (_media_json(value)["id"] if slot == "media" else value)


async def fill_empty_invite_images(ctx: ToolContext, course: Dict[str, Any],
                                   batch_ids: List[str], slots: List[str]) -> Dict[str, List[str]]:
    """
    After a course's images change: give the course's invites those images in
    every slot the invite has left EMPTY. An image an invite was given on purpose
    is never replaced. Returns the invites updated and the ones that failed.
    """
    out: Dict[str, List[str]] = {"updated": [], "failed": []}
    for invite in cbd.invites_for_batches(ctx, batch_ids):
        full, links, error = await _read_invite(ctx, invite["id"])
        if error:
            out["failed"].append(invite["name"])
            continue
        meta = _json_obj(full.get("web_page_meta_data_json"))
        empty = [slot for slot in slots if _slot_empty(meta, slot) and not _slot_empty(
            {_IMAGE_SLOTS[slot][0]: _course_image(slot, course)}, slot)]
        if not empty:
            continue
        for slot in empty:
            await _set_image(ctx, meta, slot, _course_image(slot, course))
        if await _save_invite(ctx, full, links, {"web_page_meta_data_json": json.dumps(meta)}):
            out["failed"].append(invite["name"])
        else:
            out["updated"].append(invite["name"])
    return out


async def _action_update_invite(args: Dict[str, Any], ctx: ToolContext) -> Dict[str, Any]:
    keys = ("name", "start_date", "end_date", "clear_end_date", "landing", "images", "redirect_path", "success_page")
    if not any(args.get(k) is not None for k in keys):
        return _err("missing_argument", action="update_invite", needs=["one of " + ", ".join(keys)])
    course, invite, error = _course_and_invite(ctx, args, "update_invite")
    if error:
        return error
    full, links, error = await _read_invite(ctx, invite["id"])
    if error:
        return error

    changed: List[str] = []
    body: Dict[str, Any] = {}

    if args.get("name") is not None:
        name = str(args["name"]).strip()[:120]
        if not name:
            return _err("bad_request", message="name cannot be empty")
        body["name"] = name
        changed.append("name")
    start, problem = _iso_day(args.get("start_date"))
    end, problem2 = _iso_day(args.get("end_date"))
    if problem or problem2:
        return _err("bad_request", message=problem or problem2)
    if start:
        body["start_date"] = start
        changed.append("start_date")
    if args.get("clear_end_date"):
        body["end_date"] = None
        changed.append("end_date")
    elif end:
        body["end_date"] = end
        changed.append("end_date")
    eff_start = _iso_day(body.get("start_date", full.get("start_date")))[0]
    eff_end = _iso_day(body.get("end_date", full.get("end_date")))[0]
    if eff_start and eff_end and eff_end < eff_start:
        return _err("bad_request", message="end_date is before start_date")

    meta = _json_obj(full.get("web_page_meta_data_json"))
    landing = args.get("landing")
    if landing is not None:
        if not isinstance(landing, dict):
            return _err("bad_request", message="landing must be an object")
        for arg_key, meta_key in _LANDING_KEYS.items():
            if landing.get(arg_key) is not None:
                html = str(landing[arg_key])
                if len(html) > _MAX_HTML:
                    return _err("bad_request", message=f"landing.{arg_key} is over {_MAX_HTML} characters")
                meta[meta_key] = html
                changed.append(meta_key)
        if landing.get("tags") is not None:
            if not isinstance(landing["tags"], list):
                return _err("bad_request", message="landing.tags must be a list of strings")
            meta["tags"] = [str(t).strip()[:40] for t in landing["tags"] if str(t).strip()][:10]
            changed.append("tags")

    settings = _json_obj(full.get("setting_json"))
    post_fill = dict(settings.get("postformfillConfiguration") or {})
    if args.get("redirect_path") is not None:
        path = str(args["redirect_path"]).strip()
        if path and not _REDIRECT_RE.match(path):
            return _err("bad_request", message="redirect_path must be a learner-app path starting with '/', e.g. "
                                               "/study-library/courses (not a full URL)")
        if path:
            post_fill["redirectPath"] = path
        else:
            post_fill.pop("redirectPath", None)
        changed.append("redirect_path")
    success = args.get("success_page")
    if success is not None:
        if not isinstance(success, dict):
            return _err("bad_request", message="success_page must be an object: {content?, show_login_button?}")
        if success.get("content") is not None:
            if len(str(success["content"])) > _MAX_HTML:
                return _err("bad_request", message=f"success_page.content is over {_MAX_HTML} characters")
            post_fill["content"] = str(success["content"])
            changed.append("success_page.content")
        if success.get("show_login_button") is not None:
            if not isinstance(success["show_login_button"], bool):
                return _err("bad_request", message="success_page.show_login_button must be true or false")
            post_fill["showLoginButton"] = success["show_login_button"]
            changed.append("success_page.show_login_button")

    images = args.get("images")
    if images is not None:
        if not isinstance(images, dict) or not images or set(images) - set(_IMAGE_SLOTS):
            return _err("bad_request", message="images must be {preview?, banner?, media?}")
        # Every image is checked before any is imported, so a bad one leaves nothing half-done.
        for slot, spec in images.items():
            problem = None if spec == "course" else cbd.check_media_spec(spec, f"images.{slot}",
                                                                         allow_youtube=slot == "media")
            if problem:
                return _err("bad_request", message=problem)
        for slot, spec in images.items():
            value, problem = await _image_value(ctx, slot, spec, course)
            if problem:
                return _err("image_failed", message=problem)
            await _set_image(ctx, meta, slot, value)
            changed.append(f"images.{slot}")

    if not changed:
        return _err("missing_argument", action="update_invite", message="Nothing to change.")
    body["web_page_meta_data_json"] = json.dumps(meta)
    if post_fill != (settings.get("postformfillConfiguration") or {}):
        settings["postformfillConfiguration"] = post_fill
        body["setting_json"] = json.dumps(settings)
    error = await _save_invite(ctx, full, links, body)
    if error:
        return error
    return {"invite": {"id": invite["id"], "name": body.get("name", full.get("name")),
                       "link": full.get("short_url") or invite.get("short_url")},
            "changed": list(dict.fromkeys(changed)),
            "notes": [_LIVE_NOTE] if course["status"] == cbd.STATUS_ACTIVE else []}


_ACTIONS = {"create_invite": _action_create_invite, "create_payment_plan": _action_create_payment_plan,
            "make_default": _action_make_default, "update_invite": _action_update_invite,
            "update_form_fields": _action_update_form_fields}


async def execute_course_invites_edit(args: Dict[str, Any], ctx: ToolContext) -> str:
    action = str((args or {}).get("action") or "").strip()
    handler = _ACTIONS.get(action)
    if handler is None:
        return json.dumps(_err("unknown_action", action=action, available=list(INVITES_EDIT_ACTIONS)))
    result = await handler(args or {}, ctx)
    if isinstance(result, dict) and "action" not in result:
        result = {"action": action, **result}
    return json.dumps(result, ensure_ascii=False, default=str)


INVITES_EDIT_TOOLS: Dict[str, ToolSpec] = {
    INVITES_EDIT_TOOL_NAME: ToolSpec(
        name=INVITES_EDIT_TOOL_NAME,
        schema=INVITES_EDIT_SCHEMA,
        executor=execute_course_invites_edit,
        required_permission=None,
        setting_key=INVITES_EDIT_GROUP_KEY,
        default_enabled=False,
        default_roles=None,
        phase=3,
        mode="WRITE",
    ),
}


def _register() -> None:
    from .assistant_tool_registry import ASSISTANT_TOOLS, GROUP_LABELS
    ASSISTANT_TOOLS.update(INVITES_EDIT_TOOLS)
    GROUP_LABELS.update({INVITES_EDIT_GROUP_KEY: "Courses: invite links & payment plans"})


_register()

__all__ = ["INVITES_EDIT_TOOLS", "INVITES_EDIT_TOOL_NAME", "INVITES_EDIT_GROUP_KEY", "INVITES_EDIT_ACTIONS",
           "INVITES_EDIT_SCHEMA", "execute_course_invites_edit", "build_payment_option", "form_fields_payload",
           "describe_option", "form_field_views", "catalogue_field_views", "field_key_for",
           "fill_empty_invite_images"]
