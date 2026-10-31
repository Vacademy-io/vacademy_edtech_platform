"""
AI planner for daily engagement.

A teacher describes what they want — a batch, a stretch of days, a topic or a set
of chapters, the kinds of task they like — and the model drafts the whole plan in
the SAME shape the composer saves (slots with items). The draft is returned for
review and never published by this service: draft-and-approve, not autopilot.

Cost is planned, not incidental. ONE structured call produces every day's
questions, polls, written prompts, reading text and flashcard decks. It does not
produce illustrated pages: a fortnight of visual notes with pictures would cost
14 × (page + images) before the teacher had seen any of it. Readings come back as
plain semantic HTML with image placeholders, and the teacher upgrades the ones
worth it through the separate illustrate step, which is billed per picture.

Flashcards are native FLASHCARDS tasks: the model writes plain-text cards, and
`_norm_cards` turns them into the `flashcards/v1` payload admin_core validates
(FlashcardsPayloadValidator is authoritative; the limits here mirror it). There
is no rendered HTML game any more — the learner app draws the deck itself.

Models: text on the 'engagement_plan' use case (super-admin portal; GLM by
default); pictures on qwen/qwen-image-3 via illustrate_document.
"""
from __future__ import annotations

import html as html_lib
import json
import logging
import os
import re
import secrets
import unicodedata
from datetime import date, timedelta
from typing import Any, Callable, Dict, List, Optional, Set, Tuple

import httpx
from .llm_router import open_chat_stream, post_chat

from ..constants.model_defaults import GLM_DEFAULT
from .document_postprocess import adopt_foreign_images

logger = logging.getLogger(__name__)

# Hard fallback only: the model comes from the 'engagement_plan' use case
# (ai_model_defaults, super-admin portal); ENGAGEMENT_PLAN_MODEL still wins.
DEFAULT_MODEL = GLM_DEFAULT
USE_CASE = "engagement_plan"
MAX_TOKENS = 24000
MAX_DAYS = 31
MAX_ITEMS_PER_DAY = 3
MAX_GROUNDING_CHARS = 24000
# admin_core refuses points outside 0..1000 on save (EngagementItemChangePolicy),
# so a model value out of range would only surface as a failed publish later.
MAX_POINTS = 1000

# Flashcards. admin_core's FlashcardsPayloadValidator is authoritative; these
# mirror its limits (UTF-16 units, like Java String.length and JS .length) so a
# drafted deck never fails the save the teacher makes after review.
FLASHCARDS_SCHEMA = "flashcards/v1"
CARD_MAX_FRONT = 200
CARD_MAX_BACK = 500
CARD_MAX_HINT = 150
CARD_MAX_LINES = 12
CARD_ID_RE = re.compile(r"^[a-z0-9_-]{1,24}$")
# The planner's own bounds on a drafted deck, tighter than the 1..50 the server
# allows: fewer than 3 cards is not a study session, and more than 20 is a chore.
DECK_MIN_CARDS = 3
DECK_MAX_CARDS = 20

# "GAME" is accepted from the model only as the old flashcards shape (a GAME
# item carrying `cards`); it is emitted as FLASHCARDS or dropped.
ITEM_TYPES = {
    "QUESTION_OF_DAY",
    "POLL",
    "READING_HTML",
    "VISUAL_NOTE",
    "FLASHCARDS",
    "GAME",
}


# ── schedule ─────────────────────────────────────────────────────────────────

_WEEKDAY_NAMES = {
    "mon": 1, "monday": 1,
    "tue": 2, "tues": 2, "tuesday": 2,
    "wed": 3, "wednesday": 3,
    "thu": 4, "thur": 4, "thurs": 4, "thursday": 4,
    "fri": 5, "friday": 5,
    "sat": 6, "saturday": 6,
    "sun": 7, "sunday": 7,
}
_WEEKDAY_ABBR = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")
_MONTH_ABBR = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")


def parse_weekdays(value: Any) -> Optional[List[int]]:
    """The weekdays a plan runs on, as sorted ISO numbers (Mon=1 … Sun=7).

    None means every day. Accepted: a list of numbers — ISO 1-7, with 0 also
    meaning Sunday so JS getDay() values work too — or of names ("mon",
    "Tuesday"); a comma-separated string of either; or the composer's dowMask
    bitmask (Mon=1, Tue=2, … Sun=64) as a single integer. An empty list is
    returned as [] (no day selected) for the caller to refuse. Anything else
    raises ValueError.
    """
    if value is None:
        return None
    if isinstance(value, bool):
        raise ValueError("weekdays must be a list of days")
    if isinstance(value, int):
        if not 1 <= value <= 127:
            raise ValueError("a weekday mask is 1..127")
        return [d + 1 for d in range(7) if value & (1 << d)]
    if isinstance(value, str):
        value = [part for part in re.split(r"[\s,]+", value) if part]
    if not isinstance(value, (list, tuple, set)):
        raise ValueError("weekdays must be a list of days")
    out: Set[int] = set()
    for v in value:
        if isinstance(v, bool):
            raise ValueError("weekdays must be a list of days")
        if isinstance(v, int):
            n = v
        elif isinstance(v, str):
            s = v.strip().lower()
            if s.isdigit():
                n = int(s)
            elif s in _WEEKDAY_NAMES:
                n = _WEEKDAY_NAMES[s]
            else:
                raise ValueError(f"unknown weekday {v!r}")
        else:
            raise ValueError("weekdays must be a list of days")
        n = 7 if n == 0 else n
        if not 1 <= n <= 7:
            raise ValueError(f"weekday {v!r} is out of range")
        out.add(n)
    return sorted(out)


def plan_dates(brief: Dict[str, Any]) -> List[date]:
    """The dates a draft covers, in order.

    An explicit `dates` list (the wizard's institute-local run dates, already
    filtered to the chosen weekdays) wins: those dates, de-duplicated, sorted,
    at most MAX_DAYS. Otherwise `days` is the calendar span from `start_date`
    and `weekdays`, when given, keeps only the matching dates in that span
    (Mon–Fri over 7 days = 5 dates). A single-task regenerate is always one
    date: the start date.
    """
    start = _as_date(brief["start_date"])
    if brief.get("single_item_type"):
        return [start]
    explicit = brief.get("dates")
    if explicit:
        return sorted({_as_date(d) for d in explicit})[:MAX_DAYS]
    span = max(1, min(_int(brief.get("days"), 1), MAX_DAYS))
    every = [start + timedelta(days=i) for i in range(span)]
    wanted = parse_weekdays(brief.get("weekdays"))
    if wanted is None:
        return every
    return [d for d in every if d.isoweekday() in wanted]


def _date_label(d: date) -> str:
    return f"{_WEEKDAY_ABBR[d.weekday()]} {d.day} {_MONTH_ABBR[d.month - 1]}"


# ── chrome (the planner's own words inside a draft) ─────────────────────────

# Fallback titles the planner writes when the model leaves one blank. They land
# in the teacher's plan and the learner's app, so they follow the brief's
# language rather than always being English.
_CHROME: Dict[str, Dict[str, str]] = {
    "en": {"day": "Day {n}", "task": "Day {n} task", "plan": "AI engagement plan"},
    "hi": {"day": "दिन {n}", "task": "दिन {n} का कार्य", "plan": "AI सहभागिता योजना"},
    "fr": {"day": "Jour {n}", "task": "Tâche du jour {n}", "plan": "Plan d'engagement IA"},
    "ar": {"day": "اليوم {n}", "task": "مهمة اليوم {n}", "plan": "خطة تفاعل بالذكاء الاصطناعي"},
}
_LANG_ALIASES = {
    "hi": "hi", "hindi": "hi", "हिन्दी": "hi", "हिंदी": "hi",
    "fr": "fr", "french": "fr", "français": "fr", "francais": "fr",
    "ar": "ar", "arabic": "ar", "العربية": "ar",
}


def chrome(language: Any, key: str, **kw: Any) -> str:
    """One of the planner's own strings in the brief's language (English for
    anything it has no translation for)."""
    raw = str(language or "").strip().lower()
    code = _LANG_ALIASES.get(raw) or _LANG_ALIASES.get(raw.split("-")[0].split("_")[0]) or "en"
    return _CHROME[code][key].format(**kw)


# ── prompt ────────────────────────────────────────────────────────────────────

def _schema_text() -> str:
    return """
Return ONLY a JSON object, no prose, no code fence, of this exact shape:

{
  "title": "short plan title",
  "days": [
    {
      "day": 1,
      "theme": "one-line theme for the day",
      "items": [
        {
          "type": "QUESTION_OF_DAY",
          "format": "MCQ",
          "title": "short task title",
          "prompt": "<p>the question, as simple HTML</p>",
          "options": [{"id":"a","text":"..."},{"id":"b","text":"..."},{"id":"c","text":"..."},{"id":"d","text":"..."}],
          "correctOptionId": "b",
          "explanation": "<p>why b is right, as simple HTML</p>",
          "completionPoints": 10,
          "correctPoints": 20
        },
        {
          "type": "QUESTION_OF_DAY",
          "format": "TEXT",
          "title": "...",
          "prompt": "<p>a reflective question the learner answers in writing</p>",
          "explanation": "<p>what a good answer covers</p>",
          "completionPoints": 15
        },
        {
          "type": "POLL",
          "title": "...",
          "prompt": "<p>an opinion question with no right answer</p>",
          "options": [{"id":"a","text":"..."},{"id":"b","text":"..."}],
          "completionPoints": 5
        },
        {
          "type": "READING_HTML",
          "title": "...",
          "contentHtml": "<h2>...</h2><p>...</p>  (200-350 words of semantic HTML: h2, p, ul, li, strong; up to 2 <img data-img-prompt=\\"a clear illustration prompt\\" alt=\\"...\\"> placeholders where a picture would genuinely help)",
          "completionPoints": 10
        },
        {
          "type": "FLASHCARDS",
          "title": "...",
          "cards": [{"front":"term or question (at most 120 characters)","back":"definition or answer (at most 300 characters)","hint":"optional nudge (at most 100 characters)"}, ...6 to 12 cards],
          "completionPoints": 10
        }
      ]
    }
  ]
}

Rules:
- Every day MUST have exactly the requested number of items, and the days array MUST have exactly the requested number of days, in date order.
- Use only the task types the teacher enabled. Vary types across days so no two consecutive days feel the same.
- MCQ: exactly 4 options with ids a,b,c,d; exactly one correctOptionId; distractors must be plausible, not silly.
- Questions must be answerable from the provided material when material is given; never invent facts.
- Language: write everything in the requested language.
- Difficulty: honour the requested level.
- FLASHCARDS: 6 to 12 cards; plain text only (no HTML, no markdown); every front different; every card answerable from the material.
- Keep prompts and explanations concise. No markdown anywhere — HTML only inside HTML fields, plain text elsewhere.
""".strip()


# Regenerating ONE task: what the teacher asked for → (the label the prompt
# enables, the itemType the result must carry, the QUESTION_OF_DAY format it must
# carry). A VISUAL_NOTE is drafted as a reading with picture placeholders — the
# pictures are the separate, per-picture illustrate step — but it comes back typed
# VISUAL_NOTE so the task keeps its type in the review.
SINGLE_ITEM_TARGETS: Dict[str, Tuple[str, str, Optional[str]]] = {
    "QUESTION_OF_DAY": ("QUESTION_OF_DAY (format MCQ)", "QUESTION_OF_DAY", "MCQ"),
    "TEXT_QUESTION": ("QUESTION_OF_DAY (format TEXT)", "QUESTION_OF_DAY", "TEXT"),
    "POLL": ("POLL", "POLL", None),
    "READING_HTML": ("READING_HTML", "READING_HTML", None),
    "VISUAL_NOTE": ("READING_HTML", "VISUAL_NOTE", None),
    "FLASHCARDS": ("FLASHCARDS", "FLASHCARDS", None),
    # The wizard before native flashcards regenerated a deck as "GAME"; the
    # replacement is a native deck either way.
    "GAME": ("FLASHCARDS", "FLASHCARDS", None),
}


def single_item_target(single: Any) -> Optional[Tuple[str, str, Optional[str]]]:
    """The target for a single-task regenerate, or None for a type this planner
    cannot draft (the router turns that into a 400 before any paid call)."""
    return SINGLE_ITEM_TARGETS.get(str(single or "").strip().upper())


def build_prompt(brief: Dict[str, Any], grounding: str) -> str:
    single = brief.get("single_item_type")
    target = single_item_target(single) if single else None
    if target:
        # Regenerating ONE task: ONLY its type is enabled. The plan's mix is
        # ignored here — appending it let the model swap a visual note for a
        # question, and the teacher lost the task (and its paid pictures).
        enabled_types = [target[0]]
    else:
        mix = brief.get("mix") or {}
        enabled_types = []
        if mix.get("question_of_day", True):
            enabled_types.append("QUESTION_OF_DAY (format MCQ)")
        if mix.get("text_question"):
            enabled_types.append("QUESTION_OF_DAY (format TEXT)")
        if mix.get("poll"):
            enabled_types.append("POLL")
        if mix.get("reading"):
            enabled_types.append("READING_HTML")
        # `game` is the pre-flashcards wizard's name for the same toggle.
        if mix.get("flashcards") or mix.get("game"):
            enabled_types.append("FLASHCARDS")
    if not enabled_types:
        enabled_types = ["QUESTION_OF_DAY (format MCQ)"]

    avoid = brief.get("avoid_title")
    dates = plan_dates(brief) if brief.get("start_date") else None
    n_days = 1 if single else (len(dates) if dates is not None else brief["days"])
    per_day = 1 if single else brief.get("per_day_items", 2)
    parts = [
        "You are planning daily engagement tasks for a class. A teacher will review and edit "
        "everything you produce before learners see it.",
        "",
        f"Number of days: {n_days}",
        f"Tasks per day: exactly {per_day}",
        f"Enabled task types: {', '.join(enabled_types)}",
        f"Difficulty: {brief.get('difficulty', 'medium')}",
        f"Language: {brief.get('language', 'English')}",
        f"Audience: {brief.get('audience') or 'students in this batch'}",
        "",
        f"Topic / instructions from the teacher:\n{brief.get('topic') or '(none given — use the material below)'}",
    ]
    if dates and not single:
        parts += [
            "",
            "The days, in order (days[0] is Day 1): "
            + "; ".join(f"Day {i + 1} = {_date_label(d)}" for i, d in enumerate(dates)),
        ]
    if single:
        parts += [
            "",
            f"Produce EXACTLY ONE day with EXACTLY ONE item, of type {enabled_types[0]} and no other type. "
            + (f"Do not reuse this rejected task: \"{avoid}\". Cover a different angle." if avoid else ""),
        ]
        if target and target[1] == "VISUAL_NOTE":
            parts.append(
                "This reading becomes an illustrated page: include 1 or 2 "
                "<img data-img-prompt=\"...\" alt=\"...\"> placeholders where a picture genuinely helps."
            )
    if grounding:
        parts += [
            "",
            "MATERIAL TO GROUND EVERY TASK IN (do not go beyond it):",
            "<<<",
            grounding,
            ">>>",
        ]
    parts += ["", _schema_text()]
    return "\n".join(parts)


# ── grounding ────────────────────────────────────────────────────────────────

_TAG_RE = re.compile(r"<[^>]+>")


def strip_html(text: str) -> str:
    return html_lib.unescape(_TAG_RE.sub(" ", text or "")).replace("\xa0", " ")


def assemble_grounding(texts: List[Dict[str, str]], kb_hits: List[Dict[str, Any]]) -> str:
    """Concatenate teacher-supplied slide text and KB hits under a hard character
    budget, most relevant first, so a huge chapter cannot blow the prompt."""
    chunks: List[str] = []
    for t in texts or []:
        title = (t.get("title") or "").strip()
        body = re.sub(r"\s+", " ", strip_html(t.get("text") or "")).strip()
        if body:
            chunks.append(f"## {title}\n{body}" if title else body)
    for hit in kb_hits or []:
        body = hit.get("text") or hit.get("content") or hit.get("chunk_text") or ""
        body = re.sub(r"\s+", " ", str(body)).strip()
        if body:
            chunks.append(body)
    out, used = [], 0
    for c in chunks:
        if used + len(c) > MAX_GROUNDING_CHARS:
            remaining = MAX_GROUNDING_CHARS - used
            if remaining > 400:
                out.append(c[:remaining])
            break
        out.append(c)
        used += len(c) + 2
    return "\n\n".join(out)


# ── model call ───────────────────────────────────────────────────────────────

_REASONING_EFFORTS = {"none", "minimal", "low", "medium", "high", "xhigh"}


def reasoning_effort() -> str:
    """GLM reasons for minutes by default, and a plan is a structured fill, not a
    puzzle. Override with ENGAGEMENT_PLAN_REASONING_EFFORT (low|medium|high, or
    "" for the model's default) — the same knob the HTML-document generator has.
    A typo falls back to low: the provider would 400 every draft on it."""
    effort = os.getenv("ENGAGEMENT_PLAN_REASONING_EFFORT", "low").strip().lower()
    if effort and effort not in _REASONING_EFFORTS:
        logger.warning("[engagement-plan] unknown reasoning effort %r; using low", effort)
        return "low"
    return effort


def _payload(prompt: str, model: str) -> Dict[str, Any]:
    payload: Dict[str, Any] = {
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.6,
        "max_tokens": MAX_TOKENS,
        # Ask for JSON where the provider supports it; the parser below
        # still tolerates a fenced or prefixed reply.
        "response_format": {"type": "json_object"},
    }
    effort = reasoning_effort()
    if effort:
        payload["reasoning"] = {"effort": effort}
    return payload


async def call_model(prompt: str, api_key: str, base_url: str, model: str) -> Tuple[str, dict]:
    """One non-streamed call (the synchronous draft endpoint)."""
    payload = _payload(prompt, model)
    # base_url is kept for callers; the gateway comes from the route map.
    async with httpx.AsyncClient(timeout=240.0) as client:
        resp = await post_chat(client, payload, api_key)
    if resp.status_code != 200:
        raise httpx.HTTPStatusError(
            f"OpenRouter {resp.status_code}: {resp.text[:500]}",
            request=resp.request,
            response=resp,
        )
    data = resp.json()
    choices = data.get("choices") or []
    if not choices:
        raise RuntimeError(f"OpenRouter returned no choices: {str(data)[:300]}")
    content = (choices[0].get("message") or {}).get("content") or ""
    if not content.strip():
        raise RuntimeError("OpenRouter returned empty content")
    return content, (data.get("usage") or {})


# Per read, not per call: a streamed draft keeps the connection busy for
# minutes, and OpenRouter sends keep-alive comments while the model reasons.
_STREAM_TIMEOUT = httpx.Timeout(connect=20.0, read=180.0, write=30.0, pool=20.0)

OnDelta = Callable[[str, Any], None]


async def stream_model(
    prompt: str,
    api_key: str,
    base_url: str,
    model: str,
    on_delta: Optional[OnDelta] = None,
) -> Tuple[str, dict]:
    """The same call, streamed, so a background job can report progress.

    `on_delta("reasoning", n_chars)` fires while the model thinks and
    `on_delta("content", text)` for every piece of the JSON it writes. Returns
    the whole reply and the usage from the final chunk. Raises on a non-200, a
    mid-stream provider error, or an empty reply.
    """
    payload = _payload(prompt, model)
    payload["stream"] = True
    # A final usage chunk, so a job bills on actual tokens like the sync path.
    payload["stream_options"] = {"include_usage": True}
    pieces: List[str] = []
    usage: dict = {}
    async with httpx.AsyncClient(timeout=_STREAM_TIMEOUT) as client:
        async with open_chat_stream(client, payload, api_key) as resp:
            if resp.status_code != 200:
                detail = (await resp.aread()).decode(errors="ignore")[:500]
                raise httpx.HTTPStatusError(
                    f"OpenRouter {resp.status_code}: {detail}", request=resp.request, response=resp
                )
            async for line in resp.aiter_lines():
                if not line or not line.startswith("data:"):
                    continue
                data_str = line[len("data:"):].strip()
                if data_str == "[DONE]":
                    break
                try:
                    chunk = json.loads(data_str)
                except ValueError:
                    continue
                if not isinstance(chunk, dict):
                    continue
                if chunk.get("error"):
                    raise RuntimeError(f"OpenRouter stream error: {str(chunk['error'])[:300]}")
                if chunk.get("usage"):
                    usage = chunk["usage"]
                choices = chunk.get("choices") or []
                delta = (choices[0].get("delta") or {}) if choices else {}
                reasoning = delta.get("reasoning") or delta.get("reasoning_content")
                if reasoning and on_delta:
                    on_delta("reasoning", len(reasoning))
                piece = delta.get("content")
                if piece:
                    pieces.append(piece)
                    if on_delta:
                        on_delta("content", piece)
    text = "".join(pieces)
    if not text.strip():
        raise RuntimeError("OpenRouter returned empty content")
    return text, usage


_DAY_ITEMS_KEY_RE = re.compile(r'"items"\s*:')


def drafted_days(partial: str, total: int) -> int:
    """Days fully written so far in a streamed reply. Every day object has one
    "items" key; the newest one is still being written."""
    started = len(_DAY_ITEMS_KEY_RE.findall(partial or ""))
    return max(0, min(total, started - 1))


def parse_json_lenient(text: str) -> Dict[str, Any]:
    """Accept a bare object, a fenced object, or prose around an object."""
    s = text.strip()
    s = re.sub(r"^```(?:json)?\s*", "", s)
    s = re.sub(r"\s*```$", "", s)
    try:
        return json.loads(s)
    except json.JSONDecodeError:
        start, end = s.find("{"), s.rfind("}")
        if start >= 0 and end > start:
            return json.loads(s[start : end + 1])
        raise


_DAYS_ARRAY_RE = re.compile(r'"days"\s*:\s*\[')
_TITLE_RE = re.compile(r'"title"\s*:\s*("(?:[^"\\]|\\.)*")')


def salvage_partial_plan(text: str) -> Optional[Dict[str, Any]]:
    """The complete days of a reply that was cut off (the token cap on a long
    plan, or a stream that dropped near the end), or None when not even one
    day object is complete.

    Throwing away six finished days because the seventh was cut mid-sentence
    wastes minutes of the teacher's wait; the review reports the missing dates
    instead, and the charge follows what was delivered.
    """
    s = text or ""
    m = _DAYS_ARRAY_RE.search(s)
    if not m:
        return None
    decoder = json.JSONDecoder()
    days: List[Any] = []
    i = m.end()
    while True:
        while i < len(s) and s[i] in " \t\r\n,":
            i += 1
        if i >= len(s) or s[i] != "{":
            break
        try:
            day, i = decoder.raw_decode(s, i)
        except ValueError:
            break
        days.append(day)
    if not days:
        return None
    title = ""
    head = _TITLE_RE.search(s[: m.start()])
    if head:
        try:
            title = str(json.loads(head.group(1)))
        except ValueError:
            title = ""
    return {"title": title, "days": days}


def parse_draft_reply(text: str) -> Dict[str, Any]:
    """The model's reply as an object: the whole JSON when it parses, else the
    complete days of a truncated one. Raises when neither works."""
    try:
        return parse_json_lenient(text)
    except (ValueError, TypeError):
        salvaged = salvage_partial_plan(text)
        if salvaged is None:
            raise
        logger.warning(
            "[engagement-plan] reply was cut off; kept %d complete day(s)", len(salvaged["days"])
        )
        return salvaged


# ── validation / normalisation ───────────────────────────────────────────────

def _norm_options(raw: Any) -> List[Dict[str, str]]:
    out: List[Dict[str, str]] = []
    if not isinstance(raw, list):
        return out
    seen: set = set()
    for idx, o in enumerate(raw[:6]):
        if isinstance(o, dict):
            text = str(o.get("text") or "").strip()
            oid = str(o.get("id") or chr(97 + idx)).strip().lower()[:2]
        else:
            text = str(o).strip()
            oid = chr(97 + idx)
        if not text:
            continue
        if not oid or oid in seen:
            # Two options with one id would collapse into one on save (and could
            # make the wrong one "correct"); give the repeat the next free letter.
            oid = next(c for c in "abcdefghijkl" if c not in seen)
        seen.add(oid)
        out.append({"id": oid, "text": text})
    return out


_BREAK_TAG_RE = re.compile(r"<\s*(?:br\s*/?|/p|/li|/div|/h[1-6])\s*>", re.IGNORECASE)
# Only things shaped like real tags: "2 < x > 1" survives, "<b>x</b>" does not.
_CARD_TAG_RE = re.compile(r"</?[A-Za-z][A-Za-z0-9-]*(?:\s[^<>]*)?/?>")
_MD_BOLD_RE = re.compile(r"(\*\*|__)(.+?)\1")
_H_SPACE_RE = re.compile(r"[^\S\n]+")


def _card_text(raw: Any) -> str:
    """One card face as the plain text the deck stores.

    This is the ONLY place card text is tag-stripped: the model was asked for
    plain text, so markup here is a slip, not content (admin_core keeps a
    teacher's "<b>x</b>" verbatim). Then the server's normalisation: newlines
    kept, other whitespace one space, control characters removed, trimmed.
    """
    if isinstance(raw, bool) or not isinstance(raw, (str, int, float)):
        return ""
    s = str(raw)
    s = _BREAK_TAG_RE.sub("\n", s)
    s = _CARD_TAG_RE.sub(" ", s)
    s = html_lib.unescape(s)
    s = _MD_BOLD_RE.sub(r"\2", s)
    s = s.replace("\r\n", "\n").replace("\r", "\n").replace("\ufeff", " ")
    s = "".join(ch for ch in s if ch == "\n" or ch.isspace() or unicodedata.category(ch) != "Cc")
    s = _H_SPACE_RE.sub(" ", s)
    s = re.sub(r" ?\n ?", "\n", s)
    s = re.sub(r"\n{3,}", "\n\n", s)
    return s.strip()


def _utf16_len(s: str) -> int:
    return len(s.encode("utf-16-le")) // 2


def _fits(text: str, limit: int) -> bool:
    return _utf16_len(text) <= limit and text.count("\n") + 1 <= CARD_MAX_LINES


def mint_card_id(taken: Set[str]) -> str:
    """`c_` plus 6 base36 characters, unique within the deck."""
    alphabet = "0123456789abcdefghijklmnopqrstuvwxyz"
    while True:
        cid = "c_" + "".join(secrets.choice(alphabet) for _ in range(6))
        if cid not in taken:
            return cid


def _face(card: Dict[str, Any], *keys: str) -> Any:
    for k in keys:
        if card.get(k) not in (None, ""):
            return card.get(k)
    return None


def _norm_cards(raw: Any) -> Optional[List[Dict[str, str]]]:
    """The model's cards → a deck admin_core will accept, or None when fewer
    than DECK_MIN_CARDS survive.

    Strips tags, trims, drops a card that is missing a face or over a length
    or line limit (an over-long hint loses only the hint), drops a repeated
    front (case-insensitive), caps the deck at DECK_MAX_CARDS and mints fresh
    ids — the model's own ids are never trusted.
    """
    if not isinstance(raw, list):
        return None
    cards: List[Dict[str, str]] = []
    fronts: Set[str] = set()
    ids: Set[str] = set()
    for c in raw:
        if len(cards) >= DECK_MAX_CARDS:
            break
        if not isinstance(c, dict):
            continue
        front = _card_text(_face(c, "front", "term", "question"))
        back = _card_text(_face(c, "back", "definition", "answer"))
        if not front or not back:
            continue
        if not _fits(front, CARD_MAX_FRONT) or not _fits(back, CARD_MAX_BACK):
            continue
        key = " ".join(front.casefold().split())
        if key in fronts:
            continue
        fronts.add(key)
        cid = mint_card_id(ids)
        ids.add(cid)
        card = {"id": cid, "front": front, "back": back}
        hint = _card_text(c.get("hint"))
        if hint and _fits(hint, CARD_MAX_HINT):
            card["hint"] = hint
        cards.append(card)
    return cards if len(cards) >= DECK_MIN_CARDS else None


def flashcards_payload(cards: List[Dict[str, str]]) -> Dict[str, Any]:
    """The v1 payload, in the shape admin_core canonicalises to."""
    return {"schema": FLASHCARDS_SCHEMA, "cards": cards, "settings": {"shuffle": True}}


def _int(value: Any, default: int) -> int:
    """Points from the model: a number, a numeric string, or junk. Junk means
    the brief's default, never a crash that loses a paid draft."""
    try:
        return int(value) if value not in (None, "") else default
    except (TypeError, ValueError):
        return default


def _points(value: Any, default: int) -> int:
    """A model-chosen point value: zero, junk or out of the range the engagement
    API accepts means the brief's default."""
    n = _int(value, default)
    return n if 0 < n <= MAX_POINTS else default


def _as_date(value: Any) -> date:
    """The router hands over a validated `date`; older callers pass yyyy-MM-dd."""
    return value if isinstance(value, date) else date.fromisoformat(str(value))


def _normalise_item(
    it: Any,
    day_index: int,
    default_completion: int,
    default_correct: int,
    keep_points: bool = False,
    language: Any = "English",
) -> Optional[Dict[str, Any]]:
    """One model item → one composer item, or None when it is malformed.

    keep_points: a regenerate replaces the task's content, not its reward — the
    brief carries the replaced task's own points, and the model's are ignored.
    """
    if not isinstance(it, dict):
        return None
    itype = str(it.get("type") or "").upper()
    if itype not in ITEM_TYPES:
        return None
    title = str(it.get("title") or "").strip() or chrome(language, "task", n=day_index + 1)
    base: Dict[str, Any] = {
        "itemType": itype,
        "title": title[:200],
        "isRequired": True,
        "completionPoints": default_completion if keep_points else _points(it.get("completionPoints"), default_completion),
        "correctPoints": 0,
    }

    if itype == "QUESTION_OF_DAY":
        fmt = str(it.get("format") or "MCQ").upper()
        prompt = str(it.get("prompt") or "").strip()
        if not prompt:
            return None
        payload: Dict[str, Any] = {"format": fmt, "prompt": prompt}
        if fmt == "MCQ":
            options = _norm_options(it.get("options"))
            correct = str(it.get("correctOptionId") or "").strip().lower()
            if len(options) < 2 or not any(o["id"] == correct for o in options):
                return None
            payload["options"] = options
            payload["correctOptionId"] = correct
            payload["explanation"] = str(it.get("explanation") or "")
            base["correctPoints"] = default_correct if keep_points else _points(it.get("correctPoints"), default_correct)
            base["hideResultUntilReveal"] = True
        elif fmt in ("TEXT", "UPLOAD"):
            payload["explanation"] = str(it.get("explanation") or "")
        else:
            return None
        base["payloadJson"] = json.dumps(payload)

    elif itype == "POLL":
        prompt = str(it.get("prompt") or "").strip()
        options = _norm_options(it.get("options"))
        if not prompt or len(options) < 2:
            return None
        base["payloadJson"] = json.dumps({"format": "MCQ", "prompt": prompt, "options": options})

    elif itype in ("READING_HTML", "VISUAL_NOTE"):
        content = str(it.get("contentHtml") or "").strip()
        # Models sometimes invent <img src="https://…"> instead of the placeholder
        # contract; those reach learners as broken images. Adopt them as
        # placeholders (drawn from their alt) so the illustrate step can draw them.
        content, _ = adopt_foreign_images(content)
        if len(strip_html(content)) < 80:
            return None
        base["itemType"] = "READING_HTML"
        base["contentHtml"] = content

    elif itype in ("FLASHCARDS", "GAME"):
        # A deck is completion-scored: studying it earns the completion points,
        # and there is no "correct" reward (admin_core forces correctPoints 0).
        cards = _norm_cards(it.get("cards"))
        if cards is None:
            return None
        base["itemType"] = "FLASHCARDS"
        base["payloadJson"] = json.dumps(flashcards_payload(cards), ensure_ascii=False)
        base["maxScore"] = len(cards)
        base["correctPoints"] = 0
        base["hideResultUntilReveal"] = False

    return base


def _slot(brief: Dict[str, Any], when: date, day_index: int, day: Any, items: List[Dict[str, Any]]) -> Dict[str, Any]:
    theme = str(day.get("theme") or "").strip() if isinstance(day, dict) else ""
    return {
        "title": (theme or chrome(brief.get("language"), "day", n=day_index + 1))[:200],
        "startDate": when.isoformat(),
        "startTime": brief.get("start_time", "06:00"),
        "endTime": brief.get("end_time", "20:00"),
        "revealTime": brief.get("reveal_time") or None,
        "notifyTime": brief.get("notify_time") or None,
        "items": items,
    }


def _plan_title(raw: Dict[str, Any], brief: Dict[str, Any]) -> str:
    # The teacher's own title wins; the model's is only a fallback for a blank one.
    title = str(brief.get("title") or "").strip() or str(raw.get("title") or "").strip()
    return (title or chrome(brief.get("language"), "plan"))[:200]


def normalise_draft(
    raw: Dict[str, Any],
    brief: Dict[str, Any],
) -> Dict[str, Any]:
    """Turn the model's JSON into slots + items in the composer's request shape.

    Anything malformed is dropped rather than repaired into something wrong: a
    question with no correct option is not a question, and the teacher reviews
    the result anyway. What was dropped is REPORTED, not hidden: the result
    carries the requested counts and the dates that came back empty or short,
    so the review can say "5 of 7 days drafted".

    The model's days map onto `plan_dates(brief)` in order: day 1 → the first
    date the plan runs on, skipping weekdays the teacher left out.
    """
    if not isinstance(raw, dict):
        raw = {}
    dates = plan_dates(brief)
    per_day = max(1, min(_int(brief.get("per_day_items"), 2), MAX_ITEMS_PER_DAY))
    default_completion = _int(brief.get("completion_points"), 10)
    default_correct = _int(brief.get("correct_points"), 20)
    language = brief.get("language")

    slots: List[Dict[str, Any]] = []
    missing: List[str] = []
    short: List[str] = []
    dropped = 0
    days = raw.get("days") if isinstance(raw.get("days"), list) else []
    for day_index, when in enumerate(dates):
        day = days[day_index] if day_index < len(days) else None
        items_in = day.get("items") if isinstance(day, dict) else []
        items_out: List[Dict[str, Any]] = []
        for it in (items_in if isinstance(items_in, list) else [])[:per_day]:
            item = _normalise_item(it, day_index, default_completion, default_correct, language=language)
            if item:
                items_out.append(item)
            else:
                dropped += 1
        if items_out:
            slots.append(_slot(brief, when, day_index, day, items_out))
        if not items_out:
            missing.append(when.isoformat())
        elif len(items_out) < per_day:
            short.append(when.isoformat())

    return {
        "title": _plan_title(raw, brief),
        "slots": slots,
        "requested_days": len(dates),
        "requested_items": len(dates) * per_day,
        "missing_dates": missing,
        "short_dates": short,
        "dropped_items": dropped,
    }


def _matches_target(item: Dict[str, Any], target: Tuple[str, str, Optional[str]]) -> bool:
    _, want_type, want_format = target
    if want_type == "VISUAL_NOTE":
        # A visual note is a reading that asks for pictures; one without any
        # placeholder could never become the illustrated page it replaces.
        return item["itemType"] == "READING_HTML" and "data-img-prompt" in (item.get("contentHtml") or "")
    if item["itemType"] != want_type:
        return False
    if want_type == "FLASHCARDS":
        try:
            cards = json.loads(item.get("payloadJson") or "{}").get("cards")
        except (TypeError, ValueError):
            return False
        return isinstance(cards, list) and len(cards) >= DECK_MIN_CARDS
    if want_format:
        try:
            fmt = json.loads(item.get("payloadJson") or "{}").get("format")
        except (TypeError, ValueError):
            return False
        return str(fmt or "").upper() == want_format
    return True


def normalise_single_item(raw: Dict[str, Any], brief: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Regenerate mode: the first usable item of EXACTLY the requested type (and
    QUESTION_OF_DAY format), as a one-slot draft. None when the model returned
    nothing usable of that type — the router then refuses it without billing,
    so a wrong-typed or empty result is never charged and never replaces the
    teacher's task.

    Every day and item the model returned is scanned, not just the first: a
    model that ignores "exactly one" but does include the right kind still
    yields a usable task.
    """
    target = single_item_target(brief.get("single_item_type"))
    if target is None or not isinstance(raw, dict):
        return None
    start = _as_date(brief["start_date"])
    default_completion = _int(brief.get("completion_points"), 10)
    default_correct = _int(brief.get("correct_points"), 20)
    language = brief.get("language")

    days = raw.get("days") if isinstance(raw.get("days"), list) else []
    for day in days:
        items_in = day.get("items") if isinstance(day, dict) else []
        for it in items_in if isinstance(items_in, list) else []:
            item = _normalise_item(
                it, 0, default_completion, default_correct, keep_points=True, language=language
            )
            if item and _matches_target(item, target):
                item["itemType"] = target[1]
                return {
                    "title": _plan_title(raw, brief),
                    "slots": [_slot(brief, start, 0, day, [item])],
                    "requested_days": 1,
                    "requested_items": 1,
                    "missing_dates": [],
                    "short_dates": [],
                    "dropped_items": 0,
                }
    return None


def model_name() -> str:
    """ENGAGEMENT_PLAN_MODEL (env override) > the 'engagement_plan' use-case
    default (cached 30 s) > GLM."""
    explicit = (os.getenv("ENGAGEMENT_PLAN_MODEL") or "").strip()
    if explicit:
        return explicit
    try:
        from .model_selection import resolve_model_sync

        primary, _fallbacks = resolve_model_sync(USE_CASE, hard_fallback=DEFAULT_MODEL)
        return primary or DEFAULT_MODEL
    except Exception as exc:  # noqa: BLE001 — a model lookup never blocks a draft
        logger.warning("[engagement-plan] model lookup failed (%s); using %s", exc, DEFAULT_MODEL)
        return DEFAULT_MODEL
