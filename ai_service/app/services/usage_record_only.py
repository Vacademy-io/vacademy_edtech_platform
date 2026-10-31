"""Record-only AI usage rows: an ai_token_usage row, never a credit charge.

For calls that cost us money but are not billed to anyone today — the
OpenRouter embeddings behind every knowledge-base index and query, and the
Perplexity Sonar web search in the video pipeline. Until now they were not
even logged, so the spend was invisible.

Fire-and-forget by design. `record_usage_only(...)` only queues the write on a
small private thread pool and returns at once: the request never waits on the
database, and nothing the write does (no DB configured, table locked, pool
exhausted, bad UUID) can reach the caller. A backlog beyond MAX_PENDING drops
new rows rather than piling up threads or memory.

Price comes from the ai_models registry row for the model when one exists
(per-token, like TokenUsageService.record_usage stores it); with no row the
price columns stay NULL. credits_used is always NULL — nothing is deducted.

Switched off by default: the platform setting `billing.record_unbilled_usage`
(bool, absent = false) must be true before any row is written. The rows carry
the institute id and a price, so they show up in the institute's AI Settings
activity log and its cost total; the owner opts in. The switch is read on the
pool thread, never on the caller's (event-loop) thread.
"""
from __future__ import annotations

import logging
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Dict, Optional, Tuple
from uuid import UUID

logger = logging.getLogger(__name__)

MAX_PENDING = 500
PRICE_CACHE_TTL_SECONDS = 300
RECORD_SETTING = "billing.record_unbilled_usage"

_executor: Optional[ThreadPoolExecutor] = None
_executor_lock = threading.Lock()
_pending = 0
_pending_lock = threading.Lock()
_failure_logged = False

# model_id -> (fetched_at, (input_per_token, output_per_token) or None)
_price_cache: Dict[str, Tuple[float, Optional[Tuple[float, float]]]] = {}


def _get_executor() -> ThreadPoolExecutor:
    global _executor
    with _executor_lock:
        if _executor is None:
            _executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="usage-record-only")
        return _executor


def _uuid_or_none(value: Optional[str]) -> Optional[UUID]:
    if not value:
        return None
    try:
        return UUID(str(value))
    except (ValueError, AttributeError, TypeError):
        return None


def _registry_price(session, model: Optional[str]) -> Optional[Tuple[float, float]]:
    """(input, output) USD per token from ai_models, or None when the model has
    no registry row. A free model prices at 0. Cached for a few minutes."""
    if not model:
        return None
    now = time.monotonic()
    cached = _price_cache.get(model)
    if cached is not None and now - cached[0] < PRICE_CACHE_TTL_SECONDS:
        return cached[1]
    from sqlalchemy import text

    row = session.execute(
        text(
            "SELECT input_price_per_1m, output_price_per_1m, is_free "
            "FROM ai_models WHERE model_id = :m "
            "ORDER BY is_active DESC LIMIT 1"
        ),
        {"m": model},
    ).fetchone()
    price: Optional[Tuple[float, float]] = None
    if row is not None:
        if row.is_free:
            price = (0.0, 0.0)
        else:
            price = (
                float(row.input_price_per_1m or 0) / 1_000_000,
                float(row.output_price_per_1m or 0) / 1_000_000,
            )
    _price_cache[model] = (now, price)
    return price


def _recording_enabled() -> bool:
    """billing.record_unbilled_usage; anything unreadable is off (today's behaviour)."""
    try:
        from .platform_settings_service import get_platform_setting

        raw = get_platform_setting(RECORD_SETTING, default=False)
    except Exception:  # noqa: BLE001
        return False
    if isinstance(raw, bool):
        return raw
    return str(raw or "").strip().lower() in ("true", "1", "yes", "on")


def _meter_free_event(session, usage, kwargs: Dict[str, Any], total_price: Optional[float]) -> None:
    """The matching FREE / BUNDLED usage event (services/metering), on this
    pool thread's session. Never raises; the usage row is already committed."""
    try:
        from .metering import service as _metering

        rt = kwargs.get("request_type")
        meta = None
        try:
            import json

            meta = json.loads(kwargs.get("metadata") or "null")
        except Exception:  # noqa: BLE001
            meta = None
        _metering.write_free_event(
            session,
            _metering.input_from(
                None,
                institute_id=kwargs.get("institute_id"),
                request_type=rt.value if hasattr(rt, "value") else rt,
                model=kwargs.get("model"),
                prompt_tokens=kwargs.get("prompt_tokens") or 0,
                completion_tokens=kwargs.get("completion_tokens") or 0,
                user_id=kwargs.get("user_id"),
                metadata=meta if isinstance(meta, dict) else None,
                real_cost_usd=total_price,
                use_case=kwargs.get("use_case"),
            ),
            usage_log_id=str(usage.id) if usage is not None and getattr(usage, "id", None) else None,
            free_reason="BUNDLED",
        )
    except Exception as exc:  # noqa: BLE001
        logger.debug("usage-record-only: usage event skipped: %s", exc)


def _write(kwargs: Dict[str, Any]) -> None:
    """Runs on the pool thread. Swallows everything."""
    global _pending, _failure_logged
    try:
        if not _recording_enabled():
            return
        from ..db import db_session
        from ..repositories.ai_token_usage_repository import AiTokenUsageRepository

        with db_session() as session:
            price = None
            try:
                price = _registry_price(session, kwargs.get("model"))
            except Exception as exc:  # noqa: BLE001
                logger.debug("usage-record-only: price lookup failed for %s: %s", kwargs.get("model"), exc)
                try:
                    session.rollback()
                except Exception:  # noqa: BLE001
                    pass
            input_price = output_price = total_price = None
            if price is not None:
                input_price, output_price = price
                total_price = (input_price * kwargs["prompt_tokens"]) + (output_price * kwargs["completion_tokens"])
            usage = AiTokenUsageRepository(session).create_usage_record(
                api_provider=kwargs["api_provider"],
                prompt_tokens=kwargs["prompt_tokens"],
                completion_tokens=kwargs["completion_tokens"],
                total_tokens=kwargs["total_tokens"],
                request_type=kwargs["request_type"],
                institute_id=_uuid_or_none(kwargs.get("institute_id")),
                user_id=_uuid_or_none(kwargs.get("user_id")),
                model=kwargs.get("model"),
                request_id=kwargs.get("request_id"),
                metadata=kwargs.get("metadata"),
                input_token_price=input_price,
                output_token_price=output_price,
                total_price=total_price,
            )
            _meter_free_event(session, usage, kwargs, total_price)
    except Exception as exc:  # noqa: BLE001
        # Log the first failure loudly, then quietly: a missing DB in a script
        # or a long outage must not turn into one warning per embedding batch.
        if not _failure_logged:
            _failure_logged = True
            logger.warning("usage-record-only: could not write ai_token_usage row (%s); further failures at DEBUG", exc)
        else:
            logger.debug("usage-record-only: write failed: %s", exc)
    finally:
        with _pending_lock:
            _pending -= 1


def record_usage_only(
    *,
    api_provider: Any,
    request_type: Any,
    model: Optional[str],
    prompt_tokens: int = 0,
    completion_tokens: int = 0,
    total_tokens: Optional[int] = None,
    institute_id: Optional[str] = None,
    user_id: Optional[str] = None,
    request_id: Optional[str] = None,
    metadata: Optional[Dict[str, Any]] = None,
    use_case: Optional[str] = None,
) -> bool:
    """Queue one record-only ai_token_usage row. Returns True when queued.

    Never raises and never blocks on I/O. `metadata` gets "charged": false so a
    reader can tell these rows from billed ones at a glance. `use_case` only
    labels the matching usage event (never written to ai_token_usage).
    """
    global _pending
    try:
        import json

        prompt = max(int(prompt_tokens or 0), 0)
        completion = max(int(completion_tokens or 0), 0)
        total = int(total_tokens) if total_tokens is not None else prompt + completion
        meta = dict(metadata or {})
        meta.setdefault("charged", False)
        kwargs = {
            "api_provider": api_provider,
            "request_type": request_type,
            "model": model,
            "prompt_tokens": prompt,
            "completion_tokens": completion,
            "total_tokens": max(total, 0),
            "institute_id": institute_id,
            "user_id": user_id,
            "request_id": request_id,
            "metadata": json.dumps(meta, default=str),
        }
        if use_case:
            kwargs["use_case"] = str(use_case)
        with _pending_lock:
            if _pending >= MAX_PENDING:
                logger.debug("usage-record-only: backlog full (%d), row dropped", _pending)
                return False
            _pending += 1
        try:
            _get_executor().submit(_write, kwargs)
        except Exception:
            with _pending_lock:
                _pending -= 1
            raise
        return True
    except Exception as exc:  # noqa: BLE001
        logger.debug("usage-record-only: could not queue row: %s", exc)
        return False


__all__ = ["record_usage_only"]
