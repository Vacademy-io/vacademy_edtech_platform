"""The model-written rolling summary (design §6.6, §6.9).

At session end the deterministic one-liner is written first (cheap, never
fails); this module then rewrites the learner's rolling summary from the
session's attempts in ONE model call, in the background of the closing
socket: a spoken line for the next greeting plus the teacher's private notes.
"""
from __future__ import annotations

import logging
from typing import Optional

from ....db import db_session
from ....models.ai_token_usage import RequestType
from ...ai_billing import UC, metering_user, record_llm_billing
from ...api_key_resolver import ApiKeyResolver
from ...chat_llm_client import ChatLLMClient
from ..compile_prompts import extract_json
from ..plan_compiler import _FixedKeys
from . import prompts
from . import session_service as svc

logger = logging.getLogger(__name__)

SUMMARY_MAX_TOKENS = 450
SUMMARY_MAX_CHARS = 1500


def session_worth_summarising(digest: dict) -> bool:
    """A reconnect, a network blip or an open-and-close teaches nothing: no
    answer, no learner turn and at most one concept taught means the notes
    stay as they are (and no model call is spent)."""
    if digest.get("attempts"):
        return True
    done_today = sum(int(s.get("done_today") or 0) for s in digest.get("slides") or [])
    return int(digest.get("turns") or 0) >= 1 or int(digest.get("concepts_taught") or 0) >= 2 or done_today >= 2


async def rewrite_rolling_summary(
    *, tutor_session_id: str, user_id: str, institute_id: str, package_session_id: str, model: Optional[str],
    teacher: str, lang: str, learner_name: Optional[str],
) -> Optional[str]:
    """Returns the new summary, or None when nothing was learned this session
    or the model failed (the deterministic line stays)."""
    digest = svc.session_digest(tutor_session_id)
    if not digest or not session_worth_summarising(digest):
        return None
    messages = [
        {"role": "system", "content": "You keep short, honest notes about one learner. JSON only."},
        {"role": "user", "content": prompts.summary_prompt(teacher=teacher, learner_name=learner_name, lang=lang, digest=digest)},
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
        resp = await client.chat_completion(messages, temperature=0.3, max_tokens=SUMMARY_MAX_TOKENS,
                                            institute_id=institute_id, user_id=user_id, model=model)
        u = resp.get("usage") or {}
        record_llm_billing(
            request_type=RequestType.CONVERSATION, model=resp.get("model") or model or "default",
            prompt_tokens=int(u.get("prompt_tokens") or 0), completion_tokens=int(u.get("completion_tokens") or 0),
            total_tokens=int(u.get("prompt_tokens") or 0) + int(u.get("completion_tokens") or 0),
            institute_id=institute_id, user_id=user_id, request_id=tutor_session_id,
            metadata={"surface": "tutor", "kind": "session_summary"},
            use_case=UC.TUTOR_CHAT, metering=metering_user(user_id, surface="LEARNER_APP"),
            usage_context={"tutor_session_id": tutor_session_id, "feature": "session_summary"},
        )
        data = extract_json(resp.get("content") or "")
        if not isinstance(data, dict):
            return None
        say = " ".join(str(data.get("say_next_time") or "").split())
        notes = " ".join(str(data.get("notes") or "").split())
        if not say or not notes or say.startswith(prompts.LEGACY_SUMMARY_PREFIX):
            return None
        text_ = (say[:400] + "\n\n" + notes)[:SUMMARY_MAX_CHARS]
        svc.write_rolling_summary(user_id=user_id, package_session_id=package_session_id, text_=text_)
        return text_
    except Exception:  # noqa: BLE001
        logger.warning("Rolling summary rewrite failed for session %s", tutor_session_id, exc_info=True)
        return None
