"""Value types the extractor registry passes around (spec §6.4).

A lesson is described once (SlideRef, from published columns only), then
extracted into Segments: plain text pieces that each carry the anchor a
citation deep-links to (a PDF page, a video second, a deck step, a question
number, a drawing element). Paid work is never done implicitly: without a
PaidPermit an extractor reports a PaidNeed and stops, and with one it reports
what it actually delivered (PaidDelivered) for the worker to charge.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Dict, List, Optional, Union

# Bump when extraction output changes shape or quality: it is part of the
# course_extract_cache key and of every lesson's content hash, so a bump
# re-extracts every lesson on its next index.
EXTRACTOR_VERSION = 1
# SCORM-only extractor revision: part of SCORM lessons' content hash and cache key, so a
# better SCORM reader re-indexes SCORM lessons without orphaning other types' paid caches.
# v3: iSpring slide text, iSpring Page sections, image slides through paid OCR.
SCORM_EXTRACTOR_VERSION = 3

ANCHORS = ("none", "page", "time", "step", "question", "element")
POINTER_KINDS = ("file", "youtube", "ai_video", "deck", "scorm", "inline", "none")
PAID_KINDS = ("ocr_pages", "transcribe_minutes", "deck_images")
STATUSES = ("READY", "NEEDS_PAID", "PENDING", "EMPTY", "UNSUPPORTED", "FAILED")

TOOL_OCR_PAGE = "course_kb_ocr_page"
TOOL_TRANSCRIBE_MINUTE = "course_kb_transcribe_minute"

# The ToolCostEstimator parameter each pricing unit_field reads.
_ESTIMATOR_PARAM = {"pages": "num_pages", "audio_minutes": "audio_minutes"}


def estimator_params(unit_field: str, units: int) -> Dict[str, int]:
    """{num_pages: n} / {audio_minutes: n}: the tool_params for a quote or a charge."""
    return {_ESTIMATOR_PARAM.get(unit_field, unit_field): int(units)}


@dataclass
class Segment:
    text: str
    anchor: str = "none"                 # one of ANCHORS
    page: Optional[int] = None           # anchor page (PDF page / SCORM resource index)
    t_start_ms: Optional[int] = None     # anchor time
    t_end_ms: Optional[int] = None
    step: Optional[int] = None           # anchor step (deck / SCORM slide number)
    question_no: Optional[int] = None    # anchor question
    label: Optional[str] = None          # human label: first heading, file name, "Slide 3"…

    def to_dict(self) -> Dict[str, Any]:
        return {k: v for k, v in asdict(self).items() if v is not None}

    @classmethod
    def from_dict(cls, raw: Dict[str, Any]) -> "Segment":
        def _int(v: Any) -> Optional[int]:
            try:
                return int(v) if v is not None else None
            except (TypeError, ValueError):
                return None
        anchor = str(raw.get("anchor") or "none")
        return cls(
            text=str(raw.get("text") or ""),
            anchor=anchor if anchor in ANCHORS else "none",
            page=_int(raw.get("page")), t_start_ms=_int(raw.get("t_start_ms")), t_end_ms=_int(raw.get("t_end_ms")),
            step=_int(raw.get("step")), question_no=_int(raw.get("question_no")),
            label=(str(raw["label"]) if raw.get("label") is not None else None),
        )


@dataclass
class SlideRef:
    slide_id: str
    title: str
    description: str
    status: str
    source_type: str                     # DOCUMENT | VIDEO | HTML_VIDEO | AUDIO | SCORM | QUIZ | QUESTION | ASSIGNMENT | ASSESSMENT
    doc_type: Optional[str]              # document_slide.type for DOCUMENT, else None
    pointer_kind: str                    # one of POINTER_KINDS
    pointer_key: Optional[str]           # file id, YouTube id, AI-video id, deck base url, SCORM file id
    inline_segments: List[Segment] = field(default_factory=list)
    length_ms: Optional[int] = None      # published media length, when stored
    content_hash: str = ""
    learner_indexable: bool = True       # False for assessments: never extracted
    # Per-type details: url (YouTube), launch_url / launch_path (SCORM),
    # note (why a lesson cannot be read), video_description, text_kind.
    extras: Dict[str, Any] = field(default_factory=dict)


@dataclass
class PaidNeed:
    kind: str                            # one of PAID_KINDS
    tool_key: str                        # course_kb_ocr_page | course_kb_transcribe_minute
    unit_field: str                      # pages | audio_minutes
    units: int
    approx: bool = False                 # True when the length was unknown (quoted at a default)
    pointer_kind: Optional[str] = None
    pointer_key: Optional[str] = None

    @property
    def tool_params(self) -> Dict[str, int]:
        return estimator_params(self.unit_field, self.units)


@dataclass
class PaidPermit:
    """What the worker allows one extraction to spend. max_units is either one
    ceiling for whatever kind the lesson needs, or a ceiling per kind
    ({"ocr_pages": 12}). A need larger than its ceiling is not processed at
    all (it stays NEEDS_PAID): charges are idempotent per file, so a partial
    run could never be topped up later."""
    institute_id: str = ""
    allow_ocr: bool = True
    allow_transcription: bool = True
    max_units: Union[int, Dict[str, int], None] = None

    def allows(self, kind: str) -> bool:
        if kind in ("ocr_pages", "deck_images") and not self.allow_ocr:
            return False
        if kind == "transcribe_minutes" and not self.allow_transcription:
            return False
        return self.limit(kind) > 0

    def limit(self, kind: str) -> int:
        raw: Any = self.max_units.get(kind) if isinstance(self.max_units, dict) else self.max_units
        try:
            return max(0, int(raw or 0))
        except (TypeError, ValueError):
            return 0


@dataclass
class PaidDelivered:
    tool_key: str
    unit_field: str
    units: int
    provider_cost_usd: float
    model: str
    idempotency_key: str                 # always includes the institute id (V243 ledger-wide unique)

    @property
    def tool_params(self) -> Dict[str, int]:
        return estimator_params(self.unit_field, self.units)


@dataclass
class Extraction:
    slide_id: str
    text_kind: str                       # document | pdf | code | questions | captions | transcript | script | deck | drawing | scorm | lesson
    segments: List[Segment] = field(default_factory=list)
    status: str = "READY"                # one of STATUSES
    paid_need: Optional[PaidNeed] = None
    paid_delivered: Optional[PaidDelivered] = None
    note: Optional[str] = None
    anchor_kind: str = "none"
    content_hash: str = ""
    # Extra facts merged into knowledge_base_source.meta_json by the indexer
    # (YouTube: caption_outcome / caption_route / caption_transient).
    detail: Dict[str, Any] = field(default_factory=dict)

    @property
    def text_chars(self) -> int:
        return sum(len(s.text or "") for s in self.segments)


__all__ = [
    "EXTRACTOR_VERSION", "ANCHORS", "POINTER_KINDS", "PAID_KINDS", "STATUSES",
    "TOOL_OCR_PAGE", "TOOL_TRANSCRIBE_MINUTE", "estimator_params",
    "Segment", "SlideRef", "PaidNeed", "PaidPermit", "PaidDelivered", "Extraction",
]
