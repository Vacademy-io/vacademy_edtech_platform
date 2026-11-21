"""
The ``course_edit`` tool — DRAFT-only course building for the Assistant and the
MCP server.

The connected LLM writes the outline and every slide (see
``courses(action='schema')``); this tool validates and persists them through
admin-core with the caller's JWT. No model runs here and no AI credits are used.

Safety (MCP has no confirm card): every course created here is DRAFT and kept
off the catalogue, and slides are DRAFT unless the admin asks for them to be
published; edits / discards are refused on courses that are not DRAFT. A course
goes live only via ``submit_for_review`` → an admin approves it in the dashboard.
``publish_slides`` is the one action that can reach learners (on a live course)
and runs only when the admin asks to publish / approve slides. ``update_media``
also works on a live course (the admin's choice): it only changes the course's
images and fills the course's invites' EMPTY image slots, never one set on purpose.

Actions
    create_course      outline (+ optional inline slides) → a DRAFT course with its structure; copy_from
                       seeds it with an independent copy of another course's content; the creator is
                       its instructor
    add_chapter        one more chapter in a DRAFT course
    add_slide          one slide (document / video / pdf / quiz / question / assignment); DRAFT unless asked
    update_slide       replace a slide of a DRAFT course (status DRAFT unless asked)
    reorder            slide order inside a chapter
    import_image       public https image → institute media URL (for document HTML)
    import_pdf         public https PDF → media file id (for a pdf slide)
    discard_slide      mark a slide of a DRAFT course DELETED
    publish_slides     publish DRAFT slides (course / chapter / listed) — the admin's "approve slides"
    submit_for_review  DRAFT course → IN_REVIEW (an admin approves it in the dashboard)
    update_media       a course's preview image, banner and intro media (any status)
"""
from __future__ import annotations

import json
import logging
from typing import Any, Dict, List, Optional, Tuple

from . import course_builder_data as cbd
from . import course_content as cc
from .assistant_tool_registry import ToolContext, ToolSpec

logger = logging.getLogger(__name__)

COURSE_EDIT_TOOL_NAME = "course_edit"
COURSE_EDIT_GROUP_KEY = "course_edits"
COURSE_EDIT_ACTIONS = (
    "create_course", "add_chapter", "add_slide", "update_slide", "reorder",
    "import_image", "import_pdf", "discard_slide", "publish_slides", "submit_for_review", "update_media",
)

#: media key → the course column it sets, and the invite image slot it fills when that is empty.
_MEDIA_SLOTS = {"preview": ("course_preview_image_media_id", "preview"),
                "banner": ("course_banner_media_id", "banner"),
                "intro": ("course_media_id", "media")}
MEDIA_DOC = ("MEDIA = {preview? (the catalogue card image), banner? (top of the course page), intro? (image or "
             "YouTube video on the course page)}, each {image_url} (public https image — imported into the institute's "
             "media) | {file_id} (existing media file) | 'none'; intro also takes {youtube: url}. "
             "Never invent image URLs — use ones the admin gives or the institute's media.")

_MAX_PDF_BYTES = 40_000_000
_SPEC_TO_SOURCE = {"document": "DOCUMENT", "pdf": "DOCUMENT", "video": "VIDEO", "quiz": "QUIZ",
                   "question": "QUESTION", "assignment": "ASSIGNMENT"}

COURSE_EDIT_SCHEMA: Dict[str, Any] = {
    "type": "function",
    "function": {
        "name": COURSE_EDIT_TOOL_NAME,
        "description": (
            "Build courses as DRAFTS. You write the outline and every slide yourself (read courses(action='schema') "
            "first); this tool validates and saves — no AI credits are used and nothing goes live from here. "
            "Pick an `action`:\n"
            "- create_course (course:{name, depth?, about_html?, why_learn_html?, who_should_learn_html?, tags?}, "
            "chapters | modules | subjects, media?: MEDIA): creates a DRAFT course with its structure. Slides inside chapters may be "
            "full slide specs (saved now) or {type, title} placeholders (returned in `todo` for add_slide). Returns "
            "every chapter id. Optional sessions / levels make one batch per session × level (see "
            "courses(action='schema') → batches; reuse existing ones from courses(action='sessions_levels')); leave "
            "them out for a simple course. The admin creating it is set as the course's instructor.\n"
            "  copy_from:{course_id, batch_id?} starts the new course as an independent copy of an existing course's "
            "chapters and slides (ask the admin first whether to start from one — courses(action='list')); the copy "
            "keeps the source's depth, chapters/modules/subjects you also send are added after the copied ones, and "
            "you extend it afterwards with add_chapter / add_slide. A source with several batches needs batch_id "
            "(the error lists them).\n"
            "- add_chapter (course_id, name, module_id?): another chapter (depth ≥ 3).\n"
            "- add_slide (chapter_id, slide:{type, title, …}, position?, status?): one slide.\n"
            "- update_slide (slide_id, slide:{type, title, …}, status?): replace a slide of a DRAFT course (same type).\n"
            "- reorder (chapter_id, slide_ids:[…]): the chapter's full slide order.\n"
            "- import_image (url): public https image → institute media URL to use in document HTML.\n"
            "- import_pdf (url): public https PDF → file_id for a {type:'pdf'} slide.\n"
            "- discard_slide (slide_id): remove a slide of a DRAFT course.\n"
            "- publish_slides (course_id, chapter_id?, slide_ids?): publish DRAFT slides (all of the course, one "
            "chapter, or the listed ones) — ONLY when the admin asks to publish / approve slides. On a live course "
            "learners see them immediately, so confirm with the admin first.\n"
            "Slide STATUS (create_course slides, add_slide, update_slide): status='PUBLISHED' only when the admin asks "
            "for the slide to be published / public; status='DRAFT' when they ask for a draft; when they say nothing, "
            "it is saved as DRAFT. A status may be set per slide (slide.status) or for the call (status).\n"
            "- submit_for_review (course_id): send the finished course for approval; an admin approves it in the "
            "dashboard and it goes live. Run courses(action='review') first.\n"
            "- update_media (course_id, media: MEDIA): set or replace the course's images — works on live courses "
            "too. The course's invite links get the new images wherever they have none of their own.\n"
            + MEDIA_DOC + "\n"
            "Slide types: document {html}, video {url (YouTube)}, pdf {file_id}, quiz {questions, settings?}, "
            "question {question}, assignment {instructions_html, …}."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "action": {"type": "string", "enum": list(COURSE_EDIT_ACTIONS)},
                "course": {"type": "object", "description": "create_course: course metadata (name required)."},
                "copy_from": {"type": "object", "description": "create_course: {course_id, batch_id?} — copy an "
                              "existing course's content into the new course, then extend it."},
                "chapters": {"type": "array", "items": {"type": "object"},
                             "description": "create_course depth 2/3: [{name, slides:[…]}]."},
                "modules": {"type": "array", "items": {"type": "object"},
                            "description": "create_course depth 4: [{name, chapters:[…]}]."},
                "subjects": {"type": "array", "items": {"type": "object"},
                             "description": "create_course depth 5: [{name, modules:[…]}]."},
                "sessions": {"type": "array", "items": {}, "description": "create_course: sessions → batches, "
                             "[{name | id, start_date?, levels?:[name | {id}]}]. Omit for a course without sessions."},
                "levels": {"type": "array", "items": {}, "description": "create_course: levels (names or {id}); "
                           "with no sessions, one batch per level. Omit for a course without levels."},
                "course_id": {"type": "string"},
                "chapter_id": {"type": "string"},
                "module_id": {"type": "string", "description": "add_chapter (depth ≥ 4): the module to add it to."},
                "slide_id": {"type": "string"},
                "slide_ids": {"type": "array", "items": {"type": "string"}},
                "name": {"type": "string", "description": "add_chapter: chapter name."},
                "slide": {"type": "object", "description": "add_slide / update_slide: the slide spec "
                                                          "(may carry its own status)."},
                "status": {"type": "string", "enum": list(cc.SLIDE_STATUSES),
                           "description": "Slide status for create_course / add_slide / update_slide. Default DRAFT; "
                                          "PUBLISHED only when the admin asks for published slides."},
                "position": {"type": "integer", "description": "add_slide: 1-based position (default: last)."},
                "url": {"type": "string", "description": "import_image / import_pdf: public https URL."},
                "media": {"type": "object", "description": "create_course / update_media: MEDIA "
                                                          "{preview?, banner?, intro?}."},
            },
            "required": ["action"],
        },
    },
}


def _err(code: str, **extra: Any) -> Dict[str, Any]:
    return cbd.err(code, **extra)


def _id_from(data: Any) -> Optional[str]:
    """admin-core answers created ids as a bare (sometimes quoted) string or a DTO with `id`."""
    if isinstance(data, dict):
        return data.get("id") if not cbd.is_error(data) else None
    if isinstance(data, str) and data.strip():
        return data.strip().strip('"')
    return None


_STATUS_WORDS = {"PUBLISHED": "PUBLISHED", "PUBLISH": "PUBLISHED", "PUBLIC": "PUBLISHED", "LIVE": "PUBLISHED",
                 "DRAFT": "DRAFT"}


def _status_of(spec: Dict[str, Any], args: Dict[str, Any]) -> Tuple[Optional[str], Optional[str]]:
    """The slide's status: its own, else the call's, else DRAFT (never published unless asked)."""
    raw = spec.get("status") or args.get("status") or "DRAFT"
    status = _STATUS_WORDS.get(str(raw).strip().upper())
    if not status:
        return None, f"status must be DRAFT or PUBLISHED (got '{raw}')"
    return status, None


def _draft_course(ctx: ToolContext, course_id: Any) -> Tuple[Optional[Dict[str, Any]], Optional[Dict[str, Any]]]:
    course = cbd.course_row(ctx, str(course_id or ""))
    if not course:
        return None, _err("unknown_course", message="No such course in this institute. Use courses(action='list').")
    if course["status"] != cbd.STATUS_DRAFT:
        return None, _err("course_not_draft",
                          message=f"This course is {course['status']}; only DRAFT courses can be edited from here. "
                                  "Edit it in the dashboard.",
                          editor_url=cbd.course_editor_url(ctx, course["id"]))
    return course, None


def _draft_chapter(ctx: ToolContext, chapter_id: Any) -> Tuple[Optional[Dict[str, Any]], Optional[Dict[str, Any]]]:
    chapter = cbd.chapter_context(ctx, chapter_id)
    if not chapter:
        return None, _err("unknown_chapter", message="No such chapter in this institute's courses. "
                                                     "Use courses(action='get') for chapter ids.")
    if chapter["course_status"] != cbd.STATUS_DRAFT:
        return None, _err("course_not_draft", message="That chapter belongs to a course that is not a DRAFT; "
                                                      "edit it in the dashboard.",
                          editor_url=cbd.course_editor_url(ctx, chapter["course_id"]))
    return chapter, None


async def _save_slide(ctx: ToolContext, chapter: Dict[str, Any], request: Dict[str, Any]) -> Any:
    return await cbd.admin_core(
        ctx, "POST", request["path"], body=request["body"], timeout=60.0,
        params={
            "chapterId": chapter["chapter_id"], "moduleId": chapter["module_id"],
            "subjectId": chapter["subject_id"], "packageSessionId": chapter["package_session_id"],
            "instituteId": ctx.principal.institute_id,
        },
    )


def _chapter_slides(ctx: ToolContext, chapter: Dict[str, Any]) -> List[Dict[str, Any]]:
    tree = cbd.course_tree(ctx, chapter["course_id"], chapter["package_session_id"])
    for c in cbd.flatten_chapters(tree):
        if c["id"] == chapter["chapter_id"]:
            return c.get("slides") or []
    return []


# ── create_course ────────────────────────────────────────────────────────

def _copy_source(ctx: ToolContext, args: Dict[str, Any]) -> Tuple[Optional[Dict[str, Any]], Optional[Dict[str, Any]]]:
    """create_course copy_from → ({course, batch, depth}, None), (None, None) when not copying, or (None, problem)."""
    spec = args.get("copy_from")
    if spec in (None, "", {}):
        return None, None
    spec = {"course_id": spec} if isinstance(spec, str) else spec
    if not isinstance(spec, dict):
        return None, _err("invalid_copy_from", message="copy_from must be {course_id, batch_id?}.")
    source = cbd.course_row(ctx, str(spec.get("course_id") or ""))
    if not source:
        return None, _err("unknown_course", message="copy_from.course_id is not a course of this institute. "
                                                    "Use courses(action='list').")
    batches = cbd.course_batches(ctx, source["id"])
    wanted = str(spec.get("batch_id") or "").strip()
    if wanted:
        batch = next((b for b in batches if b["id"] == wanted), None)
        if not batch:
            return None, _err("unknown_batch", message="copy_from.batch_id is not a batch of that course.",
                              batches=[{"id": b["id"], "name": b["name"]} for b in batches])
    elif len(batches) == 1:
        batch = batches[0]
    elif not batches:
        return None, _err("nothing_to_copy", message=f"'{source['name']}' has no active batch to copy from.")
    else:
        # Batches of one course can carry different content — the admin picks which one.
        return None, _err("pick_source_batch", message=f"'{source['name']}' has several batches; ask the admin "
                                                       "which one to copy and pass copy_from.batch_id.",
                          batches=[{"id": b["id"], "name": b["name"]} for b in batches])
    depth = int(source.get("depth") or 0) or None
    course = args.get("course") if isinstance(args.get("course"), dict) else {}
    asked = course.get("depth") or args.get("depth")
    if asked and depth and str(asked) != str(depth):
        # admin-core copies only between courses of the same depth.
        return None, _err("depth_mismatch", message=f"'{source['name']}' has depth {depth}; a copy has the same "
                                                    "depth. Leave course.depth out (or change the source's depth "
                                                    "first with course_structure_edit).")
    return {"course": source, "batch": batch, "depth": depth}, None


def _instructors(ctx: ToolContext) -> List[Dict[str, Any]]:
    """The admin creating the course, as its instructor (what the dashboard's add-course sends)."""
    p = ctx.principal
    return [{"new_user": False, "status": "ACTIVE",
             "user": {"id": p.user_id, "username": p.username or "", "full_name": p.full_name or p.username or "",
                      "email": "", "roles": [], "root_user": bool(p.is_root_user)}}]


async def _action_create_course(args: Dict[str, Any], ctx: ToolContext) -> Dict[str, Any]:
    copy, problem = _copy_source(ctx, args)
    if problem:
        return problem
    if copy and copy["depth"]:
        args = {**args, "course": {**(args.get("course") if isinstance(args.get("course"), dict) else {}),
                                   "depth": copy["depth"]}}
    outline, problem = cc.normalize_outline(args, allow_empty=bool(copy))
    if problem:
        return _err("invalid_outline", message=problem, see="courses(action='schema') → outline")

    # Validate every inline slide BEFORE creating anything, so a typo never
    # leaves a half-built course behind.
    problems = []
    for s in outline["subjects"]:
        for m in s["modules"]:
            for c in m["chapters"]:
                for i, spec in enumerate(c["slides"]):
                    if cc.is_placeholder(spec):
                        if str(spec.get("type") or "document").lower() not in cc.SLIDE_TYPES:
                            problems.append(f"chapter '{c['name']}' slide {i + 1}: unknown type '{spec.get('type')}'")
                        continue
                    status, problem = _status_of(spec, args)
                    if problem:
                        problems.append(f"chapter '{c['name']}' slide '{spec.get('title')}': {problem}")
                        continue
                    _, report = cc.build_slide_request(spec, slide_order=i + 1, status=status)
                    if report.get("problem"):
                        problems.append(f"chapter '{c['name']}' slide '{spec.get('title')}': {report['problem']}")
    if problems:
        return _err("invalid_slides", problems=problems[:30], message="Nothing was created. Fix these and resend.")
    media = args.get("media")
    if media is not None:
        problem = _check_media(media)
        if problem:
            return _err("invalid_media", message=problem + " Nothing was created.")

    # Sessions × levels (batches). Ids must be the institute's own — admin-core
    # would otherwise attach this course to another institute's session/level.
    batches_spec, problem = cc.normalize_batches(args)
    if problem:
        return _err("invalid_batches", message=problem, see="courses(action='schema') → batches")
    if batches_spec["contain_levels"]:
        known = cbd.institute_sessions_levels(ctx)
        session_ids = {x["id"] for x in known["sessions"]}
        level_ids = {x["id"] for x in known["levels"]}
        for sess in batches_spec["sessions"]:
            if not sess["new_session"] and sess["id"] != cc.DEFAULT_LEVEL and sess["id"] not in session_ids:
                return _err("unknown_session", message=f"Session '{sess['id']}' is not one of this institute's "
                                                       "sessions (see courses(action='sessions_levels')).")
            for lv in sess["levels"]:
                if not lv["new_level"] and lv["id"] != cc.DEFAULT_LEVEL and lv["id"] not in level_ids:
                    return _err("unknown_level", message=f"Level '{lv['id']}' is not one of this institute's "
                                                         "levels (see courses(action='sessions_levels')).")

    course = outline["course"]
    # The admin creating it is the course's instructor — on every batch it gets.
    instructors = _instructors(ctx)
    for sess in batches_spec["sessions"]:
        for lv in sess.get("levels") or []:
            lv["add_faculty_to_course"] = instructors
    media_columns: Dict[str, str] = {}
    if media:
        media_columns, problem = await _resolve_media(ctx, media)
        if problem:
            return _err("invalid_media", message=problem + " Nothing was created.")
    created = await cbd.admin_core(
        ctx, "POST", f"/admin-core-service/course/v1/add-course/{ctx.principal.institute_id}", timeout=60.0,
        body={
            "id": "", "new_course": True, "force_new_course": True,
            "contain_levels": batches_spec["contain_levels"], "sessions": batches_spec["sessions"],
            "add_faculty_to_course": instructors,
            "course_name": course["name"], "course_depth": outline["depth"], "status": cbd.STATUS_DRAFT,
            "is_course_published_to_catalaouge": False,
            "about_the_course_html": course["about_html"], "why_learn_html": course["why_learn_html"],
            "who_should_learn_html": course["who_should_learn_html"], "course_html_description": course["about_html"],
            "tags": course["tags"], "created_by_user_id": ctx.principal.user_id, "version_number": 1,
            "thumbnail_file_id": "", "course_preview_image_media_id": "", "course_banner_media_id": "",
            "course_media_id": "", **media_columns,
        },
    )
    course_id = _id_from(created)
    if not course_id:
        return _err("create_failed", message="The course could not be created.",
                    detail=created.get("message") if isinstance(created, dict) else None)
    batch_ids = await _batches_for(ctx, course_id)
    if not batch_ids:
        return _err("create_failed", course_id=course_id,
                    message="The course was created but its batches were not found; open it in the dashboard.")
    # Content is shared by every batch: subjects and chapters are mapped to all
    # of them (the dashboard does the same); the first is the tracking batch.
    batch, all_batches = batch_ids[0], ",".join(batch_ids)

    copied: Optional[Dict[str, Any]] = None
    existing: List[Dict[str, Any]] = []
    if copy:
        # An independent copy (new ids): edits here never touch the source course. The dashboard's
        # "linked" copy shares rows with the source, so a DRAFT edit would change a live course — not offered.
        done = await cbd.admin_core(
            ctx, "POST", "/admin-core-service/course/v1/copy-content", timeout=180.0,
            body={"sourcePackageSessionId": copy["batch"]["id"], "targetPackageSessionIds": batch_ids,
                  "mode": "VALUE"},
        )
        if cbd.is_error(done) or not isinstance(done, dict):
            return _err("copy_failed", course_id=course_id, editor_url=cbd.course_editor_url(ctx, course_id),
                        message="The DRAFT course was created but copying the content failed; nothing else was "
                                "added. Retry in the dashboard (Copy content) or tell the admin.",
                        detail=done.get("message") if isinstance(done, dict) else None)
        existing = cbd.course_tree(ctx, course_id, batch)
        copied = {"from": {"course_id": copy["course"]["id"], "course": copy["course"]["name"],
                           "batch": copy["batch"]["name"]},
                  "subjects": done.get("copiedSubjects", 0), "modules": done.get("copiedModules", 0),
                  "chapters": done.get("copiedChapters", 0), "slides": done.get("copiedSlides", 0),
                  "warnings": (done.get("warnings") or [])[:20]}
    # New outline content lands AFTER the copied content: hidden DEFAULT levels reuse the copy's.
    existing_chapters = cbd.flatten_chapters(existing)
    reuse_subject = existing[0]["id"] if existing and outline["depth"] < 5 else None
    reuse_module = (existing[0].get("modules") or [{}])[0].get("id") if existing and outline["depth"] <= 3 else None
    reuse_chapter = existing_chapters[0] if existing_chapters and outline["depth"] == 2 else None
    chapter_base = len(existing_chapters) if outline["depth"] >= 3 else 0

    result_chapters: List[Dict[str, Any]] = []
    failures: List[str] = []
    todo: List[Dict[str, Any]] = []
    for s_index, s in enumerate(outline["subjects"]):
        subject_id = reuse_subject
        if not subject_id:
            subject = await cbd.admin_core(
                ctx, "POST", "/admin-core-service/subject/v1/add-subject",
                params={"commaSeparatedPackageSessionIds": all_batches},
                body={"subject_name": s["name"], "subject_code": _code(s["name"]), "credit": 0,
                      "thumbnail_id": None, "subject_order": len(existing) + s_index + 1},
            )
            subject_id = _id_from(subject)
            if not subject_id:
                failures.append(f"subject '{s['name']}' could not be created")
                continue
        for m in s["modules"]:
            module_id = reuse_module
            if not module_id:
                module = await cbd.admin_core(
                    ctx, "POST", "/admin-core-service/subject/v1/add-module",
                    params={"subjectId": subject_id, "packageSessionId": batch},
                    body={"module_name": m["name"], "status": "ACTIVE", "description": "", "thumbnail_id": None},
                )
                module_id = _id_from(module)
                if not module_id:
                    failures.append(f"module '{m['name']}' could not be created")
                    continue
            for c_index, c in enumerate(m["chapters"]):
                # depth 2: the copied course's single hidden chapter takes the new slides after its own.
                chapter_id, slide_base = (reuse_chapter["id"], len(reuse_chapter.get("slides") or [])) \
                    if reuse_chapter else (None, 0)
                if not chapter_id:
                    chapter = await cbd.admin_core(
                        ctx, "POST", "/admin-core-service/chapter/v1/add-chapter",
                        params={"subjectId": subject_id, "moduleId": module_id,
                                "commaSeparatedPackageSessionIds": all_batches},
                        body={"chapter_name": c["name"], "status": "ACTIVE", "file_id": None, "description": "",
                              "chapter_order": chapter_base + len(result_chapters) + 1},
                    )
                    chapter_id = _id_from(chapter)
                    if not chapter_id:
                        failures.append(f"chapter '{c['name']}' could not be created")
                        continue
                ctx_chapter = {"chapter_id": chapter_id, "module_id": module_id, "subject_id": subject_id,
                               "package_session_id": batch}
                saved_slides = []
                for i, spec in enumerate(c["slides"]):
                    position = slide_base + i + 1
                    if cc.is_placeholder(spec):
                        todo.append({"chapter_id": chapter_id, "chapter": c["name"], "position": position,
                                     "type": str(spec.get("type") or "document").lower(), "title": spec["title"]})
                        continue
                    status, _ = _status_of(spec, args)
                    request, report = cc.build_slide_request(spec, slide_order=position, status=status)
                    saved = await _save_slide(ctx, ctx_chapter, request)
                    if cbd.is_error(saved):
                        failures.append(f"slide '{spec['title']}': {saved.get('message') or 'rejected'}")
                        todo.append({"chapter_id": chapter_id, "chapter": c["name"], "position": position,
                                     "type": request["type"], "title": request["title"], "retry": True})
                        continue
                    saved_slides.append({"id": _id_from(saved) or request["id"], "title": request["title"],
                                         "type": request["type"], "status": status, **({"warning": report["warning"]}
                                                                     if report.get("warning") else {})})
                result_chapters.append({"id": chapter_id, "name": c["name"], "module": m["name"],
                                        "subject": s["name"], "slides": saved_slides})

    # admin-core uniquifies a name already used by an ACTIVE/DRAFT course ("X (2)") —
    # report the name it actually saved, not the one asked for.
    saved_name = (cbd.course_row(ctx, course_id) or {}).get("name") or course["name"]
    # The auto-created default invites are made with the course; give them its images.
    media_notes = _invite_notes(await _fill_invites(ctx, course_id, list(media))) if media else []
    batches = cbd.course_batches(ctx, course_id)
    invites = cbd.invites_for_batches(ctx, batch_ids)
    defaults = [i for i in invites if i["is_default"]]
    names = {b["id"]: b["name"] for b in batches}
    hidden = {2: "subject, module and chapter", 3: "subject and module", 4: "subject"}.get(outline["depth"])
    return {
        "course": {"id": course_id, "name": saved_name, "status": cbd.STATUS_DRAFT, "depth": outline["depth"],
                   "batch_id": batch},
        "batches": [{"id": b["id"], "name": b["name"], "session": b["session"], "level": b["level"]} for b in batches]
        or [{"id": bid} for bid in batch_ids],
        # Hidden DEFAULT subject / module names are noise to the caller; every other key stays,
        # including an empty `slides` list.
        "chapters": [{k: v for k, v in c.items() if not (k in ("module", "subject") and v == cc.DEFAULT_LEVEL)}
                     for c in result_chapters],
        "todo": todo,
        "failures": failures,
        "instructor": ctx.principal.full_name or ctx.principal.username or ctx.principal.user_id,
        **({"copied": {**copied, "chapter_list": [
            {"id": c["id"], "name": c["name"], "slides": len(c.get("slides") or []),
             **({"module": c["module_name"]} if c.get("module_name") != cc.DEFAULT_LEVEL else {}),
             **({"subject": c["subject_name"]} if c.get("subject_name") != cc.DEFAULT_LEVEL else {})}
            for c in existing_chapters][:200],
            "note": "An independent copy: changing it never changes the source course. Copied slides keep the "
                    "status the institute's 'copied slide status' setting gives them (DRAFT by default). Extend it "
                    "with add_chapter / add_slide / update_slide."}} if copied else {}),
        **({"media": list(media), "media_notes": media_notes} if media else {}),
        "hidden_levels": f"A hidden DEFAULT {hidden} hold the structure; learners never see them." if hidden else None,
        # Every batch gets an auto-created default invite at the institute's default price.
        "default_invites": [{"id": i["id"], "name": i["name"], "payment": i.get("payment_type"),
                             "link": i.get("short_url"), "batches": [names.get(b, b) for b in i["batch_ids"]]}
                            for i in defaults],
        "next": ("Write each `todo` slide with add_slide, then courses(action='review'). The course is a DRAFT and "
                 "off the catalogue until it is submitted and approved."),
        "editor_url": cbd.course_editor_url(ctx, course_id),
    }


def _code(name: str) -> str:
    letters = "".join(ch for ch in name if ch.isalnum())
    return (letters[:3] or "SUB").upper()


async def _batches_for(ctx: ToolContext, course_id: str) -> List[str]:
    """Every ACTIVE batch id of a freshly created course (admin-core's own list, else the DB)."""
    batches = await cbd.admin_core(ctx, "GET", f"/admin-core-service/course/v1/{course_id}/batches")
    ids = [b["id"] for b in batches if isinstance(b, dict) and b.get("id")] if isinstance(batches, list) else []
    return ids or [b["id"] for b in cbd.course_batches(ctx, course_id)]


# ── chapters & slides ────────────────────────────────────────────────────

async def _action_add_chapter(args: Dict[str, Any], ctx: ToolContext) -> Dict[str, Any]:
    name = cc.clean_title(args.get("name"))
    if not name:
        return _err("missing_argument", action="add_chapter", needs=["course_id", "name"])
    course, error = _draft_course(ctx, args.get("course_id"))
    if error:
        return error
    depth = int(course.get("depth") or 3)
    if depth < 3:
        return _err("bad_request", message="A depth-2 course has a single hidden chapter; add slides to it instead.")
    batch = cbd.active_batch_id(ctx, course["id"])
    chapters = cbd.flatten_chapters(cbd.course_tree(ctx, course["id"], batch)) if batch else []
    if not chapters:
        return _err("no_structure", message="This course has no module yet; create it with create_course.")
    module_id = str(args.get("module_id") or "")
    anchor = next((c for c in chapters if c["module_id"] == module_id), None) if module_id else chapters[-1]
    if anchor is None:
        return _err("unknown_module", message="That module is not part of this course (see courses(action='get')).")
    if name.casefold() in {c["name"].casefold() for c in chapters if c["module_id"] == anchor["module_id"]}:
        return _err("duplicate", message=f"Chapter '{name}' already exists in that module.")
    all_batches = ",".join(b["id"] for b in cbd.course_batches(ctx, course["id"])) or batch
    chapter = await cbd.admin_core(
        ctx, "POST", "/admin-core-service/chapter/v1/add-chapter",
        params={"subjectId": anchor["subject_id"], "moduleId": anchor["module_id"],
                "commaSeparatedPackageSessionIds": all_batches},
        body={"chapter_name": name, "status": "ACTIVE", "file_id": None, "description": "",
              "chapter_order": len(chapters) + 1},
    )
    chapter_id = _id_from(chapter)
    if not chapter_id:
        return _err("create_failed", message="The chapter could not be created.",
                    detail=chapter.get("message") if isinstance(chapter, dict) else None)
    return {"chapter": {"id": chapter_id, "name": name}, "course_id": course["id"],
            "next": "Add its slides with add_slide(chapter_id=…)."}


async def _action_add_slide(args: Dict[str, Any], ctx: ToolContext) -> Dict[str, Any]:
    if not args.get("chapter_id") or not isinstance(args.get("slide"), dict):
        return _err("missing_argument", action="add_slide", needs=["chapter_id", "slide"])
    chapter, error = _draft_chapter(ctx, args.get("chapter_id"))
    if error:
        return error
    existing = _chapter_slides(ctx, chapter)
    if len(existing) >= cc.MAX_SLIDES_PER_CHAPTER:
        return _err("too_many_slides", message=f"A chapter holds at most {cc.MAX_SLIDES_PER_CHAPTER} slides.")
    spec = dict(args["slide"])
    used = {(s.get("title") or "").casefold() for s in existing}
    if cc.clean_title(spec.get("title")).casefold() in used:
        return _err("duplicate_title", message="A slide with this title already exists in the chapter — use "
                                               "update_slide to change it, or pick a distinct title.")
    max_order = max([s.get("order") or 0 for s in existing] or [0])
    status, problem = _status_of(spec, args)
    if problem:
        return _err("invalid_slide", message=problem)
    request, report = cc.build_slide_request(spec, slide_order=max_order + 1, status=status)
    if request is None:
        return _err("invalid_slide", message=report.get("problem"), see="courses(action='schema') → slides")
    saved = await _save_slide(ctx, chapter, request)
    if cbd.is_error(saved):
        return _err("save_failed", message=saved.get("message") or "admin-core rejected the slide.")
    slide_id = _id_from(saved) or request["id"]
    position = args.get("position")
    moved = False
    if isinstance(position, int) and 1 <= position <= len(existing):
        ordered = [s["id"] for s in existing]
        ordered.insert(position - 1, slide_id)
        moved = not cbd.is_error(await _apply_order(ctx, chapter["chapter_id"], ordered))
    return {
        "slide": {"id": slide_id, "title": request["title"], "type": request["type"], "status": status,
                  "position": position if moved else len(existing) + 1},
        "chapter_id": chapter["chapter_id"],
        **({"report": report} if report else {}),
    }


async def _action_update_slide(args: Dict[str, Any], ctx: ToolContext) -> Dict[str, Any]:
    if not args.get("slide_id") or not isinstance(args.get("slide"), dict):
        return _err("missing_argument", action="update_slide", needs=["slide_id", "slide"])
    info = cbd.slide_context(ctx, args["slide_id"])
    if not info:
        return _err("unknown_slide", message="No such slide in this institute's courses.")
    # Inside a DRAFT course nothing is visible to learners, so any slide may be edited.
    if info["course_status"] != cbd.STATUS_DRAFT:
        return _err("not_draft", message="Only slides of DRAFT courses can be changed from here; "
                                         "edit a live course's content in the dashboard.",
                    editor_url=cbd.course_editor_url(ctx, info["course_id"]))
    spec = dict(args["slide"])
    status, problem = _status_of(spec, args)
    if problem:
        return _err("invalid_slide", message=problem)
    stype = str(spec.get("type") or "").lower()
    if _SPEC_TO_SOURCE.get(stype) != info["source_type"]:
        return _err("type_mismatch", message=f"This slide is a {info['source_type'].lower()} slide; discard it and "
                                             "add a new one to change its type.")
    if stype == "pdf" or stype == "document":
        current = await cbd.admin_core(ctx, "GET", "/admin-core-service/slide/v1/slide",
                                       params={"slideId": info["slide_id"]})
        doc_type = ((current or {}).get("document_slide") or {}).get("type") if isinstance(current, dict) else None
        if doc_type and doc_type != ("PDF" if stype == "pdf" else "HTML"):
            return _err("type_mismatch", message=f"This document slide holds {doc_type}; discard it and add a new one.")
    request, report = cc.build_slide_request(spec, slide_order=info.get("slide_order") or 1,
                                             slide_id=info["slide_id"], existing_source_id=info["source_id"],
                                             status=status)
    if request is None:
        return _err("invalid_slide", message=report.get("problem"), see="courses(action='schema') → slides")
    saved = await _save_slide(ctx, info, request)
    if cbd.is_error(saved):
        return _err("save_failed", message=saved.get("message") or "admin-core rejected the change.")
    return {"slide": {"id": info["slide_id"], "title": request["title"], "type": stype, "status": status,
                      "was": info["slide_status"]},
            **({"report": report} if report else {})}


async def _apply_order(ctx: ToolContext, chapter_id: str, slide_ids: List[str]) -> Any:
    return await cbd.admin_core(
        ctx, "PUT", "/admin-core-service/slide/v1/update-slide-order", params={"chapterId": chapter_id},
        body=[{"slide_id": sid, "slide_order": i + 1} for i, sid in enumerate(slide_ids)],
    )


async def _action_reorder(args: Dict[str, Any], ctx: ToolContext) -> Dict[str, Any]:
    ids = [str(x) for x in (args.get("slide_ids") or []) if x]
    if not args.get("chapter_id") or not ids:
        return _err("missing_argument", action="reorder", needs=["chapter_id", "slide_ids"])
    chapter, error = _draft_chapter(ctx, args.get("chapter_id"))
    if error:
        return error
    existing = [s["id"] for s in _chapter_slides(ctx, chapter)]
    if sorted(ids) != sorted(existing):
        return _err("bad_request", message="slide_ids must list every slide of the chapter exactly once.",
                    current_order=existing)
    saved = await _apply_order(ctx, chapter["chapter_id"], ids)
    if cbd.is_error(saved):
        return _err("save_failed", message=saved.get("message") or "The order could not be saved.")
    return {"chapter_id": chapter["chapter_id"], "order": ids}


async def _action_discard_slide(args: Dict[str, Any], ctx: ToolContext) -> Dict[str, Any]:
    info = cbd.slide_context(ctx, args.get("slide_id"))
    if not info:
        return _err("unknown_slide", message="No such slide in this institute's courses.")
    if info["course_status"] != cbd.STATUS_DRAFT:
        return _err("not_draft", message="Only slides of DRAFT courses can be discarded from here.")
    done = await cbd.admin_core(
        ctx, "PUT", "/admin-core-service/slide/v1/update-status",
        params={"chapterId": info["chapter_id"], "slideId": info["slide_id"],
                "instituteId": ctx.principal.institute_id, "status": "DELETED"},
    )
    if cbd.is_error(done):
        return _err("save_failed", message=done.get("message") or "The slide could not be discarded.")
    return {"discarded": {"id": info["slide_id"], "title": info["title"]}}


# ── publishing slides ────────────────────────────────────────────────────

_PUBLISH_PATHS = {
    "DOCUMENT": cc.SLIDE_ENDPOINTS["document"], "VIDEO": cc.SLIDE_ENDPOINTS["video"],
    "QUIZ": cc.SLIDE_ENDPOINTS["quiz"], "QUESTION": cc.SLIDE_ENDPOINTS["question"],
    "ASSIGNMENT": cc.SLIDE_ENDPOINTS["assignment"],
}


def publish_body(dto: Dict[str, Any], source_type: str, slide_order: Optional[int]) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    """
    The dashboard's Publish request for one slide (handlePublishSlide.tsx): the
    slide as stored, status PUBLISHED, new_slide false — plus the published copy
    learners read (documents: published_data; videos: published_url).
    """
    base = {k: v for k, v in dto.items() if k not in ("is_loaded", "new_slide", "is_new_slide")}
    base.update({"status": "PUBLISHED", "new_slide": False, "slide_order": slide_order})
    if source_type == "DOCUMENT":
        doc = dict(dto.get("document_slide") or {})
        data = doc.get("data") or doc.get("published_data")
        if not data:
            return None, "the document has no content to publish"
        doc.update({"data": data, "published_data": data, "force_publish": False,
                    "published_document_total_pages": doc.get("total_pages") or 1})
        return {"id": dto.get("id"), "title": dto.get("title"), "image_file_id": dto.get("image_file_id") or "",
                "description": dto.get("description") or "", "slide_order": slide_order, "document_slide": doc,
                "status": "PUBLISHED", "new_slide": False, "notify": False}, None
    if source_type == "VIDEO":
        video = dict(dto.get("video_slide") or {})
        url = video.get("url") or video.get("published_url")
        if not url:
            return None, "the video has no URL"
        video.update({"published_url": url,
                      "published_video_length_in_millis": video.get("video_length_in_millis")
                      or video.get("published_video_length_in_millis") or 0})
        return {**base, "video_slide": video}, None
    key = {"QUIZ": "quiz_slide", "QUESTION": "question_slide", "ASSIGNMENT": "assignment_slide"}.get(source_type)
    if not key or not isinstance(dto.get(key), dict):
        return None, f"{source_type.lower()} slides are published from the dashboard"
    return base, None


async def _action_publish_slides(args: Dict[str, Any], ctx: ToolContext) -> Dict[str, Any]:
    course = cbd.course_row(ctx, str(args.get("course_id") or ""))
    if not course:
        return _err("unknown_course", message="No such course in this institute. Use courses(action='list').")
    batch = cbd.active_batch_id(ctx, course["id"])
    chapters = cbd.flatten_chapters(cbd.course_tree(ctx, course["id"], batch)) if batch else []
    chapter_id = str(args.get("chapter_id") or "").strip()
    if chapter_id:
        chapters = [c for c in chapters if c["id"] == chapter_id]
        if not chapters:
            return _err("unknown_chapter", message="That chapter is not part of this course.")
    wanted = {str(x) for x in (args.get("slide_ids") or []) if x}
    pool = [(c, s) for c in chapters for s in c.get("slides") or []]
    if wanted:
        unknown = wanted - {s["id"] for _, s in pool}
        if unknown:
            return _err("unknown_slide", message="Some slide_ids are not part of this course / chapter.",
                        slide_ids=sorted(unknown))
        pool = [(c, s) for c, s in pool if s["id"] in wanted]
    already = [s["title"] for _, s in pool if s.get("status") == "PUBLISHED"]
    targets = [(c, s) for c, s in pool if s.get("status") == "DRAFT"]

    published, skipped = [], []
    for c, s in targets:
        dto = await cbd.admin_core(ctx, "GET", "/admin-core-service/slide/v1/slide", params={"slideId": s["id"]})
        if not isinstance(dto, dict) or cbd.is_error(dto):
            skipped.append({"title": s["title"], "reason": "could not be loaded"})
            continue
        body, reason = publish_body(dto, s.get("type") or "", s.get("order"))
        if body is None:
            skipped.append({"title": s["title"], "reason": reason})
            continue
        saved = await _save_slide(ctx, {"chapter_id": c["id"], "module_id": c["module_id"],
                                        "subject_id": c["subject_id"], "package_session_id": batch},
                                  {"path": _PUBLISH_PATHS[s["type"]], "body": body})
        if cbd.is_error(saved):
            skipped.append({"title": s["title"], "reason": saved.get("message") or "admin-core rejected it"})
        else:
            published.append({"id": s["id"], "title": s["title"], "chapter": c["name"]})
    live = course["status"] == cbd.STATUS_ACTIVE
    return {
        "course": {"id": course["id"], "name": course["name"], "status": course["status"]},
        "published": published,
        "already_published": already[:50],
        "skipped": skipped,
        "note": ("The course is live: learners can see these slides now." if live else
                 "The course is not live yet; these slides become visible to learners once it is approved."),
        "editor_url": cbd.course_editor_url(ctx, course["id"]),
    }


# ── media ────────────────────────────────────────────────────────────────

async def _action_import_image(args: Dict[str, Any], ctx: ToolContext) -> Dict[str, Any]:
    if not args.get("url"):
        return _err("missing_argument", action="import_image", needs=["url"])
    from .assistant_tools_website_edit import _import_one_image
    result = await _import_one_image({"url": args["url"], "kind": "illustration"}, ctx)
    if cbd.is_error(result):
        return result
    return {"url": result.get("url"), "source": result.get("source"),
            "next": "Use this url as <img src> in a document slide's HTML (inside a <figure> with a caption)."}


async def _action_import_pdf(args: Dict[str, Any], ctx: ToolContext) -> Dict[str, Any]:
    if not args.get("url"):
        return _err("missing_argument", action="import_pdf", needs=["url"])
    fetched = await cbd.fetch_public_file(str(args["url"]).strip(), max_bytes=_MAX_PDF_BYTES,
                                          allowed_types={"application/pdf": "pdf"})
    if cbd.is_error(fetched):
        return fetched
    content, ctype, ext = fetched
    from urllib.parse import urlparse
    base = (urlparse(args["url"]).path.rsplit("/", 1)[-1] or "document").rsplit(".", 1)[0][:60] or "document"
    file_id = await cbd.upload_to_media(ctx, content, f"{base}.{ext}".replace(" ", "_").lower(), ctype)
    if cbd.is_error(file_id):
        return file_id
    return {"file_id": file_id, "bytes": len(content),
            "next": "Add it with add_slide(slide={type:'pdf', title:…, file_id:…})."}


# ── going live ───────────────────────────────────────────────────────────

async def _action_submit_for_review(args: Dict[str, Any], ctx: ToolContext) -> Dict[str, Any]:
    course, error = _draft_course(ctx, args.get("course_id"))
    if error:
        return error
    done = await cbd.admin_core(
        ctx, "POST", "/admin-core-service/teacher/course-approval/v1/submit-for-review",
        params={"courseId": course["id"]},
    )
    if cbd.is_error(done):
        return _err("submit_failed", message=done.get("message") or "The course could not be submitted.")
    return {
        "course": {"id": course["id"], "name": course["name"], "status": cbd.STATUS_IN_REVIEW},
        "next": "An admin approves it in the dashboard (Courses → Approval); it goes live on approval. "
                "DRAFT slides stay hidden from learners until published — course_edit(publish_slides) when "
                "the admin asks.",
        "editor_url": cbd.course_editor_url(ctx, course["id"]),
    }


# ── course media ─────────────────────────────────────────────────────────

def _check_media(media: Any) -> Optional[str]:
    if not isinstance(media, dict) or not media or set(media) - set(_MEDIA_SLOTS):
        return "media must be {preview?, banner?, intro?} — " + MEDIA_DOC
    for key, spec in media.items():
        problem = cbd.check_media_spec(spec, f"media.{key}", allow_youtube=key == "intro")
        if problem:
            return problem
    return None


async def _resolve_media(ctx: ToolContext, media: Dict[str, Any]) -> Tuple[Dict[str, str], Optional[str]]:
    """media → {course column: stored value}; intro media is stored as JSON {type, id}."""
    columns: Dict[str, str] = {}
    for key, spec in media.items():
        resolved, problem = await cbd.resolve_media(ctx, spec, f"media.{key}", allow_youtube=key == "intro")
        if problem:
            return {}, problem
        kind, value = resolved
        column = _MEDIA_SLOTS[key][0]
        columns[column] = json.dumps({"type": kind, "id": value}) if key == "intro" else value
    return columns, None


async def _fill_invites(ctx: ToolContext, course_id: str, keys: List[str]) -> Dict[str, List[str]]:
    from .assistant_tools_course_invites import fill_empty_invite_images
    course = cbd.course_row(ctx, course_id) or {}
    batch_ids = [b["id"] for b in cbd.course_batches(ctx, course_id)]
    if not course or not batch_ids:
        return {"updated": [], "failed": []}
    return await fill_empty_invite_images(ctx, course, batch_ids, [_MEDIA_SLOTS[k][1] for k in keys])


def _invite_notes(filled: Dict[str, List[str]]) -> List[str]:
    notes = []
    if filled["updated"]:
        notes.append("These invite links had no image of their own and now show the course's: "
                     + ", ".join(filled["updated"]) + ".")
    if filled["failed"]:
        notes.append("These invite links could not be updated; set their images with course_invites_edit("
                     "update_invite, images={…: 'course'}): " + ", ".join(filled["failed"]) + ".")
    return notes


async def _action_update_media(args: Dict[str, Any], ctx: ToolContext) -> Dict[str, Any]:
    media = args.get("media")
    if not args.get("course_id") or media is None:
        return _err("missing_argument", action="update_media", needs=["course_id", "media"])
    problem = _check_media(media)
    if problem:
        return _err("invalid_media", message=problem)
    course = cbd.course_row(ctx, str(args["course_id"]))
    body = cbd.course_update_body(ctx, str(args["course_id"])) if course else None
    if not course or not body:
        return _err("unknown_course", message="No such course in this institute. Use courses(action='list').")
    columns, problem = await _resolve_media(ctx, media)
    if problem:
        return _err("invalid_media", message=problem)
    # update-course overwrites every field it is sent: the stored values go back
    # unchanged and only the media columns differ.
    body.update(columns)
    saved = await cbd.admin_core(ctx, "PUT", f"/admin-core-service/course/v1/update-course/{course['id']}", body=body)
    if cbd.is_error(saved):
        return _err("save_failed", message="The course's media could not be saved.",
                    detail=saved.get("message") if isinstance(saved, dict) else None)
    filled = await _fill_invites(ctx, course["id"], list(media))
    notes = _invite_notes(filled)
    if course["status"] == cbd.STATUS_ACTIVE:
        notes.append("The course is live: learners see the new images right away.")
    return {"course": {"id": course["id"], "name": course["name"], "status": course["status"]},
            "changed": list(media), "invites_updated": filled["updated"], "notes": notes,
            "editor_url": cbd.course_editor_url(ctx, course["id"])}


_ACTIONS = {
    "create_course": _action_create_course, "add_chapter": _action_add_chapter, "add_slide": _action_add_slide,
    "update_slide": _action_update_slide, "reorder": _action_reorder, "import_image": _action_import_image,
    "update_media": _action_update_media,
    "import_pdf": _action_import_pdf, "discard_slide": _action_discard_slide,
    "publish_slides": _action_publish_slides,
    "submit_for_review": _action_submit_for_review,
}


async def execute_course_edit(args: Dict[str, Any], ctx: ToolContext) -> str:
    action = str((args or {}).get("action") or "").strip()
    handler = _ACTIONS.get(action)
    if handler is None:
        return json.dumps(_err("unknown_action", action=action, available=list(COURSE_EDIT_ACTIONS)))
    result = await handler(args or {}, ctx)
    if isinstance(result, dict) and "action" not in result:
        result = {"action": action, **result}
    return json.dumps(result, ensure_ascii=False, default=str)


COURSE_EDIT_TOOLS: Dict[str, ToolSpec] = {
    COURSE_EDIT_TOOL_NAME: ToolSpec(
        name=COURSE_EDIT_TOOL_NAME,
        schema=COURSE_EDIT_SCHEMA,
        executor=execute_course_edit,
        required_permission=None,
        setting_key=COURSE_EDIT_GROUP_KEY,
        # Writes are never default-on: an admin opts a role in from settings.
        default_enabled=False,
        default_roles=None,
        phase=3,
        mode="WRITE",
    ),
}


def _register() -> None:
    from .assistant_tool_registry import ASSISTANT_TOOLS, GROUP_LABELS
    ASSISTANT_TOOLS.update(COURSE_EDIT_TOOLS)
    GROUP_LABELS.update({COURSE_EDIT_GROUP_KEY: "Courses: build drafts"})


_register()

__all__ = ["COURSE_EDIT_TOOLS", "COURSE_EDIT_TOOL_NAME", "COURSE_EDIT_GROUP_KEY", "COURSE_EDIT_ACTIONS",
           "COURSE_EDIT_SCHEMA", "execute_course_edit"]
