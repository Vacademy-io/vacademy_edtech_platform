"""SQL layer for the Knowledge Base tables (V435).

Raw SQL via SQLAlchemy ``text()``, matching the style of the surrounding
newer ai_service code (rag_service, credit_service) rather than introducing
ORM entities for tables admin_core also owns.

CAST(... AS ...) IS MANDATORY — NEVER ``::``
    SQLAlchemy's ``text()`` parses ``:name`` as a bind parameter, and a Postgres
    ``::type`` cast immediately after one is mis-read as a second parameter,
    surfacing as ``syntax error at or near ":"`` from the server. The same trap
    exists in admin_core's Hibernate native queries. Every cast here uses
    CAST(x AS t).
"""
from __future__ import annotations

import json
import logging
import re
import unicodedata
import uuid
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Sequence

from sqlalchemy import text
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

# Fallback used only if kb_embedding_model is unreadable (pre-migration env).
# Must match the V435 seed.
FALLBACK_EMBEDDING_MODEL = "google/gemini-embedding-001"
FALLBACK_EMBEDDING_DIM = 768

# Which kb_chunk column holds vectors for a given dimension. Adding an embedder
# means adding a column (see the V435 header) and one entry here.
VECTOR_COLUMN_BY_DIM: Dict[int, str] = {768: "embedding_768"}

# Every PUBLISHED platform library is free for every institute. This includes
# NCERT and other curriculum books: they are platform-owned library content,
# not per-institute features or paid catalogue products.
CURRICULUM_COLLECTION = "CURRICULUM"

# The hidden per-institute course store (app/services/course_knowledge) and its
# one-source-per-lesson rows. The generic knowledge-base code below must never
# read them: lessons are gated per learner (drip, enrolment, status) and only
# the course-knowledge gateway applies those rules.
COURSE_CONTENT_PURPOSE = "course_content"
SLIDE_SOURCE_KIND = "SLIDE"

_FREE_LIBRARY_ACCESS_SQL = f"""
    EXISTS (
        SELECT 1
          FROM knowledge_base_listing fl
         WHERE fl.knowledge_base_id = kb.id
           AND fl.status = 'PUBLISHED'
           AND kb.owner_type = 'PLATFORM'
    )
"""

def is_curriculum_kb(kb: dict) -> bool:
    """A pre-loaded textbook library (the loader stamps meta_json.curriculum).

    These are the platform's own uploads, made once for every institute, so
    ingesting them is NOT metered: charging 3 credits/page to the publisher
    institute was only ever Vacademy paying Vacademy, and an empty publisher
    wallet would still block the upload. Usage (ask / paper generation) stays
    on normal AI credits — those are real model calls."""
    meta = kb.get("meta") or {}
    return bool(meta.get("curriculum")) or meta.get("topic_tree_mode") == "AUTHORED"


# Columns every knowledge-base read returns. The listing join is LEFT so an
# unlisted base still reads; curriculum facets are NULL for anything that is not
# a curriculum library.
_KB_SELECT = f"""
    SELECT kb.id, kb.institute_id, kb.name, kb.description, kb.purpose,
           kb.language_hint, kb.owner_type, kb.embedding_model,
           kb.embedding_dim, kb.status, kb.stats_json, kb.created_by,
           kb.created_at, kb.updated_at,
           (SELECT COUNT(*) FROM knowledge_base_source s
             WHERE s.knowledge_base_id = kb.id) AS source_count,
           (SELECT COUNT(*) FROM knowledge_base_source s
             WHERE s.knowledge_base_id = kb.id
               AND s.status IN ('PENDING', 'PROCESSING')) AS processing_count,
           (SELECT COALESCE(SUM(s.pages_low_confidence), 0)
              FROM knowledge_base_source s
             WHERE s.knowledge_base_id = kb.id) AS review_pages,
           kb.meta_json,
           l.collection, l.board, l.level, l.subject, l.language, l.title AS listing_title
      FROM knowledge_base kb
      LEFT JOIN knowledge_base_listing l ON l.knowledge_base_id = kb.id
"""


# ── Stable topic ids (platform setting kb.stable_topic_ids) ─────────────────
# Off: replace_topic_tree deletes the whole topic tree and re-inserts it, so
# every LLM-derived topic gets a fresh id on every rebuild. On: nodes are
# matched to the existing rows and keep their ids, so chunks (kb_chunk.node_id),
# companions and course links that point at a topic survive a rebuild.
STABLE_TOPIC_IDS_SETTING = "kb.stable_topic_ids"

# Keyword overlap at which a renamed node of an LLM tree keeps its old id.
TOPIC_KEYWORD_JACCARD_MIN = 0.5

# "1.2 ", "3) ", "Chapter 3: ", "Unit IV - ". Roman numerals only after a
# keyword, so a title that merely starts with "Did" or "Mix" is left alone.
_LEADING_NUMBERING_RE = re.compile(
    r"^(?:(?:chapter|unit|part|section|lesson|module)\s+(?:\d+(?:\.\d+)*|[ivxlcdm]+)\b"
    r"|\d+(?:\.\d+)*\.?(?=[\s:)\-\u2013\u2014]|$))"
    r"\s*[.:)\-\u2013\u2014]*\s*"
)


def stable_topic_ids_enabled() -> bool:
    """kb.stable_topic_ids. Never raises: a settings outage reads as off, the
    old (delete and re-insert) behaviour."""
    try:
        from ..platform_settings_service import get_platform_setting
        value = get_platform_setting(STABLE_TOPIC_IDS_SETTING, default=False)
    except Exception:  # noqa: BLE001
        return False
    if isinstance(value, str):
        return value.strip().lower() in ("1", "true", "yes", "on")
    return bool(value)


def normalize_topic_title(title: Optional[str]) -> str:
    """Matching form of a topic title: NFKC, lowercase, leading numbering
    ("1.2", "Chapter 3:") and punctuation removed, spaces collapsed. A title
    that is nothing but numbering keeps its folded text, so "1.2" is not
    the same node as "1.3"."""
    folded = " ".join(unicodedata.normalize("NFKC", title or "").casefold().split())
    s = _LEADING_NUMBERING_RE.sub("", folded, count=1)
    s = "".join(" " if unicodedata.category(ch).startswith("P") else ch for ch in s)
    return " ".join(s.split()) or folded


def topic_node_id(*parts: str) -> str:
    """Deterministic topic node id, the same scheme as topics._node_id."""
    return str(uuid.uuid5(uuid.NAMESPACE_URL, "vacademy-kb-node:" + "|".join(parts)))


def _topic_key(level: str, source_id: Optional[str], parent_title: Optional[str],
               title: Optional[str]) -> tuple:
    return (
        level,
        source_id or "",
        normalize_topic_title(parent_title) if level == "subtopic" else "",
        normalize_topic_title(title),
    )


def _keyword_set(keywords: Optional[Sequence[Any]]) -> set:
    return {k for k in (normalize_topic_title(str(x)) for x in (keywords or [])) if k}


@dataclass
class _ExistingTopicNode:
    """A topic/subtopic row as stored before the rebuild."""
    id: str
    parent_id: Optional[str]
    level: str
    source_id: Optional[str]
    title: Optional[str]
    keywords: List[str]


@dataclass
class _PlannedTopicNode:
    """One node of the new tree with the id it will be written under."""
    node: Any
    level: str
    source_id: Optional[str]
    ordinal: int
    parent: Optional["_PlannedTopicNode"] = None
    children: List["_PlannedTopicNode"] = field(default_factory=list)
    id: Optional[str] = None


def plan_topic_node_ids(
    kb_id: str, existing: Sequence[_ExistingTopicNode], topics: Sequence[Any]
) -> List[_PlannedTopicNode]:
    """Give every node of a new topic tree its id, reusing stored ids.

    Per node, the first rule that applies wins:
      1. it carries an id (AUTHORED trees) that is already stored: keep it;
      2. exact key match (level, source, normalised parent title for
         subtopics, normalised title): reuse that row's id;
      3. LLM trees only (no node carries an id): a stored node with the same
         level, source and (reused) parent whose keywords overlap by Jaccard
         >= 0.5 lends its id, so a lightly renamed topic keeps it;
      4. otherwise its carried id, or a uuid5 of its normalised path.
    No stored id is ever given to two nodes. Topics resolve before subtopics,
    because a subtopic's key and its parent match depend on its topic.
    """
    old_by_id = {n.id: n for n in existing}
    old_by_key: Dict[tuple, List[str]] = {}
    for n in existing:
        parent = old_by_id.get(n.parent_id) if n.parent_id else None
        key = _topic_key(n.level, n.source_id, parent.title if parent else "", n.title)
        old_by_key.setdefault(key, []).append(n.id)

    planned: List[_PlannedTopicNode] = []
    for t_ordinal, topic in enumerate(topics, start=1):
        tp = _PlannedTopicNode(
            node=topic, level="topic", source_id=getattr(topic, "source_id", None),
            ordinal=t_ordinal,
        )
        for s_ordinal, sub in enumerate(getattr(topic, "subtopics", None) or [], start=1):
            tp.children.append(
                _PlannedTopicNode(
                    node=sub, level="subtopic",
                    source_id=getattr(sub, "source_id", None) or tp.source_id,
                    ordinal=s_ordinal, parent=tp,
                )
            )
        planned.append(tp)
    subtopics = [c for tp in planned for c in tp.children]
    authored = any(getattr(p.node, "id", None) for p in [*planned, *subtopics])
    taken: set = set()

    def assign(p: _PlannedTopicNode, node_id: str) -> None:
        p.id = node_id
        taken.add(node_id)

    # Rule 1 runs for the whole tree first, so no other node's key match can
    # take an id its own node still carries.
    for p in [*planned, *subtopics]:
        carried = getattr(p.node, "id", None)
        if carried and carried in old_by_id and carried not in taken:
            assign(p, carried)

    def parent_title(p: _PlannedTopicNode) -> str:
        return p.parent.node.title if p.parent is not None else ""

    def resolve(level_nodes: List[_PlannedTopicNode]) -> None:
        # Exact keys before any fuzzy match: a renamed node must not take the
        # id an unchanged node further down the list matches exactly.
        for p in level_nodes:
            if p.id:
                continue
            key = _topic_key(p.level, p.source_id, parent_title(p), p.node.title)
            match = next((i for i in old_by_key.get(key, []) if i not in taken), None)
            if match:
                assign(p, match)
        if not authored:
            for p in level_nodes:
                if p.id:
                    continue
                mine = _keyword_set(getattr(p.node, "keywords", None))
                if not mine:
                    continue
                want_parent = p.parent.id if p.parent is not None else None
                best, best_score = None, 0.0
                for old in existing:
                    if (old.id in taken or old.level != p.level
                            or (old.source_id or "") != (p.source_id or "")
                            or old.parent_id != want_parent):
                        continue
                    theirs = _keyword_set(old.keywords)
                    if not theirs:
                        continue
                    score = len(mine & theirs) / len(mine | theirs)
                    if score > best_score:
                        best, best_score = old.id, score
                if best and best_score >= TOPIC_KEYWORD_JACCARD_MIN:
                    assign(p, best)
        for p in level_nodes:
            if p.id:
                continue
            carried = getattr(p.node, "id", None)
            if carried and carried not in taken:
                assign(p, carried)
                continue
            path = normalize_topic_title(p.node.title)
            if p.level == "subtopic":
                path = normalize_topic_title(parent_title(p)) + "/" + path
            node_id = topic_node_id(kb_id, p.level, p.source_id or "", path)
            occurrence = 1
            while node_id in taken:
                occurrence += 1
                node_id = topic_node_id(
                    kb_id, p.level, p.source_id or "", f"{path}#{occurrence}"
                )
            assign(p, node_id)

    resolve(planned)
    resolve(subtopics)
    return planned


@dataclass
class EmbeddingModelSpec:
    """A registered embedder and the kb_chunk column its vectors live in."""
    model_id: str
    dim: int
    vector_column: str


@dataclass
class ChunkToStore:
    """One chunk ready for persistence, with its citation anchors."""
    content_text: str
    chunk_index: int
    embedding: Optional[List[float]] = None
    page_start: Optional[int] = None
    page_end: Optional[int] = None
    node_id: Optional[str] = None
    figure_ids: List[str] = field(default_factory=list)
    lang: Optional[str] = None
    meta_data: Dict[str, Any] = field(default_factory=dict)


class KbRepository:
    """Data access for knowledge bases, sources, pages, figures, nodes, chunks."""

    def __init__(self, db: Session):
        self.db = db

    # ------------------------------------------------------------------
    # Embedding-model registry
    # ------------------------------------------------------------------
    def get_default_embedding_model(self) -> EmbeddingModelSpec:
        """The active default embedder. Falls back to the V435 seed values so a
        pre-migration environment still functions rather than 500-ing."""
        try:
            row = self.db.execute(
                text(
                    "SELECT model_id, dim, vector_column FROM kb_embedding_model "
                    "WHERE is_default = TRUE AND is_active = TRUE LIMIT 1"
                )
            ).fetchone()
            if row:
                return EmbeddingModelSpec(row[0], int(row[1]), row[2])
        except Exception as exc:  # noqa: BLE001
            logger.warning("kb_embedding_model lookup failed (%s); using fallback", exc)
        return EmbeddingModelSpec(
            FALLBACK_EMBEDDING_MODEL,
            FALLBACK_EMBEDDING_DIM,
            VECTOR_COLUMN_BY_DIM[FALLBACK_EMBEDDING_DIM],
        )

    def get_embedding_model(self, model_id: Optional[str]) -> EmbeddingModelSpec:
        """The registered embedder a knowledge base is pinned to.

        Every chunk of a KB must be written — and every query against it
        embedded — with THIS model, never the current default: the default can
        change, stored vectors do not. Falls back to the default only when the
        id is missing/unknown (pre-registry rows)."""
        if model_id:
            try:
                row = self.db.execute(
                    text(
                        "SELECT model_id, dim, vector_column FROM kb_embedding_model "
                        "WHERE model_id = :m AND is_active = TRUE"
                    ),
                    {"m": model_id},
                ).fetchone()
                if row:
                    return EmbeddingModelSpec(row[0], int(row[1]), row[2])
                logger.warning("Embedding model %s is not registered/active; using default", model_id)
            except Exception as exc:  # noqa: BLE001
                logger.warning("kb_embedding_model lookup for %s failed (%s)", model_id, exc)
        return self.get_default_embedding_model()

    @staticmethod
    def vector_column_for_dim(dim: int) -> str:
        """kb_chunk column for a dimension. Raises rather than guessing: writing
        a vector into the wrong column would silently corrupt retrieval."""
        col = VECTOR_COLUMN_BY_DIM.get(int(dim))
        if not col:
            raise ValueError(
                f"No kb_chunk vector column registered for dim={dim}. "
                "Add the column + partial HNSW index (see the V435 header) and "
                "register it in VECTOR_COLUMN_BY_DIM."
            )
        return col

    # ------------------------------------------------------------------
    # knowledge_base
    # ------------------------------------------------------------------
    def create_kb(
        self,
        *,
        institute_id: str,
        name: str,
        description: Optional[str],
        purpose: str,
        language_hint: Optional[str],
        created_by: Optional[str],
        meta: Optional[Dict[str, Any]] = None,
        embedding_model: Optional[str] = None,
    ) -> Dict[str, Any]:
        # Pinned for the life of the base (see get_embedding_model). A caller
        # may pick any ACTIVE registered embedder; unknown ids fall back to
        # the default rather than creating a base nothing can embed for.
        spec = self.get_embedding_model(embedding_model) if embedding_model else self.get_default_embedding_model()
        row = self.db.execute(
            text(
                """
                INSERT INTO knowledge_base
                    (institute_id, name, description, purpose, language_hint,
                     embedding_model, embedding_dim, created_by, stats_json, meta_json)
                VALUES
                    (:institute_id, :name, :description, :purpose, :language_hint,
                     :embedding_model, :embedding_dim, :created_by,
                     CAST(:stats AS jsonb), CAST(:meta AS jsonb))
                RETURNING id
                """
            ),
            {
                "institute_id": institute_id,
                "name": name,
                "description": description,
                "purpose": purpose,
                "language_hint": language_hint,
                "embedding_model": spec.model_id,
                "embedding_dim": spec.dim,
                "created_by": created_by,
                "stats": json.dumps({"sources": 0, "pages": 0, "chunks": 0, "figures": 0}),
                "meta": json.dumps(meta or {}),
            },
        ).fetchone()
        self.db.commit()
        return self.get_kb(row[0], institute_id)  # type: ignore[return-value]

    def list_kbs(self, institute_id: str, include_archived: bool = False) -> List[Dict[str, Any]]:
        """KBs an institute can USE: its own, every published platform library,
        and anything it unlocked before that library was withdrawn.

        This list feeds the paper builder and the assessment section picker,
        so anything in it is offered as ready to use.

        Curriculum metadata is retained for grouping in authoring pickers.

        The per-institute course store (purpose course_content) is never listed:
        it is not a library anyone picks, and get_kb hides it the same way.
        """
        status_clause = "" if include_archived else "AND kb.status = 'ACTIVE'"
        rows = self.db.execute(
            text(
                f"""
                {_KB_SELECT}
                WHERE (
                        kb.institute_id = :institute_id
                        OR EXISTS (
                            SELECT 1 FROM knowledge_base_entitlement e
                             WHERE e.knowledge_base_id = kb.id
                               AND e.institute_id = :institute_id
                        )
                        OR {_FREE_LIBRARY_ACCESS_SQL}
                      )
                  AND kb.purpose <> '{COURSE_CONTENT_PURPOSE}'
                {status_clause}
                ORDER BY (kb.owner_type = 'PLATFORM'),
                         -- curriculum last (NULL collection must read as FALSE,
                         -- not sort after TRUE), then board → class → subject
                         -- → book; every other row keeps the old updated_at order
                         COALESCE(l.collection = '{CURRICULUM_COLLECTION}', FALSE),
                         CASE WHEN l.collection = '{CURRICULUM_COLLECTION}' THEN l.board END,
                         CASE WHEN l.collection = '{CURRICULUM_COLLECTION}' AND l.level ~ '^[0-9]+$'
                              THEN CAST(l.level AS INTEGER)
                              WHEN l.collection = '{CURRICULUM_COLLECTION}' THEN 99 END,
                         CASE WHEN l.collection = '{CURRICULUM_COLLECTION}' THEN l.subject END,
                         CASE WHEN l.collection = '{CURRICULUM_COLLECTION}' THEN l.title END,
                         kb.updated_at DESC
                """
            ),
            {"institute_id": institute_id},
        ).fetchall()
        return [self._kb_row(r) for r in rows]

    def get_kb(self, kb_id: str, institute_id: str) -> Optional[Dict[str, Any]]:
        """Fetch one KB, enforcing tenant scope in the WHERE clause.

        A PLATFORM-owned KB is readable by any institute; an INSTITUTE-owned one
        only by its owner. Scoping here (rather than in the caller) is what makes
        every endpoint tenant-safe by construction.

        The course store (purpose course_content) reads as not found, so every
        /knowledge-base and /kb-companion route 404s for it.
        """
        row = self.db.execute(
            text(
                f"""
                {_KB_SELECT}
                WHERE kb.id = :kb_id
                  AND (kb.institute_id = :institute_id OR kb.owner_type = 'PLATFORM')
                  AND kb.purpose <> '{COURSE_CONTENT_PURPOSE}'
                """
            ),
            {"kb_id": kb_id, "institute_id": institute_id},
        ).fetchone()
        return self._kb_row(row) if row else None

    def update_kb_meta(self, kb_id: str, institute_id: str, meta: Dict[str, Any]) -> None:
        """Merge keys into knowledge_base.meta_json. Owner only (no owner_type
        guard: the publisher must be able to tag its own PLATFORM bases)."""
        self.db.execute(
            text(
                "UPDATE knowledge_base "
                "   SET meta_json = meta_json || CAST(:meta AS jsonb), "
                "       updated_at = CURRENT_TIMESTAMP "
                " WHERE id = :kb_id AND institute_id = :institute_id"
            ),
            {"kb_id": kb_id, "institute_id": institute_id, "meta": json.dumps(meta)},
        )
        self.db.commit()

    def is_writable(self, kb: Dict[str, Any], institute_id: str) -> bool:
        """Only the owning institute may mutate a knowledge base.

        A PLATFORM library is owned by the publisher institute, so this keeps it
        read-only to every tenant that did not create it while still letting the
        publisher maintain it. Requiring owner_type == 'INSTITUTE' as well —
        which this used to do — locked the publisher out of its OWN library the
        moment it was published: no re-index, no new chapter, no fixing a bad
        ingest. The ownership match alone is what carries the protection.
        """
        return kb["institute_id"] == institute_id

    def is_usable(self, kb: Dict[str, Any], institute_id: str) -> bool:
        """May this institute generate FROM this knowledge base?

        Distinct from readability on purpose. get_kb lets any institute read a
        PLATFORM row because that is what the catalogue page renders — but
        reading the shop window is not the right to take the goods. Every path
        that retrieves passages or writes questions asks THIS instead.
        """
        if kb["institute_id"] == institute_id:
            return True
        if kb["owner_type"] != "PLATFORM":
            return False
        # Published libraries are free; withdrawn ones need the entitlement
        # their buyers hold.
        # Same SQL fragments as list_kbs, so "it is in my list" and "I may use
        # it" cannot diverge.
        return self.db.execute(
            text(
                f"""
                SELECT 1
                  FROM knowledge_base kb
                 WHERE kb.id = :kb_id
                   AND (
                        EXISTS (
                            SELECT 1 FROM knowledge_base_entitlement e
                             WHERE e.knowledge_base_id = kb.id
                               AND e.institute_id = :institute_id
                        )
                        OR {_FREE_LIBRARY_ACCESS_SQL}
                   )
                 LIMIT 1
                """
            ),
            {"kb_id": kb["id"], "institute_id": institute_id},
        ).fetchone() is not None

    def update_kb(
        self,
        kb_id: str,
        institute_id: str,
        *,
        name: Optional[str] = None,
        description: Optional[str] = None,
        purpose: Optional[str] = None,
        language_hint: Optional[str] = None,
        status: Optional[str] = None,
    ) -> None:
        sets, params = [], {"kb_id": kb_id, "institute_id": institute_id}
        for col, val in (
            ("name", name), ("description", description), ("purpose", purpose),
            ("language_hint", language_hint), ("status", status),
        ):
            if val is not None:
                sets.append(f"{col} = :{col}")
                params[col] = val
        if not sets:
            return
        sets.append("updated_at = CURRENT_TIMESTAMP")
        self.db.execute(
            text(
                f"UPDATE knowledge_base SET {', '.join(sets)} "
                "WHERE id = :kb_id AND institute_id = :institute_id "
                "AND owner_type = 'INSTITUTE'"
            ),
            params,
        )
        self.db.commit()

    def delete_kb(self, kb_id: str, institute_id: str) -> None:
        """Hard delete. Sources/pages/figures/nodes/chunks go with it via
        ON DELETE CASCADE."""
        self.db.execute(
            text(
                "DELETE FROM knowledge_base WHERE id = :kb_id "
                "AND institute_id = :institute_id AND owner_type = 'INSTITUTE'"
            ),
            {"kb_id": kb_id, "institute_id": institute_id},
        )
        self.db.commit()

    def refresh_stats(self, kb_id: str) -> Dict[str, int]:
        """Recompute the denormalized counters the list screen renders from."""
        row = self.db.execute(
            text(
                """
                SELECT
                  (SELECT COUNT(*) FROM knowledge_base_source WHERE knowledge_base_id = :kb_id),
                  (SELECT COALESCE(SUM(page_count), 0) FROM knowledge_base_source WHERE knowledge_base_id = :kb_id),
                  (SELECT COUNT(*) FROM kb_chunk WHERE knowledge_base_id = :kb_id),
                  (SELECT COUNT(*) FROM knowledge_base_figure WHERE knowledge_base_id = :kb_id)
                """
            ),
            {"kb_id": kb_id},
        ).fetchone()
        stats = {
            "sources": int(row[0] or 0),
            "pages": int(row[1] or 0),
            "chunks": int(row[2] or 0),
            "figures": int(row[3] or 0),
        }
        self.db.execute(
            text(
                "UPDATE knowledge_base SET stats_json = CAST(:stats AS jsonb), "
                "updated_at = CURRENT_TIMESTAMP WHERE id = :kb_id"
            ),
            {"stats": json.dumps(stats), "kb_id": kb_id},
        )
        self.db.commit()
        return stats

    # ------------------------------------------------------------------
    # knowledge_base_source
    # ------------------------------------------------------------------
    def create_source(
        self,
        *,
        kb_id: str,
        institute_id: str,
        source_kind: str,
        title: str,
        file_id: Optional[str] = None,
        source_url: Optional[str] = None,
        raw_text: Optional[str] = None,
        content_hash: Optional[str] = None,
        page_count: int = 0,
        created_by: Optional[str] = None,
        meta: Optional[Dict[str, Any]] = None,
    ) -> str:
        row = self.db.execute(
            text(
                """
                INSERT INTO knowledge_base_source
                    (knowledge_base_id, institute_id, source_kind, title, file_id,
                     source_url, raw_text, content_hash, page_count, status,
                     created_by, meta_json)
                VALUES
                    (:kb_id, :institute_id, :source_kind, :title, :file_id,
                     :source_url, :raw_text, :content_hash, :page_count, 'PENDING',
                     :created_by, CAST(:meta AS jsonb))
                RETURNING id
                """
            ),
            {
                "kb_id": kb_id, "institute_id": institute_id, "source_kind": source_kind,
                "title": title, "file_id": file_id, "source_url": source_url,
                "raw_text": raw_text, "content_hash": content_hash,
                "page_count": page_count, "created_by": created_by,
                "meta": json.dumps(meta or {}),
            },
        ).fetchone()
        self.db.commit()
        return str(row[0])

    def update_source_fields(
        self,
        source_id: str,
        institute_id: str,
        *,
        title: Optional[str] = None,
        raw_text: Optional[str] = None,
        meta: Optional[Dict[str, Any]] = None,
    ) -> None:
        """Patch user-editable source fields (title / pasted text / metadata)."""
        sets: List[str] = []
        params: Dict[str, Any] = {"source_id": source_id, "institute_id": institute_id}
        if title is not None:
            sets.append("title = :title")
            params["title"] = title
        if raw_text is not None:
            sets.append("raw_text = :raw_text")
            params["raw_text"] = raw_text
        if meta is not None:
            # Merge rather than replace, so writing one key cannot wipe the others.
            sets.append("meta_json = meta_json || CAST(:meta AS jsonb)")
            params["meta"] = json.dumps(meta)
        if not sets:
            return
        sets.append("updated_at = CURRENT_TIMESTAMP")
        self.db.execute(
            text(
                f"UPDATE knowledge_base_source SET {', '.join(sets)} "
                "WHERE id = :source_id AND institute_id = :institute_id"
            ),
            params,
        )
        self.db.commit()

    def list_sources(self, kb_id: str, include_text: bool = False) -> List[Dict[str, Any]]:
        """Sources in a knowledge base.

        `raw_text` is omitted by default: a knowledge base can hold many long
        pasted notes, and shipping all of them on every list render would bloat
        the response for no benefit. The deprecated items API sets
        include_text=True because its contract returns the note body inline.
        """
        text_col = "raw_text" if include_text else "NULL AS raw_text"
        rows = self.db.execute(
            text(
                f"""
                SELECT id, knowledge_base_id, institute_id, source_kind, title,
                       file_id, source_url, status, progress, stage, is_active,
                       page_count, pages_low_confidence, chunk_count, figure_count,
                       detected_languages, parser, ocr_pages, credits_charged,
                       error_message, created_by, created_at, updated_at, meta_json,
                       {text_col}
                FROM knowledge_base_source
                WHERE knowledge_base_id = :kb_id
                ORDER BY created_at DESC
                """
            ),
            {"kb_id": kb_id},
        ).fetchall()
        return [self._source_row(r) for r in rows]

    def get_source(self, source_id: str, institute_id: str) -> Optional[Dict[str, Any]]:
        # A SLIDE source is one lesson of the course store: never served,
        # edited or re-ingested through the knowledge-base routes.
        row = self.db.execute(
            text(
                f"""
                SELECT id, knowledge_base_id, institute_id, source_kind, title,
                       file_id, source_url, status, progress, stage, is_active,
                       page_count, pages_low_confidence, chunk_count, figure_count,
                       detected_languages, parser, ocr_pages, credits_charged,
                       error_message, created_by, created_at, updated_at, meta_json,
                       raw_text
                FROM knowledge_base_source
                WHERE id = :source_id AND institute_id = :institute_id
                  AND source_kind <> '{SLIDE_SOURCE_KIND}'
                """
            ),
            {"source_id": source_id, "institute_id": institute_id},
        ).fetchone()
        return self._source_row(row) if row else None

    def find_source_by_hash(self, kb_id: str, content_hash: str) -> Optional[Dict[str, Any]]:
        """An already-ingested, READY source with identical bytes in this KB.

        Backs the dedup short-circuit: institutes re-upload the same book
        constantly, and re-parsing it is the single most wasteful thing the
        pipeline can do.
        """
        row = self.db.execute(
            text(
                """
                SELECT id, knowledge_base_id, institute_id, source_kind, title,
                       file_id, source_url, status, progress, stage, is_active,
                       page_count, pages_low_confidence, chunk_count, figure_count,
                       detected_languages, parser, ocr_pages, credits_charged,
                       error_message, created_by, created_at, updated_at, meta_json,
                       raw_text
                FROM knowledge_base_source
                WHERE knowledge_base_id = :kb_id AND content_hash = :content_hash
                  AND status IN ('READY', 'PARTIAL')
                ORDER BY created_at DESC LIMIT 1
                """
            ),
            {"kb_id": kb_id, "content_hash": content_hash},
        ).fetchone()
        return self._source_row(row) if row else None

    def update_source_progress(
        self,
        source_id: str,
        *,
        status: Optional[str] = None,
        progress: Optional[int] = None,
        stage: Optional[str] = None,
        error_message: Optional[str] = None,
        ai_task_id: Optional[str] = None,
        **counters: Any,
    ) -> None:
        """Patch job state. ``counters`` accepts any of page_count,
        pages_low_confidence, chunk_count, figure_count, ocr_pages, parser,
        detected_languages, credits_charged."""
        allowed = {
            "page_count", "pages_low_confidence", "chunk_count", "figure_count",
            "ocr_pages", "parser", "detected_languages", "credits_charged",
        }
        sets, params = [], {"source_id": source_id}
        for col, val in (
            ("status", status), ("progress", progress), ("stage", stage),
            ("error_message", error_message), ("ai_task_id", ai_task_id),
        ):
            if val is not None:
                sets.append(f"{col} = :{col}")
                params[col] = val
        for col, val in counters.items():
            if col in allowed and val is not None:
                sets.append(f"{col} = :{col}")
                params[col] = val
        if not sets:
            return
        sets.append("updated_at = CURRENT_TIMESTAMP")
        self.db.execute(
            text(f"UPDATE knowledge_base_source SET {', '.join(sets)} WHERE id = :source_id"),
            params,
        )
        self.db.commit()

    def set_source_active(self, source_id: str, institute_id: str, is_active: bool) -> None:
        self.db.execute(
            text(
                "UPDATE knowledge_base_source SET is_active = :is_active, "
                "updated_at = CURRENT_TIMESTAMP "
                "WHERE id = :source_id AND institute_id = :institute_id"
            ),
            {"is_active": is_active, "source_id": source_id, "institute_id": institute_id},
        )
        self.db.commit()

    def delete_source(self, source_id: str, institute_id: str) -> None:
        """Pages/figures/nodes/chunks cascade."""
        self.db.execute(
            text(
                "DELETE FROM knowledge_base_source "
                "WHERE id = :source_id AND institute_id = :institute_id"
            ),
            {"source_id": source_id, "institute_id": institute_id},
        )
        self.db.commit()

    def clear_source_derivatives(self, source_id: str) -> None:
        """Drop everything derived from a source, keeping the source row.

        Used on re-index so a retry cannot double up pages, figures or chunks.
        """
        for table in ("kb_chunk", "knowledge_base_node", "knowledge_base_figure", "knowledge_base_page"):
            self.db.execute(text(f"DELETE FROM {table} WHERE source_id = :source_id"), {"source_id": source_id})
        self.db.commit()

    # ------------------------------------------------------------------
    # pages / figures / nodes
    # ------------------------------------------------------------------
    def insert_pages(self, kb_id: str, institute_id: str, source_id: str, pages: Sequence[Any]) -> None:
        """Bulk-insert page provenance rows. ``pages`` are ParsedPage objects."""
        if not pages:
            return
        self.db.execute(
            text(
                """
                INSERT INTO knowledge_base_page
                    (source_id, knowledge_base_id, institute_id, page_number,
                     text_chars, confidence, parser, needs_review, preview_url)
                VALUES
                    (:source_id, :kb_id, :institute_id, :page_number,
                     :text_chars, :confidence, :parser, :needs_review, :preview_url)
                ON CONFLICT (source_id, page_number) DO UPDATE SET
                    text_chars = EXCLUDED.text_chars,
                    confidence = EXCLUDED.confidence,
                    parser = EXCLUDED.parser,
                    needs_review = EXCLUDED.needs_review
                """
            ),
            [
                {
                    "source_id": source_id, "kb_id": kb_id, "institute_id": institute_id,
                    "page_number": p.page_number, "text_chars": len(p.text or ""),
                    "confidence": p.confidence, "parser": p.parser,
                    "needs_review": p.needs_review, "preview_url": p.preview_url,
                }
                for p in pages
            ],
        )
        self.db.commit()

    def insert_figures(self, kb_id: str, institute_id: str, source_id: str, figures: Sequence[Any]) -> List[str]:
        """Bulk-insert figures; returns their ids in input order so chunks can
        reference them."""
        if not figures:
            return []
        ids: List[str] = []
        for idx, fig in enumerate(figures):
            row = self.db.execute(
                text(
                    """
                    INSERT INTO knowledge_base_figure
                        (source_id, knowledge_base_id, institute_id, page_number,
                         kind, image_url, caption, alt_text, table_html, ordinal)
                    VALUES
                        (:source_id, :kb_id, :institute_id, :page_number,
                         :kind, :image_url, :caption, :alt_text, :table_html, :ordinal)
                    RETURNING id
                    """
                ),
                {
                    "source_id": source_id, "kb_id": kb_id, "institute_id": institute_id,
                    "page_number": fig.page_number, "kind": fig.kind,
                    "image_url": fig.image_url, "caption": fig.caption,
                    "alt_text": fig.alt_text, "table_html": fig.table_html, "ordinal": idx,
                },
            ).fetchone()
            ids.append(str(row[0]))
        self.db.commit()
        return ids

    def list_figures(self, source_id: str) -> List[Dict[str, Any]]:
        rows = self.db.execute(
            text(
                "SELECT id, page_number, kind, image_url, caption, alt_text, table_html "
                "FROM knowledge_base_figure WHERE source_id = :source_id ORDER BY ordinal"
            ),
            {"source_id": source_id},
        ).fetchall()
        return [
            {
                "id": r[0], "page_number": r[1], "kind": r[2], "image_url": r[3],
                "caption": r[4], "alt_text": r[5], "table_html": r[6],
            }
            for r in rows
        ]

    def insert_node(
        self,
        *,
        kb_id: str,
        institute_id: str,
        source_id: Optional[str],
        parent_id: Optional[str],
        level: str,
        title: Optional[str],
        summary: Optional[str],
        keywords: Optional[List[str]] = None,
        page_start: Optional[int] = None,
        page_end: Optional[int] = None,
        ordinal: int = 0,
    ) -> str:
        row = self.db.execute(
            text(
                """
                INSERT INTO knowledge_base_node
                    (knowledge_base_id, source_id, institute_id, parent_id, level,
                     title, summary, keywords, page_start, page_end, ordinal)
                VALUES
                    (:kb_id, :source_id, :institute_id, :parent_id, :level,
                     :title, :summary, :keywords, :page_start, :page_end, :ordinal)
                RETURNING id
                """
            ),
            {
                "kb_id": kb_id, "source_id": source_id, "institute_id": institute_id,
                "parent_id": parent_id, "level": level, "title": title,
                "summary": summary, "keywords": keywords or [],
                "page_start": page_start, "page_end": page_end, "ordinal": ordinal,
            },
        ).fetchone()
        self.db.commit()
        return str(row[0])

    # ------------------------------------------------------------------
    # Topic tree (V443) — cross-source, level IN ('topic','subtopic'),
    # source_id IS NULL because a topic spans sources.
    # ------------------------------------------------------------------
    def replace_topic_tree(self, kb_id: str, institute_id: str, topics: Sequence[Any]) -> int:
        """Swap in a freshly derived topic tree.

        Delete-then-insert in ONE transaction: the tree is a derived view, and a
        partial rebuild would leave the picker showing a mix of old and new
        topics. Only touches topic rows — the per-source summary tree
        (book/chapter/section) is left alone.

        A node may carry `source_id` (an AUTHORED tree sets it: one topic per
        chapter source). It is what lets link_chunks_to_nodes match a
        subtopic's page span against the RIGHT source — every chapter PDF starts
        at page 1, so a KB-wide (source_id NULL) subtopic spanning pages 3-7
        would otherwise claim page 3-7 of every chapter in the book.

        With kb.stable_topic_ids on, the tree is matched and pruned instead of
        replaced, so unchanged nodes keep their ids (_replace_topic_tree_stable).
        """
        if stable_topic_ids_enabled():
            return self._replace_topic_tree_stable(kb_id, institute_id, topics)
        self.db.execute(
            text(
                "DELETE FROM knowledge_base_node "
                "WHERE knowledge_base_id = :kb_id AND level IN ('topic', 'subtopic')"
            ),
            {"kb_id": kb_id},
        )
        written = 0
        for t_ordinal, topic in enumerate(topics, start=1):
            row = self.db.execute(
                text(
                    """
                    INSERT INTO knowledge_base_node
                        (id, knowledge_base_id, source_id, institute_id, parent_id, level,
                         title, summary, keywords, page_start, page_end, ordinal)
                    VALUES
                        (COALESCE(CAST(:id AS VARCHAR), CAST(gen_random_uuid() AS VARCHAR)),
                         :kb_id, :source_id, :institute_id, NULL, 'topic',
                         :title, :summary, :keywords, :page_start, :page_end, :ordinal)
                    RETURNING id
                    """
                ),
                {
                    "kb_id": kb_id, "institute_id": institute_id, "title": topic.title,
                    # AUTHORED trees mint deterministic ids so a rebuild keeps
                    # the ids a saved blueprint / course plan already holds.
                    "id": getattr(topic, "id", None),
                    "source_id": getattr(topic, "source_id", None),
                    "summary": topic.summary, "keywords": topic.keywords,
                    "page_start": topic.page_start, "page_end": topic.page_end,
                    "ordinal": t_ordinal,
                },
            ).fetchone()
            topic_id = str(row[0])
            written += 1
            for s_ordinal, sub in enumerate(topic.subtopics, start=1):
                self.db.execute(
                    text(
                        """
                        INSERT INTO knowledge_base_node
                            (id, knowledge_base_id, source_id, institute_id, parent_id, level,
                             title, summary, keywords, page_start, page_end, ordinal)
                        VALUES
                            (COALESCE(CAST(:id AS VARCHAR), CAST(gen_random_uuid() AS VARCHAR)),
                             :kb_id, :source_id, :institute_id, :parent_id, 'subtopic',
                             :title, :summary, :keywords, :page_start, :page_end, :ordinal)
                        """
                    ),
                    {
                        "kb_id": kb_id, "institute_id": institute_id, "parent_id": topic_id,
                        "id": getattr(sub, "id", None),
                        "source_id": getattr(sub, "source_id", None)
                        or getattr(topic, "source_id", None),
                        "title": sub.title, "summary": sub.summary, "keywords": sub.keywords,
                        "page_start": sub.page_start, "page_end": sub.page_end,
                        "ordinal": s_ordinal,
                    },
                )
                written += 1
        self.db.commit()
        return written

    _UPSERT_TOPIC_NODE_SQL = """
        INSERT INTO knowledge_base_node
            (id, knowledge_base_id, source_id, institute_id, parent_id, level,
             title, summary, keywords, page_start, page_end, ordinal)
        VALUES
            (:id, :kb_id, :source_id, :institute_id, :parent_id, :level,
             :title, :summary, :keywords, :page_start, :page_end, :ordinal)
        ON CONFLICT (id) DO UPDATE SET
            parent_id = EXCLUDED.parent_id,
            level = EXCLUDED.level,
            source_id = EXCLUDED.source_id,
            title = EXCLUDED.title,
            summary = EXCLUDED.summary,
            keywords = EXCLUDED.keywords,
            page_start = EXCLUDED.page_start,
            page_end = EXCLUDED.page_end,
            ordinal = EXCLUDED.ordinal
        WHERE knowledge_base_node.knowledge_base_id = EXCLUDED.knowledge_base_id
          AND knowledge_base_node.level IN ('topic', 'subtopic')
        RETURNING id
    """

    def _replace_topic_tree_stable(
        self, kb_id: str, institute_id: str, topics: Sequence[Any]
    ) -> int:
        """Match, upsert, then prune, in ONE transaction (kb.stable_topic_ids).

        Ids come from plan_topic_node_ids. Topics are written before subtopics
        so a re-parented subtopic already points at its new parent when the old
        one goes. Pruning deletes subtopics before topics: the parent foreign
        key cascades, and a topic deleted first would take with it a child the
        new tree still has. kb_chunk.node_id (ON DELETE SET NULL) therefore
        survives for every node that is kept.
        """
        try:
            # Serialises rebuilds of one KB: two concurrent ingests finishing
            # together would otherwise each prune only the rows they loaded and
            # leave the other's new nodes behind as duplicates.
            self.db.execute(
                text("SELECT id FROM knowledge_base WHERE id = :kb_id FOR UPDATE"),
                {"kb_id": kb_id},
            )
            rows = self.db.execute(
                text(
                    """
                    SELECT id, parent_id, level, source_id, title, keywords
                    FROM knowledge_base_node
                    WHERE knowledge_base_id = :kb_id AND level IN ('topic', 'subtopic')
                    ORDER BY ordinal, id
                    """
                ),
                {"kb_id": kb_id},
            ).fetchall()
            existing = [
                _ExistingTopicNode(
                    id=str(r[0]), parent_id=str(r[1]) if r[1] else None, level=r[2],
                    source_id=r[3], title=r[4], keywords=list(r[5] or []),
                )
                for r in rows
            ]
            planned = plan_topic_node_ids(kb_id, existing, topics)

            written = 0
            for p in [*planned, *(c for tp in planned for c in tp.children)]:
                node = p.node
                row = self.db.execute(
                    text(self._UPSERT_TOPIC_NODE_SQL),
                    {
                        "id": p.id, "kb_id": kb_id, "institute_id": institute_id,
                        "source_id": p.source_id,
                        "parent_id": p.parent.id if p.parent is not None else None,
                        "level": p.level, "title": node.title, "summary": node.summary,
                        "keywords": list(node.keywords or []),
                        "page_start": node.page_start, "page_end": node.page_end,
                        "ordinal": p.ordinal,
                    },
                ).fetchone()
                if row is None:
                    # The id belongs to a row outside this KB's topic tree.
                    raise RuntimeError(f"Topic node id {p.id} is held by another node")
                written += 1

            kept = {p.id for tp in planned for p in [tp, *tp.children]}
            for level in ("subtopic", "topic"):
                stale = [n.id for n in existing if n.level == level and n.id not in kept]
                if stale:
                    self.db.execute(
                        text(
                            "DELETE FROM knowledge_base_node "
                            "WHERE knowledge_base_id = :kb_id AND id = ANY(:ids)"
                        ),
                        {"kb_id": kb_id, "ids": stale},
                    )
            self.db.commit()
        except Exception:
            self.db.rollback()
            raise
        return written

    def get_topic_tree(self, kb_id: str) -> List[Dict[str, Any]]:
        """The topic tree as topics each carrying their subtopics."""
        rows = self.db.execute(
            text(
                """
                SELECT id, parent_id, level, title, summary, keywords,
                       page_start, page_end, ordinal, source_id
                FROM knowledge_base_node
                WHERE knowledge_base_id = :kb_id AND level IN ('topic', 'subtopic')
                ORDER BY ordinal
                """
            ),
            {"kb_id": kb_id},
        ).fetchall()

        topics: Dict[str, Dict[str, Any]] = {}
        children: List[Dict[str, Any]] = []
        for r in rows:
            node = {
                "id": r[0], "parent_id": r[1], "level": r[2], "title": r[3],
                "summary": r[4], "keywords": list(r[5] or []),
                "page_start": r[6], "page_end": r[7], "ordinal": r[8],
                "source_id": r[9],
            }
            if r[2] == "topic":
                node["subtopics"] = []
                topics[r[0]] = node
            else:
                children.append(node)
        for child in children:
            parent = topics.get(child["parent_id"])
            if parent:
                parent["subtopics"].append(child)
        ordered = sorted(topics.values(), key=lambda t: t["ordinal"])
        for topic in ordered:
            topic["subtopics"].sort(key=lambda s: s["ordinal"])
        return ordered

    def sources_with_chunks(self, kb_id: str) -> List[str]:
        """Sources that have at least one embedded chunk, whatever their status.

        The authored tree is rebuilt at the END of an ingest while the source
        row still reads PROCESSING (status flips to READY/PARTIAL only in the
        finalize step), so "has chunks" — not status — is the test for
        "belongs in the tree". A source mid-parse has no chunks yet and is
        left out until its own rebuild."""
        rows = self.db.execute(
            text(
                "SELECT DISTINCT source_id FROM kb_chunk "
                "WHERE knowledge_base_id = :kb_id AND source_id IS NOT NULL"
            ),
            {"kb_id": kb_id},
        ).fetchall()
        return [r[0] for r in rows]

    def clear_source_headings_cache(self, source_id: str) -> None:
        """Drop the cached verbatim headings so a re-index re-reads the text."""
        self.db.execute(
            text(
                "UPDATE knowledge_base_source SET meta_json = meta_json - 'headings' "
                "WHERE id = :source_id"
            ),
            {"source_id": source_id},
        )
        self.db.commit()

    def get_node_source_ids(self, kb_id: str, node_ids: Sequence[str]) -> List[str]:
        """Sources the given topic-tree nodes belong to (distinct, order-free).

        Empty for an LLM-derived tree, whose nodes span sources and carry no
        source_id — callers then fall back to a KB-wide search. For an AUTHORED
        tree every node is one chapter, so this is "the chapters the teacher
        ticked", and retrieval can be pinned to exactly those.
        """
        if not node_ids:
            return []
        rows = self.db.execute(
            text(
                """
                SELECT DISTINCT n.source_id
                  FROM knowledge_base_node n
                 WHERE n.knowledge_base_id = :kb_id
                   AND n.id = ANY(CAST(:node_ids AS TEXT[]))
                   AND n.source_id IS NOT NULL
                """
            ),
            {"kb_id": kb_id, "node_ids": [str(n) for n in node_ids]},
        ).fetchall()
        return [r[0] for r in rows]

    def link_chunks_to_nodes(self, source_id: str) -> int:
        """Attach each chunk to the section node covering its pages.

        Run AFTER the summary tree exists (chunks are embedded first, so the
        node ids do not exist at insert time). Without this, kb_chunk.node_id
        stays NULL and Phase 2 cannot go outline → passages: a planner that
        picked "section 3.2 — s-block elements" would have no way to pull the
        passages belonging to it without re-deriving the mapping from page
        numbers every time.

        Picks the narrowest containing section so a chunk lands on the most
        specific node rather than the book. Returns rows updated.
        """
        result = self.db.execute(
            text(
                """
                UPDATE kb_chunk c
                   SET node_id = n.id
                  FROM (
                      SELECT DISTINCT ON (ch.id) ch.id AS chunk_id, nd.id
                      FROM kb_chunk ch
                      JOIN knowledge_base_node nd
                        ON (
                             -- summary-tree sections belong to this source;
                             -- topic-tree subtopics are KB-wide (source_id NULL)
                             nd.source_id = ch.source_id
                             OR (nd.source_id IS NULL
                                 AND nd.knowledge_base_id = ch.knowledge_base_id)
                           )
                       AND (
                             nd.level IN ('section', 'subtopic')
                             -- an AUTHORED chapter topic (source-bound) owns its
                             -- chunks too, so a chapter with no printed
                             -- sub-headings is still retrievable by node
                             OR (nd.level = 'topic' AND nd.source_id IS NOT NULL)
                           )
                       AND nd.page_start IS NOT NULL
                       AND nd.page_end IS NOT NULL
                       AND ch.page_start IS NOT NULL
                       AND ch.page_start BETWEEN nd.page_start AND nd.page_end
                      WHERE ch.source_id = :source_id
                      -- Source-bound topic-tree nodes (authored trees) are the
                      -- picker's own view of this source, so they beat the
                      -- summary sections outright. Otherwise: narrowest
                      -- containing node wins; on a tie prefer the SUBTOPIC —
                      -- that is the node course slides retrieve by, and
                      -- section-only linkage left every chunk invisible to
                      -- node-scoped grounding (two client audits hit this)
                      ORDER BY ch.id,
                               CASE WHEN nd.source_id IS NOT NULL
                                     AND nd.level IN ('topic', 'subtopic')
                                    THEN 0 ELSE 1 END,
                               (nd.page_end - nd.page_start) ASC,
                               CASE nd.level WHEN 'subtopic' THEN 0 ELSE 1 END
                  ) AS n
                 WHERE c.id = n.chunk_id
                """
            ),
            {"source_id": source_id},
        )
        self.db.commit()
        return result.rowcount or 0

    def get_structure_outline(self, kb_id: str, max_nodes: int = 400) -> List[Dict[str, Any]]:
        """The compact structural index for whole-corpus planning.

        Phase 2's course-outline and full-question-paper generators read THIS,
        not vector hits: top-k retrieval cannot see a whole book, so planning
        from retrieval alone yields lumpy, incomplete coverage. Bounded so the
        planner prompt stays small.
        """
        rows = self.db.execute(
            text(
                """
                SELECT n.id, n.source_id, n.parent_id, n.level, n.title, n.summary,
                       n.keywords, n.page_start, n.page_end, s.title AS source_title
                FROM knowledge_base_node n
                LEFT JOIN knowledge_base_source s ON s.id = n.source_id
                WHERE n.knowledge_base_id = :kb_id
                  AND n.level IN ('book', 'chapter', 'section')
                -- Order as a reader (and a planner) expects: each parent
                -- immediately before its children.
                --
                -- NOT `ORDER BY ordinal`: book/chapter/section ordinals are
                -- three independent sequences, so sorting on ordinal alone
                -- interleaves them (chapter 2 landing between section 1.1 and
                -- section 1.2). Page position plus a level rank reconstructs
                -- document order, because a chapter always starts on or before
                -- its first section.
                ORDER BY n.source_id,
                         COALESCE(n.page_start, 0),
                         CASE n.level WHEN 'book' THEN 0 WHEN 'chapter' THEN 1 ELSE 2 END,
                         n.ordinal
                LIMIT :max_nodes
                """
            ),
            {"kb_id": kb_id, "max_nodes": max_nodes},
        ).fetchall()
        return [
            {
                "id": r[0], "source_id": r[1], "parent_id": r[2], "level": r[3],
                "title": r[4], "summary": r[5], "keywords": list(r[6] or []),
                "page_start": r[7], "page_end": r[8], "source_title": r[9],
            }
            for r in rows
        ]

    # ------------------------------------------------------------------
    # kb_chunk
    # ------------------------------------------------------------------
    def insert_chunks(
        self,
        *,
        kb_id: str,
        institute_id: str,
        source_id: str,
        chunks: Sequence[ChunkToStore],
        model: EmbeddingModelSpec,
    ) -> int:
        """Persist embedded chunks. Chunks whose embedding is None are SKIPPED —
        a NULL vector would satisfy no dimension branch of the
        kb_chunk_vector_matches_dim CHECK, and an unsearchable row is worse than
        an absent one because it inflates the chunk count and hides the failure.
        Returns the number stored.
        """
        col = self.vector_column_for_dim(model.dim)
        stored = 0
        for chunk in chunks:
            if not chunk.embedding:
                continue
            try:
                self.db.execute(
                    text(
                        f"""
                        INSERT INTO kb_chunk
                            (knowledge_base_id, source_id, institute_id, content_text,
                             chunk_index, page_start, page_end, node_id, figure_ids,
                             lang, embedding_model, embedding_dim, {col}, meta_data)
                        VALUES
                            (:kb_id, :source_id, :institute_id, :content_text,
                             :chunk_index, :page_start, :page_end, :node_id, :figure_ids,
                             :lang, :embedding_model, :embedding_dim,
                             CAST(:embedding AS vector), CAST(:meta_data AS jsonb))
                        """
                    ),
                    {
                        "kb_id": kb_id, "source_id": source_id, "institute_id": institute_id,
                        "content_text": chunk.content_text, "chunk_index": chunk.chunk_index,
                        "page_start": chunk.page_start, "page_end": chunk.page_end,
                        "node_id": chunk.node_id, "figure_ids": chunk.figure_ids,
                        "lang": chunk.lang, "embedding_model": model.model_id,
                        "embedding_dim": model.dim, "embedding": str(chunk.embedding),
                        "meta_data": json.dumps(chunk.meta_data or {}),
                    },
                )
                self.db.commit()
                stored += 1
            except Exception as exc:  # noqa: BLE001
                logger.error(
                    "kb_chunk insert failed (source=%s idx=%s): %s",
                    source_id, chunk.chunk_index, exc,
                )
                self.db.rollback()
        return stored

    def search_chunks(
        self,
        *,
        kb_id: str,
        institute_id: str,
        query_embedding: List[float],
        embedding_dim: int,
        top_k: int = 8,
        similarity_threshold: float = 0.25,
        source_ids: Optional[Sequence[str]] = None,
    ) -> List[Dict[str, Any]]:
        """Vector search inside ONE knowledge base.

        Scoped by kb_id AND institute_id (a PLATFORM KB is matched via its own
        institute_id, resolved by the caller through get_kb), filtered to the
        declared embedding dimension so a KB pinned to one embedder can never
        rank against another's vectors, and restricted to active sources.

        `source_ids` narrows the search to particular sources. For a textbook
        library where every chapter is its own source, this is what turns
        "questions on Chapter 5" from a similarity hope into a guarantee.

        Returns FULL chunk text — deliberately NOT truncated. The legacy
        rag_service truncates to 1000 chars while chunking at 2000, silently
        discarding half of every retrieved chunk; for question generation that
        can cut a worked example in half.
        """
        col = self.vector_column_for_dim(embedding_dim)
        source_clause = ""
        params: Dict[str, Any] = {
            "kb_id": kb_id, "institute_id": institute_id,
            "query_vec": str(query_embedding), "embedding_dim": embedding_dim,
            "threshold": similarity_threshold, "top_k": top_k,
        }
        if source_ids:
            # A TEXT[] bind rather than an expanding IN-list: the same statement
            # text is reused whatever the number of chapters ticked.
            source_clause = "AND c.source_id = ANY(CAST(:source_ids AS TEXT[]))"
            params["source_ids"] = [str(s) for s in source_ids]
        rows = self.db.execute(
            text(
                f"""
                SELECT c.id, c.content_text, c.page_start, c.page_end, c.figure_ids,
                       c.lang, c.meta_data, c.source_id, s.title AS source_title,
                       1 - (c.{col} <=> CAST(:query_vec AS vector)) AS similarity
                FROM kb_chunk c
                JOIN knowledge_base_source s ON s.id = c.source_id
                WHERE c.knowledge_base_id = :kb_id
                  AND c.institute_id = :institute_id
                  AND c.embedding_dim = :embedding_dim
                  AND c.{col} IS NOT NULL
                  AND s.is_active = TRUE
                  {source_clause}
                  AND 1 - (c.{col} <=> CAST(:query_vec AS vector)) > :threshold
                ORDER BY c.{col} <=> CAST(:query_vec AS vector)
                LIMIT :top_k
                """
            ),
            params,
        ).fetchall()
        return [
            {
                "chunk_id": r[0], "content_text": r[1], "page_start": r[2], "page_end": r[3],
                "figure_ids": list(r[4] or []), "lang": r[5], "metadata": r[6] or {},
                "source_id": r[7], "source_title": r[8],
                "similarity_score": round(float(r[9]), 4),
            }
            for r in rows
        ]

    def get_chunks_for_node(
        self, *, kb_id: str, institute_id: str, node_id: str, limit: int = 40,
        chunk_from: Optional[int] = None, chunk_to: Optional[int] = None,
    ) -> List[Dict[str, Any]]:
        """EVERY chunk of one topic-tree section, in source order.

        Whole-section grounding for faithful courses: similarity top-k over a
        section can miss the very sub-parts a client prescribed (two feedback
        rounds hit this), whereas the section's own chunks — kb_chunk.node_id
        is linked at ingest — ARE the section. Same dict shape as
        search_chunks so the passage builder is agnostic; similarity is 1.0
        because membership, not ranking, is the relevance claim.

        `chunk_from` / `chunk_to` (inclusive chunk_index bounds) narrow the
        section to one PART of it: a section too large for a single slide's
        grounding budget is split into parts at outline time, and each part
        must retrieve only its own window — otherwise every part would see the
        same first 28k characters and the tail of the section would never be
        taught."""
        window = ""
        params: Dict[str, Any] = {
            "kb_id": kb_id, "institute_id": institute_id,
            "node_id": node_id, "limit": limit,
        }
        if chunk_from is not None and chunk_to is not None:
            window = "AND c.chunk_index BETWEEN :chunk_from AND :chunk_to"
            params["chunk_from"], params["chunk_to"] = int(chunk_from), int(chunk_to)
        rows = self.db.execute(
            text(
                f"""
                SELECT c.id, c.content_text, c.page_start, c.page_end, c.figure_ids,
                       c.lang, c.meta_data, c.source_id, s.title AS source_title,
                       c.chunk_index
                FROM kb_chunk c
                JOIN knowledge_base_source s ON s.id = c.source_id
                WHERE c.knowledge_base_id = :kb_id
                  AND c.institute_id = :institute_id
                  AND c.node_id = :node_id
                  AND s.is_active = TRUE
                  {window}
                ORDER BY c.chunk_index
                LIMIT :limit
                """
            ),
            params,
        ).fetchall()
        return [
            {
                "chunk_id": r[0], "content_text": r[1], "page_start": r[2], "page_end": r[3],
                "figure_ids": list(r[4] or []), "lang": r[5], "metadata": r[6] or {},
                "source_id": r[7], "source_title": r[8], "chunk_index": r[9],
                "similarity_score": 1.0,
            }
            for r in rows
        ]

    def get_node_chunk_profiles(
        self, *, kb_id: str, institute_id: str, node_ids: List[str]
    ) -> Dict[str, List[Dict[str, Any]]]:
        """Size-only view of every chunk linked to the given sections, in source
        order: {node_id: [{chunk_index, chars, page_start, page_end}, ...]}.

        One query for the whole outline. Lets the deterministic outline decide
        which sections are too large for one slide WITHOUT pulling their text,
        which is what a 300-page textbook with 150 sections would otherwise do
        at outline time."""
        if not node_ids:
            return {}
        rows = self.db.execute(
            text(
                """
                SELECT c.node_id, c.chunk_index, length(c.content_text), c.page_start, c.page_end
                FROM kb_chunk c
                JOIN knowledge_base_source s ON s.id = c.source_id
                WHERE c.knowledge_base_id = :kb_id
                  AND c.institute_id = :institute_id
                  AND c.node_id = ANY(:node_ids)
                  AND s.is_active = TRUE
                ORDER BY c.node_id, c.chunk_index
                """
            ),
            {"kb_id": kb_id, "institute_id": institute_id, "node_ids": list(node_ids)},
        ).fetchall()
        out: Dict[str, List[Dict[str, Any]]] = {}
        for node_id, idx, chars, ps, pe in rows:
            out.setdefault(node_id, []).append(
                {"chunk_index": idx, "chars": int(chars or 0), "page_start": ps, "page_end": pe}
            )
        return out

    def get_chunks_for_pages(
        self, *, kb_id: str, institute_id: str, page_start: int, page_end: int, limit: int = 40,
        source_id: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """Every chunk within a page span, in source order.

        The generation-time bridge for KBs whose chunks were linked to nodes no
        slide uses (section-only linkage shipped twice): a deterministic slide
        knows its section's PAGE SPAN even when node_id retrieval comes back
        empty, and pages are the one join both trees share.

        `source_id` pins the span to one source: in a textbook library every
        chapter restarts at page 1, so an unscoped "pages 3-7" would return
        page 3-7 of every chapter."""
        source_clause = "AND c.source_id = :source_id" if source_id else ""
        rows = self.db.execute(
            text(
                f"""
                SELECT c.id, c.content_text, c.page_start, c.page_end, c.figure_ids,
                       c.lang, c.meta_data, c.source_id, s.title AS source_title
                FROM kb_chunk c
                JOIN knowledge_base_source s ON s.id = c.source_id
                WHERE c.knowledge_base_id = :kb_id
                  AND c.institute_id = :institute_id
                  AND c.page_start IS NOT NULL
                  AND c.page_start BETWEEN :ps AND :pe
                  AND s.is_active = TRUE
                  {source_clause}
                ORDER BY c.page_start, c.chunk_index
                LIMIT :limit
                """
            ),
            {"kb_id": kb_id, "institute_id": institute_id,
             "ps": page_start, "pe": page_end, "limit": limit, "source_id": source_id},
        ).fetchall()
        return [
            {
                "chunk_id": r[0], "content_text": r[1], "page_start": r[2], "page_end": r[3],
                "figure_ids": list(r[4] or []), "lang": r[5], "metadata": r[6] or {},
                "source_id": r[7], "source_title": r[8],
                "similarity_score": 1.0,
            }
            for r in rows
        ]

    def get_all_chunk_summaries(
        self, *, kb_id: str, institute_id: str, limit: int = 400,
        source_id: Optional[str] = None, source_ids: Optional[Sequence[str]] = None,
    ) -> List[Dict[str, Any]]:
        """Every active chunk of a KB, page-ordered — the coverage-sweep census.

        FULL-coverage courses must not silently drop material, but per-slide
        retrieval (node-scoped OR similarity) can only cover chunks it reaches:
        chunks linked to tree nodes no slide uses (ingest linked a whole KB to
        'section' nodes while the outline teaches topic/subtopic nodes) were
        invisible to every slide. The sweep diffs this census against what the
        slides actually retrieved.

        `source_id` restricts the census to one source (the authored topic
        tree reads one chapter at a time); `source_ids` to a set of them (the
        coverage sweep of a course built from a few chapters of a textbook)."""
        source_clause = ""
        if source_id:
            source_clause = "AND c.source_id = :source_id"
        elif source_ids:
            source_clause = "AND c.source_id = ANY(CAST(:source_ids AS TEXT[]))"
        rows = self.db.execute(
            text(
                f"""
                SELECT c.id, c.content_text, c.page_start, c.page_end, s.title AS source_title,
                       c.source_id
                FROM kb_chunk c
                JOIN knowledge_base_source s ON s.id = c.source_id
                WHERE c.knowledge_base_id = :kb_id
                  AND c.institute_id = :institute_id
                  AND s.is_active = TRUE
                  {source_clause}
                ORDER BY c.page_start NULLS LAST, c.chunk_index
                LIMIT :limit
                """
            ),
            {
                "kb_id": kb_id, "institute_id": institute_id, "limit": limit,
                "source_id": source_id,
                "source_ids": [str(x) for x in (source_ids or [])],
            },
        ).fetchall()
        return [
            {
                "chunk_id": r[0], "content_text": r[1], "page_start": r[2],
                "page_end": r[3], "source_title": r[4], "source_id": r[5],
            }
            for r in rows
        ]

    def search_institute_wide(
        self,
        *,
        institute_id: str,
        query_embedding: List[float],
        embedding_dim: int,
        top_k: int = 5,
        similarity_threshold: float = 0.35,
        purposes: Optional[List[str]] = None,
        embedding_model: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """Search across all of an institute's KBs at once.

        Backs the existing chatbot/assistant readers, which have a question but
        no particular knowledge base in mind. ``purposes`` narrows to e.g.
        ['institute_info'] so a policy question isn't answered out of a textbook.

        The course store is never searched here, whatever ``purposes`` says: its
        lessons are drip-, enrolment- and status-gated per learner, and only the
        course-knowledge retrieval gateway applies those rules.
        """
        col = self.vector_column_for_dim(embedding_dim)
        purpose_clause = "AND kb.purpose = ANY(:purposes)" if purposes else ""
        # Same width is not the same space: bge and gemini are both 768-d.
        model_clause = "AND c.embedding_model = :embedding_model" if embedding_model else ""
        params: Dict[str, Any] = {
            "institute_id": institute_id, "query_vec": str(query_embedding),
            "embedding_dim": embedding_dim, "threshold": similarity_threshold, "top_k": top_k,
            "embedding_model": embedding_model,
        }
        if purposes:
            params["purposes"] = purposes
        rows = self.db.execute(
            text(
                f"""
                SELECT c.id, c.content_text, c.page_start, c.page_end, c.figure_ids,
                       c.lang, c.meta_data, c.source_id, s.title AS source_title,
                       kb.id AS kb_id, kb.name AS kb_name, kb.purpose,
                       1 - (c.{col} <=> CAST(:query_vec AS vector)) AS similarity
                FROM kb_chunk c
                JOIN knowledge_base_source s ON s.id = c.source_id
                JOIN knowledge_base kb ON kb.id = c.knowledge_base_id
                WHERE c.institute_id = :institute_id
                  AND c.embedding_dim = :embedding_dim
                  {model_clause}
                  AND c.{col} IS NOT NULL
                  AND s.is_active = TRUE
                  AND kb.status = 'ACTIVE'
                  AND kb.purpose <> '{COURSE_CONTENT_PURPOSE}'
                  {purpose_clause}
                  AND 1 - (c.{col} <=> CAST(:query_vec AS vector)) > :threshold
                ORDER BY c.{col} <=> CAST(:query_vec AS vector)
                LIMIT :top_k
                """
            ),
            params,
        ).fetchall()
        return [
            {
                "chunk_id": r[0], "content_text": r[1], "page_start": r[2], "page_end": r[3],
                "figure_ids": list(r[4] or []), "lang": r[5], "metadata": r[6] or {},
                "source_id": r[7], "source_title": r[8], "knowledge_base_id": r[9],
                "knowledge_base_name": r[10], "purpose": r[11],
                "similarity_score": round(float(r[12]), 4),
            }
            for r in rows
        ]

    def list_review_pages(self, kb_id: str, limit: int = 100) -> List[Dict[str, Any]]:
        """Pages the parser flagged as unreliable, for the quality gate."""
        rows = self.db.execute(
            text(
                """
                SELECT p.id, p.source_id, s.title, p.page_number, p.confidence,
                       p.parser, p.text_chars, p.preview_url
                FROM knowledge_base_page p
                JOIN knowledge_base_source s ON s.id = p.source_id
                WHERE p.knowledge_base_id = :kb_id AND p.needs_review = TRUE
                ORDER BY p.confidence NULLS FIRST, s.title, p.page_number
                LIMIT :limit
                """
            ),
            {"kb_id": kb_id, "limit": limit},
        ).fetchall()
        return [
            {
                "id": r[0], "source_id": r[1], "source_title": r[2], "page_number": r[3],
                "confidence": float(r[4]) if r[4] is not None else None,
                "parser": r[5], "text_chars": r[6], "preview_url": r[7],
            }
            for r in rows
        ]

    def get_figures_by_ids(self, figure_ids: Sequence[str]) -> Dict[str, Dict[str, Any]]:
        """Hydrate figure references on retrieved chunks, keyed by id."""
        if not figure_ids:
            return {}
        rows = self.db.execute(
            text(
                "SELECT id, page_number, kind, image_url, caption, alt_text "
                "FROM knowledge_base_figure WHERE id = ANY(:ids)"
            ),
            {"ids": list(figure_ids)},
        ).fetchall()
        return {
            str(r[0]): {
                "id": str(r[0]), "page_number": r[1], "kind": r[2],
                "image_url": r[3], "caption": r[4], "alt_text": r[5],
            }
            for r in rows
        }

    # ------------------------------------------------------------------
    # Row mappers
    # ------------------------------------------------------------------
    @staticmethod
    def _kb_row(r) -> Dict[str, Any]:
        meta = r[17] or {}
        if isinstance(meta, str):
            try:
                meta = json.loads(meta)
            except ValueError:
                meta = {}
        row = {
            "id": r[0], "institute_id": r[1], "name": r[2], "description": r[3],
            "purpose": r[4], "language_hint": r[5], "owner_type": r[6],
            "embedding_model": r[7], "embedding_dim": int(r[8]), "status": r[9],
            "stats": r[10] or {}, "created_by": r[11],
            "created_at": r[12].isoformat() if r[12] else None,
            "updated_at": r[13].isoformat() if r[13] else None,
            "source_count": int(r[14] or 0),
            "processing_count": int(r[15] or 0),
            "review_pages": int(r[16] or 0),
            "meta": meta,
            # Set only for curriculum libraries: the facets the picker groups by.
            # `book` distinguishes several books of one class+subject (Class 10
            # Social Science has four); it is the listing title.
            "curriculum": None,
        }
        if r[18] == CURRICULUM_COLLECTION:
            row["curriculum"] = {
                "board": r[19], "class": r[20], "subject": r[21],
                "medium": r[22], "book": r[23],
                # "SYLLABUS" for an official syllabus document (scope, not
                # content — see paper.syllabus_scope); absent for a textbook.
                "kind": (meta.get("curriculum") or {}).get("kind"),
            }
        return row

    @staticmethod
    def _source_row(r) -> Dict[str, Any]:
        return {
            "id": r[0], "knowledge_base_id": r[1], "institute_id": r[2],
            "source_kind": r[3], "title": r[4], "file_id": r[5], "source_url": r[6],
            "status": r[7], "progress": int(r[8] or 0), "stage": r[9],
            "is_active": bool(r[10]), "page_count": int(r[11] or 0),
            "pages_low_confidence": int(r[12] or 0), "chunk_count": int(r[13] or 0),
            "figure_count": int(r[14] or 0), "detected_languages": list(r[15] or []),
            "parser": r[16], "ocr_pages": int(r[17] or 0),
            "credits_charged": float(r[18] or 0),
            "error_message": r[19], "created_by": r[20],
            "created_at": r[21].isoformat() if r[21] else None,
            "updated_at": r[22].isoformat() if r[22] else None,
            "meta": r[23] or {},
            # NULL from list_sources on purpose: a knowledge base can hold many
            # long pasted notes, and shipping every one of them on the list
            # endpoint would bloat the page for no benefit. Ingest reads sources
            # one at a time via get_source, which selects the real column.
            "raw_text": r[24],
        }


__all__ = ["KbRepository", "ChunkToStore", "EmbeddingModelSpec", "VECTOR_COLUMN_BY_DIM"]
