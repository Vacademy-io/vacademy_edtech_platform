"""LLM grading wrapper.

Wraps ChatLLMClient (OpenRouter primary, Gemini fallback). Adds:
  - JSON-only response_format hint to the system prompt
  - Per-copy token guard (logs warn at 20k, raises at 50k)
  - Strong-model escalation when verdict confidence < ESCALATION_CONF_THRESHOLD

Note: OpenRouter does not currently support transparent prompt caching for
arbitrary models — Anthropic's cache_control markers and Gemini's cached_content
both require provider-specific request shaping. Implementing that lives in a
future PR; for now the rubric block is resent in full on every grading call.
The transcript is NOT resent in full: locate.py narrows each call to the pages
holding that question's answer (see orchestrator step 2b).
"""
from __future__ import annotations

import json
import logging
import re
from typing import Any, Optional

from ..chat_llm_client import ChatLLMClient
from .prompt_builder import build_grading_prompt, examiner_instructions_block, grading_system_for
from .typed_answers import build_typed_grading_prompt, typed_grading_system
from .validator import coerce_confidence

logger = logging.getLogger(__name__)

# z-ai/glm-5.3-flash: $0.075/M in, $0.25/M out — cheaper than the
# gemini-2.5-flash-lite ($0.10/$0.40) it replaces, and it reads handwriting,
# which is what this pipeline actually needs (see vision_transcript.py).
# NOTE: this endpoint REFUSES `reasoning: {enabled: false}` and, given no
# reasoning key at all, spends the entire max_tokens budget thinking and
# returns empty content. chat_llm_client seeds it as "on-low" for that reason —
# do not remove that seed without re-testing a real copy end to end.
#
# Release 2: the model is the 'evaluation' use case (ai_model_defaults,
# super-admin portal) — see evaluation_model(). This literal is only the hard
# fallback when the registry cannot be read. A teacher's explicit
# preferred_model still wins for grading.
DEFAULT_MODEL = "z-ai/glm-5.3-flash"
# A low-confidence question is re-asked of the platform evaluation model at a
# lower temperature rather than escalated to another family: the pipeline must
# not silently spend a different provider's tokens on a copy. Hard fallback;
# the live value is the grader's default_model.
ESCALATION_MODEL = DEFAULT_MODEL
ESCALATION_CONF_THRESHOLD = 0.60
MAX_ESCALATIONS_PER_COPY = 2
# Budget tuned for typical 8-question copies. Each grading call re-sends the
# full OCR transcript + rubric + system prompt (~5-8k tokens), so 8 questions
# burn ~70k tokens just on grading; criteria-generation and escalations add
# more. The floor is 250k; a paper with more questions gets more, because a
# fixed cap is exactly what zeroed questions 38-64 of a 64-question paper on
# 2026-09-20 ("needs manual review" for half the sheet) while the institute was
# still charged per question. Per-call provider limits apply independently.
WARN_TOKENS_PER_COPY = 80_000
FAIL_TOKENS_PER_COPY = 250_000
TOKENS_PER_QUESTION_ALLOWANCE = 7_000


def evaluation_model(db: Any = None) -> str:
    """The 'evaluation' use-case default model (super-admin portal), or
    DEFAULT_MODEL if the registry cannot be read. No failover chain is used
    for copy-check (see ESCALATION_MODEL). Cached 30 s by model_selection."""
    try:
        from ..model_selection import resolve_model_sync, resolve_models
        if db is not None:
            primary, _fallbacks = resolve_models(db, "evaluation", hard_fallback=DEFAULT_MODEL)
        else:
            primary, _fallbacks = resolve_model_sync("evaluation", hard_fallback=DEFAULT_MODEL)
        return primary if isinstance(primary, str) and primary else DEFAULT_MODEL
    except Exception as exc:  # noqa: BLE001
        logger.warning("evaluation model lookup failed (%s); using %s", exc, DEFAULT_MODEL)
        return DEFAULT_MODEL


def token_budget_for(question_count: int) -> int:
    """Per-copy hard cap: the historical floor, or room for every question."""
    return max(FAIL_TOKENS_PER_COPY, int(question_count) * TOKENS_PER_QUESTION_ALLOWANCE)


def _strip_code_fence(text: str) -> str:
    """LLMs sometimes return ```json ... ``` despite response_format hints."""
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(json)?\s*\n", "", text, count=1)
        text = re.sub(r"\n?```\s*$", "", text, count=1)
    return text.strip()


def _parse_json_or_retry_payload(content: str) -> dict[str, Any]:
    cleaned = _strip_code_fence(content)
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        # Last-ditch: find the first { and the last } and try to parse that span.
        start = cleaned.find("{")
        end = cleaned.rfind("}")
        if start != -1 and end > start:
            return json.loads(cleaned[start : end + 1])
        raise


def _breakdown_contradicts_total(payload: dict[str, Any]) -> bool:
    """True when the per-criterion trace cannot be reconciled with the mark.

    The model occasionally emits every `criteria_breakdown[].marks` as 0 while
    the same objects' `reason` text says "Full marks — ..." and `marks_awarded`
    is non-zero. validator.validate_and_cap cannot repair that: its rescale is
    `marks_awarded / bsum`, so a zero sum is guarded out and the all-zero
    breakdown passes straight through. The teacher then sees "6/10" above four
    criteria that each read 0 — the audit trail contradicting the mark it is
    supposed to justify. Cheaper to notice and re-ask than to ship.
    """
    breakdown = payload.get("criteria_breakdown") or []
    if not breakdown:
        return False
    try:
        awarded = float(payload.get("marks_awarded") or 0)
        bsum = sum(float(it.get("marks") or 0) for it in breakdown)
    except (TypeError, ValueError):
        return True
    return awarded > 0 and bsum <= 0


class CopyCheckGrader:
    def __init__(
        self,
        llm: ChatLLMClient,
        institute_id: Optional[str] = None,
        user_id: Optional[str] = None,
        token_budget: int = FAIL_TOKENS_PER_COPY,
        exam_context: Optional[dict[str, Any]] = None,
        default_model: Optional[str] = None,
        grading_instructions: bool = False,
    ):
        self.llm = llm
        # Model used when the teacher picked none, and for escalations: the
        # 'evaluation' use case, resolved once per copy by the orchestrator.
        self.default_model = default_model or DEFAULT_MODEL
        # {"level","subject",...} from the grade request: picks the grading
        # persona (T0.25). Absent = the constant "school teacher" prompt.
        self.exam_context = exam_context or {}
        # Whether exam_context.instructions also go into the grading prompt
        # (dashboard runs). Partner API instructions shape the rubric only,
        # as they always have.
        self.grading_instructions = grading_instructions
        self.institute_id = institute_id
        self.user_id = user_id
        self.token_budget = max(int(token_budget or 0), FAIL_TOKENS_PER_COPY)
        self._tokens_used = 0
        # Prompt/completion split, accumulated across all LLM calls for this copy
        # so per-copy credit billing can price input and output tokens correctly.
        self._prompt_tokens = 0
        self._completion_tokens = 0
        self._escalations_used = 0

    def _system_for(self, question: dict[str, Any], typed: bool) -> str:
        """System prompt for this question: the question's own subject (Java
        sends it per question) or the paper's, at the paper's level."""
        subject = question.get("subject") or self.exam_context.get("subject")
        level = self.exam_context.get("level")
        system = typed_grading_system(subject, level) if typed else grading_system_for(subject, level)
        if not self.grading_instructions:
            return system
        return system + examiner_instructions_block(self.exam_context)

    def add_tokens(self, n: int) -> None:
        """External counter for non-grading calls (e.g. criteria generation
        in rubric.RubricResolver) so the per-copy budget covers every LLM call,
        not just the grading ones. Criteria generation is input-heavy, so count
        it toward the prompt side for billing."""
        n = max(0, int(n or 0))
        self._tokens_used += n
        self._prompt_tokens += n
        if self._tokens_used > WARN_TOKENS_PER_COPY:
            logger.warning(
                "copy-check token usage high: %d (warn threshold %d)",
                self._tokens_used, WARN_TOKENS_PER_COPY,
            )

    def add_usage(self, usage: dict[str, Any]) -> None:
        """Same warn-threshold accounting as add_tokens, but also splits
        prompt vs completion tokens (calculate_credits prices input/output
        tokens differently for billing). Self-contained — does NOT delegate
        to add_tokens, since that method attributes its whole count to the
        prompt side and would double-count here. Falls back to counting an
        unsplit total entirely as prompt tokens when the provider doesn't
        report the split — grading calls are dominated by the resent
        OCR+rubric context anyway, so this is a conservative under-charge
        rather than an over-charge."""
        usage = usage or {}
        prompt = usage.get("prompt_tokens")
        completion = usage.get("completion_tokens")
        if prompt is None and completion is None:
            prompt = usage.get("total_tokens") or usage.get("totalTokenCount") or 0
            completion = 0
        prompt = max(0, int(prompt or 0))
        completion = max(0, int(completion or 0))
        self._prompt_tokens += prompt
        self._completion_tokens += completion
        self._tokens_used += prompt + completion
        if self._tokens_used > WARN_TOKENS_PER_COPY:
            logger.warning(
                "copy-check token usage high: %d (warn threshold %d)",
                self._tokens_used, WARN_TOKENS_PER_COPY,
            )

    @property
    def tokens_used(self) -> int:
        return self._tokens_used

    @property
    def prompt_tokens(self) -> int:
        return self._prompt_tokens

    @property
    def completion_tokens(self) -> int:
        return self._completion_tokens

    async def grade_question(
        self,
        question: dict[str, Any],
        rubric: dict[str, Any],
        layout_map: dict[str, Any],
        preferred_model: Optional[str] = None,
        page_ids: Optional[list[str]] = None,
    ) -> dict[str, Any]:
        """`page_ids`: only these pages of the transcript go into the prompt
        (from locate.py). None = the whole copy."""
        model = preferred_model or self.default_model
        verdict = await self._call(question, rubric, layout_map, model, page_ids)
        # The model writes "low" or "85%" here often enough; read it the way
        # the validator will, instead of letting float() fail the question.
        if (
            coerce_confidence(verdict.get("confidence")) < ESCALATION_CONF_THRESHOLD
            and self._escalations_used < MAX_ESCALATIONS_PER_COPY
        ):
            self._escalations_used += 1
            logger.info(
                "Escalating Q%s to %s (conf=%.2f)",
                question["question_id"], self.default_model,
                coerce_confidence(verdict.get("confidence")),
            )
            try:
                verdict = await self._call(question, rubric, layout_map, self.default_model, page_ids)
            except Exception as e:
                logger.warning(f"Escalation failed, keeping initial verdict: {e}")
        return verdict

    async def _call(
        self,
        question: dict[str, Any],
        rubric: dict[str, Any],
        layout_map: dict[str, Any],
        model: str,
        page_ids: Optional[list[str]] = None,
    ) -> dict[str, Any]:
        if self._tokens_used >= self.token_budget:
            raise RuntimeError(
                f"copy-check token budget exhausted: {self._tokens_used} >= {self.token_budget}"
            )
        prompt = build_grading_prompt(
            question, rubric, layout_map,
            neighbour_question_labels=question.get("neighbour_labels"),
            page_ids=page_ids,
        )
        messages = [
            {"role": "system", "content": self._system_for(question, typed=False)},
            {"role": "user", "content": prompt},
        ]
        return await self._complete(messages, question, model)

    async def grade_typed_question(
        self,
        question: dict[str, Any],
        rubric: dict[str, Any],
        preferred_model: Optional[str] = None,
    ) -> dict[str, Any]:
        """An answer typed in the online player (`question["student_answer"]`):
        no transcript, no annotations. Same budget, escalation and JSON repair
        as a copy."""
        model = preferred_model or self.default_model
        verdict = await self._call_typed(question, rubric, model)
        if (
            coerce_confidence(verdict.get("confidence")) < ESCALATION_CONF_THRESHOLD
            and self._escalations_used < MAX_ESCALATIONS_PER_COPY
        ):
            self._escalations_used += 1
            try:
                verdict = await self._call_typed(question, rubric, self.default_model)
            except Exception as e:
                logger.warning(f"Escalation failed, keeping initial verdict: {e}")
        return verdict

    async def _call_typed(self, question: dict[str, Any], rubric: dict[str, Any], model: str) -> dict[str, Any]:
        if self._tokens_used >= self.token_budget:
            raise RuntimeError(
                f"copy-check token budget exhausted: {self._tokens_used} >= {self.token_budget}"
            )
        messages = [
            {"role": "system", "content": self._system_for(question, typed=True)},
            {"role": "user", "content": build_typed_grading_prompt(question, rubric)},
        ]
        return await self._complete(messages, question, model)

    async def _complete(self, messages: list[dict[str, str]], question: dict[str, Any], model: str) -> dict[str, Any]:
        try:
            response = await self.llm.chat_completion(
                messages=messages,
                temperature=0.1,
                max_tokens=8000,
                institute_id=self.institute_id,
                user_id=self.user_id,
                model=model,
            )
        except Exception:
            logger.exception("Grading LLM call failed")
            raise

        # Token bookkeeping (best-effort — providers report usage differently).
        self.add_usage(response.get("usage"))

        content = response.get("content") or ""
        try:
            parsed = _parse_json_or_retry_payload(content)
        except Exception:
            parsed = None
        if parsed is not None:
            if not _breakdown_contradicts_total(parsed):
                return parsed
            logger.warning(
                "Q%s: criteria_breakdown sums to 0 against %s marks awarded; re-asking once",
                question.get("question_id"), parsed.get("marks_awarded"),
            )
            try:
                fix = await self.llm.chat_completion(
                    messages=messages + [
                        {"role": "assistant", "content": content},
                        {
                            "role": "user",
                            "content": (
                                "Your criteria_breakdown gives every criterion 0 marks, but you "
                                f"awarded {parsed.get('marks_awarded')}. Those cannot both be true. "
                                "Re-send the SAME verdict with each criteria_breakdown[].marks set to "
                                "the marks that criterion actually earned, so they sum to "
                                "marks_awarded. Change nothing else. Return ONLY the JSON object."
                            ),
                        },
                    ],
                    temperature=0.0,
                    max_tokens=8000,
                    institute_id=self.institute_id,
                    user_id=self.user_id,
                    model=model,
                )
                self.add_usage(fix.get("usage"))
                repaired = _parse_json_or_retry_payload(fix.get("content") or "")
                if not _breakdown_contradicts_total(repaired):
                    return repaired
            except Exception as e:
                logger.warning(f"breakdown repair failed, keeping original verdict: {e}")
            # Keep the verdict either way: the headline mark and the written
            # reasons are still useful, and validator will surface what it can.
            return parsed

        logger.warning("LLM returned unparseable JSON; re-prompting once")
        retry_messages = messages + [
            {"role": "assistant", "content": content},
            {
                "role": "user",
                "content": "Your previous reply was not valid JSON. Return ONLY the JSON object, no prose, no code fences.",
            },
        ]
        retry = await self.llm.chat_completion(
            messages=retry_messages,
            temperature=0.0,
            max_tokens=8000,
            institute_id=self.institute_id,
            user_id=self.user_id,
            # Must pin the same model: this retry's output IS the grade that
            # gets returned. Omitting model= silently downgraded the actual
            # grade to ChatLLMClient's free default even when the teacher
            # explicitly picked a premium model.
            model=model,
        )
        return _parse_json_or_retry_payload(retry.get("content") or "")


async def call_llm_for_criteria(
    llm: ChatLLMClient,
    system: str,
    user: str,
    preferred_model: Optional[str] = None,
    institute_id: Optional[str] = None,
    token_sink: Optional["CopyCheckGrader"] = None,
) -> dict[str, Any]:
    """Used by rubric.RubricResolver for the LLM-derived branch.

    `token_sink`: if supplied, the response's usage is counted against the
    grader's per-copy budget so criteria-generation calls share the same
    cap as grading calls.
    """
    response = await llm.chat_completion(
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        temperature=0.2,
        max_tokens=1200,
        institute_id=institute_id,
        # No pick = the 'evaluation' use case (not the platform chat default).
        model=preferred_model or evaluation_model(),
    )
    if token_sink is not None:
        token_sink.add_usage(response.get("usage"))
    return _parse_json_or_retry_payload(response.get("content") or "")
