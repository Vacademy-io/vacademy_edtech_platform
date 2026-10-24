"""The companions' model pair from the 'kb_companion' use case.

`llm.py` picks its models from two module values, PRIMARY_MODEL and
FALLBACK_MODEL (read at call time). `refresh()` points them at the use case's
chain in ai_model_defaults (super-admin portal; GLM by default, cached 30 s),
so a portal change reaches companions without a deploy. Env still wins:

  * KB_COMPANION_MODEL / KB_COMPANION_FALLBACK_MODEL — whole-feature overrides;
    when set, the matching value is left alone;
  * KB_COMPANION_MODEL_<LANG> — per-language override; `llm.primary_for`
    reads it before PRIMARY_MODEL.

Call `refresh()` before each companion model call. It never raises: on any
problem the values already in place stay.
"""
from __future__ import annotations

import logging
import os
from typing import List, Optional

from . import llm

logger = logging.getLogger(__name__)

USE_CASE = "kb_companion"


def _chain() -> Optional[List[str]]:
    try:
        from ..model_selection import resolve_model_sync

        primary, fallbacks = resolve_model_sync(USE_CASE)
    except Exception as exc:  # noqa: BLE001 — a lookup never blocks a learner
        logger.warning("kb-companion: model lookup failed (%s); keeping current models", exc)
        return None
    return [m for m in [primary, *fallbacks] if m]


def refresh() -> None:
    chain = _chain()
    if not chain:
        return
    if not os.getenv("KB_COMPANION_MODEL") and hasattr(llm, "PRIMARY_MODEL"):
        llm.PRIMARY_MODEL = chain[0]
    if not os.getenv("KB_COMPANION_FALLBACK_MODEL") and hasattr(llm, "FALLBACK_MODEL"):
        primary = getattr(llm, "PRIMARY_MODEL", chain[0])
        fallback = next((m for m in chain if m != primary), None)
        if fallback:
            llm.FALLBACK_MODEL = fallback


__all__ = ["USE_CASE", "refresh"]
