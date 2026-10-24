"""
API router for AI chat agent with SSE streaming support.
"""
from __future__ import annotations

import json
import logging
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from ..db import db_dependency
from ..schemas.chat_agent import (
    InitSessionRequest,
    SendMessageRequest,
    UpdateContextRequest,
    InitSessionResponse,
    SendMessageResponse,
    UpdateContextResponse,
    CloseSessionResponse,
    AIStatus,
)
from ..services.ai_chat_agent_service import AiChatAgentService
from ..services.sarvam_service import SarvamService
from ..dependencies import get_chat_agent_service
from ..core.chat_auth import (
    ChatCaller,
    check_can_open,
    check_owns_session,
    check_rate_limit,
    get_chat_caller,
    require_auth_enabled,
    shadow_counts,
    shadow_counts_by_route,
)
from ..core.security import is_platform_staff

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/chat-agent", tags=["ai-chat-agent"])


def _owned_session(service: AiChatAgentService, session_id: str, caller: ChatCaller) -> dict:
    """The session's identity, after checking the caller may touch it (404 / 403)."""
    identity = service.get_session_identity(session_id)
    if identity is None:
        raise HTTPException(status_code=404, detail=f"Session {session_id} not found")
    check_owns_session(caller, identity["user_id"])
    return identity


def _caller_verified(caller: ChatCaller, identity: dict) -> bool:
    """A real token naming the session's own learner, in the session's institute.

    chatbot.text.require_auth may still be in shadow mode, which serves a
    tokenless (or mismatched) caller anyway; that session's user_id came from
    the client, so nothing private to the learner (their course content) may be
    served to it. The service stamps this on the message; it is never read from
    the request body.
    """
    return bool(
        caller.authenticated
        and str(identity.get("user_id") or "") == caller.user_id
        and str(identity.get("institute_id") or "") in caller.institute_ids
    )


@router.get(
    "/whoami",
    summary="Who the chatbot thinks is calling",
    description=(
        "Cheap authenticated call. The learner app makes it through its token-refreshing "
        "HTTP client before opening the stream, so an expired token is refreshed first."
    ),
)
async def whoami(caller: ChatCaller = Depends(get_chat_caller)):
    return {
        "authenticated": caller.authenticated,
        "user_id": caller.user_id,
        "require_auth": require_auth_enabled(),
    }


@router.get(
    "/sessions",
    summary="The learner's past chats",
    description="Own text chats with at least one question, newest first. Requires a login token.",
)
async def list_sessions(
    http_request: Request,
    limit: int = Query(20, ge=1, le=50),
    service: AiChatAgentService = Depends(get_chat_agent_service),
    caller: ChatCaller = Depends(get_chat_caller),
):
    # A new endpoint has no legacy clients: always require a real identity,
    # whatever the rollout flag says.
    if not caller.authenticated:
        raise HTTPException(status_code=401, detail="Login required")
    institute_id = http_request.headers.get("clientId") or http_request.headers.get("client_id") or ""
    if institute_id not in caller.institute_ids:
        raise HTTPException(status_code=403, detail="You are not a member of this institute")
    return {"sessions": service.list_sessions(caller.user_id, institute_id, limit)}


@router.post(
    "/session/{session_id}/resume",
    summary="Reopen one of the learner's chats",
)
async def resume_session(
    session_id: str,
    service: AiChatAgentService = Depends(get_chat_agent_service),
    caller: ChatCaller = Depends(get_chat_caller),
):
    if not caller.authenticated:
        raise HTTPException(status_code=401, detail="Login required")
    identity = _owned_session(service, session_id, caller)
    if identity["user_id"] != caller.user_id:
        raise HTTPException(status_code=403, detail="This chat belongs to someone else")
    return {"session_id": session_id, "status": service.resume_session(session_id)}


def _require_member(http_request: Request, caller: ChatCaller) -> str:
    """Institute from the clientId header, for endpoints that list the learner's own data."""
    if not caller.authenticated:
        raise HTTPException(status_code=401, detail="Login required")
    institute_id = http_request.headers.get("clientId") or http_request.headers.get("client_id") or ""
    if institute_id not in caller.institute_ids:
        raise HTTPException(status_code=403, detail="You are not a member of this institute")
    return institute_id


@router.get(
    "/starters",
    summary="Personal one-tap starters",
    description=(
        "Up to four complete requests built from the learner's page and day (lesson, live class, "
        "daily tasks, lesson to continue, upcoming test), a time-sensitive launcher peek, and "
        "'try saying' examples. Works before a chat exists (the launcher peek). Requires a login."
    ),
)
async def chat_starters(
    http_request: Request,
    context_type: Optional[str] = Query(None),
    lesson: Optional[str] = Query(None, max_length=300),
    service: AiChatAgentService = Depends(get_chat_agent_service),
    caller: ChatCaller = Depends(get_chat_caller),
):
    from ..services.chat_starters import build_starters

    institute_id = _require_member(http_request, caller)
    meta = {"name": lesson or "", "ui_language": http_request.headers.get("accept-language") or ""}
    return await build_starters(service._db_factory, caller.user_id, institute_id, context_type, meta)


@router.post(
    "/session/{session_id}/messages/{message_id}/save",
    summary="Save or unsave a tutor reply",
)
async def save_message(
    session_id: str,
    message_id: int,
    body: dict,
    service: AiChatAgentService = Depends(get_chat_agent_service),
    caller: ChatCaller = Depends(get_chat_caller),
):
    _owned_session(service, session_id, caller)
    saved = bool((body or {}).get("saved", True))
    if not service.set_saved(session_id, message_id, saved):
        raise HTTPException(status_code=404, detail="Reply not found in this chat")
    return {"message_id": message_id, "saved": saved}


@router.get(
    "/saved",
    summary="The learner's saved answers across chats",
)
async def list_saved(
    http_request: Request,
    limit: int = Query(50, ge=1, le=100),
    service: AiChatAgentService = Depends(get_chat_agent_service),
    caller: ChatCaller = Depends(get_chat_caller),
):
    institute_id = _require_member(http_request, caller)
    return {"saved": service.list_saved(caller.user_id, institute_id, limit)}


@router.post(
    "/session/{session_id}/messages/{message_id}/speech",
    summary="Read a tutor reply aloud",
    description="Returns the reply as audio segments (base64) to play in order.",
)
async def message_speech(
    session_id: str,
    message_id: int,
    service: AiChatAgentService = Depends(get_chat_agent_service),
    caller: ChatCaller = Depends(get_chat_caller),
):
    from ..services.reply_speech import speak_reply

    identity = _owned_session(service, session_id, caller)
    check_rate_limit(f"msg:{identity['user_id']}")
    content = service.get_message_content(session_id, message_id)
    if content is None:
        raise HTTPException(status_code=404, detail="Reply not found in this chat")
    _ctype, meta = service.get_session_context(session_id)
    segments = await speak_reply(content, (meta or {}).get("ui_language"))
    if not segments:
        raise HTTPException(status_code=502, detail="Could not create audio for this reply")
    return {"message_id": message_id, "segments": segments}


@router.post(
    "/session/{session_id}/stop",
    summary="Stop the reply being generated",
    description="Marks the pending question answered so it is not picked up again after the app closes the stream.",
)
async def stop_turn(
    session_id: str,
    service: AiChatAgentService = Depends(get_chat_agent_service),
    caller: ChatCaller = Depends(get_chat_caller),
):
    _owned_session(service, session_id, caller)
    return {"session_id": session_id, "stopped": service.stop_turn(session_id)}


@router.post(
    "/session/{session_id}/messages/{message_id}/feedback",
    summary="Thumbs up / down on a tutor reply",
)
async def message_feedback(
    session_id: str,
    message_id: int,
    body: dict,
    service: AiChatAgentService = Depends(get_chat_agent_service),
    caller: ChatCaller = Depends(get_chat_caller),
):
    _owned_session(service, session_id, caller)
    rating = str((body or {}).get("rating") or "").lower()
    if rating not in ("up", "down", "none"):
        raise HTTPException(status_code=422, detail="rating must be 'up', 'down' or 'none'")
    comment = (body or {}).get("comment")
    if not service.set_feedback(session_id, message_id, rating, comment if isinstance(comment, str) else None):
        raise HTTPException(status_code=404, detail="Reply not found in this chat")
    return {"message_id": message_id, "rating": rating}


@router.post(
    "/session/init",
    response_model=InitSessionResponse,
    summary="Initialize a new chat session",
    description="Creates a new chat session with context and optionally processes an initial message."
)
async def init_session(
    request: InitSessionRequest,
    http_request: Request,
    service: AiChatAgentService = Depends(get_chat_agent_service),
    caller: ChatCaller = Depends(get_chat_caller),
) -> InitSessionResponse:
    """
    Initialize a new chat session with passive context.
    
    The session will be created immediately. If an initial_message is provided,
    it will be processed asynchronously. Otherwise, a personalized greeting is sent.
    """
    check_can_open(caller, request.user_id, request.institute_id)
    check_rate_limit(f"init:{caller.user_id or request.user_id}")
    try:
        session_id, ai_status = await service.create_session(
            user_id=request.user_id,
            institute_id=request.institute_id,
            context_type=request.context_type.value if request.context_type else None,
            context_meta=request.context_meta,
            initial_message=request.initial_message,
            user_name=request.user_name,
            session_mode=request.session_mode.value if request.session_mode else "text",
            # The learner app's authenticated client sends its UI locale.
            ui_language=http_request.headers.get("accept-language") or caller.locale,
            # Same rule as send_message, against the identity being created.
            caller_verified=_caller_verified(
                caller, {"user_id": request.user_id, "institute_id": request.institute_id}
            ),
        )
        
        return InitSessionResponse(
            session_id=session_id,
            status=AIStatus(ai_status),
        )
        
    except Exception as e:
        logger.error(f"Error initializing session: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post(
    "/session/{session_id}/message",
    response_model=SendMessageResponse,
    summary="Send a message to a chat session",
    description="""Send a user message to an existing chat session. Processing happens asynchronously.
    
    Supports:
    - Regular messages (intent=general or auto-classified)
    - Doubt clarification (intent=doubt) - AI provides detailed explanations
    - Practice requests (intent=practice) - AI generates a quiz
    - Quiz submissions (include quiz_submission field with answers)
    """
)
async def send_message(
    session_id: str,
    request: SendMessageRequest,
    service: AiChatAgentService = Depends(get_chat_agent_service),
    caller: ChatCaller = Depends(get_chat_caller),
) -> SendMessageResponse:
    """
    Send a message to an existing chat session.
    
    The message will be saved immediately and processed asynchronously by the AI.
    
    Message Intent:
    - If intent is not provided, AI will automatically classify based on message content
    - DOUBT: User has a question - AI provides detailed explanation
    - PRACTICE: User wants to practice - AI generates a quiz
    - GENERAL: Regular conversation
    
    Quiz Submission:
    - Include quiz_submission when submitting answers to a quiz
    - AI will evaluate and provide personalized feedback
    """
    identity = _owned_session(service, session_id, caller)
    check_rate_limit(f"msg:{identity['user_id']}")
    try:
        attachments_list = None
        if request.attachments:
            attachments_list = [att.model_dump() for att in request.attachments]

        message_id, ai_status = await service.send_message(
            session_id=session_id,
            message=request.message,
            intent=request.intent,
            quiz_submission=request.quiz_submission,
            idempotency_key=request.idempotency_key,
            attachments=attachments_list,
            caller_verified=_caller_verified(caller, identity),
        )
        
        return SendMessageResponse(
            message_id=message_id,
            status=AIStatus(ai_status),
        )
        
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"Error sending message: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.put(
    "/session/{session_id}/context",
    response_model=UpdateContextResponse,
    summary="Update session context",
    description="Update the context for an existing session without triggering AI response. Useful when user navigates between pages."
)
async def update_context(
    session_id: str,
    request: UpdateContextRequest,
    http_request: Request,
    service: AiChatAgentService = Depends(get_chat_agent_service),
    caller: ChatCaller = Depends(get_chat_caller),
) -> UpdateContextResponse:
    """
    Update the context for an existing chat session.
    
    This allows seamless context switching as users navigate between pages
    without needing to create new sessions. The AI will use the updated
    context for future messages.
    
    No AI response is triggered by this endpoint.
    """
    _owned_session(service, session_id, caller)
    try:
        success = await service.update_context(
            session_id=session_id,
            context_type=request.context_type.value,
            context_meta=request.context_meta,
            ui_language=http_request.headers.get("accept-language"),
        )
        
        return UpdateContextResponse(
            session_id=session_id,
            context_type=request.context_type.value,
            success=success,
        )
        
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"Error updating context: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get(
    "/session/{session_id}/stream",
    summary="Stream messages via SSE",
    description="Opens a persistent SSE connection for real-time message updates. Client receives events as they occur."
)
async def stream_session(
    session_id: str,
    request: Request,
    service: AiChatAgentService = Depends(get_chat_agent_service),
    caller: ChatCaller = Depends(get_chat_caller),
):
    """
    SSE endpoint for real-time message streaming.
    
    The client opens a persistent connection and receives events in real-time:
    - 'message' events: New chat messages (user, assistant, tool_call, tool_result)
    - 'status' events: AI and session status updates
    - 'ping' events: Keepalive pings every 30 seconds
    ```
    """
    # Checked before the response starts, so a refusal is a real 401/403/404
    # the app can act on, not an error event inside a 200 stream.
    _owned_session(service, session_id, caller)

    async def event_generator():
        logger.info(f"Starting SSE event generator for session {session_id}")
        try:
            async for event in service.stream_session(session_id):
                # Format as SSE event
                event_type = event.get("event", "message")
                event_data = event.get("data", {})
                
                # Convert data to JSON string
                data_str = json.dumps(event_data)
                
                logger.debug(f"Yielding SSE event '{event_type}' for session {session_id}")
                
                # Yield SSE formatted string: event: <type>\ndata: <json>\n\n
                yield f"event: {event_type}\ndata: {data_str}\n\n"
                    
        except ValueError as e:
            logger.error(f"Session error: {e}")
            yield f"event: error\ndata: {json.dumps({'error': str(e)})}\n\n"
        except Exception as e:
            logger.error(f"SSE streaming error: {e}")
            yield f"event: error\ndata: {json.dumps({'error': 'Internal server error'})}\n\n"
        finally:
            logger.info(f"SSE event generator finished for session {session_id}")
    
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
    "/session/{session_id}/updates",
    summary="Get messages (fallback for non-SSE clients)",
    description="Fallback endpoint for clients that don't support SSE. Returns messages since last_message_id."
)
async def get_updates_fallback(
    session_id: str,
    last_message_id: Optional[int] = Query(None, description="Get messages after this ID"),
    service: AiChatAgentService = Depends(get_chat_agent_service),
    caller: ChatCaller = Depends(get_chat_caller),
):
    """
    Fallback polling endpoint for clients that cannot use SSE.
    
    Prefer using the /stream endpoint for better performance and real-time updates.
    """
    _owned_session(service, session_id, caller)
    try:
        result = await service.get_updates(
            session_id=session_id,
            last_message_id=last_message_id,
        )
        
        # Convert messages to dict format
        messages_data = [
            {
                "id": msg.id,
                "type": msg.message_type,
                "content": msg.content,
                "metadata": msg.meta_data,
                "created_at": msg.created_at.isoformat(),
            }
            for msg in result["messages"]
        ]
        
        return {
            "messages": messages_data,
            "ai_status": result["ai_status"],
            "session_status": result["session_status"],
        }
        
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"Error getting updates: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post(
    "/session/{session_id}/close",
    response_model=CloseSessionResponse,
    summary="Close a chat session",
    description="Close an active chat session. No further messages can be sent after closing."
)
async def close_session(
    session_id: str,
    service: AiChatAgentService = Depends(get_chat_agent_service),
    caller: ChatCaller = Depends(get_chat_caller),
) -> CloseSessionResponse:
    """
    Close a chat session.
    
    This marks the session as CLOSED and prevents further messages.
    """
    _owned_session(service, session_id, caller)
    try:
        success, message_count = await service.close_session(session_id)
        
        if not success:
            raise HTTPException(status_code=404, detail=f"Session {session_id} not found")
        
        return CloseSessionResponse(
            session_id=session_id,
            status="CLOSED",
            message_count=message_count,
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error closing session: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get(
    "/debug/auth-stats",
    summary="Debug (platform staff): chat-agent auth rollout counters",
    description=(
        "Requests this pod served that would be refused once chatbot.text.require_auth is on, "
        "by reason, since the pod started. Platform staff only."
    ),
)
async def debug_auth_stats(caller: ChatCaller = Depends(get_chat_caller)):
    if not caller.authenticated or not is_platform_staff({"user_id": caller.user_id}):
        raise HTTPException(status_code=404, detail="Not found")
    return {
        "require_auth": require_auth_enabled(),
        "would_refuse_since_boot": shadow_counts(),
        "no_token_or_invalid_by_route": shadow_counts_by_route(),
    }


@router.post(
    "/session/{session_id}/audio-message",
    summary="Send an audio message to a chat session",
    description="Accept an audio file, transcribe via Sarvam STT, and process as a normal text message.",
)
async def send_audio_message(
    session_id: str,
    file: UploadFile = File(...),
    language: str = Form("auto"),
    auto_send: bool = Form(False),
    service: AiChatAgentService = Depends(get_chat_agent_service),
    caller: ChatCaller = Depends(get_chat_caller),
):
    """
    Transcribe a voice note via Sarvam STT and return the transcript.

    By default the transcript is NOT sent: the learner app puts it in the input
    box to review and send. (It used to be sent here AND placed in the input,
    so the question never showed in the chat and pressing Enter asked it
    twice.) Pass auto_send=true to send it as a normal message as well.
    Returns { transcript, message_id, status } — message_id is null unless sent.
    """
    identity = _owned_session(service, session_id, caller)
    check_rate_limit(f"msg:{identity['user_id']}")
    try:
        # 1. Read audio file bytes
        audio_bytes = await file.read()
        if not audio_bytes:
            raise HTTPException(status_code=400, detail="Empty audio file")

        # 2. Normalise to WAV (browser sends webm/opus), then transcribe. Long
        #    voice notes are transcribed in <=29 s pieces inside speech_to_text.
        from ..services.audio_utils import transcode_to_wav
        from ..services.sarvam_service import SarvamSTTError

        wav_bytes, wav_mime, _note = await transcode_to_wav(audio_bytes, file.content_type)
        sarvam_service = SarvamService()
        try:
            transcript = await sarvam_service.speech_to_text(
                audio_bytes=wav_bytes,
                language=language,
                mime_type=wav_mime,
            )
        except SarvamSTTError as exc:
            # Surfaced as a client-visible failure, not a 500: the learner app
            # shows detail text for 4xx/5xx-with-detail responses.
            raise HTTPException(status_code=502, detail=f"Speech recognition failed: {exc}")

        if not transcript.strip():
            raise HTTPException(status_code=422, detail="Could not transcribe audio — no speech detected")

        # 3. Optionally send it as a normal text message
        message_id, ai_status = None, "idle"
        if auto_send:
            message_id, ai_status = await service.send_message(
                session_id=session_id,
                message=transcript,
                caller_verified=_caller_verified(caller, identity),
            )

        # 4. Return transcript and message id
        return {
            "transcript": transcript,
            "message_id": message_id,
            "status": ai_status,
        }

    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"Error processing audio message: {e}")
        raise HTTPException(status_code=500, detail=str(e))


__all__ = ["router"]
