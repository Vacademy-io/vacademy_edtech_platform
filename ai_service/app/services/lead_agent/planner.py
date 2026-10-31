"""The agent's search plan: built from its brief by the engine's planning prompt
(one LLM call), finalised by engine.planning.finalise_plan (the brief's choices
win, effort clamped), cached in lead_agent.plan_json with the brief's hash, and
rebuilt when the brief or markets change or the plan is a week old."""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
from datetime import timedelta
from typing import Any, Dict, Optional

from . import db as ladb
from . import engine_api, llm, pacing, store

logger = logging.getLogger(__name__)

PLAN_MAX_AGE = timedelta(days=7)
PLAN_MAX_TOKENS = 6000  # reasoning counts as output (llm.REASONING_EFFORT)


def brief_hash(agent: Dict[str, Any]) -> str:
    raw = json.dumps({"brief": agent.get("brief_json") or {}, "markets": agent.get("markets_json") or [],
                      "quota": agent.get("daily_quota")}, sort_keys=True, default=str)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def guided_request(agent: Dict[str, Any]) -> Dict[str, Any]:
    """The brief in the shape of the engine's guided request (engine.planning.guided_from_brief);
    lead_count = a week of the daily quota, so the plan has enough searches to rotate through."""
    quota = int(agent.get("daily_quota") or 10)
    return engine_api.guided_from_brief(agent.get("brief_json") or {}, agent.get("markets_json") or [],
                                        max(10, min(200, quota * 7)))


def request_text(agent: Dict[str, Any]) -> str:
    return engine_api.request_text_from_brief(agent.get("brief_json") or {})[:4000]


def plan_is_current(agent: Dict[str, Any]) -> bool:
    if not agent.get("plan_json") or agent.get("brief_hash") != brief_hash(agent):
        return False
    built = agent.get("plan_built_at")
    return built is not None and pacing.now_utc() - built < PLAN_MAX_AGE


async def ensure_plan(agent: Dict[str, Any], *, ctx: Optional[llm.CallContext] = None) -> Optional[Dict[str, Any]]:
    """The agent's current plan, built (one LLM call) when missing or stale.
    None when the brief cannot be planned (the reason is saved as last_error)."""
    if plan_is_current(agent):
        return agent["plan_json"]
    guided = guided_request(agent)
    try:
        system, user = engine_api.build_plan_prompt(request_text(agent), 0, guided)
    except engine_api.planning_error() as exc:
        await asyncio.to_thread(_save_error, agent["id"], f"Cannot plan this brief: {exc}")
        return None
    plan = await llm.ask(system, user, engine_api.schema("ResearchPlan"), purpose="plan", ctx=ctx,
                         max_tokens=PLAN_MAX_TOKENS)
    data = engine_api.finalise_plan(plan, guided)
    brief = agent.get("brief_json") or {}
    if brief.get("buyer_roles"):
        data["buyer_roles"] = list(brief["buyer_roles"])
    data["industries_detail"] = engine_api.guided_industries(guided)
    data["places"] = engine_api.search_places(guided)
    data["match_places"] = engine_api.match_places(guided)
    h = brief_hash(agent)
    await asyncio.to_thread(_save_plan, agent["id"], data, h)
    agent.update(plan_json=data, brief_hash=h, plan_built_at=pacing.now_utc())
    return data


def _save_plan(agent_id: str, plan: dict, h: str) -> None:
    with ladb.session() as db:
        store.set_plan(db, agent_id, plan, h)
        store.set_agent_error(db, agent_id, None)


def _save_error(agent_id: str, error: str) -> None:
    with ladb.session() as db:
        store.set_agent_error(db, agent_id, error)


def research_plan(plan: Dict[str, Any], search_queries: Optional[list] = None):
    """engine.schemas.ResearchPlan from the stored plan (only its own fields)."""
    model = engine_api.schema("ResearchPlan")
    fields = {k: plan[k] for k in model.model_fields if k in plan}
    if search_queries is not None:
        fields["search_queries"] = list(search_queries)
    return model.model_validate(fields)


__all__ = ["brief_hash", "guided_request", "request_text", "plan_is_current", "ensure_plan", "research_plan"]
