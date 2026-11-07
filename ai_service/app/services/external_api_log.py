"""Fire-and-forget rows in external_api_call_log for third-party calls with no other record.

Same contract as usage_record_only: `record_external_call(...)` only queues the write on a
small private thread pool and returns at once. Nothing the write does (no DB, table not
migrated yet, pool exhausted) can reach the caller, and a backlog beyond MAX_PENDING drops
rows rather than piling up threads or memory.

Callers pass summaries, never credentials. `key_hint` is the only trace of a key.
"""
from __future__ import annotations

import json
import logging
import threading
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Dict, Optional, Tuple

logger = logging.getLogger(__name__)

MAX_PENDING = 500
AUTO_CAPTURE_SETTING = "external_apis.auto_capture"
#: Keys shorter than this would be mostly revealed by their last four characters.
MIN_LENGTH_FOR_HINT = 12

_executor: Optional[ThreadPoolExecutor] = None
_executor_lock = threading.Lock()
_pending = 0
_pending_lock = threading.Lock()
_failure_logged = False


def key_hint(api_key: Optional[str]) -> Optional[str]:
    """Last four characters, the same hint llm_provider_keys.key_hint stores."""
    if not api_key:
        return None
    return api_key[-4:] if len(api_key) >= MIN_LENGTH_FOR_HINT else "****"


def _get_executor() -> ThreadPoolExecutor:
    global _executor
    with _executor_lock:
        if _executor is None:
            _executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="external-api-log")
        return _executor


def _cost(row: Dict[str, Any], credential: Optional[str], credits: float) -> Tuple[Optional[float], Optional[str]]:
    """(amount, currency) from the price staff entered for this key. Empty when unpriced or the request failed."""
    if not credential or row["status"] != "SUCCESS":
        return None, None
    from .external_api_keys import DETAILS_SETTING, parse_details, per_call_cost, resolve_details
    from .platform_settings_service import get_platform_setting

    details = parse_details(get_platform_setting(DETAILS_SETTING, default="{}"))
    return per_call_cost(resolve_details(details, credential, row["key_hint"]), credits=credits) or (None, None)


def _auto_capture_enabled() -> bool:
    """external_apis.auto_capture; anything unreadable is off. Read on the pool thread, never the caller's."""
    try:
        from .platform_settings_service import get_platform_setting

        return get_platform_setting(AUTO_CAPTURE_SETTING, default=False) is True
    except Exception:  # noqa: BLE001
        return False


def _write(row: Dict[str, Any], credential: Optional[str], credits: float, automatic: bool) -> None:
    """Runs on the pool thread. Swallows everything."""
    global _pending, _failure_logged
    try:
        if automatic and not _auto_capture_enabled():
            return
        from sqlalchemy import text

        from ..db import db_session

        amount, currency = _cost(row, credential, credits)
        with db_session() as session:
            session.execute(
                text(
                    "INSERT INTO external_api_call_log (vendor, source_service, operation, status, http_status, "
                    "duration_ms, key_hint, institute_id, run_id, request_summary, response_summary, error_message, "
                    "cost_amount, cost_currency) "
                    "VALUES (:vendor, :source_service, :operation, :status, :http_status, :duration_ms, :key_hint, "
                    ":institute_id, :run_id, CAST(:request AS JSONB), CAST(:response AS JSONB), :error, "
                    ":amount, :currency)"
                ),
                {**row, "amount": amount, "currency": currency},
            )
            session.execute(
                text(
                    "INSERT INTO external_api_vendor (vendor, source_service) VALUES (:vendor, :source_service) "
                    "ON CONFLICT (vendor) DO UPDATE SET last_seen_at = now()"
                ),
                {"vendor": row["vendor"], "source_service": row["source_service"]},
            )
            session.commit()
    except Exception as exc:  # noqa: BLE001
        # Loudly once, then quietly: a missing table must not become one warning per query.
        if not _failure_logged:
            _failure_logged = True
            logger.warning("external-api-log: could not write row (%s); further failures at DEBUG", exc)
        else:
            logger.debug("external-api-log: write failed: %s", exc)
    finally:
        with _pending_lock:
            _pending -= 1


def record_external_call(
    *,
    vendor: str,
    operation: str,
    status: str,
    http_status: Optional[int] = None,
    duration_ms: Optional[int] = None,
    api_key: Optional[str] = None,
    institute_id: Optional[str] = None,
    run_id: Optional[str] = None,
    request_summary: Optional[Dict[str, Any]] = None,
    response_summary: Optional[Dict[str, Any]] = None,
    error_message: Optional[str] = None,
    credential: Optional[str] = None,
    credits: float = 1,
    source_service: str = "ai",
    automatic: bool = False,
) -> bool:
    """Queue one row. Returns True when queued. Never raises and never blocks on I/O.

    This is the one call a new integration needs: its vendor registers itself and appears
    on the dashboard. `credential` is the key's name in external_apis.key_details, which
    prices the row. `automatic` rows (httpx_capture) are dropped unless that capture is on.
    """
    global _pending
    try:
        row = {
            "vendor": vendor,
            "source_service": source_service,
            "operation": operation,
            "status": status,
            "http_status": http_status,
            "duration_ms": duration_ms,
            "key_hint": key_hint(api_key),
            "institute_id": institute_id,
            "run_id": run_id,
            "request": json.dumps(request_summary, default=str) if request_summary is not None else None,
            "response": json.dumps(response_summary, default=str) if response_summary is not None else None,
            "error": error_message,
        }
        with _pending_lock:
            if _pending >= MAX_PENDING:
                logger.debug("external-api-log: backlog full (%d), row dropped", _pending)
                return False
            _pending += 1
        try:
            _get_executor().submit(_write, row, credential, credits, automatic)
        except Exception:
            with _pending_lock:
                _pending -= 1
            raise
        return True
    except Exception as exc:  # noqa: BLE001
        logger.debug("external-api-log: could not queue row: %s", exc)
        return False


__all__ = ["AUTO_CAPTURE_SETTING", "key_hint", "record_external_call"]
