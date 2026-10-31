"""Structured LLM calls for the Lead Agent.

`ask(system, user, OutputModel, purpose=...)` sends one JSON-mode chat through the
platform router (llm_router.chat_with_chain via use_case_chat.chat_json): the model
from the platform setting `lead_agent.model` (default z-ai/glm-5.3-flash) first,
then the 'lead_agent' use-case chain (GLM default, non-GLM tail). The reply is
validated into the pydantic model; an invalid reply gets ONE repair request (the
validation error and the reply are sent back), like the engine's
AIService.structured. A second failure raises engine.errors.InvalidOutput, which
the engine's discovery and contact lookup already know how to skip.

Money:
  * The agent's own work is NOT charged per token: the customer pays per delivered
    lead (billing.py). What a call costs us is added to lead_candidate.cost_usd and
    lead_agent_day.cost_usd (margin per lead).
  * Metering: the platform does not require every LLM call to be charged, but
    unbilled spend should be visible. Each such call is written as a RECORD-ONLY usage
    row (usage_record_only.record_usage_only: request_type 'agent', use case
    'lead_agent', credits never deducted, behind the existing platform switch
    billing.record_unbilled_usage) - the same path the KB embeddings and the
    learner-profile poller use for system work nobody is billed for per call.
  * A call a staff member asks for (CallContext.charge, e.g. "Suggest with AI") is
    no lead, so it is charged like any other AI feature: by tokens, request_type
    'agent', from the institute's credits (ai_billing.record_llm_billing).
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
from dataclasses import dataclass
from datetime import date
from typing import Any, Dict, Optional, Tuple, Type, TypeVar

from pydantic import BaseModel, ValidationError

from . import db as ladb
from . import flags, store

try:
    from .engine.errors import InvalidOutput
except Exception:  # noqa: BLE001 - engine not importable (yet)
    class InvalidOutput(Exception):  # type: ignore[no-redef]
        pass

logger = logging.getLogger(__name__)

USE_CASE = "lead_agent"
# GLM 5.3 Flash cannot turn reasoning off, and its reasoning counts as output: at the default
# effort a 25-result signal batch spent ~1,800 of ~2,000 output tokens reasoning (probe
# 2026-10-26), so bigger batches ran past 3,000 and the JSON was cut off. "low" kept the reply
# valid at about half the time; the cap is generous because only used tokens are billed.
REASONING_EFFORT = "low"
DEFAULT_MAX_TOKENS = 6000
TIMEOUT_S = 90.0

M = TypeVar("M", bound=BaseModel)


class LLMUnavailable(Exception):
    """Every model in the chain failed (outage, keys, credit): retry later."""


@dataclass
class CallContext:
    """Who a call is for: cost lands on this candidate / agent day. charge: a staff
    member (user_id) asked for it, so the institute pays its tokens in credits."""
    institute_id: Optional[str] = None
    agent_id: Optional[str] = None
    day: Optional[date] = None
    candidate_id: Optional[str] = None
    user_id: Optional[str] = None
    charge: bool = False


# ----------------------------------------------------------------------
# price of a call
# ----------------------------------------------------------------------
_price_cache: Dict[str, Tuple[float, Optional[Tuple[float, float]]]] = {}


def _registry_price(model: str) -> Optional[Tuple[float, float]]:
    """(input, output) USD per token from ai_models; cached 5 minutes."""
    now = time.monotonic()
    hit = _price_cache.get(model)
    if hit and now - hit[0] < 300:
        return hit[1]
    price = None
    try:
        from sqlalchemy import text
        with ladb.session() as db:
            row = db.execute(text(
                "SELECT input_price_per_1m, output_price_per_1m FROM ai_models WHERE model_id = :m "
                "ORDER BY is_active DESC LIMIT 1"), {"m": model}).first()
        if row is not None and row[0] is not None and row[1] is not None:
            price = (float(row[0]) / 1e6, float(row[1]) / 1e6)
    except Exception:  # noqa: BLE001 - unpriced, never a guess
        price = None
    _price_cache[model] = (now, price)
    return price


def call_cost_usd(model: str, usage: Dict[str, Any]) -> float:
    """The gateway's reported cost when it sent one, else tokens x registry price."""
    try:
        if usage.get("cost") is not None:
            return float(usage["cost"])
    except (TypeError, ValueError):
        pass
    price = _registry_price(model)
    if not price:
        return 0.0
    return (float(usage.get("prompt_tokens") or 0) * price[0]
            + float(usage.get("completion_tokens") or 0) * price[1])


def _account(ctx: Optional[CallContext], model: str, usage: Dict[str, Any], purpose: str) -> float:
    """Cost onto the candidate + day, and a usage row: charged in credits when
    ctx.charge, else record-only. Never raises."""
    usd = call_cost_usd(model, usage or {})
    if ctx is not None:
        try:
            with ladb.session() as db:
                if ctx.candidate_id:
                    store.add_cost(db, ctx.candidate_id, usd)
                if ctx.agent_id and ctx.day:
                    store.bump_day(db, ctx.agent_id, ctx.day, cost_usd=round(usd, 6))
        except Exception:  # noqa: BLE001
            logger.warning("lead agent: could not add LLM cost", exc_info=True)
    try:
        from ...models.ai_token_usage import RequestType
        from ..ai_billing import provider_for_model
        from ..usage_record_only import record_usage_only

        if ctx is not None and ctx.charge:
            from ..ai_billing import metering_user, record_llm_billing

            prompt, completion = int((usage or {}).get("prompt_tokens") or 0), int(
                (usage or {}).get("completion_tokens") or 0)
            record_llm_billing(
                request_type=RequestType.AGENT, model=model, prompt_tokens=prompt, completion_tokens=completion,
                total_tokens=int((usage or {}).get("total_tokens") or prompt + completion),
                institute_id=ctx.institute_id, user_id=ctx.user_id,
                metadata={"feature": "lead_agent", "purpose": purpose, "cost_usd": round(usd, 6)},
                use_case=USE_CASE, metering=metering_user(ctx.user_id, surface="ADMIN_APP"),
                usage_context={"feature": "lead_agent", "purpose": purpose},
            )
            return usd
        record_usage_only(
            api_provider=provider_for_model(model), request_type=RequestType.AGENT, model=model,
            prompt_tokens=int((usage or {}).get("prompt_tokens") or 0),
            completion_tokens=int((usage or {}).get("completion_tokens") or 0),
            institute_id=ctx.institute_id if ctx else None,
            request_id=(ctx.candidate_id or ctx.agent_id) if ctx else None,
            metadata={"feature": "lead_agent", "purpose": purpose, "cost_usd": round(usd, 6),
                      "candidate_id": ctx.candidate_id if ctx else None},
            use_case=USE_CASE,
        )
    except Exception:  # noqa: BLE001
        logger.debug("lead agent: record-only usage skipped", exc_info=True)
    return usd


# ----------------------------------------------------------------------
# the call
# ----------------------------------------------------------------------
def schema_instruction(output: Type[BaseModel]) -> str:
    schema = json.dumps(output.model_json_schema(), separators=(",", ":"))
    return ("\n\nReply with ONE JSON object only (no prose, no code fences) that matches this JSON schema:\n"
            + schema)


SALVAGE_FIXES = 20


def _parse(output: Type[M], content: str) -> M:
    from ...utils.json_extract import extract_and_sanitize_json

    raw = extract_and_sanitize_json(content) or content
    try:
        return output.model_validate_json(raw) if isinstance(raw, str) else output.model_validate(raw)
    except ValidationError as exc:
        try:
            data = json.loads(raw) if isinstance(raw, str) else raw
        except ValueError:
            # Invalid JSON, mostly an unescaped quote copied from a page ("the "best" institute"):
            # json-repair escapes it. Claims are still checked against the pages afterwards.
            import json_repair

            data = json_repair.loads(raw)
            if not isinstance(data, dict):
                raise exc from None
        return _salvage(output, data, exc)


def _salvage(output: Type[M], data: Any, first: ValidationError) -> M:
    """A reply that is valid JSON but off the schema in small ways (GLM Flash, 2026-10-26: an extra
    "cite2" key, a null text, one signal with a key outside the list) loses only what does not fit:
    the extra key is dropped, a null text becomes "", and otherwise the list item holding the error
    is dropped. Raises the first error when that does not make the reply valid."""
    for _ in range(SALVAGE_FIXES):
        try:
            return output.model_validate(data)
        except ValidationError as exc:
            if not _fix(data, exc.errors()[0]):
                raise first from None
    raise first


def _fix(data: Any, error: dict) -> bool:
    loc, kind = list(error.get("loc") or ()), error.get("type")
    if not loc:
        return False

    def at(path):
        node = data
        for part in path:
            node = node[part]
        return node

    try:
        parent = at(loc[:-1])
        if kind == "extra_forbidden" and isinstance(parent, dict):
            del parent[loc[-1]]
            return True
        if kind == "string_type" and error.get("input") is None and isinstance(parent, dict):
            parent[loc[-1]] = ""
            return True
        for i in range(len(loc) - 1, -1, -1):
            if isinstance(loc[i], int):
                holder = at(loc[:i])
                if isinstance(holder, list):
                    del holder[loc[i]]
                    return True
    except (KeyError, IndexError, TypeError):
        return False
    return False


def _ran_out(usage: Optional[dict], max_tokens: int) -> bool:
    return int((usage or {}).get("completion_tokens") or 0) >= max_tokens * 0.95


async def _chat(messages: list, max_tokens: int, purpose: str):
    from ..use_case_chat import chat_json, models_for

    models = await asyncio.to_thread(models_for, USE_CASE, explicit=flags.model())
    result = await chat_json(
        {"messages": messages, "max_tokens": max_tokens, "temperature": 0.1},
        use_case=USE_CASE, models=models, api_key=None, timeout=TIMEOUT_S, label=f"lead_agent.{purpose}",
        reasoning_effort=REASONING_EFFORT,
    )
    if result is None:
        raise LLMUnavailable(f"every model failed for {purpose}")
    return result


async def ask(system: str, user: str, output: Type[M], *, purpose: str, ctx: Optional[CallContext] = None,
              max_tokens: int = DEFAULT_MAX_TOKENS) -> M:
    """One structured reply. Raises InvalidOutput (unusable after one repair)
    or LLMUnavailable (no model answered)."""
    messages = [{"role": "system", "content": system + schema_instruction(output)},
                {"role": "user", "content": user}]
    result = await _chat(messages, max_tokens, purpose)
    await asyncio.to_thread(_account, ctx, result.model, result.usage, purpose)
    try:
        return _parse(output, result.content)
    except (ValidationError, ValueError) as exc:
        first_error = str(exc)[:2000]
    if _ran_out(result.usage, max_tokens):
        # A reply cut off at the token cap is usually one that ran on (GLM Flash repeats a key until the
        # cap): asking it to repair that text repeats it, so ask afresh instead.
        result = await _chat(messages, max_tokens, purpose + ".retry")
        await asyncio.to_thread(_account, ctx, result.model, result.usage, purpose + ".retry")
        try:
            return _parse(output, result.content)
        except (ValidationError, ValueError) as exc:
            raise InvalidOutput(f"{purpose}: reply unusable twice ({str(exc)[:300]})") from None
    repair = messages + [
        {"role": "assistant", "content": result.content[:20000]},
        {"role": "user", "content": ("That reply does not match the schema. Errors:\n" + first_error
                                     + "\nReply again with the corrected JSON object only.")},
    ]
    result = await _chat(repair, max_tokens, purpose + ".repair")
    await asyncio.to_thread(_account, ctx, result.model, result.usage, purpose + ".repair")
    try:
        return _parse(output, result.content)
    except (ValidationError, ValueError) as exc:
        raise InvalidOutput(f"{purpose}: reply unusable after a repair ({str(exc)[:300]})") from None


__all__ = ["USE_CASE", "CallContext", "LLMUnavailable", "InvalidOutput", "ask", "call_cost_usd",
           "schema_instruction"]
