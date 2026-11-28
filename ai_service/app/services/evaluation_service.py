"""AI evaluation tool — migrated from media_service evaluation_ai
(AiEvaluationController + AiAnswerEvaluationService).

Lean (FE-parity) scope: the two endpoints the FE uses — evaluate-assessment
(async kickoff) and status/{taskId} (poll). We fetch assessment metadata from
assessment_service, run the two-step LLM (extract answers → score vs rubric) per
student, and track progress in ai_service's ai_task table, updating result_json
incrementally so the FE sees per-student status move
WAITING→EXTRACTING_ANSWER→EVALUATING→EVALUATION_COMPLETED on each poll.

Deliberately NOT ported (no FE caller / product decision): auth-service learner
account provisioning, the evaluation_user persistence table, and the
details/assessment/{id} endpoint. The FE-provided student id is used as user_id.

Model is resolved from the DB registry (use case "evaluation") — fixing the
retired google/gemini-2.5-flash-preview-09-2025 id media hardcoded. Billing is
attributed to the institute (media passed null).

Not reachable over HTTP: its only caller, the logged-out /evaluator-ai free
tool, was retired (2026-10-01) and its router is no longer mounted.
"""
from __future__ import annotations

import asyncio
import json
import logging
from typing import Any, Dict, List, Optional, Set
from uuid import uuid4

from ..db import db_session
from ..models.ai_task import AiTaskInputType, AiTaskStatus, AiTaskType
from ..models.ai_token_usage import RequestType
from ..repositories.ai_task_repository import AiTaskRepository
from . import ai_billing, ai_task_service, assessment_client, llm_json, pdf_questions_service
from .ai_prompts import evaluation as prompts
from .pdf_questions_service import StillProcessing

logger = logging.getLogger(__name__)

EVALUATION_USE_CASE = "evaluation"

# EvaluationStepsStatusEnum (per-student, lives inside the response JSON)
_WAITING = "WAITING"
_EXTRACTING = "EXTRACTING_ANSWER"
_EVALUATING = "EVALUATING"
_COMPLETED = "EVALUATION_COMPLETED"

# Map ai_task row status → the Java TaskStatusEnum names the FE expects.
_STATUS_OUT = {
    AiTaskStatus.PROGRESS.value: "PROCESSING",
    AiTaskStatus.COMPLETED.value: "COMPLETED",
    AiTaskStatus.FAILED.value: "FAILED",
}

# Hold strong refs to background runs so the loop doesn't GC them mid-flight.
_running: Set[asyncio.Task] = set()

# Bound concurrent evaluation runs (each processes its students sequentially with
# multiple LLM calls + DB writes) so a burst can't exhaust the shared DB pool —
# mirrors ai_task_service's MAX_CONCURRENT_TASKS. The task row + WAITING payload
# are created immediately on kickoff; only the actual work waits for a slot.
MAX_CONCURRENT_EVALUATIONS = 8
_eval_semaphore = asyncio.Semaphore(MAX_CONCURRENT_EVALUATIONS)


def _build_initial_data(users: List[Any]) -> List[Dict[str, Any]]:
    """One EvaluationData dict per student, all WAITING. Mirrors
    createEvaluationResultFromUsers (minus auth-service provisioning — the
    provided id is used as user_id)."""
    out: List[Dict[str, Any]] = []
    for u in users:
        out.append(
            {
                "user_id": u.id,
                "name": u.full_name,
                "email": u.email,
                "contact_number": u.contact_number,
                "response_id": u.response_id,
                "section_wise_ans_extracted": None,
                "evaluation_result": None,
                "status": _WAITING,
            }
        )
    return out


def _result_json(data: List[Dict[str, Any]]) -> str:
    """Serialize the EvaluationResultFromDeepSeek envelope the FE parses."""
    return json.dumps({"evaluation_data": data})


async def start_evaluation(
    *,
    assessment_id: str,
    users: List[Any],
    models: List[str],
    institute_id: Optional[str],
    user_id: Optional[str],
) -> Dict[str, Any]:
    """Kick off an evaluation. Fetches metadata, creates the task with the
    initial WAITING payload, spawns the background run, and returns the
    EvaluationRequestResponse dict immediately ({task_id, response, status})."""
    # Fetch assessment metadata (questions + per-question marking rubric).
    metadata = await assessment_client.get_evaluation_metadata(assessment_id)

    data = _build_initial_data(users)
    initial_json = _result_json(data)

    # Create the task row already carrying the WAITING payload (better than
    # media's empty-string seed: an immediate poll always parses).
    task_id = await asyncio.to_thread(_create_task, initial_json)

    # Fire the background run.
    bg = asyncio.create_task(
        _run_evaluation(
            task_id=task_id,
            metadata=metadata,
            data=data,
            models=models,
            institute_id=institute_id,
            user_id=user_id,
        )
    )
    _running.add(bg)
    bg.add_done_callback(_running.discard)

    logger.info("Started evaluation: taskId=%s assessmentId=%s users=%d", task_id, assessment_id, len(data))
    return {"task_id": task_id, "response": initial_json, "status": "PROCESSING"}


async def _run_evaluation(
    *,
    task_id: str,
    metadata: Dict[str, Any],
    data: List[Dict[str, Any]],
    models: List[str],
    institute_id: Optional[str],
    user_id: Optional[str],
) -> None:
    """Background: per student, convert answer sheet → extract → evaluate,
    updating the task's result_json after each step. Any failure fails the whole
    task (matches media's batch-level catch)."""
    sections = metadata.get("sections") or []
    # Bound concurrent runs so a burst can't exhaust the DB pool (the kickoff
    # already created the row + WAITING payload, so queued runs still show up).
    async with _eval_semaphore:
        try:
            for student in data:
                # STEP 1 — extract answers from the converted answer sheet
                student["status"] = _EXTRACTING
                await _persist(task_id, _result_json(data), AiTaskStatus.PROGRESS)

                html = await _answer_html(student.get("response_id"))
                extracted = await _extract(sections, html, models, institute_id, user_id)
                student["section_wise_ans_extracted"] = extracted
                await _persist(task_id, _result_json(data), AiTaskStatus.PROGRESS)

                # STEP 2 — score the extracted answers against the rubric
                student["status"] = _EVALUATING
                await _persist(task_id, _result_json(data), AiTaskStatus.PROGRESS)

                result = await _evaluate(extracted, metadata, models, institute_id, user_id)
                student["evaluation_result"] = result
                student["status"] = _COMPLETED
                await _persist(task_id, _result_json(data), AiTaskStatus.PROGRESS)

            await _persist(task_id, _result_json(data), AiTaskStatus.COMPLETED)
            logger.info("Evaluation completed: taskId=%s", task_id)
        except Exception as exc:  # noqa: BLE001
            logger.exception("Evaluation failed: taskId=%s", task_id)
            # Plain-string error payload (NOT JSON) — matches media; the FE
            # substring-checks for "File Still Processing".
            await _persist(task_id, f"Error occurred: {exc}", AiTaskStatus.FAILED)


async def _answer_html(response_id: Optional[str]) -> str:
    """Convert the student's answer-sheet pdfId to HTML (cached MathPix). Fails
    fast with the 'File Still Processing' message media uses if not yet done."""
    if not response_id:
        raise RuntimeError("Missing response_id for student answer sheet")
    try:
        return await pdf_questions_service.fetch_or_convert_html(response_id, allow_poll=False)
    except StillProcessing:
        raise RuntimeError("File Still Processing")


async def _extract(
    sections: List[Dict[str, Any]],
    html: str,
    models: List[str],
    institute_id: Optional[str],
    user_id: Optional[str],
) -> List[Dict[str, Any]]:
    prompt = prompts.build_extract_prompt(sections, html)
    sanitized, model_used, usage = await llm_json.generate_json(prompt, models, label="eval_extract")
    await _bill(model_used, usage, institute_id, user_id, "extract")
    parsed = json.loads(sanitized)
    return parsed if isinstance(parsed, list) else []


async def _evaluate(
    extracted: List[Dict[str, Any]],
    metadata: Dict[str, Any],
    models: List[str],
    institute_id: Optional[str],
    user_id: Optional[str],
) -> Dict[str, Any]:
    prompt = prompts.build_evaluate_prompt(extracted, metadata)
    sanitized, model_used, usage = await llm_json.generate_json(prompt, models, label="eval_score")
    await _bill(model_used, usage, institute_id, user_id, "evaluate")
    parsed = json.loads(sanitized)
    return parsed if isinstance(parsed, dict) else {}


async def _bill(model_used, usage, institute_id, user_id, step) -> None:
    await asyncio.to_thread(
        ai_billing.record_llm_billing,
        request_type=RequestType.EVALUATION,
        model=model_used,
        prompt_tokens=usage.get("prompt_tokens", 0),
        completion_tokens=usage.get("completion_tokens", 0),
        total_tokens=usage.get("total_tokens", 0),
        institute_id=institute_id,
        user_id=user_id,
        metadata={"feature": "evaluation", "step": step},
    )


# --- task DB helpers ---

def _create_task(initial_json: str) -> str:
    """Insert the EVALUATION task row (PROGRESS) seeded with the WAITING
    payload. input_id is a fresh UUID, mirroring media's createNewTask."""
    with db_session() as db:
        from ..models.ai_task import AiTask

        task = AiTask(
            id=str(uuid4()),
            task_type=AiTaskType.EVALUATION.value,
            status=AiTaskStatus.PROGRESS.value,
            input_id=str(uuid4()),
            input_type=AiTaskInputType.ASSESSMENT_EVALUATION.value,
            task_name="",
            result_json=initial_json,
            status_message="Processing",
        )
        db.add(task)
        db.commit()
        return task.id


def _persist(task_id: str, result_json: str, status: AiTaskStatus):
    """Async wrapper to write task state off the event loop."""
    return asyncio.to_thread(_persist_sync, task_id, result_json, status)


def _persist_sync(task_id: str, result_json: str, status: AiTaskStatus) -> None:
    # Delegate to the shared task-status writer so evaluation gets the same
    # bounded retry-on-transient-DB-error behavior as every other task type
    # (a failed terminal write would otherwise strand the row in PROGRESS).
    ai_task_service._set_status(task_id, status, result_json=result_json)


def get_task_update(db, task_id: str) -> Optional[Dict[str, Any]]:
    """status/{taskId}: map the ai_task row to the EvaluationRequestResponse
    shape. Returns None if not found (router → 404)."""
    task = AiTaskRepository(db).get(task_id)
    if not task:
        return None
    return {
        "task_id": task.id,
        "status": _STATUS_OUT.get(task.status, task.status),
        "response": task.result_json or "",
    }
