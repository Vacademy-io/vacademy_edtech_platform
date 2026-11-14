"""Extraction caches: course_extract_cache (V600) and the tutor's file_conversion rows.

Every function opens its own short ``with db_session()`` block and closes it
before returning, so callers can use them between network calls without
holding a pooled connection (the 2026-08-19 pool exhaustion).

course_extract_cache is keyed (pointer_kind, pointer_key, extractor_version,
tier). A file shared by two lessons, or re-published unchanged, is read once;
reads prefer the PAID tier (OCR / transcript) over the FREE one.

The tutor's file_conversion cache is shared by many vendors, so every read
here names its vendor explicitly (never FileConversionRepository.
find_success_by_source_file_id, which returns whichever vendor wrote last).
tutor_pdf_text is read ONLY when its row is the OCR pass (file_type
'pdf_ocr'): the tutor's free pass writes partial text under the same vendor.
"""
from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Sequence

from sqlalchemy import text

from ....db import db_session
from ....models.file_conversion import FileConversion
from ...tutor import source_text
from .types import EXTRACTOR_VERSION, Segment

logger = logging.getLogger(__name__)

TIERS = ("FREE", "PAID")

# Tutor cache vendors course knowledge may read (spec §6.4).
VENDOR_TRANSCRIPT = source_text.VENDOR_TRANSCRIPT       # tutor_video_transcript
VENDOR_SCRIPT = source_text.VENDOR_SCRIPT               # tutor_ai_video_script
VENDOR_CAPTIONS = source_text.VENDOR_CAPTIONS           # tutor_youtube_captions
VENDOR_PDF = source_text.VENDOR_PDF                     # tutor_pdf_text (pdf_ocr rows only)
PDF_OCR_FILE_TYPE = "pdf_ocr"


@dataclass
class CacheHit:
    tier: str
    segments: List[Segment] = field(default_factory=list)
    probe: Dict[str, Any] = field(default_factory=dict)


_GET_SQL = text("""
    SELECT tier, segments, probe
      FROM course_extract_cache
     WHERE pointer_kind = :k AND pointer_key = :p AND extractor_version = :v
     ORDER BY CASE WHEN tier = 'PAID' THEN 0 ELSE 1 END
     LIMIT 1
""")

_PUT_SQL = text("""
    INSERT INTO course_extract_cache (pointer_kind, pointer_key, extractor_version, tier, segments, text_chars, probe)
    VALUES (:k, :p, :v, :t, CAST(:segments AS jsonb), :chars, CAST(:probe AS jsonb))
    ON CONFLICT (pointer_kind, pointer_key, extractor_version, tier)
    DO UPDATE SET segments = EXCLUDED.segments, text_chars = EXCLUDED.text_chars, probe = EXCLUDED.probe
    RETURNING pointer_key
""")


def _json(raw: Any, default: Any) -> Any:
    if raw is None:
        return default
    if isinstance(raw, (dict, list)):
        return raw
    try:
        return json.loads(raw)
    except Exception:  # noqa: BLE001
        return default


def get(pointer_kind: str, pointer_key: Optional[str]) -> Optional[CacheHit]:
    """The cached extraction for a pointer at this EXTRACTOR_VERSION, PAID first."""
    if not pointer_key:
        return None
    try:
        with db_session() as db:
            row = db.execute(_GET_SQL, {"k": pointer_kind, "p": pointer_key, "v": EXTRACTOR_VERSION}).first()
    except Exception:  # noqa: BLE001 - a cache miss, never an error
        logger.warning("course_extract_cache read failed for %s:%s", pointer_kind, pointer_key, exc_info=True)
        return None
    if row is None:
        return None
    segs = [Segment.from_dict(s) for s in _json(row[1], []) if isinstance(s, dict)]
    probe = _json(row[2], {})
    return CacheHit(tier=str(row[0]), segments=segs, probe=probe if isinstance(probe, dict) else {})


def put(pointer_kind: str, pointer_key: Optional[str], tier: str, segments: Sequence[Segment],
        probe: Optional[Dict[str, Any]] = None) -> bool:
    """Upsert one tier of a pointer's extraction. True when the row was written
    (decided from RETURNING: psycopg 3 reports rowcount -1 for ON CONFLICT)."""
    if not pointer_key or tier not in TIERS:
        return False
    payload = [s.to_dict() for s in segments]
    params = {
        "k": pointer_kind, "p": pointer_key[:512], "v": EXTRACTOR_VERSION, "t": tier,
        "segments": json.dumps(payload, ensure_ascii=False),
        "chars": sum(len(s.text or "") for s in segments),
        "probe": json.dumps(probe or {}, ensure_ascii=False, default=str),
    }
    try:
        with db_session() as db:
            row = db.execute(_PUT_SQL, params).first()
            db.commit()
        return row is not None
    except Exception:  # noqa: BLE001 - losing a cache write only costs a re-extract
        logger.warning("course_extract_cache write failed for %s:%s", pointer_kind, pointer_key, exc_info=True)
        return False


# ── tutor caches (read by explicit vendor) ───────────────────────────────────

def _tutor_text(vendor: str, key: Optional[str], file_type: Optional[str] = None) -> Optional[str]:
    if not key:
        return None
    try:
        with db_session() as db:
            q = (db.query(FileConversion.html_text)
                 .filter(FileConversion.vendor == vendor, FileConversion.vendor_file_id == key,
                         FileConversion.status == "SUCCESS", FileConversion.html_text.isnot(None)))
            if file_type is not None:
                q = q.filter(FileConversion.file_type == file_type)
            row = q.order_by(FileConversion.created_at.desc()).first()
    except Exception:  # noqa: BLE001
        logger.warning("tutor cache read failed for %s:%s", vendor, key, exc_info=True)
        return None
    body = (row[0] or "").strip() if row is not None else ""
    return body or None


def tutor_transcript(file_id: Optional[str]) -> Optional[str]:
    """A transcript the tutor already paid for (uploaded video or audio file)."""
    return _tutor_text(VENDOR_TRANSCRIPT, file_id)


def tutor_ai_video_script(video_id: Optional[str]) -> Optional[str]:
    return _tutor_text(VENDOR_SCRIPT, video_id)


def tutor_youtube_captions(video_id: Optional[str]) -> Optional[str]:
    return _tutor_text(VENDOR_CAPTIONS, video_id)


def tutor_pdf_ocr(file_id: Optional[str]) -> Optional[str]:
    """The tutor's OCR'd PDF text. Its free pass also writes tutor_pdf_text
    (file_type 'pdf', possibly partial), which is ignored here."""
    return _tutor_text(VENDOR_PDF, file_id, file_type=PDF_OCR_FILE_TYPE)


# ── write-back after a paid extraction (so the tutor never pays again) ──────

def store_tutor_transcript(file_id: str, body: str) -> None:
    if file_id and (body or "").strip():
        source_text._store(VENDOR_TRANSCRIPT, file_id, body, file_id=file_id, file_type="transcript")


def store_tutor_pdf_ocr(file_id: str, body: str) -> None:
    if file_id and (body or "").strip():
        source_text._store(VENDOR_PDF, file_id, body, file_id=file_id, file_type=PDF_OCR_FILE_TYPE)


def plain_text(segments: Sequence[Segment]) -> str:
    return "\n\n".join((s.text or "").strip() for s in segments if (s.text or "").strip())


__all__ = [
    "CacheHit", "TIERS", "get", "put",
    "tutor_transcript", "tutor_ai_video_script", "tutor_youtube_captions", "tutor_pdf_ocr",
    "store_tutor_transcript", "store_tutor_pdf_ocr", "plain_text",
]
