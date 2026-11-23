"""
Vacademy Assistant — help-corpus sync pipeline.

The how-to corpus lives in version control as ``app/data/help_knowledge.jsonl``
(one entry per line). This module keeps the deployed pgvector corpus in sync with
that file, automatically, on every startup:

  edit the JSONL  ->  commit  ->  deploy  ->  auto-ingested globally on boot

It is CHANGE-DETECTED: each row is stamped with a ``corpus_version`` (a hash of
the whole seed) in its metadata. On startup we compare the stored version to the
current seed's hash and only re-embed when they differ — so an unchanged corpus
costs one cheap query, not 86 embedding calls, on every restart.

Ingestion is under the product-wide sentinel institute
``HELP_KNOWLEDGE_INSTITUTE_ID`` (one copy serves every institute; the help tool's
executor searches it).

Each entry is replaced on its own: its embedding is computed first, then its old
rows are deleted and the new ones inserted in one transaction, under a
transaction-scoped advisory lock on the entry. Searches therefore always find
every entry (old or new text) while a sync runs, and replicas that start at the
same time cannot leave two copies of an entry. Entries no longer in the seed are
removed at the end. The up-to-date check counts distinct entries as well as
rows, so stray copies are cleaned up by the next sync.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
from typing import Any, Dict, List, Tuple

from sqlalchemy import text

from ..db import db_session
from .api_key_resolver import ApiKeyResolver
from .embedding_service import EmbeddingService
from .assistant_tool_registry import HELP_KNOWLEDGE_INSTITUTE_ID, _StaticKeyResolver

logger = logging.getLogger(__name__)

SEED_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "help_knowledge.jsonl"
)


def load_seed(path: str = SEED_PATH) -> List[Dict[str, Any]]:
    """Read the JSONL seed (skips blanks and ``#`` comment lines)."""
    if not os.path.exists(path):
        return []
    entries: List[Dict[str, Any]] = []
    with open(path, "r", encoding="utf-8") as fh:
        for line_no, line in enumerate(fh, 1):
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            try:
                entries.append(json.loads(line))
            except json.JSONDecodeError as e:
                logger.warning("help corpus: bad JSON on seed line %d: %s", line_no, e)
    return entries


def _corpus_hash(entries: List[Dict[str, Any]]) -> str:
    return hashlib.sha256(
        json.dumps(entries, sort_keys=True, ensure_ascii=False).encode("utf-8")
    ).hexdigest()


def _entry_key(entry: Dict[str, Any]) -> str:
    return str(entry.get("id") or entry.get("task") or "")


def _usable(entries: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Entries with an id and some text, the last one winning when an id repeats."""
    by_key: Dict[str, Dict[str, Any]] = {}
    for entry in entries:
        key = _entry_key(entry)
        if key and (entry.get("content_text") or "").strip():
            by_key[key] = entry
    return list(by_key.values())


def _read_marker() -> Tuple[Any, int, int]:
    """(stored corpus_version, distinct entries, duplicated chunks) for the sentinel help corpus."""
    with db_session() as db:
        row = db.execute(
            text(
                "SELECT max(meta_data->>'corpus_version') AS v, "
                "count(DISTINCT meta_data->>'corpus_version') AS versions, "
                "count(*) - count(DISTINCT (source_id, chunk_index)) AS dup, count(DISTINCT source_id) AS d "
                "FROM content_embeddings "
                "WHERE institute_id = :i AND source_type = 'help_knowledge'"
            ),
            {"i": HELP_KNOWLEDGE_INSTITUTE_ID},
        ).first()
    if not row or not row[3]:
        return (None, 0, 0)
    # Rows from more than one version mean a sync did not finish: report no version.
    return (row[0] if row[1] == 1 else None, int(row[3]), int(row[2]))


_INSERT_SQL = text(
    "INSERT INTO content_embeddings (id, institute_id, source_type, source_id, content_text, "
    "chunk_index, embedding, meta_data, created_at, updated_at) "
    "VALUES (gen_random_uuid(), :i, 'help_knowledge', :sid, :content_text, :chunk_index, "
    "CAST(:embedding AS vector), CAST(:meta_data AS jsonb), NOW(), NOW())"
)


def _replace_entry(source_id: str, chunks: List[Tuple[int, str, List[float]]], metadata: Dict[str, Any]) -> None:
    """Swap one entry's rows for the new chunks in a single transaction."""
    with db_session() as db:
        try:
            db.execute(
                text("SELECT pg_advisory_xact_lock(hashtext('help_knowledge:' || :sid))"),
                {"sid": source_id},
            )
            db.execute(
                text(
                    "DELETE FROM content_embeddings "
                    "WHERE institute_id = :i AND source_type = 'help_knowledge' AND source_id = :sid"
                ),
                {"i": HELP_KNOWLEDGE_INSTITUTE_ID, "sid": source_id},
            )
            for index, chunk, embedding in chunks:
                db.execute(_INSERT_SQL, {
                    "i": HELP_KNOWLEDGE_INSTITUTE_ID,
                    "sid": source_id,
                    "content_text": chunk,
                    "chunk_index": index,
                    "embedding": str(embedding),
                    "meta_data": json.dumps(metadata),
                })
            db.commit()
        except Exception:
            db.rollback()
            raise


def _remove_stale(keep: List[str]) -> int:
    """Delete help rows whose entry is no longer in the seed."""
    with db_session() as db:
        result = db.execute(
            text(
                "DELETE FROM content_embeddings "
                "WHERE institute_id = :i AND source_type = 'help_knowledge' "
                "AND NOT (source_id = ANY(:keep))"
            ),
            {"i": HELP_KNOWLEDGE_INSTITUTE_ID, "keep": keep},
        )
        db.commit()
        return int(result.rowcount or 0)


async def _ingest(entries: List[Dict[str, Any]], version: str) -> int:
    """Replace each entry in place, then drop entries that left the seed."""
    with db_session() as db:
        keys = ApiKeyResolver(db).resolve_keys(
            institute_id=HELP_KNOWLEDGE_INSTITUTE_ID, user_id=None
        )
    embedder = EmbeddingService(_StaticKeyResolver(keys))

    ok = 0
    for entry in entries:
        entry_id = _entry_key(entry)
        content = (entry.get("content_text") or "").strip()
        metadata = {
            "task": entry.get("task"),
            "role": entry.get("role") or "any",
            "route_path": entry.get("route_path") or "",
            "keywords": entry.get("keywords") or [],
            "corpus_version": version,
        }
        try:
            pieces = embedder.chunk_text(content)
            vectors = await embedder.embed_batch(pieces, HELP_KNOWLEDGE_INSTITUTE_ID)
            chunks = [(i, piece, vec) for i, (piece, vec) in enumerate(zip(pieces, vectors)) if vec]
            if not chunks:
                # Keep the old text searchable rather than leave the entry empty.
                logger.warning("help corpus: no embedding for %s; kept the previous copy", entry_id)
                continue
            _replace_entry(entry_id, chunks, metadata)
            ok += 1
        except Exception as e:  # noqa: BLE001
            logger.warning("help corpus: failed to ingest %s: %s", entry_id, e)
    if ok == len(entries):
        removed = _remove_stale([_entry_key(e) for e in entries])
        if removed:
            logger.info("help corpus: removed %d rows of entries no longer in the seed", removed)
    return ok


async def sync_help_corpus(force: bool = False) -> None:
    """Sync the deployed corpus to the seed file; no-op when already current."""
    entries = _usable(load_seed())
    if not entries:
        logger.info("help corpus: no seed at %s; nothing to sync", SEED_PATH)
        return

    version = _corpus_hash(entries)
    if not force:
        try:
            stored, distinct, duplicated = _read_marker()
        except Exception as e:  # noqa: BLE001
            logger.warning("help corpus: could not read version marker (%s); re-ingesting", e)
            stored, distinct, duplicated = None, -1, -1
        if stored == version and distinct == len(entries) and duplicated == 0:
            logger.info(
                "help corpus: up to date (%d entries, v=%s)", distinct, version[:12]
            )
            return

    logger.info("help corpus: syncing %d entries (v=%s)…", len(entries), version[:12])
    ok = await _ingest(entries, version)
    logger.info(
        "help corpus: synced %d/%d entries under '%s'",
        ok, len(entries), HELP_KNOWLEDGE_INSTITUTE_ID,
    )


async def _safe_sync() -> None:
    try:
        await sync_help_corpus()
    except Exception as e:  # noqa: BLE001
        logger.warning("help corpus sync failed: %s", e)


def start_help_corpus_sync() -> None:
    """Spawn the corpus sync as a background task. Call from the async lifespan."""
    try:
        asyncio.get_event_loop().create_task(_safe_sync())
    except RuntimeError:
        # No running loop (not expected from the ASGI lifespan) — run inline.
        asyncio.run(_safe_sync())


__all__ = ["sync_help_corpus", "start_help_corpus_sync", "load_seed", "SEED_PATH"]
