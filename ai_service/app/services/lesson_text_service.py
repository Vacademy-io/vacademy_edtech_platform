"""Resolve the text of the lesson the learner has open, for the learner chatbot.

Why this exists
---------------
The learner app builds `context_meta` client-side and only has text for some
slide types. Measured over 30 days of learner chats (2026-10-22): every VIDEO
session reached the tutor with empty content (the app sends the video's
description, which is almost always blank), and SCORM, AI video (HTML_VIDEO),
audio, PPT decks (the app sends the deck's S3 URL) and drawings carried
nothing readable either. The tutor then answered from the slide title or told
the learner it could not see the lesson.

The course-knowledge readers (course_knowledge/extract) already get text out of
every one of these for free and cache it (SCORM pages, YouTube captions through
the shared caption service, AI-video narration, deck manifests, drawing text,
transcripts somebody already paid for). This service reuses them for the one
lesson the learner has open, independent of the course-knowledge gate: reading
the open lesson is not course search.

Constraints (same as slide_text_service, the PDF counterpart):
1. Additive only. `content` changes only when there is real lesson text; with
   none (not read yet, nothing readable, a read that failed) the context is
   exactly what it was before this service existed.
2. The request path does a scoped lookup, describe_slides for that one lesson
   and one indexed cache read, all on the session it is given and inside a
   SAVEPOINT. Anything that touches the network runs on a bounded background
   task with its own sessions.
3. Free only: extract() is called without a PaidPermit, so nothing here ever
   transcribes a recording or OCRs a slide. Such text arrives only when the
   tutor or course knowledge already paid for it (their caches are read first).
4. A chat turn that misses the cache may wait briefly for the in-flight read
   (`wait_for_text`) — only after its DB session is released.

Handled here: SCORM, VIDEO (YouTube captions; uploads only with a cached
transcript), AUDIO, HTML_VIDEO, and DOCUMENT PPT_ANIM / PRESENTATION. PDFs keep
their own path (slide_text_service); DOC/CODE/HTML and question slides already
arrive with their text.
"""
from __future__ import annotations

import asyncio
import contextlib
import logging
import time
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Sequence, Tuple

from sqlalchemy import text
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

# file_conversion rows this service writes: the prompt text of one lesson at one
# content hash. vendor_file_id = "<slide_id>:<content_hash>", so a re-published
# lesson is read again. An empty html_text means "read, nothing to show".
LESSON_TEXT_VENDOR = "lesson_chat_text"

# What reaches the prompt. A video or SCORM is a whole lesson, so a little more
# room than a PDF slide's 4000.
MAX_PROMPT_CHARS = 6000

MAX_CONCURRENT_READS = 2
_semaphore = asyncio.Semaphore(MAX_CONCURRENT_READS)

# One read never holds a slot longer than this (the caption service's batch
# pool may otherwise wait minutes for its own slot); it is retried later.
READ_TIMEOUT_SECONDS = 60.0

# Reads queued or running at once; past this, new lessons are not read until
# the queue drains (the turn simply goes on without lesson text).
MAX_IN_FLIGHT = 50

# How long a chat turn waits for a first read before answering without it.
# Well inside the app's 45 s stuck-turn watchdog, with room for the model.
TURN_WAIT_SECONDS = 8.0

# In-flight reads by cache key: N learners on one lesson trigger one read, and a
# turn can await the read its own context lookup started.
_in_flight: Dict[str, asyncio.Task] = {}

# Results of finished reads, in process, so a read that finished while the turn
# was still in its DB block, or one whose result is not cached in the DB
# (a recording nobody has transcribed yet), is not read again on every turn.
_recent: Dict[str, Tuple[float, str]] = {}
_RECENT_MAX = 2000
_RECENT_SECONDS = 10 * 60

# Reads that failed (network, caption service busy, timeout), with when, so a
# broken lesson is not fetched again on every turn. Retried after _RETRY_SECONDS.
_failed: Dict[str, float] = {}
_FAILED_MAX = 2000
_RETRY_SECONDS = 30 * 60

_SOURCE_TYPES = ("SCORM", "VIDEO", "AUDIO", "HTML_VIDEO")
_DOC_TYPES = ("PPT_ANIM", "PRESENTATION")

# What the tutor is told each text is.
_HEADINGS = {
    "captions": "Video transcript (captions)",
    "transcript": "Transcript",
    "script": "Narration script",
    "deck": "Slide text",
    "drawing": "Text on the drawing",
    "scorm": "Lesson content",
}

# SECURITY GATE and router in one indexed read: context_meta is client-supplied,
# so the slide id is attacker-controllable. Only a slide that sits in a course of
# THIS session's institute resolves; anything else changes nothing.
_LESSON_SQL = text(
    """
    SELECT sl.source_type, d.type
    FROM slide sl
    LEFT JOIN document_slide d ON sl.source_type = 'DOCUMENT' AND d.id = sl.source_id
    JOIN chapter_to_slides cts
        ON cts.slide_id = sl.id AND cts.status <> 'DELETED'
    JOIN chapter_package_session_mapping cpsm
        ON cpsm.chapter_id = cts.chapter_id AND cpsm.status <> 'DELETED'
    JOIN package_session ps ON ps.id = cpsm.package_session_id
    JOIN package_institute pi ON pi.package_id = ps.package_id
    WHERE sl.id = :slide_id
      AND sl.status <> 'DELETED'
      AND pi.institute_id = :institute_id
    LIMIT 1
    """
)

_CACHE_GET_SQL = text(
    """
    SELECT html_text FROM file_conversion
    WHERE vendor_file_id = :k AND vendor = :v AND status = 'SUCCESS' AND html_text IS NOT NULL
    ORDER BY created_at DESC
    LIMIT 1
    """
)


@contextlib.contextmanager
def _savepoint(db: Session):
    """Run reads on the caller's session inside a SAVEPOINT. The session is
    the chat turn's own: a failed statement would otherwise abort its whole
    transaction, and every later query of the turn (settings, history, KB
    search) would fail with it. Sessions without savepoints run as they are."""
    begin_nested = getattr(db, "begin_nested", None)
    if begin_nested is None:
        yield
        return
    with begin_nested():
        yield


def _same_title(a: Any, b: Any) -> bool:
    norm = lambda v: " ".join(str(v or "").split()).casefold()  # noqa: E731
    return bool(norm(a)) and norm(a) == norm(b)


@dataclass
class Lesson:
    """The open lesson, as course knowledge describes it."""
    ref: Any                         # course_knowledge SlideRef
    # What the app sent as the lesson's own description (videos and audio
    # only); kept above the transcript so nothing on the page is lost.
    description: str = ""

    @property
    def slide_id(self) -> str:
        return self.ref.slide_id

    @property
    def type_label(self) -> str:
        return (self.ref.doc_type if self.ref.source_type == "DOCUMENT" else self.ref.source_type) or "DOCUMENT"

    @property
    def cache_key(self) -> str:
        return f"{self.ref.slide_id}:{self.ref.content_hash}"[:255]

    @property
    def needs_read(self) -> bool:
        """False for lessons whose text sits in the DB row (an audio transcript,
        an inline drawing): no network, so no cache either."""
        return self.ref.pointer_kind != "inline"

    @property
    def keeps_description(self) -> bool:
        return self.ref.source_type in ("VIDEO", "AUDIO")


def find_lesson(
    db: Session, slide_id: Optional[str], institute_id: Optional[str], slide_name: Optional[str],
) -> Optional[Lesson]:
    """The open lesson when it is in this institute, of a kind handled here, and
    really the slide the app is showing.

    `slide_name` is the title the app sent with the same context. The app can
    send the previous slide's id for a moment while it navigates (the id comes
    from the URL, the name from the slide on screen); a lesson whose title does
    not match is not used, so one slide's text never lands on another."""
    if not slide_id or not institute_id or not str(slide_name or "").strip():
        return None
    try:
        with _savepoint(db):
            row = db.execute(_LESSON_SQL, {"slide_id": str(slide_id), "institute_id": institute_id}).first()
            if row is None:
                return None
            source_type, doc_type = (row[0] or "").upper(), (row[1] or "").upper()
            if source_type not in _SOURCE_TYPES and not (source_type == "DOCUMENT" and doc_type in _DOC_TYPES):
                return None
            from .course_knowledge.extract.describe import describe_slides
            refs = describe_slides(db, [str(slide_id)])
    except Exception as exc:  # noqa: BLE001 - fail closed: the turn goes on as before
        logger.warning("lesson lookup failed for %s: %s", slide_id, exc)
        return None
    if not refs or refs[0].pointer_kind == "none":
        return None              # nothing published, or an external link (Vimeo, Jupyter…)
    if not _same_title(refs[0].title, slide_name):
        logger.info("lesson text: slide %s is not the slide on screen; not used", slide_id)
        return None
    return Lesson(ref=refs[0])


def _mmss(ms: Optional[int]) -> str:
    s = max(0, int(ms or 0) // 1000)
    return f"{s // 3600}:{s // 60 % 60:02d}:{s % 60:02d}" if s >= 3600 else f"{s // 60}:{s % 60:02d}"


def _as_prompt_text(segments: Sequence, kind: str) -> str:
    """Segments as tutor text: timed lines as [m:ss], slides under 'Slide N'."""
    parts: List[str] = []
    timed = 0
    for seg in segments or []:
        body = (getattr(seg, "text", "") or "").strip()
        if not body:
            continue
        anchor = getattr(seg, "anchor", "none")
        if anchor == "time" and getattr(seg, "t_start_ms", None) is not None:
            parts.append(f"[{_mmss(seg.t_start_ms)}] {body}")
            timed += 1
        elif anchor == "step" and getattr(seg, "label", None):
            parts.append(f"{seg.label}:\n{body}")
        else:
            parts.append(body)
    heading = _HEADINGS.get(kind, "Lesson content")
    body = "\n\n".join(parts).strip()
    if not body:
        return ""
    if len(body) > MAX_PROMPT_CHARS and timed == len(parts) and len(parts) > 1:
        # A long recording: evenly spaced excerpts cover the whole video (an
        # hour of captions is ~50k chars), where the first 6000 would stop
        # five minutes in. The time stamps show the gaps.
        keep = max(1, MAX_PROMPT_CHARS * len(parts) // len(body))
        step = len(parts) / keep
        body = "\n\n".join(parts[int(i * step)] for i in range(keep))[:MAX_PROMPT_CHARS]
        heading += ", excerpts spread across the whole recording"
    elif len(body) > MAX_PROMPT_CHARS:
        body = body[:MAX_PROMPT_CHARS] + "\n[...the rest of this lesson is not shown]"
    return f"{heading}:\n{body}"


def _content_segments(lesson: Lesson, ext) -> list:
    """The extraction minus the title/description head extract() adds to every
    lesson (that alone is not lesson content)."""
    from .course_knowledge.extract.registry import title_segment
    segs = list(ext.segments or [])
    head = title_segment(lesson.ref)
    if head is not None and segs and segs[0].anchor == "none" and segs[0].text == head.text:
        segs = segs[1:]
    return segs


def apply(context_data: Dict[str, Any], lesson: Lesson, lesson_text: str) -> None:
    """Put real lesson text into the context. Does nothing without text, so the
    context stays exactly what the app sent (and the existing paths made of it)."""
    if not (lesson_text or "").strip():
        return
    parts = [p for p in (lesson.description.strip(), lesson_text.strip()) if p]
    context_data["content"] = "\n\n".join(parts)
    context_data["type"] = lesson.type_label


def _recent_text(key: str) -> Optional[str]:
    hit = _recent.get(key)
    if hit is None:
        return None
    if time.monotonic() - hit[0] > _RECENT_SECONDS:
        _recent.pop(key, None)
        return None
    return hit[1]


def _remember(key: str, body: str) -> None:
    if len(_recent) >= _RECENT_MAX:
        _recent.clear()
    _recent[key] = (time.monotonic(), body)


def cached_text(db: Session, lesson: Lesson) -> Tuple[bool, str]:
    """(known, text) without touching the network.

    known=False: not read yet, so schedule_read() should run. known=True with
    empty text: read, and it has nothing the tutor can use."""
    if not lesson.needs_read:
        segs = [s for s in lesson.ref.inline_segments if (s.text or "").strip()]
        kind = str(lesson.ref.extras.get("text_kind") or "")
        return True, _as_prompt_text(segs, kind)
    recent = _recent_text(lesson.cache_key)
    if recent is not None:
        return True, recent
    try:
        with _savepoint(db):
            row = db.execute(_CACHE_GET_SQL, {"k": lesson.cache_key, "v": LESSON_TEXT_VENDOR}).first()
    except Exception as exc:  # noqa: BLE001 - a miss, never an error
        logger.warning("lesson text cache read failed for %s: %s", lesson.slide_id, exc)
        return False, ""
    if row is None:
        return False, ""
    return True, row[0] or ""


def _recently_failed(key: str) -> bool:
    at = _failed.get(key)
    if at is None:
        return False
    if time.monotonic() - at > _RETRY_SECONDS:
        _failed.pop(key, None)
        return False
    return True


def _remember_failure(key: str) -> None:
    if len(_failed) >= _FAILED_MAX:
        _failed.clear()
    _failed[key] = time.monotonic()


def schedule_read(lesson: Lesson) -> None:
    """Fire-and-forget free read of the lesson. Never raises into the request path."""
    if not lesson.needs_read:
        return
    key = lesson.cache_key
    if key in _in_flight or _recent_text(key) is not None or _recently_failed(key):
        return
    if len(_in_flight) >= MAX_IN_FLIGHT:
        return
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return
    task = loop.create_task(_read(lesson, key))
    _in_flight[key] = task
    task.add_done_callback(lambda _t, k=key: _in_flight.pop(k, None))


def _store(key: str, slide_id: str, body: str) -> None:
    from ..db import background_db_session
    from ..models.file_conversion import FileConversionRepository
    with background_db_session() as db:
        if db.execute(_CACHE_GET_SQL, {"k": key, "v": LESSON_TEXT_VENDOR}).first() is None:
            FileConversionRepository(db).store_success(
                vendor_file_id=key, vendor=LESSON_TEXT_VENDOR, file_id=slide_id, html=body, file_type="text",
            )


def _definitive(ext) -> bool:
    """Worth caching in the DB: READY, or EMPTY / UNSUPPORTED that will not
    change on their own. A caption outcome flagged transient (captions switched
    off, no fallback route) or unconfirmed may read differently later."""
    if ext.status == "READY":
        return True
    if ext.status not in ("EMPTY", "UNSUPPORTED"):
        return False
    detail = ext.detail or {}
    return not (detail.get("caption_transient") or detail.get("caption_unconfirmed"))


async def _read(lesson: Lesson, key: str) -> str:
    """Free pass of the course-knowledge reader for this lesson.

    Definitive results are cached in the DB; every finished read is remembered
    in process for _RECENT_SECONDS (so an untranscribed recording is not looked
    up on every turn); FAILED, a timeout or an error is retried after
    _RETRY_SECONDS."""
    try:
        async with _semaphore:
            from .course_knowledge.extract import registry
            ext = await asyncio.wait_for(registry.extract(lesson.ref), READ_TIMEOUT_SECONDS)
            kind = str(lesson.ref.extras.get("text_kind") or ext.text_kind or "")
            body = _as_prompt_text(_content_segments(lesson, ext), kind)
            if ext.status == "FAILED":
                _remember_failure(key)
            else:
                _remember(key, body)
                if _definitive(ext):
                    await asyncio.to_thread(_store, key, lesson.slide_id, body)
            logger.info("lesson text: slide=%s type=%s status=%s chars=%d",
                        lesson.slide_id, lesson.type_label, ext.status, len(body))
            return body
    except asyncio.CancelledError:
        raise
    except Exception as exc:  # noqa: BLE001 - includes the read timeout
        _remember_failure(key)
        logger.warning("lesson text read failed for slide %s: %r", lesson.slide_id, exc)
        return ""


async def wait_for_text(lesson: Lesson, timeout: float = TURN_WAIT_SECONDS) -> str:
    """The lesson text once its read finishes, or "" after `timeout`. Call only
    with no DB session held. The read itself is never cancelled, so a slow
    lesson still lands in the cache for the next turn."""
    recent = _recent_text(lesson.cache_key)
    if recent is not None:
        return recent
    schedule_read(lesson)
    task = _in_flight.get(lesson.cache_key)
    if task is None:
        return _recent_text(lesson.cache_key) or ""
    try:
        return await asyncio.wait_for(asyncio.shield(task), timeout)
    except asyncio.TimeoutError:
        logger.info("lesson text: slide=%s still reading after %.0fs", lesson.slide_id, timeout)
        return ""
    except Exception:  # noqa: BLE001
        return ""


__all__ = [
    "LESSON_TEXT_VENDOR", "MAX_PROMPT_CHARS", "Lesson", "find_lesson", "cached_text", "apply",
    "schedule_read", "wait_for_text",
]
