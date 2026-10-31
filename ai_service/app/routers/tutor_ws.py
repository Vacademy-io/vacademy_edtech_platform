"""Live AI Tutor — learner runtime: REST to start/end a session, WebSocket to
teach (design §6). Builds on the voice-call socket's audio pipeline by import.

Protocol (client → server): auth{token} FIRST, then config{language?,speak?},
continue, answer{text}, ask{text}, control{intent}, next_slide{slide_id},
audio_chunk{data}, audio_end{mime}, audio_discard, interrupt, end_session, ping.
Server → client: ready, lesson (after next_slide), state, board{ops, clear},
ai_text, segment_text, audio_chunk, audio_segment_end, audio_end{reason}, check{...},
await{what}, transcript_final, slide_done, summary, ended{reason},
error{message, fatal}, pong.

The handler holds NO database connection: every read/write goes through
session_service in its own short session, so a 90-minute lesson never pins
a pool connection across a model or TTS await.
"""
from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import logging
import re
import time
from collections import OrderedDict, deque
from dataclasses import replace as dc_replace
from typing import Any, Deque, Dict, List, Optional, Tuple

from fastapi import (
    APIRouter, BackgroundTasks, Depends, Header, HTTPException, Query, Request, WebSocket, WebSocketDisconnect, status,
)
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..config import Settings, get_settings
from ..core.security import decode_access_token, get_pinned_principal
from ..db import db_dependency
from ..models.tutor_runtime import TutorSession
from ..services.sarvam_service import SarvamService, SarvamSTTError
from ..services.tutor.roles import is_staff, normalize_roles
from ..services.tutor.runtime import session_service as svc
from ..services.tutor.runtime import state as sm
from ..services.tutor.runtime.decision import run_predict, run_turn
from ..services.tutor.runtime.intents import detect_intent
from ..services.tutor.runtime import prompts
from ..services.tutor.runtime.revisit import fresh_check
from ..services.tutor.runtime.summary import rewrite_rolling_summary
from ..services.tutor import voice_cache
from ..services.tutor.runtime.settings import TutorSettings, resolve_settings
from ..services import spatius_service
from ..services.tutor.slide_source import package_belongs_to_institute
from ..services.voice_tts import (
    SARVAM_DEFAULT_FEMALE, SMALLEST_DEFAULT_VOICE, default_voice_for, sarvam_speaker, smallest_available,
    synthesize_speech,
)
from .voice_agent import MIN_SPEECH_WAV_BYTES, TTS_CHUNK_SIZE, _SENTENCE_END, _transcode_to_wav


logger = logging.getLogger(__name__)
router = APIRouter(prefix="/tutor", tags=["tutor-runtime"])

SESSION_MAX_SECONDS = 90 * 60
# Idle = no learner frame other than keep-alive pings. Watching a video or
# reading a PDF is legitimately silent for much longer.
IDLE_SECONDS = 5 * 60

# A client that can show the teacher's face waits to hear her until the face
# is on screen and audio is unlocked: it sends `hold: true` in its auth frame
# and `{"type": "begin"}` when it is ready. Older bundles (OTA, electron) send
# neither and get the opening at once, as before. The cap keeps a broken
# client from holding a lesson forever.
# Longer than the client's own 25 s cap (tutorAudioGate.ts): the client decides;
# this only rescues a client that never says `begin` at all.
BEGIN_WAIT_SECONDS = 30.0


# Messages that drive a lesson. Before the opening they cannot mean anything
# except "this device is ready": they open the lesson and are dropped.
LESSON_MESSAGES = frozenset({"continue", "answer", "ask", "control", "audio_chunk", "audio_end",
                             "audio_discard", "interrupt", "next_slide"})


def client_holds_opening(auth_frame: dict) -> bool:
    """Does this client want the opening held until it says `begin`?"""
    return isinstance(auth_frame, dict) and auth_frame.get("hold") is True

MEDIA_IDLE_SECONDS = 30 * 60
# Every learner utterance is one model call; bound what a runaway client (or
# a script with the learner's token) can spend.
MAX_TURNS_PER_MINUTE = 20
MAX_TURNS_PER_SESSION = 400
LANG_TO_STT = {"en": "en-IN", "hi": "hi-IN"}
# Pace, segmentation and cache keys are shared with the voice warm-up (runtime/speech.py).
from ..services.tutor.runtime.speech import (  # noqa: E402
    DEFINITION_PACE, PACE_MULTIPLIER, PACE_ORDER, TUTOR_SEGMENT_MAX_CHARS, cache_key as _cache_key, spoken_form as _spoken_form, effective_pace,
    step_pace as _step_pace, tutor_segments as _tutor_segments,
)
QUESTION_BEAT_MS = 450
# Silence recovery: a nudge (hint) after this long on an open question; the
# idle exit then counts from the nudge.
NUDGE_SECONDS = 60
SERVER_TTS_PROVIDERS = ("smallest", "sarvam", "google", "edge")
# Voice lessons are metered per started minute (design §4.8, tool
# tutor_live_minute); the first minute is charged at open, the next every 60 s.
LIVE_METER_SECONDS = 60

# Session-end summary rewrites outlive the socket that started them.
_BACKGROUND: set = set()


def _fire_and_forget(coro) -> None:
    try:
        task = asyncio.get_running_loop().create_task(coro)
    except RuntimeError:
        coro.close()
        return
    _BACKGROUND.add(task)
    task.add_done_callback(_BACKGROUND.discard)


# ── in-process TTS cache (compiled narration repeats across learners) ────────
_TTS_CACHE: "OrderedDict[str, bytes]" = OrderedDict()
_TTS_CACHE_MAX = 300


def _cache_get(k: str) -> Optional[bytes]:
    v = _TTS_CACHE.get(k)
    if v is not None:
        _TTS_CACHE.move_to_end(k)
    return v


def _cache_put(k: str, v: bytes) -> None:
    _TTS_CACHE[k] = v
    _TTS_CACHE.move_to_end(k)
    while len(_TTS_CACHE) > _TTS_CACHE_MAX:
        _TTS_CACHE.popitem(last=False)


# ── REST ─────────────────────────────────────────────────────────────────────

class Caller:
    def __init__(self, institute_id: str, user_id: str, roles: List[str], is_root: bool):
        self.institute_id, self.user_id, self.roles, self.is_root = institute_id, user_id, roles, is_root

    @property
    def is_staff(self) -> bool:
        return is_staff(self.roles, is_root=self.is_root)


async def _caller(request: Request, authorization: Optional[str] = Header(default=None),
                  settings: Settings = Depends(get_settings)) -> Caller:
    if not authorization:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing Authorization: Bearer <jwt> (with a clientId header)")
    p = await get_pinned_principal(request, authorization, settings)
    return Caller(p.institute_id, p.user_id, sorted(normalize_roles(p.roles)), bool(p.is_root_user))


class StartSessionRequest(BaseModel):
    package_session_id: str = Field(..., min_length=1, max_length=255)
    slide_id: Optional[str] = Field(default=None, max_length=255)
    mode: str = Field(default="TEXT", pattern=r"^(TEXT|VOICE)$")
    language: Optional[str] = Field(default=None, pattern=r"^(en|hi)$")


def _batch_access(db: Session, caller: Caller, package_session_id: str) -> None:
    """Learners must be ACTIVE in the batch; staff must at least be in the
    batch's institute (a teacher token cannot open another institute's course)."""
    if caller.is_staff:
        pkg = svc.package_of_session(db, package_session_id)
        if not pkg or not package_belongs_to_institute(db, pkg[0], caller.institute_id):
            raise HTTPException(status_code=404, detail="Batch not found in this institute")
        return
    if not svc.learner_is_enrolled(db, user_id=caller.user_id, package_session_id=package_session_id, institute_id=caller.institute_id):
        raise HTTPException(status_code=403, detail="Not enrolled in this batch")


@router.get("/v1/learner/packages/{package_id}/availability", summary="Is tutor mode available on this course?")
def learner_availability(
    package_id: str,
    package_session_id: Optional[str] = Query(default=None),
    caller: Caller = Depends(_caller),
    db: Session = Depends(db_dependency),
) -> Dict[str, Any]:
    if not package_belongs_to_institute(db, package_id, caller.institute_id):
        raise HTTPException(status_code=404, detail="Course not found in this institute")
    return svc.availability(db, package_id=package_id, package_session_id=package_session_id,
                            institute_id=caller.institute_id, user_id=caller.user_id)


@router.get("/v1/learner/chapters/{chapter_id}/slides", summary="Ordered slides of a chapter with tutor readiness")
def learner_chapter_slides(
    chapter_id: str,
    package_session_id: str = Query(...),
    caller: Caller = Depends(_caller),
    db: Session = Depends(db_dependency),
) -> Dict[str, Any]:
    _batch_access(db, caller, package_session_id)
    return {"chapter_id": chapter_id, "slides": svc.chapter_slides(db, package_session_id=package_session_id, chapter_id=chapter_id)}


@router.get("/v1/learner/packages/{package_session_id}/outline",
            summary="Every chapter of the batch with its slides and tutor readiness (tutor left rail)")
def learner_course_outline(
    package_session_id: str,
    caller: Caller = Depends(_caller),
    db: Session = Depends(db_dependency),
) -> Dict[str, Any]:
    _batch_access(db, caller, package_session_id)
    return {"package_session_id": package_session_id, "chapters": svc.course_outline(db, package_session_id=package_session_id)}


@router.post("/v1/sessions", summary="Start (or resume) a tutor session")
def start_session(
    payload: StartSessionRequest,
    background: BackgroundTasks,
    caller: Caller = Depends(_caller),
    db: Session = Depends(db_dependency),
) -> Dict[str, Any]:
    _batch_access(db, caller, payload.package_session_id)
    if payload.mode == "VOICE":
        short = svc.preflight_live_session(db, caller.institute_id, user_id=caller.user_id, roles_raw=caller.roles)
        if short:
            raise HTTPException(status_code=status.HTTP_402_PAYMENT_REQUIRED, detail=short)
    try:
        boot = svc.start_session(user_id=caller.user_id, institute_id=caller.institute_id,
                                 package_session_id=payload.package_session_id, slide_id=payload.slide_id,
                                 mode=payload.mode, language=payload.language)
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except LookupError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    lesson: sm.LessonPlan = boot["lesson"]
    settings: TutorSettings = boot["settings"]
    # A lesson with a face: mint the Motion Server token now, in the
    # background, so the browser's own request is a cache hit (1-9 s saved).
    if (settings.avatar_provider == "spatius" and settings.avatar_id and spatius_service.available()
            and payload.mode == "VOICE"):
        background.add_task(spatius_service.warm_session_token)
    return {
        "tutor_session_id": boot["tutor_session_id"],
        "slide_id": lesson.slide_id,
        "slide_title": lesson.slide_title,
        "language": boot["language"],
        # Languages the learner may switch to during the lesson (course setting).
        "languages": [x for x in (settings.languages or ["en"]) if x in ("en", "hi")] or ["en"],
        "resumed": boot["resumed"],
        "teacher_name": settings.teacher_name,
        "teacher_avatar_file_id": settings.teacher_avatar_file_id,
        "learner_name": boot["learner_name"],
        "topics": [{"id": t.id, "title": t.title, "concepts": len(t.concepts)} for t in lesson.topics],
        "progress": boot["pointer"].progress(lesson),
        "socket_path": f"/tutor/ws/{boot['tutor_session_id']}",
        # Premium teacher avatar: the client asks for a session token when this is set.
        "avatar": ({"provider": "spatius", "avatar_id": settings.avatar_id, "app_id": spatius_service.app_id()}
                   if settings.avatar_provider == "spatius" and settings.avatar_id and spatius_service.available()
                   and payload.mode == "VOICE" else None),
    }


@router.post("/v1/sessions/{tutor_session_id}/avatar-token", summary="Session token for the teacher avatar (Spatius, premium)")
async def avatar_token(tutor_session_id: str, caller: Caller = Depends(_caller), db: Session = Depends(db_dependency)) -> Dict[str, Any]:
    ts = db.get(TutorSession, tutor_session_id)
    if ts is None or ts.user_id != caller.user_id or ts.status != "ACTIVE":
        raise HTTPException(status_code=404, detail="Session not found")
    pkg = svc.package_of_session(db, ts.package_session_id)
    s = resolve_settings(db, package_id=pkg[0] if pkg else "", institute_id=ts.institute_id)
    if not (s.avatar_provider == "spatius" and s.avatar_id and spatius_service.available()):
        raise HTTPException(status_code=404, detail="This course has no teacher avatar")
    try:
        tok = await spatius_service.mint_session_token()
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e))
    return {**tok, "avatar_id": s.avatar_id, "provider": "spatius"}


@router.post("/v1/sessions/{tutor_session_id}/end", summary="End a tutor session (fallback for closed sockets)")
def end_session_rest(
    tutor_session_id: str, background: BackgroundTasks, caller: Caller = Depends(_caller), db: Session = Depends(db_dependency),
) -> Dict[str, Any]:
    ts = db.get(TutorSession, tutor_session_id)
    if ts is None or ts.user_id != caller.user_id:
        raise HTTPException(status_code=404, detail="Session not found")
    if ts.status != "ACTIVE":
        return {"tutor_session_id": tutor_session_id, "status": ts.status}
    res = svc.end_session(tutor_session_id=tutor_session_id, user_id=ts.user_id, package_session_id=ts.package_session_id,
                          lesson=None, pointer=None, status="ENDED")
    if res.get("transitioned"):
        ctx = svc.summary_context(tutor_session_id)
        if ctx:
            background.add_task(rewrite_rolling_summary, **ctx)
    return res


# ── WebSocket ────────────────────────────────────────────────────────────────

@router.websocket("/ws/{tutor_session_id}")
async def tutor_socket(websocket: WebSocket, tutor_session_id: str) -> None:
    await websocket.accept()
    send_lock = asyncio.Lock()
    current_task: Optional[asyncio.Task] = None
    audio_buffer = bytearray()
    started_at = time.time()
    last_activity = time.time()
    reached_ready = False
    turn_times: Deque[float] = deque()
    turns = 0
    meter_task: Optional[asyncio.Task] = None
    opening_task: Optional[asyncio.Task] = None
    _summary_args = None       # set once the lesson is booted (see below)

    async def _send(payload: dict) -> None:
        async with send_lock:
            await websocket.send_json(payload)

    async def _fatal(message: str, code: int) -> None:
        await _send({"type": "error", "message": message, "fatal": True})
        await websocket.close(code=code)

    try:
        owner = svc.session_owner(tutor_session_id)
        if owner is None or owner["status"] != "ACTIVE":
            await _fatal("Tutor session not found or already ended", 4004)
            return
        user_id = owner["user_id"]

        # ── 1. auth FIRST, always ──
        try:
            raw = await asyncio.wait_for(websocket.receive_text(), timeout=20)
        except asyncio.TimeoutError:
            await _fatal("Authentication timed out", 4401)
            return
        try:
            first = json.loads(raw)
        except json.JSONDecodeError:
            first = {}
        claims = decode_access_token(str(first.get("token") or "")) if first.get("type") == "auth" else None
        if not claims or str(claims.get("user") or "") != str(user_id):
            await _fatal("Authentication required", 4401)
            return
        hold_opening = client_holds_opening(first)
        begin_event = asyncio.Event()

        # ── 2. load lesson, settings, learner state (one short session) ──
        ctx = svc.boot_context(tutor_session_id)
        if ctx is None:
            await _fatal("Tutor session not found", 4004)
            return
        lesson: Optional[sm.LessonPlan] = ctx["lesson"]
        if lesson is None:
            await _fatal("This slide has no teaching plan", 4009)
            return
        institute_id, package_session_id = ctx["institute_id"], ctx["package_session_id"]
        # Usage limits: the learner's roles for the per-minute limits check
        # (None, with no work, when the institute has no limits policy).
        limit_roles = svc.limit_roles_for(str(first.get("token") or ""), institute_id)
        chat_session_id = ctx["chat_session_id"]
        mode = "voice" if ctx["mode"] == "VOICE" else "text"
        settings: TutorSettings = ctx["settings"]
        state: Dict[str, Any] = ctx["state"]
        lang = ctx["language"] if ctx["language"] in ("en", "hi") else settings.course_language
        display_name = ctx["learner_name"] or ""
        pointer = ctx.get("pointer")
        resumed = pointer is not None
        pointer = pointer or sm.Pointer()
        svc.note_start_progress(tutor_session_id, lesson.slide_id, pointer.done)
        sarvam = SarvamService()
        tts_provider = ctx["tts_provider"]
        if tts_provider not in SERVER_TTS_PROVIDERS or (tts_provider == "smallest" and not smallest_available()):
            tts_provider = "sarvam"
        tts_voice = ctx["tts_voice"]
        live_model: Optional[str] = ctx.get("live_model")
        max_seconds = int(ctx.get("max_seconds") or SESSION_MAX_SECONDS)
        is_demo = bool(ctx.get("demo"))
        # What the learner answered per concept this session; quiz slides
        # write it back as a quiz activity log when the slide is done.
        attempt_log: Dict[str, Dict[str, Any]] = {}
        pace = state.get("pace") or "normal"
        # Course / institute voice speed; the learner's slower / faster sits on top.
        base_pace = float(getattr(settings, "voice_pace", 1.0) or 1.0)

        def _effective_pace(segment: str = "") -> float:
            return effective_pace(base_pace, pace, segment)
        # Silence recovery state: when the current question was asked and
        # whether the learner has already been nudged on it.
        awaiting_answer_since: Optional[float] = None
        nudged = False
        # Did any microphone audio arrive since this question opened? Voice
        # answers are tap-to-talk; most voice sessions used to end with no answer
        # at all, because the student spoke to a microphone that was never on.
        heard_audio = False

        # The camera says the learner stepped away (activeness tracker, opt-in):
        # teaching pauses until they are back. None = present / not tracked.
        away_since: Optional[float] = None
        last_activeness_write = 0.0
        avatar_diag_count = 0

        async def _await(what: str) -> None:
            nonlocal awaiting_answer_since, nudged, heard_audio
            awaiting_answer_since = time.time() if what == "answer" else None
            nudged = False
            heard_audio = False
            await _send({"type": "await", "what": what})
        board: List[Dict[str, Any]] = []          # cumulative ops of the current topic
        transcript: List[Dict[str, str]] = []
        speak_enabled = mode == "voice"
        teacher = settings.teacher_name or "Asha"
        # A transition already committed (pointer + DB) whose narration was
        # interrupted before the next board was shown: (step, concept it closed).
        pending: Optional[Tuple[sm.Step, Optional[sm.Concept]]] = None
        previous_slide: Optional[Dict[str, Any]] = ctx.get("previous_slide")
        # First open of this socket: later slides get a short lead-in instead.
        opened_once = False
        # Weak-concept revisit in progress (design §6.6): stage, the concepts
        # still to ask, and the one being asked with its fresh check.
        revisit: Optional[Dict[str, Any]] = None
        revisited: set = set()
        # The learner's device is rendering the premium avatar (config frame).
        avatar_active = False

        def _summary_args() -> Dict[str, Any]:
            return {"tutor_session_id": tutor_session_id, "user_id": user_id, "institute_id": institute_id,
                    "package_session_id": package_session_id, "model": live_model, "teacher": teacher, "lang": lang,
                    "learner_name": display_name or None}

        def _lang_stt() -> str:
            return LANG_TO_STT.get(lang, "en-IN")

        def _personalize(text_: str) -> str:
            return text_.replace("{student_name}", display_name or ("there" if lang == "en" else "दोस्त"))

        def _slide_name() -> str:
            return lesson.slide_title or (lesson.topics[0].title if lesson.topics else "")

        def _save() -> None:
            svc.save_pointer(user_id=user_id, package_session_id=package_session_id, lesson=lesson, pointer=pointer,
                             language=lang, pace=pace)

        async def _speak(text_: str) -> None:
            if not speak_enabled or not text_.strip():
                return
            # The teacher is female by default (owner decision); a voice name
            # Sarvam does not serve (v2 names, Smallest voices) falls back to it.
            if tts_provider == "sarvam":
                voice = sarvam_speaker(tts_voice, SARVAM_DEFAULT_FEMALE)
            elif tts_provider == "smallest":
                voice = (tts_voice or SMALLEST_DEFAULT_VOICE).strip()
            else:
                voice = tts_voice or default_voice_for(tts_provider, _lang_stt())
            for segment, first_idx, n_sent in _tutor_segments(text_):
                # The sentence(s) this audio segment speaks, with their index
                # in the narration: the client reveals the board elements
                # marked for those sentences as the segment starts playing.
                await _send({"type": "segment_text", "text": segment, "index": first_idx, "count": n_sent})
                seg_pace = _effective_pace(segment)
                # What the engine hears: "9/16" as "9 by 16", not a date.
                spoken = _spoken_form(segment, lang)
                key = _cache_key(tts_provider, voice, _lang_stt(), str(seg_pace), spoken)
                audio = _cache_get(key)
                provider_used = tts_provider
                if audio is None:
                    # Prepared voice (compile-time warm-up, or another learner's
                    # lesson): the same audio, already paid for once.
                    row = await asyncio.to_thread(voice_cache.lookup, key)
                    prepared = await voice_cache.fetch(row.url) if row is not None else None
                    if prepared:
                        audio = prepared
                        _cache_put(key, audio)
                        svc.record_media_usage(kind="tts", institute_id=institute_id, user_id=user_id,
                                               session_id=tutor_session_id, language=_lang_stt(),
                                               characters=len(segment), detail=f"tutor:{voice}", provider=tts_provider, cached=True)
                        svc.bump_telemetry(tutor_session_id, tts_prepared_hits=1)
                if audio is None:
                    audio, _mime, provider_used = await synthesize_speech(
                        text=spoken, language=_lang_stt(), voice=voice, provider=tts_provider,
                        pace=seg_pace,
                    )
                    if audio:
                        _cache_put(key, audio)
                        # Only synthesised audio costs money; a failed engine is not usage.
                        svc.record_media_usage(kind="tts", institute_id=institute_id, user_id=user_id,
                                               session_id=tutor_session_id, language=_lang_stt(),
                                               characters=len(segment), detail=f"tutor:{voice}", provider=provider_used)
                        svc.bump_telemetry(tutor_session_id, tts_chars=len(segment))
                        if provider_used == tts_provider:
                            _fire_and_forget(voice_cache.store(key, provider=tts_provider, voice=voice, lang=_lang_stt(),
                                                               pace=str(seg_pace), text_=spoken, audio=audio, mime=_mime))
                else:
                    svc.bump_telemetry(tutor_session_id, tts_cache_hits=1)
                if not audio:
                    continue
                for i in range(0, len(audio), TTS_CHUNK_SIZE):
                    await _send({"type": "audio_chunk", "data": base64.b64encode(audio[i:i + TTS_CHUNK_SIZE]).decode("ascii")})
                await _send({"type": "audio_segment_end"})

        async def _say(text_: str, *, reason: str = "complete", meta: Optional[dict] = None, beat: bool = False) -> None:
            text_ = _personalize(text_)
            transcript.append({"role": "teacher", "text": text_})
            svc.append_transcript(chat_session_id, "assistant", text_, meta)
            await _send({"type": "ai_text", "text": text_, "meta": meta or {}})
            if beat and speak_enabled:
                # A breath before a question, so it lands as a question.
                await _send({"type": "beat", "ms": QUESTION_BEAT_MS})
            await _speak(text_)
            await _send({"type": "audio_end", "reason": reason})

        async def _apply_decision_ops(decision: Dict[str, Any], concept: Optional[sm.Concept]) -> None:
            """Highlights are transient; a note the teacher writes while
            remediating stays on the board for the rest of the topic."""
            nonlocal board
            if pointer.phase == sm.PREDICT:
                return   # the concept's board is not drawn yet
            ops = decision.get("board_ops") or []
            notes = [o for o in ops if o.get("note")]
            live = [o for o in ops if not o.get("note")]
            if notes:
                board = board + notes
                t = lesson.topic_at(pointer)
                await _send({"type": "board", "clear": False, "ops": notes, "topic_id": t.id if t else None,
                             "concept_id": concept.id if concept else None})
            if live:
                await _send({"type": "board", "clear": False, "ops": live, "live": True})

        async def _keep_answer_on_board(concept: sm.Concept, decision: Dict[str, Any]) -> None:
            """Moving on after a wrong answer: the right answer stays written."""
            nonlocal board
            if any(o.get("note") for o in decision.get("board_ops") or []):
                return
            expected = ((concept.check or {}).get("expected") or "").strip()
            if not expected:
                return
            note = {"op": "callout", "id": f"live-answer-{concept.id[:8]}", "kind": "definition",
                    "text": prompts.tpl("answer_note", lang, expected=expected[:160]), "note": True}
            board = board + [note]
            t = lesson.topic_at(pointer)
            await _send({"type": "board", "clear": False, "ops": [note], "topic_id": t.id if t else None, "concept_id": concept.id})

        def _spoken_lang(concept: Optional[sm.Concept] = None) -> str:
            """The language the lesson is actually being spoken in: the session
            language when the plan carries it, else the course language (an
            English-only plan narrates in English even for a Hindi learner, and
            canned lines must not switch language mid-lesson)."""
            if lang == lesson.language:
                return lang
            c = concept or lesson.concept_at(pointer)
            return lang if c is not None and (c.say_i18n or {}).get(lang) else lesson.language

        async def _nudge() -> None:
            """A minute of silence on a question: a hint, not a timeout."""
            open_question = bool(revisit and revisit.get("current")) or (
                pending is None and pointer.phase in (sm.AWAIT_ANSWER, sm.REMEDIATE, sm.PREDICT))
            if not open_question:
                return
            concept = (revisit or {}).get("current") if revisit else None
            check = (revisit or {}).get("check") if revisit else None
            if concept is None:
                concept = lesson.concept_at(pointer)
                check = concept.check if concept else None
            if revisit and revisit.get("current"):
                hint = ((check or {}).get("hint") or "").strip() or None     # fresh checks are written in the session language
            else:
                hint = concept.hint_for(lang, lesson.language) if concept else None
            if pointer.phase == sm.PREDICT:
                hint = None
            # Voice lesson and not a sound from the microphone: the likely problem is
            # how to answer, not what to answer — say how first, then the hint.
            how = "voice_" if mode == "voice" and not heard_audio else ""
            nl = _spoken_lang(concept)
            await _say(prompts.tpl(f"nudge_{how}hint", nl, hint=hint) if hint else prompts.tpl(f"nudge_{how}open", nl),
                       meta={"kind": "nudge"})
            await _send({"type": "await", "what": "answer"})

        async def _emit_state(phase: str, concept: Optional[sm.Concept] = None) -> None:
            c = concept or lesson.concept_at(pointer)
            t = lesson.topic_at(pointer)
            await _send({"type": "state", "slide_id": lesson.slide_id, "topic_id": t.id if t else None,
                         "topic_title": t.title if t else None, "concept_id": c.id if c else None,
                         "concept_title": c.title if c else None, "phase": phase, "progress": pointer.progress(lesson),
                         "language": lang, "remediations": pointer.remediations})

        async def _send_slide_done() -> None:
            nonlocal awaiting_answer_since
            awaiting_answer_since = None
            frame: Dict[str, Any] = {"type": "slide_done", "slide_id": lesson.slide_id, "weak_concepts": list(pointer.weak),
                                     "skipped_concepts": list(pointer.skipped), "done": pointer.done, "total": lesson.total_concepts}
            qr = svc.quiz_results(lesson, attempt_log)
            if qr:
                frame["quiz_results"] = qr
            await _send(frame)

        # ── weak-concept revisits (design §6.6) ──
        def _scores() -> Dict[str, float]:
            return {cid: float(a["score"]) for cid, a in attempt_log.items() if a.get("score") is not None}

        def _revisit_candidates(stage: str) -> List[sm.Concept]:
            weak_ids = set(pointer.weak) | set(state.get("weak_concepts_json") or [])
            return sm.revisit_candidates(lesson, pointer, stage=stage, weak_ids=weak_ids, skipped_ids=pointer.skipped,
                                         revisited=revisited, scores=_scores())

        async def _begin_revisit(stage: str, cands: List[sm.Concept]) -> None:
            nonlocal revisit
            revisit = {"stage": stage, "queue": list(cands), "current": None, "check": None}
            await _say(prompts.tpl("revisit_intro_topic" if stage == "topic" else "revisit_intro_slide", lang, n=len(cands)),
                       meta={"kind": "revisit_intro"})
            await _ask_next_revisit()

        async def _ask_next_revisit() -> None:
            nonlocal revisit
            if revisit is None:
                return
            if not revisit["queue"]:
                stage = revisit["stage"]
                revisit = None
                await _say(prompts.tpl("revisit_done_topic" if stage == "topic" else "revisit_done_slide", lang),
                           meta={"kind": "revisit_done"})
                if stage == "slide":
                    await _send_slide_done()
                else:
                    await _await("continue")
                return
            concept = revisit["queue"][0]
            att = attempt_log.get(concept.id) or {}
            check, usage = await fresh_check(
                institute_id=institute_id, user_id=user_id, model=live_model, lang=lang, concept=concept,
                previous_answer=att.get("answer") or None, misconception=att.get("misconception"),
                tutor_session_id=tutor_session_id,
            )
            svc.bump_telemetry(tutor_session_id, llm_prompt_tokens=usage.get("prompt_tokens", 0),
                               llm_completion_tokens=usage.get("completion_tokens", 0))
            # Popped only now: a barge-in during the model call leaves the queue intact.
            revisit["queue"].pop(0)
            revisited.add(concept.id)
            revisit["current"], revisit["check"] = concept, check
            await _emit_state(sm.REVISIT, concept)
            await _send({"type": "check", "concept_id": concept.id, "check_type": check.get("type"), "prompt": check.get("prompt"),
                         "options": check.get("options") or [], "remediation": 0, "revisit": True})
            await _say(prompts.tpl("revisit_ask", lang, concept=concept.title, prompt=check.get("prompt") or ""),
                       meta={"concept_id": concept.id, "kind": "revisit_ask"}, beat=True)
            await _await("answer")

        async def _handle_revisit_answer(text_: str, *, spoken: bool, kind: str) -> None:
            """One attempt at the fresh question: right clears the concept,
            wrong keeps it weak and the teacher gives the answer and moves on."""
            nonlocal revisit, pointer, state
            assert revisit is not None and revisit.get("current") is not None
            concept: sm.Concept = revisit["current"]
            check: Dict[str, Any] = revisit["check"] or {}
            source_block = await svc.kb_source_block(lesson, institute_id, concept.title, text_) if kind == "doubt" else None
            decision, usage = await run_turn(
                institute_id=institute_id, user_id=user_id, model=live_model, teacher=teacher, lang=lang,
                strictness=settings.strictness, learner_name=display_name or None, state=state, lesson=lesson,
                pointer=dc_replace(pointer, remediations=0), board_ops=board, transcript=transcript, learner_message=text_, kind=kind,
                mode="voice" if spoken else "text", tutor_session_id=tutor_session_id,
                concept=dc_replace(concept, check=check), final_attempt=True, revisit=True, source_block=source_block,
            )
            # (`pointer` above is the summary pointer; its concept/remediations are not this concept's.)
            svc.bump_telemetry(tutor_session_id, turns=1, llm_prompt_tokens=usage.get("prompt_tokens", 0),
                               llm_completion_tokens=usage.get("completion_tokens", 0), fallbacks=1 if decision.get("fallback") else 0)
            await _apply_decision_ops(decision, concept)
            if kind == "doubt" or decision["action"] in ("answer_doubt", "wait"):
                # A question or small talk instead of an answer: reply and keep the question open.
                await _say(decision["say"], meta={"kind": decision["action"] if kind != "doubt" else "answer_doubt"})
                await _await("answer")
                return
            assessment = decision.get("assessment") or {}
            score = assessment.get("score")
            # A model failure is never a pass: the fallback keeps the concept weak.
            ok = decision["action"] == "advance" and not decision.get("fallback")
            action = "revisit_ok" if ok else "revisit_weak"
            svc.record_attempt(tutor_session_id=tutor_session_id, user_id=user_id, package_session_id=package_session_id,
                               concept_id=concept.id, tags=concept.tags, attempt_no=sm.MAX_REMEDIATIONS + 1, answer=text_,
                               score=score, misconception=assessment.get("misconception"), action=action,
                               session_ops=decision["board_ops"], note=(decision.get("learner_state_delta") or {}).get("note"))
            state = svc.reload_state(user_id, package_session_id) or state
            # Quiz questions keep their first answer in the activity log.
            if not (concept.check or {}).get("question_id"):
                attempt_log[concept.id] = {"answer": text_, "score": score, "correct": ok, "action": action,
                                           "misconception": assessment.get("misconception")}
            if ok:
                pointer = sm.clear_weak(pointer, concept.id)
                svc.clear_weak(user_id=user_id, package_session_id=package_session_id, concept_id=concept.id)
                state["weak_concepts_json"] = [c for c in (state.get("weak_concepts_json") or []) if c != concept.id]
                _save()
            say = decision["say"]
            if not ok and (decision.get("fallback") or say.rstrip().endswith("?")):
                say = prompts.tpl("fallback_move_on", lang, expected=(check.get("expected") or "")[:160])
            if not ok:
                await _keep_answer_on_board(dc_replace(concept, check=check), decision)
            revisit["current"], revisit["check"] = None, None
            await _say(say, meta={"kind": "revisit_verdict", "score": score, "concept_id": concept.id, "cleared": ok})
            await _ask_next_revisit()

        async def _meter() -> None:
            """Charge the first minute now, then one per minute; stop the
            lesson politely when the institute cannot afford the next one.
            The premium avatar adds its own per-minute charge while it is on."""
            minute = 0
            while True:
                minute += 1
                if is_demo:
                    # The public taste is on the house: telemetry only.
                    svc.bump_telemetry(tutor_session_id, minutes_charged=0)
                    await asyncio.sleep(LIVE_METER_SECONDS)
                    continue
                ok = await asyncio.to_thread(svc.bill_live_minute, tutor_session_id=tutor_session_id,
                                             institute_id=institute_id, user_id=user_id, minute_no=minute,
                                             roles_raw=limit_roles)
                if avatar_active:
                    await asyncio.to_thread(svc.bill_avatar_minute, tutor_session_id=tutor_session_id,
                                            institute_id=institute_id, user_id=user_id, minute_no=minute)
                if not ok:
                    await _cancel_current()
                    usage_frames = svc.usage_limit_frames(tutor_session_id)
                    if usage_frames:
                        # An AI usage limit (not the balance) stopped the lesson:
                        # {"type": "usage_limit", <the HTTP 429 body>}, then "ended".
                        for frame in usage_frames:
                            await _send(frame)
                        try:
                            await websocket.close(code=svc.USAGE_LIMIT_CLOSE_CODE)
                        except Exception:  # noqa: BLE001
                            pass
                        return
                    await _say(prompts.tpl("credits_end", lang), meta={"kind": "credits_end"})
                    await _send({"type": "ended", "reason": "credits"})
                    try:
                        await websocket.close(code=4402)
                    except Exception:  # noqa: BLE001
                        pass
                    return
                await asyncio.sleep(LIVE_METER_SECONDS)

        async def _apply_step(step: sm.Step, *, greeting: Optional[str] = None) -> None:
            nonlocal pointer, board
            # Commit the transition BEFORE any await: an interrupted narration
            # must never leave memory one concept ahead of the database.
            pointer = step.pointer
            _save()
            if step.kind == "predict":
                # A guess before the board: the question is spoken, the board
                # waits for the answer (or a skip).
                if step.clear_board:
                    board = []
                    await _send({"type": "board", "clear": True, "ops": [], "topic_id": step.topic.id if step.topic else None})
                await _emit_state(step.pointer.phase, step.concept)
                q = (step.concept.predict_text(lang, lesson.language) or "") if step.concept else ""
                if not q:
                    # No guess question in this language: straight to the teaching.
                    await _apply_step(sm.after_predict(lesson, step.pointer))
                    return
                await _send({"type": "check", "concept_id": step.concept.id if step.concept else None, "check_type": "predict",
                             "prompt": q, "options": [], "remediation": 0, "predict": True})
                await _say(prompts.tpl("predict_intro", lang, question=q), meta={"kind": "predict_ask", "concept_id": step.concept.id if step.concept else None}, beat=True)
                await _await("answer")
                return
            if step.kind in ("teach", "media_task"):
                if step.clear_board:
                    board = []
                    await _send({"type": "board", "clear": True, "ops": [], "topic_id": step.topic.id if step.topic else None})
                await _emit_state(step.pointer.phase)
                # The greeting is spoken on its own, BEFORE the board frame:
                # the board's reveal follows the narration's sentence numbers.
                if greeting and step.kind == "teach":
                    await _say(greeting, meta={"kind": "greet"})
                board = board + list(step.board_ops)
                await _send({"type": "board", "clear": False, "ops": step.board_ops, "topic_id": step.topic.id if step.topic else None,
                             "concept_id": step.concept.id if step.concept else None})
                svc.bump_telemetry(tutor_session_id, concepts_taught=1)
                narration = step.concept.narration(lang)
                # Compiled first concepts often open with their own "Hi {name},
                # …": when the teacher has a greeting of her own (welcome back,
                # next slide), drop the narration's, never hers.
                if greeting:
                    narration = prompts.strip_leading_greeting(narration)
                text_ = narration
                if step.kind == "media_task":
                    kind = next((op.get("kind") for op in step.board_ops if op.get("op") == "media_task"), "video")
                    text_ = (greeting + " " if greeting else "") + prompts.tpl("media_task_video" if kind == "video" else "media_task_pdf", lang)
                await _say(text_, meta={"concept_id": step.concept.id if step.concept else None, "kind": step.kind})
                if step.kind == "media_task":
                    await _await("done")
                elif step.concept and step.concept.has_check:
                    # Explain, then ask — in one breath, like a teacher would.
                    await _apply_step(sm.after_teach(lesson, pointer))
                else:
                    # Nothing to ask. A voice client continues by itself once
                    # the audio has played; a text client shows Continue.
                    await _await("continue")
            elif step.kind == "ask":
                await _emit_state(step.pointer.phase)
                c = step.concept
                chk = (c.check or {}) if c else {}
                prompt_text = (c.check_prompt(lang, lesson.language) if c else None) or chk.get("prompt") or ""
                await _send({"type": "check", "concept_id": c.id if c else None, "check_type": chk.get("type"),
                             "prompt": prompt_text, "options": chk.get("options") or [],
                             "remediation": step.pointer.remediations})
                # The prompt is the ONE question. Plans compiled before the
                # question-discipline rule sometimes end the narration on a
                # question already; then the card carries the prompt and the
                # voice does not ask a second, differently worded one.
                if c and step.pointer.remediations == 0 and prompts.narration_asks(c.narration(lang)):
                    await _send({"type": "beat", "ms": QUESTION_BEAT_MS})
                else:
                    await _say(prompts.tpl("ask", lang, prompt=prompt_text), meta={"concept_id": c.id if c else None, "kind": "ask"}, beat=True)
                await _await("answer")
            elif step.kind == "topic_summary":
                await _emit_state(step.pointer.phase)
                if step.board_ops:
                    board = board + list(step.board_ops)
                    await _send({"type": "board", "clear": False, "ops": step.board_ops, "topic_id": step.topic.id if step.topic else None})
                recap = (step.topic.recap(lang, lesson.language) or "") if step.topic else ""
                await _say(recap or prompts.tpl("topic_summary", lang, topic=step.topic.title if step.topic else ""),
                           meta={"kind": "topic_summary"})
                cands = _revisit_candidates("topic")
                if cands:
                    await _begin_revisit("topic", cands)
                else:
                    await _await("continue")
            elif step.kind == "slide_done":
                await _emit_state(step.pointer.phase)
                cands = _revisit_candidates("slide")
                weak = prompts.tpl("weak_note", lang, n=len(pointer.weak)) if pointer.weak and not cands else ""
                await _say(prompts.tpl("slide_done", lang, slide=_slide_name(), name=display_name, weak=weak), meta={"kind": "slide_done"})
                if cands:
                    await _begin_revisit("slide", cands)
                else:
                    await _send_slide_done()

        async def _open(*, first: bool) -> None:
            nonlocal board, opened_once, revisit
            revisit = None
            # What the teacher says about last time: the model-written line
            # from the previous session's summary, else just the weak count.
            weak_n = len(state.get("weak_concepts_json") or [])
            summary = (prompts.strip_leading_greeting(ctx.get("resume_line") or "").strip()
                       or (prompts.tpl("weak_note", lang, n=weak_n) if weak_n else ""))
            if resumed:
                # Put back what the topic's earlier concepts drew, so "look at
                # the arrow" still points at something after a refresh.
                replay = sm.replay_ops(lesson, pointer)
                if replay:
                    board = list(replay)
                    t = lesson.topic_at(pointer)
                    await _send({"type": "board", "clear": True, "ops": [], "topic_id": t.id if t else None})
                    await _send({"type": "board", "clear": False, "ops": replay, "topic_id": t.id if t else None, "replay": True})
                if pointer.phase == sm.SLIDE_DONE:
                    greet = prompts.tpl("resume_done", lang, name=display_name, slide=_slide_name(), summary=summary)
                elif pointer.phase == sm.TOPIC_SUMMARY:
                    t = lesson.topic_at(pointer)
                    greet = prompts.tpl("resume_summary", lang, name=display_name, slide=_slide_name(),
                                        topic=t.title if t else "", summary=summary)
                else:
                    greet = prompts.tpl("resume", lang, name=display_name, slide=_slide_name(), summary=summary)
            elif first and not opened_once and previous_slide and previous_slide.get("slide_title"):
                greet = prompts.tpl("greet_returning", lang, name=display_name, slide=_slide_name(),
                                    previous=previous_slide["slide_title"], summary=summary)
            elif first and not opened_once:
                greet = prompts.tpl(prompts.greet_key(lesson.style), lang, name=display_name, teacher=teacher, slide=_slide_name())
            else:
                greet = prompts.tpl("next_slide", lang, slide=_slide_name())
            opened_once = True
            step = sm.enter(lesson, pointer)
            if step.kind in ("topic_summary", "slide_done", "predict"):
                # Resuming on a summary / a finished slide, or opening on a
                # guess: say the greeting first, then the step's own line.
                await _say(greet, meta={"kind": "greet"})
            await _apply_step(step, greeting=greet if step.kind in ("teach", "media_task") else None)

        async def _commit_then_say(step: sm.Step, closed: Optional[sm.Concept], text_: str, meta: dict) -> None:
            """Verdict pattern: the transition is committed first; if the
            learner barges in during the verdict, `pending` carries the
            step so the next `continue` (or utterance) picks it up."""
            nonlocal pointer, pending
            pending = (step, closed)
            pointer = step.pointer
            _save()
            await _say(text_, meta=meta)
            pending = None
            await _apply_step(step)

        async def _answer_doubt(text_: str, concept: sm.Concept, *, spoken: bool, what_next: str) -> None:
            source_block = await svc.kb_source_block(lesson, institute_id, concept.title, text_)
            decision, usage = await run_turn(
                institute_id=institute_id, user_id=user_id, model=live_model, teacher=teacher, lang=lang,
                strictness=settings.strictness, learner_name=display_name or None, state=state, lesson=lesson,
                pointer=pointer, board_ops=board, transcript=transcript, learner_message=text_, kind="doubt",
                mode="voice" if spoken else "text", tutor_session_id=tutor_session_id, concept=concept,
                source_block=source_block,
            )
            svc.bump_telemetry(tutor_session_id, turns=1, llm_prompt_tokens=usage.get("prompt_tokens", 0),
                               llm_completion_tokens=usage.get("completion_tokens", 0), fallbacks=1 if decision.get("fallback") else 0)
            await _apply_decision_ops(decision, concept)
            await _say(decision["say"], meta={"kind": "answer_doubt"})
            if what_next == "slide_done":
                await _send_slide_done()
            else:
                await _await(what_next)

        async def _handle_doubt(text_: str) -> None:
            await _handle_learner_text(text_, spoken=False, force_doubt=True)

        async def _handle_learner_text(text_: str, *, spoken: bool, force_doubt: bool = False) -> None:
            """Route a learner utterance: intent → answer → doubt."""
            nonlocal pointer, pace, lang, pending, state
            text_ = (text_ or "").strip()
            if not text_:
                await _send({"type": "audio_end", "reason": "no_speech"})
                return
            transcript.append({"role": "learner", "text": text_})
            svc.append_transcript(chat_session_id, "user", text_, {"spoken": spoken})
            intent = None if force_doubt else detect_intent(text_)
            phase = pointer.phase
            short_ok = text_.lower().strip(" .!") in ("ok", "okay", "yes", "haan", "हाँ", "ji", "जी", "hmm", "sure", "next", "fine")

            # A verdict was interrupted: the learner either wants to go on or
            # has a question about what was just closed.
            if pending is not None:
                step, closed = pending
                if intent in ("resume", "skip", "repeat", "done") or (intent is None and short_ok):
                    pending = None
                    await _apply_step(step)
                    return
                if closed is not None:
                    await _answer_doubt(text_, closed, spoken=spoken, what_next="continue")
                    return
                pending = None
                await _apply_step(step)
                return

            # A revisit question is open (or being prepared): the utterance
            # is about it, never about the summary the pointer sits on.
            if revisit is not None:
                if revisit.get("current") is None:
                    await _ask_next_revisit(); return
                current: sm.Concept = revisit["current"]
                if intent == "repeat":
                    chk = revisit["check"] or {}
                    await _say(prompts.tpl("revisit_ask", lang, concept=current.title, prompt=chk.get("prompt") or ""),
                               meta={"concept_id": current.id, "kind": "revisit_ask"})
                    await _await("answer"); return
                if intent == "skip":
                    svc.record_attempt(tutor_session_id=tutor_session_id, user_id=user_id, package_session_id=package_session_id,
                                       concept_id=current.id, tags=current.tags, attempt_no=sm.MAX_REMEDIATIONS + 1, answer=text_,
                                       score=None, misconception=None, action="skipped", session_ops=None, note=None)
                    revisit["current"], revisit["check"] = None, None
                    await _say(prompts.tpl("revisit_skipped", lang), meta={"kind": "skip"})
                    await _ask_next_revisit(); return
                if intent in ("resume", "done") or (intent is None and short_ok):
                    # "continue" after a pause, "okay", "yes": not an answer — ask again.
                    chk = revisit["check"] or {}
                    await _say(prompts.tpl("revisit_ask", lang, concept=current.title, prompt=chk.get("prompt") or ""),
                               meta={"concept_id": current.id, "kind": "revisit_ask"})
                    await _await("answer"); return
                if intent in ("slower", "faster"):
                    pace = _step_pace(pace, -1 if intent == "slower" else 1)
                    _save()
                    await _send({"type": "pace", "pace": pace})
                    await _say(prompts.tpl(intent, lang), meta={"kind": intent})
                    await _await("answer"); return
                if intent == "pause":
                    await _say(prompts.tpl("pause", lang), meta={"kind": "pause"})
                    await _await("answer"); return
                await _handle_revisit_answer(text_, spoken=spoken, kind="doubt" if (intent == "doubt" or force_doubt) else "answer")
                return

            # Predict-then-reveal: any guess (or a skip) leads into the teaching.
            if pointer.phase == sm.PREDICT:
                concept = lesson.concept_at(pointer)
                if concept is None or intent in ("skip", "resume", "done") or (intent is None and short_ok):
                    await _apply_step(sm.after_predict(lesson, pointer)); return
                if intent == "repeat":
                    await _say(prompts.tpl("predict_intro", lang, question=concept.predict_text(lang, lesson.language) or ""), meta={"kind": "predict_ask"}, beat=True)
                    await _await("answer"); return
                if intent == "doubt" or force_doubt:
                    await _answer_doubt(text_, concept, spoken=spoken, what_next="answer"); return
                if intent not in ("slower", "faster", "pause"):
                    say, usage = await run_predict(institute_id=institute_id, user_id=user_id, model=live_model, teacher=teacher,
                                                   lang=lang, learner_name=display_name or None, concept=concept, answer=text_,
                                                   tutor_session_id=tutor_session_id)
                    svc.bump_telemetry(tutor_session_id, turns=1, llm_prompt_tokens=usage.get("prompt_tokens", 0),
                                       llm_completion_tokens=usage.get("completion_tokens", 0))
                    await _say(say, meta={"kind": "predict", "concept_id": concept.id})
                    await _apply_step(sm.after_predict(lesson, pointer)); return

            if intent == "repeat":
                await _apply_step(sm.repeat(lesson, pointer)); return
            if intent == "skip":
                concept = lesson.concept_at(pointer)
                if concept is not None:
                    svc.record_attempt(tutor_session_id=tutor_session_id, user_id=user_id, package_session_id=package_session_id,
                                       concept_id=concept.id, tags=concept.tags, attempt_no=pointer.remediations + 1, answer=text_,
                                       score=None, misconception=None, action="skipped", session_ops=None, note=None)
                    attempt_log.setdefault(concept.id, {"answer": "", "score": None, "correct": False, "action": "skipped"})
                await _say(prompts.tpl("skipped", lang), meta={"kind": "skip"})
                await _apply_step(sm.skip(lesson, pointer)); return
            if intent in ("slower", "faster"):
                pace = _step_pace(pace, -1 if intent == "slower" else 1)
                _save()
                await _send({"type": "pace", "pace": pace})
                await _say(prompts.tpl(intent, lang), meta={"kind": intent})
                await _await("continue" if phase in (sm.TEACH, sm.TOPIC_SUMMARY) else "answer"); return
            if intent == "done" and phase == sm.MEDIA_TASK:
                await _apply_step(sm.after_teach(lesson, pointer)); return
            if intent == "pause":
                await _say(prompts.tpl("pause", lang), meta={"kind": "pause"})
                await _await("answer" if phase in (sm.AWAIT_ANSWER, sm.REMEDIATE, sm.PREDICT) else "continue"); return
            if intent == "resume" or (intent is None and phase in (sm.TEACH, sm.TOPIC_SUMMARY, sm.SLIDE_DONE) and short_ok):
                await _handle_continue(); return

            concept = lesson.concept_at(pointer)
            if concept is None:
                # Topic summary or slide done: no concept to grade, but a
                # question is still a question — answer it about the last
                # concept taught, then re-open the same wait.
                if intent is None and not force_doubt and len(text_.split()) <= 2:
                    await _handle_continue(); return
                topic = lesson.topic_at(pointer) or (lesson.topics[-1] if lesson.topics else None)
                last = topic.concepts[-1] if topic and topic.concepts else None
                if last is None:
                    await _handle_continue(); return
                await _answer_doubt(text_, last, spoken=spoken, what_next="slide_done" if phase == sm.SLIDE_DONE else "continue")
                return

            kind = "answer" if phase in (sm.AWAIT_ANSWER, sm.REMEDIATE) and intent != "doubt" and not force_doubt else "doubt"
            final_attempt = kind == "answer" and pointer.remediations + 1 >= sm.MAX_REMEDIATIONS
            # Design §6.5: the course's own material reaches the model on
            # doubt turns and on remediation (a wrong answer), never on the
            # first grading pass — that one is the rubric's job.
            source_block = None
            if kind == "doubt" or pointer.remediations > 0:
                source_block = await svc.kb_source_block(lesson, institute_id, concept.title, text_)
            decision, usage = await run_turn(
                institute_id=institute_id, user_id=user_id, model=live_model, teacher=teacher, lang=lang,
                strictness=settings.strictness, learner_name=display_name or None, state=state, lesson=lesson,
                pointer=pointer, board_ops=board, transcript=transcript, learner_message=text_, kind=kind,
                mode="voice" if spoken else "text", tutor_session_id=tutor_session_id, final_attempt=final_attempt,
                source_block=source_block,
            )
            svc.bump_telemetry(tutor_session_id, turns=1, llm_prompt_tokens=usage.get("prompt_tokens", 0),
                               llm_completion_tokens=usage.get("completion_tokens", 0), fallbacks=1 if decision.get("fallback") else 0)
            await _apply_decision_ops(decision, concept)
            if kind == "answer":
                score = (decision.get("assessment") or {}).get("score")
                action = decision["action"]
                if action == "advance":
                    svc.record_attempt(tutor_session_id=tutor_session_id, user_id=user_id, package_session_id=package_session_id,
                                       concept_id=concept.id, tags=concept.tags, attempt_no=pointer.remediations + 1, answer=text_,
                                       score=score, misconception=(decision.get("assessment") or {}).get("misconception"),
                                       action="advance", session_ops=decision["board_ops"], note=(decision.get("learner_state_delta") or {}).get("note"))
                    state = svc.reload_state(user_id, package_session_id) or state
                    attempt_log[concept.id] = {"answer": text_, "score": score, "correct": True, "action": "advance"}
                    await _commit_then_say(sm.advance(lesson, pointer, mark_done=True), concept, decision["say"],
                                           {"kind": "evaluate", "score": score})
                elif action == "remediate":
                    step = sm.remediate(lesson, pointer)
                    weak_now = step.kind != "ask"      # remediation budget exhausted → advanced weak
                    svc.record_attempt(tutor_session_id=tutor_session_id, user_id=user_id, package_session_id=package_session_id,
                                       concept_id=concept.id, tags=concept.tags, attempt_no=pointer.remediations + 1, answer=text_,
                                       score=score, misconception=(decision.get("assessment") or {}).get("misconception"),
                                       action="advance_weak" if weak_now else "remediate", session_ops=decision["board_ops"],
                                       note=(decision.get("learner_state_delta") or {}).get("note"))
                    state = svc.reload_state(user_id, package_session_id) or state
                    attempt_log[concept.id] = {"answer": text_, "score": score, "correct": False,
                                               "action": "advance_weak" if weak_now else "remediate",
                                               "misconception": (decision.get("assessment") or {}).get("misconception")}
                    if step.kind == "ask":
                        pointer = step.pointer
                        _save()
                        await _say(decision["say"], meta={"kind": "remediate", "score": score})
                        await _emit_state(pointer.phase)
                        await _await("answer")
                    else:
                        # The prompt told the model this was the last attempt
                        # (no re-ask); if it re-asked anyway, close the loop
                        # ourselves rather than leave a question unanswerable.
                        say = decision["say"]
                        if decision.get("fallback") or say.rstrip().endswith("?"):
                            say = prompts.tpl("fallback_move_on", lang, expected=((concept.check or {}).get("expected") or "")[:160])
                        await _keep_answer_on_board(concept, decision)
                        await _commit_then_say(step, concept, say, {"kind": "remediate", "score": score})
                else:  # answer_doubt / wait: respond and re-open the check
                    await _say(decision["say"], meta={"kind": decision["action"]})
                    await _await("answer")
            else:
                await _say(decision["say"], meta={"kind": "answer_doubt"})
                await _await("answer" if phase in (sm.AWAIT_ANSWER, sm.REMEDIATE) else "continue")

        async def _handle_continue() -> None:
            nonlocal pointer, pending
            if pending is not None:
                step, _closed = pending
                pending = None
                await _apply_step(step)
                return
            if revisit is not None:
                # Continue during a revisit: re-open the question, or ask the
                # next one if the last was interrupted while being prepared.
                if revisit.get("current") is not None:
                    await _await("answer")
                else:
                    await _ask_next_revisit()
                return
            phase = pointer.phase
            if phase == sm.PREDICT:
                await _apply_step(sm.after_predict(lesson, pointer))
            elif phase in (sm.TEACH, sm.MEDIA_TASK):
                await _apply_step(sm.after_teach(lesson, pointer))
            elif phase == sm.TOPIC_SUMMARY:
                await _apply_step(sm.next_topic(lesson, pointer))
            elif phase in (sm.AWAIT_ANSWER, sm.REMEDIATE):
                await _await("answer")
            elif phase == sm.SLIDE_DONE:
                await _send_slide_done()

        async def _run_audio_turn(audio: bytes, mime: str) -> None:
            reason, detail = "complete", ""
            try:
                audio, mime, note = await _transcode_to_wav(audio, mime)
                detail = note
                if mime == "audio/wav" and len(audio) < MIN_SPEECH_WAV_BYTES:
                    await _send({"type": "audio_end", "reason": "no_speech", "detail": f"too_short;{note}"})
                    return
                try:
                    text_ = await sarvam.speech_to_text(audio_bytes=audio, language=_lang_stt(), mime_type=mime)
                except SarvamSTTError as e:
                    await _send({"type": "transcript_final", "text": ""})
                    await _send({"type": "error", "message": "I couldn't hear that. Please try again.", "fatal": False})
                    await _send({"type": "audio_end", "reason": "error", "detail": f"stt_http_{e.status or 'err'};{note}"})
                    return
                svc.record_media_usage(kind="stt", institute_id=institute_id, user_id=user_id, session_id=tutor_session_id,
                                       language=_lang_stt(), characters=len(text_ or ""), detail="tutor",
                                       seconds=(len(audio) / 32000.0) if mime == "audio/wav" else None)
                await _send({"type": "transcript_final", "text": text_ or ""})
                await _handle_learner_text(text_ or "", spoken=True)
            except asyncio.CancelledError:
                raise
            except Exception as e:  # noqa: BLE001
                logger.exception("tutor audio turn failed for %s", tutor_session_id)
                await _send({"type": "error", "message": str(e)[:200], "fatal": False})
                await _send({"type": "audio_end", "reason": "error", "detail": detail})

        async def _cancel_current() -> None:
            nonlocal current_task
            if current_task and not current_task.done():
                current_task.cancel()
                try:
                    await current_task
                except (asyncio.CancelledError, Exception):  # noqa: BLE001
                    pass
            current_task = None

        paused_for_away = False

        async def _away() -> None:
            nonlocal paused_for_away
            paused_for_away = True
            await _say(prompts.tpl("away", _spoken_lang()), meta={"kind": "away"})
            await _await("continue")

        async def _welcome_back() -> None:
            """Back in front of the camera: pick up the concept they missed."""
            nonlocal paused_for_away
            paused_for_away = False
            await _say(prompts.tpl("welcome_back", _spoken_lang()), meta={"kind": "welcome_back"})
            if pending is None and pointer.phase in (sm.TEACH, sm.MEDIA_TASK, sm.PREDICT, sm.AWAIT_ANSWER, sm.REMEDIATE):
                # They missed (part of) the explanation: the same "say that again"
                # step the Repeat button uses — the concept, then its question.
                await _apply_step(sm.repeat(lesson, pointer))
            else:
                # A transition cut off mid-narration, or a topic recap: carry on.
                await _handle_continue()

        def _spawn(coro) -> None:
            nonlocal current_task
            current_task = asyncio.create_task(coro)

        def _turn_allowed() -> bool:
            nonlocal turns
            now = time.time()
            while turn_times and now - turn_times[0] > 60:
                turn_times.popleft()
            if len(turn_times) >= MAX_TURNS_PER_MINUTE or turns >= MAX_TURNS_PER_SESSION:
                return False
            turn_times.append(now)
            turns += 1
            return True

        def _lesson_frame() -> dict:
            return {"type": "lesson", "slide_id": lesson.slide_id, "slide_title": lesson.slide_title, "resumed": resumed,
                    "topics": [{"id": t.id, "title": t.title, "concepts": len(t.concepts)} for t in lesson.topics],
                    "progress": pointer.progress(lesson)}

        # ── 3. ready + opening ──
        await _send({"type": "ready", "tutor_session_id": tutor_session_id, "mode": mode, "language": lang, "pace": pace,
                     "teacher_name": teacher, "teacher_avatar_file_id": settings.teacher_avatar_file_id,
                     "learner_name": display_name, "slide_id": lesson.slide_id,
                     "slide_title": lesson.slide_title,
                     "topics": [{"id": t.id, "title": t.title, "concepts": len(t.concepts)} for t in lesson.topics]})
        reached_ready = True

        async def _opening() -> None:
            """Wait for the client's `begin` (held clients only), then open.
            The session clock and the meter start here: nobody pays for, or
            loses demo seconds to, a face that is still downloading."""
            nonlocal started_at, last_activity, meter_task
            if hold_opening:
                try:
                    await asyncio.wait_for(begin_event.wait(), timeout=BEGIN_WAIT_SECONDS)
                except asyncio.TimeoutError:
                    logger.info("tutor socket %s: client never sent begin; opening anyway", tutor_session_id)
            started_at = time.time()
            last_activity = started_at
            if mode == "voice":
                meter_task = asyncio.create_task(_meter())
            # The opening itself is the current task so a barge-in can still cut
            # the greeting; the wait above is not, so a stray tap cannot cancel it.
            _spawn(_open(first=True))

        opening_task = asyncio.create_task(_opening())

        # ── 4. loop ──
        while True:
            idle_limit = MEDIA_IDLE_SECONDS if pointer.phase == sm.MEDIA_TASK else IDLE_SECONDS
            busy = current_task is not None and not current_task.done()
            timeout = float(idle_limit + 60)
            if awaiting_answer_since and not nudged and not busy:
                timeout = min(timeout, max(3.0, NUDGE_SECONDS - (time.time() - awaiting_answer_since)))
            elif busy:
                # A turn is running; look again soon so a question it asks
                # gets its nudge on time.
                timeout = 5.0
            try:
                raw = await asyncio.wait_for(websocket.receive_text(), timeout=timeout)
            except asyncio.TimeoutError:
                busy = current_task is not None and not current_task.done()
                if awaiting_answer_since and not nudged and not busy and time.time() - awaiting_answer_since >= NUDGE_SECONDS - 1:
                    nudged = True
                    last_activity = time.time()
                    _spawn(_nudge())
                    continue
                if time.time() - last_activity < idle_limit:
                    continue
                await _send({"type": "ended", "reason": "idle"})
                break
            now = time.time()
            if now - started_at > max_seconds:
                await _send({"type": "ended", "reason": "limit"})
                break
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                await _send({"type": "error", "message": "Invalid JSON", "fatal": False}); continue
            t = msg.get("type")
            if t == "ping":
                # Keep-alives are not activity: an abandoned tab still idles out.
                busy = current_task is not None and not current_task.done()
                if now - last_activity > idle_limit and not busy:
                    await _cancel_current()
                    await _say(prompts.tpl("idle_end", lang), meta={"kind": "idle_end"})
                    await _send({"type": "ended", "reason": "idle"})
                    break
                await _send({"type": "pong"})
                continue
            if t == "activeness":
                # Once a minute from the client; a faster sender is not written through.
                if now - last_activeness_write >= 20 or msg.get("final"):
                    last_activeness_write = now
                    svc.set_activeness(tutor_session_id, msg)
                continue
            if t == "avatar_diag":
                # A handful per lesson from the avatar's device check; not activity.
                if avatar_diag_count < svc.AVATAR_DIAG_MAX:
                    avatar_diag_count += 1
                    svc.add_avatar_diag(tutor_session_id, msg)
                continue
            if t == "presence":
                present = msg.get("present")
                if present is False and away_since is None:
                    away_since = now
                    svc.bump_telemetry(tutor_session_id, away_events=1)
                    # Only the teaching pauses; an open question simply waits
                    # (its nudge restarts when they are back). The server moves on
                    # to the question as soon as the narration TEXT is sent, while
                    # the learner still hears it for many seconds: `interrupted`
                    # = the device cut the teacher off mid-speech, so it is teaching.
                    teaching = pointer.phase in (sm.TEACH, sm.TOPIC_SUMMARY) or msg.get("interrupted") is True
                    if opened_once and revisit is None and teaching:
                        await _cancel_current()
                        _spawn(_away())
                    else:
                        awaiting_answer_since = None
                    continue
                if present is True and away_since is not None:
                    was_teaching = paused_for_away
                    paused_for_away = False
                    away_since = None
                    last_activity = now
                    if was_teaching:
                        await _cancel_current()
                        _spawn(_welcome_back())
                    elif pointer.phase in (sm.AWAIT_ANSWER, sm.REMEDIATE, sm.PREDICT) or (revisit and revisit.get("current")):
                        awaiting_answer_since, nudged = now, False
                continue
            last_activity = now
            if t in LESSON_MESSAGES:
                # The learner moved the lesson on themselves while "away".
                paused_for_away = False
            if t == "auth":
                continue
            elif t == "begin":
                begin_event.set()
            elif not opened_once and t in LESSON_MESSAGES:
                # A tap before the teacher has spoken: the device is ready, so
                # open now; the tap itself raced the opening and is dropped.
                begin_event.set()
            elif t == "config":
                if isinstance(msg.get("avatar"), bool):
                    avatar_active = msg["avatar"]
                    svc.bump_telemetry(tutor_session_id, avatar_on=1 if avatar_active else 0)
                new_pace = msg.get("pace")
                if isinstance(new_pace, str) and new_pace in PACE_MULTIPLIER and new_pace != pace:
                    pace = new_pace
                    _save()
                    await _send({"type": "pace", "pace": pace})
                new_lang = msg.get("language")
                if new_lang in ("en", "hi") and new_lang != lang:
                    lang = new_lang
                    _save()
                    await _emit_state(pointer.phase)
                if isinstance(msg.get("speak"), bool):
                    speak_enabled = msg["speak"] and mode == "voice"
            elif t == "continue":
                await _cancel_current()
                _spawn(_handle_continue())
            elif t == "answer" or t == "ask":
                if not _turn_allowed():
                    await _send({"type": "error", "message": "Too many messages in a row; please slow down.", "fatal": False}); continue
                await _cancel_current()
                text_ = str(msg.get("text") or "")[:2000]
                _spawn(_handle_learner_text(text_, spoken=False) if t == "answer" else _handle_doubt(text_))
            elif t == "control":
                await _cancel_current()
                intent = str(msg.get("intent") or "")
                _spawn(_handle_learner_text(intent if intent in ("repeat", "skip", "slower", "faster", "done", "pause", "resume") else "", spoken=False))
            elif t == "audio_chunk":
                data = msg.get("data") or ""
                if data:
                    heard_audio = True
                    try:
                        audio_buffer.extend(base64.b64decode(data))
                    except Exception:  # noqa: BLE001
                        await _send({"type": "error", "message": "Invalid base64 audio data", "fatal": False})
            elif t == "audio_end":
                if not audio_buffer:
                    await _send({"type": "audio_end", "reason": "no_audio"}); continue
                if not _turn_allowed():
                    audio_buffer.clear()
                    await _send({"type": "audio_end", "reason": "rate_limited"})
                    await _send({"type": "error", "message": "Too many messages in a row; please slow down.", "fatal": False}); continue
                await _cancel_current()
                audio = bytes(audio_buffer); audio_buffer.clear()
                _spawn(_run_audio_turn(audio, msg.get("mime") or "audio/wav"))
            elif t == "audio_discard":
                audio_buffer.clear()
            elif t == "interrupt":
                await _cancel_current()
            elif t == "next_slide":
                await _cancel_current()
                sid = str(msg.get("slide_id") or "")
                try:
                    lesson, pointer, resumed = svc.switch_slide(tutor_session_id=tutor_session_id, user_id=user_id,
                                                                package_session_id=package_session_id, slide_id=sid)
                    svc.note_start_progress(tutor_session_id, lesson.slide_id, pointer.done)
                    board = []
                    pending = None
                    revisit = None
                    revisited.clear()
                    await _send(_lesson_frame())
                    _spawn(_open(first=False))
                except LookupError as e:
                    await _send({"type": "error", "message": str(e), "fatal": False})
            elif t == "end_session":
                await _cancel_current()
                summary = svc.end_session(tutor_session_id=tutor_session_id, user_id=user_id, package_session_id=package_session_id,
                                          lesson=lesson, pointer=pointer)
                await _send({"type": "summary", "data": summary})
                # The model-written rolling summary (design §6.6) is rewritten
                # after the socket closes; the next greeting speaks its first line.
                if summary.get("transitioned"):
                    _fire_and_forget(rewrite_rolling_summary(**_summary_args()))
                break
            else:
                await _send({"type": "error", "message": f"Unknown message type: {t}", "fatal": False})
    except WebSocketDisconnect:
        logger.info("tutor socket disconnected %s", tutor_session_id)
    except Exception as e:  # noqa: BLE001
        logger.exception("tutor socket error %s", tutor_session_id)
        try:
            await websocket.send_json({"type": "error", "message": str(e)[:200], "fatal": True})
        except Exception:  # noqa: BLE001
            pass
    finally:
        if current_task and not current_task.done():
            current_task.cancel()
        if opening_task is not None and not opening_task.done():
            opening_task.cancel()
        if meter_task is not None and not meter_task.done():
            meter_task.cancel()
        try:
            owner = svc.session_owner(tutor_session_id)
            if owner is not None and owner["status"] == "ACTIVE":
                ts_status = "ABANDONED" if reached_ready else "ENDED"
                res = svc.end_session(tutor_session_id=tutor_session_id, user_id=owner["user_id"],
                                      package_session_id=owner["package_session_id"],
                                      lesson=None, pointer=None, status=ts_status)
                if res.get("transitioned") and _summary_args is not None and reached_ready:
                    _fire_and_forget(rewrite_rolling_summary(**_summary_args()))
        except Exception:  # noqa: BLE001
            pass


__all__ = ["router"]
