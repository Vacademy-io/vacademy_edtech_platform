"""Shared model resolution for migrated AI features.

Resolves (primary_model, [fallback_models]) from the DB-backed registry
(`ai_model_defaults` / `/models/v2`), honoring an optional caller override only
when it's a known-active model. A registry read failure degrades to the hard
fallback rather than breaking generation — removing the "dead hardcoded model
id" failure mode is the whole point of the migration.

Chain rules (Release 2):
  * The hard fallback is GLM (`GLM_DEFAULT`), so a missing row or a dead DB
    still runs every chat feature on the platform default.
  * When the chain has no non-GLM model, `NON_GLM_FALLBACK` is appended, so a
    GLM outage (Isoquant AND the OpenRouter leg) never leaves a feature with
    nothing to fail over to.
  * The `ai_model_defaults` read is cached per use case for 30 s in process.
    ai-service runs two replicas, so a super-admin change takes effect within
    30 s on every pod; a write on this pod calls `invalidate_cache()`.
"""
from __future__ import annotations

import logging
import threading
import time
from typing import Dict, List, Optional, Tuple

from sqlalchemy import text
from sqlalchemy.orm import Session

from ..constants.model_defaults import GLM_DEFAULT, NON_GLM_FALLBACK
from .ai_models_service import AIModelsService

logger = logging.getLogger(__name__)

# Every chat feature defaults to GLM; the row (super-admin portal) decides
# otherwise. Callers may still pass their own `hard_fallback`.
DEFAULT_HARD_FALLBACK = GLM_DEFAULT

CACHE_TTL_SECONDS = 30.0

_CACHE: Dict[str, Tuple[float, Optional[str], Optional[str]]] = {}
_CACHE_LOCK = threading.Lock()


def is_glm_model(model_id: Optional[str]) -> bool:
    """GLM family (any variant/suffix). Used to decide whether the chain
    already has a vendor-diverse fallback."""
    return bool(model_id) and str(model_id).lower().startswith("z-ai/glm")


def invalidate_cache(use_case: Optional[str] = None) -> None:
    """Drop the cached row for one use case (or all). Only affects this
    process; other replicas pick the change up within CACHE_TTL_SECONDS."""
    with _CACHE_LOCK:
        if use_case is None:
            _CACHE.clear()
        else:
            _CACHE.pop(use_case, None)


def resolve_models(
    db: Session,
    use_case: str,
    preferred_model: Optional[str] = None,
    hard_fallback: str = DEFAULT_HARD_FALLBACK,
) -> Tuple[str, List[str]]:
    """Return (primary_model, [fallback_models]). Precedence: valid+active
    preferred → use-case default → use-case fallback → hard fallback, then
    NON_GLM_FALLBACK when every model so far is GLM."""
    chain: List[str] = []

    if preferred_model:
        try:
            model = AIModelsService(db).get_model_by_id(preferred_model)
            if model and model.is_active:
                chain.append(preferred_model)
            else:
                logger.info(
                    "Preferred model '%s' not active in registry; using use-case default",
                    preferred_model,
                )
        except Exception as exc:  # noqa: BLE001
            logger.warning("Preferred-model lookup failed (%s); ignoring override", exc)

    default_id, fallback_id = _cached_use_case_defaults(db, use_case)
    return _build_chain(use_case, chain, default_id, fallback_id, hard_fallback)


def resolve_model_sync(
    use_case: str,
    preferred_model: Optional[str] = None,
    hard_fallback: str = DEFAULT_HARD_FALLBACK,
) -> Tuple[str, List[str]]:
    """`resolve_models` for callers without a DB session. A cache hit needs no
    connection; otherwise a short-lived session is opened. Never raises: any
    DB problem resolves to [hard_fallback, NON_GLM_FALLBACK]."""
    if not preferred_model:
        cached = _cache_get(use_case)
        if cached is not None:
            return _build_chain(use_case, [], cached[0], cached[1], hard_fallback)
    try:
        from ..db import db_session

        with db_session() as session:
            return resolve_models(session, use_case, preferred_model, hard_fallback)
    except Exception as exc:  # noqa: BLE001
        logger.warning("resolve_model_sync(%s) could not open a session (%s); using hard fallback",
                       use_case, exc)
        return _build_chain(use_case, [], None, None, hard_fallback)


def _build_chain(
    use_case: str,
    chain: List[str],
    default_id: Optional[str],
    fallback_id: Optional[str],
    hard_fallback: Optional[str],
) -> Tuple[str, List[str]]:
    chain = list(chain)
    for candidate in (default_id, fallback_id, hard_fallback or DEFAULT_HARD_FALLBACK):
        if candidate and candidate not in chain:
            chain.append(candidate)
    if not any(not is_glm_model(m) for m in chain):
        chain.append(NON_GLM_FALLBACK)
    primary, fallbacks = chain[0], chain[1:]
    logger.info("Model resolved for '%s': primary=%s fallbacks=%s", use_case, primary, fallbacks)
    return primary, fallbacks


def _cache_get(use_case: str) -> Optional[Tuple[Optional[str], Optional[str]]]:
    with _CACHE_LOCK:
        hit = _CACHE.get(use_case)
    if hit is None:
        return None
    stamp, default_id, fallback_id = hit
    if time.monotonic() - stamp > CACHE_TTL_SECONDS:
        return None
    return default_id, fallback_id


def _cached_use_case_defaults(db: Session, use_case: str) -> Tuple[Optional[str], Optional[str]]:
    cached = _cache_get(use_case)
    if cached is not None:
        return cached
    ok, default_id, fallback_id = _lookup_use_case_defaults(db, use_case)
    if ok:  # a failed read is not cached — the next call retries the DB
        with _CACHE_LOCK:
            _CACHE[use_case] = (time.monotonic(), default_id, fallback_id)
    return default_id, fallback_id


def _lookup_use_case_defaults(db: Session, use_case: str) -> Tuple[bool, Optional[str], Optional[str]]:
    """Single lightweight read of ai_model_defaults for a use case.
    Returns (read_ok, default_model_id, fallback_model_id)."""
    try:
        row = db.execute(
            text(
                "SELECT default_model_id, fallback_model_id "
                "FROM ai_model_defaults WHERE use_case = :uc"
            ),
            {"uc": use_case},
        ).fetchone()
        if row:
            return True, row.default_model_id, row.fallback_model_id
        return True, None, None
    except Exception as exc:  # noqa: BLE001
        logger.warning("Use-case default lookup failed for '%s' (%s); using hard fallback", use_case, exc)
    return False, None, None


__all__ = [
    "DEFAULT_HARD_FALLBACK", "CACHE_TTL_SECONDS", "GLM_DEFAULT", "NON_GLM_FALLBACK",
    "is_glm_model", "invalidate_cache", "resolve_models", "resolve_model_sync",
]
