"""Spreadsheet & Written Response (`CBE_RESPONSE`) questions, as a model reads them.

ACCA-style computer-based-exam answers are an on-screen spreadsheet (a sparse
`CbeSheet`: tabs of A1-keyed cells with value, formula and number format) or a
rich-text document, one per answer part. The contract is
docs/CBE_RESPONSE_QUESTION.md (section 2 sheet format, 3 config, 4 answer, 5.3
how the AI sees it). This module turns both the learner's answer and the
admin's solution + marking scheme into plain text, derives the grading rubric
from the marking scheme, and decides whether an answer is blank.

Spreadsheet text, row-wise, non-empty cells only, formula in brackets:

    [Part (a) — SPREADSHEET — 16 marks]
    Sheet "Sheet1"
      Row 7: A7 "Goodwill" | B7 = 3,200 [=Workings!B41]
      Row 11: B11 = 114,650 [=SUM(B7:B10)]

Never raises on bad input: malformed JSON falls back to the raw text, and an
unknown shape renders whatever is readable.
"""
from __future__ import annotations

import html as _html
import json
import math
import re
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from html.parser import HTMLParser
from typing import Any, Optional

CBE_TYPE = "CBE_RESPONSE"

# Per side (learner answer / solution) of one question. A 300 KB answer is
# roughly 6-8k cells; a real ACCA answer is a few hundred.
MAX_CELLS_PER_SIDE = 1500
MAX_CHARS_PER_SIDE = 60_000
# The scenario + requirement text Java sends as question_text.
MAX_QUESTION_CHARS = 30_000

_DASH = "—"


# ---------------------------------------------------------------------------
# Identification and parsing
# ---------------------------------------------------------------------------

def is_cbe(question: Any) -> bool:
    if not isinstance(question, dict):
        return False
    return str(question.get("question_type") or "").strip().upper() == CBE_TYPE


def parse_json(raw: Any) -> Any:
    """A dict/list as-is, a JSON string parsed, anything else None."""
    if isinstance(raw, (dict, list)):
        return raw
    if not isinstance(raw, str) or not raw.strip():
        return None
    try:
        return json.loads(raw)
    except (TypeError, ValueError):
        return None


def config_data(raw: Any) -> Optional[dict[str, Any]]:
    """The config's `data` ({version, parts, gradingNotes}) from the full
    `{type, data}` object, the data itself, or their JSON strings."""
    obj = parse_json(raw)
    if not isinstance(obj, dict):
        return None
    if isinstance(obj.get("data"), dict) and "parts" not in obj:
        obj = obj["data"]
    elif isinstance(obj.get("data"), str) and "parts" not in obj:
        inner = parse_json(obj["data"])
        if isinstance(inner, dict):
            obj = inner
    if not isinstance(obj.get("parts"), list):
        return None
    return obj


def question_config(question: dict[str, Any]) -> Optional[dict[str, Any]]:
    """The question's config: `cbe_config` (kept by the orchestrator before a
    teacher's saved model answer replaces `model_answer`), else model_answer."""
    for key in ("cbe_config", "model_answer"):
        data = config_data(question.get(key))
        if data is not None:
            return data
    return None


def answer_parts(raw: Any) -> Optional[dict[str, Any]]:
    """{part_id: {kind, sheet|html}} from `{parts}`, `{answer: {parts}}`
    (the whole responseData) or their JSON strings. None = not that shape."""
    obj = parse_json(raw)
    if not isinstance(obj, dict):
        return None
    if isinstance(obj.get("answer"), (dict, str)) and "parts" not in obj:
        inner = parse_json(obj["answer"])
        if isinstance(inner, dict):
            obj = inner
    parts = obj.get("parts")
    if isinstance(parts, dict):
        return parts
    if isinstance(parts, list):
        # Tolerate a list form [{id, kind, sheet|html}].
        out: dict[str, Any] = {}
        for i, p in enumerate(parts):
            if isinstance(p, dict):
                out[str(p.get("id") or f"part{i + 1}")] = p
        return out
    return None


def _num(value: Any, default: float = 0.0) -> float:
    if isinstance(value, bool) or value is None:
        return default
    try:
        f = float(value)
    except (TypeError, ValueError):
        m = re.search(r"-?\d+(?:\.\d+)?", str(value))
        if not m:
            return default
        f = float(m.group(0))
    return f if math.isfinite(f) else default


def _fmt_marks(x: float) -> str:
    x = round(float(x), 2)
    return str(int(x)) if x.is_integer() else f"{x:g}"


def _marks_word(x: float) -> str:
    return f"{_fmt_marks(x)} mark" + ("" if abs(float(x) - 1.0) < 1e-9 else "s")


# ---------------------------------------------------------------------------
# Number formats
# ---------------------------------------------------------------------------

def _split_sections(nf: str) -> list[str]:
    """Excel `pos;neg;zero;text` sections, ignoring ';' inside quotes."""
    out, buf, quoted, i = [], [], False, 0
    while i < len(nf):
        c = nf[i]
        if c == '"':
            quoted = not quoted
        elif c == "\\" and i + 1 < len(nf):
            buf.append(nf[i:i + 2])
            i += 2
            continue
        elif c == ";" and not quoted:
            out.append("".join(buf))
            buf = []
            i += 1
            continue
        buf.append(c)
        i += 1
    out.append("".join(buf))
    return out


def _tokens(section: str) -> list[tuple[str, str]]:
    """('lit', text) for literal text, ('fmt', char) for format characters."""
    toks: list[tuple[str, str]] = []
    i, n = 0, len(section)
    while i < n:
        c = section[i]
        if c == '"':
            j = section.find('"', i + 1)
            j = n if j == -1 else j
            toks.append(("lit", section[i + 1:j]))
            i = j + 1
        elif c == "\\" and i + 1 < n:
            toks.append(("lit", section[i + 1]))
            i += 2
        elif c == "[":
            j = section.find("]", i + 1)
            j = n if j == -1 else j
            inner = section[i + 1:j]
            if inner.startswith("$"):
                # [$£-809] / [$$-409]: the currency symbol only.
                toks.append(("lit", inner[1:].split("-", 1)[0]))
            i = j + 1
        elif c in "_*" and i + 1 < n:
            # _x = space the width of x, *x = fill with x: layout, not content.
            i += 2
        else:
            toks.append(("fmt", c))
            i += 1
    return toks


_DATE_CHARS = set("ymdhsYMDHS")


def _general(value: float) -> str:
    if float(value).is_integer() and abs(value) < 1e15:
        return str(int(value))
    text = f"{value:.10g}"
    return text


def format_value(value: Any, nf: Optional[str] = None) -> str:
    """A cell value as the learner saw it under number format `nf`
    ("#,##0", "#,##0.00", "0%", "0.0%", "#,##0;(#,##0)", "General", ...).
    Non-numbers are returned as text; an unreadable format falls back to
    General. Never raises."""
    if isinstance(value, bool):
        return "TRUE" if value else "FALSE"
    if not isinstance(value, (int, float)):
        return "" if value is None else str(value)
    v = float(value)
    if not math.isfinite(v):
        return str(value)
    try:
        return _format_number(v, nf)
    except Exception:  # noqa: BLE001 - a display nicety must never fail a grade
        return _general(v)


def _format_number(v: float, nf: Optional[str]) -> str:
    fmt = (nf or "").strip()
    if not fmt or fmt.lower() == "general" or fmt == "@":
        return _general(v)
    sections = _split_sections(fmt)
    negative_section = False
    if v < 0 and len(sections) >= 2 and sections[1].strip():
        section, negative_section = sections[1], True
    elif v == 0 and len(sections) >= 3 and sections[2].strip():
        section = sections[2]
    else:
        section = sections[0]
    toks = _tokens(section)
    fmt_chars = [t for k, t in toks if k == "fmt"]
    placeholders = [i for i, (k, t) in enumerate(toks) if k == "fmt" and t in "0#?"]
    if not placeholders:
        if any(c in _DATE_CHARS for c in fmt_chars) or "general" in section.lower():
            return _general(v)
        # A section of pure literal text (e.g. accounting zero "-").
        return "".join(t for _k, t in toks) or _general(v)
    if any(c in _DATE_CHARS or c in "eE" for c in fmt_chars):
        # Dates/times and scientific notation: the raw number reads fine.
        return _general(v)

    first, last = placeholders[0], placeholders[-1]
    # Trailing commas right after the last digit placeholder scale by 1,000 each.
    scale = 0
    j = last + 1
    while j < len(toks) and toks[j] == ("fmt", ","):
        scale += 1
        j += 1
    core = "".join(t for _k, t in toks[first:last + 1])
    prefix = "".join(t for _k, t in toks[:first])
    suffix = "".join(t for _k, t in toks[j:])
    percent = sum(1 for k, t in toks if k == "fmt" and t == "%")

    int_part, _, dec_part = core.partition(".")
    thousands = "," in int_part
    min_int = int_part.count("0")
    min_dec = dec_part.count("0")
    max_dec = sum(1 for c in dec_part if c in "0#?")

    x = abs(v) if (negative_section or v < 0) else v
    x = x * (100 ** percent) / (1000 ** scale)
    q = Decimal(1).scaleb(-max_dec) if max_dec else Decimal(1)
    try:
        d = Decimal(repr(x)).quantize(q, rounding=ROUND_HALF_UP)
    except InvalidOperation:
        return _general(v)
    text = f"{d:,.{max_dec}f}" if thousands else f"{d:.{max_dec}f}"
    if max_dec > min_dec:
        whole, _, frac = text.partition(".")
        frac = frac.rstrip("0")
        if len(frac) < min_dec:
            frac = frac + "0" * (min_dec - len(frac))
        text = whole + ("." + frac if frac else "")
    whole, dot, frac = text.partition(".")
    if min_int == 0 and whole in ("0", ""):
        whole = ""
    text = whole + dot + frac
    if not text or text == ".":
        text = "" if min_int == 0 else "0"
    sign = "-" if (v < 0 and not negative_section and d != 0) else ""
    return f"{sign}{prefix}{text}{suffix}"


# ---------------------------------------------------------------------------
# Sheets
# ---------------------------------------------------------------------------

_A1_RE = re.compile(r"^\$?([A-Za-z]{1,4})\$?(\d{1,7})$")


def _col_index(letters: str) -> int:
    n = 0
    for ch in letters.upper():
        n = n * 26 + (ord(ch) - 64)
    return n


def _ref_key(ref: str) -> tuple[int, int, str]:
    m = _A1_RE.match(ref.strip())
    if not m:
        return (10 ** 9, 10 ** 9, ref)
    return (int(m.group(2)), _col_index(m.group(1)), ref)


def _cell_dict(cell: Any) -> dict[str, Any]:
    if isinstance(cell, dict):
        return cell
    return {"v": cell}


def _cell_formula(cell: dict[str, Any]) -> Optional[str]:
    f = cell.get("f")
    if f is None or isinstance(f, bool):
        return None
    f = str(f).strip()
    if not f:
        return None
    return f if f.startswith("=") else "=" + f


def _value_empty(v: Any) -> bool:
    return v is None or (isinstance(v, str) and not v.strip())


def cell_is_empty(cell: Any) -> bool:
    c = _cell_dict(cell)
    return _value_empty(c.get("v")) and _cell_formula(c) is None


def render_cell(ref: str, cell: Any) -> Optional[str]:
    """`A7 "Goodwill"`, `B7 = 3,200 [=Workings!B41]`; None for an empty cell."""
    c = _cell_dict(cell)
    v = c.get("v")
    f = _cell_formula(c)
    if _value_empty(v) and f is None:
        return None
    style = c.get("s") if isinstance(c.get("s"), dict) else {}
    nf = style.get("nf") if isinstance(style.get("nf"), str) else None
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        shown = format_value(v, nf)
    elif isinstance(v, bool):
        shown = format_value(v)
    elif _value_empty(v):
        shown = "(no value)"
    else:
        quoted = json.dumps(str(v), ensure_ascii=False)
        if f is None:
            return f"{ref} {quoted}"
        shown = quoted
    out = f"{ref} = {shown}"
    if f is not None:
        out += f" [{f}]"
    return out


class _Budget:
    """What one side (answer or solution) may still spend."""

    def __init__(self, max_cells: int = MAX_CELLS_PER_SIDE, max_chars: int = MAX_CHARS_PER_SIDE):
        self.cells_left = max_cells
        self.chars_left = max_chars
        self.dropped_cells = 0
        self.dropped_chars = 0

    @property
    def exhausted(self) -> bool:
        return self.cells_left <= 0 or self.chars_left <= 0

    def note(self) -> str:
        bits = []
        if self.dropped_cells:
            bits.append(f"[truncated: {self.dropped_cells} more cells]")
        if self.dropped_chars:
            bits.append(f"[truncated: {self.dropped_chars} more characters]")
        return "\n".join(bits)


def _tabs(sheet: Any) -> list[dict[str, Any]]:
    obj = parse_json(sheet)
    if isinstance(obj, dict) and isinstance(obj.get("sheet"), (dict, str)) and "sheets" not in obj:
        obj = parse_json(obj["sheet"])
    if isinstance(obj, dict) and isinstance(obj.get("sheets"), list):
        return [t for t in obj["sheets"] if isinstance(t, dict)]
    if isinstance(obj, list):
        return [t for t in obj if isinstance(t, dict)]
    if isinstance(obj, dict) and isinstance(obj.get("cells"), dict):
        return [obj]
    return []


def render_sheet(sheet: Any, budget: Optional[_Budget] = None) -> str:
    """Every tab of a CbeSheet, row by row, non-empty cells only."""
    budget = budget or _Budget()
    tabs = _tabs(sheet)
    if not tabs:
        return "(empty spreadsheet)"
    lines: list[str] = []
    for i, tab in enumerate(tabs):
        name = str(tab.get("name") or f"Sheet{i + 1}")
        cells = tab.get("cells") if isinstance(tab.get("cells"), dict) else {}
        rendered: list[tuple[tuple[int, int, str], str]] = []
        for ref, cell in cells.items():
            text = render_cell(str(ref), cell)
            if text is not None:
                rendered.append((_ref_key(str(ref)), text))
        header = f'Sheet "{name}"' + ("" if rendered else " (empty)")
        lines.append(header)
        budget.chars_left -= len(header) + 1
        rendered.sort(key=lambda item: item[0])
        row_no: Optional[int] = None
        row_cells: list[str] = []

        def _flush() -> None:
            if row_cells:
                label = f"Row {row_no}" if row_no is not None and row_no < 10 ** 9 else "Other"
                lines.append(f"  {label}: " + " | ".join(row_cells))

        for (r, _c, _ref), text in rendered:
            if budget.exhausted:
                budget.dropped_cells += 1
                continue
            if r != row_no:
                _flush()
                row_no, row_cells = r, []
            row_cells.append(text)
            budget.cells_left -= 1
            budget.chars_left -= len(text) + 3
        _flush()
    return "\n".join(lines)


def sheet_has_content(sheet: Any, template: Any = None) -> bool:
    """A non-empty cell that the template did not already hold."""
    base: dict[tuple[str, str], tuple[Any, Optional[str]]] = {}
    for tab in _tabs(template):
        cells = tab.get("cells") if isinstance(tab.get("cells"), dict) else {}
        for ref, cell in cells.items():
            c = _cell_dict(cell)
            base[(str(tab.get("name") or ""), str(ref).upper())] = (c.get("v"), _cell_formula(c))
    for tab in _tabs(sheet):
        cells = tab.get("cells") if isinstance(tab.get("cells"), dict) else {}
        for ref, cell in cells.items():
            if cell_is_empty(cell):
                continue
            c = _cell_dict(cell)
            seen = base.get((str(tab.get("name") or ""), str(ref).upper()))
            if seen is None or seen != (c.get("v"), _cell_formula(c)):
                return True
    return False


# ---------------------------------------------------------------------------
# Documents (HTML)
# ---------------------------------------------------------------------------

_BLOCK_TAGS = {"p", "div", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "pre", "section", "article"}


class _HtmlText(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.out: list[str] = []
        self.lists: list[list[Any]] = []
        self.row: Optional[list[str]] = None
        self.cell: Optional[list[str]] = None
        self.skip = 0
        # True between a list marker and the item's first text: TipTap writes
        # <li><p>x</p></li>, and the <p> must not push the text off its marker.
        self.li_open = False
        # True when a block inside a list item (its <p>) has just ended the line.
        self.li_block_closed = False

    def _emit(self, s: str) -> None:
        if self.cell is not None:
            self.cell.append(" " if s.startswith("\n") else s)
        else:
            self.out.append(s)

    def _close_cell(self) -> None:
        if self.cell is not None:
            text = re.sub(r"\s+", " ", "".join(self.cell)).strip()
            if self.row is not None:
                self.row.append(text)
            else:
                self.out.append(text)
            self.cell = None

    def _close_row(self) -> None:
        self._close_cell()
        if self.row is not None:
            if any(c for c in self.row):
                self.out.append("\n| " + " | ".join(c.replace("|", "/") for c in self.row) + " |")
            self.row = None

    def handle_starttag(self, tag: str, attrs: Any) -> None:
        tag = tag.lower()
        if tag in ("script", "style"):
            self.skip += 1
        elif tag == "br":
            self._emit("\n")
        elif tag in _BLOCK_TAGS:
            if not self.li_open:
                self._emit("\n")
        elif tag in ("ul", "ol"):
            self.lists.append([tag, 0])
        elif tag == "li":
            marker = "- "
            if self.lists:
                self.lists[-1][1] += 1
                if self.lists[-1][0] == "ol":
                    marker = f"{self.lists[-1][1]}. "
            indent = "  " * max(0, len(self.lists) - 1)
            # The previous item's closing </p> already ended the line.
            lead = "" if self.cell is None and self.li_block_closed else "\n"
            self.li_block_closed = False
            self._emit(lead + indent + marker)
            self.li_open = True
        elif tag == "table":
            self._close_row()
            self.out.append("\n")
        elif tag == "tr":
            self._close_row()
            self.row = []
        elif tag in ("td", "th"):
            self._close_cell()
            if self.row is None:
                self.row = []
            self.cell = []

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if tag in ("script", "style"):
            self.skip = max(0, self.skip - 1)
        elif tag in ("td", "th"):
            self._close_cell()
        elif tag == "tr":
            self._close_row()
        elif tag == "table":
            self._close_row()
            self.out.append("\n")
        elif tag in ("ul", "ol"):
            self.li_open = False
            if self.lists:
                self.lists.pop()
            if not (self.li_block_closed and self.lists):
                # (a nested list whose last item already ended its line adds no blank line)
                self.li_block_closed = False
                self._emit("\n")
        elif tag in _BLOCK_TAGS:
            if not self.li_open:
                self._emit("\n")
                if self.lists:
                    self.li_block_closed = True

    def handle_data(self, data: str) -> None:
        if self.skip:
            return
        if self.li_open:
            if not data.strip():
                return
            data = data.lstrip()
            self.li_open = False
        if data.strip():
            self.li_block_closed = False
        self._emit(re.sub(r"\s+", " ", data))

    def text(self) -> str:
        self._close_row()
        return "".join(self.out)


_LIST_LINE = re.compile(r"^(\s*)(- |\d+\. )")


def _tidy(text: str) -> str:
    lines = []
    for line in text.replace("\xa0", " ").split("\n"):
        line = line.rstrip()
        m = _LIST_LINE.match(line)
        lines.append(line if m else line.strip())
    out = "\n".join(lines)
    out = re.sub(r"\n{3,}", "\n\n", out)
    return out.strip()


_HAS_TAG = re.compile(r"<\s*/?\s*(?:[a-zA-Z][a-zA-Z0-9-]*)(?:\s[^<>]*)?/?\s*>|<!--")


def html_to_text(raw: Any) -> str:
    """Document HTML as text: paragraphs and line breaks kept, lists as
    "- " / "1. " items, tables as `| a | b |` rows."""
    if raw is None:
        return ""
    text = str(raw)
    # Only real markup goes through the parser: plain text that merely contains "<"
    # ("cost<budget", already-decoded entities) must keep its lines and every word.
    if not _HAS_TAG.search(text):
        return _tidy(_html.unescape(text))
    try:
        parser = _HtmlText()
        parser.feed(text)
        parser.close()
        return _tidy(parser.text())
    except Exception:  # noqa: BLE001 - fall back to a blunt tag strip
        text = re.sub(r"(?i)<\s*br\s*/?\s*>", "\n", text)
        text = re.sub(r"(?i)</\s*(p|div|li|tr|h[1-6])\s*>", "\n", text)
        text = re.sub(r"<[^>]+>", " ", text)
        return _tidy(_html.unescape(text))


def _doc_html(part_answer: Any) -> Any:
    if isinstance(part_answer, dict):
        for key in ("html", "text"):
            if part_answer.get(key) is not None:
                return part_answer.get(key)
        return None
    if isinstance(part_answer, str):
        return part_answer
    return None


def _spend_text(text: str, budget: _Budget) -> str:
    if budget.chars_left <= 0:
        budget.dropped_chars += len(text)
        return ""
    if len(text) > budget.chars_left:
        keep = budget.chars_left
        budget.dropped_chars += len(text) - keep
        budget.chars_left = 0
        return text[:keep]
    budget.chars_left -= len(text)
    return text


# ---------------------------------------------------------------------------
# Whole question
# ---------------------------------------------------------------------------

def _parts(config: Optional[dict[str, Any]]) -> list[dict[str, Any]]:
    if not config:
        return []
    return [p for p in config.get("parts") or [] if isinstance(p, dict)]


def _part_label(part: dict[str, Any], index: int) -> str:
    label = str(part.get("label") or "").strip()
    return label or f"Part {index + 1}"


def _part_kind(part: dict[str, Any], part_answer: Any = None) -> str:
    kind = str(part.get("kind") or "").strip().upper()
    if kind in ("SPREADSHEET", "DOCUMENT"):
        return kind
    if isinstance(part_answer, dict):
        kind = str(part_answer.get("kind") or "").strip().upper()
        if kind in ("SPREADSHEET", "DOCUMENT"):
            return kind
        if part_answer.get("sheet") is not None:
            return "SPREADSHEET"
    return "DOCUMENT"


def _part_header(part: dict[str, Any], index: int, kind: str) -> str:
    label = _part_label(part, index)
    head = label if label.lower().startswith("part") else f"Part {label}"
    marks = _num(part.get("marks"), 0.0)
    tail = f" {_DASH} {_marks_word(marks)}" if marks > 0 else ""
    return f"[{head} {_DASH} {kind}{tail}]"


def _render_content(content: Any, kind: str, budget: _Budget) -> str:
    """One part's sheet or document (answer, solution or template)."""
    if isinstance(content, dict) and content.get("sheet") is not None:
        return render_sheet(content.get("sheet"), budget)
    html_value = _doc_html(content)
    if html_value is not None:
        text = html_to_text(html_value)
        return _spend_text(text, budget) if text else "(blank document)"
    if kind == "SPREADSHEET" and isinstance(content, dict) and isinstance(content.get("sheets"), list):
        return render_sheet(content, budget)
    return "(nothing)"


def render_parts_overview(config: Optional[dict[str, Any]]) -> str:
    """`- (a) SPREADSHEET, 16 marks: <requirement>` per part."""
    lines = []
    for i, part in enumerate(_parts(config)):
        kind = _part_kind(part)
        marks = _num(part.get("marks"), 0.0)
        bit = f"- {_part_label(part, i)} {kind}"
        if marks > 0:
            bit += f", {_marks_word(marks)}"
        prompt = html_to_text(part.get("promptHtml"))
        if prompt:
            bit += f": {prompt[:3000]}"
        lines.append(bit)
    return "\n".join(lines)


def render_answer(config: Optional[dict[str, Any]], answer_raw: Any,
                  max_cells: int = MAX_CELLS_PER_SIDE, max_chars: int = MAX_CHARS_PER_SIDE) -> str:
    """The learner's answer, part by part in the config's order. Parts the
    config does not know are rendered after them; an answer that is not the
    expected JSON is shown as its text."""
    budget = _Budget(max_cells, max_chars)
    parts_answer = answer_parts(answer_raw)
    if parts_answer is None:
        raw = answer_raw if isinstance(answer_raw, str) else (
            json.dumps(answer_raw, ensure_ascii=False) if answer_raw is not None else "")
        text = _spend_text(html_to_text(raw), budget)
        note = budget.note()
        return (text or "(no answer)") + (f"\n{note}" if note else "")
    blocks: list[str] = []
    seen: set[str] = set()
    for i, part in enumerate(_parts(config)):
        pid = str(part.get("id") or "")
        seen.add(pid)
        pa = parts_answer.get(pid)
        kind = _part_kind(part, pa)
        header = _part_header(part, i, kind)
        if pa is None:
            body = "(no answer for this part)"
        else:
            body = _render_content(pa, kind, budget)
        blocks.append(f"{header}\n{body}")
    extra = [(pid, pa) for pid, pa in parts_answer.items() if str(pid) not in seen]
    for pid, pa in extra:
        kind = _part_kind({}, pa)
        blocks.append(f"[Answer part {pid} {_DASH} {kind}]\n{_render_content(pa, kind, budget)}")
    note = budget.note()
    if note:
        blocks.append(note)
    return "\n\n".join(blocks) if blocks else "(no answer)"


def _scheme_lines(part: dict[str, Any]) -> list[dict[str, Any]]:
    scheme = part.get("markingScheme")
    if isinstance(scheme, str):
        scheme = parse_json(scheme)
    return [line for line in scheme or [] if isinstance(line, dict)] if isinstance(scheme, list) else []


def _scheme_line_text(line: dict[str, Any], index: int) -> str:
    label = str(line.get("label") or line.get("id") or f"Line {index + 1}").strip()
    bits = [f"- {label} {_DASH} {_marks_word(_num(line.get('marks'), 0.0))}"]
    if str(line.get("expected") or "").strip():
        bits.append(f"expected {str(line.get('expected')).strip()}")
    if str(line.get("cellRef") or "").strip():
        bits.append(f"at {str(line.get('cellRef')).strip()}")
    if str(line.get("guidance") or "").strip():
        bits.append(f"guidance: {str(line.get('guidance')).strip()}")
    return "; ".join(bits)


def render_solution(config: Optional[dict[str, Any]], raw_fallback: Any = None,
                    max_cells: int = MAX_CELLS_PER_SIDE, max_chars: int = MAX_CHARS_PER_SIDE) -> str:
    """Per part: the model solution and its marking-scheme lines, then the
    grading notes. A config that would not parse is shown as its raw text."""
    budget = _Budget(max_cells, max_chars)
    if config is None:
        raw = raw_fallback if isinstance(raw_fallback, str) else (
            json.dumps(raw_fallback, ensure_ascii=False) if raw_fallback is not None else "")
        text = _spend_text(raw.strip(), budget)
        note = budget.note()
        return (text or "(no model solution provided)") + (f"\n{note}" if note else "")
    blocks: list[str] = []
    for i, part in enumerate(_parts(config)):
        kind = _part_kind(part)
        lines = [_part_header(part, i, kind)]
        solution = part.get("solution")
        if isinstance(solution, str):
            solution = parse_json(solution) or {"html": solution}
        if solution:
            lines.append("Model solution:")
            lines.append(_render_content(solution, kind, budget))
        else:
            lines.append("Model solution: (none provided)")
        scheme = _scheme_lines(part)
        if scheme:
            # Never truncated: the scheme is what the marks are given against.
            lines.append("Marking scheme:")
            for k, line in enumerate(scheme):
                text = _scheme_line_text(line, k)
                budget.chars_left -= len(text) + 1
                lines.append(text)
        else:
            lines.append("Marking scheme: (none; mark the part as a whole against the model solution)")
        blocks.append("\n".join(lines))
    notes = str(config.get("gradingNotes") or "").strip()
    if notes:
        blocks.append("Examiner's grading notes:\n" + notes[:5000])
    note = budget.note()
    if note:
        blocks.append(note)
    return "\n\n".join(blocks) if blocks else "(no model solution provided)"


def answer_is_blank(question: dict[str, Any]) -> bool:
    """No part has a non-empty cell beyond its template, or non-blank text
    beyond its template: unattempted, 0 without a model call."""
    raw = question.get("student_answer")
    if raw is None or (isinstance(raw, str) and not raw.strip()):
        return True
    parts_answer = answer_parts(raw)
    if parts_answer is None:
        obj = parse_json(raw)
        if obj is None:
            return not html_to_text(raw)
        return not _has_scalar_text(obj)
    templates: dict[str, Any] = {}
    for part in _parts(question_config(question)):
        templates[str(part.get("id") or "")] = part.get("template")
    for pid, pa in parts_answer.items():
        template = templates.get(str(pid))
        if isinstance(pa, dict) and pa.get("sheet") is not None:
            tsheet = template.get("sheet") if isinstance(template, dict) else None
            if sheet_has_content(pa.get("sheet"), tsheet):
                return False
            continue
        html_value = _doc_html(pa)
        if html_value is not None:
            text = html_to_text(html_value)
            ttext = html_to_text(_doc_html(template)) if template is not None else ""
            if text and text != ttext:
                return False
            continue
        if isinstance(pa, dict) and isinstance(pa.get("sheets"), list):
            if sheet_has_content(pa):
                return False
    return True


def _has_scalar_text(obj: Any) -> bool:
    if isinstance(obj, dict):
        return any(_has_scalar_text(v) for v in obj.values())
    if isinstance(obj, list):
        return any(_has_scalar_text(v) for v in obj)
    if isinstance(obj, str):
        return bool(obj.strip())
    return obj is not None and not isinstance(obj, bool)


def answer_display_text(question: dict[str, Any], max_chars: int = 20_000) -> str:
    """The learner's answer as text, for a verdict's extracted_answer."""
    text = render_answer(question_config(question), question.get("student_answer"),
                         max_chars=max_chars)
    return text[:max_chars]


def question_text(question: dict[str, Any]) -> str:
    text = html_to_text(question.get("question_text"))
    if len(text) > MAX_QUESTION_CHARS:
        text = text[:MAX_QUESTION_CHARS] + f"\n[truncated: {len(text) - MAX_QUESTION_CHARS} more characters]"
    return text


# ---------------------------------------------------------------------------
# Rubric from the marking scheme
# ---------------------------------------------------------------------------

def _half_steps(values: list[float], target: float) -> list[float]:
    """Scale `values` to sum to `target`, each on a 0.5 grid (largest
    remainder), the sum exactly `target` when it is a multiple of 0.5."""
    total = sum(values)
    if total <= 0 or not values:
        return list(values)
    scaled = [v * target / total for v in values]
    units = int(round(target * 2))
    floors = [math.floor(s * 2 + 1e-9) for s in scaled]
    rest = units - sum(floors)
    order = sorted(range(len(values)), key=lambda i: (scaled[i] * 2 - floors[i]), reverse=True)
    k = 0
    while rest > 0 and order:
        floors[order[k % len(order)]] += 1
        rest -= 1
        k += 1
    out = [f / 2.0 for f in floors]
    drift = round(target - sum(out), 4)
    if abs(drift) > 1e-9:
        biggest = max(range(len(out)), key=lambda i: out[i])
        out[biggest] = round(out[biggest] + drift, 2)
    return out


CBE_RUBRIC_INSTRUCTIONS = (
    "One criterion per marking-scheme line. Award each line when the figure or point is correct, "
    "or when it follows correctly from the candidate's own earlier figure (own-figure rule). "
    "Accept equivalent presentation and rounding of +/-1 in the last unit shown. "
    "Mark every criterion independently: a candidate's overall performance, or the quality of another "
    "part, never raises or lowers a part's marks. The only cross-part link is the own-figure rule: a part "
    "that correctly uses the candidate's own earlier figure still earns its marks. "
    "A whole-part criterion is marked per key point of the model solution; a relevant point not in the "
    "model solution, correctly applied to the scenario, earns a share in place of a missed key point, up "
    "to the part's maximum. Its reason names the key points made and missed."
)


def derive_rubric(config: Optional[dict[str, Any]], max_marks: float) -> dict[str, Any]:
    """The rubric for a CBE question from its marking scheme: one criterion per
    line ("<part label> <line label>", max = line marks), one criterion worth
    the part's marks for a part without a scheme. Marks are scaled (0.5 steps)
    so the criteria add up to `max_marks`. No model call; never persisted."""
    max_marks = float(max_marks or 0)
    items: list[dict[str, Any]] = []
    raw_marks: list[float] = []
    for i, part in enumerate(_parts(config)):
        label = _part_label(part, i)
        part_marks = _num(part.get("marks"), 0.0)
        lines = [ln for ln in _scheme_lines(part) if _num(ln.get("marks"), 0.0) > 0]
        if lines:
            line_marks = [_num(ln.get("marks"), 0.0) for ln in lines]
            if part_marks > 0 and abs(sum(line_marks) - part_marks) > 0.01:
                line_marks = [m * part_marks / sum(line_marks) for m in line_marks]
            for k, (line, marks) in enumerate(zip(lines, line_marks)):
                name = str(line.get("label") or line.get("id") or f"line {k + 1}").strip()
                guide = []
                if str(line.get("expected") or "").strip():
                    guide.append(f"Expected: {str(line.get('expected')).strip()}")
                if str(line.get("cellRef") or "").strip():
                    guide.append(f"Where: {str(line.get('cellRef')).strip()}")
                if str(line.get("guidance") or "").strip():
                    guide.append(f"Guidance: {str(line.get('guidance')).strip()}")
                guide.append("Own-figure (follow-through) credit applies.")
                items.append({
                    "criteria_name": f"{label} {name}".strip(),
                    "max_marks": marks,
                    "keywords": [],
                    "evaluation_guidelines": "; ".join(guide),
                })
                raw_marks.append(marks)
        elif part_marks > 0:
            if _part_kind(part) == "DOCUMENT":
                guideline = (
                    f"No line-by-line scheme: award the marks for {label} per key point of the model "
                    "solution that the candidate makes correctly and applies to the scenario (marks shared "
                    "equally between the points unless the solution weights them). A relevant point not in "
                    "the model solution, correctly applied to the scenario, earns a share in place of a "
                    "missed key point, up to the part's maximum. In this criterion's reason, state which "
                    "key points were made and which were missed.")
            else:
                guideline = (
                    f"No line-by-line scheme: mark {label} as a whole against the model solution, "
                    "giving credit for each correct figure or relevant point.")
            items.append({
                "criteria_name": f"{label} (whole part)",
                "max_marks": part_marks,
                "keywords": [],
                "evaluation_guidelines": (
                    f"{guideline} The quality of other parts never raises or lowers the marks for "
                    f"{label}. The only cross-part link is the own-figure rule: if {label} correctly uses "
                    "the candidate's own earlier figure, it still earns its marks."),
            })
            raw_marks.append(part_marks)
    if max_marks <= 0:
        max_marks = sum(raw_marks)
    if not items or max_marks <= 0:
        return {
            "max_marks": max_marks or 0.0,
            "partial_marking_enabled": True,
            "evaluation_instructions": "Award marks based on correctness and completeness against the model solution.",
            "rubric": [{
                "criteria_name": "Correctness",
                "max_marks": max_marks or 0.0,
                "keywords": [],
                "evaluation_guidelines": "Award proportional to how correct and complete the answer is.",
            }],
        }
    # Unique names: the breakdown is matched back by name.
    seen: dict[str, int] = {}
    for it in items:
        key = it["criteria_name"].lower()
        seen[key] = seen.get(key, 0) + 1
        if seen[key] > 1:
            it["criteria_name"] = f"{it['criteria_name']} ({seen[key]})"
    for it, marks in zip(items, _half_steps(raw_marks, max_marks)):
        it["max_marks"] = marks
    return {
        "max_marks": max_marks,
        "partial_marking_enabled": True,
        "evaluation_instructions": CBE_RUBRIC_INSTRUCTIONS,
        "rubric": items,
    }


def reconcile_breakdown(verdict: dict[str, Any]) -> dict[str, Any]:
    """Put each criterion's mark on the 0.5 grid, within its maximum (`max`,
    from validator.attach_criteria_max), summing to marks_awarded. The
    validator's proportional rescale can leave 1.33-style figures; an examiner
    never writes those beside a marking-scheme line. Left unchanged when it
    cannot be reconciled. In place; returns verdict."""
    try:
        breakdown = [c for c in verdict.get("criteria_breakdown") or [] if isinstance(c, dict)]
        if not breakdown:
            return verdict
        awarded = float(verdict.get("marks_awarded") or 0)
        units = int(round(awarded * 2))
        if abs(units / 2.0 - awarded) > 1e-6:
            return verdict
        caps = []
        for c in breakdown:
            mx = c.get("max")
            caps.append(int(math.floor(float(mx) * 2 + 1e-9)) if isinstance(mx, (int, float)) else None)
        marks = [max(0.0, float(c.get("marks") or 0)) for c in breakdown]
        halves = [math.floor(m * 2 + 1e-9) for m in marks]
        halves = [min(h, cap) if cap is not None else h for h, cap in zip(halves, caps)]
        rest = units - sum(halves)
        order = sorted(range(len(marks)), key=lambda i: marks[i] * 2 - math.floor(marks[i] * 2 + 1e-9),
                       reverse=True)
        guard = 0
        while rest != 0 and guard < 10_000:
            guard += 1
            moved = False
            for i in order:
                if rest > 0 and (caps[i] is None or halves[i] < caps[i]):
                    halves[i] += 1
                    rest -= 1
                    moved = True
                elif rest < 0 and halves[i] > 0:
                    halves[i] -= 1
                    rest += 1
                    moved = True
                if rest == 0:
                    break
            if not moved:
                return verdict
        for c, h in zip(breakdown, halves):
            c["marks"] = h / 2.0
    except Exception:  # noqa: BLE001 - cosmetic; the headline mark stands
        return verdict
    return verdict
