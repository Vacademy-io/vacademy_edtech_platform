"""Extractor registry: any published lesson to text segments with citation
anchors (spec §6.4-6.5).

    refs = describe_slides(db, [slide_id])          # short read, no network
    ext = await extract(refs[0])                    # free; NEEDS_PAID says what paid work would cost
    ext = await extract(ref, paid_permit=PaidPermit(institute_id, max_units=n))

It never charges credits (the worker charges ext.paid_delivered) and never
holds a DB session across network I/O.
"""
from .describe import content_hash, describe_slides
from .registry import extract, title_segment
from .types import (
    EXTRACTOR_VERSION,
    TOOL_OCR_PAGE,
    TOOL_TRANSCRIBE_MINUTE,
    Extraction,
    PaidDelivered,
    PaidNeed,
    PaidPermit,
    Segment,
    SlideRef,
)

__all__ = [
    "EXTRACTOR_VERSION", "TOOL_OCR_PAGE", "TOOL_TRANSCRIBE_MINUTE",
    "Extraction", "PaidDelivered", "PaidNeed", "PaidPermit", "Segment", "SlideRef",
    "describe_slides", "content_hash", "extract", "title_segment",
]
