"""
Main AI Chat Agent service with agentic processing loop and SSE support.

Uses short-lived DB sessions to avoid holding database connections during
long-running LLM calls and SSE streaming. Each DB operation block opens
and closes its own session via the session factory.
"""
from __future__ import annotations

import asyncio
import json
import re
import time
from datetime import datetime
import logging
from typing import Callable, Dict, Any, List, Optional, AsyncGenerator
from uuid import uuid4

from sqlalchemy import text
from sqlalchemy.orm import Session

from ..repositories.chat_session_repository import ChatSessionRepository
from ..services.token_usage_service import TokenUsageService
from ..models.ai_token_usage import ApiProvider, RequestType

from ..repositories.chat_message_repository import ChatMessageRepository
from ..services.context_resolver_service import ContextResolverService
from ..services.lesson_text_service import apply as apply_lesson_text
from ..services.lesson_text_service import wait_for_text as wait_for_lesson_text
from ..services.tool_manager_service import (
    ORCHESTRATOR_TOOLS,
    TOOL_DEFINITIONS,
    ToolManagerService,
)
from ..services.chat_cards import card_fallback_markdown, split_tool_output
from ..services.chat_llm_client import ChatLLMClient
from ..services.institute_settings_service import InstituteSettingsService
from ..services.quiz_service import QuizService
from ..services.intent_classifier_service import IntentClassifierService
from ..services.context_window_service import ContextWindowService
from ..services.learning_analytics_service import LearningAnalyticsService
from ..services.api_key_resolver import ApiKeyResolver
from ..services.embedding_service import EmbeddingService
from ..services.rag_service import RAGService
from ..config import get_settings
from ..models.chat_message import ChatMessage
from ..models.chat_quiz_state import ChatQuizStateRepository
from ..services.mathpix_service import MathpixService
from ..schemas.chat_agent import (
    MessageIntent,
    QuizData,
    QuizSubmission,
    QuizFeedback,
)

logger = logging.getLogger(__name__)

# A user message is answered by exactly one stream. The stream that wins the
# claim (an atomic UPDATE on the message's metadata) runs the agent; any other
# stream open on the same session — a second tab, a reconnect racing the old
# connection — just relays what the winner writes. A claim not refreshed for
# CLAIM_STALE_SECONDS belongs to a stream that died (pod restart, deploy), and
# the next stream to look takes it over: that is how a reconnect now recovers a
# stuck turn. The slowest legitimate single step is quiz generation (max 62 s
# in production, Sep-Oct 2026); the claim is refreshed between steps.
CLAIM_STALE_SECONDS = 75
# Tools with side effects that must run at most once per learner message.
ONCE_PER_TURN_TOOLS = {"ask_teacher"}
# Never auto-answer a message older than this when a stream re-opens: a learner
# coming back to an old session should not get a reply to yesterday's question.
CLAIM_MAX_AGE_SECONDS = 15 * 60

_CLAIM_SQL = text(
    """
    UPDATE chat_messages
       SET metadata = COALESCE(metadata, '{}'::jsonb)
                      || jsonb_build_object('claimed_at', to_char(clock_timestamp() AT TIME ZONE 'UTC',
                                                                  'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
     WHERE id = :id
       AND session_id = :session_id
       AND message_type = 'user'
       AND created_at > (now() AT TIME ZONE 'UTC') - make_interval(secs => :max_age)
       AND (metadata IS NULL OR metadata->>'answered_at' IS NULL)
       AND (
             metadata IS NULL
          OR metadata->>'claimed_at' IS NULL
          OR (metadata->>'claimed_at')::timestamptz < clock_timestamp() - make_interval(secs => :stale)
       )
    RETURNING id
    """
)

_REFRESH_CLAIM_SQL = text(
    """
    UPDATE chat_messages
       SET metadata = metadata || jsonb_build_object('claimed_at', to_char(clock_timestamp() AT TIME ZONE 'UTC',
                                                                           'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
     WHERE id = :id AND metadata->>'answered_at' IS NULL
    RETURNING id
    """
)

_MARK_ANSWERED_SQL = text(
    """
    UPDATE chat_messages
       SET metadata = COALESCE(metadata, '{}'::jsonb)
                      || jsonb_build_object('answered_at', to_char(clock_timestamp() AT TIME ZONE 'UTC',
                                                                   'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
     WHERE id = :id
    RETURNING id
    """
)

# The answering stream went away mid-turn (tab closed, network drop): free the
# question so the next stream to open answers it, instead of waiting out the claim.
_RELEASE_CLAIM_SQL = text(
    """
    UPDATE chat_messages
       SET metadata = metadata - 'claimed_at'
     WHERE id = :id AND metadata->>'answered_at' IS NULL
    RETURNING id
    """
)

# Is this message still worth waiting for? (claimed by a live stream, young.)
_LIST_SESSIONS_SQL = text(
    """
    SELECT s.id, s.context_type, s.status, s.last_active,
           (SELECT left(m.content, 160) FROM chat_messages m
             WHERE m.session_id = s.id AND m.message_type = 'user'
               AND (m.metadata IS NULL OR m.metadata->'quiz_submission' IS NULL)
             ORDER BY m.id LIMIT 1) AS title,
           (SELECT count(*) FROM chat_messages m
             WHERE m.session_id = s.id AND m.message_type = 'user') AS question_count
      FROM chat_sessions s
     WHERE s.user_id = :user_id AND s.institute_id = :institute_id
       AND s.session_mode = 'text'
       AND s.context_type IN ('general', 'slide', 'course_details')
       AND EXISTS (SELECT 1 FROM chat_messages m WHERE m.session_id = s.id AND m.message_type = 'user')
     ORDER BY s.last_active DESC
     LIMIT :limit
    """
)

_LIST_SAVED_SQL = text(
    """
    SELECT m.id, m.session_id, m.message_type, m.content, m.metadata,
           (SELECT q.content FROM chat_messages q
             WHERE q.session_id = m.session_id AND q.message_type = 'user' AND q.id < m.id
             ORDER BY q.id DESC LIMIT 1) AS question
      FROM chat_messages m
      JOIN chat_sessions s ON s.id = m.session_id
     WHERE s.user_id = :user_id AND s.institute_id = :institute_id
       AND m.metadata->>'saved_at' IS NOT NULL
     ORDER BY m.metadata->>'saved_at' DESC
     LIMIT :limit
    """
)

_PENDING_STATE_SQL = text(
    """
    SELECT (metadata->>'answered_at') IS NOT NULL AS answered,
           created_at <= (now() AT TIME ZONE 'UTC') - make_interval(secs => :max_age) AS too_old
      FROM chat_messages
     WHERE id = :id
    """
)


class _CachedKeyResolver:
    """Lightweight API key resolver that returns pre-resolved keys without DB access."""

    def __init__(self, keys: tuple):
        self._keys = keys

    def resolve_keys(self, institute_id=None, user_id=None, request_model=None, **_ignored):
        return self._keys


def _msg_event(msg) -> dict:
    """Convert an ORM ChatMessage to an SSE-friendly dict."""
    return {
        "id": msg.id,
        "type": msg.message_type,
        "content": msg.content,
        "metadata": msg.meta_data,
        "created_at": msg.created_at.isoformat(),
    }


# ── course knowledge (CK-10) ─────────────────────────────────────────────────

# The generic resource search a verified learner's own course search replaces.
_RESOURCE_SEARCH_TOOL = "search_related_resources"
# learner_tool.TOOL_NAME, spelled out so history filtering needs no import of
# the course package on turns that never use it (a test pins the two equal).
_COURSE_TOOL_NAME = "search_my_course"
# Shadow probes run detached from the turn; keep a reference until they finish
# so the event loop cannot garbage-collect one mid-flight.
_SHADOW_TASKS: "set[asyncio.Task]" = set()


def _with_course_tool(tool_defs: List[Dict[str, Any]], course_tool: Dict[str, Any]) -> List[Dict[str, Any]]:
    """tool_defs with search_related_resources swapped for search_my_course, in place
    (appended when the generic search is absent). The shared list is not mutated."""
    swapped = [
        course_tool if t["function"]["name"] == _RESOURCE_SEARCH_TOOL else t
        for t in tool_defs
    ]
    if not any(t is course_tool for t in swapped):
        swapped.append(course_tool)
    return swapped


# The system prompt's routing line for the generic resource search, and what it
# becomes on a turn that offers search_my_course instead. Must match the line in
# _build_system_prompt exactly; a test pins both.
_RESOURCE_SEARCH_GUIDANCE = (
    "- Lessons, videos, PDFs or questions on a topic → search_related_resources. Its matches "
    "are shown to the student as clickable links, so don't repeat the list; say which to open "
    "first and why."
)
_COURSE_SEARCH_GUIDANCE = (
    "- Lessons, videos, PDFs, notes or any study question about their course content → "
    "search_my_course (passages from the courses they're enrolled in). Answer from what it "
    "returns and name the lesson you used; its matches are shown to the student as clickable "
    "links, so don't repeat the list."
)
# What a replayed search_my_course result becomes on a turn that may not read
# course content (unverified caller, gate off or shadow, kill switch).
_COURSE_RESULT_WITHHELD = (
    "[Course search result withheld: the student's course material is not available on this "
    "turn. Do not quote or rely on it.]"
)


def _with_course_tool_guidance(system_prompt: str) -> str:
    """The prompt with its resource-search routing line pointed at search_my_course.
    Appends the line when the generic one is missing, so the offered tool is
    always named."""
    if _RESOURCE_SEARCH_GUIDANCE in system_prompt:
        return system_prompt.replace(_RESOURCE_SEARCH_GUIDANCE, _COURSE_SEARCH_GUIDANCE, 1)
    return system_prompt + "\n" + _COURSE_SEARCH_GUIDANCE


def _withhold_course_tool_results(history: List[Dict[str, Any]], course_tool_name: str) -> List[Dict[str, Any]]:
    """history with every replayed search_my_course result stubbed out. The
    tool_call/tool pairing is kept (providers reject unpaired tool messages);
    only the course text goes. The input list is not mutated."""
    return [
        {**entry, "content": _COURSE_RESULT_WITHHELD}
        if entry.get("role") == "tool" and entry.get("name") == course_tool_name
        else entry
        for entry in history
    ]


async def _course_shadow_probe(
    session_id: str,
    user_id: str,
    institute_id: str,
    query: str,
    context_meta: Optional[Dict[str, Any]],
) -> None:
    """Shadow mode: run the turn's ambient course retrieval and log how it went.
    Never injects anything and never raises (except cancellation)."""
    started = time.monotonic()
    from .course_knowledge import shadow_events

    async def keep(**fields: Any) -> None:
        # Pod logs reset on every deploy; the row keeps the go-live numbers.
        await asyncio.to_thread(shadow_events.record, institute_id=institute_id, session_id=session_id, **fields)

    try:
        from .course_knowledge import learner_tool, prompt_blocks, retrieval

        q = " ".join((query or "").split())[: retrieval.MAX_QUERY_CHARS]
        if not q:
            return
        # The same scope and search the 'on' path uses (course_context_for_turn),
        # unrolled so an empty result still reports its latency and reason.
        scope = await learner_tool._scope(user_id, institute_id, context_meta)
        if scope.is_empty:
            total_ms = int((time.monotonic() - started) * 1000)
            logger.info(
                "course_kb.shadow session=%s inst=%s open=0 hits=0 signposts=0 refs=0 top=- "
                "latency_ms=0 total_ms=%d error=no_lessons",
                session_id, institute_id, total_ms,
            )
            await keep(total_ms=total_ms, error="no_lessons")
            return
        result = await retrieval.search_course(scope=scope, query=q, mode=retrieval.MODE_AMBIENT)
        block_chars = len(prompt_blocks.format_course_block(result)) if not result.is_empty else 0
    except asyncio.CancelledError:
        raise
    except Exception as e:  # noqa: BLE001 - a probe must never surface
        logger.warning(f"course_kb.shadow probe failed for session {session_id}: {e}")
        await keep(total_ms=int((time.monotonic() - started) * 1000), error="probe_failed")
        return
    top = result.top_similarity
    total_ms = int((time.monotonic() - started) * 1000)
    logger.info(
        "course_kb.shadow session=%s inst=%s open=%d hits=%d signposts=%d refs=%d top=%s "
        "latency_ms=%d total_ms=%d truncated=%s block_chars=%d leak_blocked=%d error=%s",
        session_id, institute_id, len(scope.open_ids()), len(result.hits), len(result.signposts),
        len(result.kb_hits), f"{top:.3f}" if top is not None else "-", result.latency_ms,
        total_ms, result.truncated, block_chars,
        result.leak_blocked, result.error or "-",
    )
    await keep(
        open_lessons=len(scope.open_ids()), hits=len(result.hits), signposts=len(result.signposts),
        kb_refs=len(result.kb_hits), top_similarity=top, latency_ms=int(result.latency_ms or 0), total_ms=total_ms,
        truncated=bool(result.truncated), block_chars=block_chars, leak_blocked=int(result.leak_blocked or 0),
        error=result.error,
    )


def _start_course_shadow_probe(
    session_id: str,
    user_id: str,
    institute_id: str,
    query: str,
    context_meta: Optional[Dict[str, Any]],
) -> None:
    """Fire the shadow probe without waiting for it: it must not slow the turn."""
    task = asyncio.create_task(
        _course_shadow_probe(session_id, user_id, institute_id, query, dict(context_meta or {}))
    )
    _SHADOW_TASKS.add(task)
    task.add_done_callback(_SHADOW_TASKS.discard)


class AiChatAgentService:
    """
    Orchestrates the AI chat agent with agentic capabilities and SSE support.
    Handles session management, message processing, and real-time streaming.

    Uses a DB session factory so that each database operation block opens and
    closes its own short-lived connection — no connection is held during
    long-running LLM calls or the SSE polling loop.
    """

    def __init__(self, db_session_factory: Callable):
        """
        Args:
            db_session_factory: Callable context-manager that yields a Session.
                                Typically ``db.db_session``.
        """
        self._db_factory = db_session_factory
        self.intent_classifier = IntentClassifierService()
        # Store active quizzes for evaluation (session_id -> QuizData)
        self._active_quizzes: Dict[str, QuizData] = {}

    # ── helpers ──────────────────────────────────────────────────────────

    def _get_db(self):
        """Return a context-managed short-lived DB session."""
        return self._db_factory()

    @staticmethod
    def _resolve_keys(db: Session, institute_id: str, user_id: str) -> tuple:
        """Pre-resolve API keys using the given DB session."""
        return ApiKeyResolver(db).resolve_keys(
            institute_id=institute_id,
            user_id=user_id,
            # Super-admin portal -> AI Settings -> "Chatbot model"
            platform_default_key="chatbot.text.model",
        )

    @staticmethod
    def _make_llm_client(keys: tuple) -> ChatLLMClient:
        """Create an LLM client with pre-resolved keys (no DB dependency).

        Reasoning is suppressed for the learner chatbot only (kill-switch:
        LLM_DISABLE_REASONING=false). This is the one workload where hidden
        reasoning tokens are not worth their cost: the median learner message is
        23 characters and most turns are greetings, "yes"/"idk" and quiz
        acknowledgements. Measured on qwen/qwen3.7-flash with a real student
        question — reasoning on: 6.9s / 1,358 completion tokens; off: 1.7s / 180,
        same answer quality. It is a no-op on gemini-2.5-flash, which already
        emits none. Every OTHER consumer of ChatLLMClient keeps reasoning.
        """
        from .platform_settings_service import get_platform_setting

        return ChatLLMClient(
            _CachedKeyResolver(keys),
            disable_reasoning=bool(
                get_platform_setting(
                    "chatbot.llm.disable_reasoning",
                    default=get_settings().llm_disable_reasoning,
                )
            ),
        )

    def _record_token_usage(
        self, response: Dict[str, Any], institute_id: str, user_id: str
    ):
        """Record token usage in its own short-lived DB session."""
        try:
            usage = response.get("usage", {})
            provider = response.get("provider", "unknown")
            model = response.get("model", "unknown")

            prompt_tokens = 0
            completion_tokens = 0
            total_tokens = 0

            if usage:
                if provider == "openrouter":
                    prompt_tokens = usage.get("prompt_tokens", 0)
                    completion_tokens = usage.get("completion_tokens", 0)
                    total_tokens = usage.get("total_tokens", 0)
                elif provider == "gemini":
                    prompt_tokens = usage.get("promptTokenCount", 0)
                    completion_tokens = usage.get("candidatesTokenCount", 0)
                    total_tokens = usage.get("totalTokenCount", 0)

            if total_tokens > 0:
                api_provider = ApiProvider.OPENAI
                if provider == "gemini":
                    api_provider = ApiProvider.GEMINI

                from .ai_billing import UC, metering_kwargs, metering_user, supported_kwargs

                # Usage-event attribution only (the learner chat agent is a
                # learner-app surface); the charge and ledger row are unchanged.
                meter = metering_kwargs(UC.LEARNER_ASSISTANT, metering_user(user_id, surface="LEARNER_APP"))
                with self._get_db() as db:
                    tus = TokenUsageService(db)
                    tus.record_usage_and_deduct_credits(
                        api_provider=api_provider,
                        prompt_tokens=prompt_tokens,
                        completion_tokens=completion_tokens,
                        total_tokens=total_tokens,
                        request_type=RequestType.AGENT,
                        institute_id=institute_id,
                        user_id=user_id,
                        model=model,
                        **supported_kwargs(tus.record_usage_and_deduct_credits, meter),
                    )
                logger.debug(f"Recorded usage for agent chat: {total_tokens} tokens")
        except Exception as e:
            logger.warning(f"Failed to record token usage for agent: {e}")

    def _store_course_sources(self, session_id: str, course_result: Any, final_text: str) -> Optional[dict]:
        """Store the "Sources" card for the course passages the answer cited
        ([n] markers), as its own card message like a tool card. Returns the
        SSE message data, or None when nothing was cited. Never raises."""
        try:
            from .course_knowledge import prompt_blocks

            cited = prompt_blocks.parse_citations(final_text)
            if not cited:
                return None
            card = prompt_blocks.sources_card(course_result, cited)
            if not card:
                return None
            with self._get_db() as db:
                card_msg = ChatMessageRepository(db).create_message(
                    session_id=session_id,
                    message_type="card",
                    content=card_fallback_markdown(card),
                    metadata={"card": card, "tool_name": "course_sources"},
                )
                return _msg_event(card_msg)
        except Exception as e:  # noqa: BLE001 - the answer is already stored
            logger.warning(f"Course sources card failed for session {session_id}: {e}")
            return None

    # ── public API ───────────────────────────────────────────────────────

    async def create_session(
        self,
        user_id: str,
        institute_id: str,
        context_type: Optional[str] = None,
        context_meta: Optional[Dict[str, Any]] = None,
        initial_message: Optional[str] = None,
        user_name: Optional[str] = None,
        session_mode: Optional[str] = "text",
        ui_language: Optional[str] = None,
        caller_verified: bool = False,
    ) -> tuple[str, str]:
        """Create a new chat session and optionally save an initial message.

        caller_verified is stamped on the initial message exactly as
        send_message stamps it (router-computed, never from the request body).
        """
        if context_type is None:
            context_type = "general"
        if context_meta is None:
            context_meta = {}
        if ui_language:
            # The app's UI language: the reply language when the student's own
            # message doesn't show one.
            context_meta = {**context_meta, "ui_language": ui_language[:20]}

        with self._get_db() as db:
            session_repo = ChatSessionRepository(db)
            message_repo = ChatMessageRepository(db)

            session = session_repo.create_session(
                user_id=user_id,
                institute_id=institute_id,
                context_type=context_type,
                context_meta=context_meta,
                session_mode=session_mode or "text",
            )

            logger.info(f"Created chat session {session.id} for user {user_id}")

            if initial_message:
                message_repo.create_message(
                    session_id=session.id,
                    message_type="user",
                    content=initial_message,
                    metadata={"caller_verified": True} if caller_verified is True else None,
                )

            session_id = session.id

        return (session_id, "idle")

    async def send_message(
        self,
        session_id: str,
        message: str,
        intent: Optional[MessageIntent] = None,
        quiz_submission: Optional[QuizSubmission] = None,
        idempotency_key: Optional[str] = None,
        attachments: Optional[List[Dict[str, Any]]] = None,
        caller_verified: bool = False,
    ) -> tuple[int, str]:
        """Send a message to an existing session.

        caller_verified comes from the router (a real token for the session's
        own learner and institute), never from the request body; it is what
        lets this turn read the learner's course content.
        """
        # Validate session
        with self._get_db() as db:
            session_repo = ChatSessionRepository(db)
            message_repo = ChatMessageRepository(db)

            session = session_repo.get_session_by_id(session_id)
            if not session:
                raise ValueError(f"Session {session_id} not found")
            if session.status != "ACTIVE":
                raise ValueError(f"Session {session_id} is not active")

            if idempotency_key:
                existing = message_repo.find_by_idempotency_key(
                    session_id, idempotency_key
                )
                if existing:
                    logger.info(
                        f"Duplicate message detected for idempotency key {idempotency_key}"
                    )
                    return (existing.id, "idle")

        # Extract LaTeX from image attachments via Mathpix OCR (async, no DB)
        enriched_message = message
        if not (message or "").strip() and attachments:
            # Image-only send: give the model (and the transcript) something to
            # anchor on; the image itself travels as an attachment.
            enriched_message = "Please look at the image I sent."
        if attachments:
            mathpix = MathpixService()
            for att in attachments:
                att_dict = att if isinstance(att, dict) else {}
                att_type = att_dict.get("type", "")
                att_url = att_dict.get("url", "")
                if att_type == "image" and att_url:
                    try:
                        ocr_result = await mathpix.ocr_image(att_url)
                        latex_content = ocr_result.get("latex", "")
                        if latex_content:
                            enriched_message += (
                                f"\n\n[Math from image: ${latex_content}$]"
                            )
                    except Exception as e:
                        logger.warning(f"Mathpix OCR failed for attachment: {e}")

        # Build metadata
        metadata: Dict[str, Any] = {}
        if intent:
            metadata["intent"] = intent.value
        if idempotency_key:
            metadata["idempotency_key"] = idempotency_key
        if quiz_submission:
            metadata["quiz_submission"] = quiz_submission.model_dump()
        if attachments:
            metadata["attachments"] = [
                att.copy() if isinstance(att, dict) else att for att in attachments
            ]
        if caller_verified is True:
            # Server-stamped only: metadata is built from typed fields above,
            # so a client cannot put this key here itself.
            metadata["caller_verified"] = True

        # Save message
        with self._get_db() as db:
            message_repo = ChatMessageRepository(db)
            session_repo = ChatSessionRepository(db)

            msg = message_repo.create_message(
                session_id=session_id,
                message_type="user",
                content=enriched_message,
                metadata=metadata if metadata else None,
            )
            session_repo.update_last_active(session_id)
            msg_id = msg.id

        return (msg_id, "idle")

    async def update_context(
        self,
        session_id: str,
        context_type: str,
        context_meta: Dict[str, Any],
        ui_language: Optional[str] = None,
    ) -> bool:
        """Update the context for an existing session without triggering AI response."""
        with self._get_db() as db:
            session_repo = ChatSessionRepository(db)
            session = session_repo.get_session_by_id(session_id)
            if not session:
                raise ValueError(f"Session {session_id} not found")
            if session.status != "ACTIVE":
                raise ValueError(f"Session {session_id} is not active")

            # A voice call's topic lives in context_meta (voice_topic), but the
            # learner app re-syncs context on route/slide changes with a payload
            # that never carries it. A resync must not silently drop what the
            # interview/test is about — it turned "parenting" into the French
            # Revolution in production.
            existing_meta = getattr(session, "context_meta", None) or {}
            if existing_meta.get("voice_topic") and not (context_meta or {}).get("voice_topic"):
                context_meta = {**(context_meta or {}), "voice_topic": existing_meta["voice_topic"]}
            # Same for the UI language: a resync must not reset it.
            language = (ui_language or "")[:20] or existing_meta.get("ui_language")
            if language:
                context_meta = {**(context_meta or {}), "ui_language": language}

            success = session_repo.update_context(
                session_id=session_id,
                context_type=context_type,
                context_meta=context_meta,
            )

        if success:
            logger.info(f"Context updated for session {session_id}: {context_type}")
        return success

    async def get_updates(
        self,
        session_id: str,
        last_message_id: Optional[int] = None,
    ) -> Dict[str, Any]:
        """Get new messages since last_message_id (fallback for non-SSE clients)."""
        with self._get_db() as db:
            session_repo = ChatSessionRepository(db)
            message_repo = ChatMessageRepository(db)

            session = session_repo.get_session_by_id(session_id)
            if not session:
                raise ValueError(f"Session {session_id} not found")

            messages = message_repo.get_messages_by_session(
                session_id=session_id,
                after_message_id=last_message_id,
            )

            latest = message_repo.get_latest_message(session_id)
            ai_status = (
                "thinking" if latest and latest.message_type == "user" else "idle"
            )

            # Materialise data before session closes
            messages_list = list(messages)
            session_status = session.status

        return {
            "messages": messages_list,
            "ai_status": ai_status,
            "session_status": session_status,
        }

    # ── exactly-once processing ──────────────────────────────────────────

    def _try_claim(self, session_id: str, message_id: int) -> bool:
        """Atomically take ownership of answering `message_id` (see CLAIM_*)."""
        try:
            with self._get_db() as db:
                row = db.execute(
                    _CLAIM_SQL,
                    {
                        "id": message_id,
                        "session_id": session_id,
                        "stale": CLAIM_STALE_SECONDS,
                        "max_age": CLAIM_MAX_AGE_SECONDS,
                    },
                ).first()
            return row is not None
        except Exception as e:  # noqa: BLE001
            logger.warning(f"Claim failed for message {message_id}: {e}")
            return False

    def _refresh_claim(self, message_id: Optional[int]) -> None:
        if not message_id:
            return
        try:
            with self._get_db() as db:
                db.execute(_REFRESH_CLAIM_SQL, {"id": message_id}).first()
        except Exception as e:  # noqa: BLE001
            logger.debug(f"Claim refresh failed for message {message_id}: {e}")

    def _mark_answered(self, message_id: Optional[int]) -> None:
        if not message_id:
            return
        try:
            with self._get_db() as db:
                db.execute(_MARK_ANSWERED_SQL, {"id": message_id}).first()
        except Exception as e:  # noqa: BLE001
            logger.warning(f"Could not mark message {message_id} answered: {e}")

    def _release_claim(self, message_id: Optional[int]) -> None:
        if not message_id:
            return
        try:
            with self._get_db() as db:
                db.execute(_RELEASE_CLAIM_SQL, {"id": message_id}).first()
        except Exception as e:  # noqa: BLE001
            logger.warning(f"Could not release the claim on message {message_id}: {e}")

    def _still_pending(self, message_id: int) -> bool:
        """False once the message is answered (by anyone) or too old to auto-answer."""
        try:
            with self._get_db() as db:
                row = db.execute(
                    _PENDING_STATE_SQL,
                    {"id": message_id, "max_age": CLAIM_MAX_AGE_SECONDS},
                ).first()
            if row is None:
                return False
            return not (row[0] or row[1])
        except Exception as e:  # noqa: BLE001
            logger.debug(f"Pending check failed for message {message_id}: {e}")
            return True

    def get_session_context(self, session_id: str):
        """(context_type, context_meta) of a session."""
        with self._get_db() as db:
            session = ChatSessionRepository(db).get_session_by_id(session_id)
            if not session:
                return None, {}
            return session.context_type, dict(session.context_meta or {})

    def get_message_content(self, session_id: str, message_id: int) -> Optional[str]:
        """A tutor reply's text (assistant messages only)."""
        with self._get_db() as db:
            msg = db.get(ChatMessage, message_id)
            if not msg or msg.session_id != session_id or msg.message_type != "assistant":
                return None
            return msg.content

    def get_session_identity(self, session_id: str) -> Optional[Dict[str, Any]]:
        """Owner and status of a session, for the router's ownership check."""
        with self._get_db() as db:
            session = ChatSessionRepository(db).get_session_by_id(session_id)
            if not session:
                return None
            return {
                "user_id": session.user_id,
                "institute_id": session.institute_id,
                "status": session.status,
            }

    # ── chat history & controls ──────────────────────────────────────────

    def list_sessions(self, user_id: str, institute_id: str, limit: int = 20) -> List[Dict[str, Any]]:
        """The learner's own text chats that have at least one question, newest first."""
        with self._get_db() as db:
            rows = db.execute(_LIST_SESSIONS_SQL, {
                "user_id": user_id,
                "institute_id": institute_id,
                "limit": max(1, min(limit, 50)),
            }).mappings().all()
        return [
            {
                "session_id": r["id"],
                "title": " ".join(str(r["title"] or "").split())[:80],
                "context_type": r["context_type"],
                "status": r["status"],
                "last_active": r["last_active"].isoformat() if r["last_active"] else None,
                "question_count": int(r["question_count"] or 0),
            }
            for r in rows
        ]

    def resume_session(self, session_id: str) -> str:
        """Reopen a chat (a closed one becomes ACTIVE again). Returns its status."""
        with self._get_db() as db:
            session = ChatSessionRepository(db).get_session_by_id(session_id)
            if not session:
                raise ValueError(f"Session {session_id} not found")
            session.status = "ACTIVE"
            session.last_active = datetime.utcnow()
            return session.status

    def set_saved(self, session_id: str, message_id: int, saved: bool) -> bool:
        """Bookmark (or un-bookmark) a tutor reply into the learner's Saved answers."""
        with self._get_db() as db:
            msg = db.get(ChatMessage, message_id)
            if not msg or msg.session_id != session_id or msg.message_type not in ("assistant", "card"):
                return False
            meta = dict(msg.meta_data or {})
            if saved:
                meta["saved_at"] = datetime.utcnow().isoformat() + "Z"
            else:
                meta.pop("saved_at", None)
            msg.meta_data = meta
            return True

    def list_saved(self, user_id: str, institute_id: str, limit: int = 50) -> List[Dict[str, Any]]:
        """The learner's saved replies across all their chats, newest saved first."""
        with self._get_db() as db:
            rows = db.execute(_LIST_SAVED_SQL, {
                "user_id": user_id, "institute_id": institute_id, "limit": max(1, min(limit, 100)),
            }).mappings().all()
        return [
            {
                "message_id": r["id"],
                "session_id": r["session_id"],
                "type": r["message_type"],
                "content": r["content"],
                "metadata": r["metadata"],
                "saved_at": (r["metadata"] or {}).get("saved_at"),
                "question": " ".join(str(r["question"] or "").split())[:160],
            }
            for r in rows
        ]

    def stop_turn(self, session_id: str) -> bool:
        """
        The learner pressed Stop: mark the newest unanswered question answered,
        so no stream (this one reconnecting, or another tab) picks it up again.
        The cancelled stream keeps what it had written (see the agent loop).
        """
        with self._get_db() as db:
            latest = ChatMessageRepository(db).get_latest_message(session_id)
            if not latest or latest.message_type != "user":
                return False
            meta = dict(latest.meta_data or {})
            if meta.get("answered_at"):
                return False
            meta["answered_at"] = datetime.utcnow().isoformat() + "Z"
            meta["stopped_by_learner"] = True
            latest.meta_data = meta
            return True

    def set_feedback(self, session_id: str, message_id: int, rating: str, comment: Optional[str]) -> bool:
        """Thumbs up/down on one of the tutor's replies, kept on the message."""
        with self._get_db() as db:
            msg = db.get(ChatMessage, message_id)
            if not msg or msg.session_id != session_id or msg.message_type not in ("assistant", "card", "quiz_feedback"):
                return False
            meta = dict(msg.meta_data or {})
            meta["feedback"] = {
                "rating": rating,
                "comment": (comment or "").strip()[:500] or None,
                "at": datetime.utcnow().isoformat() + "Z",
            }
            msg.meta_data = meta
            return True

    async def stream_session(
        self,
        session_id: str,
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """
        Stream messages for a session via SSE.

        Replays the transcript, then polls for new rows every 2 s. The newest
        unanswered user message is answered by whichever open stream wins its
        claim; every other stream relays the rows the winner writes. Uses
        short-lived DB sessions so the pool is never held across the loop.
        """
        with self._get_db() as db:
            session = ChatSessionRepository(db).get_session_by_id(session_id)
            if not session:
                raise ValueError(f"Session {session_id} not found")
            user_id = session.user_id
            institute_id = session.institute_id
            session_status = session.status

        logger.info(f"SSE stream started for session {session_id}")

        with self._get_db() as db:
            existing_messages = ChatMessageRepository(db).get_messages_by_session(
                session_id
            )

        # `cursor` only ever advances through rows this stream has READ from the
        # table, never through ids it produced itself. Rows written by our own
        # processing are remembered in `sent` so the next poll skips them. (The
        # old loop advanced to the highest id it had produced, which silently
        # skipped a learner message that landed while a reply was generating.)
        cursor = 0
        sent: set = set()
        pending: Optional[int] = None

        def _relay(msg) -> Dict[str, Any]:
            sent.add(msg.id)
            return {"event": "message", "data": _msg_event(msg)}

        for msg in existing_messages:
            cursor = msg.id
            yield _relay(msg)
        # The last question is still open when nothing but tool scaffolding
        # (rows the learner never sees) follows it: the stream answering it went
        # away mid-turn. The claim decides whether it is really unanswered.
        for msg in reversed(existing_messages):
            if msg.message_type == "user":
                pending = msg.id
                break
            if msg.message_type not in ("tool_call", "tool_result"):
                break

        if not existing_messages:
            async for event in self._stream_greeting_generation(
                session_id, user_id, institute_id
            ):
                if event.get("event") == "message" and event.get("data", {}).get("id"):
                    sent.add(event["data"]["id"])
                yield event

        yield {
            "event": "status",
            "data": {"ai_status": "idle", "session_status": session_status},
        }

        idle_iterations = 0
        max_idle_iterations = (30 * 60) // 2  # 30 minutes of nothing new

        while True:
            if pending is not None:
                if self._try_claim(session_id, pending):
                    claimed = pending
                    pending = None
                    idle_iterations = 0
                    logger.info(
                        f"Answering message {claimed} for session {session_id}"
                    )
                    yield {
                        "event": "status",
                        "data": {"ai_status": "thinking", "session_status": session_status},
                    }
                    # The reply is produced inside this stream. If the learner
                    # leaves mid-turn the generator is closed/cancelled here: the
                    # question was NOT answered, so release it and the next stream
                    # (the chat reopened) answers it. It used to be marked answered,
                    # which left the question without a reply for good.
                    try:
                        async for event in self._stream_agentic_processing(
                            session_id, user_id, institute_id, message_id=claimed
                        ):
                            if event.get("event") == "message" and event.get("data", {}).get("id"):
                                sent.add(event["data"]["id"])
                            yield event
                    except (GeneratorExit, asyncio.CancelledError):
                        logger.info(f"Stream left mid-turn; releasing message {claimed} for session {session_id}")
                        self._release_claim(claimed)
                        raise
                    except BaseException:
                        self._mark_answered(claimed)
                        raise
                    self._mark_answered(claimed)
                    yield {
                        "event": "status",
                        "data": {"ai_status": "idle", "session_status": session_status},
                    }
                elif not self._still_pending(pending):
                    pending = None

            with self._get_db() as db:
                new_messages = ChatMessageRepository(db).get_messages_by_session(
                    session_id=session_id,
                    after_message_id=cursor,
                )

            if new_messages:
                idle_iterations = 0
                newest_user: Optional[int] = None
                for msg in new_messages:
                    cursor = msg.id
                    if msg.message_type == "user":
                        newest_user = msg.id
                    if msg.id in sent:
                        continue
                    yield _relay(msg)
                if newest_user is not None and newest_user not in (pending,):
                    # Answer the newest question; earlier unanswered ones in the
                    # same burst are in the history the model sees.
                    pending = newest_user
                if pending is not None:
                    # Another stream may already be answering it — tell the UI.
                    yield {
                        "event": "status",
                        "data": {"ai_status": "thinking", "session_status": session_status},
                    }
                    continue
            elif pending is None:
                idle_iterations += 1
                if idle_iterations >= max_idle_iterations:
                    logger.info(
                        f"Session {session_id} idle for 30 minutes, closing stream"
                    )
                    break

            with self._get_db() as db:
                session = ChatSessionRepository(db).get_session_by_id(session_id)
            if not session or session.status == "CLOSED":
                logger.info(f"Session {session_id} closed, ending stream")
                break
            session_status = session.status

            yield {"event": "comment", "data": {"message": "keepalive"}}
            await asyncio.sleep(2)

        logger.info(f"SSE stream ended for session {session_id}")

    async def close_session(self, session_id: str) -> tuple[bool, int]:
        """Close a chat session."""
        with self._get_db() as db:
            session_repo = ChatSessionRepository(db)
            message_repo = ChatMessageRepository(db)
            success = session_repo.close_session(session_id)
            if success:
                count = message_repo.count_messages_by_session(session_id)
                return (True, count)
        return (False, 0)

    # ── private processing methods ───────────────────────────────────────

    async def _stream_greeting_generation(
        self,
        session_id: str,
        user_id: str,
        institute_id: str,
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """Generate personalised AI greeting for a new session."""
        try:
            # ── Phase 1: read context from DB ──
            with self._get_db() as db:
                session = ChatSessionRepository(db).get_session_by_id(session_id)
                if not session:
                    return

                context = await ContextResolverService(db).resolve_context(
                    session.context_type,
                    session.context_meta,
                    user_id,
                    institute_id,
                )
                ui_language = (session.context_meta or {}).get("ui_language")

                inst_settings = InstituteSettingsService(db)
                ai_settings = inst_settings.get_ai_settings(institute_id)
                institute_rules = inst_settings.format_rules_for_prompt(ai_settings)
                temperature = inst_settings.get_temperature(ai_settings)

                keys = self._resolve_keys(db, institute_id, user_id)
            # ── DB released ──

            from .platform_settings_service import get_platform_setting

            use_llm = bool(get_platform_setting("chatbot.text.llm_greeting", default=False))
            if not use_llm:
                greeting_content = template_greeting(
                    assistant_name=str(ai_settings.get("assistant_name") or "").strip(),
                    context=context,
                    ui_language=ui_language,
                )
                with self._get_db() as db:
                    greeting_msg = ChatMessageRepository(db).create_message(
                        session_id=session_id,
                        message_type="assistant",
                        content=greeting_content,
                    )
                    msg_data = _msg_event(greeting_msg)
                yield {"event": "message", "data": msg_data}
                return

            system_prompt = self._build_system_prompt(
                institute_rules, context, user_id, institute_id, is_greeting=True,
                ui_language=ui_language,
            )
            messages = [{"role": "system", "content": system_prompt}]

            # ── Phase 2: LLM call (no DB held) ──
            try:
                llm_client = self._make_llm_client(keys)
                response = await llm_client.chat_completion(
                    messages=messages,
                    tools=None,
                    temperature=temperature,
                    institute_id=institute_id,
                    user_id=user_id,
                )

                self._record_token_usage(response, institute_id, user_id)
                greeting_content = split_suggestions(
                    response.get("content") or "Hi! How can I help you today?"
                )[0]

            except Exception as e:
                logger.error(f"Error generating greeting: {e}")
                greeting_content = (
                    "Hi! I'm your AI tutor. How can I help you today?"
                )

            # ── Phase 3: save to DB ──
            with self._get_db() as db:
                greeting_msg = ChatMessageRepository(db).create_message(
                    session_id=session_id,
                    message_type="assistant",
                    content=greeting_content,
                )
                msg_data = _msg_event(greeting_msg)

            yield {"event": "message", "data": msg_data}

        except Exception as e:
            logger.error(
                f"Error in greeting generation for session {session_id}: {e}"
            )

    async def _stream_agentic_processing(
        self,
        session_id: str,
        user_id: str,
        institute_id: str,
        message_id: Optional[int] = None,
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """
        Main agentic processing loop with tool calling support.
        Streams events as they happen.

        DB sessions are acquired only for short DB-bound phases and released
        before every LLM call so the connection pool is not blocked.
        """
        try:
            # ── Phase 1: gather all context from DB ──
            with self._get_db() as db:
                session_repo = ChatSessionRepository(db)
                message_repo = ChatMessageRepository(db)

                session = session_repo.get_session_by_id(session_id)
                if not session:
                    return

                # Answer the message this stream claimed — not "whatever is
                # newest", which may be a later message another stream owns.
                if message_id is not None:
                    latest_msg = db.get(ChatMessage, message_id)
                else:
                    latest_msg = message_repo.get_latest_message(session_id)
                if (
                    not latest_msg
                    or latest_msg.message_type != "user"
                    or latest_msg.session_id != session_id
                ):
                    return

                # Materialise ORM data into local variables
                latest_msg_content = latest_msg.content
                latest_msg_meta_data = latest_msg.meta_data
                msg_metadata = latest_msg.meta_data or {}

                # Resolve context
                resolver = ContextResolverService(db)
                context = await resolver.resolve_context(
                    session.context_type,
                    session.context_meta,
                    user_id,
                    institute_id,
                )
                pending_lesson = getattr(resolver, "pending_lesson", None)
                ui_language = (session.context_meta or {}).get("ui_language")
                session_context_meta = dict(session.context_meta or {})

                # Pre-resolve API keys
                keys = self._resolve_keys(db, institute_id, user_id)
                llm_client = self._make_llm_client(keys)

                # Get optimised conversation history
                optimized_history = ContextWindowService(
                    db, message_repo, llm_client
                ).get_optimized_history(session_id)

                # Fetch institute AI settings
                inst_settings = InstituteSettingsService(db)
                ai_settings = inst_settings.get_ai_settings(institute_id)
                institute_rules = inst_settings.format_rules_for_prompt(ai_settings)
                temperature = inst_settings.get_temperature(ai_settings)

                # Auto-search the institute's knowledge base.
                #
                # Reads kb_chunk (V435) rather than content_embeddings, so anything
                # an admin adds to the "Institute Info" knowledge base — pasted
                # notes, an uploaded fee-policy PDF, a scraped notices page —
                # becomes answerable here, not just the legacy typed items.
                #
                # Scoped to purpose='institute_info' ON PURPOSE. This assistant is
                # student/lead-facing, and letting a fee question retrieve out of a
                # Class 9 Science textbook would be worse than finding nothing.
                # Broadening it to teaching corpora is a product decision, not a
                # tidy-up — it changes what this bot will answer.
                kb_context = ""
                try:
                    from .kb.retrieval import KbRetrievalService

                    kb_items = await KbRetrievalService(db).search_institute(
                        institute_id=institute_id,
                        query=latest_msg_content,
                        top_k=3,
                        similarity_threshold=0.35,
                        purposes=["institute_info"],
                    )
                    if kb_items:
                        kb_snippets = []
                        for item in kb_items:
                            title = item.get("source_title") or ""
                            meta = item.get("metadata") or {}
                            category = str(meta.get("category") or "general")
                            text = item.get("content_text", "")
                            header = (
                                f"[{category.upper()}] {title}"
                                if title
                                else f"[{category.upper()}]"
                            )
                            kb_snippets.append(f"- {header}: {text}")
                        kb_context = (
                            "\n\nINSTITUTE KNOWLEDGE BASE "
                            "(use this information when relevant to the student's question):\n"
                            + "\n".join(kb_snippets)
                        )
                        logger.info(
                            f"KB search found {len(kb_items)} relevant items "
                            f"for session {session_id}"
                        )
                except Exception as e:
                    logger.warning(f"KB search failed (non-critical): {e}")

                # Extract quiz submission data before session closes
                quiz_submission_data = msg_metadata.get("quiz_submission")
            # ── DB released ──

            # A lesson nobody has asked about yet (video captions, a SCORM
            # package…) is being read now. Wait briefly (no DB held) so this
            # turn sees the lesson text.
            if pending_lesson is not None:
                apply_lesson_text(context["context_data"], pending_lesson, await wait_for_lesson_text(pending_lesson))

            # Context gathering (KB embedding search) can take seconds.
            self._refresh_claim(message_id)

            # Handle quiz submission (manages its own sessions)
            if quiz_submission_data:
                logger.info(
                    f"Processing quiz submission for session {session_id}"
                )
                async for event in self._handle_quiz_submission(
                    session_id,
                    quiz_submission_data,
                    context,
                    institute_id,
                    user_id,
                    llm_client,
                ):
                    yield event
                return

            # Classify intent (no DB needed)
            explicit_intent = None
            if msg_metadata.get("intent"):
                explicit_intent = MessageIntent(msg_metadata["intent"])

            intent = self.intent_classifier.classify(
                message=latest_msg_content,
                explicit_intent=explicit_intent,
            )
            logger.info(f"Message intent for session {session_id}: {intent}")

            # Track doubt analytics
            if intent == MessageIntent.DOUBT:
                try:
                    topic = self.intent_classifier.get_practice_topic(
                        latest_msg_content, context
                    )
                    with self._get_db() as db:
                        LearningAnalyticsService(db).track_doubt(
                            user_id=user_id,
                            institute_id=institute_id,
                            topic=topic,
                            content=latest_msg_content,
                            session_id=session_id,
                        )
                except Exception as e:
                    logger.warning(f"Failed to track doubt analytics: {e}")

            # Only an EXPLICIT practice intent from the app skips the model.
            # A keyword guess no longer does: "quiz"/"practice"/"exercise" in
            # a message sent 646 messages a month straight into 10-question
            # quiz generation — pasted questions, "how to practice the
            # assessment", and 354 bare "Quiz me on " sends. The model now
            # decides, through the create_practice_quiz tool.
            if intent == MessageIntent.PRACTICE and explicit_intent == MessageIntent.PRACTICE:
                async for event in self._handle_practice_request(
                    session_id,
                    latest_msg_content,
                    context,
                    institute_id,
                    user_id,
                    llm_client,
                ):
                    yield event
                return

            # ── Course knowledge (no DB held) ──
            # Only for a caller the router verified (a real token for this
            # session's learner and institute), and only when the institute's
            # course-knowledge gate is active. Every read runs in its own short
            # session inside course_knowledge; nothing here touches self._get_db.
            # Any failure means no course context for this turn.
            course_block: Optional[str] = None
            course_result = None
            course_tool_on = False
            if msg_metadata.get("caller_verified") is True:
                try:
                    from .course_knowledge import learner_tool, settings_store

                    gate = await asyncio.to_thread(settings_store.learner_gate, institute_id)
                    if gate.active and gate.mode == "on":
                        course_tool_on = True
                        course_block, course_result = await learner_tool.course_context_for_turn(
                            user_id,
                            institute_id,
                            query=latest_msg_content,
                            context_meta=session_context_meta,
                        )
                    elif gate.active and gate.mode == "shadow":
                        _start_course_shadow_probe(
                            session_id, user_id, institute_id,
                            latest_msg_content, session_context_meta,
                        )
                except Exception as e:  # noqa: BLE001 - course context is optional
                    logger.warning(f"Course context skipped for session {session_id}: {e}")
                    course_block, course_result, course_tool_on = None, None, False

            # ── Phase 2: build prompt and run agentic loop ──

            system_prompt = self._build_system_prompt(
                institute_rules,
                context,
                user_id,
                institute_id,
                is_greeting=False,
                is_doubt=(intent == MessageIntent.DOUBT),
                ui_language=ui_language,
            )
            if course_tool_on:
                # search_my_course replaces search_related_resources below; the
                # routing line must name the tool actually offered.
                system_prompt = _with_course_tool_guidance(system_prompt)
            if kb_context:
                system_prompt += kb_context
            if course_block:
                system_prompt += "\n\n" + course_block

            messages: List[Dict[str, Any]] = [
                {"role": "system", "content": system_prompt}
            ]
            if course_tool_on:
                messages.extend(optimized_history)
            else:
                # Course text from an earlier verified turn must not reach a turn
                # that may not read it (unverified caller, gate off, kill switch).
                # A no-op for sessions that never ran search_my_course.
                messages.extend(_withhold_course_tool_results(optimized_history, _COURSE_TOOL_NAME))

            # Add attachments to the latest user message if present
            if latest_msg_meta_data and latest_msg_meta_data.get("attachments"):
                for i in range(len(messages) - 1, -1, -1):
                    if messages[i].get("role") == "user":
                        messages[i]["attachments"] = latest_msg_meta_data[
                            "attachments"
                        ]
                        break

            max_iterations = 5
            iteration = 0
            tools = TOOL_DEFINITIONS
            course_tool_name: Optional[str] = None
            if course_tool_on:
                # The learner's own course replaces the generic resource search;
                # every other tool stays.
                from .course_knowledge import learner_tool

                course_tool_name = learner_tool.TOOL_NAME
                tools = _with_course_tool(TOOL_DEFINITIONS, learner_tool.SEARCH_MY_COURSE_TOOL)

            while iteration < max_iterations:
                iteration += 1
                self._refresh_claim(message_id)
                logger.info(
                    f"Agentic loop iteration {iteration} for session {session_id}"
                )

                # ── LLM call (no DB held!) ──
                try:
                    full_content = ""
                    tool_calls_result = None
                    usage_data = None

                    # The last round gets no tools, so a turn that keeps
                    # calling tools still ends with an answer.
                    try:
                        async for chunk in llm_client.chat_completion_stream(
                            messages=messages,
                            tools=tools if iteration < max_iterations else None,
                            temperature=temperature,
                            institute_id=institute_id,
                            user_id=user_id,
                        ):
                            if chunk["type"] == "token":
                                full_content += chunk["content"]
                                yield {
                                    "event": "token",
                                    "data": {"content": chunk["content"]},
                                }
                            elif chunk["type"] == "tool_calls":
                                tool_calls_result = chunk["tool_calls"]
                            elif chunk["type"] == "done":
                                usage_data = chunk
                    except (asyncio.CancelledError, GeneratorExit):
                        # The learner pressed Stop (the app closed the stream).
                        # Keep what was already written instead of losing it.
                        partial = split_suggestions(full_content)[0]
                        if partial.strip():
                            try:
                                with self._get_db() as db:
                                    ChatMessageRepository(db).create_message(
                                        session_id=session_id,
                                        message_type="assistant",
                                        content=partial,
                                        metadata={"stopped": True},
                                    )
                            except Exception:  # noqa: BLE001
                                logger.warning(f"Could not keep the stopped reply for {session_id}")
                        raise

                    # Record token usage (opens its own session)
                    if usage_data:
                        self._record_token_usage(
                            {
                                "usage": usage_data.get("usage"),
                                "provider": usage_data.get("provider"),
                                "model": usage_data.get("model"),
                            },
                            institute_id,
                            user_id,
                        )

                except Exception as e:
                    logger.error(f"LLM call failed: {e}")
                    is_payment_error = (
                        "402" in str(e) or "Payment Required" in str(e)
                    )
                    if is_payment_error:
                        error_content = (
                            "AI service credits have been exhausted. "
                            "Please contact your administrator to add more credits."
                        )
                        logger.error(
                            f"OpenRouter 402 error for session {session_id}, "
                            f"institute {institute_id}: {e}"
                        )
                    else:
                        error_content = (
                            "I encountered an error processing your request. "
                            "Please try again."
                        )

                    yield {
                        "event": "error",
                        "data": {
                            "type": "ERROR",
                            "code": 402 if is_payment_error else 500,
                            "message": error_content,
                        },
                    }

                    with self._get_db() as db:
                        error_msg = ChatMessageRepository(db).create_message(
                            session_id=session_id,
                            message_type="assistant",
                            content=error_content,
                        )
                        error_data = _msg_event(error_msg)
                    yield {"event": "message", "data": error_data}
                    break

                tool_calls = tool_calls_result

                logger.info(
                    f"LLM response received for session {session_id}, "
                    f"tool_calls: {bool(tool_calls)}, content: {bool(full_content)}"
                )

                if not tool_calls:
                    # No tool calls — final response (tokens already streamed)
                    final_content = full_content
                    logger.info(
                        f"Final response for session {session_id}, "
                        f"content length: {len(final_content) if final_content else 0}"
                    )
                    final_content, suggestions = split_suggestions(final_content)
                    if final_content:
                        logger.info(
                            f"Creating assistant message for session {session_id}"
                        )
                        with self._get_db() as db:
                            msg = ChatMessageRepository(db).create_message(
                                session_id=session_id,
                                message_type="assistant",
                                content=final_content,
                                metadata={"suggestions": suggestions} if suggestions else None,
                            )
                            msg_data = _msg_event(msg)
                        logger.info(
                            f"Created message {msg_data['id']}, yielding to SSE stream"
                        )
                        yield {"event": "message", "data": msg_data}
                        # The [n] course passages the answer cited, as a card.
                        if course_result is not None:
                            sources_data = self._store_course_sources(
                                session_id, course_result, final_content
                            )
                            if sources_data:
                                yield {"event": "message", "data": sources_data}
                    else:
                        logger.warning(
                            f"LLM returned empty content for session {session_id}"
                        )
                    break

                # Text streamed alongside tool calls ("Let me look that up")
                # was shown to the learner and then dropped; keep it.
                pre_text = split_suggestions(full_content)[0]
                if pre_text.strip():
                    with self._get_db() as db:
                        pre_msg = ChatMessageRepository(db).create_message(
                            session_id=session_id,
                            message_type="assistant",
                            content=pre_text,
                        )
                        pre_data = _msg_event(pre_msg)
                    yield {"event": "message", "data": pre_data}

                # ── Process tool calls ──
                for tool_call in tool_calls:
                    tool_name = tool_call["function"]["name"]
                    tool_args_str = tool_call["function"]["arguments"]

                    try:
                        tool_args = (
                            json.loads(tool_args_str)
                            if isinstance(tool_args_str, str)
                            else tool_args_str
                        )
                    except json.JSONDecodeError:
                        tool_args = {}

                    if "user_id" in tool_args and not tool_args["user_id"]:
                        tool_args["user_id"] = user_id

                    # Record the call BEFORE running it, so the learner app's
                    # tool indicator ("Checking your progress...") is up while
                    # the tool actually runs. (It used to arrive after the
                    # result, so the indicator flashed for zero time and a canned
                    # English filler line was stored as a reply instead.)
                    with self._get_db() as db:
                        tool_call_msg = ChatMessageRepository(db).create_message(
                            session_id=session_id,
                            message_type="tool_call",
                            content=f"Calling tool: {tool_name}",
                            metadata={
                                "tool_name": tool_name,
                                "tool_arguments": tool_args,
                                "tool_call_id": tool_call["id"],
                            },
                        )
                        tool_call_data = _msg_event(tool_call_msg)
                    yield {"event": "message", "data": tool_call_data}
                    self._refresh_claim(message_id)

                    tool_card = None
                    if tool_name in ORCHESTRATOR_TOOLS:
                        # The quiz is a chat message of its own, not text for
                        # the model: generate it, show it, and tell the model
                        # what was shown.
                        quiz_outcome: Dict[str, Any] = {}
                        async for event in self._generate_quiz(
                            session_id=session_id,
                            topic=str(tool_args.get("topic") or "").strip(),
                            num_questions=tool_args.get("num_questions"),
                            difficulty=tool_args.get("difficulty"),
                            context=context,
                            user_message=latest_msg_content,
                            institute_id=institute_id,
                            user_id=user_id,
                            llm_client=llm_client,
                            outcome=quiz_outcome,
                        ):
                            yield event
                        tool_result = quiz_outcome.get("tool_result") or (
                            "The quiz could not be created. Apologise briefly and offer to explain "
                            "the topic instead."
                        )
                        # One quiz per turn: the model gets no second go.
                        tools = [
                            t for t in tools
                            if t["function"]["name"] not in ORCHESTRATOR_TOOLS
                        ] or None
                    elif course_tool_name and tool_name in (course_tool_name, _RESOURCE_SEARCH_TOOL):
                        # Runs WITHOUT self._get_db(): the course search embeds
                        # the query and opens its own short sessions, so no
                        # pooled connection is held across the network call.
                        # search_related_resources is not offered on this turn;
                        # a model calling it from memory searches the learner's
                        # course instead of the generic resource index.
                        from .course_knowledge import learner_tool

                        course_args = tool_args
                        if tool_name == _RESOURCE_SEARCH_TOOL:
                            topic = tool_args.get("topic") if isinstance(tool_args, dict) else None
                            course_args = {"query": str(topic or "")}
                        tool_output = await learner_tool.run_search_my_course(
                            user_id=user_id,
                            institute_id=institute_id,
                            args=course_args,
                            context_meta=session_context_meta,
                        )
                        tool_result, tool_card = split_tool_output(tool_output)
                    else:
                        with self._get_db() as db:
                            cached_resolver = _CachedKeyResolver(keys)
                            embedding_service = EmbeddingService(cached_resolver)
                            rag_service = RAGService(db, embedding_service)
                            analytics_service = LearningAnalyticsService(db)
                            tool_manager = ToolManagerService(
                                db,
                                rag_service=rag_service,
                                analytics_service=analytics_service,
                                institute_id=institute_id,
                                user_id=user_id,
                                context_meta=session_context_meta,
                            )
                            tool_output = await tool_manager.execute_tool(
                                tool_name, tool_args
                            )
                        tool_result, tool_card = split_tool_output(tool_output)
                        if tool_name in ONCE_PER_TURN_TOOLS:
                            # One hand-off per turn — a second call would file a duplicate doubt.
                            tools = [
                                t for t in (tools or [])
                                if t["function"]["name"] != tool_name
                            ] or None

                    with self._get_db() as db:
                        tool_result_msg = ChatMessageRepository(db).create_message(
                            session_id=session_id,
                            message_type="tool_result",
                            content=tool_result,
                            metadata={
                                "tool_name": tool_name,
                                "tool_call_id": tool_call["id"],
                            },
                        )
                        tool_result_data = _msg_event(tool_result_msg)
                    yield {"event": "message", "data": tool_result_data}

                    # A tool may hand back something to SHOW (links, progress)
                    # alongside the text the model reads. It is its own message
                    # so it renders as a card and survives a reload; `content`
                    # is the plain-markdown fallback for older app builds and
                    # the admin transcript viewer.
                    if tool_card:
                        with self._get_db() as db:
                            card_msg = ChatMessageRepository(db).create_message(
                                session_id=session_id,
                                message_type="card",
                                content=card_fallback_markdown(tool_card),
                                metadata={"card": tool_card, "tool_name": tool_name},
                            )
                            card_data = _msg_event(card_msg)
                        yield {"event": "message", "data": card_data}

                    # Append to conversation for next LLM call
                    messages.append(
                        {
                            "role": "assistant",
                            "content": None,
                            "tool_calls": [tool_call],
                        }
                    )
                    messages.append(
                        {
                            "role": "tool",
                            "content": tool_result,
                            "tool_call_id": tool_call["id"],
                            "name": tool_name,
                        }
                    )

                # Continue loop to process tool results

            # Update session last_active
            with self._get_db() as db:
                ChatSessionRepository(db).update_last_active(session_id)

            # Check if conversation needs summarisation
            # NOTE: generate_summary() calls the LLM while holding a DB session.
            # This is acceptable because it's rare and happens after main processing.
            try:
                with self._get_db() as db:
                    message_repo = ChatMessageRepository(db)
                    context_window = ContextWindowService(
                        db, message_repo, llm_client
                    )
                    if context_window.should_summarize(session_id):
                        await context_window.generate_summary(
                            session_id, institute_id, user_id
                        )
            except Exception as summary_err:
                logger.warning(
                    f"Non-critical: summary generation failed for "
                    f"{session_id}: {summary_err}"
                )

        except Exception as e:
            logger.error(
                f"Error in agentic processing for session {session_id}: {e}"
            )
            is_payment_error = (
                "402" in str(e) or "Payment Required" in str(e)
            )
            if is_payment_error:
                error_content = (
                    "AI service credits have been exhausted. "
                    "Please contact your administrator to add more credits."
                )
                logger.error(
                    f"OpenRouter 402 error for session {session_id}: {e}"
                )
            else:
                error_content = (
                    "I encountered an error processing your request. "
                    "Please try again."
                )

            yield {
                "event": "error",
                "data": {
                    "type": "ERROR",
                    "code": 402 if is_payment_error else 500,
                    "message": error_content,
                },
            }

            with self._get_db() as db:
                error_msg = ChatMessageRepository(db).create_message(
                    session_id=session_id,
                    message_type="assistant",
                    content=error_content,
                )
                error_data = _msg_event(error_msg)
            yield {"event": "message", "data": error_data}

    async def _handle_practice_request(
        self,
        session_id: str,
        user_message: str,
        context: Dict[str, Any],
        institute_id: str,
        user_id: str,
        llm_client: ChatLLMClient,
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """Explicit practice intent from the app (no model turn): quiz on the current topic."""
        topic = self.intent_classifier.get_practice_topic(user_message, context)
        if topic in ("Current Topic", "current topic"):
            with self._get_db() as db:
                ask_msg = ChatMessageRepository(db).create_message(
                    session_id=session_id,
                    message_type="assistant",
                    content=(
                        "What topic would you like to practice? "
                        "Please specify, for example:\n"
                        '- "Quiz me on quadratic equations"\n'
                        '- "Practice photosynthesis"\n'
                        '- "Test me on Newton\'s laws"'
                    ),
                )
                ask_data = _msg_event(ask_msg)
            yield {"event": "message", "data": ask_data}
            return
        outcome: Dict[str, Any] = {}
        async for event in self._generate_quiz(
            session_id=session_id,
            topic=topic,
            num_questions=None,
            difficulty=None,
            context=context,
            user_message=user_message,
            institute_id=institute_id,
            user_id=user_id,
            llm_client=llm_client,
            outcome=outcome,
        ):
            yield event
        if not outcome.get("shown"):
            with self._get_db() as db:
                fail_msg = ChatMessageRepository(db).create_message(
                    session_id=session_id,
                    message_type="assistant",
                    content=(
                        "I couldn't make a quiz on that just now. Tell me the specific topic "
                        "you'd like to practise, or ask me to explain it instead."
                    ),
                )
                fail_data = _msg_event(fail_msg)
            yield {"event": "message", "data": fail_data}

    async def _generate_quiz(
        self,
        session_id: str,
        topic: str,
        num_questions: Any,
        difficulty: Any,
        context: Dict[str, Any],
        user_message: str,
        institute_id: str,
        user_id: str,
        llm_client: ChatLLMClient,
        outcome: Dict[str, Any],
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """
        Generate a quiz, store its answer key, and post it as a `quiz` message.

        Used by the create_practice_quiz tool (the model chose topic, count and
        difficulty) and by the explicit practice intent. On return,
        outcome["tool_result"] says what happened, for the model.
        """
        try:
            n = int(num_questions) if num_questions not in (None, "") else 5
        except (TypeError, ValueError):
            n = 5
        n = max(3, min(10, n))
        level = difficulty if difficulty in ("easy", "medium", "hard") else "medium"
        topic = (topic or "").strip()[:200]
        if not topic:
            outcome["tool_result"] = (
                "No topic was given, so no quiz was created. Ask the student what they want "
                "to practise."
            )
            return

        yield {"event": "status", "data": {"ai_status": "generating_quiz"}}
        try:
            quiz_context = dict(context)
            quiz_context["context_data"] = dict(quiz_context.get("context_data") or {})
            existing_content = quiz_context["context_data"].get("content", "")
            quiz_context["context_data"]["content"] = (
                f"{existing_content}\n\nUser's request: {user_message}"
                if existing_content
                else f"User's request: {user_message}"
            )

            quiz_service = QuizService(llm_client)
            quiz_data = await quiz_service.generate_quiz(
                topic=topic,
                context=quiz_context,
                num_questions=n,
                difficulty=level,
                institute_id=institute_id,
                user_id=user_id,
            )
            if not quiz_data.questions:
                outcome["tool_result"] = (
                    f"Quiz generation for '{topic}' returned no questions. Tell the student "
                    "briefly, and offer to explain the topic or try a more specific one."
                )
                return

            # The DB row is the answer key that survives restarts and deploys
            # between generation and submission; the dict is a per-request
            # fast path only.
            self._active_quizzes[session_id] = quiz_data
            with self._get_db() as db:
                ChatQuizStateRepository(db).save(
                    session_id=session_id,
                    quiz_id=quiz_data.quiz_id,
                    quiz_payload=quiz_data.model_dump(),
                )

            frontend_quiz_data = quiz_service.get_quiz_for_frontend(quiz_data)
            with self._get_db() as db:
                quiz_msg = ChatMessageRepository(db).create_message(
                    session_id=session_id,
                    message_type="quiz",
                    content=(
                        f"Here's your quiz on **{quiz_data.topic or topic}**! "
                        f"Answer all {quiz_data.total_questions} questions "
                        "and submit when ready."
                    ),
                    metadata={"quiz_data": frontend_quiz_data},
                )
                quiz_event = _msg_event(quiz_msg)
            yield {"event": "message", "data": quiz_event}
            logger.info(f"Quiz generated for session {session_id}: {quiz_data.quiz_id}")
            outcome["shown"] = True
            outcome["tool_result"] = (
                f"A {quiz_data.total_questions}-question {level} quiz on '{quiz_data.topic or topic}' "
                "is now on screen as an interactive card; it is scored automatically when they "
                "submit. Do NOT list the questions or answers. Reply with one short, encouraging "
                "line in the student's language."
            )
        except Exception as e:
            logger.error(f"Error generating quiz for session {session_id}: {e}")
            outcome["tool_result"] = (
                "Quiz generation failed. Apologise briefly and offer to explain the topic instead."
            )

    async def _handle_quiz_submission(
        self,
        session_id: str,
        submission_data: Dict[str, Any],
        context: Dict[str, Any],
        institute_id: str,
        user_id: str,
        llm_client: ChatLLMClient,
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """Handle quiz submission and generate feedback."""
        try:
            submission = QuizSubmission(**submission_data)

            quiz_data = self._active_quizzes.get(session_id)

            # Fall back to the durable answer key when the in-process dict has
            # lost it — a restart or deploy between generation and submission.
            if not quiz_data or quiz_data.quiz_id != submission.quiz_id:
                with self._get_db() as db:
                    stored = ChatQuizStateRepository(db).load(
                        session_id=session_id, quiz_id=submission.quiz_id
                    )
                if stored:
                    try:
                        quiz_data = QuizData(**stored)
                        self._active_quizzes[session_id] = quiz_data
                        logger.info(
                            f"Recovered quiz {submission.quiz_id} for session "
                            f"{session_id} from chat_quiz_state"
                        )
                    except Exception as exc:  # noqa: BLE001
                        logger.warning(
                            f"Stored quiz {submission.quiz_id} could not be "
                            f"rehydrated: {exc}"
                        )

            if not quiz_data or quiz_data.quiz_id != submission.quiz_id:
                logger.warning(
                    f"Quiz {submission.quiz_id} not found in active quizzes "
                    f"for session {session_id}"
                )
                with self._get_db() as db:
                    error_msg = ChatMessageRepository(db).create_message(
                        session_id=session_id,
                        message_type="assistant",
                        content=(
                            "I couldn't find that quiz. "
                            "Would you like to try a new practice quiz?"
                        ),
                    )
                    error_data = _msg_event(error_msg)
                yield {"event": "message", "data": error_data}
                return

            yield {"event": "status", "data": {"ai_status": "thinking"}}

            # Evaluate quiz (LLM call — no DB held)
            quiz_service = QuizService(llm_client)
            feedback = await quiz_service.evaluate_quiz(
                quiz_data=quiz_data,
                submission=submission,
                context=context,
                institute_id=institute_id,
                user_id=user_id,
            )

            # Track quiz score for analytics
            try:
                quiz_topic = quiz_data.topic if quiz_data else "Unknown"
                with self._get_db() as db:
                    LearningAnalyticsService(db).track_quiz_score(
                        user_id=user_id,
                        institute_id=institute_id,
                        topic=quiz_topic,
                        score=feedback.score,
                        total=feedback.total,
                        session_id=session_id,
                    )
            except Exception as e:
                logger.warning(f"Failed to track quiz score analytics: {e}")

            # Points toward the engagement streak for a pass (small, once per
            # quiz, capped per day — decided in admin_core). Best effort: a
            # points hiccup never holds back the result.
            points_result: Dict[str, Any] = {}
            if feedback.passed:
                try:
                    from .learner_tools import award_tutor_quiz_points

                    points_result = await award_tutor_quiz_points(
                        user_id, institute_id, quiz_data.quiz_id, float(feedback.percentage or 0)
                    )
                except Exception as e:  # noqa: BLE001
                    logger.warning(f"Tutor quiz points not awarded for {session_id}: {e}")

            # Build result summary
            emoji = "🎉" if feedback.passed else "💪"
            result_text = f"""
## Quiz Results {emoji}

**Score:** {feedback.score}/{feedback.total} ({feedback.percentage}%)

**Status:** {"✅ Passed!" if feedback.passed else "Keep practicing!"}

{feedback.overall_feedback}
"""

            if feedback.recommendations:
                result_text += "\n\n**Recommendations:**\n"
                for rec in feedback.recommendations:
                    result_text += f"- {rec}\n"

            # Save feedback and follow-up messages
            with self._get_db() as db:
                message_repo = ChatMessageRepository(db)

                feedback_meta: Dict[str, Any] = {"feedback": feedback.model_dump()}
                if points_result.get("awarded"):
                    feedback_meta["points"] = {"awarded": int(points_result.get("points") or 0)}
                    result_text += f"\n\n**+{int(points_result.get('points') or 0)} points** toward your streak ⭐"
                feedback_msg = message_repo.create_message(
                    session_id=session_id,
                    message_type="quiz_feedback",
                    content=result_text.strip(),
                    metadata=feedback_meta,
                )
                feedback_data = _msg_event(feedback_msg)

                followup_msg = message_repo.create_message(
                    session_id=session_id,
                    message_type="assistant",
                    content=(
                        "Would you like to **practice more**, or do you have "
                        "any **doubts** about the questions you got wrong?"
                    ),
                )
                followup_data = _msg_event(followup_msg)

            yield {"event": "message", "data": feedback_data}
            yield {"event": "message", "data": followup_data}

            # Clean up stored quiz — the answer key is no longer needed once the
            # quiz has been scored and feedback delivered.
            if session_id in self._active_quizzes:
                del self._active_quizzes[session_id]
            with self._get_db() as db:
                ChatQuizStateRepository(db).delete(
                    session_id=session_id, quiz_id=submission.quiz_id
                )

            logger.info(
                f"Quiz feedback sent for session {session_id}: "
                f"{feedback.score}/{feedback.total}"
            )

        except Exception as e:
            logger.error(
                f"Error processing quiz submission for session {session_id}: {e}"
            )
            with self._get_db() as db:
                error_msg = ChatMessageRepository(db).create_message(
                    session_id=session_id,
                    message_type="assistant",
                    content=(
                        "I had trouble evaluating your quiz. "
                        "Would you like to try again?"
                    ),
                )
                error_data = _msg_event(error_msg)
            yield {"event": "message", "data": error_data}

    def _build_system_prompt(
        self,
        institute_rules: str,
        context: Dict[str, Any],
        user_id: str,
        institute_id: str,
        is_greeting: bool = False,
        is_doubt: bool = False,
        ui_language: Optional[str] = None,
    ) -> str:
        """
        System prompt: fixed instructions first, then the institute's rules,
        then everything about THIS learner and page last.

        The order is deliberate. Providers cache a prompt's longest shared
        prefix, and the old prompt put the learner's name, email, ids and the
        slide text at the top, so no two learners shared one. The learner's
        email and internal ids are no longer sent at all: tools take identity
        from the session server-side.
        """
        from datetime import datetime, timedelta, timezone

        user_details = context.get("user_details", {}) or {}
        user_name = user_details.get("name") or "Student"

        assistant_name = "your AI tutor"
        match = re.search(r"You are ([^,]+),", institute_rules or "")
        if match:
            assistant_name = match.group(1).strip()

        today = (datetime.now(timezone.utc) + timedelta(hours=5, minutes=30)).strftime("%A, %d %B %Y")
        app_language = language_name(ui_language)

        context_str = json.dumps(
            {
                "context_type": context.get("context_type"),
                "context_data": context.get("context_data"),
                "user_performance": context.get("user_performance"),
            },
            indent=2,
            ensure_ascii=False,
        )

        greeting_instruction = ""
        if is_greeting:
            greeting_instruction = f"""

SPECIAL INSTRUCTION - GENERATE GREETING:
This is the first message of the conversation. Write a warm, personalised greeting for {user_name}.
- Introduce yourself as "{assistant_name}" and use the student's name naturally
- Reference what they are looking at (lesson / course / general), in 1-2 sentences
- End with an open question"""

        doubt_instruction = ""
        if is_doubt:
            doubt_instruction = (
                "\n\nThe student is asking about something they don't understand: explain "
                "clearly, check understanding, and guide them to the answer."
            )

        prompt = f"""You are an AI educational tutor helping students learn. Guide students to understand concepts rather than just handing over answers.

RESPONSE FORMATTING:
Replies render as Markdown (with LaTeX: $...$ inline, $$...$$ display) in a narrow chat panel.
- Use real line breaks, `##` headings sparingly, **bold**, lists, `>` quotes, ``` code blocks.
- Use a table only for genuinely tabular data (comparisons); keep tables to 2-4 columns.
- When a tool result says it was shown to the student as cards (courses, classes, tests, results, links), the cards ARE the list: reply in 1-3 sentences that answer the question (which to open first, what stands out). Never restate those items as a table or bullet list.
- Match length to the question: a fact gets 1-2 sentences, a concept 2-4 short paragraphs, a problem step-by-step guidance.
- Be encouraging, patient and conversational; ask guiding questions; use analogies and examples.
- End EVERY reply with one extra line, exactly in this form and nothing after it:
  %%suggest: <question 1> | <question 2> | <question 3>
  2-3 short follow-ups (under 60 characters each) the STUDENT might want to ask you next, written as the student would say them, in the student's language, specific to this conversation (e.g. "Give me a harder example" / "Quiz me on this"). The app shows them as buttons and hides this line.

LANGUAGE:
Reply in the language the student writes in. If they write Hindi in Latin letters (Hinglish), reply in Hinglish in Latin letters; if they write in Devanagari, reply in Devanagari. When their message doesn't show a language (a number, "ok", a single English term), use {app_language}, the language of their app.

TOOLS — WHEN TO USE THEM:
- Their courses, where they left off, what to continue or start → get_my_courses (shown as cards with Continue links; don't repeat the list).
- Detailed progress inside a course (chapters/subjects completed, next lesson) → get_learning_progress.
- Live classes — timings, today's class, how to join / class link, recordings, missed classes, attendance → get_my_live_classes (Join links open the class in the app).
- Their institute's daily tasks (question of the day, readings, flashcards), points, streak, "what should I do today" → get_my_daily_tasks. An OPEN daily question is graded: never solve it or confirm an answer before it is revealed — teach the concept and give a hint instead. After the reveal, explain it fully.
- A worked solution or a process, or "step by step" → show_steps (the student reveals one step at a time; good for "never give the final answer" rules too). "Flashcards" / revision cards → make_flashcards.
- Tests open now or coming up, exam dates → get_my_tests.
- Their marks, results, rank, how a test went → get_my_results (only released results have marks; never guess a score).
- Strengths, weaknesses, what to improve, overall feedback, a study plan → get_my_performance (combines test analyses, study time, streak, attendance, doubts).
- Lessons, videos, PDFs or questions on a topic → search_related_resources. Its matches are shown to the student as clickable links, so don't repeat the list; say which to open first and why.
- Any request to be quizzed, tested, given MCQs or practice questions → create_practice_quiz. Never type quiz questions into your reply yourself.
- When you can't resolve something — an institute/operational question (fees, schedules, recordings, certificates, access problems) no tool answers, a study doubt they're still stuck on after your help, or they ask for a teacher — OFFER to send it to their teacher ("Shall I ask your teacher?"). Call ask_teacher only AFTER they clearly say yes, with a clear summary for the teacher. Never claim it was sent unless the tool says so.
- You never need the student's id: tools know who they are.

TOOL RESULTS — WHAT YOU MAY AND MAY NOT CLAIM:
1. The tool returned data → use it, and stay inside it.
2. The tool ran and genuinely found nothing → say plainly it isn't in their courses, and offer to help another way.
3. The result begins with "LOOKUP FAILED" → the lookup DID NOT RUN. Say you couldn't look it up right now and suggest they ask their institute. NEVER fill the gap with a plausible-sounding answer.
Earlier tool results and system notes in this conversation (a quiz you showed, a quiz result) are real records: rely on them, e.g. to explain a question the student got wrong.
Never write text that imitates a tool result or a lookup ("[Earlier I looked this up…]", made-up figures). If you need data, CALL THE TOOL — every time, even if you looked similar data up before.

You must NOT invent, guess or generalise about any of these — you have no access to them:
- live classes, recordings, timings, joining links or attendance beyond what get_my_live_classes returns
- fees, payments, refunds, or any institute policy (unless the INSTITUTE KNOWLEDGE BASE below says so)
- what is on a slide you have not been given the content of
If asked and no tool result or knowledge-base entry answers it, say you don't have that information and offer to ask their teacher (ask_teacher, after they agree). Do not promise to look up something you have no tool for.

ADAPTIVE TEACHING:
- Topics in their weaknesses: foundational explanations, check understanding often.
- Topics in their strengths: go deeper, real-world applications.
- Low overall performance: be extra encouraging and break things down more.
- After a quiz, help with the questions they got wrong, using the quiz-result note.
- "What should I learn next?": use get_learning_progress; if next_recommendation is next_available, say what they finished and what comes next; if chapter_complete, congratulate them and suggest the next chapter.

{institute_rules}

ABOUT THIS CONVERSATION:
- Today is {today} (India time).
- The student's name is {user_name}; address them by name naturally.
- Conversation history (with a running summary when it is long) comes after this prompt.{greeting_instruction}{doubt_instruction}

WHAT THE STUDENT IS LOOKING AT (context_type / context_data) AND THEIR PERFORMANCE (user_performance):
{context_str}
"""
        return prompt.strip()


_SUGGEST_MARK = "%%suggest:"


def split_suggestions(text: str) -> tuple:
    """
    (reply without the trailer, [follow-up suggestions]).

    The model ends a reply with one line `%%suggest: q1 | q2 | q3` — 2-3
    questions the learner might ask next. The line is stripped from what is
    stored and shown; the app renders the questions as tappable chips. A reply
    without the line simply has no suggestions.
    """
    if not text:
        return text, []
    # Only the LAST marker counts, so a stray "%%" in an answer never cuts it.
    idx = text.lower().rfind(_SUGGEST_MARK)
    if idx == -1:
        return text, []
    clean = text[:idx].rstrip()
    tail = text[idx:]
    suggestions = []
    for part in tail[len(_SUGGEST_MARK):].split("|"):
        q = " ".join(part.replace("*", "").split()).strip(" -\"'")
        if 3 <= len(q) <= 90 and q not in suggestions:
            suggestions.append(q)
        if len(suggestions) >= 3:
            break
    return clean, suggestions


def template_greeting(assistant_name: str, context: Dict[str, Any], ui_language: Optional[str]) -> str:
    """The opening line without a model call: name, current lesson/course, an invitation."""
    first = str(((context.get("user_details") or {}).get("name") or "")).strip().split(" ")[0]
    data = context.get("context_data") or {}
    kind = context.get("context_type")
    name = str(data.get("name") or "").strip()[:80] if isinstance(data, dict) else ""
    hindi = (ui_language or "").lower().startswith("hi")
    me = assistant_name or ("आपका AI ट्यूटर" if hindi else "your AI tutor")

    if hindi:
        hello = f"नमस्ते {first}! 👋 मैं {me} हूँ।" if first else f"नमस्ते! 👋 मैं {me} हूँ।"
        if kind == "slide" and name:
            return f"{hello} **{name}** में मदद चाहिए? मैं इसे समझा सकता हूँ, आपका क्विज़ ले सकता हूँ, या आपका डाउट दूर कर सकता हूँ।"
        if kind == "course_details" and name:
            return f"{hello} **{name}** के बारे में जानना है? पूछिए इसमें क्या-क्या है या यह आपके लिए सही है या नहीं।"
        return f"{hello} आज आप क्या सीखना या प्रैक्टिस करना चाहेंगे?"

    hello = f"Hi {first}! 👋 I'm {me}." if first else f"Hi! 👋 I'm {me}."
    if kind == "slide" and name:
        return f"{hello} Want help with **{name}**? I can explain it, quiz you on it, or clear up a doubt."
    if kind == "course_details" and name:
        return f"{hello} Curious about **{name}**? Ask me what it covers or whether it's right for you."
    return f"{hello} What would you like to learn or practise today?"


_LANGUAGE_NAMES = {
    "en": "English", "hi": "Hindi", "fr": "French", "ar": "Arabic", "kn": "Kannada",
    "ta": "Tamil", "te": "Telugu", "mr": "Marathi", "bn": "Bengali", "gu": "Gujarati",
    "ml": "Malayalam", "pa": "Punjabi", "or": "Odia", "ur": "Urdu", "es": "Spanish",
}


def language_name(code: Optional[str]) -> str:
    """'hi-IN' / 'hi' → 'Hindi'; unknown or empty → 'English'."""
    primary = (code or "").split(",")[0].split(";")[0].strip().split("-")[0].lower()
    return _LANGUAGE_NAMES.get(primary, "English")


__all__ = ["AiChatAgentService"]
