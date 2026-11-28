"""Quotes and charges for paid course processing (spec §7.2, §7.4).

Quote: ToolCostEstimator at the institute's price, one call per lesson. The
estimate rounds UP to a whole credit per call, so per-lesson quotes and
per-lesson charges both use exactly this call (three one-page scans cost 3,
not 2).

Charge: record_tool_billing after the text was delivered and cached (it opens
its own session, is post-paid and swallows errors), keyed on the extractor's
idempotency key, which always carries the institute id because
credit_transactions.external_reference_id is unique across the whole ledger
(V243). The amount is then read back from the ledger, as kb/ingest does. A key
already in the ledger (a retry, the sweep's re-drive) makes no billing call at
all, so replays never add usage rows.
"""
from __future__ import annotations

import logging
from decimal import Decimal
from typing import Any, Optional, Tuple

from sqlalchemy import text
from sqlalchemy.orm import Session

from ...db import db_session
from ...models.ai_token_usage import RequestType
from ..ai_billing import UC, metering_system, metering_user, record_tool_billing
from ..tool_cost_estimator import ToolCostEstimator
from .extract.types import TOOL_OCR_PAGE, TOOL_TRANSCRIBE_MINUTE, PaidDelivered

logger = logging.getLogger(__name__)

FEATURE = "course_knowledge"
_UNIT_FIELD = {TOOL_OCR_PAGE: "pages", TOOL_TRANSCRIBE_MINUTE: "audio_minutes"}
_ESTIMATOR_PARAM = {"pages": "num_pages", "audio_minutes": "audio_minutes"}


def tool_params(tool_key: str, units: int) -> dict:
    """{num_pages: n} / {audio_minutes: n} for a course tool key."""
    unit_field = _UNIT_FIELD.get(tool_key)
    if unit_field is None:
        raise ValueError(f"not a course knowledge tool: {tool_key!r}")
    return {_ESTIMATOR_PARAM[unit_field]: int(units)}


def request_type_for(tool_key: str) -> RequestType:
    return RequestType.TRANSCRIPTION if tool_key == TOOL_TRANSCRIBE_MINUTE else RequestType.KNOWLEDGE_BASE


def quote_credits(db: Session, institute_id: str, tool_key: str, units: int) -> Decimal:
    """Credits one lesson's paid step costs at this institute's price (whole
    credits, rounded up per call). Zero units cost nothing."""
    if int(units or 0) <= 0:
        return Decimal("0")
    estimate = ToolCostEstimator(db).estimate(
        tool_key, tool_params(tool_key, units), institute_id=institute_id,
    )
    return Decimal(str(estimate.get("estimated_credits") or 0))


_LEDGER_SQL = text(
    """
    SELECT COUNT(*),
           COALESCE(SUM(-amount) FILTER (WHERE transaction_type = 'USAGE_DEDUCTION'), 0)
      FROM credit_transactions
     WHERE external_reference_id = :k
    """
)


def ledger_charge(db: Session, idempotency_key: str) -> Tuple[bool, Decimal]:
    """(recorded, credits) for an idempotency key: recorded when the ledger
    has a row for it, or an AI plan covered it (INCLUDED / ALLOWANCE usage
    events have no ledger row); credits = SUM(-amount) of its USAGE_DEDUCTION
    rows, the same read-back as kb/ingest._ledger_charge."""
    row = db.execute(_LEDGER_SQL, {"k": idempotency_key}).fetchone()
    count, credits = (int(row[0] or 0), Decimal(str(row[1] or 0))) if row else (0, Decimal("0"))
    if count:
        return True, credits
    try:
        from ..metering import plan_wiring
        if plan_wiring.plan_event_for_key(db, idempotency_key):
            return True, Decimal("0")
    except Exception:  # noqa: BLE001 - plans unavailable: the ledger answer stands
        pass
    return False, Decimal("0")


def _read_back(idempotency_key: str) -> Tuple[bool, Decimal]:
    try:
        with db_session() as db:
            return ledger_charge(db, idempotency_key)
    except Exception:  # noqa: BLE001
        logger.warning("course knowledge: could not read the ledger for %s", idempotency_key, exc_info=True)
        return False, Decimal("0")


def charge(
    delivered: PaidDelivered,
    *,
    institute_id: str,
    requested_by: Optional[str],
    run_id: Optional[str],
    slide_id: str,
    pointer: Any = None,
    manual: Optional[bool] = None,
) -> Optional[Decimal]:
    """Charge what an extraction delivered, once per idempotency key, and
    return the credits the ledger holds for that key. None when nothing was
    recorded (the billing call failed): the sweep re-drives it with the same
    key. Blocking (short sessions only); call it via asyncio.to_thread."""
    key = delivered.idempotency_key
    if not key or institute_id not in key:
        # A key without the institute could collide with another institute's
        # charge in the ledger-wide unique index (V243); never send one.
        logger.error("course knowledge: refusing to bill slide %s with key %r", slide_id, key)
        return None
    recorded, credits = _read_back(key)
    if recorded:
        return credits
    # An admin's action is metered to them even without a run (a kept transcript used).
    manual = bool(run_id) if manual is None else manual
    record_tool_billing(
        tool_key=delivered.tool_key,
        tool_params=delivered.tool_params,
        request_type=request_type_for(delivered.tool_key),
        model=delivered.model or "unknown",
        institute_id=institute_id,
        user_id=requested_by,
        user_role="ADMIN" if requested_by else None,
        request_id=slide_id,
        idempotency_key=key,
        provider_cost_usd=delivered.provider_cost_usd,
        use_case=UC.COURSE_KNOWLEDGE,
        metering=metering_user(requested_by, surface="ADMIN_APP") if manual else metering_system(),
        usage_context={
            "feature": FEATURE, "slide_id": slide_id, "pointer": pointer, "run_id": run_id,
            "mode": "manual" if manual else "auto",
        },
    )
    recorded, credits = _read_back(key)
    if recorded:
        return credits
    if _free_at_this_price(institute_id, delivered):
        # A zero price writes a usage row but no ledger row: nothing is owed,
        # so report 0 rather than leave it for the sweep to re-drive.
        return Decimal("0")
    logger.warning("course knowledge: charge for %s (slide %s) is not in the ledger yet", key, slide_id)
    return None


def _free_at_this_price(institute_id: str, delivered: PaidDelivered) -> bool:
    try:
        with db_session() as db:
            return quote_credits(db, institute_id, delivered.tool_key, delivered.units) <= 0
    except Exception:  # noqa: BLE001
        return False


__all__ = [
    "FEATURE", "tool_params", "request_type_for", "quote_credits", "ledger_charge", "charge",
]
