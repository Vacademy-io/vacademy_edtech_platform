"""The only learner-to-lessons path: which course lessons a learner may read
right now, classified OPEN or COMING_UP. HIDDEN lessons (not enrolled, not
visible, drip hide/both, assessments) are simply absent.

resolve_scope runs every query in ONE short session (enrolments, the visible
tree, the course outline, the institute drip settings and, in mirror mode,
learner progress), then evaluates drip in pure Python. The caller must close
that session before any embedding or LLM call.

Drip is evaluated exactly as the learner app does (drip.py is the port):
- master switch COURSE_SETTING.data.dripConditions.enabled
  (use-course-drip-schedule.ts conditionFor);
- lessons and chapters: the settings-blob condition, then the row's own
  drip_condition_json, then the package row condition; the row path applies
  only when the switch is on (slides/index.tsx, course-structure-details.tsx);
- lesson index = position within its chapter (assessments count), with the
  previous lesson's completion and the earlier lessons' scores; prerequisite
  completions for other chapters are 0, the slide viewer's own limitation,
  mirrored so the AI is never looser than the app;
- chapter index = course-wide order (subject, module, chapter); subjects and
  modules are evaluated on rolled-up percentages through the settings path only;
- cascade: a hidden parent hides its lessons, a locked parent locks them.
Any exception while evaluating an item locks it (fail closed, never open).

No admin_core HTTP call: admin_core computes no lock state and its enrolment
guard is off by default. is_root_user is never consulted.

CAST(... AS ...) IS MANDATORY — NEVER ``::`` after a bind parameter.
"""
from __future__ import annotations

import logging
import math
import re
import threading
import time
from dataclasses import dataclass, field, replace
from datetime import datetime, timezone
from typing import Any, Callable, Dict, FrozenSet, List, Mapping, Optional, Sequence, Tuple
from zoneinfo import ZoneInfo

from sqlalchemy import bindparam, text
from sqlalchemy.orm import Session

from . import drip, flags, tree

logger = logging.getLogger(__name__)

DEFAULT_TZ = "Asia/Kolkata"
CACHE_TTL_SECONDS = 60.0
# Each scope holds one Entry per lesson (~1.6 KB), so keep the count small.
_CACHE_MAX_ENTRIES = 512

STATE_OPEN = "OPEN"
STATE_COMING_UP = "COMING_UP"

TIER_CURRENT_SLIDE = 0
TIER_CURRENT_CHAPTER = 1
TIER_CURRENT_BATCH = 2
TIER_OTHER = 3

HINT_EARLIER = "After you finish the earlier lessons"
HINT_NOT_YET = "Not open yet"
STAFF_PREVIEW_MODE = "staff_preview"

# Which learner_operation holds each lesson's percentage, per source_type
# (LearnerStudyLibraryService.SLIDE_PERCENT_OPERATIONS; HTML_VIDEO has none).
SLIDE_PERCENT_OPERATIONS: Mapping[str, str] = {
    "VIDEO": "PERCENTAGE_VIDEO_WATCHED",
    "DOCUMENT": "PERCENTAGE_DOCUMENT_COMPLETED",
    "QUESTION": "PERCENTAGE_QUESTION_COMPLETED",
    "ASSIGNMENT": "PERCENTAGE_ASSIGNMENT_COMPLETED",
    "QUIZ": "PERCENTAGE_QUIZ_COMPLETED",
    "SCORM": "PERCENTAGE_SCORM_COMPLETED",
    "AUDIO": "PERCENTAGE_AUDIO_LISTENED",
    "ASSESSMENT": "PERCENTAGE_ASSESSMENT_DONE",
}
CHAPTER_PERCENT_OPERATION = "PERCENTAGE_CHAPTER_COMPLETED"
MODULE_PERCENT_OPERATION = "PERCENTAGE_MODULE_COMPLETED"

_MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")
_NUMERIC = re.compile(r"^[0-9]+(\.[0-9]+)?$")
_IN_BATCH = 1000

# StudentSessionInstituteGroupMappingRepository (ACTIVE, not an abandoned cart
# or failed payment) plus the expiry check (the expiry sweep is opt-in), and the
# batch's package must belong to this institute (defense in depth).
# Batch and course status as the learner app lists them (LearnerPackageService:
# package ACTIVE, package_session ACTIVE or HIDDEN): deleting a batch or course
# leaves the enrolment row ACTIVE, so the mapping alone is not enough.
_ENROLMENTS_SQL = text(
    """
    SELECT m.package_session_id, m.enrolled_date, ps.package_id, ps.level_id, s.start_date
    FROM student_session_institute_group_mapping m
    JOIN package_session ps ON ps.id = m.package_session_id
    JOIN package p ON p.id = ps.package_id
    LEFT JOIN session s ON s.id = ps.session_id
    WHERE m.user_id = :u AND m.institute_id = :i AND m.status = 'ACTIVE'
      AND ps.status IN ('ACTIVE', 'HIDDEN')
      AND p.status = 'ACTIVE'
      AND (m.type IS NULL OR m.type NOT IN ('ABANDONED_CART', 'PAYMENT_FAILED'))
      AND (m.expiry_date IS NULL OR m.expiry_date > now())
      AND EXISTS (SELECT 1 FROM package_institute pi
                  WHERE pi.package_id = ps.package_id AND pi.institute_id = :i)
    ORDER BY m.enrolled_date NULLS LAST, m.package_session_id
    """
)

_SETTINGS_SQL = text("SELECT setting_json FROM institutes WHERE id = :i")

_PROGRESS_SQL = text(
    """
    SELECT source, source_id, operation, value
    FROM learner_operation
    WHERE user_id = :u
      AND source IN ('SLIDE', 'CHAPTER', 'MODULE')
      AND operation IN :ops
      AND source_id IN :ids
    ORDER BY updated_at NULLS FIRST
    """
).bindparams(bindparam("ops", expanding=True), bindparam("ids", expanding=True))


# ── Result types ─────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class Entry:
    slide_id: str
    title: Optional[str]
    source_type: Optional[str]
    package_id: Optional[str]
    package_session_id: str
    level_id: Optional[str]
    subject_id: str
    module_id: str
    chapter_id: str
    chapter_title: Optional[str]
    order: int
    state: str
    unlock_hint: Optional[str] = None
    # Every chapter / batch the lesson is visible in (it can sit in several).
    chapter_ids: FrozenSet[str] = frozenset()
    package_session_ids: FrozenSet[str] = frozenset()


@dataclass(frozen=True)
class ResolvedScope:
    user_id: str
    institute_id: str
    tz: str
    drip_mode: str
    entries: Mapping[str, Entry] = field(default_factory=dict)
    current_slide_id: Optional[str] = None
    current_chapter_id: Optional[str] = None
    current_package_session_id: Optional[str] = None
    package_session_ids: Tuple[str, ...] = ()
    # Chapters / batches holding at least one OPEN lesson (where hints may point).
    open_chapter_ids: FrozenSet[str] = frozenset()
    open_package_session_ids: FrozenSet[str] = frozenset()

    def _ids(self, state: str) -> List[str]:
        return [e.slide_id for e in sorted(self.entries.values(), key=lambda e: e.order) if e.state == state]

    def open_ids(self) -> List[str]:
        return self._ids(STATE_OPEN)

    def coming_up_ids(self) -> List[str]:
        return self._ids(STATE_COMING_UP)

    def is_open(self, slide_id: Optional[str]) -> bool:
        e = self.entries.get(slide_id) if slide_id else None
        return e is not None and e.state == STATE_OPEN

    def tier_of(self, slide_id: str) -> int:
        """0 = current slide, 1 = current chapter, 2 = current batch, 3 = other."""
        if self.current_slide_id and slide_id == self.current_slide_id:
            return TIER_CURRENT_SLIDE
        e = self.entries.get(slide_id)
        if e is None:
            return TIER_OTHER
        if self.current_chapter_id and self.current_chapter_id in e.chapter_ids:
            return TIER_CURRENT_CHAPTER
        if self.current_package_session_id and self.current_package_session_id in e.package_session_ids:
            return TIER_CURRENT_BATCH
        return TIER_OTHER

    @property
    def is_empty(self) -> bool:
        return not self.entries


@dataclass(frozen=True)
class Enrolment:
    package_session_id: str
    enrolled_date: Any
    package_id: Optional[str]
    level_id: Optional[str]
    start_date: Any


@dataclass
class LearnerProgress:
    """learner_operation percentages (mirror mode only; empty = nothing done)."""
    slide: Dict[Tuple[str, str], float] = field(default_factory=dict)
    chapter: Dict[str, float] = field(default_factory=dict)
    module: Dict[str, float] = field(default_factory=dict)

    def slide_pct(self, slide_id: str, source_type: Optional[str]) -> float:
        op = SLIDE_PERCENT_OPERATIONS.get((source_type or "").upper())
        return self.slide.get((slide_id, op), 0.0) if op else 0.0

    def chapter_pct(self, chapter_id: str) -> float:
        return self.chapter.get(chapter_id, 0.0)

    def module_pct(self, module_id: str) -> Optional[float]:
        return self.module.get(module_id)


# ── Time zone and cache ──────────────────────────────────────────────────────

def normalize_tz(tz: Optional[str]) -> str:
    """A valid IANA zone name, else DEFAULT_TZ."""
    if isinstance(tz, str) and tz.strip():
        name = tz.strip()
        try:
            ZoneInfo(name)
            return name
        except Exception:  # noqa: BLE001 - unknown / malformed zone names fall back
            return DEFAULT_TZ
    return DEFAULT_TZ


_cache: Dict[tuple, Tuple[float, ResolvedScope]] = {}
_cache_lock = threading.Lock()


def cache_key(user_id: str, institute_id: str, tz: str, drip_mode: str, now: datetime) -> tuple:
    return (user_id, institute_id, tz, drip_mode, int(now.timestamp() // 60))


def _cache_get(key: tuple) -> Optional[ResolvedScope]:
    with _cache_lock:
        hit = _cache.get(key)
        if hit is None:
            return None
        if hit[0] <= time.monotonic():
            _cache.pop(key, None)
            return None
        return hit[1]


def _cache_put(key: tuple, scope: ResolvedScope) -> None:
    """Insert, dropping expired scopes on every put. The key carries a minute
    bucket, so past keys are never looked up again; without this sweep they
    would sit in memory until the size cap. Entries are kept in insertion order
    with a fixed TTL, so the dict's order is expiry order and the sweep only
    walks the expired head."""
    now = time.monotonic()
    with _cache_lock:
        _cache.pop(key, None)  # re-insert at the tail so order stays expiry order
        while _cache:
            oldest = next(iter(_cache))
            if _cache[oldest][0] > now and len(_cache) < _CACHE_MAX_ENTRIES:
                break
            _cache.pop(oldest, None)
        _cache[key] = (now + CACHE_TTL_SECONDS, scope)


def invalidate_cache() -> None:
    with _cache_lock:
        _cache.clear()


# ── Public entry points ──────────────────────────────────────────────────────

def resolve_scope(
    db: Optional[Session],
    *,
    user_id: str,
    institute_id: str,
    tz: Optional[str] = None,
    hint_slide_id: Optional[str] = None,
    hint_chapter_id: Optional[str] = None,
    hint_package_session_id: Optional[str] = None,
    now: Optional[datetime] = None,
    drip_mode: Optional[str] = None,
) -> ResolvedScope:
    """The lessons this learner may read, OPEN or COMING_UP.

    `db` is one short session the caller closes before any embedding or LLM
    call; with db=None a short session is opened and closed here. Results are
    cached in-process for 60 s per (user, institute, tz, drip mode, minute).
    Client hints only pick the current slide / chapter / batch, and only when
    they fall inside the OPEN set."""
    tz_name = normalize_tz(tz)
    mode = drip_mode if drip_mode in drip.DRIP_MODES else flags.drip_mode()
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    if not user_id or not institute_id:
        return ResolvedScope(user_id=user_id or "", institute_id=institute_id or "", tz=tz_name, drip_mode=mode)

    key = cache_key(user_id, institute_id, tz_name, mode, now)
    base = _cache_get(key)
    if base is None:
        if db is None:
            from ...db import db_session
            with db_session() as session:
                base = _compute(session, user_id, institute_id, tz_name, mode, now)
        else:
            base = _compute(db, user_id, institute_id, tz_name, mode, now)
        _cache_put(key, base)
    return apply_hints(base, hint_slide_id=hint_slide_id, hint_chapter_id=hint_chapter_id,
                       hint_package_session_id=hint_package_session_id)


def apply_hints(
    scope: ResolvedScope,
    *,
    hint_slide_id: Optional[str] = None,
    hint_chapter_id: Optional[str] = None,
    hint_package_session_id: Optional[str] = None,
) -> ResolvedScope:
    """Set the current slide / chapter / batch from client hints that fall
    inside the OPEN set; anything else is ignored. A valid current slide
    supplies the chapter and batch the client did not (validly) name."""
    slide = hint_slide_id if scope.is_open(hint_slide_id) else None
    entry = scope.entries.get(slide) if slide else None
    chapter = hint_chapter_id if hint_chapter_id and hint_chapter_id in scope.open_chapter_ids else None
    batch = (hint_package_session_id
             if hint_package_session_id and hint_package_session_id in scope.open_package_session_ids else None)
    if entry is not None:
        chapter = chapter or entry.chapter_id
        batch = batch or entry.package_session_id
    return replace(scope, current_slide_id=slide, current_chapter_id=chapter, current_package_session_id=batch)


def staff_preview_scope(db: Session, institute_id: str, package_id: str) -> ResolvedScope:
    """Every visible non-assessment lesson of the package, all OPEN, drip
    ignored. Only for the staff preview endpoint."""
    rows = [r for r in tree.package_slide_tree(db, institute_id, package_id) if not r.is_assessment]
    entries: Dict[str, Entry] = {}
    chapters: Dict[str, set] = {}
    batches: Dict[str, set] = {}
    for order, r in enumerate(rows):
        chapters.setdefault(r.slide_id, set()).add(r.chapter_id)
        batches.setdefault(r.slide_id, set()).add(r.package_session_id)
        if r.slide_id not in entries:
            entries[r.slide_id] = _entry(r, order, STATE_OPEN, None)
    for sid, e in entries.items():
        entries[sid] = replace(e, chapter_ids=frozenset(chapters[sid]), package_session_ids=frozenset(batches[sid]))
    return ResolvedScope(
        user_id="", institute_id=institute_id or "", tz=DEFAULT_TZ, drip_mode=STAFF_PREVIEW_MODE,
        entries=entries,
        package_session_ids=tuple(dict.fromkeys(r.package_session_id for r in rows)),
        open_chapter_ids=frozenset(r.chapter_id for r in rows),
        open_package_session_ids=frozenset(r.package_session_id for r in rows),
    )


# ── Loading (one short session) ──────────────────────────────────────────────

def _compute(db: Session, user_id: str, institute_id: str, tz_name: str, mode: str, now: datetime) -> ResolvedScope:
    enrolments = load_enrolments(db, user_id, institute_id)
    if not enrolments:
        return ResolvedScope(user_id=user_id, institute_id=institute_id, tz=tz_name, drip_mode=mode)
    ps_ids = [e.package_session_id for e in enrolments]
    rows = tree.learner_slide_tree(db, ps_ids)
    outline = tree.learner_course_outline(db, ps_ids)
    settings_raw = db.execute(_SETTINGS_SQL, {"i": institute_id}).scalar()
    progress = load_progress(db, user_id, rows, outline) if mode == drip.MODE_MIRROR else LearnerProgress()
    return build_scope(
        user_id=user_id, institute_id=institute_id, tz_name=tz_name, mode=mode, now=now,
        enrolments=enrolments, rows=rows, outline=outline, settings_raw=settings_raw, progress=progress,
    )


def load_enrolments(db: Session, user_id: str, institute_id: str) -> List[Enrolment]:
    out: Dict[str, Enrolment] = {}
    for r in db.execute(_ENROLMENTS_SQL, {"u": user_id, "i": institute_id}).mappings():
        ps = r["package_session_id"]
        if ps and ps not in out:
            out[ps] = Enrolment(ps, r["enrolled_date"], r["package_id"], r["level_id"], r["start_date"])
    return list(out.values())


def _pct(value: Any) -> Optional[float]:
    if value is None:
        return None
    s = str(value).strip()
    return float(s) if _NUMERIC.match(s) else None


def load_progress(db: Session, user_id: str, rows: Sequence[tree.TreeRow],
                  outline: Sequence[tree.OutlineRow]) -> LearnerProgress:
    ids = list(dict.fromkeys(
        [r.slide_id for r in rows]
        + [r.chapter_id for r in rows] + [o.chapter_id for o in outline if o.chapter_id]
        + [r.module_id for r in rows] + [o.module_id for o in outline if o.module_id]
    ))
    ops = sorted(set(SLIDE_PERCENT_OPERATIONS.values()) | {CHAPTER_PERCENT_OPERATION, MODULE_PERCENT_OPERATION})
    progress = LearnerProgress()
    for i in range(0, len(ids), _IN_BATCH):
        chunk = ids[i:i + _IN_BATCH]
        for r in db.execute(_PROGRESS_SQL, {"u": user_id, "ops": ops, "ids": chunk}).mappings():
            source, sid, op, value = r["source"], r["source_id"], r["operation"], r["value"]
            if source == "SLIDE":
                v = _pct(value)
                if v is not None:
                    progress.slide[(sid, op)] = v
            elif source == "CHAPTER" and op == CHAPTER_PERCENT_OPERATION:
                # MAX over rows, non-numeric as 0 (ModuleChapterMappingRepository).
                progress.chapter[sid] = max(progress.chapter.get(sid, 0.0), _pct(value) or 0.0)
            elif source == "MODULE" and op == MODULE_PERCENT_OPERATION:
                v = _pct(value)
                if v is not None:
                    progress.module[sid] = v
    return progress


# ── Evaluation (pure) ────────────────────────────────────────────────────────

@dataclass(frozen=True)
class _Judged:
    """One item's drip result plus the item before it (kind, id), which a
    sequential hint names when that item is visible to the learner."""
    evaluation: drip.Evaluation
    previous: Optional[Tuple[str, str]] = None


_OPEN_JUDGED = _Judged(drip.OPEN)


def _js_round(x: float) -> float:
    """Math.round (halves towards +Infinity)."""
    return float(math.floor(x + 0.5))


def _judge(pick: Callable[[], Any], progress: drip.ProgressData, *, now: datetime, zone, mode: str,
           previous: Optional[Tuple[str, str]], what: str) -> _Judged:
    """Pick the governing condition and evaluate it; any exception locks."""
    condition = None
    try:
        condition = pick()
        if condition is None:
            return _OPEN_JUDGED
        return _Judged(drip.evaluate_drip_condition(condition, progress, now, tz=zone, mode=mode), previous)
    except Exception as exc:  # noqa: BLE001 - fail closed, never open
        logger.warning("course_kb.drip_eval_failed item=%s error=%s", what, type(exc).__name__)
        return _Judged(drip.fail_closed(condition), previous)


def _row_path_condition(configured: Any, row: Any, package: Any, row_path_enabled: bool) -> Any:
    """`configured || row || package`, evaluated only when the row path is on
    or a configured condition exists, and the pick is not disabled."""
    truthy = drip.js_truthy
    condition = next((c for c in (configured, row, package) if truthy(c)), package)
    has = truthy(configured) or truthy(row) or truthy(package)
    should = ((row_path_enabled or truthy(configured)) and has
              and not (isinstance(condition, dict) and condition.get("is_enabled") is False))
    return condition if should and truthy(condition) else None


def _entry(r: tree.TreeRow, order: int, state: str, hint: Optional[str]) -> Entry:
    return Entry(
        slide_id=r.slide_id, title=r.title, source_type=r.source_type, package_id=r.package_id,
        package_session_id=r.package_session_id, level_id=r.level_id, subject_id=r.subject_id,
        module_id=r.module_id, chapter_id=r.chapter_id, chapter_title=r.chapter_title,
        order=order, state=state, unlock_hint=hint,
    )


def build_scope(
    *,
    user_id: str,
    institute_id: str,
    tz_name: str,
    mode: str,
    now: datetime,
    enrolments: Sequence[Enrolment],
    rows: Sequence[tree.TreeRow],
    outline: Sequence[tree.OutlineRow],
    settings_raw: Any,
    progress: LearnerProgress,
) -> ResolvedScope:
    zone = ZoneInfo(tz_name)
    try:
        settings = drip.parse_course_settings_drip_conditions(settings_raw)
    except Exception as exc:  # noqa: BLE001 - the app reads an unreadable blob as "no drip"
        logger.warning("course_kb.drip_settings_unreadable institute=%s error=%s", institute_id, type(exc).__name__)
        settings = drip.EMPTY_SETTINGS

    rows_by_ps: Dict[str, List[tree.TreeRow]] = {}
    for r in rows:
        rows_by_ps.setdefault(r.package_session_id, []).append(r)
    outline_by_ps: Dict[str, List[tree.OutlineRow]] = {}
    for o in outline:
        outline_by_ps.setdefault(o.package_session_id, []).append(o)

    best: Dict[str, Entry] = {}
    best_locks: Dict[str, List[_Judged]] = {}
    visible: List[tree.TreeRow] = []
    seen_chapters: Dict[str, set] = {}
    seen_batches: Dict[str, set] = {}
    open_chapters: set = set()
    open_batches: set = set()
    order = 0

    for enrolment in enrolments:
        ps_rows = rows_by_ps.get(enrolment.package_session_id, [])
        if not ps_rows:
            continue
        judged = _judge_batch(
            enrolment, ps_rows, outline_by_ps.get(enrolment.package_session_id, []), settings, progress,
            now=now, zone=zone, mode=mode,
        )
        for r in ps_rows:
            if r.is_assessment:
                continue
            chain = [
                judged.subjects.get(r.subject_id, _OPEN_JUDGED),
                judged.modules.get(r.module_id, _OPEN_JUDGED),
                judged.chapters.get(r.chapter_id, _OPEN_JUDGED),
                judged.slides.get((r.chapter_id, r.slide_id), _OPEN_JUDGED),
            ]
            if any(j.evaluation.is_hidden for j in chain):
                continue
            locked = [j for j in chain if j.evaluation.is_locked]
            state = STATE_COMING_UP if locked else STATE_OPEN
            visible.append(r)
            order += 1
            seen_chapters.setdefault(r.slide_id, set()).add(r.chapter_id)
            seen_batches.setdefault(r.slide_id, set()).add(r.package_session_id)
            if state == STATE_OPEN:
                open_chapters.add(r.chapter_id)
                open_batches.add(r.package_session_id)
            current = best.get(r.slide_id)
            # OPEN in any enrolled batch is OPEN; otherwise the first occurrence.
            if current is None or (current.state != STATE_OPEN and state == STATE_OPEN):
                best[r.slide_id] = _entry(r, order, state, None)
                best_locks[r.slide_id] = locked

    # Hints may name only what the learner can already see: never an
    # assessment, a hidden lesson, or a chapter / module / subject with no
    # visible lesson ("not even the title").
    names = _VisibleNames(visible)
    entries = {}
    for sid, e in best.items():
        hint = _unlock_hint(best_locks[sid], zone, now, names) if e.state == STATE_COMING_UP else None
        entries[sid] = replace(e, unlock_hint=hint, chapter_ids=frozenset(seen_chapters[sid]),
                               package_session_ids=frozenset(seen_batches[sid]))
    return ResolvedScope(
        user_id=user_id, institute_id=institute_id, tz=tz_name, drip_mode=mode, entries=entries,
        package_session_ids=tuple(e.package_session_id for e in enrolments),
        open_chapter_ids=frozenset(open_chapters), open_package_session_ids=frozenset(open_batches),
    )


@dataclass
class _BatchJudgement:
    subjects: Dict[str, _Judged]
    modules: Dict[str, _Judged]
    chapters: Dict[str, _Judged]
    slides: Dict[Tuple[str, str], _Judged]


def _judge_batch(
    enrolment: Enrolment,
    ps_rows: Sequence[tree.TreeRow],
    ps_outline: Sequence[tree.OutlineRow],
    settings: drip.ResolvedDripConditions,
    progress: LearnerProgress,
    *,
    now: datetime,
    zone,
    mode: str,
) -> _BatchJudgement:
    package_id = enrolment.package_id
    package_drip = next((r.package_drip_condition_json for r in ps_rows if r.package_drip_condition_json), None)
    anchors = {"enrollment_date": enrolment.enrolled_date, "session_start_date": enrolment.start_date}
    apply_rules = settings.apply_configured_rules

    def configured(level: str, level_id: str) -> Any:
        if not settings.enabled:
            return None
        return drip.resolve_drip_condition(
            settings.conditions, level=level, level_id=level_id, package_id=package_id,
            apply_configured_rules=apply_rules,
        )

    # Course structure in course order (the app's subjectModulesMap): subjects,
    # module occurrences per subject, chapter occurrences per module. The outline
    # keeps empty modules and chapters; the lesson rows fill in anything missing.
    subjects: List[str] = []
    modules: List[Tuple[str, str]] = []
    chapters: List[Tuple[str, str, str]] = []
    chapter_drip: Dict[str, Optional[str]] = {}
    seen: set = set()

    def add(subject_id, module_id, chapter_id, chapter_json):
        if ("s", subject_id) not in seen:
            seen.add(("s", subject_id))
            subjects.append(subject_id)
        if module_id and ("m", subject_id, module_id) not in seen:
            seen.add(("m", subject_id, module_id))
            modules.append((subject_id, module_id))
        if module_id and chapter_id and ("c", subject_id, module_id, chapter_id) not in seen:
            seen.add(("c", subject_id, module_id, chapter_id))
            chapter_drip.setdefault(chapter_id, chapter_json)
            chapters.append((subject_id, module_id, chapter_id))

    structure: List[tuple] = []
    for o in ps_outline:
        structure.append(((tree._nulls_last(o.subject_order), o.subject_id),
                          (tree._nulls_last(o.module_order), o.module_id or ""),
                          (tree._nulls_last(o.chapter_order), o.chapter_id or ""),
                          (o.subject_id, o.module_id, o.chapter_id, o.chapter_drip_condition_json)))
    for r in ps_rows:
        structure.append(((tree._nulls_last(r.subject_order), r.subject_id),
                          (tree._nulls_last(r.module_order), r.module_id),
                          (tree._nulls_last(r.chapter_order), r.chapter_id),
                          (r.subject_id, r.module_id, r.chapter_id, r.chapter_drip_condition_json)))
    structure.sort(key=lambda s: (s[0], s[1], s[2]))
    for *_, args in structure:
        add(*args)

    # Subjects and modules: rolled-up percentages, settings-blob path only.
    def module_pct(module_id: str) -> float:
        return _js_round(progress.module_pct(module_id) or 0.0)

    def subject_pct(subject_id: str) -> float:
        counted = [p for s, m in modules if s == subject_id
                   for p in [progress.module_pct(m)] if p is not None]
        return _js_round(sum(counted) / len(counted)) if counted else 0.0

    def containers(level: str, items: List[Tuple[str, float]]) -> Dict[str, _Judged]:
        out: Dict[str, _Judged] = {}
        completions = {item_id: pct for item_id, pct in items}
        for i, (item_id, pct) in enumerate(items):
            prev = items[i - 1] if i > 0 else None
            data = drip.ProgressData(
                percentage_completed=pct,
                previous_item_id=prev[0] if prev else None,
                previous_item_completion=prev[1] if prev else 0,
                item_index=i,
                prerequisite_completions=completions,
                recent_scores=[p for _, p in items[:i]],
                **anchors,
            )

            def pick(item_id=item_id):
                condition = configured(level, item_id)
                if not drip.js_truthy(condition) or (isinstance(condition, dict)
                                                     and condition.get("is_enabled") is False):
                    return None
                return condition

            out[item_id] = _judge(pick, data, now=now, zone=zone, mode=mode,
                                  previous=(level, prev[0]) if prev else None, what=f"{level}:{item_id}")
        return out

    subject_judged = containers("subject", [(s, subject_pct(s)) for s in subjects])
    module_judged = containers("module", [(m, module_pct(m)) for _, m in modules])

    # Chapters: course-wide flattened order; the last occurrence wins, as in the app.
    chapter_judged: Dict[str, _Judged] = {}
    chapter_ids = [c for _, _, c in chapters]
    chapter_completions = {c: progress.chapter_pct(c) for c in chapter_ids}
    package_chapter_condition = _safe(lambda: drip.package_condition_for_level(package_drip, "chapter"))
    for i, cid in enumerate(chapter_ids):
        prev = chapter_ids[i - 1] if i > 0 else None
        data = drip.ProgressData(
            percentage_completed=progress.chapter_pct(cid),
            previous_item_id=prev,
            previous_item_completion=progress.chapter_pct(prev) if prev else 0,
            item_index=i,
            prerequisite_completions=chapter_completions,
            recent_scores=[progress.chapter_pct(c) for c in chapter_ids[:i]],
            **anchors,
        )

        def pick_chapter(cid=cid):
            if isinstance(package_chapter_condition, Exception):
                raise package_chapter_condition
            return _row_path_condition(
                configured("chapter", cid), drip.row_condition_for_level(chapter_drip.get(cid), "chapter"),
                package_chapter_condition, settings.row_path_enabled,
            )

        chapter_judged[cid] = _judge(pick_chapter, data, now=now, zone=zone, mode=mode,
                                     previous=("chapter", prev) if prev else None, what=f"chapter:{cid}")

    # Lessons: position within the chapter (the slide viewer's list, assessments
    # included). Prerequisites see only this chapter's lessons and its overall
    # completion; every other chapter and lesson counts as 0.
    slide_judged: Dict[Tuple[str, str], _Judged] = {}
    by_chapter: Dict[str, List[tree.TreeRow]] = {}
    for r in sorted(ps_rows, key=lambda r: (tree._nulls_last(r.slide_order), r.slide_id)):
        lst = by_chapter.setdefault(r.chapter_id, [])
        if all(x.slide_id != r.slide_id for x in lst):
            lst.append(r)
    package_slide_condition = _safe(lambda: drip.package_condition_for_level(package_drip, "slide"))
    for cid, lessons in by_chapter.items():
        pcts = [progress.slide_pct(r.slide_id, r.source_type) for r in lessons]
        completions: Dict[str, float] = {r.slide_id: p for r, p in zip(lessons, pcts)}
        completions[cid] = min(_js_round(sum(min(p, 100.0) for p in pcts) / len(pcts)), 100.0) if pcts else 0.0
        for i, r in enumerate(lessons):
            prev = lessons[i - 1] if i > 0 else None
            data = drip.ProgressData(
                percentage_completed=pcts[i],
                previous_item_id=prev.slide_id if prev else None,
                previous_item_completion=pcts[i - 1] if prev else 0,
                item_index=i,
                prerequisite_completions=completions,
                recent_scores=pcts[:i],
                **anchors,
            )

            def pick_slide(r=r):
                if isinstance(package_slide_condition, Exception):
                    raise package_slide_condition
                return _row_path_condition(
                    configured("slide", r.slide_id), drip.row_condition_for_level(r.slide_drip_condition_json, "slide"),
                    package_slide_condition, settings.row_path_enabled,
                )

            slide_judged[(cid, r.slide_id)] = _judge(
                pick_slide, data, now=now, zone=zone, mode=mode,
                previous=("slide", prev.slide_id) if prev else None, what=f"slide:{r.slide_id}",
            )

    return _BatchJudgement(subject_judged, module_judged, chapter_judged, slide_judged)


def _safe(fn: Callable[[], Any]) -> Any:
    """Run fn; return its exception instead of raising, so the items that use
    the value fail closed one by one."""
    try:
        return fn()
    except Exception as exc:  # noqa: BLE001
        return exc


# ── Unlock hints ─────────────────────────────────────────────────────────────

def _titles_phrase(titles: List[str]) -> str:
    if len(titles) == 1:
        return titles[0]
    if len(titles) <= 3:
        return ", ".join(titles[:-1]) + " and " + titles[-1]
    return ", ".join(titles[:3]) + f" and {len(titles) - 3} more"


def format_unlock_date(when: datetime, zone, now: datetime) -> str:
    """'12 Nov' in the learner's zone ('12 Nov 2027' outside the current year)."""
    d = when.astimezone(zone)
    label = f"{d.day} {_MONTHS[d.month - 1]}"
    return label if d.year == now.astimezone(zone).year else f"{label} {d.year}"


class _VisibleNames:
    """Titles of the lessons, chapters, modules and subjects the learner sees."""

    def __init__(self, visible: Sequence[tree.TreeRow]):
        self.by_kind: Dict[str, Dict[str, str]] = {"slide": {}, "chapter": {}, "module": {}, "subject": {}}
        for r in visible:
            for kind, item_id, name in (("slide", r.slide_id, r.title), ("chapter", r.chapter_id, r.chapter_title),
                                        ("module", r.module_id, r.module_name),
                                        ("subject", r.subject_id, r.subject_name)):
                if name and name.strip():
                    self.by_kind[kind].setdefault(item_id, name.strip())

    def of(self, ref: Optional[Tuple[str, str]]) -> Optional[str]:
        return self.by_kind.get(ref[0], {}).get(ref[1]) if ref else None

    def any_of(self, item_id: str) -> Optional[str]:
        return self.by_kind["slide"].get(item_id) or self.by_kind["chapter"].get(item_id)


def _unlock_hint(locked: Sequence[_Judged], zone, now: datetime, names: _VisibleNames) -> str:
    latest: Optional[datetime] = None
    phrases: List[str] = []
    for j in locked:
        ev = j.evaluation
        if ev.error or not ev.failed_rules:
            phrases.append(HINT_NOT_YET)
            continue
        for rule in ev.failed_rules:
            if rule.rule_type in drip.TIME_RULE_TYPES:
                if rule.unlock_at is not None:
                    latest = rule.unlock_at if latest is None or rule.unlock_at > latest else latest
                else:
                    phrases.append(HINT_NOT_YET)
            elif rule.rule_type == "sequential":
                previous = names.of(j.previous)
                phrases.append(f"After you finish {previous}" if previous else HINT_EARLIER)
            elif rule.rule_type == "prerequisite":
                titles = [t for t in (names.any_of(i) for i in rule.pending_ids) if t]
                titles = list(dict.fromkeys(titles))
                phrases.append(f"After you complete {_titles_phrase(titles)}" if titles else HINT_EARLIER)
            else:
                phrases.append(HINT_EARLIER)
    parts = [f"Unlocks on {format_unlock_date(latest, zone, now)}"] if latest is not None else []
    parts.extend(dict.fromkeys(phrases))
    if len(parts) > 1 and HINT_NOT_YET in parts:
        parts.remove(HINT_NOT_YET)
    return "; ".join(parts) or HINT_NOT_YET


__all__ = [
    "DEFAULT_TZ", "CACHE_TTL_SECONDS", "STATE_OPEN", "STATE_COMING_UP",
    "TIER_CURRENT_SLIDE", "TIER_CURRENT_CHAPTER", "TIER_CURRENT_BATCH", "TIER_OTHER",
    "SLIDE_PERCENT_OPERATIONS", "Entry", "ResolvedScope", "Enrolment", "LearnerProgress",
    "normalize_tz", "cache_key", "invalidate_cache", "resolve_scope", "apply_hints",
    "staff_preview_scope", "load_enrolments", "load_progress", "build_scope", "format_unlock_date",
]
