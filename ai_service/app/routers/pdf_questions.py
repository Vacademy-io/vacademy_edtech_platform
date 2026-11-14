"""PDF question-generation router — migrated from media_service
PDFQuestionGeneratorController (core PDF entry points).

  POST /ai-service/ai/get-question-pdf/math-parser/start-process-pdf          (multipart → pdfId)
  POST /ai-service/ai/get-question-pdf/math-parser/start-process-pdf-file-id  (fileId → pdfId)
  GET  /ai-service/ai/get-question-pdf/math-parser/pdf-to-html                (pdfId → html)
  GET  /ai-service/ai/get-question-pdf/math-parser/pdf-to-questions           (async → taskId)

MathPix submit/poll lives in pdf_questions_service; the async question step
reuses the shared question engine (question_gen_service + question_format).
"""
from __future__ import annotations

import asyncio
import json
import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from ..core.security import get_optional_user
from ..db import db_dependency
from ..models.ai_task import AiTaskInputType, AiTaskType
from ..repositories.ai_task_repository import AiTaskRepository
from ..schemas.ai_task import LecturePlanKickoffResponse
from ..services import (
    ai_task_service, audit_client, mathpix_pdf_service, pdf_local_convert, pdf_questions_service,
    question_extract_service, question_gen_service,
)
from ..services.ai_billing import preflight_tool_credits
from ..services.ai_task_service import AiTaskService
from ..services.model_selection import resolve_models
from ..services.pdf_questions_service import StillProcessing
from ..services.s3_service import S3Service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ai/get-question-pdf", tags=["AI Question Generation"])


class AutoDocumentSubmitResponse(BaseModel):
    pdf_id: Optional[str] = None
    # Set by mode=extract: whether the file needed OCR (MathPix, charged per
    # page) or was read locally for free, how many pages it has, how many
    # questions it prints and what extracting them will cost — shown to the
    # teacher before they press the button.
    ocr: Optional[bool] = None
    pages: Optional[int] = None
    ocr_pages: Optional[int] = None
    question_count: Optional[int] = None
    estimated_credits: Optional[float] = None
    # The paper's own sections (name, question count, marks) and its marking
    # scheme, so the teacher can be asked "one section per paper section, or
    # everything in one?" before extracting. Empty when the paper has none.
    sections: Optional[List[Dict[str, Any]]] = None
    marking: Optional[Dict[str, Any]] = None
    duration_minutes: Optional[int] = None


AUDIT_ENTITY = "AI_QUESTION_EXTRACTION"


class PdfFileIdRequest(BaseModel):
    """Mirror of FileIdSubmitRequest (@JsonNaming snake → file_id). Accept the
    camelCase fileId too, defensively."""
    model_config = ConfigDict(extra="ignore", populate_by_name=True)
    file_id: Optional[str] = Field(default=None, validation_alias="file_id")
    fileId: Optional[str] = None

    def resolved(self) -> Optional[str]:
        return self.file_id or self.fileId


class PdfHtmlResponse(BaseModel):
    html: Optional[str] = None


@router.post("/math-parser/start-process-pdf", response_model=AutoDocumentSubmitResponse)
async def start_process_pdf(
    file: UploadFile = File(...),
    user=Depends(get_optional_user),
) -> AutoDocumentSubmitResponse:
    """Upload a PDF to S3, submit it to MathPix, return the pdfId."""
    try:
        content = await file.read()
        url = await asyncio.to_thread(
            S3Service().upload_file_content, content, file.filename or "upload.pdf",
            None, file.content_type or "application/pdf",
        )
        if not url:
            raise RuntimeError("File upload failed")
        pdf_id = await pdf_questions_service.start_from_url(url)
        return AutoDocumentSubmitResponse(pdf_id=pdf_id)
    except Exception as exc:  # noqa: BLE001
        logger.exception("start-process-pdf failed")
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc))


@router.post("/math-parser/start-process-pdf-file-id", response_model=AutoDocumentSubmitResponse)
async def start_process_pdf_from_file_id(
    body: PdfFileIdRequest,
    request: Request,
    mode: Optional[str] = Query(
        None,
        description="'extract' = read a digital PDF locally (free) and use MathPix only for scans; "
                    "absent = MathPix for every file, as before.",
    ),
    instituteId: Optional[str] = Query(None, description="for the cost estimate and the activity log (extract)"),
    fileName: Optional[str] = Query(None, description="shown in the activity log (extract)"),
    user=Depends(get_optional_user),
) -> AutoDocumentSubmitResponse:
    """Resolve a media fileId → URL, submit to MathPix, return the pdfId."""
    file_id = body.resolved()
    if not file_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="fileId is required")
    try:
        if (mode or "").strip().lower() == "extract":
            started = await pdf_local_convert.start_for_extraction(file_id)
            questions = started.get("question_count")
            ocr_pages = started.get("ocr_pages") or 0
            sections = started.get("sections") or []
            estimate = None
            if questions is not None:
                estimate = await asyncio.to_thread(
                    question_extract_service._estimated_credits, questions, ocr_pages, instituteId,
                )
            name = fileName or file_id
            how = (
                "read locally, free" if not started["ocr"]
                else (f"{ocr_pages} page(s) via OCR" if started.get("ocr_pages") else "scanned — sent to OCR")
            )
            audit_client.record_later(
                institute_id=instituteId, request=request, user=user,
                entity_type=AUDIT_ENTITY, entity_id=started["pdf_id"], action="UPLOAD",
                description=(
                    f"Uploaded '{name}' for question extraction — {started.get('pages') or '?'} page(s), {how}"
                    + (f", {questions} question(s) found, estimated {estimate:.0f} credits" if questions is not None and estimate is not None else "")
                    + (f", {len(sections)} section(s): " + ", ".join(sec["name"] for sec in sections) if sections else "")
                ),
                payload={"file_id": file_id, "pdf_id": started["pdf_id"], "pages": started.get("pages"),
                         "ocr_pages": ocr_pages, "question_count": questions, "estimated_credits": estimate,
                         "sections": [{"name": sec["name"], "count": sec["count"]} for sec in sections],
                         "marking": started.get("marking"), "duration_minutes": started.get("duration_minutes")},
            )
            return AutoDocumentSubmitResponse(
                pdf_id=started["pdf_id"], ocr=started["ocr"], pages=started.get("pages"),
                ocr_pages=ocr_pages, question_count=questions, estimated_credits=estimate,
                sections=sections, marking=started.get("marking"),
                duration_minutes=started.get("duration_minutes"),
            )
        pdf_id = await pdf_questions_service.start_from_file_id(file_id)
        return AutoDocumentSubmitResponse(pdf_id=pdf_id)
    except Exception as exc:  # noqa: BLE001
        logger.exception("start-process-pdf-file-id failed")
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc))


@router.get("/math-parser/pdf-to-html", response_model=PdfHtmlResponse)
async def pdf_to_html(pdfId: str = Query(...)) -> PdfHtmlResponse:
    """Return the converted HTML for a pdfId (cached). 425 while still converting."""
    try:
        html = await pdf_questions_service.fetch_or_convert_html(pdfId, allow_poll=False)
        return PdfHtmlResponse(html=html)
    except StillProcessing:
        raise HTTPException(status_code=status.HTTP_425_TOO_EARLY, detail=f"PDF {pdfId} is still processing")
    except Exception as exc:  # noqa: BLE001
        logger.exception("pdf-to-html failed")
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc))


@router.get("/math-parser/pdf-to-questions", response_model=LecturePlanKickoffResponse)
async def pdf_to_questions(
    request: Request,
    pdfId: str = Query(...),
    userPrompt: Optional[str] = Query(None),
    taskName: Optional[str] = Query(None),
    instituteId: Optional[str] = Query(None),
    preferredModel: Optional[str] = Query(None),
    generateImage: bool = Query(True),
    mode: Optional[str] = Query(
        None,
        description="'extract' = digitise the paper's own questions verbatim (Vsmart Extract); "
                    "absent = generate questions from the material (Vsmart Upload).",
    ),
    sectionMode: Optional[str] = Query(
        None,
        description="extract only: 'split' = one assessment section per paper section, "
                    "'single' = every question in one section; absent = split when the paper has sections.",
    ),
    db: Session = Depends(db_dependency),
    user=Depends(get_optional_user),
):
    """Async: poll MathPix for the PDF HTML, then generate questions. Poll
    /task-status/get-result for the AutoQuestionPaperResponse."""
    extract = (mode or "").strip().lower() == "extract"
    section_mode = (sectionMode or "").strip().lower() or None
    if extract and instituteId:
        # Credit gate before any model call, priced on the paper's own
        # question count when its text is already converted (the local
        # path), else on a typical paper; the real charge (per question
        # actually extracted) is recorded by the worker.
        known = pdf_local_convert.question_count_of(pdfId)
        estimate = preflight_tool_credits(
            db, tool_key=question_extract_service.TOOL_KEY,
            tool_params={"num_questions": known if known else 20}, institute_id=instituteId,
        )
        if estimate.get("sufficient") is False:
            raise HTTPException(
                status_code=status.HTTP_402_PAYMENT_REQUIRED,
                detail={
                    "message": (
                        f"Extracting a paper needs about {estimate['estimated_credits']:.0f} credits "
                        f"but only {estimate.get('current_balance', 0):.0f} are available. Top up to continue."
                    ),
                    "estimate": estimate,
                },
            )
    primary_model, fallback_models = resolve_models(
        db, question_gen_service.QUESTIONS_USE_CASE, preferredModel
    )
    task = AiTaskService(AiTaskRepository(db)).create(
        task_type=AiTaskType.PDF_TO_QUESTIONS,
        input_id=pdfId,
        input_type=AiTaskInputType.PDF_ID,
        task_name=taskName or "",
        institute_id=instituteId,
        dynamic_values={
            "model": primary_model,
            "params": {
                "pdfId": pdfId, "userPrompt": userPrompt, "generateImage": generateImage,
                **({"mode": "extract"} if extract else {}),
                **({"sectionMode": section_mode} if extract and section_mode else {}),
            },
        },
    )
    user_id = getattr(user, "user_id", None)
    models = [primary_model, *fallback_models]
    # Captured now: the worker runs after the request (and its headers) is gone.
    actor = audit_client.actor_from_request(request, user) if extract else None

    async def _extract() -> str:
        # The paper's own questions, all of them, key applied — never a
        # rewrite. userPrompt here is the teacher's notes, not a brief.
        # A scanned file went through MathPix (per-page cost); a digital
        # one was read locally for free — only the former is surcharged.
        html = await pdf_questions_service.fetch_or_convert_html(pdfId, allow_poll=True)
        vendor = await asyncio.to_thread(pdf_local_convert.vendor_of, pdfId)
        ocr_pages = pdf_local_convert.ocr_pages_from_vendor(vendor)
        if ocr_pages is None:  # whole-file MathPix job
            ocr_pages = await mathpix_pdf_service.get_num_pages(pdfId) or 0
        try:
            raw = await question_extract_service.extract_from_html(
                html=html, models=models, user_notes=userPrompt,
                institute_id=instituteId, user_id=user_id, billing_ref=task.id,
                ocr_pages=ocr_pages, section_mode=section_mode,
            )
        except Exception as exc:
            audit_client.record_later(
                institute_id=instituteId, actor=actor, entity_type=AUDIT_ENTITY, entity_id=task.id,
                action="FAIL", description=f"Question extraction failed: {str(exc)[:200]}",
                payload={"task_id": task.id, "pdf_id": pdfId}, response_status=500,
            )
            raise
        summary = (json.loads(raw).get("extraction") or {}) if raw else {}
        audit_client.record_later(
            institute_id=instituteId, actor=actor, entity_type=AUDIT_ENTITY, entity_id=task.id,
            action="COMPLETE",
            description=(
                f"Extracted {summary.get('questions', 0)} question(s) — answers for {summary.get('keyed', 0)}, "
                f"explanations for {summary.get('explained', 0)}"
                + (f", {summary['credits']:.0f} credits charged" if summary.get("credits") is not None else "")
                + (f", {summary['ocr_pages']} page(s) OCR" if summary.get("ocr_pages") else "")
                + (f", {len(summary['sections'])} section(s) ({summary.get('section_mode')})" if summary.get("sections") else "")
            ),
            payload={"task_id": task.id, "pdf_id": pdfId, **{k: v for k, v in summary.items() if k != "check"},
                     "check": summary.get("check")},
        )
        return raw

    async def _work() -> str:
        if extract:
            return await _extract()
        html = await pdf_questions_service.fetch_or_convert_html(pdfId, allow_poll=True)
        return await question_gen_service.questions_from_html(
            html=html, user_prompt=userPrompt, generate_image=generateImage,
            models=models, institute_id=instituteId, user_id=user_id,
        )

    if extract:
        audit_client.record_later(
            institute_id=instituteId, request=request, user=user,
            entity_type=AUDIT_ENTITY, entity_id=task.id, action="EXTRACT",
            description=f"Started question extraction (task {task.id})"
                        + (f" — {taskName}" if taskName else ""),
            payload={"task_id": task.id, "pdf_id": pdfId, "notes": userPrompt or None},
        )

    ai_task_service.schedule(task.id, _work)
    logger.info("Started pdf-to-questions%s: taskId=%s pdfId=%s model=%s",
                " (extract)" if extract else "", task.id, pdfId, primary_model)
    return LecturePlanKickoffResponse(
        taskId=task.id, model=primary_model, message="PDF question generation started"
    )


@router.get("/math-parser/image-to-questions", response_model=LecturePlanKickoffResponse)
async def image_to_questions(
    pdfId: str = Query(...),
    userPrompt: Optional[str] = Query(None),
    taskName: Optional[str] = Query(None),
    instituteId: Optional[str] = Query(None),
    preferredModel: Optional[str] = Query(None),
    generateImage: bool = Query(True),
    db: Session = Depends(db_dependency),
    user=Depends(get_optional_user),
):
    """Async image→questions. Identical pipeline to pdf-to-questions (the image
    is MathPix-converted to a pdfId via start-process), only the task type
    differs (IMAGE_TO_QUESTIONS / IMAGE_ID)."""
    primary_model, fallback_models = resolve_models(
        db, question_gen_service.QUESTIONS_USE_CASE, preferredModel
    )
    task = AiTaskService(AiTaskRepository(db)).create(
        task_type=AiTaskType.IMAGE_TO_QUESTIONS,
        input_id=pdfId,
        input_type=AiTaskInputType.IMAGE_ID,
        task_name=taskName or "",
        institute_id=instituteId,
        dynamic_values={
            "model": primary_model,
            "params": {"pdfId": pdfId, "userPrompt": userPrompt, "generateImage": generateImage},
        },
    )
    user_id = getattr(user, "user_id", None)
    models = [primary_model, *fallback_models]

    async def _work() -> str:
        html = await pdf_questions_service.fetch_or_convert_html(pdfId, allow_poll=True)
        return await question_gen_service.questions_from_html(
            html=html, user_prompt=userPrompt, generate_image=generateImage,
            models=models, institute_id=instituteId, user_id=user_id,
        )

    ai_task_service.schedule(task.id, _work)
    logger.info("Started image-to-questions: taskId=%s pdfId=%s model=%s", task.id, pdfId, primary_model)
    return LecturePlanKickoffResponse(
        taskId=task.id, model=primary_model, message="Image question generation started"
    )


@router.get("/math-parser/topic-wise/pdf-to-questions", response_model=LecturePlanKickoffResponse)
async def topic_wise_pdf_to_questions(
    pdfId: str = Query(...),
    userPrompt: Optional[str] = Query(None),
    instituteId: Optional[str] = Query(None),
    taskName: Optional[str] = Query(None),
    generateImage: bool = Query(True),
    db: Session = Depends(db_dependency),
    user=Depends(get_optional_user),
):
    """Async: PDF → questions grouped by topic (SORT_QUESTIONS_TOPIC_WISE)."""
    primary_model, fallback_models = resolve_models(db, question_gen_service.QUESTIONS_USE_CASE, None)
    task = AiTaskService(AiTaskRepository(db)).create(
        task_type=AiTaskType.SORT_QUESTIONS_TOPIC_WISE,
        input_id=pdfId, input_type=AiTaskInputType.PDF_ID,
        task_name=taskName or "", institute_id=instituteId,
        dynamic_values={
            "model": primary_model,
            "params": {"pdfId": pdfId, "generateImage": generateImage},
        },
    )
    user_id = getattr(user, "user_id", None)
    models = [primary_model, *fallback_models]

    async def _work() -> str:
        html = await pdf_questions_service.fetch_or_convert_html(pdfId, allow_poll=True)
        return await question_gen_service.questions_topic_wise(
            html=html, generate_image=generateImage, models=models,
            institute_id=instituteId, user_id=user_id,
        )

    ai_task_service.schedule(task.id, _work)
    return LecturePlanKickoffResponse(taskId=task.id, model=primary_model, message="Topic sorting started")


@router.get("/math-parser/pdf-to-extract-topic-questions", response_model=LecturePlanKickoffResponse)
async def pdf_extract_topic_questions(
    pdfId: str = Query(...),
    requiredTopics: str = Query(...),
    taskName: Optional[str] = Query(None),
    instituteId: Optional[str] = Query(None),
    generateImage: bool = Query(True),
    db: Session = Depends(db_dependency),
    user=Depends(get_optional_user),
):
    """Async: extract only questions matching requiredTopics (PDF_TO_QUESTIONS_WITH_TOPIC)."""
    primary_model, fallback_models = resolve_models(db, question_gen_service.QUESTIONS_USE_CASE, None)
    task = AiTaskService(AiTaskRepository(db)).create(
        task_type=AiTaskType.PDF_TO_QUESTIONS_WITH_TOPIC,
        input_id=pdfId, input_type=AiTaskInputType.PDF_ID,
        task_name=taskName or "", institute_id=instituteId,
        dynamic_values={
            "model": primary_model,
            "params": {"pdfId": pdfId, "requiredTopics": requiredTopics, "generateImage": generateImage},
        },
    )
    user_id = getattr(user, "user_id", None)
    models = [primary_model, *fallback_models]

    async def _work() -> str:
        html = await pdf_questions_service.fetch_or_convert_html(pdfId, allow_poll=True)
        return await question_gen_service.questions_extract_topic(
            html=html, required_topics=requiredTopics, generate_image=generateImage,
            models=models, institute_id=instituteId, user_id=user_id,
        )

    ai_task_service.schedule(task.id, _work)
    return LecturePlanKickoffResponse(taskId=task.id, model=primary_model, message="Topic extraction started")
