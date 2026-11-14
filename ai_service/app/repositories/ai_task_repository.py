"""
Repository for the ai_task table — all DB access for AI async tasks goes
through here so the service layer stays free of SQL/session details.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import List, Optional

from sqlalchemy import or_, text
from sqlalchemy.orm import Session

from ..models.ai_task import AiTask, AiTaskInputType, AiTaskStatus, AiTaskType

logger = logging.getLogger(__name__)


# DDL kept in sync with app/migrations/2026-05-30_add_ai_task_table.sql. Run at
# startup (idempotent) so the feature works without a manual migration step.
# NOTE: one statement per list entry — psycopg3's extended protocol rejects
# multiple commands in a single execute().
_ENSURE_TABLE_STATEMENTS = [
    """
    CREATE TABLE IF NOT EXISTS ai_task (
        id                 VARCHAR(255) PRIMARY KEY,
        "type"             VARCHAR(255),
        status             VARCHAR(255),
        institute_id       VARCHAR(255),
        result_json        TEXT,
        input_id           VARCHAR(255),
        input_type         VARCHAR(255),
        task_name          VARCHAR(255),
        parent_id          VARCHAR(255),
        status_message     TEXT,
        dynamic_values_map TEXT,
        created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
    )
    """,
    'CREATE INDEX IF NOT EXISTS idx_ai_task_institute_id ON ai_task(institute_id)',
    'CREATE INDEX IF NOT EXISTS idx_ai_task_type         ON ai_task("type")',
    'CREATE INDEX IF NOT EXISTS idx_ai_task_status       ON ai_task(status)',
    'CREATE INDEX IF NOT EXISTS idx_ai_task_parent_id    ON ai_task(parent_id)',
    'CREATE INDEX IF NOT EXISTS idx_ai_task_created_at   ON ai_task(created_at)',
]

_SEED_LECTURE_DEFAULT_SQL = """
INSERT INTO ai_model_defaults (use_case, default_model_id, fallback_model_id, free_tier_model_id, description)
VALUES ('lecture', 'google/gemini-2.5-flash', 'openai/gpt-4o-mini', NULL,
        'Lecture planning and feedback generation (migrated from media_service).')
ON CONFLICT (use_case) DO NOTHING;
"""


def ensure_ai_task_schema(db: Session) -> None:
    """Create the ai_task table + seed the lecture default if missing.
    Idempotent and safe to run on every boot. Failures are logged but not
    raised — a transient DB hiccup at startup shouldn't crash the whole app."""
    try:
        for stmt in _ENSURE_TABLE_STATEMENTS:
            db.execute(text(stmt))
        db.execute(text(_SEED_LECTURE_DEFAULT_SQL))
        db.commit()
        logger.info("ai_task schema ensured.")
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        logger.warning("ensure_ai_task_schema failed (will rely on external migration): %s", exc)


# Task types that are an implementation detail of one editor (not an "AI tool"
# run the user browses in history). Kept out of the unfiltered listings — their
# result_json is a whole HTML page, and the history UI has no card for them.
# Engagement plan drafts run as jobs too; like HTML docs they are not user-visible
# AI tasks, so they stay out of the task list.
_INTERNAL_TASK_TYPES = (AiTaskType.HTML_DOC_GENERATE.value, "ENGAGEMENT_PLAN_DRAFT")


def _not_internal():
    return or_(AiTask.task_type.is_(None), AiTask.task_type.notin_(_INTERNAL_TASK_TYPES))


class AiTaskRepository:
    def __init__(self, db: Session):
        self.db = db

    def create(self, task: AiTask) -> AiTask:
        self.db.add(task)
        self.db.commit()
        self.db.refresh(task)
        return task

    def get(self, task_id: str) -> Optional[AiTask]:
        return self.db.get(AiTask, task_id)

    def query_for_institute(self, institute_id: str, task_type: Optional[str] = None):
        """Newest first; callers add their own filters before `.first()`/`.all()`."""
        q = self.db.query(AiTask).filter(AiTask.institute_id == institute_id)
        if task_type:
            q = q.filter(AiTask.task_type == task_type)
        return q.order_by(AiTask.created_at.desc())

    @staticmethod
    def dynamic_values_contains(fragment: str):
        """Filter on the JSON text of dynamic_values_map (a TEXT column, so a
        substring match — pass a `"key": "value"` fragment exactly as json.dumps
        writes it)."""
        return AiTask.dynamic_values_map.like(f"%{fragment}%")

    def list_by_institute(
        self, institute_id: str, task_type: Optional[str] = None
    ) -> List[AiTask]:
        q = self.db.query(AiTask).filter(AiTask.institute_id == institute_id)
        if task_type:
            q = q.filter(AiTask.task_type == task_type)
        else:
            q = q.filter(_not_internal())
        return q.order_by(AiTask.created_at.desc()).all()

    # --- Chat-with-PDF reads (migrated from media_service TaskStatusService) ---

    def list_chat_turns(self, institute_id: Optional[str], input_id: str) -> List[AiTask]:
        """All chat turns for one PDF, oldest→newest. Mirrors
        findByTypeAndInstituteIdAndInputIdAndInputTypeOrderByASC
        (type=CHAT_WITH_PDF, input_type=PDF_ID). Used by get-response."""
        return (
            self.db.query(AiTask)
            .filter(
                AiTask.task_type == AiTaskType.CHAT_WITH_PDF.value,
                AiTask.institute_id == institute_id,
                AiTask.input_id == input_id,
                AiTask.input_type == AiTaskInputType.PDF_ID.value,
            )
            .order_by(AiTask.created_at.asc())
            .all()
        )

    def list_last_chat_turns(
        self, institute_id: Optional[str], input_id: str, limit: int = 5
    ) -> List[AiTask]:
        """Most-recent `limit` chat turns for one PDF (newest first). Mirrors
        findLastFiveByTypeAndInstituteAndInput; caller re-sorts oldest→newest
        for the prompt's conversation context."""
        return (
            self.db.query(AiTask)
            .filter(
                AiTask.task_type == AiTaskType.CHAT_WITH_PDF.value,
                AiTask.institute_id == institute_id,
                AiTask.input_id == input_id,
                AiTask.input_type == AiTaskInputType.PDF_ID.value,
            )
            .order_by(AiTask.created_at.desc())
            .limit(limit)
            .all()
        )

    def list_thread(self, parent_id: str) -> List[AiTask]:
        """One conversation thread, oldest→newest: the head row (id = parentId)
        plus its children (parent_id = parentId). Mirrors
        findByParentIdAndTaskWithParentId. Used by get-chat."""
        return (
            self.db.query(AiTask)
            .filter(or_(AiTask.id == parent_id, AiTask.parent_id == parent_id))
            .order_by(AiTask.created_at.asc())
            .all()
        )

    def list_parentless(self, institute_id: str) -> List[AiTask]:
        """All top-level (parent_id IS NULL) rows for an institute, any type.
        Mirrors findByInstituteIdAndNullParentId — note the Java query is NOT
        filtered by task type, so this returns every parentless task. Used by
        get/chat-list."""
        return (
            self.db.query(AiTask)
            .filter(AiTask.institute_id == institute_id, AiTask.parent_id.is_(None))
            .filter(_not_internal())
            .order_by(AiTask.created_at.desc())
            .all()
        )

    def update_status(
        self,
        task_id: str,
        status: AiTaskStatus,
        *,
        result_json: Optional[str] = None,
        status_message: Optional[str] = None,
    ) -> Optional[AiTask]:
        task = self.get(task_id)
        if not task:
            return None
        task.status = status.value
        if result_json is not None:
            task.result_json = result_json
        if status_message is not None:
            task.status_message = status_message
        self.db.commit()
        self.db.refresh(task)
        return task

    def fail_stale_in_progress(self, older_than_minutes: int) -> int:
        """Mark PROGRESS rows older than the cutoff as FAILED — the restart
        sweep. Returns the number of rows swept."""
        cutoff = datetime.now(timezone.utc) - timedelta(minutes=older_than_minutes)
        result = self.db.execute(
            text(
                """
                UPDATE ai_task
                SET status = :failed,
                    status_message = :msg,
                    updated_at = now()
                WHERE status = :progress AND created_at < :cutoff
                """
            ),
            {
                "failed": AiTaskStatus.FAILED.value,
                "progress": AiTaskStatus.PROGRESS.value,
                "msg": "Interrupted by service restart",
                "cutoff": cutoff,
            },
        )
        self.db.commit()
        return result.rowcount or 0
