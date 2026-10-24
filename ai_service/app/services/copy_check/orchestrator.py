"""grade_copy() — the end-to-end copy-check flow that ai_service runs as a
FastAPI BackgroundTask. Reads from CopyCheckGradeRequest, drives render_worker
OCR, resolves rubrics per question, gives low-confidence maths lines a close-up
second reading, grades each, and POSTs per-question + final callbacks to Java.

Cancellation is checked at three checkpoints — before OCR, before grading,
and between questions — matching the Java cancellation model.
"""
from __future__ import annotations

import asyncio
import logging
import os
import uuid
from typing import Any, Optional

from sqlalchemy.orm import Session

from ...models.ai_token_usage import RequestType
from ..ai_billing import UC, metering_api_key, metering_user, record_tool_billing
from ..api_key_resolver import ApiKeyResolver
from ..chat_llm_client import ChatLLMClient
from ...repositories.copy_check_rubric_repository import CopyCheckRubricRepository
from . import annotator, callbacks, cancellation, deduction_check, language_check, language_feedback, locate, math_reread, option_letter, typed_answers, vision_transcript
from .choice_groups import counted_awarded, counted_flags, resolve_paper_max
from .failure import (
    COPY_UNREADABLE,
    ENGINE_UNAVAILABLE,
    FILE_MISSING,
    LANGUAGE_NOT_SUPPORTED,
    NO_GRADABLE_QUESTIONS,
    CANCELLED as FAILURE_CANCELLED,
    CopyCheckFailure,
    error_code_for,
    redact_urls,
)
from .grader import DEFAULT_MODEL, CopyCheckGrader, call_llm_for_criteria, evaluation_model, token_budget_for
from .prompt_builder import paper_label_for
from .mathpix_fallback import MathpixFallback
from .render_client import CopyCheckRenderClient, OcrCancelled
from .rubric import RubricGenerationFailed, RubricResolver, load_snapshot
from .validator import attach_criteria_max, validate_and_cap
from .enforce_bridge import apply_enforcement

logger = logging.getLogger(__name__)

# Every cut mark is re-checked against a picture of the answer (deduction_check.py)
# unless this is "off".
DEDUCTION_CHECK = os.getenv("COPY_CHECK_DEDUCTION_CHECK", "on").strip().lower() != "off"
# Token allowance on top of the per-question budget for the steps that work
# per page (handwriting read, maths close-ups) and per cut (the image check).
TOKENS_PER_PAGE_ALLOWANCE = 20_000
TOKENS_PER_QUESTION_CHECK = 4_000
# Beside an answer an internal-choice group left out of the total.
NOT_COUNTED_NOTE = "Extra answer - not counted in the total."

# Which reader gives maths lines a second look: "glm" (math_reread.py,
# the default), "mathpix" (the old crop OCR that overwrote the row) or "off".
MATH_READER = os.getenv("COPY_CHECK_MATH_READER", "glm").strip().lower()

# A silent job looks dead to Java's stale-job sweeper, which requeues it and
# would then run the same copy twice. Long phases (a 30-page handwriting read,
# Mathpix enrichment) post no step change of their own, so the running job
# re-posts its current step this often to say "still here".
HEARTBEAT_SECONDS = float(os.getenv("COPY_CHECK_HEARTBEAT_SECONDS", "60"))


def describe_failure(exc: BaseException) -> str:
    """What to tell the admin about a question that could not be graded.

    Read on the evaluation page under "AI could not grade this". A raw
    `ValueError: could not convert string to float: 'low'` told the teacher
    nothing they could act on; say what happened in plain words and keep the
    class + message after it for whoever reads the logs.
    """
    name = type(exc).__name__
    msg = str(exc) or name
    low = msg.lower()
    if "token budget" in low:
        why = "The AI budget for this copy ran out before this question."
    elif "no valid max_marks" in low:
        why = "This question has no maximum marks set on the assessment."
    elif name in ("TimeoutError", "ReadTimeout", "ConnectTimeout", "ConnectError") or "timed out" in low:
        why = "The AI service did not answer in time."
    elif name in ("JSONDecodeError", "ValueError", "TypeError", "KeyError", "AttributeError"):
        why = "The AI's reply could not be read as a verdict, twice."
    elif "rate limit" in low or "429" in low:
        why = "The AI provider rate-limited the request."
    else:
        why = "The AI service returned an error, twice."
    return f"{why} ({name}: {msg})"[:500]


def _new_job_id() -> str:
    return str(uuid.uuid4())


def label_on_copy(question: dict[str, Any], layout_map: dict[str, Any]) -> bool:
    """Does a row on the copy start with this question's printed number
    ("16)", "Q16.", "16 -")? The locator's "not attempted" ([]) is then not
    believed: on a real copy it said so for MCQs 16 and 17 sitting at the top
    of page 2 as "16) b) 1:5" and "17) b) 9", and both scored 0."""
    import re as _re
    m = _re.match(r"\s*(\d{1,3})", str(question.get("paper_label") or question.get("question_number") or ""))
    if not m:
        return False
    num = m.group(1)
    pattern = _re.compile(r"^\s*(?:[Qq](?:ue)?s?\.?\s*)?0*" + num + r"\s*[).:\-]")
    for page in layout_map.get("pages") or []:
        for row in page.get("lines") or []:
            if pattern.match(str(row.get("text") or "")):
                return True
    return False


def _looks_unattempted(raw: dict[str, Any]) -> bool:
    """The grader found no answer: the explicit verdict, or the shape the
    prompt prescribes for one (0 marks, nothing extracted, nothing to draw) for
    models that leave `verdict` out."""
    if not isinstance(raw, dict):
        return False
    if str(raw.get("verdict") or "").strip().lower() == "unattempted":
        return True
    try:
        marks = float(raw.get("marks_awarded") or 0)
    except (TypeError, ValueError):
        return False
    return (
        marks == 0
        and not str(raw.get("extracted_answer") or "").strip()
        and not raw.get("annotations")
    )


def _render_client() -> CopyCheckRenderClient:
    # ai-service uses RENDER_SERVER_URL/RENDER_SERVER_KEY as the cluster-wide
    # convention (already set on the deployment). Fall through to the names
    # I used in the original plan for backward compat.
    base = os.getenv("RENDER_SERVER_URL") or os.getenv("RENDER_WORKER_URL", "")
    key = os.getenv("RENDER_SERVER_KEY") or os.getenv("RENDER_KEY", "")
    return CopyCheckRenderClient(base, key)


async def grade_copy(process_id: Optional[str] = None, job_id: Optional[str] = None) -> str:
    """Allocate a job_id (or adopt the one the router already claimed in
    copy_check_job) and arm the in-memory cancellation slot for it
    (indexed by both job_id and process_id so a cancel-by-process arriving
    before the BG task runs still aborts the job). The actual pipeline runs
    via `run(payload, job_id, db)` in a background task — the router
    schedules it after this returns.
    """
    job_id = job_id or _new_job_id()
    cancellation.register(job_id, process_id=process_id)
    return job_id


def _mark_label_blocks(questions: list[dict[str, Any]]) -> None:
    """Tell repeated printed numbers apart.

    A paper with two passages under one section prints 1-10 twice; the student
    writes both runs. `label_block` = which run this question belongs to (1, 2…)
    and `label_blocks` = how many runs that section has, worked out from paper
    order: a printed number that is <= the previous one in the same section
    starts a new run. Without this "Section A · 1" named two questions and the
    grader marked one passage's answers against the other's key (2026-09-21).
    """
    import re as _re

    def _num(label: Any) -> int | None:
        m = _re.match(r"\s*(\d+)", str(label or ""))
        return int(m.group(1)) if m else None

    runs: dict[str, int] = {}
    last: dict[str, int] = {}
    for q in questions:
        section = str(q.get("section") or "").strip()
        n = _num(q.get("paper_label"))
        if n is None:
            q["label_block"] = 1
            continue
        if section in last and n <= last[section]:
            runs[section] = runs.get(section, 1) + 1
        runs.setdefault(section, 1)
        last[section] = n
        q["label_block"] = runs[section]
    for q in questions:
        q["label_blocks"] = runs.get(str(q.get("section") or "").strip(), 1)


_EMPTY_LAYOUT: dict[str, Any] = {"pages": []}


async def _grade_typed(
    questions: list[dict[str, Any]],
    rubric_resolver: RubricResolver,
    grader: CopyCheckGrader,
    preferred_model: Optional[str],
    on_verdict,
    check_cancelled,
) -> tuple[float, float, int, int]:
    """Grade every typed answer; post each verdict through `on_verdict`.
    Returns (awarded, max, evaluated, graded) - `graded` counts the answers a
    model actually read, which is what the institute is charged for."""
    retry_model = getattr(grader, "default_model", None) or DEFAULT_MODEL
    total_awarded = 0.0
    total_max = 0.0
    evaluated = 0
    graded = 0
    for q in questions:
        check_cancelled()
        answer = typed_answers.answer_text(q.get("student_answer"))
        if not answer:
            verdict = typed_answers.unattempted_verdict(q)
        else:
            graded += 1
            try:
                rubric = await rubric_resolver.resolve(q, preferred_model)
                raw = await grader.grade_typed_question(q, rubric, preferred_model)
                verdict = attach_criteria_max(validate_and_cap(raw, q, _EMPTY_LAYOUT), rubric)
            except cancellation.Cancelled:
                raise
            except Exception as e:
                logger.warning(
                    f"Typed grading failed for question {q.get('question_id')}: {e}; retrying once with {retry_model}",
                )
                try:
                    rubric = await rubric_resolver.resolve(q, retry_model)
                    raw = await grader.grade_typed_question(q, rubric, retry_model)
                    verdict = attach_criteria_max(validate_and_cap(raw, q, _EMPTY_LAYOUT), rubric)
                except cancellation.Cancelled:
                    raise
                except Exception as retry_err:
                    logger.exception(f"Retry also failed for question {q.get('question_id')}")
                    verdict = {
                        "question_id": q["question_id"],
                        "marks_awarded": 0.0,
                        "max_marks": float(q.get("max_marks") or 0),
                        "extracted_answer": answer,
                        "feedback": "This answer could not be evaluated automatically and needs manual review.",
                        "confidence": 0.0,
                        "criteria_breakdown": [],
                        "annotations": [],
                        "status": "FAILED",
                        "error_detail": describe_failure(retry_err),
                    }
            # What the student typed, not the model's retelling of it.
            verdict["extracted_answer"] = answer
            verdict["annotations"] = []
        total_awarded += verdict["marks_awarded"]
        total_max += verdict["max_marks"]
        evaluated += 1
        verdict.setdefault("question_number", q.get("question_number") or evaluated)
        await on_verdict(verdict)
    return total_awarded, total_max, evaluated, graded


# Tool keys (spec 10.1): the dashboard prices per graded question with
# real-token overage; the partner API prices per page (typed: per non-blank
# answer) at a fixed price.
DASHBOARD_TOOL_KEY = "copy_check_evaluation"
API_TOOL_KEY = "copy_check_evaluation_api"
API_ACTOR_PREFIX = "apikey:"
API_KEY_USER_ROLE = "API_KEY"

# What run() reports to the grade route, which records it on copy_check_job
# (the nightly billing reconciliation reads it): the copy was graded and a
# charge is due / graded with nothing to charge / not graded (failed or
# cancelled; never billed).
RUN_BILLED = "COMPLETED"
RUN_NO_CHARGE = "NO_CHARGE"
RUN_FAILED = "FAILED"


def is_api_actor(billing_actor: Any) -> bool:
    return isinstance(billing_actor, str) and billing_actor.startswith(API_ACTOR_PREFIX)


def charge_plan(
    billing: dict[str, Any],
    *,
    typed: bool,
    num_questions: int,
    num_answers: int = 0,
    layout_pages: Optional[int] = None,
) -> Optional[dict[str, Any]]:
    """The record_tool_billing arguments for a completed copy (spec 10.1,
    10.8), or None when nothing is chargeable.

    Dashboard (no `apikey:` actor): unchanged - copy_check_evaluation on the
    graded questions (typed: the answers actually read), no user attribution.
    API: copy_check_evaluation_api at a fixed price on the copy's pages as
    counted at upload (`page_count`; the OCR'd page count if the request had
    none), or on the non-blank typed answers; user_id = the billing actor,
    user_role API_KEY. A rate_snapshot for the chosen key is passed through.
    """
    actor = billing.get("billing_actor")
    snapshot = billing.get("rate_snapshot") or None
    if not is_api_actor(actor):
        if typed and num_answers <= 0:
            return None  # every answer blank: nothing was read
        units = num_answers if typed else num_questions
        return {
            "tool_key": DASHBOARD_TOOL_KEY,
            "tool_params": {"num_questions": units},
            "user_id": None,
            "user_role": None,
            "rate_snapshot": snapshot if _snapshot_key(snapshot) == DASHBOARD_TOOL_KEY else None,
        }
    if typed:
        if num_answers <= 0:
            return None
        params: dict[str, Any] = {"answer_mode": "TYPED", "num_answers": int(num_answers)}
    else:
        pages = billing.get("page_count")
        if not pages:
            pages = layout_pages or 0
        if int(pages) <= 0:
            return None
        params = {"num_pages": int(pages)}
    return {
        "tool_key": API_TOOL_KEY,
        "tool_params": params,
        "user_id": actor,
        "user_role": API_KEY_USER_ROLE,
        "rate_snapshot": snapshot if _snapshot_key(snapshot) == API_TOOL_KEY else None,
    }


def charge_metering(billing: dict[str, Any], req: dict[str, Any]) -> dict[str, Any]:
    """Usage-event attribution for the copy's charge (never changes it): the
    partner API key for API runs, else the dashboard (actor unknown here; the
    teacher who queued the copy is not sent to ai_service)."""
    try:
        actor = billing.get("billing_actor")
        if is_api_actor(actor):
            meter = metering_api_key(actor[len(API_ACTOR_PREFIX):] or None)
        else:
            meter = metering_user(None, surface="ADMIN_APP")
        return {
            "use_case": UC.EVALUATION,
            "metering": meter,
            "usage_context": {
                "assessment_id": req.get("assessment_id"),
                "attempt_id": req.get("attempt_id"),
                "process_id": req.get("process_id"),
                "answer_mode": req.get("answer_mode"),
            },
        }
    except Exception:  # noqa: BLE001 - attribution must never cost a charge
        return {}


def _snapshot_key(snapshot: Any) -> Optional[str]:
    return snapshot.get("tool_key") if isinstance(snapshot, dict) else None


def _layout_page_count(layout_map: Any) -> Optional[int]:
    pages = layout_map.get("pages") if isinstance(layout_map, dict) else None
    return len(pages) if isinstance(pages, list) else None


def _printed_labels(questions: list[dict[str, Any]]) -> dict[str, str]:
    """question_id -> the number printed on the paper, for the checked copy's
    comment panel. Never raises: the copy is rendered after grading succeeded."""
    labels: dict[str, str] = {}
    for q in questions or []:
        try:
            if q.get("question_id"):
                labels[str(q["question_id"])] = str(q.get("paper_label") or "").strip()
        except Exception:
            continue
    return labels


def billing_context(req: dict[str, Any]) -> dict[str, Any]:
    """What the charge at completion is computed from (spec 10.3, 10.8): who
    is billed ("apikey:<key_id>" for API runs, None = the institute), the rate
    quoted at enqueue, and the copy's page count. Carried with the run; the
    billing step reads it."""
    return {
        "billing_actor": req.get("billing_actor"),
        "rate_snapshot": req.get("rate_snapshot"),
        "page_count": req.get("page_count"),
    }


async def _repost_revised(
    callback_base: str,
    process_id: str,
    job_id: str,
    verdicts: list[dict[str, Any]],
    sent: dict[str, tuple[float, list[Any]]],
    rubric_version: Optional[int],
) -> int:
    """Re-send the question callback for every question whose mark changed
    after it was first reported (enforcement) or that a choice group left out
    (T0.21, T1.36). Same endpoint: Java upserts by (process, question), skips
    rows a reviewer edited, and counts a question once. The first send's
    annotations go again so the dashboard overlay keeps the grader's rows."""
    reposted = 0
    for v in verdicts:
        qid = str(v.get("question_id"))
        first = sent.get(qid)
        if first is None:
            continue
        marks_then, annotations_then = first
        failed = str(v.get("status") or "").upper() == "FAILED"
        # A FAILED question keeps its 0 and status; it is re-sent only when a
        # choice group left it out, so Java does not keep counted=true from
        # the live first send.
        changed = (not failed) and abs(float(v.get("marks_awarded") or 0) - marks_then) > 1e-9
        if not changed and v.get("counted", True):
            continue
        payload = dict(v, annotations=_rescore_annotations(annotations_then, v) if changed else annotations_then)
        await callbacks.question_done(
            callback_base, process_id, job_id, payload, rubric_version=rubric_version,
        )
        reposted += 1
    return reposted


def _rescore_annotations(annotations: list[Any], verdict: dict[str, Any]) -> list[Any]:
    """The first send's annotations with every score annotation rewritten to
    the enforced mark, so the overlay Java stores agrees with marks_awarded."""
    try:
        mark = float(verdict.get("marks_awarded") or 0)
        mx = float(verdict.get("max_marks") or 0)
    except (TypeError, ValueError):
        return list(annotations)

    def _fmt(x: float) -> str:
        return str(int(x)) if float(x).is_integer() else f"{x:g}"

    out: list[Any] = []
    for a in annotations:
        if isinstance(a, dict) and a.get("style") == "score":
            a = dict(a, text=f"{_fmt(mark)}/{_fmt(mx)}", marks=mark)
        out.append(a)
    return out


async def run(req: dict[str, Any], job_id: str, db: Session) -> str:
    """The actual pipeline. Designed to never raise out of the BG task — any
    failure ends in a callbacks.failed() POST so Java can surface it.

    Returns RUN_BILLED, RUN_NO_CHARGE or RUN_FAILED (see above)."""
    process_id = req["process_id"]
    callback_base = req["callback_base_url"]
    pdf_url = req.get("pdf_url")
    assessment_id = req["assessment_id"]
    institute_id = req.get("institute_id")
    preferred_model = req.get("preferred_model")
    questions: list[dict[str, Any]] = req["questions"]
    choice_groups = req.get("choice_groups") or None
    billing = billing_context(req)

    llm = ChatLLMClient(ApiKeyResolver(db))
    # The platform's evaluation model ('evaluation' use case, super-admin
    # portal): used whenever the teacher picked none, for retries/escalations,
    # and for reading the page. Resolved once per copy.
    eval_model = evaluation_model(db)
    # The cut-mark re-check has its own use case so it can be switched alone.
    deduction_model = deduction_check.deduction_model(db)
    # The cut-check sends crops of the student's copy to Gemini through
    # OpenRouter: only zero-data-retention endpoints may serve it. Its own
    # client, so a model a teacher picks for grading is never restricted.
    check_llm = ChatLLMClient(ApiKeyResolver(db))
    if hasattr(check_llm, "provider_prefs"):
        check_llm.provider_prefs = {"zdr": True, "data_collection": "deny"}
    grader = CopyCheckGrader(
        llm, institute_id=institute_id, token_budget=token_budget_for(len(questions)),
        exam_context=req.get("exam_context"), default_model=eval_model,
        grading_instructions=not is_api_actor(billing["billing_actor"]),
    )
    mathpix = MathpixFallback()

    async def _llm_for_criteria(system: str, user: str, model: str | None) -> dict[str, Any]:
        # token_sink=grader makes criteria-generation usage count against the
        # same per-copy budget as grading calls (#12).
        return await call_llm_for_criteria(
            llm, system, user, model or eval_model, institute_id, token_sink=grader,
        )

    # Pre-load all rubric state into memory. The DB session is closed after the
    # up-front rubric step below, before the long-running OCR/grading calls so
    # the pool isn't pinned for minutes (#17).
    rubric_snapshot = load_snapshot(db, assessment_id)
    rubric_resolver = RubricResolver(rubric_snapshot, _llm_for_criteria, exam_context=req.get("exam_context"))
    # Attach teacher model answers before anything uses the questions: the
    # grader reads them as the reference for a full-marks answer, and the
    # criteria generator below builds its rubric from them (T0.24).
    for q in questions:
        model_answer = rubric_snapshot.model_answers.get(q["question_id"])
        if model_answer:
            q["model_answer"] = model_answer

    current_step = {"step": "QUEUED"}

    async def _progress(step: str, **kwargs: Any) -> None:
        current_step["step"] = step
        await callbacks.progress(callback_base, process_id, job_id, step=step, **kwargs)

    async def _heartbeat() -> None:
        while True:
            await asyncio.sleep(HEARTBEAT_SECONDS)
            try:
                await callbacks.progress(callback_base, process_id, job_id, step=current_step["step"])
            except Exception as e:  # best-effort; the next beat will try again
                logger.debug("copy-check job %s heartbeat failed: %s", job_id, e)

    heartbeat = asyncio.create_task(_heartbeat())

    async def _stop_heartbeat() -> None:
        """Before any terminal callback: a beat in flight alongside complete/failed
        could land after it and be applied to a finished process."""
        if not heartbeat.done():
            heartbeat.cancel()
            try:
                await heartbeat
            except (asyncio.CancelledError, Exception):
                pass

    try:
        if not questions:
            raise CopyCheckFailure(NO_GRADABLE_QUESTIONS, "no questions to grade on this copy")
        if req.get("answer_mode") != "TYPED" and not pdf_url:
            raise CopyCheckFailure(FILE_MISSING, "no answer sheet (pdf_url) for this copy")

        # 0. Rubric coherence: generate any missing rubrics ONCE, persist them,
        # and reuse for every student — so two students on the same question are
        # graded against identical criteria, not a fresh per-copy invention.
        cancellation.check(job_id, process_id)
        missing = [q for q in questions if not rubric_resolver.has_rubric(q["question_id"])]
        if missing:
            generated: dict[str, Any] = {}
            for q in missing:
                cancellation.check(job_id, process_id)
                try:
                    generated[q["question_id"]] = await rubric_resolver.generate(q, preferred_model)
                except cancellation.Cancelled:
                    raise
                except RubricGenerationFailed:
                    # Not persisted: this copy grades the question with the
                    # default rubric (resolver remembers it for this run only)
                    # and the next copy tries generation again.
                    logger.warning("Rubric generation failed for question %s; default rubric for this copy only",
                                   q.get("question_id"))
                except Exception:
                    logger.exception("Rubric generation failed for question %s", q.get("question_id"))
            if generated and institute_id:
                try:
                    rubric_repo = CopyCheckRubricRepository(db)
                    authoritative = rubric_repo.merge_generated_rubrics(
                        assessment_id, institute_id, generated,
                    )
                    rubric_snapshot.fixed_rubric.update(authoritative)
                    stored = rubric_repo.get(assessment_id)
                    if stored is not None:
                        rubric_snapshot.rubric_version = stored.rubric_version
                except Exception:
                    logger.exception(
                        "Persisting generated rubrics failed; grading this copy with in-memory rubrics",
                    )
                    rubric_snapshot.fixed_rubric.update(generated)
            elif generated:
                # No institute_id → can't persist (column is NOT NULL); still use
                # the generated rubrics for this copy.
                rubric_snapshot.fixed_rubric.update(generated)

        rubric_version = rubric_snapshot.rubric_version
        db.close()

        if req.get("answer_mode") == "TYPED":
            # An online attempt: the answers are exact text already. Nothing to
            # OCR, locate or draw on - grade each answer and finish.
            await _progress("GRADING")
            typed_verdicts: list[dict[str, Any]] = []
            typed_sent: dict[str, tuple[float, list[Any]]] = {}

            async def _typed_done(verdict: dict[str, Any]) -> None:
                typed_verdicts.append(verdict)
                typed_sent[str(verdict["question_id"])] = (
                    float(verdict.get("marks_awarded") or 0), list(verdict.get("annotations") or []))
                await callbacks.question_done(
                    callback_base, process_id, job_id, verdict, rubric_version=rubric_version,
                )

            total_awarded, total_max, evaluated, graded = await _grade_typed(
                questions, rubric_resolver, grader, preferred_model,
                _typed_done,
                lambda: cancellation.check(job_id, process_id),
            )
            if choice_groups and typed_verdicts:
                # Internal choice across the typed answers sent here. Objective
                # questions are marked in Java and never reach this run, so
                # the paper total (and request paper_max) is Java's to compose;
                # this total covers only these questions.
                flags = counted_flags(typed_verdicts, choice_groups)
                for v in typed_verdicts:
                    v["counted"] = flags.get(str(v.get("question_id")), True)
                await _repost_revised(callback_base, process_id, job_id, typed_verdicts, typed_sent, rubric_version)
                total_awarded = counted_awarded(typed_verdicts)
                total_max = resolve_paper_max(questions, choice_groups) or total_max
            await _stop_heartbeat()
            await callbacks.complete(
                callback_base, process_id, job_id,
                total_marks_awarded=round(total_awarded, 2),
                total_max_marks=round(total_max, 2),
                questions_evaluated=evaluated,
                evaluated_file_id=None,
            )
            logger.info("copy-check job %s (typed) complete: %s/%s, %d graded, %d tokens",
                        job_id, total_awarded, total_max, graded, grader.tokens_used)
            # Blank answers were zeroed without a model call; only the answers
            # actually read are charged (dashboard: per answer as a question;
            # API: typed_per_answer each, fixed price).
            plan = charge_plan(billing, typed=True, num_questions=graded, num_answers=graded)
            if plan is None:
                return RUN_NO_CHARGE
            record_tool_billing(
                request_type=RequestType.EVALUATION,
                model=(preferred_model or eval_model),
                prompt_tokens=grader.prompt_tokens,
                completion_tokens=grader.completion_tokens,
                institute_id=institute_id,
                request_id=job_id,
                idempotency_key=process_id,
                **plan,
                **charge_metering(billing, req),
            )
            return RUN_BILLED

        # 1. OCR via render_worker.
        cancellation.check(job_id, process_id)
        render = _render_client()
        if not render.is_configured:
            raise CopyCheckFailure(ENGINE_UNAVAILABLE, "RENDER_WORKER_URL not configured on ai_service")
        await _progress("LAYOUT_OCR_STARTED")
        layout_map = await render.submit_and_wait(
            pdf_url, dpi=200, poll_interval=3.0, timeout=300.0,
            cancellation_check=lambda: cancellation.is_cancelled(job_id, process_id),
        )

        # 1b. Re-read the handwriting with a vision model, and merge the OCR's
        # word-level boxes into real lines. render_worker runs PaddleOCR's
        # PRINTED-text recogniser on handwriting, which returns fragments like
        # 'yromrp' — grading against that does not produce lenient marks, it
        # produces random ones, because the model reconstructs a textbook answer
        # from keyword noise and scores it at high confidence. This step is what
        # makes the marks mean anything. It is pinned to a known vision model
        # rather than `preferred_model`: reading the page is not a place to let
        # a picker choose a text-only model and silently fall back to noise.
        cancellation.check(job_id, process_id)
        await _progress("HANDWRITING_READ")
        try:
            layout_map = await vision_transcript.enrich_layout_with_vision(
                pdf_url, layout_map, llm,
                model=eval_model,
                institute_id=institute_id,
                token_sink=grader,
                cancellation_check=lambda: cancellation.is_cancelled(job_id, process_id),
            )
        except cancellation.Cancelled:
            raise
        except Exception:
            # Never lose a copy to this step: grading can still proceed on the
            # raw OCR, and the prompt now tells the model that transcript is
            # unreliable so it answers with low confidence instead of inventing.
            logger.exception("Vision transcription failed; falling back to raw OCR")

        cancellation.check(job_id, process_id)
        # A copy written in Hindi is refused before any grading call (T1.15):
        # row OCR is English-only and no Hindi evaluation set has passed, so
        # it must never be graded as English. Not billed (failed copy).
        if language_check.applies_to(billing["billing_actor"]) and language_check.is_unsupported_language(layout_map):
            share, letters = language_check.devanagari_share(layout_map)
            raise CopyCheckFailure(
                LANGUAGE_NOT_SUPPORTED,
                f"answers are written in Devanagari ({share:.0%} of {letters} letters); "
                "this language is not supported yet - needs manual evaluation",
            )
        quality = layout_map.get("vision_quality") or {}
        if quality and not quality.get("gradeable", True):
            # Refuse to grade a copy we could not read. Before this gate existed
            # nothing checked the transcript was usable, so an unreadable scan
            # came back as confident marks. A human reading it is the correct
            # outcome; a fabricated mark is not.
            raise CopyCheckFailure(
                COPY_UNREADABLE,
                "answer sheet could not be read reliably "
                f"({quality.get('legible_pages')}/{quality.get('pages')} pages legible, "
                f"{quality.get('avg_chars_per_page')} chars/page) — needs manual evaluation"
            )

        await _progress("LAYOUT_OCR_DONE", layout_map=layout_map)

        # 2. A close-up second reading of the maths lines (cheap if there are
        # none). See math_reread.py for why this is not Mathpix any more.
        cancellation.check(job_id, process_id)
        maths_rows_read = 0
        if MATH_READER == "glm":
            try:
                maths_rows_read = await math_reread.reread_math_rows(
                    pdf_url, layout_map, llm,
                    model=eval_model,
                    institute_id=institute_id,
                    token_sink=grader,
                    cancellation_check=lambda: cancellation.is_cancelled(job_id, process_id),
                )
            except cancellation.Cancelled:
                raise
            except Exception:
                logger.exception("Maths re-read failed; grading on the full-page reading")
        elif MATH_READER == "mathpix":
            layout_map = await mathpix.enrich_layout_for_math(pdf_url, layout_map)

        # 2b. Where is each answer? One call over the page prose so every
        # grading call below gets only the pages that matter (+1 either side)
        # instead of the whole copy. Without this, cost was pages × questions:
        # a 100-question/40-page copy re-sent ~18k tokens of transcript 100
        # times. Advisory only — {} (call failed, copy too small, locator
        # unconvincing) means every call sees the full transcript, as before.
        cancellation.check(job_id, process_id)
        if req.get("skip_answer_location"):
            located = {}
        else:
            located = await locate.locate_answers(
                llm, questions, layout_map, eval_model,
                institute_id=institute_id, token_sink=grader,
            )
        # The per-question budget was sized before the page count was known;
        # the page-level steps and the cut checks must not starve the last
        # questions of the paper (a 43-question copy ran dry on question 42).
        if hasattr(grader, "token_budget"):
            grader.token_budget += (TOKENS_PER_PAGE_ALLOWANCE * len(layout_map.get("pages") or [])
                                    + TOKENS_PER_QUESTION_CHECK * len(questions))
        # 2c. Language accuracy, when the institute asked for it: every error in
        # the student's English, with its correction, found once for the whole
        # copy. Marks are never touched; each written answer's feedback lists
        # its errors and the copy shows them (step 4).
        language_errors: dict[str, list[dict[str, Any]]] = {}
        row_positions: dict[str, tuple[int, int]] = {}
        if language_feedback.enabled(req.get("exam_context")):
            cancellation.check(job_id, process_id)
            if hasattr(grader, "token_budget"):
                grader.token_budget += TOKENS_PER_PAGE_ALLOWANCE * len(layout_map.get("pages") or [])
            language_errors = await language_feedback.find_errors(
                llm, layout_map, eval_model, institute_id=institute_id, token_sink=grader,
                cancellation_check=lambda: cancellation.is_cancelled(job_id, process_id),
            )
            row_positions = language_feedback.row_positions(layout_map)
        # question id -> the language errors in its answer.
        language_found: dict[str, list[dict[str, Any]]] = {}
        checker = (deduction_check.DeductionChecker(
            pdf_url, layout_map, check_llm, institute_id=institute_id, token_sink=grader,
            model=deduction_model,
        ) if DEDUCTION_CHECK else None)
        all_page_ids = [str(p.get("page_id")) for p in layout_map.get("pages") or []]
        question_order = locate.paper_order(questions)

        # 3. Per-question grading.
        # Java flips the process to EVALUATING on this step. Python never sent
        # it, so that branch was dead and the UI showed "OCR done" for most of
        # the run — the grading loop is the long part.
        await _progress("GRADING")
        total_awarded = 0.0
        total_max = 0.0
        evaluated = 0
        # Kept so the annotator can draw every verdict in one pass at the end;
        # the per-question callback already fired for each of these.
        # Every other question's printed label: the grader is told which numbers
        # exist on the sheet so "2." under Section B is not mistaken for "2." under
        # Passage I. Labels only reached us from 2026-09-21; before that this list
        # would have been ids and was not sent at all.
        _mark_label_blocks(questions)
        all_labels = [paper_label_for(q) for q in questions]
        verdicts: list[dict[str, Any]] = []
        # What each question callback said first: enforcement below may change
        # the mark, and the callback is then sent again (T0.21).
        sent: dict[str, tuple[float, list[Any]]] = {}
        for index, q in enumerate(questions):
            q["neighbour_labels"] = [lbl for i, lbl in enumerate(all_labels) if i != index][:80]
            cancellation.check(job_id, process_id)
            qid = str(q["question_id"])
            page_ids = locate.pages_for_question(qid, located, question_order, all_page_ids)
            narrowed = page_ids is not None and len(page_ids) < len(all_page_ids)
            try:
                rubric = await rubric_resolver.resolve(q, preferred_model)
                raw = await grader.grade_question(q, rubric, layout_map, preferred_model, page_ids)
                if narrowed and _looks_unattempted(raw) and (
                        located.get(qid) != [] or label_on_copy(q, layout_map)):
                    # The locator said the answer is on these pages (or did not
                    # place it at all) and the grader found nothing there. One
                    # of them is wrong; a wrong locator must never cost a
                    # student the marks, so look at the whole copy once. An
                    # explicit [] from the locator ("not attempted") agreeing
                    # with the grader is left alone — that is two reads
                    # saying the same thing.
                    logger.info(
                        "Q%s unattempted on located pages %s; re-grading against the full copy",
                        qid, page_ids,
                    )
                    raw = await grader.grade_question(q, rubric, layout_map, preferred_model)
                verdict = attach_criteria_max(validate_and_cap(raw, q, layout_map), rubric)
                if option_letter.honour_option_letter(verdict, q):
                    logger.info("Q%s: the chosen option is the key's - full marks", qid)
                elif checker is not None:
                    await checker.check(verdict, q, rubric)
            except cancellation.Cancelled:
                raise
            except Exception as e:
                # One salvage attempt with the cheap default model before
                # zeroing the question. The most common reason we land here
                # is a transient network/parse glitch or the per-copy token
                # cap being hit mid-batch — both of which a single retry
                # with a clean state often clears. Without this, a single
                # failure mid-batch silently steals marks from the student.
                logger.warning(
                    f"Grading failed for question {q.get('question_id')}: {e}; retrying once with {eval_model}",
                )
                try:
                    rubric = await rubric_resolver.resolve(q, eval_model)
                    raw = await grader.grade_question(q, rubric, layout_map, eval_model, page_ids)
                    verdict = attach_criteria_max(validate_and_cap(raw, q, layout_map), rubric)
                    option_letter.honour_option_letter(verdict, q)
                except cancellation.Cancelled:
                    raise
                except Exception as retry_err:
                    logger.exception(
                        f"Retry also failed for question {q.get('question_id')}",
                    )
                    # Never surface the raw exception (which can be a stack trace
                    # or provider error) as the student's feedback. Keep the
                    # detail in logs; give teacher/student a neutral, actionable
                    # message. status=FAILED lets the reviewer spot it.
                    verdict = {
                        "question_id": q["question_id"],
                        "marks_awarded": 0.0,
                        "max_marks": float(q.get("max_marks") or 0),
                        "extracted_answer": "",
                        "feedback": "This answer could not be evaluated automatically and needs manual review.",
                        "confidence": 0.0,
                        "criteria_breakdown": [],
                        "annotations": [],
                        "status": "FAILED",
                        # Diagnosis without pod logs. Still kept out of `feedback`
                        # so no provider error or stack trace reaches a student —
                        # this rides along to ai_question_evaluation instead, where
                        # only admins read it. Class name + message, not a trace.
                        "error_detail": describe_failure(retry_err),
                    }
            if (language_errors and language_feedback.applies_to_question(q)
                    and str(verdict.get("status") or "").upper() != "FAILED"):
                errors = language_feedback.errors_for_answer(
                    language_errors, verdict.get("answer_rows"), row_positions)
                if errors:
                    language_found[qid] = errors
            total_awarded += verdict["marks_awarded"]
            total_max += verdict["max_marks"]
            evaluated += 1
            verdict.setdefault("question_number", q.get("question_number") or evaluated)
            verdicts.append(verdict)
            sent[qid] = (float(verdict.get("marks_awarded") or 0), list(verdict.get("annotations") or []))
            # The language paragraph rides on the callback only: enforcement
            # below may build a deduction reason from the verdict's feedback,
            # and a language slip is never a reason for lost marks.
            reported = verdict
            if qid in language_found:
                reported = dict(verdict, feedback=language_feedback.with_language_feedback(
                    verdict.get("feedback"), language_found[qid]))
            await callbacks.question_done(
                callback_base, process_id, job_id, reported, rubric_version=rubric_version,
            )

        # 4. Burn the corrections onto the copy so the admin screens that resolve
        # a checked copy through evaluated_file_id have a file to show. Best
        # effort by design: grading is already done and reported, so a render or
        # upload failure returns None and the evaluation still completes.
        # Checkpoint first: a cancel that landed after the last question's check
        # would otherwise render, upload, and bill a copy the teacher stopped.
        cancellation.check(job_id, process_id)
        # Between the grader and the renderer: enforce.py makes the marking
        # correct whatever the model returned - exactly one score per attempted
        # question in the right margin, one deduction note below the answer,
        # praise only where the guide allows it, every annotation on a real
        # row. A question it still cannot place is reported and left without
        # ink; the copy ships anyway. Withholding the whole file for one gap
        # (the first rule here) sent teachers a bare scan with the on-screen
        # overlay instead of twenty checked answers.
        try:
            questions_meta = [{
                "question_id": q.get("question_id"),
                # section-qualified so "2" under Section B and "2" under Passage I
                # stay two different keys inside enforce
                "paper_label": paper_label_for(q) if (q.get("paper_label") or q.get("label")) else None,
                "max_marks": q.get("max_marks"),
                "question_type": q.get("question_type"),
            } for q in questions]
        except Exception:
            questions_meta = None
        # The paper's maximum: the request's paper_max, else derived from the
        # choice groups, else None (enforce sums every question, as before).
        paper_max = resolve_paper_max(questions, choice_groups, req.get("paper_max"))
        verdicts, _total, enforce_report, unmarked = apply_enforcement(
            verdicts, layout_map, questions_meta, paper_max=paper_max, choice_groups=choice_groups)
        if unmarked:
            logger.warning("copy-check %s: enforce could not place a mark for %s; shipping the copy without them",
                           process_id, unmarked)
        # Language corrections go on after enforcement, which keeps one remark
        # per answer and would drop them. They are not in the question
        # callbacks: the feedback there already lists them.
        for v in verdicts:
            errors = language_found.get(str(v.get("question_id")))
            if errors:
                v["feedback"] = language_feedback.with_language_feedback(v.get("feedback"), errors)
                v["annotations"] = (list(v.get("annotations") or [])
                                    + language_feedback.annotations(errors, v.get("question_id")))
        # Internal choice ("any 4 of 5"): an answer a choice group left out keeps
        # its own mark on the copy, so say beside it that it is not in the total.
        # Dashboard copies only; a partner's checked copy is drawn as before.
        for v in verdicts:
            if (is_api_actor(billing["billing_actor"]) or v.get("counted", True)
                    or str(v.get("status") or "").upper() == "FAILED"):
                continue
            score = next((a for a in v.get("annotations") or [] if a.get("style") == "score"), None)
            if score and score.get("target"):
                v["annotations"] = list(v["annotations"]) + [{
                    "style": "margin_note", "q": score.get("q"), "target": score["target"],
                    "page_id": score.get("page_id"), "placement": "below_line", "position": "below_line_left",
                    "text": NOT_COUNTED_NOTE, "anchor_text": score.get("anchor_text"),
                }]
        # The marks Java stores must be the marks on the checked copy (gate G9):
        # re-send every question enforcement changed or a choice group dropped,
        # before `complete` makes Java total the rows.
        revised = await _repost_revised(callback_base, process_id, job_id, verdicts, sent, rubric_version)
        if revised:
            logger.info("copy-check %s: re-sent %d question callback(s) after enforcement", process_id, revised)
        total_awarded = counted_awarded(verdicts)
        if paper_max is not None:
            total_max = paper_max
        # The "Teacher comments outside the copy" template; the default copy is
        # rendered exactly as before.
        panel = ({"comment_placement": "OUTSIDE", "question_labels": _printed_labels(questions)}
                 if str(req.get("comment_placement") or "").strip().upper() == "OUTSIDE" else {})
        evaluated_file_id = await annotator.render_and_upload(
            pdf_url, layout_map, verdicts, req.get("attempt_id") or process_id, **panel,
        )

        # 5. Done.
        await _stop_heartbeat()
        await callbacks.complete(
            callback_base, process_id, job_id,
            total_marks_awarded=round(total_awarded, 2),
            total_max_marks=round(total_max, 2),
            questions_evaluated=evaluated,
            evaluated_file_id=evaluated_file_id,
        )
        logger.info(
            "copy-check job %s complete: %s/%s, %d maths row(s) re-read, %d Mathpix crops used, %d tokens, billing %s",
            job_id, total_awarded, total_max, maths_rows_read, mathpix.used, grader.tokens_used,
            {k: v for k, v in billing.items() if k != "rate_snapshot"},
        )

        # Meter the copy: charge the institute's credits once per completed
        # evaluation. Dashboard: per graded question with real-token overage
        # (tool_cost_estimator "copy_check_evaluation"); API: every page of the
        # copy at a fixed price ("copy_check_evaluation_api"). Idempotent on
        # process_id so a retried complete callback never double-charges, and
        # best-effort so a billing error never fails a delivered evaluation
        # (the nightly reconciliation flags a completed copy left unbilled).
        # Cancelled/failed copies are intentionally not charged.
        plan = charge_plan(billing, typed=False, num_questions=evaluated,
                           layout_pages=_layout_page_count(layout_map))
        if plan is None:
            logger.warning("copy-check %s: API copy with no page count; not billed", process_id)
            return RUN_NO_CHARGE
        record_tool_billing(
            request_type=RequestType.EVALUATION,
            model=(preferred_model or eval_model),
            prompt_tokens=grader.prompt_tokens,
            completion_tokens=grader.completion_tokens,
            institute_id=institute_id,
            request_id=job_id,
            idempotency_key=process_id,
            **plan,
            **charge_metering(billing, req),
        )
        return RUN_BILLED
    except (cancellation.Cancelled, OcrCancelled):
        logger.info(f"copy-check job {job_id} cancelled")
        await _stop_heartbeat()
        await callbacks.failed(callback_base, process_id, job_id, "Cancelled by user",
                               error_code=FAILURE_CANCELLED)
        return RUN_FAILED
    except Exception as e:
        if isinstance(e, CopyCheckFailure):
            logger.warning("copy-check job %s failed (%s): %s", job_id, e.error_code, e)
        else:
            logger.exception(f"copy-check job {job_id} failed")
        await _stop_heartbeat()
        await callbacks.failed(callback_base, process_id, job_id, redact_urls(str(e)),
                               error_code=error_code_for(e))
        return RUN_FAILED
    finally:
        heartbeat.cancel()
        cancellation.cleanup(job_id, process_id=process_id)
