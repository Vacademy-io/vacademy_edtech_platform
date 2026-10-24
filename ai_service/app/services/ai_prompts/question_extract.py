"""Prompts for digitising an existing question paper verbatim
(question_extract_service). Kept apart from question_gen: that family
GENERATES questions from material; these must never invent one.
"""
from __future__ import annotations

_EXTRACT = """You are digitising an EXISTING question paper for a teacher. Below is part {index} of {total} of the paper as HTML. Images and equations were replaced by comments like <!--DS_TAG:abc123--> — keep every such comment exactly where it is.

TASK: extract EVERY question in this part, verbatim, in order.
- Never invent, rephrase, shorten, merge, solve or skip a question. Never add a question that is not in the text.
- If this part begins with a fragment that has no question number (the tail of a question from the previous part), ignore that fragment.
- Instructions, headings, page furniture and the answer key are not questions.

For each question:
- "question_number": the number printed in the paper, as a string ("1", "17", "Q3" → "3"). Keep the paper's own numbering.
- "section": the section / part name it falls under if the paper has sections ("Section A", "Logical Reasoning"), else null.
- SHARED MATERIAL: a comprehension passage, a data table, a case study, "Directions for questions 5–8", a diagram that a GROUP of questions depends on goes ONCE into the top-level "passages" map (key "P1", "P2", …, value = the material verbatim as HTML) and every question of the group carries "passage_id": "P1". Never put it inside "question.content". A question with no shared material has "passage_id": null.
- "question": {{"type": "HTML", "content": "the question exactly as printed, as HTML, WITHOUT its number"}}. Keep tables as <table>.
- FIGURES: a <!--DS_TAG:…--> comment is a figure or diagram cropped from the page. Put it inside the "question.content" of the question it belongs to — the one that says "in the figure", "the diagram below", "shown above", or the nearest question when nothing says so — at the point where it was printed. Never drop a DS_TAG, never move one into "options", never repeat one. A figure shared by several questions goes in their "passage".
- FORMULAS: write every mathematical expression as LaTeX inside $…$ (inline) or $$…$$ (display): $x^2 + 3x - 4 = 0$, $\\frac{{a}}{{b}}$, $\\sqrt{{154}}$, $\\int_0^1$. Text that is already LaTeX stays as it is. A text layer reads stacked expressions as fragments ("2√154 2", "x / 2" on separate lines) — reassemble them into the expression the paper prints; never change a value.
- "options": only for MCQS / MCQM / TRUE_FALSE. Each: {{"type": "HTML", "preview_id": "1"|"2"|…, "option_label": "the printed label, e.g. A, b, (iii), 2", "content": "option text as HTML"}}.
- "question_type": decided by what is PRINTED, never by the subject:
    if lettered / numbered options follow the question ((a)…(d), A…D, 1…4) it is MCQS (one correct) or MCQM (the question says "select all that apply" / "which of the following are"), whatever the answer looks like — a question whose options are the numbers 10, 12, 14 is MCQS, not NUMERIC, and its options must be listed;
    TRUE_FALSE — true/false statements;  NUMERIC — no options printed and the answer is a number;
    ONE_WORD — no options, fill in the blank / one word;  LONG_ANSWER — no options, descriptive / explain / derive / match the following / essays.
    Comprehension / case-study MCQs are MCQS with a "passage_id".
- "marks": marks printed for the question or its section (number), else null. "negative_marks": likewise, else null.
- "correct_options": preview_ids of the correct option(s) ONLY if the answer is printed right at the question (an "Ans." line, a tick, a bold/underlined option). Otherwise []. The answer key at the end of the paper is handled separately — do not look for it here.
- "ans": the printed answer for non-MCQ types only if printed at the question, else "". "exp": the printed explanation if any, else "".

Return STRICT JSON only, no prose, no markdown fence:
{{
  "questions": [
    {{
      "question_number": "1",
      "section": null,
      "passage_id": null,
      "question": {{"type": "HTML", "content": "…"}},
      "options": [
        {{"type": "HTML", "preview_id": "1", "option_label": "A", "content": "…"}},
        {{"type": "HTML", "preview_id": "2", "option_label": "B", "content": "…"}}
      ],
      "correct_options": [],
      "ans": "",
      "exp": "",
      "question_type": "MCQS",
      "marks": null,
      "negative_marks": null
    }}
  ],
  "passages": {{"P1": "<p>…shared passage / table, verbatim…</p>"}},
  "title": "the paper's title as printed, or a short descriptive one",
  "tags": ["chapter / topic names"],
  "subjects": ["subject"],
  "classes": ["class 10"],
  "difficulty": "easy | medium | hard"
}}
JSON requires every backslash to be doubled: write \\\\frac, \\\\sqrt, \\\\( … \\\\).
{notes}
PAPER — PART {index} OF {total}:
{html}
"""

_KEY = """Below is part {index} of {total} of the ANSWER KEY / SOLUTIONS section of a question paper, as HTML (images and equations appear as <!--DS_TAG:…--> comments — keep them exactly).

Read off, for every question number in this part, what is PRINTED. Never solve a question yourself, never guess an answer that is not printed.
- "options": for multiple-choice answers, the printed option label(s) exactly as printed ("B", "c", "iii", "2"); more than one label when the key lists several. A key table like "1 2 3 / A A C" pairs each number with the letter below or beside it.
- "ans": for numeric / one-word / descriptive answers, the printed answer text.
- "exp": the printed solution / explanation for that question, verbatim as HTML — the working, the reasoning, why other options fail — everything the paper prints for it. Keep math as written. If nothing is printed beyond the answer, "".
- A question number that appears only in a summary table has "exp": "" here; another part may carry its solution.

Return STRICT JSON only, no prose, no markdown fence:
{{
  "answers": {{
    "1": {{"options": ["B"], "ans": "", "exp": "<p>…</p>"}},
    "2": {{"options": [], "ans": "42", "exp": ""}}
  }}
}}
JSON requires every backslash to be doubled: write \\\\frac, \\\\sqrt.

ANSWER KEY / SOLUTIONS — PART {index} OF {total}:
{html}
"""


def build_extract_prompt(html: str, *, index: int, total: int, user_notes: str = "") -> str:
    notes = f"TEACHER'S NOTES (follow them where they apply): {user_notes.strip()}\n" if user_notes.strip() else ""
    return _EXTRACT.format(html=html, index=index, total=total, notes=notes)


def build_key_prompt(html: str, *, index: int = 1, total: int = 1) -> str:
    return _KEY.format(html=html, index=index, total=total)
