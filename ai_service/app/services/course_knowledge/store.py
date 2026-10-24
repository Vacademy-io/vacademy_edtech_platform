"""The ONLY reader and writer of course chunks.

Course lessons live in one hidden knowledge base per institute (purpose
'course_content'), one knowledge_base_source row per lesson (source_kind
'SLIDE', keyed by slide_id) and kb_chunk rows whose vector sits in
``embedding_768_scoped`` with ``embedding_768`` NULL. Every legacy KB reader
filters ``embedding_768 IS NOT NULL``, so it never sees a course chunk; this
module is the one place that reads the scoped column.

This module knows nothing about slides, chapters or enrolments: callers pass
slide ids that the access layer already decided on. That keeps the kb tables
movable to their own Postgres later by changing only the session factory.

Rules:
  * Raw SQL through ``text()`` with CAST(:x AS type), never ``::`` after a bind
    (see kb/repository.py header).
  * Writes are decided from RETURNING, never rowcount: psycopg 3 reports -1 for
    INSERT .. ON CONFLICT.
  * Lists bind as ANY(CAST(:ids AS TEXT[])); vectors as CAST(:vec AS vector)
    from str(list).
  * Functions do not commit unless their docstring says so. The session is
    never held across a network call here; callers embed before calling in.
"""
from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from datetime import datetime
from decimal import Decimal
from typing import Any, Dict, List, Mapping, Optional, Sequence, Tuple

from sqlalchemy import text
from sqlalchemy.orm import Session

from ..kb.repository import FALLBACK_EMBEDDING_MODEL as _KB_FALLBACK_EMBEDDING_MODEL

logger = logging.getLogger(__name__)

PURPOSE = "course_content"
KB_NAME = "Course content (system)"
KB_DESCRIPTION = (
    "Lessons of this institute's courses, indexed automatically for learner "
    "chat, voice and the tutor. Managed by the system."
)

# Only the 768-dim scoped column exists (V600). Must match the V435 seed.
SCOPED_DIM = 768
FALLBACK_EMBEDDING_MODEL = _KB_FALLBACK_EMBEDDING_MODEL   # the KB layer's registry fallback
FALLBACK_EMBEDDING_DIM = 768

MAX_CHUNKS_PER_SLIDE = 400

INDEX_STATES = frozenset({"READY", "NEEDS_PROCESSING", "PENDING", "EMPTY", "UNSUPPORTED", "FAILED"})
SOURCE_STATUSES = frozenset({"PENDING", "PROCESSING", "READY", "PARTIAL", "FAILED"})

_TITLE_MAX = 500
_PARSER_MAX = 20
_LANG_MAX = 20


@dataclass(frozen=True)
class CourseKb:
    id: str
    institute_id: str
    embedding_model: str
    embedding_dim: int


@dataclass(frozen=True)
class SourceRow:
    """One lesson's source row (no chunk text, no vectors)."""
    id: str
    slide_id: str
    title: str
    content_hash: Optional[str]
    index_state: Optional[str]
    status: str
    chunk_count: int
    meta_json: Dict[str, Any]
    credits_charged: Decimal
    is_active: bool
    updated_at: Optional[datetime]


@dataclass
class CourseChunk:
    """One embedded chunk of a lesson. Field names match kb.repository.ChunkToStore,
    so either can be passed to write_slide_index."""
    content_text: str
    chunk_index: int
    embedding: Optional[Sequence[float]] = None
    page_start: Optional[int] = None
    page_end: Optional[int] = None
    lang: Optional[str] = None
    meta_data: Dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class ScanHit:
    """A scored chunk from exact_scan. Carries no text: fetch_texts is a separate
    call so retrieval reads text only for lessons the learner may open."""
    chunk_id: str
    source_id: str
    slide_id: str
    similarity: float
    page_start: Optional[int]
    page_end: Optional[int]
    meta: Dict[str, Any]


# ----------------------------------------------------------------------
# helpers
# ----------------------------------------------------------------------
def _json(value: Any) -> Dict[str, Any]:
    if isinstance(value, dict):
        return value
    if isinstance(value, str) and value:
        try:
            parsed = json.loads(value)
            return parsed if isinstance(parsed, dict) else {}
        except ValueError:
            return {}
    return {}


def _vec(values: Optional[Sequence[float]], what: str) -> Optional[str]:
    if values is None:
        return None
    floats = [float(v) for v in values]
    if len(floats) != SCOPED_DIM:
        raise ValueError(f"{what} has {len(floats)} dims; the course index stores {SCOPED_DIM}")
    return str(floats)


def _ids(values: Sequence[str]) -> List[str]:
    return [str(v) for v in dict.fromkeys(values) if v]


def _clip(value: Optional[str], limit: int) -> Optional[str]:
    if value is None:
        return None
    value = str(value)
    return value[:limit]


def _title(title: Optional[str], slide_id: str) -> str:
    clean = (title or "").strip()
    return (clean or f"Lesson {slide_id}")[:_TITLE_MAX]


def _chunk_attr(chunk: Any, name: str, default: Any = None) -> Any:
    if isinstance(chunk, Mapping):
        return chunk.get(name, default)
    return getattr(chunk, name, default)


def _source_status(index_state: str, has_chunks: bool, given: Optional[str]) -> str:
    """READY when chunks exist (PARTIAL while a paid step is still owed);
    otherwise FAILED or PENDING, as given."""
    if has_chunks:
        if index_state in ("NEEDS_PROCESSING", "PENDING"):
            return "PARTIAL"
        if index_state == "FAILED":
            return "FAILED"
        return "READY"
    if given in ("FAILED", "PENDING"):
        return given
    return "FAILED" if index_state == "FAILED" else "PENDING"


def _check_state(index_state: str) -> None:
    if index_state not in INDEX_STATES:
        raise ValueError(f"unknown index_state {index_state!r}")


_SOURCE_COLS = (
    "id, slide_id, title, content_hash, index_state, status, chunk_count, "
    "meta_json, credits_charged, is_active, updated_at"
)


def _source_row(r) -> SourceRow:
    return SourceRow(
        id=r[0], slide_id=r[1], title=r[2], content_hash=r[3], index_state=r[4],
        status=r[5], chunk_count=int(r[6] or 0), meta_json=_json(r[7]),
        credits_charged=Decimal(str(r[8] if r[8] is not None else 0)),
        is_active=bool(r[9]), updated_at=r[10],
    )


def _kb_from_row(r) -> CourseKb:
    return CourseKb(id=r[0], institute_id=r[1], embedding_model=r[2], embedding_dim=int(r[3]))


# ----------------------------------------------------------------------
# the course KB
# ----------------------------------------------------------------------
_SELECT_KB_SQL = text(
    """
    SELECT id, institute_id, embedding_model, embedding_dim
      FROM knowledge_base
     WHERE institute_id = :i AND purpose = 'course_content'
     LIMIT 1
    """
)


def get_course_kb(db: Session, institute_id: str) -> Optional[CourseKb]:
    """The institute's course KB, or None when it was never created."""
    row = db.execute(_SELECT_KB_SQL, {"i": institute_id}).fetchone()
    return _kb_from_row(row) if row else None


def _default_embedder(db: Session) -> Tuple[str, int]:
    """Same lookup as KbRepository.get_default_embedding_model, with the same
    fallback (the V435 seed) when the registry is unreadable."""
    try:
        row = db.execute(
            text(
                "SELECT model_id, dim FROM kb_embedding_model "
                "WHERE is_default = TRUE AND is_active = TRUE LIMIT 1"
            )
        ).fetchone()
        if row:
            return row[0], int(row[1])
    except Exception as exc:  # noqa: BLE001
        logger.warning("course knowledge: kb_embedding_model lookup failed (%s); using fallback", exc)
        db.rollback()
    return FALLBACK_EMBEDDING_MODEL, FALLBACK_EMBEDDING_DIM


def ensure_course_kb(db: Session, institute_id: str) -> CourseKb:
    """The institute's course KB, created on first use. Commits.

    The partial unique index uq_kb_course_content makes concurrent creation
    safe: the losing INSERT does nothing and the re-SELECT sees the winner.
    Raises ValueError when the KB (or the default embedder it would be pinned
    to) is not 768-dim, because only the 768 scoped column exists."""
    kb = get_course_kb(db, institute_id)
    if kb is None:
        model_id, dim = _default_embedder(db)
        if dim != SCOPED_DIM:
            raise ValueError(
                f"default embedder {model_id} is {dim}-dim; course knowledge stores only {SCOPED_DIM}"
            )
        db.execute(
            text(
                """
                INSERT INTO knowledge_base
                    (institute_id, name, description, purpose, embedding_model, embedding_dim,
                     owner_type, stats_json, meta_json)
                VALUES
                    (:i, :name, :description, 'course_content', :model, :dim,
                     'INSTITUTE', CAST(:stats AS jsonb), CAST(:meta AS jsonb))
                ON CONFLICT DO NOTHING
                RETURNING id
                """
            ),
            {
                "i": institute_id, "name": KB_NAME, "description": KB_DESCRIPTION,
                "model": model_id, "dim": dim,
                "stats": json.dumps({}), "meta": json.dumps({"system": True}),
            },
        ).fetchone()
        kb = get_course_kb(db, institute_id)
        if kb is None:  # pragma: no cover - the insert or the winner's row must exist
            db.rollback()
            raise RuntimeError(f"course knowledge: could not create the course KB for {institute_id}")
    db.commit()
    if kb.embedding_dim != SCOPED_DIM:
        raise ValueError(
            f"course KB {kb.id} is {kb.embedding_dim}-dim; course knowledge stores only {SCOPED_DIM}"
        )
    return kb


def delete_course_kb(db: Session, institute_id: str) -> bool:
    """Delete the institute's course KB; sources, chunks, pages and figures
    cascade. Commits. True when a KB was deleted."""
    row = db.execute(
        text(
            "DELETE FROM knowledge_base WHERE institute_id = :i AND purpose = 'course_content' "
            "RETURNING id"
        ),
        {"i": institute_id},
    ).fetchone()
    db.commit()
    return row is not None


# ----------------------------------------------------------------------
# sources (one per lesson)
# ----------------------------------------------------------------------
def get_source(db: Session, kb_id: str, slide_id: str) -> Optional[SourceRow]:
    row = db.execute(
        text(
            f"SELECT {_SOURCE_COLS} FROM knowledge_base_source "
            "WHERE knowledge_base_id = :kb AND slide_id = :s"
        ),
        {"kb": kb_id, "s": slide_id},
    ).fetchone()
    return _source_row(row) if row else None


def coverage_rows(db: Session, kb_id: str, slide_ids: Sequence[str]) -> Dict[str, SourceRow]:
    """slide_id -> its source row, for the given lessons that have one."""
    ids = _ids(slide_ids)
    if not ids:
        return {}
    rows = db.execute(
        text(
            f"SELECT {_SOURCE_COLS} FROM knowledge_base_source "
            "WHERE knowledge_base_id = :kb AND slide_id = ANY(CAST(:ids AS TEXT[]))"
        ),
        {"kb": kb_id, "ids": ids},
    ).fetchall()
    return {r[1]: _source_row(r) for r in rows}


# meta_json keys a re-index must not drop while the lesson is still unread:
# the caption requeue's throttle (caption_requeue.py). The new meta replaces
# the stored one, except that these keys are carried over unless the new
# state is READY (a successful read starts the requeue history afresh).
STICKY_META_KEYS = ("caption_requeued_at", "caption_requeues")
_STICKY_META_SQL = (
    "CASE WHEN EXCLUDED.index_state = 'READY' THEN EXCLUDED.meta_json"
    " ELSE COALESCE(EXCLUDED.meta_json, CAST('{}' AS jsonb)) || jsonb_strip_nulls(jsonb_build_object("
    + ", ".join(f"'{k}', knowledge_base_source.meta_json -> '{k}'" for k in STICKY_META_KEYS)
    + ")) END"
)

# Upsert of the lesson's source row. Shared by write_slide_index (which also
# sets the chunk-derived columns) and set_source_state (which leaves them).
_UPSERT_SOURCE_SQL = text(
    """
    INSERT INTO knowledge_base_source
        (knowledge_base_id, institute_id, source_kind, slide_id, title, file_id, source_url,
         parser, page_count, ocr_pages, credits_charged, content_hash, status, index_state,
         meta_json, centroid_768, is_active, updated_at)
    VALUES
        (:kb, :inst, 'SLIDE', :slide, :title, :file_id, :source_url,
         :parser, :page_count, :ocr_pages, COALESCE(CAST(:credits AS NUMERIC), 0), :hash, :status,
         :index_state, CAST(:meta AS jsonb), CAST(:centroid AS vector), TRUE, now())
    ON CONFLICT (knowledge_base_id, slide_id) WHERE slide_id IS NOT NULL DO UPDATE SET
        institute_id    = EXCLUDED.institute_id,
        source_kind     = 'SLIDE',
        title           = EXCLUDED.title,
        file_id         = EXCLUDED.file_id,
        source_url      = EXCLUDED.source_url,
        parser          = EXCLUDED.parser,
        page_count      = EXCLUDED.page_count,
        ocr_pages       = EXCLUDED.ocr_pages,
        credits_charged = COALESCE(CAST(:credits AS NUMERIC), knowledge_base_source.credits_charged),
        content_hash    = EXCLUDED.content_hash,
        status          = EXCLUDED.status,
        index_state     = EXCLUDED.index_state,
        meta_json       = """ + _STICKY_META_SQL + """,
        centroid_768    = EXCLUDED.centroid_768,
        error_message   = NULL,
        is_active       = TRUE,
        updated_at      = now()
    RETURNING id
    """
)

_UPSERT_STATE_SQL = text(
    """
    INSERT INTO knowledge_base_source
        (knowledge_base_id, institute_id, source_kind, slide_id, title, content_hash, status,
         index_state, meta_json, is_active, updated_at)
    VALUES
        (:kb, :inst, 'SLIDE', :slide, :title, :hash, :status, :index_state,
         CAST(:meta AS jsonb), TRUE, now())
    ON CONFLICT (knowledge_base_id, slide_id) WHERE slide_id IS NOT NULL DO UPDATE SET
        institute_id = EXCLUDED.institute_id,
        title        = EXCLUDED.title,
        content_hash = COALESCE(EXCLUDED.content_hash, knowledge_base_source.content_hash),
        status       = EXCLUDED.status,
        index_state  = EXCLUDED.index_state,
        meta_json    = """ + _STICKY_META_SQL + """,
        is_active    = TRUE,
        updated_at   = now()
    RETURNING id
    """
)

_INSERT_CHUNK_SQL = text(
    """
    INSERT INTO kb_chunk
        (knowledge_base_id, source_id, institute_id, content_text, chunk_index,
         page_start, page_end, lang, embedding_model, embedding_dim,
         embedding_768, embedding_768_scoped, meta_data)
    VALUES
        (:kb, :sid, :inst, :content_text, :chunk_index,
         :page_start, :page_end, :lang, :model, :dim,
         NULL, CAST(:embedding AS vector), CAST(:meta AS jsonb))
    """
)


def _chunk_params(kb: CourseKb, source_id: str, chunks: Sequence[Any]) -> List[Dict[str, Any]]:
    params: List[Dict[str, Any]] = []
    for position, chunk in enumerate(chunks):
        content = _chunk_attr(chunk, "content_text")
        if not content:
            raise ValueError(f"chunk {position} has no text")
        embedding = _chunk_attr(chunk, "embedding")
        if not embedding:
            raise ValueError(f"chunk {position} has no embedding")
        index = _chunk_attr(chunk, "chunk_index")
        params.append({
            "kb": kb.id, "sid": source_id, "inst": kb.institute_id,
            "content_text": str(content),
            "chunk_index": int(index) if index is not None else position,
            "page_start": _chunk_attr(chunk, "page_start"),
            "page_end": _chunk_attr(chunk, "page_end"),
            "lang": _clip(_chunk_attr(chunk, "lang"), _LANG_MAX),
            "model": kb.embedding_model, "dim": kb.embedding_dim,
            "embedding": _vec(embedding, f"chunk {position} embedding"),
            "meta": json.dumps(_chunk_attr(chunk, "meta_data") or {}),
        })
    return params


def write_slide_index(
    db: Session,
    *,
    kb: CourseKb,
    slide_id: str,
    title: Optional[str],
    fields: Optional[Mapping[str, Any]],
    chunks: Sequence[Any],
    centroid: Optional[Sequence[float]],
    index_state: str,
    meta: Optional[Mapping[str, Any]],
) -> str:
    """Replace one lesson's index in ONE transaction and commit once: upsert the
    source, delete its old chunks, insert the new ones in one multi-row
    statement (embedding_768 NULL, embedding_768_scoped set), set chunk_count.

    `fields` may carry file_id, source_url, text_kind (stored as parser),
    page_count, ocr_pages, credits_charged (None keeps the stored total),
    content_hash and status (used only when there are no chunks: FAILED or
    PENDING). `chunks` are CourseChunk / ChunkToStore objects or dicts with the
    same keys, each with a 768-dim embedding. Returns the source id.
    """
    _check_state(index_state)
    if kb.embedding_dim != SCOPED_DIM:
        raise ValueError(f"course KB {kb.id} is {kb.embedding_dim}-dim; only {SCOPED_DIM} is stored")
    fields = dict(fields or {})
    chunks = list(chunks or [])
    if len(chunks) > MAX_CHUNKS_PER_SLIDE:
        logger.warning(
            "course knowledge: slide %s has %d chunks; keeping the first %d",
            slide_id, len(chunks), MAX_CHUNKS_PER_SLIDE,
        )
        chunks = chunks[:MAX_CHUNKS_PER_SLIDE]
    # Validate everything before the first statement, so a bad chunk never
    # leaves a half-written lesson behind.
    chunk_params = _chunk_params(kb, "", chunks)
    centroid_param = _vec(centroid, "centroid") if chunks else None
    status = _source_status(index_state, bool(chunks), fields.get("status"))
    try:
        row = db.execute(
            _UPSERT_SOURCE_SQL,
            {
                "kb": kb.id, "inst": kb.institute_id, "slide": slide_id,
                "title": _title(title, slide_id),
                "file_id": _clip(fields.get("file_id"), 255),
                "source_url": fields.get("source_url"),
                "parser": _clip(fields.get("text_kind"), _PARSER_MAX),
                "page_count": int(fields.get("page_count") or 0),
                "ocr_pages": int(fields.get("ocr_pages") or 0),
                "credits": (str(fields["credits_charged"])
                            if fields.get("credits_charged") is not None else None),
                "hash": _clip(fields.get("content_hash"), 64),
                "status": status,
                "index_state": index_state,
                "meta": json.dumps(dict(meta or {})),
                "centroid": centroid_param,
            },
        ).fetchone()
        if row is None:
            raise RuntimeError(f"course knowledge: source upsert returned nothing for slide {slide_id}")
        source_id = row[0]
        db.execute(text("DELETE FROM kb_chunk WHERE source_id = :sid"), {"sid": source_id})
        if chunk_params:
            for p in chunk_params:
                p["sid"] = source_id
            db.execute(_INSERT_CHUNK_SQL, chunk_params)
        db.execute(
            text(
                "UPDATE knowledge_base_source SET chunk_count = :n WHERE id = :sid RETURNING id"
            ),
            {"n": len(chunk_params), "sid": source_id},
        ).fetchone()
        db.commit()
    except Exception:
        db.rollback()
        raise
    return source_id


def set_source_state(
    db: Session,
    *,
    kb: CourseKb,
    slide_id: str,
    title: Optional[str],
    index_state: str,
    status: str,
    meta: Optional[Mapping[str, Any]],
    content_hash: Optional[str] = None,
) -> str:
    """Record a lesson's state without touching its chunks (e.g. PENDING while a
    transcription job runs). content_hash None keeps the stored hash. Commits.
    Returns the source id."""
    _check_state(index_state)
    if status not in SOURCE_STATUSES:
        raise ValueError(f"unknown source status {status!r}")
    try:
        row = db.execute(
            _UPSERT_STATE_SQL,
            {
                "kb": kb.id, "inst": kb.institute_id, "slide": slide_id,
                "title": _title(title, slide_id), "hash": _clip(content_hash, 64),
                "status": status, "index_state": index_state,
                "meta": json.dumps(dict(meta or {})),
            },
        ).fetchone()
        if row is None:
            raise RuntimeError(f"course knowledge: source upsert returned nothing for slide {slide_id}")
        db.commit()
    except Exception:
        db.rollback()
        raise
    return row[0]


def tombstone_slide(db: Session, *, kb_id: str, slide_id: str) -> bool:
    """Drop a lesson from the index; chunks, pages and figures cascade.
    Commits. True when a source row was deleted."""
    row = db.execute(
        text(
            "DELETE FROM knowledge_base_source WHERE knowledge_base_id = :kb AND slide_id = :s "
            "RETURNING id"
        ),
        {"kb": kb_id, "s": slide_id},
    ).fetchone()
    db.commit()
    return row is not None


def institute_chunk_total(db: Session, kb_id: str) -> int:
    """Chunks stored in the course KB (sum of the per-lesson counters)."""
    row = db.execute(
        text(
            "SELECT COALESCE(SUM(chunk_count), 0) FROM knowledge_base_source "
            "WHERE knowledge_base_id = :kb"
        ),
        {"kb": kb_id},
    ).fetchone()
    return int(row[0] or 0) if row else 0


# ----------------------------------------------------------------------
# retrieval reads
# ----------------------------------------------------------------------
def candidate_stats(
    db: Session, kb_id: str, institute_id: str, slide_ids: Sequence[str],
) -> Dict[str, Tuple[str, int]]:
    """slide_id -> (source_id, chunk_count) for the given lessons whose source
    is active and has chunks."""
    ids = _ids(slide_ids)
    if not ids:
        return {}
    rows = db.execute(
        text(
            """
            SELECT slide_id, id, chunk_count
              FROM knowledge_base_source
             WHERE knowledge_base_id = :kb
               AND institute_id = :inst
               AND slide_id = ANY(CAST(:ids AS TEXT[]))
               AND is_active
               AND chunk_count > 0
            """
        ),
        {"kb": kb_id, "inst": institute_id, "ids": ids},
    ).fetchall()
    return {r[0]: (r[1], int(r[2])) for r in rows}


def centroid_shortlist(
    db: Session, kb_id: str, institute_id: str, slide_ids: Sequence[str],
    qvec: Sequence[float], limit: int,
) -> List[str]:
    """The given lessons ordered by centroid_768 <=> query, best first."""
    ids = _ids(slide_ids)
    if not ids or limit <= 0:
        return []
    rows = db.execute(
        text(
            """
            SELECT slide_id
              FROM knowledge_base_source
             WHERE knowledge_base_id = :kb
               AND institute_id = :inst
               AND slide_id = ANY(CAST(:ids AS TEXT[]))
               AND is_active
               AND chunk_count > 0
               AND centroid_768 IS NOT NULL
             ORDER BY centroid_768 <=> CAST(:q AS vector)
             LIMIT :limit
            """
        ),
        {"kb": kb_id, "inst": institute_id, "ids": ids, "q": _vec(qvec, "query"), "limit": int(limit)},
    ).fetchall()
    return [r[0] for r in rows]


# MATERIALIZED keeps the planner on idx_kb_chunk_source for the candidate
# sources instead of an HNSW walk; content_text is deliberately absent.
_EXACT_SCAN_SQL = text(
    """
    WITH cand AS MATERIALIZED (
        SELECT c.id, c.source_id, c.page_start, c.page_end, c.meta_data,
               1 - (c.embedding_768_scoped <=> CAST(:q AS vector)) AS sim
          FROM kb_chunk c
         WHERE c.knowledge_base_id = :kb
           AND c.institute_id = :inst
           AND c.source_id = ANY(CAST(:sids AS TEXT[]))
           AND c.embedding_768_scoped IS NOT NULL
           AND c.embedding_model = :model)
    SELECT cand.id, cand.source_id, cand.page_start, cand.page_end, cand.meta_data,
           cand.sim, s.slide_id
      FROM cand
      JOIN knowledge_base_source s ON s.id = cand.source_id AND s.is_active
     WHERE cand.sim > :floor
     ORDER BY cand.sim DESC
     LIMIT :limit
    """
)


def exact_scan(
    db: Session,
    *,
    kb: CourseKb,
    source_ids: Sequence[str],
    qvec: Sequence[float],
    floor: float,
    limit: int,
) -> List[ScanHit]:
    """Exact cosine scan over the chunks of the given sources of this KB and
    institute, best first. Returns no text (see fetch_texts)."""
    ids = _ids(source_ids)
    if not ids or limit <= 0:
        return []
    rows = db.execute(
        _EXACT_SCAN_SQL,
        {
            "kb": kb.id, "inst": kb.institute_id, "sids": ids, "q": _vec(qvec, "query"),
            "model": kb.embedding_model, "floor": float(floor), "limit": int(limit),
        },
    ).fetchall()
    return [
        ScanHit(
            chunk_id=r[0], source_id=r[1], slide_id=r[6], similarity=float(r[5]),
            page_start=r[2], page_end=r[3], meta=_json(r[4]),
        )
        for r in rows
    ]


def fetch_texts(db: Session, chunk_ids: Sequence[str]) -> Dict[str, str]:
    """chunk id -> text. Retrieval calls this for OPEN lessons' chunk ids only."""
    ids = _ids(chunk_ids)
    if not ids:
        return {}
    rows = db.execute(
        text("SELECT id, content_text FROM kb_chunk WHERE id = ANY(CAST(:ids AS TEXT[]))"),
        {"ids": ids},
    ).fetchall()
    return {r[0]: r[1] for r in rows}


__all__ = [
    "PURPOSE", "MAX_CHUNKS_PER_SLIDE", "CourseKb", "SourceRow", "CourseChunk", "ScanHit",
    "get_course_kb", "ensure_course_kb", "delete_course_kb", "get_source", "coverage_rows",
    "write_slide_index", "set_source_state", "tombstone_slide", "institute_chunk_total",
    "candidate_stats", "centroid_shortlist", "exact_scan", "fetch_texts",
]
