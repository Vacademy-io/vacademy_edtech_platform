"""Live AI Tutor — creation-time endpoints (design §4, build plan WP2).

Auth: JWT + clientId through get_pinned_principal on every route. The copilot's
outline/content endpoints are unauthenticated; these deliberately are not.
"""
from __future__ import annotations

import asyncio
import json
import logging
import uuid
from typing import Any, Dict, List, Optional

from fastapi import (APIRouter, BackgroundTasks, Depends, File, Form, Header, HTTPException, Query, Request,
                     Response, UploadFile, status)
from fastapi.responses import StreamingResponse
from sqlalchemy import text
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..config import Settings, get_settings
from ..core.security import get_pinned_principal
from ..db import db_dependency
from ..schemas.tutor import (
    CompileRequest, PackagePlansResponse, PlanStatusItem, RecompileOptions, SourceDescriptionRequest,
)
from ..schemas.tutor import CompileKbGrounding, CompileOptions
from ..services.tutor import plan_store
from ..services.tutor.runtime import state as sm
from ..services.tutor.runtime import session_service as svc
from ..services.tutor.plan_compiler import PlanCompiler
from ..services.tutor.roles import is_staff, normalize_roles
from ..services.tutor.insights_export import insights_csv_text
from ..services.tutor.compile_estimate import estimate_compile
from ..services.tutor.slide_source import source_kinds_for_slides
from ..services.voice_tts import (
    _EDGE_DEFAULT_VOICES, clone_voice_smallest, default_voice_for, list_cloned_voices_smallest, list_smallest_voices,
    sarvam_voice_catalogue, smallest_available,
)
from ..services.tutor.runtime.settings import TutorSettings, resolve_settings
from ..services.platform_settings_service import get_platform_setting
from ..services.tutor.slide_source import (
    list_package_slides, package_belongs_to_institute, package_of_slide, slide_belongs_to_institute,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/tutor/v1", tags=["tutor"])

_HEARTBEAT_SECONDS = 15
# Slide types the compiler handles in phase 1; quizzes compile deterministically
# and are not billed, so they are supported but not "billable".
SUPPORTED_SOURCE_TYPES = {"DOCUMENT", "QUIZ", "VIDEO", "HTML_VIDEO", "SCORM"}
# Compiles outlive the request that started them: closing the admin tab must
# not turn paid model calls into FAILED rows. Tasks are kept here so the
# event loop does not garbage-collect them mid-flight.
_BACKGROUND_COMPILES: set = set()


class Caller:
    def __init__(self, institute_id: str, user_id: Optional[str], roles: List[str], is_root: bool):
        self.institute_id = institute_id
        self.user_id = user_id
        self.roles = roles
        self.is_root = is_root


async def _caller(
    request: Request,
    authorization: Optional[str] = Header(default=None),
    settings: Settings = Depends(get_settings),
) -> Caller:
    """JWT + clientId, pinned to one institute, and STAFF ONLY: a learner's
    token is a member of the institute too, and these routes expose quiz
    answer keys and spend the institute's credits. Roles only, from the
    clientId institute's authorities entry: is_root_user is set for learners
    too and never makes a caller staff."""
    if not authorization:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED,
                            detail="Missing Authorization: Bearer <jwt> (with a clientId header)")
    principal = await get_pinned_principal(request, authorization, settings)
    roles = sorted(normalize_roles(principal.roles))
    if not is_staff(roles):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                            detail="Teaching plans are managed by institute staff (admin, teacher or content-creator roles)")
    return Caller(principal.institute_id, principal.user_id, roles, bool(principal.is_root_user))


def _sse(compiler: PlanCompiler, slide_ids: List[str]) -> StreamingResponse:
    async def event_generator():
        queue: asyncio.Queue = asyncio.Queue()
        _DONE = object()

        async def _pump():
            try:
                async for ev in compiler.compile_many(slide_ids):
                    await queue.put(("data", ev))
            except Exception as exc:  # noqa: BLE001
                await queue.put(("fatal", str(exc)))
            finally:
                await queue.put((_DONE, None))

        task = asyncio.create_task(_pump())
        _BACKGROUND_COMPILES.add(task)
        task.add_done_callback(_BACKGROUND_COMPILES.discard)
        try:
            yield f"data: {json.dumps({'type': 'INFO', 'message': f'Compiling {len(slide_ids)} slide(s)', 'total': len(slide_ids)})}\n\n"
            while True:
                try:
                    kind, val = await asyncio.wait_for(queue.get(), timeout=_HEARTBEAT_SECONDS)
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"
                    continue
                if kind is _DONE:
                    break
                if kind == "data":
                    yield f"data: {json.dumps(val, ensure_ascii=False, default=str)}\n\n"
                else:
                    yield f"data: {json.dumps({'type': 'ERROR', 'message': val})}\n\n"
            yield f"data: {json.dumps({'type': 'DONE'})}\n\n"
        finally:
            # The client went away (or DONE was sent): the pump keeps running
            # to completion in the background; its later events are dropped.
            pass

    return StreamingResponse(
        event_generator(), media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no"},
    )


def _preflight(db: Session, institute_id: str, slide_ids: List[str], p: CompileOptions, *, force: bool) -> None:
    """Refuse (402) a compile the institute cannot pay for: compile credits plus
    transcription minutes for uploaded videos. Images are not gated (capped,
    charged as delivered). An unknown balance never blocks."""
    try:
        est = estimate_compile(db, institute_id=institute_id, slide_ids=slide_ids, language=p.language,
                               generate_images=bool(p.generate_images), transcribe_videos=bool(p.transcribe_videos),
                               ocr_pdfs=bool(p.ocr_pdfs), force=force)
    except Exception:  # noqa: BLE001 — never block on a malformed estimate
        return
    if est.get("sufficient") is False:
        t = est["totals"]
        raise HTTPException(status_code=status.HTTP_402_PAYMENT_REQUIRED,
                            detail=(f"Insufficient credits: preparing {t['to_compile']} slide(s) needs ≈{t['required']:g} credits "
                                    f"({t['compile_credits']:g} to compile + {t['transcription_credits']:g} for "
                                    f"{t['transcription_minutes']} min of transcription + {t['ocr_credits']:g} for "
                                    f"{t['ocr_pages']} OCR page(s)), balance is {est['balance']:g}."))


def _compiler(db: Session, caller: Caller, package_id: str, p: CompileOptions, *, force: bool) -> PlanCompiler:
    """Course Tutor Mode settings (package → institute → platform) supply what
    the request leaves at its defaults: the compile model, the teacher's
    name, the KB grounding saved at creation, and whether images are on."""
    s: TutorSettings = resolve_settings(db, package_id=package_id, institute_id=caller.institute_id)
    fields = p.model_fields_set
    teacher = p.teacher_name if "teacher_name" in fields else (s.teacher_name or p.teacher_name)
    language = p.language if "language" in fields else s.course_language
    images = p.generate_images if "generate_images" in fields else bool(s.generate_images)
    kb, chapter_topics = _kb_for_compile(db, caller, package_id, p, s)
    # Prepared voice: the same provider / voice / pace a lesson would use.
    try:
        vp_provider = s.tts_provider or str(get_platform_setting("tutor.voice.provider", default="sarvam", db=db) or "sarvam")
        vp_voice = s.tts_voice or str(get_platform_setting("tutor.voice.voice", default="", db=db) or "")
    except Exception:  # noqa: BLE001
        vp_provider, vp_voice = s.tts_provider or "sarvam", s.tts_voice or ""
    voice_prepare = {"provider": vp_provider, "voice": vp_voice, "base_pace": float(getattr(s, "voice_pace", 1.0) or 1.0),
                     "languages": [x for x in (s.languages or ["en"]) if x in ("en", "hi")] or ["en"], "course_lang": s.course_language}
    return PlanCompiler(
        institute_id=caller.institute_id, user_id=caller.user_id, language=language,
        teacher_name=teacher, force=force, generate_images=images, kb_grounding=kb,
        compile_run_id=p.compile_run_id or str(uuid.uuid4()), model_override=s.compile_model,
        transcribe_videos=p.transcribe_videos, ocr_pdfs=p.ocr_pdfs, voice_prepare=voice_prepare,
        chapter_topics=chapter_topics,
    )


def _kb_for_compile(db: Session, caller: Caller, package_id: str, p: CompileOptions,
                    s: TutorSettings) -> tuple:
    """(kb_grounding, chapter_topics) for a compile.

    Flag off (course_knowledge.links_enabled): the request override, else the
    Tutor Mode setting's kbGrounding, and no chapter topics — exactly the old
    behaviour. Flag on: the request override, else the course's first active
    GROUNDING link used by the tutor, else the legacy setting; chapter topics
    come from the course's tutor link to whichever KB was picked (its node
    ids belong to that KB). A links read failure falls back to the flag-off
    choice."""
    override = "kb_grounding" in p.model_fields_set
    legacy = CompileKbGrounding(**s.kb_grounding) if s.kb_grounding else None
    kb = p.kb_grounding if override else legacy
    from ..services.course_knowledge import flags as ck_flags
    if not package_id or not ck_flags.links_enabled():
        return kb, None
    try:
        from ..services.course_knowledge import links as ck_links
        if not override:
            link = ck_links.tutor_grounding_link(db, caller.institute_id, package_id)
            if link:
                kb = CompileKbGrounding(knowledge_base_id=link["knowledge_base_id"], mode=link["grounding_mode"])
        chapter_topics = (ck_links.chapter_topics_for_kb(db, caller.institute_id, package_id, kb.knowledge_base_id)
                          if kb else None)
        return kb, chapter_topics
    except Exception:  # noqa: BLE001 — links are an upgrade; never block a compile on them
        logger.warning("course knowledge links unreadable for package %s", package_id, exc_info=True)
        try:
            db.rollback()
        except Exception:  # noqa: BLE001
            pass
        return (p.kb_grounding if override else legacy), None


@router.post("/compile",summary="Compile slides of a course into teaching plans (SSE)")
async def compile_plans(
    payload: CompileRequest,
    caller: Caller = Depends(_caller),
    db: Session = Depends(db_dependency),
) -> StreamingResponse:
    if not package_belongs_to_institute(db, payload.package_id, caller.institute_id):
        raise HTTPException(status_code=404, detail="Course not found in this institute")
    slide_ids = list(dict.fromkeys(payload.slide_ids))
    if not slide_ids:
        slide_ids = [s["slide_id"] for s in list_package_slides(db, payload.package_id)
                     if (s["source_type"] or "").upper() in SUPPORTED_SOURCE_TYPES]
    if not slide_ids:
        raise HTTPException(status_code=400, detail="No slides to compile")
    _preflight(db, caller.institute_id, slide_ids, payload, force=payload.force)
    compiler = _compiler(db, caller, payload.package_id, payload, force=payload.force)
    return _sse(compiler, slide_ids)


@router.post("/compile/estimate", summary="What preparing these slides will cost (no credits spent)")
def compile_estimate(
    payload: CompileRequest,
    caller: Caller = Depends(_caller),
    db: Session = Depends(db_dependency),
) -> Dict[str, Any]:
    """Per slide: up to date / needs details / will compile, compile credits,
    transcription minutes and credits for uploaded videos without a
    transcript, and the image cap. Same rules as the compile itself."""
    if not package_belongs_to_institute(db, payload.package_id, caller.institute_id):
        raise HTTPException(status_code=404, detail="Course not found in this institute")
    slide_ids = list(dict.fromkeys(payload.slide_ids))
    if not slide_ids:
        slide_ids = [s["slide_id"] for s in list_package_slides(db, payload.package_id)
                     if (s["source_type"] or "").upper() in SUPPORTED_SOURCE_TYPES]
    s = resolve_settings(db, package_id=payload.package_id, institute_id=caller.institute_id)
    fields = payload.model_fields_set
    images = payload.generate_images if "generate_images" in fields else bool(s.generate_images)
    language = payload.language if "language" in fields else s.course_language
    try:
        vp = s.tts_provider or str(get_platform_setting("tutor.voice.provider", default="sarvam", db=db) or "sarvam")
    except Exception:  # noqa: BLE001
        vp = s.tts_provider or "sarvam"
    out = estimate_compile(db, institute_id=caller.institute_id, slide_ids=slide_ids, language=language,
                           generate_images=images, transcribe_videos=payload.transcribe_videos,
                           ocr_pdfs=payload.ocr_pdfs, force=payload.force, voice_provider=vp, languages=list(s.languages or ["en"]))
    out["package_id"] = payload.package_id
    return out


@router.post("/slides/{slide_id}/recompile", summary="Recompile one slide (SSE)")
async def recompile_slide(
    slide_id: str,
    payload: Optional[RecompileOptions] = None,
    caller: Caller = Depends(_caller),
    db: Session = Depends(db_dependency),
) -> StreamingResponse:
    if not slide_belongs_to_institute(db, slide_id, caller.institute_id):
        raise HTTPException(status_code=404, detail="Slide not found in this institute")
    p = payload or RecompileOptions()
    _preflight(db, caller.institute_id, [slide_id], p, force=True)
    compiler = _compiler(db, caller, package_of_slide(db, slide_id) or "", p, force=True)
    return _sse(compiler, [slide_id])


@router.get("/packages/{package_id}/plans", response_model=PackagePlansResponse,
            summary="Teaching-plan status for every slide of a course")
def package_plans(
    package_id: str,
    caller: Caller = Depends(_caller),
    db: Session = Depends(db_dependency),
) -> PackagePlansResponse:
    """Sync handler (runs in the threadpool): three queries for the whole
    course instead of two per slide on the event loop."""
    if not package_belongs_to_institute(db, package_id, caller.institute_id):
        raise HTTPException(status_code=404, detail="Course not found in this institute")
    plan_store.retire_stuck_compiling(db)
    db.commit()
    slides = list_package_slides(db, package_id)
    ids = [s["slide_id"] for s in slides]
    newest = plan_store.latest_plans_for_slides(db, ids)
    serving = plan_store.latest_plans_for_slides(db, ids, ready_only=True)
    counts_by_plan = plan_store.counts_for_plans(db, [p.id for p in serving.values()])
    kinds = source_kinds_for_slides(db, slides)
    items: List[PlanStatusItem] = []
    counts: Dict[str, int] = {}
    for s in slides:
        st = (s["source_type"] or "").upper()
        plan = newest.get(s["slide_id"])
        serve = serving.get(s["slide_id"])
        if plan is None:
            status_ = "NOT_COMPILED" if st in SUPPORTED_SOURCE_TYPES else "UNSUPPORTED"
            item = PlanStatusItem(slide_id=s["slide_id"], slide_title=s["title"], source_type=st,
                                  chapter_id=s["chapter_id"], chapter_name=s["chapter_name"], status=status_,
                                  source_kind=kinds.get(s["slide_id"]))
        else:
            c = counts_by_plan.get(serve.id, {"topics": 0, "concepts": 0}) if serve else {"topics": 0, "concepts": 0}
            inputs = ((plan.raw_plan_json or {}).get("compile_inputs") or {}) if isinstance(plan.raw_plan_json, dict) else {}
            item = PlanStatusItem(
                slide_id=s["slide_id"], slide_title=s["title"], source_type=st,
                chapter_id=s["chapter_id"], chapter_name=s["chapter_name"],
                plan_id=plan.id, version=plan.version, status=plan.status, error=plan.error,
                serving_plan_id=serve.id if serve else None,
                topics=c["topics"], concepts=c["concepts"],
                updated_at=plan.updated_at.isoformat() if plan.updated_at else None,
                source_kind=kinds.get(s["slide_id"]), text_kind=inputs.get("text_kind"),
                quality_notes=plan_store.quality_notes_of(plan),
            )
        counts[item.status] = counts.get(item.status, 0) + 1
        items.append(item)
    return PackagePlansResponse(package_id=package_id, counts=counts, slides=items)


@router.get("/slides/{slide_id}/plan", summary="Teaching plan of a slide (preview)")
def slide_plan(
    slide_id: str,
    latest: bool = Query(default=False, description="Newest row even if not READY (default: the READY plan learners get)"),
    caller: Caller = Depends(_caller),
    db: Session = Depends(db_dependency),
) -> Dict[str, Any]:
    if not slide_belongs_to_institute(db, slide_id, caller.institute_id):
        raise HTTPException(status_code=404, detail="Slide not found in this institute")
    plan = plan_store.latest_plan(db, slide_id) if latest else (
        plan_store.latest_ready_plan(db, slide_id) or plan_store.latest_plan(db, slide_id)
    )
    if plan is None:
        raise HTTPException(status_code=404, detail="No teaching plan for this slide yet")
    return plan_store.plan_view(db, plan)


@router.put("/slides/{slide_id}/source-description", summary="Set what a video / PDF slide teaches")
async def put_source_description(
    slide_id: str,
    payload: SourceDescriptionRequest,
    caller: Caller = Depends(_caller),
    db: Session = Depends(db_dependency),
) -> Dict[str, Any]:
    if not slide_belongs_to_institute(db, slide_id, caller.institute_id):
        raise HTTPException(status_code=404, detail="Slide not found in this institute")
    plan = plan_store.set_source_description(
        db, slide_id=slide_id, institute_id=caller.institute_id,
        description=payload.description.strip(), user_id=caller.user_id,
    )
    db.commit()
    return {"slide_id": slide_id, "plan_id": plan.id, "status": plan.status}


# ── teacher insights (design WP9) ────────────────────────────────────────────

# Attempts that leave a concept weak: capped remediation, a skip, or a revisit
# that was still wrong. A correct revisit (`revisit_ok`) clears it.
_WEAK_ACTIONS = "('advance_weak', 'skipped', 'revisit_weak')"


def _num(v: Any) -> Optional[float]:
    return round(float(v), 3) if v is not None else None


# Session-average activeness (0-100) the learner's camera tracker reported;
# NULL when the learner did not turn the camera on.
_ACTIVENESS = "CASE WHEN jsonb_typeof(ts.summary_json->'activeness'->'avg') = 'number' THEN (ts.summary_json->'activeness'->>'avg')::numeric END"


def _insights(
    db: Session, *, institute_id: str, package_id: Optional[str], package_session_id: Optional[str], days: int,
    learners_limit: int = 200, concepts_limit: int = 40, courses_limit: int = 200,
) -> Dict[str, Any]:
    """Sessions, minutes and scores per course and per learner, the concepts
    learners get wrong most (with the misconceptions the teacher recorded),
    and the batches that have used the tutor — for one course or the whole
    institute. Read-only; six queries."""
    params: Dict[str, Any] = {"inst": institute_id, "days": days, "learners_limit": learners_limit,
                              "concepts_limit": concepts_limit, "courses_limit": courses_limit}
    pkg_filter = batch_filter = ""
    if package_id:
        pkg_filter = "AND ps.package_id = :pkg"
        params["pkg"] = package_id
    if package_session_id:
        batch_filter = "AND ts.package_session_id = :ps"
        params["ps"] = package_session_id
    scope = f"ts.institute_id = :inst AND ts.started_at > now() - make_interval(days => :days) {pkg_filter} {batch_filter}"
    # Institute-wide: only batches that used the tutor (a course lists all its batches).
    batches_having = "" if package_id else "HAVING COUNT(ts.id) > 0"

    batches = db.execute(text(f"""
        SELECT ps.id, COALESCE(l.level_name, '') AS level_name, COALESCE(s.session_name, '') AS session_name,
               COALESCE(p.package_name, '') AS course, COUNT(ts.id) AS sessions
        FROM package_session ps
        JOIN package p ON p.id = ps.package_id
        JOIN package_institute pi ON pi.package_id = p.id AND pi.institute_id = :inst
        LEFT JOIN level l ON l.id = ps.level_id
        LEFT JOIN session s ON s.id = ps.session_id
        LEFT JOIN tutor_session ts ON ts.package_session_id = ps.id AND ts.institute_id = :inst
             AND ts.started_at > now() - make_interval(days => :days)
        WHERE ps.status <> 'DELETED' {pkg_filter}
        GROUP BY ps.id, l.level_name, s.session_name, p.package_name
        {batches_having}
        ORDER BY sessions DESC, course, level_name
        LIMIT 100
    """), params).fetchall()

    totals = db.execute(text(f"""
        SELECT COUNT(*) AS sessions, COUNT(DISTINCT ts.user_id) AS learners,
               COALESCE(SUM(ts.minutes_billed), 0) AS minutes,
               COUNT(*) FILTER (WHERE ts.mode = 'VOICE') AS voice_sessions,
               COUNT(*) FILTER (WHERE ts.status = 'ABANDONED') AS abandoned,
               COUNT(DISTINCT ps.package_id) AS courses,
               AVG({_ACTIVENESS}) AS activeness, COUNT({_ACTIVENESS}) AS activeness_sessions
        FROM tutor_session ts
        JOIN package_session ps ON ps.id = ts.package_session_id
        WHERE {scope}
    """), params).first()

    courses = db.execute(text(f"""
        WITH s AS (
            SELECT ts.id, ts.user_id, ts.minutes_billed, ts.started_at, ps.package_id,
                   {_ACTIVENESS} AS act
            FROM tutor_session ts
            JOIN package_session ps ON ps.id = ts.package_session_id
            WHERE {scope}
        ), att AS (
            SELECT s.package_id, COUNT(*) AS attempts, AVG(a.score) AS avg_score,
                   COUNT(*) FILTER (WHERE a.action_taken IN {_WEAK_ACTIONS}) AS weak_attempts
            FROM tutor_concept_attempt a
            JOIN s ON s.id = a.tutor_session_id
            GROUP BY s.package_id
        )
        SELECT s.package_id, MAX(p.package_name) AS name, COUNT(s.id) AS sessions, COUNT(DISTINCT s.user_id) AS learners,
               COALESCE(SUM(s.minutes_billed), 0) AS minutes, COALESCE(MAX(att.attempts), 0) AS attempts,
               MAX(att.avg_score) AS avg_score, COALESCE(MAX(att.weak_attempts), 0) AS weak_attempts,
               MAX(s.started_at) AS last_active, AVG(s.act) AS activeness, COUNT(s.act) AS activeness_sessions
        FROM s
        JOIN package p ON p.id = s.package_id
        LEFT JOIN att ON att.package_id = s.package_id
        GROUP BY s.package_id
        ORDER BY sessions DESC, name
        LIMIT :courses_limit
    """), params).fetchall()

    learners = db.execute(text(f"""
        WITH s AS (
            SELECT ts.id, ts.user_id, ts.minutes_billed, ts.started_at, ps.package_id,
                   {_ACTIVENESS} AS act
            FROM tutor_session ts
            JOIN package_session ps ON ps.id = ts.package_session_id
            WHERE {scope}
        ), att AS (
            SELECT a.user_id, COUNT(*) AS attempts, AVG(a.score) AS avg_score,
                   COUNT(*) FILTER (WHERE a.action_taken IN {_WEAK_ACTIONS}) AS weak_attempts
            FROM tutor_concept_attempt a
            JOIN s ON s.id = a.tutor_session_id
            GROUP BY a.user_id
        )
        SELECT s.user_id, MAX(st.full_name) AS name, COUNT(s.id) AS sessions,
               COALESCE(SUM(s.minutes_billed), 0) AS minutes,
               COALESCE(MAX(att.attempts), 0) AS attempts, MAX(att.avg_score) AS avg_score,
               COALESCE(MAX(att.weak_attempts), 0) AS weak_attempts, MAX(s.started_at) AS last_active,
               COUNT(DISTINCT s.package_id) AS courses, AVG(s.act) AS activeness, COUNT(s.act) AS activeness_sessions
        FROM s
        LEFT JOIN att ON att.user_id = s.user_id
        LEFT JOIN student st ON st.user_id = s.user_id
        GROUP BY s.user_id
        ORDER BY last_active DESC
        LIMIT :learners_limit
    """), params).fetchall()

    # The teacher's latest note about each learner (rolling summary, model-written
    # after each session), scoped like the sessions above.
    notes: Dict[str, Optional[str]] = {}
    ids = [r[0] for r in learners]
    if ids:
        note_scope = ""
        if package_session_id:
            note_scope = "AND st.package_session_id = :ps"
        elif package_id:
            note_scope = "AND st.package_session_id IN (SELECT id FROM package_session WHERE package_id = :pkg)"
        for uid, summary in db.execute(text(f"""
            SELECT DISTINCT ON (st.user_id) st.user_id, st.rolling_summary
            FROM tutor_learner_state st
            WHERE st.institute_id = :inst AND st.user_id = ANY(:ids) {note_scope}
            ORDER BY st.user_id, st.updated_at DESC
        """), {**params, "ids": ids}).fetchall():
            notes[uid] = (summary or "").strip() or None

    concepts = db.execute(text(f"""
        SELECT c.id, c.title AS concept, t.title AS topic, sl.title AS slide, sl.id AS slide_id,
               MAX(p.package_name) AS course,
               COUNT(a.id) AS attempts, COUNT(DISTINCT a.user_id) AS learners,
               AVG(a.score) AS avg_score,
               COUNT(a.id) FILTER (WHERE a.action_taken IN {_WEAK_ACTIONS}) AS weak_attempts,
               COUNT(DISTINCT a.user_id) FILTER (WHERE a.action_taken IN {_WEAK_ACTIONS}) AS weak_learners,
               COUNT(DISTINCT a.user_id) FILTER (WHERE a.action_taken = 'revisit_ok') AS cleared_learners,
               (ARRAY_AGG(a.misconception ORDER BY a.created_at DESC) FILTER (WHERE a.misconception IS NOT NULL AND a.misconception <> ''))[1:3] AS misconceptions
        FROM tutor_concept_attempt a
        JOIN tutor_session ts ON ts.id = a.tutor_session_id
        JOIN package_session ps ON ps.id = ts.package_session_id
        JOIN package p ON p.id = ps.package_id
        JOIN teaching_concept c ON c.id = a.concept_id
        JOIN teaching_topic t ON t.id = c.topic_id
        JOIN slide sl ON sl.id = t.slide_id
        WHERE {scope}
        GROUP BY c.id, c.title, t.title, sl.title, sl.id
        HAVING COUNT(a.id) > 0
        ORDER BY weak_learners DESC, avg_score ASC NULLS LAST, attempts DESC
        LIMIT :concepts_limit
    """), params).fetchall()

    return {
        "package_id": package_id, "package_session_id": package_session_id, "days": days,
        "batches": [{"package_session_id": b[0], "name": (" · ".join(x for x in (b[1], b[2]) if x) or "Batch"),
                     "course": b[3], "sessions": int(b[4] or 0)} for b in batches],
        "totals": {"sessions": int(totals[0] or 0), "learners": int(totals[1] or 0), "minutes": int(totals[2] or 0),
                   "voice_sessions": int(totals[3] or 0), "abandoned": int(totals[4] or 0),
                   "courses": int(totals[5] or 0), "activeness": _num(totals[6]),
                   "activeness_sessions": int(totals[7] or 0)} if totals else {},
        "courses": [{"package_id": r[0], "name": r[1], "sessions": int(r[2] or 0), "learners": int(r[3] or 0),
                     "minutes": int(r[4] or 0), "attempts": int(r[5] or 0), "avg_score": _num(r[6]),
                     "weak_attempts": int(r[7] or 0), "last_active": r[8].isoformat() if r[8] else None,
                     "activeness": _num(r[9]), "activeness_sessions": int(r[10] or 0)}
                    for r in courses],
        "learners": [{"user_id": r[0], "name": (r[1] or "").strip() or None, "sessions": int(r[2] or 0),
                      "minutes": int(r[3] or 0), "attempts": int(r[4] or 0), "avg_score": _num(r[5]),
                      "weak_attempts": int(r[6] or 0), "last_active": r[7].isoformat() if r[7] else None,
                      "courses": int(r[8] or 0), "note": notes.get(r[0]),
                      "activeness": _num(r[9]), "activeness_sessions": int(r[10] or 0)}
                     for r in learners],
        "concepts": [{"concept_id": r[0], "concept": r[1], "topic": r[2], "slide": r[3], "slide_id": r[4], "course": r[5],
                      "attempts": int(r[6] or 0), "learners": int(r[7] or 0), "avg_score": _num(r[8]),
                      "weak_attempts": int(r[9] or 0), "weak_learners": int(r[10] or 0), "cleared_learners": int(r[11] or 0),
                      "misconceptions": list(r[12] or [])} for r in concepts],
    }


@router.get("/packages/{package_id}/insights", summary="What the tutor learned about this course's learners")
def package_insights(
    package_id: str,
    package_session_id: Optional[str] = Query(default=None, description="One batch; default every batch of the course"),
    days: int = Query(default=90, ge=1, le=365),
    caller: Caller = Depends(_caller),
    db: Session = Depends(db_dependency),
) -> Dict[str, Any]:
    if not package_belongs_to_institute(db, package_id, caller.institute_id):
        raise HTTPException(status_code=404, detail="Course not found in this institute")
    return _insights(db, institute_id=caller.institute_id, package_id=package_id, package_session_id=package_session_id, days=days)


@router.get("/insights", summary="What the tutor learned across the institute (optionally one course / batch)")
def institute_insights(
    package_id: Optional[str] = Query(default=None),
    package_session_id: Optional[str] = Query(default=None),
    days: int = Query(default=90, ge=1, le=365),
    caller: Caller = Depends(_caller),
    db: Session = Depends(db_dependency),
) -> Dict[str, Any]:
    if package_id and not package_belongs_to_institute(db, package_id, caller.institute_id):
        raise HTTPException(status_code=404, detail="Course not found in this institute")
    return _insights(db, institute_id=caller.institute_id, package_id=package_id, package_session_id=package_session_id, days=days)


@router.get("/insights/export.csv", summary="Insights as a CSV file: learners, concepts or courses")
def insights_csv(
    sheet: str = Query(default="learners", pattern=r"^(learners|concepts|courses)$"),
    package_id: Optional[str] = Query(default=None),
    package_session_id: Optional[str] = Query(default=None),
    days: int = Query(default=90, ge=1, le=365),
    caller: Caller = Depends(_caller),
    db: Session = Depends(db_dependency),
) -> Response:
    if package_id and not package_belongs_to_institute(db, package_id, caller.institute_id):
        raise HTTPException(status_code=404, detail="Course not found in this institute")
    data = _insights(db, institute_id=caller.institute_id, package_id=package_id, package_session_id=package_session_id,
                     days=days, learners_limit=5000, concepts_limit=2000, courses_limit=500)
    body = insights_csv_text(data, sheet)
    filename = f"tutor-insights-{sheet}-{days}d.csv"
    return Response(content=body, media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="{filename}"'})


# ── option catalogues for the Tutor Mode settings cards ──────────────────────

def _one_time_fees(db: Session) -> Dict[str, float]:
    from ..services.tool_cost_estimator import ToolCostEstimator
    from ..services.tutor import asset_registry
    try:
        pricing = ToolCostEstimator(db).get_tool_pricing()
        return {"voice": float(pricing.get(asset_registry.VOICE_CLONE_TOOL, {}).get("flat_base_credits") or 0),
                "avatar": float(pricing.get(asset_registry.AVATAR_CREATE_TOOL, {}).get("flat_base_credits") or 0),
                "avatar_minute": float(pricing.get("tutor_avatar_minute", {}).get("per_unit_credits") or 0),
                "live_minute": float(pricing.get("tutor_live_minute", {}).get("per_unit_credits") or 0)}
    except Exception:  # noqa: BLE001
        return {"voice": 0.0, "avatar": 0.0, "avatar_minute": 0.0, "live_minute": 0.0}


def _voice_option(a: Dict[str, Any]) -> Dict[str, Any]:
    return {"id": a["external_id"], "name": a["display_name"] + ("" if a["stock"] else " (your voice)"),
            "gender": a.get("gender"), "languages": a.get("languages") or [], "cloned": not a["stock"],
            "stock": a["stock"], "asset_id": a["id"]}


@router.get("/options", summary="Voices per provider and models for the Tutor Mode settings dropdowns")
async def tutor_options(
    caller: Caller = Depends(_caller),
    db: Session = Depends(db_dependency),
) -> Dict[str, Any]:
    """Voices: each provider's stock catalogue plus the registry rows the
    caller may see (platform stock + its own clones). Other institutes'
    clones are never listed. Avatars come only from the registry."""
    from ..services import spatius_service
    from ..services.tutor import asset_registry
    voices: Dict[str, List[Dict[str, Any]]] = {"sarvam": sarvam_voice_catalogue(), "google": [], "edge": [], "smallest": []}
    for lang, vid in _EDGE_DEFAULT_VOICES.items():
        voices["edge"].append({"id": vid, "name": vid.split("-")[-1].replace("Neural", ""), "gender": "female", "languages": [lang]})
    for lang in ("en-IN", "hi-IN"):
        voices["google"].append({"id": default_voice_for("google", lang), "name": f"Chirp3-HD Achird ({lang})",
                                 "gender": "female", "languages": [lang]})
    if smallest_available():
        try:
            voices["smallest"] = await list_smallest_voices()
        except Exception as e:  # noqa: BLE001
            logger.warning("Smallest voice catalogue unavailable: %s", e)
    assets = asset_registry.visible(db, institute_id=caller.institute_id)
    registered_voices = [a for a in assets if a["kind"] == "voice" and a["status"] == "ready" and a["external_id"]]
    for a in reversed(registered_voices):
        bucket = voices.setdefault(a["provider"], [])
        bucket[:] = [v for v in bucket if v.get("id") != a["external_id"]]
        bucket.insert(0, _voice_option(a))
    avatars = [a for a in assets if a["kind"] == "avatar"]
    rows = db.execute(text("""
        SELECT model_id, name, provider, tier, COALESCE(is_free, FALSE)
        FROM ai_models
        WHERE is_active = TRUE AND category NOT IN ('embedding', 'image', 'tts', 'video')
        ORDER BY display_order, provider, name
    """)).fetchall()
    models = [{"model_id": r[0], "name": r[1], "provider": r[2], "tier": r[3], "is_free": bool(r[4])} for r in rows]
    return {"voices": voices, "models": models, "smallest_available": smallest_available(),
            "avatar_available": spatius_service.available(), "avatar_provider": "spatius" if spatius_service.available() else None,
            "avatars": avatars, "fees": _one_time_fees(db)}


# ── public 3-minute demo (tutezy.ai; no auth) ────────────────────────────────

class DemoStartRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=80)
    topic_key: str = Field(..., min_length=1, max_length=64)
    language: Optional[str] = Field(default=None, pattern="^(en|hi)$")
    mode: str = Field(default="VOICE", pattern="^(VOICE|TEXT)$")


@router.get("/demo/topics", summary="Public: topics the free 3-minute lesson can teach")
def demo_topics(db: Session = Depends(db_dependency)) -> Dict[str, Any]:
    from ..services.tutor import demo
    return demo.public_topics(db)


@router.post("/demo/start", summary="Public: start a free, short, unbilled lesson as a guest")
def demo_start(payload: DemoStartRequest, request: Request, background: BackgroundTasks,
               db: Session = Depends(db_dependency)) -> Dict[str, Any]:
    from ..services import spatius_service
    from ..services.tutor import demo
    c = demo.config(db)
    pub = demo.public_topics(db)
    if not pub["enabled"]:
        raise HTTPException(status_code=503, detail="The free lesson is not available right now. Book a demo instead.")
    # Look up among every startable topic, not just the listed ones: an unlisted topic
    # (a prospect's own chapter) is reachable only by its direct link.
    topic = demo.topic_by_key(demo.startable_topics(db), payload.topic_key)
    if not topic:
        raise HTTPException(status_code=404, detail="Unknown topic")
    topic = {**topic, "slide_id": demo.slide_id_for(topic["key"])}
    ip = demo.client_ip(request)
    iph = demo.ip_hash(ip)
    reason = demo.grant_allowed(db, iph=iph, per_ip_per_day=c["per_ip_per_day"], daily_cap=c["daily_cap"])
    if reason:
        raise HTTPException(status_code=429, detail=reason)
    name = demo.sanitize_name(payload.name)
    user_id = demo.guest_user_id()
    try:
        boot = svc.start_session(user_id=user_id, institute_id=c["institute_id"], package_session_id=c["package_session_id"] or "demo",
                                 slide_id=str(topic["slide_id"]), mode=payload.mode,
                                 language=payload.language or topic.get("language") or "en",
                                 guest={"name": name, "minutes": c["minutes"]})
    except (PermissionError, LookupError, ValueError) as e:
        logger.warning("demo start failed for topic %s: %s", payload.topic_key, e)
        raise HTTPException(status_code=503, detail="The free lesson is not ready right now. Book a demo instead.")
    demo.record_grant(db, iph=iph, name=name, topic_key=payload.topic_key, tutor_session_id=boot["tutor_session_id"],
                      user_agent=request.headers.get("user-agent") or "")
    lesson: sm.LessonPlan = boot["lesson"]
    settings: TutorSettings = boot["settings"]
    token = demo.mint_guest_token(user_id=user_id, tutor_session_id=boot["tutor_session_id"], institute_id=c["institute_id"])
    logger.info("demo lesson %s started (topic %s, ip %s…)", boot["tutor_session_id"], payload.topic_key, iph[:8])
    # The teacher's face, and a token warmed while the browser is still
    # downloading the SDK — minting costs 1-9 s at the vendor.
    avatar_info = ({"provider": "spatius", "avatar_id": settings.avatar_id, "app_id": spatius_service.app_id()}
                   if settings.avatar_provider == "spatius" and settings.avatar_id and spatius_service.available()
                   and payload.mode == "VOICE" else None)
    if avatar_info:
        background.add_task(spatius_service.warm_session_token)
    return {
        "token": token,
        "minutes": c["minutes"],
        "boot": {
            "tutor_session_id": boot["tutor_session_id"],
            "slide_id": lesson.slide_id,
            "slide_title": lesson.slide_title,
            "language": boot["language"],
            "languages": [x for x in (settings.languages or ["en"]) if x in ("en", "hi")] or ["en"],
            "resumed": False,
            "teacher_name": c["teacher_name"] or settings.teacher_name,
            "teacher_avatar_file_id": settings.teacher_avatar_file_id,
            "learner_name": name,
            "topics": [{"id": t.id, "title": t.title, "concepts": len(t.concepts)} for t in lesson.topics],
            "progress": boot["pointer"].progress(lesson),
            "socket_path": f"/tutor/ws/{boot['tutor_session_id']}",
            # Premium avatar of the demo institute, in voice lessons (unbilled like the rest).
            "avatar": (avatar_info if avatar_info else None),
        },
    }


class DemoAvatarTokenRequest(BaseModel):
    tutor_session_id: str = Field(..., min_length=1, max_length=64)


@router.post("/demo/avatar-token", summary="Public: Spatius session token for a guest lesson (guest JWT in Authorization)")
async def demo_avatar_token(payload: DemoAvatarTokenRequest, authorization: Optional[str] = Header(default=None),
                            db: Session = Depends(db_dependency)) -> Dict[str, Any]:
    from ..core.security import decode_access_token
    from ..models.tutor_runtime import TutorSession
    from ..services import spatius_service
    from ..services.tutor import demo
    token = (authorization or "").replace("Bearer", "").strip()
    claims = decode_access_token(token) if token else None
    if not claims or str(claims.get("demo") or "") != payload.tutor_session_id:
        raise HTTPException(status_code=401, detail="Guest token required")
    ts = db.get(TutorSession, payload.tutor_session_id)
    if ts is None or ts.status != "ACTIVE" or ts.user_id != str(claims.get("user") or ""):
        raise HTTPException(status_code=404, detail="Session not found")
    c = demo.config(db)
    pkg = svc.package_of_session(db, ts.package_session_id)
    s = resolve_settings(db, package_id=pkg[0] if pkg else "", institute_id=c["institute_id"] or ts.institute_id)
    if not (s.avatar_provider == "spatius" and s.avatar_id and spatius_service.available()):
        raise HTTPException(status_code=404, detail="This lesson has no teacher avatar")
    try:
        tok = await spatius_service.mint_session_token()
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e))
    return {**tok, "avatar_id": s.avatar_id, "provider": "spatius"}


# ── registered assets (voices + avatars the institute may use) ───────────────

@router.get("/assets", summary="Voices and avatars this institute may use (platform stock + its own)")
def list_assets(kind: Optional[str] = Query(default=None, pattern="^(voice|avatar)$"),
                caller: Caller = Depends(_caller), db: Session = Depends(db_dependency)) -> Dict[str, Any]:
    from ..services.tutor import asset_registry
    return {"assets": asset_registry.visible(db, institute_id=caller.institute_id, kind=kind), "fees": _one_time_fees(db)}


@router.delete("/assets/{asset_id}", summary="Stop using one of this institute's own voices or avatars")
def disable_asset(asset_id: str, caller: Caller = Depends(_caller), db: Session = Depends(db_dependency)) -> Dict[str, Any]:
    from ..services.tutor import asset_registry
    row = asset_registry.get(db, asset_id)
    if not row or row["institute_id"] != caller.institute_id:
        raise HTTPException(status_code=404, detail="Asset not found")
    return asset_registry.update(db, asset_id, status="disabled") or {}


# ── teacher avatar (Spatius, premium) ────────────────────────────────────────

class AvatarCreateRequest(BaseModel):
    # Media file id of the teacher's face photo (the Tutor Mode face field).
    file_id: str = Field(..., min_length=1, max_length=255)
    name: Optional[str] = Field(default=None, max_length=80)
    # The institute confirms it holds the person's consent to animate their likeness.
    consent: bool = False


def _avatar_status(row: Dict[str, Any]) -> Dict[str, Any]:
    return {"asset_id": row["id"], "status": row["status"], "avatar_id": row.get("external_id") if row["status"] == "ready" else None,
            "error": row.get("error"), "provider": row["provider"], "display_name": row["display_name"],
            "credits_charged": row.get("credits_charged") or 0, "created_at": row.get("created_at")}


@router.post("/avatar/create", summary="Request a custom teacher avatar from the teacher's face photo")
async def avatar_create(payload: AvatarCreateRequest, caller: Caller = Depends(_caller),
                        db: Session = Depends(db_dependency)) -> Dict[str, Any]:
    """Registers the request for this institute. When the vendor's creation
    API is enabled it runs at once; otherwise the request waits for a super
    admin to build it in Spatius Studio and paste the avatar id. The one-time
    fee is charged when the avatar is ready."""
    from ..services import spatius_service
    from ..services.media_file_client import get_public_file_url
    from ..services.tutor import asset_registry
    if not spatius_service.available():
        raise HTTPException(status_code=503, detail="The teacher avatar is not configured on this server")
    if not payload.consent:
        raise HTTPException(status_code=400, detail="Confirm that the teacher has consented to an animated likeness")
    pending = [a for a in asset_registry.visible(db, institute_id=caller.institute_id, kind="avatar")
               if not a["stock"] and a["status"] in ("requested", "processing")]
    if pending:
        return _avatar_status(pending[0])
    try:
        url = await get_public_file_url(payload.file_id)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"The face photo could not be resolved: {e}")
    row = asset_registry.create(db, kind="avatar", provider="spatius", display_name=(payload.name or "Teacher").strip()[:120],
                                institute_id=caller.institute_id, status="requested", source_file_id=payload.file_id,
                                consent=True, requested_by=caller.user_id, notes=url[:1000])
    try:
        job = await spatius_service.create_avatar(url, name=payload.name)
        row = asset_registry.update(db, row["id"], status="processing", vendor_job_id=str(job.get("job_id") or "")) or row
    except RuntimeError as e:
        # Typically "Open API access is not configured": the request waits in the super-admin queue.
        logger.info("Avatar request %s for institute %s queued for manual fulfilment: %s", row["id"], caller.institute_id, e)
    return _avatar_status(row)


@router.get("/avatar/assets/{asset_id}", summary="Status of a custom avatar request")
async def avatar_request_status(asset_id: str, caller: Caller = Depends(_caller),
                                db: Session = Depends(db_dependency)) -> Dict[str, Any]:
    from ..services import spatius_service
    from ..services.tutor import asset_registry
    row = asset_registry.get(db, asset_id)
    if not row or row["institute_id"] != caller.institute_id or row["kind"] != "avatar":
        raise HTTPException(status_code=404, detail="Avatar request not found")
    if row["status"] == "processing" and row.get("vendor_job_id") and spatius_service.available():
        try:
            job = await spatius_service.avatar_job(row["vendor_job_id"])
            if job.get("status") == "succeeded" and job.get("avatar_id"):
                row = asset_registry.update(db, asset_id, status="ready", external_id=str(job["avatar_id"])) or row
                asset_registry.charge_one_time(db, asset=row, tool_key=asset_registry.AVATAR_CREATE_TOOL,
                                               model="spatius-avatar", user_id=caller.user_id)
                row = asset_registry.get(db, asset_id) or row
            elif job.get("status") == "failed":
                row = asset_registry.update(db, asset_id, status="failed", error=str(job.get("error") or "The vendor could not build the avatar")) or row
        except RuntimeError as e:
            logger.warning("avatar job poll failed for %s: %s", asset_id, e)
    return _avatar_status(row)


# (tool pricing lives in super_admin.py — see /super-admin/v1/tool-pricing)

# ── teacher voice (Smallest.ai instant clone) ─────────────────────────────────

_CLONE_MAX_BYTES = 5 * 1024 * 1024


@router.post("/voice/clone", summary="Clone a teacher's voice from a 5-15 s sample (Smallest.ai)")
async def clone_voice(
    file: UploadFile = File(...),
    display_name: str = Form(..., min_length=1, max_length=80),
    language: Optional[str] = Form(default=None),
    consent: bool = Form(default=True),
    caller: Caller = Depends(_caller),
    db: Session = Depends(db_dependency),
) -> Dict[str, Any]:
    """Returns the new voice id, registered to this institute (nobody else
    sees it), and charges the one-time fee. Consent: the institute confirms
    it holds the speaker's permission."""
    from ..services.tutor import asset_registry
    if not smallest_available():
        raise HTTPException(status_code=503, detail="Voice cloning is not configured on this server")
    if not consent:
        raise HTTPException(status_code=400, detail="Confirm that the speaker has consented to a cloned voice")
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty audio file")
    if len(data) > _CLONE_MAX_BYTES:
        raise HTTPException(status_code=413, detail="Sample must be under 5 MB (5-15 seconds of clean speech)")
    try:
        result = await clone_voice_smallest(audio=data, filename=file.filename or "sample.wav",
                                            display_name=display_name, language=language)
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e))
    row = asset_registry.create(db, kind="voice", provider="smallest", external_id=result["voice_id"],
                                display_name=display_name.strip(), institute_id=caller.institute_id, status="ready",
                                languages=[language] if language else None, consent=True, requested_by=caller.user_id)
    charged = 0.0
    try:
        charged = float(asset_registry.charge_one_time(db, asset=row, tool_key=asset_registry.VOICE_CLONE_TOOL,
                                                       model="smallest-clone", user_id=caller.user_id))
    except Exception as e:  # noqa: BLE001
        logger.warning("voice clone charge failed for %s: %s", row["id"], e)
    logger.info("Voice cloned for institute %s by %s: %s (asset %s, %s credits)", caller.institute_id, caller.user_id,
                result["voice_id"], row["id"], charged)
    return {"voice_id": result["voice_id"], "provider": "smallest", "display_name": display_name,
            "asset_id": row["id"], "credits_charged": charged}


@router.get("/voice/clones", summary="This institute's cloned voices")
async def cloned_voices(caller: Caller = Depends(_caller), db: Session = Depends(db_dependency)) -> Dict[str, Any]:
    from ..services.tutor import asset_registry
    rows = [a for a in asset_registry.visible(db, institute_id=caller.institute_id, kind="voice") if not a["stock"]]
    return {"available": smallest_available(), "voices": [
        {"voice_id": a["external_id"], "name": a["display_name"], "status": a["status"], "asset_id": a["id"],
         "provider": a["provider"]} for a in rows
    ]}


__all__ = ["router"]
