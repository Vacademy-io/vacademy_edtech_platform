"""
Follow-up suggestions for the Vacademy Assistant.

The model ends a helpful answer with a small fenced block::

    ```suggestions
    ["Show their attendance this month", "Any fees overdue?"]
    ```

No second model call is made. The block is cut out of the answer before the
user sees it (also while tokens stream, see ``SuggestionStreamFilter``), the
strings are checked by ``validate_suggestions`` and kept with the assistant
message as ``metadata.suggestions``. An answer without a usable block gets no
suggestions; none are ever made up.
"""
from __future__ import annotations

import json
import re
from typing import Any, Iterable, List, Optional, Sequence, Set, Tuple

#: The opening fence the model is asked to write (matched case-insensitively).
OPEN_FENCE = "```suggestions"
CLOSE_FENCE = "```"
#: Also accepts spaces or tabs between the backticks and the label ("``` suggestions").
_OPEN_RE = re.compile(r"```[ \t]*suggestions", re.I)
_LABEL = "suggestions"
_MAX_GAP = 8

MAX_SUGGESTIONS = 3
MAX_SUGGESTION_CHARS = 80

#: Tool-result error codes that mean the turn refused or failed: such a turn gets no suggestions.
REFUSAL_ERRORS = frozenset({
    "tool_not_permitted", "topic_not_available", "module_not_enabled", "tool_not_available", "tool_failed",
})

#: An answer that points the user to the AI access settings is telling them something is not enabled.
_SETTINGS_POINTER = "selectedTab=aiAccess"

PROMPT_RULES = (
    "FOLLOW-UP SUGGESTIONS:\n"
    "- After a helpful answer, end your reply with 2-3 short questions the user is likely to ask next, in "
    "this exact format and as the very last thing in the reply:\n"
    "```suggestions\n"
    "[\"First follow-up question\", \"Second follow-up question\"]\n"
    "```\n"
    "- Each is under 80 characters, written as the user would type it, in the user's language, and must be "
    "answerable with the capabilities enabled for this user (listed above). Never name tools, never include "
    "links, and never suggest calling, messaging, emailing or reminding people.\n"
    "- Leave the block out when you refuse, report an error, ask a clarifying question or a confirmation "
    "card is waiting for the user.\n"
    "- Never mention or explain this block in the visible answer.\n\n"
)


def _partial_open_len(text: str) -> int:
    """Length of the longest suffix of ``text`` that could be the start of the opening fence."""
    for size in range(min(len(text), 3 + _MAX_GAP + len(_LABEL) - 1), 0, -1):
        if _could_open(text[-size:].lower()):
            return size
    return 0


def _could_open(tail: str) -> bool:
    if len(tail) <= 3:
        return "```".startswith(tail)
    if not tail.startswith("```"):
        return False
    rest = tail[3:]
    label = rest.lstrip(" \t")
    return len(rest) - len(label) <= _MAX_GAP and _LABEL.startswith(label) and label != _LABEL


class SuggestionStreamFilter:
    """
    Removes ``suggestions`` blocks from streamed text.

    ``feed`` returns the part of each chunk that is safe to show now: text that
    could still turn out to be the start of the block is held back until the
    next chunk settles it, and everything inside a block is withheld. ``finish``
    returns the held-back visible tail and the raw bodies of the blocks seen
    (an unterminated block at the end still counts as a block).
    """

    def __init__(self) -> None:
        self._pending = ""
        self._block: Optional[str] = None
        self._bodies: List[str] = []

    def feed(self, chunk: str) -> str:
        if not chunk:
            return ""
        shown: List[str] = []
        if self._block is None:
            self._pending += chunk
        else:
            self._block += chunk
        while True:
            if self._block is None:
                found = _OPEN_RE.search(self._pending)
                if found is None:
                    hold = _partial_open_len(self._pending)
                    cut = len(self._pending) - hold
                    shown.append(self._pending[:cut])
                    self._pending = self._pending[cut:]
                    break
                shown.append(self._pending[:found.start()])
                self._block = self._pending[found.end():]
                self._pending = ""
            close = self._block.find(CLOSE_FENCE)
            if close < 0:
                break
            self._bodies.append(self._block[:close])
            self._pending = self._block[close + len(CLOSE_FENCE):]
            self._block = None
        return "".join(shown)

    def finish(self) -> Tuple[str, List[str]]:
        tail = ""
        if self._block is not None:
            self._bodies.append(self._block)
            self._block = None
        else:
            tail = self._pending
        self._pending = ""
        return tail, list(self._bodies)


def parse_block(body: str) -> Optional[List[Any]]:
    """The list in one block body, or None when the body is not a JSON list (or ``{"suggestions": [...]}``)."""
    try:
        value = json.loads((body or "").strip())
    except (TypeError, ValueError):
        return None
    if isinstance(value, dict):
        value = value.get("suggestions")
    return value if isinstance(value, list) else None


def split_suggestions(text: str) -> Tuple[str, Optional[List[Any]]]:
    """``(answer without any block, raw list from the last well-formed block or None)``."""
    stream = SuggestionStreamFilter()
    visible = stream.feed(text or "")
    tail, bodies = stream.finish()
    raw: Optional[List[Any]] = None
    for body in bodies:
        parsed = parse_block(body)
        if parsed is not None:
            raw = parsed
    return (visible + tail).rstrip(), raw


# ── validation ────────────────────────────────────────────────────────────

_HOW_TO = re.compile(r"^(how (do|can|should) (i|we)|how to|where (do|can) (i|we)|where is|where are)\b", re.I)
#: Actions this assistant never takes (they contact people); the matching pages do.
_CONTACT_ACTION = re.compile(
    r"^(please\s+)?(call|dial|phone|ring|whatsapp|sms|text|e-?mail|message|remind)\b"
    r"|^(please\s+)?send\s+(an?\s+|the\s+)?(whatsapp|sms|text|e-?mail|message|reminder)",
    re.I,
)
_SNAKE_CASE = re.compile(r"[a-z0-9]+_[a-z0-9_]+", re.I)
_LIST_PREFIX = re.compile(r"^\s*(?:[-*•]|\d+[.)])\s+")

_CRM_TOOLS = frozenset({"crm_leads", "crm_calls", "crm_meetings", "crm_messages", "crm_reports", "crm_collections",
                        "crm_lead_activity", "crm_lead_edit", "crm_lead_merge", "crm_lead_intake", "crm_team_edit",
                        "crm_meetings_edit"})
_LEARNER_TOOLS = frozenset({"learners", "learner_report", "find_batch", "list_batch_learners",
                            "list_recent_enrollments", "trigger_full_report", "update_learner_profile",
                            "manage_enrollment", "learner_edit", "learner_enroll", "get_fee_dues",
                            "get_payment_history", "search_fee_records"})

#: (words in a suggestion, tools that can answer it). A suggestion that names an area the caller has
#: none of these tools for is dropped (how-to questions excepted: the help search answers those).
_AREAS: Sequence[Tuple[re.Pattern, frozenset]] = (
    (re.compile(r"\b(leads?|enquir(y|ies)|inquir(y|ies)|counsell?ors?|follow[- ]?ups?|callbacks?)\b", re.I),
     _CRM_TOOLS),
    (re.compile(r"\b(fees?|dues?|overdue|payments?|paid|unpaid|collections?|collected|instal+ments?|invoices?|"
                r"revenue)\b", re.I),
     frozenset({"get_payment_history", "get_fee_dues", "search_fee_records", "get_collections_summary",
                "get_institute_overview", "get_subscription_plans", "crm_collections"})),
    (re.compile(r"\b(assessments?|tests?|exams?|quiz(zes)?|scores?|marks|results?|leaderboard|toppers?|"
                r"rank(s|ing)?|evaluations?|graded|grading)\b", re.I),
     frozenset({"find_assessment", "get_assessment_results", "get_assessment_leaderboard", "learner_report"})),
    (re.compile(r"\b(announcements?|broadcast)\b", re.I), frozenset({"list_announcements", "send_announcement"})),
    (re.compile(r"\b(live class(es)?|schedules?|scheduled|timetable)\b", re.I), frozenset({"get_class_schedule"})),
    (re.compile(r"\battendance\b", re.I), frozenset({"learner_report", "trigger_full_report"})),
    (re.compile(r"\b(website|landing page|web ?pages?)\b", re.I), frozenset({"website", "website_edit"})),
    (re.compile(r"\bblogs?\b", re.I), frozenset({"blog", "blog_edit"})),
    (re.compile(r"\b(automations?|workflows?)\b", re.I), frozenset({"workflows", "workflows_edit"})),
    (re.compile(r"\bsub[- ]?org(ani[sz]ations?|s)?\b", re.I),
     frozenset({"sub_orgs", "sub_org_edit", "sub_org_enroll"})),
    (re.compile(r"\b(enrol+(s|ed|ing|ments?)?)\b", re.I),
     frozenset({"learner_enroll", "manage_enrollment", "list_recent_enrollments", "sub_org_enroll", "learners"})),
    (re.compile(r"\b(learners?|students?)\b", re.I), _LEARNER_TOOLS),
    (re.compile(r"\bcourses?\b", re.I),
     frozenset({"courses", "course_edit", "course_drip_edit", "course_invites_edit", "course_structure_edit"})),
)


def _clean(value: Any) -> Optional[str]:
    if not isinstance(value, str):
        return None
    text = " ".join(value.split())
    text = _LIST_PREFIX.sub("", text).strip().strip("\"'“”‘’").strip()
    return text or None


def suggestion_allowed(text: str, usable_tools: Set[str], all_tools: Iterable[str] = ()) -> bool:
    """True when ``text`` is a short plain question this caller's tools can answer."""
    if len(text) > MAX_SUGGESTION_CHARS:
        return False
    low = text.lower()
    if any(mark in low for mark in ("`", "http://", "https://", "](", "{", "}")):
        return False
    if _SNAKE_CASE.search(text) or any(name and name.lower() in low for name in all_tools if "_" in name):
        return False
    if _HOW_TO.match(text):
        return "search_help_knowledge" in usable_tools
    if _CONTACT_ACTION.match(text):
        return False
    for words, tools in _AREAS:
        if words.search(text) and not (tools & usable_tools):
            return False
    return True


def validate_suggestions(
    raw: Optional[List[Any]],
    usable_tools: Iterable[str],
    *,
    all_tools: Iterable[str] = (),
    asked: Optional[str] = None,
) -> List[str]:
    """
    At most three distinct suggestions from the model's raw list: plain strings under
    80 characters, no tool names, links or markup, nothing that contacts people and
    nothing about an area the caller has no tool for. ``asked`` (the user's question)
    is never suggested back.
    """
    if not isinstance(raw, list):
        return []
    usable = set(usable_tools)
    known = list(all_tools)
    seen = {" ".join(str(asked).split()).lower().rstrip("?.! ")} if asked else set()
    out: List[str] = []
    for value in raw[:10]:
        text = _clean(value)
        if not text or not suggestion_allowed(text, usable, known):
            continue
        key = text.lower().rstrip("?.! ")
        if key in seen:
            continue
        seen.add(key)
        out.append(text)
        if len(out) == MAX_SUGGESTIONS:
            break
    return out


def refused_or_failed(tool_result: Any) -> bool:
    """True when a tool result says the call was refused or failed."""
    try:
        data = json.loads(tool_result) if isinstance(tool_result, str) else tool_result
    except (TypeError, ValueError):
        return False
    return isinstance(data, dict) and data.get("error") in REFUSAL_ERRORS


def answer_points_to_settings(text: str) -> bool:
    return _SETTINGS_POINTER in (text or "")


__all__ = [
    "OPEN_FENCE",
    "MAX_SUGGESTIONS",
    "MAX_SUGGESTION_CHARS",
    "PROMPT_RULES",
    "SuggestionStreamFilter",
    "parse_block",
    "split_suggestions",
    "suggestion_allowed",
    "validate_suggestions",
    "refused_or_failed",
    "answer_points_to_settings",
]
