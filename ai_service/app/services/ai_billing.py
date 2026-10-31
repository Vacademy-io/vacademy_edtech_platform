"""Shared token-usage logging + credit deduction for migrated AI features.

Wraps TokenUsageService.record_usage_and_deduct_credits on a fresh DB session so
it works equally from sync request handlers and background workers. Best-effort:
a billing failure never propagates — the generation has already happened.
"""
from __future__ import annotations

import logging
from decimal import Decimal
from typing import Any, Optional

from sqlalchemy.orm import Session

from ..db import db_session
from ..models.ai_token_usage import ApiProvider, RequestType
from .token_usage_service import TokenUsageService

logger = logging.getLogger(__name__)


def provider_for_model(model: str) -> ApiProvider:
    """OpenRouter exposes both; attribute by model family (matches the
    convention in content_generation_service / course_outline_service)."""
    return ApiProvider.GEMINI if "gemini" in (model or "").lower() else ApiProvider.OPENAI


# ============================================================================
# Usage metering attribution (write-only pass-through)
#
# Callers say WHAT the spend was for (`use_case`, an ai_use_case_catalog key)
# and WHO did it (`metering`: a services.metering MeteringContext, or a plain
# dict of the same fields). These ride on the CreditDeductRequest as optional
# fields and only feed ai_usage_event. They NEVER change what is charged or
# what the ledger row holds: the legacy user_id / user_role / subject_user_id
# columns keep exactly the values the caller passed before this existed.
#
# Every helper here is fail-soft: a missing metering package, a bad context or
# a TokenUsageService that does not (yet) accept the fields all degrade to
# "no attribution", never to a failed or changed charge.
# ============================================================================

class UC:
    """ai_use_case_catalog keys used by ai_service callers (seeded by the
    V586 metering migration). One place, so a renamed key is a one-line fix."""
    LEARNER_ASSISTANT = "learner_assistant"
    VACADEMY_ASSISTANT = "vacademy_assistant"
    TUTOR_LIVE = "tutor_live"
    TUTOR_CHAT = "tutor_chat"
    TUTOR_SETUP = "tutor_setup"
    KB_COMPANION = "kb_companion"
    KB_QUESTION_PAPER = "kb_question_paper"
    TRANSLATION = "translation"
    CONTENT = "content"
    CONTENT_IMAGE = "content_image"
    COURSE_OUTLINE = "course_outline"
    COURSE_ASSIST = "course_assist"
    COURSE_ASSIST_IMAGE = "course_assist_image"
    HTML_DOCUMENT = "html_document"
    DOCUMENT_IMAGE = "document_image"
    PAGE_BUILDER = "page_builder"
    PAGE_BUILDER_IMAGE = "page_builder_image"
    EVALUATION = "evaluation"
    QUIZ_IMAGE = "quiz_image"
    KNOWLEDGE_BASE = "knowledge_base"
    LESSON_VIDEO = "lesson_video"
    AVATAR_VIDEO = "avatar_video"
    STOCK_MEDIA = "stock_media"
    TTS = "tts"
    TRANSCRIPTION = "transcription"
    CALL_INTELLIGENCE = "call_intelligence"
    COURSE_KNOWLEDGE = "course_knowledge"   # V600 (course_kb_ocr_page, course_kb_transcribe_minute)


# The optional CreditDeductRequest metering fields (contract K2), minus
# subject_user_id: that one is also a legacy ledger column, so it only ever
# travels through the callers' own subject_user_id argument.
METERING_FIELD_NAMES = frozenset({
    "use_case", "actor_kind", "actor_user_id", "role_source",
    "actor_role_class", "actor_roles_raw", "actor_display_name",
    "subject_display_name", "surface", "source_service", "usage_context",
    "router", "provider", "gateway_key_id", "byo_key", "parent_event_id", "usage_event_id",
    "tool_key",
    # record_usage only (record-only events): why it was free.
    "free_reason",
})
# Legacy ledger columns a metering context must never overwrite.
_LEDGER_OWNED = ("user_id", "user_role", "subject_user_id")
_CTX_MAX_STR = 200
# ai_usage_event column widths: clip so a long value can never fail validation.
_FIELD_WIDTH = {"use_case": 64, "actor_kind": 16, "actor_role_class": 16, "role_source": 16,
                "surface": 24, "source_service": 24,
                "router": 32, "provider": 32, "gateway_key_id": 64, "actor_display_name": 255,
                "subject_display_name": 255, "parent_event_id": 64, "usage_event_id": 64,
                "tool_key": 64, "free_reason": 24}


def _metering_cls():
    try:
        from .metering.context import MeteringContext
        return MeteringContext
    except Exception:  # noqa: BLE001 - package absent/broken => attribution off
        return None


def metering_from_request(request: Any, institute_id: Optional[str], *, user: Any = None,
                          auth_mode: Optional[str] = None) -> Any:
    """MeteringContext.from_request, or None. Never raises. `auth_mode`: the
    mode a verified API-key / internal-token dependency returned."""
    cls = _metering_cls()
    if cls is None or request is None:
        return None
    try:
        if auth_mode:
            return cls.from_request(request, institute_id, user=user, auth_mode=auth_mode)
        return cls.from_request(request, institute_id, user=user)
    except Exception as exc:  # noqa: BLE001
        logger.debug("metering_from_request failed: %s", exc)
        return None


def metering_system(*, subject_user_id: Optional[str] = None, subject_display_name: Optional[str] = None,
                    surface: str = "SCHEDULED") -> Any:
    """MeteringContext.system(...), or None. Never raises."""
    cls = _metering_cls()
    if cls is None:
        return None
    try:
        return cls.system(subject_user_id=subject_user_id, subject_display_name=subject_display_name,
                          surface=surface)
    except Exception as exc:  # noqa: BLE001
        logger.debug("metering_system failed: %s", exc)
        return None


def metering_api_key(key_id: Optional[str]) -> Any:
    """MeteringContext.api_key(key_id), or None. Never raises."""
    cls = _metering_cls()
    if cls is None:
        return None
    try:
        return cls.api_key(key_id)
    except Exception as exc:  # noqa: BLE001
        logger.debug("metering_api_key failed: %s", exc)
        return None


def metering_unverified(claimed_user_id: Optional[str], *, surface: str = "UNKNOWN") -> dict:
    """Attribution for a route that cannot verify who is acting (the user id
    comes from the body or query string). The id is kept only as
    usage_context.claimed_user_id: it never becomes the event actor, so it
    feeds neither the per-user History scope nor the nightly role lookup."""
    out: dict = {"actor_kind": "UNKNOWN", "role_source": "UNRESOLVED", "surface": surface}
    if claimed_user_id:
        out["usage_context"] = {"claimed_user_id": str(claimed_user_id)[:255]}
    return out


def metering_user(user_id: Optional[str], *, surface: str = "UNKNOWN", display_name: Optional[str] = None,
                  roles_raw: Optional[list] = None, role_class: Optional[str] = None) -> Any:
    """A USER context for code that has the caller's id but no request (SSE
    streams, background workers). Roles stay UNRESOLVED unless the caller
    already verified them; the nightly admin_core job fills them in."""
    kw: dict = {"actor_kind": "USER" if user_id else "UNKNOWN", "actor_user_id": user_id,
                "surface": surface, "actor_display_name": display_name}
    if roles_raw:
        kw["actor_roles_raw"] = sorted({str(r) for r in roles_raw if r})
    if role_class:
        kw["actor_role_class"] = role_class
    elif roles_raw:
        try:
            from .metering.context import resolve_role_class
            kw["actor_role_class"] = resolve_role_class(kw["actor_roles_raw"])
        except Exception:  # noqa: BLE001
            pass
    if kw.get("actor_role_class"):
        kw["role_source"] = "JWT"
    cls = _metering_cls()
    if cls is not None:
        try:
            return cls(**{k: v for k, v in kw.items() if v is not None})
        except Exception as exc:  # noqa: BLE001
            logger.debug("metering_user failed: %s", exc)
    # No (compatible) MeteringContext: the same fields as a plain dict.
    return {k: v for k, v in kw.items() if v is not None and k in METERING_FIELD_NAMES}


def _clean_context(ctx: Optional[dict]) -> Optional[dict]:
    """Small, JSON-safe usage_context: scalar values only, strings capped."""
    if not isinstance(ctx, dict):
        return None
    out: dict = {}
    for k, v in ctx.items():
        if v is None or v == "":
            continue
        if isinstance(v, bool) or isinstance(v, (int, float)):
            out[str(k)[:64]] = v
        else:
            out[str(k)[:64]] = str(v)[:_CTX_MAX_STR]
    return out or None


def metering_kwargs(use_case: Optional[str] = None, metering: Any = None,
                    usage_context: Optional[dict] = None, *, keep_subject: bool = False, **extra: Any) -> dict:
    """The metering fields to splat into a deduct/record call.

    `metering` is a MeteringContext (its as_fields()) or a dict. The legacy
    ledger columns (user_id, user_role, subject_user_id) are dropped: they keep
    the caller's own values so ledger rows stay byte-identical; a context's
    subject is kept for the event only as subject_display_name / usage_context.
    keep_subject=True (record-only calls, which write no ledger row) passes
    subject_user_id through as well. Never raises; returns {} on any problem."""
    try:
        fields: dict = {}
        if metering is not None:
            raw = metering.as_fields() if hasattr(metering, "as_fields") else metering
            if isinstance(raw, dict):
                fields.update(raw)
        subject = fields.get("subject_user_id")
        for k in _LEDGER_OWNED:
            fields.pop(k, None)
        for k, v in extra.items():
            if v is not None:
                fields[k] = v
        if use_case:
            fields["use_case"] = use_case
        ctx = dict(fields.get("usage_context") or {})
        if usage_context:
            ctx.update(usage_context)
        if subject and not keep_subject and "subject_user_id" not in ctx:
            ctx["subject_user_id"] = subject
        ctx = _clean_context(ctx)
        if ctx:
            fields["usage_context"] = ctx
        else:
            fields.pop("usage_context", None)
        out: dict = {}
        for k, v in fields.items():
            if k not in METERING_FIELD_NAMES or v is None:
                continue
            if k == "actor_roles_raw":
                v = [str(r)[:64] for r in (v if isinstance(v, (list, tuple, set)) else [v]) if r][:32]
            elif k == "byo_key":
                v = bool(v)
            elif k == "usage_context":
                if not isinstance(v, dict):
                    continue
            else:
                v = str(v)[:_FIELD_WIDTH.get(k, 255)]
            out[k] = v
        if keep_subject and subject:
            out["subject_user_id"] = str(subject)[:255]
        return out
    except Exception as exc:  # noqa: BLE001
        logger.debug("metering_kwargs failed: %s", exc)
        return {}


def build_deduct_request(meter: Optional[dict] = None, **fields: Any):
    """CreditDeductRequest(**fields, **meter), falling back to the request
    WITHOUT the metering fields if they do not validate, so attribution can
    never cost a charge."""
    from ..schemas.credits import CreditDeductRequest
    if meter:
        try:
            return CreditDeductRequest(**fields, **meter)
        except Exception as exc:  # noqa: BLE001
            logger.warning("Metering fields rejected, deducting without them: %s", exc)
    return CreditDeductRequest(**fields)


import weakref

# fn -> True (takes **kwargs) | frozenset of parameter names. Weak keys: an
# id()-keyed cache could hand a stale answer to a new function reusing an id.
_SIG_CACHE: "weakref.WeakKeyDictionary" = weakref.WeakKeyDictionary()


def supported_kwargs(fn: Any, kwargs: dict) -> dict:
    """The subset of `kwargs` that `fn` accepts by name (all of them if it
    takes **kwargs). Keeps a caller from breaking a TokenUsageService (or a
    test double) that predates the metering fields."""
    if not kwargs:
        return {}
    try:
        import inspect
        target = getattr(fn, "__func__", fn)
        try:
            spec = _SIG_CACHE.get(target)
        except TypeError:  # not weak-referenceable: no caching
            spec = None
        if spec is None:
            params = inspect.signature(fn).parameters.values()
            if any(p.kind is inspect.Parameter.VAR_KEYWORD for p in params):
                spec = True
            else:
                spec = frozenset(p.name for p in params)
            try:
                _SIG_CACHE[target] = spec
            except TypeError:
                pass
        if spec is True:
            return dict(kwargs)
        return {k: v for k, v in kwargs.items() if k in spec}
    except Exception:  # noqa: BLE001
        return {}


def record_llm_billing(
    *,
    request_type: RequestType,
    model: str,
    prompt_tokens: int,
    completion_tokens: int,
    total_tokens: int,
    institute_id: Optional[str] = None,
    user_id: Optional[str] = None,
    request_id: Optional[str] = None,
    metadata: Optional[dict] = None,
    use_case: Optional[str] = None,
    metering: Any = None,
    usage_context: Optional[dict] = None,
) -> None:
    """Log usage + deduct institute credits. Swallows all errors.

    use_case / metering / usage_context: optional usage-event attribution
    (see metering_kwargs); they never change the charge or the ledger row."""
    try:
        with db_session() as db:
            tus = TokenUsageService(db)
            tus.record_usage_and_deduct_credits(
                api_provider=provider_for_model(model),
                prompt_tokens=prompt_tokens,
                completion_tokens=completion_tokens,
                total_tokens=total_tokens,
                request_type=request_type,
                institute_id=institute_id,
                user_id=user_id,
                model=model,
                request_id=request_id,
                metadata=metadata,
                **supported_kwargs(tus.record_usage_and_deduct_credits,
                                   metering_kwargs(use_case, metering, usage_context)),
            )
    except Exception as exc:  # noqa: BLE001
        logger.warning("LLM billing failed (request_type=%s, request_id=%s): %s", request_type, request_id, exc)


# ============================================================================
# Academy-credits parametric tool billing (Phase 2)
#
# Charge for a metered AI tool = max(parametric_estimate, actual_token_cost):
#   - parametric: predictable, what the admin previewed (ToolCostEstimator)
#   - actual: real token cost via CreditService.calculate_credits (overage only)
# The user is never charged below the previewed number; huge inputs add overage.
#
# Fixed-price rows (params.fixed_price / no_token_overage, always the partner
# API key copy_check_evaluation_api) charge exactly the parametric quote. The
# parametric part is priced at the institute's rate (override → global →
# default, spec 10.3), or at `rate_snapshot` when the caller quoted one at
# enqueue.
# ============================================================================

def _charge_description(rt_str: str, model: str, tool_key: str, rate_source: Optional[str]) -> str:
    """credit_transactions.description: the old "<request_type> using <model>"
    plus the tool and the price it used, for reconciliation (spec 10.3/10.5)."""
    desc = f"{rt_str} using {model} [{tool_key}; rate {rate_source or 'default'}]"
    return desc[:500]


def charge_tool(
    db: Session,
    *,
    tool_key: str,
    tool_params: dict,
    request_type: RequestType,
    model: str,
    prompt_tokens: int = 0,
    completion_tokens: int = 0,
    institute_id: Optional[str] = None,
    user_id: Optional[str] = None,
    user_role: Optional[str] = None,
    subject_user_id: Optional[str] = None,
    request_id: Optional[str] = None,
    idempotency_key: Optional[str] = None,
    usage_markup: Decimal = Decimal("1"),
    provider_cost_usd: Optional[float] = None,
    seconds: Optional[int] = None,
    character_count: Optional[int] = None,
    rate_snapshot: Optional[dict] = None,
    use_case: Optional[str] = None,
    metering: Any = None,
    usage_context: Optional[dict] = None,
) -> Decimal:
    """Deduct max(parametric, actual × usage_markup) for a metered tool, or
    exactly the parametric quote when the resolved row is fixed-price.

    The parametric part is priced for `institute_id` (its override, else the
    global rate) unless `rate_snapshot` - the rate quoted at enqueue - is given
    for this tool_key, which then wins (spec 10.3).

    `provider_cost_usd` is what the vendor charged us for this call (voice,
    speech-to-text, OCR, image); it lands in ai_token_usage.total_price so
    margins can be read from our own rows.

    usage_markup (default 1×) marks up ONLY the actual token cost — used to
    make heavy-usage tools (e.g. HTML document generation with big PDFs / large
    pages) charge above raw cost. The parametric floor is unchanged.

    use_case / metering / usage_context: optional usage-event attribution
    (metering_kwargs); they never change the charge or the ledger row.

    Records an ai_token_usage row + a credit_transactions deduction. Returns the
    amount charged. Raises on hard DB errors (callers wrap as best-effort).
    """
    from .credit_service import CreditService
    from .tool_cost_estimator import ToolCostEstimator

    rt_str = request_type.value if hasattr(request_type, "value") else str(request_type)

    actual = Decimal("0")
    if prompt_tokens or completion_tokens:
        actual = CreditService(db).calculate_credits(
            request_type=rt_str,
            model=model,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
        ) * usage_markup

    estimate = ToolCostEstimator(db).estimate(
        tool_key, tool_params, institute_id=institute_id, rate_snapshot=rate_snapshot,
    )
    parametric = Decimal(str(estimate["estimated_credits"]))
    fixed_price = bool(estimate.get("fixed_price"))
    charge = parametric if fixed_price else max(parametric, actual)
    description = _charge_description(rt_str, model, tool_key, estimate.get("rate_source"))

    meter = (metering_kwargs(use_case, metering, usage_context, tool_key=tool_key)
             if (use_case or metering is not None or usage_context) else {})
    tus = TokenUsageService(db)
    if fixed_price and charge <= 0:
        # Nothing to charge at a fixed price (e.g. zero pages). Record the
        # usage only: a zero precomputed amount would make deduct_credits fall
        # back to the token price, which a fixed price must never charge.
        tus.record_usage(
            api_provider=provider_for_model(model),
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            total_tokens=prompt_tokens + completion_tokens,
            request_type=request_type,
            institute_id=institute_id,
            user_id=user_id,
            model=model,
            request_id=request_id,
            total_price=provider_cost_usd,
            character_count=character_count,
            **supported_kwargs(tus.record_usage, meter),
        )
        return Decimal("0")

    tus.record_usage_and_deduct_credits(
        api_provider=provider_for_model(model),
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        total_tokens=prompt_tokens + completion_tokens,
        request_type=request_type,
        institute_id=institute_id,
        user_id=user_id,
        model=model,
        request_id=request_id,
        precomputed_credits=charge,
        idempotency_key=idempotency_key,
        user_role=user_role,
        subject_user_id=subject_user_id,
        total_price=provider_cost_usd,
        seconds=seconds,
        character_count=character_count,
        # Post-paid: the work was already delivered, so never silently drop the
        # charge if a concurrent spend slipped the balance below the estimate.
        allow_negative=True,
        description=description,
        **supported_kwargs(tus.record_usage_and_deduct_credits, meter),
    )
    return charge


def record_tool_billing(
    *,
    tool_key: str,
    tool_params: dict,
    request_type: RequestType,
    model: str,
    prompt_tokens: int = 0,
    completion_tokens: int = 0,
    institute_id: Optional[str] = None,
    user_id: Optional[str] = None,
    user_role: Optional[str] = None,
    subject_user_id: Optional[str] = None,
    request_id: Optional[str] = None,
    idempotency_key: Optional[str] = None,
    usage_markup: Decimal = Decimal("1"),
    provider_cost_usd: Optional[float] = None,
    seconds: Optional[int] = None,
    character_count: Optional[int] = None,
    rate_snapshot: Optional[dict] = None,
    use_case: Optional[str] = None,
    metering: Any = None,
    usage_context: Optional[dict] = None,
) -> None:
    """Best-effort tool charge on a fresh session. Swallows all errors — the
    work has already happened, so a billing failure must not fail the response.
    (Copy-check charges keyed on a process id are re-checked by the nightly
    billing reconciliation, services/copy_check/billing_reconciliation.py.)"""
    if not institute_id:
        return
    try:
        with db_session() as db:
            charge_tool(
                db,
                tool_key=tool_key,
                tool_params=tool_params,
                request_type=request_type,
                model=model,
                prompt_tokens=prompt_tokens,
                completion_tokens=completion_tokens,
                institute_id=institute_id,
                user_id=user_id,
                user_role=user_role,
                subject_user_id=subject_user_id,
                request_id=request_id,
                idempotency_key=idempotency_key,
                usage_markup=usage_markup,
                provider_cost_usd=provider_cost_usd,
                seconds=seconds,
                character_count=character_count,
                rate_snapshot=rate_snapshot,
                use_case=use_case,
                metering=metering,
                usage_context=usage_context,
            )
    except Exception as exc:  # noqa: BLE001
        logger.warning("Tool billing failed (tool=%s, request_id=%s): %s", tool_key, request_id, exc)


def _plan_cover_preflight(db: Session, result: dict, *, tool_key: str, institute_id: str, metering: Any,
                          use_case: Optional[str]) -> None:
    """AI plans: a balance-short pre-flight that a LIVE subscription covers in
    full (included within fair use, or the remaining allowance) is allowed:
    `sufficient` becomes True and `plan_covered` names the mode. Read-only;
    never creates a wallet. Nothing (an in-memory lookup) without a live
    subscription; any failure leaves today's result."""
    try:
        from .metering import plan_wiring

        if not plan_wiring.live(institute_id):
            return
        ctx = metering
        if ctx is None:
            from .metering import limit_gate

            ctx = limit_gate.context_from_current_request(institute_id)
        mode = plan_wiring.precheck_mode(db, institute_id=institute_id, use_case=use_case, tool_key=tool_key,
                                         ctx=ctx, estimate=result.get("estimated_credits"))
        if mode:
            result["sufficient"] = True
            result["plan_covered"] = mode
    except Exception as exc:  # noqa: BLE001
        logger.debug("plan pre-flight skipped: %s", exc)


def preflight_tool_credits(
    db: Session,
    *,
    tool_key: str,
    tool_params: dict,
    institute_id: Optional[str],
    metering: Any = None,
    use_case: Optional[str] = None,
    enforce_limits: bool = True,
) -> dict:
    """Estimate the parametric cost + check affordability for a 402 pre-flight.

    Returns the estimate dict (with current_balance/balance_after/sufficient).
    `sufficient` is None when balance is unknown (no institute) — callers should
    treat None as "allow" so a missing balance never hard-blocks.

    Usage limits (contract N4): when the institute has a limits policy and the
    balance check did not fail, the limits engine is asked too; an ENFORCE
    block raises LimitExceeded (HTTP 429 AI_USAGE_LIMIT). `metering` (a
    MeteringContext or fields dict) names the actor; default = the HTTP request
    in scope. `enforce_limits=False` skips the limits engine (display-only
    estimates shown after work was already done; callers that run their own
    limit check). No policy -> exactly today's result, no extra call.
    """
    from .tool_cost_estimator import ToolCostEstimator

    result = ToolCostEstimator(db).estimate_with_balance(tool_key, tool_params, institute_id)
    if result.get("sufficient") is False and institute_id:
        _plan_cover_preflight(db, result, tool_key=tool_key, institute_id=institute_id, metering=metering,
                              use_case=use_case)
    if enforce_limits and institute_id and result.get("sufficient") is not False:
        try:
            from .metering import limit_gate
        except Exception:  # noqa: BLE001
            return result
        if limit_gate.policy_active(institute_id):
            limit_gate.authorize(db, institute_id=institute_id, use_case=use_case, tool_key=tool_key,
                                 ctx=metering, estimate_credits=result.get("estimated_credits"),
                                 reserve=False)
    return result
