"""Citations for course passages: where a passage sits in its lesson and the
learner-app link that opens it there.

A chunk carries its anchor the way the indexer stored it (spec 6.3): real PDF
pages in page_start / page_end, and {t_start_ms, t_end_ms, step, question_no,
label, text_kind} in its meta. From that:

  href   learner_tools.slide_link(entry) plus &page=N (PDF page, 1-based) or
         &t=S (whole seconds, > 0); the learner app opens the PDF at the page
         or seeks the video, and ignores either parameter on older builds
  badge  'p. 12', '04:31' (1:02:05 past an hour), 'Step 3', 'Q 3' or None
  icon   pdf | video | quiz | slide (all in chat_cards.CARD_ICONS; the tests check)
  label  'Chapter › Lesson (p. 12)'

Pure functions, no DB.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping, Optional

from ..learner_tools import course_link, slide_link

ANCHOR_NONE = "none"
ANCHOR_PAGE = "page"
ANCHOR_TIME = "time"
ANCHOR_STEP = "step"
ANCHOR_QUESTION = "question"

ICON_PDF = "pdf"
ICON_VIDEO = "video"
ICON_QUIZ = "quiz"
ICON_SLIDE = "slide"

_VIDEO_TYPES = frozenset({"VIDEO", "AUDIO", "HTML_VIDEO"})
_QUIZ_TYPES = frozenset({"QUIZ", "QUESTION", "ASSIGNMENT"})
_VIDEO_KINDS = frozenset({"captions", "transcript", "script"})
_LOCKED_DATE_PREFIX = "Unlocks on "

@dataclass(frozen=True)
class Anchor:
    kind: str = ANCHOR_NONE
    page: Optional[int] = None
    page_end: Optional[int] = None
    t_start_ms: Optional[int] = None
    step: Optional[int] = None
    question_no: Optional[int] = None
    label: Optional[str] = None

    @property
    def seconds(self) -> Optional[int]:
        if self.t_start_ms is None:
            return None
        return int(self.t_start_ms // 1000)


@dataclass(frozen=True)
class Citation:
    href: str
    badge: Optional[str]
    icon: str
    label: str
    anchor: Anchor


def _positive_int(value: Any) -> Optional[int]:
    if value is None or isinstance(value, bool):
        return None
    try:
        n = int(float(value))
    except (TypeError, ValueError):
        return None
    return n if n > 0 else None


def _non_negative_int(value: Any) -> Optional[int]:
    if value is None or isinstance(value, bool):
        return None
    try:
        n = int(float(value))
    except (TypeError, ValueError):
        return None
    return n if n >= 0 else None


def _field(row: Any, name: str) -> Any:
    if isinstance(row, Mapping):
        return row.get(name)
    return getattr(row, name, None)


def anchor_of(page_start: Any = None, page_end: Any = None, meta: Optional[Mapping[str, Any]] = None) -> Anchor:
    """The passage's anchor. A real page wins, then a time, a step, a question."""
    meta = meta or {}
    label = meta.get("label")
    label = " ".join(str(label).split())[:120] if label else None
    page = _positive_int(page_start)
    if page is not None:
        end = _positive_int(page_end)
        return Anchor(ANCHOR_PAGE, page=page, page_end=end if end and end > page else None, label=label)
    t_ms = _non_negative_int(meta.get("t_start_ms"))
    if t_ms is not None:
        return Anchor(ANCHOR_TIME, t_start_ms=t_ms, label=label)
    step = _positive_int(meta.get("step"))
    if step is not None:
        return Anchor(ANCHOR_STEP, step=step, label=label)
    question = _positive_int(meta.get("question_no"))
    if question is not None:
        return Anchor(ANCHOR_QUESTION, question_no=question, label=label)
    return Anchor(ANCHOR_NONE, label=label)


def clock(seconds: int) -> str:
    """04:31, or 1:02:05 past an hour."""
    seconds = max(0, int(seconds))
    h, rest = divmod(seconds, 3600)
    m, s = divmod(rest, 60)
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m:02d}:{s:02d}"


def badge_for(anchor: Anchor) -> Optional[str]:
    if anchor.kind == ANCHOR_PAGE and anchor.page:
        return f"p. {anchor.page}"
    if anchor.kind == ANCHOR_TIME and anchor.t_start_ms is not None:
        return clock(anchor.seconds or 0)
    if anchor.kind == ANCHOR_STEP and anchor.step:
        return f"Step {anchor.step}"
    if anchor.kind == ANCHOR_QUESTION and anchor.question_no:
        return f"Q {anchor.question_no}"
    return None


def icon_for(source_type: Optional[str], anchor: Anchor, text_kind: Optional[str] = None) -> str:
    st = (source_type or "").upper()
    kind = (text_kind or "").lower()
    if st in _QUIZ_TYPES or kind == "questions":
        return ICON_QUIZ
    if st in _VIDEO_TYPES or kind in _VIDEO_KINDS or anchor.kind == ANCHOR_TIME:
        return ICON_VIDEO
    if kind == "pdf" or anchor.kind == ANCHOR_PAGE:
        return ICON_PDF
    return ICON_SLIDE


def deep_link(entry: Any, anchor: Anchor) -> str:
    """slide_link for the lesson in the batch the learner sees it in, plus the
    page or second to open at."""
    href = slide_link({
        "package_id": _field(entry, "package_id"),
        "level_id": _field(entry, "level_id"),
        "subject_id": _field(entry, "subject_id"),
        "module_id": _field(entry, "module_id"),
        "chapter_id": _field(entry, "chapter_id"),
        "slide_id": _field(entry, "slide_id"),
        "package_session_id": _field(entry, "package_session_id"),
    })
    if anchor.kind == ANCHOR_PAGE and anchor.page:
        return f"{href}&page={anchor.page}"
    if anchor.kind == ANCHOR_TIME and anchor.seconds:
        return f"{href}&t={anchor.seconds}"
    return href


def locked_link(entry: Any) -> str:
    """A COMING UP lesson links to its course page, never to the lesson."""
    return course_link(_field(entry, "package_id") or "", _field(entry, "package_session_id") or "")


def label_for(chapter_title: Optional[str], title: Optional[str], badge: Optional[str]) -> str:
    """'Chapter › Lesson (p. 12)'."""
    parts = [p for p in ((chapter_title or "").strip(), (title or "").strip()) if p]
    text = " › ".join(parts) or "Lesson"
    return f"{text} ({badge})" if badge else text


def cite(entry: Any, page_start: Any = None, page_end: Any = None,
         meta: Optional[Mapping[str, Any]] = None) -> Citation:
    """Everything a passage of `entry` (an access.Entry or a mapping with the
    same fields) needs to be cited and opened."""
    meta = meta or {}
    anchor = anchor_of(page_start, page_end, meta)
    badge = badge_for(anchor)
    return Citation(
        href=deep_link(entry, anchor),
        badge=badge,
        icon=icon_for(_field(entry, "source_type"), anchor, meta.get("text_kind")),
        label=label_for(_field(entry, "chapter_title"), _field(entry, "title"), badge),
        anchor=anchor,
    )


def locked_badge(unlock_hint: Optional[str]) -> str:
    """'Locked · unlocks 12 Nov' for a date rule, else 'Locked'. The learner app
    shows any badge starting with 'Locked' muted, with a lock icon."""
    for part in (unlock_hint or "").split(";"):
        part = part.strip()
        if part.startswith(_LOCKED_DATE_PREFIX):
            return "Locked · unlocks " + part[len(_LOCKED_DATE_PREFIX):].strip()
    return "Locked"


def page_label(page_start: Any, page_end: Any = None) -> Optional[str]:
    """'p. 12' or 'pp. 12–13' for reference material (no deep link)."""
    start = _positive_int(page_start)
    if start is None:
        return None
    end = _positive_int(page_end)
    return f"pp. {start}–{end}" if end and end > start else f"p. {start}"


__all__ = [
    "Anchor", "Citation", "anchor_of", "badge_for", "icon_for", "deep_link", "locked_link",
    "label_for", "cite", "locked_badge", "page_label", "clock",
    "ANCHOR_NONE", "ANCHOR_PAGE", "ANCHOR_TIME", "ANCHOR_STEP", "ANCHOR_QUESTION",
    "ICON_PDF", "ICON_VIDEO", "ICON_QUIZ", "ICON_SLIDE",
]
