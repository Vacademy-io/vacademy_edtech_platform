"""Course AI knowledge: the admin API behind the course "AI knowledge" tab and
Settings > AI > Course knowledge (spec §12, §13).

Base /course-knowledge/v1 (mounted under the service base path, /ai-service).

  GET    /status                                     staff
  GET    /settings                                   staff
  PUT    /settings                                   manage
  GET    /packages/{package_id}/coverage             staff
  POST   /packages/{package_id}/scan                 staff   (free)
  POST   /packages/{package_id}/process              manage  (paid, quote-checked)
  GET    /runs/{run_id}                              staff
  POST   /runs/{run_id}/cancel                       manage
  POST   /packages/{package_id}/lessons/{slide_id}/retry   staff (free)
  POST   /packages/{package_id}/preview-search       staff   (no LLM, no charge)
  DELETE /data                                       manage

Auth is by ROLES only (auth.ck_staff; is_root_user is never read: it is set
for ordinary learners too). Every package route checks package_institute.
403 {code: not_available} when the platform has not made the feature
available to the institute; writes also return 409 {code: not_enabled} while
the institute's setting is off (PUT /settings, cancel and DELETE /data are
exempt: turning the feature on, stopping spending and deleting data must
always work).

The router is thin: coverage.py computes coverage and the quote, runs.py
owns the writes. No network call is made while a DB session is open; the
preview search opens its own short session and lets retrieval embed the
query with no session held.
"""
from __future__ import annotations

import asyncio
import logging
from decimal import Decimal
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..db import db_dependency, db_session
from ..services.ai_billing import UC, metering_user, preflight_tool_credits
from ..services.course_knowledge import (
    access, billing, budget, coverage, flags, kept_transcript, retrieval, runs, settings_store, tree,
)
from ..services.course_knowledge.auth import CkStaff, ck_staff, require_manage
from ..services.course_knowledge.settings_store import CourseKnowledgeSetting
from ..services.tutor.slide_source import package_belongs_to_institute

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/course-knowledge/v1", tags=["course-knowledge"])

PREVIEW_NOTE = "Preview searches every published lesson and ignores drip locks."
NOTHING_TO_PROCESS = "Nothing in this course needs paid processing."


class SettingsPatch(BaseModel):
    enabled: Optional[bool] = None
    learner_answers_enabled: Optional[bool] = None
    auto_paid_enabled: Optional[bool] = None
    monthly_auto_cap_credits: Optional[float] = None
    allow_ocr: Optional[bool] = None
    allow_transcription: Optional[bool] = None


class ProcessRequest(BaseModel):
    expected_credits: float = Field(ge=0)


class PreviewRequest(BaseModel):
    query: str = Field(min_length=1, max_length=retrieval.MAX_QUERY_CHARS)


# ----------------------------------------------------------------------
# guards
# ----------------------------------------------------------------------
def _error(code: int, error: str, message: str, **extra: Any) -> HTTPException:
    return HTTPException(status_code=code, detail={"code": error, "message": message, **extra})


def _require_available(staff: CkStaff) -> None:
    if not flags.available(staff.institute_id):
        raise _error(status.HTTP_403_FORBIDDEN, "not_available",
                     "Course knowledge is not available for your institute yet.")


def _require_enabled(db: Session, staff: CkStaff) -> CourseKnowledgeSetting:
    setting = settings_store.get_setting(db, staff.institute_id)
    if not setting.enabled:
        raise _error(status.HTTP_409_CONFLICT, "not_enabled", "Turn on course knowledge first.")
    return setting


def _require_package(db: Session, staff: CkStaff, package_id: str) -> None:
    if not package_belongs_to_institute(db, package_id, staff.institute_id):
        raise _error(status.HTTP_404_NOT_FOUND, "course_not_found", "Course not found in this institute")


def _visible_lessons(db: Session, institute_id: str, package_id: str) -> List[str]:
    """Every visible lesson of the course the AI may read (assessments left
    out), course order, each once."""
    rows = tree.package_slide_tree(db, institute_id, package_id)
    return list(dict.fromkeys(r.slide_id for r in rows if not r.is_assessment))


def _http(exc: runs.RunError) -> HTTPException:
    return HTTPException(status_code=exc.status_code, detail=exc.detail, headers=exc.headers)


def _status(db: Optional[Session], staff: CkStaff) -> Dict[str, Any]:
    """The GET /status shape. With the feature unavailable no table is read."""
    available = flags.available(staff.institute_id)
    setting = settings_store.get_setting(db, staff.institute_id) if available and db is not None else (
        CourseKnowledgeSetting())
    spent = budget.month_spent(db, staff.institute_id) if available and db is not None else 0
    return {
        "available": available,
        "enabled": setting.enabled,
        "learner_answers_enabled": setting.learner_answers_enabled,
        "auto_paid_enabled": setting.auto_paid_enabled,
        "monthly_auto_cap_credits": setting.monthly_auto_cap_credits,
        "month_auto_spent_credits": coverage.num(spent),
        "max_monthly_auto_cap": flags.max_monthly_auto_cap(),
        "allow_ocr": setting.allow_ocr,
        "allow_transcription": setting.allow_transcription,
        "paid_available": flags.paid_enabled(),
        "links_enabled": flags.links_enabled(),
        "retrieval_mode": flags.retrieval_mode(),
        "can_manage": staff.can_manage,
    }


# ----------------------------------------------------------------------
# status and settings
# ----------------------------------------------------------------------
@router.get("/status", summary="Course knowledge status for the caller's institute")
def get_status(staff: CkStaff = Depends(ck_staff), db: Session = Depends(db_dependency)) -> Dict[str, Any]:
    """Always 200 for staff; available=false when the platform has not made
    the feature available to this institute."""
    return _status(db, staff)


@router.get("/settings", summary="The institute's course knowledge setting")
def get_settings_route(staff: CkStaff = Depends(ck_staff), db: Session = Depends(db_dependency)) -> Dict[str, Any]:
    if not flags.available(staff.institute_id):
        return CourseKnowledgeSetting().as_dict()
    return settings_store.get_setting(db, staff.institute_id).as_dict()


@router.put("/settings", summary="Change the institute's course knowledge setting (admins)")
def put_settings_route(
    payload: SettingsPatch,
    staff: CkStaff = Depends(ck_staff),
    db: Session = Depends(db_dependency),
) -> Dict[str, Any]:
    require_manage(staff)
    _require_available(staff)
    try:
        settings_store.put_setting(db, staff.institute_id, payload.model_dump(exclude_none=True), staff.user_id)
    except ValueError as exc:
        raise _error(status.HTTP_422_UNPROCESSABLE_ENTITY, "invalid_setting", str(exc)) from exc
    return _status(db, staff)


# ----------------------------------------------------------------------
# coverage, scan, process
# ----------------------------------------------------------------------
@router.get("/packages/{package_id}/coverage", summary="What the AI can read in a course, and the quote")
def get_coverage(
    package_id: str,
    staff: CkStaff = Depends(ck_staff),
    db: Session = Depends(db_dependency),
) -> Dict[str, Any]:
    _require_available(staff)
    _require_package(db, staff, package_id)
    setting = settings_store.get_setting(db, staff.institute_id)
    cov = coverage.compute_coverage(db, staff.institute_id, package_id, setting)
    out = cov.to_dict()
    out["balance"] = coverage.balance(db, staff.institute_id, cov.quote.credits)
    out["active_run"] = runs.active_run_dict(db, staff.institute_id, package_id)
    return out


@router.post("/packages/{package_id}/scan", status_code=status.HTTP_202_ACCEPTED,
             summary="Read the free text of every lesson (Make course AI-ready, step 1)")
def post_scan(
    package_id: str,
    staff: CkStaff = Depends(ck_staff),
    db: Session = Depends(db_dependency),
) -> Dict[str, Any]:
    _require_available(staff)
    _require_enabled(db, staff)
    _require_package(db, staff, package_id)
    slide_ids = _visible_lessons(db, staff.institute_id, package_id)
    try:
        return runs.start_scan(db, institute_id=staff.institute_id, package_id=package_id,
                               requested_by=staff.user_id, slide_ids=slide_ids)
    except runs.RunError as exc:
        raise _http(exc) from exc


def _insufficient(credits: Any, current: Any) -> HTTPException:
    """The 402 shape of routers/knowledge_base._preflight_or_402."""
    estimate = {
        "estimated_credits": coverage.num(credits),
        "current_balance": coverage.num(current),
        "balance_after": coverage.num(current - credits),
        "sufficient": False,
    }
    return HTTPException(
        status_code=status.HTTP_402_PAYMENT_REQUIRED,
        detail={
            "message": (
                f"This needs about {float(credits):.0f} credits but only {float(current):.0f} are available. "
                "Top up to continue."
            ),
            "estimate": estimate,
        },
    )


@router.post("/packages/{package_id}/process", status_code=status.HTTP_202_ACCEPTED,
             summary="Process scans and media for the accepted quote (Make course AI-ready, step 2)")
def post_process(
    package_id: str,
    payload: ProcessRequest,
    staff: CkStaff = Depends(ck_staff),
    db: Session = Depends(db_dependency),
) -> Any:
    require_manage(staff)
    _require_available(staff)
    setting = _require_enabled(db, staff)
    _require_package(db, staff, package_id)

    # a) the same quote coverage shows
    quote = coverage.compute_coverage(db, staff.institute_id, package_id, setting).quote
    # b) nothing to pay for (lessons whose paid text is already cached are still re-read, free)
    if quote.credits <= 0:
        queued = runs.enqueue_cached(db, staff.institute_id, quote)
        db.commit()
        return JSONResponse(status_code=status.HTTP_200_OK,
                            content={"run_id": None, "message": NOTHING_TO_PROCESS, "lessons_queued": queued})
    # c) the price moved since the admin saw it
    if quote.credits > Decimal(str(payload.expected_credits)):
        raise _error(status.HTTP_409_CONFLICT, "QUOTE_CHANGED",
                     f"The amount changed to {coverage.num(quote.credits)} credits.", quote=quote.to_dict())
    # d) paid processing switched off on the platform
    if not flags.paid_enabled():
        raise _error(status.HTTP_403_FORBIDDEN, "paid_not_available",
                     "Paid processing is not available for your institute yet.")
    # e) per-tool preflight: V587 ENFORCE limits raise LimitExceeded (429), left to propagate
    meter = metering_user(staff.user_id, surface="ADMIN_APP")
    plan_covered = False
    for tool_key, units in quote.tool_units().items():
        estimate = preflight_tool_credits(
            db, tool_key=tool_key, tool_params=billing.tool_params(tool_key, units),
            institute_id=staff.institute_id, metering=meter, use_case=UC.COURSE_KNOWLEDGE,
        )
        plan_covered = plan_covered or bool(estimate.get("plan_covered"))
    # f) the whole quote against the balance (no wallet row = allowed)
    wallet = coverage.balance(db, staff.institute_id, quote.credits)
    if wallet["sufficient"] is False and not plan_covered:
        current = Decimal(str(wallet["current_balance"]))
        raise _insufficient(quote.credits, current)
    # g-i) run, budget, queue
    try:
        return runs.start_process(db, institute_id=staff.institute_id, package_id=package_id,
                                  requested_by=staff.user_id, quote=quote)
    except runs.RunError as exc:
        raise _http(exc) from exc


# ----------------------------------------------------------------------
# runs
# ----------------------------------------------------------------------
@router.get("/runs/{run_id}", summary="Progress of a Make course AI-ready run")
def get_run(run_id: str, staff: CkStaff = Depends(ck_staff), db: Session = Depends(db_dependency)) -> Dict[str, Any]:
    _require_available(staff)
    run = runs.get_run(db, staff.institute_id, run_id)
    if run is None:
        raise _error(status.HTTP_404_NOT_FOUND, "run_not_found", "Run not found")
    return runs.run_dict(db, run)


@router.post("/runs/{run_id}/cancel", summary="Stop a run; unspent credits are released")
def post_cancel(run_id: str, staff: CkStaff = Depends(ck_staff), db: Session = Depends(db_dependency)) -> Dict[str, Any]:
    require_manage(staff)
    _require_available(staff)
    run = runs.cancel_run(db, staff.institute_id, run_id)
    if run is None:
        raise _error(status.HTTP_404_NOT_FOUND, "run_not_found", "Run not found")
    return runs.run_dict(db, runs.get_run(db, staff.institute_id, run_id) or run)


# ----------------------------------------------------------------------
# lessons
# ----------------------------------------------------------------------
@router.post("/packages/{package_id}/lessons/{slide_id}/retry", status_code=status.HTTP_202_ACCEPTED,
             summary="Read one lesson again (free)")
def post_retry(
    package_id: str,
    slide_id: str,
    staff: CkStaff = Depends(ck_staff),
    db: Session = Depends(db_dependency),
) -> Dict[str, Any]:
    _require_available(staff)
    _require_enabled(db, staff)
    _require_package(db, staff, package_id)
    if slide_id not in _visible_lessons(db, staff.institute_id, package_id):
        raise _error(status.HTTP_404_NOT_FOUND, "lesson_not_found", "Lesson not found in this course")
    queued = runs.retry_lesson(db, staff.institute_id, slide_id)
    return {"slide_id": slide_id, "queued": queued > 0}


def _kept_or_404(db: Session, staff: CkStaff, package_id: str, slide_id: str) -> kept_transcript.Kept:
    if slide_id not in _visible_lessons(db, staff.institute_id, package_id):
        raise _error(status.HTTP_404_NOT_FOUND, "lesson_not_found", "Lesson not found in this course")
    kept = kept_transcript.find(db, staff.institute_id, slide_id)
    if kept is None:
        raise _error(status.HTTP_404_NOT_FOUND, "no_kept_transcript",
                     "This lesson has no kept transcript. Read it again to transcribe it.")
    return kept


@router.get("/packages/{package_id}/lessons/{slide_id}/kept-transcript",
            summary="The transcript the speech check rejected, with its price")
def get_kept_transcript(
    package_id: str,
    slide_id: str,
    staff: CkStaff = Depends(ck_staff),
    db: Session = Depends(db_dependency),
) -> Dict[str, Any]:
    _require_available(staff)
    _require_package(db, staff, package_id)
    return _kept_or_404(db, staff, package_id, slide_id).to_dict()


@router.post("/packages/{package_id}/lessons/{slide_id}/use-kept-transcript", status_code=status.HTTP_202_ACCEPTED,
             summary="Use a rejected transcript anyway (charges its minutes once)")
def post_use_kept_transcript(
    package_id: str,
    slide_id: str,
    payload: ProcessRequest,
    staff: CkStaff = Depends(ck_staff),
    db: Session = Depends(db_dependency),
) -> Dict[str, Any]:
    require_manage(staff)
    _require_available(staff)
    _require_enabled(db, staff)
    _require_package(db, staff, package_id)
    kept = _kept_or_404(db, staff, package_id, slide_id)
    if kept.credits > Decimal(str(payload.expected_credits)):
        raise _error(status.HTTP_409_CONFLICT, "QUOTE_CHANGED",
                     f"The amount changed to {coverage.num(kept.credits)} credits.", credits=coverage.num(kept.credits))
    if not flags.paid_enabled():
        raise _error(status.HTTP_403_FORBIDDEN, "paid_not_available",
                     "Paid processing is not available for your institute yet.")
    meter = metering_user(staff.user_id, surface="ADMIN_APP")
    estimate = preflight_tool_credits(
        db, tool_key=kept_transcript.TOOL_TRANSCRIBE_MINUTE,
        tool_params=billing.tool_params(kept_transcript.TOOL_TRANSCRIBE_MINUTE, kept.units),
        institute_id=staff.institute_id, metering=meter, use_case=UC.COURSE_KNOWLEDGE,
    )
    wallet = coverage.balance(db, staff.institute_id, kept.credits)
    if wallet["sufficient"] is False and not estimate.get("plan_covered"):
        raise _insufficient(kept.credits, Decimal(str(wallet["current_balance"])))
    # Release the request's connection before the short sessions use() opens.
    db.commit()
    try:
        credits = kept_transcript.use(staff.institute_id, kept, staff.user_id)
    except kept_transcript.KeptError as exc:
        raise _error(status.HTTP_503_SERVICE_UNAVAILABLE, "kept_transcript_failed", str(exc)) from exc
    return {"slide_id": slide_id, "queued": True, "credits_charged": coverage.num(credits)}


def _preview_scope(institute_id: str, package_id: str) -> Optional[access.ResolvedScope]:
    """None when the course is not this institute's. Own short session."""
    with db_session() as db:
        if not package_belongs_to_institute(db, package_id, institute_id):
            return None
        return access.staff_preview_scope(db, institute_id, package_id)


@router.post("/packages/{package_id}/preview-search", summary="Test what the AI finds in a course")
async def post_preview_search(
    package_id: str,
    payload: PreviewRequest,
    staff: CkStaff = Depends(ck_staff),
) -> Dict[str, Any]:
    """Every published lesson, drip ignored. No LLM call and no charge; the
    query embedding runs with no DB session held."""
    _require_available(staff)
    scope = await asyncio.to_thread(_preview_scope, staff.institute_id, package_id)
    if scope is None:
        raise _error(status.HTTP_404_NOT_FOUND, "course_not_found", "Course not found in this institute")
    result = await retrieval.search_course(scope=scope, query=payload.query, mode=retrieval.MODE_PREVIEW)
    hits: List[Dict[str, Any]] = [hit.preview_dict() for hit in result.hits]
    return {"hits": hits, "note": PREVIEW_NOTE}


# ----------------------------------------------------------------------
# data
# ----------------------------------------------------------------------
@router.delete("/data", summary="Delete the institute's course AI data and turn the feature off")
def delete_data(staff: CkStaff = Depends(ck_staff), db: Session = Depends(db_dependency)) -> Dict[str, Any]:
    require_manage(staff)
    _require_available(staff)
    return runs.delete_institute_data(db, staff.institute_id, staff.user_id)


__all__ = ["router", "SettingsPatch", "ProcessRequest", "PreviewRequest", "PREVIEW_NOTE"]
