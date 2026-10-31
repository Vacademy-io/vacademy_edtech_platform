"""1 credit per produced answer, paid by the institute (PRD §1).

* Pre-flight before the model runs: an institute out of credits gets the
  contact card instead of an answer (no model call, nothing charged).
* Charge after the model produced an answer: tool ``site_assistant_answer``
  (flat 1 credit, fixed price), request type ``chatbot``, use case
  ``site_assistant``; idempotent per assistant message. Guarded / canned
  replies never reach here.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, Optional

from ..db import db_session
from .settings import TOOL_KEY, USE_CASE

logger = logging.getLogger(__name__)


def _metering(channel: str, user_id: Optional[str]) -> Any:
    try:
        from ..services.ai_billing import metering_unverified, metering_user
        if channel == "PREVIEW" and user_id:
            return metering_user(user_id, surface="ADMIN_APP")
        return metering_unverified(None, surface="PUBLIC")
    except Exception:  # noqa: BLE001
        return None


def preflight(institute_id: str, *, channel: str = "HOSTED", user_id: Optional[str] = None) -> bool:
    """True when the institute can pay for one answer (unknown balance = allow)."""
    try:
        from ..services.ai_billing import preflight_tool_credits
        with db_session() as db:
            est = preflight_tool_credits(db, tool_key=TOOL_KEY, tool_params={}, institute_id=institute_id,
                                         metering=_metering(channel, user_id), use_case=USE_CASE)
        return est.get("sufficient") is not False
    except Exception as exc:  # noqa: BLE001
        try:
            from ..services.metering.limit_gate import is_limit_exceeded
            if is_limit_exceeded(exc):
                return False
        except Exception:  # noqa: BLE001
            pass
        logger.warning("site-assistant preflight failed for %s (%s); allowing", institute_id, exc)
        return True


def charge(*, institute_id: str, model: str, prompt_tokens: int, completion_tokens: int, message_id: int,
           conversation_id: str, site_tag: str, channel: str, user_id: Optional[str]) -> bool:
    """Charge one answer. True when the charge was recorded (never raises)."""
    try:
        from ..models.ai_token_usage import RequestType
        from ..services.ai_billing import charge_tool
        with db_session() as db:
            charge_tool(
                db, tool_key=TOOL_KEY, tool_params={}, request_type=RequestType.CHATBOT, model=model or "unknown",
                prompt_tokens=int(prompt_tokens or 0), completion_tokens=int(completion_tokens or 0),
                institute_id=institute_id, user_id=user_id, request_id=f"sa_msg:{message_id}",
                idempotency_key=f"sa_answer:{message_id}", use_case=USE_CASE,
                metering=_metering(channel, user_id),
                usage_context={"site_tag": site_tag, "channel": channel, "conversation_id": conversation_id,
                               "feature": "site_assistant_answer"},
            )
        return True
    except Exception as exc:  # noqa: BLE001
        logger.warning("site-assistant billing failed for message %s: %s", message_id, exc)
        return False


def balance_warning(institute_id: str) -> Dict[str, Any]:
    """For the staff status view: balance and whether one more answer is affordable."""
    try:
        from ..services.ai_billing import preflight_tool_credits
        with db_session() as db:
            est = preflight_tool_credits(db, tool_key=TOOL_KEY, tool_params={}, institute_id=institute_id,
                                         enforce_limits=False)
        return {"balance": est.get("current_balance"), "sufficient": est.get("sufficient"),
                "credits_per_answer": est.get("estimated_credits")}
    except Exception:  # noqa: BLE001
        return {"balance": None, "sufficient": None, "credits_per_answer": None}
