"""Question papers generated from a knowledge base (V441).

Three moments, three endpoints, and the credit cost is previewed at each one so
the number on screen always matches the button about to be pressed:

    POST /bases/{kb_id}/paper/blueprint   plan (or revise) — cheap, iterate freely
    POST /bases/{kb_id}/paper/generate    write the questions — async, the big spend
    POST /bases/{kb_id}/paper/regenerate  redo ONE question the teacher rejected

Generation is async because a 60-question paper is roughly ten batched LLM calls:
minutes, not seconds. It returns a task id; poll GET /paper-jobs/{task_id}.

Questions come back already run through `question_format.format_questions`, i.e.
the exact QuestionDTO shape the assessment builder consumes from every other AI
source — so saving to the question bank is the FE's existing
`POST /assessment-service/question-paper/manage/v1/add` call with no new Java.
"""
from __future__ import annotations

import json
import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..db import db_dependency, db_session
from ..models.ai_task import AiTaskInputType, AiTaskType
from ..models.ai_token_usage import RequestType
from ..repositories.ai_task_repository import AiTaskRepository
from ..services import ai_task_service
from ..services.ai_billing import UC, preflight_tool_credits, record_tool_billing
from ..services.ai_task_service import AiTaskService
from ..services.kb import generations as kb_generations
from ..services.kb import paper as kb_paper
from ..services.kb import paper_pdf as kb_paper_pdf
from ..services.kb import paper_publish as kb_paper_publish
from ..services.kb.repository import KbRepository
from .knowledge_base import Caller, get_caller, require_usable

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/knowledge-base/v1", tags=["knowledge-base-paper"])


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class PaperSpec(BaseModel):
    """What the teacher asked for, from the short intake form."""
    # A teacher thinks in QUESTIONS ("I want a 20-question test"); marks fall out
    # of the blueprint they then edit. total_marks stays accepted for callers
    # that prefer it, but total_questions is what the UI asks for.
    total_questions: Optional[int] = Field(None, ge=1, le=200)
    total_marks: Optional[int] = Field(None, ge=1, le=500)
    duration_minutes: Optional[int] = Field(None, ge=5, le=600)
    difficulty: Optional[str] = None          # EASY | MEDIUM | HARD | MIXED
    question_types: Optional[List[str]] = None
    grade: Optional[str] = None
    language: Optional[str] = None
    exam_style: Optional[str] = None          # e.g. "CBSE board pattern"
    # The teacher's own title; blank lets the planner name the paper.
    title: Optional[str] = Field(None, max_length=200)
    # Fixed mix, in paper order: [{question_type, count, marks_each, label?,
    # instruction?, difficulty?}]. Counts/marks are enforced, not suggested.
    type_plan: Optional[List[Dict[str, Any]]] = None
    # Optional share per chapter/topic id, e.g. {"<node_id>": 30}. Guidance only.
    weightage: Optional[Dict[str, float]] = None
    # The teacher's own "General Instructions" lines; replace the planner's.
    instructions: Optional[List[str]] = None


class BlueprintRequest(BaseModel):
    spec: PaperSpec = Field(default_factory=PaperSpec)
    selected_node_ids: Optional[List[str]] = None
    # Present on a REFINE: the blueprint currently on screen plus what to change.
    current_blueprint: Optional[Dict[str, Any]] = None
    instruction: Optional[str] = None
    institute_id: Optional[str] = None


class GenerateRequest(BaseModel):
    blueprint: Dict[str, Any]
    grade: Optional[str] = None
    # Draw a figure for questions the writer marks as needing one and the book
    # does not provide (slow: ~1 min per figure; billed per image). Off unless
    # the teacher asks — a wrong diagram on an exam is worse than none.
    generate_diagrams: bool = False
    institute_id: Optional[str] = None


class RegenerateRequest(BaseModel):
    """Redo one question, optionally nudged ('make it harder', 'use a diagram')."""
    blueprint_row: Dict[str, Any]
    instruction: Optional[str] = None
    grade: Optional[str] = None
    institute_id: Optional[str] = None


class ValidateRequest(BaseModel):
    blueprint: Dict[str, Any]
    questions: List[Dict[str, Any]]
    institute_id: Optional[str] = None


class FormatRequest(BaseModel):
    """One question the teacher edited by hand, in the raw (review-board) shape."""
    raw_question: Dict[str, Any]
    generation_id: Optional[str] = None
    institute_id: Optional[str] = None


class PaperPdfRequest(BaseModel):
    """The paper as it is on the review board right now — including questions
    rewritten since generation, which only the client holds."""
    blueprint: Dict[str, Any]
    questions: List[Dict[str, Any]]
    include_answer_key: bool = False
    show_marks: bool = True
    # Printed above the title. Defaults to the institute's own name.
    institute_name: Optional[str] = None
    # "A", "B"… for parallel sets; printed in a box at the top right.
    set_label: Optional[str] = Field(None, max_length=8)
    # Where the institute logo goes: faint watermark behind every page
    # (default), beside the name as a letterhead, or nowhere.
    logo_placement: str = "watermark"
    # The "Name / Roll No. / Date" line under the marks strip. Off by default:
    # most institutes hand the paper out digitally, not as an answer booklet.
    candidate_line: bool = False
    # Layout: "classic" (board sheet), "compact" (two-column, footer band) or
    # "coaching" (bordered two-column with inline answers). See paper_themes.
    theme: str = "classic"
    # Printed in the header where the layout has a Date field (dd-mm-yyyy or free text).
    exam_date: Optional[str] = Field(None, max_length=40)
    # "Class - 10th" line for the coaching layout; defaults from the curriculum book.
    grade_line: Optional[str] = Field(None, max_length=60)
    institute_id: Optional[str] = None


class PaperPublishRequest(PaperPdfRequest):
    """PaperPdfRequest plus the history row to remember the link on."""
    generation_id: Optional[str] = None


class GenerationPublishRequest(BaseModel):
    include_answer_key: bool = False
    show_marks: bool = True
    set_label: Optional[str] = Field(None, max_length=8)
    theme: str = "classic"
    exam_date: Optional[str] = Field(None, max_length=40)
    grade_line: Optional[str] = Field(None, max_length=60)
    institute_id: Optional[str] = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _preflight_or_402(db: Session, *, tool_key: str, params: dict, institute_id: str) -> dict:
    estimate = preflight_tool_credits(
        db, tool_key=tool_key, tool_params=params, institute_id=institute_id
    )
    if estimate.get("sufficient") is False:
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail={
                "message": (
                    f"This needs about {estimate['estimated_credits']:.0f} credits but "
                    f"only {estimate.get('current_balance', 0):.0f} are available. "
                    "Top up to continue."
                ),
                "estimate": estimate,
            },
        )
    return estimate


def _bill(
    tool_key: str, params: dict, *, model: Optional[str], usage: Dict[str, int],
    institute_id: str, user_id: Optional[str], idempotency_key: Optional[str] = None,
    metering: Any = None, kb_id: Optional[str] = None,
) -> None:
    record_tool_billing(
        tool_key=tool_key,
        tool_params=params,
        request_type=RequestType.ASSESSMENT,
        model=model or "unknown",
        prompt_tokens=int((usage or {}).get("prompt_tokens") or 0),
        completion_tokens=int((usage or {}).get("completion_tokens") or 0),
        institute_id=institute_id,
        user_id=user_id,
        user_role="ADMIN",
        idempotency_key=idempotency_key,
        # Usage-event attribution only; drawn figures are question images.
        use_case=UC.QUIZ_IMAGE if tool_key == "html_document_image" else UC.KB_QUESTION_PAPER,
        metering=metering,
        usage_context={"kb_id": kb_id, "feature": tool_key},
    )


def _assert_kb(db: Session, kb_id: str, institute_id: str) -> Dict[str, Any]:
    """Load a KB the caller may actually generate from.

    Every paper endpoint funnels through here, so the entitlement gate lives
    here too: a shared library the institute has not unlocked is a 402, and a
    new endpoint added later cannot forget the check.
    """
    repo = KbRepository(db)
    kb = repo.get_kb(kb_id, institute_id)
    if not kb:
        raise HTTPException(404, "Knowledge base not found")
    require_usable(repo, kb, institute_id)
    return kb


def _topic_label(repo: KbRepository, kb_id: str, node_ids: Optional[List[str]]) -> str:
    """Human name for the chosen topics, used as the retrieval subject.

    Retrieval is far sharper when it queries "Rotational Motion" than the name
    of a 400-page book, so the picked topics — not the knowledge base — decide
    what gets searched. Subtopics collapse to their parents to keep the label
    short when someone selects a whole branch.
    """
    if not node_ids:
        return ""
    wanted = set(node_ids)
    tree = repo.get_topic_tree(kb_id)
    picked_parents = [n["title"] for n in tree if n["id"] in wanted and n["title"]]
    if not picked_parents:
        # Only subtopics were selected — name them directly.
        picked_parents = [
            c["title"]
            for n in tree
            for c in (n.get("subtopics") or [])
            if c["id"] in wanted and c.get("title")
        ]
    if not picked_parents:
        return ""
    if len(picked_parents) <= 3:
        return ", ".join(picked_parents)
    return f"{', '.join(picked_parents[:3])} and {len(picked_parents) - 3} more"


# ---------------------------------------------------------------------------
# 1. Blueprint
# ---------------------------------------------------------------------------

@router.post("/bases/{kb_id}/paper/blueprint")
async def build_or_refine_blueprint(
    kb_id: str,
    body: BlueprintRequest,
    caller: Caller = Depends(get_caller),
    db: Session = Depends(db_dependency),
):
    """Plan a paper from the KB's chapter tree, or revise the current plan.

    The same endpoint serves the first build and every chat refinement — a
    refinement just carries `current_blueprint` plus `instruction`, and the
    planner returns the FULL updated plan so the teacher's earlier edits survive.
    """
    resolved = caller.require_institute(body.institute_id)
    _assert_kb(db, kb_id, resolved)
    _preflight_or_402(db, tool_key="kb_paper_blueprint", params={}, institute_id=resolved)

    current = (
        kb_paper.Blueprint.from_dict(body.current_blueprint)
        if body.current_blueprint
        else None
    )
    try:
        blueprint, usage, model = await kb_paper.build_blueprint(
            db,
            kb_id=kb_id,
            institute_id=resolved,
            spec=body.spec.model_dump(exclude_none=True),
            selected_node_ids=body.selected_node_ids,
            current=current,
            instruction=body.instruction,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        logger.exception("Blueprint failed for kb=%s", kb_id)
        raise HTTPException(502, "The paper plan could not be generated. Please try again.") from exc

    _bill("kb_paper_blueprint", {}, model=model, usage=usage,
          institute_id=resolved, user_id=caller.user_id, metering=getattr(caller, "metering", None), kb_id=kb_id)

    # What generating THIS plan will cost, so the teacher sees it on the button
    # before committing rather than after.
    estimate = preflight_tool_credits(
        db, tool_key="kb_paper_questions",
        tool_params={"num_questions": blueprint.total_questions},
        institute_id=resolved,
        # Display only, after the blueprint was made and billed: a usage limit
        # must not throw that work away (generate checks the limit itself).
        enforce_limits=False,
    )
    return {"blueprint": blueprint.to_dict(), "generation_estimate": estimate}


# ---------------------------------------------------------------------------
# 2. Generate
# ---------------------------------------------------------------------------

@router.post("/bases/{kb_id}/paper/generate", status_code=202)
async def generate_paper(
    kb_id: str,
    body: GenerateRequest,
    caller: Caller = Depends(get_caller),
    db: Session = Depends(db_dependency),
):
    """Write every question in the blueprint. Async — poll GET /paper-jobs/{id}."""
    resolved = caller.require_institute(body.institute_id)
    _assert_kb(db, kb_id, resolved)

    blueprint = kb_paper.Blueprint.from_dict(body.blueprint)
    if blueprint.total_questions <= 0:
        raise HTTPException(400, "This plan has no questions in it")
    if blueprint.total_questions > kb_paper.MAX_QUESTIONS_PER_PAPER:
        raise HTTPException(
            400,
            f"This plan has {blueprint.total_questions} questions; the limit per paper "
            f"is {kb_paper.MAX_QUESTIONS_PER_PAPER}. Reduce some counts first.",
        )
    _preflight_or_402(
        db, tool_key="kb_paper_questions",
        params={"num_questions": blueprint.total_questions}, institute_id=resolved,
    )

    task = AiTaskService(AiTaskRepository(db)).create(
        task_type=AiTaskType.KB_PAPER_GENERATE,
        input_id=kb_id,
        input_type=AiTaskInputType.PROMPT_ID,
        task_name=f"Question paper — {blueprint.title}",
        institute_id=resolved,
        dynamic_values={"kb_id": kb_id, "user_id": caller.user_id},
    )
    task_id = str(task.id)
    user_id = caller.user_id
    grade = body.grade
    generate_diagrams = body.generate_diagrams

    # Record the run BEFORE it starts, so a generation that fails or that the
    # user navigates away from is still visible and resumable. input_json keeps
    # the blueprint — resuming restores the PLAN, not just the output.
    generation_id = kb_generations.create(
        db,
        kb_id=kb_id,
        institute_id=resolved,
        artifact_type="QUESTION_PAPER",
        title=blueprint.title,
        status="GENERATING",
        input_payload={
            "blueprint": blueprint.to_dict(), "grade": grade,
            "generate_diagrams": body.generate_diagrams,
        },
        ai_task_id=task_id,
        items_planned=blueprint.total_questions,
        created_by=user_id,
    )

    async def work() -> str:
        try:
            return await _run_generation()
        except Exception as exc:
            # ai_task records FAILED too, but that row is not surfaced anywhere.
            # THIS is what the teacher sees, so it must never be left stuck on
            # GENERATING — a spinner that never resolves is the exact failure
            # mode this history exists to remove.
            if generation_id:
                with db_session() as hist_db:
                    kb_generations.update(
                        hist_db, generation_id, status="FAILED",
                        error_message=str(exc)[:2000],
                    )
            raise

    async def _run_generation() -> str:
        with db_session() as job_db:
            generated = await kb_paper.generate_questions(
                job_db, kb_id=kb_id, institute_id=resolved,
                blueprint=blueprint, grade=grade,
                generate_diagrams=generate_diagrams,
            )
            issues = kb_paper.validate_paper(blueprint, generated.questions)

        # Charge on questions DELIVERED, never on questions planned — a paper
        # the material could only half-support must not cost a full paper.
        if generated.questions:
            _bill(
                "kb_paper_questions",
                {"num_questions": len(generated.questions)},
                model=generated.model,
                usage={
                    "prompt_tokens": generated.prompt_tokens,
                    "completion_tokens": generated.completion_tokens,
                },
                institute_id=resolved, user_id=user_id, metering=getattr(caller, "metering", None), kb_id=kb_id,
                # Keyed on the task, so a retry of the same job cannot double-charge.
                idempotency_key=f"kb_paper:{task_id}",
            )
        # Drawn figures are real image-model spend, priced like document
        # illustrations (same tool key, per image that actually came back).
        if generated.diagrams_drawn:
            _bill(
                "html_document_image",
                {"num_images": generated.diagrams_drawn},
                model="image",
                usage={"prompt_tokens": 0, "completion_tokens": 0},
                institute_id=resolved, user_id=user_id, metering=getattr(caller, "metering", None), kb_id=kb_id,
                idempotency_key=f"kb_paper_diagrams:{task_id}",
            )

        # Paired so `questions[i]` always describes `raw_questions[i]`. The review
        # board maps a rewritten question back by index, so a silent skip inside
        # the formatter would otherwise replace the WRONG question.
        raw_kept, formatted, format_warnings = kb_paper.pair_with_formatted(
            generated.questions, kb_id=kb_id, generation_id=generation_id
        )
        payload = {
            "blueprint": blueprint.to_dict(),
            # Assessment-builder shape, identical to every other AI source.
            "questions": formatted,
            # The raw shape keeps kb_meta (citations, figures) for the review board.
            "raw_questions": raw_kept,
            "issues": [
                {
                    "question_number": i.question_number, "severity": i.severity,
                    "kind": i.kind, "message": i.message,
                }
                for i in issues
            ],
            "warnings": generated.warnings + format_warnings,
            "delivered": len(formatted),
            "planned": blueprint.total_questions,
        }
        if generation_id:
            with db_session() as hist_db:
                kb_generations.update(
                    hist_db, generation_id,
                    status="READY" if formatted else "FAILED",
                    progress=100,
                    result_payload=payload,
                    items_delivered=len(formatted),
                    error_message=None if formatted else
                    "No questions could be written from the selected material.",
                )
        return json.dumps(payload)

    ai_task_service.schedule(task_id, work)
    # generation_id is returned so the caller can mark the run SAVED once the questions
    # land somewhere. The section endpoint below already did this; without it here, a
    # whole-paper run stayed READY forever in the history even after it was used.
    return {
        "task_id": task_id,
        "status": "PROGRESS",
        "generation_id": generation_id,
        "planned": blueprint.total_questions,
    }


class SectionRequest(BaseModel):
    """Fill ONE assessment section from a knowledge base.

    Deliberately not a blueprint: the assessment already has sections with their
    own marks and duration, so re-planning sections inside one of them would
    fight the existing UI. The teacher states what this section needs and it is
    generated directly — which also skips the planning LLM call entirely.
    """
    selected_node_ids: Optional[List[str]] = None   # topics/subtopics; empty = whole KB
    count: int = Field(10, ge=1, le=60)
    question_type: str = "MCQS"
    difficulty: str = "MEDIUM"
    marks_each: float = Field(1, ge=0)
    section_title: Optional[str] = Field(None, max_length=200)
    grade: Optional[str] = None
    language: Optional[str] = None
    institute_id: Optional[str] = None


@router.post("/bases/{kb_id}/paper/section", status_code=202)
async def generate_for_section(
    kb_id: str,
    body: SectionRequest,
    caller: Caller = Depends(get_caller),
    db: Session = Depends(db_dependency),
):
    """Generate questions for one assessment section. Poll GET /paper-jobs/{id}.

    Returns the same result shape as whole-paper generation, so the review board
    is shared between the standalone builder and the assessment flow.
    """
    resolved = caller.require_institute(body.institute_id)
    kb = _assert_kb(db, kb_id, resolved)
    repo = KbRepository(db)

    qtype = (body.question_type or "MCQS").upper()
    if qtype not in kb_paper.QUESTION_TYPES:
        raise HTTPException(400, f"question_type must be one of {kb_paper.QUESTION_TYPES}")

    # Name the row after the topics actually chosen, so retrieval queries the
    # subject the teacher picked rather than the knowledge base as a whole.
    topic_label = _topic_label(repo, kb_id, body.selected_node_ids) or kb["name"]

    blueprint = kb_paper.Blueprint(
        title=body.section_title or f"{topic_label} — {body.count} questions",
        language=body.language,
        rows=[
            kb_paper.BlueprintRow(
                id="section-1",
                section=body.section_title or "Section",
                topic=topic_label,
                node_ids=list(body.selected_node_ids or []),
                question_type=qtype,
                count=body.count,
                marks_each=body.marks_each,
                difficulty=(body.difficulty or "MEDIUM").upper(),
            )
        ],
    )
    _preflight_or_402(
        db, tool_key="kb_paper_questions",
        params={"num_questions": body.count}, institute_id=resolved,
    )

    task = AiTaskService(AiTaskRepository(db)).create(
        task_type=AiTaskType.KB_PAPER_GENERATE,
        input_id=kb_id,
        input_type=AiTaskInputType.PROMPT_ID,
        task_name=f"Assessment section — {topic_label}",
        institute_id=resolved,
        dynamic_values={"kb_id": kb_id, "user_id": caller.user_id, "mode": "section"},
    )
    task_id = str(task.id)
    user_id = caller.user_id
    grade = body.grade

    generation_id = kb_generations.create(
        db,
        kb_id=kb_id, institute_id=resolved,
        artifact_type="ASSESSMENT",
        title=blueprint.title,
        status="GENERATING",
        input_payload={
            "blueprint": blueprint.to_dict(),
            "grade": grade,
            "mode": "section",
            "selected_node_ids": body.selected_node_ids or [],
        },
        ai_task_id=task_id,
        items_planned=body.count,
        created_by=user_id,
    )

    async def work() -> str:
        try:
            with db_session() as job_db:
                generated = await kb_paper.generate_questions(
                    job_db, kb_id=kb_id, institute_id=resolved,
                    blueprint=blueprint, grade=grade,
                )
                issues = kb_paper.validate_paper(blueprint, generated.questions)

            if generated.questions:
                _bill(
                    "kb_paper_questions", {"num_questions": len(generated.questions)},
                    model=generated.model,
                    usage={
                        "prompt_tokens": generated.prompt_tokens,
                        "completion_tokens": generated.completion_tokens,
                    },
                    institute_id=resolved, user_id=user_id, metering=getattr(caller, "metering", None), kb_id=kb_id,
                    idempotency_key=f"kb_paper:{task_id}",
                )

            raw_kept, formatted, format_warnings = kb_paper.pair_with_formatted(
                generated.questions, kb_id=kb_id, generation_id=generation_id
            )
            payload = {
                "blueprint": blueprint.to_dict(),
                "questions": formatted,
                "raw_questions": raw_kept,
                "issues": [
                    {
                        "question_number": i.question_number, "severity": i.severity,
                        "kind": i.kind, "message": i.message,
                    }
                    for i in issues
                ],
                "warnings": generated.warnings + format_warnings,
                "delivered": len(formatted),
                "planned": body.count,
            }
            if generation_id:
                with db_session() as hist_db:
                    kb_generations.update(
                        hist_db, generation_id,
                        status="READY" if formatted else "FAILED",
                        progress=100, result_payload=payload,
                        items_delivered=len(formatted),
                        error_message=None if formatted else
                        "No questions could be written from the selected topics.",
                    )
            return json.dumps(payload)
        except Exception as exc:
            if generation_id:
                with db_session() as hist_db:
                    kb_generations.update(
                        hist_db, generation_id, status="FAILED",
                        error_message=str(exc)[:2000],
                    )
            raise

    ai_task_service.schedule(task_id, work)
    return {
        "task_id": task_id,
        "status": "PROGRESS",
        "generation_id": generation_id,
        "planned": body.count,
    }


@router.get("/paper-jobs/{task_id}")
async def get_paper_job(
    task_id: str,
    institute_id: Optional[str] = Query(None),
    caller: Caller = Depends(get_caller),
    db: Session = Depends(db_dependency),
):
    """Poll a generation job. Returns the paper once status is COMPLETED."""
    resolved = caller.require_institute(institute_id)
    task = AiTaskRepository(db).get(task_id)
    if not task or task.institute_id != resolved:
        raise HTTPException(404, "Job not found")

    payload: Optional[Dict[str, Any]] = None
    if task.result_json:
        try:
            payload = json.loads(task.result_json)
        except Exception:  # noqa: BLE001
            payload = None
    return {
        "task_id": task_id,
        "status": task.status,
        "status_message": task.status_message,
        "result": payload,
    }


# ---------------------------------------------------------------------------
# 3. Regenerate one question
# ---------------------------------------------------------------------------

@router.post("/bases/{kb_id}/paper/regenerate")
async def regenerate_question(
    kb_id: str,
    body: RegenerateRequest,
    caller: Caller = Depends(get_caller),
    db: Session = Depends(db_dependency),
):
    """Rewrite a single question the teacher rejected.

    Deliberately cheap and synchronous: one question is a few seconds, and if
    fixing a bad question felt expensive teachers would keep it instead — which
    is exactly what makes generated papers feel untrustworthy.
    """
    resolved = caller.require_institute(body.institute_id)
    _assert_kb(db, kb_id, resolved)
    _preflight_or_402(db, tool_key="kb_paper_regenerate", params={}, institute_id=resolved)

    row = kb_paper.BlueprintRow.from_dict(body.blueprint_row)
    row.count = 1
    if body.instruction:
        row.instruction = f"{row.instruction or ''} {body.instruction}".strip()

    single = kb_paper.Blueprint(
        title="regenerate", rows=[row],
        language=body.blueprint_row.get("language"),
    )
    generated = await kb_paper.generate_questions(
        db, kb_id=kb_id, institute_id=resolved, blueprint=single, grade=body.grade
    )
    if not generated.questions:
        raise HTTPException(
            422,
            "No suitable question could be written for that topic from this material. "
            "Try widening the chapter selection or changing the question type.",
        )

    # Format BEFORE billing: a question that cannot be converted is not a
    # delivered question, and charging for it would be charging for nothing.
    raw_kept, formatted, _ = kb_paper.pair_with_formatted(generated.questions[:1], kb_id=kb_id)
    if not formatted:
        raise HTTPException(
            422,
            "The rewritten question came back malformed. Please try again.",
        )

    _bill("kb_paper_regenerate", {}, model=generated.model,
          usage={"prompt_tokens": generated.prompt_tokens,
                 "completion_tokens": generated.completion_tokens},
          institute_id=resolved, user_id=caller.user_id, metering=getattr(caller, "metering", None), kb_id=kb_id)

    return {"question": formatted[0], "raw_question": raw_kept[0]}


# ---------------------------------------------------------------------------
# History — what this knowledge base has produced
#
# Artifact-agnostic on purpose: these endpoints know nothing about question
# papers. A future course generator writes rows with artifact_type='COURSE' and
# gets listing, resume and deletion for free.
# ---------------------------------------------------------------------------

class GenerationUpdate(BaseModel):
    title: Optional[str] = Field(None, max_length=500)
    status: Optional[str] = None
    external_id: Optional[str] = None
    external_type: Optional[str] = None
    institute_id: Optional[str] = None


@router.get("/bases/{kb_id}/generations")
async def list_generations(
    kb_id: str,
    artifact_type: Optional[str] = Query(None, description="e.g. QUESTION_PAPER"),
    limit: int = Query(50, ge=1, le=200),
    institute_id: Optional[str] = Query(None),
    caller: Caller = Depends(get_caller),
    db: Session = Depends(db_dependency),
):
    """Everything created from this knowledge base, newest first.

    Result payloads are omitted — a list of 50 papers would otherwise be
    megabytes. Fetch one record to get its blueprint and questions.
    """
    resolved = caller.require_institute(institute_id)
    _assert_kb(db, kb_id, resolved)
    return {
        "generations": kb_generations.list_for_kb(
            db, kb_id, resolved, artifact_type=artifact_type, limit=limit
        )
    }


@router.get("/generations/{generation_id}")
async def get_generation(
    generation_id: str,
    institute_id: Optional[str] = Query(None),
    caller: Caller = Depends(get_caller),
    db: Session = Depends(db_dependency),
):
    """One record WITH its input and result — this is what Resume reads."""
    resolved = caller.require_institute(institute_id)
    record = kb_generations.get(db, generation_id, resolved)
    if not record:
        raise HTTPException(404, "Not found")
    return record


@router.patch("/generations/{generation_id}")
async def update_generation(
    generation_id: str,
    body: GenerationUpdate,
    caller: Caller = Depends(get_caller),
    db: Session = Depends(db_dependency),
):
    """Rename, or record where the artifact ended up once saved.

    The FE calls this after a successful save to the question bank so the history
    can link straight to the saved paper instead of offering to save it again.
    """
    resolved = caller.require_institute(body.institute_id)
    if not kb_generations.get(db, generation_id, resolved):
        raise HTTPException(404, "Not found")
    if body.status is not None and body.status not in kb_generations.STATUSES:
        raise HTTPException(400, f"status must be one of {kb_generations.STATUSES}")
    kb_generations.update(
        db, generation_id,
        title=body.title, status=body.status,
        external_id=body.external_id, external_type=body.external_type,
    )
    return kb_generations.get(db, generation_id, resolved)


@router.delete("/generations/{generation_id}")
async def delete_generation(
    generation_id: str,
    institute_id: Optional[str] = Query(None),
    caller: Caller = Depends(get_caller),
    db: Session = Depends(db_dependency),
):
    """Remove a history entry. Does NOT delete anything already saved elsewhere —
    a paper in the question bank stays there."""
    resolved = caller.require_institute(institute_id)
    if not kb_generations.delete(db, generation_id, resolved):
        raise HTTPException(404, "Not found")
    return {"deleted": True}


# ---------------------------------------------------------------------------
# 3a. Format — a hand-edited question back into the shape the bank stores
# ---------------------------------------------------------------------------

@router.post("/bases/{kb_id}/paper/format")
async def format_edited_question(
    kb_id: str,
    body: FormatRequest,
    caller: Caller = Depends(get_caller),
    db: Session = Depends(db_dependency),
):
    """The review board lets a teacher edit a question's text, options, answer
    and marking scheme. The formatted QuestionDTO the bank stores must follow
    that edit, and the only safe way is the same formatter generation uses —
    hand-building the DTO on the client is how MCQ answers went missing before.
    Not metered: no model call."""
    resolved = caller.require_institute(body.institute_id)
    _assert_kb(db, kb_id, resolved)
    raw_kept, formatted, _ = kb_paper.pair_with_formatted(
        [body.raw_question], kb_id=kb_id, generation_id=body.generation_id
    )
    if not formatted:
        raise HTTPException(422, "That question could not be converted. Check its options and answer.")
    return {"question": formatted[0], "raw_question": raw_kept[0]}


# ---------------------------------------------------------------------------
# 3b. PDF — the paper as a sheet (free — no model call)
# ---------------------------------------------------------------------------

def _pdf_response(pdf: bytes, filename: str) -> Response:
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Cache-Control": "no-store",
        },
    )


async def _render_paper(
    db: Session,
    kb: Dict[str, Any],
    institute_id: str,
    blueprint_raw: Dict[str, Any],
    questions: List[Dict[str, Any]],
    *,
    include_answer_key: bool,
    show_marks: bool,
    institute_name: Optional[str],
    set_label: Optional[str],
    logo_placement: str = "watermark",
    candidate_line: bool = False,
    theme: str = "classic",
    exam_date: Optional[str] = None,
    grade_line: Optional[str] = None,
) -> Response:
    if not questions:
        raise HTTPException(400, "There are no questions to print")
    blueprint = kb_paper.Blueprint.from_dict(blueprint_raw)
    try:
        pdf = await kb_paper_publish.render_branded_pdf(
            db, kb, institute_id, blueprint, questions,
            include_answer_key=include_answer_key, show_marks=show_marks,
            institute_name=institute_name, set_label=set_label,
            logo_placement=logo_placement, candidate_line=candidate_line,
            theme=theme, exam_date=exam_date, grade_line=grade_line,
        )
    except Exception as exc:  # noqa: BLE001 — surface as a 503, keep the trace
        logger.exception("paper PDF render failed for kb %s", kb.get("id"))
        raise HTTPException(503, "Could not render the PDF right now. Please try again.") from exc
    return _pdf_response(pdf, kb_paper_pdf.paper_filename(blueprint.title, with_key=include_answer_key))


def _generation_paper(db: Session, generation_id: str, institute_id: str):
    """(record, blueprint_raw, raw_questions) for a finished paper, or 404/409."""
    record = kb_generations.get(db, generation_id, institute_id)
    if not record:
        raise HTTPException(404, "Not found")
    result = record.get("result") or {}
    questions = result.get("raw_questions") or []
    blueprint_raw = (record.get("input") or {}).get("blueprint") or result.get("blueprint") or {}
    if not questions or not blueprint_raw:
        raise HTTPException(409, "This paper has no generated questions to print yet")
    return record, blueprint_raw, questions


async def _publish(
    db: Session,
    kb: Dict[str, Any],
    institute_id: str,
    blueprint_raw: Dict[str, Any],
    questions: List[Dict[str, Any]],
    *,
    include_answer_key: bool,
    show_marks: bool,
    set_label: Optional[str],
    generation_id: Optional[str],
    theme: str = "classic",
    exam_date: Optional[str] = None,
    grade_line: Optional[str] = None,
) -> Dict[str, Any]:
    if not questions:
        raise HTTPException(400, "There are no questions to publish")
    try:
        return await kb_paper_publish.publish_paper(
            db, kb, institute_id, kb_paper.Blueprint.from_dict(blueprint_raw), questions,
            include_answer_key=include_answer_key, show_marks=show_marks,
            set_label=(set_label or "").strip() or None, generation_id=generation_id,
            theme=theme, exam_date=exam_date, grade_line=grade_line,
        )
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        logger.exception("paper publish failed for kb %s", kb.get("id"))
        raise HTTPException(503, "Could not publish the paper right now. Please try again.") from exc


@router.post("/bases/{kb_id}/paper/pdf")
async def paper_pdf(
    kb_id: str,
    body: PaperPdfRequest,
    caller: Caller = Depends(get_caller),
    db: Session = Depends(db_dependency),
):
    """The paper on screen as a print-ready A4 PDF (optionally with the answer
    key and marking scheme on its own pages). Not metered: layout, not a model
    call. Takes the client's copy because rewrites live only there until the
    paper is saved."""
    resolved = caller.require_institute(body.institute_id)
    kb = _assert_kb(db, kb_id, resolved)
    return await _render_paper(
        db, kb, resolved, body.blueprint, body.questions,
        include_answer_key=body.include_answer_key, show_marks=body.show_marks,
        institute_name=body.institute_name, set_label=body.set_label,
        logo_placement=body.logo_placement, candidate_line=body.candidate_line,
        theme=body.theme, exam_date=body.exam_date, grade_line=body.grade_line,
    )


@router.get("/generations/{generation_id}/paper.pdf")
async def generation_paper_pdf(
    generation_id: str,
    include_answer_key: bool = Query(False),
    show_marks: bool = Query(True),
    set_label: Optional[str] = Query(None, max_length=8),
    logo_placement: str = Query("watermark"),
    candidate_line: bool = Query(False),
    theme: str = Query("classic"),
    exam_date: Optional[str] = Query(None, max_length=40),
    grade_line: Optional[str] = Query(None, max_length=60),
    institute_id: Optional[str] = Query(None),
    caller: Caller = Depends(get_caller),
    db: Session = Depends(db_dependency),
):
    """A finished paper from the history, straight to PDF — no need to reopen
    it on the review board first."""
    resolved = caller.require_institute(institute_id)
    record, blueprint_raw, questions = _generation_paper(db, generation_id, resolved)
    kb = _assert_kb(db, record["knowledge_base_id"], resolved)
    return await _render_paper(
        db, kb, resolved, blueprint_raw, questions,
        include_answer_key=include_answer_key, show_marks=show_marks,
        institute_name=None, set_label=set_label,
        logo_placement=logo_placement, candidate_line=candidate_line,
        theme=theme, exam_date=exam_date, grade_line=grade_line,
    )


@router.post("/bases/{kb_id}/paper/publish")
async def publish_paper(
    kb_id: str,
    body: PaperPublishRequest,
    caller: Caller = Depends(get_caller),
    db: Session = Depends(db_dependency),
):
    """Put the paper on screen behind a link anyone can open (public media
    bucket + short link), and remember it on the history row when one is
    given. Not metered."""
    resolved = caller.require_institute(body.institute_id)
    kb = _assert_kb(db, kb_id, resolved)
    if body.generation_id and not kb_generations.get(db, body.generation_id, resolved):
        raise HTTPException(404, "Not found")
    return await _publish(
        db, kb, resolved, body.blueprint, body.questions,
        include_answer_key=body.include_answer_key, show_marks=body.show_marks,
        set_label=body.set_label, generation_id=body.generation_id,
        theme=body.theme, exam_date=body.exam_date, grade_line=body.grade_line,
    )


@router.post("/generations/{generation_id}/paper/publish")
async def publish_generation_paper(
    generation_id: str,
    body: GenerationPublishRequest,
    caller: Caller = Depends(get_caller),
    db: Session = Depends(db_dependency),
):
    """Publish a finished paper straight from the history."""
    resolved = caller.require_institute(body.institute_id)
    record, blueprint_raw, questions = _generation_paper(db, generation_id, resolved)
    kb = _assert_kb(db, record["knowledge_base_id"], resolved)
    return await _publish(
        db, kb, resolved, blueprint_raw, questions,
        include_answer_key=body.include_answer_key, show_marks=body.show_marks,
        set_label=body.set_label, generation_id=generation_id,
        theme=body.theme, exam_date=body.exam_date, grade_line=body.grade_line,
    )


# ---------------------------------------------------------------------------
# 4. Validate (free — deterministic, no LLM)
# ---------------------------------------------------------------------------

@router.post("/bases/{kb_id}/paper/validate")
async def validate_paper(
    kb_id: str,
    body: ValidateRequest,
    caller: Caller = Depends(get_caller),
    db: Session = Depends(db_dependency),
):
    """Re-check a paper after the teacher has edited it. Not metered: this is
    arithmetic and string comparison, not a model call."""
    resolved = caller.require_institute(body.institute_id)
    _assert_kb(db, kb_id, resolved)
    issues = kb_paper.validate_paper(
        kb_paper.Blueprint.from_dict(body.blueprint), body.questions
    )
    return {
        "issues": [
            {
                "question_number": i.question_number, "severity": i.severity,
                "kind": i.kind, "message": i.message,
            }
            for i in issues
        ],
        "error_count": sum(1 for i in issues if i.severity == "error"),
        "warning_count": sum(1 for i in issues if i.severity == "warning"),
    }
