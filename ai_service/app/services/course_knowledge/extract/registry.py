"""extract(ref, paid_permit=None): one published lesson to anchored segments.

Dispatch is on the SlideRef describe_slides built (pointer kind, then lesson
and document type). Rules every path keeps:
- inline lessons (HTML, code, questions, typed transcripts) return at once;
- without a permit, paid work is reported as NEEDS_PAID with a PaidNeed (any
  free part, such as a PDF's text pages, still comes back as segments);
- with a permit, only that kind runs, never past its max_units, and
  paid_delivered says what was actually processed. Nothing is charged here:
  the worker charges paid_delivered after the text is cached;
- every lesson's segments start with its title-plus-description segment, so
  even an unreadable lesson stays findable as a link;
- exceptions become FAILED with a short note. Only asyncio.CancelledError
  propagates.
"""
from __future__ import annotations

import asyncio
import logging
from typing import List, Optional

from . import deck, documents, media, pdf, scorm
from .types import Extraction, PaidPermit, Segment, SlideRef

logger = logging.getLogger(__name__)

_TEXT_KIND = {"file": "pdf", "youtube": "captions", "ai_video": "script", "deck": "deck", "scorm": "scorm"}


def title_segment(ref: SlideRef) -> Optional[Segment]:
    """Title + description (+ a video's own description): every lesson has one."""
    parts: List[str] = []
    for part in (ref.title, ref.description, ref.extras.get("video_description")):
        part = (part or "").strip()
        if part and part not in parts:
            parts.append(part)
    if not parts:
        return None
    return Segment(text="\n".join(parts), anchor="none", label=ref.title or None)


def _text_kind(ref: SlideRef) -> str:
    return str(ref.extras.get("text_kind") or _TEXT_KIND.get(ref.pointer_kind) or "lesson")


def _anchor_kind(segments: List[Segment]) -> str:
    for seg in segments:
        if seg.anchor != "none":
            return seg.anchor
    return "none"


def _finish(ref: SlideRef, ext: Extraction) -> Extraction:
    """Add the title segment and the lesson's inline extras (in-video
    questions, embedded code), settle READY vs EMPTY, stamp the hash."""
    extra_inline = ref.pointer_kind not in ("inline", "none") and bool(ref.pointer_key)
    content = list(ext.segments) + ([s for s in ref.inline_segments] if extra_inline else [])
    if ext.status in ("READY", "EMPTY"):
        ext.status = "READY" if any((s.text or "").strip() for s in content) else "EMPTY"
    head = title_segment(ref)
    ext.segments = ([head] if head else []) + [s for s in content if (s.text or "").strip()]
    ext.anchor_kind = _anchor_kind(content)
    ext.content_hash = ref.content_hash
    ext.slide_id = ref.slide_id
    return ext


async def _dispatch(ref: SlideRef, permit: Optional[PaidPermit]) -> Extraction:
    kind = _text_kind(ref)
    if not ref.learner_indexable:
        return Extraction(ref.slide_id, kind, status="UNSUPPORTED", note=ref.extras.get("note") or "Never read by the AI")
    if permit is not None and not permit.institute_id:
        # Paid idempotency keys must carry the institute (V243: the ledger key
        # is unique across institutes).
        return Extraction(ref.slide_id, kind, status="FAILED", note="Paid permit has no institute")
    pk = ref.pointer_kind
    if pk == "inline":
        segs = [s for s in ref.inline_segments if (s.text or "").strip()]
        return Extraction(ref.slide_id, kind, segments=segs, status="READY" if segs else "EMPTY")
    if pk == "none" or not ref.pointer_key:
        segs = [s for s in ref.inline_segments if (s.text or "").strip()]
        note = ref.extras.get("note")
        if note and not segs:
            return Extraction(ref.slide_id, kind, status="UNSUPPORTED", note=note)
        if note and ref.doc_type in ("JUPYTER", "SCRATCH"):
            return Extraction(ref.slide_id, kind, segments=segs, status="UNSUPPORTED", note=note)
        return Extraction(ref.slide_id, kind, segments=segs, status="READY" if segs else "EMPTY",
                          note=note or (None if segs else "Nothing is published in this lesson yet"))
    if pk == "file":
        if ref.source_type == "DOCUMENT" and ref.doc_type == "PRESENTATION":
            return await documents.extract_drawing(ref)
        if ref.source_type in ("VIDEO", "AUDIO"):
            return await media.extract_upload(ref, permit)
        return await pdf.extract_pdf(ref, permit)
    if pk == "youtube":
        return await media.extract_youtube(ref)
    if pk == "ai_video":
        return await media.extract_ai_video(ref)
    if pk == "deck":
        return await deck.extract_deck(ref, permit)
    if pk == "scorm":
        return await scorm.extract_scorm(ref, permit)
    return Extraction(ref.slide_id, kind, status="UNSUPPORTED", note="This lesson type cannot be read yet")


async def extract(ref: SlideRef, *, paid_permit: Optional[PaidPermit] = None) -> Extraction:
    """Never raises (except CancelledError) and never charges."""
    try:
        ext = await _dispatch(ref, paid_permit)
    except asyncio.CancelledError:
        raise
    except Exception as exc:  # noqa: BLE001 - the worker records a note, never a traceback
        logger.warning("course knowledge: extract failed for slide %s (%s/%s): %s",
                       ref.slide_id, ref.source_type, ref.doc_type, exc, exc_info=True)
        ext = Extraction(ref.slide_id, _text_kind(ref), status="FAILED",
                         note=f"Could not read this lesson: {str(exc)[:160]}")
    return _finish(ref, ext)


__all__ = ["extract", "title_segment"]
