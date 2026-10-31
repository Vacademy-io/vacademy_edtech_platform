"""Fresh questions for weak-concept revisits (design §6.6).

At a topic summary or slide end the teacher re-asks the concepts the learner
found hard, each with ONE fresh question written by the model from the
concept, its original check and what the learner said. When the model is
down the original check is re-asked, so a revisit never depends on a call.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, Optional, Tuple

from ....db import db_session
from ....models.ai_token_usage import RequestType
from ...ai_billing import UC, metering_user, record_llm_billing
from ...api_key_resolver import ApiKeyResolver
from ...chat_llm_client import ChatLLMClient
from ..compile_prompts import extract_json
from ..plan_compiler import _FixedKeys
from . import prompts
from .state import Concept

logger = logging.getLogger(__name__)

QUESTION_MAX_TOKENS = 300


def fallback_check(concept: Concept, lang: str) -> Dict[str, Any]:
    """The original check re-asked (or, for a concept that had none, "tell me
    in your own words")."""
    chk = dict(concept.check or {})
    if chk.get("prompt"):
        prefix = "एक बार फिर कोशिश करते हैं: " if lang == "hi" else "Let's try this once more: "
        return {
            "type": chk.get("type") if chk.get("type") in ("open", "mcq") else "open",
            "prompt": prefix + str(chk["prompt"]), "options": list(chk.get("options") or []),
            "expected": chk.get("expected"), "rubric": chk.get("rubric"),
            "misconceptions": list(chk.get("misconceptions") or []),
            "pass_threshold": chk.get("pass_threshold", 0.7), "fresh": False,
        }
    q = (f"अपने शब्दों में बताइए, {concept.title} क्या है?" if lang == "hi"
         else f"In your own words, what is {concept.title}?")
    return {"type": "open", "prompt": q, "options": [], "expected": (concept.say or "")[:300],
            "rubric": "Credit the core idea in the learner's own words.", "misconceptions": [],
            "pass_threshold": 0.6, "fresh": False}


async def fresh_check(
    *, institute_id: str, user_id: str, model: Optional[str], lang: str, concept: Concept,
    previous_answer: Optional[str], misconception: Optional[str], tutor_session_id: str,
) -> Tuple[Dict[str, Any], Dict[str, int]]:
    """A new check for `concept` plus the model usage; falls back to the
    original check when the model fails or repeats it."""
    chk = dict(concept.check or {})
    usage = {"prompt_tokens": 0, "completion_tokens": 0}
    fallback = fallback_check(concept, lang)
    messages = [
        {"role": "system", "content": "You write one short check question for a one-to-one lesson. JSON only."},
        {"role": "user", "content": prompts.revisit_question_prompt(
            lang=lang, concept_title=concept.title, concept_say=concept.narration(lang), teach_notes=concept.teach_notes,
            check=chk, previous_answer=previous_answer, misconception=misconception)},
    ]
    try:
        with db_session() as db:
            keys = ApiKeyResolver(db).resolve_keys(
                institute_id, user_id, request_model=model,
                # A blank live model inherits the chatbot model setting (then the
                # platform_default use case), not the env default.
                platform_default_key="chatbot.text.model",
            )
        client = ChatLLMClient(_FixedKeys(keys), platform_model_key="chatbot.text.model")
        resp = await client.chat_completion(messages, temperature=0.5, max_tokens=QUESTION_MAX_TOKENS,
                                            institute_id=institute_id, user_id=user_id, model=model)
        u = resp.get("usage") or {}
        usage = {"prompt_tokens": int(u.get("prompt_tokens") or 0), "completion_tokens": int(u.get("completion_tokens") or 0)}
        record_llm_billing(
            request_type=RequestType.CONVERSATION, model=resp.get("model") or model or "default",
            prompt_tokens=usage["prompt_tokens"], completion_tokens=usage["completion_tokens"],
            total_tokens=usage["prompt_tokens"] + usage["completion_tokens"], institute_id=institute_id, user_id=user_id,
            request_id=tutor_session_id, metadata={"surface": "tutor", "kind": "revisit_question"},
            use_case=UC.TUTOR_CHAT, metering=metering_user(user_id, surface="LEARNER_APP"),
            usage_context={"tutor_session_id": tutor_session_id, "feature": "revisit_question"},
        )
        data = extract_json(resp.get("content") or "")
        prompt = str((data or {}).get("prompt") or "").strip() if isinstance(data, dict) else ""
        if not prompt or prompt.strip().lower() == str(chk.get("prompt") or "").strip().lower():
            return fallback, usage
        return {
            "type": "open", "prompt": prompt[:400], "options": [],
            "expected": (str(data.get("expected") or "").strip() or chk.get("expected") or None),
            "rubric": (str(data.get("rubric") or "").strip() or chk.get("rubric") or None),
            "misconceptions": list(chk.get("misconceptions") or []),
            "pass_threshold": chk.get("pass_threshold", 0.7), "fresh": True,
        }, usage
    except Exception:  # noqa: BLE001
        logger.warning("Revisit question failed for session %s; re-asking the original", tutor_session_id, exc_info=True)
        return fallback, usage
