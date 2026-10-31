"""Digitise a question-paper PDF into gradable questions.

The offline-exam flow (Shiksha Nation's daily use) attaches the paper as a PDF
in the test description; learners download it, solve on paper and upload a scan.
The assessment behind it has one placeholder question ("Upload your answer
sheet.") carrying every mark, so the AI checker — which grades question by
question — has nothing to grade against.

This module turns that attached PDF into the assessment's real questions:

    fetch(pdf_url) → validate → MathPix HTML → LLM extraction (verbatim,
    with marks) → assessment-builder DTOs with a marking rubric each

Rules that matter here and not in the generic PDF→questions tool:
  * Every printed question is kept, in order, with ITS marks — the checker's
    maximum per question comes from here.
  * Nothing is invented as fact: an answer the paper does not print is marked
    `answer_source: "model"` so the teacher is told to verify it.
  * The charge is per page + a flat base, and only when questions come back.
"""
from __future__ import annotations

import asyncio
import io
import json
import logging
import re
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Sequence
from urllib.parse import unquote, urlparse

import httpx

from ..utils.html_tags import HtmlTagProtector
from . import llm_json, pdf_questions_service
from .question_format import format_questions

logger = logging.getLogger(__name__)

TOOL_KEY = "paper_digitise"
MAX_PDF_BYTES = 25 * 1024 * 1024
MAX_PAGES = 30
MAX_ROUNDS = 4  # continuation calls for long papers
DOWNLOAD_TIMEOUT_SECONDS = 45.0
SOURCE_TYPE = "QUESTION_PAPER_PDF"
ANSWER_TYPES_WITH_KEY = ("MCQS", "MCQM", "TRUE_FALSE", "ONE_WORD", "NUMERIC")


class PaperPdfError(ValueError):
    """The PDF cannot be digitised for a reason the teacher can act on."""


# ---------------------------------------------------------------------------
# 1. Fetch + validate
# ---------------------------------------------------------------------------

@dataclass
class PaperPdf:
    url: str
    file_name: str
    content: bytes
    pages: int

    @property
    def size_bytes(self) -> int:
        return len(self.content)


def file_name_from_url(url: str) -> str:
    """Last path segment, decoded; never empty."""
    path = urlparse(url).path or ""
    last = path.rsplit("/", 1)[-1]
    try:
        last = unquote(last)
    except Exception:  # noqa: BLE001
        pass
    return last or "question-paper.pdf"


def _count_pages(content: bytes) -> int:
    """Page count via PyMuPDF; raises PaperPdfError for encrypted/unreadable files."""
    try:
        import fitz  # PyMuPDF
    except Exception as exc:  # noqa: BLE001 — the image always has it; tests may not
        raise RuntimeError("PyMuPDF is not available") from exc
    try:
        doc = fitz.open(stream=io.BytesIO(content), filetype="pdf")
    except Exception as exc:  # noqa: BLE001
        raise PaperPdfError("This file is not a readable PDF.") from exc
    try:
        if doc.is_encrypted and not doc.authenticate(""):
            raise PaperPdfError("This PDF is password-protected. Attach an unlocked copy.")
        return int(doc.page_count)
    finally:
        doc.close()


async def fetch_paper_pdf(url: str) -> PaperPdf:
    """Download the attached paper and make sure it is something we can read.

    Every failure is a PaperPdfError with a sentence the teacher can act on —
    the description editor accepts any file, so DOCX, images and dead links all
    arrive here.
    """
    parsed = urlparse(url or "")
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise PaperPdfError("The question paper link is not a valid web address.")

    try:
        async with httpx.AsyncClient(timeout=DOWNLOAD_TIMEOUT_SECONDS, follow_redirects=True) as client:
            async with client.stream("GET", url) as resp:
                if resp.status_code >= 400:
                    raise PaperPdfError(
                        f"Could not download the question paper (HTTP {resp.status_code}). "
                        "Re-attach it in the description and try again."
                    )
                declared = int(resp.headers.get("content-length") or 0)
                if declared > MAX_PDF_BYTES:
                    raise PaperPdfError(
                        f"The question paper is {declared / (1024 * 1024):.0f} MB; "
                        f"the limit is {MAX_PDF_BYTES // (1024 * 1024)} MB."
                    )
                chunks: List[bytes] = []
                total = 0
                async for chunk in resp.aiter_bytes():
                    total += len(chunk)
                    if total > MAX_PDF_BYTES:
                        raise PaperPdfError(
                            f"The question paper is larger than {MAX_PDF_BYTES // (1024 * 1024)} MB."
                        )
                    chunks.append(chunk)
                content = b"".join(chunks)
                content_type = (resp.headers.get("content-type") or "").split(";")[0].strip().lower()
    except PaperPdfError:
        raise
    except httpx.HTTPError as exc:
        raise PaperPdfError(
            "Could not download the question paper. Check that the attachment opens in a browser."
        ) from exc

    if not content:
        raise PaperPdfError("The question paper file is empty.")
    if not content.startswith(b"%PDF") and content_type != "application/pdf":
        raise PaperPdfError(
            "Only PDF question papers can be digitised. Export the paper as a PDF and attach that."
        )

    pages = await asyncio.to_thread(_count_pages, content)
    if pages <= 0:
        raise PaperPdfError("This PDF has no pages.")
    if pages > MAX_PAGES:
        raise PaperPdfError(
            f"This PDF has {pages} pages; a question paper of up to {MAX_PAGES} pages can be digitised."
        )
    return PaperPdf(url=url, file_name=file_name_from_url(url), content=content, pages=pages)


# ---------------------------------------------------------------------------
# 2. Extraction prompt
# ---------------------------------------------------------------------------

_PROMPT = """You are digitising a printed QUESTION PAPER so that students' handwritten answers can be marked question by question.

The paper, converted from PDF to HTML:
<paper>
{paper_html}
</paper>

{continuation}

Extract EVERY question exactly as printed, in order. Return ONLY this JSON:
{{
  "title": "string",                       // the paper's own title, e.g. "Half Yearly Mock — Class 7 Social Science"
  "total_marks": number | null,            // the maximum marks the paper states ("MM: 40", "M.M. 40", "Max. Marks 40", "Maximum Marks: 40", "Full Marks 40"), else null
  "duration_minutes": number | null,       // the time allowed the paper states, else null
  "sections": [ {{ "name": "Section A", "instruction": "string", "marks_each": number | null, "question_count": number | null, "total_marks": number | null, "attempt": number | null }} ],
  "questions": [
    {{
      "question_number": "1",              // as printed: "1", "2(a)", "Q7"
      "section": "Section A" | null,
      "marks": number | null,              // this question's marks, see rules
      "marks_source": "printed" | "section" | "none",
      "question": {{ "type": "HTML", "content": "string" }},   // verbatim; keep <img> and DS_TAG comments
      "options": [ {{ "type": "HTML", "preview_id": "1", "content": "string" }} ],   // MCQS/MCQM only, preview_id "1".."n"
      "correct_options": ["1"],            // MCQS/MCQM/TRUE_FALSE only
      "ans": "string",                     // ONE_WORD/NUMERIC/LONG_ANSWER expected answer
      "answer_source": "paper" | "model" | "none",
      "marking_points": ["string"],        // 2-5 points a full-mark answer must contain (LONG_ANSWER/ONE_WORD), else []
      "question_type": "MCQS" | "MCQM" | "TRUE_FALSE" | "ONE_WORD" | "NUMERIC" | "LONG_ANSWER",
      "tags": ["topic"],
      "level": "easy" | "medium" | "hard"
    }}
  ],
  "notes": ["string"],                     // anything a teacher must check: unreadable text, guessed marks, OR-choices
  "is_process_completed": true | false     // false ONLY if you had to stop before the last printed question
}}

Rules:
1. Verbatim. Copy the wording, numbers, units and sub-parts as printed. Do not paraphrase, merge, split or "improve" questions. Instructions, headers, section titles and the marking-scheme lines are NOT questions.
2. Sub-parts. "3 (a)…(b)…" printed with ONE mark figure is ONE question containing both parts. Sub-parts printed with their OWN marks are separate questions numbered "3(a)", "3(b)".
3. "OR" choices. Keep both alternatives inside ONE question, prefixed "Either … OR …", and add a note.
4. Marks. Use the figure printed next to the question ("[5]", "(2 marks)", "2M"). If none, use the section's "each carries N marks" and set marks_source "section". A section header written as "(8 × 1 = 8 Marks)", "8 questions × 1 mark" or "5 x 2 = 10" means COUNT × MARKS-EACH = TOTAL: marks_each is the SECOND number (1, 1, 2 here), never the count and never the total. A block printed as ONE numbered question but made of several scored items (match-the-following pairs, a set of fill-in-the-blanks, "4 × 1") carries the SUM of its items' marks. If nothing is printed anywhere, marks = null and marks_source "none" — never guess a number.
5. Answers. If the paper prints an answer key, use it and set answer_source "paper". Otherwise, for MCQS/MCQM/TRUE_FALSE/ONE_WORD/NUMERIC give your best answer with answer_source "model" (the teacher will verify). For LONG_ANSWER leave ans empty unless printed, but ALWAYS fill marking_points with what a full-mark answer must contain.
6. Types. Single correct option → MCQS; "choose all that apply" → MCQM; true/false → TRUE_FALSE; a numeric result → NUMERIC; a word/phrase → ONE_WORD; everything else (explain, describe, prove, draw, solve with steps) → LONG_ANSWER. For TRUE_FALSE always give options [{{"preview_id":"1","content":"True"}},{{"preview_id":"2","content":"False"}}] and correct_options ["1"] or ["2"]. If an answer cannot be determined (a table or figure is missing), leave it empty and set answer_source "none" — never write "model" for an empty answer.
7. Keep every <img …> tag and every <!--DS_TAG:…--> comment exactly where it appears in the source.
8. If the numbering restarts inside a section (a second passage or part printed 1, 2, 3… again), give that block its own section name — the printed heading if there is one ("Passage II", "Part B"), else "<Section> · Block 2" — so no two questions share the same section AND number.
9. Valid JSON only. No markdown fences, no commentary outside the JSON.
10. Internal choice. When a section lets the student answer only SOME of its questions ("Answer any FOUR of the following", "Attempt any 4", "Do any two", "any 3 out of 5"), set that section's "attempt" to how many must be answered (4 here) - in the field, not only in a note - and still list EVERY printed question of the section. A header such as "(4 × 3M = 12)" on such a section means attempt 4, marks_each 3, total_marks 12 (the total counts only the attempted questions; question_count is then the number to attempt, 4, not the number printed). "attempt" is null when every question of the section must be answered. An "Either … OR …" inside one question is rule 3, not this.
"""

_CONTINUATION = (
    "You have ALREADY returned questions {done}. Continue from the next printed question "
    "after those; do not repeat any of them. Return the same JSON shape (title/sections may be empty)."
)


def _build_prompt(paper_html: str, already: Sequence[str]) -> str:
    continuation = _CONTINUATION.format(done=", ".join(already)) if already else ""
    return _PROMPT.format(paper_html=paper_html, continuation=continuation)


# ---------------------------------------------------------------------------
# 3. Post-processing
# ---------------------------------------------------------------------------

@dataclass
class DigitisedPaper:
    title: str
    total_marks: Optional[float]
    duration_minutes: Optional[int]
    sections: List[Dict[str, Any]]
    raw_questions: List[Dict[str, Any]]
    questions: List[Dict[str, Any]]  # assessment-builder DTOs
    warnings: List[str] = field(default_factory=list)
    # Internal choice ("answer any 4 of 5"), positions in `questions` order.
    choice_groups: List[Dict[str, Any]] = field(default_factory=list)
    model: str = ""
    prompt_tokens: int = 0
    completion_tokens: int = 0
    rounds: int = 0

    @property
    def marks_total(self) -> float:
        return round(sum(float(q.get("marks") or 0) for q in self.raw_questions), 2)

    @property
    def paper_total(self) -> float:
        """The paper's maximum, internal choice applied (marks_total when there is none)."""
        return paper_total(self.raw_questions, self.choice_groups)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "title": self.title,
            "total_marks": self.total_marks,
            "duration_minutes": self.duration_minutes,
            "sections": self.sections,
            "questions": self.questions,
            "raw_questions": self.raw_questions,
            "warnings": self.warnings,
            "choice_groups": self.choice_groups,
            "paper_total": self.paper_total,
            "model": self.model,
            "prompt_tokens": self.prompt_tokens,
            "completion_tokens": self.completion_tokens,
        }


def _num(value: Any) -> Optional[float]:
    if value is None or value == "":
        return None
    try:
        out = float(value)
    except (TypeError, ValueError):
        match = re.search(r"\d+(?:\.\d+)?", str(value))
        if not match:
            return None
        out = float(match.group(0))
    return out if out > 0 else None


def _section_marks_each(section: Dict[str, Any]) -> Optional[float]:
    """Marks per question for a section, cross-checked against its count and total.

    "(8 × 1 = 8 Marks)" was read as marks_each 8 on the first real paper — eight
    one-mark tense items became 8/8 each. When the header gives a count and a
    total, total ÷ count is the truth and wins over whatever the model wrote.
    """
    each = _num(section.get("marks_each"))
    count = _num(section.get("question_count"))
    total = _num(section.get("total_marks"))
    # "Answer any FOUR (4 × 3M = 12)": the header's count is how many are
    # answered, not how many are printed - 12 ÷ 5 printed would make every
    # question 2.4.
    attempt = _attempt(section.get("attempt"))
    if attempt:
        count = float(attempt)
    if count and total:
        derived = total / count
        if derived > 0 and (each is None or abs(each * count - total) > 1e-6):
            return round(derived, 2)
    return each


def _attempt(value: Any) -> Optional[int]:
    """How many of a section's questions are answered ("any FOUR" -> 4); None = all."""
    n = _num(value)
    return int(n) if n and float(n).is_integer() and n >= 1 else None


# Extra answers in a choice group: the best-marked ones count. The teacher can
# switch a group to "first" (answer order) when the paper is set that way.
DEFAULT_CHOICE_POLICY = "best"


def choice_groups_for(raw_questions: List[Dict[str, Any]],
                      sections: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """The paper's internal choices: per section with an "attempt", the positions
    (in `raw_questions` order) of its questions and how many of them count.

    A section whose attempt is not below its number of questions is not a
    choice at all (every question is answered) and is left out, so a model
    that writes attempt = 5 on a five-question section changes nothing.
    """
    groups: List[Dict[str, Any]] = []
    for section in sections:
        attempt = _attempt(section.get("attempt"))
        name = str(section.get("name") or "").strip()
        if not attempt or not name:
            continue
        members = [i for i, q in enumerate(raw_questions)
                   if str(q.get("section") or "").strip().lower() == name.lower()]
        if attempt >= len(members):
            continue
        groups.append({"label": name, "question_indexes": members,
                       "question_numbers": [str(raw_questions[i].get("question_number") or "") for i in members],
                       "attempt": attempt, "policy": DEFAULT_CHOICE_POLICY})
    return groups


def paper_total(raw_questions: List[Dict[str, Any]], groups: Sequence[Dict[str, Any]]) -> float:
    """The paper's maximum: every compulsory question, plus, per choice group,
    the `attempt` highest-marked of its questions (equal marks in practice)."""
    grouped = {i for g in groups for i in g["question_indexes"]}
    total = sum(float(q.get("marks") or 0) for i, q in enumerate(raw_questions) if i not in grouped)
    for g in groups:
        marks = sorted((float(raw_questions[i].get("marks") or 0) for i in g["question_indexes"]), reverse=True)
        total += sum(marks[: g["attempt"]])
    return round(total, 2)


def _norm_type(value: Any) -> str:
    qt = str(value or "").strip().upper()
    aliases = {"MCQ": "MCQS", "SINGLE_CHOICE": "MCQS", "MULTIPLE_CHOICE": "MCQM", "TF": "TRUE_FALSE",
               "SHORT_ANSWER": "ONE_WORD", "SUBJECTIVE": "LONG_ANSWER", "DESCRIPTIVE": "LONG_ANSWER"}
    return aliases.get(qt, qt)


def _coerce_question(q: Dict[str, Any]) -> Dict[str, Any]:
    """Bring one raw question to the shape the rest of the pipeline assumes.

    The prompt asks for `question: {type, content}` and lists for options,
    correct_options, marking_points and tags, but a model round can flatten any
    of them to a bare string (seen 2026-09-20: `"question": "…"` on one question
    took the whole 7-page read down in `_dedupe_key`). Wrong shapes are repaired,
    never dropped — the question is still on the paper.
    """
    question = q.get("question")
    if isinstance(question, str):
        q["question"] = {"type": "HTML", "content": question}
    elif not isinstance(question, dict):
        q["question"] = {"type": "HTML", "content": ""}
    options = q.get("options")
    if isinstance(options, str):
        options = [options]
    if isinstance(options, list):
        fixed = []
        for i, opt in enumerate(options):
            if isinstance(opt, dict):
                fixed.append(opt)
            elif opt is not None:
                fixed.append({"type": "HTML", "preview_id": str(i + 1), "content": str(opt)})
        q["options"] = fixed
    else:
        q["options"] = []
    for key in ("correct_options", "marking_points", "tags"):
        value = q.get(key)
        if isinstance(value, (str, int, float)):
            q[key] = [str(value)]
        elif not isinstance(value, list):
            q[key] = []
    if isinstance(q.get("ans"), (list, dict)):
        q["ans"] = json.dumps(q["ans"], ensure_ascii=False) if isinstance(q["ans"], dict) else ", ".join(map(str, q["ans"]))
    return q


def _dedupe_key(q: Dict[str, Any]) -> str:
    number = str(q.get("question_number") or "").strip().lower()
    text = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", str((q.get("question") or {}).get("content") or ""))).strip().lower()
    return f"{number}|{text[:80]}"


def reconcile_marks(
    raw_questions: List[Dict[str, Any]],
    sections: List[Dict[str, Any]],
    stated_total: Optional[float],
    expected_total: Optional[float],
    groups: Optional[Sequence[Dict[str, Any]]] = None,
) -> List[str]:
    """Fill missing marks and explain every guess.

    Order of trust: printed on the question → the section's "each carries" →
    an equal split of whatever total is known (the paper's, else the teacher's)
    among the questions that still have none → 1. Every fallback beyond the
    section figure becomes a warning, because the checker's maximum for that
    question is now a guess the teacher must confirm.
    """
    warnings: List[str] = []
    section_each = {
        str(s.get("name") or "").strip().lower(): _num(s.get("marks_each"))
        for s in sections if isinstance(s, dict)
    }
    missing: List[Dict[str, Any]] = []
    for q in raw_questions:
        marks = _num(q.get("marks"))
        if marks is None:
            each = section_each.get(str(q.get("section") or "").strip().lower())
            if each:
                marks = each
                q["marks_source"] = "section"
        if marks is None:
            missing.append(q)
        else:
            q["marks"] = marks

    if missing:
        known = sum(float(q.get("marks") or 0) for q in raw_questions if q not in missing)
        total = stated_total or expected_total
        remainder = (total - known) if total else 0
        if remainder > 0:
            share = round(remainder / len(missing), 2)
            for q in missing:
                q["marks"] = share
                q["marks_source"] = "split"
            warnings.append(
                f"{len(missing)} question(s) had no marks printed; the remaining {remainder:g} "
                f"marks were split equally ({share:g} each). Check them before creating the test."
            )
        else:
            for q in missing:
                q["marks"] = 1.0
                q["marks_source"] = "default"
            warnings.append(
                f"{len(missing)} question(s) had no marks printed and were set to 1 mark. "
                "Check them before creating the test."
            )

    total_found = round(sum(float(q.get("marks") or 0) for q in raw_questions), 2)
    if groups:
        # "Answer any FOUR of five": the paper's maximum counts four of them, so
        # 18 questions adding to 46 on a 40-mark paper is exactly right.
        choice_total = paper_total(raw_questions, groups)
        target = stated_total or expected_total
        if not target or abs(choice_total - target) <= 0.01:
            return warnings
        total_found = choice_total
    if stated_total and abs(total_found - stated_total) > 0.01:
        warnings.append(
            f"The paper states {stated_total:g} marks but the questions add up to {total_found:g}. "
            "Adjust the marks that are wrong."
        )
    elif expected_total and abs(total_found - expected_total) > 0.01:
        warnings.append(
            f"You entered {expected_total:g} total marks but the questions add up to {total_found:g}."
        )
    return warnings


def marking_rubric(raw: Dict[str, Any]) -> Dict[str, Any]:
    """`evaluation_criteria_json` for the AI checker, from what the paper gives us.

    Objective types: one criterion, full marks for the key. Written answers: the
    marking points the model listed, equal split with the remainder on the last
    point so the rubric always sums to the question's marks. Same shape the KB
    paper generator emits, so the evaluator treats both alike.
    """
    max_marks = float(raw.get("marks") or 1)
    qtype = _norm_type(raw.get("question_type"))
    points = [str(p).strip() for p in (raw.get("marking_points") or []) if str(p or "").strip()]
    tags = [str(t) for t in (raw.get("tags") or []) if str(t or "").strip()]
    if qtype in ANSWER_TYPES_WITH_KEY or not points:
        source = raw.get("answer_source")
        if qtype in ANSWER_TYPES_WITH_KEY and source == "none":
            # No key at all: say so, or the checker looks for one that is not there.
            guidelines = ("No answer key was available from the paper. Work out the correct answer from "
                          "the question itself, then full marks if the student's answer matches it; no partial marks.")
        else:
            verify = " The key was inferred by the model, not printed on the paper — the teacher should confirm it." \
                if source == "model" else ""
            guidelines = "Full marks for the correct answer as in the key; no partial marks." + verify
        rubric = [{
            "criteria_name": "Correct answer",
            "max_marks": max_marks,
            "keywords": tags,
            "evaluation_guidelines": guidelines,
        }]
    else:
        share = round(max_marks / len(points), 2)
        rubric = [
            {
                "criteria_name": f"Point {i + 1}",
                "max_marks": share if i < len(points) - 1 else round(max_marks - share * (len(points) - 1), 2),
                "keywords": tags if i == len(points) - 1 else [],
                "evaluation_guidelines": point,
            }
            for i, point in enumerate(points)
        ]
    return {
        "max_marks": max_marks,
        "partial_marking_enabled": len(rubric) > 1,
        "evaluation_instructions": (
            "Mark against the points below. Award a point's marks when the student's answer "
            "covers it correctly, in any wording; half marks for a partially correct point."
        ),
        "rubric": rubric,
    }


def _provenance(raw: Dict[str, Any], pdf_url: str, file_name: str) -> Dict[str, Any]:
    return {
        "paper_url": pdf_url,
        "paper_file": file_name,
        "question_number": raw.get("question_number"),
        "marks": raw.get("marks"),
        "marks_source": raw.get("marks_source"),
        "section": raw.get("section"),
        "answer_source": raw.get("answer_source"),
    }


def clean_title(value: Any) -> str:
    """One line of plain text: printed papers break titles with <br> (or its escaped
    twin), which the bank would otherwise show literally."""
    text = str(value or "")
    text = re.sub(r"(?i)(?:<br\s*/?>|&lt;br\s*/?&gt;)", " - ", text)
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"\s*-\s*(?:-\s*)+", " - ", text)
    return re.sub(r"\s+", " ", text).strip(" -")


def has_answer_key(dto: Dict[str, Any]) -> Optional[bool]:
    """Whether the formatted question carries something the checker can mark against.

    None for types that are marked by rubric rather than key (LONG_ANSWER).
    """
    qtype = str(dto.get("question_type") or "")
    if qtype not in ANSWER_TYPES_WITH_KEY:
        return None
    try:
        data = (json.loads(dto.get("auto_evaluation_json") or "{}") or {}).get("data") or {}
    except ValueError:
        return False
    if qtype in ("MCQS", "MCQM", "TRUE_FALSE"):
        return bool(data.get("correct_option_ids") or data.get("correctOptionIds"))
    if qtype == "NUMERIC":
        return bool(data.get("valid_answers") or data.get("validAnswers"))
    return bool(str(data.get("answer") or "").strip())


def build_paper(
    rounds: List[Dict[str, Any]],
    *,
    pdf_url: str,
    file_name: str,
    expected_total: Optional[float],
) -> DigitisedPaper:
    """Merge the LLM round(s) into one paper and shape it for the assessment builder."""
    title = ""
    total_marks: Optional[float] = None
    duration: Optional[int] = None
    sections: List[Dict[str, Any]] = []
    notes: List[str] = []
    seen: set[str] = set()
    raw_questions: List[Dict[str, Any]] = []

    for data in rounds:
        if not title and data.get("title"):
            title = str(data["title"]).strip()
        if total_marks is None:
            total_marks = _num(data.get("total_marks"))
        if duration is None:
            d = _num(data.get("duration_minutes"))
            duration = int(d) if d else None
        for s in data.get("sections") or []:
            if isinstance(s, dict) and s.get("name") and not any(
                str(x.get("name")).lower() == str(s.get("name")).lower() for x in sections
            ):
                sections.append({"name": str(s.get("name")), "instruction": s.get("instruction") or "",
                                 "marks_each": _section_marks_each(s),
                                 "question_count": _num(s.get("question_count")),
                                 "total_marks": _num(s.get("total_marks")),
                                 "attempt": _attempt(s.get("attempt"))})
        notes.extend(str(n) for n in (data.get("notes") or []) if str(n or "").strip())
        for q in data.get("questions") or []:
            if not isinstance(q, dict):
                continue
            _coerce_question(q)
            q["question_type"] = _norm_type(q.get("question_type"))
            key = _dedupe_key(q)
            if key in seen:
                continue
            seen.add(key)
            raw_questions.append(q)

    warnings = reconcile_marks(raw_questions, sections, total_marks, expected_total,
                               choice_groups_for(raw_questions, sections))

    formatted: List[Dict[str, Any]] = []
    kept: List[Dict[str, Any]] = []
    dropped: List[str] = []
    keyless: List[str] = []
    model_answers = 0
    for raw in raw_questions:
        # format_questions mutates its input; give it a copy so raw stays intact.
        out = format_questions([json.loads(json.dumps(raw))])
        if not out:
            dropped.append(str(raw.get("question_number") or "?"))
            continue
        dto = out[0]
        # An objective question whose key did not survive formatting (the model
        # wrote nothing, or something no option matches) must not claim a key:
        # the rubric would tell the checker to mark "as in the key", and the
        # review would count it among the verified answers.
        if has_answer_key(dto) is False:
            raw["answer_source"] = "none"
            keyless.append(str(raw.get("question_number") or "?"))
        dto["source_type"] = SOURCE_TYPE
        dto["source_meta"] = json.dumps(_provenance(raw, pdf_url, file_name), ensure_ascii=False)
        dto["evaluation_criteria_json"] = json.dumps(marking_rubric(raw), ensure_ascii=False)
        if raw.get("answer_source") == "model":
            model_answers += 1
        formatted.append(dto)
        kept.append(raw)

    if dropped:
        warnings.append(
            f"{len(dropped)} question(s) could not be read cleanly and were left out: {', '.join(dropped)}."
        )
    if keyless:
        warnings.append(
            f"No answer could be read or worked out for question(s) {', '.join(keyless)}. "
            "Add the answer in the question bank before sheets are checked, or the AI will judge those on its own."
        )
    if model_answers:
        warnings.append(
            f"The paper prints no answer key; the AI suggested answers for {model_answers} "
            "objective question(s). Verify them — they decide the marks."
        )
    warnings.extend(dict.fromkeys(notes))  # the model's own notes, deduplicated, order kept

    return DigitisedPaper(
        title=clean_title(title) or file_name.rsplit(".", 1)[0],
        total_marks=total_marks,
        duration_minutes=duration,
        sections=sections,
        raw_questions=kept,
        questions=formatted,
        warnings=warnings,
        # Positions in the questions that were kept: a dropped question leaves its group.
        choice_groups=choice_groups_for(kept, sections),
    )


# ---------------------------------------------------------------------------
# 4. The pipeline
# ---------------------------------------------------------------------------

async def extract_questions(
    paper_html: str,
    models: List[str],
    *,
    pdf_url: str,
    file_name: str,
    expected_total: Optional[float],
) -> DigitisedPaper:
    """LLM extraction with continuation rounds for long papers, then shaping."""
    protector = HtmlTagProtector()
    protected = protector.protect(paper_html)
    rounds: List[Dict[str, Any]] = []
    already: List[str] = []
    model_used = ""
    prompt_tokens = completion_tokens = 0

    for _ in range(MAX_ROUNDS):
        sanitized, model_used, usage = await llm_json.generate_json(
            _build_prompt(protected, already), models, label="paper_digitise"
        )
        prompt_tokens += int((usage or {}).get("prompt_tokens") or 0)
        completion_tokens += int((usage or {}).get("completion_tokens") or 0)
        restored = protector.restore_in_json(sanitized)
        try:
            data = json.loads(restored)
        except ValueError:
            logger.warning("paper_digitise: round returned unparseable JSON; stopping")
            break
        if not isinstance(data, dict):
            break
        new = [q for q in (data.get("questions") or []) if isinstance(q, dict)]
        rounds.append(data)
        numbers = [str(q.get("question_number") or "").strip() for q in new]
        fresh = [n for n in numbers if n and n not in already]
        already.extend(fresh)
        # Done when the model says so, or when a round adds nothing new (a model
        # that ignores the continuation instruction must not loop us forever).
        if data.get("is_process_completed", True) or not fresh:
            break

    paper = build_paper(rounds, pdf_url=pdf_url, file_name=file_name, expected_total=expected_total)
    paper.model = model_used
    paper.prompt_tokens = prompt_tokens
    paper.completion_tokens = completion_tokens
    paper.rounds = len(rounds)
    return paper


async def digitise(
    pdf: PaperPdf,
    models: List[str],
    *,
    expected_total: Optional[float],
) -> DigitisedPaper:
    """MathPix → HTML → questions. Raises on MathPix/LLM failure."""
    pdf_id = await pdf_questions_service.start_from_bytes(pdf.content, pdf.file_name)
    html = await pdf_questions_service.fetch_or_convert_html(pdf_id, allow_poll=True)
    if not (html or "").strip():
        raise RuntimeError("The PDF converted to an empty document.")
    return await extract_questions(
        html, models, pdf_url=pdf.url, file_name=pdf.file_name, expected_total=expected_total
    )


def tool_params(pages: int) -> Dict[str, Any]:
    return {"num_pages": int(pages)}


__all__ = [
    "PaperPdf", "PaperPdfError", "DigitisedPaper", "TOOL_KEY", "MAX_PAGES", "MAX_PDF_BYTES",
    "fetch_paper_pdf", "digitise", "extract_questions", "build_paper", "reconcile_marks",
    "choice_groups_for", "paper_total",
    "marking_rubric", "tool_params", "file_name_from_url",
]
