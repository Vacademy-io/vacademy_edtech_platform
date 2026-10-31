"""
SQLAlchemy model + enums for the generic AI async task tracker.

This is ai_service's own durable task table (in the admin_core_service DB it
already connects to). It deliberately mirrors the shape of media_service's
`task_status` table so the migrated polling endpoints can return a byte-for-byte
identical contract while keeping ownership of the row on the Python side.

Lifecycle: a kick-off endpoint inserts a row in PROGRESS, an asyncio worker
flips it to COMPLETED (with result_json) or FAILED (with status_message). A
startup sweep marks rows left PROGRESS by a crash/restart as FAILED so they
don't hang forever (strictly better than the Java executor, which leaks them).
"""
from __future__ import annotations

import json
from datetime import datetime
from enum import Enum
from typing import Any, Dict, Optional
from uuid import uuid4

from sqlalchemy import Column, String, Text, DateTime, Index
from sqlalchemy.orm import declarative_base

Base = declarative_base()


class AiTaskStatus(str, Enum):
    """Row status. Values match media_service `TaskStatusEnum` for contract
    parity on the polling endpoints (the kick-off RESPONSE separately reports
    the literal "STARTED", matching AiLectureController)."""
    PROGRESS = "PROGRESS"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"


class AiTaskType(str, Enum):
    """Task type. Mirrors media_service `TaskStatusTypeEnum`. Only the migrated
    types are listed; add entries here as more endpoints move over."""
    LECTURE_PLANNER = "LECTURE_PLANNER"
    LECTURE_FEEDBACK = "LECTURE_FEEDBACK"
    TEXT_TO_QUESTIONS = "TEXT_TO_QUESTIONS"
    PDF_TO_QUESTIONS = "PDF_TO_QUESTIONS"
    IMAGE_TO_QUESTIONS = "IMAGE_TO_QUESTIONS"
    AUDIO_TO_QUESTIONS = "AUDIO_TO_QUESTIONS"
    PDF_TO_QUESTIONS_WITH_TOPIC = "PDF_TO_QUESTIONS_WITH_TOPIC"
    SORT_QUESTIONS_TOPIC_WISE = "SORT_QUESTIONS_TOPIC_WISE"
    CHAT_WITH_PDF = "CHAT_WITH_PDF"
    EVALUATION = "EVALUATION"
    # i18n Phase 1 — content translation pipeline (translation_service.py).
    TRANSLATE_SLIDE = "TRANSLATE_SLIDE"
    TRANSLATE_QUESTION = "TRANSLATE_QUESTION"
    TRANSLATE_STRINGS = "TRANSLATE_STRINGS"
    # Knowledge Base ingestion (V435). Long-running by nature: a 300-page
    # scanned book means hundreds of OCR round-trips plus embedding and the
    # summary tree, so this can never run inside a request.
    KB_INGEST_SOURCE = "KB_INGEST_SOURCE"
    # Whole-paper generation from a knowledge-base blueprint. Async because a
    # 60-question paper is ~10 batched LLM calls — minutes, not seconds.
    KB_PAPER_GENERATE = "KB_PAPER_GENERATE"
    # HTML Document slide generation (routers/html_document.py). Runs detached
    # from the request so closing the tab doesn't lose a 3-10 min generation;
    # the client polls partial HTML + phase and re-attaches by slide id.
    HTML_DOC_GENERATE = "HTML_DOC_GENERATE"


class AiTaskInputType(str, Enum):
    """Input type. Mirrors media_service `TaskInputTypeEnum`."""
    PROMPT_ID = "PROMPT_ID"
    AUDIO_ID = "AUDIO_ID"
    PDF_ID = "PDF_ID"
    IMAGE_ID = "IMAGE_ID"
    ASSESSMENT_EVALUATION = "ASSESSMENT_EVALUATION"
    SLIDE_ID = "SLIDE_ID"


class AiTask(Base):
    """One async AI task. `result_json` holds the raw model output as a JSON
    string (kept as TEXT, not JSONB, to match the media_service contract where
    `/get-raw-result` returns the string verbatim)."""

    __tablename__ = "ai_task"

    id = Column(String(255), primary_key=True, default=lambda: str(uuid4()))
    task_type = Column("type", String(255), nullable=True, index=True)
    status = Column(String(255), nullable=True, index=True)
    institute_id = Column(String(255), nullable=True, index=True)
    result_json = Column(Text, nullable=True)
    input_id = Column(String(255), nullable=True)
    input_type = Column(String(255), nullable=True)
    task_name = Column(String(255), nullable=True)
    parent_id = Column(String(255), nullable=True, index=True)
    status_message = Column(Text, nullable=True)
    # Free-form JSON string for per-type request context (model used, request
    # params, etc.). Mirrors media_service `dynamic_values_map`.
    dynamic_values_map = Column(Text, nullable=True)

    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow, index=True)
    updated_at = Column(
        DateTime(timezone=True), nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow
    )

    def __repr__(self) -> str:
        return f"<AiTask(id={self.id}, type={self.task_type}, status={self.status})>"

    def has_result(self) -> bool:
        return bool(self.result_json)

    def to_status_dict(self) -> Dict[str, Any]:
        """camelCase status payload — matches media_service
        TaskGetController#getTaskStatus exactly (key set, casing, empty-string
        fallbacks, and the boolean `hasResult`)."""
        return {
            "taskId": self.id,
            "status": self.status or "",
            "statusMessage": self.status_message or "",
            "type": self.task_type or "",
            "taskName": self.task_name or "",
            "hasResult": self.has_result(),
            "createdAt": self.created_at.isoformat() if self.created_at else "",
            "updatedAt": self.updated_at.isoformat() if self.updated_at else "",
        }

    def to_raw_result_dict(self) -> Dict[str, Any]:
        """camelCase raw-result payload — matches TaskGetController#getRawResult."""
        return {
            "taskId": self.id,
            "status": self.status or "",
            "resultJson": self.result_json or "",
            "statusMessage": self.status_message or "",
        }

    def to_chat_response(self) -> Optional[Dict[str, Any]]:
        """Map a CHAT_WITH_PDF row to the ChatWithPdfResponse shape (snake_case)
        by reading {user, response} out of result_json. Mirrors
        TaskStatus.getPdfChatResponse: question = stored "user", response =
        stored "response", and parent_id is intentionally left null. Returns
        None if result_json is missing/unparseable so the caller can skip the
        row (matches the Java per-row try/catch that logs and drops bad rows
        rather than failing the whole list)."""
        raw = (self.result_json or "").strip()
        if not raw:
            return None
        try:
            data = json.loads(raw)
        except Exception:  # noqa: BLE001
            return None
        if not isinstance(data, dict):
            return None
        return {
            "id": self.id,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "question": data.get("user"),
            "response": data.get("response"),
            "parent_id": None,
        }

    def to_list_dto(self) -> Dict[str, Any]:
        """snake_case list item — matches media_service TaskStatusDto (the shape
        the FE AITaskIndividualListInterface expects), plus an additive `type`.
        file_detail is always null for migrated prompt-only tasks (no associated
        file)."""
        return {
            "id": self.id,
            "task_name": self.task_name,
            "institute_id": self.institute_id,
            # `type` is additive to the legacy media_service DTO: without it the
            # aggregated AI-tools history can't tell a topic-question task from a
            # lecture plan (input_type is only PROMPT_ID/PDF_ID/... for both), so
            # every card fell through to "open the tool fresh".
            "type": self.task_type,
            "status": self.status,
            "result_json": self.result_json,
            "input_id": self.input_id,
            "input_type": self.input_type,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
            "parent_id": self.parent_id,
            "file_detail": None,
        }


Index("idx_ai_task_institute_id", AiTask.institute_id)
Index("idx_ai_task_type", AiTask.task_type)
Index("idx_ai_task_status", AiTask.status)
Index("idx_ai_task_parent_id", AiTask.parent_id)
Index("idx_ai_task_created_at", AiTask.created_at)
