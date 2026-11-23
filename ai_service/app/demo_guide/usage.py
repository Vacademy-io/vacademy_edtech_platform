"""Usage rows for the demo guide: recorded, never charged (SPEC 2.4).

The guide is our own sales demo, so its model, speech and microphone spend
is written to ai_token_usage against the product's ``lead_institute_id``
with free_reason POLICY_FREE: it shows in the usage history and costs no
credits. Every function is best-effort and never raises; the blocking write
runs on a worker thread, off the event loop.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any, Dict, Optional

from .settings import TOOL_KEY, USE_CASE

logger = logging.getLogger(__name__)

_tasks: set = set()


def _spawn(fn, **kwargs: Any) -> None:
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        fn(**kwargs)
        return
    task = loop.create_task(asyncio.to_thread(fn, **kwargs))
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)


def _meter(context: Dict[str, Any]) -> Dict[str, Any]:
    from ..services.ai_billing import metering_kwargs, metering_unverified
    return {**metering_kwargs(USE_CASE, metering_unverified(None, surface="PUBLIC"), context),
            "free_reason": "POLICY_FREE"}


def _write_turn(*, institute_id: str, model: str, prompt_tokens: int, completion_tokens: int, session_id: str,
                message_id: str, product: str) -> None:
    try:
        from ..db import db_session
        from ..models.ai_token_usage import ApiProvider, RequestType
        from ..services.ai_billing import supported_kwargs
        from ..services.call_intelligence_service import _llm_cost_usd
        from ..services.token_usage_service import TokenUsageService
        usage = {"prompt_tokens": prompt_tokens, "completion_tokens": completion_tokens}
        meter = _meter({"session_id": session_id, "product": product, "feature": TOOL_KEY})
        with db_session() as db:
            tus = TokenUsageService(db)
            tus.record_usage(
                api_provider=ApiProvider.OPENAI, prompt_tokens=prompt_tokens, completion_tokens=completion_tokens,
                total_tokens=prompt_tokens + completion_tokens, request_type=RequestType.CHATBOT,
                institute_id=institute_id, model=model or "unknown", request_id=f"dg_msg:{message_id}",
                total_price=_llm_cost_usd(model, usage) if model else None,
                metadata={"session_id": session_id, "product": product, "feature": TOOL_KEY},
                **supported_kwargs(tus.record_usage, {**meter, "tool_key": TOOL_KEY}))
    except Exception:  # noqa: BLE001 - accounting must never fail a reply
        logger.warning("demo-guide: turn usage not recorded (session %s)", session_id, exc_info=True)


def record_turn(**kwargs: Any) -> None:
    """One turn's model tokens (all rounds summed)."""
    _spawn(_write_turn, **kwargs)


def _write_speech(*, institute_id: str, provider: str, characters: int, lang: str, product: str,
                  session_id: Optional[str], feature: str) -> None:
    try:
        from ..db import db_session
        from ..models.ai_token_usage import ApiProvider, RequestType
        from ..services.ai_billing import supported_kwargs
        from ..services.provider_rates import tts_cost_usd
        from ..services.token_usage_service import TokenUsageService
        meter = _meter({"session_id": session_id, "product": product, "feature": feature})
        with db_session() as db:
            tus = TokenUsageService(db)
            tus.record_usage(
                # The api_provider CHECK allows google_tts for speech rows; tts_provider carries the real vendor.
                api_provider=ApiProvider.GOOGLE_TTS, prompt_tokens=0, completion_tokens=0, total_tokens=0,
                request_type=RequestType.TTS, institute_id=institute_id, model=f"{provider}:tts",
                tts_provider=provider, character_count=max(int(characters), 0),
                total_price=tts_cost_usd(provider, int(characters)),
                metadata={"session_id": session_id, "product": product, "feature": feature, "language": lang},
                **supported_kwargs(tus.record_usage, meter))
    except Exception:  # noqa: BLE001
        logger.warning("demo-guide: speech usage not recorded (%s)", feature, exc_info=True)


def record_speech(**kwargs: Any) -> None:
    """Characters one synthesis sent to the voice provider (cache hits are not recorded)."""
    _spawn(_write_speech, **kwargs)


def record_listen(*, institute_id: str, seconds: Optional[float], characters: int, lang: str) -> None:
    """One transcription, through the shared speech-to-text usage writer."""
    def write() -> None:
        from ..services.speech_to_text import record_stt_usage
        record_stt_usage(institute_id=institute_id, user_id=None, seconds=seconds, characters=characters,  # type: ignore[arg-type]
                         language=lang, surface="demo_guide", use_case=USE_CASE, metering_surface="PUBLIC")
    _spawn(write)
