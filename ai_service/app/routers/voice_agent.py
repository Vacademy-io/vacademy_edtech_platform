"""
WebSocket router for full-duplex voice conversations.

Uses Sarvam AI REST APIs for STT/TTS (will be upgraded to WebSocket streaming later).
"""
from __future__ import annotations

import asyncio
import base64
import json
import logging
import re
from typing import Optional

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from ..config import get_settings
from ..core.security import decode_access_token
from ..db import get_sessionmaker
from ..repositories.chat_session_repository import ChatSessionRepository
from ..services.sarvam_service import SarvamService, SarvamSTTError
from ..services.voice_session_service import VoiceSessionService
from ..services.platform_settings_service import get_platform_setting
from ..services.voice_tts import default_voice_for, synthesize_speech
from ..services.audio_utils import transcode_to_wav, trim_to_container_start
from ..services.context_resolver_service import ContextResolverService
from ..services.chat_llm_client import ChatLLMClient
from ..services.api_key_resolver import ApiKeyResolver
from ..services.institute_settings_service import InstituteSettingsService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/chat-agent", tags=["voice-agent"])

# Audio chunk size for TTS streaming to client (~32 KB)
TTS_CHUNK_SIZE = 32 * 1024

# Speech is synthesized a segment at a time so playback can start on the first
# sentence. The first segment is kept short — it is the one the student waits
# on — and later ones are larger to keep prosody natural.
FIRST_SEGMENT_MAX_CHARS = 140
SEGMENT_MAX_CHARS = 320

_SENTENCE_END = re.compile(r"(?<=[.!?…।])\s+|\n+")


# Anything shorter than this (16 kHz mono 16-bit) cannot hold a word. Skipping
# STT for it saves a Sarvam call and a "didn't catch that" round trip.
MIN_SPEECH_WAV_BYTES = 44 + 16000 * 2 * 0.4


async def _transcode_to_wav(audio: bytes, mime: str) -> tuple[bytes, str, str]:
    """Shared implementation — see services/audio_utils.transcode_to_wav."""
    out, out_mime, note = await transcode_to_wav(audio, mime)
    return out, out_mime, note


def _split_for_speech(text: str) -> list[str]:
    """Break a reply into sentence-aligned segments for streaming synthesis."""
    sentences = [s.strip() for s in _SENTENCE_END.split(text.strip()) if s and s.strip()]
    if not sentences:
        return []

    segments: list[str] = []
    buffer = ""
    for sentence in sentences:
        limit = FIRST_SEGMENT_MAX_CHARS if not segments else SEGMENT_MAX_CHARS
        if buffer and len(buffer) + 1 + len(sentence) > limit:
            segments.append(buffer)
            buffer = sentence
        else:
            buffer = f"{buffer} {sentence}".strip()
    if buffer:
        segments.append(buffer)
    return segments


def _course_verified(claims: Optional[dict], user_id, institute_id) -> bool:
    """
    Whether the auth message proves who is on the call well enough to search
    their course: the token names the session's user AND lists the session's
    institute in its per-institute authorities map. is_root_user is never
    consulted (it is set for ordinary learners).
    """
    if not isinstance(claims, dict) or not user_id or not institute_id:
        return False
    token_user = str(claims.get("user") or "")
    authorities = claims.get("authorities")
    return (
        bool(token_user)
        and token_user == str(user_id)
        and isinstance(authorities, dict)
        and str(institute_id) in {str(k) for k in authorities}
    )


def _build_voice_session_service(db_session) -> VoiceSessionService:
    """Build a VoiceSessionService instance manually (no FastAPI Depends)."""
    context_resolver = ContextResolverService(db_session)
    institute_settings = InstituteSettingsService(db_session)
    api_key_resolver = ApiKeyResolver(db_session)
    llm_client = ChatLLMClient(
        api_key_resolver,
        disable_reasoning=bool(
            get_platform_setting(
                "chatbot.llm.disable_reasoning",
                default=get_settings().llm_disable_reasoning,
                db=db_session,
            )
        ),
        platform_model_key="chatbot.text.model",
    )

    return VoiceSessionService(
        db_session=db_session,
        llm_client=llm_client,
        institute_settings=institute_settings,
        context_resolver=context_resolver,
    )


@router.websocket("/session/{session_id}/voice")
async def voice_session(websocket: WebSocket, session_id: str):
    """
    Full-duplex voice conversation WebSocket.

    Client -> Server messages:
      { "type": "auth", "token": "<access token>" }                -- identifies the caller;
                                                                      send it first
      { "type": "config", "language": "en-IN", "voice": "shubh" }  -- initial config;
                                                                      the agent opens the call
      { "type": "audio_chunk", "data": "<base64 audio>" }          -- streaming mic audio
      { "type": "audio_end", "mime": "audio/webm" }                -- student finished speaking
      { "type": "audio_discard" }                                   -- drop buffered mic audio
                                                                      (a turn with no speech)
      { "type": "interrupt" }                                       -- student talked over the
                                                                      agent; abandon this turn
      { "type": "end_session" }                                     -- end voice session

    Server -> Client messages:
      { "type": "ready" }                                           -- connection ready
      { "type": "transcript_partial", "text": "..." }              -- real-time STT partial
      { "type": "transcript_final", "text": "..." }                -- final transcript
      { "type": "ai_text", "text": "...", "message_id": N }        -- LLM response text
      { "type": "audio_chunk", "data": "<base64 audio>" }          -- streaming TTS audio
      { "type": "audio_segment_end" }                              -- one playable segment done;
                                                                      play it while the next
                                                                      one synthesizes
      { "type": "audio_end", "reason": "..." }                     -- turn over (always sent,
                                                                      even with no audio, so the
                                                                      client can re-arm the mic)
      { "type": "summary", "data": { ... } }                       -- session-end scorecard
      { "type": "error", "message": "..." }                         -- error
    """
    await websocket.accept()

    # Create a DB session manually (WebSocket doesn't support FastAPI Depends)
    session_factory = get_sessionmaker()
    db = session_factory()

    # Hoisted so the finally block can stop a turn that is still talking to the
    # DB session we are about to close.
    current_turn: Optional[asyncio.Task] = None

    try:
        # 1. Verify session exists
        session_repo = ChatSessionRepository(db)
        chat_session = session_repo.get_session_by_id(session_id)
        if not chat_session:
            await websocket.send_json({"type": "error", "message": f"Session {session_id} not found"})
            await websocket.close(code=4004)
            return

        user_id = chat_session.user_id
        institute_id = chat_session.institute_id

        # 2. Create services
        sarvam_service = SarvamService()
        voice_service = _build_voice_session_service(db)

        # 3. Voice config defaults
        language: str = "en-IN"
        voice: str = "shubh"

        # Platform switches (super-admin portal -> AI Settings). Resolved once
        # per call so a mid-call flip can't change engines between sentences.
        tts_provider: str = str(get_platform_setting("chatbot.voice.tts_provider", default="sarvam", db=db))
        platform_voice: str = str(get_platform_setting("chatbot.voice.tts_voice", default="", db=db) or "")
        voice_model: Optional[str] = get_platform_setting("chatbot.voice.model", db=db) or None
        opening_turn_enabled: bool = bool(get_platform_setting("chatbot.voice.opening_turn", default=True, db=db))

        # Audio buffer for accumulating chunks
        audio_buffer: bytearray = bytearray()

        # A turn — the opening line or a reply — runs as its own task so this
        # loop keeps reading the socket while the agent talks. That is what lets
        # "interrupt" and a hang-up land mid-answer instead of queueing behind a
        # 10-second STT/LLM/TTS round trip. Two coroutines therefore share one
        # socket, so every write goes through _send.
        send_lock = asyncio.Lock()
        opening_started = False
        # A voice turn spends real money (STT + LLM + TTS) and exposes the
        # transcript, so the socket checks any token it is given and refuses one
        # that belongs to somebody else. Sockets with no token at all are still
        # served until VOICE_REQUIRE_AUTH is switched on — the rest of
        # /chat-agent is unauthenticated today, and cutting them off before
        # every client sends a token would drop live calls.
        settings = get_settings()
        require_auth = bool(
            settings.voice_require_auth
            or get_platform_setting("chatbot.voice.require_auth", default=False, db=db)
        )
        is_authenticated = False
        # Set by a valid auth message for this user AND this institute; only
        # then may a doubt call search the learner's course.
        course_verified = False

        async def _send(payload: dict) -> None:
            async with send_lock:
                await websocket.send_json(payload)

        async def _speak(text: str) -> None:
            """
            Synthesize a segment at a time and stream each one the moment it is
            ready, so the student hears the first sentence while the rest is
            still being synthesized. Each segment is its own playable file —
            concatenated WAVs only ever decoded as far as the first header.

            Cancellation (a barge-in) stops it between segments at the latest.
            """
            # Sarvam speaks with the institute's configured voice; other engines
            # use the platform voice (or a per-language default), since Sarvam
            # speaker names mean nothing to them.
            spoken_voice = voice if tts_provider == "sarvam" else (
                platform_voice or default_voice_for(tts_provider, language)
            )
            for segment in _split_for_speech(text):
                segment_audio, _mime, provider_used = await synthesize_speech(
                    text=segment,
                    language=language,
                    voice=spoken_voice,
                    provider=tts_provider,
                )
                voice_service.record_voice_media_usage(
                    kind="tts",
                    institute_id=institute_id,
                    user_id=user_id,
                    session_id=session_id,
                    language=language,
                    characters=len(segment),
                    detail=spoken_voice,
                    provider=provider_used,
                )
                if not segment_audio:
                    continue
                for i in range(0, len(segment_audio), TTS_CHUNK_SIZE):
                    chunk = segment_audio[i : i + TTS_CHUNK_SIZE]
                    await _send({
                        "type": "audio_chunk",
                        "data": base64.b64encode(chunk).decode("ascii"),
                    })
                # Playable unit boundary — the client starts this one now.
                await _send({"type": "audio_segment_end"})

        async def _run_opening_turn() -> None:
            """Greet the student the moment they join, so nobody has to type first."""
            reason = "complete"
            try:
                opening = await voice_service.generate_opening_turn(
                    session_id=session_id,
                    user_id=user_id,
                    institute_id=institute_id,
                    model=voice_model,
                )
                # No opening line (a reconnect mid-call, or an empty completion)
                # still has to end the turn, or the client waits on "connecting"
                # with a disabled mic.
                if opening:
                    await _send({
                        "type": "ai_text",
                        "text": opening["ai_text"],
                        "message_id": opening.get("message_id"),
                    })
                    await _speak(opening["ai_text"])
            except asyncio.CancelledError:
                raise
            except Exception as e:
                logger.exception(f"Error opening voice session {session_id}")
                reason = "error"
                await _send({"type": "error", "message": str(e)})
            await _send({"type": "audio_end", "reason": reason})

        async def _run_turn(audio: bytes, mime: str) -> None:
            """
            One student turn: STT -> LLM -> TTS.

            Always finishes with audio_end (empty speech and failures included) —
            without it the client is left in 'processing' with a disabled mic and
            no way back into the conversation.
            """
            reason = "complete"
            # `detail` names the leg that decided the outcome (transcode, STT,
            # clip length). Clients ignore it; it is there so a "didn't catch
            # that" can be diagnosed from the socket frames instead of pod logs.
            detail = ""
            try:
                audio, dropped = trim_to_container_start(audio, mime)
                if dropped:
                    logger.warning(
                        f"Voice turn for session {session_id}: dropped {dropped} stray bytes "
                        f"before the {mime} header (previous turn's trailing chunk)"
                    )
                audio, mime, note = await _transcode_to_wav(audio, mime)
                detail = note
                if mime == "audio/wav" and len(audio) < MIN_SPEECH_WAV_BYTES:
                    await _send({"type": "audio_end", "reason": "no_speech", "detail": f"too_short;{note}"})
                    return

                try:
                    transcript = await sarvam_service.speech_to_text(
                        audio_bytes=audio,
                        language=language,
                        mime_type=mime,
                    )
                except SarvamSTTError as stt_exc:
                    detail = f"stt_http_{stt_exc.status or 'err'};{note}"
                    await _send({"type": "transcript_final", "text": ""})
                    await _send({"type": "error", "message": "Speech recognition failed"})
                    await _send({"type": "audio_end", "reason": "error", "detail": detail})
                    return

                await _send({"type": "transcript_final", "text": transcript})
                voice_service.record_voice_media_usage(
                    kind="stt",
                    institute_id=institute_id,
                    user_id=user_id,
                    session_id=session_id,
                    language=language,
                    characters=len(transcript),
                    detail=f"{len(audio)}B {mime}",
                )

                if not transcript.strip():
                    reason = "no_speech"
                    detail = f"stt_empty;{note}"
                else:
                    result = await voice_service.process_voice_turn(
                        session_id=session_id,
                        transcript=transcript,
                        user_id=user_id,
                        institute_id=institute_id,
                        model=voice_model,
                        course_verified=course_verified,
                    )
                    ai_text = result.get("ai_text", "")
                    await _send({
                        "type": "ai_text",
                        "text": ai_text,
                        "message_id": result.get("message_id"),
                    })
                    await _speak(ai_text)
            except asyncio.CancelledError:
                # Interrupted by the student — they are already talking and the
                # client has stopped playback. Nothing left to announce.
                raise
            except Exception as e:
                logger.exception(f"Error processing voice turn for session {session_id}")
                reason = "error"
                detail = f"exception:{type(e).__name__}"
                await _send({"type": "error", "message": str(e)})
            await _send({"type": "audio_end", "reason": reason, "detail": detail})

        async def _cancel_current_turn() -> None:
            """Stop whatever the agent is saying and wait for the task to unwind.

            Awaiting matters: the turn task writes to the DB session this handler
            also uses, and they must never overlap.
            """
            nonlocal current_turn
            task = current_turn
            current_turn = None
            if task and not task.done():
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass
                except Exception:
                    logger.exception(f"Voice turn failed while cancelling, session {session_id}")

        # 4. Send ready signal
        await _send({"type": "ready"})
        logger.info(f"Voice session ready for session_id={session_id}, user_id={user_id}")

        # 5. Main loop
        while True:
            raw = await websocket.receive_text()
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                await _send({"type": "error", "message": "Invalid JSON"})
                continue

            msg_type = msg.get("type")

            if msg_type == "ping":
                await _send({"type": "pong"})
                continue

            elif msg_type == "auth":
                claims = decode_access_token(msg.get("token") or "")
                if not claims:
                    await _send({"type": "error", "message": "Invalid credentials"})
                    await websocket.close(code=4401)
                    return
                token_user = str(claims.get("user") or "")
                if token_user and user_id and token_user != str(user_id):
                    logger.warning(
                        f"Voice socket for session {session_id} presented a token for a "
                        f"different user — closing"
                    )
                    await _send({"type": "error", "message": "Session does not belong to this user"})
                    await websocket.close(code=4403)
                    return
                is_authenticated = True
                course_verified = _course_verified(claims, user_id, institute_id)
                continue

            elif not is_authenticated and require_auth:
                await _send({"type": "error", "message": "Authentication required"})
                await websocket.close(code=4401)
                return

            elif msg_type == "config":
                language = msg.get("language", language)
                voice = msg.get("voice", voice)
                logger.info(f"Voice config updated: language={language}, voice={voice}")

                # The agent opens the call. generate_opening_turn is a no-op once
                # the session has history, so a reconnect mid-call stays silent.
                if not opening_started:
                    opening_started = True
                    if opening_turn_enabled:
                        current_turn = asyncio.create_task(_run_opening_turn())
                    else:
                        # No greeting: hand the floor to the student straight away.
                        await _send({"type": "audio_end", "reason": "complete"})

            elif msg_type == "audio_chunk":
                # Accumulate base64-decoded audio bytes
                data_b64 = msg.get("data", "")
                if data_b64:
                    try:
                        audio_buffer.extend(base64.b64decode(data_b64))
                    except Exception:
                        await _send({"type": "error", "message": "Invalid base64 audio data"})

            elif msg_type == "audio_end":
                if not audio_buffer:
                    await _send({"type": "error", "message": "No audio data received"})
                    await _send({"type": "audio_end", "reason": "no_audio"})
                    continue

                # Whatever the agent was saying is now stale — the student spoke.
                await _cancel_current_turn()
                audio = bytes(audio_buffer)
                audio_buffer.clear()
                current_turn = asyncio.create_task(
                    _run_turn(audio, msg.get("mime") or "audio/wav")
                )

            elif msg_type == "audio_discard":
                # The client heard no speech and dropped the turn; forget the
                # chunks it already streamed or they'd prefix the next turn.
                audio_buffer.clear()

            elif msg_type == "interrupt":
                await _cancel_current_turn()

            elif msg_type == "end_session":
                await _cancel_current_turn()
                try:
                    # Generate session summary via VoiceSessionService
                    session = session_repo.get_session_by_id(session_id)
                    session_mode = getattr(session, "session_mode", "text") if session else "text"

                    summary = await voice_service.generate_session_summary(
                        session_id=session_id,
                        mode=session_mode,
                        institute_id=institute_id,
                        user_id=user_id,
                    )

                    # Close the session
                    session_repo.close_session(session_id)

                    await _send({
                        "type": "summary",
                        "data": summary,
                    })
                except Exception as e:
                    logger.exception(f"Error ending voice session {session_id}")
                    await _send({"type": "error", "message": str(e)})
                break

            else:
                await _send({"type": "error", "message": f"Unknown message type: {msg_type}"})

    except WebSocketDisconnect:
        logger.info(f"Voice WebSocket disconnected for session {session_id}")
    except Exception as e:
        logger.exception(f"Voice session error for session {session_id}")
        try:
            await websocket.send_json({"type": "error", "message": str(e)})
        except Exception:
            pass
    finally:
        if current_turn and not current_turn.done():
            current_turn.cancel()
            try:
                await current_turn
            except (asyncio.CancelledError, Exception):
                pass
        try:
            db.close()
        except Exception:
            pass


__all__ = ["router"]
