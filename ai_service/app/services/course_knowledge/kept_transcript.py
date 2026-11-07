"""Use a transcript the speech check rejected ("no clear speech").

The speech check (tutor.source_text.looks_like_speech) guards against indexing
music or silence, but it can be wrong: hour-long chanting or a talk over music
reads like a loop to it. When it rejects a paid transcription the extractor
keeps the text under HELD_POINTER_KIND and charges nothing (extract/media.py
_hold). From the AI knowledge tab an admin can read a preview and use it anyway:
the transcription minutes are charged once (same idempotency key as a normal
transcription), the text becomes the file's PAID cache entry and the lesson is
queued, so the worker indexes it from the cache without transcribing again.

find() is DB-only. use() opens its own short sessions (billing, cache, queue);
no network call is made.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any, Dict, List, Optional

from sqlalchemy import text
from sqlalchemy.orm import Session

from ...db import db_session
from . import billing, store
from .extract import cache, describe
from .extract.media import HELD_POINTER_KIND
from .extract.types import TOOL_TRANSCRIBE_MINUTE, PaidDelivered, Segment
from .queue import enqueue_slides

logger = logging.getLogger(__name__)

PREVIEW_CHARS = 600
REASON = "KEPT_TRANSCRIPT"


class KeptError(Exception):
    pass


@dataclass
class Kept:
    slide_id: str
    file_id: str
    units: int
    credits: Decimal
    words: int
    preview: str
    model: str
    cost_usd: float
    segments: List[Segment] = field(default_factory=list)
    probe: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "slide_id": self.slide_id, "minutes": self.units, "credits": float(self.credits),
            "words": self.words, "preview": self.preview,
        }


def find(db: Session, institute_id: str, slide_id: str) -> Optional[Kept]:
    """The kept transcript of a lesson the speech check rejected, priced; None
    when the lesson has none (it was never rejected, or was read since)."""
    kb = store.get_course_kb(db, institute_id)
    src = store.get_source(db, kb.id, slide_id) if kb is not None else None
    meta = src.meta_json if src is not None and isinstance(src.meta_json, dict) else {}
    if src is None or (src.index_state or "").upper() != "EMPTY" or not meta.get("kept_transcript"):
        return None
    refs = describe.describe_slides(db, [slide_id])
    ref = refs[0] if refs else None
    if ref is None or ref.pointer_kind != "file" or not ref.pointer_key:
        return None
    hit = cache.get(HELD_POINTER_KIND, ref.pointer_key)
    if hit is None or not hit.segments:
        return None
    body = cache.plain_text(hit.segments)
    try:
        units = max(1, int(hit.probe.get("units") or 1))
    except (TypeError, ValueError):
        units = 1
    return Kept(
        slide_id=slide_id, file_id=ref.pointer_key, units=units,
        credits=billing.quote_credits(db, institute_id, TOOL_TRANSCRIBE_MINUTE, units),
        words=len(body.split()), preview=body[:PREVIEW_CHARS], model=str(hit.probe.get("model") or "unknown"),
        cost_usd=float(hit.probe.get("cost_usd") or 0.0), segments=hit.segments, probe=hit.probe,
    )


_SET_CHARGED_SQL = text(
    """
    UPDATE knowledge_base_source
       SET credits_charged = COALESCE(credits_charged, 0) + CAST(:c AS NUMERIC), updated_at = now()
     WHERE knowledge_base_id = :kb AND slide_id = :s
    """
)


def use(institute_id: str, kept: Kept, requested_by: Optional[str]) -> Decimal:
    """Charge the minutes, make the kept text the file's transcript and queue
    the lesson. Returns the credits the ledger holds for the charge. Blocking:
    call it via asyncio.to_thread from async code."""
    delivered = PaidDelivered(
        tool_key=TOOL_TRANSCRIBE_MINUTE, unit_field="audio_minutes", units=kept.units,
        provider_cost_usd=kept.cost_usd, model=kept.model,
        idempotency_key=f"course_kb_transcribe:{institute_id}:{kept.file_id}",
    )
    with db_session() as db:
        already, _ = billing.ledger_charge(db, delivered.idempotency_key)
    credits = billing.charge(delivered, institute_id=institute_id, requested_by=requested_by, run_id=None,
                             slide_id=kept.slide_id, pointer=["file", kept.file_id], manual=True)
    if credits is None:
        raise KeptError("The charge could not be recorded; nothing was changed. Try again in a minute.")
    probe = {**kept.probe, "kept": True}
    if not cache.put("file", kept.file_id, "PAID", kept.segments, probe):
        # Charged but not cached: the retry reads the ledger (same key) and is not charged twice.
        raise KeptError("The transcript could not be saved. Try again; you will not be charged twice.")
    cache.store_tutor_transcript(kept.file_id, cache.plain_text(kept.segments))
    with db_session() as db:
        kb = store.get_course_kb(db, institute_id)
        if kb is not None and not already:
            db.execute(_SET_CHARGED_SQL, {"c": str(credits), "kb": kb.id, "s": kept.slide_id})
        enqueue_slides(db, institute_id, [kept.slide_id], reason=REASON)
        db.commit()
    logger.info("course knowledge: kept transcript used for slide %s (inst %s, %d min, %s cr)",
                kept.slide_id, institute_id, kept.units, credits)
    return credits


__all__ = ["Kept", "KeptError", "find", "use", "REASON", "PREVIEW_CHARS", "TOOL_TRANSCRIBE_MINUTE"]
