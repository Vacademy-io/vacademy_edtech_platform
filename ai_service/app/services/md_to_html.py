"""Markdown→HTML converter — port of media_service util MdToHtmlConverter.

Converts MathPix OCR-style Markdown (with LaTeX) into an HTML document with a
MathJax head. Deliberately a simple line-by-line converter (NOT a generic
markdown library), matching the Java behavior exactly: headers, $$ blocks,
numbered "question" lines, and paragraphs; inline image + bold handling; $ math
left untouched for MathJax.
"""
from __future__ import annotations

import re

_HEAD = (
    '<!DOCTYPE html>\n<html lang="en">\n<head>\n'
    '<meta charset="UTF-8">\n'
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">\n'
    "<title>Converted Document</title>\n"
    "<style>\n"
    "  body { font-family: sans-serif; line-height: 1.6; max-width: 800px; margin: 20px auto; padding: 20px; color: #333; }\n"
    "  img { max-width: 100%; height: auto; display: block; margin: 20px auto; border: 1px solid #ddd; }\n"
    "  h2 { border-bottom: 2px solid #eee; padding-bottom: 10px; margin-top: 30px; }\n"
    "  .question { margin-bottom: 15px; }\n"
    "  .math-block { overflow-x: auto; margin: 10px 0; }\n"
    "</style>\n"
    "<script>\n"
    "  window.MathJax = {\n"
    "    tex: {\n"
    "      inlineMath: [['$', '$'], ['\\\\(', '\\\\)']],\n"
    "      displayMath: [['$$', '$$'], ['\\\\[', '\\\\]']]\n"
    "    }\n"
    "  };\n"
    "</script>\n"
    '<script id="MathJax-script" async src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-mml-chtml.js"></script>\n'
    "</head>\n<body>\n\n"
)

_NUMBERED_RE = re.compile(r"^\d+\..*")
# MathPix joins a Word heading's lines with a literal "<br>" ("TEST - 03 <br>
# SECTION A: …"); each line is a heading of its own, or the section heading
# hides behind the paper's title. A bare label line ("Section A <br>
# THERMODYNAMICS") is joined to the name under it instead.
_HEADING_BREAK_RE = re.compile(r"\s*<br\s*/?>\s*", re.I)
_BARE_LABEL_RE = re.compile(r"^(?:section|part|unit)\s*[-–:]?\s*[A-Za-z0-9]{1,4}\s*[:.\-–]?$", re.I)


def _heading_lines(title: str) -> list[str]:
    lines: list[str] = []
    for part in _HEADING_BREAK_RE.split(title):
        if not part:
            continue
        if lines and _BARE_LABEL_RE.match(lines[-1]):
            lines[-1] = f"{lines[-1].rstrip(' :.-–')}: {part}"
        else:
            lines.append(part)
    return lines


_IMG_RE = re.compile(r"!\s?\[(.*?)\]\((.*?)\)")
_BOLD_RE = re.compile(r"\*\*(.*?)\*\*")


def _escape_html(s: str) -> str:
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


# "$…$", "$$…$$", "\(…\)", "\[…\]" — escaped dollars ("\$5") open nothing.
_MATH_SPAN_RE = re.compile(r"\$\$.*?\$\$|\$[^$]*\$|\\\(.*?\\\)|\\\[.*?\\\]", re.S)
_MATH_LT_RE = re.compile(r"<(?!/?br\s*/?>)", re.I)


def _escape_math(text: str) -> str:
    """Escape "<" inside math spans. The page is parsed as HTML later
    (extract_body), and a raw "3<x" in "\\begin{cases} … 3<x \\leq 5" opened
    a tag that swallowed the rest of the block. The renderer reads the
    formula from text, which decodes "&lt;" back. "&" is left alone: the
    parser already writes a bare one as "&amp;", and an entity MathPix wrote
    itself must not be escaped twice. A "<br>" MathPix put on the line stays
    a line break, even between two "$" amounts."""
    if "<" not in text:
        return text
    masked = text.replace("\\$", "\x00")
    out = _MATH_SPAN_RE.sub(lambda m: _MATH_LT_RE.sub("&lt;", m.group(0)), masked)
    return out.replace("\x00", "\\$")


def _parse_inline(text: str) -> str:
    text = _IMG_RE.sub(r'<img src="\2" alt="\1" />', text)
    text = _BOLD_RE.sub(r"<strong>\1</strong>", text)
    return text


def _display_math_end(lines: list[str], start: int) -> int | None:
    """Index of the line that closes the display math opened at `start`, when
    it does not close on its own line. MathPix writes a multi-line equation
    ("\\begin{aligned} … \\end{aligned}") as "$$" / rows / "$$"; read line by
    line, each row became a paragraph of raw LaTeX and the "$$" pair, split
    across blocks, rendered nothing."""
    line = lines[start]
    if line.startswith("$$"):
        if line.count("$$") % 2 == 0:
            return None
        close = "$$"
    elif line.startswith("\\[") and "\\]" not in line:
        close = "\\]"
    else:
        return None
    for j in range(start + 1, len(lines)):
        if close in lines[j]:
            return j
    return None


def convert_markdown_to_html(markdown_text: str | None) -> str:
    if markdown_text is None:
        return ""
    html = [_HEAD]
    lines = [raw_line.strip() for raw_line in markdown_text.splitlines()]
    i = 0
    while i < len(lines):
        line = lines[i]
        i += 1
        if not line:
            continue
        end = _display_math_end(lines, i - 1)
        if end is not None:
            body = "\n".join(l for l in lines[i - 1:end + 1] if l)
            html.append(f'<div class="math-block">{_escape_math(body)}</div>\n')
            i = end + 1
            continue
        if line.startswith("##"):
            title = re.sub(r"^#+\s*", "", line)
            for part in _heading_lines(title):
                html.append(f"<h2>{_escape_html(part)}</h2>\n")
        elif line.startswith("$$"):
            html.append(f'<div class="math-block">{_escape_math(line)}</div>\n')
        elif _NUMBERED_RE.match(line):
            html.append(f'<div class="question">{_parse_inline(_escape_math(line))}</div>\n')
        else:
            html.append(f"<p>{_parse_inline(_escape_math(line))}</p>\n")
    html.append("\n</body>\n</html>")
    return "".join(html)
