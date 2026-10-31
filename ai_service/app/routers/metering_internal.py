"""
Internal usage-limits endpoints (contract N4), service-to-service only
(X-Internal-Service-Token, the same guard as /internal/llm/v1):

  POST /ai-service/internal/metering/v1/authorize
      The limits decision for one operation a Java service is about to run.
      ALWAYS 200 with the Decision JSON {allow, decision, warnings, block,
      reservation_id, ...}: the caller reads `allow` / `block` (the N3 429
      body) and decides what its user sees. Any problem -> allow / NONE.
      An institute without a limits policy -> NONE with no database query.
  POST /ai-service/internal/metering/v1/counters/rebuild?days=35[&institute_id=]
      Recompute the current usage-counter windows from ai_usage_event (the
      admin_core nightly job). Returns the engine's report.

A caller that asks for a reservation (reserve=true) gets its id back and must
pass it on the charge as usage_context.reservation_id (the post-commit event
hook settles it); one it did not ask for (the use case reserves on its own) is
released at once, since the caller cannot carry it to the charge.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..db import db_dependency
from ..dependencies import require_internal_service_token

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/internal/metering/v1",
    tags=["Internal usage metering"],
    dependencies=[Depends(require_internal_service_token)],
)


class AuthorizeRequest(BaseModel):
    """Lenient on purpose (like the metering request fields): an odd value is
    ignored by the engine, never a 422 that would stop the caller's work."""

    institute_id: Optional[str] = None
    use_case: Optional[str] = None
    tool_key: Optional[str] = None
    request_type: Optional[str] = None
    # actor (the metering request schema's fields)
    user_id: Optional[str] = None
    actor_kind: Optional[str] = None
    actor_user_id: Optional[str] = None
    actor_role_class: Optional[str] = None
    actor_roles_raw: Optional[List[Any]] = None
    role_source: Optional[str] = None
    actor_display_name: Optional[str] = None
    subject_user_id: Optional[str] = None
    subject_display_name: Optional[str] = None
    surface: Optional[str] = None
    source_service: Optional[str] = None
    estimate_credits: Optional[float] = Field(None, ge=0)
    reserve: bool = False


def _ctx(body: AuthorizeRequest) -> Dict[str, Any]:
    ctx: Dict[str, Any] = {
        "actor_kind": body.actor_kind,
        "actor_user_id": body.actor_user_id or body.user_id,
        "actor_role_class": body.actor_role_class,
        "actor_roles_raw": [str(r) for r in body.actor_roles_raw if r] if body.actor_roles_raw else None,
        "role_source": body.role_source,
        "actor_display_name": body.actor_display_name,
        "subject_user_id": body.subject_user_id,
        "subject_display_name": body.subject_display_name,
        "surface": body.surface or "INTERNAL",
        "source_service": body.source_service,
    }
    if not ctx["actor_kind"]:
        ctx["actor_kind"] = "USER" if ctx["actor_user_id"] else "SYSTEM"
    if ctx["actor_kind"] == "SYSTEM" and not ctx["actor_role_class"]:
        ctx["actor_role_class"] = "SYSTEM"
    if not ctx["role_source"] and (ctx["actor_role_class"] or ctx["actor_roles_raw"]):
        ctx["role_source"] = "CALLER"
    return {k: v for k, v in ctx.items() if v is not None}


def _none() -> Dict[str, Any]:
    from ..services.metering.limit_gate import none_decision

    return none_decision()


@router.post("/authorize", summary="Usage-limits decision for one operation (always 200; fails open)")
def authorize(body: AuthorizeRequest, db: Session = Depends(db_dependency)) -> Dict[str, Any]:
    out = _authorize_limits(body, db)
    return _with_billing_mode(out, body, db)


def _with_billing_mode(out: Dict[str, Any], body: AuthorizeRequest, db: Session) -> Dict[str, Any]:
    """AI plans (additive): `billing_mode` CHARGED | INCLUDED | ALLOWANCE for
    an institute with a live AI subscription (INCLUDED / ALLOWANCE = a LIVE
    plan covers the estimate, so the caller's balance requirement does not
    apply). Left out for everyone else (in-memory lookup), so their JSON is
    exactly today's. Never fails the call."""
    try:
        from ..services.metering import plan_wiring

        if not body.institute_id or not plan_wiring.live(body.institute_id):
            return out
        mode = plan_wiring.billing_mode_for(
            db, institute_id=body.institute_id, use_case=body.use_case, tool_key=body.tool_key,
            request_type=body.request_type, ctx=_ctx(body), estimate=body.estimate_credits)
        if mode:
            out = dict(out)
            out["billing_mode"] = mode
    except Exception as exc:  # noqa: BLE001
        logger.debug("internal authorize billing_mode skipped: %s", exc)
    return out


def _authorize_limits(body: AuthorizeRequest, db: Session) -> Dict[str, Any]:
    try:
        from ..services.metering import limit_gate
    except Exception:  # noqa: BLE001
        return {"allow": True, "decision": "NONE", "warnings": [], "block": None, "reservation_id": None}
    try:
        if not body.institute_id or not limit_gate.policy_active(body.institute_id):
            return _none()
        decision = limit_gate.authorize(
            db, institute_id=body.institute_id, use_case=body.use_case, tool_key=body.tool_key,
            request_type=body.request_type, ctx=_ctx(body), estimate_credits=body.estimate_credits,
            reserve=bool(body.reserve), enforce=False,
        )
        if decision is None:
            return _none()
        out = dict(decision)
        # enforce=False above only stops the gate raising; the engine's verdict
        # is reported as it is (allow false + block for an ENFORCE block).
        return out
    except Exception as exc:  # noqa: BLE001 - this endpoint never fails a caller
        logger.warning("internal authorize failed (allowing): %s", str(exc).splitlines()[0][:300] if str(exc) else exc)
        return _none()


@router.post("/counters/rebuild", summary="Recompute usage counters from ai_usage_event")
def rebuild_counters(
    days: int = Query(35, ge=1, le=400),
    institute_id: Optional[str] = Query(None, max_length=64),
    db: Session = Depends(db_dependency),
) -> Dict[str, Any]:
    try:
        from ..services.metering import limits
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": f"limits engine unavailable: {type(exc).__name__}"}
    try:
        report = limits.rebuild_counters(db, days=days, institute_id=institute_id)
    except Exception as exc:  # noqa: BLE001
        logger.warning("counters rebuild failed: %s", exc)
        return {"ok": False, "error": str(exc).splitlines()[0][:300] if str(exc) else type(exc).__name__}
    return report if isinstance(report, dict) else {"ok": True, "report": report}


__all__ = ["router"]
