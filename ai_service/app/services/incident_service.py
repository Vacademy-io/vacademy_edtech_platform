"""Incident/LL structure extraction — migrated from media_service LlController.

Synchronous: builds the inline incident prompt (with the full IncidentType
catalog embedded), calls the LLM, parses the snake_case JSON into
IncidentAIStructureResponse, bills usage/credits. Model resolved from the
registry (use case 'incident'; falls back to the platform default GLM, then
gemini-2.5-flash).
"""
from __future__ import annotations

import asyncio
import json
import logging
from typing import Optional

from sqlalchemy.orm import Session

from ..models.ai_token_usage import RequestType
from ..schemas.incident import IncidentAIStructureResponse
from . import ai_billing, llm_json
from .ai_prompts import incident as prompts
from .model_selection import resolve_models

logger = logging.getLogger(__name__)

INCIDENT_USE_CASE = "incident"


async def generate_incident_structure(
    db: Session,
    *,
    incident_text: str,
    institute_id: Optional[str],
    user_id: Optional[str],
) -> IncidentAIStructureResponse:
    primary, fallbacks = resolve_models(db, INCIDENT_USE_CASE, None)
    prompt = prompts.build_prompt(incident_text)
    sanitized, model_used, usage = await llm_json.generate_json(
        prompt, [primary, *fallbacks], label="incident"
    )
    await asyncio.to_thread(
        ai_billing.record_llm_billing,
        request_type=RequestType.INCIDENT,
        model=model_used,
        prompt_tokens=usage.get("prompt_tokens", 0),
        completion_tokens=usage.get("completion_tokens", 0),
        total_tokens=usage.get("total_tokens", 0),
        institute_id=institute_id,
        user_id=user_id,
        metadata={"feature": "incident_structure"},
    )
    return IncidentAIStructureResponse.model_validate(json.loads(sanitized))
