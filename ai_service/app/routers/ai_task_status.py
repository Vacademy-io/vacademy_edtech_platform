"""
AI task-status router — the polling half of the migrated contract.

Mirrors the subset of media_service /media-service/task-status/* that the
lecture flow uses: get-status, get-raw-result, get/lecture-plan. Responses are
byte-for-byte identical (camelCase keys, empty-string fallbacks) so the FE only
swaps the base URL.

These read ai_service's OWN ai_task table — they do NOT touch media_service's
task_status table. The FE points lecture-plan polling at AI_SERVICE_BASE_URL
only when the lecture planner has been cut over.
"""
from __future__ import annotations

import json
import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from ..db import db_dependency
from ..models.ai_task import AiTaskType
from ..repositories.ai_task_repository import AiTaskRepository
from ..schemas.ai_task import LecturePlanResponse
from ..schemas.lecture_feedback import LectureFeedbackResponse
from ..schemas.question_paper import AutoQuestionPaperResponse
from ..services.question_format import convert_to_question_paper_response

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/task-status", tags=["AI Task Status"])

# media_service TaskStatusManager#isBlankResultJson
_BLANK_RESULTS = {"", "{}", "[]"}


# Rows written by the retired, logged-out /evaluator-ai tool (per-student
# answers and scores). Nothing logged-in reads them, and these routes have no
# auth yet, so they answer 404 here instead of handing out the stored result.
_RETIRED_TASK_TYPES = {AiTaskType.EVALUATION.value}


def _get_task_or_404(db: Session, task_id: str):
    task = AiTaskRepository(db).get(task_id)
    if not task or task.task_type in _RETIRED_TASK_TYPES:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task Not Found")
    return task


@router.get("/get-all")
def get_all(
    instituteId: str = Query(...),
    taskType: Optional[str] = Query(None),
    db: Session = Depends(db_dependency),
) -> List[Dict[str, Any]]:
    """Mirror of TaskGetController#getAllTasks — lists this institute's AI tasks
    (optionally filtered by type), newest first, in the TaskStatusDto shape.

    NOTE: reads ONLY ai_service's ai_task table. During the phased migration the
    FE merges this with media_service's get-all for unfiltered (all-types)
    views so both Java- and Python-owned tasks appear in history.
    """
    tasks = AiTaskRepository(db).list_by_institute(instituteId, taskType)
    return [t.to_list_dto() for t in tasks]


@router.get("/get-status")
def get_status(taskId: str = Query(...), db: Session = Depends(db_dependency)) -> Dict[str, Any]:
    """Mirror of TaskGetController#getTaskStatus."""
    return _get_task_or_404(db, taskId).to_status_dict()


@router.get("/get-raw-result")
def get_raw_result(taskId: str = Query(...), db: Session = Depends(db_dependency)) -> Dict[str, Any]:
    """Mirror of TaskGetController#getRawResult."""
    return _get_task_or_404(db, taskId).to_raw_result_dict()


@router.get("/get/lecture-plan", response_model=LecturePlanResponse, response_model_exclude_none=False)
def get_lecture_plan(taskId: str = Query(...), db: Session = Depends(db_dependency)) -> LecturePlanResponse:
    """Mirror of TaskGetController#getLecturePlan via TaskStatusManager.

    Not-found -> 404. Blank/not-ready result -> empty plan. Parse failure ->
    empty plan (logged), matching the Java fallback behavior.
    """
    task = _get_task_or_404(db, taskId)
    raw = (task.result_json or "").strip()
    if raw in _BLANK_RESULTS:
        return LecturePlanResponse()
    try:
        return LecturePlanResponse.model_validate(json.loads(raw))
    except Exception as exc:  # noqa: BLE001
        logger.error("Failed to convert lecture plan for taskId=%s: %s", taskId, exc)
        return LecturePlanResponse()


@router.get("/get-result", response_model=AutoQuestionPaperResponse, response_model_exclude_none=False)
def get_result(taskId: str = Query(...), db: Session = Depends(db_dependency)) -> AutoQuestionPaperResponse:
    """Mirror of TaskGetController#getAllQuestions: convert the stored RAW LLM
    question JSON to AutoQuestionPaperResponse on read. Blank/parse failure →
    empty response (matches Java)."""
    task = _get_task_or_404(db, taskId)
    raw = (task.result_json or "").strip()
    if raw in _BLANK_RESULTS:
        return AutoQuestionPaperResponse()
    try:
        return convert_to_question_paper_response(raw)
    except Exception as exc:  # noqa: BLE001
        logger.error("Failed to convert questions for taskId=%s: %s", taskId, exc)
        return AutoQuestionPaperResponse()


@router.get("/get/lecture-feedback", response_model=LectureFeedbackResponse, response_model_exclude_none=False)
def get_lecture_feedback(taskId: str = Query(...), db: Session = Depends(db_dependency)) -> LectureFeedbackResponse:
    """Mirror of TaskGetController#getLectureFeedback. Not-found → 404;
    blank/not-ready or parse failure → empty feedback (matches Java fallback)."""
    task = _get_task_or_404(db, taskId)
    raw = (task.result_json or "").strip()
    if raw in _BLANK_RESULTS:
        return LectureFeedbackResponse()
    try:
        return LectureFeedbackResponse.model_validate(json.loads(raw))
    except Exception as exc:  # noqa: BLE001
        logger.error("Failed to convert lecture feedback for taskId=%s: %s", taskId, exc)
        return LectureFeedbackResponse()
