"""Alternative print layouts for a generated question paper.

`classic` (paper_pdf.py) is the board-exam sheet: single column, marks in the
margin, answer key on its own pages. Institutes also asked for the two layouts
their existing papers use, so the same paper can be printed as:

  compact   — the coaching/CA-foundation style: sans-serif, institute name and
              title on top, Subject/Date left and Time/Max Marks right,
              numbered "Instructions for students", then a TWO-COLUMN body with
              centred underlined section headings, marks as a small number in
              the column margin, and a coloured footer band with the page count.
              The answer key follows in the same two-column style.

  coaching  — the classes-style sheet: serif, big institute header with the
              logo, "CLASS - 10TH" line, topics on the left / boxed title in the
              centre / Time · M.M · Date on the right, a BORDERED two-column
              body with a vertical rule, rounded shadowed section boxes,
              options in a 2×2 row, and — when the key is requested — "Ans. (b)"
              printed inline under every question, exactly as a teacher's copy.

Both reuse the question/option/figure renderers of the classic theme, so KaTeX
maths, book figures and generated diagrams print the same everywhere.
"""
from __future__ import annotations

import html
import re
from datetime import date
from typing import Any, Dict, List, Optional, Sequence

from .paper import Blueprint, BlueprintRow

THEMES = ("classic", "compact", "coaching")

# The dashboard's theme picker stores either a preset code or a raw hex in
# institutes.institute_theme_code; these are each preset's primary-500 (kept in
# step with frontend-admin-dashboard/src/constants/themes/theme.json).
PRESET_ACCENTS = {
    "primary": "#ED7424", "blue": "#1E88E5", "green": "#43A047", "purple": "#8E24AA",
    "red": "#E53935", "pink": "#D81B60", "indigo": "#3949AB", "amber": "#FFB300",
    "cyan": "#00ACC1", "teal": "#00897B", "lime": "#7CB342", "violet": "#5E35B1",
    "maroon": "#9B2242", "navy": "#1A237E", "brown": "#6D4C41", "slate": "#546E7A",
    "charcoal": "#424242", "holistic": "#622335",
}
DEFAULT_ACCENT = "#2F8FE0"
_HEX = re.compile(r"^#?([0-9a-fA-F]{6})$")


def resolve_accent(theme_code: Optional[str]) -> str:
    """Institute theme code → the compact footer-band colour (the only place the
    brand colour appears on the sheet; headings and rules stay black so the
    paper photocopies cleanly). Unknown or blank → the default blue."""
    code = (theme_code or "").strip()
    if not code:
        return DEFAULT_ACCENT
    match = _HEX.match(code)
    if match:
        return "#" + match.group(1).upper()
    return PRESET_ACCENTS.get(code.lower(), DEFAULT_ACCENT)


def accent_text_color(accent: str) -> str:
    """White on dark footer bands, near-black on light ones (amber, lime)."""
    r, g, b = (int(accent[i:i + 2], 16) for i in (1, 3, 5))
    luminance = 0.299 * r + 0.587 * g + 0.114 * b
    return "#111111" if luminance > 170 else "#FFFFFF"



# Human names for the types, as a coaching paper prints them in section boxes.
_TYPE_LABELS = {
    "MCQS": "MCQ's", "MCQM": "MCQ's (multiple correct)", "TRUE_FALSE": "True/False",
    "ONE_WORD": "One Word", "NUMERIC": "Numerical", "LONG_ANSWER": "Subjective",
    "PASSAGE": "Case Study", "ASSERTION_REASON": "Assertion-Reason",
}


def _h(text: Any) -> str:
    return html.escape(str(text or ""))


def _short_duration(minutes: Optional[int]) -> str:
    """'1 hr 30 min' — the header box has no room for words."""
    if not minutes:
        return ""
    hours, rest = divmod(int(minutes), 60)
    bits = []
    if hours:
        bits.append(f"{hours} hr")
    if rest:
        bits.append(f"{rest} min")
    return " ".join(bits)


# ---------------------------------------------------------------------------
# CSS
# ---------------------------------------------------------------------------

COMPACT_CSS = """
@page { size: Letter; margin: 14mm 12mm 16mm 12mm; }
body { font-family: "Noto Sans", "Liberation Sans", Arial, "Noto Sans Devanagari", sans-serif; font-size: 9.5pt; line-height: 1.4; }
.c-head { text-align: center; position: relative; padding-bottom: 1.5mm; border-bottom: 1.2pt solid #000; }
.c-head.with-logo { display: flex; flex-direction: column; justify-content: center; min-height: 16mm; padding: 0 34mm 1.5mm; }
.c-head .logo { position: absolute; left: 0; top: 0; max-height: 14mm; max-width: 30mm; object-fit: contain; }
.c-head .institute { font-size: 17pt; font-weight: 700; letter-spacing: 0.01em; text-transform: none; }
.c-head .title { font-size: 10.5pt; margin-top: 0.5mm; }
.c-head.with-logo .title { font-size: 14pt; font-weight: 700; margin-top: 0; }
.c-meta { display: flex; justify-content: space-between; margin-top: 1.5mm; padding-bottom: 1.5mm; border-bottom: 0.6pt solid #000; font-size: 8.5pt; }
.c-meta div { line-height: 1.6; }
.c-meta b { font-weight: 700; }
.c-instr { margin-top: 2.5mm; border: 0.6pt solid #000; padding: 1.5mm 3mm 2mm; }
.c-instr h3 { text-align: center; font-size: 9.5pt; font-weight: 700; margin: 0 0 1mm; }
.c-instr ol { margin: 0; padding-left: 6mm; }
.c-instr li { padding-left: 1mm; }
.c-body { column-count: 2; column-gap: 7mm; column-rule: 0.6pt solid #000; margin-top: 3mm; }
.c-body .section { margin-top: 3mm; break-inside: auto; }
.c-body .section-start { break-inside: avoid; }
.c-body .section-head { text-align: center; break-after: avoid; margin-bottom: 1.5mm; }
.c-body .section-head h2 { font-size: 11pt; font-weight: 700; text-decoration: underline; text-transform: none; letter-spacing: 0; margin: 0; }
.c-body .section-head .marks { font-size: 8pt; color: #444; }
.c-body .row-instruction { font-style: italic; margin: 0 0 1mm; break-after: avoid; }
.c-body .q { display: grid; grid-template-columns: 6mm 1fr 6mm; column-gap: 1.5mm; margin-top: 2mm; break-inside: avoid; }
.c-body .q .num { font-weight: 400; }
.c-body .q .marks { text-align: right; font-weight: 400; color: #222; }
.c-body .options { grid-template-columns: 1fr 1fr; column-gap: 3mm; }
.c-body .options .opt { grid-template-columns: 6mm 1fr; }
.c-body figure img { max-height: 55mm; }
.c-key { margin-top: 5mm; break-before: page; page-break-before: always; }
.c-key h2 { text-align: center; font-size: 11pt; text-decoration: underline; margin: 0 0 2mm; }
.c-key .c-body { margin-top: 0; }
.c-key .k { display: grid; grid-template-columns: 6mm 1fr; column-gap: 1.5mm; margin-top: 1.5mm; break-inside: avoid; }
.c-key .k .steps { margin: 0.5mm 0 0; padding-left: 4mm; font-size: 8.5pt; color: #333; }
.watermark { filter: none; opacity: 0.07; }
"""

COACHING_CSS = """
@page { size: A4; margin: 10mm 10mm 12mm 10mm; }
body { font-family: "Noto Serif", "Liberation Serif", "Times New Roman", "Noto Sans Devanagari", serif; font-size: 10pt; line-height: 1.35; }
.k-head { display: flex; align-items: center; justify-content: center; gap: 4mm; }
.k-head .logo { max-height: 20mm; max-width: 30mm; object-fit: contain; }
.k-head .institute { font-family: "Noto Sans", "Liberation Sans", Arial, sans-serif; font-size: 26pt; font-weight: 900; letter-spacing: 0.04em; text-transform: uppercase; line-height: 1.05; }
.k-rule { border-top: 1.8pt solid #000; margin: 1.5mm 0 1mm; }
.k-class { text-align: center; font-family: "Noto Sans", Arial, sans-serif; font-weight: 700; font-size: 11pt; }
.k-meta { display: grid; grid-template-columns: minmax(48mm, 1fr) minmax(60mm, 2fr) 38mm; align-items: center; gap: 4mm; margin: 1mm 0 2mm; font-family: "Noto Sans", Arial, sans-serif; font-size: 9pt; }
.k-meta .topics { font-weight: 700; line-height: 1.45; font-size: 8.5pt; }
.k-meta .topics div { display: flex; gap: 1mm; }
.k-meta .topics div span.n { flex: 0 0 auto; }
.k-meta .titlebox { border: 1.4pt solid #000; padding: 1.2mm 3mm; text-align: center; font-weight: 700; font-size: 10.5pt; line-height: 1.3; }
.k-meta .titlebox .sub { font-weight: 700; }
.k-meta .right { text-align: left; font-weight: 700; line-height: 1.5; white-space: nowrap; }
.k-meta .right span { display: inline-block; min-width: 12mm; }
.k-body { border: 1pt solid #000; padding: 2.5mm 3mm; column-count: 2; column-gap: 6mm; column-rule: 0.7pt solid #000; }
.k-body .section { break-inside: auto; margin-top: 2mm; }
.k-body .section-start { break-inside: avoid; }
.k-body .section-head { text-align: center; margin: 1mm 0 2mm; break-after: avoid; }
.k-body .section-head .box { display: inline-block; border: 1.1pt solid #222; border-radius: 3mm; padding: 1mm 4mm; font-family: "Noto Sans", Arial, sans-serif; font-weight: 700; font-size: 10pt; box-shadow: 1.2mm 1.2mm 0 #999; background: #fff; }
.k-body .row-instruction { margin: 0 0 1.5mm; font-weight: 700; break-after: avoid; }
.k-body .row-instruction::before { content: "Instructions: "; }
.k-body .q { display: grid; grid-template-columns: 7mm 1fr; column-gap: 1mm; margin-top: 2mm; break-inside: avoid; }
.k-body .q .num { font-weight: 400; }
.k-body .options { grid-template-columns: 1fr 1fr; column-gap: 2mm; row-gap: 0.5mm; margin-top: 1mm; }
.k-body .options .opt { grid-template-columns: 6mm 1fr; }
.k-body .ans { margin-top: 1mm; font-weight: 700; }
.k-body .ans .steps { margin: 0.5mm 0 0 4mm; padding-left: 4mm; font-weight: 400; font-size: 9pt; color: #222; }
.k-body figure img { max-height: 55mm; }
.watermark { width: 150mm; height: 150mm; margin: -75mm 0 0 -75mm; opacity: 0.09; }
"""


# ---------------------------------------------------------------------------
# Shared pieces
# ---------------------------------------------------------------------------

def _row_type_label(rows: Sequence[Optional[BlueprintRow]]) -> str:
    types = [r.question_type for r in rows if r is not None]
    if not types:
        return ""
    labels = []
    for t in types:
        label = _TYPE_LABELS.get(t, t.title())
        if label not in labels:
            labels.append(label)
    return " / ".join(labels)


def _inline_answer(question: Dict[str, Any], with_steps: bool) -> str:
    """'Ans. (b)' for choice questions; 'Ans. …' plus steps for the rest."""
    from .paper_pdf import _answer_text, _marking_steps_html

    text = _answer_text(question)
    steps = _marking_steps_html(question) if with_steps else ""
    return f'<div class="ans">Ans. {text}{steps}</div>'


def _render_question(
    number: int, question: Dict[str, Any], marks: float, *, show_marks: bool,
    marks_column: bool, inline_key: bool,
) -> str:
    from .paper_pdf import _clean_html, _fmt_marks, _render_figures, _render_options

    raw = question.get("question")
    body = _clean_html(raw.get("content") if isinstance(raw, dict) else raw)
    ans = _inline_answer(question, with_steps=True) if inline_key else ""
    cells = [
        f'<div class="num">{number}.</div>',
        f'<div class="body">{body}{_render_options(question)}{_render_figures(question, body)}{ans}</div>',
    ]
    if marks_column:
        cells.append(f'<div class="marks">{_fmt_marks(marks)}</div>' if show_marks else "<div></div>")
    return '<div class="q">' + "".join(cells) + "</div>"


def _render_sections(
    sections: List[Dict[str, Any]], *, show_marks: bool, marks_column: bool,
    inline_key: bool, boxed_heads: bool,
) -> str:
    from .paper_pdf import _fmt_marks, _question_marks, _section_marks_line

    out: List[str] = []
    number = 0
    for bucket in sections:
        rows = [e["row"] for e in bucket["rows"]]
        if boxed_heads:
            marks_each = {r.marks_each for r in rows if r is not None}
            marks_bit = f" ({_fmt_marks(next(iter(marks_each)))}M)" if len(marks_each) == 1 and show_marks else ""
            type_bit = _row_type_label(rows)
            head = (
                f'<div class="section-head"><span class="box">{_h(bucket["section"]).upper()}'
                f'{" (" + _h(type_bit) + ")" if type_bit else ""}{marks_bit}</span></div>'
            )
        else:
            head = (
                f'<div class="section-head"><h2>{_h(bucket["section"])}</h2>'
                f'<div class="marks">({_h(_section_marks_line(bucket, show_marks))})</div></div>'
            )
        out.append(f'<section class="section"><div class="section-start">{head}')
        block_open = True
        last_instruction: Optional[str] = None
        for entry in bucket["rows"]:
            row = entry["row"]
            instruction = (row.instruction or "").strip() if row else ""
            if instruction and instruction != last_instruction:
                out.append(f'<p class="row-instruction">{_h(instruction)}</p>')
                last_instruction = instruction
            for q in entry["questions"]:
                number += 1
                out.append(_render_question(
                    number, q, _question_marks(q, row), show_marks=show_marks,
                    marks_column=marks_column, inline_key=inline_key,
                ))
                if block_open:
                    out.append("</div>")
                    block_open = False
        if block_open:
            out.append("</div>")
        out.append("</section>")
    return "".join(out)


def _compact_key(sections: List[Dict[str, Any]]) -> str:
    from .paper_pdf import _answer_text, _marking_steps_html

    items: List[str] = []
    number = 0
    for bucket in sections:
        for entry in bucket["rows"]:
            for q in entry["questions"]:
                number += 1
                items.append(
                    f'<div class="k"><div>{number}.</div><div>{_answer_text(q)}{_marking_steps_html(q)}</div></div>'
                )
    return (
        '<section class="c-key"><h2>Answer Key &amp; Marking Scheme</h2>'
        f'<div class="c-body">{"".join(items)}</div></section>'
    )


# ---------------------------------------------------------------------------
# Themes
# ---------------------------------------------------------------------------

def render_compact(
    blueprint: Blueprint,
    sections: List[Dict[str, Any]],
    *,
    delivered: int,
    total_marks: float,
    institute_name: Optional[str],
    subtitle: Optional[str],
    include_answer_key: bool,
    show_marks: bool,
    set_label: Optional[str],
    logo_url: Optional[str],
    logo_placement: str,
    exam_date: Optional[str],
) -> str:
    from .paper_pdf import _fmt_duration, _fmt_marks, _render_watermark

    # A small mark top-left as on a printed letterhead; the watermark (the
    # default placement) stays underneath so the sheet reads as the institute's
    # on every page, not just the first. The logo already carries the name, so
    # the name is only printed when there is no logo to do that job.
    header_logo = (
        f'<img class="logo" src="{html.escape(logo_url, quote=True)}" alt="">'
        if logo_url and logo_placement != "none"
        else ""
    )
    head_class = "c-head with-logo" if header_logo else "c-head"
    parts = [_render_watermark(logo_url, logo_placement), f'<header class="{head_class}">{header_logo}']
    if set_label:
        parts.append(f'<div class="set">SET {_h(set_label)}</div>')
    if institute_name and not header_logo:
        parts.append(f'<div class="institute">{_h(institute_name)}</div>')
    parts.append(f'<div class="title">{_h(blueprint.title)}</div></header>')
    duration = _fmt_duration(blueprint.duration_minutes)
    left = f"<div><b>Subject:</b> {_h(subtitle)}</div>" if subtitle else "<div></div>"
    left += f"<div><b>Date:</b> {_h(exam_date) if exam_date else '____________'}</div>"
    right = (
        f"<div><b>Time:</b> {_h(duration) if duration else '—'}</div>"
        f"<div><b>Maximum Marks:</b> {_fmt_marks(total_marks)}</div>"
    )
    parts.append(f'<div class="c-meta"><div>{left}</div><div style="text-align:right">{right}</div></div>')
    if blueprint.instructions:
        items = "".join(f"<li>{_h(line)}</li>" for line in blueprint.instructions)
        parts.append(f'<div class="c-instr"><h3>Instructions for students</h3><ol>{items}</ol></div>')
    parts.append(
        '<div class="c-body">'
        + _render_sections(sections, show_marks=show_marks, marks_column=True, inline_key=False, boxed_heads=False)
        + "</div>"
    )
    if include_answer_key:
        parts.append(_compact_key(sections))
    return "".join(parts)


def render_coaching(
    blueprint: Blueprint,
    sections: List[Dict[str, Any]],
    *,
    delivered: int,
    total_marks: float,
    institute_name: Optional[str],
    subtitle: Optional[str],
    grade_line: Optional[str],
    include_answer_key: bool,
    show_marks: bool,
    set_label: Optional[str],
    logo_url: Optional[str],
    exam_date: Optional[str],
) -> str:
    from .paper_pdf import _fmt_marks, _render_watermark

    # The watermark is part of this look even when the logo also sits in the header.
    parts = [_render_watermark(logo_url, "watermark")]
    logo = f'<img class="logo" src="{html.escape(logo_url, quote=True)}" alt="">' if logo_url else ""
    name = institute_name or blueprint.title
    # A long name drops a size rather than wrapping onto a third line.
    size = "26pt" if len(name) <= 22 else "21pt" if len(name) <= 34 else "17pt"
    parts.append(
        f'<header class="k-head">{logo}<div class="institute" style="font-size:{size}">{_h(name)}</div></header>'
        '<div class="k-rule"></div>'
    )
    if grade_line:
        parts.append(f'<div class="k-class">{_h(grade_line).upper()}</div>')
    topics: List[str] = []
    for bucket in sections:
        for entry in bucket["rows"]:
            row = entry["row"]
            if row and row.topic and row.topic not in topics:
                topics.append(row.topic)
    def clip(text: str, limit: int = 48) -> str:
        return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"

    topic_html = "".join(
        f'<div><span class="n">{"Topic: " if i == 0 else "&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"}'
        f'{i + 1}.</span><span>{_h(clip(t))}</span></div>'
        for i, t in enumerate(topics[:3])
    )
    title_sub = '<div class="sub">(Answer Key)</div>' if include_answer_key else ""
    duration = _short_duration(blueprint.duration_minutes)
    right = (
        f"<div>Time : <span>{_h(duration) if duration else '—'}</span></div>"
        f"<div>M.M &nbsp;: <span>{_fmt_marks(total_marks)}</span></div>"
        f"<div>Date : <span>{_h(exam_date) if exam_date else '__________'}</span></div>"
    )
    set_html = f' <span style="font-weight:400">· Set {_h(set_label)}</span>' if set_label else ""
    parts.append(
        f'<div class="k-meta"><div class="topics">{topic_html}</div>'
        f'<div class="titlebox">{_h(blueprint.title)}{set_html}{title_sub}</div>'
        f'<div class="right">{right}</div></div>'
    )
    parts.append(
        '<div class="k-body">'
        + _render_sections(
            sections, show_marks=show_marks, marks_column=False,
            inline_key=include_answer_key, boxed_heads=True,
        )
        + "</div>"
    )
    return "".join(parts)


# ---------------------------------------------------------------------------
# Print settings per theme
# ---------------------------------------------------------------------------

def page_settings(
    theme: str, *, institute_name: Optional[str], title: str, subtitle: Optional[str],
    accent: Optional[str] = None,
) -> Dict[str, Any]:
    """Playwright page.pdf() arguments that differ per theme: paper size,
    margins, and the running header/footer templates (inline styles only —
    templates render in their own document)."""
    if theme == "compact":
        band_left = " | ".join(t for t in (institute_name, subtitle) if t) or title
        band = accent or DEFAULT_ACCENT
        return {
            "format": "Letter",
            "margin": {"top": "14mm", "right": "12mm", "bottom": "16mm", "left": "12mm"},
            "header_template": (
                '<div style="width:100%;padding:0 12mm;text-align:right;font-family:Arial,sans-serif;'
                f'font-size:7pt;color:#555">{html.escape(title[:110])}</div>'
            ),
            "footer_template": (
                f'<div style="width:100%;margin:0 12mm;background:{band};color:{accent_text_color(band)};-webkit-print-color-adjust:exact;'
                'print-color-adjust:exact;padding:2mm 4mm;display:flex;justify-content:space-between;'
                'font-family:Arial,sans-serif;font-size:8.5pt;font-weight:700">'
                f"<span>{html.escape(band_left[:90])}</span>"
                '<span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>'
            ),
        }
    if theme == "coaching":
        return {
            "format": "A4",
            "margin": {"top": "10mm", "right": "10mm", "bottom": "12mm", "left": "10mm"},
            "header_template": "<span></span>",
            "footer_template": (
                '<div style="width:100%;text-align:center;font-family:Arial,sans-serif;font-size:7.5pt;color:#666">'
                'Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>'
            ),
        }
    raise ValueError(theme)


def today_label() -> str:
    return date.today().strftime("%d-%m-%Y")
