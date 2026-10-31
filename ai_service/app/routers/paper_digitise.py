"""Question-paper PDF → gradable questions, for offline tests.

    POST /paper-digitise/v1/estimate      what reading this PDF will cost (pages, credits, balance)
    POST /paper-digitise/v1/start         202 → task id; 402 when the institute cannot afford it
    GET  /paper-digitise/v1/jobs/{id}     poll; the questions + what was charged once COMPLETED
    GET  /paper-digitise/v1/jobs/for-assessment/{assessment_id}
                                          the newest read started for a test (reading / ready / failed)

A read takes minutes, so it is started with the test's id and left to run: when it
settles, the teacher who started it gets a bell alert and the test's own page picks
the result up from the lookup above — nobody has to keep a dialog open.

Charged on delivery: the task bills `paper_digitise` (per page + base, floored
by the parametric estimate the teacher saw) only after questions come back, and
the amount is written into the result so the UI can show exactly what was
deducted. Keyed on the task id, so a retried job never charges twice.
"""
from __future__ import annotations

import json
import logging
from decimal import Decimal
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..db import db_dependency, db_session
from ..models.ai_task import AiTaskInputType, AiTaskType
from ..models.ai_token_usage import RequestType
from ..repositories.ai_task_repository import AiTaskRepository
from ..services import ai_task_service, paper_digitise
from ..services.ai_billing import charge_tool, metering_user, preflight_tool_credits
from ..services.ai_task_service import AiTaskService
from ..services.model_selection import resolve_models
from ..services.question_gen_service import QUESTIONS_USE_CASE
from ..core.security import decode_access_token
from ..services import staff_notify
from .knowledge_base import Caller, get_caller

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/paper-digitise/v1", tags=["Question paper digitisation"])


class EstimateRequest(BaseModel):
    pdf_url: str = Field(..., description="The paper as attached to the test description")
    institute_id: Optional[str] = Field(None, description="INTERNAL callers only")


class StartRequest(EstimateRequest):
    expected_total_marks: Optional[float] = Field(
        None, description="What the teacher typed as the test's total; used to sanity-check the marks read"
    )
    title: Optional[str] = None
    preferred_model: Optional[str] = None
    assessment_id: Optional[str] = Field(
        None, description="The test this paper belongs to; lets its page find the read and the alert link to it"
    )
    return_path: Optional[str] = Field(
        None, description="Dashboard path to open from the alert (relative, e.g. /study-library/...)"
    )


def _notice_email_html(name: Optional[str], title: str, text: str, return_url: Optional[str]) -> str:
    """Plain, brand-neutral note (no platform names — the institute's sender is
    what the teacher sees), linking back to the test on their own portal."""
    from html import escape
    greeting = f"Hi {escape(name)}," if name else "Hi,"
    link = (f'<p><a href="{escape(return_url)}">Open the test</a></p>'
            if return_url and return_url.startswith("https://") else "")
    return (
        f"<p>{greeting}</p><p><strong>{escape(title)}</strong></p><p>{escape(text)}</p>{link}"
        "<p>Learners see nothing until you review and release.</p>"
    )


def _pdf_or_400(exc: paper_digitise.PaperPdfError) -> HTTPException:
    return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))


def _estimate_or_402(db: Session, *, pages: int, institute_id: str) -> Dict[str, Any]:
    estimate = preflight_tool_credits(
        db, tool_key=paper_digitise.TOOL_KEY,
        tool_params=paper_digitise.tool_params(pages), institute_id=institute_id,
    )
    if estimate.get("sufficient") is False:
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail={
                "message": (
                    f"Reading this paper needs about {estimate['estimated_credits']:.0f} credits but "
                    f"only {estimate.get('current_balance', 0):.0f} are available. Top up to continue."
                ),
                "estimate": estimate,
            },
        )
    return estimate


def _charge(
    *, pages: int, paper: paper_digitise.DigitisedPaper, institute_id: str,
    user_id: Optional[str], task_id: str,
) -> Dict[str, Any]:
    """Deduct for the delivered paper and report what happened.

    Returns {credits_charged, balance_after, billed}. A billing failure never
    fails the job — the questions exist and the teacher is mid-flow — but it is
    reported as billed=False rather than shown as a zero charge.
    """
    try:
        with db_session() as db:
            charged = charge_tool(
                db,
                tool_key=paper_digitise.TOOL_KEY,
                tool_params=paper_digitise.tool_params(pages),
                request_type=RequestType.ASSESSMENT,
                model=paper.model or "unknown",
                prompt_tokens=paper.prompt_tokens,
                completion_tokens=paper.completion_tokens,
                institute_id=institute_id,
                user_id=user_id,
                user_role="ADMIN",
                request_id=task_id,
                idempotency_key=f"paper_digitise:{task_id}",
                # Usage-event attribution only (the ledger role above is unchanged).
                use_case="questions",
                metering=metering_user(user_id, surface="ADMIN_APP"),
                usage_context={"task_id": task_id, "pages": pages},
            )
            from ..services.credit_service import CreditService  # local: avoids an import cycle
            balance = CreditService(db).get_balance(institute_id)
            after = float(balance.current_balance) if balance else None
        return {"credits_charged": float(Decimal(charged)), "balance_after": after, "billed": True}
    except Exception as exc:  # noqa: BLE001
        logger.warning("paper_digitise billing failed for task %s: %s", task_id, exc)
        return {"credits_charged": None, "balance_after": None, "billed": False}


@router.post("/estimate")
async def estimate(
    body: EstimateRequest,
    caller: Caller = Depends(get_caller),
    db: Session = Depends(db_dependency),
):
    """Fetch + validate the PDF and price the read, before anything is charged."""
    resolved = caller.require_institute(body.institute_id)
    try:
        pdf = await paper_digitise.fetch_paper_pdf(body.pdf_url)
    except paper_digitise.PaperPdfError as exc:
        raise _pdf_or_400(exc) from exc
    est = preflight_tool_credits(
        db, tool_key=paper_digitise.TOOL_KEY,
        tool_params=paper_digitise.tool_params(pdf.pages), institute_id=resolved,
    )
    return {
        "file_name": pdf.file_name,
        "pages": pdf.pages,
        "size_bytes": pdf.size_bytes,
        "estimate": est,
    }


def _caller_contact(authorization: Optional[str]) -> Dict[str, Optional[str]]:
    """Email + name from the dashboard JWT, for the notice when the read settles."""
    token = (authorization or "").removeprefix("Bearer ").strip()
    claims = decode_access_token(token) or {} if token else {}
    return {"email": claims.get("email") or None, "name": claims.get("fullname") or None}


@router.post("/start", status_code=status.HTTP_202_ACCEPTED)
async def start(
    body: StartRequest,
    caller: Caller = Depends(get_caller),
    db: Session = Depends(db_dependency),
    authorization: Optional[str] = Header(None),
    origin: Optional[str] = Header(None),
):
    """Read the paper in the background. Poll GET /jobs/{task_id}."""
    resolved = caller.require_institute(body.institute_id)
    contact = _caller_contact(authorization)
    # The email needs an absolute link; the dashboard's own origin (white-label
    # portals differ per institute) + the relative path the page sent.
    return_url = (
        f"{origin.rstrip('/')}{body.return_path}"
        if origin and origin.startswith("https://") and body.return_path and body.return_path.startswith("/")
        else None
    )
    try:
        pdf = await paper_digitise.fetch_paper_pdf(body.pdf_url)
    except paper_digitise.PaperPdfError as exc:
        raise _pdf_or_400(exc) from exc
    est = _estimate_or_402(db, pages=pdf.pages, institute_id=resolved)

    primary_model, fallback_models = resolve_models(db, QUESTIONS_USE_CASE, body.preferred_model)
    models: List[str] = [primary_model, *fallback_models]
    task = AiTaskService(AiTaskRepository(db)).create(
        task_type=AiTaskType.PDF_TO_QUESTIONS,
        input_id=pdf.file_name[:255],
        input_type=AiTaskInputType.PDF_ID,
        task_name=f"Question paper — {body.title or pdf.file_name}"[:255],
        institute_id=resolved,
        dynamic_values={
            "model": primary_model,
            "params": {
                "pdf_url": body.pdf_url,
                "pages": pdf.pages,
                "tool": paper_digitise.TOOL_KEY,
                # For the lookup by test and for the alert when the read settles.
                "assessment_id": body.assessment_id,
                "started_by": caller.user_id,
                "started_by_email": contact["email"],
                "return_path": body.return_path,
            },
        },
    )
    task_id = task.id
    user_id = caller.user_id
    expected_total = body.expected_total_marks
    test_name = (body.title or pdf.file_name)[:120]

    async def _work() -> str:
        try:
            paper = await paper_digitise.digitise(pdf, models, expected_total=expected_total)
        except RuntimeError:
            raise  # already worded for the teacher
        except Exception as exc:  # noqa: BLE001
            # The message becomes the card text and the bell body: a Python
            # error string helps nobody there. The traceback stays in the log.
            logger.exception("paper_digitise task=%s crashed", task_id)
            raise RuntimeError(
                "The paper could not be read this time because of an internal error. "
                "Nothing was charged — please try again in a minute."
            ) from exc
        if not paper.questions:
            # Nothing usable → the job FAILS and nothing is charged (MathPix cost is ours).
            raise RuntimeError(
                "No questions could be read from this PDF. If it is a scan, make sure the text is "
                "legible; otherwise create the test without AI checking."
            )
        billing = _charge(
            pages=pdf.pages, paper=paper, institute_id=resolved, user_id=user_id, task_id=task_id,
        )
        # `questions` in the LLM shape keeps this task readable in the AI Center
        # history (its converter expects that shape); the builder-ready payload
        # the offline-test form needs lives under `digitised`.
        return json.dumps(
            {
                "title": paper.title,
                "questions": paper.raw_questions,
                "digitised": {
                    **paper.to_dict(),
                    "pages": pdf.pages,
                    "file_name": pdf.file_name,
                    "estimate": est,
                    **billing,
                },
            },
            ensure_ascii=False,
        )

    async def _tell_teacher(final_status: Any, result_json: Optional[str], message: Optional[str]) -> None:
        # Bell + email, like the copy-check notice: the teacher who pressed the
        # button has usually moved on by the time a read settles.
        if not user_id:
            return
        link = {"assessmentId": body.assessment_id or "", "taskId": task_id, "path": body.return_path or ""}
        if str(getattr(final_status, "value", final_status)) == "COMPLETED":
            count = 0
            try:
                count = len(((json.loads(result_json or "{}") or {}).get("digitised") or {}).get("questions") or [])
            except ValueError:
                pass
            title = f"Question paper read for {test_name}"
            text = (f"{count} questions with their marks are ready. Review them on the test to turn on "
                    "AI checking of the answer sheets.")
        else:
            title = f"Could not read the question paper for {test_name}"
            text = ((message or "The paper could not be read.") + " Nothing was charged. You can try again "
                    "from the test, or check the sheets by hand.")
        await staff_notify.system_alert(resolved, [user_id], title, text, source_id=task_id, data=link)
        await staff_notify.email(
            resolved,
            [{"email": contact["email"], "name": contact["name"], "userId": user_id}],
            title,
            _notice_email_html(contact["name"], title, text, return_url),
            source_id=task_id,
        )

    ai_task_service.schedule(task_id, _work, on_done=_tell_teacher)
    logger.info("paper_digitise started task=%s pages=%s institute=%s assessment=%s",
                task_id, pdf.pages, resolved, body.assessment_id)
    return {
        "task_id": task_id,
        "file_name": pdf.file_name,
        "pages": pdf.pages,
        "estimate": est,
    }


def _job_payload(task: Any) -> Dict[str, Any]:
    result: Optional[Dict[str, Any]] = None
    if task.result_json:
        try:
            result = (json.loads(task.result_json) or {}).get("digitised")
        except Exception:  # noqa: BLE001
            result = None
    return {
        "task_id": task.id,
        "status": task.status,
        "status_message": task.status_message,
        "created_at": task.created_at.isoformat() if getattr(task, "created_at", None) else None,
        "result": result,
    }


@router.get("/jobs/for-assessment/{assessment_id}")
async def get_job_for_assessment(
    assessment_id: str,
    institute_id: Optional[str] = Query(None),
    caller: Caller = Depends(get_caller),
    db: Session = Depends(db_dependency),
):
    """The newest read started for this test, or 404 when none was."""
    resolved = caller.require_institute(institute_id)
    needle = f'"assessment_id": "{assessment_id}"'
    task = (
        AiTaskRepository(db).query_for_institute(resolved, AiTaskType.PDF_TO_QUESTIONS.value)
        .filter(AiTaskRepository.dynamic_values_contains(needle))
        .first()
    )
    if not task:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No read for this test")
    return _job_payload(task)


@router.get("/jobs/{task_id}")
async def get_job(
    task_id: str,
    institute_id: Optional[str] = Query(None),
    caller: Caller = Depends(get_caller),
    db: Session = Depends(db_dependency),
):
    """Poll. `result` is the digitised paper (questions, warnings, credits) once COMPLETED."""
    resolved = caller.require_institute(institute_id)
    task = AiTaskRepository(db).get(task_id)
    if not task or task.institute_id != resolved:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Job not found")
    return _job_payload(task)
