"""
Credits v2 — the institute's AI plan, tenant view (contract P-API):

  GET /ai-service/credits/v2/institutes/{institute_id}/plan
      {plan: {name, plan_key, version_no, period_start, period_end, renews_at, enforcement, status,
              auto_renew, cancel_at_period_end} | null,
       allowance: {credits, used, remaining} | null,
       features: [{feature_key, label, mode, display_cap_text, roles_included, usage_pct,
                   any_model, included_models: [...]}]}

Who: any member of the institute (the signed JWT's per-institute authorities)
and platform staff. Institute ADMINs (and staff) also get the caps detail:
usage_pct per feature and the allowance numbers; other members get null there.

What a tenant is never shown: prices in USD, the internal cost caps
(internal_cost_cap_usd, inst_cost_usd_cap), raw cap values or real cost.
usage_pct is the institute's use of the feature's fair use in this period, in
percent of the tightest institute cap (units, credits or the internal cost
cap, without saying which); null when the feature has no institute cap.

A plan is shown to the tenant only while it changes their billing: a LIVE
subscription with billing.plans.enabled on. A SHADOW subscription (or plans
switched off platform-wide) bills exactly as before, so the tenant sees
{plan: null}; platform staff see it anyway, flagged effective=false. A paid
plan (source PAYMENT, LIVE) stays effective with the switch off (the engine
keeps applying it: payments critique #9), but only while its current period is
paid; otherwise its benefits are paused (plan.payment_status says why).

Paid plans (V590): admins (and staff) also get `billing`: source, the current
period's payment status, next renewal, grace end, the open charge (amount,
due date, payment link), a scheduled plan change and the autopay mandate.
Feature labels use ai_billing_feature.tenant_label when set (F13).

Read-only: no period row, wallet or counter is created here.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, Header
from sqlalchemy.orm import Session

from ..core.security import get_current_user, is_platform_staff, jwt_institute_roles, require_institute_member
from ..db import db_dependency
from . import plans_admin as pa
from ..services.metering.plan_models import TOOL_FEATURE_OVERRIDES

logger = logging.getLogger(__name__)

UTC = timezone.utc
MODELS_MAX = 20

router = APIRouter(prefix="/credits/v2/institutes/{institute_id}", tags=["Credits v2 — AI plan"])


def _aware(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=UTC)


def _empty() -> Dict[str, Any]:
    return {"plan": None, "allowance": None, "features": []}


def _counter_key(sub_id: str, feature_key: str) -> str:
    try:
        from ..services.metering.plan_models import plan_counter_key
        return plan_counter_key(sub_id, feature_key)
    except Exception:  # noqa: BLE001
        return f"PLAN:{sub_id}|F:{feature_key}"


def _counter_all_key(sub_id: str) -> str:
    try:
        from ..services.metering.plan_models import plan_counter_key
        return plan_counter_key(sub_id)
    except Exception:  # noqa: BLE001
        return f"PLAN:{sub_id}|ALL"


def _pct(used: Any, cap: Any) -> Optional[float]:
    try:
        cap_d = Decimal(str(cap))
    except Exception:  # noqa: BLE001
        return None
    if not cap_d.is_finite() or cap_d < 0:
        return None
    used_d = Decimal(str(used or 0))
    if cap_d == 0:
        return 100.0
    return round(float(used_d / cap_d * 100), 1)


def _usage_pct(counter: Optional[Dict[str, Any]], caps: Dict[str, Any]) -> Optional[float]:
    pairs = (("inst_units_cap", "count_used"), ("inst_credits_cap", "credits_used"), ("inst_cost_usd_cap", "cost_usd"))
    pcts = [_pct((counter or {}).get(col), caps.get(cap)) for cap, col in pairs if caps.get(cap) is not None]
    pcts = [p for p in pcts if p is not None]
    return max(pcts) if pcts else None


def _default_chain_models(db: Session, feature_key: str) -> List[str]:
    engine = pa.get_plans_engine()
    fn = getattr(engine, "default_chain_models", None) if engine is not None else None
    if callable(fn):
        try:
            return [str(m) for m in (fn(db, feature_key) or [])][:MODELS_MAX]
        except Exception:  # noqa: BLE001
            logger.warning("plans engine default_chain_models failed", exc_info=True)
            pa._rollback(db)  # noqa: SLF001
    out: List[str] = []
    try:
        from ..services.model_selection import resolve_models

        ucs = [r["model_use_case"] for r in pa.rows(
            db, "SELECT DISTINCT model_use_case FROM ai_use_case_catalog WHERE billing_feature_key = :f "
                "AND model_use_case IS NOT NULL AND is_active ORDER BY 1", {"f": feature_key})]
        for uc in ucs:
            primary, _fallbacks = resolve_models(db, uc)   # fallbacks are charged (plans.default_chain_models)
            if primary and primary not in out:
                out.append(primary)
    except Exception:  # noqa: BLE001
        logger.warning("included models lookup failed for %s", feature_key, exc_info=True)
        pa._rollback(db)  # noqa: SLF001
    return out[:MODELS_MAX]


def _max_price_models(db: Session, max_price: Any) -> List[str]:
    try:
        return [r["model_id"] for r in pa.rows(
            db, "SELECT model_id FROM ai_models WHERE is_active AND output_price_per_1m IS NOT NULL "
                "AND output_price_per_1m <= :p ORDER BY display_order NULLS LAST, model_id LIMIT :n",
            {"p": max_price, "n": MODELS_MAX})]
    except Exception:  # noqa: BLE001
        pa._rollback(db)  # noqa: SLF001
        return []


def _models(db: Session, item: Dict[str, Any]) -> Dict[str, Any]:
    policy = str(item.get("model_policy") or "DEFAULT_CHAIN").upper()
    if policy == "ANY":
        return {"any_model": True, "included_models": []}
    if policy == "ALLOWLIST":
        return {"any_model": False, "included_models": list(item.get("model_allowlist") or [])[:MODELS_MAX]}
    if policy == "MAX_PRICE":
        return {"any_model": False, "included_models": _max_price_models(db, item.get("max_output_price_per_1m"))}
    return {"any_model": False, "included_models": _default_chain_models(db, item["feature_key"])}


def plan_view(db: Session, institute_id: str, *, is_admin: bool, is_staff: bool,
              now: Optional[datetime] = None) -> Dict[str, Any]:
    now = now or datetime.now(UTC)
    if not pa.tables_ready(db):
        return _empty()
    sub = pa.one(db, (
        "SELECT s.*, p.plan_key, p.name AS plan_name, v.version_no, v.allowance_credits AS v_allowance, "
        "v.internal_cost_cap_usd AS v_cost_cap "
        "FROM institute_ai_subscription s JOIN ai_plan_version v ON v.id = s.plan_version_id "
        "JOIN ai_plan p ON p.id = v.plan_id WHERE s.institute_id = :i AND s.status IN ('TRIAL','ACTIVE','GRACE') "
        "LIMIT 1"), {"i": institute_id})
    if sub is None:
        return _empty()
    enabled = pa.plans_enabled()
    paid_plan = str(sub.get("source") or "").upper() == "PAYMENT"
    started = sub["start_at"] is not None and _aware(sub["start_at"]) <= now
    ended = sub.get("end_at") is not None and _aware(sub["end_at"]) <= now
    effective = (enabled or paid_plan) and sub["enforcement"] == "LIVE" and started and not ended
    if not effective and not is_staff:
        return _empty()
    sid = str(sub["id"])
    anchor = _aware(sub["anchor_at"])
    ps, pe = pa.period_bounds(anchor, int(sub.get("period_months") or 1), now)
    period = pa.one(db, "SELECT * FROM ai_subscription_period WHERE subscription_id = CAST(:s AS UUID) "
                        "AND period_start <= :now AND period_end > :now ORDER BY period_start DESC LIMIT 1",
                    {"s": sid, "now": now})
    vid = str(sub["plan_version_id"])
    if period is not None:
        ps, pe = period["period_start"], period["period_end"]
        if period.get("plan_version_id") and str(period["plan_version_id"]) != vid:
            # the engine bills a period on the version recorded on it (a plan change at renewal)
            vid = str(period["plan_version_id"])
            v = pa.one(db, "SELECT v.version_no, v.allowance_credits AS v_allowance, v.internal_cost_cap_usd AS "
                           "v_cost_cap, p.plan_key, p.name AS plan_name FROM ai_plan_version v JOIN ai_plan p ON "
                           "p.id = v.plan_id WHERE v.id = CAST(:v AS UUID)", {"v": vid})
            if v:
                sub = {**sub, **v}
    end_at = sub.get("end_at")
    renews = bool(sub.get("auto_renew")) and not bool(sub.get("cancel_at_period_end")) and (
        end_at is None or end_at > pe)
    plan = {"name": sub["plan_name"], "plan_key": sub["plan_key"], "version_no": sub["version_no"],
            "status": sub["status"], "enforcement": sub["enforcement"],
            "period_start": pa.iso(ps), "period_end": pa.iso(pe), "renews_at": pa.iso(pe) if renews else None,
            "end_at": pa.iso(end_at), "auto_renew": bool(sub.get("auto_renew")),
            "cancel_at_period_end": bool(sub.get("cancel_at_period_end"))}
    if paid_plan:
        pay = str((period or {}).get("payment_status") or "DUE").upper() if period is not None else "DUE"
        plan["payment_status"] = pay
        plan["benefits_paused"] = pay not in ("PAID", "WAIVED", "COMPLIMENTARY")
    if is_staff:
        plan["effective"] = effective
        plan["plans_enabled"] = enabled
        plan["subscription_id"] = sid

    allowance = None
    if is_admin:
        credits = pa.num(period["allowance_credits"]) if period else pa.num(sub.get("v_allowance"))
        used = pa.num(period["allowance_used"]) if period else 0.0
        credits, used = credits or 0.0, used or 0.0
        allowance = {"credits": credits, "used": used, "remaining": max(0.0, credits - used)}

    label_sql = _label_sql(db)
    items = pa.rows(db, f"SELECT i.*, {label_sql} AS label, f.display_order, f.eligibility, f.locked FROM ai_plan_item i "
                        "JOIN ai_billing_feature f ON f.feature_key = i.feature_key "
                        "WHERE i.plan_version_id = CAST(:v AS UUID) AND f.is_active "
                        "ORDER BY f.display_order, i.feature_key", {"v": vid})
    overrides = {r["feature_key"]: r for r in pa.rows(
        db, f"SELECT o.*, {label_sql} AS label, f.display_order, f.eligibility, f.locked FROM ai_subscription_override o "
            "JOIN ai_billing_feature f ON f.feature_key = o.feature_key "
            "WHERE o.subscription_id = CAST(:s AS UUID) AND o.is_active AND f.is_active", {"s": sid})}
    # an override with a mode and no plan item stands alone (the engine's rule; default model policy)
    have = {i["feature_key"] for i in items}
    for key, ov in sorted(overrides.items(), key=lambda kv: (kv[1].get("display_order") or 0, kv[0])):
        if key not in have and ov.get("mode"):
            items.append({"feature_key": key, "mode": ov["mode"], "label": ov.get("label"),
                          "eligibility": ov.get("eligibility"), "locked": ov.get("locked"),
                          "model_policy": "DEFAULT_CHAIN", "display_cap_text": None, "roles_included": None,
                          **{c: None for c in pa.CAP_FIELDS}})
    counters: Dict[str, Dict[str, Any]] = {}
    if is_admin and items:
        keys = [_counter_key(sid, i["feature_key"]) for i in items] + [_counter_all_key(sid)]
        try:
            for r in pa.rows(db, "SELECT counter_key, count_used, credits_used, cost_usd FROM ai_usage_counter "
                                 "WHERE institute_id = :i AND period = 'PLAN_PERIOD' AND window_start = :w "
                                 "AND counter_key = ANY(CAST(:k AS VARCHAR[]))",
                             {"i": institute_id, "w": ps, "k": keys}):
                counters[r["counter_key"]] = r
        except Exception:  # noqa: BLE001
            logger.warning("plan counters read failed", exc_info=True)
            pa._rollback(db)  # noqa: SLF001

    tools = _feature_tool_keys(db)
    features = []
    for it in items:
        key = it["feature_key"]
        ov = overrides.get(key) or {}
        mode = str(ov.get("mode") or it["mode"]).upper()
        elig = str(it.get("eligibility") or "")
        if key in pa.HARD_LOCKED_FEATURES or elig not in pa.ELIGIBILITIES or elig == "ALWAYS_CHARGED":
            mode = "CHARGED"            # what the engine does whatever the item says
        elif mode == "INCLUDED" and elig == "ALLOWANCE_ONLY":
            mode = "ALLOWANCE"          # the engine pays it from the allowance
        elif mode not in pa.ITEM_MODES:
            mode = "CHARGED"
        caps = {c: (ov.get(c) if ov.get(c) is not None else it.get(c)) for c in pa.CAP_FIELDS}
        f = {"feature_key": key, "label": it.get("label") or key, "mode": mode,
             "display_cap_text": it.get("display_cap_text"),
             "roles_included": list(it.get("roles_included") or []) or None,
             "usage_pct": _usage_pct(counters.get(_counter_key(sid, key)), caps) if (is_admin and mode == "INCLUDED")
             else None}
        if mode == "INCLUDED":
            f.update(_models(db, it))
        else:
            f.update({"any_model": None, "included_models": []})
        f["tool_keys"] = tools.get(key, [])
        features.append(f)
    if is_admin:
        # the plan-wide internal cost cap, as a percentage only (never the USD figure)
        plan["overall_fair_use_pct"] = (_pct((counters.get(_counter_all_key(sid)) or {}).get("cost_usd"),
                                             sub.get("v_cost_cap")) if sub.get("v_cost_cap") is not None else None)
    out = {"plan": plan, "allowance": allowance, "features": features}
    if paid_plan and (is_admin or is_staff):
        out["billing"] = _billing(db, institute_id, now)
    return out


def _feature_tool_keys(db: Session) -> Dict[str, List[str]]:
    """billing feature -> the tool keys billed as it (the catalog's use cases, then the engine's
    per-tool overrides). Lets a cost preview in the admin app say "included in your plan" for
    the tool it is pricing. Read-only; empty on any error."""
    out: Dict[str, List[str]] = {}
    try:
        for r in pa.rows(db, "SELECT billing_feature_key AS f, tool_keys FROM ai_use_case_catalog "
                             "WHERE is_active AND billing_feature_key IS NOT NULL"):
            for t in (r.get("tool_keys") or []):
                if t and t not in TOOL_FEATURE_OVERRIDES:
                    out.setdefault(str(r["f"]), []).append(str(t))
        for t, f in TOOL_FEATURE_OVERRIDES.items():
            out.setdefault(f, []).append(t)
    except Exception:  # noqa: BLE001
        logger.warning("plan tool keys read failed", exc_info=True)
        pa._rollback(db)  # noqa: SLF001
        return {}
    return {k: sorted(set(v)) for k, v in out.items()}


def _label_sql(db: Session) -> str:
    """The tenant-facing feature label: tenant_label (V590) when set."""
    try:
        from . import plans_billing_internal as pb
        if pb.has_column(db, "ai_billing_feature", "tenant_label"):
            return "COALESCE(f.tenant_label, f.label)"
    except Exception:  # noqa: BLE001
        logger.warning("tenant_label check failed", exc_info=True)
        pa._rollback(db)  # noqa: SLF001
    return "f.label"


def _billing(db: Session, institute_id: str, now: datetime) -> Optional[Dict[str, Any]]:
    """Paid-plan state for admins: never a USD figure, a cap or a vendor id."""
    try:
        from . import plans_billing_internal as pb
        if not pb.billing_ready(db):
            return None
        s = pb.subscription_summary(db, institute_id, now)
        if s is None:
            return None
        m = pb.latest_mandate(db, institute_id, s.get("subscription_id"))
        oc = s.get("open_charge")
        return {"source": s.get("source"), "status": s.get("status"), "renews_at": s.get("renews_at"),
                "grace_until": s.get("grace_until"), "cancel_at_period_end": s.get("cancel_at_period_end"),
                "pending_plan": s.get("pending_plan"),
                "open_charge": {k: oc.get(k) for k in ("kind", "status", "due_at", "base_minor", "tax_minor",
                                                       "total_minor", "currency", "payment_link_url",
                                                       "link_expires_at")} if oc else None,
                "autopay": {"status": m.get("status"), "method": m.get("method"),
                            "max_amount_minor": int(m["max_amount_minor"]) if m.get("max_amount_minor") is not None
                            else None} if m else None}
    except Exception:  # noqa: BLE001
        logger.warning("plan billing block failed for %s", institute_id, exc_info=True)
        pa._rollback(db)  # noqa: SLF001
        return None


@router.get("/plan", summary="The institute's AI plan: what is included, fair use and allowance")
def get_plan(
    institute_id: str,
    current_user=Depends(get_current_user),
    authorization: Optional[str] = Header(None),
    db: Session = Depends(db_dependency),
):
    staff = is_platform_staff(current_user)
    if staff:
        is_admin = True
    else:
        require_institute_member(authorization, institute_id)
        roles = jwt_institute_roles(authorization, institute_id) or set()
        is_admin = "ADMIN" in roles
    try:
        return plan_view(db, institute_id, is_admin=is_admin, is_staff=staff)
    except Exception:  # noqa: BLE001 - a read for a popover: never a 500
        logger.exception("plan view failed for %s", institute_id)
        pa._rollback(db)  # noqa: SLF001
        return _empty()


__all__ = ["router", "plan_view"]
