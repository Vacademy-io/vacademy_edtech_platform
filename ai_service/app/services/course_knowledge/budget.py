"""Credit budgets for paid course processing (table course_knowledge_budget, spec §7.3).

Two kinds of row:
  * ``run:<run_id>``: one per Make course AI-ready PROCESS run, cap = the quote
    the admin accepted. Explicit runs never touch the monthly auto budget.
  * ``month:<institute_id>:<YYYY-MM>`` (UTC month): automatic paid processing of
    newly published lessons, cap = min(institute cap, platform max).

A lesson reserves its quote before any provider call. The reservation is one
conditional UPDATE, so it is atomic across ai_service replicas: concurrent
reservations can never push reserved + charged past the cap. After delivery
the reservation is settled (moved to charged at the ledger amount) or
released. The reservation is mirrored on the lesson's queue row (budget_id,
reserved_credits) so a crashed worker's hold is released when the row is
re-armed (queue.rearm_stale).

Functions take the caller's session and never commit.
CAST(:x AS type), never ``::`` after a bind.
"""
from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Optional

from sqlalchemy import text
from sqlalchemy.orm import Session

KIND_RUN = "RUN"
KIND_MONTH = "MONTH"
_ZERO = Decimal("0")


def _dec(value: Any) -> Decimal:
    try:
        d = Decimal(str(value if value is not None else 0))
    except Exception:  # noqa: BLE001
        return _ZERO
    return d if d.is_finite() else _ZERO


def month_budget_id(institute_id: str, now: Optional[datetime] = None) -> str:
    when = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    return f"month:{institute_id}:{when:%Y-%m}"


def run_budget_id(run_id: str) -> str:
    return f"run:{run_id}"


_UPSERT_BUDGET_SQL = text(
    """
    INSERT INTO course_knowledge_budget (id, institute_id, kind, cap_credits, created_at, updated_at)
    VALUES (:id, :i, :kind, CAST(:cap AS NUMERIC), now(), now())
    ON CONFLICT (id) DO UPDATE SET cap_credits = EXCLUDED.cap_credits, updated_at = now()
    RETURNING id
    """
)


def _upsert(db: Session, budget_id: str, institute_id: str, kind: str, cap: Any) -> str:
    cap_d = max(_ZERO, _dec(cap))
    row = db.execute(
        _UPSERT_BUDGET_SQL, {"id": budget_id, "i": institute_id, "kind": kind, "cap": str(cap_d)},
    ).fetchone()
    if row is None:  # pragma: no cover - an upsert always returns its row
        raise RuntimeError(f"course knowledge: budget upsert returned nothing for {budget_id}")
    return row[0]


def ensure_month_budget(db: Session, institute_id: str, cap: Any, now: Optional[datetime] = None) -> str:
    """This month's auto budget, created or re-capped (the cap follows the
    current setting). Returns its id."""
    return _upsert(db, month_budget_id(institute_id, now), institute_id, KIND_MONTH, cap)


def create_run_budget(db: Session, run_id: str, institute_id: str, cap: Any) -> str:
    """The budget of one PROCESS run, cap = the accepted quote. Returns its id."""
    return _upsert(db, run_budget_id(run_id), institute_id, KIND_RUN, cap)


_RESERVE_SQL = text(
    """
    UPDATE course_knowledge_budget
       SET reserved_credits = reserved_credits + CAST(:c AS NUMERIC), updated_at = now()
     WHERE id = :id AND reserved_credits + charged_credits + CAST(:c AS NUMERIC) <= cap_credits
    RETURNING id
    """
)

_MARK_ROW_SQL = text(
    """
    UPDATE content_index_queue
       SET budget_id = :id, reserved_credits = reserved_credits + CAST(:c AS NUMERIC), updated_at = now()
     WHERE institute_id = :i AND slide_id = :s AND status = 'PROCESSING'
    RETURNING slide_id
    """
)

_CLEAR_ROW_SQL = text(
    """
    UPDATE content_index_queue
       SET budget_id = NULL, reserved_credits = 0, updated_at = now()
     WHERE institute_id = :i AND slide_id = :s AND budget_id = :id
    RETURNING slide_id
    """
)


def reserve(
    db: Session,
    budget_id: str,
    credits: Any,
    *,
    institute_id: Optional[str] = None,
    slide_id: Optional[str] = None,
) -> bool:
    """Hold `credits` on the budget if it fits under the cap; True when held.
    With institute_id + slide_id the hold is also recorded on that lesson's
    PROCESSING queue row (same transaction). A zero amount always fits."""
    c = max(_ZERO, _dec(credits))
    if c <= 0:
        return True
    row = db.execute(_RESERVE_SQL, {"id": budget_id, "c": str(c)}).fetchone()
    if row is None:
        return False
    if institute_id and slide_id:
        db.execute(_MARK_ROW_SQL, {"id": budget_id, "c": str(c), "i": institute_id, "s": slide_id}).fetchone()
    return True


def _clear_row(db: Session, budget_id: str, institute_id: Optional[str], slide_id: Optional[str]) -> None:
    if institute_id and slide_id:
        db.execute(_CLEAR_ROW_SQL, {"id": budget_id, "i": institute_id, "s": slide_id}).fetchone()


def release(
    db: Session,
    budget_id: str,
    credits: Any,
    *,
    institute_id: Optional[str] = None,
    slide_id: Optional[str] = None,
) -> bool:
    """Give back a hold (never below zero). With institute_id + slide_id the
    queue row's record of it is cleared too. True when the budget exists."""
    c = max(_ZERO, _dec(credits))
    row = db.execute(
        text(
            """
            UPDATE course_knowledge_budget
               SET reserved_credits = GREATEST(reserved_credits - CAST(:c AS NUMERIC), 0), updated_at = now()
             WHERE id = :id
            RETURNING id
            """
        ),
        {"id": budget_id, "c": str(c)},
    ).fetchone()
    _clear_row(db, budget_id, institute_id, slide_id)
    return row is not None


def settle(
    db: Session,
    budget_id: str,
    reserved: Any,
    charged: Any,
    *,
    institute_id: Optional[str] = None,
    slide_id: Optional[str] = None,
) -> bool:
    """Move a hold to charged: reserved drops by `reserved` (never below
    zero), charged grows by `charged` (the ledger amount, which may differ
    from the quote). True when the budget exists."""
    r = max(_ZERO, _dec(reserved))
    c = max(_ZERO, _dec(charged))
    row = db.execute(
        text(
            """
            UPDATE course_knowledge_budget
               SET reserved_credits = GREATEST(reserved_credits - CAST(:r AS NUMERIC), 0),
                   charged_credits = charged_credits + CAST(:c AS NUMERIC),
                   updated_at = now()
             WHERE id = :id
            RETURNING id
            """
        ),
        {"id": budget_id, "r": str(r), "c": str(c)},
    ).fetchone()
    _clear_row(db, budget_id, institute_id, slide_id)
    return row is not None


def true_up(db: Session, budget_id: str, delta: Any) -> bool:
    """Correct charged_credits by `delta` (either sign, never below zero): a
    delivery whose charge was not confirmed was counted at its quote, and the
    sweep's re-drive moves it to the ledger amount. True when the budget exists."""
    d = _dec(delta)
    row = db.execute(
        text(
            """
            UPDATE course_knowledge_budget
               SET charged_credits = GREATEST(charged_credits + CAST(:d AS NUMERIC), 0), updated_at = now()
             WHERE id = :id
            RETURNING id
            """
        ),
        {"id": budget_id, "d": str(d)},
    ).fetchone()
    return row is not None


def close_run_budget(db: Session, run_id: str) -> bool:
    """A finished run's cap shrinks to what it charged, so its unused headroom
    can never be spent later. True when the budget exists."""
    row = db.execute(
        text(
            """
            UPDATE course_knowledge_budget
               SET cap_credits = charged_credits, updated_at = now()
             WHERE id = :id
            RETURNING id
            """
        ),
        {"id": run_budget_id(run_id)},
    ).fetchone()
    return row is not None


def month_spent(db: Session, institute_id: str, now: Optional[datetime] = None) -> Decimal:
    """Charged + reserved on this month's auto budget (0 when it has none)."""
    row = db.execute(
        text(
            "SELECT charged_credits + reserved_credits FROM course_knowledge_budget WHERE id = :id"
        ),
        {"id": month_budget_id(institute_id, now)},
    ).fetchone()
    return _dec(row[0]) if row else _ZERO


__all__ = [
    "KIND_RUN", "KIND_MONTH", "month_budget_id", "run_budget_id", "ensure_month_budget",
    "create_run_budget", "reserve", "release", "settle", "true_up", "close_run_budget", "month_spent",
]
