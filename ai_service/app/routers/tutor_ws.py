"""Live AI Tutor — learner runtime: REST to start/end a session, WebSocket to
teach (design §6). Builds on the voice-call socket's audio pipeline by import.

Protocol (client → server): auth{token, hold?, caps?} FIRST, then config{language?,speak?},
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
from ..services.tutor.runtime.decision import append_bridge, bridge_target, run_predict, run_turn, run_warmup_ack
from ..services.tutor.runtime.intents import detect_intent
from ..services.tutor.runtime import prompts
from ..services.tutor.runtime.revisit import fresh_check
from ..services.tutor.runtime.summary import rewrite_rolling_summary
from ..services.tutor import languages as tutor_langs
from ..services.tutor import voice_cache
from ..services.tutor.runtime.settings import TutorSettings, resolve_settings
from ..services import spatius_service
from ..services.tutor.slide_source import package_belongs_to_institute
from ..services.voice_tts import (
    SARVAM_DEFAULT_FEMALE, SMALLEST_DEFAULT_VOICE, sarvam_speaker, smallest_available,
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


# ── natural teaching: the warm-up (pure helpers) ─────────────────────────────

def warmup_gate(*, fresh: bool, style: Optional[str], plan_kind: Optional[str], step_kind: str,
                topic_index: int, concept_index: int, is_demo: bool) -> bool:
    """May this opening start with a warm-up question? A first, fresh open
    (not a resume) of a lesson-style, non-quiz plan whose first step teaches
    concept 1 of topic 1 — a plan that opens on a guess or a media task
    already has its own opener. Never for a demo / guest."""
    return (fresh and not is_demo and (style or "lesson") == "lesson" and (plan_kind or "lesson") != "quiz"
            and step_kind == "teach" and topic_index == 0 and concept_index == 0)


def warmup_command(text_: str, intent: Optional[str], *, from_control: bool) -> Optional[str]:
    """During the warm-up, is this a command rather than the answer? Short
    answers are exactly where the intent patterns fire ("again and again",
    "slow and fast"), so only a control button or an utterance that is ONE
    command word counts. Returns repeat / slower / faster / pause / skip, or
    None: the text is the answer (a doubt included)."""
    if from_control:
        if intent in ("repeat", "slower", "faster", "pause"):
            return intent
        return "skip" if intent in ("skip", "resume", "done") else None
    words = (text_ or "").split()
    if len(words) != 1:
        return None
    if words[0].lower().strip(" .!।,") in SHORT_OK:
        return "skip"
    if intent in ("repeat", "slower", "faster", "pause"):
        return intent
    if intent in ("skip", "resume", "done"):
        return "skip"
    return None


def warmup_wait_seconds(mode: str) -> float:
    return float(WARMUP_WAIT_VOICE_SECONDS if mode == "voice" else WARMUP_WAIT_TEXT_SECONDS)


def audio_arriving(buffered_bytes: int, last_audio_at: float, now: float) -> bool:
    """A recording is in progress: never move on under the learner's voice."""
    return buffered_bytes > 0 or (now - last_audio_at) < AUDIO_ACTIVE_GRACE_SECONDS


def client_supports_warmup(auth_frame: dict) -> bool:
    """Does this client bundle know the warm-up (its card, its phone pane, its
    transcript)? Bundles cached from before it do not advertise `caps`, and
    get the ordinary opening even on a natural-teaching course."""
    caps = auth_frame.get("caps") if isinstance(auth_frame, dict) else None
    return isinstance(caps, list) and "warmup" in caps


def estimated_speech_seconds(text_: str, pace: float = 1.0) -> float:
    """Roughly how long the client takes to PLAY a line: `_speak` sends audio
    as fast as the socket takes it, so a silence clock started at send time
    would be most of the way through before the learner has heard the line."""
    n = len(" ".join((text_ or "").split()))
    return n / (SPOKEN_CHARS_PER_SECOND * max(0.5, float(pace or 1.0)))

MEDIA_IDLE_SECONDS = 30 * 60
# Every learner utterance is one model call; bound what a runaway client (or
# a script with the learner's token) can spend.
MAX_TURNS_PER_MINUTE = 20
MAX_TURNS_PER_SESSION = 400
LANG_TO_STT = tutor_langs.LOCALES
# Pace, segmentation and cache keys are shared with the voice warm-up (runtime/speech.py).
from ..services.tutor.runtime.speech import (  # noqa: E402
    DEFINITION_PACE, PACE_MULTIPLIER, PACE_ORDER, TUTOR_SEGMENT_MAX_CHARS, cache_key as _cache_key, spoken_form as _spoken_form, effective_pace,
    step_pace as _step_pace, tutor_segments as _tutor_segments, NAME_TOKEN,
)
QUESTION_BEAT_MS = 450
# Silence recovery: a nudge (hint) after this long on an open question; the
# idle exit then counts from the nudge.
NUDGE_SECONDS = 60
# Natural teaching's warm-up question waits much less than a graded one: it
# is a one-line opinion, and nothing is lost by moving on.
WARMUP_WAIT_VOICE_SECONDS = 15
WARMUP_WAIT_TEXT_SECONDS = 40
# Microphone audio this recent means the learner is still talking.
AUDIO_ACTIVE_GRACE_SECONDS = 4.0
# How often the socket looks at the warm-up clock while it is open.
WARMUP_POLL_SECONDS = 2.0
# Spoken rate at pace 1.0 for the playback estimate (≈ 150 words a minute in
# English; Indic scripts run a little faster per character — a slight
# over-estimate only makes the warm-up wait a little longer).
SPOKEN_CHARS_PER_SECOND = 14.0
# "Okay"-type replies that mean "go on", not an answer.
SHORT_OK = ("ok", "okay", "yes", "haan", "हाँ", "ji", "जी", "hmm", "sure", "next", "fine")
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
    language: Optional[str] = Field(default=None, pattern=r"^(en|hi|bn|kn)$")


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
        "languages": settings.language_pair,
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
        warmup_client = client_supports_warmup(first)
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
        lang = ctx["language"] if tutor_langs.is_supported(ctx["language"]) else settings.course_language
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
        # Natural teaching: the arm frozen on the session when it was created
        # (summary_json.natural), never re-resolved here; never for a demo.
        natural = bool(ctx.get("natural", False)) and not is_demo
        # This learner already had an opening of this slide that could warm up
        # (an earlier session): eligibility counts once per (learner, slide)
        # in both arms, so an abandoned warm-up is not offered (or counted) again.
        warmup_seen = bool(ctx.get("warmup_seen", False))
        # The warm-up question in progress (socket-local, never persisted):
        # {step, question, lang, topic, answers, coached, asked}. While it is
        # set the pointer stays unsaved, so a refresh simply opens fresh again.
        # `asked`: the question has gone out (its card is on screen).
        warmup: Optional[Dict[str, Any]] = None
        # When the audio sent so far will have finished playing on the client
        # (an estimate): the warm-up's silence clock starts there.
        speech_until = 0.0
        # After the warm-up the teacher has already greeted: the first
        # concept's own "Hi {name}, …" is dropped once.
        strip_greeting_once = False
        # When the last microphone chunk arrived (the warm-up never moves on
        # under the learner's voice).
        last_audio_at = 0.0
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
            if warmup is not None and awaiting_answer_since is not None:
                # The warm-up's short wait counts from when the learner has
                # HEARD the question, and never runs while they are away.
                awaiting_answer_since = None if away_since is not None else max(awaiting_answer_since, speech_until)
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
            return text_.replace("{student_name}", display_name or tutor_langs.UNNAMED_LEARNER.get(lang, "there"))

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
                voice = tutor_langs.tutor_voice_for(tts_provider, tts_voice, lang)
            # `text_` still carries {student_name}: the sentence with the name
            # is its own segment (voiced for this learner), every other
            # segment is the same audio for all learners — prepared at compile
            # time or cached from an earlier lesson.
            for segment, first_idx, n_sent in _tutor_segments(text_, isolate=NAME_TOKEN):
                segment = _personalize(segment)
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
                        pace=seg_pace, fallback_voice=SARVAM_DEFAULT_FEMALE,
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
            nonlocal speech_until
            raw = text_
            text_ = _personalize(text_)
            transcript.append({"role": "teacher", "text": text_})
            svc.append_transcript(chat_session_id, "assistant", text_, meta)
            await _send({"type": "ai_text", "text": text_, "meta": meta or {}})
            sent_at = time.time()
            if beat and speak_enabled:
                # A breath before a question, so it lands as a question.
                await _send({"type": "beat", "ms": QUESTION_BEAT_MS})
            await _speak(raw)
            if speak_enabled and text_.strip():
                # The client plays its queue in order: this line ends after the
                # ones before it, and never before its own audio was sent.
                played = (QUESTION_BEAT_MS / 1000.0 if beat else 0.0) + estimated_speech_seconds(text_, _effective_pace())
                speech_until = max(max(sent_at, speech_until) + played, time.time())
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
            if warmup is not None:
                await _warmup_silence()
                return
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
            await _say(prompts.tpl(f"nudge_{how}hint", nl, vary=natural, hint=hint) if hint
                       else prompts.tpl(f"nudge_{how}open", nl, vary=natural),
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
                await _say(prompts.tpl("revisit_done_topic" if stage == "topic" else "revisit_done_slide", lang, vary=natural),
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
            nonlocal pointer, board, pending, strip_greeting_once
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
                await _say(prompts.tpl("predict_intro", lang, vary=natural, question=q), meta={"kind": "predict_ask", "concept_id": step.concept.id if step.concept else None}, beat=True)
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
                    # The pointer is already saved at this concept's TEACH phase:
                    # a barge-in or Continue during the greeting must teach it,
                    # never jump to its check (after_teach) before it was taught.
                    pending = (step, None)
                    await _say(greeting, meta={"kind": "greet"})
                    pending = None
                board = board + list(step.board_ops)
                await _send({"type": "board", "clear": False, "ops": step.board_ops, "topic_id": step.topic.id if step.topic else None,
                             "concept_id": step.concept.id if step.concept else None})
                svc.bump_telemetry(tutor_session_id, concepts_taught=1)
                narration = step.concept.narration(lang)
                # Compiled first concepts often open with their own "Hi {name},
                # …": when the teacher has a greeting of her own (welcome back,
                # next slide, the warm-up), drop the narration's, never hers.
                strip_now = strip_greeting_once and step.kind == "teach"
                if step.kind == "teach":
                    strip_greeting_once = False
                if greeting or strip_now:
                    # (The extended greeting words are natural teaching's; the
                    # off arm strips exactly what it always did.)
                    narration = prompts.strip_leading_greeting(narration, extended=natural)
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
                await _say(recap or prompts.tpl("topic_summary", lang, vary=natural, topic=step.topic.title if step.topic else ""),
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
            nonlocal board, opened_once, revisit, pending
            revisit = None
            # Before opened_once flips: a first, fresh (not resumed) open.
            fresh = first and not opened_once and not resumed
            # What the teacher says about last time: the model-written line
            # from the previous session's summary, else just the weak count.
            weak_n = len(state.get("weak_concepts_json") or [])
            summary = (prompts.strip_leading_greeting(ctx.get("resume_line") or "", extended=natural).strip()
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
                greet = prompts.tpl("next_slide", lang, vary=natural, slide=_slide_name())
            opened_once = True
            step = sm.enter(lesson, pointer)
            eligible = warmup_gate(fresh=fresh and not warmup_seen, style=lesson.style,
                                   plan_kind=getattr(lesson, "kind", "lesson"), step_kind=step.kind,
                                   topic_index=step.pointer.topic, concept_index=step.pointer.concept, is_demo=is_demo)
            if eligible:
                # Both arms: the comparison is over openings that COULD warm up
                # (once per learner and slide: see warmup_seen).
                svc.bump_telemetry(tutor_session_id, warmup_eligible=1)
            if eligible and natural and not warmup_client:
                # A bundle cached from before the warm-up: the ordinary opening.
                svc.bump_telemetry(tutor_session_id, warmup_unsupported_client=1)
            if eligible and natural and warmup_client:
                if previous_slide and previous_slide.get("slide_title"):
                    short = prompts.tpl("greet_returning_short", lang, name=display_name, slide=_slide_name(),
                                        previous=previous_slide["slide_title"], summary=summary)
                else:
                    short = prompts.tpl("greet_short", lang, name=display_name, teacher=teacher, slide=_slide_name())
                await _start_warmup(step, short)
                return
            if step.kind in ("topic_summary", "slide_done", "predict"):
                # Resuming on a summary / a finished slide, or opening on a
                # guess: say the greeting first, then the step's own line.
                if step.kind == "predict":
                    # A fresh pointer sits at TEACH: a Continue during this
                    # greeting would otherwise ask concept 1's check untaught.
                    pending = (step, None)
                await _say(greet, meta={"kind": "greet"})
                if step.kind == "predict":
                    pending = None
            await _apply_step(step, greeting=greet if step.kind in ("teach", "media_task") else None)

        async def _start_warmup(step: sm.Step, greeting: str) -> None:
            """Natural teaching's opener: a short greeting, then one open
            question about the first topic before any board. Nothing is saved:
            the pointer stays the fresh in-memory one until the warm-up ends."""
            nonlocal warmup, awaiting_answer_since, nudged
            nl = _spoken_lang(step.concept)
            topic = (lesson.topics[0].title if lesson.topics else "") or _slide_name()
            question = prompts.tpl("warmup_ask", nl, vary=True, topic=topic)
            # Set BEFORE the first await: a barge-in on the greeting is routed
            # by the warm-up (which asks the question first: `asked` is False).
            warmup = {"step": step, "question": question, "lang": nl, "topic": topic, "answers": [], "coached": False,
                      "asked": False}
            # The silence clock runs from now, so a greeting cut off by a stray
            # tap still gets its question (it cannot fire while the greeting
            # is being spoken: the task is busy).
            awaiting_answer_since, nudged = time.time(), False
            svc.bump_telemetry(tutor_session_id, warmups_offered=1)
            await _emit_state("warmup", step.concept)
            await _say(greeting, meta={"kind": "greet"})
            await _ask_warmup_question()

        async def _ask_warmup_question(*, again: bool = False) -> None:
            """The warm-up question itself: its card, then the spoken line.
            `again`: asked afresh (back from away) — earlier words are dropped."""
            w = warmup
            if w is None:
                return
            if again:
                w["answers"] = []
            # Never counted by the client: no concept id, and a guess-style card.
            await _send({"type": "check", "concept_id": None, "check_type": "open", "prompt": w["question"], "options": [],
                         "remediation": 0, "predict": True, "warmup": True})
            w["asked"] = True
            await _say(w["question"], meta={"kind": "warmup_ask"}, beat=True)
            await _await("answer")

        def _rearm_warmup_clock() -> None:
            """An answer attempt ended without an answer (too short, the
            speech engine failed, a discarded or empty recording): the learner
            was told to try again, so the silence clock starts over."""
            nonlocal awaiting_answer_since, nudged
            if warmup is not None and warmup.get("asked") and away_since is None:
                awaiting_answer_since, nudged = time.time(), False

        async def _finish_warmup(text_: Optional[str], how: str) -> None:
            """End the warm-up: acknowledge the answer (one small model call)
            or move on, then commit concept 1 and teach it. `how`: answered /
            skipped / silent."""
            nonlocal warmup, strip_greeting_once, pending, pointer
            w = warmup
            if w is None:
                return
            step: sm.Step = w["step"]
            nl = w["lang"]
            if text_:
                # Every utterance so far: a second tap that adds words cancels
                # the first call and answers again with the whole thought.
                w["answers"].append(text_)
                ack, usage, fell_back = await run_warmup_ack(
                    institute_id=institute_id, user_id=user_id, model=live_model, teacher=teacher, lang=nl,
                    learner_name=display_name or None, question=w["question"], answer=" ".join(w["answers"])[-300:],
                    topic=w["topic"], first_concept=step.concept.title if step.concept else None,
                    tutor_session_id=tutor_session_id,
                )
                # Not a learner `turn` (that counter decides whether the session
                # is worth a rolling-summary rewrite, and compares the arms) and
                # not a decision `fallback`: the warm-up has its own counters.
                svc.bump_telemetry(tutor_session_id, warmups_answered=1,
                                   llm_prompt_tokens=usage.get("prompt_tokens", 0),
                                   llm_completion_tokens=usage.get("completion_tokens", 0),
                                   warmup_ack_fallbacks=1 if fell_back else 0)
            else:
                ack = prompts.tpl("warmup_move_on", nl, vary=True)
                svc.bump_telemetry(tutor_session_id, **{f"warmups_{'silent' if how == 'silent' else 'skipped'}": 1})
            # No await between clearing the warm-up and the commit: from here
            # on a barge-in lands on `pending` and teaches concept 1.
            warmup = None
            strip_greeting_once = True
            if mode == "voice" and speak_enabled:
                # Concept 1 waits until her reply has PLAYED (the voice client
                # continues by itself): sent at socket speed, its narration and
                # check would be open while the learner still hears the reply,
                # and a word added to the warm-up would be graded as concept 1's
                # answer. `pending` stays set, so Continue — or anything the
                # learner says now — teaches concept 1, never grades it.
                pending = (step, None)
                pointer = step.pointer
                _save()
                await _say(ack, meta={"kind": "warmup_ack"})
                await _await("continue")
                return
            await _commit_then_say(step, None, ack, {"kind": "warmup_ack"})

        async def _warmup_silence() -> None:
            """No answer to the warm-up: in a voice lesson where no audio has
            arrived, explain how to answer once; otherwise move on. Never while
            the learner is away; a question cut off before it went out is asked."""
            w = warmup
            if w is None or away_since is not None:
                return
            if not w.get("asked"):
                await _ask_warmup_question()
                return
            if mode == "voice" and not heard_audio and not w.get("coached"):
                w["coached"] = True
                await _say(prompts.tpl("nudge_voice_open", w["lang"], vary=True), meta={"kind": "nudge"})
                await _await("answer")
                return
            await _finish_warmup(None, "silent")

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

        async def _handle_learner_text(text_: str, *, spoken: bool, force_doubt: bool = False,
                                       from_control: bool = False) -> None:
            """Route a learner utterance: intent → answer → doubt.
            `from_control`: the text is a control button's intent word."""
            nonlocal pointer, pace, lang, pending, state, awaiting_answer_since
            text_ = (text_ or "").strip()
            if not text_:
                _rearm_warmup_clock()
                await _send({"type": "audio_end", "reason": "no_speech"})
                return
            transcript.append({"role": "learner", "text": text_})
            svc.append_transcript(chat_session_id, "user", text_, {"spoken": spoken})
            intent = None if force_doubt else detect_intent(text_)
            phase = pointer.phase
            short_ok = text_.lower().strip(" .!") in SHORT_OK

            # A verdict was interrupted: the learner either wants to go on or
            # has a question about what was just closed.
            if pending is not None:
                step, closed = pending
                if closed is not None:
                    if intent in ("resume", "skip", "repeat", "done") or (intent is None and short_ok):
                        pending = None
                        await _apply_step(step)
                        return
                    await _answer_doubt(text_, closed, spoken=spoken, what_next="continue")
                    return
                # A greeting (or the warm-up's reply) was interrupted before
                # the concept was taught. "Go on" teaches it now; Skip skips it
                # as it always did; anything else (pause, pace, a question, a
                # remark) is handled as usual with `pending` kept, so the next
                # Continue teaches the concept instead of asking its check.
                if intent in ("resume", "repeat", "done") or (intent is None and not force_doubt and short_ok):
                    pending = None
                    await _apply_step(step)
                    return
                if intent == "skip" and not force_doubt:
                    pending = None

            # The warm-up question is open: almost everything is its answer.
            # Nothing here saves the pointer or records an attempt.
            if warmup is not None:
                cmd = None if force_doubt else warmup_command(text_, intent, from_control=from_control)
                wl = warmup["lang"]
                if not warmup.get("asked"):
                    # The learner spoke over the greeting: the question has not
                    # gone out, so nothing said yet can be its answer. Only the
                    # Skip button passes on it; everything else gets the question.
                    if cmd == "skip" and from_control and intent == "skip":
                        await _finish_warmup(None, "skipped"); return
                    if cmd in ("slower", "faster"):
                        pace = _step_pace(pace, -1 if cmd == "slower" else 1)
                        await _send({"type": "pace", "pace": pace})
                        await _say(prompts.tpl(cmd, wl, vary=True), meta={"kind": cmd})
                    elif cmd == "pause":
                        await _say(prompts.tpl("pause", wl, vary=True), meta={"kind": "pause"})
                        # Continue asks the question (see _handle_continue).
                        await _await("continue"); return
                    await _ask_warmup_question(); return
                if cmd == "repeat":
                    await _say(warmup["question"], meta={"kind": "warmup_ask"}, beat=True)
                    await _await("answer"); return
                if cmd in ("slower", "faster"):
                    # Saved with the first concept (a save now would make a refresh "resumed").
                    pace = _step_pace(pace, -1 if cmd == "slower" else 1)
                    await _send({"type": "pace", "pace": pace})
                    await _say(prompts.tpl(cmd, wl, vary=True), meta={"kind": cmd})
                    await _await("answer"); return
                if cmd == "pause":
                    await _say(prompts.tpl("pause", wl, vary=True), meta={"kind": "pause"})
                    await _await("answer")
                    # Paused: no silent move-on; "continue" (or an answer) ends it.
                    awaiting_answer_since = None
                    return
                if cmd == "skip":
                    await _finish_warmup(None, "skipped"); return
                await _finish_warmup(text_, "answered"); return

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
                    await _say(prompts.tpl(intent, lang, vary=natural), meta={"kind": intent})
                    await _await("answer"); return
                if intent == "pause":
                    await _say(prompts.tpl("pause", lang, vary=natural), meta={"kind": "pause"})
                    await _await("answer"); return
                await _handle_revisit_answer(text_, spoken=spoken, kind="doubt" if (intent == "doubt" or force_doubt) else "answer")
                return

            # Predict-then-reveal: any guess (or a skip) leads into the teaching.
            if pointer.phase == sm.PREDICT:
                concept = lesson.concept_at(pointer)
                if concept is None or intent in ("skip", "resume", "done") or (intent is None and short_ok):
                    await _apply_step(sm.after_predict(lesson, pointer)); return
                if intent == "repeat":
                    await _say(prompts.tpl("predict_intro", lang, vary=natural, question=concept.predict_text(lang, lesson.language) or ""), meta={"kind": "predict_ask"}, beat=True)
                    await _await("answer"); return
                if intent == "doubt" or force_doubt:
                    await _answer_doubt(text_, concept, spoken=spoken, what_next="answer"); return
                if intent not in ("slower", "faster", "pause"):
                    say, usage = await run_predict(institute_id=institute_id, user_id=user_id, model=live_model, teacher=teacher,
                                                   lang=lang, learner_name=display_name or None, concept=concept, answer=text_,
                                                   tutor_session_id=tutor_session_id, vary=natural)
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
                await _say(prompts.tpl("skipped", lang, vary=natural), meta={"kind": "skip"})
                await _apply_step(sm.skip(lesson, pointer)); return
            if intent in ("slower", "faster"):
                pace = _step_pace(pace, -1 if intent == "slower" else 1)
                _save()
                await _send({"type": "pace", "pace": pace})
                await _say(prompts.tpl(intent, lang, vary=natural), meta={"kind": intent})
                await _await("continue" if phase in (sm.TEACH, sm.TOPIC_SUMMARY) else "answer"); return
            if intent == "done" and phase == sm.MEDIA_TASK:
                await _apply_step(sm.after_teach(lesson, pointer)); return
            if intent == "pause":
                await _say(prompts.tpl("pause", lang, vary=natural), meta={"kind": "pause"})
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
            # Natural teaching: name the concept an advance would lead into
            # (sm.advance is pure), so the verdict can bridge into it.
            next_concept = bridge_target(sm.advance(lesson, pointer, mark_done=True), lang) if (natural and kind == "answer") else None
            decision, usage = await run_turn(
                institute_id=institute_id, user_id=user_id, model=live_model, teacher=teacher, lang=lang,
                strictness=settings.strictness, learner_name=display_name or None, state=state, lesson=lesson,
                pointer=pointer, board_ops=board, transcript=transcript, learner_message=text_, kind=kind,
                mode="voice" if spoken else "text", tutor_session_id=tutor_session_id, final_attempt=final_attempt,
                source_block=source_block, next_concept=next_concept,
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
                    step = sm.advance(lesson, pointer, mark_done=True)
                    say = decision["say"]
                    if natural:
                        # Spoken after the verdict, only into a new concept.
                        say = append_bridge(say, decision.get("bridge"), action=action, next_kind=step.kind)
                    await _commit_then_say(step, concept, say, {"kind": "evaluate", "score": score})
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
            if warmup is not None:
                # Continue on the warm-up question = "no answer, let's start"
                # (the fresh pointer sits at TEACH: after_teach would ask
                # concept 1's check before teaching it). Before the question
                # went out (a Continue on the greeting) it means "go on": ask it.
                if not warmup.get("asked"):
                    await _ask_warmup_question()
                else:
                    await _finish_warmup(None, "skipped")
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
                    _rearm_warmup_clock()
                    await _send({"type": "audio_end", "reason": "no_speech", "detail": f"too_short;{note}"})
                    return
                try:
                    text_ = await sarvam.speech_to_text(audio_bytes=audio, language=_lang_stt(), mime_type=mime)
                except SarvamSTTError as e:
                    _rearm_warmup_clock()
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
            await _say(prompts.tpl("welcome_back", _spoken_lang(), vary=natural), meta={"kind": "welcome_back"})
            if warmup is not None:
                # They stepped away during the warm-up: ask it afresh.
                await _ask_warmup_question(again=True)
            elif pending is None and pointer.phase in (sm.TEACH, sm.MEDIA_TASK, sm.PREDICT, sm.AWAIT_ANSWER, sm.REMEDIATE):
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
                     "topics": [{"id": t.id, "title": t.title, "concepts": len(t.concepts)} for t in lesson.topics],
                     "natural": natural})
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
            # The warm-up waits less than a graded question (natural teaching).
            nudge_after = warmup_wait_seconds(mode) if warmup is not None else NUDGE_SECONDS
            if awaiting_answer_since and not nudged and not busy:
                timeout = min(timeout, max(3.0, nudge_after - (time.time() - awaiting_answer_since)))
            elif busy:
                # A turn is running; look again soon so a question it asks
                # gets its nudge on time.
                timeout = 5.0
            if natural and (warmup is not None or not opened_once):
                # The warm-up's short wait must not sit behind a long receive
                # started before it opened (the client pings only every 25 s).
                timeout = min(timeout, WARMUP_POLL_SECONDS)
            try:
                raw = await asyncio.wait_for(websocket.receive_text(), timeout=timeout)
            except asyncio.TimeoutError:
                busy = current_task is not None and not current_task.done()
                # The warm-up never moves on while the learner is still speaking
                # (a recording in progress); the idle exit below still applies.
                talking = warmup is not None and audio_arriving(len(audio_buffer), last_audio_at, time.time())
                if (awaiting_answer_since and not nudged and not busy and not talking
                        and time.time() - awaiting_answer_since >= nudge_after - 1):
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
                    # The warm-up is an open question (its phase is still TEACH).
                    teaching = warmup is None and (pointer.phase in (sm.TEACH, sm.TOPIC_SUMMARY) or msg.get("interrupted") is True)
                    # The warm-up is still being said (greeting, question) or
                    # answered (the reply's model call): pause it like teaching,
                    # so it never ends — and concept 1 is never taught — while
                    # the learner is away; back, they get the question afresh.
                    warmup_busy = warmup is not None and current_task is not None and not current_task.done()
                    if opened_once and revisit is None and (teaching or warmup_busy):
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
                    elif (pointer.phase in (sm.AWAIT_ANSWER, sm.REMEDIATE, sm.PREDICT) or (revisit and revisit.get("current"))
                          or warmup is not None):
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
                    # During the warm-up nothing is saved (a refresh would read
                    # as "resumed"); the first concept's save carries it.
                    if warmup is None:
                        _save()
                    await _send({"type": "pace", "pace": pace})
                new_lang = msg.get("language")
                if new_lang in settings.language_pair and new_lang != lang:
                    lang = new_lang
                    if warmup is None:
                        _save()
                        await _emit_state(pointer.phase)
                    else:
                        warmup["lang"] = _spoken_lang(warmup["step"].concept)
                        await _emit_state("warmup", warmup["step"].concept)
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
                _spawn(_handle_learner_text(intent if intent in ("repeat", "skip", "slower", "faster", "done", "pause", "resume") else "",
                                            spoken=False, from_control=True))
            elif t == "audio_chunk":
                data = msg.get("data") or ""
                if data:
                    heard_audio = True
                    last_audio_at = now
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
                # "Tap the button and speak when you're ready": a fresh wait.
                _rearm_warmup_clock()
            elif t == "interrupt":
                await _cancel_current()
                # The client stopped her audio: nothing queued is still playing.
                speech_until = min(speech_until, now)
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
                    warmup = None
                    strip_greeting_once = False
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
