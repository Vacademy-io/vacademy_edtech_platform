"""Compile slides into teaching plans (design §4).

One PlanCompiler per compile request; `compile_many` runs slides under a small
semaphore and yields SSE-ready events as each finishes. Every slide owns its
own DB sessions (the pool is shared with the chatbot; three concurrent slides
is the ceiling), its own model calls, its own token counters and its own
billing row, so one bad slide never fails — or overcharges — another.
"""
from __future__ import annotations

import asyncio
import json
import logging
from dataclasses import dataclass, field, replace
from typing import Any, AsyncIterator, Dict, List, Optional, Tuple

import httpx
from pydantic import ValidationError

from ...db import db_session
from ...models.ai_token_usage import RequestType
from ...models.teaching_plan import TeachingPlan
from ...constants.model_defaults import GLM_DEFAULT
from ...schemas.tutor import CompileKbGrounding, MediaTaskOp, SvgPart, TeachingPlanDraft
from ..ai_billing import UC, metering_user, record_llm_billing, record_tool_billing, supported_kwargs
from ..api_key_resolver import ApiKeyResolver
from ..chat_llm_client import ChatLLMClient
from ..platform_settings_service import get_platform_setting
from . import compile_prompts as prompts
from . import demo, plan_store
from .plan_validator import DEFAULT_LIMITS, QUIZ_LIMITS, image_target, soft_errors, validate_plan
from .svg_check import auto_layout_svg, structural_svg_errors
from .quiz_compiler import compile_quiz
from .slide_source import SlideSource, load_slide_source, slide_belongs_to_institute
from . import source_text

logger = logging.getLogger(__name__)

MAX_REPAIRS = 2
MAX_CONCURRENT_SLIDES = 3
# AI images are the expensive visual; SVG diagrams are free. Cap per slide.
# Raised from 4 once the image pass became concurrent (institutes asked for
# textbook-style illustration, not walls of text): a picture takes about a
# minute, so drawing a board's worth of them must not cost a board's worth of
# minutes.
MAX_GENERATED_IMAGES_PER_SLIDE = 6
IMAGE_CONCURRENCY = 3
COMPILE_MAX_TOKENS = 12_000
# Long material gets a bigger output budget, scaled linearly with its length.
# A 5,100-word SCORM package (32k chars, en + hi narration) needs ~23k output
# tokens for a whole plan; at the flat cap every reply was cut off or came back
# broken and the slide failed (2026-10-22). Short slides keep the flat cap.
LONG_SOURCE_CHARS = (12_000, 36_000)
COMPILE_MAX_TOKENS_LONG = 24_000
# The quality round rewrites the whole plan. Past this size the rewrite costs
# as much as the plan and was the reply that hit the cap; the plan is kept
# with its quality notes instead.
QUALITY_ROUND_MAX_CHARS = 45_000
# After a cut-off reply only this much of it goes back to the model: the whole
# partial (60k chars) tripled the next prompt and is redone from scratch anyway.
TRUNCATED_ECHO_CHARS = 2_000
# Flash, not Pro: on this platform's credit pricing a single failed Pro compile
# (3 × ~7k output tokens) cost 35 credits on 2026-09-03; Flash is an order of
# magnitude cheaper and the validator + repair loop carries the quality. Raise
# it per platform setting tutor.compile.model when the economics allow. Code
# default is the platform GLM default (prod's tutor.compile.model is GLM too).
DEFAULT_COMPILE_MODEL = GLM_DEFAULT
# Provider answers that mean "this model id is not served": fall back to the
# institute default. Timeouts and 5xx are NOT retried on another model — that
# doubled cost and latency for nothing.
_MODEL_REJECTED_STATUSES = {400, 404, 422}


def resolve_compile_model(override: Optional[str] = None) -> Optional[str]:
    if override:
        return override
    try:
        val = get_platform_setting("tutor.compile.model", default=DEFAULT_COMPILE_MODEL)
    except Exception:  # noqa: BLE001
        val = DEFAULT_COMPILE_MODEL
    return val or None


def compile_max_tokens(source_chars: int) -> int:
    """The flat cap up to LONG_SOURCE_CHARS[0], COMPILE_MAX_TOKENS_LONG from
    LONG_SOURCE_CHARS[1], linear in between."""
    lo, hi = LONG_SOURCE_CHARS
    if source_chars <= lo:
        return COMPILE_MAX_TOKENS
    frac = min(1.0, (source_chars - lo) / (hi - lo))
    return int(COMPILE_MAX_TOKENS + frac * (COMPILE_MAX_TOKENS_LONG - COMPILE_MAX_TOKENS))


def _pydantic_errors(exc: ValidationError) -> List[str]:
    out = []
    for e in exc.errors()[:40]:
        loc = ".".join(str(p) for p in e.get("loc", []))
        out.append(f"{loc}: {e.get('msg')}")
    return out


def _description_unchanged(plan: TeachingPlan) -> bool:
    """For video / PDF plans the description is part of the source: a STALE
    row whose description differs from the one it was compiled with must be
    recompiled even though the slide body hash matches."""
    inputs = ((plan.raw_plan_json or {}).get("compile_inputs") or {}) if isinstance(plan.raw_plan_json, dict) else {}
    if "source_description" not in inputs:
        # Compiled before the description was recorded: trust the body hash.
        return True
    return (inputs.get("source_description") or "").strip() == (plan.source_description or "").strip()


def _replace_broken_diagrams(draft: TeachingPlanDraft) -> int:
    """A diagram that still fails the geometry gate after the quality round
    is replaced by a clean auto-layout of its parts. Returns how many."""
    replaced = 0
    for topic in draft.topics:
        for concept in topic.concepts:
            for op in concept.board_ops:
                if getattr(op, "op", None) != "svg":
                    continue
                parts = [p.model_dump() for p in (op.parts or [])]
                if not structural_svg_errors(op.svg):
                    continue
                svg, used = auto_layout_svg(concept.title, parts or [{"id": op.id + "-p1", "label": concept.title[:28]}])
                op.svg = svg
                op.parts = [SvgPart(**u) for u in used]
                replaced += 1
    if replaced:
        logger.info("Tutor compile: %d diagram(s) replaced by auto-layout", replaced)
    return replaced


def _image_target(draft: TeachingPlanDraft) -> int:
    return image_target(draft)


def _count_image_ops(draft: TeachingPlanDraft) -> int:
    return sum(1 for t in draft.topics for c in t.concepts for op in c.board_ops if getattr(op, "op", None) == "image")


class _Skip(Exception):
    """Raised by the draft stage when a slide should be reported as skipped
    (not failed): nothing to teach, no model call made."""


class _FixedKeys:
    """Pre-resolved API keys, so no DB session is held across a model call.
    Duck-types ApiKeyResolver.resolve_keys (same trick as the chat agent)."""

    def __init__(self, keys: Tuple[Optional[str], Optional[str], Optional[str]]):
        self._keys = keys

    def resolve_keys(self, institute_id=None, user_id=None, request_model=None, **_ignored):
        return self._keys


@dataclass
class _Run:
    """Per-slide compile state. compile_many runs slides concurrently on one
    compiler, so nothing that counts tokens or money may live on `self`."""
    usage: Dict[str, int] = field(default_factory=lambda: {"prompt_tokens": 0, "completion_tokens": 0})
    model_used: Optional[str] = None
    # Generated images: (url, usage). Billed only once the plan is stored.
    images: List[Tuple[str, Dict[str, Any]]] = field(default_factory=list)
    # Uploaded video transcribed / scanned PDF OCR'd for this compile (billed inside source_text).
    transcription_minutes: int = 0
    ocr_pages: int = 0
    # Board-quality asks the model did not satisfy; stored with the plan.
    quality_notes: List[str] = field(default_factory=list)
    # Output-token cap for this slide's model calls (compile_max_tokens).
    max_tokens: int = COMPILE_MAX_TOKENS


# Voice warm-ups outlive the compile that started them.
_VOICE_TASKS: set = set()


class PlanCompiler:
    def __init__(
        self,
        *,
        institute_id: str,
        user_id: Optional[str],
        language: str = "en",
        teacher_name: str = "Asha",
        force: bool = False,
        generate_images: bool = False,
        kb_grounding: Optional[CompileKbGrounding] = None,
        compile_run_id: Optional[str] = None,
        model_override: Optional[str] = None,
        transcribe_videos: bool = True,
        ocr_pdfs: bool = True,
        voice_prepare: Optional[Dict[str, Any]] = None,
        metering: Any = None,
        chapter_topics: Optional[Dict[str, List[str]]] = None,
    ) -> None:
        self.institute_id = institute_id
        # Usage-event attribution for every charge of this compile (never
        # changes a charge). Callers with a request pass
        # MeteringContext.from_request; otherwise the authoring user with
        # roles left for the nightly lookup.
        self.metering = metering if metering is not None else metering_user(user_id, surface="ADMIN_APP")
        # Prepared voice: {"provider", "voice", "base_pace", "languages", "course_lang"}
        # — every spoken line of a READY plan is synthesised once, in the
        # background, so lessons play it instead of paying per learner.
        self.voice_prepare = voice_prepare
        # Uploaded videos with no transcript yet: run Whisper (per-minute
        # credits) or park the slide for a description. Scanned PDFs: MathPix
        # OCR (per page) or park.
        self.transcribe_videos = bool(transcribe_videos) and source_text.transcription_available()
        self.ocr_pdfs = bool(ocr_pdfs) and source_text.ocr_available()
        # SCORM slides drawn as images: read per slide (same switch and price as PDF OCR).
        self.ocr_scorm = bool(ocr_pdfs) and source_text.scorm_ocr_available()
        self.user_id = user_id
        self.language = language if language in ("en", "hi") else "en"
        self.teacher_name = (teacher_name or "Asha")[:60]
        self.force = force
        self.generate_images = generate_images
        self.kb_grounding = kb_grounding
        # Course-KB link chapter map {chapter_id: [node_id, ...]} of the
        # grounding KB (course_knowledge.links_enabled): a slide whose chapter
        # is mapped is grounded on its first node's whole section. None keeps
        # the similarity grounding.
        self.chapter_topics = chapter_topics or None
        self.compile_run_id = (compile_run_id or "")[:64] or None
        self.model = resolve_compile_model(model_override)
        # Board images: the tutor's own image model setting, else the platform
        # image model (resolved inside the image service).
        try:
            self.image_model: Optional[str] = get_platform_setting("tutor.image.model", default=None) or None
        except Exception:  # noqa: BLE001
            self.image_model = None

    def _limits(self, source):
        """Interviews and practice drop the lesson-only engagement rules
        (predict guesses, recap bullets, example callouts)."""
        base = replace(DEFAULT_LIMITS, expect_images=bool(self.generate_images))
        if getattr(source, "style", "lesson") in ("interview", "practice"):
            return replace(base, engagement_rules=False)
        return base

    # ── public ───────────────────────────────────────────────────────────

    async def compile_many(self, slide_ids: List[str]) -> AsyncIterator[Dict[str, Any]]:
        queue: asyncio.Queue = asyncio.Queue()
        sem = asyncio.Semaphore(MAX_CONCURRENT_SLIDES)
        _DONE = object()

        async def _one(sid: str) -> None:
            async with sem:
                await queue.put({"type": "PLAN_STARTED", "slide_id": sid})
                try:
                    ev = await self.compile_slide(sid)
                except asyncio.CancelledError:
                    raise
                except Exception as exc:  # noqa: BLE001
                    logger.exception("compile_slide crashed for %s", sid)
                    ev = {"type": "PLAN_ERROR", "slide_id": sid, "error": str(exc)[:500]}
                await queue.put(ev)

        tasks = [asyncio.create_task(_one(s)) for s in slide_ids]

        async def _waiter() -> None:
            try:
                await asyncio.gather(*tasks, return_exceptions=True)
            finally:
                await queue.put(_DONE)

        waiter = asyncio.create_task(_waiter())
        try:
            while True:
                ev = await queue.get()
                if ev is _DONE:
                    break
                yield ev
        finally:
            for t in tasks:
                t.cancel()
            waiter.cancel()

    async def compile_slide(self, slide_id: str) -> Dict[str, Any]:
        # 1. Load + gate
        with db_session() as db:
            if demo.is_demo_slide(slide_id):
                # Public demo topics: authored text in tutor_demo_topic, no course behind it.
                source = demo.load_demo_source(db, slide_id)
                if source is None:
                    return {"type": "PLAN_ERROR", "slide_id": slide_id, "error": "Demo topic not found"}
            else:
                if not slide_belongs_to_institute(db, slide_id, self.institute_id):
                    return {"type": "PLAN_ERROR", "slide_id": slide_id, "error": "Slide not found in this institute"}
                source = load_slide_source(db, slide_id)
                if source is None:
                    return {"type": "PLAN_ERROR", "slide_id": slide_id, "error": "Slide not found or not published"}
            db.commit()

        # Video / PDF: the material's own words (script, captions, cached
        # transcript, PDF text) — network and CPU, so outside any DB session.
        if source.kind in ("video", "pdf", "scorm"):
            await source_text.resolve_free_text(source)
            if (source.kind == "video" and not source.text and source.media_file_id and self.transcribe_videos):
                # Whisper runs later in _build_draft; the plan must hash as
                # a transcript plan so an up-to-date one is not re-paid.
                source.content_hash = source_text.hash_for(source, "transcript")
            if source.kind == "pdf" and not source.text and source.media_file_id and self.ocr_pdfs:
                source.content_hash = source_text.hash_for(source, "pdf")
            if source.kind == "scorm" and source.ocr_units and getattr(self, "ocr_scorm", False):
                source.content_hash = source_text.hash_for(source, source_text.SCORM_OCR_TEXT)

        with db_session() as db:
            plan_store.retire_stuck_compiling(db, slide_id)
            in_progress = plan_store.active_compiling(db, slide_id)
            if in_progress is not None:
                db.commit()
                return {"type": "PLAN_IN_PROGRESS", "slide_id": slide_id, "plan_id": in_progress.id,
                        "reason": "a compile of this slide is already running"}

            existing = plan_store.latest_plan(db, slide_id)
            description = existing.source_description if existing else None

            if source.kind == "other":
                db.commit()
                return {"type": "PLAN_SKIPPED", "slide_id": slide_id,
                        "reason": f"{source.source_type or 'this'} slides are not compiled in phase 1"}

            # The admin's own video description (slide editor) counts as details.
            if not (description or "").strip() and source.video_description:
                description = source.video_description
            will_transcribe = (source.kind == "video" and not source.text and bool(source.media_file_id)
                               and self.transcribe_videos)
            will_ocr = ((source.kind == "pdf" and not source.text and bool(source.media_file_id) and self.ocr_pdfs)
                        or (source.kind == "scorm" and source.ocr_units > 0 and getattr(self, "ocr_scorm", False)))
            if (source.kind in ("video", "pdf", "scorm") and not source.text and not will_transcribe and not will_ocr
                    and not (description or "").strip()):
                # Nothing to teach from: park the slide in NEEDS_DETAILS (once)
                # so the course page can list it; a description flips it to STALE.
                if existing is None or existing.status != "NEEDS_DETAILS":
                    plan_store.start_plan(
                        db, slide_id=slide_id, institute_id=self.institute_id,
                        content_hash=source.content_hash, language=self.language,
                        user_id=self.user_id, source_description=None, status="NEEDS_DETAILS",
                    )
                db.commit()
                why = source.text_note or ("Turn on video transcription or add what this video teaches"
                                           if source.kind == "video" and source.media_file_id
                                           else "Add what this video / PDF teaches before it can be compiled")
                return {"type": "PLAN_NEEDS_DETAILS", "slide_id": slide_id, "reason": why}

            unchanged = (existing is not None and existing.content_hash == source.content_hash
                         and existing.language == self.language and not self.force)
            if unchanged and existing.status == "READY":
                counts = plan_store.plan_counts(db, existing.id)
                db.commit()
                return {"type": "PLAN_UP_TO_DATE", "slide_id": slide_id, "plan_id": existing.id,
                        "version": existing.version, **counts}
            if unchanged and existing.status == "STALE" and _description_unchanged(existing):
                # Re-published without a body change: the plan is still right.
                # No model call, no charge.
                plan_store.reinstate_ready(db, existing)
                counts = plan_store.plan_counts(db, existing.id)
                db.commit()
                return {"type": "PLAN_UP_TO_DATE", "slide_id": slide_id, "plan_id": existing.id,
                        "version": existing.version, "reason": "unchanged since last compile", **counts}

            plan = plan_store.start_plan(
                db, slide_id=slide_id, institute_id=self.institute_id,
                content_hash=source.content_hash, language=self.language,
                user_id=self.user_id, source_description=description, status="COMPILING",
            )
            db.commit()
            plan_id, version = plan.id, plan.version

        # 2. Build the draft
        run = _Run()
        try:
            draft, raw = await self._build_draft(source, description, run)
        except _Skip as skip:
            self._fail(plan_id, f"skipped: {skip}")
            return {"type": "PLAN_SKIPPED", "slide_id": slide_id, "plan_id": plan_id, "reason": str(skip)}
        except asyncio.CancelledError:
            # Server shutting down (compiles outlive the request that started
            # them): never leave the row COMPILING. The write is synchronous,
            # so it completes even though this task is being cancelled.
            self._fail(plan_id, "compile cancelled")
            self._bill_partial(slide_id, run)
            raise
        except Exception as exc:  # noqa: BLE001
            logger.warning("Compile failed for slide %s: %s", slide_id, exc, exc_info=True)
            self._fail(plan_id, str(exc))
            self._bill_partial(slide_id, run)
            return {"type": "PLAN_ERROR", "slide_id": slide_id, "plan_id": plan_id, "error": str(exc)[:500]}

        # 3. Persist + bill (a storage failure is a failed compile too)
        try:
            with db_session() as db:
                plan = db.get(TeachingPlan, plan_id)
                if plan is None:
                    return {"type": "PLAN_ERROR", "slide_id": slide_id, "error": "plan row vanished"}
                plan_store.store_draft(
                    db, plan, draft, model=run.model_used, raw=raw,
                    quality_notes=run.quality_notes,
                    compile_inputs={
                        "kb": self.kb_grounding.model_dump() if self.kb_grounding else None,
                        "teacher_name": self.teacher_name, "language": self.language,
                        "generate_images": self.generate_images, "kind": source.kind,
                        "style": getattr(source, "style", "lesson"),
                        "compile_run_id": self.compile_run_id,
                        "source_description": description,
                        "text_kind": source.text_kind, "text_chars": len(source.text or ""),
                        "transcription_minutes": run.transcription_minutes, "ocr_pages": run.ocr_pages,
                    },
                    compiled_with_description=description,
                )
                status_after = plan.status
                db.commit()
                counts = plan_store.plan_counts(db, plan_id)
        except Exception as exc:  # noqa: BLE001
            logger.warning("Storing plan %s failed: %s", plan_id, exc, exc_info=True)
            self._fail(plan_id, f"could not store the plan: {exc}")
            self._bill_partial(slide_id, run)
            return {"type": "PLAN_ERROR", "slide_id": slide_id, "plan_id": plan_id, "error": str(exc)[:500]}

        if source.kind != "quiz":
            record_tool_billing(
                tool_key="tutor_compile_slide",
                tool_params={},
                request_type=RequestType.CONTENT,
                model=run.model_used or "unknown",
                prompt_tokens=int(run.usage.get("prompt_tokens") or 0),
                completion_tokens=int(run.usage.get("completion_tokens") or 0),
                institute_id=self.institute_id,
                user_id=self.user_id,
                user_role="ADMIN",
                request_id=self.compile_run_id,
                use_case=UC.TUTOR_SETUP,
                metering=getattr(self, "metering", None),
                usage_context={"slide_id": slide_id, "plan_id": plan_id, "feature": "tutor_compile"},
                # A retried request (same run id) or a concurrent duplicate of
                # the same slide must not bill twice.
                idempotency_key=(f"tutor_compile:{self.compile_run_id}:{slide_id}"
                                 if self.compile_run_id else f"tutor_compile:{plan_id}"),
            )
        # Images are charged only for a plan that was actually delivered.
        self._bill_images(run)
        if status_after == "READY" and self.voice_prepare and source.kind != "quiz":
            self._schedule_voice_prepare(plan_id, slide_id)
        return {"type": "PLAN_READY" if status_after == "READY" else "PLAN_STALE",
                "slide_id": slide_id, "plan_id": plan_id, "version": version,
                "kind": source.kind, "model": run.model_used, "status": status_after,
                "images": len(run.images), **counts}

    # ── failure paths ────────────────────────────────────────────────────

    def _fail(self, plan_id: str, error: str) -> None:
        try:
            with db_session() as db:
                plan = db.get(TeachingPlan, plan_id)
                if plan is not None:
                    plan_store.fail_plan(db, plan, error)
                    db.commit()
        except Exception:  # noqa: BLE001
            logger.warning("Could not mark plan %s failed", plan_id, exc_info=True)

    def _bill_partial(self, slide_id: str, run: _Run) -> None:
        """A failed compile still spent model tokens: log and charge the
        ACTUAL usage (no parametric floor — nothing was delivered). Images
        generated for a failed plan are the platform's loss, not billed."""
        pt, ct = int(run.usage.get("prompt_tokens") or 0), int(run.usage.get("completion_tokens") or 0)
        if pt + ct <= 0:
            return
        record_llm_billing(
            request_type=RequestType.CONTENT, model=run.model_used or "unknown",
            prompt_tokens=pt, completion_tokens=ct, total_tokens=pt + ct,
            institute_id=self.institute_id, user_id=self.user_id, request_id=self.compile_run_id,
            metadata={"tool": "tutor_compile_slide", "slide_id": slide_id, "outcome": "failed"},
            use_case=UC.TUTOR_SETUP, metering=getattr(self, "metering", None),
            usage_context={"slide_id": slide_id, "feature": "tutor_compile", "outcome": "failed"},
        )

    def _schedule_voice_prepare(self, plan_id: str, slide_id: str) -> None:
        """Warm the teacher's audio for this plan after the compile returns."""
        from .voice_cache import warm_plan
        vp = self.voice_prepare or {}
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            return
        task = loop.create_task(warm_plan(
            plan_id=plan_id, slide_id=slide_id, institute_id=self.institute_id, user_id=self.user_id,
            provider=str(vp.get("provider") or "sarvam"), voice=str(vp.get("voice") or ""),
            base_pace=float(vp.get("base_pace") or 1.0), languages=list(vp.get("languages") or ["en"]),
            course_lang=str(vp.get("course_lang") or self.language), request_id=self.compile_run_id,
            **supported_kwargs(warm_plan, {"metering": getattr(self, "metering", None)}),
        ))
        _VOICE_TASKS.add(task)
        task.add_done_callback(_VOICE_TASKS.discard)

    def _bill_images(self, run: _Run) -> None:
        from ..provider_rates import image_cost_usd
        cost = image_cost_usd(getattr(self, "image_model", None)) if run.images else 0.0
        for url, usage in run.images:
            try:
                record_tool_billing(
                    tool_key="tutor_media_image", tool_params={}, request_type=RequestType.IMAGE,
                    model=str(getattr(self, "image_model", None) or "image"), prompt_tokens=int((usage or {}).get("prompt_tokens") or 0),
                    completion_tokens=int((usage or {}).get("completion_tokens") or 0),
                    institute_id=self.institute_id, user_id=self.user_id, user_role="ADMIN",
                    request_id=self.compile_run_id, idempotency_key=f"tutor_media:{url}"[:255],
                    provider_cost_usd=cost,
                    use_case=UC.TUTOR_SETUP, metering=getattr(self, "metering", None),
                    usage_context={"feature": "tutor_compile"},
                )
            except Exception:  # noqa: BLE001
                logger.warning("Image billing failed for %s", url, exc_info=True)

    # ── draft building ───────────────────────────────────────────────────

    async def _build_draft(
        self, source: SlideSource, description: Optional[str], run: _Run
    ) -> Tuple[TeachingPlanDraft, Optional[Dict[str, Any]]]:
        if source.kind == "quiz":
            if not source.questions:
                raise _Skip("this quiz has no questions yet")
            draft = compile_quiz(source, self.language)
            errors = validate_plan(draft, self.language, limits=QUIZ_LIMITS)
            if errors:
                raise RuntimeError("quiz plan failed validation: " + "; ".join(errors[:5]))
            run.model_used = "deterministic"
            return draft, None

        if source.kind == "video" and not source.text and source.media_file_id and self.transcribe_videos:
            # The one paid text source: Whisper on the render worker, cached per file.
            try:
                run.transcription_minutes = await source_text.transcribe_upload(
                    source, institute_id=self.institute_id, user_id=self.user_id, request_id=self.compile_run_id,
                    **supported_kwargs(source_text.transcribe_upload, {"metering": getattr(self, "metering", None)}))
            except source_text.TranscriptionPending as pending:
                # Long lecture: the transcript arrives later; the next Prepare
                # picks the job up. Not a failure of the material.
                raise _Skip(str(pending)) from pending
            except Exception as exc:  # noqa: BLE001
                if not (description or "").strip():
                    raise RuntimeError(f"Transcription failed ({str(exc)[:160]}); add what this video teaches instead") from exc
                logger.warning("Transcription failed for slide %s; compiling from the description: %s", source.slide_id, exc)
        if source.kind == "pdf" and not source.text and source.media_file_id and self.ocr_pdfs:
            try:
                run.ocr_pages = await source_text.ocr_pdf(
                    source, institute_id=self.institute_id, user_id=self.user_id, request_id=self.compile_run_id,
                    **supported_kwargs(source_text.ocr_pdf, {"metering": getattr(self, "metering", None)}))
            except Exception as exc:  # noqa: BLE001
                if not (description or "").strip():
                    raise RuntimeError(f"OCR failed ({str(exc)[:160]}); add what this PDF teaches instead") from exc
                logger.warning("OCR failed for slide %s; compiling from the description: %s", source.slide_id, exc)
        if source.kind == "scorm" and source.ocr_units > 0 and getattr(self, "ocr_scorm", False):
            try:
                run.ocr_pages = await source_text.ocr_scorm(
                    source, institute_id=self.institute_id, user_id=self.user_id, request_id=self.compile_run_id,
                    **supported_kwargs(source_text.ocr_scorm, {"metering": getattr(self, "metering", None)}))
            except Exception as exc:  # noqa: BLE001
                if not source.text and not (description or "").strip():
                    raise RuntimeError(f"OCR failed ({str(exc)[:160]}); add what this package teaches instead") from exc
                logger.warning("SCORM OCR failed for slide %s; compiling from what was readable: %s",
                               source.slide_id, exc)
        kb_block = await self._kb_block(source)
        system = prompts.system_prompt(self.teacher_name, self.language, images_enabled=self.generate_images,
                                       style=getattr(source, "style", "lesson"))
        if source.kind == "scorm":
            # The package's own words (slide text, sections, OCR of image
            # slides) taught on the board; the admin's description when the
            # package had nothing readable.
            user = prompts.user_prompt(
                slide_title=source.title, chapter_title=source.chapter_name, course_title=source.course_name,
                slide_kind="SCORM package — teach the text of its slides on the board",
                source_text=source.text or (description or ""), lang=self.language, kb_block=kb_block,
                images_enabled=self.generate_images,
            )
        elif source.kind in ("video", "pdf") and source.text and not (source.media_url or source.media_file_id):
            # An AI video (HTML animation, no file to embed): teach its
            # narration on the board like a document.
            user = prompts.user_prompt(
                slide_title=source.title, chapter_title=source.chapter_name, course_title=source.course_name,
                slide_kind="AI video — teach its narration script on the board (there is no video file to embed)",
                source_text=source.text, lang=self.language, kb_block=kb_block, images_enabled=self.generate_images,
            )
        elif source.kind in ("video", "pdf"):
            user = prompts.media_task_user_prompt(
                slide_title=source.title, chapter_title=source.chapter_name, course_title=source.course_name,
                kind=source.kind, description=description or "", lang=self.language,
                transcript=source.text or None, text_kind=source.text_kind,
            )
        else:
            user = prompts.user_prompt(
                slide_title=source.title, chapter_title=source.chapter_name, course_title=source.course_name,
                slide_kind="document", source_text=source.text, lang=self.language, kb_block=kb_block,
                images_enabled=self.generate_images,
            )
        messages: List[Dict[str, Any]] = [{"role": "system", "content": system}, {"role": "user", "content": user}]

        last_json = ""
        draft_json = ""
        draft: Optional[TeachingPlanDraft] = None
        errors: List[str] = []
        asked_for_images = False
        asked_for_quality = False
        hard_repairs = 0
        run.max_tokens = compile_max_tokens(len(source.text or "") + len(description or ""))
        for attempt in range(MAX_REPAIRS + 3):
            content, finish_reason = await self._chat(messages, run)
            data = None if finish_reason == "length" else prompts.extract_json(content)
            if finish_reason == "length":
                # A cut-off reply repaired into "valid" JSON is a plan with
                # its last topics missing. Ask for a shorter one instead.
                logger.warning("Tutor compile: reply %d truncated at %d tokens for slide %s",
                               attempt + 1, run.max_tokens, source.slide_id)
                errors = ["the reply was cut off at the output-token limit: return a SHORTER plan — fewer, "
                          "simpler SVG diagrams (well under 20,000 characters each), fewer concepts per topic, "
                          "shorter narration — that still covers the whole slide"]
                last_json = ""
            elif data is None:
                shape = prompts.describe_reply(content)
                logger.warning("Tutor compile: reply %d was not JSON for slide %s: %s; %s", attempt + 1,
                               source.slide_id, shape, prompts.json_error_at(content))
                errors = [f"the reply was not a single JSON object ({shape})"]
                last_json = (content or "")[:4000]
            else:
                last_json = json.dumps(data, ensure_ascii=False)
                try:
                    candidate = TeachingPlanDraft.model_validate(data)
                    # Media urls are filled by the system after this loop.
                    errors = validate_plan(candidate, self.language, limits=self._limits(source),
                                           require_media_urls=False)
                    if not errors:
                        draft = candidate
                        draft_json = last_json
                        # Images are on but the model drew none: one extra
                        # round asking for pictures where they belong. Not a
                        # failure if it still declines (abstract material).
                        if (self.generate_images and source.kind == "document" and not asked_for_images
                                and _count_image_ops(candidate) < _image_target(candidate)):
                            asked_for_images = True
                            logger.info("Tutor compile: no image ops with images on for slide %s; asking once", source.slide_id)
                            messages.append({"role": "assistant", "content": last_json[:60000]})
                            messages.append({"role": "user", "content": prompts.image_repair_prompt(last_json)})
                            continue
                        # Engagement and diagram quality: one round, never a
                        # failure — a plan that still misses them is kept.
                        soft = soft_errors(candidate, limits=self._limits(source), source_text=source.text)
                        if soft and not asked_for_quality and len(last_json) > QUALITY_ROUND_MAX_CHARS:
                            logger.info("Tutor compile: plan for slide %s is %d chars; skipping the quality round",
                                        source.slide_id, len(last_json))
                        elif soft and not asked_for_quality:
                            asked_for_quality = True
                            logger.info("Tutor compile: %d quality ask(s) for slide %s: %s", len(soft), source.slide_id, "; ".join(soft[:3])[:400])
                            messages.append({"role": "assistant", "content": last_json[:60000]})
                            messages.append({"role": "user", "content": prompts.soft_repair_prompt(soft, last_json)})
                            continue
                        break
                except ValidationError as ve:
                    errors = _pydantic_errors(ve)
            # A quality round that came back invalid: keep the last valid plan.
            if draft is not None and asked_for_quality:
                logger.info("Tutor compile: quality round for slide %s was invalid; keeping the previous plan", source.slide_id)
                break
            # Which rules bounce plans is what tunes the prompt; keep it visible.
            logger.info("Tutor compile attempt %d for slide %s: %d validation error(s): %s",
                        attempt + 1, source.slide_id, len(errors), "; ".join(errors[:4])[:600])
            if hard_repairs >= MAX_REPAIRS:
                break
            hard_repairs += 1
            if finish_reason == "length":
                echo = (content or "")[:TRUNCATED_ECHO_CHARS] + " …[cut off at the output-token limit]"
            else:
                echo = last_json[:60000] or (content or "")[:60000]
            messages.append({"role": "assistant", "content": echo})
            messages.append({"role": "user", "content": prompts.repair_prompt(errors, last_json)})
        if draft is None:
            raise RuntimeError("plan failed validation after repairs: " + "; ".join(errors[:6]))

        raw = json.loads(draft_json) if draft_json else None
        _replace_broken_diagrams(draft)
        await self._resolve_media(draft, source, run)
        # An image the system could not fill (images off, per-slide cap, a
        # generation error) is dropped, not fatal: the board keeps its text
        # and the plan is still delivered.
        errors = validate_plan(draft, self.language, limits=self._limits(source), require_media_urls=True)
        if errors:
            raise RuntimeError("plan invalid after media stage: " + "; ".join(errors[:6]))
        # What the quality round did not manage (a derivation that will not fit
        # the word budget, an abstract board with no diagram): kept with the
        # plan and shown to the admin, never a failed compile.
        run.quality_notes = soft_errors(draft, limits=self._limits(source), source_text=source.text)
        if run.quality_notes:
            logger.info("Tutor compile: slide %s kept with %d quality note(s): %s",
                        source.slide_id, len(run.quality_notes), "; ".join(run.quality_notes[:3])[:400])
        return draft, raw

    async def _chat(self, messages: List[Dict[str, Any]], run: _Run) -> Tuple[str, Optional[str]]:
        """One model call → (content, finish_reason). Keys are resolved in a
        short-lived session closed BEFORE the await, so no pool connection
        sits idle in an open transaction for the length of a model call.
        Falls back to the institute's default model only when the provider
        rejects the configured compile model id."""
        candidates = (self.model, None) if self.model else (None,)
        last_exc: Optional[Exception] = None
        for model in candidates:
            with db_session() as db:
                keys = ApiKeyResolver(db).resolve_keys(self.institute_id, self.user_id, request_model=model)
            # Reasoning off, like the chatbot: the validator + repair loop carries
            # quality here, and on a reasoning-mandatory model (glm-5.3-flash) the
            # client then bounds the thinking and raises the cap to make room for it.
            # Without this flag the model thought freely inside COMPILE_MAX_TOKENS and
            # every attempt came back "length"-truncated (3 x 12k tokens, 2026-09-05).
            client = ChatLLMClient(_FixedKeys(keys), disable_reasoning=True)
            try:
                resp = await client.chat_completion(
                    messages, temperature=0.2, max_tokens=run.max_tokens,
                    institute_id=self.institute_id, user_id=self.user_id, model=model,
                )
            except httpx.HTTPStatusError as exc:
                last_exc = exc
                status_code = exc.response.status_code if exc.response is not None else 0
                if model is None or status_code not in _MODEL_REJECTED_STATUSES:
                    raise
                logger.warning("Compile model %s rejected by the provider (%s); retrying with the default model",
                               model, status_code)
                continue
            usage = resp.get("usage") or {}
            for k in run.usage:
                run.usage[k] += int(usage.get(k) or 0)
            run.model_used = resp.get("model") or model or run.model_used
            if resp.get("finish_reason") == "length":
                details = usage.get("completion_tokens_details") or {}
                logger.warning(
                    "Tutor compile: model %s hit the output cap — completion_tokens=%s reasoning_tokens=%s "
                    "visible_chars=%d", run.model_used, usage.get("completion_tokens"),
                    details.get("reasoning_tokens"), len(resp.get("content") or ""),
                )
            return resp.get("content") or "", resp.get("finish_reason")
        raise last_exc or RuntimeError("no model answered")

    def _chapter_node(self, source: SlideSource) -> Optional[str]:
        """The first topic node the course link maps to the slide's chapter."""
        if not self.chapter_topics or not getattr(source, "chapter_id", None):
            return None
        nodes = self.chapter_topics.get(source.chapter_id) or []
        return next((str(n) for n in nodes if n), None)

    async def _kb_block(self, source: SlideSource) -> Optional[str]:
        if not self.kb_grounding or source.kind not in ("document", "scorm"):
            return None
        try:
            from ..kb import course_grounding
            extra: Dict[str, Any] = {}
            node_id = self._chapter_node(source)
            if node_id:
                extra["node_id"] = node_id
            with db_session() as db:
                g = await course_grounding.ground_slide(
                    db, kb_id=self.kb_grounding.knowledge_base_id, institute_id=self.institute_id,
                    query=" ".join(p for p in [source.chapter_name, source.title] if p),
                    mode=self.kb_grounding.mode, faithful=True, **extra,
                )
            if g and g.supported:
                return course_grounding.slide_prompt_block(g, self.kb_grounding.mode)
        except Exception:  # noqa: BLE001
            logger.warning("KB grounding unavailable for slide %s", source.slide_id, exc_info=True)
        return None

    async def _resolve_media(self, draft: TeachingPlanDraft, source: SlideSource, run: _Run) -> None:
        """Fill media-task urls, generate or drop requested images. References
        (annotate / arrow) to a dropped element are pruned across the whole
        topic, since a later concept may point at an earlier concept's image."""
        # 1. Media tasks resolve from the slide itself; pick the images to draw
        #    (the cap applies in document order, so the earliest boards win).
        wanted: List[Tuple[Any, str]] = []
        for topic in draft.topics:
            for concept in topic.concepts:
                for op in concept.board_ops:
                    kind = getattr(op, "op", None)
                    if kind == "media_task":
                        op.url = source.media_url or op.url
                        op.file_id = source.media_file_id or op.file_id
                    elif (kind == "image" and not op.url and self.generate_images
                          and len(wanted) < MAX_GENERATED_IMAGES_PER_SLIDE):
                        prompt = getattr(op, "generate", None) or getattr(op, "description", None)
                        if prompt:
                            wanted.append((op, prompt))

        # 2. Draw them together. Each picture is ~a minute of vendor time, so
        #    sequential generation was what kept boards text-heavy.
        if wanted:
            sem = asyncio.Semaphore(IMAGE_CONCURRENCY)

            async def _draw(op: Any, prompt: str) -> None:
                async with sem:
                    op.url = await self._generate_image(prompt, source.course_name, run)

            await asyncio.gather(*(_draw(op, prompt) for op, prompt in wanted))

        # 3. Anything still without a url is dropped, and every reference to it
        #    pruned across the topic.
        for topic in draft.topics:
            dropped_ids: set = set()
            for concept in topic.concepts:
                kept = []
                for op in concept.board_ops:
                    kind = getattr(op, "op", None)
                    if kind == "media_task" and not (op.url or op.file_id):
                        dropped_ids.add(op.id)
                        continue
                    if kind == "image" and not op.url:
                        dropped_ids.add(op.id)
                        continue
                    kept.append(op)
                concept.board_ops = kept
            if dropped_ids:
                for concept in topic.concepts:
                    concept.board_ops = [
                        op for op in concept.board_ops
                        if getattr(op, "target", None) not in dropped_ids
                        and getattr(op, "from_", None) not in dropped_ids
                        and getattr(op, "to", None) not in dropped_ids
                    ]
                topic.summary_ops = [
                    op for op in topic.summary_ops
                    if getattr(op, "target", None) not in dropped_ids
                    and getattr(op, "from_", None) not in dropped_ids
                    and getattr(op, "to", None) not in dropped_ids
                ]
        # A media task must start with the task itself.
        if source.kind in ("video", "pdf") and draft.topics and draft.topics[0].concepts:
            first = draft.topics[0].concepts[0]
            if not any(getattr(op, "op", None) == "media_task" for op in first.board_ops):
                if source.media_url or source.media_file_id:
                    first.board_ops.insert(0, MediaTaskOp(
                        op="media_task", id="t1c1-m", kind="video" if source.kind == "video" else "pdf",
                        url=source.media_url, file_id=source.media_file_id,
                        description=f"{'Watch' if source.kind == 'video' else 'Read'}: {source.title}",
                    ))

    async def _generate_image(self, prompt: Optional[str], course_name: Optional[str], run: _Run) -> Optional[str]:
        if not prompt:
            return None
        try:
            from ...dependencies import get_image_service
            svc = get_image_service()
            url, usage = await svc._generate_and_upload_media(  # noqa: SLF001 — existing internal helper
                course_name=course_name or "tutor", prompt=prompt, model=self.image_model,
            )
            if url:
                run.images.append((url, dict(usage or {})))
            return url
        except Exception:  # noqa: BLE001
            logger.warning("Tutor image generation failed", exc_info=True)
            return None
