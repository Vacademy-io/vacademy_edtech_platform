from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import StreamingResponse
import uuid
import json
import asyncio

from ..dependencies import get_course_outline_service
from ..schemas.content_generation import ContentGenerationRequest
from ..services.course_outline_service import CourseOutlineGenerationService
from ..core.exceptions import PaymentRequiredError
from ..db import db_dependency
from sqlalchemy.orm import Session


router = APIRouter(prefix="/course", tags=["content-generation"])


@router.post(
    "/content/v1/generate",
    summary="Generate content for todos in an existing coursetree",
    response_class=StreamingResponse,
)
async def generate_content_from_coursetree(
    payload: ContentGenerationRequest,
    request: Request,
    service: CourseOutlineGenerationService = Depends(get_course_outline_service),
    db: Session = Depends(db_dependency),
) -> StreamingResponse:
    """
    Generate content for todos in an existing coursetree.

    This endpoint is called by the frontend when the user clicks "Generate Content" button.

    **Payload Options:**
    - You can send the full outline response: `{"explanation": "...", "tree": [...], "todos": [...], "courseMetadata": {...}}`
    - Or just the todos: `{"todos": [...]}`
    - The endpoint will extract and use only the `todos` array

    **Recommended:** Send just `{"todos": [...]}` for efficiency, or the full response for convenience.

    Returns Server-Sent Events stream with content generation progress for each todo.

    Args:
        payload: Request containing course_tree (from outline API) and optional institute_id.
    """
    # Resolve the billing institute the same way the generation service does —
    # the top-level field, else courseMetadata (a supported payload shape).
    # Otherwise the pre-flight could be bypassed while charges still land.
    course_metadata = (payload.course_tree or {}).get("courseMetadata") or {}
    billing_institute_id = (
        payload.institute_id
        or course_metadata.get("instituteId")
        or course_metadata.get("institute_id")
    )

    # Pre-flight credit check: sum the parametric per-slide prices for the
    # requested todos (DB-tunable in ai_tool_pricing). AI_VIDEO-family slides
    # are excluded — the video pipeline meters their actual usage separately.
    if billing_institute_id:
        from decimal import Decimal
        from ..services.credit_service import CreditService
        from ..services.tool_cost_estimator import ToolCostEstimator

        estimated_total = Decimal("0")
        try:
            todos = (payload.course_tree or {}).get("todos") or []
            counts = {"course_slide_document": 0, "course_slide_assessment": 0, "course_slide_video": 0}
            for todo in todos:
                todo_type = (todo or {}).get("type") if isinstance(todo, dict) else None
                if todo_type == "DOCUMENT":
                    counts["course_slide_document"] += 1
                elif todo_type == "ASSESSMENT":
                    counts["course_slide_assessment"] += 1
                elif todo_type in ("VIDEO", "VIDEO_CODE"):
                    counts["course_slide_video"] += 1
            estimator = ToolCostEstimator(db)
            for tool_key, count in counts.items():
                if count:
                    per_slide = Decimal(str(estimator.estimate(tool_key, {})["estimated_credits"]))
                    estimated_total += per_slide * count
        except Exception as exc:  # estimation must never block generation
            import logging
            logging.getLogger(__name__).warning(f"Content credit pre-flight estimation failed: {exc}")

        if estimated_total > 0:
            balance = CreditService(db).get_balance(billing_institute_id)
            if balance and balance.current_balance < estimated_total:
                raise HTTPException(
                    status_code=status.HTTP_402_PAYMENT_REQUIRED,
                    detail=(
                        f"Insufficient credits: generating this content needs ≈{estimated_total} "
                        f"credits, balance is {balance.current_balance}. Please top up."
                    ),
                )

    # Client-minted run id (stable across transport retries) keys idempotent
    # per-slide charges; fall back to a per-request UUID for older clients.
    request_id = payload.generation_run_id or str(uuid.uuid4())

    # Usage-event attribution from the caller's VERIFIED JWT, when there is one
    # (without it the body user id is kept only as an unverified claim).
    try:
        from ..services.ai_billing import metering_from_request

        _meter_ctx = metering_from_request(request, billing_institute_id)
        if _meter_ctx is not None and getattr(_meter_ctx, "actor_user_id", None):
            service._metering = _meter_ctx
    except Exception:  # noqa: BLE001 - attribution never affects the request
        pass

    # Heartbeat interval: AI-video SCRIPT stages can go minutes between SSE
    # events; without a keepalive the gateway/proxy idles the connection out
    # and the client stops receiving the later slides (videos + assignments),
    # leaving them stuck "generating" forever even though the server finished.
    # An SSE comment line (": ...") keeps the socket warm and is ignored by the
    # client parser (it only reads "data:" lines).
    _HEARTBEAT_SECONDS = 15

    async def event_generator():
        # Run the generator in a background task feeding a queue; the SSE loop
        # reads with a timeout and emits a keepalive on quiet stretches. This
        # keeps the heartbeat from cancelling the generator's in-flight step
        # (wait_for on __anext__ would corrupt the async generator).
        queue: asyncio.Queue = asyncio.Queue()
        _DONE = object()

        async def _pump():
            try:
                async for ev in service.generate_content_from_coursetree(
                    course_tree=payload.course_tree,
                    request_id=request_id,
                    institute_id=payload.institute_id,
                    user_id=payload.user_id,
                    language=payload.language,
                    model=payload.model,
                    video_settings=payload.video_settings,
                    document_settings=payload.document_settings,
                    reference_document_file_ids=payload.reference_document_file_ids,
                    kb_grounding=payload.kb_grounding,
                ):
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
                    yield ": keepalive\n\n"  # keep the connection warm during quiet stretches
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



