"""Print-ready PDF of a generated question paper, with an optional answer key.

The review board shows a paper as cards; a teacher who wants to hand it out
needs a sheet. This turns the blueprint + the generated questions into the
layout every Indian school paper uses — institute name, title, "Time Allowed /
Maximum Marks" strip, name and roll-number line, general instructions, then
sections with their marks and per-section instruction, continuously numbered
questions with the marks in the right margin, and (optionally) an answer key
with the marking scheme on pages of its own.

Two halves so the layout can be tested without a browser:

    build_paper_html(...)  -> str      pure; the document as HTML + print CSS
    render_pdf(html)       -> bytes    Playwright Chromium (already in the image
                                       for page_builder screenshots)

Maths is `$…$` / `$$…$$` LaTeX inside the question HTML, exactly what the
review board's MathHtml typesets with KaTeX. The page loads KaTeX from a CDN
and auto-renders before printing; if the CDN is unreachable the raw LaTeX
stays visible rather than the export failing — a teacher still gets a paper.
"""
from __future__ import annotations

import asyncio
import html
import logging
import re
from typing import Any, Dict, List, Optional, Sequence

from .paper import OPTION_QUESTION_TYPES, Blueprint, BlueprintRow

logger = logging.getLogger(__name__)

# Chromium per render is ~150–300 MB for a few seconds. Two at once is plenty
# for a "Download" button and keeps a burst of clicks from stacking browsers.
_RENDER_CONCURRENCY = asyncio.Semaphore(2)
_RENDER_TIMEOUT_S = 60
# How long to wait for KaTeX (CDN) + images before printing anyway.
_ASSET_WAIT_MS = 12_000

_KATEX_VERSION = "0.16.11"   # matches the admin FE's katex dependency
_KATEX_CDN = f"https://cdn.jsdelivr.net/npm/katex@{_KATEX_VERSION}/dist"

OPTION_LABELS = "abcdefghijklmnop"

# Generated question HTML is our own model output stored in our own table, but
# it is rendered inside a browser we then print from, so scripts and inline
# handlers are dropped rather than trusted.
_SCRIPT_RE = re.compile(r"<script\b[^>]*>.*?</script>", re.I | re.S)
_ON_ATTR_RE = re.compile(r"\s+on[a-z]+\s*=\s*(\"[^\"]*\"|'[^']*'|[^\s>]+)", re.I)
_TAG_RE = re.compile(r"<[^>]+>")
_MATH_RE = re.compile(r"\$\$[\s\S]+?\$\$|\$[^$\n]+?\$")


def _clean_html(fragment: Optional[str]) -> str:
    text = str(fragment or "")
    text = _SCRIPT_RE.sub("", text)
    text = _ON_ATTR_RE.sub("", text)
    return text.strip()


def _plain_len(fragment: str) -> int:
    """Visible length of an HTML fragment — decides whether options fit two per line."""
    return len(html.unescape(_TAG_RE.sub("", fragment)).strip())


def _fmt_marks(value: Any) -> str:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return str(value or "")
    return str(int(number)) if number.is_integer() else f"{number:g}"


def _fmt_duration(minutes: Optional[int]) -> str:
    if not minutes:
        return ""
    hours, rest = divmod(int(minutes), 60)
    parts: List[str] = []
    if hours:
        parts.append(f"{hours} hour" + ("s" if hours > 1 else ""))
    if rest:
        parts.append(f"{rest} minutes")
    return " ".join(parts)


def _roman(index: int) -> str:
    numerals = ["i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x",
                "xi", "xii", "xiii", "xiv", "xv", "xvi", "xvii", "xviii", "xix", "xx"]
    return numerals[index] if index < len(numerals) else str(index + 1)


# ---------------------------------------------------------------------------
# Grouping: questions under the sections the blueprint planned
# ---------------------------------------------------------------------------

def _meta(question: Dict[str, Any]) -> Dict[str, Any]:
    meta = question.get("kb_meta")
    return meta if isinstance(meta, dict) else {}


def _group_by_section(
    blueprint: Blueprint, questions: Sequence[Dict[str, Any]]
) -> List[Dict[str, Any]]:
    """[{section, rows: [{row, questions}]}] in blueprint order.

    A question belongs to the row whose id its kb_meta names; one that names a
    row no longer in the plan (the teacher deleted the row after generating)
    is kept under its own section name at the end rather than dropped — a
    question the teacher reviewed must not vanish from the printout.
    """
    by_row: Dict[str, List[Dict[str, Any]]] = {}
    orphans: Dict[str, List[Dict[str, Any]]] = {}
    row_ids = {r.id for r in blueprint.rows}
    for q in questions:
        row_id = str(_meta(q).get("row_id") or "")
        if row_id in row_ids:
            by_row.setdefault(row_id, []).append(q)
        else:
            section = str(_meta(q).get("section") or "Section")
            orphans.setdefault(section, []).append(q)

    sections: List[Dict[str, Any]] = []
    index: Dict[str, Dict[str, Any]] = {}
    for row in blueprint.rows:
        qs = by_row.get(row.id) or []
        if not qs:
            continue
        bucket = index.get(row.section)
        if bucket is None:
            bucket = {"section": row.section, "rows": []}
            index[row.section] = bucket
            sections.append(bucket)
        bucket["rows"].append({"row": row, "questions": qs})
    for section, qs in orphans.items():
        bucket = index.get(section)
        if bucket is None:
            bucket = {"section": section, "rows": []}
            index[section] = bucket
            sections.append(bucket)
        bucket["rows"].append({"row": None, "questions": qs})
    return sections


def _question_marks(question: Dict[str, Any], row: Optional[BlueprintRow]) -> float:
    marks = _meta(question).get("marks")
    if marks is None and row is not None:
        marks = row.marks_each
    try:
        return float(marks if marks is not None else 1)
    except (TypeError, ValueError):
        return 1.0


# ---------------------------------------------------------------------------
# HTML
# ---------------------------------------------------------------------------

_CSS = """
@page { size: A4; margin: 15mm 14mm 17mm 14mm; }
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body {
  margin: 0; color: #111; background: #fff;
  font-family: "Noto Serif", "Liberation Serif", "Times New Roman", "Noto Sans Devanagari", serif;
  font-size: 11pt; line-height: 1.45;
}
p { margin: 0; }
img { max-width: 100%; height: auto; }
table { border-collapse: collapse; }
.head { text-align: center; }
.brand { display: flex; align-items: center; justify-content: center; gap: 5mm; }
.brand .logo { max-height: 18mm; max-width: 40mm; object-fit: contain; }
.brand .text { text-align: left; }
.brand.centered .text { text-align: center; }
.head .institute {
  font-family: "Noto Sans", "Liberation Sans", Arial, "Noto Sans Devanagari", sans-serif;
  font-size: 15pt; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; line-height: 1.2;
}
.head .contact {
  font-family: "Noto Sans", "Liberation Sans", Arial, sans-serif;
  font-size: 8.5pt; color: #444; margin-top: 1mm; letter-spacing: 0.02em;
}
.head .rule { margin: 3mm 0 3.5mm; border-top: 1.6pt solid #111; border-bottom: 0.5pt solid #111; height: 1.2mm; }
.head .title { margin-top: 2mm; font-size: 13pt; font-weight: 700; }
.head .subtitle { margin-top: 1mm; font-size: 10.5pt; color: #333; }
.watermark {
  position: fixed; left: 50%; top: 50%; width: 110mm; height: 110mm; margin: -55mm 0 0 -55mm;
  background-position: center; background-repeat: no-repeat; background-size: contain;
  opacity: 0.06; filter: grayscale(100%); z-index: -1; pointer-events: none;
}
.set { position: absolute; top: 0; right: 0; border: 1.2pt solid #111; padding: 0.5mm 2.5mm;
       font-family: "Noto Sans", "Liberation Sans", Arial, sans-serif; font-size: 10pt; font-weight: 700; }
.strip {
  display: flex; justify-content: space-between; gap: 8mm; margin-top: 4mm; padding: 1.8mm 0;
  border-top: 1.2pt solid #111; border-bottom: 1.2pt solid #111; font-weight: 700; font-size: 11pt;
}
.candidate { display: flex; gap: 6mm; margin-top: 3.5mm; font-size: 10.5pt; }
.candidate span { flex: 1 1 auto; border-bottom: 0.6pt solid #111; padding-bottom: 0.5mm; white-space: nowrap; }
.candidate span.short { flex: 0 0 34mm; }
.instructions { margin-top: 4mm; }
.instructions h3 { margin: 0 0 1mm; font-size: 11pt; font-weight: 700; }
.instructions ol { margin: 0; padding-left: 8mm; }
.instructions li { padding-left: 1mm; }
.section { margin-top: 6mm; break-inside: auto; }
.section-head { text-align: center; break-after: avoid; }
.section-head h2 {
  margin: 0; font-family: "Noto Sans", "Liberation Sans", Arial, "Noto Sans Devanagari", sans-serif;
  font-size: 12pt; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase;
}
.section-head .marks { font-size: 10pt; color: #333; }
.row-instruction { margin: 2mm 0 1mm; font-style: italic; break-after: avoid; }
.q { display: grid; grid-template-columns: 8mm 1fr 12mm; column-gap: 2mm; margin-top: 3mm;
     break-inside: avoid; page-break-inside: avoid; }
.q .num { font-weight: 700; }
.q .marks { text-align: right; font-weight: 700; white-space: nowrap; }
.q .body p + p { margin-top: 1mm; }
sup, sub { line-height: 0; }
.section-start { break-inside: avoid; page-break-inside: avoid; }
.options { display: grid; grid-template-columns: 1fr 1fr; column-gap: 6mm; row-gap: 1mm; margin-top: 1.5mm; }
.options.stacked { grid-template-columns: 1fr; }
.options .opt { display: grid; grid-template-columns: 7mm 1fr; }
.options .opt .lbl { font-weight: 400; }
figure { margin: 2mm 0 0; text-align: center; }
figure img { max-height: 65mm; }
.katex-display { margin: 1.5mm 0; }
.key { break-before: page; page-break-before: always; }
.key h2 { margin: 0 0 1mm; text-align: center; font-size: 13pt; }
.key .sub { text-align: center; font-size: 10pt; color: #333; margin-bottom: 4mm; }
.key table { width: 100%; font-size: 10.5pt; }
.key th { text-align: left; border-bottom: 1.2pt solid #111; padding: 1.2mm 1.5mm; font-size: 10pt; }
.key td { vertical-align: top; border-bottom: 0.4pt solid #bbb; padding: 1.6mm 1.5mm; }
.key td.n { width: 10mm; font-weight: 700; }
.key td.m { width: 14mm; text-align: right; }
.key .steps { margin: 1mm 0 0; padding-left: 5mm; font-size: 9.5pt; color: #333; }
.key .steps li { margin-top: 0.3mm; }
.key tr { break-inside: avoid; page-break-inside: avoid; }
"""


def _katex_head() -> str:
    """KaTeX loaded WITHOUT blocking the page.

    The scripts are injected one after the other (auto-render needs katex
    first) and a poll typesets as soon as they are there; if the CDN has not
    delivered within _ASSET_WAIT_MS the page is declared ready anyway and the
    raw `$…$` prints. Nothing here is on the document's load path, so a slow
    CDN can never time out the whole render.
    """
    return (
        f'<link rel="stylesheet" href="{_KATEX_CDN}/katex.min.css">\n'
        "<script>\n"
        "window.__paperReady = false;\n"
        "(function(){\n"
        f"  var deadline = Date.now() + {_ASSET_WAIT_MS};\n"
        "  function done(){ window.__paperReady = true; }\n"
        "  function load(src, next){ var s = document.createElement('script'); s.src = src; s.async = true;\n"
        "    s.onload = next; s.onerror = done; document.head.appendChild(s); }\n"
        "  function typeset(){\n"
        "    if (typeof renderMathInElement === 'function') {\n"
        "      try { renderMathInElement(document.body, {\n"
        "        delimiters: [{left:'$$', right:'$$', display:true}, {left:'$', right:'$', display:false}],\n"
        "        throwOnError: false, strict: false }); } catch (e) {}\n"
        "      done(); return;\n"
        "    }\n"
        "    if (Date.now() > deadline) { done(); return; }\n"
        "    setTimeout(typeset, 100);\n"
        "  }\n"
        f"  load('{_KATEX_CDN}/katex.min.js', function(){{ load('{_KATEX_CDN}/contrib/auto-render.min.js', typeset); }});\n"
        "  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', typeset); else typeset();\n"
        "})();\n"
        "</script>\n"
    )


def _render_options(question: Dict[str, Any]) -> str:
    options = [o for o in (question.get("options") or []) if isinstance(o, dict)]
    if not options:
        return ""
    contents = [_clean_html(o.get("content")) for o in options]
    stacked = any(_plain_len(c) > 42 or "<img" in c.lower() for c in contents)
    items = "".join(
        f'<div class="opt"><span class="lbl">({OPTION_LABELS[i] if i < len(OPTION_LABELS) else i + 1})</span>'
        f"<span>{c}</span></div>"
        for i, c in enumerate(contents)
    )
    return f'<div class="options{" stacked" if stacked else ""}">{items}</div>'


def _render_figures(question: Dict[str, Any], question_html: str) -> str:
    """Book diagrams the generator attached but did not already place inline."""
    figures = _meta(question).get("figures") or []
    out = []
    for fig in figures:
        url = (fig or {}).get("image_url") if isinstance(fig, dict) else None
        if not url or url in question_html:
            continue
        out.append(f'<figure><img src="{html.escape(str(url), quote=True)}" alt=""></figure>')
    return "".join(out)


def _render_question(number: int, question: Dict[str, Any], marks: float, show_marks: bool) -> str:
    body = _clean_html((question.get("question") or {}).get("content") if isinstance(question.get("question"), dict) else question.get("question"))
    marks_cell = f'<div class="marks">[{_fmt_marks(marks)}]</div>' if show_marks else "<div></div>"
    return (
        '<div class="q">'
        f'<div class="num">{number}.</div>'
        f'<div class="body">{body}{_render_options(question)}{_render_figures(question, body)}</div>'
        f"{marks_cell}"
        "</div>"
    )


def _answer_text(question: Dict[str, Any]) -> str:
    """The key entry: option letter(s) for choice questions, else the answer."""
    qtype = str(question.get("question_type") or "").upper()
    options = [o for o in (question.get("options") or []) if isinstance(o, dict)]
    correct = [str(c) for c in (question.get("correct_options") or [])]
    if qtype in OPTION_QUESTION_TYPES and options and correct:
        picked = []
        for i, o in enumerate(options):
            if str(o.get("preview_id") or i + 1) in correct:
                label = OPTION_LABELS[i] if i < len(OPTION_LABELS) else str(i + 1)
                picked.append(f"({label}) {_clean_html(o.get('content'))}")
        if picked:
            return "; ".join(picked)
    return _clean_html(question.get("ans")) or "—"


def _marking_steps_html(question: Dict[str, Any]) -> str:
    """The marking scheme under a key entry: the generator's steps, else the
    explanation split on its line breaks."""
    steps = question.get("marking_steps") or []
    if not isinstance(steps, list):
        steps = []
    steps = [_clean_html(s) for s in steps if str(s or "").strip()]
    if not steps and question.get("exp"):
        steps = [s for s in re.split(r"<br\s*/?>", _clean_html(question.get("exp"))) if s.strip()]
    if not steps:
        return ""
    return '<ol class="steps">' + "".join(f"<li>{s}</li>" for s in steps) + "</ol>"


def _render_key(
    sections: List[Dict[str, Any]], show_marks: bool, title: str
) -> str:
    rows_html = []
    number = 0
    for bucket in sections:
        for entry in bucket["rows"]:
            row = entry["row"]
            for q in entry["questions"]:
                number += 1
                marks_cell = f'<td class="m">{_fmt_marks(_question_marks(q, row))}</td>' if show_marks else ""
                rows_html.append(
                    f'<tr><td class="n">{number}.</td><td>{_answer_text(q)}{_marking_steps_html(q)}</td>{marks_cell}</tr>'
                )
    head_marks = "<th>Marks</th>" if show_marks else ""
    return (
        '<section class="key">'
        "<h2>Answer Key &amp; Marking Scheme</h2>"
        f'<p class="sub">{html.escape(title)}</p>'
        f"<table><thead><tr><th>Q.</th><th>Answer</th>{head_marks}</tr></thead>"
        f"<tbody>{''.join(rows_html)}</tbody></table>"
        "</section>"
    )


def _question_html_parts(question: Dict[str, Any]) -> List[str]:
    q = question.get("question")
    return (
        [q.get("content") if isinstance(q, dict) else q, question.get("ans"), question.get("exp")]
        + [o.get("content") for o in (question.get("options") or []) if isinstance(o, dict)]
        + list(question.get("marking_steps") or [])
    )


def _needs_math(questions: Sequence[Dict[str, Any]]) -> bool:
    return any(_MATH_RE.search(str(part or "")) for q in questions for part in _question_html_parts(q))


LOGO_PLACEMENTS = ("watermark", "header", "none")


def _render_brand(
    institute_name: Optional[str],
    logo_url: Optional[str],
    contact_line: Optional[str],
    logo_placement: str = "watermark",
) -> str:
    """The institute's name (and contact line) at the top, then a double rule.

    The logo goes where the institute wants it: a faint watermark behind every
    page (the default — the title stays the first thing on the sheet), beside
    the name as a letterhead, or nowhere.
    """
    if not institute_name and not logo_url:
        return ""
    text = ""
    if institute_name:
        text += f'<div class="institute">{html.escape(institute_name)}</div>'
    if contact_line:
        text += f'<div class="contact">{html.escape(contact_line)}</div>'
    in_header = bool(logo_url) and logo_placement == "header"
    logo = (
        f'<img class="logo" src="{html.escape(logo_url, quote=True)}" alt="">' if in_header else ""
    )
    if not text and not logo:
        return ""
    return (
        f'<div class="brand{"" if in_header else " centered"}">{logo}<div class="text">{text}</div></div>'
        '<div class="rule"></div>'
    )


def _render_watermark(logo_url: Optional[str], logo_placement: str) -> str:
    """position:fixed repeats on every printed page in Chromium, which is what
    makes one element a watermark for the whole paper."""
    if not logo_url or logo_placement != "watermark":
        return ""
    return (
        f'<div class="watermark" style="background-image:url({html.escape(logo_url, quote=True)})"></div>'
    )


def _render_header(
    blueprint: Blueprint,
    *,
    delivered: int,
    total_marks: float,
    institute_name: Optional[str],
    subtitle: Optional[str],
    set_label: Optional[str],
    logo_url: Optional[str] = None,
    contact_line: Optional[str] = None,
    logo_placement: str = "watermark",
    candidate_line: bool = False,
    exam_date: Optional[str] = None,
) -> str:
    parts = [_render_watermark(logo_url, logo_placement)]
    parts.append('<header class="head" style="position:relative">')
    if set_label:
        parts.append(f'<div class="set">SET {html.escape(set_label)}</div>')
    parts.append(_render_brand(institute_name, logo_url, contact_line, logo_placement))
    parts.append(f'<div class="title">{html.escape(blueprint.title)}</div>')
    if subtitle:
        parts.append(f'<div class="subtitle">{html.escape(subtitle)}</div>')
    parts.append("</header>")

    duration = _fmt_duration(blueprint.duration_minutes)
    left = f"Time Allowed: {duration}" if duration else f"Questions: {delivered}"
    parts.append(
        f'<div class="strip"><span>{html.escape(left)}</span>'
        f"<span>Maximum Marks: {_fmt_marks(total_marks)}</span></div>"
    )
    if candidate_line:
        # The exam date, when the teacher set one, is printed rather than left
        # for the student to fill in.
        date_cell = f"Date: {html.escape(exam_date)}" if exam_date else "Date:"
        parts.append(
            '<div class="candidate"><span>Name:</span><span class="short">Roll No.:</span>'
            f'<span class="short">{date_cell}</span></div>'
        )
    elif exam_date:
        parts.append(f'<div class="candidate"><span class="short">Date: {html.escape(exam_date)}</span></div>')
    if blueprint.instructions:
        items = "".join(
            f"<li>({_roman(i)}) {html.escape(text)}</li>" for i, text in enumerate(blueprint.instructions)
        )
        parts.append(
            '<div class="instructions"><h3>General Instructions</h3>'
            f'<ol style="list-style:none;padding-left:0">{items}</ol></div>'
        )
    return "".join(parts)


def _section_marks_line(bucket: Dict[str, Any], show_marks: bool) -> str:
    questions = [q for e in bucket["rows"] for q in e["questions"]]
    count = len(questions)
    if not show_marks:
        return f"{count} questions"
    total = sum(_question_marks(q, e["row"]) for e in bucket["rows"] for q in e["questions"])
    rows = [e["row"] for e in bucket["rows"] if e["row"] is not None]
    if len(bucket["rows"]) == 1 and rows:
        each = rows[0].marks_each
        return (
            f"{count} question{'s' if count != 1 else ''} × "
            f"{_fmt_marks(each)} mark{'s' if each != 1 else ''} = {_fmt_marks(total)} marks"
        )
    return f"{count} questions · {_fmt_marks(total)} marks"


def _render_section(bucket: Dict[str, Any], first_number: int, show_marks: bool) -> tuple:
    """One section's HTML and the next question number.

    The heading, the section's first instruction and its first question travel
    as one unbreakable block: a "SECTION C" alone at the foot of a page is the
    first thing a teacher notices about a printout.
    """
    parts = [
        '<section class="section"><div class="section-start">',
        f'<div class="section-head"><h2>{html.escape(bucket["section"])}</h2>'
        f'<div class="marks">({html.escape(_section_marks_line(bucket, show_marks))})</div></div>',
    ]
    number = first_number
    last_instruction: Optional[str] = None
    block_open = True
    for entry in bucket["rows"]:
        row = entry["row"]
        instruction = (row.instruction or "").strip() if row else ""
        if instruction and instruction != last_instruction:
            parts.append(f'<p class="row-instruction">{html.escape(instruction)}</p>')
            last_instruction = instruction
        for q in entry["questions"]:
            number += 1
            parts.append(_render_question(number, q, _question_marks(q, row), show_marks))
            if block_open:
                parts.append("</div>")
                block_open = False
    if block_open:
        parts.append("</div>")
    parts.append("</section>")
    return "".join(parts), number


def build_paper_html(
    blueprint: Blueprint,
    questions: Sequence[Dict[str, Any]],
    *,
    institute_name: Optional[str] = None,
    subtitle: Optional[str] = None,
    include_answer_key: bool = False,
    show_marks: bool = True,
    set_label: Optional[str] = None,
    logo_url: Optional[str] = None,
    contact_line: Optional[str] = None,
    logo_placement: str = "watermark",
    candidate_line: bool = False,
    theme: str = "classic",
    exam_date: Optional[str] = None,
    grade_line: Optional[str] = None,
) -> str:
    """The whole document. Pure: same inputs, same HTML.

    `theme` picks the layout: "classic" (this module), or one of the
    institute-style layouts in paper_themes ("compact", "coaching")."""
    from . import paper_themes

    sections = _group_by_section(blueprint, questions)
    delivered = sum(len(e["questions"]) for b in sections for e in b["rows"])
    total_marks = sum(
        _question_marks(q, e["row"]) for b in sections for e in b["rows"] for q in e["questions"]
    )
    if theme not in paper_themes.THEMES:
        theme = "classic"
    lang = "hi" if (blueprint.language or "").lower().startswith("hi") else "en"
    head_script = _katex_head() if _needs_math(questions) else "<script>window.__paperReady = true;</script>"

    if theme != "classic":
        placement = logo_placement if logo_placement in LOGO_PLACEMENTS else "watermark"
        if theme == "compact":
            themed = paper_themes.render_compact(
                blueprint, sections, delivered=delivered, total_marks=total_marks,
                institute_name=institute_name, subtitle=subtitle,
                include_answer_key=include_answer_key, show_marks=show_marks,
                set_label=set_label, logo_url=logo_url, logo_placement=placement,
                exam_date=exam_date,
            )
            theme_css = paper_themes.COMPACT_CSS
        else:
            themed = paper_themes.render_coaching(
                blueprint, sections, delivered=delivered, total_marks=total_marks,
                institute_name=institute_name, subtitle=subtitle, grade_line=grade_line,
                include_answer_key=include_answer_key, show_marks=show_marks,
                set_label=set_label, logo_url=logo_url, exam_date=exam_date,
            )
            theme_css = paper_themes.COACHING_CSS
        return (
            "<!DOCTYPE html>\n"
            f'<html lang="{lang}"><head><meta charset="utf-8">'
            f"<title>{html.escape(blueprint.title)}</title>"
            f"<style>{_CSS}{theme_css}</style>{head_script}</head>"
            f'<body class="theme-{theme}">{themed}</body></html>'
        )

    body = [
        _render_header(
            blueprint, delivered=delivered, total_marks=total_marks,
            institute_name=institute_name, subtitle=subtitle, set_label=set_label,
            logo_url=logo_url, contact_line=contact_line,
            logo_placement=logo_placement if logo_placement in LOGO_PLACEMENTS else "watermark",
            candidate_line=candidate_line, exam_date=exam_date,
        )
    ]
    number = 0
    for bucket in sections:
        section_html, number = _render_section(bucket, number, show_marks)
        body.append(section_html)
    if include_answer_key:
        body.append(_render_key(sections, show_marks, blueprint.title))

    return (
        "<!DOCTYPE html>\n"
        f'<html lang="{lang}"><head><meta charset="utf-8">'
        f"<title>{html.escape(blueprint.title)}</title>"
        f"<style>{_CSS}</style>{head_script}</head><body>"
        + "".join(body)
        + "</body></html>"
    )


# ---------------------------------------------------------------------------
# PDF
# ---------------------------------------------------------------------------

def _footer_template(title: str) -> str:
    # Header/footer templates render in their own document: inline styles only,
    # and an explicit font-size or nothing shows.
    return (
        '<div style="width:100%;padding:0 14mm;display:flex;justify-content:space-between;'
        'font-family:Arial,sans-serif;font-size:8pt;color:#666">'
        f"<span>{html.escape(title[:90])}</span>"
        '<span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>'
        "</div>"
    )


async def render_pdf(
    document_html: str,
    *,
    footer_title: str = "",
    print_settings: Optional[Dict[str, Any]] = None,
) -> bytes:
    """HTML → PDF bytes through headless Chromium.

    Waits for KaTeX (and images) up to _ASSET_WAIT_MS, then prints whatever is
    on the page: a slow CDN costs a raw formula, never the whole download.
    `print_settings` (paper size, margins, header/footer) come from the theme;
    the classic sheet is A4 with a plain footer.
    """
    from playwright.async_api import async_playwright  # heavy import; only when used

    settings = {
        "format": "A4",
        "margin": {"top": "15mm", "right": "14mm", "bottom": "17mm", "left": "14mm"},
        "header_template": "<span></span>",
        "footer_template": _footer_template(footer_title),
        **(print_settings or {}),
    }

    async with _RENDER_CONCURRENCY:
        async with async_playwright() as pw:
            browser = await pw.chromium.launch(headless=True, args=["--disable-dev-shm-usage"])
            try:
                page = await browser.new_page()
                await page.set_content(document_html, wait_until="domcontentloaded", timeout=_ASSET_WAIT_MS + 5_000)
                try:
                    await page.wait_for_function("window.__paperReady === true", timeout=_ASSET_WAIT_MS)
                except Exception:  # noqa: BLE001 — print what we have
                    logger.warning("paper_pdf: assets did not settle in %sms; printing anyway", _ASSET_WAIT_MS)
                try:
                    await page.wait_for_load_state("networkidle", timeout=4_000)
                except Exception:  # noqa: BLE001 — a straggling image is not worth a failed download
                    logger.debug("paper_pdf: network still busy after 4s; printing anyway")
                return await page.pdf(
                    format=settings["format"],
                    print_background=True,
                    prefer_css_page_size=True,
                    display_header_footer=True,
                    header_template=settings["header_template"],
                    footer_template=settings["footer_template"],
                    margin=settings["margin"],
                )
            finally:
                await browser.close()


async def render_paper_pdf(
    blueprint: Blueprint,
    questions: Sequence[Dict[str, Any]],
    **options: Any,
) -> bytes:
    from . import paper_themes

    # Only the running footer band carries the institute colour; the document itself stays black.
    accent_color = options.pop("accent_color", None)
    document = build_paper_html(blueprint, questions, **options)
    footer = " · ".join(
        t for t in (options.get("institute_name"), blueprint.title) if t
    )
    theme = options.get("theme") or "classic"
    print_settings = (
        paper_themes.page_settings(
            theme, institute_name=options.get("institute_name"),
            title=blueprint.title, subtitle=options.get("subtitle"),
            accent=paper_themes.resolve_accent(accent_color),
        )
        if theme in paper_themes.THEMES and theme != "classic"
        else None
    )
    return await asyncio.wait_for(
        render_pdf(document, footer_title=footer, print_settings=print_settings),
        timeout=_RENDER_TIMEOUT_S,
    )


def paper_filename(title: str, *, with_key: bool) -> str:
    slug = re.sub(r"[^A-Za-z0-9]+", "-", title).strip("-")[:80] or "question-paper"
    return f"{slug}{'-with-answer-key' if with_key else ''}.pdf"
