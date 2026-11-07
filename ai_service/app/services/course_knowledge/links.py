"""Course to knowledge-base links (table course_knowledge_link, V600).

A link says which knowledge base grounds a course, which of its topics, and
which chapter maps to which topics ({chapter_id: [node_id, ...]}). The AI
course creator writes one right after it builds a course from a KB; admins
add or remove them; the tutor compile and learner retrieval read them. Over
time this replaces TUTOR_MODE_SETTING.kbGrounding, which is still shown here
as a read-only ``legacy`` entry when no active link uses its KB (never
written from a read path).

Everything here is reached only when course_knowledge.links_enabled is on
(the router and the readers check the flag).

The caller owns the session. upsert_link and remove_link commit once; every
other function only reads. No network calls.

CAST(... AS ...) IS MANDATORY — NEVER ``::`` after a bind parameter: SQLAlchemy
``text()`` reads ``:name::type`` as two parameters. psycopg 3 reports rowcount
-1 for INSERT .. ON CONFLICT, so writes decide from RETURNING.
"""
from __future__ import annotations

import json
import logging
import re
import unicodedata
from typing import Any, Dict, Iterable, List, Mapping, Optional, Sequence

from sqlalchemy import text
from sqlalchemy.orm import Session

from . import store

logger = logging.getLogger(__name__)

ROLES = ("GROUNDING", "REFERENCE")
GROUNDING_MODES = ("STRICT", "BLENDED")
USE_IN_VALUES = ("tutor", "chatbot")
PROVENANCES = ("AI_COURSE_CREATOR", "ADMIN", "LEGACY_TUTOR_SETTING")
DEFAULT_USE_IN = ("tutor", "chatbot")

STATUS_ACTIVE = "ACTIVE"
STATUS_REMOVED = "REMOVED"

# Guards on what one request may store (a course outline has tens of
# chapters, a KB topic tree a few hundred nodes).
MAX_TOPIC_NODE_IDS = 1000
MAX_CHAPTERS = 500
MAX_NODES_PER_CHAPTER = 100

_LINK_COLUMNS = """
    l.id, l.institute_id, l.package_id, l.knowledge_base_id, l.role, l.grounding_mode,
    l.use_in, l.topic_node_ids, l.chapter_topics, l.provenance, l.status, l.created_by,
    l.created_at, l.updated_at
"""


class LinkError(Exception):
    """A refused link request; the router turns it into an HTTP error."""

    def __init__(self, status_code: int, detail: Dict[str, Any]):
        super().__init__(detail.get("message") or detail.get("code") or "link error")
        self.status_code = status_code
        self.detail = detail


# ── serialisation ────────────────────────────────────────────────────────────

def _iso(v: Any) -> Optional[str]:
    if v is None:
        return None
    return v.isoformat() if hasattr(v, "isoformat") else str(v)


def _json_obj(v: Any) -> Dict[str, Any]:
    if isinstance(v, dict):
        return v
    if isinstance(v, str) and v.strip():
        try:
            parsed = json.loads(v)
            return parsed if isinstance(parsed, dict) else {}
        except (TypeError, ValueError):
            return {}
    return {}


def _link_row(m: Mapping[str, Any]) -> Dict[str, Any]:
    out = {
        "id": m["id"],
        "institute_id": m["institute_id"],
        "package_id": m["package_id"],
        "knowledge_base_id": m["knowledge_base_id"],
        "role": m["role"],
        "grounding_mode": m["grounding_mode"],
        "use_in": list(m["use_in"] or []),
        "topic_node_ids": list(m["topic_node_ids"] or []),
        "chapter_topics": {str(k): [str(x) for x in (v or [])]
                           for k, v in _json_obj(m["chapter_topics"]).items() if isinstance(v, list)},
        "provenance": m["provenance"],
        "status": m["status"],
        "created_by": m["created_by"],
        "created_at": _iso(m["created_at"]),
        "updated_at": _iso(m["updated_at"]),
    }
    if "knowledge_base_name" in m:
        out["knowledge_base_name"] = m["knowledge_base_name"]
    return out


# ── reads ────────────────────────────────────────────────────────────────────

def _active_links(db: Session, institute_id: str, package_ids: Sequence[str]) -> List[Dict[str, Any]]:
    if not institute_id or not package_ids:
        return []
    rows = db.execute(
        text(
            f"""
            SELECT {_LINK_COLUMNS}, kb.name AS knowledge_base_name
              FROM course_knowledge_link l
              LEFT JOIN knowledge_base kb ON kb.id = l.knowledge_base_id
             WHERE l.institute_id = :institute_id
               AND l.package_id = ANY(CAST(:package_ids AS TEXT[]))
               AND l.status = 'ACTIVE'
             ORDER BY (l.role = 'GROUNDING') DESC, l.created_at, l.id
            """
        ),
        {"institute_id": institute_id, "package_ids": list(dict.fromkeys(package_ids))},
    ).mappings().all()
    return [_link_row(r) for r in rows]


def legacy_kb_grounding(db: Session, institute_id: str, package_id: str) -> Optional[Dict[str, str]]:
    """TUTOR_MODE_SETTING.kbGrounding for the course ({knowledge_base_id, mode})
    with the tutor's own precedence (package course_setting over institute
    setting_json) and its own parser. Read-only; None when unset or unreadable."""
    from ..tutor.runtime.settings import TutorSettings, _apply, _extract

    s = TutorSettings()
    for sql, params in (
        ("SELECT setting_json FROM institutes WHERE id = :i", {"i": institute_id}),
        ("SELECT course_setting FROM package WHERE id = :p", {"p": package_id}),
    ):
        try:
            with db.begin_nested():
                row = db.execute(text(sql), params).first()
        except Exception:  # noqa: BLE001 - a bad envelope or column must not break the read
            logger.warning("tutor settings unreadable for %s / %s", institute_id, package_id, exc_info=True)
            continue
        if row and row[0]:
            _apply(s, _extract(row[0]))
    return dict(s.kb_grounding) if s.kb_grounding else None


def _kb_name(db: Session, kb_id: str, institute_id: str) -> Optional[str]:
    row = db.execute(
        text(
            "SELECT name FROM knowledge_base WHERE id = :id "
            "AND (institute_id = :i OR owner_type = 'PLATFORM') AND purpose <> :course_purpose"
        ),
        {"id": kb_id, "i": institute_id, "course_purpose": store.PURPOSE},
    ).first()
    return row[0] if row else None


def list_links(db: Session, institute_id: str, package_id: str) -> Dict[str, Any]:
    """{links: the ACTIVE links, legacy: the course's TUTOR_MODE_SETTING.kbGrounding
    when no active link uses that KB, else None}. Never writes."""
    links = _active_links(db, institute_id, [package_id])
    legacy = None
    kbg = legacy_kb_grounding(db, institute_id, package_id)
    if kbg and not any(l["knowledge_base_id"] == kbg["knowledge_base_id"] for l in links):
        legacy = {
            "knowledge_base_id": kbg["knowledge_base_id"],
            "knowledge_base_name": _kb_name(db, kbg["knowledge_base_id"], institute_id),
            "role": "GROUNDING",
            "grounding_mode": kbg.get("mode") or "STRICT",
            "use_in": ["tutor"],
            "topic_node_ids": [],
            "chapter_topics": {},
            "provenance": "LEGACY_TUTOR_SETTING",
            "source": "TUTOR_MODE_SETTING",
        }
    return {"links": links, "legacy": legacy}


def resolve_course_kb_links(
    db: Session, institute_id: str, package_ids: Iterable[str], use_in: str,
) -> List[Dict[str, Any]]:
    """The active links of these courses whose use_in contains ``use_in``
    ('tutor' or 'chatbot'), GROUNDING first, then oldest first. Read-only; the
    caller checks flags.links_enabled()."""
    ids = [p for p in dict.fromkeys(package_ids or []) if p]
    if not institute_id or not ids or not use_in:
        return []
    return [l for l in _active_links(db, institute_id, ids) if use_in in l["use_in"]]


# ── writes ───────────────────────────────────────────────────────────────────

def _norm_name(name: Any) -> str:
    s = unicodedata.normalize("NFKC", str(name or "")).casefold()
    return re.sub(r"\s+", " ", s).strip()


def _package_chapters(db: Session, package_id: str) -> Dict[str, str]:
    """{chapter_id: chapter_name} for the live chapters of every live batch of
    the course (a chapter shared by batches is one id)."""
    rows = db.execute(
        text(
            """
            SELECT DISTINCT c.id, c.chapter_name
              FROM package_session ps
              JOIN chapter_package_session_mapping cpsm
                ON cpsm.package_session_id = ps.id AND cpsm.status <> 'DELETED'
              JOIN chapter c ON c.id = cpsm.chapter_id AND c.status <> 'DELETED'
             WHERE ps.package_id = :package_id AND ps.status <> 'DELETED'
            """
        ),
        {"package_id": package_id},
    ).fetchall()
    return {r[0]: (r[1] or "") for r in rows}


def _chapter_id_for_name(name: str, chapters: Mapping[str, str]) -> Optional[str]:
    """Exact (case- and space-insensitive) name match first, then the KB's
    topic-title normalisation (drops "Chapter 3:" / "1.2" numbering). A name
    that matches more than one chapter is ambiguous and resolves to None."""
    from ..kb.repository import normalize_topic_title

    want = _norm_name(name)
    if not want:
        return None
    exact = [cid for cid, cname in chapters.items() if _norm_name(cname) == want]
    if len(exact) == 1:
        return exact[0]
    if len(exact) > 1:
        return None
    loose_want = normalize_topic_title(name)
    if not loose_want:
        return None
    loose = [cid for cid, cname in chapters.items() if normalize_topic_title(cname) == loose_want]
    return loose[0] if len(loose) == 1 else None


def _str_list(v: Any, limit: int) -> List[str]:
    if not isinstance(v, (list, tuple)):
        return []
    out = [str(x).strip() for x in v if isinstance(x, (str, int)) and str(x).strip()]
    return list(dict.fromkeys(out))[:limit]


def _existing_node_ids(db: Session, kb_id: str, node_ids: Sequence[str]) -> set:
    if not node_ids:
        return set()
    rows = db.execute(
        text(
            "SELECT id FROM knowledge_base_node "
            "WHERE knowledge_base_id = :kb AND id = ANY(CAST(:ids AS TEXT[]))"
        ),
        {"kb": kb_id, "ids": list(node_ids)},
    ).fetchall()
    return {r[0] for r in rows}


def _raw_chapter_topics(db: Session, package_id: str, raw: Any) -> Dict[str, List[str]]:
    """{chapter_id: [node_ids]} from either accepted shape, chapters resolved
    within the course: {chapter_id: [node_ids]} (unknown chapter ids dropped)
    or [{chapter_name | chapter_id, node_ids | node_id}] (ambiguous or unknown
    names skipped). Node ids are not validated here."""
    if not raw:
        return {}
    chapters = _package_chapters(db, package_id)
    out: Dict[str, List[str]] = {}

    def _add(cid: Optional[str], nodes: List[str]) -> None:
        if not cid or not nodes or (cid not in out and len(out) >= MAX_CHAPTERS):
            return
        merged = list(dict.fromkeys(out.get(cid, []) + nodes))[:MAX_NODES_PER_CHAPTER]
        out[cid] = merged

    if isinstance(raw, Mapping):
        for cid, nodes in raw.items():
            cid = str(cid)
            if cid in chapters:
                _add(cid, _str_list(nodes, MAX_NODES_PER_CHAPTER))
            else:
                logger.info("course link: chapter %s is not in package %s; dropped", cid, package_id)
        return out
    if isinstance(raw, (list, tuple)):
        for item in raw:
            if not isinstance(item, Mapping):
                continue
            nodes = _str_list(item.get("node_ids"), MAX_NODES_PER_CHAPTER)
            if not nodes and item.get("node_id"):
                nodes = _str_list([item.get("node_id")], 1)
            cid = item.get("chapter_id")
            if cid and str(cid) in chapters:
                _add(str(cid), nodes)
                continue
            resolved = _chapter_id_for_name(item.get("chapter_name") or "", chapters)
            if resolved:
                _add(resolved, nodes)
            else:
                logger.info("course link: chapter name %r unknown or ambiguous in package %s; skipped",
                            item.get("chapter_name"), package_id)
    return out


def _choice(value: Any, options: Sequence[str], default: str, field: str) -> str:
    if value in (None, ""):
        return default
    v = str(value).strip()
    for opt in options:
        if v.upper() == opt.upper():
            return opt
    raise LinkError(422, {"code": "invalid_field", "field": field,
                          "message": f"{field} must be one of {', '.join(options)}"})


def _use_in(value: Any) -> List[str]:
    if value is None:
        return list(DEFAULT_USE_IN)
    if not isinstance(value, (list, tuple)):
        raise LinkError(422, {"code": "invalid_field", "field": "use_in",
                              "message": "use_in must be a list"})
    picked = {str(v).strip().lower() for v in value if v}
    unknown = picked - set(USE_IN_VALUES)
    if unknown:
        raise LinkError(422, {"code": "invalid_field", "field": "use_in",
                              "message": f"use_in values must be among {', '.join(USE_IN_VALUES)}"})
    return [v for v in USE_IN_VALUES if v in picked]


def validate_kb(db: Session, kb_id: str, institute_id: str) -> Dict[str, Any]:
    """The KB the institute may ground on: 404 when it cannot read it, 402
    LIBRARY_LOCKED when it is a locked library (routers/course_outline.py)."""
    from ..kb.repository import KbRepository

    repo = KbRepository(db)
    kb = repo.get_kb(kb_id, institute_id) if kb_id else None
    if not kb:
        raise LinkError(404, {"code": "kb_not_found", "message": "Knowledge base not found"})
    if not repo.is_usable(kb, institute_id):
        raise LinkError(402, {
            "message": f"Unlock '{kb['name']}' to link it to a course",
            "knowledge_base_id": kb["id"],
            "reason": "LIBRARY_LOCKED",
        })
    return kb


_UPSERT_SQL = text(
    f"""
    INSERT INTO course_knowledge_link AS l
        (institute_id, package_id, knowledge_base_id, role, grounding_mode, use_in,
         topic_node_ids, chapter_topics, provenance, status, created_by)
    VALUES (:institute_id, :package_id, :kb_id, :role, :mode, CAST(:use_in AS TEXT[]),
            CAST(:topic_node_ids AS TEXT[]), CAST(:chapter_topics AS jsonb), :provenance,
            'ACTIVE', :created_by)
    ON CONFLICT (package_id, knowledge_base_id) WHERE status = 'ACTIVE'
    DO UPDATE SET
        role           = CASE WHEN CAST(:set_role AS BOOLEAN) THEN EXCLUDED.role ELSE l.role END,
        grounding_mode = CASE WHEN CAST(:set_mode AS BOOLEAN) THEN EXCLUDED.grounding_mode ELSE l.grounding_mode END,
        use_in         = CASE WHEN CAST(:set_use_in AS BOOLEAN) THEN EXCLUDED.use_in ELSE l.use_in END,
        topic_node_ids = CASE WHEN CAST(:set_topics AS BOOLEAN) THEN EXCLUDED.topic_node_ids ELSE l.topic_node_ids END,
        chapter_topics = CASE WHEN CAST(:set_chapters AS BOOLEAN) THEN EXCLUDED.chapter_topics ELSE l.chapter_topics END,
        updated_at     = now()
     WHERE l.institute_id = EXCLUDED.institute_id
    RETURNING {_LINK_COLUMNS}
    """
)


def upsert_link(
    db: Session, institute_id: str, package_id: str, data: Mapping[str, Any], created_by: Optional[str],
) -> Dict[str, Any]:
    """Create the course's active link to ``data['knowledge_base_id']``, or
    update it (one active link per course and KB). Fields left out of
    ``data`` keep their stored value on update (defaults on insert); the
    first author's provenance is kept. Unknown topic node ids and unknown or
    ambiguous chapters are dropped. Commits once; LinkError on a refusal."""
    kb_id = str(data.get("knowledge_base_id") or "").strip()
    if not kb_id:
        raise LinkError(422, {"code": "invalid_field", "field": "knowledge_base_id",
                              "message": "knowledge_base_id is required"})
    role = _choice(data.get("role"), ROLES, "GROUNDING", "role")
    mode = _choice(data.get("grounding_mode"), GROUNDING_MODES, "STRICT", "grounding_mode")
    provenance = _choice(data.get("provenance"), PROVENANCES, "ADMIN", "provenance")
    use_in = _use_in(data.get("use_in"))

    validate_kb(db, kb_id, institute_id)

    wanted_topics = _str_list(data.get("topic_node_ids"), MAX_TOPIC_NODE_IDS)
    raw_chapters = _raw_chapter_topics(db, package_id, data.get("chapter_topics"))
    every_node = list(dict.fromkeys(wanted_topics + [n for ns in raw_chapters.values() for n in ns]))
    known = _existing_node_ids(db, kb_id, every_node)
    topics = [n for n in wanted_topics if n in known]
    chapter_topics = {cid: kept for cid, ns in raw_chapters.items() if (kept := [n for n in ns if n in known])}
    dropped = len(every_node) - len(known)
    if dropped:
        logger.info("course link %s/%s: dropped %d unknown topic node id(s)", package_id, kb_id, dropped)

    def _given(key: str) -> bool:
        return key in data and data.get(key) is not None

    try:
        row = db.execute(_UPSERT_SQL, {
            "institute_id": institute_id, "package_id": package_id, "kb_id": kb_id,
            "role": role, "mode": mode, "use_in": use_in, "topic_node_ids": topics,
            "chapter_topics": json.dumps(chapter_topics), "provenance": provenance,
            "created_by": created_by,
            "set_role": _given("role"), "set_mode": _given("grounding_mode"),
            "set_use_in": _given("use_in"), "set_topics": _given("topic_node_ids"),
            "set_chapters": _given("chapter_topics"),
        }).mappings().first()
        if row is None:
            # The active (package, KB) row belongs to another institute.
            raise LinkError(409, {"code": "link_conflict", "message": "This course already has that link"})
        db.commit()
    except Exception:
        db.rollback()
        raise
    out = _link_row(row)
    out["knowledge_base_name"] = _kb_name(db, kb_id, institute_id)
    return out


def remove_link(db: Session, institute_id: str, package_id: str, link_id: str) -> Dict[str, Any]:
    """Mark the course's active link REMOVED (the row is kept). Commits;
    LinkError 404 when no such active link exists for this course."""
    try:
        row = db.execute(
            text(
                f"""
                UPDATE course_knowledge_link AS l
                   SET status = 'REMOVED', updated_at = now()
                 WHERE l.id = :id AND l.institute_id = :institute_id
                   AND l.package_id = :package_id AND l.status = 'ACTIVE'
                RETURNING {_LINK_COLUMNS}
                """
            ),
            {"id": link_id, "institute_id": institute_id, "package_id": package_id},
        ).mappings().first()
        if row is None:
            db.rollback()
            raise LinkError(404, {"code": "link_not_found", "message": "Link not found"})
        db.commit()
    except LinkError:
        raise
    except Exception:
        db.rollback()
        raise
    return _link_row(row)


def tutor_grounding_link(db: Session, institute_id: str, package_id: str) -> Optional[Dict[str, Any]]:
    """The course's first active GROUNDING link used by the tutor, or None."""
    for link in resolve_course_kb_links(db, institute_id, [package_id], "tutor"):
        if link["role"] == "GROUNDING":
            return link
    return None


def chapter_topics_for_kb(db: Session, institute_id: str, package_id: str, kb_id: str) -> Optional[Dict[str, List[str]]]:
    """chapter_topics of the course's active tutor link to ``kb_id`` (node ids
    belong to that KB, so they only apply when grounding on it); None when
    there is no such link or it maps no chapter."""
    for link in resolve_course_kb_links(db, institute_id, [package_id], "tutor"):
        if link["knowledge_base_id"] == kb_id:
            return link["chapter_topics"] or None
    return None


__all__ = [
    "ROLES", "GROUNDING_MODES", "USE_IN_VALUES", "PROVENANCES", "DEFAULT_USE_IN",
    "STATUS_ACTIVE", "STATUS_REMOVED", "LinkError",
    "list_links", "legacy_kb_grounding", "resolve_course_kb_links", "validate_kb",
    "upsert_link", "remove_link", "tutor_grounding_link", "chapter_topics_for_kb",
]
