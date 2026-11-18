"""
API router for the Vacademy Assistant (admin portal AI agent).

SECURITY: every endpoint is gated by ``get_pinned_principal`` — a verified JWT
plus a ``clientId`` header that pins the session to ONE institute. There is no
unauthenticated path here (unlike the learner ``/chat-agent`` endpoints). All
identity used downstream is JWT-derived; request bodies never carry user/institute.

The SSE stream requires the ``Authorization`` header like every other endpoint,
so the browser must consume it with a fetch + ReadableStream client (the native
``EventSource`` cannot send headers).
"""
from __future__ import annotations

import json
import logging
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from fastapi.responses import StreamingResponse

from ..core.security import get_pinned_principal
from ..schemas.auth import PinnedPrincipal
from ..schemas.assistant import (
    AssistantInitRequest,
    AssistantInitResponse,
    AssistantMessageRequest,
    AssistantMessageResponse,
    AssistantCloseResponse,
)
from ..services.assistant_service import AssistantAgentService
from ..dependencies import get_assistant_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/assistant", tags=["vacademy-assistant"])


@router.post(
    "/session/init",
    response_model=AssistantInitResponse,
    summary="Start a Vacademy Assistant session",
)
async def init_session(
    request: AssistantInitRequest,
    principal: PinnedPrincipal = Depends(get_pinned_principal),
    service: AssistantAgentService = Depends(get_assistant_service),
) -> AssistantInitResponse:
    try:
        session_id = await service.create_session(
            principal,
            context_meta=request.context_meta,
            initial_message=request.initial_message,
        )
        return AssistantInitResponse(session_id=session_id)
    except Exception as e:
        logger.error("Error starting Assistant session: %s", e)
        raise HTTPException(status_code=500, detail="Could not start the Assistant session.")


@router.post(
    "/session/{session_id}/message",
    response_model=AssistantMessageResponse,
    summary="Send a message to the Assistant",
)
async def send_message(
    session_id: str,
    request: AssistantMessageRequest,
    principal: PinnedPrincipal = Depends(get_pinned_principal),
    service: AssistantAgentService = Depends(get_assistant_service),
) -> AssistantMessageResponse:
    try:
        message_id = await service.send_message(
            session_id, principal, request.message, context_meta=request.context_meta
        )
        return AssistantMessageResponse(message_id=message_id)
    except PermissionError:
        raise HTTPException(status_code=403, detail="You do not have access to this session.")
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error("Error sending Assistant message: %s", e)
        raise HTTPException(status_code=500, detail="Could not send the message.")


@router.get(
    "/session/{session_id}/stream",
    summary="Stream the Assistant's response via SSE",
)
async def stream_session(
    session_id: str,
    principal: PinnedPrincipal = Depends(get_pinned_principal),
    service: AssistantAgentService = Depends(get_assistant_service),
    authorization: Optional[str] = Header(None),
):
    # The caller's own JWT is replayed on data tools that hit normal admin
    # endpoints (e.g. the learner list), so the real user identity reaches Java.
    bearer_token = (
        authorization[len("Bearer "):] if authorization and authorization.startswith("Bearer ") else None
    )

    async def event_generator():
        try:
            async for event in service.stream(session_id, principal, bearer_token=bearer_token):
                event_type = event.get("event", "message")
                data_str = json.dumps(event.get("data", {}))
                yield f"event: {event_type}\ndata: {data_str}\n\n"
        except Exception as e:
            logger.error("Assistant SSE streaming error for %s: %s", session_id, e)
            yield (
                "event: error\n"
                f"data: {json.dumps({'type': 'ERROR', 'code': 500, 'message': 'Internal server error'})}\n\n"
            )

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get(
    "/capabilities",
    summary="The tool groups the caller can use (for role-accurate suggestions)",
)
async def capabilities(
    principal: PinnedPrincipal = Depends(get_pinned_principal),
    service: AssistantAgentService = Depends(get_assistant_service),
):
    try:
        return await service.get_capabilities(principal)
    except Exception as e:
        logger.error("Error fetching assistant capabilities: %s", e)
        # Fail soft — the FE falls back to the generic help suggestions.
        return {"groups": []}


@router.post(
    "/session/{session_id}/action/{action_id}/confirm",
    summary="Confirm a pending assistant write action",
)
async def confirm_action(
    session_id: str,
    action_id: str,
    principal: PinnedPrincipal = Depends(get_pinned_principal),
    service: AssistantAgentService = Depends(get_assistant_service),
    authorization: Optional[str] = Header(None),
):
    bearer_token = (
        authorization[len("Bearer "):] if authorization and authorization.startswith("Bearer ") else None
    )
    try:
        return await service.confirm_action(session_id, principal, action_id, bearer_token)
    except PermissionError:
        raise HTTPException(status_code=403, detail="You do not have access to this session.")
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error("Error confirming assistant action: %s", e)
        raise HTTPException(status_code=500, detail="Could not confirm the action.")


@router.post(
    "/session/{session_id}/action/{action_id}/cancel",
    summary="Cancel a pending assistant write action",
)
async def cancel_action(
    session_id: str,
    action_id: str,
    principal: PinnedPrincipal = Depends(get_pinned_principal),
    service: AssistantAgentService = Depends(get_assistant_service),
):
    try:
        return await service.cancel_action(session_id, principal, action_id)
    except PermissionError:
        raise HTTPException(status_code=403, detail="You do not have access to this session.")
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error("Error cancelling assistant action: %s", e)
        raise HTTPException(status_code=500, detail="Could not cancel the action.")


@router.post(
    "/session/{session_id}/close",
    response_model=AssistantCloseResponse,
    summary="Close an Assistant session",
)
async def close_session(
    session_id: str,
    principal: PinnedPrincipal = Depends(get_pinned_principal),
    service: AssistantAgentService = Depends(get_assistant_service),
) -> AssistantCloseResponse:
    try:
        ok, message_count = await service.close_session(session_id, principal)
        if not ok:
            raise HTTPException(status_code=404, detail=f"Session {session_id} not found")
        return AssistantCloseResponse(session_id=session_id, message_count=message_count)
    except HTTPException:
        raise
    except PermissionError:
        raise HTTPException(status_code=403, detail="You do not have access to this session.")
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error("Error closing Assistant session: %s", e)
        raise HTTPException(status_code=500, detail="Could not close the session.")


__all__ = ["router"]
