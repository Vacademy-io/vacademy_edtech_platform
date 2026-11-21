"""Instant AI check of a Spreadsheet & Written Response (`CBE_RESPONSE`) answer
on an LMS question slide (docs/CBE_RESPONSE_QUESTION.md 5.2).

admin_core calls POST /copy-check/v1/grade-cbe-sync when a learner submits and
waits (120 s timeout) for the marks. Same renderer, rubric and prompt as the
assessment (async, TYPED lane) path; this one:

  1. zeroes a blank answer without a model call or a charge;
  2. checks the institute's AI credits BEFORE any model call
     (InsufficientCredits -> HTTP 402);
  3. grades once, retrying once with the platform evaluation model on failure,
     within an overall deadline below admin_core's timeout;
  4. charges tool `cbe_answer_check` (1 credit flat, or the real token cost if
     higher), idempotently on a key derived from slide + learner + answer, so
     a resubmitted identical answer or a retried request is not charged twice.

A failed grade is not charged (CbeGradingFailed -> HTTP 502).
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
from typing import Any, Optional

from sqlalchemy import text

from ...models.ai_token_usage import RequestType
from ..ai_billing import UC, charge_tool, metering_user, preflight_tool_credits
from . import cbe_render, typed_answers
from .grader import FAIL_TOKENS_PER_COPY, CopyCheckGrader, evaluation_model
from .validator import attach_criteria_max, validate_and_cap

logger = logging.getLogger(__name__)

TOOL_KEY = "cbe_answer_check"
# admin_core waits 120 s; finish (or fail cleanly) before that.
TOTAL_SECONDS = float(os.getenv("CBE_SYNC_TIMEOUT_SECONDS", "110"))
FIRST_ATTEMPT_SECONDS = float(os.getenv("CBE_SYNC_FIRST_ATTEMPT_SECONDS", "75"))
# A retry with less time than this left is not started.
MIN_RETRY_SECONDS = 15.0
TOKEN_BUDGET = FAIL_TOKENS_PER_COPY

_EMPTY_LAYOUT: dict[str, Any] = {"pages": []}


class InsufficientCredits(Exception):
    def __init__(self, estimate: dict[str, Any]):
        super().__init__("insufficient AI credits")
        self.estimate = estimate or {}


class CbeGradingFailed(Exception):
    """Both attempts failed or ran out of time. Nothing was charged."""


# ---------------------------------------------------------------------------
# Request -> question
# ---------------------------------------------------------------------------

def _as_json_text(value: Any) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, str):
        return value
    try:
        return json.dumps(value, ensure_ascii=False)
    except (TypeError, ValueError):
        return str(value)


def build_question(req: dict[str, Any]) -> dict[str, Any]:
    """The copy-check question dict the typed grader reads, from the sync body."""
    config_text = _as_json_text(req.get("config"))
    scenario = cbe_render.html_to_text(req.get("scenario_text"))
    requirement = cbe_render.html_to_text(req.get("question_text"))
    text_parts = []
    if scenario:
        text_parts.append(f"Scenario:\n{scenario}")
    if requirement:
        text_parts.append(f"Requirement:\n{requirement}")
    max_marks = float(req.get("max_marks") or 0)
    if max_marks <= 0:
        config = cbe_render.config_data(config_text)
        max_marks = sum(cbe_render._num(p.get("marks"), 0.0)
                        for p in (config or {}).get("parts") or [] if isinstance(p, dict))
    return {
        "question_id": str(req.get("source_id") or ""),
        "question_type": cbe_render.CBE_TYPE,
        "question_text": "\n\n".join(text_parts),
        "max_marks": max_marks,
        "student_answer": _as_json_text(req.get("answer")),
        "model_answer": config_text,
        "cbe_config": config_text,
    }


def charge_key(req: dict[str, Any]) -> str:
    """Idempotency key of the charge: the caller's request_id, else slide +
    learner + the answer's canonical JSON (an identical resubmission or a
    retried request is charged once)."""
    if req.get("request_id"):
        return f"{TOOL_KEY}:{str(req['request_id'])[:200]}"
    answer = req.get("answer")
    parsed = cbe_render.parse_json(answer)
    canonical = (json.dumps(parsed, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
                 if parsed is not None else str(answer or ""))
    digest = hashlib.sha256(
        "\x1f".join([str(req.get("source_id") or ""), str(req.get("user_id") or ""), canonical]).encode("utf-8")
    ).hexdigest()
    return f"{TOOL_KEY}:{digest}"


# ---------------------------------------------------------------------------
# Seams (patched in tests)
# ---------------------------------------------------------------------------

def _preflight(db: Any, institute_id: str, meter: Any) -> dict[str, Any]:
    return preflight_tool_credits(
        db, tool_key=TOOL_KEY, tool_params={}, institute_id=institute_id,
        metering=meter, use_case=UC.EVALUATION,
    )


def _new_llm(db: Any) -> Any:
    from ..api_key_resolver import ApiKeyResolver
    from ..chat_llm_client import ChatLLMClient

    return ChatLLMClient(ApiKeyResolver(db))


def _eval_model(db: Any) -> str:
    return evaluation_model(db)


def _release(db: Any) -> None:
    """End the read transaction so the request's connection goes back to the
    pool while the model thinks (the session reopens on demand)."""
    try:
        db.commit()
    except Exception:  # noqa: BLE001
        pass


def _already_charged(db: Any, key: str) -> bool:
    try:
        row = db.execute(
            text("SELECT 1 FROM credit_transactions WHERE external_reference_id = :k LIMIT 1"),
            {"k": key},
        ).fetchone()
        return row is not None
    except Exception:  # noqa: BLE001 - CreditService's own idempotency still applies
        try:
            db.rollback()
        except Exception:  # noqa: BLE001
            pass
        return False


def _charge(db: Any, *, key: str, institute_id: str, user_id: str, model: str,
            grader: CopyCheckGrader, source_id: str, meter: Any) -> float:
    """Best-effort: the learner already has the grade."""
    try:
        if _already_charged(db, key):
            logger.info("cbe sync: %s already charged; not charging again", key)
            return 0.0
        amount = charge_tool(
            db,
            tool_key=TOOL_KEY,
            tool_params={},
            request_type=RequestType.EVALUATION,
            model=model,
            prompt_tokens=grader.prompt_tokens,
            completion_tokens=grader.completion_tokens,
            institute_id=institute_id,
            user_id=user_id,
            request_id=key,
            idempotency_key=key,
            use_case=UC.EVALUATION,
            metering=meter,
            usage_context={"source_id": source_id, "surface": "question_slide",
                           "question_type": cbe_render.CBE_TYPE},
            description_label="AI answer check · spreadsheet & written response",
        )
        return float(amount or 0)
    except Exception as exc:  # noqa: BLE001
        logger.warning("cbe sync: charge failed for %s (%s): %s", source_id, key, exc)
        try:
            db.rollback()
        except Exception:  # noqa: BLE001
            pass
        return 0.0


# ---------------------------------------------------------------------------
# Grading
# ---------------------------------------------------------------------------

def _finalise(raw: dict[str, Any], question: dict[str, Any], rubric: dict[str, Any]) -> dict[str, Any]:
    verdict = attach_criteria_max(validate_and_cap(raw, question, _EMPTY_LAYOUT), rubric)
    return cbe_render.reconcile_breakdown(verdict)


async def _grade_with_retry(grader: CopyCheckGrader, question: dict[str, Any], rubric: dict[str, Any],
                            preferred_model: Optional[str]) -> tuple[dict[str, Any], str]:
    """(verdict, model used). One retry with the platform evaluation model,
    like the assessment path's _grade_typed, inside TOTAL_SECONDS."""
    loop = asyncio.get_running_loop()
    deadline = loop.time() + TOTAL_SECONDS
    first_model = preferred_model or grader.default_model
    try:
        raw = await asyncio.wait_for(
            grader.grade_typed_question(question, rubric, preferred_model),
            timeout=min(FIRST_ATTEMPT_SECONDS, TOTAL_SECONDS),
        )
        return _finalise(raw, question, rubric), first_model
    except Exception as first_err:  # noqa: BLE001
        remaining = deadline - loop.time()
        logger.warning("cbe sync: grading %s failed (%s: %s); %.0fs left for a retry",
                       question.get("question_id"), type(first_err).__name__, first_err, remaining)
        if remaining < MIN_RETRY_SECONDS:
            raise CbeGradingFailed(_describe(first_err)) from first_err
    retry_model = grader.default_model
    try:
        raw = await asyncio.wait_for(
            grader.grade_typed_question(question, rubric, retry_model),
            timeout=max(1.0, deadline - loop.time()),
        )
        return _finalise(raw, question, rubric), retry_model
    except Exception as retry_err:  # noqa: BLE001
        logger.exception("cbe sync: retry also failed for %s", question.get("question_id"))
        raise CbeGradingFailed(_describe(retry_err)) from retry_err


def _describe(exc: BaseException) -> str:
    from .orchestrator import describe_failure

    if isinstance(exc, asyncio.TimeoutError):
        return "The AI service did not answer in time."
    return describe_failure(exc)


def _verdict_word(verdict: dict[str, Any]) -> str:
    word = str(verdict.get("verdict") or "").strip().lower()
    if word in ("correct", "partial", "wrong", "unattempted"):
        return word.upper()
    awarded = float(verdict.get("marks_awarded") or 0)
    mx = float(verdict.get("max_marks") or 0)
    if mx > 0 and awarded >= mx - 1e-9:
        return "CORRECT"
    return "PARTIAL" if awarded > 0 else "WRONG"


def to_response(verdict: dict[str, Any], credits_charged: float) -> dict[str, Any]:
    breakdown = []
    for c in verdict.get("criteria_breakdown") or []:
        if not isinstance(c, dict):
            continue
        breakdown.append({
            "criteria_name": str(c.get("criteria_name") or ""),
            "marks": float(c.get("marks") or 0),
            "max_marks": c.get("max") if c.get("max") is not None else c.get("max_marks"),
            "reason": str(c.get("reason") or ""),
        })
    return {
        "marks_awarded": float(verdict.get("marks_awarded") or 0),
        "max_marks": float(verdict.get("max_marks") or 0),
        "verdict": _verdict_word(verdict),
        "feedback": str(verdict.get("feedback") or ""),
        "confidence": float(verdict.get("confidence") or 0),
        "criteria_breakdown": breakdown,
        "credits_charged": round(float(credits_charged or 0), 4),
    }


async def grade_cbe_sync(req: dict[str, Any], db: Any) -> dict[str, Any]:
    """Grade one answer. Raises ValueError (bad request), InsufficientCredits
    (402) or CbeGradingFailed (502)."""
    question = build_question(req)
    if not question["question_id"]:
        raise ValueError("source_id is required")
    if float(question["max_marks"] or 0) <= 0:
        raise ValueError("max_marks is missing and the config's parts carry no marks")
    if cbe_render.answer_is_blank(question):
        return to_response(typed_answers.unattempted_verdict(question), 0.0)

    institute_id = str(req["institute_id"])
    user_id = str(req["user_id"])
    meter = metering_user(user_id, surface="LEARNER_APP")
    estimate = _preflight(db, institute_id, meter)
    if estimate.get("sufficient") is False:
        raise InsufficientCredits(estimate)

    eval_model = _eval_model(db)
    llm = _new_llm(db)
    _release(db)
    grader = CopyCheckGrader(
        llm, institute_id=institute_id, user_id=user_id,
        token_budget=TOKEN_BUDGET, default_model=eval_model,
    )
    rubric = cbe_render.derive_rubric(cbe_render.question_config(question), float(question["max_marks"]))
    verdict, model_used = await _grade_with_retry(grader, question, rubric, req.get("preferred_model") or None)

    credits = _charge(
        db, key=charge_key(req), institute_id=institute_id, user_id=user_id, model=model_used,
        grader=grader, source_id=question["question_id"], meter=meter,
    )
    logger.info("cbe sync: %s/%s graded %.1f/%.1f, %d tokens, %.2f credits",
                question["question_id"], user_id, verdict["marks_awarded"], verdict["max_marks"],
                grader.tokens_used, credits)
    return to_response(verdict, credits)
