"""Timed media: YouTube captions (free), AI-video narration (free), and
uploaded video / audio files (paid transcription) — spec §6.5.

YouTube: the legacy course cache row first, then the shared caption service
(services/youtube_captions), which owns its own cache. A transient caption
failure (blocked, busy, timeout) is FAILED, so the indexer retries with
backoff and keeps the last good index; only a definitive answer about the
video (no captions, private, removed, age-restricted) is EMPTY.

With NO fallback route configured (no proxy, no Supadata), a transient
result from YouTube is EMPTY instead (as before the service: retrying from a
blocked server IP within minutes does not help), marked caption_transient so
the caption requeue re-reads it once a fallback works (BUSY, our own
capacity, stays FAILED). A definitive answer nothing could confirm is EMPTY
and marked caption_unconfirmed for the same re-read.

Every text comes back in roughly fixed time windows (Segment anchor time) so
a citation can open the player at that second. Nothing here holds a DB
session across a network call: cache reads and writes open their own short
sessions, and the AI-video row is read in one short session before any
download.

Uploaded files: the course cache (PAID) first, then a transcript the tutor
already paid for (cost 0), else NEEDS_PAID. With a permit the transcript is
made by source_text.transcription_provider(): OpenRouter Whisper with a
hard max_seconds (a longer recording raises DurationExceeded before any
paid call and is re-quoted at its real length), or the render worker, whose
job is resumed across runs exactly like the tutor's (without its billing).
"""
from __future__ import annotations

import asyncio
import json
import logging
import math
import re
import time
from typing import Any, Iterable, List, Optional, Sequence, Tuple

from sqlalchemy import text as sql_text

from ....db import db_session
from ...tutor import source_text
from ...youtube_captions import NOTES, Outcome
from ...youtube_captions import service as yt_service
from . import cache
from .types import Extraction, PaidDelivered, PaidNeed, PaidPermit, Segment, SlideRef, TOOL_TRANSCRIBE_MINUTE

logger = logging.getLogger(__name__)

YOUTUBE_WINDOW_S = 60
AI_VIDEO_WINDOW_S = 45
TRANSCRIPT_WINDOW_S = 60
DEFAULT_UNKNOWN_MINUTES = 10
MAX_WORDS_BYTES = 5 * 1024 * 1024
# How long one worker run waits on a render-worker transcription job before
# handing the lesson back as PENDING (the job keeps running and is resumed).
RENDER_WAIT_SECONDS = 90

# The pre-service note: blocked and caption-less videos both got it, so the
# caption requeue (caption_requeue.py) selects lessons still carrying it.
LEGACY_NO_CAPTIONS_NOTE = "YouTube did not share captions: add a description or upload the video"
NO_CAPTIONS_NOTE = NOTES[Outcome.NO_CAPTIONS]
NO_SPEECH_NOTE = "The recording has no clear speech (music or silence): add what this lesson teaches"
NO_FALLBACK_NOTE = ("YouTube didn't give us the captions (it is blocking our server). Add what this lesson "
                    "teaches or upload the video; the captions are read again once access is restored.")
OVER_APPROVED_NOTE = "Over the approved amount"
# A transcript the speech check rejected is kept under its own pointer kind (never
# read as the lesson's text) so an admin who knows the recording does have speech
# can use it without paying for a second transcription (kept_transcript.py).
HELD_POINTER_KIND = "held_file"


# ── time windows ─────────────────────────────────────────────────────────────

def _clock(seconds: float) -> str:
    s = max(0, int(seconds))
    h, rem = divmod(s, 3600)
    m, sec = divmod(rem, 60)
    return f"{h}:{m:02d}:{sec:02d}" if h else f"{m}:{sec:02d}"


def time_windows(items: Iterable[Tuple[float, float, str]], window_s: float, joiner: str = " ") -> List[Segment]:
    """Group timed pieces (start s, end s, text) into ~window_s windows; a
    window closes at the first piece that starts window_s after it opened."""
    out: List[Segment] = []
    cur: List[str] = []
    start: Optional[float] = None
    end = 0.0
    last_norm, last_end = None, None
    for s, e, t in sorted(((float(a), float(b), str(c)) for a, b, c in items if str(c or "").strip()),
                          key=lambda x: x[0]):
        norm = _norm_piece(t)
        if norm and norm == last_norm and last_end is not None and s - last_end <= LOOP_GAP_S:
            # Speech-to-text stuck in a loop (chanting, music) repeats the same piece
            # back to back; a refrain said again later is kept.
            end = max(end, e, s)
            last_end = max(last_end, e, s)
            continue
        last_norm, last_end = norm, max(e, s)
        if start is not None and s - start >= window_s and cur:
            out.append(_window(start, end, cur, joiner))
            cur, start = [], None
        if start is None:
            start = s
        cur.append(t.strip())
        end = max(end, e, s)
    if cur and start is not None:
        out.append(_window(start, end, cur, joiner))
    return out


def _norm_piece(text: str) -> str:
    return " ".join(re.sub(r"[^\w\s]", " ", text or "").lower().split())


# A phrase (6-160 chars) said 3+ times in a row: keep it once. Transcribers loop on
# chanting and music ("tasya sanjanayan harsham ..." x40 on a pilot shloka video).
LOOP_GAP_S = 3.0   # identical pieces closer than this are one transcriber loop
_REPEAT_RUN_RE = re.compile(r"(\S.{5,159}?)(?:[\s,.;:!?।|-]+\1){2,}", re.DOTALL)


def collapse_repeats(text: str) -> str:
    """Collapse runs of the same phrase repeated 3+ times into one occurrence."""
    prev = None
    out = text or ""
    while prev != out:            # nested runs collapse in a few passes
        prev, out = out, _REPEAT_RUN_RE.sub(r"\1", out)
    return out


def _window(start: float, end: float, parts: List[str], joiner: str) -> Segment:
    return Segment(text=collapse_repeats(joiner.join(parts).strip()), anchor="time", t_start_ms=int(round(start * 1000)),
                   t_end_ms=int(round(max(end, start) * 1000)), label=_clock(start))


# ── YouTube ──────────────────────────────────────────────────────────────────

async def extract_youtube(ref: SlideRef) -> Extraction:
    vid = ref.pointer_key or ""
    hit = await asyncio.to_thread(cache.get, "youtube", vid)      # legacy course row
    if hit is not None and hit.segments:
        return Extraction(ref.slide_id, "captions", segments=hit.segments, status="READY")
    url = str(ref.extras.get("url") or f"https://www.youtube.com/watch?v={vid}")
    result = await yt_service.get_captions(vid or url, purpose="course_knowledge")
    detail = {"caption_outcome": result.outcome.value, "caption_route": result.route}
    if result.outcome is Outcome.OK:
        segs = time_windows(((s.start_ms / 1000.0, s.end_ms / 1000.0, s.text) for s in result.segments),
                            YOUTUBE_WINDOW_S)
        if segs:
            detail.update(caption_language=result.language, caption_kind=result.kind)
            return Extraction(ref.slide_id, "captions", segments=segs, status="READY", detail=detail)
        return Extraction(ref.slide_id, "captions", status="EMPTY", note=NO_CAPTIONS_NOTE,
                          detail={"caption_outcome": Outcome.NO_CAPTIONS.value})
    tutor = await asyncio.to_thread(cache.tutor_youtube_captions, vid)
    if tutor:
        return Extraction(ref.slide_id, "captions", segments=[Segment(text=tutor)], status="READY",
                          note="Read from the AI tutor's copy of the captions", detail=detail)
    if result.transient:
        detail["caption_transient"] = True
        if not result.fallback_configured and result.outcome is not Outcome.BUSY:
            logger.info("course knowledge: captions for %s not available (%s) and no caption fallback is "
                        "configured; EMPTY until the caption requeue", vid, result.outcome.value)
            return Extraction(ref.slide_id, "captions", status="EMPTY", note=NO_FALLBACK_NOTE, detail=detail)
        logger.info("course knowledge: captions for %s not available right now (%s); will retry",
                    vid, result.outcome.value)
        return Extraction(ref.slide_id, "captions", status="FAILED", note=result.note, detail=detail)
    if not result.confirmed:
        detail["caption_unconfirmed"] = True
    logger.info("course knowledge: no captions for %s (%s)", vid, result.outcome.value)
    return Extraction(ref.slide_id, "captions", status="EMPTY", note=result.note or NO_CAPTIONS_NOTE,
                      detail=detail)


# ── AI video (HTML_VIDEO) ────────────────────────────────────────────────────

def _words_row(video_id: str) -> Optional[Tuple[Optional[str], Optional[str]]]:
    with db_session() as db:
        row = db.execute(sql_text("SELECT s3_urls->>'words', file_ids->>'words' FROM ai_gen_video WHERE video_id = :v"),
                         {"v": video_id}).first()
    return (row[0], row[1]) if row else None


def _words(payload: Any) -> List[Tuple[float, float, str]]:
    items = payload.get("words") if isinstance(payload, dict) else payload
    out: List[Tuple[float, float, str]] = []
    if not isinstance(items, list):
        return out
    for w in items:
        if not isinstance(w, dict):
            continue
        word = str(w.get("word") or w.get("text") or "").strip()
        try:
            s = float(w.get("start"))
            e = float(w.get("end", s))
        except (TypeError, ValueError):
            continue
        if word:
            out.append((s, e, word))
    return out


async def extract_ai_video(ref: SlideRef) -> Extraction:
    vid = ref.pointer_key or ""
    hit = await asyncio.to_thread(cache.get, "ai_video", vid)
    if hit is not None and hit.segments:
        return Extraction(ref.slide_id, "script", segments=hit.segments, status="READY")
    segs: List[Segment] = []
    row = await asyncio.to_thread(_words_row, vid)
    if row is not None:
        url = row[0] or (await source_text._file_url(row[1]) if row[1] else None)
        if url:
            try:
                data = await source_text._download(url, max_bytes=MAX_WORDS_BYTES, timeout=60.0)
                words = _words(json.loads((data or b"").decode("utf-8", errors="replace") or "[]"))
                segs = time_windows(words, AI_VIDEO_WINDOW_S)
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001 - fall back to the script
                logger.info("course knowledge: AI video %s words unreadable: %s", vid, exc)
                segs = []
    if not segs:
        # The narration script, read (and tutor-cached) the way the tutor reads it.
        script = await source_text._ai_video_script(vid)
        if script and script.strip():
            segs = [Segment(text=script.strip(), label="Narration")]
    if not segs:
        return Extraction(ref.slide_id, "script", status="EMPTY", note="The AI video's narration could not be read")
    await asyncio.to_thread(cache.put, "ai_video", vid, "FREE", segs,
                            {"timed": any(s.anchor == "time" for s in segs)})
    return Extraction(ref.slide_id, "script", segments=segs, status="READY")


# ── uploaded video / audio (paid transcription) ──────────────────────────────

def needed_minutes(length_ms: Optional[int]) -> Tuple[int, bool]:
    """(minutes, approx): from the published length, else DEFAULT_UNKNOWN_MINUTES."""
    if length_ms and length_ms > 0:
        return max(1, int(math.ceil(length_ms / 60000.0))), False
    return DEFAULT_UNKNOWN_MINUTES, True


def _need(ref: SlideRef, minutes: int, approx: bool) -> PaidNeed:
    return PaidNeed(kind="transcribe_minutes", tool_key=TOOL_TRANSCRIBE_MINUTE, unit_field="audio_minutes",
                    units=int(minutes), approx=approx, pointer_kind="file", pointer_key=ref.pointer_key)


def _transcript_segments(pieces: Sequence[dict], body: str) -> List[Segment]:
    segs = time_windows(((p.get("start") or 0.0, p.get("end") or p.get("start") or 0.0, p.get("text") or "")
                         for p in pieces if isinstance(p, dict)), TRANSCRIPT_WINDOW_S)
    return segs or ([Segment(text=collapse_repeats(body.strip()))] if body.strip() else [])


async def extract_upload(ref: SlideRef, permit: Optional[PaidPermit] = None) -> Extraction:
    file_id = ref.pointer_key or ""
    hit = await asyncio.to_thread(cache.get, "file", file_id)
    if hit is not None and hit.tier == "PAID" and hit.segments:
        return Extraction(ref.slide_id, "transcript", segments=hit.segments, status="READY")
    tutor = await asyncio.to_thread(cache.tutor_transcript, file_id)
    if tutor:
        return Extraction(ref.slide_id, "transcript", segments=[Segment(text=tutor)], status="READY",
                          note="Read from the AI tutor's transcript")
    minutes, approx = needed_minutes(ref.length_ms)
    need = _need(ref, minutes, approx)
    if permit is None or not permit.allows("transcribe_minutes"):
        return Extraction(ref.slide_id, "transcript", status="NEEDS_PAID", paid_need=need,
                          note="The recording needs transcribing")
    limit = permit.limit("transcribe_minutes")
    if not approx and minutes > limit:
        return Extraction(ref.slide_id, "transcript", status="NEEDS_PAID", paid_need=need, note=OVER_APPROVED_NOTE)

    from ....config import get_settings
    if source_text.transcription_provider() == "openrouter":
        try:
            return await _via_openrouter(ref, permit, limit, need)
        except asyncio.CancelledError:
            raise
        except _NoSpeech:
            return Extraction(ref.slide_id, "transcript", status="EMPTY", note=NO_SPEECH_NOTE)
        except _Requote as rq:
            return Extraction(ref.slide_id, "transcript", status="NEEDS_PAID", paid_need=rq.need, note=rq.note)
        except Exception as exc:  # noqa: BLE001
            if not get_settings().render_server_url:
                raise
            logger.warning("course knowledge: OpenRouter transcription failed for %s; using the render worker: %s",
                           file_id, exc)
    return await _via_render(ref, permit, limit, need)


class _NoSpeech(Exception):
    pass


async def _hold(ref: SlideRef, segs: List[Segment], units: int, model: str, cost_usd: float,
                probe: dict) -> Extraction:
    """No clear speech: keep the transcript for an admin's "use it anyway", charge nothing."""
    kept = await asyncio.to_thread(
        cache.put, HELD_POINTER_KIND, ref.pointer_key, "PAID", segs,
        {**probe, "units": int(units), "model": model, "cost_usd": float(cost_usd or 0.0)},
    )
    detail = {"kept_transcript": {"units": int(units)}} if kept else {}
    return Extraction(ref.slide_id, "transcript", status="EMPTY", note=NO_SPEECH_NOTE, detail=detail)


class _Requote(Exception):
    def __init__(self, need: PaidNeed, note: str) -> None:
        super().__init__(note)
        self.need, self.note = need, note


def _billable_minutes(length_ms: Optional[int], duration_s: Optional[float], limit: int) -> int:
    """Real minutes (min 1), never above the permitted ceiling: the approved
    quote is the most a lesson can cost."""
    return min(limit, max(1, source_text.transcription_minutes(length_ms, duration_s)))


async def _finish(ref: SlideRef, permit: PaidPermit, segs: List[Segment], body: str, units: int,
                  model: str, cost_usd: float, probe: dict) -> Extraction:
    file_id = ref.pointer_key or ""
    await asyncio.to_thread(cache.put, "file", file_id, "PAID", segs, probe)
    await asyncio.to_thread(cache.store_tutor_transcript, file_id, body)
    delivered = PaidDelivered(
        tool_key=TOOL_TRANSCRIBE_MINUTE, unit_field="audio_minutes", units=units, provider_cost_usd=float(cost_usd or 0.0),
        model=model, idempotency_key=f"course_kb_transcribe:{permit.institute_id}:{file_id}",
    )
    return Extraction(ref.slide_id, "transcript", segments=segs, status="READY", paid_delivered=delivered)


async def _via_openrouter(ref: SlideRef, permit: PaidPermit, limit: int, need: PaidNeed) -> Extraction:
    from ...openrouter_transcription import DurationExceeded, transcribe_media
    file_id = ref.pointer_key or ""
    key = await asyncio.to_thread(source_text._openrouter_key, permit.institute_id, None)
    if not key:
        raise RuntimeError("No OpenRouter key available for transcription")
    url = await source_text._file_url(file_id)
    if not url:
        raise RuntimeError("The media file could not be resolved for transcription")
    model = source_text.transcription_model()
    try:
        result = await transcribe_media(url, api_key=key, model=model, max_seconds=limit * 60 + 59)
    except DurationExceeded as exc:
        real = max(1, int(math.ceil(exc.duration / 60.0)))
        raise _Requote(_need(ref, real, False),
                       f"The recording is {real} min long, over the approved {limit} min") from exc
    body = (result.text or "").strip()
    if not body:
        raise _NoSpeech()
    segs = _transcript_segments(result.segments or [], body)
    units = _billable_minutes(ref.length_ms, result.duration_seconds, limit)
    probe = {"seconds": round(float(result.duration_seconds or 0.0), 1), "chunks": result.chunks,
             "language": result.language, "provider": "openrouter"}
    if not source_text.looks_like_speech(body, result.duration_seconds):
        return await _hold(ref, segs, units, f"openrouter:{model}", result.cost_usd, probe)
    return await _finish(ref, permit, segs, body, units, f"openrouter:{model}", result.cost_usd, probe)


def _pending_job(file_id: str) -> Optional[str]:
    with db_session() as db:
        return source_text.pending_transcription_job(db, file_id)


async def _via_render(ref: SlideRef, permit: PaidPermit, limit: int, need: PaidNeed) -> Extraction:
    from ....config import get_settings
    from ...transcription_service import TranscriptionService
    import httpx

    file_id = ref.pointer_key or ""
    settings = get_settings()
    if not settings.render_server_url:
        return Extraction(ref.slide_id, "transcript", status="FAILED", paid_need=need,
                          note="Transcription is not available on this server")
    service = TranscriptionService(settings.render_server_url, settings.render_server_key)
    job_id = await asyncio.to_thread(_pending_job, file_id)
    if not job_id:
        url = await source_text._file_url(file_id)
        if not url:
            return Extraction(ref.slide_id, "transcript", status="FAILED", paid_need=need,
                              note="The media file could not be resolved for transcription")
        job_id = await asyncio.to_thread(service.submit, url, None, "small", True, ["txt", "json"], None, "transcribe")
        await asyncio.to_thread(source_text._remember_job, file_id, job_id)

    budget = min(RENDER_WAIT_SECONDS, source_text.transcription_wait_budget(ref.length_ms))
    expected = source_text.expected_transcription_seconds(ref.length_ms)
    started = time.monotonic()
    status: dict = {}
    while True:
        status = await asyncio.to_thread(service.check_status, job_id)
        state = (status.get("status") or "").lower()
        if state == "completed":
            break
        if state in ("failed", "unknown"):
            await asyncio.to_thread(source_text._close_job, file_id, "FAILED")
            return Extraction(ref.slide_id, "transcript", status="FAILED", paid_need=need,
                              note=f"Transcription failed: {str(status.get('error') or state)[:160]}")
        if time.monotonic() - started + source_text.TRANSCRIBE_POLL_SECONDS > budget:
            progress = float(status.get("progress") or 0.0)
            remaining = (expected or source_text.TRANSCRIBE_MAX_WAIT_SECONDS) * max(0.0, 1.0 - progress / 100.0)
            eta = max(1, int(remaining / 60) + 1)
            return Extraction(ref.slide_id, "transcript", status="PENDING", paid_need=need,
                              note=f"Transcribing ({int(progress)}% done, about {eta} min left)")
        await asyncio.sleep(source_text.TRANSCRIBE_POLL_SECONDS)

    urls: dict = {}
    for key in ("output_urls", "output_urls_source"):
        if isinstance(status.get(key), dict):
            urls = status[key]
            break
    body, pieces = "", []
    async with httpx.AsyncClient(timeout=60.0) as client:
        if urls.get("json"):
            try:
                resp = await client.get(urls["json"])
                resp.raise_for_status()
                payload = resp.json()
                pieces = [p for p in (payload.get("segments") if isinstance(payload, dict) else []) or []
                          if isinstance(p, dict)]
                body = " ".join(str(p.get("text") or "").strip() for p in pieces).strip()
            except Exception as exc:  # noqa: BLE001 - the txt output still has the words
                logger.info("course knowledge: transcript json unreadable for %s: %s", file_id, exc)
                pieces = []
        if not body and urls.get("txt"):
            resp = await client.get(urls["txt"])
            resp.raise_for_status()
            body = resp.text.strip()
    duration = status.get("duration_seconds")
    if not body:
        await asyncio.to_thread(source_text._close_job, file_id, "FAILED")
        return Extraction(ref.slide_id, "transcript", status="EMPTY", note=NO_SPEECH_NOTE)
    segs = _transcript_segments(pieces, body)
    units = _billable_minutes(ref.length_ms, duration, limit)
    if not source_text.looks_like_speech(body, duration):
        await asyncio.to_thread(source_text._close_job, file_id, "FAILED")
        return await _hold(ref, segs, units, source_text.TRANSCRIPTION_MODEL, 0.0,
                           {"seconds": duration, "provider": "render", "job_id": job_id})
    result = await _finish(ref, permit, segs, body, units, source_text.TRANSCRIPTION_MODEL, 0.0,
                           {"seconds": duration, "provider": "render", "job_id": job_id})
    await asyncio.to_thread(source_text._close_job, file_id, "SUCCESS")
    return result


__all__ = [
    "extract_youtube", "extract_ai_video", "LEGACY_NO_CAPTIONS_NOTE", "extract_upload", "time_windows", "needed_minutes",
    "NO_CAPTIONS_NOTE", "NO_SPEECH_NOTE", "NO_FALLBACK_NOTE", "HELD_POINTER_KIND",
]
