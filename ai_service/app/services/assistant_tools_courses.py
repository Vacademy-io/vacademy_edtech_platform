"""
The ``courses`` tool — read-only view of the institute's courses for the
Assistant and the MCP server, and the authoring contract the connected LLM
writes courses against (no model runs server-side; see
docs/ai-course/COURSE_BUILDER_MCP_PLAN.md).

Actions
    list             courses with status, depth and slide count
    get              one course's tree (subjects → modules → chapters → slides) + batch id
    get_slide        one slide's full content
    schema           the authoring contract (outline JSON, slide specs, HTML rules)
    brief_checklist  what to ask the admin before building
    review           deterministic quality check of a course
    drip             the course's drip rules in plain language
    invites          the course's invite links with their payment plans
    get_invite       one invite in full
    payment_setup    active payment gateways + the institute's existing plans
"""
from __future__ import annotations

import json
import logging
from typing import Any, Dict, List, Optional

from . import course_builder_data as cbd
from . import course_content as cc
from .assistant_tool_registry import ToolContext, ToolSpec, _compact

logger = logging.getLogger(__name__)

COURSES_TOOL_NAME = "courses"
COURSES_GROUP_KEY = "courses"
COURSES_ACTIONS = (
    "list", "get", "get_slide", "schema", "brief_checklist", "review",
    "drip", "invites", "get_invite", "payment_setup", "sessions_levels",
)

BRIEF_CHECKLIST = [
    {"key": "start_from", "ask": "Start from scratch, or copy an existing course and extend it? (If copying: which "
                                 "course — courses(list) — and, when it has several batches, which batch. The copy is "
                                 "independent of the original.)"},
    {"key": "topic_and_goal", "ask": "What is the course about, and what should a learner be able to DO after it?"},
    {"key": "audience", "ask": "Who is it for — age/class, prior knowledge, exam or job goal?"},
    {"key": "level_and_language", "ask": "Beginner / intermediate / advanced? Which language should it be written in?"},
    {"key": "size", "ask": "How big — number of chapters, or total hours? (Default: 5-8 chapters of 3-6 slides.)"},
    {"key": "depth", "ask": "Just chapters (depth 3), or modules of chapters (4), or subjects → modules (5)?"},
    {"key": "batches", "ask": "Is it taught in batches — by session/year (e.g. 2026-27) and/or level/class (e.g. "
                              "Class 9, Class 10)? Which of the institute's existing ones (courses(sessions_levels))? "
                              "Most courses need none."},
    {"key": "slide_mix", "ask": "Which formats: reading pages, YouTube videos (do they have favourite channels/links?), "
                                "PDFs they want included, quizzes, single practice questions, assignments to submit?"},
    {"key": "assessment", "ask": "A quiz after every chapter? An assignment per chapter? Passing marks / attempts?"},
    {"key": "source_material", "ask": "Any syllabus, notes, PDFs or links the course must follow?"},
    {"key": "brand_and_tone", "ask": "Tone (formal, friendly, exam-focused), examples to use (local context, industry)?"},
    {"key": "pricing", "ask": "Free or paid? If paid: price, currency, one-time or subscription, access period?"},
    {"key": "invite", "ask": "Invite link: name, start/end dates, what the registration form should ask?"},
    {"key": "drip", "ask": "Release everything at once, or drip it (one chapter a day/week, or unlock after the previous one)?"},
]

COURSES_SCHEMA: Dict[str, Any] = {
    "type": "function",
    "function": {
        "name": COURSES_TOOL_NAME,
        "description": (
            "Read the institute's courses and the contract for building one. YOU (the AI) write every outline and "
            "slide; the server only validates and saves — no AI credits are used. Pick an `action`:\n"
            "- list (status?: DRAFT|IN_REVIEW|ACTIVE, search?): courses with status, depth and slide count.\n"
            "- get (course_id, batch_id?): the course tree with chapter / slide ids, types and statuses, plus its "
            "batches (session × level) — content is shared by all batches.\n"
            "- get_slide (slide_id): one slide's full content.\n"
            "- schema: READ THIS BEFORE BUILDING — the outline JSON for course_edit(create_course), every slide "
            "type's fields, the HTML document rules and the quiz format.\n"
            "- brief_checklist: what to ask the admin first. Interview them one question at a time; never invent "
            "prices, dates, links or facts about the institute.\n"
            "- review (course_id): deterministic quality check — run it before telling the admin the course is ready "
            "and fix every `fix` item.\n"
            "- drip (course_id): the course's drip rules and whether the institute enforces them.\n"
            "- invites (course_id): its invite links, prices and which one is the default.\n"
            "- get_invite (course_id, invite_id): one invite in full — landing copy, images, redirect path, success "
            "page, its form fields (field_id, label, type, required, locked) and available_fields (the institute's "
            "fields not yet on the form) for course_invites_edit(update_invite / update_form_fields).\n"
            "- payment_setup: active payment gateways and existing payment plans.\n"
            "- sessions_levels: the institute's existing sessions (e.g. '2026-27') and levels (e.g. 'Class 9') to "
            "reuse by id when a course is taught in several batches (session × level)."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "action": {"type": "string", "enum": list(COURSES_ACTIONS)},
                "course_id": {"type": "string"},
                "slide_id": {"type": "string"},
                "invite_id": {"type": "string"},
                "batch_id": {"type": "string", "description": "get: read the tree through this batch (default: "
                                                              "the course's first)."},
                "status": {"type": "string", "description": "list: DRAFT, IN_REVIEW or ACTIVE."},
                "search": {"type": "string", "description": "list: part of the course name."},
            },
            "required": ["action"],
        },
    },
}


def _err(code: str, **extra: Any) -> Dict[str, Any]:
    return cbd.err(code, **extra)


def _course_or_error(ctx: ToolContext, args: Dict[str, Any], action: str):
    course_id = str(args.get("course_id") or "").strip()
    if not course_id:
        return None, _err("missing_argument", action=action, needs=["course_id"])
    course = cbd.course_row(ctx, course_id)
    if not course:
        return None, _err("unknown_course", message="No such course in this institute. Use courses(action='list').")
    return course, None


def _slide_view(s: Dict[str, Any]) -> Dict[str, Any]:
    return {"id": s["id"], "title": s["title"], "type": cc.SOURCE_TYPE_TO_SPEC.get(s.get("type"), s.get("type")),
            "status": s.get("status"), "order": s.get("order")}


def _tree_view(tree: List[Dict[str, Any]], depth: int) -> Dict[str, Any]:
    """The tree as the admin sees it: hidden DEFAULT levels folded away."""
    def chapters(m):
        return [{"id": c["id"], "name": c["name"], "order": c.get("order"),
                 "slides": [_slide_view(s) for s in c.get("slides") or []]} for c in m.get("chapters") or []]
    if depth >= 5:
        return {"subjects": [{"id": s["id"], "name": s["name"], "modules": [
            {"id": m["id"], "name": m["name"], "chapters": chapters(m)} for m in s.get("modules") or []]}
            for s in tree]}
    modules = [m for s in tree for m in s.get("modules") or []]
    if depth == 4:
        return {"modules": [{"id": m["id"], "name": m["name"], "chapters": chapters(m)} for m in modules]}
    flat = [c for m in modules for c in chapters(m)]
    if depth <= 2:
        return {"chapter_id": flat[0]["id"] if flat else None,
                "slides": [s for c in flat for s in c["slides"]]}
    return {"chapters": flat}


async def _action_list(args: Dict[str, Any], ctx: ToolContext) -> Dict[str, Any]:
    status = str(args.get("status") or "").upper() or None
    if status and status not in (cbd.STATUS_DRAFT, cbd.STATUS_IN_REVIEW, cbd.STATUS_ACTIVE):
        return _err("bad_request", message="status must be DRAFT, IN_REVIEW or ACTIVE")
    rows = cbd.list_courses(ctx, status=status, search=args.get("search"))
    return {"courses": [{k: v for k, v in r.items() if k != "created_by_user_id"} | {
        "built_by_you": r.get("created_by_user_id") == ctx.principal.user_id} for r in rows], "count": len(rows)}


async def _action_get(args: Dict[str, Any], ctx: ToolContext) -> Dict[str, Any]:
    course, error = _course_or_error(ctx, args, "get")
    if error:
        return error
    batches = cbd.course_batches(ctx, course["id"])
    # Content is shared by all batches; read it through the requested one, else the primary.
    batch = str(args.get("batch_id") or "") or (batches[0]["id"] if batches else None)
    if args.get("batch_id") and batch not in {b["id"] for b in batches}:
        return _err("unknown_batch", message="That batch is not part of this course.",
                    batches=[{"id": b["id"], "name": b["name"]} for b in batches])
    depth = int(course.get("depth") or 3)
    tree = cbd.course_tree(ctx, course["id"], batch) if batch else []
    slide_count = sum(len(c.get("slides") or []) for c in cbd.flatten_chapters(tree))
    return {
        "course": {
            "id": course["id"], "name": course["name"], "status": course["status"], "depth": depth,
            "batch_id": batch, "slide_count": slide_count,
            "tags": [t for t in (course.get("tags") or "").split(",") if t],
            "enrolled_learners": sum(b.get("enrolled", 0) for b in batches),
        },
        # One batch per session × level; a simple course has a single unnamed one.
        "batches": [{"id": b["id"], "name": b["name"], "session": b.get("session"), "level": b.get("level"),
                     "start_date": b.get("start_date"), "enrolled": b.get("enrolled", 0)} for b in batches],
        **_tree_view(tree, depth),
        "editor_url": cbd.course_editor_url(ctx, course["id"]),
        "writable": course["status"] == cbd.STATUS_DRAFT,
    }


def _slide_content(dto: Dict[str, Any]) -> Dict[str, Any]:
    """The content-bearing parts of an admin-core SlideDTO, compacted."""
    out: Dict[str, Any] = {}
    doc = dto.get("document_slide")
    if isinstance(doc, dict):
        out["document"] = {"type": doc.get("type"), "data": doc.get("data") or doc.get("published_data")}
    video = dto.get("video_slide")
    if isinstance(video, dict):
        out["video"] = {"url": video.get("url") or video.get("published_url"), "description": video.get("description")}
    quiz = dto.get("quiz_slide")
    if isinstance(quiz, dict):
        out["quiz"] = {
            "questions": [{
                "type": q.get("question_type"),
                "question": (q.get("text") or {}).get("content"),
                "options": [(o.get("text") or {}).get("content") for o in q.get("options") or []],
                "answer_key": q.get("auto_evaluation_json"),
                "explanation": (q.get("explanation_text") or {}).get("content"),
            } for q in quiz.get("questions") or [] if isinstance(q, dict) and q.get("status") != "DELETED"],
        }
    question = dto.get("question_slide")
    if isinstance(question, dict):
        out["question"] = {"type": question.get("question_type"),
                           "question": (question.get("text_data") or {}).get("content"),
                           "options": [(o.get("text") or {}).get("content") for o in question.get("options") or []],
                           "answer_key": question.get("auto_evaluation_json")}
    assignment = dto.get("assignment_slide")
    if isinstance(assignment, dict):
        out["assignment"] = {"instructions_html": (assignment.get("text_data") or {}).get("content"),
                             "live_date": assignment.get("live_date"), "end_date": assignment.get("end_date")}
    return out


async def _action_get_slide(args: Dict[str, Any], ctx: ToolContext) -> Dict[str, Any]:
    slide_id = str(args.get("slide_id") or "").strip()
    if not slide_id:
        return _err("missing_argument", action="get_slide", needs=["slide_id"])
    info = cbd.slide_context(ctx, slide_id)
    if not info:
        return _err("unknown_slide", message="No such slide in this institute's courses.")
    dto = await cbd.admin_core(ctx, "GET", "/admin-core-service/slide/v1/slide", params={"slideId": slide_id})
    if cbd.is_error(dto) or not isinstance(dto, dict):
        return _err("fetch_failed", message="The slide content could not be loaded.")
    return {
        "slide": {"id": slide_id, "title": info["title"],
                  "type": cc.SOURCE_TYPE_TO_SPEC.get(info["source_type"], info["source_type"]),
                  "status": info["slide_status"], "chapter_id": info["chapter_id"], "course_id": info["course_id"]},
        "content": _slide_content(dto),
    }


async def _action_schema(args: Dict[str, Any], ctx: ToolContext) -> Dict[str, Any]:
    return {
        "workflow": [
            "1. courses(brief_checklist) and interview the admin.",
            "2. Write the outline; course_edit(create_course) — the course is saved as a DRAFT with its chapters "
            "(copy_from: start from a copy of an existing course and add to it).",
            "3. Write each slide and save it with course_edit(add_slide) (or include it inline in create_course).",
            "4. courses(review) → fix every `fix` with course_edit(update_slide).",
            "5. course_invites_edit(create_invite) with the price → share the returned link.",
            "6. Optional: course_drip_edit(schedule / set_rules).",
            "   Slides are DRAFT unless the admin asked for published ones; course_edit(publish_slides) when they "
            "approve them.",
            "7. course_edit(submit_for_review) — an admin approves it in the dashboard, then it goes live.",
        ],
        "depth": cc.DEPTH_CONTRACT,
        "batches": cc.BATCHES_CONTRACT,
        "outline": cc.OUTLINE_CONTRACT,
        "slides": cc.slide_contract(),
        "limits": {"chapters_per_course": cc.MAX_CHAPTERS, "slides_per_chapter": cc.MAX_SLIDES_PER_CHAPTER,
                   "questions_per_quiz": cc.MAX_QUESTIONS, "html_kb": cc.MAX_HTML_BYTES // 1000},
    }


async def _action_brief_checklist(args: Dict[str, Any], ctx: ToolContext) -> Dict[str, Any]:
    return {
        "checklist": BRIEF_CHECKLIST,
        "how": "Ask one question at a time and skip what the admin already told you. Confirm the outline with the "
               "admin before writing slides. Never invent prices, dates, video links or institute facts.",
    }


async def _action_review(args: Dict[str, Any], ctx: ToolContext) -> Dict[str, Any]:
    course, error = _course_or_error(ctx, args, "review")
    if error:
        return error
    batch = cbd.active_batch_id(ctx, course["id"])
    tree = cbd.course_tree(ctx, course["id"], batch) if batch else []
    chapters = cbd.flatten_chapters(tree)
    # Content for document / quiz slides, one admin-core call per chapter.
    for c in chapters:
        if not c.get("slides"):
            continue
        dtos = await cbd.admin_core(ctx, "GET", "/admin-core-service/slide/v1/slides", params={"chapterId": c["id"]})
        by_id = {d.get("id"): d for d in dtos if isinstance(d, dict)} if isinstance(dtos, list) else {}
        for s in c["slides"]:
            dto = by_id.get(s["id"]) or {}
            doc = dto.get("document_slide") or {}
            if doc:
                s["document_type"] = doc.get("type")
                s["html"] = doc.get("data") or doc.get("published_data") or ""
            quiz = dto.get("quiz_slide") or {}
            if quiz:
                s["question_count"] = len([q for q in quiz.get("questions") or [] if q.get("status") != "DELETED"])
    findings = cc.review_findings(chapters, int(course.get("depth") or 3))

    all_slides = [s for c in chapters for s in c.get("slides") or []]
    drafts = [s for s in all_slides if s.get("status") == "DRAFT"]
    if drafts and course["status"] != cbd.STATUS_DRAFT:
        findings.append({"severity": "warn", "where": "course",
                         "issue": f"{len(drafts)} slide(s) are still DRAFT, so learners won't see them — publish them "
                                  "with course_edit(publish_slides) if the admin approves."})
    if not course.get("course_preview_image_media_id"):
        findings.append({"severity": "warn", "where": "course",
                         "issue": "No preview image — the catalogue card is blank. Ask the admin for one and set it "
                                  "with course_edit(update_media, media={preview: {image_url}})."})
    batches = cbd.course_batches(ctx, course["id"])
    invites = cbd.invites_for_batches(ctx, [b["id"] for b in batches])
    setup = {
        "has_invite": bool(invites),
        "default_invite": next((i["name"] for i in invites if i["is_default"]), None),
        "status": course["status"],
    }
    if not invites:
        findings.append({"severity": "warn", "where": "course",
                         "issue": "No invite link yet — create one with course_invites_edit(create_invite)."})
    fixes = [f for f in findings if f["severity"] == "fix"]
    return {
        "course": {"id": course["id"], "name": course["name"]},
        "ready": not fixes,
        "findings": findings[:60],
        "summary": {"chapters": len(chapters), "slides": len(all_slides), "draft_slides": len(drafts),
                    "published_slides": len(all_slides) - len(drafts),
                    "fix": len(fixes), "warn": len(findings) - len(fixes)},
        "setup": setup,
        "editor_url": cbd.course_editor_url(ctx, course["id"]),
    }


async def _action_drip(args: Dict[str, Any], ctx: ToolContext) -> Dict[str, Any]:
    from .assistant_tools_course_drip import summarize_course_drip

    course, error = _course_or_error(ctx, args, "drip")
    if error:
        return error
    batch = cbd.active_batch_id(ctx, course["id"])
    chapters = cbd.flatten_chapters(cbd.course_tree(ctx, course["id"], batch) if batch else [])
    names = {course["id"]: course["name"]}
    for c in chapters:
        names[c["id"]] = c["name"]
        for s in c.get("slides") or []:
            names[s["id"]] = s["title"]
    settings = await cbd.load_course_settings(ctx)
    if cbd.is_error(settings):
        return _err("fetch_failed", message="The institute's course settings could not be read.")
    summary = summarize_course_drip(settings, course["id"], [c["id"] for c in chapters],
                                    [s["id"] for c in chapters for s in c.get("slides") or []], names)
    return {"course": {"id": course["id"], "name": course["name"], "status": course["status"]}, **summary,
            "editable_here": course["status"] != cbd.STATUS_ACTIVE}


def _invite_view(r: Dict[str, Any], batch_names: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
    names = batch_names or {}
    return {
        "id": r["id"], "name": r["name"], "status": r["status"], "is_default": r["is_default"],
        "batches": [names.get(b, b) for b in r.get("batch_ids") or []],
        "link": r.get("short_url"), "invite_code": r.get("invite_code"),
        "payment": {"type": r.get("payment_type"), "name": r.get("payment_option_name"),
                    "requires_approval": r.get("require_approval"),
                    "plans": [{"name": p["name"], "price": float(p["actual_price"] or 0),
                               "strike_price": float(p["elevated_price"]) if p.get("elevated_price") else None,
                               "currency": p.get("currency"), "validity_days": p.get("validity_in_days")}
                              for p in r.get("plans") or []]},
        "dates": {"start": r.get("start_date"), "end": r.get("end_date")},
        "access_days": r.get("learner_access_days"),
    }


async def _action_invites(args: Dict[str, Any], ctx: ToolContext) -> Dict[str, Any]:
    course, error = _course_or_error(ctx, args, "invites")
    if error:
        return error
    batches = cbd.course_batches(ctx, course["id"])
    names = {b["id"]: b["name"] for b in batches}
    rows = cbd.invites_for_batches(ctx, [b["id"] for b in batches])
    without_default = [b["name"] for b in batches if not any(r["is_default"] and b["id"] in r["batch_ids"] for r in rows)]
    return {"course": {"id": course["id"], "name": course["name"], "status": course["status"]},
            "batches": [{"id": b["id"], "name": b["name"]} for b in batches],
            "invites": [_invite_view(r, names) for r in rows], "count": len(rows),
            **({"batches_without_default_invite": without_default} if without_default else {})}


async def _action_get_invite(args: Dict[str, Any], ctx: ToolContext) -> Dict[str, Any]:
    course, error = _course_or_error(ctx, args, "get_invite")
    if error:
        return error
    invite_id = str(args.get("invite_id") or "").strip()
    if not invite_id:
        return _err("missing_argument", action="get_invite", needs=["invite_id"])
    batches = cbd.course_batches(ctx, course["id"])
    row = cbd.invite_row(ctx, invite_id, [b["id"] for b in batches]) if batches else None
    if not row:
        return _err("unknown_invite", message="No such invite for this course. Use courses(action='invites').")
    full = await cbd.admin_core(ctx, "GET",
                                f"/admin-core-service/v1/enroll-invite/{ctx.principal.institute_id}/{invite_id}")
    detail: Dict[str, Any] = {}
    if isinstance(full, dict) and not cbd.is_error(full):
        try:
            meta = json.loads(full.get("web_page_meta_data_json") or "{}")
        except ValueError:
            meta = {}
        from .assistant_tool_registry import _media_public_url
        from .assistant_tools_course_invites import catalogue_field_views, form_field_views
        try:
            settings = json.loads(full.get("setting_json") or "{}")
        except ValueError:
            settings = {}
        post_fill = (settings.get("postformfillConfiguration") if isinstance(settings, dict) else None) or {}
        fields = form_field_views(full.get("institute_custom_fields"))
        catalogue = await cbd.admin_core(ctx, "GET", "/admin-core-service/common/custom-fields",
                                         params={"instituteId": ctx.principal.institute_id})
        on_form = {f["field_id"] for f in fields}
        media = meta.get("courseMedia") if isinstance(meta.get("courseMedia"), dict) else {}
        images = {}
        for slot, fid in (("preview", meta.get("coursePreview")), ("banner", meta.get("courseBanner")),
                          ("media", media.get("id") if media.get("type") != "youtube" else None)):
            if fid:
                images[slot] = {"file_id": fid, "url": await _media_public_url(ctx, fid)}
        if media.get("type") == "youtube" and media.get("id"):
            images["media"] = {"youtube": media["id"]}
        detail = {
            "landing_page": _compact({k: meta.get(k) for k in (
                "description", "learningOutcome", "aboutCourse", "targetAudience", "tags", "includePaymentPlans")}),
            "images": images,
            "redirect_path": post_fill.get("redirectPath") or None,
            "success_page": _compact({"content": post_fill.get("content"),
                                      "show_login_button": post_fill.get("showLoginButton")}),
            "form_fields": fields,
            "available_fields": [f for f in catalogue_field_views(catalogue) if f["field_id"] not in on_form],
            "availability": full.get("availability_status"),
            "link": full.get("short_url") or row.get("short_url"),
        }
    names = {b["id"]: b["name"] for b in batches}
    return {"course": {"id": course["id"], "name": course["name"]}, "invite": {**_invite_view(row, names), **detail}}


async def _action_payment_setup(args: Dict[str, Any], ctx: ToolContext) -> Dict[str, Any]:
    vendors = await cbd.payment_vendors(ctx)
    options = await cbd.admin_core(
        ctx, "POST", "/admin-core-service/v1/payment-option/get-payment-options",
        body={"source": "INSTITUTE", "source_id": ctx.principal.institute_id, "exclude_types": ["CPO"]},
    )
    plans = []
    for o in options if isinstance(options, list) else []:
        if not isinstance(o, dict):
            continue
        plans.append({
            "id": o.get("id"), "name": o.get("name"), "type": o.get("type"), "is_institute_default": o.get("tag") == "DEFAULT",
            "plans": [{"name": p.get("name"), "price": p.get("actual_price"), "currency": p.get("currency"),
                       "validity_days": p.get("validity_in_days")} for p in o.get("payment_plans") or []][:6],
        })
    return {
        "gateways": [v.get("vendor") for v in vendors],
        "can_take_payments": bool(vendors),
        "payment_plans": plans[:30],
        "note": ("No payment gateway is set up, so only FREE invites can be created. An admin connects one under "
                 "Settings → Payment.") if not vendors else
                "Paid invites charge through these gateways. New plans are created per invite; existing ones are never edited.",
    }


async def _action_sessions_levels(args: Dict[str, Any], ctx: ToolContext) -> Dict[str, Any]:
    found = cbd.institute_sessions_levels(ctx)
    return {
        **found,
        "how": "Reuse these by id in course_edit(create_course, sessions=[{id, levels:[{id}]}]) so the course joins "
               "the institute's existing years / classes. New names create new sessions / levels (a name that "
               "already exists is reused). Ask the admin before inventing new ones.",
    }


_ACTIONS = {
    "list": _action_list, "get": _action_get, "get_slide": _action_get_slide, "schema": _action_schema,
    "brief_checklist": _action_brief_checklist, "review": _action_review, "drip": _action_drip,
    "invites": _action_invites, "get_invite": _action_get_invite, "payment_setup": _action_payment_setup,
    "sessions_levels": _action_sessions_levels,
}


async def execute_courses(args: Dict[str, Any], ctx: ToolContext) -> str:
    action = str((args or {}).get("action") or "").strip()
    handler = _ACTIONS.get(action)
    if handler is None:
        return json.dumps(_err("unknown_action", action=action, available=list(COURSES_ACTIONS)))
    result = await handler(args or {}, ctx)
    if isinstance(result, dict) and "action" not in result:
        result = {"action": action, **result}
    return json.dumps(result, ensure_ascii=False, default=str)


COURSES_TOOLS: Dict[str, ToolSpec] = {
    COURSES_TOOL_NAME: ToolSpec(
        name=COURSES_TOOL_NAME,
        schema=COURSES_SCHEMA,
        executor=execute_courses,
        required_permission=None,
        setting_key=COURSES_GROUP_KEY,
        default_enabled=False,
        default_roles=["ADMIN"],
        phase=2,
        mode="READ",
    ),
}


def _register() -> None:
    from .assistant_tool_registry import ASSISTANT_TOOLS, GROUP_LABELS
    ASSISTANT_TOOLS.update(COURSES_TOOLS)
    GROUP_LABELS.update({COURSES_GROUP_KEY: "Courses: view"})


_register()

__all__ = ["COURSES_TOOLS", "COURSES_TOOL_NAME", "COURSES_GROUP_KEY", "COURSES_ACTIONS", "COURSES_SCHEMA",
           "BRIEF_CHECKLIST", "execute_courses"]
