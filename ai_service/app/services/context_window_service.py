"""
Context Window Management Service.
Prevents context overflow by summarizing old messages into hierarchical summaries.
"""
from __future__ import annotations

import json
import logging
from typing import Dict, Any, List, Optional

from sqlalchemy.orm import Session

from ..repositories.chat_message_repository import ChatMessageRepository
from ..models.chat_message import ChatMessage
from .chat_llm_client import ChatLLMClient

logger = logging.getLogger(__name__)

# Summarize when message count since last summary exceeds this threshold
SUMMARY_THRESHOLD = 20
# Keep this many recent messages in full (not summarized)
RECENT_MESSAGES_LIMIT = 10
# Rows that carry conversation the model needs on the NEXT turn. Quizzes, quiz
# results, cards and tool lookups used to be left out, so the tutor could not
# discuss the quiz it had just set ("I can't see that question") and invented
# results when asked for them.
HISTORY_MESSAGE_TYPES = ["user", "assistant", "quiz", "quiz_feedback", "tool_call", "tool_result"]
# Rows of those types fetched per turn (tool results and cards ride along with
# the user/assistant turns they belong to, so this is larger than the limit).
HISTORY_FETCH_LIMIT = 24
# Longest piece of an earlier tool lookup replayed to the model.
TOOL_NOTE_MAX_CHARS = 1500
# Filler lines older builds stored as assistant turns. They carry nothing and
# would crowd real turns out of the window.
LEGACY_FILLER_PREFIXES = (
    "Let me check your progress! ",
    "Looking up your feedback...",
    "Searching for helpful resources...",
    "One moment, let me check that for you...",
    "Evaluating your answers...",
    # A reply that imitated the old bracketed lookup note: its figures were invented.
    "[Earlier I looked this up",
)


def _quiz_note(msg: ChatMessage) -> Optional[str]:
    quiz = (msg.meta_data or {}).get("quiz_data") or {}
    questions = quiz.get("questions") or []
    if not questions:
        return None
    lines = [
        f"[Quiz I showed the student on \"{quiz.get('topic') or quiz.get('title') or 'this topic'}\" — "
        "they answer it in the quiz card; until they submit, do not reveal answers.]"
    ]
    for i, q in enumerate(questions, 1):
        opts = " | ".join(str(o)[:80] for o in (q.get("options") or []))
        lines.append(f"Q{i}. {str(q.get('question', ''))[:300]}  Options: {opts}")
    return "\n".join(lines)


def _feedback_note(msg: ChatMessage) -> Optional[str]:
    fb = (msg.meta_data or {}).get("feedback") or {}
    if not fb:
        return msg.content
    lines = [f"[Quiz result: {fb.get('score')}/{fb.get('total')} ({fb.get('percentage')}%).]"]
    for i, q in enumerate(fb.get("question_feedback") or [], 1):
        if q.get("correct"):
            lines.append(f"Q{i} correct: {str(q.get('question_text', ''))[:200]}")
        else:
            lines.append(
                f"Q{i} WRONG: {str(q.get('question_text', ''))[:200]} — student chose "
                f"\"{q.get('user_answer_text') or 'nothing'}\", correct is \"{q.get('correct_answer_text')}\""
                + (f". Why: {str(q.get('explanation'))[:200]}" if q.get("explanation") else "")
            )
    return "\n".join(lines)


def history_entry(msg: ChatMessage) -> Optional[Dict[str, str]]:
    """
    One stored user/assistant/quiz row as an LLM message, or None to skip it.

    Quiz and quiz-result notes go in as SYSTEM messages, never as assistant
    text: replayed as bracketed assistant notes, the model learned to WRITE
    such notes itself ("[Earlier I looked this up with get_my_performance:]"
    followed by invented data) instead of calling the tool — seen on prod
    2026-10-20. Tool lookups are replayed as real tool_call/tool pairs by
    build_history().
    """
    kind = msg.message_type
    if kind == "user":
        return {"role": "user", "content": msg.content}
    if kind == "assistant":
        if (msg.content or "").startswith(LEGACY_FILLER_PREFIXES):
            return None
        return {"role": "assistant", "content": msg.content}
    if kind == "quiz":
        note = _quiz_note(msg)
        return {"role": "system", "content": note} if note else None
    if kind == "quiz_feedback":
        note = _feedback_note(msg)
        return {"role": "system", "content": note} if note else None
    return None


def build_history(rows: List[ChatMessage]) -> List[Dict[str, Any]]:
    """
    Stored rows → LLM messages, with tool lookups as proper pairs: an assistant
    message carrying tool_calls, then the matching role=tool result. A call
    without its result (or a result whose call fell outside the window) is
    dropped, because providers reject unpaired tool messages.
    """
    entries: List[Dict[str, Any]] = []
    open_calls: Dict[str, int] = {}
    for msg in rows:
        meta = msg.meta_data or {}
        if msg.message_type == "tool_call":
            call_id = meta.get("tool_call_id")
            if not call_id:
                continue
            entries.append({
                "role": "assistant",
                "content": None,
                "tool_calls": [{
                    "id": call_id,
                    "type": "function",
                    "function": {
                        "name": meta.get("tool_name") or "tool",
                        "arguments": json.dumps(meta.get("tool_arguments") or {}),
                    },
                }],
            })
            open_calls[call_id] = len(entries) - 1
        elif msg.message_type == "tool_result":
            call_id = meta.get("tool_call_id")
            if call_id in open_calls:
                open_calls.pop(call_id)
                entries.append({
                    "role": "tool",
                    "tool_call_id": call_id,
                    "name": meta.get("tool_name") or "tool",
                    "content": (msg.content or "")[:TOOL_NOTE_MAX_CHARS],
                })
        else:
            entry = history_entry(msg)
            if entry:
                entries.append(entry)
    dangling = set(open_calls.values())
    return [e for i, e in enumerate(entries) if i not in dangling]


class ContextWindowService:
    """
    Manages conversation context window by generating hierarchical summaries.
    Keeps recent messages in full and summarizes older ones.
    """

    def __init__(
        self,
        db_session: Session,
        message_repo: ChatMessageRepository,
        llm_client: ChatLLMClient,
    ):
        self.db = db_session
        self.message_repo = message_repo
        self.llm_client = llm_client

    def should_summarize(self, session_id: str) -> bool:
        """Check if the session needs a new summary based on message count."""
        # Get latest summary
        latest_summary = self._get_latest_summary(session_id)

        # Count user+assistant messages since last summary
        if latest_summary:
            after_id = latest_summary.id
        else:
            after_id = 0

        messages = self.message_repo.get_messages_by_session(
            session_id=session_id,
            after_message_id=after_id,
        )
        # Count only user and assistant messages
        count = sum(1 for m in messages if m.message_type in ("user", "assistant"))
        return count >= SUMMARY_THRESHOLD

    async def generate_summary(
        self,
        session_id: str,
        institute_id: str,
        user_id: str,
    ) -> Optional[ChatMessage]:
        """
        Generate a summary of messages since the last summary.
        Saves it as a 'summary' type message.
        """
        latest_summary = self._get_latest_summary(session_id)
        after_id = latest_summary.id if latest_summary else 0

        # Get messages to summarize
        messages = self.message_repo.get_messages_by_session(
            session_id=session_id,
            after_message_id=after_id,
        )
        # Filter to user and assistant only
        conv_messages = [m for m in messages if m.message_type in ("user", "assistant")]

        if len(conv_messages) < SUMMARY_THRESHOLD:
            return None

        # Build conversation text for summarization
        conversation_text = self._format_conversation(conv_messages)

        # Include previous summary for continuity
        prev_summary = ""
        if latest_summary:
            prev_summary = f"\nPrevious conversation summary:\n{latest_summary.content}\n"

        # Generate summary via LLM
        summary_prompt = f"""Summarize the following conversation between a student and an AI tutor.
Focus on:
1. Key topics discussed
2. Questions the student asked and main answers given
3. Any quizzes taken and their results
4. The student's current understanding and struggles
5. What was being worked on most recently

Keep the summary concise (150-250 words) but preserve important context that would help continue the conversation naturally.
{prev_summary}
Conversation:
{conversation_text}

Summary:"""

        try:
            response = await self.llm_client.chat_completion(
                messages=[{"role": "user", "content": summary_prompt}],
                tools=None,
                temperature=0.2,
                max_tokens=500,
                institute_id=institute_id,
                user_id=user_id,
            )

            summary_text = response.get("content", "")
            if not summary_text:
                return None

            # Store as summary message
            summary_msg = self.message_repo.create_message(
                session_id=session_id,
                message_type="summary",
                content=summary_text,
                metadata={
                    "summarized_from_id": conv_messages[0].id if conv_messages else None,
                    "summarized_to_id": conv_messages[-1].id if conv_messages else None,
                    "message_count": len(conv_messages),
                },
            )

            logger.info(
                f"Generated summary for session {session_id}: "
                f"{len(conv_messages)} messages → {len(summary_text)} chars"
            )
            return summary_msg

        except Exception as e:
            logger.error(f"Error generating summary for session {session_id}: {e}")
            return None

    def get_optimized_history(self, session_id: str) -> List[Dict[str, str]]:
        """
        Get optimized conversation history for LLM context.
        Returns: latest summary (if any) + recent messages.
        This replaces the simple `get_conversation_history(limit=10)`.
        """
        result_messages = []

        # Get latest summary
        latest_summary = self._get_latest_summary(session_id)
        if latest_summary:
            # Include summary as a system-like context block
            result_messages.append({
                "role": "system",
                "content": f"[Conversation Summary]\n{latest_summary.content}",
            })

        # Get recent messages (after summary, or all if no summary)
        after_id = latest_summary.id if latest_summary else None
        recent = self.message_repo.get_conversation_history(
            session_id=session_id,
            limit=HISTORY_FETCH_LIMIT,
            message_types=HISTORY_MESSAGE_TYPES,
        )

        # If we have a summary, only include messages after it
        if latest_summary:
            after = [m for m in recent if m.id > latest_summary.id]
            # If filtering leaves too few, keep the overlap for continuity
            if sum(1 for m in after if m.message_type == "user") >= 2:
                recent = after

        entries = build_history(recent)
        # Keep the last RECENT_MESSAGES_LIMIT conversational turns (user and
        # assistant text); tool pairs and system notes between them ride along.
        turns = 0
        start = len(entries)
        for i in range(len(entries) - 1, -1, -1):
            e = entries[i]
            if e["role"] == "user" or (e["role"] == "assistant" and e.get("content")):
                turns += 1
                if turns > RECENT_MESSAGES_LIMIT:
                    break
            start = i
        # Never open on a tool result whose call was cut off.
        while start < len(entries) and entries[start]["role"] == "tool":
            start += 1
        result_messages.extend(entries[start:])
        return result_messages

    def _get_latest_summary(self, session_id: str) -> Optional[ChatMessage]:
        """Get the most recent summary message for a session."""
        from sqlalchemy import select, and_

        stmt = (
            select(ChatMessage)
            .where(
                and_(
                    ChatMessage.session_id == session_id,
                    ChatMessage.message_type == "summary",
                )
            )
            .order_by(ChatMessage.id.desc())
            .limit(1)
        )

        result = self.db.execute(stmt)
        return result.scalars().first()

    def _format_conversation(self, messages: List[ChatMessage]) -> str:
        """Format a list of messages into readable conversation text."""
        lines = []
        for msg in messages:
            role = "Student" if msg.message_type == "user" else "Tutor"
            # Truncate very long messages
            content = msg.content[:500] if len(msg.content) > 500 else msg.content
            lines.append(f"{role}: {content}")
        return "\n".join(lines)


__all__ = ["ContextWindowService"]
