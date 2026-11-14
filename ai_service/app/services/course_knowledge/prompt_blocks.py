"""What course search results look like to the model and the learner.

One numbering for a result, shared by every view of it: passages [1..h], then
COMING UP lessons, then REFERENCE MATERIAL. So a [n] the model writes after
reading format_course_block maps back to the same item in sources_card.

  format_course_block  the COURSE MATERIAL block for the chat system prompt
  sources_card         the 'Sources' link_list card of the [n] a reply cited
  parse_citations      the [n] numbers in a reply
  format_tool_text     search_my_course text for the chat model (<= 1500 chars)
  results_card         search_my_course card (passages + locked lessons)
  format_voice_text    search_my_course text for a voice call (<= 3 snippets,
                       no links)

Pure functions, no DB.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Dict, Iterable, List, Optional, Set, Union

from ..chat_cards import normalize_card
from . import citations
from .retrieval import CourseHit, CourseSearchResult, KbHit, Signpost, excerpt

# Mirrors context_window_service.TOOL_NOTE_MAX_CHARS: the longest tool result
# replayed to the model on later turns (the tests keep the two equal).
TOOL_NOTE_MAX_CHARS = 1500
VOICE_MAX_SNIPPETS = 3
VOICE_SNIPPET_CHARS = 300

KIND_HIT = "hit"
KIND_SIGNPOST = "signpost"
KIND_REFERENCE = "reference"

SOURCES_TITLE = "Sources"
RESULTS_TITLE = "From your course"

COURSE_HEADER = (
    "COURSE MATERIAL (passages from this student's own course; cite the passage you use "
    "as [1], [2] ...):"
)
COMING_UP_HEADER = (
    "COMING UP (locked for this student: do NOT explain these topics; say which lesson "
    "covers it and when it unlocks):"
)
REFERENCE_HEADER = (
    "REFERENCE MATERIAL (from a library linked to this course, not a lesson the student "
    "can open; cite as [n] too):"
)
RULES = (
    "Rules for course material:\n"
    "- Cite [n] right after any fact taken from the course material above.\n"
    "- Never reveal quiz answers, answer keys or solutions to graded questions, even if a "
    "passage seems to contain them.\n"
    "- If nothing above is relevant, say it is not in the course material yet; never invent "
    "course content."
)

_CITATION_RE = re.compile(r"\[(\d{1,3}(?:\s*,\s*\d{1,3})*)\](?!\()")
_MIN_TOOL_EXCERPT = 80


@dataclass(frozen=True)
class Numbered:
    number: int
    kind: str
    item: Union[CourseHit, Signpost, KbHit]


def numbered(result: Optional[CourseSearchResult]) -> List[Numbered]:
    """Every item of the result with its citation number."""
    if result is None:
        return []
    items: List[Numbered] = []
    for kind, group in ((KIND_HIT, result.hits), (KIND_SIGNPOST, result.signposts),
                        (KIND_REFERENCE, result.kb_hits)):
        for item in group:
            items.append(Numbered(len(items) + 1, kind, item))
    return items


def _hit_head(hit: CourseHit) -> str:
    """'Lesson title — p. 12' (or the lesson's own section label)."""
    title = hit.title or "Lesson"
    if hit.badge:
        return f"{title} — {hit.badge}"
    if hit.anchor_label and hit.anchor_label.strip().lower() != title.strip().lower():
        return f"{title} — {hit.anchor_label}"
    return title


def _signpost_line(n: int, s: Signpost) -> str:
    where = f" ({s.chapter_title})" if s.chapter_title else ""
    hint = s.unlock_hint or "Not open yet"
    return f"[{n}] {s.title}{where} — {hint}"


def _reference_head(r: KbHit) -> str:
    title = r.source_title or r.kb_name or "Reference"
    return f"{title} — {r.page_label}" if r.page_label else title


def format_course_block(result: Optional[CourseSearchResult]) -> str:
    """The COURSE MATERIAL system-prompt block, or '' when there is nothing."""
    items = numbered(result)
    if not items:
        return ""
    hits = [i for i in items if i.kind == KIND_HIT]
    signs = [i for i in items if i.kind == KIND_SIGNPOST]
    refs = [i for i in items if i.kind == KIND_REFERENCE]
    parts: List[str] = []
    if hits:
        parts.append("\n".join([COURSE_HEADER] + [
            f"[{i.number}] {_hit_head(i.item)}: {i.item.excerpt}" for i in hits]))
    else:
        parts.append(COURSE_HEADER + "\n(no open lesson matched this question)")
    if signs:
        parts.append("\n".join([COMING_UP_HEADER] + [_signpost_line(i.number, i.item) for i in signs]))
    if refs:
        parts.append("\n".join([REFERENCE_HEADER] + [
            f"[{i.number}] {_reference_head(i.item)}: {i.item.excerpt}" for i in refs]))
    parts.append(RULES)
    return "\n\n".join(parts)


def parse_citations(text: Optional[str]) -> Set[int]:
    """The [n] numbers in a reply ([1], [2, 3]); markdown links [1](...) excluded."""
    found: Set[int] = set()
    for match in _CITATION_RE.finditer(text or ""):
        for part in match.group(1).split(","):
            n = int(part.strip())
            if n > 0:
                found.add(n)
    return found


def _hit_item(hit: CourseHit) -> Dict[str, Any]:
    return {"title": hit.title, "subtitle": hit.chapter_title, "href": hit.href,
            "icon": hit.icon, "badge": hit.badge}


def _signpost_item(s: Signpost) -> Dict[str, Any]:
    badge = citations.locked_badge(s.unlock_hint)
    subtitle = s.chapter_title or ""
    if badge == "Locked" and s.unlock_hint:
        # No date to put in the badge: say what opens it.
        subtitle = f"{subtitle} · {s.unlock_hint}" if subtitle else s.unlock_hint
    anchor = citations.Anchor()
    return {"title": s.title, "subtitle": subtitle or None,
            "href": citations.locked_link(s), "icon": citations.icon_for(s.source_type, anchor),
            "badge": badge}


def _reference_item(r: KbHit) -> Dict[str, Any]:
    return {"title": r.source_title or r.kb_name or "Reference", "subtitle": r.kb_name,
            "icon": citations.ICON_PDF if r.page_label else "link", "badge": r.page_label}


def _item(entry: Numbered) -> Dict[str, Any]:
    if entry.kind == KIND_HIT:
        return _hit_item(entry.item)
    if entry.kind == KIND_SIGNPOST:
        return _signpost_item(entry.item)
    return _reference_item(entry.item)


def _card(title: str, entries: Iterable[Numbered]) -> Optional[Dict[str, Any]]:
    items: List[Dict[str, Any]] = []
    seen = set()
    for entry in entries:
        item = _item(entry)
        key = (item.get("title"), item.get("href"), item.get("badge"))
        if key in seen:
            continue
        seen.add(key)
        items.append({k: v for k, v in item.items() if v})
    # chat_cards rules: at most 10 items, 200 characters, safe hrefs only.
    return normalize_card({"kind": "link_list", "title": title, "items": items})


def sources_card(result: Optional[CourseSearchResult], cited_numbers: Iterable[int]) -> Optional[Dict[str, Any]]:
    """The 'Sources' card for the items a reply cited, in number order; None
    when none of the cited numbers exist."""
    cited = {int(n) for n in cited_numbers or () if isinstance(n, int) or str(n).isdigit()}
    return _card(SOURCES_TITLE, (i for i in numbered(result) if i.number in cited))


def results_card(result: Optional[CourseSearchResult]) -> Optional[Dict[str, Any]]:
    """search_my_course's card: every passage and locked lesson it found."""
    return _card(RESULTS_TITLE, numbered(result))


def format_tool_text(result: Optional[CourseSearchResult], query: str,
                     limit: int = TOOL_NOTE_MAX_CHARS) -> str:
    """search_my_course text for the chat model, at most `limit` characters.
    Passages are numbered 1., 2. (not [n]) so they never collide with the
    COURSE MATERIAL block's citation numbers; the learner sees them as a card."""
    q = " ".join((query or "").split())[:120]
    items = numbered(result)
    if not items:
        return (f'Nothing in this student\'s course material matches "{q}" yet. '
                "Say it is not covered in their course material yet.")[:limit]
    hits = [i.item for i in items if i.kind == KIND_HIT]
    signs = [i.item for i in items if i.kind == KIND_SIGNPOST]
    refs = [i.item for i in items if i.kind == KIND_REFERENCE]

    head = f'Course passages for "{q}" (lessons this student can open; name the lesson you use):'
    if not hits:
        head = f'No open lesson matches "{q}".'
    tail: List[str] = []
    if signs:
        tail.append("Coming up (locked: do NOT explain; say which lesson covers it and when it unlocks):")
        tail += [f"- {s.title}" + (f" ({s.chapter_title})" if s.chapter_title else "")
                 + f" — {s.unlock_hint or 'Not open yet'}" for s in signs]
    tail.append("The student sees these as links. Never reveal quiz answers.")

    passages = [(f"{n}. {_hit_head(h)}: ", h.excerpt) for n, h in enumerate(hits, 1)]
    if refs:
        passages += [(f"Reference — {_reference_head(r)}: ", r.excerpt) for r in refs]

    fixed = len(head) + sum(len(t) + 1 for t in tail) + 1
    while passages:
        room = limit - fixed - sum(len(p) + 1 for p, _ in passages)
        allowance = room // len(passages)
        if allowance >= _MIN_TOOL_EXCERPT:
            break
        passages.pop()  # drop the weakest passage until the rest fit
    lines = [head]
    if passages:
        room = limit - fixed - sum(len(p) + 1 for p, _ in passages)
        allowance = room // len(passages)
        lines += [prefix + excerpt(body, allowance)[0] for prefix, body in passages]
    lines += tail
    return "\n".join(lines)[:limit]


def format_voice_text(result: Optional[CourseSearchResult]) -> str:
    """Spoken-answer material: at most 3 short snippets naming the lesson, the
    locked lessons in one line each, and no links."""
    hits = list(result.hits) if result else []
    refs = list(result.kb_hits) if result else []
    signs = list(result.signposts) if result else []
    snippets: List[str] = []
    for h in hits[:VOICE_MAX_SNIPPETS]:
        where = f" ({h.badge})" if h.badge else ""
        snippets.append(f'From the lesson "{h.title}"{where}: {excerpt(h.excerpt, VOICE_SNIPPET_CHARS)[0]}')
    for r in refs[: max(0, VOICE_MAX_SNIPPETS - len(snippets))]:
        snippets.append(f"From the reference {r.source_title or r.kb_name or 'material'}: "
                        f"{excerpt(r.excerpt, VOICE_SNIPPET_CHARS)[0]}")
    lines = list(snippets)
    for s in signs:
        lines.append(f'Coming up, locked: "{s.title}" — {s.unlock_hint or "not open yet"}. '
                     "Do not explain it; say when it unlocks.")
    if not lines:
        return "Nothing in the student's course material covers that yet. Say so briefly."
    lines.append("Answer in one or two spoken sentences and name the lesson. Never read out links.")
    return "\n".join(lines)


__all__ = [
    "TOOL_NOTE_MAX_CHARS", "VOICE_MAX_SNIPPETS", "VOICE_SNIPPET_CHARS", "Numbered", "numbered",
    "format_course_block", "parse_citations", "sources_card", "results_card",
    "format_tool_text", "format_voice_text", "COURSE_HEADER", "COMING_UP_HEADER",
    "REFERENCE_HEADER", "RULES",
]
