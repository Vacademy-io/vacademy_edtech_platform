"""LMS AI Video (Phase 1): teachers generate an AI video slide from the chapter view.

Auth: JWT + clientId through get_pinned_principal (pinned to one institute) and an
institute STAFF role (services/tutor/roles.py). Every video-id route requires
``extra_metadata.institute_id`` to equal the caller's institute (404 otherwise —
stricter than the external API, which lets unstamped legacy rows through).

The server owns the format → VideoGenerationRequest mapping (FORMATS below); the
dashboard sends only ``format``. Generation reuses the external router's
background runner (refund-on-exception, cancel registry) and pre-flight
(CreditService.check_video_tier_credits with the estimator's selections).
Per-institute limits come from the AI_VIDEO_POLICY setting
(services/ai_video_policy_service.py).

Errors: 403 {detail, code} for policy blocks, 402 {detail, code:
"INSUFFICIENT_CREDITS", required, balance}, 422 {detail, code} for requests the
format cannot run (e.g. lesson_teacher without a teacher).
"""
from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, List, Literal, Optional, Tuple
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from sqlalchemy.orm import Session

from ..core.security import get_pinned_principal
from ..db import db_dependency, db_session as make_db_session
from ..repositories.ai_video_repository import AiVideoRepository
from ..schemas.auth import PinnedPrincipal
from ..schemas.video_generation import LessonConfig, ReferenceFileItem, VideoGenerationRequest
from ..services import ai_video_policy_service as policy_svc
from ..services.tutor.roles import is_staff, normalize_roles
from . import external_video_generation as ext

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/lms-video/v1", tags=["lms-ai-video"])

# Studio default: the HTML timeline is the playable video.
TARGET_STAGE = "HTML"
SOURCE_TEXT_CAP = 20_000
MAX_SOURCE_SLIDES = 20
MAX_REFERENCE_FILES = 10
# How long /generate waits for the background run to create the video row
# (it validates the lesson + creates the row before any pipeline work).
READY_TIMEOUT_SECONDS = 20.0
TERMINAL_STATUSES = ("COMPLETED", "FAILED", "CANCELLED")
NOTIFY_SOURCE = "lms_ai_video"

Format = Literal["lesson_teacher", "board_explainer", "problem_walkthrough", "quick_concept",
                 "revision_short", "storybook", "conversation", "code_lesson"]
Duration = Literal["1-2 minutes", "2-3 minutes", "3-5 minutes", "5-8 minutes"]
Quality = Literal["standard", "premium", "ultra"]
Layout = Literal["auto", "corner", "bubble", "side", "presenter", "board"]


# ── request ──────────────────────────────────────────────────────────────────

class LmsTeacher(BaseModel):
    avatar_id: str = Field(..., min_length=8, max_length=160)
    name: Optional[str] = Field(default=None, max_length=60)
    title: Optional[str] = Field(default=None, max_length=60)


class LmsReferenceFile(BaseModel):
    # Pre-signed S3 URLs (media-service get-public-url) run long.
    url: str = Field(..., min_length=1, max_length=4096)
    name: str = Field(..., min_length=1, max_length=255)
    type: Literal["pdf", "image"]


class LmsContext(BaseModel):
    model_config = ConfigDict(extra="ignore")
    course_id: Optional[str] = Field(default=None, max_length=255)
    subject_id: Optional[str] = Field(default=None, max_length=255)
    module_id: Optional[str] = Field(default=None, max_length=255)
    chapter_id: Optional[str] = Field(default=None, max_length=255)
    chapter_name: Optional[str] = Field(default=None, max_length=500)
    package_session_id: Optional[str] = Field(default=None, max_length=255)


class LmsVideoRequest(BaseModel):
    topic: str = Field(..., min_length=1, max_length=500)
    objectives: Optional[str] = Field(default=None, max_length=2000)
    audience: Optional[str] = Field(default=None, max_length=200)
    notes: Optional[str] = Field(default=None, max_length=8000)
    language: str = Field(default="English", min_length=1, max_length=60)
    format: Format
    # None → the format's default length.
    duration: Optional[Duration] = None
    quality: Quality = "standard"
    # None → the format's default orientation.
    orientation: Optional[Literal["landscape", "portrait"]] = None
    teacher: Optional[LmsTeacher] = None
    layout: Optional[Layout] = None
    voice_gender: Optional[Literal["female", "male"]] = None
    voice_id: Optional[str] = Field(default=None, max_length=120)
    include_worked_example: Optional[bool] = None
    include_recap: Optional[bool] = None
    subject: Optional[str] = Field(default=None, max_length=80)
    captions_enabled: bool = True
    background_music_enabled: Optional[bool] = None
    source_slide_ids: List[str] = Field(default_factory=list, max_length=MAX_SOURCE_SLIDES)
    reference_files: List[LmsReferenceFile] = Field(default_factory=list, max_length=MAX_REFERENCE_FILES)
    context: Optional[LmsContext] = None


# ── format → VideoGenerationRequest ──────────────────────────────────────────

@dataclass(frozen=True)
class FormatSpec:
    lesson: bool
    teacher: str                      # "required" | "optional" | "none"
    orientation: str = "landscape"
    duration: str = "2-3 minutes"
    worked_example: bool = True       # default when the request leaves it unset
    force_worked_example: bool = False
    recap: bool = True
    code_editor: bool = False
    brief: str = ""


FORMATS: Dict[str, FormatSpec] = {
    "lesson_teacher": FormatSpec(
        lesson=True, teacher="required",
        brief=("Teach this as a clear classroom lesson, explained by the teacher beside the board: "
               "a short hook, the core ideas built up step by step, one worked example, and a quick recap."),
    ),
    "board_explainer": FormatSpec(
        lesson=True, teacher="none",
        brief=("Explain this at the board the way a great teacher derives it: build every idea, equation "
               "and diagram progressively on screen, one step at a time, saying why each step follows."),
    ),
    "problem_walkthrough": FormatSpec(
        lesson=True, teacher="optional", force_worked_example=True,
        brief=("Solve one representative exam-style problem on this topic step by step on the board "
               "(use the problem from the teacher's notes if there is one): state the problem, the approach, "
               "every step with its reasoning, the final answer, and the most common mistake to avoid."),
    ),
    "quick_concept": FormatSpec(
        lesson=True, teacher="none", duration="1-2 minutes", worked_example=False,
        brief=("A focused micro-lesson on ONE core idea: what it is, why it matters, one quick example, "
               "and a one-line takeaway. No digressions."),
    ),
    "revision_short": FormatSpec(
        lesson=True, teacher="none", orientation="portrait", duration="1-2 minutes", worked_example=False,
        brief=("A fast revision short for phone viewers: the key points, formulas and facts to remember as "
               "crisp, punchy beats, ending with a quick recap of everything to remember."),
    ),
    "storybook": FormatSpec(
        lesson=False, teacher="none",
        brief=("Tell this as an engaging illustrated story for young learners: friendly characters, simple "
               "words, a clear beginning, middle and end, with the lesson woven into the story. End by "
               "saying what we learned."),
    ),
    "conversation": FormatSpec(
        lesson=False, teacher="none",
        brief=("Present this as a natural conversation between two people (for example a learner and a "
               "coach). The narration alternates between them and names who is speaking, modelling real "
               "phrases and responses the viewer can reuse. Close with a recap of the key phrases."),
    ),
    "code_lesson": FormatSpec(
        lesson=True, teacher="none", code_editor=True,
        brief=("A programming walkthrough: explain the concept, then build the code step by step on screen "
               "in short, syntax-highlighted snippets, explaining each line, show the output, and point out "
               "common bugs. Keep every code example short and runnable."),
    ),
}

TEACHER_LAYOUT_DEFAULT = "corner"


@dataclass
class FormatPlan:
    format: str
    duration: str
    orientation: str
    lesson: Optional[Dict[str, Any]]           # LessonConfig dump, or None
    teacher_used: bool
    code_editor: bool
    warnings: List[str] = field(default_factory=list)
    error: Optional[Tuple[str, str]] = None    # (code, detail) → 422


def resolve_format(req: LmsVideoRequest) -> FormatPlan:
    spec = FORMATS[req.format]
    warnings: List[str] = []
    duration = req.duration or spec.duration
    orientation = req.orientation or spec.orientation
    teacher = req.teacher if spec.teacher in ("required", "optional") else None
    if req.teacher is not None and spec.teacher == "none":
        warnings.append("This format has no on-screen teacher, so the selected teacher is not used.")
    error = None
    if spec.teacher == "required" and teacher is None:
        error = ("TEACHER_REQUIRED", "Pick a teacher for a lesson with a teacher, or choose the Board explainer format.")

    lesson: Optional[Dict[str, Any]] = None
    if spec.lesson:
        if teacher is not None:
            layout = req.layout or TEACHER_LAYOUT_DEFAULT
        else:
            layout = "board"
        worked = True if spec.force_worked_example else (
            req.include_worked_example if req.include_worked_example is not None else spec.worked_example)
        recap = req.include_recap if req.include_recap is not None else spec.recap
        lesson = LessonConfig(
            enabled=True,
            teacher=(teacher.model_dump() if teacher is not None else None),
            layout=layout,
            subject=(req.subject or None),
            include_worked_example=worked,
            include_recap=recap,
        ).model_dump()
    return FormatPlan(
        format=req.format, duration=duration, orientation=orientation, lesson=lesson,
        teacher_used=teacher is not None, code_editor=spec.code_editor, warnings=warnings, error=error,
    )


def build_prompt(req: LmsVideoRequest, plan: FormatPlan, source_text: str = "") -> str:
    spec = FORMATS[req.format]
    parts = [spec.brief, "", f"Topic: {req.topic.strip()}"]
    if req.objectives and req.objectives.strip():
        parts.append(f"Learning objectives: {req.objectives.strip()}")
    if req.audience and req.audience.strip():
        parts.append(f"Audience: {req.audience.strip()}")
    if req.subject and req.subject.strip():
        parts.append(f"Subject: {req.subject.strip()}")
    if req.context and req.context.chapter_name:
        parts.append(f"Chapter: {req.context.chapter_name.strip()}")
    if plan.lesson is not None:
        lesson = plan.lesson
        if not lesson.get("include_worked_example", True):
            parts.append("Skip the worked example; keep it short.")
        if not lesson.get("include_recap", True):
            parts.append("No recap section.")
    if req.notes and req.notes.strip():
        parts += ["", "Teacher's notes (follow them):", req.notes.strip()]
    if source_text:
        parts += ["", "Source material from this chapter (ground the video in it and do not contradict it):",
                  source_text]
    return "\n".join(parts).strip()


def _tts_provider(req: LmsVideoRequest) -> str:
    """Edge voices (…Neural) are the free standard tier; any other voice id is a
    premium (Sarvam / Google) voice. Without a voice: premium for Premium/Best."""
    if req.voice_id:
        return "standard" if req.voice_id.strip().endswith("Neural") else "premium"
    return "standard" if req.quality == "standard" else "premium"


def build_video_request(
    req: LmsVideoRequest,
    plan: FormatPlan,
    prompt: str,
    *,
    video_id: str,
    institute_id: str,
    user_id: Optional[str],
) -> VideoGenerationRequest:
    return VideoGenerationRequest(
        prompt=prompt,
        content_type="VIDEO",
        language=req.language,
        captions_enabled=req.captions_enabled,
        video_id=video_id,
        target_audience=(req.audience.strip() if req.audience and req.audience.strip() else "General/Adult"),
        target_duration=plan.duration,
        institute_id=institute_id,
        user_id=user_id,
        quality_tier=req.quality,
        voice_gender=req.voice_gender or "female",
        tts_provider=_tts_provider(req),
        voice_id=req.voice_id or None,
        reference_files=[ReferenceFileItem(**rf.model_dump()) for rf in req.reference_files] or None,
        orientation=plan.orientation,
        background_music_enabled=req.background_music_enabled,
        lesson=(LessonConfig(**plan.lesson) if plan.lesson is not None else None),
    )


def estimate_params_for(video_req: VideoGenerationRequest) -> Dict[str, Any]:
    dump = video_req.model_dump()
    return ext._video_estimate_params(dump, host=dump.get("host"), lesson=dump.get("lesson"))


# ── auth / tenancy ───────────────────────────────────────────────────────────

async def _staff_principal(principal: PinnedPrincipal = Depends(get_pinned_principal)) -> PinnedPrincipal:
    """Pinned principal with an institute STAFF role. Unlike tutor._caller,
    is_root_user alone is not enough: it is set for learners too, and these
    routes spend the institute's credits."""
    if not is_staff(sorted(normalize_roles(principal.roles))):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                            detail="AI videos are created by institute staff (admin, teacher or content-creator roles)")
    return principal


def _lms_access(video_id: str, institute_id: str, db: Session):
    record = AiVideoRepository(session=db).get_by_video_id(video_id)
    owner = str(((record.extra_metadata or {}) if record is not None else {}).get("institute_id") or "").strip()
    if record is None or not owner or owner != institute_id:
        raise HTTPException(status_code=404, detail=f"Video {video_id} not found")
    return record


def _error(status_code: int, code: str, detail: str, **extra: Any) -> JSONResponse:
    return JSONResponse(status_code=status_code, content={"detail": detail, "code": code, **extra})


# ── sources ──────────────────────────────────────────────────────────────────

def _end_transaction(db: Session, *, rollback: bool = False) -> None:
    """Close the request session's read-only transaction (nothing was written)."""
    fn = getattr(db, "rollback" if rollback else "commit", None)
    if callable(fn):
        try:
            fn()
        except Exception:  # noqa: BLE001
            pass


async def collect_sources(
    db: Session, institute_id: str, slide_ids: List[str], *, extract: bool,
) -> Tuple[str, List[str]]:
    """(source text, warnings). Only this institute's PUBLISHED/UNSYNC slides
    are used; with `extract` the free text of PDFs / videos is resolved too."""
    from ..services.tutor.slide_source import load_slide_source, slide_belongs_to_institute

    ids = [s for s in dict.fromkeys((sid or "").strip() for sid in slide_ids) if s][:MAX_SOURCE_SLIDES]
    if not ids:
        return "", []
    warnings: List[str] = []
    skipped = 0
    parts: List[str] = []
    loaded = []
    for sid in ids:
        try:
            if not slide_belongs_to_institute(db, sid, institute_id):
                skipped += 1
                continue
            src = load_slide_source(db, sid)
        except Exception:  # noqa: BLE001
            logger.warning("[LMS-Video] could not read source slide %s", sid, exc_info=True)
            _end_transaction(db, rollback=True)
            skipped += 1
            continue
        if src is None:
            skipped += 1
            continue
        loaded.append(src)
    needs_fetch = extract and any(
        not (s.text or "").strip() and s.kind in ("video", "pdf") for s in loaded)
    if needs_fetch:
        # Don't hold the request's transaction open across PDF / script downloads.
        _end_transaction(db)
    for src in (loaded if extract else []):
        sid = src.slide_id
        if not (src.text or "").strip() and src.kind in ("video", "pdf"):
            try:
                from ..services.tutor.source_text import resolve_free_text
                await resolve_free_text(src)
            except Exception:  # noqa: BLE001
                logger.warning("[LMS-Video] free text failed for slide %s", sid, exc_info=True)
        body = (src.text or "").strip() or (src.video_description or "").strip()
        if body:
            parts.append(f"### {src.title or 'Slide'}\n{body}")
        else:
            why = f" ({src.text_note})" if src.text_note else ""
            warnings.append(f"“{src.title or 'A slide'}” has no readable text{why} and was not used.")
    if skipped:
        warnings.append(
            f"{skipped} selected slide{'s were' if skipped != 1 else ' was'} skipped (draft, deleted or not "
            f"in this institute). Publish a slide to use it as a source.")
    text_ = "\n\n".join(parts)
    if len(text_) > SOURCE_TEXT_CAP:
        warnings.append(
            f"The source material was trimmed to its first {SOURCE_TEXT_CAP:,} characters "
            f"(of {len(text_):,}).")
        text_ = text_[:SOURCE_TEXT_CAP]
    return text_, warnings


# ── estimate / policy evaluation ─────────────────────────────────────────────

def _estimate(db: Session, institute_id: str, video_req: VideoGenerationRequest) -> Dict[str, Any]:
    from ..services.video_estimation_service import estimate_video_generation
    return estimate_video_generation(
        db, institute_id=institute_id, quality_tier=video_req.quality_tier, **estimate_params_for(video_req),
    )


def _estimate_view(result: Dict[str, Any]) -> Dict[str, Any]:
    e = result.get("estimate") or {}
    return {
        "expected_credits": float(e.get("expected_credits") or 0),
        "low_credits": float(e.get("low_credits") or 0),
        "high_credits": float(e.get("high_credits") or 0),
        "rows": [{"label": r.get("component"), "credits": float(r.get("credits") or 0)}
                 for r in (e.get("breakdown") or [])],
    }


def _usage_numbers(db: Session, institute_id: str) -> Tuple[float, int]:
    return (policy_svc.month_credits_used(db, institute_id), policy_svc.running_now(db, institute_id))


def _prepare(req: LmsVideoRequest, principal: PinnedPrincipal, prompt: str = "",
             video_id: Optional[str] = None) -> Tuple[FormatPlan, VideoGenerationRequest]:
    plan = resolve_format(req)
    video_req = build_video_request(
        req, plan, prompt or build_prompt(req, plan), video_id=video_id or "estimate",
        institute_id=principal.institute_id, user_id=principal.user_id,
    )
    return plan, video_req


async def check_reference_urls(files: List[LmsReferenceFile]) -> Optional[str]:
    """Detail for the first reference file whose URL is not a public https
    address, else None. The pipeline's reference_file_service downloads these
    with a plain urlopen (any scheme, any host), so staff-supplied URLs are
    checked here with the same address rules as services/safe_http (no
    file://, localhost, cluster or private / link-local / metadata addresses)."""
    from ..services.safe_http import SafeFetchError, _validate

    for rf in files:
        try:
            await _validate(rf.url, allow_http=False, allowed_hosts=None, allowed_ports=None)
        except SafeFetchError as exc:
            return f"“{rf.name}” can't be used as a source: {exc.message}"
    return None


def _validation_detail(exc: ValidationError) -> str:
    try:
        first = exc.errors()[0]
        return f"{'.'.join(str(x) for x in first.get('loc', ()))}: {first.get('msg')}"
    except Exception:  # noqa: BLE001
        return str(exc)


# ── endpoints ────────────────────────────────────────────────────────────────

@router.post("/estimate", summary="Estimate credits and check the institute's AI video policy")
async def estimate_lms_video(
    payload: LmsVideoRequest,
    principal: PinnedPrincipal = Depends(_staff_principal),
    db: Session = Depends(db_dependency),
):
    inst = principal.institute_id
    try:
        plan, video_req = _prepare(payload, principal)
    except ValidationError as exc:
        return _error(422, "INVALID_REQUEST", _validation_detail(exc))
    policy, _ = policy_svc.load_policy(db, inst)
    warnings = list(plan.warnings)
    _, source_warnings = await collect_sources(db, inst, payload.source_slide_ids, extract=False)
    warnings += source_warnings

    result = _estimate(db, inst, video_req)
    est = _estimate_view(result)
    current = (result.get("balance") or {}).get("current")

    blocked: Optional[Tuple[str, str]] = plan.error
    if blocked is None:
        blocked = policy_svc.static_block(
            policy, quality=payload.quality, teacher_requested=plan.teacher_used, duration=plan.duration)
    if blocked is None:
        month_used, running = _usage_numbers(db, inst)
        blocked = policy_svc.usage_block(
            policy, expected_credits=est["expected_credits"], month_used=month_used, running=running)
    if blocked is None and current is not None and float(current) < est["expected_credits"]:
        blocked = ("INSUFFICIENT_CREDITS",
                   f"Not enough credits: this video needs about {est['expected_credits']:.0f} credits and the "
                   f"institute has {float(current):.0f}.")
    return {
        "estimate": est,
        "balance": {"current_balance": float(current) if current is not None else None},
        "policy": policy_svc.public_policy(policy),
        "allowed": blocked is None,
        "blocked_reason": blocked[1] if blocked else None,
        "blocked_code": blocked[0] if blocked else None,
        "warnings": warnings,
    }


class _DiscardQueue(asyncio.Queue):
    """Nobody streams an LMS run's events (the slide polls /status), so the
    runner's SSE queue drops them instead of growing for the whole render."""

    async def put(self, item):  # noqa: D401
        return None

    def put_nowait(self, item):
        return None


def _merge_metadata(video_id: str, extra: Dict[str, Any]) -> bool:
    """Atomic ``metadata || extra`` (never a read-modify-write of the column:
    that could revert the run lease / run request written concurrently)."""
    return AiVideoRepository().merge_metadata(video_id, extra)


def _finish_record(video_id: str, failure: Optional[BaseException], extra: Dict[str, Any],
                   responded: bool, prompt: str, language: str) -> Optional[str]:
    """Final status of the run for the notification; marks a run that raised
    (or never created its row after /generate already answered) FAILED so the
    slide stops showing progress. Returns None when nothing should be sent."""
    with make_db_session() as s:
        repo = AiVideoRepository(session=s)
        rec = repo.get_by_video_id(video_id)
        if rec is None:
            if not responded:
                return None   # /generate reported the error; no slide exists
            repo.create(video_id=video_id, prompt=prompt, language=language, content_type="VIDEO",
                        metadata=extra)
            repo.mark_failed(video_id=video_id,
                             error_message=f"Generation could not start: {failure}" if failure
                             else "Generation could not start")
            return "FAILED"
        current = rec.status
        if failure is not None and current not in TERMINAL_STATUSES:
            repo.mark_failed(video_id=video_id, error_message=f"Generation failed: {failure}")
            return "FAILED"
        return current


class _LmsRun:
    """Hooks for one LMS run: stamp the LMS metadata the moment the run creates
    its row, tell /generate whether it started, and notify the creator once it
    ends (COMPLETED / FAILED — never CANCELLED)."""

    def __init__(self, *, video_id: str, institute_id: str, user_id: Optional[str], topic: str,
                 context: Dict[str, Any], extra: Dict[str, Any], prompt: str, language: str):
        self.video_id = video_id
        self.institute_id = institute_id
        self.user_id = user_id
        self.topic = topic
        self.context = context
        self.extra = extra
        self.prompt = prompt
        self.language = language
        self.ready: asyncio.Future = asyncio.get_running_loop().create_future()
        self.merged = False
        self.responded = False
        # The run failed before /generate answered, so /generate returns the
        # error in the dialog (no slide is added): no FAILED row, no bell.
        self.rejected = False

    def _settle(self, value: Optional[str]) -> None:
        if not self.ready.done():
            if value is not None and not self.responded:
                self.rejected = True
            self.ready.set_result(value)

    async def on_event(self, event: Dict[str, Any]) -> None:
        if self.merged:
            return
        if event.get("type") == "error":
            self._settle(str(event.get("message") or "Generation could not start"))
            return
        self.merged = await asyncio.to_thread(_merge_metadata, self.video_id, self.extra)
        if self.merged:
            self._settle(None)

    async def on_finished(self, failure: Optional[BaseException]) -> None:
        if not self.merged and not self.ready.done():
            self._settle(f"Generation could not start: {failure}" if failure else "Generation could not start")
        final = await asyncio.to_thread(
            _finish_record, self.video_id, failure, self.extra, self.responded and not self.rejected,
            self.prompt, self.language)
        if self.rejected or final not in ("COMPLETED", "FAILED"):
            return
        await notify_creator(self.institute_id, self.user_id, self.video_id, self.topic, self.context, final)


def resume_hooks(video_id: str, meta: Dict[str, Any]) -> "_LmsRun":
    """Hooks for an auto-resumed LMS leg: the LMS metadata is already on the
    row and /generate answered long ago, so ``merged`` / ``responded`` start
    True — on_finished notifies the creator once, only when the run ends
    COMPLETED or FAILED (an interrupted leg ends IN_PROGRESS: no bell)."""
    meta = meta if isinstance(meta, dict) else {}
    rr = meta.get("run_request") if isinstance(meta.get("run_request"), dict) else {}
    run = _LmsRun(
        video_id=video_id,
        institute_id=str(meta.get("institute_id") or rr.get("institute_id") or ""),
        user_id=meta.get("created_by_user_id") or rr.get("user_id"),
        topic=str(meta.get("lms_topic") or ""),
        context=meta.get("context") if isinstance(meta.get("context"), dict) else {},
        extra={},
        prompt="",
        language=str((rr.get("kwargs") or {}).get("language") or "English"),
    )
    run.merged = True
    run.responded = True
    if not run.ready.done():
        run.ready.set_result(None)
    return run


async def notify_creator(institute_id: str, user_id: Optional[str], video_id: str, topic: str,
                         context: Dict[str, Any], final_status: str) -> bool:
    if not user_id:
        return False
    from ..services import staff_notify

    short = (topic or "AI video").strip()
    if len(short) > 80:
        short = short[:77] + "…"
    where = (context or {}).get("chapter_name")
    if final_status == "COMPLETED":
        title = "Your AI video is ready"
        body = (f"“{short}” has finished generating"
                + (f" in {where}" if where else "")
                + ". Review it and publish the slide when you're happy with it.")
    else:
        title = "Your AI video couldn't be generated"
        body = f"“{short}” couldn't be generated — credits refunded. You can try again from the chapter."
    data = {"video_id": video_id, "status": final_status}
    for k in ("chapter_id", "course_id", "subject_id", "module_id", "package_session_id"):
        v = (context or {}).get(k)
        if v:
            data[k] = str(v)
    return await staff_notify.system_alert(
        institute_id, [user_id], title, body, source=NOTIFY_SOURCE, source_id=video_id, data=data,
    )


@router.post("/generate", summary="Start an AI video for a chapter slide")
async def generate_lms_video(
    payload: LmsVideoRequest,
    principal: PinnedPrincipal = Depends(_staff_principal),
    db: Session = Depends(db_dependency),
):
    inst = principal.institute_id
    plan = resolve_format(payload)
    if plan.error:
        return _error(422, *plan.error)

    # 1. Policy: enabled, quality, teacher, length.
    policy, _ = policy_svc.load_policy(db, inst)
    blocked = policy_svc.static_block(
        policy, quality=payload.quality, teacher_requested=plan.teacher_used, duration=plan.duration)
    if blocked:
        return _error(403, *blocked)

    # The teacher must be a ready Spatius avatar this institute may use.
    if plan.teacher_used and plan.lesson is not None:
        from ..services.lesson_plan_service import LessonConfigError, resolve_lesson_plan
        try:
            resolve_lesson_plan(LessonConfig(**plan.lesson), institute_id=inst, db=db)
        except LessonConfigError as exc:
            return _error(422, "TEACHER_NOT_AVAILABLE", str(exc))

    bad_file = await check_reference_urls(payload.reference_files)
    if bad_file:
        return _error(422, "INVALID_REFERENCE_FILE", bad_file)

    video_id = str(uuid4())
    try:
        # The estimator prices the selections, not the prompt, so the policy
        # and credit checks run before any source is downloaded.
        video_req = build_video_request(payload, plan, build_prompt(payload, plan), video_id=video_id,
                                        institute_id=inst, user_id=principal.user_id)
    except ValidationError as exc:
        return _error(422, "INVALID_REQUEST", _validation_detail(exc))

    # 2. Policy: monthly cap + concurrency (need the estimate / DB).
    est = _estimate_view(_estimate(db, inst, video_req))
    month_used, running = _usage_numbers(db, inst)
    blocked = policy_svc.usage_block(
        policy, expected_credits=est["expected_credits"], month_used=month_used, running=running)
    if blocked:
        return _error(403, *blocked)

    # 3. Credits: the same pre-flight the external /generate runs.
    from ..services.credit_service import CreditService
    check = CreditService(db).check_video_tier_credits(
        institute_id=inst,
        quality_tier=video_req.quality_tier,
        ai_video_enabled=False,
        partial_run_factor=1.0,
        estimate_params=estimate_params_for(video_req),
    )
    if not check.has_sufficient_credits:
        return _error(402, "INSUFFICIENT_CREDITS", check.message,
                      required=float(check.estimated_cost), balance=float(check.current_balance))

    # 4. Grounding text from the chapter's slides, into the prompt.
    source_text, source_warnings = await collect_sources(db, inst, payload.source_slide_ids, extract=True)
    warnings = list(plan.warnings) + source_warnings
    prompt = build_prompt(payload, plan, source_text)
    try:
        video_req = build_video_request(payload, plan, prompt, video_id=video_id,
                                        institute_id=inst, user_id=principal.user_id)
    except ValidationError as exc:
        return _error(422, "INVALID_REQUEST", _validation_detail(exc))

    # 5. Start the shared background runner.
    context = payload.context.model_dump(exclude_none=True) if payload.context else {}
    extra = {
        "source": "lms",
        "created_by_user_id": principal.user_id,
        "institute_id": inst,
        "format": payload.format,
        "context": context,
        "lms_topic": payload.topic.strip(),
        "lms_code_editor": plan.code_editor,
    }
    run = _LmsRun(video_id=video_id, institute_id=inst, user_id=principal.user_id, topic=payload.topic,
                  context=context, extra=extra, prompt=prompt, language=payload.language)
    ext.start_video_generation(
        video_req, video_id, TARGET_STAGE, inst,
        queue=_DiscardQueue(), user_id=principal.user_id,
        on_event=run.on_event, on_finished=run.on_finished, track_concurrency=False,
        run_request_kind="lms",
    )
    try:
        start_error = await asyncio.wait_for(asyncio.shield(run.ready), timeout=READY_TIMEOUT_SECONDS)
    except asyncio.TimeoutError:
        start_error = None
        warnings.append("The video is still starting; its progress will appear shortly.")
    run.responded = True
    if start_error:
        return _error(422, "GENERATION_REJECTED", start_error)
    logger.info("[LMS-Video] %s started for institute %s by %s (format=%s, quality=%s, %s)",
                video_id, inst, principal.user_id, payload.format, payload.quality, plan.duration)
    return {"video_id": video_id, "estimate": est, "code_editor": plan.code_editor, "warnings": warnings}


def _video_status_dict(db: Session, video_id: str) -> Optional[Dict[str, Any]]:
    from ..services.s3_service import S3Service
    from ..services.video_generation_service import VideoGenerationService
    return VideoGenerationService(repository=AiVideoRepository(session=db), s3_service=S3Service()) \
        .get_video_status(video_id)


_STAGE_PERCENT = {"PENDING": 2, "SCRIPT": 8, "TTS": 12, "WORDS": 15, "HTML": 15}
_EARLY_STAGES = ("PENDING", "SCRIPT", "TTS", "WORDS")


def build_status(video_id: str, st: Dict[str, Any]) -> Dict[str, Any]:
    status_ = st.get("status") or "PENDING"
    stage = st.get("current_stage") or "PENDING"
    # Between stages a row can read COMPLETED at SCRIPT/TTS/WORDS: the run is
    # still going until the HTML timeline exists.
    if status_ == "COMPLETED" and stage in _EARLY_STAGES:
        status_ = "IN_PROGRESS"
    prog = st.get("generation_progress") or {}
    live = st.get("live") or {}
    s3 = st.get("s3_urls") or {}
    done = int(prog.get("shots_completed") or 0)
    total = int(prog.get("shots_total") or 0) or len(live.get("shots") or []) or 0
    # current_stage only advances when a stage finishes, so a run that is
    # already drawing shots still reads WORDS until the HTML stage completes.
    if status_ == "IN_PROGRESS" and total > 0 and stage in _EARLY_STAGES:
        stage = "HTML"
    if status_ == "COMPLETED":
        pct = 100
    else:
        pct = _STAGE_PERCENT.get(stage, 15)
        if total > 0:
            pct = max(pct, 15 + int(80 * min(done, total) / total))
        last_pct = (prog.get("last_event") or {}).get("percentage")
        if isinstance(last_pct, (int, float)):
            pct = max(pct, int(last_pct))
        pct = min(pct, 99)
    timeline = s3.get("timeline")
    audio = s3.get("audio")
    return {
        "video_id": video_id,
        "status": status_,
        "current_stage": stage,
        "percentage": pct,
        "sub_stage": prog.get("sub_stage") or live.get("active_substage") or None,
        "shots_completed": done,
        "shots_total": total,
        "error_message": st.get("error_message"),
        "html_url": timeline if isinstance(timeline, str) else None,
        "audio_url": audio if isinstance(audio, str) else None,
        "updated_at": st.get("updated_at"),
    }


@router.get("/status/{video_id}", summary="Progress of an LMS AI video")
async def lms_video_status(
    video_id: str,
    principal: PinnedPrincipal = Depends(_staff_principal),
    db: Session = Depends(db_dependency),
):
    _lms_access(video_id, principal.institute_id, db)
    st = _video_status_dict(db, video_id)
    if not st:
        raise HTTPException(status_code=404, detail=f"Video {video_id} not found")
    return build_status(video_id, st)


@router.post("/cancel/{video_id}", summary="Stop an LMS AI video (credits refunded)")
async def cancel_lms_video(
    video_id: str,
    principal: PinnedPrincipal = Depends(_staff_principal),
):
    return await ext.cancel_video_generation(video_id, principal.institute_id, ensure_access=_lms_access)


# ── MP4 render ───────────────────────────────────────────────────────────────
#
# The slide plays the HTML timeline; an MP4 is an optional export rendered by
# the dedicated render worker through the external router's shared code path
# (ext.submit_video_render + ext.render_state_with_watchdog). Renders are not
# billed, so the LMS watchdog never refunds (the external one refunds the
# video's credits, which here would refund the whole generation).

RENDER_STATUSES = ("none", "queued", "running", "completed", "failed")


class LmsRenderBody(BaseModel):
    model_config = ConfigDict(extra="ignore")
    resolution: Literal["720p", "1080p"] = "1080p"
    show_captions: bool = True


def _video_service(db: Session):
    from ..services.s3_service import S3Service
    from ..services.video_generation_service import VideoGenerationService
    return VideoGenerationService(repository=AiVideoRepository(session=db), s3_service=S3Service())


def _progress(value: Any) -> float:
    try:
        pct = float(value or 0)
    except (TypeError, ValueError):
        return 0.0
    return max(0.0, min(100.0, pct))


def render_state(video_id: str, institute_id: str, record: Any, db: Session) -> Dict[str, Any]:
    """RenderState for an LMS video: {status, progress, video_url, error, updated_at}.

    "none" = never rendered, or the MP4 was cleared (DELETE /external/.../render
    drops s3_urls.video and render_job_id but leaves render_status behind).
    A render that completed reads completed only while its MP4 is on record
    (s3_urls.video, or render_job_id still set: the worker records
    render_status before s3_urls)."""
    meta = record.extra_metadata or {}
    s3_video = (record.s3_urls or {}).get("video") if isinstance(record.s3_urls, dict) else None
    s3_video = s3_video if isinstance(s3_video, str) and s3_video else None
    if not meta.get("render_status"):
        if s3_video:
            return {"status": "completed", "progress": 100.0, "video_url": s3_video, "error": None,
                    "updated_at": None}
        if not meta.get("render_job_id"):
            return {"status": "none", "progress": 0.0, "video_url": None, "error": None, "updated_at": None}
    state, _ = ext.render_state_with_watchdog(
        video_id, institute_id, record, db, job_id=meta.get("render_job_id"), refund=False)
    status_ = str(state.get("status") or "queued")
    if status_ not in RENDER_STATUSES or status_ == "none":
        status_ = "running"
    video_url = None
    if status_ == "completed":
        video_url = s3_video or (state.get("video_url") if meta.get("render_job_id") else None)
        if not video_url:
            return {"status": "none", "progress": 0.0, "video_url": None, "error": None,
                    "updated_at": state.get("last_seen_at")}
    return {
        "status": status_,
        "progress": 100.0 if status_ == "completed" else _progress(state.get("progress")),
        "video_url": video_url,
        "error": (state.get("error") or "Render failed") if status_ == "failed" else None,
        "updated_at": state.get("last_seen_at"),
    }


def _not_ready_reason(record: Any) -> Optional[str]:
    status_ = str(getattr(record, "status", "") or "")
    stage = str(getattr(record, "current_stage", "") or "")
    s3 = record.s3_urls if isinstance(getattr(record, "s3_urls", None), dict) else {}
    if status_ in ("PENDING", "IN_PROGRESS") or (status_ == "COMPLETED" and stage in _EARLY_STAGES):
        return "The video is still being generated. Render the MP4 once it has finished."
    if not s3.get("timeline") or not s3.get("audio"):
        return "This video has no finished board timeline and narration yet, so it can't be rendered."
    return None


def _claim_render(video_id: str, record: Any, db: Session) -> Tuple[str, Any]:
    """Stamp render_status=queued before the submit so a concurrent POST reads a
    live render and returns it instead of submitting again. The submit replaces
    this with the real job's status; a stuck claim is failed by the watchdog.
    Returns (claim timestamp, previous render_status) for _release_render_claim."""
    meta = dict(record.extra_metadata or {})
    prev_rs = meta.get("render_status")
    claim_at = datetime.now(timezone.utc).isoformat()
    meta["render_status"] = {"status": "queued", "progress": 0, "video_url": None,
                             "error": None, "last_seen_at": claim_at}
    AiVideoRepository(session=db).update_metadata(video_id, meta)
    return claim_at, prev_rs


def _release_render_claim(video_id: str, db: Session, claim_at: str, prev_rs: Any) -> None:
    """The submit failed: put back the previous render_status, unless something
    else (a callback, another submit) has written since the claim."""
    try:
        repo = AiVideoRepository(session=db)
        record = repo.get_by_video_id(video_id)
        if record is None:
            return
        meta = dict(record.extra_metadata or {})
        if (meta.get("render_status") or {}).get("last_seen_at") != claim_at:
            return
        if prev_rs:
            meta["render_status"] = prev_rs
        else:
            meta.pop("render_status", None)
        repo.update_metadata(video_id, meta)
    except Exception as exc:  # noqa: BLE001 - the submit's own error is what the caller sees
        logger.warning("[LMS-Video] could not release the render claim for %s: %s", video_id, exc)


@router.get("/render/{video_id}", summary="MP4 render status of an LMS AI video")
async def lms_render_status(
    video_id: str,
    principal: PinnedPrincipal = Depends(_staff_principal),
    db: Session = Depends(db_dependency),
):
    record = _lms_access(video_id, principal.institute_id, db)
    return render_state(video_id, principal.institute_id, record, db)


@router.post("/render/{video_id}", summary="Render an LMS AI video to MP4 (not billed)")
async def lms_render(
    video_id: str,
    body: Optional[LmsRenderBody] = None,
    principal: PinnedPrincipal = Depends(_staff_principal),
    db: Session = Depends(db_dependency),
):
    inst = principal.institute_id
    record = _lms_access(video_id, inst, db)
    current = render_state(video_id, inst, record, db)
    # One MP4 per video: a finished one is returned, a live job is not duplicated.
    if current["status"] in ("completed", "queued", "running"):
        return current
    reason = _not_ready_reason(record)
    if reason:
        return _error(409, "NOT_READY", reason)
    opts = body or LmsRenderBody()
    # Claim the render before submitting: the submit takes seconds (render
    # server call + timeline probe) and only then records the job, so without
    # this a second click / tab in that window would start a second job.
    claim_at, prev_rs = _claim_render(video_id, record, db)
    # Off the event loop: the submit calls the render server and probes the
    # timeline over HTTP. The request's session is used by one thread at a time.
    try:
        result = await asyncio.to_thread(
            ext.submit_video_render,
            video_id, inst, db, _video_service(db),
            ext.RenderOptionsBody(resolution=opts.resolution, show_captions=opts.show_captions),
            ensure_access=_lms_access,
        )
    except Exception:
        _release_render_claim(video_id, db, claim_at, prev_rs)
        raise
    logger.info("[LMS-Video] MP4 render %s queued for %s by %s (%s, captions=%s)",
                result.get("job_id"), video_id, principal.user_id, opts.resolution, opts.show_captions)
    return {"status": "queued", "progress": 0.0, "video_url": None, "error": None,
            "updated_at": datetime.now(timezone.utc).isoformat()}
