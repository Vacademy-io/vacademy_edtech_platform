"""The run request of an AI-video generation, persisted for resume.

``extra_metadata.run_request`` records every ``generate_till_stage`` keyword
of the FIRST leg (JSON-safe), the run's kind (who to notify / how to continue)
and its FINAL target stage — the leg's own target can be clamped (assist
gates, course-builder leg 1 stops at SCRIPT). A resumer rebuilds the exact
kwargs with ``rehydrate`` instead of guessing them from scattered metadata:

    {"v": 1, "kind": "external|lms|course_builder|storybook_builder",
     "final_target_stage": "HTML", "institute_id", "user_id",
     "kwargs": {...}, "captured_at"}

Not captured: ``video_id`` (the row key), ``prompt`` (the row's prompt column;
LMS prompts embed source text), ``db_session`` and the per-leg resume/lease
controls.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, Optional

RUN_REQUEST_VERSION = 1
RUN_KINDS = ("external", "lms", "course_builder", "storybook_builder")

# Per-leg controls of generate_till_stage — never part of the run request.
_EXCLUDED = frozenset({
    "video_id", "prompt", "db_session", "resume", "resume_from_stage", "resume_mode",
    "run_request", "lease", "lease_origin", "target_stage",
})


def _json_safe(value: Any) -> Any:
    if hasattr(value, "model_dump"):
        return value.model_dump(mode="json", exclude_none=True)
    if isinstance(value, dict):
        return {str(k): _json_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe(v) for v in value]
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    return str(value)


def capture(kind: str, final_target_stage: str, kwargs: Dict[str, Any]) -> Dict[str, Any]:
    """JSON-safe run request from a ``generate_till_stage`` kwargs dict."""
    kw = {k: _json_safe(v) for k, v in (kwargs or {}).items() if k not in _EXCLUDED}
    return {
        "v": RUN_REQUEST_VERSION,
        "kind": kind if kind in RUN_KINDS else "external",
        "final_target_stage": str(final_target_stage or "HTML").upper(),
        "institute_id": kw.get("institute_id"),
        "user_id": kw.get("user_id"),
        "kwargs": kw,
        "captured_at": datetime.now(timezone.utc).isoformat(),
    }


def _model(cls_name: str, value: Any) -> Any:
    if value is None or not isinstance(value, dict):
        return value
    from ..schemas import video_generation as vg

    cls = getattr(vg, cls_name)
    try:
        return cls.model_validate(value)
    except Exception:  # noqa: BLE001 — a schema drift must not block the resume
        return value


def rehydrate(run_request: Dict[str, Any], rec: Any = None) -> Dict[str, Any]:
    """``generate_till_stage`` kwargs (minus video_id / db_session / resume
    controls) from a stored run request. ``rec`` (the AiGenVideo row) supplies
    the prompt; ``target_stage`` is the run's final target.

    host must come back as a HostConfig model (the service reads it with
    getattr); model_overrides / brand_overrides / visual_preferences / lesson
    as their pydantic models. reference_files stay plain dicts — the fresh
    path passes ``[rf.model_dump() ...]`` — but are re-validated through
    ReferenceFileItem so a corrupt entry is dropped, not crashed on."""
    rr = run_request if isinstance(run_request, dict) else {}
    kw: Dict[str, Any] = dict(rr.get("kwargs") or {})
    kw["host"] = _model("HostConfig", kw.get("host"))
    kw["model_overrides"] = _model("ModelOverrides", kw.get("model_overrides"))
    kw["brand_overrides"] = _model("BrandOverrides", kw.get("brand_overrides"))
    kw["visual_preferences"] = _model("VisualPreferences", kw.get("visual_preferences"))
    kw["lesson"] = _model("LessonConfig", kw.get("lesson"))
    if isinstance(kw.get("reference_files"), list):
        from ..schemas.video_generation import ReferenceFileItem

        files = []
        for item in kw["reference_files"]:
            try:
                files.append(ReferenceFileItem.model_validate(item).model_dump())
            except Exception:  # noqa: BLE001
                continue
        kw["reference_files"] = files or None
    kw["target_stage"] = str(rr.get("final_target_stage") or "HTML").upper()
    if rec is not None:
        kw["prompt"] = getattr(rec, "prompt", None) or ""
    return kw


def kind_of(run_request: Optional[Dict[str, Any]]) -> Optional[str]:
    return (run_request or {}).get("kind") if isinstance(run_request, dict) else None


__all__ = ["RUN_KINDS", "RUN_REQUEST_VERSION", "capture", "kind_of", "rehydrate"]
