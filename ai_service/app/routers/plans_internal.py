"""
Internal AI-plan endpoints, service-to-service only (X-Internal-Service-Token,
the same guard as /internal/metering/v1):

  POST /ai-service/internal/plans/v1/roll[?institute_id=&dry_run=true]
      The renewal / expiry job (admin_core calls it hourly behind the setting
      billing.plans.roll.enabled). For every open subscription:
        SCHEDULED, start_at reached       -> ACTIVE (first period row), unless the
                                             institute already has a live one
        end_at reached                    -> EXPIRED
        period over, cancel_at_period_end -> CANCELLED at the period end
        period over, auto_renew off       -> EXPIRED at the period end
        period over, PAYMENT source, unpaid -> GRACE for grace_days, then EXPIRED
        period over, otherwise            -> the next period row (MANUAL: DUE,
                                             COMPLIMENTARY: COMPLIMENTARY), applying
                                             pending_plan_version_id (publishing a
                                             version with migrate_existing_at_renewal
                                             sets it on the old version's subscribers)
      Missed hours catch up (one period at a time, up to 120 per run).

      Paid plans (source PAYMENT, V590) take a path of their own
      (plans_billing_internal.roll_payment, payments critique #4): every
      PENDING / ACTIVE / GRACE one is checked each run; the roll never creates
      their periods (only a paid charge does), it creates the renewal CHARGE
      7 days before the period end, moves an unpaid renewal to GRACE at the
      period end and to EXPIRED after grace_days, cancels at the period end,
      expires an unpaid checkout, and voids charges that can no longer be paid.
      The report lists charges_created / charges_voided; admin_core's billing
      job reads the charges to collect from GET /charges?needs_collection=true
      (state, not this report, drives collection: critique #6).

Idempotent and safe to run concurrently (two replicas, a retry): each
subscription is handled in its own transaction under a transaction-scoped
advisory lock (pg_advisory_xact_lock, fine behind pgbouncer transaction
pooling) and re-read FOR UPDATE under it; period rows are INSERT .. ON CONFLICT
DO NOTHING RETURNING. A second run with nothing due changes nothing and writes
no event. One subscription's failure is reported and never stops the rest.

Nothing here touches a wallet, a ledger row or a usage counter.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from ..db import db_dependency
from ..dependencies import require_internal_service_token
from . import plans_admin as pa
from . import plans_billing_internal as pb

logger = logging.getLogger(__name__)

UTC = timezone.utc
ACTOR = "system:plans-roll"
MAX_STEPS = 120
BATCH_LIMIT = 5000

router = APIRouter(
    prefix="/internal/plans/v1",
    tags=["Internal AI plans"],
    dependencies=[Depends(require_internal_service_token)],
)


def _aware(value: Optional[datetime]) -> Optional[datetime]:
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=UTC)


def _version(db: Session, vid: Any) -> Dict[str, Any]:
    return pa.one(db, "SELECT * FROM ai_plan_version WHERE id = CAST(:v AS UUID)", {"v": str(vid)}) or {}


def _latest_period(db: Session, sid: str) -> Optional[Dict[str, Any]]:
    return pa.one(db, "SELECT * FROM ai_subscription_period WHERE subscription_id = CAST(:s AS UUID) "
                      "ORDER BY period_start DESC LIMIT 1", {"s": sid})


def _set(db: Session, sid: str, fields: Dict[str, Any]) -> Dict[str, Any]:
    uuid_cols = {"plan_version_id", "pending_plan_version_id"}
    sets = ", ".join((f"{k} = CAST(:{k} AS UUID)" if k in uuid_cols else f"{k} = :{k}") for k in fields)
    return pa.one(db, f"UPDATE institute_ai_subscription SET {sets}, updated_by = :_actor, updated_at = now() "
                      "WHERE id = CAST(:_sid AS UUID) RETURNING *", {**fields, "_actor": ACTOR, "_sid": sid})


def _roll_one(db: Session, sid: str, now: datetime, dry_run: bool,
              extra: Optional[Dict[str, List[Dict[str, Any]]]] = None) -> List[str]:
    """Bring one subscription up to `now`. Runs inside the caller's transaction; returns what happened."""
    head = pa.one(db, "SELECT institute_id, source FROM institute_ai_subscription WHERE id = CAST(:s AS UUID)",
                  {"s": sid})
    if head is not None and str(head.get("source") or "").upper() == "PAYMENT":
        return pb.roll_payment(db, sid, head["institute_id"], now, dry_run, extra)
    pa.xact_lock(db, f"ai_subscription_roll:{sid}")
    sub = pa.one(db, "SELECT * FROM institute_ai_subscription WHERE id = CAST(:s AS UUID) FOR UPDATE", {"s": sid})
    if sub is None or sub["status"] in pa.TERMINAL_STATUSES:
        return []
    done: List[str] = []
    iid = sub["institute_id"]

    def event(kind: str, before: Dict[str, Any], after: Dict[str, Any], reason: str) -> None:
        done.append(kind)
        if not dry_run:
            pa.sub_event(db, sid, iid, kind, pa.sub_state(before), pa.sub_state(after), ACTOR, reason)

    # 1. a scheduled start
    if sub["status"] == "SCHEDULED":
        if _aware(sub["start_at"]) > now:
            return []
        end_at = _aware(sub.get("end_at"))
        if end_at is not None and end_at <= now:
            after = {**sub, "status": "EXPIRED"}
            if not dry_run:
                after = _set(db, sid, {"status": "EXPIRED"})
            event("EXPIRED", sub, after, "end_at passed before the subscription started")
            return done
        pa.xact_lock(db, f"ai_subscription:{iid}")    # the same lock assignment takes
        other = pa.one(db, "SELECT id FROM institute_ai_subscription WHERE institute_id = :i AND id <> CAST(:s AS UUID) "
                           "AND status IN ('TRIAL','ACTIVE','GRACE') LIMIT 1", {"i": iid, "s": sid})
        if other is not None:
            return ["BLOCKED_BY_LIVE_SUBSCRIPTION"]
        after = {**sub, "status": "ACTIVE"}
        if not dry_run:
            after = _set(db, sid, {"status": "ACTIVE"})
        event("ACTIVATED", sub, after, "start_at reached")
        sub = after

    # 2. walk period ends up to now
    for _ in range(MAX_STEPS):
        end_at = _aware(sub.get("end_at"))
        anchor = _aware(sub["anchor_at"])
        pm = int(sub.get("period_months") or 1)
        latest = _latest_period(db, sid)
        if latest is None:
            ps, pe = pa.period_bounds(anchor, pm, min(now, end_at) if end_at else now)
            if anchor > now:
                return done
            # first period missing (assigned before this job ran, or the engine has not created it yet):
            # create the one containing now; history before it is not invented.
            if end_at is not None and end_at <= now:
                after = {**sub, "status": "EXPIRED"}
                if not dry_run:
                    after = _set(db, sid, {"status": "EXPIRED"})
                event("EXPIRED", sub, after, "end_at reached")
                return done
            done.append("PERIOD_CREATED")
            if dry_run:
                return done
            pa.ensure_period(db, sub, ps, pe)
            continue
        p_end = _aware(latest["period_end"])
        if end_at is not None and end_at <= now and end_at <= p_end:
            after = {**sub, "status": "EXPIRED"}
            if not dry_run:
                after = _set(db, sid, {"status": "EXPIRED"})
            event("EXPIRED", sub, after, "end_at reached")
            return done
        if p_end > now:
            # The engine opens a renewed period lazily (on the pending version) when a charge
            # lands before this job: the subscription follows the period it is billed on.
            pv = str(latest.get("plan_version_id") or "")
            if pv and pv != str(sub["plan_version_id"]) and _aware(latest["period_start"]) > _aware(sub["start_at"]):
                fields = {"plan_version_id": pv}
                if str(sub.get("pending_plan_version_id") or "") == pv:
                    fields["pending_plan_version_id"] = None
                after = {**sub, **fields}
                if not dry_run:
                    after = _set(db, sid, fields)
                event("PLAN_CHANGED", sub, after, "applied at renewal (period opened by the plan engine)")
                sub = after
            # GRACE that was paid in the meantime goes back to ACTIVE
            if sub["status"] == "GRACE" and str(latest.get("payment_status")) in ("PAID", "COMPLIMENTARY", "WAIVED"):
                after = {**sub, "status": "ACTIVE"}
                if not dry_run:
                    after = _set(db, sid, {"status": "ACTIVE"})
                event("GRACE_CLEARED", sub, after, "period paid")
            return done
        # the latest period is over
        if sub.get("cancel_at_period_end"):
            fields = {"status": "CANCELLED", "end_at": p_end, "auto_renew": False}
            after = {**sub, **fields}
            if not dry_run:
                after = _set(db, sid, fields)
            event("CANCELLED", sub, after, "cancel_at_period_end")
            return done
        if not sub.get("auto_renew"):
            fields = {"status": "EXPIRED", "end_at": end_at if end_at is not None and end_at < p_end else p_end}
            after = {**sub, **fields}
            if not dry_run:
                after = _set(db, sid, fields)
            event("EXPIRED", sub, after, "period ended without auto-renew")
            return done
        if str(sub.get("source")).upper() == "PAYMENT" and str(latest.get("payment_status")) == "DUE":
            grace_until = p_end + timedelta(days=int(sub.get("grace_days") or 0))
            if now < grace_until:
                if sub["status"] != "GRACE":
                    after = {**sub, "status": "GRACE"}
                    if not dry_run:
                        after = _set(db, sid, {"status": "GRACE"})
                    event("GRACE_STARTED", sub, after, "period unpaid at its end")
                return done
            fields = {"status": "EXPIRED", "end_at": grace_until}
            after = {**sub, **fields}
            if not dry_run:
                after = _set(db, sid, fields)
            event("EXPIRED", sub, after, "unpaid after the grace days")
            return done
        # renew: next period starts where the last one ended
        next_start = p_end
        _, next_end = pa.period_bounds(anchor, pm, next_start)
        if next_end <= next_start:     # defensive: arithmetic must move forward
            next_end = pa.add_months(next_start, pm)
        target = None
        reason = "auto-renew"
        if sub.get("pending_plan_version_id"):
            target = _version(db, sub["pending_plan_version_id"])
            if target.get("status") != "PUBLISHED":
                logger.warning("plans roll: pending version %s of %s is %s; renewing on the current version",
                               sub["pending_plan_version_id"], sid, target.get("status"))
                target, reason = None, "auto-renew (pending version not published; kept the current one)"
            else:
                reason = "auto-renew with the scheduled plan change"
        if target is not None:
            fields = {"plan_version_id": str(target["id"]), "pending_plan_version_id": None}
            after = {**sub, **fields}
            if not dry_run:
                after = _set(db, sid, fields)
            event("PLAN_CHANGED", sub, after, reason)
            sub = after
        elif sub.get("pending_plan_version_id"):
            after = {**sub, "pending_plan_version_id": None}
            if not dry_run:
                after = _set(db, sid, {"pending_plan_version_id": None})
            sub = after
        if dry_run:
            done.append("RENEWED")
            return done          # a dry run cannot walk further without the row
        row, created = pa.ensure_period(db, sub, next_start, next_end)
        if created:
            event("RENEWED", sub, sub, reason)
        if sub["status"] == "GRACE":
            after = _set(db, sid, {"status": "ACTIVE"})
            event("GRACE_CLEARED", sub, after, "renewed")
            sub = after
    logger.warning("plans roll: %s still behind after %d steps", sid, MAX_STEPS)
    return done


def roll(db: Session, *, now: Optional[datetime] = None, institute_id: Optional[str] = None,
         dry_run: bool = False) -> Dict[str, Any]:
    now = _aware(now) or datetime.now(UTC)
    report: Dict[str, Any] = {"ok": True, "now": now.isoformat(), "dry_run": dry_run, "checked": 0,
                              "changed": [], "errors": [], "counts": {}, "charges_created": [],
                              "charges_voided": []}
    if not pa.tables_ready(db):
        report.update(ok=True, skipped="the AI plan tables are missing (V588 not applied)")
        return report
    params: Dict[str, Any] = {"lim": BATCH_LIMIT, "now": now}
    sql = ("SELECT s.id FROM institute_ai_subscription s WHERE ((s.status IN ('SCHEDULED','TRIAL','ACTIVE','GRACE') "
           "AND (s.status <> 'SCHEDULED' OR s.start_at <= :now) ")
    # only the ones with something due: no period row yet, the latest one over, end_at passed, GRACE,
    # or a pending plan change (applied once its period starts)
    sql += ("AND (s.status IN ('SCHEDULED','GRACE') OR (s.end_at IS NOT NULL AND s.end_at <= :now) "
            "OR s.pending_plan_version_id IS NOT NULL OR NOT EXISTS (SELECT 1 FROM ai_subscription_period p WHERE p.subscription_id = s.id "
            "AND p.period_end > :now))) "
            # paid plans: every open one (renewal charge at T-7, grace, checkout expiry; few rows)
            "OR (s.source = 'PAYMENT' AND s.status IN ('PENDING','ACTIVE','GRACE'))) ")
    if institute_id:
        sql += "AND s.institute_id = :i "
        params["i"] = institute_id
    sql += "ORDER BY s.created_at LIMIT :lim"
    ids = [str(r["id"]) for r in pa.rows(db, sql, params)]
    pa._rollback(db)  # noqa: SLF001 - end the read transaction before the per-subscription ones
    touched: Dict[str, Optional[bool]] = {}
    for sid in ids:
        report["checked"] += 1
        extra: Dict[str, List[Dict[str, Any]]] = {}
        try:
            done = _roll_one(db, sid, now, dry_run, extra)
            if dry_run:
                pa._rollback(db)  # noqa: SLF001
            else:
                db.commit()
        except Exception as exc:  # noqa: BLE001 - one bad row never stops the job
            pa._rollback(db)  # noqa: SLF001
            msg = str(exc).splitlines()[0][:300] if str(exc) else type(exc).__name__
            logger.warning("plans roll failed for %s: %s", sid, msg)
            report["errors"].append({"subscription_id": sid, "error": msg})
            continue
        report["charges_created"].extend(extra.get("charges_created", []))
        report["charges_voided"].extend(extra.get("charges_voided", []))
        if done:
            report["changed"].append({"subscription_id": sid, "actions": done})
            for a in done:
                report["counts"][a] = report["counts"].get(a, 0) + 1
            live = None
            if any(a in ("EXPIRED", "CANCELLED") for a in done):
                live = False
            elif "ACTIVATED" in done:
                live = True
            touched[sid] = live
    if touched and not dry_run:
        for r in pa.rows(db, "SELECT id::text AS id, institute_id FROM institute_ai_subscription "
                             "WHERE id = ANY(CAST(:ids AS UUID[]))", {"ids": list(touched)}):
            pa.notify_engine(r["institute_id"], live=touched.get(r["id"]))
        pa._rollback(db)  # noqa: SLF001
    report["ok"] = not report["errors"]
    return report


@router.post("/roll", summary="Renew, expire, cancel and activate AI plan subscriptions (idempotent)")
def roll_endpoint(
    institute_id: Optional[str] = Query(None, max_length=64),
    dry_run: bool = Query(False),
    db: Session = Depends(db_dependency),
) -> Dict[str, Any]:
    try:
        return roll(db, institute_id=institute_id.strip() if institute_id else None, dry_run=dry_run)
    except Exception as exc:  # noqa: BLE001 - the scheduler logs the body; never a 500 loop
        pa._rollback(db)  # noqa: SLF001
        logger.exception("plans roll failed")
        return {"ok": False, "error": str(exc).splitlines()[0][:300] if str(exc) else type(exc).__name__}


__all__ = ["router", "roll"]
