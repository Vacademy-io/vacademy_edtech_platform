"""Per-institute course-knowledge setting (table course_knowledge_setting, V600).

No row means off. The row is written only through put_setting, one upsert that
decides everything from RETURNING (psycopg 3 reports rowcount -1 for INSERT ..
ON CONFLICT, so rowcount is never read).

CAST(... AS ...) IS MANDATORY — NEVER ``::`` after a bind parameter: SQLAlchemy
``text()`` reads ``:name::type`` as two parameters (see kb/repository.py).
"""
from __future__ import annotations

import logging
import threading
import time
from dataclasses import asdict, dataclass
from datetime import datetime
from typing import Any, Dict, Mapping, Optional, Tuple

from sqlalchemy import text
from sqlalchemy.orm import Session

from ...db import db_session
from . import flags

logger = logging.getLogger(__name__)

CACHE_TTL_SECONDS = 30.0

BOOL_FIELDS = (
    "enabled", "learner_answers_enabled", "auto_paid_enabled", "allow_ocr", "allow_transcription",
)
INT_FIELDS = ("monthly_auto_cap_credits",)
PATCHABLE_FIELDS = BOOL_FIELDS + INT_FIELDS


@dataclass(frozen=True)
class CourseKnowledgeSetting:
    enabled: bool = False
    learner_answers_enabled: bool = True
    auto_paid_enabled: bool = False
    monthly_auto_cap_credits: int = 0
    allow_ocr: bool = True
    allow_transcription: bool = True
    enabled_at: Optional[datetime] = None
    updated_by: Optional[str] = None
    updated_at: Optional[datetime] = None

    def as_dict(self) -> Dict[str, Any]:
        out = asdict(self)
        for k in ("enabled_at", "updated_at"):
            if isinstance(out[k], datetime):
                out[k] = out[k].isoformat()
        return out


@dataclass(frozen=True)
class LearnerGate:
    """Whether learner chat / voice may read this institute's course text, and
    how: mode 'shadow' searches and logs but never injects, 'on' injects."""
    active: bool
    mode: str


_COLUMNS = (
    "enabled, learner_answers_enabled, auto_paid_enabled, monthly_auto_cap_credits, "
    "allow_ocr, allow_transcription, enabled_at, updated_by, updated_at"
)

_SELECT_SQL = text(
    f"SELECT {_COLUMNS} FROM course_knowledge_setting WHERE institute_id = :institute_id"
)

# A NULL bind means "not in the patch": keep the stored value (or the column
# default on first insert). enabled_at is stamped only on a false -> true flip.
_UPSERT_SQL = text(
    f"""
    INSERT INTO course_knowledge_setting AS s (
        institute_id, enabled, learner_answers_enabled, auto_paid_enabled,
        monthly_auto_cap_credits, allow_ocr, allow_transcription,
        enabled_at, updated_by, created_at, updated_at
    ) VALUES (
        :institute_id,
        COALESCE(CAST(:enabled AS BOOLEAN), FALSE),
        COALESCE(CAST(:learner_answers_enabled AS BOOLEAN), TRUE),
        COALESCE(CAST(:auto_paid_enabled AS BOOLEAN), FALSE),
        COALESCE(CAST(:monthly_auto_cap_credits AS INTEGER), 0),
        COALESCE(CAST(:allow_ocr AS BOOLEAN), TRUE),
        COALESCE(CAST(:allow_transcription AS BOOLEAN), TRUE),
        CASE WHEN COALESCE(CAST(:enabled AS BOOLEAN), FALSE) THEN now() ELSE NULL END,
        CAST(:updated_by AS VARCHAR),
        now(), now()
    )
    ON CONFLICT (institute_id) DO UPDATE SET
        enabled                  = COALESCE(CAST(:enabled AS BOOLEAN), s.enabled),
        learner_answers_enabled  = COALESCE(CAST(:learner_answers_enabled AS BOOLEAN), s.learner_answers_enabled),
        auto_paid_enabled        = COALESCE(CAST(:auto_paid_enabled AS BOOLEAN), s.auto_paid_enabled),
        monthly_auto_cap_credits = COALESCE(CAST(:monthly_auto_cap_credits AS INTEGER), s.monthly_auto_cap_credits),
        allow_ocr                = COALESCE(CAST(:allow_ocr AS BOOLEAN), s.allow_ocr),
        allow_transcription      = COALESCE(CAST(:allow_transcription AS BOOLEAN), s.allow_transcription),
        enabled_at = CASE
            WHEN COALESCE(CAST(:enabled AS BOOLEAN), s.enabled) AND NOT s.enabled THEN now()
            ELSE s.enabled_at
        END,
        updated_by = CAST(:updated_by AS VARCHAR),
        updated_at = now()
    RETURNING {_COLUMNS}
    """
)


def _from_row(row: Optional[Mapping[str, Any]]) -> CourseKnowledgeSetting:
    if not row:
        return CourseKnowledgeSetting()
    return CourseKnowledgeSetting(
        enabled=bool(row["enabled"]),
        learner_answers_enabled=bool(row["learner_answers_enabled"]),
        auto_paid_enabled=bool(row["auto_paid_enabled"]),
        monthly_auto_cap_credits=int(row["monthly_auto_cap_credits"] or 0),
        allow_ocr=bool(row["allow_ocr"]),
        allow_transcription=bool(row["allow_transcription"]),
        enabled_at=row["enabled_at"],
        updated_by=row["updated_by"],
        updated_at=row["updated_at"],
    )


def get_setting(db: Session, institute_id: str) -> CourseKnowledgeSetting:
    """The institute's setting; the defaults (off) when it has no row."""
    row = db.execute(_SELECT_SQL, {"institute_id": institute_id}).mappings().first()
    return _from_row(row)


def _coerce_bool(name: str, value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str) and value.strip().lower() in ("true", "false"):
        return value.strip().lower() == "true"
    raise ValueError(f"{name} must be true or false")


def _coerce_cap(value: Any) -> int:
    if isinstance(value, bool):
        raise ValueError("monthly_auto_cap_credits must be a number")
    try:
        n = int(float(value))
    except (TypeError, ValueError, OverflowError):  # OverflowError: "inf", 1e400
        raise ValueError("monthly_auto_cap_credits must be a number")
    return max(0, min(flags.max_monthly_auto_cap(), n))


def clean_patch(patch: Mapping[str, Any] | None) -> Dict[str, Any]:
    """Only the patchable fields, coerced; the cap clamped to
    [0, course_knowledge.max_monthly_auto_cap]. Raises ValueError on a bad value."""
    out: Dict[str, Any] = {}
    for name, value in (patch or {}).items():
        if name not in PATCHABLE_FIELDS or value is None:
            continue
        out[name] = _coerce_cap(value) if name in INT_FIELDS else _coerce_bool(name, value)
    return out


def put_setting(
    db: Session, institute_id: str, patch: Mapping[str, Any] | None, updated_by: Optional[str],
) -> CourseKnowledgeSetting:
    """Merge `patch` into the institute's row (creating it), commit, and return
    the stored setting. Unknown fields are ignored."""
    clean = clean_patch(patch)
    params: Dict[str, Any] = {name: clean.get(name) for name in PATCHABLE_FIELDS}
    params["institute_id"] = institute_id
    params["updated_by"] = updated_by
    row = db.execute(_UPSERT_SQL, params).mappings().first()
    db.commit()
    invalidate_cache(institute_id)
    return _from_row(row)


# ── in-process cache for hot readers (learner chat, worker) ─────────────────

_cache: Dict[str, Tuple[float, CourseKnowledgeSetting]] = {}
_cache_lock = threading.Lock()


def invalidate_cache(institute_id: Optional[str] = None) -> None:
    with _cache_lock:
        if institute_id is None:
            _cache.clear()
        else:
            _cache.pop(institute_id, None)


def cached_setting(institute_id: str) -> CourseKnowledgeSetting:
    """get_setting through a 30 s per-process cache, on its own short session.
    Never raises: an unreadable setting reads as the defaults (off), uncached."""
    now = time.monotonic()
    with _cache_lock:
        hit = _cache.get(institute_id)
        if hit is not None and now - hit[0] < CACHE_TTL_SECONDS:
            return hit[1]
    try:
        with db_session() as db:
            setting = get_setting(db, institute_id)
    except Exception as exc:  # noqa: BLE001 - table missing / pool busy => off
        logger.warning("course_knowledge_setting unreadable for %s: %s", institute_id, exc)
        return CourseKnowledgeSetting()
    with _cache_lock:
        _cache[institute_id] = (time.monotonic(), setting)
    return setting


def learner_gate(institute_id: Optional[str]) -> LearnerGate:
    """Active only when the platform has the feature available for the
    institute, the institute turned it on with learner answers, and the
    retrieval mode is not off. The cheap platform checks run first, so with the
    platform switch off no DB read happens at all."""
    mode = flags.retrieval_mode()
    if not institute_id or mode == "off" or not flags.available(institute_id):
        return LearnerGate(active=False, mode=mode)
    setting = cached_setting(institute_id)
    return LearnerGate(active=bool(setting.enabled and setting.learner_answers_enabled), mode=mode)


__all__ = [
    "CourseKnowledgeSetting", "LearnerGate", "PATCHABLE_FIELDS", "clean_patch",
    "get_setting", "put_setting", "cached_setting", "invalidate_cache", "learner_gate",
]
