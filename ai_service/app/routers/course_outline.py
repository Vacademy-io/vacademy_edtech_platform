from __future__ import annotations

from fastapi import APIRouter, Depends, Query, HTTPException, Request, status
from fastapi.responses import StreamingResponse
import asyncio
import uuid
import json
from typing import Optional
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import db_dependency
from ..dependencies import get_course_outline_service
from ..schemas.course_outline import (
    CourseOutlineRequest, 
    CourseOutlineResponse, 
    CourseUserPromptRequest
)
from ..services.course_outline_service import CourseOutlineGenerationService
from ..core.exceptions import PaymentRequiredError


router = APIRouter(prefix="/course", tags=["course-outline"])


def _attach_verified_metering(service, request: Request, institute_id) -> None:
    """Usage-event attribution from the caller's VERIFIED JWT (signature +
    institute membership), when there is one. Without it the service records
    the body/query user id only as an unverified claim. Never raises."""
    try:
        from ..services.ai_billing import metering_from_request

        ctx = metering_from_request(request, institute_id)
        if ctx is not None and getattr(ctx, "actor_user_id", None):
            service._metering = ctx
    except Exception:  # noqa: BLE001 - attribution never affects the request
        pass


@router.post(
    "/outline/v1/generate",
    response_model=CourseOutlineResponse,
    summary="Generate a course outline using AI",
)
async def generate_course_outline(
    payload: CourseOutlineRequest,
    request: Request,
    service: CourseOutlineGenerationService = Depends(get_course_outline_service),
    db: Session = Depends(db_dependency),
) -> CourseOutlineResponse:
    """
    Generate an abstract course outline (headings, subjects, chapters, slides)
    based on user prompt, optional existing course tree, and optional course
    metadata from admin-core-service.
    """
    # Pre-flight credit check (parametric course_outline price; None = allow)
    if payload.institute_id:
        from ..services.ai_billing import preflight_tool_credits
        estimate = preflight_tool_credits(
            db, tool_key="course_outline", tool_params={}, institute_id=payload.institute_id
        )
        if estimate.get("sufficient") is False:
            raise HTTPException(
                status_code=status.HTTP_402_PAYMENT_REQUIRED,
                detail=(
                    f"Insufficient credits: course outline needs ≈{estimate.get('estimated_credits')} "
                    f"credits, balance is {estimate.get('current_balance')}. Please top up."
                ),
            )
    _attach_verified_metering(service, request, payload.institute_id)
    try:
        return await service.generate_outline(payload)
    except PaymentRequiredError as exc:
        raise HTTPException(
            status_code=402,
            detail=str(exc),
        ) from exc


@router.post(
    "/ai/v1/generate",
    summary="Generate course outline with SSE streaming (matches media-service pattern)",
    response_class=StreamingResponse,
)
async def stream_course_outline(
    institute_id: str,
    payload: CourseUserPromptRequest,
    model: Optional[str] = Query(default=None, description="Optional LLM model to use"),
    user_id: Optional[str] = Query(default=None, description="Optional user identifier for user-level API key lookup"),
    request: Request = None,
    service: CourseOutlineGenerationService = Depends(get_course_outline_service),
    db: Session = Depends(db_dependency),
) -> StreamingResponse:
    """
    Generate course outline using streaming SSE events (matches media-service endpoint pattern).
    Returns Server-Sent Events stream with outline generation progress.

    Args:
        institute_id: Institute identifier (required, from query parameter).
        user_id: Optional user identifier for user-level API key lookup (waterfall priority).
        model: Optional LLM model to use. Defaults to database default or LLM_DEFAULT_MODEL from environment.
        payload: Request containing user prompt, course tree, and course depth.
    """
    # Pre-flight credit check (parametric course_outline price; None = allow)
    if institute_id:
        from ..services.ai_billing import preflight_tool_credits
        estimate = preflight_tool_credits(
            db, tool_key="course_outline", tool_params={}, institute_id=institute_id
        )
        if estimate.get("sufficient") is False:
            raise HTTPException(
                status_code=status.HTTP_402_PAYMENT_REQUIRED,
                detail=(
                    f"Insufficient credits: course outline needs ≈{estimate.get('estimated_credits')} "
                    f"credits, balance is {estimate.get('current_balance')}. Please top up."
                ),
            )

    # A locked library must fail HERE, with a price, rather than deep inside
    # generation where the only honest option left is to build the course
    # ungrounded and say nothing.
    if payload.kb_grounding:
        from ..services.kb.repository import KbRepository

        repo = KbRepository(db)
        kb = repo.get_kb(payload.kb_grounding.knowledge_base_id, institute_id)
        if not kb:
            raise HTTPException(status_code=404, detail="Knowledge base not found")
        if not repo.is_usable(kb, institute_id):
            raise HTTPException(
                status_code=status.HTTP_402_PAYMENT_REQUIRED,
                detail={
                    "message": f"Unlock '{kb['name']}' to build courses from it",
                    "knowledge_base_id": kb["id"],
                    "reason": "LIBRARY_LOCKED",
                },
            )

    # Convert CourseUserPromptRequest to internal CourseOutlineRequest
    from ..services.ai_models_service import AIModelsService
    default_model = AIModelsService(db).get_models_for_use_case("outline").default_model.model_id
    
    final_model = model or payload.model or default_model

    internal_request = CourseOutlineRequest(
        institute_id=institute_id,
        user_prompt=payload.user_prompt,
        existing_course_tree=json.loads(payload.course_tree) if payload.course_tree else None,
        model=final_model,
        course_depth=payload.course_depth,
        generation_options=payload.generation_options,
        user_id=user_id,  # Extracted from query parameter for waterfall key resolution
        reference_document_file_ids=payload.reference_document_file_ids,
        kb_grounding=payload.kb_grounding,
        # NOTE: Keys are NOT accepted from frontend - resolved automatically from DB (user → institute) or env
    )

    request_id = str(uuid.uuid4())
    _attach_verified_metering(service, request, institute_id)

    # Heartbeat: document grounding + the single outline LLM call can be silent
    # for longer than a proxy idle timeout; an SSE comment keeps the connection
    # alive (the client parser ignores non-"data:" lines).
    _HEARTBEAT_SECONDS = 15

    async def event_generator():
        # Background pump + queue so the heartbeat timeout never cancels the
        # generator's in-flight step (see the content endpoint for rationale).
        queue: asyncio.Queue = asyncio.Queue()
        _DONE = object()

        async def _pump():
            try:
                async for ev in service.stream_outline_events(internal_request, request_id):
                    await queue.put(("data", ev))
            except PaymentRequiredError as exc:
                await queue.put(("402", str(exc)))
            except Exception as exc:  # noqa: BLE001
                await queue.put(("fatal", str(exc)))
            finally:
                await queue.put((_DONE, None))

        task = asyncio.create_task(_pump())
        try:
            while True:
                try:
                    kind, val = await asyncio.wait_for(queue.get(), timeout=_HEARTBEAT_SECONDS)
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"
                    continue
                if kind is _DONE:
                    break
                if kind == "data":
                    yield f"data: {val}\n\n"
                elif kind == "402":
                    yield f"data: {json.dumps({'type': 'ERROR', 'code': 402, 'message': val})}\n\n"
                elif kind == "fatal":
                    yield f"data: {json.dumps({'type': 'ERROR', 'message': val})}\n\n"
        finally:
            task.cancel()

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        }
    )


__all__ = ["router"]


