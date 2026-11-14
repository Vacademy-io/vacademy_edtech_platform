"""search_my_course: the learner's own course as a tool, shared by the chat
agent (CK-10) and voice doubt calls (CK-11), plus the ambient COURSE MATERIAL
context for a chat turn.

Identity comes from the verified session (user_id, institute_id), never from
model arguments; context_meta only hints the current slide / chapter / batch
and the time zone, and access.py ignores hints outside the OPEN set.

Every DB read here runs in its OWN short session (resolve_scope with db=None
in a worker thread, retrieval's own sessions). Never pass the caller's
long-lived session: the chat tool loop and the voice socket each hold one for
the whole turn / call, and holding it across the embedding call is how the
pool ran dry on 2026-08-19.
"""
from __future__ import annotations

import asyncio
import json
import logging
from typing import Any, Mapping, Optional, Tuple

from ..chat_cards import ToolOutput
from . import access, prompt_blocks, retrieval, settings_store

logger = logging.getLogger(__name__)

TOOL_NAME = "search_my_course"
MAX_QUERY_CHARS = 500
_HINT_MAX = 64

SEARCH_MY_COURSE_TOOL = {
    "type": "function",
    "function": {
        "name": TOOL_NAME,
        "description": (
            "Search the lessons of the courses THIS student is enrolled in (PDF pages, videos, "
            "notes, quizzes) and return passages with links. Use it for any study question about "
            "their course content. Locked lessons come back only as coming-up titles; never "
            "explain them."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "What to look for: the student's question or its key terms.",
                },
            },
            "required": ["query"],
        },
    },
}

NO_QUERY_TEXT = "search_my_course needs a query: what to look for in the student's course."
NOT_AVAILABLE_TEXT = "Searching the student's course is not available here."
NO_LESSONS_TEXT = (
    "This student has no open lessons in an enrolled course, so there is no course material "
    "to search."
)
FAILED_TEXT = "The course search did not work just now. Answer from general knowledge and say so."


def _query(args: Any) -> str:
    if isinstance(args, str):
        try:
            args = json.loads(args) if args.strip() else {}
        except ValueError:
            args = {"query": args}
    if not isinstance(args, Mapping):
        return ""
    value = args.get("query")
    return " ".join(str(value).split())[:MAX_QUERY_CHARS] if value is not None else ""


def _hint(meta: Optional[Mapping[str, Any]], key: str) -> Optional[str]:
    if not isinstance(meta, Mapping):
        return None
    value = meta.get(key)
    if not isinstance(value, str):
        return None
    value = value.strip()
    return value[:_HINT_MAX] if value else None


async def _scope(user_id: str, institute_id: str, context_meta: Optional[Mapping[str, Any]]) -> access.ResolvedScope:
    """The learner's scope, resolved in a worker thread with its own session."""
    return await asyncio.to_thread(
        access.resolve_scope, None,
        user_id=user_id, institute_id=institute_id,
        tz=_hint(context_meta, "tz"),
        hint_slide_id=_hint(context_meta, "slide_id"),
        hint_chapter_id=_hint(context_meta, "chapter_id"),
        hint_package_session_id=_hint(context_meta, "package_session_id"),
    )


async def _gate(institute_id: str) -> settings_store.LearnerGate:
    return await asyncio.to_thread(settings_store.learner_gate, institute_id)


async def run_search_my_course(
    *,
    user_id: str,
    institute_id: str,
    args: Any,
    context_meta: Optional[Mapping[str, Any]],
    mode: str = retrieval.MODE_TOOL,
) -> ToolOutput:
    """Execute search_my_course for the verified learner. Chat (mode 'tool')
    gets text plus a link_list card; voice (mode 'voice') gets text only."""
    voice = mode == retrieval.MODE_VOICE
    search_mode = retrieval.MODE_VOICE if voice else retrieval.MODE_TOOL
    query = _query(args)
    if not query:
        return ToolOutput(text=NO_QUERY_TEXT)
    if not user_id or not institute_id:
        return ToolOutput(text=NOT_AVAILABLE_TEXT)
    try:
        # The tool is offered only when the gate is on; a model calling it from
        # memory on any other turn gets nothing from the course.
        gate = await _gate(institute_id)
        if not gate.active or gate.mode != "on":
            return ToolOutput(text=NOT_AVAILABLE_TEXT)
        scope = await _scope(user_id, institute_id, context_meta)
        if scope.is_empty:
            return ToolOutput(text=NO_LESSONS_TEXT)
        result = await retrieval.search_course(scope=scope, query=query, mode=search_mode)
    except Exception as exc:  # noqa: BLE001 - a tool failure must not break the turn
        logger.warning("search_my_course failed for user %s in %s: %s", user_id, institute_id, exc)
        return ToolOutput(text=FAILED_TEXT)
    logger.info(
        "search_my_course mode=%s inst=%s hits=%d signposts=%d refs=%d top=%s latency_ms=%d",
        search_mode, institute_id, len(result.hits), len(result.signposts), len(result.kb_hits),
        f"{result.top_similarity:.3f}" if result.top_similarity is not None else "-", result.latency_ms,
    )
    if voice:
        return ToolOutput(text=prompt_blocks.format_voice_text(result))
    return ToolOutput(
        text=prompt_blocks.format_tool_text(result, query),
        card=prompt_blocks.results_card(result),
    )


async def course_context_for_turn(
    user_id: str,
    institute_id: str,
    query: str,
    context_meta: Optional[Mapping[str, Any]],
) -> Tuple[Optional[str], Optional[retrieval.CourseSearchResult]]:
    """(COURSE MATERIAL block, result) for one chat turn in ambient mode, or
    (None, None) when there is nothing relevant or the gate is off. Never raises
    (except cancellation)."""
    query = " ".join((query or "").split())[: retrieval.MAX_QUERY_CHARS]
    if not query or not user_id or not institute_id:
        return None, None
    try:
        gate = await _gate(institute_id)
        if not gate.active:
            return None, None
        scope = await _scope(user_id, institute_id, context_meta)
        if scope.is_empty:
            return None, None
        result = await retrieval.search_course(scope=scope, query=query, mode=retrieval.MODE_AMBIENT)
    except Exception as exc:  # noqa: BLE001
        logger.warning("course context failed for user %s in %s: %s", user_id, institute_id, exc)
        return None, None
    if result.is_empty:
        return None, None
    block = prompt_blocks.format_course_block(result)
    return (block, result) if block else (None, None)


__all__ = [
    "TOOL_NAME", "SEARCH_MY_COURSE_TOOL", "run_search_my_course", "course_context_for_turn",
]
