"""
Service for managing AI tool definitions and execution.
"""
from __future__ import annotations

import json
import logging
from typing import Dict, Any, List, Callable, Optional, Union

from sqlalchemy import text
from sqlalchemy.orm import Session

from .learning_progress_service import LearningProgressService
from .chat_cards import ToolOutput
from .learner_tools import (
    DAILY_TASKS_TOOL,
    get_my_daily_tasks,
    ASK_TEACHER_TOOL,
    ask_teacher,
    LIVE_CLASSES_TOOL,
    MY_COURSES_TOOL,
    MY_PERFORMANCE_TOOL,
    MY_RESULTS_TOOL,
    MY_TESTS_TOOL,
    get_my_courses,
    get_my_live_classes,
    get_my_performance,
    get_my_results,
    get_my_tests,
)

logger = logging.getLogger(__name__)


# Tool definitions in OpenAI function calling format
TOOL_DEFINITIONS = [
    MY_COURSES_TOOL,
    DAILY_TASKS_TOOL,
    LIVE_CLASSES_TOOL,
    MY_TESTS_TOOL,
    MY_RESULTS_TOOL,
    MY_PERFORMANCE_TOOL,
    ASK_TEACHER_TOOL,
    {
        "type": "function",
        "function": {
            "name": "get_learning_progress",
            "description": "Detailed progress below course level: completion % per chapter/module/subject, recent activity, and the recommended next lesson. Use for 'what have I completed in <subject>', 'what's next in this chapter'. For 'my courses' / 'where did I leave off' / 'continue', use get_my_courses instead.",
            "parameters": {
                "type": "object",
                "properties": {
                    "source_filter": {
                        "type": "string",
                        "enum": ["SLIDE", "CHAPTER", "MODULE", "SUBJECT", "PACKAGE_SESSION"],
                        "description": "Optional: Filter progress by specific source level. Leave empty for all levels."
                    }
                },
                "required": []
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "search_related_resources",
            "description": (
                "Find lessons (videos, PDFs, notes, quizzes) and practice questions on a topic in the "
                "courses THIS student is enrolled in. The matches are shown to the student as "
                "clickable links, so don't repeat the list — say which one to start with and why. "
                "Use short topic words ('circles', 'photosynthesis'), not whole sentences."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "topic": {
                        "type": "string",
                        "description": "The topic or keyword to search for"
                    },
                    "resource_type": {
                        "type": "string",
                        "enum": ["slide", "question", "all"],
                        "description": "Type of resource to search for",
                        "default": "all"
                    }
                },
                "required": ["topic"]
            }
        }
    },
    # semantic_search_content is NOT offered to the model. Its corpus
    # (content_embeddings) holds only the platform's admin help articles —
    # nothing ingests course material into it — so in production it answered
    # learners' study questions with "Add modules and chapters"-style admin
    # docs (Oct 2026). The executor stays for when a course corpus exists;
    # add SEMANTIC_SEARCH_TOOL back to this list then.
    {
        "type": "function",
        "function": {
            "name": "create_practice_quiz",
            "description": (
                "Create an interactive multiple-choice practice quiz that the student answers "
                "inside the chat; it is scored automatically and you see the result afterwards. "
                "Use it whenever the student asks to be quizzed/tested/given practice questions or "
                "MCQs, or agrees to practise. Do NOT type quiz questions into your reply yourself. "
                "If the request is vague (\"quiz me\") and they are on a lesson, use that lesson's "
                "topic; if there is no usable topic at all, ask what to practise instead of calling this."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "topic": {
                        "type": "string",
                        "description": "The specific study topic, e.g. 'Areas related to circles' or 'Newton's second law'.",
                    },
                    "num_questions": {
                        "type": "integer",
                        "description": "How many questions (3-10). Default 5; use what the student asked for, capped at 10.",
                    },
                    "difficulty": {
                        "type": "string",
                        "enum": ["easy", "medium", "hard"],
                        "description": "Default medium. Use what the student asked for (e.g. 'tough' = hard).",
                    },
                },
                "required": ["topic"],
            },
        },
    },
]


SEMANTIC_SEARCH_TOOL = {
    "type": "function",
    "function": {
        "name": "semantic_search_content",
        "description": "Search across all course materials (slides, chapters, questions) using semantic similarity. Use this when the student asks about a topic and you need to find relevant learning materials, or when you need more context about a subject.",
        "parameters": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "The search query - describe what you're looking for"
                },
                "top_k": {
                    "type": "integer",
                    "description": "Number of results to return (default 5)",
                    "default": 5
                }
            },
            "required": ["query"]
        }
    }
}

# Superseded for the model by get_my_performance (which folds in their data and
# adds released-test analysis, study time, streak and attendance). Kept so the
# executors stay documented and can be offered again.
STUDENT_FEEDBACK_TOOL = {
        "type": "function",
        "function": {
            "name": "get_student_feedback",
            "description": "Get detailed performance feedback for the student including strengths, weaknesses, and recent activity",
            "parameters": {
                "type": "object",
                "properties": {
                    "date_range_days": {
                        "type": "integer",
                        "description": "Number of days to look back for analysis",
                        "default": 30
                    }
                },
                "required": []
            }
        }
    }

LEARNING_ANALYTICS_TOOL = {
        "type": "function",
        "function": {
            "name": "get_learning_analytics",
            "description": "Get learning analytics including doubt patterns, quiz performance trends, and topic engagement. Use when the student asks about their learning patterns, weak areas, or overall performance trends.",
            "parameters": {
                "type": "object",
                "properties": {
                },
                "required": []
            }
        }
    }

# Presentation tools: the model hands over content, the learner gets an
# interactive card. No lookups, no side effects.
SHOW_STEPS_TOOL = {
    "type": "function",
    "function": {
        "name": "show_steps",
        "description": (
            "Show a worked solution or a process as steps the student reveals one at a time. Use "
            "when they ask for step-by-step, how to solve/derive something, or seem stuck on a "
            "problem — it lets them try each step before seeing the next. 2-8 steps; each body may "
            "use markdown and LaTeX."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "title": {"type": "string", "description": "What is being solved, e.g. 'Area of a 90° sector, r = 7'."},
                "steps": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "title": {"type": "string", "description": "Short step name, e.g. 'Write the formula'."},
                            "body": {"type": "string", "description": "The step's working."},
                        },
                        "required": ["title", "body"],
                    },
                },
            },
            "required": ["steps"],
        },
    },
}

MAKE_FLASHCARDS_TOOL = {
    "type": "function",
    "function": {
        "name": "make_flashcards",
        "description": (
            "Turn what was just explained into flip cards for revision (3-8 cards: a short "
            "question or term on the front, a crisp answer on the back). Use when the student asks "
            "for flashcards, revision cards, or to memorise something."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "title": {"type": "string"},
                "cards": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {"front": {"type": "string"}, "back": {"type": "string"}},
                        "required": ["front", "back"],
                    },
                },
            },
            "required": ["cards"],
        },
    },
}

TOOL_DEFINITIONS.extend([SHOW_STEPS_TOOL, MAKE_FLASHCARDS_TOOL])

# Tools the orchestrator runs itself because they produce chat messages (a quiz
# card) rather than text for the model.
ORCHESTRATOR_TOOLS = {"create_practice_quiz"}

# ── search_related_resources helpers ─────────────────────────────────────────

_SEARCH_STOPWORDS = frozenset(
    """a an and are about any can chapter class do does find for from give how i in is it
    lecture lectures lesson lessons me material materials my notes of on or please pdf pdfs
    question questions related resource resources show some std standard study the this
    to topic video videos want what with""".split()
)


def search_words(topic: str, limit: int = 6) -> List[str]:
    """Topic words worth matching: >2 letters, no filler, light plural folding."""
    import re

    out: List[str] = []
    # Split on whitespace/punctuation, not \w: \w breaks Devanagari words at
    # their vowel signs.
    for raw in re.split(r"[\s\.,;:!?()\[\]{}\"'/\\|+*=<>&_-]+", topic.lower()):
        if len(raw) < 3 or raw.isdigit() or raw in _SEARCH_STOPWORDS:
            continue
        word = raw
        if len(word) > 4 and word.endswith("es") and not word.endswith("ses"):
            word = word[:-2]
        elif len(word) > 3 and word.endswith("s") and not word.endswith("ss"):
            word = word[:-1]
        if word not in out:
            out.append(word)
        if len(out) >= limit:
            break
    return out


_SLIDE_ROUTE = "/study-library/courses/course-details/subjects/modules/chapters/slides"


def slide_href(row) -> str:
    """The learner-app route that opens a slide (same search params the dashboard uses)."""
    from urllib.parse import urlencode

    return _SLIDE_ROUTE + "?" + urlencode({
        "courseId": row["package_id"] or "",
        "levelId": row["level_id"] or "",
        "subjectId": row["subject_id"] or "",
        "moduleId": row["module_id"] or "",
        "chapterId": row["chapter_id"] or "",
        "slideId": row["slide_id"] or "",
        "sessionId": row["package_session_id"] or "",
    })


_SLIDE_ICONS = {"VIDEO": "video", "DOCUMENT": "pdf", "QUIZ": "quiz", "QUESTION": "question", "ASSIGNMENT": "assessment"}

# Every published slide in the learner's ACTIVE enrolments, with the ids the
# app needs to open it. Slides carry no institute id; tenancy and enrolment
# both come through package_session.
_ENROLLED_SLIDES_CTE = """
WITH enrolled AS (
    SELECT DISTINCT package_session_id
      FROM student_session_institute_group_mapping
     WHERE user_id = :user_id AND institute_id = :institute_id AND status = 'ACTIVE'
), placed AS (
    SELECT s.id AS slide_id, s.title, s.description, s.source_type, s.source_id,
           c.id AS chapter_id, c.chapter_name, m.id AS module_id, m.module_name,
           subj.id AS subject_id, subj.subject_name,
           ps.id AS package_session_id, ps.package_id, ps.level_id
      FROM enrolled e
      JOIN package_session ps ON ps.id = e.package_session_id
      JOIN chapter_package_session_mapping cpsm
        ON cpsm.package_session_id = ps.id AND cpsm.status <> 'DELETED'
      JOIN chapter c ON c.id = cpsm.chapter_id AND c.status <> 'DELETED'
      JOIN chapter_to_slides cts ON cts.chapter_id = c.id AND cts.status <> 'DELETED'
      JOIN slide s ON s.id = cts.slide_id AND s.status IN ('PUBLISHED', 'UNSYNC')
      JOIN module_chapter_mapping mcm ON mcm.chapter_id = c.id
      JOIN modules m ON m.id = mcm.module_id AND m.status <> 'DELETED'
      JOIN subject_module_mapping smm ON smm.module_id = m.id
      JOIN subject subj ON subj.id = smm.subject_id AND subj.status <> 'DELETED'
      JOIN subject_session ss ON ss.subject_id = subj.id AND ss.session_id = ps.id
)
"""

_RESOURCE_SLIDES_SQL = text(_ENROLLED_SLIDES_CTE + """
, scored AS (
    SELECT p.*,
           (SELECT 3 * count(*) FILTER (WHERE p.title ILIKE '%' || w || '%')
                 + 2 * count(*) FILTER (WHERE p.chapter_name ILIKE '%' || w || '%')
                 + count(*) FILTER (WHERE p.module_name ILIKE '%' || w || '%'
                                       OR p.subject_name ILIKE '%' || w || '%'
                                       OR p.description ILIKE '%' || w || '%')
              FROM unnest(CAST(:words AS text[])) AS w) AS score
      FROM placed p
)
SELECT * FROM (
    SELECT DISTINCT ON (slide_id) *
      FROM scored
     WHERE score > 0
     ORDER BY slide_id, score DESC
) best
ORDER BY score DESC, title
LIMIT 5
""")

_RESOURCE_QUESTIONS_SQL = text(_ENROLLED_SLIDES_CTE + """
SELECT DISTINCT ON (q.id)
       q.id AS question_id, p.title AS slide_title,
       regexp_replace(rt.content, '<[^>]+>', '', 'g') AS question_text,
       p.slide_id, p.chapter_id, p.module_id, p.subject_id,
       p.package_session_id, p.package_id, p.level_id
  FROM placed p
  JOIN quiz_slide_question q ON q.quiz_slide_id = p.source_id AND q.status <> 'DELETED'
  JOIN rich_text_data rt ON rt.id = q.text_id
 WHERE p.source_type = 'QUIZ'
   AND EXISTS (SELECT 1 FROM unnest(CAST(:words AS text[])) AS w
                WHERE rt.content ILIKE '%' || w || '%')
 LIMIT 3
""")


class ToolManagerService:
    """
    Manages tool definitions and executes tool calls from the LLM.
    """
    
    def __init__(
        self,
        db_session: Session,
        rag_service=None,
        analytics_service=None,
        institute_id: str = "",
        user_id: str = "",
        context_meta: Optional[Dict[str, Any]] = None,
    ):
        self.db = db_session
        self.learning_progress_service = LearningProgressService(db_session)
        self.rag_service = rag_service
        self.analytics_service = analytics_service

        # Identity/tenant scope comes from the session row, NEVER from the tool
        # arguments the model produced. `institute_id` in particular is not a
        # declared parameter on any tool, so reading it out of `args` always
        # yielded "" and every scoped query silently matched zero rows —
        # semantic_search_content returned nothing on 571/571 production calls.
        # Holding it as instance state also means a hallucinated user_id cannot
        # be used to read another learner's progress.
        self.institute_id = institute_id or ""
        self.user_id = user_id or ""
        # What the learner is looking at (slide / batch ids), for tools that act on it.
        self.context_meta = context_meta or {}

        # Map tool names to executor methods
        self.executors: Dict[str, Callable] = {
            "get_my_courses": self._execute_get_my_courses,
            "get_my_live_classes": self._execute_get_my_live_classes,
            "get_my_tests": self._learner_tool(get_my_tests, "tests"),
            "get_my_results": self._learner_tool(get_my_results, "test results"),
            "get_my_performance": self._learner_tool(get_my_performance, "performance data"),
            "ask_teacher": self._execute_ask_teacher,
            "get_my_daily_tasks": self._learner_tool(get_my_daily_tasks, "daily tasks"),
            "show_steps": self._execute_show_steps,
            "make_flashcards": self._execute_make_flashcards,
            "get_learning_progress": self._execute_get_learning_progress,
            "get_student_feedback": self._execute_get_student_feedback,
            "search_related_resources": self._execute_search_resources,
            "semantic_search_content": self._execute_semantic_search,
            "get_learning_analytics": self._execute_get_analytics,
        }
    
    def get_tool_definitions(self) -> List[Dict[str, Any]]:
        """
        Get all tool definitions for the LLM.
        
        Returns:
            List of tool definitions in OpenAI format
        """
        return TOOL_DEFINITIONS
    
    async def execute_tool(self, tool_name: str, arguments: Dict[str, Any]) -> Union[str, ToolOutput]:
        """
        Execute a tool by name with given arguments.
        
        Args:
            tool_name: Name of the tool to execute
            arguments: Dictionary of arguments for the tool
            
        Returns:
            Tool execution result as a string
        """
        executor = self.executors.get(tool_name)
        
        if not executor:
            error_msg = f"Unknown tool: {tool_name}"
            logger.error(error_msg)
            return error_msg
        
        try:
            logger.info(f"Executing tool: {tool_name} with args: {arguments}")
            result = await executor(arguments)
            return result
        except Exception as e:
            error_msg = f"Error executing tool {tool_name}: {str(e)}"
            logger.error(error_msg)
            return error_msg
    
    async def _execute_get_my_courses(self, args: Dict[str, Any]) -> Union[str, ToolOutput]:
        if not self.user_id or not self.institute_id:
            return "LOOKUP FAILED: course lookup is unavailable right now. Do not guess their courses."
        try:
            return await get_my_courses(self.db, self.user_id, self.institute_id)
        except Exception as e:
            logger.error(f"get_my_courses failed: {e}")
            return (
                "LOOKUP FAILED: could not load the student's courses right now. Say so and "
                "suggest the Courses page."
            )

    async def _execute_show_steps(self, args: Dict[str, Any]) -> Union[str, ToolOutput]:
        steps = args.get("steps") or []
        card = {"kind": "steps", "title": args.get("title") or "Step by step", "items": steps}
        if len([s for s in steps if isinstance(s, dict)]) < 2:
            return "Not shown: give at least 2 steps, each with a title and body."
        return ToolOutput(
            text=(f"Shown as {len(steps)} steps the student reveals one at a time. Reply with one "
                  "short line inviting them to try each step before revealing the next."),
            card=card,
        )

    async def _execute_make_flashcards(self, args: Dict[str, Any]) -> Union[str, ToolOutput]:
        cards = args.get("cards") or []
        if len([c for c in cards if isinstance(c, dict)]) < 2:
            return "Not shown: give at least 2 cards, each with a front and back."
        return ToolOutput(
            text=(f"Shown as {len(cards)} flashcards. Reply with one short line telling them to "
                  "flip each card after trying to recall the answer."),
            card={"kind": "flashcards", "title": args.get("title") or "Flashcards", "items": cards},
        )

    async def _execute_ask_teacher(self, args: Dict[str, Any]) -> Union[str, ToolOutput]:
        if not self.user_id or not self.institute_id:
            return "LOOKUP FAILED: the question could not be sent right now. Do not say it was sent."
        try:
            return await ask_teacher(self.db, self.user_id, self.institute_id, args, self.context_meta)
        except Exception as e:
            logger.error(f"ask_teacher failed: {e}")
            return (
                "FAILED: the question could NOT be sent to the teacher. Tell the student honestly "
                "and suggest Help & Queries in the app (the ? icon)."
            )

    def _learner_tool(self, fn: Callable, what: str) -> Callable:
        """Executor for a learner_tools function: session identity in, honest failure out."""

        async def run(args: Dict[str, Any]) -> Union[str, ToolOutput]:
            if not self.user_id or not self.institute_id:
                return f"LOOKUP FAILED: {what} lookup is unavailable right now. Do not guess."
            try:
                return await fn(self.db, self.user_id, self.institute_id)
            except Exception as e:
                logger.error(f"{fn.__name__} failed: {e}")
                return (
                    f"LOOKUP FAILED: could not load the student's {what} right now. Say so; do "
                    "not guess names, dates, marks or ranks."
                )

        return run

    async def _execute_get_my_live_classes(self, args: Dict[str, Any]) -> Union[str, ToolOutput]:
        if not self.user_id or not self.institute_id:
            return "LOOKUP FAILED: live-class lookup is unavailable right now. Do not guess timings or links."
        try:
            return await get_my_live_classes(
                self.db, self.user_id, self.institute_id, str(args.get("which") or "upcoming")
            )
        except Exception as e:
            logger.error(f"get_my_live_classes failed: {e}")
            return (
                "LOOKUP FAILED: could not load live classes right now. Do not guess timings, links "
                "or recordings; point them to the Live Classes page."
            )

    async def _execute_get_learning_progress(self, args: Dict[str, Any]) -> str:
        """
        Get comprehensive learning progress from learner_operation table.
        Returns hierarchical paths, completion percentages, recent activity.
        """
        # Session identity wins over anything the model supplied.
        user_id = self.user_id or args.get("user_id")
        source_filter = args.get("source_filter")
        
        if not user_id:
            return "Error: user_id is required"
        
        try:
            # Use LearningProgressService to fetch and format data
            progress_data = await self.learning_progress_service.get_learning_progress(
                user_id=user_id,
                source_filter=source_filter,
                include_recent_activity=True
            )
            
            # Format for AI consumption
            return json.dumps(progress_data, indent=2, ensure_ascii=False)
            
        except Exception as e:
            logger.error(f"Error fetching learning progress: {e}")
            return f"Unable to fetch learning progress: {str(e)}"
    
    async def _execute_get_student_feedback(self, args: Dict[str, Any]) -> str:
        """
        Get student performance feedback from student_analysis_process and user_linked_data.
        """
        # Session identity wins over anything the model supplied.
        user_id = self.user_id or args.get("user_id")
        date_range_days = args.get("date_range_days", 30)
        
        if not user_id:
            return "Error: user_id is required"
        
        try:
            # Fetch strengths and weaknesses from user_linked_data
            stmt = text("""
                SELECT type, data, percentage
                FROM user_linked_data
                WHERE user_id = :user_id
                ORDER BY percentage DESC
            """)
            result = self.db.execute(stmt, {"user_id": user_id})
            rows = result.fetchall()
            
            strengths = []
            weaknesses = []
            
            for row in rows:
                type_val, data, percentage = row
                if type_val == "strength":
                    strengths.append(f"- {data} ({percentage}%)")
                elif type_val == "weakness":
                    weaknesses.append(f"- {data} ({percentage}%)")
            
            # Fetch recent analysis reports.
            #
            # This used to read `INTERVAL ':days days'` — a *quoted literal*, so
            # the bind never applied and Postgres raised
            # `invalid input syntax for type interval: ":days days"`. Because that
            # raise happened inside the same try as the strengths/weaknesses
            # query above, the whole tool returned "Unable to fetch student
            # feedback" and threw away data it had already fetched. make_interval
            # takes a real bind, and the lookup now fails in isolation.
            recent_report = ""
            try:
                stmt = text("""
                    SELECT status, report_json, created_at
                    FROM student_analysis_process
                    WHERE user_id = :user_id
                    AND created_at >= NOW() - make_interval(days => :days)
                    ORDER BY created_at DESC
                    LIMIT 1
                """)
                result = self.db.execute(
                    stmt, {"user_id": user_id, "days": int(date_range_days)}
                )
                analysis_row = result.fetchone()

                if analysis_row and analysis_row[1]:
                    report = (
                        json.loads(analysis_row[1])
                        if isinstance(analysis_row[1], str)
                        else analysis_row[1]
                    )
                    recent_report = (
                        f"\nRecent Analysis: "
                        f"{report.get('summary', 'No summary available')}"
                    )
            except Exception as e:
                logger.warning(f"Recent analysis report lookup failed: {e}")

            # Format response
            feedback = f"""
Student Performance Feedback:

Strengths:
{chr(10).join(strengths) if strengths else '- No strength data available yet'}

Areas for Improvement:
{chr(10).join(weaknesses) if weaknesses else '- No weakness data available yet'}
{recent_report}

Use this information to provide personalized guidance to the student.
"""
            return feedback.strip()
            
        except Exception as e:
            logger.error(f"Error fetching student feedback: {e}")
            return f"Unable to fetch student feedback: {str(e)}"
    
    async def _execute_search_resources(self, args: Dict[str, Any]) -> Union[str, ToolOutput]:
        """
        Find slides (and practice questions) on a topic in the learner's own
        courses, with links that open them.

        Scope is the learner's ACTIVE enrolments, not the whole institute: an
        institute-wide hit is often a course the learner cannot open. Matching
        is per word over the slide title and description and the chapter,
        module and subject names, ranked — the old version matched the whole
        topic phrase against slide titles only, so "Areas related to circles
        class 10" found nothing even when "Areas Related to Circles Lecture -
        01" was in the learner's course (~80% of production searches came back
        empty, Sep-Oct 2026).
        """
        topic = (args.get("topic") or "").strip()
        resource_type = args.get("resource_type", "all")
        if not topic:
            return "Error: topic is required"
        if not self.institute_id or not self.user_id:
            logger.error("search_related_resources called without learner scope")
            return (
                "LOOKUP FAILED: resource search is unavailable right now. Do not invent "
                "lesson names; tell the student you could not search their course."
            )
        words = search_words(topic)
        if not words:
            return (
                f"'{topic}' has no searchable topic words. Ask the student which topic they "
                "want material for."
            )
        try:
            slides = []
            if resource_type in ("slide", "all"):
                slides = self.db.execute(
                    _RESOURCE_SLIDES_SQL,
                    {"user_id": self.user_id, "institute_id": self.institute_id, "words": words},
                ).mappings().all()
            questions = []
            if resource_type in ("question", "all"):
                questions = self.db.execute(
                    _RESOURCE_QUESTIONS_SQL,
                    {"user_id": self.user_id, "institute_id": self.institute_id, "words": words},
                ).mappings().all()
        except Exception as e:
            logger.error(f"Error searching resources: {e}")
            return (
                "LOOKUP FAILED: could not search the course material right now. Tell the "
                "student you could not search it rather than guessing at what exists."
            )

        if not slides and not questions:
            return (
                f"Searched the courses this student is enrolled in for {', '.join(words)}: no lesson, "
                "chapter or question title matched. The material may still exist under a "
                "different name — suggest they browse the course, or teach the topic directly."
            )

        items: List[Dict[str, Any]] = []
        lines: List[str] = []
        for row in slides:
            where = " · ".join(x for x in (row["subject_name"], row["chapter_name"]) if x)
            items.append({
                "title": row["title"],
                "subtitle": where,
                "href": slide_href(row),
                "icon": _SLIDE_ICONS.get(str(row["source_type"] or "").upper(), "slide"),
            })
            lines.append(f"- {row['title']} ({row['source_type']}; {where})")
        for row in questions:
            q_text = " ".join((row["question_text"] or "").split())[:200]
            items.append({
                "title": q_text,
                "subtitle": f"Practice question · {row['slide_title']}",
                "href": slide_href(row),
                "icon": "question",
            })
            lines.append(f"- Question: {q_text} (in '{row['slide_title']}')")

        text = (
            "Found in the student's own courses (already shown to them as clickable links):\n"
            + "\n".join(lines)
        )
        card = {"kind": "link_list", "title": f"From your courses: {topic}"[:120], "items": items}
        return ToolOutput(text=text, card=card)

    async def _execute_semantic_search(self, args: Dict[str, Any]) -> str:
        """Search course content using semantic similarity via RAG."""
        query = args.get("query")
        top_k = args.get("top_k", 5)
        # Tenant scope is server-side state, not a model argument.
        institute_id = self.institute_id

        if not query:
            return "Error: query is required"

        if not institute_id:
            # Fail loudly rather than running an unscoped search that quietly
            # matches nothing — the model must be told the lookup did not run.
            logger.error("semantic_search_content called with no institute scope")
            return (
                "LOOKUP FAILED: content search is unavailable right now "
                "(no institute scope). Do not guess at course content; tell the "
                "student you could not search the material."
            )

        if not self.rag_service:
            return "Semantic search is not available. Falling back to keyword search."

        try:
            results = await self.rag_service.search(
                query=query,
                institute_id=institute_id,
                top_k=top_k,
            )

            if not results:
                return f"No relevant content found for: '{query}'"

            formatted = [f"Found {len(results)} relevant materials:\n"]
            for i, r in enumerate(results, 1):
                meta = r.get("metadata", {})
                title = meta.get("title", "Untitled")
                chapter = meta.get("chapter", "")
                subject = meta.get("subject", "")
                source = f"{r['source_type']}/{r['source_id']}"

                formatted.append(f"--- Result {i} (relevance: {r['similarity_score']}) ---")
                if title:
                    formatted.append(f"Title: {title}")
                if chapter:
                    formatted.append(f"Chapter: {chapter}")
                if subject:
                    formatted.append(f"Subject: {subject}")
                formatted.append(f"Source: {source}")
                formatted.append(f"Content:\n{r['content_text']}\n")

            return "\n".join(formatted)
        except Exception as e:
            logger.error(f"Semantic search error: {e}")
            return f"Search error: {str(e)}"


    async def _execute_get_analytics(self, args: Dict[str, Any]) -> str:
        """Get learning analytics for a student."""
        # Session identity wins over anything the model supplied.
        user_id = self.user_id or args.get("user_id")
        if not user_id:
            return "Error: user_id is required"
        if not self.analytics_service:
            return "Learning analytics is not available."
        try:
            return self.analytics_service.get_analytics_summary(user_id)
        except Exception as e:
            logger.error(f"Error getting analytics: {e}")
            return f"Unable to fetch analytics: {str(e)}"


__all__ = ["ToolManagerService", "TOOL_DEFINITIONS"]
