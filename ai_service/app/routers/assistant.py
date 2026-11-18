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

import asyncio
import json
import logging
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, UploadFile
from fastapi.responses import StreamingResponse

from ..core.chat_auth import check_rate_limit
from ..core.security import get_pinned_principal
from ..schemas.auth import PinnedPrincipal
from ..schemas.assistant import (
    AssistantInitRequest,
    AssistantInitResponse,
    AssistantMessageRequest,
    AssistantMessageResponse,
    AssistantCloseResponse,
    AssistantSpeechToTextResponse,
)
from ..services.ai_billing import UC
from ..services.assistant_service import AssistantAgentService
from ..services.audio_utils import base_mime
from ..services.sarvam_service import SarvamService, SarvamSTTError
from ..services import speech_to_text as stt
from ..services.tutor.roles import is_staff
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


# ── speech to text ───────────────────────────────────────────────────────────
# A spoken question for the Assistant (or any staff screen that wants one):
# the recording becomes text the user reviews before sending.

#: Longest recording accepted, in seconds. The admin app stops recording here.
STT_MAX_SECONDS = 120
#: Largest upload accepted. Two minutes of browser audio (opus or AAC) is well
#: under this; the cap bounds clips whose length cannot be measured.
STT_MAX_UPLOAD_BYTES = 5 * 1024 * 1024


@router.post(
    "/speech-to-text",
    response_model=AssistantSpeechToTextResponse,
    summary="Turn a short recording into text (not sent to the Assistant)",
    description=(
        "Multipart upload: `file` (webm/opus, ogg, mp4/aac, mp3 or wav; up to "
        f"{STT_MAX_SECONDS} s and {STT_MAX_UPLOAD_BYTES // (1024 * 1024)} MB) and an optional "
        "`language` hint (`auto`, or a code such as `en-IN` / `hi-IN`). Institute staff only. "
        "Returns the transcript for the user to review; nothing is sent. 422 when no speech is "
        "heard, 413 when the recording is too long, 415 for other content types, 502 when the "
        "speech service fails, 429 when called too often."
    ),
)
async def speech_to_text(
    file: UploadFile = File(...),
    language: str = Form("auto"),
    principal: PinnedPrincipal = Depends(get_pinned_principal),
) -> AssistantSpeechToTextResponse:
    if not is_staff(principal.roles):
        raise HTTPException(status_code=403, detail="Voice input is available to institute staff only.")
    check_rate_limit(f"assistant-stt:{principal.institute_id}:{principal.user_id}")

    try:
        language_hint = stt.normalize_language(language)
    except stt.UnsupportedLanguageError:
        raise HTTPException(status_code=422, detail="This language is not supported for voice input.")

    content_type = base_mime(file.content_type)
    if not stt.is_accepted_audio_type(content_type):
        raise HTTPException(
            status_code=415,
            detail="Unsupported recording format. Record with the microphone button or upload webm, ogg, mp4, mp3 or wav audio.",
        )

    audio = await file.read(STT_MAX_UPLOAD_BYTES + 1)
    if not audio:
        raise HTTPException(status_code=400, detail="The recording is empty.")
    if len(audio) > STT_MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="The recording is too large. Keep it under 2 minutes.")

    try:
        result = await stt.transcribe_audio(
            audio,
            content_type,
            language=language_hint,
            max_seconds=STT_MAX_SECONDS,
            min_speech_wav_bytes=stt.MIN_SPEECH_WAV_BYTES,
            stt=SarvamService(),
        )
    except stt.SpeechTooLongError as exc:
        logger.info("assistant stt refused: %.1fs over the %ss limit (%dB %s)",
                    exc.duration_seconds, STT_MAX_SECONDS, len(audio), content_type)
        raise HTTPException(status_code=413, detail="The recording is too long. Keep it under 2 minutes.")
    except SarvamSTTError as exc:
        logger.warning("assistant stt provider error: status=%s %dB %s", exc.status, len(audio), content_type)
        raise HTTPException(
            status_code=502, detail="Voice input isn't available right now. Please try again or type your question."
        )
    except Exception as exc:  # noqa: BLE001
        logger.error("assistant stt failed: %s (%dB %s)", type(exc).__name__, len(audio), content_type)
        raise HTTPException(status_code=500, detail="Could not process the recording.")

    # Sizes and timings only: never the audio or the transcript text.
    logger.info(
        "assistant stt: %dB %s, %s s, %s, provider=%s, %d chars, lang=%s",
        result.input_bytes, content_type,
        f"{result.duration_seconds:.1f}" if result.duration_seconds is not None else "?",
        result.transcode_note, result.provider_called, len(result.transcript), result.language or language_hint,
    )

    if result.provider_called:
        await asyncio.to_thread(
            stt.record_stt_usage,
            institute_id=principal.institute_id,
            user_id=principal.user_id,
            seconds=result.duration_seconds,
            characters=len(result.transcript),
            language=result.language or language_hint,
            surface="assistant",
            use_case=UC.VACADEMY_ASSISTANT,
            actor_roles=principal.roles,
            actor_display_name=principal.full_name,
        )

    transcript = result.transcript.strip()
    if not transcript:
        raise HTTPException(status_code=422, detail="No speech was detected. Please try again.")

    return AssistantSpeechToTextResponse(
        transcript=transcript,
        language=result.language or (None if language_hint == "auto" else language_hint),
        duration_seconds=round(result.duration_seconds, 1) if result.duration_seconds is not None else None,
    )


__all__ = ["router"]
