"""AI subscription plans on the money paths (contract P-WIRING).

CreditService (deduct / check / refund), require_credits, preflight_tool_credits,
the tutor minute gate and the internal authorize endpoint call in here ONLY
after `live(institute_id)` said True: an in-memory lookup (metering/plans.py
has_live_subscription: billing.plans.enabled AND the institute has a TRIAL /
ACTIVE / GRACE subscription, bulk-refreshed <= 30 s, last good copy on error).
For every other institute none of this code runs and the charge path is
literally the code that ran before plans existed.

Fail-safe rule: anything going wrong here means CHARGED, exactly as today
(never free by accident, never a failed charge). Every function here
therefore returns a "do what today's code does" answer on any exception.

The plan decision itself (feature mapping, eligibility, override > item,
roles / model / fair-use reservation, allowance take, SHADOW) is
metering/plans.py decide(); this module only feeds it the charge's
attribution and turns its answer into wallet / allowance / included parts.
"""
from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass, field
from decimal import Decimal, ROUND_HALF_UP
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

_D0 = Decimal("0")
_Q = Decimal("0.0001")
PLAN_MODES = ("INCLUDED", "ALLOWANCE", "SPLIT")
_LOG_EVERY = 60.0
_last_log: Dict[str, float] = {}
_stats: Dict[str, int] = {}


def _count(key: str, n: int = 1) -> None:
    _stats[key] = _stats.get(key, 0) + n


def stats() -> Dict[str, int]:
    return dict(_stats)


def _log_limited(key: str, level: int, msg: str, *args: Any) -> None:
    now = time.monotonic()
    last = _last_log.get(key)
    if last is not None and now - last < _LOG_EVERY:
        return
    _last_log[key] = now
    logger.log(level, msg, *args)


def _first_line(exc: BaseException) -> str:
    s = str(exc)
    return s.splitlines()[0][:300] if s else type(exc).__name__


def _dec(value: Any) -> Decimal:
    try:
        if value is None or isinstance(value, bool):
            return _D0
        d = Decimal(str(value))
        return d if d.is_finite() else _D0
    except Exception:  # noqa: BLE001
        return _D0


def _q(value: Decimal) -> Decimal:
    return value.quantize(_Q, rounding=ROUND_HALF_UP)


def _get(obj: Any, name: str, default: Any = None) -> Any:
    if obj is None:
        return default
    if isinstance(obj, dict):
        return obj.get(name, default)
    return getattr(obj, name, default)


# ----------------------------------------------------------------------------
# The plan engine (metering/plans.py, unit P2), imported lazily
# ----------------------------------------------------------------------------

def plans() -> Any:
    try:
        from . import plans as _plans

        return _plans
    except Exception:  # noqa: BLE001
        return None


def live(institute_id: Any) -> bool:
    """In-memory (no I/O): plans on AND a live subscription for this institute.
    False on any problem (= today's path)."""
    if not institute_id:
        return False
    try:
        mod = plans()
        return bool(mod is not None and mod.has_live_subscription(str(institute_id)))
    except Exception:  # noqa: BLE001
        return False


def known(institute_id: Any) -> bool:
    """In-memory (no I/O): the institute has or had an AI subscription (any
    status) as far as this pod knows (plans.had_subscription). Refunds and
    idempotent replays use it to stay plan-aware after a subscription stopped
    being live, so what a plan paid is never credited to the wallet and a
    covered operation is never charged a second time. False for an institute
    that never had a subscription (= today's path, no extra query)."""
    if not institute_id:
        return False
    try:
        mod = plans()
        fn = getattr(mod, "had_subscription", None) if mod is not None else None
        return bool(fn is not None and fn(str(institute_id)))
    except Exception:  # noqa: BLE001
        return False


# ----------------------------------------------------------------------------
# Attribution of one charge (same resolution as the usage event it writes)
# ----------------------------------------------------------------------------

_EXPLICIT_SOURCES = frozenset({"EXPLICIT", "USER", "LEGACY_DEFAULT", "TENANT", "INSTITUTE_TENANT"})


def _attribution(db, obj: Any, *, use_case: Optional[str] = None, tool_key: Optional[str] = None,
                 request_type: Optional[str] = None, model: Optional[str] = None,
                 ctx: Any = None) -> Dict[str, Any]:
    """use_case / tool_key / request_type / model / actor / subject / cost for
    a deduct or check request (or explicit values), resolved exactly like the
    usage event (metering/service.py) so the plan and the event agree."""
    from . import cache as _cache
    from . import service as _svc

    fields: Dict[str, Any] = {}
    if ctx is not None:
        raw = ctx.as_fields() if hasattr(ctx, "as_fields") else ctx
        if isinstance(raw, dict):
            fields.update({k: v for k, v in raw.items() if v is not None})
    for k, v in (("use_case", use_case), ("tool_key", tool_key), ("request_type", request_type), ("model", model)):
        if v is not None:
            fields[k] = v
    inp = _svc.input_from(obj, **fields)
    private = getattr(obj, "__pydantic_private__", None) or {}
    if isinstance(private, dict):
        if inp.real_cost_usd is None and private.get("_meter_real_cost_usd") is not None:
            inp.real_cost_usd = private.get("_meter_real_cost_usd")
        if inp.metadata is None and private.get("_meter_metadata"):
            inp.metadata = private.get("_meter_metadata")
    snap = _cache.get_snapshot(db)
    tk = _svc._tool_key(inp)  # noqa: SLF001 - same resolution as the event writer
    uc = inp.use_case
    role_class = None
    actor_roles = inp.actor_roles_raw
    actor_user_id = inp.actor_user_id or inp.user_id
    if snap is not None:
        uc, _src, row = _svc.resolve_use_case(snap, inp, tk)
        try:
            actor = _svc.resolve_actor(snap, inp, row)
            role_class = actor.get("actor_role_class")
            actor_user_id = actor.get("actor_user_id") or actor_user_id
        except Exception:  # noqa: BLE001
            role_class = None
    if role_class is None and inp.actor_role_class:
        role_class = str(inp.actor_role_class).upper()
    if role_class is None and inp.user_role:
        role_class = "LEARNER" if str(inp.user_role).upper() == "STUDENT" else str(inp.user_role).upper()
    uctx = inp.usage_context if isinstance(inp.usage_context, dict) else {}
    subject = inp.subject_user_id or uctx.get("subject_user_id")
    explicit: Optional[bool] = None
    src = uctx.get("resolution_source") or uctx.get("model_source")
    if src:
        explicit = str(src).upper() in _EXPLICIT_SOURCES
    if uctx.get("preferred_model_explicit") is not None:
        explicit = bool(uctx.get("preferred_model_explicit"))
    return {
        "use_case": uc, "tool_key": tk, "request_type": inp.request_type, "model": inp.model,
        "actor_user_id": actor_user_id, "actor_role_class": role_class, "subject_user_id": subject,
        "actor_roles": actor_roles, "user_role": inp.user_role,
        "cost_usd": inp.real_cost_usd, "preferred_model_explicit": explicit,
        "seconds": inp.seconds, "minutes": uctx.get("minutes"),
    }


def _units(att: Dict[str, Any]) -> Decimal:
    """Fair-use units of one charge: minutes for minute features, else 1 request."""
    m = _dec(att.get("minutes"))
    if m > 0:
        return m
    return Decimal("1")


# ----------------------------------------------------------------------------
# Deduction
# ----------------------------------------------------------------------------

@dataclass
class Outcome:
    """What deduct_credits does with one charge for a live-subscription institute."""

    billing_mode: str = "CHARGED"          # CHARGED | INCLUDED | ALLOWANCE | SPLIT
    list_credits: Decimal = _D0
    wallet: Decimal = _D0                  # debited from the institute balance (ledger row)
    allowance: Decimal = _D0               # taken from the period allowance
    included: Decimal = _D0
    enforcement: Optional[str] = None
    shadow_mode: Optional[str] = None
    reason: Optional[str] = None
    subscription_id: Optional[str] = None
    plan_id: Optional[str] = None
    plan_item_id: Optional[str] = None
    feature_key: Optional[str] = None
    period_id: Optional[str] = None
    release_token: Any = None
    raw: Any = None
    extra: Dict[str, Any] = field(default_factory=dict)

    @property
    def no_ledger(self) -> bool:
        return self.billing_mode in ("INCLUDED", "ALLOWANCE") and self.wallet <= 0

    def plan_fields(self) -> Dict[str, Any]:
        """ai_usage_event columns + context for this charge. A SHADOW charge
        gets the plan ids and shadow_billing_mode only (no context keys)."""
        if self.shadow_mode or self.enforcement == "SHADOW":
            return {"subscription_id": self.subscription_id, "plan_id": self.plan_id,
                    "plan_item_id": self.plan_item_id, "shadow_billing_mode": self.shadow_mode}
        ctx: Dict[str, Any] = {}
        if self.feature_key:
            ctx["plan_feature"] = self.feature_key
        if self.period_id and self.billing_mode in ("ALLOWANCE", "SPLIT"):
            ctx["plan_period_id"] = self.period_id
        if self.billing_mode in ("ALLOWANCE", "SPLIT") and self.allowance > 0:
            ctx["allowance_credits"] = float(self.allowance)
        if self.billing_mode == "INCLUDED" and self.included > 0:
            ctx["included_credits"] = float(self.included)
        if self.reason:
            ctx["plan_reason"] = str(self.reason)[:64]
        if self.enforcement:
            ctx["plan_enforcement"] = self.enforcement
        ctx.update(self.extra)
        out: Dict[str, Any] = {
            "subscription_id": self.subscription_id, "plan_id": self.plan_id,
            "plan_item_id": self.plan_item_id, "context": ctx,
        }
        if self.shadow_mode:
            out["shadow_billing_mode"] = self.shadow_mode
        return out


def _outcome_from(decision: Any, list_credits: Decimal) -> Optional[Outcome]:
    """Normalise plans.decide()'s PlanDecision. Anything inconsistent -> None
    (the caller then charges exactly as today)."""
    if decision is None:
        return None
    mode = str(_get(decision, "billing_mode") or "CHARGED").upper()
    enforcement = (str(_get(decision, "enforcement")).upper() if _get(decision, "enforcement") else None)
    shadow = _get(decision, "shadow_mode") or _get(decision, "shadow_billing_mode")
    o = Outcome(
        billing_mode=mode if mode in ("CHARGED",) + PLAN_MODES else "CHARGED",
        list_credits=list_credits,
        enforcement=enforcement,
        shadow_mode=str(shadow).upper() if shadow else None,
        reason=_get(decision, "reason"),
        subscription_id=_s(_get(decision, "subscription_id")),
        plan_id=_s(_get(decision, "plan_id")),
        plan_item_id=_s(_get(decision, "plan_item_id")),
        feature_key=_s(_get(decision, "feature_key")),
        period_id=_s(_get(decision, "period_id")),
        release_token=_get(decision, "release_token"),
        raw=decision,
    )
    if o.billing_mode == "CHARGED" or enforcement == "SHADOW":
        o.billing_mode = "CHARGED"
        o.wallet, o.allowance, o.included = list_credits, _D0, _D0
        return o
    wallet = _q(max(_dec(_get(decision, "wallet_credits")), _D0))
    allowance = _q(max(_dec(_get(decision, "allowance_credits")), _D0))
    included = _q(max(_dec(_get(decision, "included_credits")), _D0))
    if wallet + allowance + included != list_credits:
        # Parts must add up to today's price; otherwise charge as today.
        return None
    if o.billing_mode == "INCLUDED" and (included != list_credits or wallet or allowance):
        return None
    if o.billing_mode == "ALLOWANCE" and (allowance != list_credits or wallet or included):
        return None
    if o.billing_mode == "SPLIT" and (wallet <= 0 or allowance <= 0 or included):
        return None
    o.wallet, o.allowance, o.included = wallet, allowance, included
    return o


def _s(value: Any) -> Optional[str]:
    return str(value) if value not in (None, "") else None


def decide_for_deduct(db, request: Any, list_credits: Decimal) -> Optional[Outcome]:
    """plans.decide() for one deduction, reserving fair use / allowance in
    SAVEPOINTs of `db`'s open transaction (the deduction's own: they commit
    with the ledger row; release() undoes them while it is still open). None =
    charge exactly as today with no plan tags: no subscription row after all,
    an inconsistent decision, or any failure (after releasing what was
    reserved)."""
    mod = plans()
    if mod is None:
        return None
    decision = None
    try:
        att = _attribution(db, request)
        decision = mod.decide(
            db,
            institute_id=str(request.institute_id),
            list_credits=list_credits,
            use_case=att["use_case"], tool_key=att["tool_key"], request_type=att["request_type"],
            model=att["model"],
            actor_user_id=att["actor_user_id"], role_class=att["actor_role_class"],
            user_role=att["user_role"], actor_roles=att["actor_roles"],
            subject_user_id=att["subject_user_id"],
            units=_units(att), cost_usd=att["cost_usd"],
            preferred_model_explicit=att["preferred_model_explicit"],
            reserve=True,
        )
        if decision is None or (_get(decision, "subscription_id") is None
                                and str(_get(decision, "billing_mode") or "CHARGED").upper() == "CHARGED"):
            return None      # no subscription after all (index ahead of the row): today's charge, untagged
        out = _outcome_from(decision, list_credits)
        if out is None:
            release(db, decision)
            _count("decide_inconsistent")
            _log_limited("inconsistent", logging.WARNING,
                         "plans: inconsistent plan decision for institute %s; charged as before", request.institute_id)
        if out is not None:
            _count(f"mode:{out.billing_mode}" + (":shadow" if out.shadow_mode else ""))
        return out
    except Exception as exc:  # noqa: BLE001
        if decision is not None:
            release(db, decision)
        _count("decide_failed")
        _log_limited("decide", logging.WARNING, "plans: decision failed (charged as before): %s", _first_line(exc))
        return None


def release(db, decision_or_outcome: Any) -> None:
    """Give back what decide() reserved (never raises)."""
    try:
        token = decision_or_outcome.release_token if isinstance(decision_or_outcome, Outcome) \
            else _get(decision_or_outcome, "release_token")
        if token is None:
            return
        mod = plans()
        if mod is not None:
            mod.release(db, token)
            _count("released")
    except Exception as exc:  # noqa: BLE001
        _count("release_failed")
        _log_limited("release", logging.WARNING, "plans: release failed: %s", _first_line(exc))


# ----------------------------------------------------------------------------
# Idempotency for charges that write no ledger row
# ----------------------------------------------------------------------------

def _is_pg(db) -> bool:
    try:
        return db.get_bind().dialect.name == "postgresql"
    except Exception:  # noqa: BLE001
        return False


def plan_event_for_key(db, key: str) -> bool:
    """Was this idempotency key already used by an INCLUDED / ALLOWANCE charge
    (which has no ledger row to find)?"""
    if not key:
        return False
    try:
        from sqlalchemy import text

        with db.begin_nested():
            got = db.execute(text(
                "SELECT 1 FROM ai_usage_event WHERE idempotency_key = :k "
                "AND billing_mode IN ('INCLUDED', 'ALLOWANCE') LIMIT 1"), {"k": key}).first()
        return got is not None
    except Exception:  # noqa: BLE001
        return False


# ----------------------------------------------------------------------------
# Pre-checks (read-only; never create a wallet; never reserve)
# ----------------------------------------------------------------------------

def precheck_mode(db, *, institute_id: Any, use_case: Optional[str] = None, tool_key: Optional[str] = None,
                  request_type: Optional[str] = None, model: Optional[str] = None, ctx: Any = None,
                  obj: Any = None, estimate: Any = None) -> Optional[str]:
    """INCLUDED / ALLOWANCE when a LIVE subscription covers this operation in
    full (so the balance requirement does not apply), else None (today's
    balance check). Only after live(institute_id). Never raises."""
    if not live(institute_id):
        return None
    mod = plans()
    if mod is None:
        return None
    try:
        att = _attribution(db, obj, use_case=use_case, tool_key=tool_key, request_type=request_type,
                           model=model, ctx=ctx)
        res = mod.precheck(
            db, institute_id=str(institute_id),
            use_case=att["use_case"], tool_key=att["tool_key"], request_type=att["request_type"],
            model=att["model"], actor_user_id=att["actor_user_id"], role_class=att["actor_role_class"],
            user_role=att["user_role"], actor_roles=att["actor_roles"],
            subject_user_id=att["subject_user_id"], estimate=_dec(estimate),
            preferred_model_explicit=att["preferred_model_explicit"],
        )
        if bool(_get(res, "covered")):
            mode = str(_get(res, "mode") or "INCLUDED").upper()
            _count(f"precheck_covered:{mode}")
            return mode if mode in ("INCLUDED", "ALLOWANCE") else "INCLUDED"
        return None
    except Exception as exc:  # noqa: BLE001
        _count("precheck_failed")
        _log_limited("precheck", logging.WARNING, "plans: pre-check failed (balance check as before): %s",
                     _first_line(exc))
        return None


def billing_mode_for(db, *, institute_id: Any, use_case: Optional[str] = None, tool_key: Optional[str] = None,
                     request_type: Optional[str] = None, ctx: Any = None, estimate: Any = None) -> Optional[str]:
    """The Decision JSON's billing_mode (internal authorize): INCLUDED /
    ALLOWANCE when covered, CHARGED otherwise; None without a live
    subscription (the field is then left out, so the JSON is today's)."""
    if not live(institute_id):
        return None
    mode = precheck_mode(db, institute_id=institute_id, use_case=use_case, tool_key=tool_key,
                         request_type=request_type, ctx=ctx, estimate=estimate)
    return mode or "CHARGED"


# ----------------------------------------------------------------------------
# Refunds
# ----------------------------------------------------------------------------

def _ctx(value: Any) -> Dict[str, Any]:
    if isinstance(value, dict):
        return dict(value)
    if isinstance(value, str):
        try:
            got = json.loads(value)
            return got if isinstance(got, dict) else {}
        except Exception:  # noqa: BLE001
            return {}
    return {}


def _shot_key(description: Any):
    from .service import _shot_key as sk

    return sk(description)


@dataclass
class _Part:
    institute_id: str
    event_id: str
    mode: str
    occurred_at: Any
    subscription_id: Optional[str]
    wallet: Decimal          # credits_charged (ledger)
    allowance: Decimal       # allowance part
    included: Decimal
    allowance_refunded: Decimal
    included_refunded: Decimal
    refunded_credits: Decimal
    shot: Any
    context: Dict[str, Any]


def _batch_parts(db, institute_id: str, batch_id: str) -> Tuple[List[_Part], Decimal]:
    """The batch's usage events with a plan part, and the batch's open wallet
    amount (ledger deductions minus refunds)."""
    from sqlalchemy import text

    rows = db.execute(text(
        "SELECT e.id, e.billing_mode, e.occurred_at, e.subscription_id, e.list_credits, e.credits_charged, "
        "e.refunded_credits, e.context, ct.description "
        "FROM ai_usage_event e LEFT JOIN credit_transactions ct ON ct.id = e.ledger_tx_id "
        "WHERE e.batch_id = :b AND e.institute_id = :i "
        "AND e.billing_mode IN ('CHARGED', 'INCLUDED', 'ALLOWANCE', 'SPLIT') "
        "AND e.charge_status <> 'DROPPED_INSUFFICIENT' ORDER BY e.occurred_at, e.id"),
        {"b": batch_id, "i": institute_id}).all()
    parts: List[_Part] = []
    for r in rows:
        mode = str(r[1])
        ctx = _ctx(r[7])
        listed, charged = _dec(r[4]), _dec(r[5])
        allowance = listed if mode == "ALLOWANCE" else (max(listed - charged, _D0) if mode == "SPLIT" else _D0)
        included = listed if mode == "INCLUDED" else _D0
        desc = r[8] if r[8] is not None else ctx.get("charge_description")
        shot = _shot_key(desc)
        parts.append(_Part(
            institute_id=institute_id, event_id=str(r[0]), mode=mode, occurred_at=r[2], subscription_id=_s(r[3]),
            wallet=charged if mode in ("CHARGED", "SPLIT") else _D0, allowance=allowance, included=included,
            allowance_refunded=_dec(ctx.get("allowance_refunded")),
            included_refunded=_dec(ctx.get("included_refunded")),
            refunded_credits=_dec(r[6]), shot=shot if shot is not None and not shot[2] else None, context=ctx))
    wallet_net = _dec(db.execute(text(
        "SELECT COALESCE(SUM(CASE WHEN transaction_type = 'USAGE_DEDUCTION' THEN ABS(amount) "
        "WHEN transaction_type = 'REFUND' THEN -ABS(amount) ELSE 0 END), 0) FROM credit_transactions "
        "WHERE batch_id = :b AND institute_id = :i AND transaction_type IN ('USAGE_DEDUCTION', 'REFUND')"),
        {"b": batch_id, "i": institute_id}).scalar())
    return parts, max(wallet_net, _D0)


def _lock_batch(db, institute_id: str, batch_id: str) -> None:
    if not _is_pg(db):
        return
    from sqlalchemy import text

    db.execute(text("SELECT pg_advisory_xact_lock(hashtext(:k))"), {"k": f"plan-refund|{institute_id}|{batch_id}"})


def _period_of(db, part: _Part) -> Optional[str]:
    """The period the event consumed allowance from: context.plan_period_id,
    else the subscription's period containing the event time."""
    pid = _s(part.context.get("plan_period_id"))
    if pid:
        return pid
    if not part.subscription_id:
        return None
    from sqlalchemy import text

    got = db.execute(text(
        "SELECT id FROM ai_subscription_period WHERE subscription_id = :s AND period_start <= :t "
        "AND period_end > :t ORDER BY period_start DESC LIMIT 1"),
        {"s": part.subscription_id, "t": part.occurred_at}).first()
    return str(got[0]) if got is not None else None


def _give_back_allowance(db, part: _Part, amount: Decimal) -> Decimal:
    """Give `amount` of allowance back to the period the event consumed from
    (plans.refund_allowance: guarded, never below 0). Returns what was given back."""
    if amount <= 0:
        return _D0
    mod = plans()
    period_id = _period_of(db, part)
    if mod is None or not period_id:
        return _D0
    return _dec(mod.refund_allowance(db, period_id, amount))


def _mark_allowance_refund(db, part: _Part, given: Decimal, included: Decimal = _D0) -> None:
    """Record allowance (and included) parts refunded on the event; ALLOWANCE
    events carry it in refunded_credits too (limits counters follow)."""
    from sqlalchemy import update

    from .models import EVENT_TABLE as T

    ctx = dict(part.context)
    values: Dict[str, Any] = {}
    if given > 0:
        part.allowance_refunded += given
        ctx["allowance_refunded"] = float(part.allowance_refunded)
    if included > 0:
        part.included_refunded += included
        ctx["included_refunded"] = float(part.included_refunded)
    values["context"] = ctx
    before = part.refunded_credits
    if part.mode in ("ALLOWANCE", "INCLUDED"):
        total = part.allowance_refunded + part.included_refunded
        values["refunded_credits"] = total
        full = part.allowance if part.mode == "ALLOWANCE" else part.included
        values["charge_status"] = "REFUNDED" if total >= full else "PARTIAL_REFUND"
        part.refunded_credits = total
    elif part.mode == "SPLIT" and given > 0:
        total = part.refunded_credits + given
        values["refunded_credits"] = total
        values["charge_status"] = "REFUNDED" if total >= part.wallet + part.allowance else "PARTIAL_REFUND"
        part.refunded_credits = total
    part.context = ctx
    db.execute(update(T).where(T.c.id == part.event_id).values(**values))
    delta = part.refunded_credits - before
    if delta > 0:
        # Usage-limit counters count list_credits net of refunds: take the
        # refunded plan part back out (own SAVEPOINT; never fails the refund).
        try:
            from .service import _decrement_for_refund, _limits_on

            if _limits_on(part.institute_id):
                _decrement_for_refund(db, part.event_id, delta, before)
        except Exception:  # noqa: BLE001
            pass


def refund_allocation(db, institute_id: str, batch_id: str, amount: Decimal,
                      description: Optional[str]) -> Optional[Decimal]:
    """refund_credits for a live-subscription institute and a batch with plan
    parts: how much of `amount` goes to the WALLET. The allowance part of
    the refund goes back to the period allowance here; included parts (and
    anything beyond what the batch was charged) are not credited anywhere.
    None = the batch has no plan parts: refund exactly as today. Runs on the
    refund's transaction (caller commits). Raises on DB errors (the caller
    then refunds as today)."""
    _lock_batch(db, institute_id, batch_id)
    parts, wallet_open = _batch_parts(db, institute_id, batch_id)
    if not any(p.mode in PLAN_MODES for p in parts):
        return None
    remaining = _dec(amount)
    to_wallet = _D0
    key = _shot_key(description)
    targets = parts
    if key is not None and key[2]:
        shot, seg = key[0], key[1]
        matched = [p for p in parts if p.shot is not None and p.shot[0] == shot and (seg is None or p.shot[1] == seg)]
        if matched:
            targets = matched
    # 1. wallet parts of the targeted events (bounded by the batch's open wallet amount)
    if targets is not parts:
        shot_wallet = sum((p.wallet for p in targets), _D0)
        take = min(remaining, shot_wallet, wallet_open)
    else:
        take = min(remaining, wallet_open)
    to_wallet += take
    remaining -= take
    # 2. allowance parts, oldest first
    for p in targets:
        if remaining <= 0:
            break
        open_ = p.allowance - p.allowance_refunded
        if open_ <= 0:
            continue
        give = min(open_, remaining)
        given = _give_back_allowance(db, p, give)
        if given > 0:
            _mark_allowance_refund(db, p, given)
            remaining -= given
    # 3. included parts: nothing to credit, but recorded so they are not refunded twice
    for p in targets:
        if remaining <= 0:
            break
        open_ = p.included - p.included_refunded
        if open_ <= 0:
            continue
        inc = min(open_, remaining)
        _mark_allowance_refund(db, p, _D0, inc)
        remaining -= inc
    if remaining > 0:
        _count("refund_beyond_charged")
        _log_limited("refund-beyond", logging.WARNING,
                     "plans: refund of %s for batch %s exceeds what the plan batch was charged; %s not credited",
                     amount, batch_id, remaining)
    return _q(to_wallet)


def restore_batch_allowance(db, institute_id: str, batch_id: str) -> Decimal:
    """Full refund of a failed batch (refund_video_credits): every open
    allowance part of the batch goes back to its period allowance. The
    wallet part is refunded separately from the ledger, as today. Returns
    the allowance given back. Caller commits."""
    _lock_batch(db, institute_id, batch_id)
    parts, _wallet = _batch_parts(db, institute_id, batch_id)
    total = _D0
    for p in parts:
        open_ = p.allowance - p.allowance_refunded
        if open_ <= 0:
            continue
        given = _give_back_allowance(db, p, open_)
        if given > 0:
            _mark_allowance_refund(db, p, given)
            total += given
    return total


__all__ = [
    "live", "known", "plans", "Outcome", "decide_for_deduct", "release", "plan_event_for_key",
    "precheck_mode", "billing_mode_for", "refund_allocation", "restore_batch_allowance", "stats",
]
