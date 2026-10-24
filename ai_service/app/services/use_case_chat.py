"""Small helpers for features that call `llm_router.chat_with_chain` directly.

* `models_for(use_case, explicit=..., env=...)` — the model chain for a use
  case with an explicit pick first: a request's model, or a feature's
  emergency env override (e.g. REELS_PREVIEW_LLM_MODEL). The explicit model
  wins; the use case's chain (default, fallback, GLM, non-GLM tail) follows it
  for failover.
* `chat_json(...)` — one JSON-mode call through the chain. Asks for
  `response_format: json_object`; when a model rejected the request with a 400
  (some providers refuse the parameter), the chain is walked once more without
  it. Returns None instead of raising, for best-effort callers.
"""
from __future__ import annotations

import logging
import os
from typing import Any, Dict, List, Optional

from .llm_router import ChainExhausted, ChainResult, chat_with_chain

logger = logging.getLogger(__name__)


def models_for(
    use_case: str,
    *,
    explicit: Optional[str] = None,
    env: Optional[str] = None,
    db=None,
) -> List[str]:
    """[explicit or $env, *use-case chain] without duplicates. Never raises:
    resolve_model_sync already degrades to [GLM, NON_GLM_FALLBACK]."""
    from .model_selection import resolve_model_sync, resolve_models

    if db is not None:
        primary, fallbacks = resolve_models(db, use_case)
    else:
        primary, fallbacks = resolve_model_sync(use_case)
    chain: List[str] = [primary, *fallbacks]
    first = (explicit or "").strip() or ((os.getenv(env) or "").strip() if env else "")
    if first:
        chain = [first, *[m for m in chain if m != first]]
    out: List[str] = []
    for m in chain:
        if m and m not in out:
            out.append(m)
    return out


def _rejected_with_400(exc: ChainExhausted) -> bool:
    return any(str(reason).startswith("HTTP 400") for _model, reason in exc.attempts)


async def chat_json(
    payload: Dict[str, Any],
    *,
    use_case: str,
    models: List[str],
    api_key: Optional[str],
    timeout: float,
    label: str,
    reasoning_effort: Optional[str] = None,
) -> Optional[ChainResult]:
    """JSON-mode chat through `models` (see module doc). None when every model
    failed — the caller falls back to its non-LLM path."""
    strict = {**payload, "response_format": {"type": "json_object"}}
    try:
        return await chat_with_chain(
            strict, use_case, models=models, api_key=api_key,
            reasoning_effort=reasoning_effort, timeout=timeout,
        )
    except ChainExhausted as exc:
        if not _rejected_with_400(exc):
            logger.warning("[%s] LLM chain failed: %s", label, exc)
            return None
        logger.info("[%s] a model rejected json mode; retrying the chain without it", label)
    except Exception as exc:  # noqa: BLE001 — best-effort callers never raise
        logger.warning("[%s] LLM call failed: %s", label, exc)
        return None
    plain = {k: v for k, v in payload.items() if k != "response_format"}
    try:
        return await chat_with_chain(
            plain, use_case, models=models, api_key=api_key,
            reasoning_effort=reasoning_effort, timeout=timeout,
        )
    except ChainExhausted as exc:
        logger.warning("[%s] LLM chain failed (plain retry): %s", label, exc)
        return None
    except Exception as exc:  # noqa: BLE001 — best-effort callers never raise
        logger.warning("[%s] LLM call failed: %s", label, exc)
        return None


__all__ = ["models_for", "chat_json"]
