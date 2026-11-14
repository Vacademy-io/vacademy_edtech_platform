"""The visible course tree: which lessons a batch exposes, read straight from
the admin_core tables (short-session SQL helpers; the caller owns the session).

VISIBLE copies admin_core's learner rule, not the looser tutor SQL in
tutor/slide_source.py. A lesson is visible in a batch (package_session) when
every link of the chain holds:
  chapter_package_session_mapping ACTIVE -> chapter ACTIVE
  -> module_chapter_mapping -> modules ACTIVE
  -> subject_module_mapping -> subject ACTIVE
  -> subject_session for the SAME batch (session_id is the package_session id)
  -> chapter_to_slides PUBLISHED/UNSYNC -> slide PUBLISHED/UNSYNC.
Assessments are returned (they occupy a position in the chapter, which drip
counts); callers that must never use them drop source_type 'ASSESSMENT'.

CAST(... AS ...) IS MANDATORY — NEVER ``::`` after a bind parameter: SQLAlchemy
``text()`` reads ``:name::type`` as two parameters (see kb/repository.py).
Every chapter_to_slides / chapter_package_session_mapping index is partial on
status <> 'DELETED', so every query filters those statuses.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, List, Optional, Sequence

from sqlalchemy import bindparam, text
from sqlalchemy.orm import Session

ASSESSMENT = "ASSESSMENT"
VISIBLE_SLIDE_STATUSES = ("PUBLISHED", "UNSYNC")
_IN_BATCH = 1000


@dataclass(frozen=True)
class TreeRow:
    """One visible (batch, subject, module, chapter, lesson) occurrence."""
    package_session_id: str
    package_id: Optional[str]
    level_id: Optional[str]
    slide_id: str
    title: Optional[str]
    source_type: Optional[str]
    chapter_id: str
    chapter_title: Optional[str]
    module_id: str
    module_name: Optional[str]
    subject_id: str
    subject_name: Optional[str]
    subject_order: Optional[int]
    module_order: Optional[int]
    chapter_order: Optional[int]
    slide_order: Optional[int]
    slide_drip_condition_json: Optional[str]
    chapter_drip_condition_json: Optional[str]
    package_drip_condition_json: Optional[str]

    @property
    def is_assessment(self) -> bool:
        return (self.source_type or "").upper() == ASSESSMENT

    def sort_key(self) -> tuple:
        return (
            self.package_session_id,
            _nulls_last(self.subject_order), self.subject_id,
            _nulls_last(self.module_order), self.module_id,
            _nulls_last(self.chapter_order), self.chapter_id,
            _nulls_last(self.slide_order), self.slide_id,
        )


@dataclass(frozen=True)
class OutlineRow:
    """One batch's structure row, chapters included even with no lessons:
    subject (always), module and chapter when an ACTIVE one is linked."""
    package_session_id: str
    subject_id: str
    subject_name: Optional[str]
    subject_order: Optional[int]
    module_id: Optional[str]
    module_name: Optional[str]
    module_order: Optional[int]
    chapter_id: Optional[str]
    chapter_title: Optional[str]
    chapter_order: Optional[int]
    chapter_drip_condition_json: Optional[str]


def _nulls_last(v: Optional[int]) -> tuple:
    return (v is None, v if v is not None else 0)


# The visible chain, shared by every lesson query. `cpsm` / `ps` are the batch.
_VISIBLE_CHAIN = """
    FROM chapter_package_session_mapping cpsm
    JOIN package_session ps ON ps.id = cpsm.package_session_id
    JOIN chapter c ON c.id = cpsm.chapter_id AND c.status = 'ACTIVE'
    JOIN module_chapter_mapping mcm ON mcm.chapter_id = c.id
    JOIN modules m ON m.id = mcm.module_id AND m.status = 'ACTIVE'
    JOIN subject_module_mapping smm ON smm.module_id = m.id
    JOIN subject sub ON sub.id = smm.subject_id AND sub.status = 'ACTIVE'
    JOIN subject_session ss ON ss.subject_id = sub.id AND ss.session_id = cpsm.package_session_id
    JOIN chapter_to_slides cts ON cts.chapter_id = c.id AND cts.status IN ('PUBLISHED', 'UNSYNC')
    JOIN slide sl ON sl.id = cts.slide_id AND sl.status IN ('PUBLISHED', 'UNSYNC')
"""

_TREE_COLUMNS = """
    SELECT cpsm.package_session_id, ps.package_id, ps.level_id,
           sl.id AS slide_id, sl.title, sl.source_type,
           c.id AS chapter_id, c.chapter_name AS chapter_title,
           m.id AS module_id, m.module_name, sub.id AS subject_id, sub.subject_name,
           ss.subject_order, smm.module_order, cpsm.chapter_order, cts.slide_order,
           sl.drip_condition_json AS slide_drip_condition_json,
           c.drip_condition_json AS chapter_drip_condition_json,
           p.drip_condition_json AS package_drip_condition_json
"""

_LEARNER_TREE_SQL = text(
    _TREE_COLUMNS + _VISIBLE_CHAIN + """
    LEFT JOIN package p ON p.id = ps.package_id
    WHERE cpsm.package_session_id IN :ps_ids AND cpsm.status = 'ACTIVE'
    """
).bindparams(bindparam("ps_ids", expanding=True))

_PACKAGE_TREE_SQL = text(
    _TREE_COLUMNS + _VISIBLE_CHAIN + """
    LEFT JOIN package p ON p.id = ps.package_id
    WHERE ps.package_id = :package_id
      AND ps.status <> 'DELETED'
      AND cpsm.status = 'ACTIVE'
      AND EXISTS (SELECT 1 FROM package_institute pi
                  WHERE pi.package_id = ps.package_id AND pi.institute_id = :institute_id)
    """
)

_SLIDE_VISIBLE_SQL = text(
    "SELECT 1" + _VISIBLE_CHAIN + """
    WHERE sl.id = :slide_id
      AND cpsm.status = 'ACTIVE'
      AND ps.status <> 'DELETED'
      AND EXISTS (SELECT 1 FROM package_institute pi
                  WHERE pi.package_id = ps.package_id AND pi.institute_id = :institute_id)
    LIMIT 1
    """
)

# Subjects of the batch, then their ACTIVE modules, then the ACTIVE chapters the
# batch maps. LEFT JOINs keep empty modules and chapters, because the learner app
# counts them when it numbers items for drip (course-wide chapter index).
_OUTLINE_SQL = text(
    """
    SELECT ss.session_id AS package_session_id,
           sub.id AS subject_id, sub.subject_name, ss.subject_order,
           m.id AS module_id, m.module_name, smm.module_order,
           c.id AS chapter_id, c.chapter_name AS chapter_title, cpsm.chapter_order,
           c.drip_condition_json AS chapter_drip_condition_json
    FROM subject_session ss
    JOIN subject sub ON sub.id = ss.subject_id AND sub.status = 'ACTIVE'
    LEFT JOIN subject_module_mapping smm ON smm.subject_id = sub.id
    LEFT JOIN modules m ON m.id = smm.module_id AND m.status = 'ACTIVE'
    LEFT JOIN module_chapter_mapping mcm ON mcm.module_id = m.id
    LEFT JOIN chapter_package_session_mapping cpsm
           ON cpsm.chapter_id = mcm.chapter_id
          AND cpsm.package_session_id = ss.session_id
          AND cpsm.status = 'ACTIVE'
    LEFT JOIN chapter c ON c.id = cpsm.chapter_id AND c.status = 'ACTIVE'
    WHERE ss.session_id IN :ps_ids
    """
).bindparams(bindparam("ps_ids", expanding=True))


def _chunks(ids: Sequence[str], size: int = _IN_BATCH) -> Iterable[List[str]]:
    for i in range(0, len(ids), size):
        yield list(ids[i:i + size])


def _distinct(ids: Iterable[Optional[str]]) -> List[str]:
    return list(dict.fromkeys(i for i in ids if i))


def _tree_rows(result) -> List[TreeRow]:
    rows = []
    seen = set()
    for r in result.mappings():
        key = (r["package_session_id"], r["subject_id"], r["module_id"], r["chapter_id"], r["slide_id"])
        if key in seen:
            continue
        seen.add(key)
        rows.append(TreeRow(**{k: r[k] for k in TreeRow.__dataclass_fields__}))
    rows.sort(key=TreeRow.sort_key)
    return rows


def learner_slide_tree(db: Session, package_session_ids: Iterable[str]) -> List[TreeRow]:
    """Every visible lesson occurrence of these batches, in course order
    (subject_order, module_order, chapter_order, slide_order). Assessments included."""
    ids = _distinct(package_session_ids)
    rows: List[TreeRow] = []
    for chunk in _chunks(ids):
        rows.extend(_tree_rows(db.execute(_LEARNER_TREE_SQL, {"ps_ids": chunk})))
    rows.sort(key=TreeRow.sort_key)
    return rows


def learner_course_outline(db: Session, package_session_ids: Iterable[str]) -> List[OutlineRow]:
    """The subject / module / chapter structure of these batches (no lessons)."""
    ids = _distinct(package_session_ids)
    out: List[OutlineRow] = []
    for chunk in _chunks(ids):
        for r in db.execute(_OUTLINE_SQL, {"ps_ids": chunk}).mappings():
            out.append(OutlineRow(**{k: r[k] for k in OutlineRow.__dataclass_fields__}))
    out.sort(key=lambda o: (
        o.package_session_id, _nulls_last(o.subject_order), o.subject_id,
        _nulls_last(o.module_order), o.module_id or "", _nulls_last(o.chapter_order), o.chapter_id or "",
    ))
    return out


def package_slide_tree(db: Session, institute_id: str, package_id: str) -> List[TreeRow]:
    """Every visible lesson of every non-deleted batch of the package, provided
    package_institute maps the package to this institute (else empty)."""
    if not institute_id or not package_id:
        return []
    return _tree_rows(db.execute(_PACKAGE_TREE_SQL, {"package_id": package_id, "institute_id": institute_id}))


def slide_visible_for_institute(db: Session, slide_id: str, institute_id: str) -> bool:
    """The lesson is visible in at least one non-deleted batch of a package
    this institute owns."""
    if not slide_id or not institute_id:
        return False
    row = db.execute(_SLIDE_VISIBLE_SQL, {"slide_id": slide_id, "institute_id": institute_id}).first()
    return row is not None


__all__ = [
    "ASSESSMENT", "VISIBLE_SLIDE_STATUSES", "TreeRow", "OutlineRow",
    "learner_slide_tree", "learner_course_outline", "package_slide_tree", "slide_visible_for_institute",
]
