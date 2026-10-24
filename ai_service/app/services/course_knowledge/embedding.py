"""Embeddings for course knowledge, with no DB session held across the HTTP call.

The institute's keys are resolved in a short session that is closed before the
embedding provider is called (a session held across a slow network call is how
the 2026-08-19 pool exhaustion happened). EmbeddingService then gets a tiny
static resolver that hands back those keys, the same idea as
ai_chat_agent_service._CachedKeyResolver.

All-zero vectors come back as None: a zero-norm vector makes pgvector's cosine
distance NaN, and Postgres sorts NaN above every number, so it would match
every chunk (kb/retrieval.py).
"""
from __future__ import annotations

import asyncio
import logging
from typing import List, Optional, Sequence, Tuple

from ...db import db_session
from ..api_key_resolver import ApiKeyResolver
from ..embedding_service import EmbeddingService

logger = logging.getLogger(__name__)

Keys = Tuple[Optional[str], Optional[str], Optional[str]]


class _StaticKeyResolver:
    """Returns keys resolved earlier; never touches the DB."""

    def __init__(self, keys: Keys):
        self._keys = keys

    def resolve_keys(self, **_kwargs) -> Keys:
        return self._keys


def _resolve_keys(institute_id: str) -> Optional[Keys]:
    try:
        with db_session() as db:
            return ApiKeyResolver(db).resolve_keys(institute_id=institute_id)
    except Exception as exc:  # noqa: BLE001 - no keys => no vectors, never an error
        logger.warning("course knowledge: key resolution failed for %s: %s", institute_id, exc)
        return None


def _usable(vector: Optional[Sequence[float]]) -> Optional[List[float]]:
    if not vector or not any(vector):
        return None
    return list(vector)


async def embed_texts(
    institute_id: str, model_id: Optional[str], texts: Sequence[str],
) -> Optional[List[Optional[List[float]]]]:
    """One vector per text (None for a text that failed or came back all-zero),
    or None when nothing could be embedded at all."""
    if not texts:
        return []
    # Off the event loop: the lookup checks out a pooled connection and runs
    # sync queries, which can wait up to pool_timeout when the pool is busy.
    keys = await asyncio.to_thread(_resolve_keys, institute_id)
    if keys is None:
        return None
    service = EmbeddingService(_StaticKeyResolver(keys))
    try:
        vectors = await service.embed_batch(list(texts), institute_id, model=model_id)
    except Exception as exc:  # noqa: BLE001
        logger.error("course knowledge: embedding failed for %s: %s", institute_id, exc)
        return None
    finally:
        await service.close()
    out = [_usable(v) for v in (vectors or [])]
    if len(out) != len(texts) or not any(v is not None for v in out):
        return None
    return out


async def embed_query(institute_id: str, model_id: Optional[str], text: str) -> Optional[List[float]]:
    """The query vector, or None (failure or a degenerate all-zero vector)."""
    if not text or not text.strip():
        return None
    # Off the event loop: the lookup checks out a pooled connection and runs
    # sync queries, which can wait up to pool_timeout when the pool is busy.
    keys = await asyncio.to_thread(_resolve_keys, institute_id)
    if keys is None:
        return None
    service = EmbeddingService(_StaticKeyResolver(keys))
    try:
        vector = await service.embed_query(text, institute_id, model=model_id)
    except Exception as exc:  # noqa: BLE001
        logger.error("course knowledge: query embedding failed for %s: %s", institute_id, exc)
        return None
    finally:
        await service.close()
    return _usable(vector)


__all__ = ["embed_texts", "embed_query"]
