"""
The ``learner_report`` tool — a learner's progress-report data for the connected
AI app to write the report itself. Read-only.

Actions
    guide           what every field means, the dashboard report's rules, and how to write the report
    data            the report's facts for a window (the same Layer-1 JSON the dashboard report is built
                    from) plus the detail that report throws away (per-class attendance, per-module progress
                    vs the batch, slide-by-slide study, assignment submissions, doubt text, per-attempt analysis)
    saved_reports   the progress reports already generated in the dashboard for a learner
    saved_report    one of those reports in full

No model runs here: the dashboard's report spends AI credits on its narrative,
this tool spends none — the admin's own AI app reads the data and writes. The
per-attempt analysis rows were produced when each attempt was made (charged
then); reading them is free.

Every read is scoped to the pinned institute: the admin-core endpoints refuse a
learner (or batch) that is not in it, and the saved-report SQL filters on it.
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
from typing import Any, Dict, List, Optional, Tuple

from . import course_builder_data as cbd
from . import learner_data as ld
from .assistant_tool_registry import ToolContext, ToolSpec, _prune_nulls

logger = logging.getLogger(__name__)

LEARNER_REPORT_TOOL_NAME = "learner_report"
LEARNER_REPORT_GROUP_KEY = "learner_reports"
LEARNER_REPORT_ACTIONS = ("guide", "data", "saved_reports", "saved_report")

#: The report's sections (admin-core ReportModule keys). Identity, institute and period are always sent.
REPORT_MODULES = ("attendance", "live_classes", "academics", "activity", "progress", "certificates",
                  "assignments", "doubts", "login", "learning_insights")

#: The detail the report throws away (admin-core StudentRawDetailService parts).
DETAIL_PARTS = ("attendance_sessions", "module_progress", "content_activity", "assignments", "doubts",
                "attempt_insights", "attempt_details")
DEFAULT_DETAIL_PARTS = DETAIL_PARTS[:-1]  # attempt_details (per-question input) only when asked for

DEFAULT_ATTEMPTS = 10
MAX_ATTEMPTS = 50
MAX_RANGE_DAYS = 366
_DAY_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_TIMEOUT_SECONDS = 70.0

LEARNER_REPORT_SCHEMA: Dict[str, Any] = {
    "type": "function",
    "function": {
        "name": LEARNER_REPORT_TOOL_NAME,
        "description": (
            "A learner's progress-report data, for YOU to write the report (for the admin, a parent or the "
            "learner). Read-only; uses no AI credits — you are the writer. Pick an `action`:\n"
            "- guide: what every field means, the dashboard report's status/grade rules and how to write a "
            "grounded report. Read it once before writing.\n"
            "- data (learner_id, start_date, end_date — YYYY-MM-DD, default the last 30 days, max 366 days; "
            "optional batch_id, modules, detail, attempt_limit): `report` = the facts the dashboard report is "
            "built from (attendance, live classes, assessments with rank/percentile/class average, marks by "
            "subject, study habits, course progress, certificates, assignments, doubts, logins, topic mastery / "
            "Bloom's / confidence / misconceptions); `detail` = what that report throws away (every live class, "
            "per-module progress next to the batch average, what was studied slide by slide, assignment "
            "submissions with feedback, the doubts' text and replies, and the analysis of each attempt). Ask for "
            "only the modules / detail the admin's report needs when the window is long.\n"
            "- saved_reports (learner_id): progress reports already generated in the dashboard (to compare "
            "periods).\n"
            "- saved_report (report_id): one of them in full.\n"
            "Get the learner_id from learners(action='find'). Never invent numbers: every figure you write must "
            "come from this data."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "action": {"type": "string", "enum": list(LEARNER_REPORT_ACTIONS)},
                # NOT `user_id`: the tool runner overwrites a top-level user_id with the CALLER's id.
                "learner_id": {"type": "string", "description": "The learner's learner_id (from learners find)."},
                "start_date": {"type": "string", "description": "data: window start, YYYY-MM-DD."},
                "end_date": {"type": "string", "description": "data: window end, YYYY-MM-DD (inclusive)."},
                "batch_id": {"type": "string",
                             "description": "data: one of the learner's batch_ids (from learners get) to scope "
                                            "progress / assignments. Default: their latest batch."},
                "modules": {"type": "array", "items": {"type": "string", "enum": list(REPORT_MODULES)},
                            "description": "data: report sections to include. Default: all."},
                "detail": {"type": "array", "items": {"type": "string", "enum": list(DETAIL_PARTS) + ["none"]},
                           "description": "data: detail parts to include. Default: all but attempt_details "
                                          "(the per-question input of each attempt — large). ['none'] = no "
                                          "detail."},
                "attempt_limit": {"type": "integer",
                                  "description": f"data: newest attempts to include in attempt_insights "
                                                 f"(default {DEFAULT_ATTEMPTS}, max {MAX_ATTEMPTS}; "
                                                 f"attempt_details max 15)."},
                "report_id": {"type": "string", "description": "saved_report: a report_id from saved_reports."},
                "page": {"type": "integer", "description": "saved_reports: page, from 0."},
            },
            "required": ["action"],
        },
    },
}


GUIDE: Dict[str, Any] = {
    "workflow": [
        "Find the learner: learners(action='find', query=<name/email/phone>); ask the admin which one when "
        "several match. learners(action='get') lists their batches.",
        "Ask the admin for the period, who the report is for (parent, learner, teacher, management), the "
        "language and the format (chat text, document, email) if they have not said.",
        "learner_report(action='data') for the window. For a comparison, also read an earlier window or "
        "saved_reports / saved_report.",
        "Write the report from the data only. Show it to the admin; this tool saves nothing.",
    ],
    "rules": [
        "Never invent, estimate or round into new numbers: every percentage, score, date and count you write "
        "must be in the data. You may compare and interpret them.",
        "A section that is missing, or has available=false, had no data in the window — say 'no data' (or "
        "leave it out); never present it as 0.",
        "Each subject / topic is either a strength (>= 60) or an area to improve (< 60), judged on its overall "
        "score, never on one good or bad test. Use the real subject and topic names from the data.",
        "Ground recommendations in specific weak topics, misconceptions, missed classes or pending work, with a "
        "concrete action and a priority.",
        "For a parent: plain language, achievements first, one or two clear focus areas.",
        "learning_insights and detail.attempt_insights come from an automatic analysis of each attempt; "
        "treat them as evidence, not as the institute's assessment of the learner.",
    ],
    "dashboard_rules": {
        "overall_status": "Insufficient Data when attendance and average score are both missing; On Track when "
                          "attendance >= 75 (or missing) and average score >= 60 (or missing); Needs Attention "
                          "when attendance >= 60 or score >= 40; else At Risk.",
        "grade": "From academics.average_percentage: A+ >= 90, A >= 80, B+ >= 70, B >= 60, C >= 50, else D.",
        "assessment_status": "PASS / FAIL from the assessment's own result, else >= 50 PASS, >= 35 NEEDS_WORK.",
        "subject_sentiment": "attention when the subject score is more than 5 below the class average, good "
                             "when >= 70.",
        "consistency": "study_habits.consistency_rating: High when active on >= 80% of days, Medium >= 50%.",
        "mastery_level": "learning_insights.topic_mastery: Expert >= 85% accuracy, Proficient >= 70, "
                         "Developing >= 50, else Beginner.",
        "streak_badge": "A 'N-Day Study Streak' achievement is added when the longest streak is >= 7 days.",
    },
    "fields": {
        "report.overview": "Status, grade and headline metrics computed from the sections below.",
        "report.attendance": "Live classes scheduled for the learner's batches in the window: present / absent "
                             "(unmarked counts as absent) and weekly %.",
        "report.academics": "Assessments taken in the window (latest attempt each, max 50): marks, %, rank, "
                            "percentile, class average, accuracy and section-wise marks; per-subject averages.",
        "report.subject_marks": "Marks summed by subject across assessments, assignments, quizzes and "
                                "questions; items[] are the individual graded items.",
        "report.study_habits": "Study time per day (engaged minutes), active days, longest streak, focus score "
                               "and counts of videos / documents / quizzes opened. Across all courses.",
        "report.course_progress": "Completion % per subject of the batch — ALL-TIME, not limited to the window.",
        "report.assignments": "Assigned (in the batch, all-time) vs submitted / on time / late in the window, "
                              "average score.",
        "report.doubts_and_engagement": "Doubts asked / resolved in the window and average resolution hours.",
        "report.login": "Logins in the window, last login, average and total session minutes.",
        "report.learning_insights": "Aggregated from the per-attempt analysis: topic mastery, Bloom's levels, "
                                    "confidence (knows / guesses / confidently wrong) and misconceptions.",
        "detail.attendance_sessions": "Every class: date, start time, title, subject, status and attended "
                                      "minutes (when the class provider reported them).",
        "detail.module_progress": "Per module: the learner's completion % and minutes next to the batch "
                                  "average (all-time) — the peer comparison.",
        "detail.content_activity": "Each slide opened in the window: title, type, visits, engaged minutes, "
                                   "furthest % watched, first / last seen. Most time first, max 100.",
        "detail.assignments": "Each submission: title, date, late or not, marks out of total, teacher feedback.",
        "detail.doubts": "Each doubt's text, where it was asked (slide, position), status and the replies "
                         "(learner / staff).",
        "detail.attempt_insights": "Per attempt (quiz, question, assignment, assessment), newest first: the "
                                   "full analysis — performance, strengths / weaknesses, topic analysis, "
                                   "Bloom's, confidence, misconceptions with the learner's vs the correct "
                                   "answer, behavioural insights (time management, fatigue, skipping) and a "
                                   "suggested learning path.",
        "detail.attempt_details": "Opt-in: the per-question input each analysis was made from (questions, "
                                  "answers, marks, time per question, class context).",
    },
    "suggested_structure": [
        "Header: learner, batch, period.",
        "Summary: status, grade and a 2-4 sentence overview.",
        "Attendance & live classes.",
        "Academics: assessments, marks by subject, rank / class average.",
        "Learning: topic mastery, thinking skills (Bloom's), confidence, misconceptions.",
        "Study habits & course progress (vs the batch where module_progress has it).",
        "Assignments & doubts.",
        "Strengths, areas to improve, and a prioritised improvement plan.",
    ],
}


def _err(code: str, **extra: Any) -> Dict[str, Any]:
    return {"error": code, **extra}


def _window(args: Dict[str, Any]) -> Tuple[Optional[str], Optional[str], Optional[Dict[str, Any]]]:
    start = str(args.get("start_date") or "").strip() or None
    end = str(args.get("end_date") or "").strip() or None
    for name, value in (("start_date", start), ("end_date", end)):
        if value and not (_DAY_RE.match(value) and ld.parse_day(value)):
            return None, None, _err("bad_date", message=f"{name} must be YYYY-MM-DD.")
    if start and end:
        if start > end:
            return None, None, _err("bad_window", message="start_date is after end_date.")
        from datetime import date
        if (date.fromisoformat(end) - date.fromisoformat(start)).days > MAX_RANGE_DAYS:
            return None, None, _err("window_too_long", message=f"At most {MAX_RANGE_DAYS} days per call — "
                                                               "split the period.")
    return start, end, None


async def _internal_get(path: str, params: Dict[str, Any]) -> Tuple[int, Any]:
    import httpx
    from ..config import get_settings
    from .internal_auth import internal_auth_headers

    url = f"{get_settings().admin_core_service_base_url}/admin-core-service/internal/student-analysis/{path}"
    headers = await internal_auth_headers()
    async with httpx.AsyncClient(timeout=_TIMEOUT_SECONDS) as client:
        resp = await client.get(url, params=params, headers=headers)
    if resp.status_code != 200:
        logger.warning("learner_report %s: %s (%s)", path, resp.status_code, resp.text[:200])
        return resp.status_code, None
    return 200, resp.json()


async def _fetch(path: str, params: Dict[str, Any]) -> Any:
    """The endpoint's JSON, or an error dict (never raises)."""
    try:
        status, body = await _internal_get(path, params)
    except Exception as exc:  # noqa: BLE001
        logger.warning("learner_report %s failed: %s", path, exc)
        return _err("fetch_failed", message="Could not read this part — try again, or a shorter window.")
    if status == 404:
        return _err("not_found", message="This learner (or batch) is not in your institute.")
    if status != 200:
        return _err("fetch_failed", status=status)
    return body


async def _action_guide(args: Dict[str, Any], ctx: ToolContext) -> Dict[str, Any]:
    return {"guide": GUIDE, "modules": list(REPORT_MODULES), "detail_parts": list(DETAIL_PARTS)}


async def _action_data(args: Dict[str, Any], ctx: ToolContext) -> Dict[str, Any]:
    learner_id = ld.target_learner_id(args)
    if not learner_id:
        return ld.missing_learner_error()
    profile = ld.learner_profile(ctx, learner_id)
    if not profile:
        return _err("unknown_learner", message="No learner of this institute has that learner_id. Use "
                                               "learners(action='find').")
    start, end, bad = _window(args)
    if bad:
        return bad

    requested = [m for m in (args.get("modules") or []) if m in REPORT_MODULES]
    unknown_modules = [m for m in (args.get("modules") or []) if m not in REPORT_MODULES]
    raw_detail = args.get("detail")
    if raw_detail is None:
        detail = list(DEFAULT_DETAIL_PARTS)
    else:
        detail = [p for p in raw_detail if p in DETAIL_PARTS]
    attempt_limit = args.get("attempt_limit")
    try:
        attempt_limit = max(1, min(MAX_ATTEMPTS, int(attempt_limit))) if attempt_limit is not None else DEFAULT_ATTEMPTS
    except (TypeError, ValueError):
        attempt_limit = DEFAULT_ATTEMPTS

    common: Dict[str, Any] = {"userId": learner_id, "instituteId": ctx.principal.institute_id}  # forced
    if args.get("batch_id"):
        common["batchId"] = str(args["batch_id"])
    if start:
        common["startDate"] = start
    if end:
        common["endDate"] = end

    report_params = dict(common)
    if requested:
        report_params["modules"] = ",".join(requested)
    calls = [_fetch("student-360", report_params)]
    if detail:
        calls.append(_fetch("raw-detail", {**common, "parts": ",".join(detail), "attemptLimit": attempt_limit}))
    results = await asyncio.gather(*calls)

    report = results[0]
    if isinstance(report, dict) and report.get("error") == "not_found":
        return report
    out: Dict[str, Any] = {
        "learner": {"learner_id": profile["user_id"], "full_name": profile.get("full_name")},
        "report": _prune_nulls(report) if not (isinstance(report, dict) and "error" in report) else report,
    }
    if detail:
        out["detail"] = _prune_nulls(results[1]) if not (isinstance(results[1], dict) and "error" in results[1]) \
            else results[1]
    if unknown_modules:
        out["ignored_modules"] = unknown_modules
    out["note"] = ("Facts only — write the report from these numbers; read learner_report(action='guide') for "
                   "the field meanings and rules. Missing sections had no data in the window.")
    return out


_SAVED_LIST_SQL = """
SELECT id, name, start_date_iso, end_date_iso, report_version, created_at,
       COUNT(*) OVER () AS total
FROM student_analysis_process
WHERE user_id = :uid AND institute_id = :inst AND status = 'COMPLETED'
ORDER BY created_at DESC
LIMIT :lim OFFSET :off
"""

_SAVED_ONE_SQL = """
SELECT id, user_id, name, start_date_iso, end_date_iso, report_version, created_at, report_json
FROM student_analysis_process
WHERE id = :id AND institute_id = :inst AND status = 'COMPLETED'
"""

_PAGE_SIZE = 10


async def _action_saved_reports(args: Dict[str, Any], ctx: ToolContext) -> Dict[str, Any]:
    learner_id = ld.target_learner_id(args)
    if not learner_id:
        return ld.missing_learner_error()
    try:
        page = max(0, int(args.get("page") or 0))
    except (TypeError, ValueError):
        page = 0
    rows = cbd._rows(ctx, _SAVED_LIST_SQL, {"uid": learner_id, "inst": ctx.principal.institute_id,
                                            "lim": _PAGE_SIZE, "off": page * _PAGE_SIZE})
    total = int(rows[0]["total"]) if rows else 0
    reports = [{"report_id": r["id"], "name": r.get("name"),
                "start_date": str(r["start_date_iso"]) if r.get("start_date_iso") else None,
                "end_date": str(r["end_date_iso"]) if r.get("end_date_iso") else None,
                "version": r.get("report_version") or "v1",
                "generated_at": str(r["created_at"])[:19] if r.get("created_at") else None} for r in rows]
    return {"reports": reports, "total": total, "page": page,
            "more": (page + 1) * _PAGE_SIZE < total,
            "note": None if reports else "No progress report has been generated for this learner in the dashboard."}


async def _action_saved_report(args: Dict[str, Any], ctx: ToolContext) -> Dict[str, Any]:
    report_id = str(args.get("report_id") or "").strip()
    if not report_id:
        return _err("missing_argument", action="saved_report", needs=["report_id (from saved_reports)"])
    rows = cbd._rows(ctx, _SAVED_ONE_SQL, {"id": report_id, "inst": ctx.principal.institute_id})
    if not rows:
        return _err("unknown_report", message="No completed report of this institute has that report_id.")
    r = rows[0]
    try:
        body = json.loads(r.get("report_json") or "null")
    except (TypeError, ValueError):
        body = None
    return {"report_id": r["id"], "learner_id": r.get("user_id"), "name": r.get("name"),
            "start_date": str(r["start_date_iso"]) if r.get("start_date_iso") else None,
            "end_date": str(r["end_date_iso"]) if r.get("end_date_iso") else None,
            "version": r.get("report_version") or "v1",
            "report": _prune_nulls(body) if body is not None else None,
            "note": "The dashboard's saved report: its numbers are facts; its ai_insights / narrative / "
                    "strengths were written by the dashboard's AI."}


_ACTIONS = {
    "guide": _action_guide,
    "data": _action_data,
    "saved_reports": _action_saved_reports,
    "saved_report": _action_saved_report,
}


async def execute_learner_report(args: Dict[str, Any], ctx: ToolContext) -> str:
    action = str((args or {}).get("action") or "").strip()
    handler = _ACTIONS.get(action)
    if handler is None:
        return json.dumps(_err("unknown_action", action=action, available=list(LEARNER_REPORT_ACTIONS)))
    result = await handler(args or {}, ctx)
    if isinstance(result, dict) and "action" not in result:
        result = {"action": action, **result}
    return json.dumps(result, ensure_ascii=False, default=str)


LEARNER_REPORT_TOOLS: Dict[str, ToolSpec] = {
    LEARNER_REPORT_TOOL_NAME: ToolSpec(
        name=LEARNER_REPORT_TOOL_NAME,
        schema=LEARNER_REPORT_SCHEMA,
        executor=execute_learner_report,
        required_permission=None,
        # Its own settings group: academic data is switched on separately from finding learners.
        setting_key=LEARNER_REPORT_GROUP_KEY,
        default_enabled=False,
        default_roles=["ADMIN"],
        phase=2,
        mode="READ",
    ),
}


def _register() -> None:
    from .assistant_tool_registry import ASSISTANT_TOOLS, GROUP_LABELS
    ASSISTANT_TOOLS.update(LEARNER_REPORT_TOOLS)
    GROUP_LABELS.update({LEARNER_REPORT_GROUP_KEY: "Progress reports: view data"})


_register()

__all__ = ["LEARNER_REPORT_TOOLS", "LEARNER_REPORT_TOOL_NAME", "LEARNER_REPORT_GROUP_KEY", "LEARNER_REPORT_ACTIONS", "LEARNER_REPORT_SCHEMA",
           "REPORT_MODULES", "DETAIL_PARTS", "GUIDE", "execute_learner_report"]
