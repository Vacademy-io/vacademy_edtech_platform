"""
The ``learner_enroll`` tool — enrol learners (existing or new, one or a CSV's
worth) into one or more courses through the invites the admin picks, for the
Assistant and the MCP server.

It sends exactly what the dashboard's "Enroll Learner" wizard sends:
``POST /admin-core-service/v3/learner-management/assign`` — every learner into
every chosen course, dry run first.

Safety (MCP has no confirm card):

* two calls: ``preview`` runs admin-core's dry run and returns a confirm_token
  signed over the exact request; ``enroll`` refuses without a matching,
  unexpired token — so the admin always sees the outcome before it happens;
* additive only: never de-assigns; duplicate handling is SKIP or ERROR, never
  RE_ENROLL (admin-core re-activates terminated / expired enrolments on its
  own, exactly as in the dashboard);
* admin-core does not check that an invite belongs to the institute or the
  batch, so every invite is checked here against this institute's invites of
  that batch (bare SUB_ORG invites refused, as the dashboard hides them);
* existing learner_ids must be learners of this institute;
* batches sold to organisations (is_org_associated) are refused — they need
  the sub-org step, which is dashboard-only for now;
* notify / send-credentials are refused when Course Settings hide them.
"""
from __future__ import annotations

import csv
import io
import json
import logging
from datetime import date
from typing import Any, Dict, List, Optional, Tuple

from . import course_builder_data as cbd
from . import learner_data as ld
from .assistant_tool_registry import ToolContext, ToolSpec
from .assistant_tools_learners import TEMPLATE_COLUMNS, enrollable_invites, invite_view

logger = logging.getLogger(__name__)

ENROLL_TOOL_NAME = "learner_enroll"
ENROLL_GROUP_KEY = "learner_enrollments"
ENROLL_ACTIONS = ("preview", "enroll")
ASSIGN_PATH = "/admin-core-service/v3/learner-management/assign"

MAX_LEARNERS = 200
MAX_COURSES = 10
_MAX_RESULT_ROWS = 60
GENDERS = ("MALE", "FEMALE", "OTHER")
#: The enroll_template's sample row — a value copied from it is never a real learner's.
_SAMPLE_VALUES = {"student@example.com", "919876543210", "9876543210"}
_ROW_KEYS = {k for k, _, _ in TEMPLATE_COLUMNS}
#: Plain profile columns copied onto NewUserDTO as-is.
_TEXT_KEYS = ("full_name", "username", "password", "address_line", "pin_code", "city", "region",
              "linked_institute_name", "fathers_name", "mothers_name", "parents_mobile_number", "parents_email",
              "parents_to_mother_mobile_number", "parents_to_mother_email")

ENROLL_SCHEMA: Dict[str, Any] = {
    "type": "function",
    "function": {
        "name": ENROLL_TOOL_NAME,
        "description": (
            "Enrol learners into courses through an invite — one learner or a whole list / CSV, into one or several "
            "courses at once (every learner goes into every course listed, like the dashboard's Enroll Learner "
            "dialog). Never removes or unenrols anyone. Steps: learners(action='enroll_options') for the courses → "
            "ask the admin which invite when a course has several (never pick a price for them) → "
            "preview → show the admin the outcome (who is new, who is already enrolled and skipped, which invite / "
            "price) and get a clear yes → enroll with the SAME arguments plus confirm_token. Pick an `action`:\n"
            "- preview (learners and/or csv, courses, options?): checks everything and runs a dry run. Nothing is "
            "saved. Returns the per-learner outcome and a confirm_token (valid 15 min).\n"
            "- enroll (same arguments + confirm_token): does it. Changed arguments need a new preview.\n"
            "learners: [{learner_id} (an existing learner, from learners(action='find')) | a new-learner row using the "
            "enroll_template columns, e.g. {full_name, email, mobile_number, …, custom_fields?: {label: value}}] "
            f"(max {MAX_LEARNERS}). csv: the filled-in template as CSV text (header row first). A row whose email / "
            "mobile already belongs to a learner of this institute enrols that learner and leaves their profile "
            "as is.\n"
            "courses: [{course_id, batch_id? (needed when the course has several batches), invite_id? (needed when "
            f"the course has several invites), access_days?}}] (max {MAX_COURSES}).\n"
            "options: {send_welcome_email: bool (the 'Welcome to <institute>' enrolment email — ASK the admin), "
            "send_credentials: bool (email username + password to NEW learners — ASK the admin; only asked when "
            "new accounts are created), duplicate_handling?: SKIP (default: already-enrolled learners are skipped) | "
            "ERROR (reported as failed), payment_date?: YYYY-MM-DD (offline payment received), transaction_id?, "
            "credentials_file: bool (a CSV of every enrolled learner's username + password, delivered as a private "
            "download link valid 30 minutes — ASK the admin)}. Never assume these answers: preview returns error "
            "'ask_admin' until they are given (a switch turned off in Course Settings is not asked). Hand the "
            "credentials link to the admin as is; never open it. The preview also lists the enrolment automations that "
            "will run anyway — they may send their own welcome message; tell the admin."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "action": {"type": "string", "enum": list(ENROLL_ACTIONS)},
                "learners": {"type": "array", "items": {"type": "object"},
                             "description": "[{learner_id}] for existing learners and/or new-learner rows."},
                "csv": {"type": "string", "description": "The filled-in enroll_template as CSV text."},
                "courses": {"type": "array", "items": {"type": "object"},
                            "description": "[{course_id, batch_id?, invite_id?, access_days?}]"},
                "options": {"type": "object"},
                "confirm_token": {"type": "string", "description": "enroll: the token preview returned."},
            },
            "required": ["action"],
        },
    },
}


def _err(code: str, **extra: Any) -> Dict[str, Any]:
    return {"error": code, **extra}


# ── courses ──────────────────────────────────────────────────────────────

def _resolve_courses(ctx: ToolContext, specs: Any) -> Tuple[List[Dict[str, Any]], Optional[Dict[str, Any]]]:
    """Each course spec → {assignment, view}, or the first problem (with the choices to offer)."""
    if not isinstance(specs, list) or not specs:
        return [], _err("missing_argument", needs=["courses"], message="Which course(s)? Pass courses: [{course_id}].")
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
        if not batches:
            return [], _err("no_batch", course=course.get("name"), message="This course has no active batch.")
        batch_views = [{"batch_id": b["id"], "name": b["name"]} for b in batches]
        batch_id = str(spec.get("batch_id") or "")
        if batch_id:
            batch = next((b for b in batches if b["id"] == batch_id), None)
            if not batch:
                return [], _err("unknown_batch", course=course.get("name"), batches=batch_views,
                                message="That batch_id is not a batch of this course.")
        elif len(batches) == 1:
            batch = batches[0]
        else:
            return [], _err("choose_batch", course=course.get("name"), batches=batch_views,
                            message="This course has several batches (session × level). Ask the admin which one.")
        if batch["id"] in seen:
            return [], _err("duplicate_course", course=course.get("name"), message="The same batch is listed twice.")
        seen.add(batch["id"])
        if batch["id"] in ld.org_associated_batches(ctx, [batch["id"]]):
            return [], _err("org_batch_unsupported", course=course.get("name"), batch=batch["name"],
                            message="This batch is sold to organisations; enrolling into it needs the organisation "
                                    "step. To add learners to a sub-organisation use sub_org_enroll; otherwise "
                                    "enrol from the dashboard (Manage Learners → Enroll Learner).")
        invites = enrollable_invites(ctx, batch["id"])
        if not invites:
            return [], _err("no_invite", course=course.get("name"),
                            message="This course has no active invite to enrol through. Create one with "
                                    "course_invites_edit(create_invite) (ask the admin for the price).")
        invite_id = str(spec.get("invite_id") or "")
        if invite_id:
            invite = next((i for i in invites if i["id"] == invite_id), None)
            if not invite:
                return [], _err("unknown_invite", course=course.get("name"),
                                invites=[invite_view(i) for i in invites],
                                message="That invite_id is not an active invite of this course's batch.")
        elif len(invites) == 1:
            invite = invites[0]
        else:
            return [], _err("choose_invite", course=course.get("name"), batch=batch["name"],
                            invites=[invite_view(i) for i in invites],
                            message="This course has several invites (different prices / plans). Ask the admin "
                                    "which one to enrol through and pass invite_id.")
        access_days = spec.get("access_days")
        if access_days not in (None, ""):
            try:
                access_days = int(access_days)
            except (TypeError, ValueError):
                access_days = 0
            if not 1 <= access_days <= 36500:
                return [], _err("invalid_access_days", course=course.get("name"),
                                message="access_days must be a whole number of days (1-36500).")
        else:
            access_days = None
        view = {"course": course.get("name"), "course_id": course["id"], "batch": batch["name"],
                "invite": invite_view(invite)}
        if course.get("status") != cbd.STATUS_ACTIVE:
            view["warning"] = "Course not live yet — learners see it once it is approved."
        if access_days:
            view["access_days"] = access_days
        out.append({"assignment": {"package_session_id": batch["id"], "enroll_invite_id": invite["id"],
                                   "access_days": access_days},
                    "view": view})
    return out, None


# ── learners ─────────────────────────────────────────────────────────────

def _csv_rows(text: Any) -> Tuple[List[Dict[str, Any]], Optional[str]]:
    raw = str(text or "").strip().lstrip("﻿")
    if not raw:
        return [], None
    reader = csv.DictReader(io.StringIO(raw))
    if not reader.fieldnames:
        return [], "The CSV has no header row."
    rows = [{(k or "").strip().lower(): (v or "").strip() if isinstance(v, str) else v for k, v in r.items()}
            for r in reader]
    return [r for r in rows if any(str(v or "").strip() for v in r.values())], None


def _new_user(row: Dict[str, Any], label: str, identifier: str, fields: List[Dict[str, Any]],
              problems: List[str]) -> Optional[Dict[str, Any]]:
    """A NewUserDTO from one row (template columns), or None after recording what is wrong."""
    def val(key: str) -> str:
        v = row.get(key)
        return str(v).strip() if v is not None else ""

    email, phone, name = val("email").lower(), val("mobile_number"), val("full_name")
    start = len(problems)
    samples = [k for k, v in (("email", email), ("mobile_number", ld.digits(phone))) if v and v in _SAMPLE_VALUES]
    if samples:
        problems.append(f"{label}: {', '.join(samples)} is the template's sample value — use the learner's real "
                        "details, or leave it out (never fill in a value the admin did not give).")
    if identifier == "PHONE" and not phone:
        problems.append(f"{label}: mobile_number is required.")
    if identifier != "PHONE" and not email:
        problems.append(f"{label}: email is required.")
    if email and not ld.valid_email(email):
        problems.append(f"{label}: '{email}' is not a valid email.")
    if phone and not ld.valid_phone(phone):
        problems.append(f"{label}: '{phone}' is not a valid mobile number.")
    if not name:
        problems.append(f"{label}: full_name is required.")
    if val("username") and any(c.isspace() for c in val("username")):
        problems.append(f"{label}: username cannot contain spaces.")
    gender = val("gender").upper()
    if gender and gender not in GENDERS:
        problems.append(f"{label}: gender must be MALE, FEMALE or OTHER.")
    dob = val("date_of_birth")
    if dob and not ld.parse_day(dob):
        problems.append(f"{label}: date_of_birth '{dob}' is not a date (YYYY-MM-DD).")
    paid = val("payment_date")
    paid_day = ld.parse_day(paid) if paid else None
    if paid and not paid_day:
        problems.append(f"{label}: payment_date '{paid}' is not a date (DD/MM/YYYY).")
    elif paid_day and not ld.not_future(paid_day):
        problems.append(f"{label}: payment_date cannot be in the future.")

    values: List[Dict[str, str]] = []
    by_column = {ld.cf_column(f["label"]): f for f in fields}
    for key, raw in row.items():
        if str(key).startswith("cf_") and str(raw or "").strip():
            f = by_column.get(str(key))
            if not f:
                problems.append(f"{label}: column '{key}' is not one of the institute's custom fields.")
                continue
            values.append({"custom_field_id": f["field_id"], "value": str(raw).strip()})
    extra = row.get("custom_fields")
    if isinstance(extra, dict):
        for ref, raw in extra.items():
            ref_s = str(ref).strip()
            f = next((x for x in fields if x["field_id"] == ref_s), None) or \
                next((x for x in fields if str(x["label"]).strip().casefold() == ref_s.casefold()), None)
            if not f:
                problems.append(f"{label}: '{ref_s}' is not one of the institute's custom fields.")
            elif str(raw or "").strip():
                values.append({"custom_field_id": f["field_id"], "value": str(raw).strip()})
    unknown = [k for k in row if k not in _ROW_KEYS and not str(k).startswith("cf_")
               and k not in ("custom_fields", "user_id", "learner_id")]
    if unknown:
        problems.append(f"{label}: unknown column(s) {', '.join(sorted(map(str, unknown)))} — use the "
                        "enroll_template columns.")
    if len(problems) > start:
        return None
    user: Dict[str, Any] = {"email": email, "mobile_number": phone or None}
    for key in _TEXT_KEYS:
        if val(key):
            user[key] = val(key)
    if gender:
        user["gender"] = gender
    if dob:
        user["date_of_birth"] = ld.parse_day(dob)
    if paid_day:
        user["payment_date"] = paid_day
    if values:
        user["custom_field_values"] = values
    return {k: v for k, v in user.items() if v not in (None, "")} | {"email": email, "full_name": name}


async def _resolve_learners(ctx: ToolContext, args: Dict[str, Any]) -> Tuple[Dict[str, Any], Optional[Dict[str, Any]]]:
    """→ {user_ids, new_users, matched, transaction_id, payment_date, views} or a problem."""
    entries: List[Tuple[str, Dict[str, Any]]] = []
    for i, item in enumerate(args.get("learners") or []):
        if isinstance(item, str):
            item = {"learner_id": item}
        if isinstance(item, dict):
            entry = {str(k).strip().lower(): v for k, v in item.items()}
            # learner_id is the documented key; a nested user_id (not touched by the tool runner) is accepted too.
            if entry.get("learner_id") and not entry.get("user_id"):
                entry["user_id"] = entry["learner_id"]
            entries.append((f"learner {i + 1}", entry))
    rows, csv_problem = _csv_rows(args.get("csv"))
    if csv_problem:
        return {}, _err("invalid_csv", message=csv_problem)
    entries += [(f"CSV row {i + 2}", r) for i, r in enumerate(rows)]
    if not entries:
        return {}, _err("missing_argument", needs=["learners or csv"], message="Who should be enrolled?")
    if len(entries) > MAX_LEARNERS:
        return {}, _err("too_many_learners", message=f"At most {MAX_LEARNERS} learners per call — split the list.")

    identifier = await ld.user_identifier(ctx)
    needs_fields = any(not e.get("user_id") for _, e in entries)
    fields = await ld.custom_field_catalogue(ctx) if needs_fields else []
    problems: List[str] = []
    user_ids: List[str] = []
    new: List[Tuple[str, Dict[str, Any]]] = []
    transaction_id = None
    for label, entry in entries:
        if entry.get("user_id"):
            user_ids.append(str(entry["user_id"]).strip())
            continue
        user = _new_user(entry, label, identifier, fields, problems)
        if user:
            new.append((label, user))
        if not transaction_id and str(entry.get("transaction_id") or "").strip():
            transaction_id = str(entry["transaction_id"]).strip()

    known = ld.learners_by_ids(ctx, list(dict.fromkeys(user_ids)))
    unknown = [u for u in dict.fromkeys(user_ids) if u not in known]
    if unknown:
        problems.append(f"Not learners of this institute: {', '.join(unknown)} — add them as new-learner rows "
                        "(name + email / mobile) instead.")

    # The same person twice in one upload would be created twice.
    seen: Dict[str, str] = {}
    for label, user in new:
        for key in ([user["email"]] if user.get("email") else []) + \
                   ([ld.digits(user["mobile_number"])] if user.get("mobile_number") else []):
            if key in seen:
                problems.append(f"{label} repeats {seen[key]} ({key}).")
            seen.setdefault(key, label)
    if problems:
        return {}, _err("invalid_learners", problems=problems[:50], problem_count=len(problems),
                        message="Nothing was checked against the courses yet — fix these rows (or drop them) and "
                                "preview again.")

    # A row for someone who is already a learner here enrols that learner (by id) — otherwise the dry run would
    # report them as "created" and miss that they are already in the course.
    matches = ld.match_existing(ctx, [u["email"] for _, u in new if u.get("email")],
                                [ld.digits(u["mobile_number"]) for _, u in new if u.get("mobile_number")])
    by_email = {m["email"]: m for m in matches if m.get("email")}
    by_phone = {m["phone"]: m for m in matches if m.get("phone")}
    matched, new_users = [], []
    for label, user in new:
        hit = by_email.get(user.get("email") or "\0") or by_phone.get(ld.digits(user.get("mobile_number")) or "\0")
        if hit:
            user_ids.append(hit["user_id"])
            known[hit["user_id"]] = {"user_id": hit["user_id"], "full_name": hit.get("full_name"),
                                     "email": user.get("email")}
            matched.append({"row": label, "learner": hit.get("full_name"), "learner_id": hit["user_id"]})
        else:
            new_users.append(user)
    first_paid = next((u["payment_date"] for u in new_users if u.get("payment_date")), None)
    return {"user_ids": list(dict.fromkeys(user_ids)), "new_users": new_users, "matched": matched,
            "names": {uid: (p.get("full_name") or p.get("email")) for uid, p in known.items()},
            "transaction_id": transaction_id, "payment_date": first_paid}, None


# ── options + request ────────────────────────────────────────────────────

def _flag(raw: Dict[str, Any], *names: str) -> Optional[bool]:
    """An explicit yes / no under any of these names, else None (not decided)."""
    for name in names:
        value = raw.get(name)
        if isinstance(value, bool):
            return value
        if isinstance(value, str) and value.strip().lower() in ("true", "yes", "false", "no"):
            return value.strip().lower() in ("true", "yes")
    return None


async def _options(ctx: ToolContext, raw: Any, learners: Dict[str, Any]) -> Tuple[Dict[str, Any], Optional[Dict[str, Any]]]:
    raw = raw if isinstance(raw, dict) else {}
    dup = str(raw.get("duplicate_handling") or "SKIP").strip().upper()
    if dup not in ("SKIP", "ERROR"):
        return {}, _err("invalid_option", message="duplicate_handling is SKIP or ERROR. Re-enrolling learners who are "
                                                  "already active is done from the dashboard.")
    # Emails go out to real people, so they are never defaulted: the admin decides each one. A switch Course
    # Settings hides is the institute's standing "no" — nothing to ask, and a yes is refused.
    allowed = await ld.notification_toggles(ctx)
    notify = _flag(raw, "send_welcome_email", "notify_learners")
    creds = _flag(raw, "send_credentials") if learners["new_users"] else False
    if notify and not allowed["notify_learners"]:
        return {}, _err("option_disabled", message="The enrolment welcome email ('Notify learners') is turned off in "
                                                   "Course Settings, so it cannot be sent from here.")
    if creds and not allowed["send_credentials"]:
        return {}, _err("option_disabled", message="The login-details email ('Send credentials') is turned off in "
                                                   "Course Settings, so it cannot be sent from here.")
    credentials_file = _flag(raw, "credentials_file")
    undecided = []
    if notify is None and allowed["notify_learners"]:
        undecided.append({"option": "send_welcome_email",
                          "ask": "Send each learner the 'Welcome to <institute>' enrolment email?"})
    if creds is None and allowed["send_credentials"]:
        undecided.append({"option": "send_credentials",
                          "ask": f"Email the {len(learners['new_users'])} NEW learner(s) their username and password?"})
    if credentials_file is None:
        undecided.append({"option": "credentials_file",
                          "ask": "Do you want a CSV file with the username and password of every learner enrolled? "
                                 "It comes as a private download link that works for 30 minutes."})
    if undecided:
        return {}, _err("ask_admin", questions=undecided,
                        message="Ask the admin these yes / no questions (do not assume), then pass the answers in "
                                "options. Nothing has been checked or sent yet.")
    options: Dict[str, Any] = {"duplicate_handling": dup, "notify_learners": bool(notify),
                               "send_credentials": bool(creds),
                               # Ours, not admin-core's — _build moves it out of the request.
                               "credentials_file": credentials_file}
    paid = raw.get("payment_date") or learners.get("payment_date")
    if paid:
        day = ld.parse_day(paid)
        if not day or not ld.not_future(day):
            return {}, _err("invalid_option", message="payment_date must be a past date (YYYY-MM-DD).")
        options["payment_date"] = day
    txn = str(raw.get("transaction_id") or learners.get("transaction_id") or "").strip()
    if txn:
        if len(txn) > 100:
            return {}, _err("invalid_option", message="transaction_id is too long.")
        options["transaction_id"] = txn
    return options, None


async def _build(ctx: ToolContext, args: Dict[str, Any]) -> Tuple[Optional[Dict[str, Any]], Dict[str, Any], Optional[Dict[str, Any]]]:
    """(admin-core request without dry_run, context for the report, problem)."""
    courses, problem = _resolve_courses(ctx, args.get("courses"))
    if problem:
        return None, {}, problem
    learners, problem = await _resolve_learners(ctx, args)
    if problem:
        return None, {}, problem
    options, problem = await _options(ctx, args.get("options"), learners)
    if problem:
        return None, {}, problem
    credentials_file = options.pop("credentials_file")
    body: Dict[str, Any] = {
        "institute_id": ctx.principal.institute_id,  # forced — never model-supplied
        "assignments": [c["assignment"] for c in courses],
        "options": options,
    }
    if learners["user_ids"]:
        body["user_ids"] = learners["user_ids"]
    if learners["new_users"]:
        body["new_users"] = learners["new_users"]
    return body, {"courses": courses, "learners": learners, "credentials_file": credentials_file}, None


def _signed(body: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
    """What the confirm token covers: the admin-core request AND the credentials-file answer."""
    return {"request": body, "credentials_file": context["credentials_file"]}


def _timeout(body: Dict[str, Any]) -> float:
    people = len(body.get("user_ids") or []) + len(body.get("new_users") or [])
    return float(min(300, 30 + 1.5 * people * len(body["assignments"])))


def _report(response: Any, body: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
    courses = {c["assignment"]["package_session_id"]: c["view"]["course"] for c in context["courses"]}
    names = context["learners"]["names"]
    summary = response.get("summary") or {}
    rows = []
    for r in response.get("results") or []:
        uid = r.get("user_id") or ""
        rows.append({
            "learner": names.get(uid) or r.get("user_email") or uid,
            "email": r.get("user_email"),
            "course": courses.get(r.get("package_session_id"), r.get("package_session_id")),
            "status": r.get("status"),
            "outcome": r.get("action_taken"),
            **({"message": r["message"]} if r.get("message") else {}),
            **({"payment": r["payment_option_type"]} if r.get("payment_option_type") else {}),
        })
    if len(rows) > _MAX_RESULT_ROWS:
        problems = [r for r in rows if r["status"] != "SUCCESS"]
        rows = problems[:_MAX_RESULT_ROWS] + [r for r in rows if r["status"] == "SUCCESS"][:max(0, 20 - len(problems))]
        truncated = True
    else:
        truncated = False
    return {"summary": {k: summary.get(k) for k in ("total_requested", "successful", "skipped", "failed",
                                                    "re_enrolled")},
            "results": rows, "results_truncated": truncated or None}


# ── actions ──────────────────────────────────────────────────────────────

async def _emails(ctx: ToolContext, body: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
    """What reaches the learners' inboxes, in the admin's words — the two switches and the automations."""
    opts, new = body["options"], len(context["learners"]["new_users"])
    automations = await ld.enrolment_automations(ctx, [a["package_session_id"] for a in body["assignments"]])
    by_course = [{"course": c["view"]["course"], "automations": automations.get(c["assignment"]["package_session_id"])}
                 for c in context["courses"] if automations.get(c["assignment"]["package_session_id"])]
    out: Dict[str, Any] = {
        "welcome_email": "will be sent" if opts["notify_learners"] else "will NOT be sent",
        "login_details_email": (f"will be sent to the {new} new learner(s)" if opts["send_credentials"]
                                else ("will NOT be sent" if new else "not applicable (no new accounts)")),
    }
    if by_course:
        out["automations_that_run_anyway"] = by_course
        out["automations_note"] = ("These automations run on every enrolment whatever the switches say, and may send "
                                   "their own welcome message. To stop them, pause them in Automations first.")
    return out


async def _action_preview(args: Dict[str, Any], ctx: ToolContext) -> Dict[str, Any]:
    body, context, problem = await _build(ctx, args)
    if problem:
        return problem
    response = await cbd.admin_core(ctx, "POST", ASSIGN_PATH, body={**body, "options": {**body["options"],
                                                                                          "dry_run": True}},
                                    timeout=_timeout(body))
    if cbd.is_error(response) or not isinstance(response, dict):
        return _err("preview_failed", message="The enrolment could not be checked.",
                    detail=response.get("message") if isinstance(response, dict) else None)
    report = _report(response, body, context)
    learners = context["learners"]
    out: Dict[str, Any] = {
        "dry_run": True,
        "courses": [c["view"] for c in context["courses"]],
        "learners": {"existing": len(learners["user_ids"]), "new_accounts": len(learners["new_users"]),
                     "matched_existing": learners["matched"] or None,
                     # Exactly what will be sent for each new learner — show it, so nothing the admin did not
                     # give (a phone number, say) slips in unnoticed.
                     "new_learner_details": [
                         {k: u.get(k) for k in ("full_name", "email", "mobile_number", "username") if u.get(k)}
                         for u in learners["new_users"][:50]] or None},
        "options": body["options"],
        **report,
    }
    will_change = (report["summary"].get("successful") or 0) + (report["summary"].get("re_enrolled") or 0)
    if will_change:
        out["confirm_token"] = ld.issue_token(ctx, ENROLL_TOOL_NAME, _signed(body, context))
        out["next"] = ("Show the admin this outcome and ask them to confirm. On a clear yes call "
                       "learner_enroll(action='enroll') with the SAME arguments and this confirm_token.")
    else:
        out["next"] = "Nobody would be enrolled (all skipped or failed) — tell the admin why; there is nothing to confirm."
    if learners["new_users"]:
        out["accounts_note"] = (
            "A 'new' learner whose email (or mobile) already has a Vacademy account — from a website form, an OTP "
            "sign-up or another institute — is enrolled with THAT account and keeps its own details (name, phone). "
            "If it has no password yet, one is created after enrolling.")
    out["emails"] = await _emails(ctx, body, context)
    out["credentials_file"] = ("a private download link with every enrolled learner's username and password will be "
                               "created after enrolling" if context["credentials_file"] else "not requested")
    return out


async def _action_enroll(args: Dict[str, Any], ctx: ToolContext) -> Dict[str, Any]:
    body, context, problem = await _build(ctx, args)
    if problem:
        return problem
    reason = ld.check_token(ctx, ENROLL_TOOL_NAME, _signed(body, context), args.get("confirm_token"))
    if reason:
        return ld.token_error(reason, ENROLL_TOOL_NAME)
    response = await cbd.admin_core(ctx, "POST", ASSIGN_PATH, body={**body, "options": {**body["options"],
                                                                                          "dry_run": False}},
                                    timeout=_timeout(body))
    if cbd.is_error(response) or not isinstance(response, dict):
        return _err("enroll_failed", message="admin-core did not complete the enrolment. Some learners may have been "
                                             "enrolled — check with learners(action='find') before retrying.",
                    detail=response.get("message") if isinstance(response, dict) else None)
    report = _report(response, body, context)
    out: Dict[str, Any] = {"done": True, **report,
                           "manage_url": f"{cbd.admin_base(ctx)}/manage-students/students-list"}
    enrolled = _enrolled_ids(response)
    logins, set_for = await _ensure_passwords(ctx, enrolled)
    if set_for:
        out["passwords_set"] = (f"{len(set_for)} learner(s) had an account with no password (an existing Vacademy "
                                "account, e.g. from a website form or OTP sign-up), so a password was created for "
                                "them" + (" — it is in the credentials file." if context["credentials_file"]
                                          else ". Share it from Manage Learners → Send credentials."))
    if context["credentials_file"]:
        out["credentials_file"] = await _credentials_file(ctx, response, body, context, logins)
    return out


def _enrolled_ids(response: Dict[str, Any]) -> List[str]:
    return list(dict.fromkeys(r["user_id"] for r in response.get("results") or []
                              if r.get("status") == "SUCCESS" and r.get("user_id")))


def new_password() -> str:
    """10 characters, letters + digits, no look-alikes (0/O, 1/l/I) — easy to type from a CSV."""
    import secrets
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"
    while True:
        pw = "".join(secrets.choice(alphabet) for _ in range(10))
        if any(c.isdigit() for c in pw) and any(c.isupper() for c in pw) and any(c.islower() for c in pw):
            return pw


async def _ensure_passwords(ctx: ToolContext, user_ids: List[str]) -> Tuple[Dict[str, Dict[str, Any]], List[str]]:
    """
    Every enrolled learner must be able to sign in. auth-service generates a password only for a brand-new
    account; an email / mobile that already had a Vacademy account (website form, OTP sign-up, another
    institute) is reused as is — and may have NO password. Those get one here, through auth-service's own
    update-password with the admin's token. A learner who already has a password is never touched.
    Returns (logins after the change, ids that got a password).
    """
    if not user_ids:
        return {}, []
    logins = await ld.login_credentials(ctx, user_ids)
    set_for: List[str] = []
    for uid, login in logins.items():
        if (login or {}).get("password"):
            continue
        password = new_password()
        saved = await ld.auth_call(ctx, "POST", "/auth-service/v1/user-operation/update-password",
                                   body={"user_id": uid, "password": password})
        if cbd.is_error(saved):
            logger.warning("could not set a password for enrolled learner %s: %s", uid, saved.get("message"))
            continue
        logins[uid] = {**(login or {}), "password": password}
        set_for.append(uid)
    return logins, set_for


# ── credentials file ─────────────────────────────────────────────────────

CREDENTIAL_COLUMNS = ("full_name", "email", "mobile_number", "username", "password", "courses", "account")


def _cell(value: Any) -> str:
    """CSV-injection safe: a cell a spreadsheet would run as a formula is prefixed with a quote."""
    text = str(value if value is not None else "")
    return "'" + text if text[:1] in ("=", "+", "-", "@", "\t", "\r") else text


def credentials_csv(rows: List[Dict[str, Any]]) -> str:
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(CREDENTIAL_COLUMNS)
    for r in rows:
        writer.writerow([_cell(r.get(c)) for c in CREDENTIAL_COLUMNS])
    return buf.getvalue()


async def _credentials_file(ctx: ToolContext, response: Dict[str, Any], body: Dict[str, Any],
                            context: Dict[str, Any],
                            logins: Optional[Dict[str, Dict[str, Any]]] = None) -> Dict[str, Any]:
    """
    The enrolled learners' logins as a link-only CSV (services/file_exports.py). The passwords are read
    from auth-service with the admin's own token and go straight into the encrypted file — they are
    never part of this tool's result, so they never reach the AI chat.
    """
    from .file_exports import create_export, link_result

    course_names = {c["assignment"]["package_session_id"]: c["view"]["course"] for c in context["courses"]}
    courses_by_user: Dict[str, List[str]] = {}
    for r in response.get("results") or []:
        uid = r.get("user_id")
        if r.get("status") == "SUCCESS" and uid:
            courses_by_user.setdefault(uid, []).append(course_names.get(r.get("package_session_id"), ""))
    if not courses_by_user:
        return {"status": "not_created", "message": "Nobody was enrolled, so there are no logins to export."}
    ids = list(courses_by_user)
    profiles = ld.learners_by_ids(ctx, ids)
    if logins is None:
        logins = await ld.login_credentials(ctx, ids)
    existing = set(body.get("user_ids") or [])
    emails = {str(r.get("user_id")): r.get("user_email") for r in response.get("results") or []}
    rows = []
    for uid in ids:
        p, login = profiles.get(uid) or {}, logins.get(uid) or {}
        rows.append({"full_name": p.get("full_name"), "email": p.get("email") or emails.get(uid),
                     "mobile_number": p.get("mobile_number"),
                     "username": login.get("username") or p.get("username"),
                     "password": login.get("password") or "(not available - set one with learner_edit)",
                     "courses": "; ".join(dict.fromkeys(courses_by_user[uid])),
                     "account": "existing" if uid in existing else "new"})
    missing = sum(1 for uid in ids if not (logins.get(uid) or {}).get("password"))
    try:
        handle = create_export(
            ctx.db, institute_id=ctx.principal.institute_id, user_id=ctx.principal.user_id,
            source_tool=ENROLL_TOOL_NAME, kind="ENROLMENT_CREDENTIALS",
            file_name=f"learner_logins_{date.today().isoformat()}.csv", content=credentials_csv(rows),
            metadata={"learners": len(rows), "without_password": missing,
                      "batch_ids": [a["package_session_id"] for a in body["assignments"]]})
    except Exception as exc:  # noqa: BLE001
        logger.warning("credentials export failed: %s", exc)
        try:
            ctx.db.rollback()
        except Exception:  # noqa: BLE001
            pass
        return {"status": "not_created", "message": "The enrolment is done, but the credentials file could not be "
                                                    "created. The admin can see each login in Manage Learners."}
    return link_result(handle, learners=len(rows), **({"without_password": missing} if missing else {}))


_ACTIONS = {"preview": _action_preview, "enroll": _action_enroll}


async def execute_learner_enroll(args: Dict[str, Any], ctx: ToolContext) -> str:
    action = str((args or {}).get("action") or "").strip()
    handler = _ACTIONS.get(action)
    if handler is None:
        return json.dumps(_err("unknown_action", action=action, available=list(ENROLL_ACTIONS)))
    result = await handler(args or {}, ctx)
    if isinstance(result, dict) and "action" not in result:
        result = {"action": action, **result}
    return json.dumps(result, ensure_ascii=False, default=str)


ENROLL_TOOLS: Dict[str, ToolSpec] = {
    ENROLL_TOOL_NAME: ToolSpec(
        name=ENROLL_TOOL_NAME,
        schema=ENROLL_SCHEMA,
        executor=execute_learner_enroll,
        required_permission=None,
        setting_key=ENROLL_GROUP_KEY,
        default_enabled=False,
        default_roles=None,
        phase=3,
        mode="WRITE",
    ),
}


def _register() -> None:
    from .assistant_tool_registry import ASSISTANT_TOOLS, GROUP_LABELS
    ASSISTANT_TOOLS.update(ENROLL_TOOLS)
    GROUP_LABELS.update({ENROLL_GROUP_KEY: "Learners: enrol into courses"})


_register()

__all__ = ["ENROLL_TOOLS", "ENROLL_TOOL_NAME", "ENROLL_GROUP_KEY", "ENROLL_ACTIONS", "ENROLL_SCHEMA",
           "MAX_LEARNERS", "MAX_COURSES", "execute_learner_enroll"]
