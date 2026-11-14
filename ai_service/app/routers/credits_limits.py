"""
Credits v2 — AI usage limits, tenant admin API (/credits/v2/institutes/{id}/limits/**).

  GET    ""                  policy (or the default OFF one), TENANT rows, PLATFORM rows (read-only),
                             whether ENFORCE is switched on platform-wide
  PUT    /policy             mode OFF | SHADOW | ENFORCE (ENFORCE only when the platform unlocked it),
                             notify_admins_on_soft, show_numbers_to_learners
  POST   /rows               add a TENANT row
  PATCH  /rows/{row_id}      change a TENANT row's soft / hard limit
  DELETE /rows/{row_id}      retire a TENANT row (is_active = false, effective_to = now())
  POST   /preview            replay the last N days of usage against proposed + existing rows
  GET    /effective?user_id= which limits apply to one user and why
  GET    /usage?period=      the current window's counters, labelled

Who: the institute's ADMINs (require_institute_member admin=True: the signed
JWT's per-institute roles) and platform staff (SUPER_ADMIN_USER_IDS). Through
this API everyone, staff included, gets tenant rights: TENANT rows only, never
PLATFORM or locked rows, no dollar (COST_USD) caps, and ENFORCE only when the
super admin set tenant_may_enforce. Super-admin powers are in
routers/metering_limits_admin.py, which reuses the validation below.

Every write needs a `reason`; the actor comes from the token, never the body;
both go to ai_model_change_log (an INFO log while that table is missing).
Evaluation (effective limits, preview) is the limits engine's
(services/metering/limits.py); this module only stores and validates rows.
While V587 is not applied, reads answer the default OFF state and writes 503.
"""
from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Dict, List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..core.security import get_current_user, is_platform_staff, require_institute_member
from ..db import db_dependency
from ..services import metering_query as mq

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/credits/v2/institutes/{institute_id}/limits",
                   tags=["Credits v2 — AI usage limits"])

ENFORCE_SETTING = "metering.limits.enforce"
UNITS = {"CREDITS": "credits", "COUNT": "requests", "COST_USD": "usd"}
PREVIEW_DAYS_MAX = 90


# ── request bodies ──────────────────────────────────────────────────────────

class PolicyPut(BaseModel):
    mode: str = Field(..., max_length=8)
    notify_admins_on_soft: Optional[bool] = None
    show_numbers_to_learners: Optional[bool] = None
    reason: str = Field(..., max_length=2000)


class RowBase(BaseModel):
    subject_kind: str = Field(..., max_length=16)
    subject_value: Optional[str] = Field(None, max_length=255)
    per_member: Optional[bool] = None
    scope_kind: str = Field(..., max_length=16)
    scope_value: Optional[str] = Field(None, max_length=64)
    period: str = Field(..., max_length=12)
    metric: str = Field(..., max_length=8)
    soft_limit: Optional[float] = None
    hard_limit: Optional[float] = None


class RowCreate(RowBase):
    reason: str = Field(..., max_length=2000)


class TenantRowCreate(RowCreate):
    # Only so a tenant asking for them gets a clear 403 (never stored from here).
    origin: Optional[str] = Field(None, max_length=10)
    locked: Optional[bool] = None


class RowPatch(BaseModel):
    soft_limit: Optional[float] = None
    hard_limit: Optional[float] = None
    reason: str = Field(..., max_length=2000)


class PreviewRow(BaseModel):
    """A proposed row. With `id` of an existing row it replaces that row in
    the replay; with `id` and is_active=false it removes it."""
    id: Optional[str] = Field(None, max_length=64)
    is_active: Optional[bool] = None
    subject_kind: Optional[str] = Field(None, max_length=16)
    subject_value: Optional[str] = Field(None, max_length=255)
    per_member: Optional[bool] = None
    scope_kind: Optional[str] = Field(None, max_length=16)
    scope_value: Optional[str] = Field(None, max_length=64)
    period: Optional[str] = Field(None, max_length=12)
    metric: Optional[str] = Field(None, max_length=8)
    soft_limit: Optional[float] = None
    hard_limit: Optional[float] = None
    origin: Optional[str] = Field(None, max_length=10)   # super-admin preview only
    locked: Optional[bool] = None                        # super-admin preview only


class PreviewBody(BaseModel):
    rows: List[PreviewRow] = Field(default_factory=list, max_length=50)
    days: int = Field(30, ge=1, le=PREVIEW_DAYS_MAX)


# ── dependencies (overridable in tests) ─────────────────────────────────────

def get_limits_query(db: Session = Depends(db_dependency)) -> mq.LimitsQuery:
    return mq.LimitsQuery(db)


_engine_state: Dict[str, Any] = {"retry_at": 0.0}


def get_limits_engine():
    """services/metering/limits.py, or None while it cannot be imported
    (re-tried at most once a minute, logged once per try)."""
    now = time.monotonic()
    if now < _engine_state["retry_at"]:
        return None
    try:
        from ..services.metering import limits as engine  # type: ignore
        return engine
    except Exception as exc:  # noqa: BLE001
        _engine_state["retry_at"] = now + 60.0
        logger.warning("metering limits engine unavailable: %s", exc)
        return None


@dataclass
class Caller:
    user_id: Optional[str]
    is_staff: bool


def actor_id(user: Any) -> Optional[str]:
    uid = user.get("user_id") if isinstance(user, dict) else getattr(user, "user_id", None)
    uid = str(uid or "").strip()
    return uid if uid and uid != "unknown" else None


def require_limits_admin(institute_id: str, user: Any, authorization: Optional[str]) -> Caller:
    """Platform staff, or an ADMIN of this institute (403 otherwise)."""
    if is_platform_staff(user):
        return Caller(actor_id(user), True)
    require_institute_member(authorization, institute_id, admin=True)
    return Caller(actor_id(user), False)


# ── shared helpers (also used by metering_limits_admin) ─────────────────────

def need_reason(reason: Optional[str]) -> str:
    reason = (reason or "").strip()
    if not reason:
        raise HTTPException(status_code=422, detail="reason is required: say why this changes")
    return reason


def require_tables(lq: mq.LimitsQuery) -> None:
    if not lq.tables_ready():
        raise HTTPException(status_code=503, detail=(
            "the usage-limit tables are missing: deploy admin_core (its Flyway migration V587 "
            "creates them) first"))


def valid_row_id(row_id: str) -> str:
    try:
        return str(UUID(str(row_id)))
    except (TypeError, ValueError):
        raise HTTPException(status_code=404, detail="limit row not found")


def _upper(value: Optional[str], allowed: tuple, name: str) -> str:
    v = str(value or "").strip().upper()
    if v not in allowed:
        raise HTTPException(status_code=422, detail=f"{name} must be one of {', '.join(allowed)}")
    return v


def _amount(value: Optional[float], name: str) -> Optional[Decimal]:
    if value is None:
        return None
    try:
        d = Decimal(str(value))
    except Exception:  # noqa: BLE001
        raise HTTPException(status_code=422, detail=f"{name} must be a number")
    if not d.is_finite() or d < 0:
        raise HTTPException(status_code=422, detail=f"{name} must be 0 or more")
    if d > Decimal(str(mq.LIMIT_MAX_VALUE)):
        raise HTTPException(status_code=422, detail=f"{name} is too large")
    return d.quantize(Decimal("0.0001"))


def check_soft_hard(soft: Optional[Decimal], hard: Optional[Decimal], subject_kind: str) -> None:
    if soft is not None and hard is not None and soft > hard:
        raise HTTPException(status_code=422, detail="soft_limit must not be above hard_limit")
    if soft is None and hard is None and subject_kind not in ("USER", "ROLE"):
        # A USER / ROLE row with no numbers is an exemption from a broader cap
        # (d_credits §4.2 rule 2); anywhere else it would mean nothing.
        raise HTTPException(status_code=422, detail="set a soft_limit, a hard_limit or both")


def _role_classes() -> set:
    try:
        from ..services.metering.cache import peek_snapshot
        from ..services.metering.constants import DEFAULT_ROLE_MAP
        snap = peek_snapshot()
        roles = snap.roles if snap is not None else DEFAULT_ROLE_MAP
    except Exception:  # noqa: BLE001
        from ..services.metering.constants import DEFAULT_ROLE_MAP
        roles = DEFAULT_ROLE_MAP
    return {cls for cls, _ in roles.values()} | set(mq.EXTRA_LIMIT_ROLE_CLASSES)


def _clean_value(value: Optional[str]) -> Optional[str]:
    v = str(value).strip() if value is not None else ""
    return v or None


def validate_row(lq: mq.LimitsQuery, institute_id: str, body: RowBase, *, platform: bool,
                 origin: str = "TENANT", locked: bool = False) -> Dict[str, Any]:
    """Normalise + validate one limit row (422 on bad input, 403 for what
    only the platform may set). Returns the column values to store."""
    sk = _upper(body.subject_kind, mq.LIMIT_SUBJECT_KINDS, "subject_kind")
    sv = _clean_value(body.subject_value)
    if sk == "INSTITUTE":
        if sv is not None:
            raise HTTPException(status_code=422, detail="subject_value must be empty for INSTITUTE")
    elif sv is None:
        raise HTTPException(status_code=422, detail=f"subject_value is required for {sk}")
    elif "|" in sv:
        raise HTTPException(status_code=422, detail="subject_value must not contain '|'")
    if sk == "ROLE_CLASS":
        sv = sv.upper()
        classes = _role_classes()
        if sv not in classes:
            raise HTTPException(status_code=422,
                                detail=f"role class must be one of {', '.join(sorted(classes))}")
    elif sk == "ROLE":
        sv = sv.upper().replace("-", "_").replace(" ", "_")
        if len(sv) > 64:
            raise HTTPException(status_code=422, detail="role name must be at most 64 characters")
        if not lq.role_known(institute_id, sv):
            raise HTTPException(status_code=422, detail=(
                f"role {sv} is not known: map it on the Metering page first, or use a role class"))
    # Per member / pooled only means something for role rows.
    per_member = True if sk in ("INSTITUTE", "USER") else (True if body.per_member is None
                                                            else bool(body.per_member))

    ck = _upper(body.scope_kind, mq.LIMIT_SCOPE_KINDS, "scope_kind")
    cv = _clean_value(body.scope_value)
    cv = cv.lower() if cv else cv  # the engine matches use cases / groups lower-case
    if ck == "ALL":
        if cv is not None:
            raise HTTPException(status_code=422, detail="scope_value must be empty for ALL")
    elif cv is None:
        raise HTTPException(status_code=422, detail=f"scope_value is required for {ck}")
    elif ck == "GROUP":
        if cv not in lq.feature_groups():
            raise HTTPException(status_code=422, detail=f"unknown feature group {cv}")
    else:
        uc = lq.use_case_row(cv)
        if uc is None or uc.get("is_active") is False:
            raise HTTPException(status_code=422, detail=f"unknown use case {cv}")
        if uc.get("limit_eligible") is False:
            raise HTTPException(status_code=422, detail=f"{cv} cannot be limited")

    period = str(body.period or "").strip().upper()
    if period == "PLAN_PERIOD":
        raise HTTPException(status_code=422, detail="PLAN_PERIOD is reserved for AI plans")
    period = _upper(period, mq.LIMIT_PERIODS, "period")
    metric = _upper(body.metric, mq.LIMIT_METRICS, "metric")
    if metric == "COST_USD" and not platform:
        raise HTTPException(status_code=403, detail="Only the platform can set dollar-cost limits.")
    soft = _amount(body.soft_limit, "soft_limit")
    hard = _amount(body.hard_limit, "hard_limit")
    check_soft_hard(soft, hard, sk)
    return {"subject_kind": sk, "subject_value": sv, "per_member": per_member, "scope_kind": ck,
            "scope_value": cv, "period": period, "metric": metric, "soft_limit": soft,
            "hard_limit": hard, "origin": origin, "locked": bool(locked)}


def tenant_may_edit(row: Dict[str, Any]) -> None:
    if str(row.get("origin") or "").upper() != "TENANT" or row.get("locked"):
        raise HTTPException(status_code=403, detail="This limit is set by the platform and cannot be changed here.")
    if not row.get("is_active") or row.get("effective_to") is not None:
        raise HTTPException(status_code=404, detail="limit row not found")


def _jsonish(value: Any) -> Any:
    """Engine results -> JSON-safe values."""
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, datetime):
        return mq._iso(value)
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, UUID):
        return str(value)
    if isinstance(value, dict):
        return {str(k): _jsonish(v) for k, v in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [_jsonish(v) for v in value]
    if hasattr(value, "__dict__") and not isinstance(value, type):
        try:
            return _jsonish({k: v for k, v in vars(value).items() if not k.startswith("_")})
        except Exception:  # noqa: BLE001
            return str(value)
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    return str(value)


def change_log_ready(db: Session) -> bool:
    """Checked BEFORE a write: the check rolls the session back on error."""
    try:
        from ..services.model_defaults_admin import change_log_available
        return change_log_available(db)
    except Exception:  # noqa: BLE001
        return False


def log_change(db: Session, ready: bool, table: str, key: str, old: Any, new: Any, reason: str,
               actor: Optional[str]) -> None:
    """Audit row in ai_model_change_log (V569), or an INFO log while it is
    missing. A failed audit insert fails the whole change (503): a change is
    never saved without its record."""
    old_j = _jsonish(old) if old is not None else None
    new_j = _jsonish(new) if new is not None else None
    if not ready:
        logger.info("limits change %s/%s by %s (%s): %s -> %s", table, key, actor, reason, old_j, new_j)
        return
    try:
        from ..services.model_defaults_admin import _log_change as log_row
        log_row(db, table, key, old_j, new_j, reason, actor)
    except Exception:  # noqa: BLE001
        logger.exception("ai_model_change_log write failed for %s/%s", table, key)
        _rollback(db)
        raise HTTPException(status_code=503, detail="could not save the change")


def commit(db: Session) -> None:
    try:
        db.commit()
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        logger.error("limits change commit failed: %s", exc)
        raise HTTPException(status_code=503, detail="could not save the change")


ACTIVE_MODES = ("SHADOW", "ENFORCE")


def notify_engine(lq: mq.LimitsQuery, institute_id: str, *, rebuild: Optional[bool] = None,
                  active: Optional[bool] = None) -> None:
    """After a committed write: the engine drops its cached policy (and, with
    `active`, updates this process's policy index at once) and, when the
    institute's limits are live, rebuilds its current counter windows (the
    engine keeps counters only for keys an active row references). Never
    raises: the change is saved either way, and the nightly rebuild repairs."""
    engine = get_limits_engine()
    if engine is None:
        return
    try:
        if rebuild is None:
            row = lq.policy_row(institute_id)
            rebuild = bool(row) and str(row.get("mode") or "OFF").upper() in ACTIVE_MODES
        fn = getattr(engine, "notify_changed", None)
        if callable(fn):
            fn(lq.db, institute_id, rebuild=bool(rebuild), active=active)
        elif callable(getattr(engine, "invalidate", None)):
            engine.invalidate(institute_id, active=active)
    except Exception:  # noqa: BLE001
        logger.warning("limits engine notify failed for %s", institute_id, exc_info=True)
        _rollback(lq.db)


def enforce_globally_enabled() -> bool:
    try:
        from ..services.metering.cache import as_bool, setting_value
        return as_bool(setting_value(ENFORCE_SETTING, True), True)
    except Exception:  # noqa: BLE001
        return True


def labelled_rows(lq: mq.LimitsQuery, institute_id: str, rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    users = [r.get("subject_value") for r in rows if str(r.get("subject_kind")) == "USER"]
    names = lq.user_names(institute_id, users) if users else {}
    catalog = mq.MeteringQuery(lq.db).catalog() if any(
        str(r.get("scope_kind")) == "USE_CASE" for r in rows) else {}
    return [mq.limit_row_item(r, catalog, names) for r in rows]


def row_out(lq: mq.LimitsQuery, institute_id: str, row: Dict[str, Any]) -> Dict[str, Any]:
    return labelled_rows(lq, institute_id, [row])[0]


def limits_overview(lq: mq.LimitsQuery, institute_id: str, *, include_inactive: bool = False) -> Dict[str, Any]:
    out = {"policy": mq.default_policy(institute_id), "rows": [], "platform_rows": [],
           "enforce_globally_enabled": enforce_globally_enabled()}
    if not lq.tables_ready():
        return out
    out["policy"] = mq.policy_item(lq.policy_row(institute_id), institute_id)
    items = labelled_rows(lq, institute_id, lq.list_rows(institute_id, include_inactive=include_inactive))
    out["rows"] = [r for r in items if r["origin"] != "PLATFORM"]
    out["platform_rows"] = [r for r in items if r["origin"] == "PLATFORM"]
    return out


def create_row(lq: mq.LimitsQuery, institute_id: str, fields: Dict[str, Any], reason: str,
               actor: Optional[str]) -> Dict[str, Any]:
    db = lq.db
    ready = change_log_ready(db)
    new = lq.insert_row(institute_id, {**fields, "reason": reason}, actor or "unknown")
    if new is None:
        db.rollback()
        raise HTTPException(status_code=409, detail=(
            "an active limit for this subject, scope, period and metric already exists: edit that one"))
    log_change(db, ready, mq.LIMIT_TABLE_NAME, str(new["id"]), None, new, reason, actor)
    commit(db)
    notify_engine(lq, institute_id)
    logger.info("limit %s created for %s by %s: %s %s/%s %s %s soft=%s hard=%s origin=%s",
                new["id"], institute_id, actor, fields["subject_kind"], fields["scope_kind"],
                fields.get("scope_value"), fields["period"], fields["metric"], fields.get("soft_limit"),
                fields.get("hard_limit"), fields["origin"])
    return row_out(lq, institute_id, new)


def patch_row(lq: mq.LimitsQuery, institute_id: str, row_id: str, changes: Dict[str, Any], reason: str,
              actor: Optional[str], *, platform: bool) -> Dict[str, Any]:
    db = lq.db
    ready = change_log_ready(db)
    old = lq.get_row(institute_id, row_id, for_update=True)
    if old is None:
        raise HTTPException(status_code=404, detail="limit row not found")
    if not platform:
        tenant_may_edit(old)
    elif not old.get("is_active") or old.get("effective_to") is not None:
        raise HTTPException(status_code=404, detail="limit row not found")
    fields: Dict[str, Any] = {}
    for name in ("soft_limit", "hard_limit"):
        if name in changes:
            fields[name] = _amount(changes[name], name)
    if "locked" in changes:
        if changes["locked"] is None:
            raise HTTPException(status_code=422, detail="locked cannot be null")
        fields["locked"] = bool(changes["locked"])
    if not fields:
        raise HTTPException(status_code=422, detail="nothing to change")
    soft = fields["soft_limit"] if "soft_limit" in fields else old.get("soft_limit")
    hard = fields["hard_limit"] if "hard_limit" in fields else old.get("hard_limit")
    check_soft_hard(Decimal(str(soft)) if soft is not None else None,
                    Decimal(str(hard)) if hard is not None else None, str(old.get("subject_kind")))
    new = lq.update_row(institute_id, row_id, fields, actor, reason)
    if new is None:
        db.rollback()
        raise HTTPException(status_code=404, detail="limit row not found")
    log_change(db, ready, mq.LIMIT_TABLE_NAME, row_id, old, new, reason, actor)
    commit(db)
    notify_engine(lq, institute_id)
    logger.info("limit %s of %s changed by %s: %s", row_id, institute_id, actor, sorted(fields))
    return row_out(lq, institute_id, new)


def delete_row(lq: mq.LimitsQuery, institute_id: str, row_id: str, reason: str, actor: Optional[str],
               *, platform: bool) -> Dict[str, Any]:
    db = lq.db
    ready = change_log_ready(db)
    old = lq.get_row(institute_id, row_id, for_update=True)
    if old is None:
        raise HTTPException(status_code=404, detail="limit row not found")
    if not platform:
        tenant_may_edit(old)
    new = lq.deactivate_row(institute_id, row_id, actor, reason)
    if new is None:
        db.rollback()
        raise HTTPException(status_code=404, detail="limit row not found")
    log_change(db, ready, mq.LIMIT_TABLE_NAME, row_id, old, new, reason, actor)
    commit(db)
    notify_engine(lq, institute_id)
    logger.info("limit %s of %s retired by %s", row_id, institute_id, actor)
    return row_out(lq, institute_id, new)


_MODE_RANK = {"OFF": 0, "SHADOW": 1, "ENFORCE": 2}


def save_policy(lq: mq.LimitsQuery, institute_id: str, changes: Dict[str, Any], reason: str,
                actor: Optional[str], *, platform: bool) -> Dict[str, Any]:
    db = lq.db
    ready = change_log_ready(db)
    old = lq.policy_row(institute_id, for_update=True)
    current = mq.policy_item(old, institute_id)
    values = {k: current[k] for k in ("mode", "tenant_may_enforce", "timezone", "notify_admins_on_soft",
                                      "show_numbers_to_learners")}
    if "mode" in changes and changes["mode"] is not None:
        mode = _upper(changes["mode"], mq.LIMIT_MODES, "mode")
        if not platform and mode != current["mode"]:
            if mode == "ENFORCE" and not current["tenant_may_enforce"]:
                raise HTTPException(status_code=403, detail=(
                    "Enforcing limits is not enabled for this institute yet: use Preview (SHADOW), "
                    "or ask Vacademy support to enable it."))
            if current["mode"] == "ENFORCE" and not current["tenant_may_enforce"]:
                raise HTTPException(status_code=403, detail=(
                    "Limits are enforced by the platform for this institute; the mode cannot be changed here."))
            if _MODE_RANK.get(mode, 0) < _MODE_RANK.get(current["mode"], 0) and any(
                    str(r.get("origin") or "").upper() == "PLATFORM" for r in lq.list_rows(institute_id)):
                # The mode switches PLATFORM rows on and off too: a tenant who
                # may enforce its own rows still cannot lift the platform's caps.
                raise HTTPException(status_code=403, detail=(
                    "Platform limits apply to this institute, so the mode cannot be lowered here: "
                    "ask Vacademy support."))
        values["mode"] = mode
    for name in ("notify_admins_on_soft", "show_numbers_to_learners"):
        if changes.get(name) is not None:
            values[name] = bool(changes[name])
    if platform:
        if changes.get("tenant_may_enforce") is not None:
            values["tenant_may_enforce"] = bool(changes["tenant_may_enforce"])
        if changes.get("timezone") is not None:
            values["timezone"] = valid_timezone(changes["timezone"])
    new = lq.save_policy(institute_id, values, actor, reason)
    log_change(db, ready, mq.POLICY_TABLE_NAME, institute_id, old, new, reason, actor)
    commit(db)
    was_active = current["mode"] in ACTIVE_MODES
    now_active = values["mode"] in ACTIVE_MODES
    notify_engine(lq, institute_id, active=now_active,
                  rebuild=now_active and (not was_active or values["timezone"] != current["timezone"]))
    logger.info("limits policy of %s by %s: %s -> %s", institute_id, actor,
                current["mode"], values["mode"])
    return mq.policy_item(new, institute_id)


def valid_timezone(name: Any) -> str:
    from zoneinfo import ZoneInfo
    tz = str(name or "").strip()
    if not tz or len(tz) > 48:
        raise HTTPException(status_code=422, detail="timezone must be an IANA name like Asia/Kolkata")
    try:
        ZoneInfo(tz)
    except Exception:  # noqa: BLE001
        raise HTTPException(status_code=422, detail=f"unknown timezone {tz}")
    return tz


def preview_rows(lq: mq.LimitsQuery, institute_id: str, rows: List[PreviewRow], *,
                 platform: bool) -> List[Dict[str, Any]]:
    """Validated proposed rows for the engine's preview_impact. Tenants may
    only replace / remove their own editable rows, and only propose TENANT
    rows; the super admin may propose either origin (PLATFORM by default)."""
    from pydantic import ValidationError

    out: List[Dict[str, Any]] = []
    for n, pr in enumerate(rows):
        rid = None
        if pr.id is not None:
            rid = valid_row_id(pr.id)
            existing = lq.get_row(institute_id, rid)
            if existing is None:
                raise HTTPException(status_code=422, detail=f"proposed row {n + 1}: no limit row {rid}")
            if not platform:
                tenant_may_edit(existing)
        if pr.is_active is False:
            if rid is None:
                raise HTTPException(status_code=422, detail=f"proposed row {n + 1}: removing needs an id")
            out.append({"id": rid, "is_active": False, "institute_id": institute_id})
            continue
        if not platform and ((pr.origin is not None and str(pr.origin).strip().upper() != "TENANT")
                             or pr.locked):
            raise HTTPException(status_code=403, detail="Only the platform can add platform or locked limits.")
        try:
            base = RowBase.model_validate(pr.model_dump(exclude={"id", "is_active", "origin", "locked"}))
        except ValidationError as exc:
            raise HTTPException(status_code=422, detail=f"proposed row {n + 1}: {exc.errors()}")
        if platform:
            origin = _upper(pr.origin or "PLATFORM", mq.LIMIT_ORIGINS, "origin")
            locked = (origin == "PLATFORM") if pr.locked is None else bool(pr.locked)
        else:
            origin, locked = "TENANT", False
        f = validate_row(lq, institute_id, base, platform=platform, origin=origin, locked=locked)
        out.append({**{k: (float(v) if isinstance(v, Decimal) else v) for k, v in f.items()},
                    "id": rid or f"proposed-{n + 1}", "institute_id": institute_id, "is_active": True,
                    "effective_to": None})
    return out


def run_preview(engine, lq: mq.LimitsQuery, institute_id: str, proposed: List[Dict[str, Any]],
                days: int) -> Dict[str, Any]:
    if engine is None or not callable(getattr(engine, "preview_impact", None)):
        raise HTTPException(status_code=503, detail="the limits engine is not deployed yet")
    try:
        return _jsonish(engine.preview_impact(lq.db, institute_id, proposed, days=days))
    except ValueError as exc:  # the engine's own row validation
        raise HTTPException(status_code=422, detail=str(exc))
    except Exception:  # noqa: BLE001
        logger.exception("limits preview failed for %s", institute_id)
        _rollback(lq.db)
        raise HTTPException(status_code=503, detail="could not compute the preview")


def run_effective(engine, lq: mq.LimitsQuery, institute_id: str, user_id: Optional[str]) -> List[Any]:
    """The engine's effective_limits (it takes the user's roles from their
    latest usage event here)."""
    if engine is None or not callable(getattr(engine, "effective_limits", None)):
        raise HTTPException(status_code=503, detail="the limits engine is not deployed yet")
    try:
        items = engine.effective_limits(lq.db, institute_id, user_id=_clean_value(user_id))
    except Exception:  # noqa: BLE001
        logger.exception("effective limits failed for %s", institute_id)
        _rollback(lq.db)
        raise HTTPException(status_code=503, detail="could not work out the effective limits")
    return _jsonish(list(items or []))


def _rollback(db: Session) -> None:
    try:
        db.rollback()
    except Exception:  # noqa: BLE001
        pass


# ── usage (current window counters) ─────────────────────────────────────────

def _f(value: Any) -> Optional[float]:
    return mq._num(value)


def _used_for(counter: Dict[str, Any], metric: str) -> float:
    col = {"CREDITS": "credits_used", "COUNT": "count_used", "COST_USD": "cost_usd"}.get(metric, "credits_used")
    return _f(counter.get(col)) or 0.0


def _row_matches_scope(row: Dict[str, Any], parsed: Dict[str, Optional[str]]) -> bool:
    return (str(row.get("scope_kind")) == parsed["scope_kind"]
            and (row.get("scope_value") or None) == (parsed["scope_value"] or None))


def mq_norm(role: Any) -> str:
    return str(role or "").strip().upper().replace("-", "_").replace(" ", "_")


def governing_rows(parsed: Dict[str, Optional[str]], rows: List[Dict[str, Any]],
                   user_role: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
    """The active rows (same period, already filtered) that cap this counter.
    Pool counters (I, RC:/R: pooled) take their pooled rows. A user counter
    takes the most specific TENANT individual row (USER > ROLE, most
    permissive > ROLE_CLASS, d_credits §4.2 rule 2) plus every PLATFORM
    individual row that names the user, their roles or their class."""
    kind, value = parsed["subject_kind"], parsed["subject_value"]
    scoped = [r for r in rows if _row_matches_scope(r, parsed)]
    if kind == "INSTITUTE":
        return [r for r in scoped if r.get("subject_kind") == "INSTITUTE"]
    if kind in ("ROLE_CLASS", "ROLE"):
        return [r for r in scoped if r.get("subject_kind") == kind and r.get("per_member") is False
                and str(r.get("subject_value") or "").upper() == str(value or "").upper()]
    if kind != "USER":
        return []
    raw = {mq_norm(x) for x in (user_role or {}).get("raw_roles") or []}
    cls = str((user_role or {}).get("role_class") or "").upper()

    def names_user(r: Dict[str, Any]) -> bool:
        sk, sv = r.get("subject_kind"), str(r.get("subject_value") or "")
        if sk == "USER":
            return sv == str(value)
        if r.get("per_member") is False:
            return False
        if sk == "ROLE":
            return sv.upper() in raw
        if sk == "ROLE_CLASS":
            return bool(cls) and sv.upper() == cls
        return False

    mine = [r for r in scoped if names_user(r)]
    platform = [r for r in mine if r.get("origin") == "PLATFORM"]
    tenant = [r for r in mine if r.get("origin") != "PLATFORM"]
    picked: List[Dict[str, Any]] = []
    for level in ("USER", "ROLE", "ROLE_CLASS"):
        at = [r for r in tenant if r.get("subject_kind") == level]
        if at:
            # most permissive: NULL hard (unlimited) beats any number
            at.sort(key=lambda r: (r.get("hard_limit") is not None, -(_f(r.get("hard_limit")) or 0.0)))
            picked = [at[0]]
            break
    return picked + platform


def usage_items(lq: mq.LimitsQuery, institute_id: str, period: str, *, include_cost: bool,
                now: Optional[datetime] = None) -> List[Dict[str, Any]]:
    if not lq.tables_ready():
        return []
    policy = mq.policy_item(lq.policy_row(institute_id), institute_id)
    tz = policy["timezone"]
    ws, we = mq.limits_window_bounds(period, tz, now)
    counters = lq.counters(institute_id, period, ws)
    if not counters:
        return []
    rows = [r for r in lq.list_rows(institute_id) if str(r.get("period")) == period]
    parsed = {c["counter_key"]: mq.parse_counter_key(c["counter_key"]) for c in counters}
    user_ids = sorted({p["subject_value"] for p in parsed.values()
                       if p["subject_kind"] == "USER" and p["subject_value"]})
    names = lq.user_names(institute_id, user_ids) if user_ids else {}
    roles: Dict[str, Dict[str, Any]] = {}
    if user_ids and any(r.get("subject_kind") in ("ROLE", "ROLE_CLASS") and r.get("per_member") is not False
                        for r in rows):
        roles = lq.users_roles(institute_id, user_ids)
    catalog = mq.MeteringQuery(lq.db).catalog()
    out = []
    for c in counters:
        p = parsed[c["counter_key"]]
        gov = governing_rows(p, rows, roles.get(str(p["subject_value"]))) if p["subject_kind"] else []
        best = None  # the binding row: highest used / limit
        for r in gov:
            used = _used_for(c, str(r.get("metric")))
            lim = _f(r.get("hard_limit"))
            if lim is None:
                lim = _f(r.get("soft_limit"))
            pct = (100.0 if used > 0 else 0.0) if lim == 0 else (used / lim * 100.0 if lim else None)
            key = pct if pct is not None else -1.0
            if best is None or key > best[0]:
                best = (key, r, pct)
        item = {
            "key": c["counter_key"],
            "label": mq.counter_label(c["counter_key"], catalog, names),
            "period": period,
            "window_start": mq.local_iso(ws, tz),
            "resets_at": mq.local_iso(we, tz),
            "credits_used": _f(c.get("credits_used")) or 0.0,
            "count_used": _f(c.get("count_used")) or 0.0,
            "soft": _f(best[1].get("soft_limit")) if best else None,
            "hard": _f(best[1].get("hard_limit")) if best else None,
            "metric": str(best[1].get("metric")) if best else None,
            "unit": UNITS.get(str(best[1].get("metric"))) if best else None,
            "pct": round(best[2], 1) if best and best[2] is not None else None,
            "limit_id": str(best[1].get("id")) if best else None,
        }
        if include_cost:
            item["cost_usd"] = _f(c.get("cost_usd")) or 0.0
        elif best and str(best[1].get("metric")) == "COST_USD":
            item.update(soft=None, hard=None)  # vendor dollars are platform-only
        out.append(item)
    return out


# ── me/usage limits (used by credits_v2.my_usage) ───────────────────────────

_my_limits_errors = {"at": 0.0}


def _pget(obj: Any, name: str, default: Any = None) -> Any:
    if obj is None:
        return default
    if isinstance(obj, dict):
        return obj.get(name, default)
    return getattr(obj, name, default)


def my_limits(db: Optional[Session], institute_id: str, *, user_id: Optional[str], is_admin: bool,
              is_staff: bool, raw_roles: Optional[List[str]]) -> Optional[List[Dict[str, Any]]]:
    """The caller's limits for /credits/v2/me/usage.

    None (the response keeps today's exact shape, no "limits" key) for an
    institute without a limits policy: an in-memory check, no query. Also None
    with no engine / no session. [] for mode OFF or any error (fail open: this
    is display only). Numbers (used / soft / hard) are shown to admins, and to
    everyone else only when the institute turned on show_numbers_to_learners;
    dollar caps show numbers to staff only."""
    engine = get_limits_engine()
    if engine is None or db is None:
        return None
    try:
        if not engine.has_policy(institute_id):
            return None
    except Exception:  # noqa: BLE001
        return None
    try:
        policy = engine.get_policy(db, institute_id)
        if policy is None or str(_pget(policy, "mode", "OFF") or "OFF").upper() == "OFF":
            return []
        from ..services.metering.context import resolve_role_class
        roles = sorted(raw_roles or [])
        items = engine.effective_limits(db, institute_id, user_id=user_id,
                                        role_class=resolve_role_class(roles), raw_roles=roles or None)
        show = is_admin or bool(_pget(policy, "show_numbers_to_learners", False))
        catalog = mq.MeteringQuery(db).catalog()
        out = []
        for it in items or []:
            if _pget(it, "selected") is False:
                continue  # out-ranked by a more specific row: does not apply to the caller
            row = _pget(it, "row") or {}
            row = row if isinstance(row, dict) else (_jsonish(row) or {})
            metric = str(_pget(it, "metric") or _pget(row, "metric") or "CREDITS").upper()
            numbers = show and (metric != "COST_USD" or is_staff)
            out.append({
                "scope": _pget(it, "scope"),
                "scope_label": _pget(it, "scope_label") or (mq.limit_scope_label(row, catalog) if row else None),
                "period": _pget(it, "period") or _pget(row, "period"),
                "used": _jsonish(_pget(it, "used")) if numbers else None,
                "soft": _jsonish(_pget(it, "soft")) if numbers else None,
                "hard": _jsonish(_pget(it, "hard")) if numbers else None,
                "unit": UNITS.get(metric, "credits"),
                "resets_at": _jsonish(_pget(it, "resets_at")),
                "decision": _pget(it, "decision"),
            })
        return out
    except Exception:  # noqa: BLE001 - display only: fail open, rate-limited log
        now = time.monotonic()
        if now - _my_limits_errors["at"] > 60:
            _my_limits_errors["at"] = now
            logger.warning("me/usage limits failed for %s; answering none", institute_id, exc_info=True)
        _rollback(db)
        return []


# ── endpoints ───────────────────────────────────────────────────────────────

@router.get("", summary="The institute's limits policy and rows (PLATFORM rows read-only)")
def get_limits(
    institute_id: str,
    include_inactive: bool = Query(False),
    current_user=Depends(get_current_user),
    authorization: Optional[str] = Header(None),
    lq: mq.LimitsQuery = Depends(get_limits_query),
):
    require_limits_admin(institute_id, current_user, authorization)
    out = limits_overview(lq, institute_id, include_inactive=include_inactive)
    out["policy"] = {k: out["policy"][k] for k in ("mode", "tenant_may_enforce", "timezone",
                                                    "notify_admins_on_soft", "show_numbers_to_learners")}
    return out


@router.put("/policy", summary="Turn limits off, preview them (SHADOW) or enforce them")
def put_policy(
    institute_id: str,
    body: PolicyPut,
    current_user=Depends(get_current_user),
    authorization: Optional[str] = Header(None),
    lq: mq.LimitsQuery = Depends(get_limits_query),
):
    caller = require_limits_admin(institute_id, current_user, authorization)
    reason = need_reason(body.reason)
    _upper(body.mode, mq.LIMIT_MODES, "mode")
    require_tables(lq)
    policy = save_policy(lq, institute_id, body.model_dump(exclude={"reason"}), reason, caller.user_id,
                         platform=False)
    return {k: policy[k] for k in ("mode", "tenant_may_enforce", "timezone", "notify_admins_on_soft",
                                   "show_numbers_to_learners")}


@router.post("/rows", summary="Add a limit (TENANT row)")
def post_row(
    institute_id: str,
    body: TenantRowCreate,
    current_user=Depends(get_current_user),
    authorization: Optional[str] = Header(None),
    lq: mq.LimitsQuery = Depends(get_limits_query),
):
    caller = require_limits_admin(institute_id, current_user, authorization)
    if (body.origin is not None and str(body.origin).strip().upper() != "TENANT") or body.locked:
        raise HTTPException(status_code=403, detail="Only the platform can add platform or locked limits.")
    reason = need_reason(body.reason)
    require_tables(lq)
    fields = validate_row(lq, institute_id, body, platform=False)
    return create_row(lq, institute_id, fields, reason, caller.user_id)


@router.patch("/rows/{row_id}", summary="Change a TENANT row's soft / hard limit")
def patch_limit_row(
    institute_id: str,
    row_id: str,
    body: RowPatch,
    current_user=Depends(get_current_user),
    authorization: Optional[str] = Header(None),
    lq: mq.LimitsQuery = Depends(get_limits_query),
):
    caller = require_limits_admin(institute_id, current_user, authorization)
    reason = need_reason(body.reason)
    row_id = valid_row_id(row_id)
    require_tables(lq)
    changes = body.model_dump(exclude_unset=True, exclude={"reason"})
    return patch_row(lq, institute_id, row_id, changes, reason, caller.user_id, platform=False)


@router.delete("/rows/{row_id}", summary="Retire a TENANT row (kept for history)")
def delete_limit_row(
    institute_id: str,
    row_id: str,
    reason: Optional[str] = Query(None, max_length=2000),
    current_user=Depends(get_current_user),
    authorization: Optional[str] = Header(None),
    lq: mq.LimitsQuery = Depends(get_limits_query),
):
    caller = require_limits_admin(institute_id, current_user, authorization)
    reason = need_reason(reason)
    row_id = valid_row_id(row_id)
    require_tables(lq)
    return delete_row(lq, institute_id, row_id, reason, caller.user_id, platform=False)


@router.post("/preview", summary="What proposed limits would have done over the last N days")
def post_preview(
    institute_id: str,
    body: PreviewBody,
    current_user=Depends(get_current_user),
    authorization: Optional[str] = Header(None),
    lq: mq.LimitsQuery = Depends(get_limits_query),
    engine=Depends(get_limits_engine),
):
    require_limits_admin(institute_id, current_user, authorization)
    require_tables(lq)
    rows = preview_rows(lq, institute_id, body.rows, platform=False)
    return run_preview(engine, lq, institute_id, rows, body.days)


@router.get("/effective", summary="Which limits apply to a user (or the institute) and why")
def get_effective(
    institute_id: str,
    user_id: Optional[str] = Query(None, max_length=255),
    current_user=Depends(get_current_user),
    authorization: Optional[str] = Header(None),
    lq: mq.LimitsQuery = Depends(get_limits_query),
    engine=Depends(get_limits_engine),
):
    require_limits_admin(institute_id, current_user, authorization)
    if not lq.tables_ready():
        return []
    return run_effective(engine, lq, institute_id, user_id)


@router.get("/usage", summary="This window's usage counters, with the limit that binds each")
def get_usage(
    institute_id: str,
    period: str = Query("DAY", pattern="^(DAY|WEEK|MONTH)$"),
    current_user=Depends(get_current_user),
    authorization: Optional[str] = Header(None),
    lq: mq.LimitsQuery = Depends(get_limits_query),
):
    caller = require_limits_admin(institute_id, current_user, authorization)
    return usage_items(lq, institute_id, period, include_cost=caller.is_staff)
