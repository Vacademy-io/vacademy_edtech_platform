"""Lesson mode request validation (see ai-video-gen-main/lesson_mode.py).

Kept out of video_generation_service so it can be imported and tested without
the whole generation stack."""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session


class LessonConfigError(ValueError):
    """A `lesson` request that cannot run (bad teacher, combined with host...)."""


def _lesson_modules():
    """lesson_mode / lesson_teacher live in ai-video-gen-main (same sys.path
    trick as the pipeline import)."""
    import sys as _sys
    from pathlib import Path as _Path
    _aigen = str(_Path(__file__).resolve().parent.parent / "ai-video-gen-main")
    if _aigen not in _sys.path:
        _sys.path.insert(0, _aigen)
    import lesson_mode  # type: ignore
    import lesson_teacher  # type: ignore
    return lesson_mode, lesson_teacher


def resolve_lesson_plan(
    lesson: Any,
    *,
    institute_id: Optional[str],
    host: Any = None,
    db: Optional[Session] = None,
) -> Optional[Dict[str, Any]]:
    """Validate a request's `lesson` block into the plan the pipeline runs.

    The teacher must be a ready Spatius avatar this institute may use —
    platform stock or its own row in tutor_asset_registry (the same list the
    AI tutor offers). Raises LessonConfigError with a user-facing message."""
    lm, lt = _lesson_modules()
    plan = lm.normalize_lesson_plan(lesson)
    if not plan:
        return None
    if host is not None:
        raise LessonConfigError(
            "Lesson mode brings its own on-screen teacher — remove `host` from the request "
            "(or turn lesson mode off to use the Host feature)."
        )
    if not lm.has_teacher(plan):
        return plan
    if not lt.configured():
        raise LessonConfigError(
            "The lesson teacher is not available on this server (Spatius is not configured). "
            "Remove `lesson.teacher` for a board-only lesson."
        )
    if institute_id:
        from .tutor import asset_registry

        def _match(_db: Session) -> List[Dict[str, Any]]:
            return [
                r for r in asset_registry.visible(_db, institute_id=institute_id, kind="avatar")
                if r.get("provider") == "spatius" and r.get("status") == "ready"
                and r.get("external_id") == plan["teacher"]["avatar_id"]
            ]

        if db is not None:
            rows = _match(db)
        else:
            from ..db import db_session as _fresh_db_session
            with _fresh_db_session() as _db:
                rows = _match(_db)
        if not rows:
            raise LessonConfigError(
                "That teacher avatar is not available to this institute. Pick one from the "
                "teacher list (AI tutor avatars), or remove `lesson.teacher`."
            )
        if not plan["teacher"].get("name"):
            plan["teacher"]["name"] = rows[0].get("display_name") or None
    return plan
