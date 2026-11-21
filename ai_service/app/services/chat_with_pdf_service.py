"""Chat-with-PDF — migrated from media_service ChatWithPdfController +
ChatAiManager + DeepSeekConversationService.

get-response flow (one synchronous turn):
  1. PDF → HTML: reuse the WS7 MathPix pipeline (pdf_questions_service), which
     caches the converted HTML on file_conversion keyed by the MathPix pdfId and
     reuses it for every turn. Raises StillProcessing if MathPix isn't done
     (the router maps that to HTTP 425 so the FE retries — see router docstring).
  2. Conversation context: the last 5 turns for this PDF (scoped by
     institute+pdfId+PDF_ID, NOT by parentId — matches Java), serialized to the
     ConversationDto JSON the prompt expects.
  3. LLM: chat prompt → {"user","response"} JSON, model resolved from the DB
     registry ("chat" use case) — fixes the hardcoded retired -preview model id.
  4. Persist the turn as one COMPLETED ai_task row (parent_id threads the
     conversation).
  5. Return the full ordered chat history for the PDF as ChatWithPdfResponse[].

Chat turns are stored in ai_service's own ai_task table (the same table the
other migrated async features use); there is no separate chat table, exactly as
media_service reused task_status.
"""
from __future__ import annotations

import asyncio
import json
import logging
from typing import Any, Dict, List, Optional
from uuid import uuid4

from ..db import db_session
from ..models.ai_task import AiTask, AiTaskInputType, AiTaskStatus, AiTaskType
from ..models.ai_token_usage import RequestType
from ..repositories.ai_task_repository import AiTaskRepository
from . import ai_billing, llm_json, pdf_questions_service
from .ai_prompts import chat_with_pdf as prompts

logger = logging.getLogger(__name__)

# Registry use case for chat model resolution. No ai_model_defaults row is
# required — resolve_models falls back to the platform default (GLM, then the
# non-GLM tail), which is the whole point of the migration: media_service
# hardcoded the retired google/gemini-2.5-flash-preview-09-2025 here.
CHAT_USE_CASE = "chat"


async def generate_chat_response(
    *,
    pdf_id: str,
    user_prompt: str,
    task_name: str,
    institute_id: Optional[str],
    parent_id: Optional[str],
    models: List[str],
    user_id: Optional[str],
) -> List[Dict[str, Any]]:
    """Run one chat turn and return the full chat history for the PDF.

    Raises pdf_questions_service.StillProcessing if the PDF is not yet converted
    (the caller translates that to a 425 so the FE polls)."""
    # 1. PDF → HTML (cached; StillProcessing propagates if MathPix isn't done)
    html_text = await pdf_questions_service.fetch_or_convert_html(pdf_id, allow_poll=False)

    # 2. last-5 conversation context (own session)
    last5 = await asyncio.to_thread(_load_last5_json, institute_id, pdf_id)

    # 3. build the chat prompt
    prompt = prompts.build_prompt(
        html_text=html_text, user_prompt=user_prompt, last5_conversation=last5
    )

    # 4. LLM → sanitized {"user","response"} JSON string
    sanitized, model_used, usage = await llm_json.generate_json(
        prompt, models, label="chat_with_pdf"
    )

    # 5. persist this turn as a COMPLETED ai_task row (own session)
    await asyncio.to_thread(
        _persist_turn, institute_id, pdf_id, sanitized, task_name, parent_id
    )

    # 6. bill (best-effort; conversation use case)
    await asyncio.to_thread(
        ai_billing.record_llm_billing,
        request_type=RequestType.CONVERSATION,
        model=model_used,
        prompt_tokens=usage.get("prompt_tokens", 0),
        completion_tokens=usage.get("completion_tokens", 0),
        total_tokens=usage.get("total_tokens", 0),
        institute_id=institute_id,
        user_id=user_id,
        metadata={"feature": "chat_with_pdf", "pdf_id": pdf_id},
    )

    # 7. return the full ordered chat history for this PDF (matches Java)
    return await asyncio.to_thread(_load_history, institute_id, pdf_id)


# --- sync DB helpers (run via to_thread from the async path) ---

def _load_last5_json(institute_id: Optional[str], pdf_id: str) -> str:
    """Serialize the last (up to) 5 turns for this PDF, oldest→newest, into the
    ConversationDto JSON shape media uses: {user, aiResponse, createdAt}."""
    convos: List[Dict[str, Any]] = []
    try:
        with db_session() as db:
            rows = AiTaskRepository(db).list_last_chat_turns(institute_id, pdf_id, limit=5)
            for r in reversed(rows):  # newest-first → oldest-first
                raw = (r.result_json or "").strip()
                if not raw:
                    continue
                try:
                    data = json.loads(raw)
                except Exception:  # noqa: BLE001
                    continue
                if not isinstance(data, dict):
                    continue
                convos.append(
                    {
                        "user": data.get("user"),
                        "aiResponse": data.get("response"),
                        "createdAt": r.created_at.isoformat() if r.created_at else None,
                    }
                )
    except Exception as exc:  # noqa: BLE001
        logger.warning("chat last-5 context load failed for pdf=%s: %s", pdf_id, exc)
    return json.dumps(convos)


def _persist_turn(
    institute_id: Optional[str],
    pdf_id: str,
    result_json: str,
    task_name: str,
    parent_id: Optional[str],
) -> None:
    """Insert one COMPLETED chat-turn row. An empty/blank parentId is stored as
    NULL so the first turn of a thread is a proper session head (matches the
    Java intent that thread heads have parent_id IS NULL)."""
    with db_session() as db:
        db.add(
            AiTask(
                id=str(uuid4()),
                task_type=AiTaskType.CHAT_WITH_PDF.value,
                status=AiTaskStatus.COMPLETED.value,
                institute_id=institute_id,
                input_id=pdf_id,
                input_type=AiTaskInputType.PDF_ID.value,
                task_name=task_name or "",
                parent_id=(parent_id or None),
                result_json=result_json,
                status_message="Completed",
            )
        )
        db.commit()


def _load_history(institute_id: Optional[str], pdf_id: str) -> List[Dict[str, Any]]:
    with db_session() as db:
        rows = AiTaskRepository(db).list_chat_turns(institute_id, pdf_id)
        return [m for m in (r.to_chat_response() for r in rows) if m is not None]


# --- request-session reads (quick; used directly by the GET endpoints) ---

def get_thread(db, parent_id: str) -> List[Dict[str, Any]]:
    """get-chat: the head row + its children, oldest→newest."""
    rows = AiTaskRepository(db).list_thread(parent_id)
    return [m for m in (r.to_chat_response() for r in rows) if m is not None]


def list_chat_sessions(db, institute_id: str) -> List[Dict[str, Any]]:
    """get/chat-list: all parentless rows for the institute, as TaskStatusDto."""
    rows = AiTaskRepository(db).list_parentless(institute_id)
    return [r.to_list_dto() for r in rows]
