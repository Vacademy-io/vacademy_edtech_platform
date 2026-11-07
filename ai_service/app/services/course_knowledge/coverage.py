"""Per-course coverage and the paid-processing quote (spec §7.2, §12, §13).

compute_coverage() answers "what can the AI read in this course, and what
would it cost to read the rest" for the admin AI knowledge tab, and is the
single quote both GET coverage and POST process use (process recomputes it,
so what the admin approved and what is enqueued come from the same code).

Lesson states:
  READY             indexed (free or already paid text)
  NEEDS_PROCESSING  free text read; scans / slide images / media need a paid step
  PROCESSING        a queue row is PENDING or PROCESSING, or a transcription job runs
  NOT_SCANNED       no source row yet
  CANT_READ         the extractor reported UNSUPPORTED or EMPTY (reason = its note)
  FAILED            the source, or a never-written lesson's queue row, FAILED
  EXCLUDED          assessments: never shown to the AI

Quote rules:
  * one ToolCostEstimator.estimate per lesson, SUMMED: the estimate rounds up
    to a whole credit per call (_ceil_whole), so three one-page scans at 0.5
    cost 3 credits, never total units x unit price = 2. The per-lesson charge
    in the worker uses the same per-call price, so quote == ledger;
  * estimates are memoized per (tool, units) within one computation (each
    estimate runs two pricing queries);
  * deduped by pointer: a file two lessons share is charged once, on the first
    lesson in course order; the other shows 0 and "Uses the same file as ...";
  * a pointer whose PAID text is already in course_extract_cache (another
    course or institute paid for it) costs 0: "Already processed";
  * uploaded video / audio not scanned yet is quoted from its published
    length (DEFAULT_UNKNOWN_MINUTES with approx when unknown);
  * a kind the institute switched off in Settings (allow_ocr /
    allow_transcription) is not quoted: the worker would not run it.

The caller owns the session; reads only, never commits, no network.
CAST(:x AS type), never ``::`` after a bind.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any, Dict, List, Optional, Sequence, Tuple

from sqlalchemy import text
from sqlalchemy.orm import Session

from . import billing, store, tree
from .extract import describe
from .extract.media import needed_minutes
from .extract.types import EXTRACTOR_VERSION, TOOL_OCR_PAGE, TOOL_TRANSCRIBE_MINUTE
from .settings_store import CourseKnowledgeSetting

logger = logging.getLogger(__name__)

STATE_READY = "READY"
STATE_NEEDS_PROCESSING = "NEEDS_PROCESSING"
STATE_PROCESSING = "PROCESSING"
STATE_NOT_SCANNED = "NOT_SCANNED"
STATE_CANT_READ = "CANT_READ"
STATE_FAILED = "FAILED"
STATE_EXCLUDED = "EXCLUDED"
LESSON_STATES = (
    STATE_READY, STATE_NEEDS_PROCESSING, STATE_PROCESSING, STATE_NOT_SCANNED,
    STATE_CANT_READ, STATE_FAILED, STATE_EXCLUDED,
)

KIND_OCR = "ocr_pages"
KIND_TRANSCRIBE = "transcribe_minutes"
KIND_DECK = "deck_images"
QUOTE_KINDS = (KIND_OCR, KIND_TRANSCRIBE, KIND_DECK)
_TOOL_FOR_KIND = {KIND_OCR: TOOL_OCR_PAGE, KIND_DECK: TOOL_OCR_PAGE, KIND_TRANSCRIBE: TOOL_TRANSCRIBE_MINUTE}

ASSESSMENT_REASON = "Assessment: never shown to the AI"
SHARED_FILE_REASON = "Uses the same file as {title}"
ALREADY_PROCESSED_REASON = "Already processed"
OCR_OFF_REASON = "Reading scanned pages is turned off in Settings"
TRANSCRIPTION_OFF_REASON = "Transcription is turned off in Settings"
FAILED_REASON = "Could not read this lesson"
CANT_READ_REASON = "The AI can't read this lesson"
TRANSCRIBING_REASON = "Transcription is running"

_MEDIA_TYPES = ("VIDEO", "AUDIO")
_ZERO = Decimal("0")


# ----------------------------------------------------------------------
# value types
# ----------------------------------------------------------------------
@dataclass
class LessonCoverage:
    slide_id: str
    title: str
    chapter_id: Optional[str]
    chapter_name: Optional[str]
    source_type: Optional[str]
    doc_type: Optional[str]
    state: str
    reason: Optional[str] = None
    units: Optional[int] = None
    credits: Decimal = _ZERO
    credits_charged: Decimal = _ZERO
    chunk_count: int = 0
    anchor_kind: Optional[str] = None
    updated_at: Optional[str] = None
    # Quote internals (not serialised).
    kind: Optional[str] = None
    tool_key: Optional[str] = None
    approx: bool = False
    pointer: Optional[Tuple[str, str]] = None
    # "No clear speech" with the transcript kept: minutes to charge if the admin
    # uses it anyway (kept_transcript.py), priced in compute_coverage.
    kept_minutes: Optional[int] = None
    kept_credits: Decimal = _ZERO

    def to_dict(self) -> Dict[str, Any]:
        return {
            "slide_id": self.slide_id, "title": self.title, "chapter_id": self.chapter_id,
            "chapter_name": self.chapter_name, "source_type": self.source_type, "doc_type": self.doc_type,
            "state": self.state, "reason": self.reason, "units": self.units,
            "credits": num(self.credits), "credits_charged": num(self.credits_charged),
            "chunk_count": self.chunk_count, "anchor_kind": self.anchor_kind, "updated_at": self.updated_at,
            "kept_transcript": ({"minutes": self.kept_minutes, "credits": num(self.kept_credits)}
                                if self.kept_minutes else None),
        }


@dataclass(frozen=True)
class QuoteLine:
    """One lesson the quote charges for."""
    slide_id: str
    kind: str
    tool_key: str
    units: int
    credits: Decimal
    approx: bool


@dataclass
class Quote:
    credits: Decimal = _ZERO
    approx: bool = False
    lines: List[QuoteLine] = field(default_factory=list)
    # Lessons whose paid text is already cached: a free pass makes them READY.
    cached_slide_ids: List[str] = field(default_factory=list)

    def items(self) -> List[Dict[str, Any]]:
        by_kind: Dict[str, Dict[str, Any]] = {}
        for line in self.lines:
            item = by_kind.setdefault(line.kind, {"kind": line.kind, "units": 0, "credits": _ZERO, "lessons": 0})
            item["units"] += int(line.units)
            item["credits"] += line.credits
            item["lessons"] += 1
        return [
            {**by_kind[k], "credits": num(by_kind[k]["credits"])} for k in QUOTE_KINDS if k in by_kind
        ]

    def tool_units(self) -> Dict[str, int]:
        """tool_key -> summed units (the preflight parameters per tool)."""
        out: Dict[str, int] = {}
        for line in self.lines:
            out[line.tool_key] = out.get(line.tool_key, 0) + int(line.units)
        return out

    @property
    def slide_ids(self) -> List[str]:
        return [line.slide_id for line in self.lines]

    def to_dict(self) -> Dict[str, Any]:
        return {"credits": num(self.credits), "approx": bool(self.approx), "items": self.items()}


@dataclass
class Coverage:
    package_id: str
    lessons: List[LessonCoverage]
    quote: Quote

    def totals(self) -> Dict[str, Any]:
        counts = {s: 0 for s in LESSON_STATES}
        charged = _ZERO
        for lesson in self.lessons:
            counts[lesson.state] = counts.get(lesson.state, 0) + 1
            charged += lesson.credits_charged
        return {
            "lessons": len(self.lessons),
            "ready": counts[STATE_READY],
            "needs_processing": counts[STATE_NEEDS_PROCESSING],
            "processing": counts[STATE_PROCESSING],
            "not_scanned": counts[STATE_NOT_SCANNED],
            "cant_read": counts[STATE_CANT_READ],
            "failed": counts[STATE_FAILED],
            "excluded": counts[STATE_EXCLUDED],
            "credits_required": num(self.quote.credits),
            "credits_charged": num(charged),
        }

    @property
    def visible_slide_ids(self) -> List[str]:
        """Every lesson the AI may read (assessments left out), course order."""
        return [lesson.slide_id for lesson in self.lessons if lesson.state != STATE_EXCLUDED]

    def to_dict(self) -> Dict[str, Any]:
        return {
            "package_id": self.package_id,
            "totals": self.totals(),
            "quote": self.quote.to_dict(),
            "lessons": [lesson.to_dict() for lesson in self.lessons],
        }


def num(value: Any) -> Any:
    """A Decimal as JSON: an int when whole, else a float; None stays None."""
    if value is None:
        return None
    d = value if isinstance(value, Decimal) else Decimal(str(value))
    if not d.is_finite():
        return None
    return int(d) if d == d.to_integral_value() else float(d)


# ----------------------------------------------------------------------
# pricing (memoized per request)
# ----------------------------------------------------------------------
class Estimator:
    """billing.quote_credits memoized per (tool, units): one estimate per
    distinct lesson size, never one per lesson."""

    def __init__(self, db: Session, institute_id: str) -> None:
        self.db = db
        self.institute_id = institute_id
        self._memo: Dict[Tuple[str, int], Decimal] = {}

    def credits(self, tool_key: str, units: int) -> Decimal:
        key = (tool_key, int(units))
        if key not in self._memo:
            self._memo[key] = billing.quote_credits(self.db, self.institute_id, tool_key, int(units))
        return self._memo[key]


# ----------------------------------------------------------------------
# reads
# ----------------------------------------------------------------------
_QUEUE_SQL = text(
    """
    SELECT slide_id, status, last_error
      FROM content_index_queue
     WHERE institute_id = :i AND slide_id = ANY(CAST(:ids AS TEXT[]))
    """
)

_DOC_TYPES_SQL = text(
    """
    SELECT s.id, ds.type
      FROM slide s
      JOIN document_slide ds ON ds.id = s.source_id
     WHERE s.id = ANY(CAST(:ids AS TEXT[])) AND s.source_type = 'DOCUMENT'
    """
)

_PAID_CACHE_SQL = text(
    """
    SELECT pointer_kind, pointer_key
      FROM course_extract_cache
     WHERE tier = 'PAID' AND extractor_version = :v
       AND pointer_key = ANY(CAST(:keys AS TEXT[]))
       AND jsonb_array_length(segments) > 0
    """
)


def _queue_states(db: Session, institute_id: str, slide_ids: Sequence[str]) -> Dict[str, Tuple[str, Optional[str]]]:
    if not slide_ids:
        return {}
    rows = db.execute(_QUEUE_SQL, {"i": institute_id, "ids": list(slide_ids)}).fetchall()
    return {r[0]: (str(r[1] or ""), r[2]) for r in rows}


def _doc_types(db: Session, slide_ids: Sequence[str]) -> Dict[str, Optional[str]]:
    if not slide_ids:
        return {}
    rows = db.execute(_DOC_TYPES_SQL, {"ids": list(slide_ids)}).fetchall()
    return {r[0]: ((r[1] or "").strip().upper() or None) for r in rows}


def _paid_cached(db: Session, pointers: Sequence[Tuple[str, str]]) -> set:
    keys = sorted({p[1] for p in pointers if p and p[1]})
    if not keys:
        return set()
    rows = db.execute(_PAID_CACHE_SQL, {"v": EXTRACTOR_VERSION, "keys": keys}).fetchall()
    return {(r[0], r[1]) for r in rows}


def _unique_lessons(rows: Sequence[tree.TreeRow]) -> List[tree.TreeRow]:
    """One row per lesson (its first occurrence: a lesson shown in several
    batches or chapters is still one lesson to index)."""
    seen: Dict[str, tree.TreeRow] = {}
    for r in rows:
        seen.setdefault(r.slide_id, r)
    return list(seen.values())


# ----------------------------------------------------------------------
# state per lesson
# ----------------------------------------------------------------------
def _need_reason(kind: Optional[str], units: Optional[int], approx: bool, source_type: Optional[str]) -> str:
    n = int(units or 0)
    if kind == KIND_TRANSCRIBE:
        what = "Audio" if (source_type or "").upper() == "AUDIO" else "Video"
        return f"{what} · {'about ' if approx else ''}{n} min to transcribe"
    if kind == KIND_DECK:
        return f"Slide images · {n} slide{'s' if n != 1 else ''} need reading"
    return f"Scanned PDF · {n} page{'s' if n != 1 else ''} need reading"


def _kind_allowed(kind: Optional[str], setting: CourseKnowledgeSetting) -> bool:
    if kind in (KIND_OCR, KIND_DECK):
        return bool(setting.allow_ocr)
    if kind == KIND_TRANSCRIBE:
        return bool(setting.allow_transcription)
    return False


def _from_source(lesson: LessonCoverage, src: store.SourceRow) -> None:
    meta = src.meta_json if isinstance(src.meta_json, dict) else {}
    note = meta.get("note") or None
    lesson.credits_charged = Decimal(str(src.credits_charged or 0))
    lesson.chunk_count = int(src.chunk_count or 0)
    lesson.anchor_kind = meta.get("anchor_kind") or None
    lesson.updated_at = src.updated_at.isoformat() if src.updated_at is not None else None
    state = (src.index_state or "").upper()
    if state == "READY":
        lesson.state, lesson.reason = STATE_READY, note
    elif state == "NEEDS_PROCESSING":
        lesson.state = STATE_NEEDS_PROCESSING
        paid = meta.get("paid") if isinstance(meta.get("paid"), dict) else {}
        kind = paid.get("kind") if paid.get("kind") in QUOTE_KINDS else None
        try:
            units = int(paid.get("units") or 0)
        except (TypeError, ValueError):
            units = 0
        lesson.kind = kind
        lesson.units = units if kind else None
        lesson.approx = bool(paid.get("approx"))
        lesson.tool_key = str(paid.get("tool_key") or _TOOL_FOR_KIND.get(kind or "", "")) or None
        pk, pkey = paid.get("pointer_kind"), paid.get("pointer_key")
        lesson.pointer = (str(pk), str(pkey)) if pk and pkey else None
        lesson.reason = note or (_need_reason(kind, units, lesson.approx, lesson.source_type) if kind else None)
    elif state == "PENDING":
        lesson.state, lesson.reason = STATE_PROCESSING, note or TRANSCRIBING_REASON
    elif state in ("UNSUPPORTED", "EMPTY"):
        lesson.state, lesson.reason = STATE_CANT_READ, note or CANT_READ_REASON
        kept = meta.get("kept_transcript") if state == "EMPTY" else None
        if isinstance(kept, dict):
            try:
                lesson.kept_minutes = max(1, int(kept.get("units") or 1))
            except (TypeError, ValueError):
                lesson.kept_minutes = None
    elif state == "FAILED":
        lesson.state, lesson.reason = STATE_FAILED, note or FAILED_REASON
    else:
        # A source without a known index state was not written by the worker.
        lesson.state = STATE_NOT_SCANNED


def _media_needs(db: Session, lessons: List[LessonCoverage]) -> None:
    """Quote uploaded video / audio that has not been scanned yet from its
    published length (spec §7.2)."""
    media = [l for l in lessons if l.state == STATE_NOT_SCANNED and (l.source_type or "").upper() in _MEDIA_TYPES]
    if not media:
        return
    refs = {r.slide_id: r for r in describe.describe_slides(db, [l.slide_id for l in media])}
    for lesson in media:
        ref = refs.get(lesson.slide_id)
        if ref is None or ref.pointer_kind != "file" or not ref.pointer_key:
            continue                        # YouTube captions (shared caption service, free to the institute),
                                            # a transcript, an external link: free or unreadable
        minutes, approx = needed_minutes(ref.length_ms)
        lesson.kind, lesson.tool_key = KIND_TRANSCRIBE, TOOL_TRANSCRIBE_MINUTE
        lesson.units, lesson.approx = int(minutes), bool(approx)
        lesson.pointer = ("file", ref.pointer_key)
        lesson.reason = _need_reason(KIND_TRANSCRIBE, minutes, approx, lesson.source_type)


# ----------------------------------------------------------------------
# entry point
# ----------------------------------------------------------------------
def compute_coverage(
    db: Session,
    institute_id: str,
    package_id: str,
    setting: CourseKnowledgeSetting,
    *,
    estimator: Optional[Estimator] = None,
) -> Coverage:
    """Coverage of every visible lesson of the package plus the quote. The
    caller has checked that package_institute maps the package to the
    institute (package_slide_tree also returns nothing otherwise)."""
    rows = _unique_lessons(tree.package_slide_tree(db, institute_id, package_id))
    slide_ids = [r.slide_id for r in rows]
    kb = store.get_course_kb(db, institute_id)
    sources = store.coverage_rows(db, kb.id, slide_ids) if kb is not None and slide_ids else {}
    queued = _queue_states(db, institute_id, slide_ids)
    doc_types = _doc_types(db, [r.slide_id for r in rows if (r.source_type or "").upper() == "DOCUMENT"])

    lessons: List[LessonCoverage] = []
    for r in rows:
        lesson = LessonCoverage(
            slide_id=r.slide_id, title=(r.title or "").strip(), chapter_id=r.chapter_id,
            chapter_name=r.chapter_title, source_type=r.source_type, doc_type=doc_types.get(r.slide_id),
            state=STATE_NOT_SCANNED,
        )
        lessons.append(lesson)
        if r.is_assessment:
            lesson.state, lesson.reason = STATE_EXCLUDED, ASSESSMENT_REASON
            continue
        src = sources.get(r.slide_id)
        if src is not None:
            _from_source(lesson, src)
        q_status, q_error = queued.get(r.slide_id, ("", None))
        if q_status in ("PENDING", "PROCESSING"):
            # Waiting for (or in) the worker: whatever it stored before is about to change.
            lesson.state = STATE_PROCESSING
            if src is None or (src.index_state or "").upper() != "PENDING":
                lesson.reason = None
        elif q_status == "FAILED" and src is None:
            lesson.state, lesson.reason = STATE_FAILED, (q_error or FAILED_REASON)[:300]

    _media_needs(db, lessons)
    estimator = estimator or Estimator(db, institute_id)
    for lesson in lessons:
        if lesson.state == STATE_CANT_READ and lesson.kept_minutes:
            lesson.kept_credits = estimator.credits(TOOL_TRANSCRIBE_MINUTE, lesson.kept_minutes)
        else:
            lesson.kept_minutes = None
    quote = _quote(db, lessons, setting, estimator)
    return Coverage(package_id=package_id, lessons=lessons, quote=quote)


def _quote(
    db: Session, lessons: List[LessonCoverage], setting: CourseKnowledgeSetting, estimator: Estimator,
) -> Quote:
    candidates = [
        l for l in lessons
        if l.state in (STATE_NEEDS_PROCESSING, STATE_NOT_SCANNED) and l.kind and l.tool_key and (l.units or 0) > 0
    ]
    cached = _paid_cached(db, [l.pointer for l in candidates if l.pointer])
    quote = Quote()
    # A file a queued lesson is already reading (a run in progress) is not
    # quoted again for the lessons that share it: they read its text after.
    first_by_pointer: Dict[Tuple[str, str], LessonCoverage] = {}
    for lesson in lessons:
        if lesson.state == STATE_PROCESSING and lesson.pointer is not None:
            first_by_pointer.setdefault(lesson.pointer, lesson)
    for lesson in candidates:
        if not _kind_allowed(lesson.kind, setting):
            lesson.reason = OCR_OFF_REASON if lesson.kind in (KIND_OCR, KIND_DECK) else TRANSCRIPTION_OFF_REASON
            continue
        if lesson.pointer is not None:
            if lesson.pointer in cached:
                lesson.reason = ALREADY_PROCESSED_REASON
                if lesson.state == STATE_NEEDS_PROCESSING:
                    quote.cached_slide_ids.append(lesson.slide_id)
                continue
            first = first_by_pointer.get(lesson.pointer)
            if first is not None:
                lesson.reason = SHARED_FILE_REASON.format(title=first.title or "another lesson")
                continue
            first_by_pointer[lesson.pointer] = lesson
        credits = estimator.credits(lesson.tool_key, int(lesson.units))
        lesson.credits = credits
        if (lesson.kind == KIND_DECK and (lesson.source_type or "").upper() == "SCORM" and credits > 0
                and lesson.reason and "credits)" not in lesson.reason):
            # "Slides are images: 12 slides need reading (≈ 6 credits)"
            lesson.reason = f"{lesson.reason} (≈ {num(credits)} credits)"
        if credits <= 0:
            continue
        quote.lines.append(QuoteLine(
            slide_id=lesson.slide_id, kind=lesson.kind, tool_key=lesson.tool_key,
            units=int(lesson.units), credits=credits, approx=lesson.approx,
        ))
        quote.credits += credits
        quote.approx = quote.approx or lesson.approx
    return quote


def balance(db: Session, institute_id: str, credits: Any) -> Dict[str, Any]:
    """{current_balance, balance_after, sufficient}; all None when the
    institute has no wallet row (a missing balance never blocks)."""
    from ..credit_service import CreditService

    row = CreditService(db).get_balance(institute_id)
    if not row:
        return {"current_balance": None, "balance_after": None, "sufficient": None}
    current = Decimal(str(row.current_balance))
    needed = Decimal(str(credits or 0))
    return {
        "current_balance": num(current),
        "balance_after": num(current - needed),
        "sufficient": bool(current >= needed),
    }


__all__ = [
    "LESSON_STATES", "QUOTE_KINDS", "LessonCoverage", "QuoteLine", "Quote", "Coverage", "Estimator",
    "compute_coverage", "balance", "num",
    "ASSESSMENT_REASON", "SHARED_FILE_REASON", "ALREADY_PROCESSED_REASON",
]
