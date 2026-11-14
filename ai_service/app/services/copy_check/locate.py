"""Answer location pass — which pages hold each question's answer.

Why this exists
---------------
`prompt_builder._transcript_for_prompt` used to put the WHOLE copy into every
grading call. Cost was therefore pages × questions, not pages + questions: a
100-question paper answered across 40 pages re-sent ~18k tokens of transcript
100 times (~2M prompt tokens, ≈ $0.15 on the default model) — more than the
copy is sold for, and billed to the institute as overage on top of the quoted
price. The grader does not need page 31 to mark question 4.

So, before grading, ONE cheap call reads the page-level text and maps every
question to the page(s) its answer is on. Each grading call then receives only
those pages (plus one page either side, since an answer can run over a page
break). Cost falls back to roughly pages + questions.

Safety
------
Locating is advisory. Anything that goes wrong — the call fails, the JSON is
bad, a page id is invented — degrades to the old behaviour (full transcript)
for the affected question, never to a lost answer. A question the locator did
not place is graded against the pages between its paper neighbours' answers
(answers are almost always written in paper order), and against the whole
copy when even that is unknown.
"""
from __future__ import annotations

import json
import logging
import re
from typing import Any, Optional

from .prompt_builder import paper_label_for

logger = logging.getLogger(__name__)

# Below this many pages the whole copy is small enough that the extra call
# costs more than it saves.
LOCATE_MIN_PAGES = 4
# Pages of context either side of the located page(s): an answer that ends at
# the foot of p3 often has its score row at the top of p4, and the locator
# reads prose, not row geometry.
NEIGHBOUR_PAGES = 1
# The locator reads page prose, not rows; cap per page so a 40-page copy stays
# one call (40 × 2,400 chars ≈ 24k tokens). A full handwritten page is
# ~1,200-2,000 chars, so this cuts nothing on a normal page — a one-line
# answer at the foot of a page must not be truncated away.
MAX_CHARS_PER_PAGE = 2_400
MAX_QUESTION_CHARS = 160

LOCATE_SYSTEM = """You index a student's handwritten exam copy. You do NOT grade.
For every question in the paper, say which page(s) of the copy hold the
student's answer to it. Match by CONTENT (topic, option letters, values,
section heading), never by the student's numbering alone - students restart
numbering per section, skip and shift. An answer may run across two pages;
list both. A question the student did not attempt gets an empty list.
Return STRICT JSON only."""


def _page_prose(page: dict[str, Any]) -> str:
    text = (page.get("vision_text") or "").strip()
    if not text:
        text = " ".join(
            (line.get("text") or "").strip()
            for line in page.get("lines") or []
            if (line.get("text") or "").strip()
        )
    text = re.sub(r"\s+", " ", text)
    if len(text) > MAX_CHARS_PER_PAGE:
        text = text[:MAX_CHARS_PER_PAGE] + " ..."
    return text


def _question_line(index: int, question: dict[str, Any]) -> str:
    text = re.sub(r"\s+", " ", str(question.get("question_text") or "")).strip()
    if len(text) > MAX_QUESTION_CHARS:
        text = text[:MAX_QUESTION_CHARS] + "..."
    options = question.get("options") or []
    opt = ""
    if options:
        heads = []
        for i, o in enumerate(options[:6]):
            raw = o.get("text") if isinstance(o, dict) else o
            t = re.sub(r"\s+", " ", str(raw or "")).strip()[:30]
            heads.append(f"({chr(97 + i)}) {t}")
        opt = " | options: " + "; ".join(heads)
    return f"#{index}  [{paper_label_for(question)}] ({question.get('question_type') or '?'}) {text}{opt}"


def build_locate_prompt(questions: list[dict[str, Any]], layout_map: dict[str, Any]) -> str:
    pages = layout_map.get("pages") or []
    page_block = "\n\n".join(
        f"---- {p.get('page_id')} ----\n{_page_prose(p) or '(blank page)'}" for p in pages
    )
    q_block = "\n".join(_question_line(i + 1, q) for i, q in enumerate(questions))
    page_ids = ", ".join(str(p.get("page_id")) for p in pages)
    return f"""**The copy, page by page (verbatim reading):**
{page_block}

**The question paper ({len(questions)} questions):**
{q_block}

For each question number #1..#{len(questions)} give the page id(s) where the
student's answer to it is written, in reading order. Valid page ids: {page_ids}.
Empty list if not attempted. Do not invent page ids.

Output (STRICT JSON, nothing else):
{{"locations": {{"1": ["p2"], "2": ["p2", "p3"], "3": []}}}}"""


def _norm_page_id(value: Any, valid: set[str]) -> Optional[str]:
    if value is None:
        return None
    s = str(value).strip()
    if s in valid:
        return s
    if s.isdigit() and f"p{s}" in valid:
        return f"p{s}"
    m = re.fullmatch(r"(?:p|page)\s*(\d+)", s, flags=re.IGNORECASE)
    if m and f"p{m.group(1)}" in valid:
        return f"p{m.group(1)}"
    return None


def parse_locate_response(
    content: str, questions: list[dict[str, Any]], layout_map: dict[str, Any],
) -> dict[str, list[str]]:
    """{question_id: [page_id, ...]} for every question the model placed.

    A question is present in the result only when the model gave it at least
    one VALID page. An empty list (model says unattempted) is returned as an
    empty list so the caller can tell "not attempted" from "not answered by
    the locator" — the latter simply has no key.
    """
    valid = {str(p.get("page_id")) for p in layout_map.get("pages") or []}
    order = [str(p.get("page_id")) for p in layout_map.get("pages") or []]
    text = content.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(json)?\s*\n", "", text, count=1)
        text = re.sub(r"\n?```\s*$", "", text, count=1)
    try:
        payload = json.loads(text)
    except json.JSONDecodeError:
        start, end = text.find("{"), text.rfind("}")
        if start == -1 or end <= start:
            raise
        payload = json.loads(text[start : end + 1])
    locations = payload.get("locations") if isinstance(payload, dict) else None
    if not isinstance(locations, dict):
        # Tolerate the bare map too.
        locations = payload if isinstance(payload, dict) else {}

    out: dict[str, list[str]] = {}
    for key, pages in locations.items():
        m = re.search(r"\d+", str(key))
        if not m:
            continue
        idx = int(m.group()) - 1
        if not 0 <= idx < len(questions):
            continue
        qid = str(questions[idx]["question_id"])
        if not isinstance(pages, list):
            pages = [pages]
        found = []
        for p in pages:
            pid = _norm_page_id(p, valid)
            if pid and pid not in found:
                found.append(pid)
        # Keep page order as on the copy, not as the model listed them.
        found.sort(key=order.index)
        out[qid] = found
    return out


def paper_order(questions: list[dict[str, Any]]) -> list[str]:
    """Question ids in the order they appear on the PAPER, which is the order
    students answer in. The request lists them in whatever order the platform
    stored them (observed: random), so the neighbour window in
    pages_for_question() must not use the list order. Numeric printed labels
    first (grouped by section as first seen), then question_number, then
    list position."""
    sections: dict[str, int] = {}

    def key(item: tuple[int, dict[str, Any]]) -> tuple[int, float, int]:
        i, q = item
        section = str(q.get("section") or "").strip()
        sections.setdefault(section, len(sections))
        label = re.sub(r"[^0-9.]", "", str(q.get("paper_label") or ""))
        try:
            n = float(label) if label else float(q.get("question_number") or i + 1)
        except (TypeError, ValueError):
            n = float(i + 1)
        return (sections[section], n, i)

    return [str(q["question_id"]) for _, q in sorted(enumerate(questions), key=key)]


def pages_for_question(
    question_id: str,
    located: dict[str, list[str]],
    question_order: list[str],
    all_page_ids: list[str],
    neighbour_pages: int = NEIGHBOUR_PAGES,
) -> Optional[list[str]]:
    """Pages to show the grader for one question, or None for the whole copy.

    located  — parse_locate_response() output
    question_order — question ids in paper order
    """
    if not located or not all_page_ids:
        return None
    index = {pid: i for i, pid in enumerate(all_page_ids)}
    n = len(all_page_ids)

    def _expand(lo: int, hi: int) -> list[str]:
        lo = max(0, lo - neighbour_pages)
        hi = min(n - 1, hi + neighbour_pages)
        return all_page_ids[lo : hi + 1]

    pages = located.get(question_id)
    if pages:
        idxs = [index[p] for p in pages if p in index]
        if idxs:
            return _expand(min(idxs), max(idxs))

    # Not placed (or placed nowhere): look between the nearest placed
    # neighbours in paper order. Answers are written in paper order far more
    # often than not, so the answer — if it exists — is almost always there.
    try:
        pos = question_order.index(question_id)
    except ValueError:
        return None
    lo_idx: Optional[int] = None
    for qid in reversed(question_order[:pos]):
        prev = located.get(qid)
        if prev:
            lo_idx = max(index[p] for p in prev if p in index)
            break
    hi_idx: Optional[int] = None
    for qid in question_order[pos + 1 :]:
        nxt = located.get(qid)
        if nxt:
            hi_idx = min(index[p] for p in nxt if p in index)
            break
    if lo_idx is None and hi_idx is None:
        return None
    if lo_idx is None:
        lo_idx = 0
    if hi_idx is None:
        hi_idx = n - 1
    if hi_idx < lo_idx:
        # Out-of-order answers — widen to both rather than guess.
        lo_idx, hi_idx = hi_idx, lo_idx
    return _expand(lo_idx, hi_idx)


async def locate_answers(
    llm: Any,
    questions: list[dict[str, Any]],
    layout_map: dict[str, Any],
    model: str,
    institute_id: Optional[str] = None,
    token_sink: Any = None,
) -> dict[str, list[str]]:
    """One LLM call; {} when the copy is too small to bother or anything fails.

    A {} result means every grading call sees the full transcript — exactly
    the behaviour before this pass existed.
    """
    pages = layout_map.get("pages") or []
    if len(pages) < LOCATE_MIN_PAGES or not questions:
        return {}
    try:
        prompt = build_locate_prompt(questions, layout_map)
    except Exception:
        logger.exception("Answer location prompt could not be built; grading with the full transcript")
        return {}
    try:
        response = await llm.chat_completion(
            messages=[
                {"role": "system", "content": LOCATE_SYSTEM},
                {"role": "user", "content": prompt},
            ],
            temperature=0.0,
            # ~10 tokens per question; 100 questions ≈ 1k, leave headroom for
            # models that pad the JSON.
            max_tokens=max(1_500, 20 * len(questions)),
            institute_id=institute_id,
            model=model,
        )
    except Exception:
        logger.exception("Answer location call failed; grading with the full transcript")
        return {}
    if token_sink is not None:
        try:
            token_sink.add_usage(response.get("usage"))
        except Exception:
            logger.debug("token sink rejected locate usage", exc_info=True)
    try:
        located = parse_locate_response(response.get("content") or "", questions, layout_map)
    except Exception:
        logger.exception("Answer location reply unparseable; grading with the full transcript")
        return {}
    placed = sum(1 for v in located.values() if v)
    logger.info(
        "Located answers for %d/%d questions across %d pages (%d marked unattempted)",
        placed, len(questions), len(pages), sum(1 for v in located.values() if not v),
    )
    # A locator that placed almost nothing is more likely confused than right;
    # do not let it narrow every call to the wrong pages.
    if placed < max(1, len(questions) // 4):
        logger.warning("Locator placed too few answers (%d/%d); ignoring it", placed, len(questions))
        return {}
    return located
