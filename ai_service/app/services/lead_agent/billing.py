"""Credits for the Lead Agent: one fixed-price charge per lead DELIVERED into a
lead list (rejected / skipped leads are free).

Tool keys (ai_tool_pricing, seeded by admin_core V612, mirrored in
tool_cost_estimator.DEFAULT_TOOL_PRICING): `lead_agent_lead_local` when any page
used for the lead was read by the institute's Chrome extension, else
`lead_agent_lead_remote`. Both are unit_field 'flat', fixed_price, request_type
'agent': one call = one lead.

Idempotency: key `lead_agent:{candidate_id}`. credit_transactions.external_reference_id
is unique across the whole ledger (V243), which is why course_knowledge puts the
institute id in its keys (its slide ids can repeat across institutes); a
candidate id is a random UUID that exists once in lead_candidate, so this key
cannot collide with another institute's and the spec's form is kept. A key
already in the ledger makes no second billing call; the charged credits are read
back from the ledger into lead_candidate.credits_charged.

Before a day's discovery the agent is skipped when the wallet cannot cover the
rest of today's quota at the agent's price, or when its monthly credit cap is
reached (delivery stops at the cap too).
"""
from __future__ import annotations

import logging
from decimal import Decimal
from typing import Any, Dict, Optional, Tuple

from . import db as ladb
from . import pacing, store

logger = logging.getLogger(__name__)

TOOL_LOCAL = "lead_agent_lead_local"
TOOL_REMOTE = "lead_agent_lead_remote"
USE_CASE = "lead_agent"


def idempotency_key(candidate_id: str) -> str:
    return f"lead_agent:{candidate_id}"


def tool_key_for(lead_json: Optional[dict], agent_mode: Optional[str] = None) -> str:
    """Local price when the agent reads only through the extension (LOCAL), or when
    the extension read any page for THIS candidate; else remote. Pages reused from
    the shared server cache do not make a lead local or remote by themselves."""
    fetch = (lead_json or {}).get("fetch") or {}
    if (agent_mode or fetch.get("agent_mode")) == "LOCAL" or int(fetch.get("extension_pages") or 0) > 0:
        return TOOL_LOCAL
    return TOOL_REMOTE


def tool_key_for_mode(mode: str) -> str:
    """The price to plan with: LOCAL agents pay the local price; REMOTE and AUTO the
    remote one (the upper bound)."""
    return TOOL_LOCAL if mode == "LOCAL" else TOOL_REMOTE


def price(db, institute_id: str, tool_key: str) -> Decimal:
    """Credits one delivered lead costs this institute (its override, else the global row)."""
    from ..tool_cost_estimator import ToolCostEstimator

    est = ToolCostEstimator(db).estimate(tool_key, {}, institute_id=institute_id)
    return Decimal(str(est.get("estimated_credits") or 0))


def _read_back(key: str) -> Tuple[bool, Decimal]:
    from ..course_knowledge.billing import ledger_charge

    try:
        with ladb.session() as db:
            return ledger_charge(db, key)
    except Exception:  # noqa: BLE001
        logger.warning("lead agent: could not read the ledger for %s", key, exc_info=True)
        return False, Decimal("0")


def charge(cand: Dict[str, Any], agent: Dict[str, Any]) -> Optional[Decimal]:
    """Charge one delivered lead (once per candidate) and store the credits on
    the candidate and the day. None when the charge is not in the ledger yet
    (the next delivery tick retries with the same key). Blocking."""
    from ...models.ai_token_usage import RequestType
    from ..ai_billing import metering_system, record_tool_billing

    if cand.get("charged_at") is not None:  # settled already (maybe free): never again
        return Decimal(str(cand.get("credits_charged") or 0))
    key = idempotency_key(cand["id"])
    recorded, credits = _read_back(key)
    if not recorded:
        tool_key = tool_key_for(cand.get("lead_json"), agent.get("mode"))
        record_tool_billing(
            tool_key=tool_key, tool_params={}, request_type=RequestType.AGENT, model="lead-agent",
            institute_id=cand["institute_id"], user_id=None, user_role=None, request_id=cand["id"],
            idempotency_key=key, provider_cost_usd=float(cand.get("cost_usd") or 0) or None,
            use_case=USE_CASE, metering=metering_system(surface="SCHEDULED"),
            usage_context={"feature": "lead_agent", "agent_id": agent["id"], "candidate_id": cand["id"],
                           "audience_id": agent["audience_id"], "tool_key": tool_key},
        )
        recorded, credits = _read_back(key)
        if not recorded:
            try:
                with ladb.session() as db:
                    if price(db, cand["institute_id"], tool_key) <= 0:
                        recorded, credits = True, Decimal("0")  # a zero price writes no ledger row
            except Exception:  # noqa: BLE001
                pass
        if not recorded:
            logger.warning("lead agent: charge for %s is not in the ledger yet", key)
            return None
    day = pacing.agent_day(agent.get("window_json"))
    with ladb.session() as db:
        if store.set_credits(db, cand["id"], credits):
            store.bump_day(db, agent["id"], day, credits=credits)
    return credits


def affordable(agent: Dict[str, Any], leads: int) -> Tuple[bool, str]:
    """Can the institute pay for `leads` more leads today (wallet, AI plan,
    monthly cap)? (ok, reason)."""
    if leads <= 0:
        return True, ""
    from ..ai_billing import metering_system, preflight_tool_credits

    tool_key = tool_key_for_mode(agent.get("mode") or "AUTO")
    try:
        with ladb.session() as db:
            each = price(db, agent["institute_id"], tool_key)
            cap = agent.get("monthly_credit_cap")
            if cap is not None:
                spent = store.month_credits(db, agent["id"], pacing.month_start_utc(agent.get("window_json")))
                if spent + each > Decimal(str(cap)):
                    return False, f"Monthly credit cap reached ({spent} of {cap})"
            if each <= 0:
                return True, ""
            pre = preflight_tool_credits(db, tool_key=tool_key, tool_params={}, institute_id=agent["institute_id"],
                                         metering=metering_system(surface="SCHEDULED"), use_case=USE_CASE,
                                         enforce_limits=False)
    except Exception as exc:  # noqa: BLE001 - cannot tell: do not spend
        logger.warning("lead agent: credit check failed for agent %s: %s", agent.get("id"), exc)
        return False, "Credit check failed"
    if pre.get("plan_covered"):
        return True, ""
    balance = pre.get("current_balance")
    if balance is None:
        return True, ""  # no wallet row: the house rule is "unknown balance = allow" (post-paid charge)
    need = each * leads
    if Decimal(str(balance)) < need:
        return False, f"Not enough credits for today's quota ({balance} < {need})"
    return True, ""


def cap_room(agent: Dict[str, Any]) -> Optional[int]:
    """How many more leads the monthly credit cap allows at the agent's price
    (None = no cap). floor((cap - spent this month) / price)."""
    cap = agent.get("monthly_credit_cap")
    if cap is None:
        return None
    with ladb.session() as db:
        spent = store.month_credits(db, agent["id"], pacing.month_start_utc(agent.get("window_json")))
        each = price(db, agent["institute_id"], tool_key_for_mode(agent.get("mode") or "AUTO"))
    left = Decimal(str(cap)) - spent
    if left <= 0:
        return 0
    if each <= 0:
        return None
    return int(left // each)


def cap_reached(agent: Dict[str, Any]) -> bool:
    cap = agent.get("monthly_credit_cap")
    if cap is None:
        return False
    with ladb.session() as db:
        spent = store.month_credits(db, agent["id"], pacing.month_start_utc(agent.get("window_json")))
    return spent >= Decimal(str(cap))


__all__ = ["TOOL_LOCAL", "TOOL_REMOTE", "idempotency_key", "tool_key_for", "charge", "affordable", "cap_reached",
           "cap_room",
           "price"]
