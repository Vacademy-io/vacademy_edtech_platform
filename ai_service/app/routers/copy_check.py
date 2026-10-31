"""Copy-check endpoints. Owns:
  - POST /copy-check/grade            (Java triggers a copy grade; deduped across
                                       pods via copy_check_job, 429 when this pod is full)
  - POST /copy-check/inspect          (page count / encryption of an uploaded PDF)
  - POST /copy-check/{job_id}/cancel
  - GET  /copy-check/{job_id}/status
  - GET  /copy-check/rubric/{assessment_id}
  - POST /copy-check/rubric           (legacy full-replace upsert of the assessment rubric)
  - PATCH /copy-check/rubric/{assessment_id}   (per-question merge, one version bump)
  - DELETE /copy-check/rubric/{assessment_id}
  - PUT  /copy-check/rubric/{assessment_id}/question/{question_id}   (PATCH semantics)
  - DELETE /copy-check/rubric/{assessment_id}/question/{question_id}

All gated by X-Internal-Service-Token (Java assessment_service is the only
intended caller). The rubric endpoints will be proxied through Java for the FE.

Tenant check: a rubric row belongs to the institute that created it. A write
naming another institute is refused (403), and the rubric endpoints take an
optional `institute_id` query param that scopes reads/deletes to that institute.
"""
from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..db import db_dependency, db_session
from ..dependencies import require_internal_service_token
from ..repositories.copy_check_question_answer_repository import (
    CopyCheckQuestionAnswerRepository,
)
from ..repositories.copy_check_rubric_repository import (
    CopyCheckRubricRepository,
    RubricInstituteMismatch,
    RubricVersionMismatch,
    ensure_same_institute,
)
from ..schemas.copy_check import (
    CopyCheckGradeRequest,
    CopyCheckGradeResponse,
    CopyCheckIdentifyRequest,
    CopyCheckIdentifyResponse,
    InspectRequest,
    InspectResponse,
    PatchRubricRequest,
    PatchRubricResponse,
    RubricResponse,
    UpsertQuestionAnswerRequest,
    UpsertRubricRequest,
)
from ..services.copy_check import cancellation, job_guard, upload_inspect
from ..services.copy_check.orchestrator import _new_job_id, grade_copy, run

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/copy-check", tags=["copy-check"])


# In-memory job tracker — Java has the authoritative state, this is just so
# the /status endpoint can answer "is it still running" without a DB hit.
_jobs: dict[str, dict] = {}


@router.post(
    "/grade",
    response_model=CopyCheckGradeResponse,
    dependencies=[Depends(require_internal_service_token)],
)
async def submit_grade_job(
    req: CopyCheckGradeRequest,
    background: BackgroundTasks,
):
    """Start a grade run, at most once per process across pods.

    A live run of the same process (on any pod) answers 200 with that run's
    job_id and starts nothing. A pod already running its limit of jobs for the
    request's lane (COPY or TYPED; both unlimited by default) answers 429 with
    Retry-After; the caller leaves the process queued and retries.
    """
    payload = req.model_dump()
    job_id = _new_job_id()
    claim = await job_guard.claim(req.process_id, job_id)
    if claim is not None and not claim.owns:
        logger.info("copy-check: process %s already running as job %s; not starting another",
                    req.process_id, claim.job_id)
        return CopyCheckGradeResponse(job_id=claim.job_id, status="PROCESSING")
    gate = job_guard.gate_for(req.answer_mode)
    if not gate.try_acquire(job_id):
        if claim is not None:
            await job_guard.release(req.process_id, job_id)
        raise HTTPException(
            status_code=429,
            detail=f"copy-check is running {gate.limit} {req.answer_mode} jobs on this pod; retry later",
            headers={"Retry-After": str(job_guard.RETRY_AFTER_SECONDS)},
        )
    try:
        await grade_copy(process_id=req.process_id, job_id=job_id)
        _jobs[job_id] = {
            "job_id": job_id,
            "process_id": req.process_id,
            "status": "PROCESSING",
            "started_at": datetime.utcnow().isoformat(),
        }
        # FastAPI BackgroundTasks creates a fresh DB session per request; we want
        # the BG task to own its own session that survives the response cycle.
        background.add_task(_run_with_session, payload, job_id, claim is not None, gate)
    except BaseException:
        # BaseException: a cancelled request must not keep the reservation.
        gate.release(job_id)
        if claim is not None:
            await job_guard.release(req.process_id, job_id)
        raise
    return CopyCheckGradeResponse(job_id=job_id, status="PROCESSING")


@router.post(
    "/inspect",
    response_model=InspectResponse,
    dependencies=[Depends(require_internal_service_token)],
)
async def inspect_upload(req: InspectRequest):
    """Page count and encryption of an uploaded answer sheet (spec 7.5), so
    assessment_service never parses PDFs in the pods that serve live exams.
    200 for every file, usable or not (`error` says why not); 429 with
    Retry-After only when this pod's inspect slots stay full for a few seconds."""
    try:
        return InspectResponse(**await upload_inspect.inspect_pdf_url(req.pdf_url))
    except upload_inspect.InspectBusy:
        raise HTTPException(
            status_code=429,
            detail="copy-check inspect is busy on this pod; retry later",
            headers={"Retry-After": "2"},
        )


@router.post(
    "/identify",
    response_model=CopyCheckIdentifyResponse,
    dependencies=[Depends(require_internal_service_token)],
)
async def identify_copy(req: CopyCheckIdentifyRequest, db: Session = Depends(db_dependency)):
    """Who wrote this copy: the name / roll number / class handwritten at the top.

    Synchronous and cheap (one or two header images); the caller matches the
    reading against its students. Billing rides on the batch that uses it.
    """
    from ..services.api_key_resolver import ApiKeyResolver
    from ..services.chat_llm_client import ChatLLMClient
    from ..services.copy_check.grader import DEFAULT_MODEL
    from ..services.copy_check.identify import identify_student

    llm = ChatLLMClient(ApiKeyResolver(db))
    try:
        result = await identify_student(
            req.pdf_url, llm, req.preferred_model or DEFAULT_MODEL, institute_id=req.institute_id,
        )
    except Exception as e:
        logger.warning("copy-check identify failed for %s: %s", req.pdf_url[:120], e)
        raise HTTPException(status_code=422, detail=f"could not read the copy: {e}")
    result.pop("usage", None)
    return CopyCheckIdentifyResponse(**result)


# run()'s outcome -> the copy_check_job status recorded for it. Anything else
# (an older run() that returned None) keeps the previous meaning: COMPLETED.
_CLAIM_STATUS_BY_OUTCOME = {
    "COMPLETED": job_guard.STATUS_COMPLETED,
    "NO_CHARGE": job_guard.STATUS_NO_CHARGE,
    "FAILED": job_guard.STATUS_FAILED,
}


async def _run_with_session(
    payload: dict,
    job_id: str,
    claimed: bool = False,
    gate: Optional["job_guard.SlotGate"] = None,
) -> None:
    """Run one grade job. Confirms and finally frees the pod slot reserved by
    submit_grade_job and, when the run is recorded in copy_check_job, keeps its
    heartbeat fresh and at the end records run()'s outcome on it: COMPLETED
    (graded, charge due), NO_CHARGE (graded, nothing to charge) or FAILED (not
    graded, or run() itself raised). run() reports its own success or failure
    to Java; the nightly billing reconciliation reads COMPLETED rows."""
    process_id = payload["process_id"]
    gate = gate or job_guard.gate_for(payload.get("answer_mode"))
    gate.start(job_id)
    heartbeat = asyncio.create_task(job_guard.heartbeat_loop(process_id, job_id)) if claimed else None
    final_status = job_guard.STATUS_FAILED
    try:
        with db_session() as bg_db:
            outcome = await run(payload, job_id, bg_db)
        final_status = _CLAIM_STATUS_BY_OUTCOME.get(outcome, job_guard.STATUS_COMPLETED)
    finally:
        if heartbeat is not None:
            heartbeat.cancel()
            try:
                await heartbeat
            except (asyncio.CancelledError, Exception):
                pass
        gate.release(job_id)
        _jobs.pop(job_id, None)
        if claimed:
            await job_guard.finish(process_id, job_id, status=final_status)


@router.post(
    "/{job_id}/cancel",
    dependencies=[Depends(require_internal_service_token)],
)
async def cancel_job(job_id: str):
    cancellation.cancel(job_id)
    return {"job_id": job_id, "cancelled": True}


@router.post(
    "/by-process/{process_id}/cancel",
    dependencies=[Depends(require_internal_service_token)],
)
async def cancel_by_process(process_id: str):
    """Cancel by process_id — closes the race where Java's stop endpoint
    fires before ai_service has echoed back the job_id (#16)."""
    cancellation.cancel_by_process(process_id)
    return {"process_id": process_id, "cancelled": True}


@router.get(
    "/{job_id}/status",
    dependencies=[Depends(require_internal_service_token)],
)
async def get_status(job_id: str):
    if job_id not in _jobs:
        raise HTTPException(status_code=404, detail="Job not found or already completed")
    return _jobs[job_id]


# --------------------------- Rubric CRUD ------------------------------------

def _require_rubric_institute(db: Session, assessment_id: str, institute_id: Optional[str]) -> None:
    """403 when the caller names an institute and the assessment's rubric row
    belongs to a different one. No institute named = unchanged behaviour."""
    if not institute_id:
        return
    try:
        ensure_same_institute(CopyCheckRubricRepository(db).get(assessment_id), institute_id)
    except RubricInstituteMismatch:
        raise HTTPException(status_code=403, detail="Rubric belongs to a different institute")


@router.get(
    "/rubric/{assessment_id}",
    response_model=RubricResponse,
    dependencies=[Depends(require_internal_service_token)],
)
async def get_rubric(
    assessment_id: str,
    institute_id: Optional[str] = None,
    db: Session = Depends(db_dependency),
):
    repo = CopyCheckRubricRepository(db)
    row = repo.get(assessment_id)
    if not row or (institute_id and str(row.institute_id) != str(institute_id)):
        raise HTTPException(status_code=404, detail="Rubric not found")
    return RubricResponse(
        assessment_id=row.assessment_id,
        institute_id=row.institute_id,
        rubric_version=row.rubric_version,
        rubric=json.loads(row.rubric_json),
        model_answers=json.loads(row.model_answers_json) if row.model_answers_json else {},
        updated_at=row.updated_at.isoformat() if row.updated_at else "",
    )


@router.post(
    "/rubric",
    response_model=RubricResponse,
    dependencies=[Depends(require_internal_service_token)],
)
async def upsert_rubric(req: UpsertRubricRequest, db: Session = Depends(db_dependency)):
    repo = CopyCheckRubricRepository(db)
    rubric_dict = {qid: r.model_dump() for qid, r in req.rubric.items()}
    try:
        row = repo.upsert(
            assessment_id=req.assessment_id,
            institute_id=req.institute_id,
            rubric=rubric_dict,
            model_answers=req.model_answers,
            created_by=req.created_by,
        )
    except RubricInstituteMismatch:
        raise HTTPException(status_code=403, detail="Rubric belongs to a different institute")
    return RubricResponse(
        assessment_id=row.assessment_id,
        institute_id=row.institute_id,
        rubric_version=row.rubric_version,
        rubric=json.loads(row.rubric_json),
        model_answers=json.loads(row.model_answers_json) if row.model_answers_json else {},
        updated_at=row.updated_at.isoformat() if row.updated_at else "",
    )


@router.patch(
    "/rubric/{assessment_id}",
    response_model=PatchRubricResponse,
    dependencies=[Depends(require_internal_service_token)],
)
async def patch_rubric(
    assessment_id: str,
    req: PatchRubricRequest,
    db: Session = Depends(db_dependency),
):
    """Per-question merge (spec 7.4.1): for each question a `rubric` /
    `model_answer` key replaces that field, null deletes it, a missing key
    leaves it alone. One transaction, one version bump. 409 when the rubric
    belongs to another institute, 412 when `if_match` is not the current version.

    Tenancy: when the assessment has no rubric row yet, the first PATCH creates
    one owned by `institute_id`, and ai_service cannot check that the
    assessment really belongs to that institute. The caller (assessment_service)
    MUST verify assessment ownership first (requireAssessmentInInstitute) and
    answer 404 for another institute's exam id before calling this."""
    patches = {
        qid: {field: getattr(patch, field) for field in patch.model_fields_set}
        for qid, patch in req.questions.items()
    }
    for patch in patches.values():
        if patch.get("rubric") is not None:
            patch["rubric"] = patch["rubric"].model_dump()
    try:
        row = CopyCheckRubricRepository(db).patch_questions(
            assessment_id, req.institute_id, patches, if_match=req.if_match, updated_by=req.updated_by,
        )
    except RubricInstituteMismatch:
        raise HTTPException(status_code=409, detail="Rubric belongs to a different institute")
    except RubricVersionMismatch as e:
        raise HTTPException(status_code=412, detail=f"rubric_version_mismatch: current version is {e.current}")
    return PatchRubricResponse(version=row.rubric_version)


@router.delete(
    "/rubric/{assessment_id}",
    dependencies=[Depends(require_internal_service_token)],
)
async def delete_rubric(
    assessment_id: str,
    institute_id: Optional[str] = None,
    db: Session = Depends(db_dependency),
):
    _require_rubric_institute(db, assessment_id, institute_id)
    repo = CopyCheckRubricRepository(db)
    deleted = repo.delete(assessment_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Rubric not found")
    return {"assessment_id": assessment_id, "deleted": True}


@router.put(
    "/rubric/{assessment_id}/question/{question_id}",
    dependencies=[Depends(require_internal_service_token)],
)
async def upsert_question_answer(
    assessment_id: str,
    question_id: str,
    req: UpsertQuestionAnswerRequest,
    institute_id: Optional[str] = None,
    db: Session = Depends(db_dependency),
):
    """PATCH semantics (spec 7.4.1): only the fields present in the body
    change (`null` clears one); sending just a model answer no longer wipes
    the step rubric. Always bumps the assessment's rubric_version, under the
    rubric row's lock and in the same transaction as the override, creating
    the row at version 1 when the institute is known and none exists yet."""
    fields: dict = {}
    if "model_answer" in req.model_fields_set:
        fields["model_answer"] = req.model_answer
    if "step_rubric" in req.model_fields_set:
        fields["step_rubric"] = req.step_rubric.model_dump() if req.step_rubric else None
    rubric_repo = CopyCheckRubricRepository(db)
    for attempt in range(2):
        try:
            # Lock + tenant check first, so the override is never written for a
            # rubric row that belongs to another institute.
            version = rubric_repo.bump_version(assessment_id, institute_id, commit=False)
            row = CopyCheckQuestionAnswerRepository(db).patch(assessment_id, question_id, fields, commit=False)
            db.commit()
            break
        except RubricInstituteMismatch:
            raise HTTPException(status_code=403, detail="Rubric belongs to a different institute")
        except IntegrityError:
            # Two first writes raced to create the rubric row (or the override
            # row). Roll back and retry once against the row the winner made.
            db.rollback()
            if attempt == 1:
                raise
    return {
        "assessment_id": assessment_id,
        "question_id": question_id,
        "model_answer": row.model_answer,
        "rubric_version": version,
        "updated_at": row.updated_at.isoformat() if row.updated_at else "",
    }


@router.delete(
    "/rubric/{assessment_id}/question/{question_id}",
    dependencies=[Depends(require_internal_service_token)],
)
async def delete_question_answer(
    assessment_id: str,
    question_id: str,
    institute_id: Optional[str] = None,
    db: Session = Depends(db_dependency),
):
    _require_rubric_institute(db, assessment_id, institute_id)
    repo = CopyCheckQuestionAnswerRepository(db)
    deleted = repo.delete(assessment_id, question_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Question answer not found")
    return {"assessment_id": assessment_id, "question_id": question_id, "deleted": True}
