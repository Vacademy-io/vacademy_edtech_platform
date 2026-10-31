"""
Voice session service — orchestrates voice conversation turns (STT transcript -> LLM -> TTS text).
"""
from __future__ import annotations

import asyncio
import json
import logging
from typing import Dict, Any, List, Optional

from sqlalchemy.orm import Session

from ..repositories.chat_session_repository import ChatSessionRepository
from ..repositories.chat_message_repository import ChatMessageRepository
from ..services.context_resolver_service import ContextResolverService
from ..services.chat_llm_client import ChatLLMClient
from ..services.institute_settings_service import InstituteSettingsService
from ..services.token_usage_service import TokenUsageService
from ..models.ai_token_usage import ApiProvider, RequestType
from .course_knowledge import learner_tool, retrieval, settings_store

logger = logging.getLogger(__name__)

# Lookups a voice call may make about the learner. Interview and oral-test
# calls stay on their topic, so they get none.
VOICE_LEARNER_TOOL_NAMES = (
    "get_my_courses", "get_my_live_classes", "get_my_tests", "get_my_results", "get_my_performance",
)
TOOL_FREE_VOICE_MODES = ("voice_interview", "voice_oral_test")
VOICE_TOOL_ROUNDS = 3


def _voice_tools() -> List[Dict[str, Any]]:
    from .tool_manager_service import TOOL_DEFINITIONS

    return [t for t in TOOL_DEFINITIONS if t["function"]["name"] in VOICE_LEARNER_TOOL_NAMES]


VOICE_LEARNER_TOOLS = _voice_tools()

VOICE_TOOLS_RULE = (
    "\n\nYou can look up this student's own courses (and where they left off), live classes, "
    "tests, released results and performance with your tools. When they ask about any of "
    "these, CALL THE TOOL — never say you don't have access. Then SAY the answer briefly in "
    "plain speech (no lists, no links, no markdown), e.g. 'You have Physics today at 7:30 PM'; "
    "they can see the details in the app. Never guess times, marks or ranks."
)

# search_my_course joins the voice tools only for a verified caller (token user
# = session user, session institute in the token's authorities) on a doubt /
# tutoring call, and only while the institute's course-knowledge gate is on.
VOICE_COURSE_RULE = (
    "\n\nFor questions about this student's course content, call search_my_course and answer "
    "in one or two spoken sentences, mentioning the lesson name. For a locked lesson, say when "
    "it unlocks and do not explain it. Never read out links."
)
# Hints the course search may use from the session's context; access.py ignores
# any that point outside the learner's open lessons.
_COURSE_HINT_KEYS = ("slide_id", "chapter_id", "package_session_id", "tz")


class VoiceSessionService:
    """
    Orchestrates voice conversation turns.
    Takes a transcript from STT, processes it with the LLM, and returns the AI response text.
    """

    def __init__(
        self,
        db_session: Session,
        llm_client: ChatLLMClient,
        institute_settings: InstituteSettingsService,
        context_resolver: ContextResolverService,
    ):
        self.db = db_session
        self.llm_client = llm_client
        self.institute_settings = institute_settings
        self.context_resolver = context_resolver
        self.session_repo = ChatSessionRepository(db_session)
        self.message_repo = ChatMessageRepository(db_session)

    def record_voice_media_usage(
        self,
        kind: str,
        institute_id: str,
        user_id: str,
        session_id: str,
        language: str,
        characters: int,
        detail: Optional[str] = None,
        provider: str = "sarvam",
    ) -> None:
        """
        Attribute Sarvam STT/TTS spend to the institute that caused it.

        Voice used to be the one AI surface that cost real money per turn and
        left no usage row behind. Provider stays "google_tts" — that is the
        value the api_provider CHECK constraint allows for premium TTS, and
        tts_provider carries the real vendor (see V225).
        """
        try:
            TokenUsageService(self.db).record_usage(
                api_provider=ApiProvider.GOOGLE_TTS,
                prompt_tokens=0,
                completion_tokens=0,
                total_tokens=0,
                request_type=RequestType.TTS_PREMIUM if kind == "tts" else RequestType.TRANSCRIPTION,
                institute_id=institute_id,
                user_id=user_id,
                model=(
                    {"sarvam": "sarvam:bulbul-v3", "google": "google:chirp3-hd", "edge": "edge:neural"}.get(
                        provider, provider
                    )
                    if kind == "tts"
                    else "sarvam:saaras-v3"
                ),
                request_id=session_id,
                tts_provider=provider if kind == "tts" else "sarvam",
                character_count=max(characters, 0),
                metadata={"surface": "voice_call", "language": language, "detail": detail},
            )
        except Exception:
            # Metering must never take a call down.
            logger.exception(f"Failed to record voice usage for session {session_id}")

    async def _prepare_turn(
        self,
        session_id: str,
        user_id: str,
        institute_id: str,
    ) -> tuple:
        """Resolve everything a turn needs:
        (session_mode, system_prompt, temperature, user_name, context_meta)."""
        session = self.session_repo.get_session_by_id(session_id)
        if not session:
            raise ValueError(f"Session {session_id} not found")

        session_mode = getattr(session, "session_mode", "text") or "text"
        context = await self.context_resolver.resolve_context(
            context_type=session.context_type or "general",
            context_meta=session.context_meta or {},
            user_id=user_id,
            institute_id=institute_id,
        )
        ai_settings = self.institute_settings.get_ai_settings(institute_id)
        system_prompt = self._build_voice_system_prompt(
            mode=session_mode,
            institute_rules=self.institute_settings.format_rules_for_prompt(ai_settings),
            context=context,
            user_id=user_id,
            institute_id=institute_id,
        )
        user_name = (context.get("user_details", {}) or {}).get("name") or ""
        return (
            session_mode,
            system_prompt,
            self.institute_settings.get_temperature(ai_settings),
            user_name,
            dict(session.context_meta) if isinstance(session.context_meta, dict) else {},
        )

    async def generate_opening_turn(
        self,
        session_id: str,
        user_id: str,
        institute_id: str,
        model: Optional[str] = None,
    ) -> Optional[dict]:
        """
        Produce the line the agent speaks the moment the student joins the call,
        so nobody has to type or tap to get the conversation started.

        Returns None when the session already has conversation — a reconnect
        mid-call must not replay a greeting over the top of it.
        """
        if self.message_repo.get_conversation_history(session_id, limit=1):
            return None

        session_mode, system_prompt, temperature, user_name, _context_meta = await self._prepare_turn(
            session_id, user_id, institute_id
        )

        # Spoken aloud, so a guessed name or a literal "[Student's name]" is
        # worse than no name. Only ask for one when we actually have it.
        known_name = user_name.strip() and user_name.strip().lower() not in ("student", "learner", "user")
        greet = "Greet them by name" if known_name else "Greet them warmly without using a name (you do not know it — never guess or use a placeholder)"

        if session_mode == "voice_interview":
            opening_instruction = (
                f"The student has just joined the interview call. {greet} in one short "
                "sentence, say what the interview is about, then immediately ask your first question."
            )
        elif session_mode == "voice_oral_test":
            opening_instruction = (
                f"The student has just joined the oral test call. {greet} in one short "
                "sentence, say what the test covers, then immediately ask your first question."
            )
        else:
            opening_instruction = (
                f"The student has just joined the voice call. {greet} in one short "
                "sentence and ask what they would like help with. Keep it to two sentences."
            )

        llm_response = await self.llm_client.chat_completion(
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": f"[SYSTEM] {opening_instruction}"},
            ],
            temperature=temperature,
            max_tokens=150,
            institute_id=institute_id,
            user_id=user_id,
            model=model,
        )

        ai_text = (llm_response.get("content") or "").strip()
        if not ai_text:
            return None

        # Only the spoken line is stored: the instruction above is scaffolding,
        # and keeping it in history would leak into later turns.
        assistant_message = self.message_repo.create_message(
            session_id=session_id,
            message_type="assistant",
            content=ai_text,
            metadata={
                "source": "voice_llm",
                "turn": "opening",
                "provider": llm_response.get("provider"),
                "model": llm_response.get("model"),
            },
        )
        self.session_repo.update_last_active(session_id)

        return {"ai_text": ai_text, "message_id": assistant_message.id}

    async def process_voice_turn(
        self,
        session_id: str,
        transcript: str,
        user_id: str,
        institute_id: str,
        model: Optional[str] = None,
        course_verified: bool = False,
    ) -> dict:
        """
        Process a single voice conversation turn.

        course_verified: the socket proved the caller is the session's user and
        a member of its institute. Only then may a doubt call search the
        learner's course (and only while the institute's gate is on).

        1. Save user message (transcript) to DB
        2. Get session to read session_mode and context
        3. Resolve context via context_resolver
        4. Build mode-specific system prompt
        5. Get conversation history (last 10 messages)
        6. Call LLM
        7. Save assistant message to DB
        8. Return { "ai_text": str, "message_id": int, "metadata": dict }
        """
        # 1. Save user transcript as a message
        user_message = self.message_repo.create_message(
            session_id=session_id,
            message_type="user",
            content=transcript,
            metadata={"source": "voice_stt"},
        )

        # 2-4. Session mode, resolved context and the mode-specific prompt
        session_mode, system_prompt, temperature, _user_name, context_meta = await self._prepare_turn(
            session_id, user_id, institute_id
        )
        tools = VOICE_LEARNER_TOOLS if session_mode not in TOOL_FREE_VOICE_MODES else None
        if tools:
            system_prompt += VOICE_TOOLS_RULE
        course_tool = await self._course_tool_allowed(course_verified, session_mode, institute_id)
        if course_tool:
            # A new list: VOICE_LEARNER_TOOLS is shared by every call.
            tools = [*(tools or []), learner_tool.SEARCH_MY_COURSE_TOOL]
            system_prompt += VOICE_COURSE_RULE

        # 5. Conversation history (last 10 messages)
        history = self.message_repo.get_conversation_history(session_id, limit=10)
        messages: List[Dict[str, Any]] = [{"role": "system", "content": system_prompt}]
        for msg in history:
            role = "user" if msg.message_type == "user" else "assistant"
            messages.append({"role": role, "content": msg.content})

        # 6. Call LLM — with the learner lookup tools in doubt calls, so "do I
        # have a class today?" is answered from the schedule instead of "I
        # don't have access to your timetable" (seen on prod 2026-10-20).
        llm_response: Dict[str, Any] = {}
        for round_no in range(1, VOICE_TOOL_ROUNDS + 1):
            llm_response = await self.llm_client.chat_completion(
                messages=messages,
                tools=tools if round_no < VOICE_TOOL_ROUNDS else None,
                temperature=temperature,
                max_tokens=300,  # short responses for voice
                institute_id=institute_id,
                user_id=user_id,
                model=model,  # platform "voice call model" when set; else the chatbot model
            )
            tool_calls = llm_response.get("tool_calls") or []
            if not tools or not tool_calls:
                break
            for call in tool_calls:
                result = await self._run_voice_tool(
                    call, user_id, institute_id, course_tool=course_tool, context_meta=context_meta
                )
                messages.append({"role": "assistant", "content": None, "tool_calls": [call]})
                messages.append({
                    "role": "tool",
                    "tool_call_id": call.get("id"),
                    "name": (call.get("function") or {}).get("name"),
                    "content": result,
                })

        ai_text = llm_response.get("content") or ""

        # 7. Save assistant message
        metadata = {
            "source": "voice_llm",
            "provider": llm_response.get("provider"),
            "model": llm_response.get("model"),
        }
        assistant_message = self.message_repo.create_message(
            session_id=session_id,
            message_type="assistant",
            content=ai_text,
            metadata=metadata,
        )

        # Update session last_active
        self.session_repo.update_last_active(session_id)

        # 8. Return result
        return {
            "ai_text": ai_text,
            "message_id": assistant_message.id,
            "metadata": metadata,
        }

    async def _course_tool_allowed(self, course_verified: bool, session_mode: str, institute_id: str) -> bool:
        """search_my_course is offered only to a verified caller on a tutoring /
        doubt call while the institute's gate is active in mode 'on'. The gate
        reads platform settings and a cached row on its own short session, in a
        worker thread — never self.db."""
        if not course_verified or session_mode in TOOL_FREE_VOICE_MODES or not institute_id:
            return False
        try:
            gate = await asyncio.to_thread(settings_store.learner_gate, institute_id)
        except Exception:  # noqa: BLE001 - an unreadable gate is an off gate
            logger.warning(f"Course knowledge gate unreadable for institute {institute_id}", exc_info=True)
            return False
        return bool(gate.active and gate.mode == "on")

    async def _run_voice_tool(
        self,
        call: Dict[str, Any],
        user_id: str,
        institute_id: str,
        course_tool: bool = False,
        context_meta: Optional[Dict[str, Any]] = None,
    ) -> str:
        """Run one learner lookup for a voice turn; the text is all a call can use."""
        from .chat_cards import split_tool_output
        from .tool_manager_service import ToolManagerService

        fn = call.get("function") or {}
        name = fn.get("name") or ""
        if name == learner_tool.TOOL_NAME and course_tool:
            # Own short sessions inside the tool: self.db lives for the whole
            # socket and must not be held across the query embedding.
            hints = {k: (context_meta or {}).get(k) for k in _COURSE_HINT_KEYS}
            output = await learner_tool.run_search_my_course(
                user_id=user_id,
                institute_id=institute_id,
                args=fn.get("arguments") or "{}",
                context_meta=hints,
                mode=retrieval.MODE_VOICE,
            )
            return output.text
        if name not in VOICE_LEARNER_TOOL_NAMES:
            return f"Unknown tool: {name}"
        try:
            args = json.loads(fn.get("arguments") or "{}")
        except (TypeError, ValueError):
            args = {}
        manager = ToolManagerService(self.db, institute_id=institute_id, user_id=user_id)
        text_out, _card = split_tool_output(await manager.execute_tool(name, args))
        return text_out

    def _build_voice_system_prompt(
        self,
        mode: str,
        institute_rules: str,
        context: dict,
        user_id: str,
        institute_id: str,
    ) -> str:
        """
        Build system prompt specific to voice modes.
        Prompts instruct the LLM to keep responses SHORT (under 50 words) since they will be spoken aloud.
        """
        context_data = context.get("context_data", {})
        user_details = context.get("user_details", {})
        user_name = user_details.get("name", "Student")
        topic = context_data.get("voice_topic") or context_data.get("chapter") or context_data.get("name") or context_data.get("topic") or "the given subject"

        # Performance context snippet
        user_perf = context.get("user_performance", {})
        perf_snippet = ""
        if user_perf.get("strengths") or user_perf.get("weaknesses"):
            strengths = ", ".join(s["topic"] for s in user_perf.get("strengths", [])[:3])
            weaknesses = ", ".join(w["topic"] for w in user_perf.get("weaknesses", [])[:3])
            perf_snippet = f"\nStudent strengths: {strengths or 'N/A'}. Weaknesses: {weaknesses or 'N/A'}."

        base_voice_rule = (
            "CRITICAL: Keep every response under 50 words. You are speaking aloud — be concise, "
            "conversational, and natural. Do not use markdown, bullet points, or formatting."
        )

        if mode == "voice_interview":
            prompt = (
                f"You are conducting a mock interview with {user_name} on the topic: {topic}. "
                f"Ask one question at a time. Wait for the student's answer before proceeding. "
                f"Give brief feedback after each answer, then ask the next question. "
                f"Be encouraging but honest.{perf_snippet}\n\n"
                f"{base_voice_rule}\n\n{institute_rules}"
            )
        elif mode == "voice_doubt":
            prompt = (
                f"You are helping {user_name} discuss their doubt verbally about: {topic}. "
                f"Use Socratic questioning — guide the student to the answer rather than giving it directly. "
                f"Ask clarifying questions. Be patient and supportive.{perf_snippet}\n\n"
                f"{base_voice_rule}\n\n{institute_rules}"
            )
        elif mode == "voice_oral_test":
            prompt = (
                f"You are administering an oral test to {user_name} on: {topic}. "
                f"Ask one question at a time. After the student answers, clearly state whether it is "
                f"correct or incorrect and give the right answer if wrong. Then move to the next question. "
                f"Track the score internally.{perf_snippet}\n\n"
                f"{base_voice_rule}\n\n{institute_rules}"
            )
        else:
            # Fallback for text mode used over voice (general conversation)
            prompt = (
                f"You are a helpful voice tutor assisting {user_name}. "
                f"Topic context: {topic}.{perf_snippet}\n\n"
                f"{base_voice_rule}\n\n{institute_rules}"
            )

        return prompt

    async def generate_session_summary(
        self,
        session_id: str,
        mode: str,
        institute_id: str,
        user_id: str,
    ) -> dict:
        """
        Generate end-of-session scorecard.

        1. Fetch all messages for the session
        2. Build a summary prompt based on mode
        3. Call LLM to generate: { score, total_questions, strengths, areas_to_improve, feedback }
        4. Save summary as a special assistant message with metadata type="summary"
        5. Return the summary dict
        """
        # 1. Fetch all messages
        all_messages = self.message_repo.get_messages_by_session(session_id)
        if not all_messages:
            return {
                "score": 0,
                "total_questions": 0,
                "strengths": [],
                "areas_to_improve": [],
                "feedback": "No conversation data available to summarize.",
            }

        # Build conversation transcript for the LLM
        transcript_lines = []
        for msg in all_messages:
            role_label = "Student" if msg.message_type == "user" else "Tutor"
            transcript_lines.append(f"{role_label}: {msg.content}")
        transcript_text = "\n".join(transcript_lines)

        # 2. Build summary prompt based on mode
        if mode == "voice_interview":
            summary_instruction = (
                "You just conducted a mock interview. Analyze the conversation and produce a JSON scorecard."
            )
        elif mode == "voice_oral_test":
            summary_instruction = (
                "You just administered an oral test. Analyze the conversation and produce a JSON scorecard."
            )
        else:
            summary_instruction = None

        if summary_instruction:
            summary_prompt = (
                f"{summary_instruction}\n\n"
                f"Conversation transcript:\n{transcript_text}\n\n"
                f"Respond ONLY with valid JSON in this exact format:\n"
                f'{{"score": <number 0-100>, "total_questions": <number>, '
                f'"strengths": ["strength1", "strength2"], '
                f'"areas_to_improve": ["area1", "area2"], '
                f'"feedback": "Overall feedback paragraph"}}'
            )
        else:
            # A doubt call is help, not a test: a recap, never a score. (It used
            # to be graded like an oral test — a student who asked how to
            # download an exam paper was told their understanding was "very
            # limited", 30/100.)
            summary_prompt = (
                "You just helped a student with their doubts in a voice call. Write a short recap.\n\n"
                f"Conversation transcript:\n{transcript_text}\n\n"
                "Respond ONLY with valid JSON in this exact format:\n"
                '{"score": null, "total_questions": 0, '
                '"strengths": ["what the student now understands"], '
                '"areas_to_improve": ["what to revise or practise next"], '
                '"feedback": "Two or three encouraging sentences recapping what was covered"}\n'
                "Use empty lists when the call had no study content (e.g. a question about the app)."
            )

        messages = [
            {"role": "system", "content": "You are an assessment evaluator. Respond only with valid JSON."},
            {"role": "user", "content": summary_prompt},
        ]

        # 3. Call LLM
        llm_response = await self.llm_client.chat_completion(
            messages=messages,
            temperature=0.2,
            max_tokens=800,
            institute_id=institute_id,
            user_id=user_id,
        )

        raw_content = llm_response.get("content") or "{}"

        # Parse the JSON object out of the reply (models wrap it in fences or
        # prose). On failure show nothing rather than the raw reply — a literal
        # "```" once reached a learner as their feedback.
        summary = None
        start, end = raw_content.find("{"), raw_content.rfind("}")
        if start != -1 and end > start:
            try:
                parsed = json.loads(raw_content[start:end + 1])
                summary = parsed if isinstance(parsed, dict) else None
            except (json.JSONDecodeError, ValueError):
                summary = None
        if summary is None:
            logger.warning(f"Failed to parse summary JSON for session {session_id}: {raw_content[:300]}")
            summary = {"score": None, "total_questions": 0, "strengths": [], "areas_to_improve": [], "feedback": ""}
        if mode not in ("voice_interview", "voice_oral_test"):
            summary["score"] = None

        # Ensure all expected keys exist; the score is a 0-100 percentage
        if summary.get("score") is not None:
            try:
                summary["score"] = max(0, min(100, round(float(summary["score"]))))
            except (TypeError, ValueError):
                summary["score"] = None
        summary.setdefault("score", None)
        summary.setdefault("total_questions", 0)
        summary.setdefault("strengths", [])
        summary.setdefault("areas_to_improve", [])
        summary.setdefault("feedback", "")

        # 4. Save summary as special assistant message
        self.message_repo.create_message(
            session_id=session_id,
            message_type="assistant",
            content=json.dumps(summary),
            metadata={"type": "summary", "mode": mode},
        )

        # 5. Return
        return summary


__all__ = ["VoiceSessionService"]
