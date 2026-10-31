"""
The ``sub_org_enroll`` tool — add learners (one, a list or a CSV) to a
sub-organisation's courses, for the Assistant and the MCP server.

Each learner is one ``POST /admin-core-service/sub-org/v1/add-member`` with role
LEARNER — the same call the sub-org admin's "Add member" / CSV upload makes in the
learner app (learner + sub-org link + plan, the SUB_ORG_MEMBER_ENROLLMENT
automations), with every chosen course in one request.

Safety (MCP has no confirm card; add-member has no dry run and no access check):

* two calls: ``preview`` checks everything and returns a confirm_token signed over the
  exact requests; ``enroll`` refuses without a matching, unexpired token;
* learners only — never ADMIN / ROOT_ADMIN (the sub-org's admin is sub_org_edit's
  add_admin); additive only, nobody is removed;
* the sub-org must be a child of this institute and the courses must be the sub-org's
  own; institute_id / sub_org_id / roles are set here, never taken from the model;
* seats: admin-core only enforces the admin plan's member_count, which is empty for
  sub-orgs on a shared option or CPO — the preview enforces the cap the admin set
  (MEMBER_COUNT) per course and refuses an upload that would go over it;
* a learner already ACTIVE in a course — in this sub-org or outside it — is skipped for
  that course (admin-core would otherwise give them a second active enrolment);
* not one transaction: each learner commits on their own, so the result reports every
  row and a retry after a partial failure skips the ones already added.
"""
from __future__ import annotations

import asyncio
import csv
import io
import json
import logging
from datetime import date
from typing import Any, Dict, List, Optional, Tuple

from . import course_builder_data as cbd
from . import learner_data as ld
from . import sub_org_data as sd
from .assistant_tool_registry import ToolContext, ToolSpec
from .assistant_tools_sub_orgs import SUB_ORG_TEMPLATE_COLUMNS

logger = logging.getLogger(__name__)

ENROLL_TOOL_NAME = "sub_org_enroll"
ENROLL_GROUP_KEY = "sub_org_enrollments"
ENROLL_ACTIONS = ("preview", "enroll")

MAX_LEARNERS = 200
_CONCURRENCY = 4
_MAX_RESULT_ROWS = 60
GENDERS = ("MALE", "FEMALE", "OTHER")
_SAMPLE_VALUES = {"student@example.com", "919876543210", "9876543210"}
_ROW_KEYS = {k for k, _, _ in SUB_ORG_TEMPLATE_COLUMNS}
_TEXT_KEYS = ("username", "password", "address_line", "city", "region", "pin_code")

ENROLL_SCHEMA: Dict[str, Any] = {
    "type": "function",
    "function": {
        "name": ENROLL_TOOL_NAME,
        "description": (
            "Add learners to a sub-organisation — one, a list or a whole CSV — into its courses (all of them unless "
            "batch_ids narrows it). Adds LEARNERS only (the sub-org's admin is sub_org_edit(change='add_admin')) and "
            "never removes anyone. Steps: sub_orgs(action='list') → sub_orgs(action='get') for its courses and seats → "
            "preview → show the admin the outcome (who is added to which course, who is skipped and why, seats "
            "left, which emails go out) and get a clear yes → enroll with the SAME arguments plus confirm_token. "
            "Pick an `action`:\n"
            "- preview (sub_org_id, csv and/or learners, batch_ids?, options): checks everything; nothing is saved. "
            "Returns the per-learner plan and a confirm_token (valid 15 min).\n"
            "- enroll (same arguments + confirm_token): does it, learner by learner, and reports each one.\n"
            "csv: the filled-in sub_orgs(action='enroll_template') as CSV text (header row first). learners: "
            "[{learner_id} (an existing learner, from learners(action='find')) | a row with the template columns "
            "{email, full_name, mobile_number?, …, custom_fields?: {label: value}}] "
            f"(max {MAX_LEARNERS} in total). batch_ids: some of the sub-org's course batch_ids (default: all).\n"
            "options: {credentials_file: bool — a CSV of every added learner's username + password, delivered as a "
            "private download link valid 30 minutes — ASK the admin}. Login-details emails follow Course Settings "
            "('Send credentials') and cannot be switched per upload; the preview says whether they go out and "
            "which automations run."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "action": {"type": "string", "enum": list(ENROLL_ACTIONS)},
                "sub_org_id": {"type": "string", "description": "From sub_orgs(action='list')."},
                "csv": {"type": "string", "description": "The filled-in enroll_template as CSV text."},
                "learners": {"type": "array", "items": {"type": "object"},
                             "description": "[{learner_id}] for existing learners and/or new-learner rows."},
                "batch_ids": {"type": "array", "items": {"type": "string"},
                              "description": "Only these of the sub-org's courses (batch_ids from sub_orgs(get))."},
                "options": {"type": "object", "description": "{credentials_file: bool}"},
                "confirm_token": {"type": "string", "description": "enroll: the token preview returned."},
            },
            "required": ["action"],
        },
    },
}


def _err(code: str, **extra: Any) -> Dict[str, Any]:
    return {"error": code, **extra}


# ── the sub-org and its courses ──────────────────────────────────────────

def _resolve_target(ctx: ToolContext, args: Dict[str, Any]) -> Tuple[Dict[str, Any], Optional[Dict[str, Any]]]:
    org = sd.sub_org(ctx, args.get("sub_org_id"))
    if not org:
        return {}, sd.unknown_sub_org_error(args.get("sub_org_id"))
    if str(org.get("status") or "ACTIVE").upper() != "ACTIVE":
        return {}, _err("sub_org_inactive", message=f"'{org.get('name')}' is not active.")
    invite_rows = sd.invites(ctx, org["id"])
    courses = sd.sub_org_batches(ctx, invite_rows)
    if not courses:
        return {}, _err("no_courses", message="This sub-org has no courses yet — add some with "
                                              "sub_org_edit(change='update', add_courses=…) first.")
    wanted = [str(b) for b in args.get("batch_ids") or [] if b]
    if wanted:
        by_id = {c["batch_id"]: c for c in courses}
        unknown = [b for b in wanted if b not in by_id]
        if unknown:
            return {}, _err("unknown_batch", batch_ids=unknown,
                            courses=[{k: c[k] for k in ("course", "batch", "batch_id")} for c in courses],
                            message="Not courses of this sub-org. Use the batch_ids sub_orgs(action='get') lists.")
        courses = [by_id[b] for b in dict.fromkeys(wanted)]
    main = sd.org_invite(invite_rows)
    return {"org": org, "courses": courses, "cap": sd.seat_cap(ctx, org["id"], main)}, None


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


def _new_user(row: Dict[str, Any], label: str, fields: List[Dict[str, Any]], problems: List[str]) -> Optional[Dict[str, Any]]:
    """add-member's UserDTO (+ custom_field_values) from one template row, or None after recording what is wrong."""
    def val(key: str) -> str:
        v = row.get(key)
        return str(v).strip() if v is not None else ""

    email, phone, name = val("email").lower(), val("mobile_number"), " ".join(val("full_name").split())
    start = len(problems)
    samples = [k for k, v in (("email", email), ("mobile_number", ld.digits(phone))) if v and v in _SAMPLE_VALUES]
    if samples:
        problems.append(f"{label}: {', '.join(samples)} is the template's sample value — use the learner's real "
                        "details (never fill in a value the admin did not give).")
    if not email:
        problems.append(f"{label}: email is required (it is the learner's login).")
    elif not ld.valid_email(email):
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
               and k not in ("custom_fields", "learner_id", "user_id")]
    if unknown:
        problems.append(f"{label}: unknown column(s) {', '.join(sorted(map(str, unknown)))} — use the "
                        "sub_orgs(action='enroll_template') columns.")
    if len(problems) > start:
        return None
    user: Dict[str, Any] = {"email": email, "full_name": name}
    if phone:
        user["mobile_number"] = phone
    for key in _TEXT_KEYS:
        if val(key):
            user[key] = val(key)
    if gender:
        user["gender"] = gender
    if dob:
        user["date_of_birth"] = ld.parse_day(dob)
    return {"user": user, "custom_field_values": values}


async def _resolve_learners(ctx: ToolContext, args: Dict[str, Any]) -> Tuple[List[Dict[str, Any]], Optional[Dict[str, Any]]]:
    """→ [{label, user, custom_field_values, learner_id?, existing}] or a problem."""
    entries: List[Tuple[str, Dict[str, Any]]] = []
    for i, item in enumerate(args.get("learners") or []):
        if isinstance(item, str):
            item = {"learner_id": item}
        if isinstance(item, dict):
            entries.append((f"learner {i + 1}", {str(k).strip().lower(): v for k, v in item.items()}))
    rows, csv_problem = _csv_rows(args.get("csv"))
    if csv_problem:
        return [], _err("invalid_csv", message=csv_problem)
    entries += [(f"CSV row {i + 2}", r) for i, r in enumerate(rows)]
    if not entries:
        return [], _err("missing_argument", needs=["csv or learners"], message="Who should be added?")
    if len(entries) > MAX_LEARNERS:
        return [], _err("too_many_learners", message=f"At most {MAX_LEARNERS} learners per call — split the list.")

    needs_fields = any(not (e.get("learner_id") or e.get("user_id")) for _, e in entries)
    fields = await ld.custom_field_catalogue(ctx) if needs_fields else []
    problems: List[str] = []
    out: List[Dict[str, Any]] = []
    ids = [str(e.get("learner_id") or e.get("user_id")).strip() for _, e in entries if e.get("learner_id") or e.get("user_id")]
    known = ld.learners_by_ids(ctx, list(dict.fromkeys(ids)))
    for label, entry in entries:
        lid = str(entry.get("learner_id") or entry.get("user_id") or "").strip()
        if lid:
            p = known.get(lid)
            if not p:
                problems.append(f"{label}: '{lid}' is not a learner of this institute — add them as a row (name + "
                                "email) instead.")
            elif not ld.valid_email(p.get("email")):
                problems.append(f"{label}: {p.get('full_name') or lid} has no email on file, and the sub-org "
                                "enrolment matches learners by email — add their email with learner_edit first.")
            else:
                user = {"id": lid, "email": str(p["email"]).strip().lower(), "full_name": p.get("full_name") or ""}
                if p.get("mobile_number"):
                    user["mobile_number"] = p["mobile_number"]
                out.append({"label": label, "user": user, "custom_field_values": [], "learner_id": lid,
                            "existing": True})
            continue
        made = _new_user(entry, label, fields, problems)
        if made:
            out.append({"label": label, **made, "learner_id": None, "existing": False})

    seen: Dict[str, str] = {}
    for r in out:
        key = r["user"]["email"]
        if key in seen:
            problems.append(f"{r['label']} repeats {seen[key]} ({key}).")
        seen.setdefault(key, r["label"])
    if problems:
        return [], _err("invalid_learners", problems=problems[:50], problem_count=len(problems),
                        message="Nothing was checked against the sub-org yet — fix these rows (or drop them) and "
                                "preview again.")

    # A row whose email belongs to a learner of this institute is that learner: their existing enrolments decide
    # what is skipped (admin-core would otherwise give them a second ACTIVE enrolment in the same course).
    matches = ld.match_existing(ctx, [r["user"]["email"] for r in out if not r["existing"]], [])
    by_email = {m["email"]: m for m in matches if m.get("email")}
    for r in out:
        if not r["existing"] and r["user"]["email"] in by_email:
            r["learner_id"] = by_email[r["user"]["email"]]["user_id"]
            r["matched"] = by_email[r["user"]["email"]].get("full_name")
    return out, None


# ── the plan ─────────────────────────────────────────────────────────────

def _flag(raw: Dict[str, Any], name: str) -> Optional[bool]:
    value = raw.get(name)
    if isinstance(value, bool):
        return value
    if isinstance(value, str) and value.strip().lower() in ("true", "yes", "false", "no"):
        return value.strip().lower() in ("true", "yes")
    return None


async def _build(ctx: ToolContext, args: Dict[str, Any]) -> Tuple[Optional[Dict[str, Any]], Optional[Dict[str, Any]]]:
    """→ ({requests, rows, courses, seats, credentials_file, org}, problem)."""
    target, problem = _resolve_target(ctx, args)
    if problem:
        return None, problem
    learners, problem = await _resolve_learners(ctx, args)
    if problem:
        return None, problem
    raw = args.get("options") if isinstance(args.get("options"), dict) else {}
    credentials_file = _flag(raw, "credentials_file")
    if credentials_file is None:
        return None, _err("ask_admin", questions=[{
            "option": "credentials_file",
            "ask": "Do you want a CSV file with the username and password of every learner added? It comes as a "
                   "private download link that works for 30 minutes."}],
            message="Ask the admin (do not assume), then pass the answer in options. Nothing has been checked yet.")

    org, courses, cap = target["org"], target["courses"], target["cap"]
    batch_ids = [c["batch_id"] for c in courses]
    names = {c["batch_id"]: f"{c['course']} ({c['batch']})" for c in courses}
    active = sd.active_enrolments(ctx, [r["learner_id"] for r in learners if r["learner_id"]], batch_ids)
    taken: Dict[Tuple[str, str], Dict[str, Any]] = {(a["user_id"], a["package_session_id"]): a for a in active}

    requests: List[Dict[str, Any]] = []
    rows: List[Dict[str, Any]] = []
    need = {b: 0 for b in batch_ids}
    for r in learners:
        into, skipped = [], []
        for b in batch_ids:
            hit = taken.get((r["learner_id"], b)) if r["learner_id"] else None
            if not hit:
                into.append(b)
            elif hit.get("sub_org_id") == org["id"]:
                skipped.append({"course": names[b], "reason": "already in this sub-org"})
            else:
                skipped.append({"course": names[b], "reason": "already enrolled in this course outside this sub-org "
                                                              "(change it from the dashboard)"})
        row = {"row": r["label"], "learner": r["user"].get("full_name"), "email": r["user"]["email"],
               "account": "existing learner" if r["learner_id"] else "new (or an account from elsewhere)",
               "add_to": [names[b] for b in into], **({"skipped": skipped} if skipped else {})}
        rows.append(row)
        if not into:
            continue
        for b in into:
            need[b] += 1
        body: Dict[str, Any] = {
            "user": r["user"],
            "package_session_ids": into,
            "sub_org_id": org["id"],
            "institute_id": ctx.principal.institute_id,  # forced — never model-supplied
            "status": "ACTIVE",
            "comma_separated_org_roles": sd.LEARNER,     # learners only — never ADMIN / ROOT_ADMIN
        }
        if r["custom_field_values"]:
            body["custom_field_values"] = r["custom_field_values"]
        requests.append({"label": r["label"], "body": body})

    used = sd.used_seats(ctx, org["id"], batch_ids)
    seats = [{"course": names[b], "used": used.get(b, 0), "adding": need[b],
              **({"cap": cap, "left_after": cap - used.get(b, 0) - need[b]} if cap else {})} for b in batch_ids]
    over = [s for s in seats if cap and s["left_after"] < 0]
    if over:
        return None, _err("seats_exceeded", seats=over, cap=cap,
                          message=f"This would put more than {cap} learners in a course of '{org.get('name')}'. "
                                  "Add fewer learners, or raise the seats first with "
                                  "sub_org_edit(change='update', member_count=…) — ask the admin.")
    return {"org": org, "courses": courses, "requests": requests, "rows": rows, "seats": seats,
            "credentials_file": credentials_file}, None


def _signed(plan: Dict[str, Any]) -> Dict[str, Any]:
    return {"sub_org_id": plan["org"]["id"], "requests": [r["body"] for r in plan["requests"]],
            "credentials_file": plan["credentials_file"]}


def _trim(rows: List[Dict[str, Any]], problem_key: str) -> Tuple[List[Dict[str, Any]], bool]:
    if len(rows) <= _MAX_RESULT_ROWS:
        return rows, False
    flagged = [r for r in rows if r.get(problem_key)]
    rest = [r for r in rows if not r.get(problem_key)]
    return (flagged[:_MAX_RESULT_ROWS] + rest[:max(0, 20 - len(flagged))]), True


async def _emails(ctx: ToolContext, plan: Dict[str, Any]) -> Dict[str, Any]:
    toggles = await ld.notification_toggles(ctx)
    automations = await ld.enrolment_automations(ctx, [c["batch_id"] for c in plan["courses"]],
                                                 event=sd.SUB_ORG_ENROLMENT_EVENT)
    out: Dict[str, Any] = {"login_details_email": (
        "sent to each NEW account by auth-service (Course Settings → 'Send credentials' is on; it cannot be turned "
        "off for one upload)" if toggles["send_credentials"] else "not sent (turned off in Course Settings)")}
    named = [{"course": f"{c['course']} ({c['batch']})", "automations": automations[c["batch_id"]]}
             for c in plan["courses"] if automations.get(c["batch_id"])]
    if named:
        out["automations_that_run"] = named
        out["automations_note"] = ("These run once per learner per course and may send their own message. To stop "
                                   "them, pause them in Automations first.")
    return out


# ── actions ──────────────────────────────────────────────────────────────

async def _action_preview(args: Dict[str, Any], ctx: ToolContext) -> Dict[str, Any]:
    plan, problem = await _build(ctx, args)
    if problem:
        return problem
    rows, truncated = _trim(plan["rows"], "skipped")
    out: Dict[str, Any] = {
        "dry_run": True, "sub_org": plan["org"].get("name"),
        "summary": {"learners": len(plan["rows"]), "to_add": len(plan["requests"]),
                    "fully_skipped": len(plan["rows"]) - len(plan["requests"])},
        "learners": rows, "results_truncated": truncated or None,
        "seats": plan["seats"],
        "emails": await _emails(ctx, plan),
        "credentials_file": ("a private download link with every added learner's username and password will be "
                             "created after adding" if plan["credentials_file"] else "not requested"),
        "accounts_note": ("A 'new' learner whose email already has a Vacademy account (a website form, an OTP "
                          "sign-up, another institute) is added with THAT account and keeps its own details."),
    }
    if plan["requests"]:
        out["confirm_token"] = ld.issue_token(ctx, ENROLL_TOOL_NAME, _signed(plan))
        out["next"] = ("Show the admin this outcome and ask them to confirm. On a clear yes call "
                       "sub_org_enroll(action='enroll') with the SAME arguments and this confirm_token.")
    else:
        out["next"] = "Nobody would be added (everyone is already in these courses) — tell the admin; nothing to confirm."
    return out


async def _add_one(ctx: ToolContext, sem: asyncio.Semaphore, request: Dict[str, Any]) -> Dict[str, Any]:
    async with sem:
        response = await cbd.admin_core(ctx, "POST", sd.ADD_MEMBER_PATH, body=request["body"], timeout=90.0)
    user = request["body"]["user"]
    row = {"row": request["label"], "learner": user.get("full_name"), "email": user["email"]}
    if cbd.is_error(response):
        return {**row, "status": "FAILED", "message": response.get("message") or "admin-core refused this learner."}
    data = response if isinstance(response, dict) else {}
    added = data.get("user") if isinstance(data.get("user"), dict) else {}
    return {**row, "status": "ADDED", "learner_id": added.get("id"),
            "courses": len(request["body"]["package_session_ids"])}


async def _action_enroll(args: Dict[str, Any], ctx: ToolContext) -> Dict[str, Any]:
    plan, problem = await _build(ctx, args)
    if problem:
        return problem
    reason = ld.check_token(ctx, ENROLL_TOOL_NAME, _signed(plan), args.get("confirm_token"))
    if reason:
        return ld.token_error(reason, ENROLL_TOOL_NAME)
    sem = asyncio.Semaphore(_CONCURRENCY)
    results = await asyncio.gather(*(_add_one(ctx, sem, r) for r in plan["requests"]))
    added = [r for r in results if r["status"] == "ADDED"]
    failed = [r for r in results if r["status"] == "FAILED"]
    rows, truncated = _trim(list(results), "message")
    out: Dict[str, Any] = {
        "done": True, "sub_org": plan["org"].get("name"),
        "summary": {"added": len(added), "failed": len(failed),
                    "skipped": len(plan["rows"]) - len(plan["requests"])},
        "results": rows, "results_truncated": truncated or None,
        "manage_url": sd.manage_url(ctx),
    }
    if failed:
        out["note"] = ("Some learners were not added (see each message). Everyone else is in. Fix those rows and "
                       "preview again with just them — learners already added are skipped automatically.")
    from .assistant_tools_learner_enroll import _ensure_passwords
    ids = [r["learner_id"] for r in added if r.get("learner_id")]
    logins, set_for = await _ensure_passwords(ctx, ids)
    if set_for:
        out["passwords_set"] = (f"{len(set_for)} learner(s) had an account with no password (an existing Vacademy "
                                "account), so a password was created for them" +
                                (" — it is in the credentials file." if plan["credentials_file"]
                                 else ". Share it from Manage Learners → Send credentials."))
    if plan["credentials_file"]:
        out["credentials_file"] = await _credentials_file(ctx, plan, added, logins)
    return out


async def _credentials_file(ctx: ToolContext, plan: Dict[str, Any], added: List[Dict[str, Any]],
                            logins: Dict[str, Dict[str, Any]]) -> Dict[str, Any]:
    """The added learners' logins as a link-only CSV — the passwords never enter this tool's result."""
    from .assistant_tools_learner_enroll import credentials_csv
    from .file_exports import create_export, link_result

    ids = [r["learner_id"] for r in added if r.get("learner_id")]
    if not ids:
        return {"status": "not_created", "message": "Nobody was added, so there are no logins to export."}
    profiles = ld.learners_by_ids(ctx, ids)
    missing_logins = [i for i in ids if i not in logins]
    if missing_logins:
        logins = {**logins, **await ld.login_credentials(ctx, missing_logins)}
    courses = "; ".join(f"{c['course']} ({c['batch']})" for c in plan["courses"])
    by_id = {r["learner_id"]: r for r in added if r.get("learner_id")}
    rows = []
    for uid in ids:
        p, login = profiles.get(uid) or {}, logins.get(uid) or {}
        rows.append({"full_name": p.get("full_name") or by_id[uid].get("learner"),
                     "email": p.get("email") or by_id[uid].get("email"), "mobile_number": p.get("mobile_number"),
                     "username": login.get("username") or p.get("username"),
                     "password": login.get("password") or "(not available - set one with learner_edit)",
                     "courses": courses, "account": "sub-org learner"})
    missing = sum(1 for uid in ids if not (logins.get(uid) or {}).get("password"))
    try:
        handle = create_export(
            ctx.db, institute_id=ctx.principal.institute_id, user_id=ctx.principal.user_id,
            source_tool=ENROLL_TOOL_NAME, kind="ENROLMENT_CREDENTIALS",
            file_name=f"sub_org_learner_logins_{date.today().isoformat()}.csv", content=credentials_csv(rows),
            metadata={"learners": len(rows), "without_password": missing, "sub_org_id": plan["org"]["id"]})
    except Exception as exc:  # noqa: BLE001
        logger.warning("sub-org credentials export failed: %s", exc)
        try:
            ctx.db.rollback()
        except Exception:  # noqa: BLE001
            pass
        return {"status": "not_created", "message": "The learners were added, but the credentials file could not be "
                                                    "created. The admin can see each login in Manage Learners."}
    return link_result(handle, learners=len(rows), **({"without_password": missing} if missing else {}))


_ACTIONS = {"preview": _action_preview, "enroll": _action_enroll}


async def execute_sub_org_enroll(args: Dict[str, Any], ctx: ToolContext) -> str:
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
        executor=execute_sub_org_enroll,
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
    GROUP_LABELS.update({ENROLL_GROUP_KEY: "Sub-organisations: add learners"})


_register()

__all__ = ["ENROLL_TOOLS", "ENROLL_TOOL_NAME", "ENROLL_GROUP_KEY", "ENROLL_ACTIONS", "ENROLL_SCHEMA",
           "MAX_LEARNERS", "execute_sub_org_enroll"]
