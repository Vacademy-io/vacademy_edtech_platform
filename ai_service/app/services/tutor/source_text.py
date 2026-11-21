"""Text for video and PDF slides (design §4.2), so they compile like documents.

Where the words come from, cheapest first:
- HTML_VIDEO (AI video): the narration script the copilot wrote (S3, free).
- YouTube video: the caption track through the shared caption service
  (services/youtube_captions: its own cache, direct, rotating proxy, Supadata;
  free to the institute). Older captions cached here under
  tutor_youtube_captions are still read first; new ones are not written here.
- Uploaded video: Whisper on the render worker (`transcription` tool, per
  audio-minute) — the only paid path, run once per file and cached.
- PDF: PyMuPDF text layer (free; a scanned PDF has none — no OCR here).
- SCORM: the course-knowledge SCORM reader (HTML pages, iSpring text, free);
  slides drawn as images are read with paid OCR (ocr_scorm), billed like PDF
  OCR pages, and cached in course knowledge's shared cache so neither the
  tutor nor course knowledge ever pays for a package twice.

Every other result is cached in `file_conversion` under a tutor vendor key, so
a recompile never re-fetches or re-pays. Nothing here holds a DB session across
a network call.
"""
from __future__ import annotations

import asyncio
import logging
import math
import time
from typing import Any, Optional
from uuid import uuid4

import httpx
from sqlalchemy import text as sql_text
from sqlalchemy.orm import Session

from ...db import db_session
from ...models.ai_token_usage import RequestType
from ...models.file_conversion import FileConversion
from ..ai_billing import UC, metering_user, record_tool_billing, supported_kwargs
from .slide_source import MAX_SOURCE_CHARS, SlideSource, _hash, source_kind_label

logger = logging.getLogger(__name__)

VENDOR_TRANSCRIPT = "tutor_video_transcript"
# A Whisper job in flight for a video file: vendor_file_id = job id, file_id
# = the video's file id. A compile that runs out of waiting time leaves the
# job running and the next compile picks it up here instead of resubmitting.
VENDOR_TRANSCRIPT_JOB = "tutor_video_transcript_job"
# Observed on the render worker: Whisper "small" on CPU runs at ~0.7x realtime,
# so an 82-minute lecture takes about two hours. A compile waits only when
# the transcript can plausibly arrive within one sitting.
TRANSCRIBE_REALTIME_FACTOR = 1.4
TRANSCRIBE_MAX_WAIT_SECONDS = 30 * 60
TRANSCRIBE_POLL_SECONDS = 15


class TranscriptionPending(RuntimeError):
    """The transcript is still being made; the slide can be prepared later."""

    def __init__(self, job_id: str, progress: float, eta_minutes: int) -> None:
        self.job_id, self.progress, self.eta_minutes = job_id, progress, eta_minutes
        super().__init__(f"Transcribing this video ({int(progress)}% done, about {eta_minutes} min left). "
                         "Prepare it again later and it will be picked up where it is.")


def expected_transcription_seconds(video_length_ms: Optional[int]) -> Optional[int]:
    if not video_length_ms:
        return None
    return int(video_length_ms / 1000 * TRANSCRIBE_REALTIME_FACTOR)


def transcription_wait_budget(video_length_ms: Optional[int]) -> int:
    """How long one compile waits for this video's transcript: the expected
    time plus slack, capped; a video that will clearly take longer than the
    cap is submitted and parked at once (a two-step prepare)."""
    expected = expected_transcription_seconds(video_length_ms)
    if expected is None:
        return TRANSCRIBE_MAX_WAIT_SECONDS
    if expected > TRANSCRIBE_MAX_WAIT_SECONDS:
        return 0
    return min(TRANSCRIBE_MAX_WAIT_SECONDS, expected + 10 * 60)
VENDOR_CAPTIONS = "tutor_youtube_captions"
VENDOR_SCRIPT = "tutor_ai_video_script"
VENDOR_PDF = "tutor_pdf_text"
# {"pages": n, "text_chars": c}: what the free pass found, so the estimate
# can price OCR for a scanned PDF without downloading it again.
VENDOR_PDF_PROBE = "tutor_pdf_probe"
OCR_TOOL = "html_document_pdf"          # MathPix per-page surcharge (0.5/page)
TRANSCRIPTION_TOOL = "transcription"
TRANSCRIPTION_MODEL = "whisper-small"
# Where speech-to-text runs: OpenRouter (Whisper large-v3-turbo, minutes for
# a lecture) or the render worker (Whisper small on CPU, hours). Platform
# settings tutor.transcription.provider / tutor.transcription.model.
TRANSCRIPTION_PROVIDERS = ("openrouter", "render")
DEFAULT_TRANSCRIPTION_PROVIDER = "openrouter"
MAX_PDF_BYTES = 40 * 1024 * 1024
MAX_CACHED_CHARS = 120_000

TEXT_KIND_BY_SOURCE_KIND = {"ai_video": "script", "youtube": "captions", "video_upload": "transcript", "pdf": "pdf",
                            "scorm": "scorm"}
# SCORM text kinds: the package's own text only, or with its image slides read by OCR.
SCORM_TEXT = "scorm"
SCORM_OCR_TEXT = "scorm_ocr"
MAX_SCORM_OCR_SLIDES = 300


def expected_text_kind(src: SlideSource) -> Optional[str]:
    """What kind of text this slide can get (before fetching anything)."""
    return TEXT_KIND_BY_SOURCE_KIND.get(source_kind_label(src))


def hash_for(src: SlideSource, text_kind: Optional[str]) -> str:
    """The content hash a plan compiled from this text kind carries. A plan
    compiled from a description only keeps the old hash, so the first compile
    with real text counts as a change."""
    if src.kind == "video":
        return _hash("video", src.title, src.media_file_id or src.media_url, text_kind) if text_kind else src.content_hash
    if src.kind == "pdf":
        return _hash("pdf", src.title, src.media_file_id, text_kind) if text_kind else src.content_hash
    if src.kind == "scorm":
        if not text_kind:
            return src.content_hash
        from ..course_knowledge.extract.types import SCORM_EXTRACTOR_VERSION
        return _hash("scorm", src.title, src.scorm_pointer, src.scorm_launch_url, src.scorm_launch_path,
                     SCORM_EXTRACTOR_VERSION, text_kind)
    return src.content_hash


def _set_text(src: SlideSource, text_: str, kind: str) -> None:
    src.text = (text_ or "").strip()[:MAX_SOURCE_CHARS]
    src.text_kind = kind
    src.content_hash = hash_for(src, kind)


# ── cache ────────────────────────────────────────────────────────────────────

def cached_text(db: Session, vendor: str, key: str) -> Optional[str]:
    row = (db.query(FileConversion)
           .filter(FileConversion.vendor == vendor, FileConversion.vendor_file_id == key,
                   FileConversion.status == "SUCCESS", FileConversion.html_text.isnot(None))
           .order_by(FileConversion.created_at.desc()).first())
    return row.html_text if row is not None else None


def store_text(db: Session, vendor: str, key: str, text_: str, *, file_id: Optional[str] = None, file_type: str = "text") -> None:
    db.add(FileConversion(id=str(uuid4()), vendor_file_id=key, vendor=vendor, file_id=file_id, status="SUCCESS",
                          html_text=(text_ or "")[:MAX_CACHED_CHARS], file_type=file_type))
    db.commit()


def transcript_cached(db: Session, file_id: str) -> bool:
    return cached_text(db, VENDOR_TRANSCRIPT, file_id) is not None


def _cached(vendor: str, key: str) -> Optional[str]:
    with db_session() as db:
        return cached_text(db, vendor, key)


def _store(vendor: str, key: str, text_: str, file_id: Optional[str] = None, file_type: str = "text") -> None:
    try:
        with db_session() as db:
            store_text(db, vendor, key, text_, file_id=file_id, file_type=file_type)
    except Exception:  # noqa: BLE001
        logger.warning("source_text cache write failed for %s:%s", vendor, key, exc_info=True)


# ── free sources ─────────────────────────────────────────────────────────────

async def _download(url: str, *, max_bytes: int, timeout: float = 120.0) -> Optional[bytes]:
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
        async with client.stream("GET", url) as resp:
            resp.raise_for_status()
            buf = bytearray()
            async for chunk in resp.aiter_bytes():
                buf.extend(chunk)
                if len(buf) > max_bytes:
                    return None
            return bytes(buf)


async def _file_url(file_id: str) -> Optional[str]:
    from ..media_file_client import get_file_url, get_public_file_url
    for resolver in (get_public_file_url, get_file_url):
        try:
            url = await resolver(file_id)
            if url:
                return url
        except Exception as exc:  # noqa: BLE001
            logger.debug("source_text: %s could not resolve %s: %s", resolver.__name__, file_id, exc)
    return None


async def _ai_video_script(video_id: str) -> Optional[str]:
    cached = _cached(VENDOR_SCRIPT, video_id)
    if cached:
        return cached
    with db_session() as db:
        row = db.execute(sql_text("SELECT s3_urls->>'script', file_ids->>'script' FROM ai_gen_video WHERE video_id = :v"),
                         {"v": video_id}).first()
    if not row:
        return None
    url = row[0] or (await _file_url(row[1]) if row[1] else None)
    if not url:
        return None
    data = await _download(url, max_bytes=2 * 1024 * 1024, timeout=60.0)
    script = (data or b"").decode("utf-8", errors="replace").strip()
    if script:
        _store(VENDOR_SCRIPT, video_id, script, file_type="script")
    return script or None


async def _youtube_captions(url: str) -> Optional[str]:
    """The video's caption text. Raises CaptionsError (a ValueError carrying
    the service result) when there are none to read right now."""
    from ..kb.parsing import youtube_video_id
    from ..youtube_captions import service as yt_service
    vid = youtube_video_id(url)
    if not vid:
        return None
    cached = _cached(VENDOR_CAPTIONS, vid)        # legacy rows: still read, no longer written
    if cached:
        return cached
    result = await yt_service.require_captions(vid, purpose="tutor")
    return result.text.strip() or None


def youtube_note(result: Any) -> str:
    """What the tutor tells the teacher when a YouTube video's captions could
    not be read, chosen from the service outcome (not from message text)."""
    from ..youtube_captions import NOTES, Outcome, note_for
    outcome = getattr(result, "outcome", None)
    if not isinstance(outcome, Outcome):
        return note_for(Outcome.NETWORK, "tutor")
    if getattr(result, "transient", False):
        return note_for(outcome, "tutor", transient=True)
    return NOTES.get(outcome) or note_for(outcome, "tutor")


def pdf_probe(db: Session, file_id: str) -> Optional[dict]:
    """{"pages", "text_chars"} from the last free pass over this PDF, if any."""
    raw = cached_text(db, VENDOR_PDF_PROBE, file_id)
    if not raw:
        return None
    try:
        import json
        return json.loads(raw)
    except Exception:  # noqa: BLE001
        return None


async def _pdf_bytes(file_id: str) -> Optional[bytes]:
    url = await _file_url(file_id)
    if not url:
        raise RuntimeError("The PDF file could not be resolved")
    data = await _download(url, max_bytes=MAX_PDF_BYTES)
    if not data:
        raise RuntimeError("The PDF is larger than 40 MB")
    return data


async def _pdf_text(file_id: str) -> Optional[str]:
    cached = _cached(VENDOR_PDF, file_id)
    if cached:
        return cached
    from ..kb import parsing
    data = await _pdf_bytes(file_id)
    # extract_figures=False and OCR payloads ignored: zero paid OCR.
    extracted = await asyncio.to_thread(parsing._extract_sync, data, False)
    body = "\n\n".join((p.text or "").strip() for p in extracted.pages if (p.text or "").strip())
    import json
    _store(VENDOR_PDF_PROBE, file_id, json.dumps({"pages": len(extracted.pages), "text_chars": len(body),
                                                  "scanned_pages": len(getattr(extracted, "ocr_payloads", []) or [])}),
           file_id=file_id, file_type="probe")
    if body:
        _store(VENDOR_PDF, file_id, body, file_id=file_id, file_type="pdf")
    return body or None


async def ocr_pdf(src: SlideSource, *, institute_id: str, user_id: Optional[str], request_id: Optional[str],
                  metering: Any = None) -> int:
    """Read a scanned PDF with MathPix OCR (the knowledge base's paid path),
    once per file, charged per page with the `html_document_pdf` tool.
    Returns the pages charged (0 on a cache hit)."""
    from ..kb import parsing
    file_id = src.media_file_id or ""
    cached = _cached(VENDOR_PDF, file_id)
    if cached:
        _set_text(src, cached, "pdf")
        return 0
    data = await _pdf_bytes(file_id)
    doc = await parsing.parse_pdf(data, extract_figures=False)
    body = "\n\n".join((p.text or "").strip() for p in doc.pages if (p.text or "").strip())
    if not body:
        raise RuntimeError("OCR found no readable text in this PDF")
    _store(VENDOR_PDF, file_id, body, file_id=file_id, file_type="pdf_ocr")
    pages = int(doc.ocr_pages or 0)
    if pages > 0:
        from ..provider_rates import ocr_cost_usd
        record_tool_billing(
            tool_key=OCR_TOOL, tool_params={"num_pages": pages}, request_type=RequestType.PDF_QUESTIONS,
            model="mathpix", institute_id=institute_id, user_id=user_id, user_role="ADMIN",
            request_id=request_id, idempotency_key=f"tutor_ocr:{file_id}", provider_cost_usd=ocr_cost_usd(pages),
            use_case=UC.TUTOR_SETUP, metering=metering if metering is not None else metering_user(user_id, surface="ADMIN_APP"),
            usage_context={"slide_id": src.slide_id, "file_id": file_id, "feature": "tutor_ocr"},
        )
    _set_text(src, body, "pdf")
    return pages


def ocr_available() -> bool:
    from ...config import get_settings
    try:
        s = get_settings()
        return bool(getattr(s, "mathpix_app_id", None) and getattr(s, "mathpix_app_key", None))
    except Exception:  # noqa: BLE001
        return False


async def resolve_free_text(src: SlideSource) -> None:
    """Fill `src.text` from every source that costs nothing (script, captions,
    a cached transcript, the PDF text layer). Sets `src.text_note` when a
    source was tried and had nothing."""
    kind = source_kind_label(src)
    try:
        if kind == "ai_video" and src.ai_gen_video_id:
            script = await _ai_video_script(src.ai_gen_video_id)
            if script:
                _set_text(src, script, "script"); return
            src.text_note = "The AI video's script could not be read"
        elif kind == "youtube" and src.media_url:
            from ..youtube_captions import CaptionsError
            try:
                captions = await _youtube_captions(src.media_url)
            except CaptionsError as exc:
                captions = None
                src.text_note = youtube_note(exc.result)
            if captions:
                _set_text(src, captions, "captions"); return
            src.text_note = src.text_note or "This video has no captions"
        elif kind == "video_upload" and src.media_file_id:
            cached = _cached(VENDOR_TRANSCRIPT, src.media_file_id)
            if cached:
                _set_text(src, cached, "transcript"); return
        elif kind == "pdf" and src.media_file_id:
            body = await _pdf_text(src.media_file_id)
            if body:
                _set_text(src, body, "pdf"); return
            src.text_note = "This PDF has no text layer (scanned pages): turn on OCR or add what it teaches"
        elif kind == "scorm" and src.scorm_launch_url:
            await _scorm_free_text(src)
    except Exception as exc:  # noqa: BLE001
        logger.warning("source_text: free text failed for slide %s (%s): %s", src.slide_id, kind, exc, exc_info=True)
        src.text_note = f"Could not read the {kind.replace('_', ' ')}: {str(exc)[:120]}"


# ── SCORM packages (through the course-knowledge SCORM reader) ───────────────

def scorm_ref(src: SlideSource):
    """The course-knowledge SlideRef of a SCORM slide (same pointer and cache key)."""
    from ..course_knowledge.extract.types import SlideRef
    extras: dict = {"launch_url": src.scorm_launch_url or "", "text_kind": "scorm"}
    if src.scorm_launch_path:
        extras["launch_path"] = src.scorm_launch_path
    return SlideRef(slide_id=src.slide_id, title=src.title, description="", status="PUBLISHED",
                    source_type="SCORM", doc_type=None, pointer_kind="scorm", pointer_key=src.scorm_pointer,
                    extras=extras)


def scorm_text(segments: Any) -> str:
    """Segments as teaching text: each slide under a 'Slide N' line."""
    parts = []
    for seg in segments or []:
        body = (getattr(seg, "text", "") or "").strip()
        if not body:
            continue
        label = getattr(seg, "label", None) if getattr(seg, "anchor", "none") == "step" else None
        parts.append(f"{label}:\n{body}" if label else body)
    return "\n\n".join(parts)


def scorm_cached(src: SlideSource) -> Optional[dict]:
    """What course knowledge's shared cache already knows about the package
    (no network): {"paid", "ocr_units", "has_text"}; None when not scanned."""
    if not src.scorm_pointer:
        return None
    from ..course_knowledge.extract import cache as ck_cache, scorm as ck_scorm
    hit = ck_cache.get("scorm", ck_scorm.cache_key(scorm_ref(src)))
    if hit is None:
        return None
    waiting = hit.probe.get("ocr_slides") if isinstance(hit.probe, dict) else None
    return {"paid": hit.tier == "PAID", "ocr_units": 0 if hit.tier == "PAID" else len(waiting or []),
            "has_text": any((s.text or "").strip() for s in hit.segments)}


def scorm_ocr_available() -> bool:
    """The configured SCORM slide reader can run: MathPix keys, or the vision
    engine with an OpenRouter key."""
    try:
        from ..course_knowledge import flags as ck_flags
        if ck_flags.scorm_ocr_engine() == "vision":
            import os
            return bool(os.environ.get("OPENROUTER_API_KEY")) or ocr_available()
    except Exception:  # noqa: BLE001
        pass
    return ocr_available()


async def _scorm_free_text(src: SlideSource) -> None:
    """The package's free text (or the paid text another run already cached);
    src.ocr_units = the image slides still to read."""
    from ..course_knowledge.extract import scorm as ck_scorm
    ext = await ck_scorm.extract_scorm(scorm_ref(src))
    body = scorm_text(ext.segments)
    if ext.status == "READY":
        _set_text(src, body, SCORM_OCR_TEXT if ext.detail.get("scorm_ocr") else SCORM_TEXT)
        return
    if ext.status == "NEEDS_PAID" and ext.paid_need is not None:
        src.ocr_units = int(ext.paid_need.units or 0)
        if body:
            _set_text(src, body, SCORM_TEXT)
        n = src.ocr_units
        src.text_note = (f"{n} slide{'s' if n != 1 else ''} of this package {'are' if n != 1 else 'is'} drawn as "
                         "images: turn on OCR or add what it teaches")
        return
    src.text_note = ext.note or "This package has no readable text: add what it teaches"


async def ocr_scorm(src: SlideSource, *, institute_id: str, user_id: Optional[str], request_id: Optional[str],
                    metering: Any = None) -> int:
    """Read a SCORM package's image slides (one composed picture per slide)
    and charge them per slide with the `html_document_pdf` OCR tool, like
    scanned PDF pages. The text lands in course knowledge's shared PAID cache,
    so a package course knowledge already read costs 0 here, and one read
    here costs 0 there. Returns the slides charged (0 on a cache hit)."""
    from ..course_knowledge.extract import scorm as ck_scorm
    from ..course_knowledge.extract.types import PaidPermit
    permit = PaidPermit(institute_id=institute_id, allow_ocr=True, max_units={"deck_images": MAX_SCORM_OCR_SLIDES})
    ref = scorm_ref(src)
    ext = await ck_scorm.extract_scorm(ref, permit)
    if ext.status == "FAILED":
        raise RuntimeError(ext.note or "OCR could not read the slides")
    if ext.status == "NEEDS_PAID":
        raise RuntimeError(ext.note or "The package has too many image slides to read")
    body = scorm_text(ext.segments)
    if not body:
        raise RuntimeError("OCR found no readable text in this package")
    delivered = ext.paid_delivered
    slides = int(delivered.units) if delivered is not None else 0
    if slides > 0:
        record_tool_billing(
            tool_key=OCR_TOOL, tool_params={"num_pages": slides}, request_type=RequestType.PDF_QUESTIONS,
            model=delivered.model or "mathpix", institute_id=institute_id, user_id=user_id, user_role="ADMIN",
            request_id=request_id,
            idempotency_key=f"tutor_scorm_ocr:{institute_id}:{ck_scorm.billing_key(ck_scorm.cache_key(ref))}",
            provider_cost_usd=delivered.provider_cost_usd,
            use_case=UC.TUTOR_SETUP, metering=metering if metering is not None else metering_user(user_id, surface="ADMIN_APP"),
            usage_context={"slide_id": src.slide_id, "scorm": src.scorm_pointer, "feature": "tutor_scorm_ocr"},
        )
    src.ocr_units = 0
    _set_text(src, body, SCORM_OCR_TEXT)
    return slides


# ── the paid source: Whisper for uploaded videos ─────────────────────────────

# Whisper narrates silence and music as filler ("Thank you.", "Music.",
# "Subscribe!"). A transcript that is mostly that is no transcript.
_FILLER = {"thank", "you", "music", "thanks", "subscribe", "bye", "applause", "laughter", "silence", "the", "end"}
MIN_SPEECH_WORDS_PER_MINUTE = 15
SPEECH_WINDOW_WORDS = 300       # distinct-word share is judged per window of this many words


def looks_like_speech(text: str, duration_seconds: Optional[float]) -> bool:
    words = [w.strip(".,!?").lower() for w in (text or "").split() if w.strip(".,!?")]
    if len(words) < 12:
        return False
    unique = len(set(words))
    if unique <= 6:
        return False
    # The share of distinct words falls as speech gets longer (an hour-long talk
    # reuses a few thousand words), so a long transcript is judged per window:
    # a whole-text ratio of 0.2 rejected real 54-102 min lectures as "no speech".
    window = SPEECH_WINDOW_WORDS
    if len(words) <= window:
        if unique / len(words) < 0.2:
            return False
    else:
        ratios = sorted(len(set(words[i:i + window])) / window
                        for i in range(0, len(words) - window + 1, window))
        if ratios[len(ratios) // 2] < 0.2:
            return False
    filler = sum(1 for w in words if w in _FILLER)
    if filler / len(words) > 0.6:
        return False
    if duration_seconds and duration_seconds > 60 and len(words) / (duration_seconds / 60.0) < MIN_SPEECH_WORDS_PER_MINUTE:
        return False
    return True


def transcription_minutes(video_length_ms: Optional[int], duration_seconds: Optional[float] = None) -> int:
    secs = float(duration_seconds) if duration_seconds else (float(video_length_ms or 0) / 1000.0)
    return int(math.ceil(secs / 60.0)) if secs > 0 else 0


def pending_transcription_job(db: Session, file_id: str) -> Optional[str]:
    """The Whisper job id already running for this video file, if any."""
    row = (db.query(FileConversion)
           .filter(FileConversion.vendor == VENDOR_TRANSCRIPT_JOB, FileConversion.file_id == file_id,
                   FileConversion.status == "INIT")
           .order_by(FileConversion.created_at.desc()).first())
    return row.vendor_file_id if row is not None else None


def _remember_job(file_id: str, job_id: str) -> None:
    try:
        with db_session() as db:
            db.add(FileConversion(id=str(uuid4()), vendor_file_id=job_id, vendor=VENDOR_TRANSCRIPT_JOB, file_id=file_id,
                                  status="INIT", file_type="transcript_job"))
            db.commit()
    except Exception:  # noqa: BLE001
        logger.warning("could not remember transcription job %s for %s", job_id, file_id, exc_info=True)


def _close_job(file_id: str, status: str) -> None:
    try:
        with db_session() as db:
            for row in (db.query(FileConversion).filter(FileConversion.vendor == VENDOR_TRANSCRIPT_JOB,
                                                        FileConversion.file_id == file_id, FileConversion.status == "INIT").all()):
                row.status = status
            db.commit()
    except Exception:  # noqa: BLE001
        pass


async def transcribe_upload(src: SlideSource, *, institute_id: str, user_id: Optional[str], request_id: Optional[str],
                            metering: Any = None) -> int:
    """Transcribe an uploaded video once (cached by file id) and charge the
    `transcription` tool per audio-minute. Returns the minutes billed (0 on a
    cache hit). A job that cannot finish within this compile's wait budget is
    left running and raised as TranscriptionPending; the next compile of the
    slide resumes polling it. Raises RuntimeError when the worker fails."""
    import httpx as _httpx
    from ...config import get_settings
    from ..transcription_service import TranscriptionService
    file_id = src.media_file_id or ""
    cached = _cached(VENDOR_TRANSCRIPT, file_id)
    if cached:
        _set_text(src, cached, "transcript")
        return 0
    settings = get_settings()
    if transcription_provider() == "openrouter":
        try:
            return await _transcribe_via_openrouter(src, institute_id=institute_id, user_id=user_id, request_id=request_id,
                                                    **supported_kwargs(_transcribe_via_openrouter, {"metering": metering}))
        except Exception as exc:  # noqa: BLE001
            if not settings.render_server_url or "no clear speech" in str(exc):
                raise
            logger.warning("OpenRouter transcription failed for %s; falling back to the render worker: %s", file_id, exc)
    if not settings.render_server_url:
        raise RuntimeError("Transcription unavailable: RENDER_SERVER_URL not configured")
    service = TranscriptionService(settings.render_server_url, settings.render_server_key)
    with db_session() as db:
        job_id = pending_transcription_job(db, file_id)
    if not job_id:
        url = await _file_url(file_id)
        if not url:
            raise RuntimeError("The video file could not be resolved for transcription")
        job_id = await asyncio.to_thread(service.submit, url, None, "small", True, ["txt", "json"], None, "transcribe")
        _remember_job(file_id, job_id)
    budget = transcription_wait_budget(src.video_length_ms)
    expected = expected_transcription_seconds(src.video_length_ms)
    started = time.monotonic()
    status: dict = {}
    while True:
        status = await asyncio.to_thread(service.check_status, job_id)
        state = (status.get("status") or "").lower()
        if state == "completed":
            break
        if state in ("failed", "unknown"):
            _close_job(file_id, "FAILED")
            raise RuntimeError(f"Transcription failed: {status.get('error') or state}")
        waited = time.monotonic() - started
        if waited + TRANSCRIBE_POLL_SECONDS > budget:
            progress = float(status.get("progress") or 0.0)
            remaining = (expected or TRANSCRIBE_MAX_WAIT_SECONDS) * max(0.0, 1.0 - progress / 100.0)
            raise TranscriptionPending(job_id, progress, max(1, int(remaining / 60) + 1))
        await asyncio.sleep(TRANSCRIBE_POLL_SECONDS)
    txt_url = None
    for key in ("output_urls", "output_urls_source"):
        urls = status.get(key)
        if isinstance(urls, dict) and urls.get("txt"):
            txt_url = urls["txt"]
            break
    body = ""
    if txt_url:
        async with _httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.get(txt_url)
            resp.raise_for_status()
            body = resp.text.strip()
    if not body or not looks_like_speech(body, status.get("duration_seconds")):
        _close_job(file_id, "FAILED")
        raise RuntimeError("The recording has no clear speech to transcribe; add what this video teaches instead")
    _store(VENDOR_TRANSCRIPT, file_id, body, file_id=file_id, file_type="transcript")
    _close_job(file_id, "SUCCESS")
    minutes = max(1, transcription_minutes(src.video_length_ms, status.get("duration_seconds")))
    record_tool_billing(
        tool_key=TRANSCRIPTION_TOOL, tool_params={"audio_minutes": minutes}, request_type=RequestType.TRANSCRIPTION,
        model=TRANSCRIPTION_MODEL, institute_id=institute_id, user_id=user_id, user_role="ADMIN",
        request_id=request_id, idempotency_key=f"tutor_transcribe:{file_id}",
        use_case=UC.TRANSCRIPTION, metering=metering if metering is not None else metering_user(user_id, surface="ADMIN_APP"),
        usage_context={"slide_id": src.slide_id, "file_id": file_id, "feature": "tutor_transcribe"},
    )
    _set_text(src, body, "transcript")
    return minutes


def transcription_provider() -> str:
    try:
        from ...services.platform_settings_service import get_platform_setting
        p = str(get_platform_setting("tutor.transcription.provider", default=DEFAULT_TRANSCRIPTION_PROVIDER) or "")
        return p if p in TRANSCRIPTION_PROVIDERS else DEFAULT_TRANSCRIPTION_PROVIDER
    except Exception:  # noqa: BLE001
        return DEFAULT_TRANSCRIPTION_PROVIDER


def transcription_model() -> str:
    try:
        from ...services.platform_settings_service import get_platform_setting
        from ..openrouter_transcription import DEFAULT_MODEL
        return str(get_platform_setting("tutor.transcription.model", default=DEFAULT_MODEL) or DEFAULT_MODEL)
    except Exception:  # noqa: BLE001
        return "openai/whisper-large-v3-turbo"


def _openrouter_key(institute_id: str, user_id: Optional[str]) -> Optional[str]:
    """The institute's own OpenRouter key when it has one, else the platform's."""
    try:
        from ..api_key_resolver import ApiKeyResolver
        with db_session() as db:
            key, _g, _m = ApiKeyResolver(db).resolve_keys(institute_id or "default", user_id)
        return key or None
    except Exception:  # noqa: BLE001
        logger.warning("OpenRouter key resolution failed", exc_info=True)
        return None


def transcription_available() -> bool:
    from ...config import get_settings
    try:
        s = get_settings()
        if transcription_provider() == "openrouter":
            import os
            return bool(os.environ.get("OPENROUTER_API_KEY")) or bool(s.render_server_url)
        return bool(s.render_server_url)
    except Exception:  # noqa: BLE001
        return False


async def _transcribe_via_openrouter(src: SlideSource, *, institute_id: str, user_id: Optional[str], request_id: Optional[str],
                                    metering: Any = None) -> int:
    """Whisper large-v3-turbo on OpenRouter: minutes, not hours. Charges the
    `transcription` tool per audio-minute and records the provider's cost."""
    from ..openrouter_transcription import transcribe_media
    from ..token_usage_service import TokenUsageService
    from ...models.ai_token_usage import ApiProvider
    file_id = src.media_file_id or ""
    key = _openrouter_key(institute_id, user_id)
    if not key:
        raise RuntimeError("No OpenRouter key available for transcription")
    url = await _file_url(file_id)
    if not url:
        raise RuntimeError("The video file could not be resolved for transcription")
    model = transcription_model()
    result = await transcribe_media(url, api_key=key, model=model)
    body = (result.text or "").strip()
    if not body or not looks_like_speech(body, result.duration_seconds):
        # Not charged to the institute: there was nothing to transcribe.
        src.text_note = "The recording has no clear speech (music or silence): add what this video teaches"
        raise RuntimeError("The recording has no clear speech to transcribe; add what this video teaches instead")
    _store(VENDOR_TRANSCRIPT, file_id, body, file_id=file_id, file_type="transcript")
    minutes = max(1, transcription_minutes(src.video_length_ms, result.duration_seconds))
    record_tool_billing(
        tool_key=TRANSCRIPTION_TOOL, tool_params={"audio_minutes": minutes}, request_type=RequestType.TRANSCRIPTION,
        model=f"openrouter:{model}", institute_id=institute_id, user_id=user_id, user_role="ADMIN",
        request_id=request_id, idempotency_key=f"tutor_transcribe:{file_id}",
        use_case=UC.TRANSCRIPTION, metering=metering if metering is not None else metering_user(user_id, surface="ADMIN_APP"),
        usage_context={"slide_id": src.slide_id, "file_id": file_id, "feature": "tutor_transcribe"},
    )
    # The provider's actual spend, for the AI usage / cost pages.
    try:
        from ..ai_billing import metering_kwargs, supported_kwargs
        meter = metering_kwargs(UC.TRANSCRIPTION,
                                metering if metering is not None else metering_user(user_id, surface="ADMIN_APP"),
                                {"slide_id": src.slide_id, "file_id": file_id, "feature": "tutor_transcribe_cost"},
                                free_reason="BUNDLED")
        with db_session() as db:
            tus = TokenUsageService(db)
            tus.record_usage(
                api_provider=ApiProvider.OPENAI, prompt_tokens=0, completion_tokens=0, total_tokens=0,
                request_type=RequestType.TRANSCRIPTION, institute_id=institute_id, user_id=user_id,
                model=f"openrouter:{model}", request_id=request_id, total_price=float(result.cost_usd or 0.0),
                character_count=int(result.duration_seconds or 0),
                metadata={"surface": "tutor", "kind": "transcription", "seconds": round(result.duration_seconds, 1),
                          "cost_usd": result.cost_usd, "chunks": result.chunks, "language": result.language,
                          "file_id": file_id, "generation_ids": [g for g in result.generation_ids if g][:20]},
                **supported_kwargs(tus.record_usage, meter),
            )
            db.commit()
    except Exception:  # noqa: BLE001
        logger.warning("transcription usage not recorded for %s", file_id, exc_info=True)
    logger.info("Transcribed %s via OpenRouter: %.0f s in %d chunk(s), $%.4f", file_id, result.duration_seconds, result.chunks, result.cost_usd)
    _set_text(src, body, "transcript")
    return minutes
