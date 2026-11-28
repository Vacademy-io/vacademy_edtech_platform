"""
Super Admin — AI usage metering (/super-admin/v1/metering/**).

  GET   /catalog                 every use case of ai_use_case_catalog
  PATCH /catalog/{use_case}      label, label template, feature group, order, active
  GET   /role-map                role -> role class map + raw roles no row maps yet
  PUT   /role-map/{role_name}    add / change one role's class and precedence
  GET   /coverage?days=7         how well events are attributed (sources, unknowns, ledger gaps)
  GET   /parity?days=7           USAGE_DEDUCTION ledger rows vs CHARGED events per IST day

Platform staff only (SUPER_ADMIN_USER_IDS, fail closed). The guard is a
ROUTER-level dependency, so no route can be added here without it. Writes
need a `reason`; the actor comes from the token, never the body, and both go
to ai_model_change_log (or an INFO log while that table is missing). Billing
fields of the catalog (billing_policy, plan/limit eligibility...) are not
writable here on purpose.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..core.security import get_current_user
from ..db import db_dependency
from ..schemas.auth import CustomUserDetails
from ..services import metering_query as mq
from .super_admin import _require_super_admin

logger = logging.getLogger(__name__)


def _staff_only(current_user: CustomUserDetails = Depends(get_current_user)) -> None:
    _require_super_admin(current_user)


router = APIRouter(
    prefix="/super-admin/v1/metering",
    tags=["Super Admin — AI usage metering"],
    dependencies=[Depends(_staff_only)],
)


def get_admin_query(db: Session = Depends(db_dependency)) -> mq.MeteringQuery:
    return mq.MeteringQuery(db)


class CatalogPatch(BaseModel):
    label: Optional[str] = Field(None, min_length=1, max_length=128)
    # An explicit null clears the template (the plain label is shown).
    label_template: Optional[str] = Field(None, max_length=255)
    feature_group: Optional[str] = Field(None, min_length=1, max_length=48, pattern=r"^[a-z][a-z0-9_]*$")
    display_order: Optional[int] = Field(None, ge=0, le=100_000)
    is_active: Optional[bool] = None
    reason: str = Field(..., max_length=2000)


class RolePut(BaseModel):
    role_class: str = Field(..., max_length=16)
    precedence: int = Field(..., ge=0, le=1000)
    reason: str = Field(..., max_length=2000)


# ── helpers ─────────────────────────────────────────────────────────────────

def _actor(user: CustomUserDetails) -> Optional[str]:
    return str(getattr(user, "user_id", "") or "") or None


def _reason(reason: Optional[str]) -> str:
    reason = (reason or "").strip()
    if not reason:
        raise HTTPException(status_code=422, detail="reason is required: say why this changes")
    return reason


def normalize_role(name: str) -> str:
    """Same rule as core.security.jwt_institute_roles: upper, '-'/' ' -> '_'."""
    return str(name or "").strip().upper().replace("-", "_").replace(" ", "_")


def _require_tables(query: mq.MeteringQuery) -> None:
    if not query.tables_ready():
        raise HTTPException(status_code=503, detail=(
            "the metering tables are missing: deploy admin_core (its Flyway migration creates them) first"))


def _change_log_ready(db: Session) -> bool:
    from ..services.model_defaults_admin import change_log_available
    return change_log_available(db)


def _log_change(db: Session, ready: bool, table: str, key: str, old, new, reason: str, actor: Optional[str]) -> None:
    if ready:
        from ..services.model_defaults_admin import _log_change as log_row
        log_row(db, table, key, old, new, reason, actor)
    else:
        logger.info("metering change %s/%s by %s (%s): %s -> %s", table, key, actor, reason, old, new)


def _commit(db: Session) -> None:
    try:
        db.commit()
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        logger.error("metering change commit failed: %s", exc)
        raise HTTPException(status_code=503, detail="could not save the change")


def _invalidate_caches() -> None:
    """Drop the read-side catalog cache and, when the metering core exposes
    one, its catalog / role-map caches (else they refresh within 5 minutes)."""
    mq.invalidate_catalog_cache()
    try:
        from ..services.metering import cache as core_cache  # type: ignore
        core_cache.invalidate()
    except Exception:  # noqa: BLE001 - core missing: its cache expires on its own
        logger.debug("metering core cache not invalidated", exc_info=True)


def _check_template(template: Optional[str], row: Dict[str, Any]) -> None:
    """A template must render against a sample event (no exception)."""
    if not template:
        return
    if template.count("{") != template.count("}"):
        raise HTTPException(status_code=422, detail="label_template has unbalanced braces")
    try:
        from ..services.metering.labels import render_label as core_render  # type: ignore
    except Exception:  # noqa: BLE001
        return
    sample = {"use_case": row.get("use_case"), "actor_display_name": "Ravi", "actor_name": "Ravi",
              "actor_role_class": "LEARNER", "subject_display_name": "Priya", "subject_name": "Priya",
              "minutes": 4, "context": {}}
    try:
        core_render({**row, "label_template": template}, sample)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=422, detail=f"label_template does not render: {exc}")


# ── endpoints ───────────────────────────────────────────────────────────────

@router.get("/catalog", summary="Every AI use case in the metering catalog")
def get_catalog(query: mq.MeteringQuery = Depends(get_admin_query)):
    if not query.tables_ready():
        return {"use_cases": []}
    return {"use_cases": query.catalog_rows()}


@router.patch("/catalog/{use_case}", summary="Change a use case's label, template, group, order or active flag")
def patch_catalog(
    use_case: str,
    body: CatalogPatch,
    query: mq.MeteringQuery = Depends(get_admin_query),
    current_user: CustomUserDetails = Depends(get_current_user),
):
    reason = _reason(body.reason)
    _require_tables(query)
    db = query.db
    log_ready = _change_log_ready(db)
    old = query.catalog_row(use_case)
    if old is None:
        raise HTTPException(status_code=404, detail="use case not found")
    fields = {k: v for k, v in body.model_dump(exclude_unset=True).items() if k != "reason"}
    for name in ("label", "feature_group", "display_order", "is_active"):
        if name in fields and fields[name] is None:
            raise HTTPException(status_code=422, detail=f"{name} cannot be null")
    if "label" in fields:
        fields["label"] = fields["label"].strip()
        if not fields["label"]:
            raise HTTPException(status_code=422, detail="label cannot be blank")
    if "label_template" in fields:
        fields["label_template"] = (fields["label_template"] or "").strip() or None
        _check_template(fields["label_template"], old)
    if use_case == "unknown" and fields.get("is_active") is False:
        raise HTTPException(status_code=422, detail="the 'unknown' use case cannot be deactivated")
    if not fields:
        raise HTTPException(status_code=422, detail="nothing to change")
    actor = _actor(current_user)
    query.update_catalog(use_case, fields, actor)
    new = query.catalog_row(use_case)
    _log_change(db, log_ready, mq.CATALOG_TABLE, use_case, old, new, reason, actor)
    _commit(db)
    _invalidate_caches()
    logger.info("metering catalog %s changed by %s: %s", use_case, actor, sorted(fields))
    return new


@router.get("/role-map", summary="Role -> role class map, plus raw roles seen on events that no row maps")
def get_role_map(
    days: int = Query(30, ge=1, le=365),
    query: mq.MeteringQuery = Depends(get_admin_query),
):
    if not query.tables_ready():
        return {"roles": [], "unmapped": []}
    return {"roles": query.role_map(), "unmapped": query.unmapped_roles(days)}


@router.put("/role-map/{role_name}", summary="Add or change one role's class and precedence")
def put_role(
    role_name: str,
    body: RolePut,
    query: mq.MeteringQuery = Depends(get_admin_query),
    current_user: CustomUserDetails = Depends(get_current_user),
):
    reason = _reason(body.reason)
    name = normalize_role(role_name)
    if not name or len(name) > 64:
        raise HTTPException(status_code=422, detail="role_name must be 1-64 characters")
    role_class = body.role_class.strip().upper()
    if role_class not in mq.ROLE_CLASSES:
        raise HTTPException(status_code=422, detail=f"role_class must be one of {', '.join(mq.ROLE_CLASSES)}")
    _require_tables(query)
    db = query.db
    log_ready = _change_log_ready(db)
    old = query.role_row(name)
    actor = _actor(current_user)
    query.upsert_role(name, role_class, body.precedence, actor)
    new = query.role_row(name) or {"role_name": name, "role_class": role_class, "precedence": body.precedence}
    _log_change(db, log_ready, mq.ROLE_MAP_TABLE, name, old, new, reason, actor)
    _commit(db)
    _invalidate_caches()
    logger.info("metering role %s -> %s/%s by %s", name, role_class, body.precedence, actor)
    return new


@router.get("/coverage", summary="Attribution coverage of usage events over the last N days")
def get_coverage(
    days: int = Query(7, ge=1, le=90),
    query: mq.MeteringQuery = Depends(get_admin_query),
):
    if not query.tables_ready():
        return {"days": days, "events": 0, "ledger_rows": 0, "ledger_without_event": 0,
                "use_case_source": {}, "role_source": {}, "unknown_use_case_events": 0,
                "null_actor_events": 0, "by_use_case": []}
    return query.coverage(days)


@router.get("/parity", summary="USAGE_DEDUCTION ledger rows vs CHARGED events per IST day")
def get_parity(
    days: int = Query(7, ge=1, le=90),
    query: mq.MeteringQuery = Depends(get_admin_query),
):
    if not query.tables_ready():
        return {"rows": []}
    return query.parity(days)
