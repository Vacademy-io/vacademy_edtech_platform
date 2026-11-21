"""Put a Word paper's own question numbers back after MathPix renumbers them.

MathPix converts a .docx to Markdown, and a typed "1." line inside a
question (the statements of "which statement does not belong") becomes an
item of the ordered list the question itself opened. Markdown numbers a
list by position, so in a 60-question mock the statements under Q13
came back as 14–17 and the paper's Q14 and Q15 as 18 and 19 — the
extraction then read 64 questions out of 60, and the section counts slid.

The .docx still has the numbers as printed. Each numbered line MathPix
returns is matched, in order, to the line of the document with the same
words after the number, and takes that line's number. A line with no match
(maths MathPix rewrote as LaTeX, a figure caption) keeps its number.
"""
from __future__ import annotations

import html as htmlmod
import io
import re
import zipfile
from typing import List, Optional, Sequence, Tuple
from xml.etree import ElementTree

_W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"

# A printed line that opens with its number: "13. Direction…", "1) It does…",
# "Q14. Fill…".
_PRINTED_NO = re.compile(r"^\s*(?:q\.?\s*)?\(?(\d{1,3})[.)]\s*(.*)$", re.I | re.S)
# A numbered line of md_to_html output: <div class="question">13. …</div>.
_HTML_NO = re.compile(r'(<div class="question">\s*)(\d{1,3})(\.)(.*?)(</div>)', re.S)
_TAG = re.compile(r"<[^>]+>")
# Characters compared: the words survive MathPix ("\&", "\_\_\_", curly
# quotes, extra spaces); the punctuation around them does not.
_NOT_WORD = re.compile(r"[^a-z0-9]+")
KEY_CHARS = 40
# Shorter lines ("Find the value") are too generic to tell one question from
# another; they keep MathPix's number.
MIN_KEY_CHARS = 20
# An uploaded file is untrusted: a document.xml bigger than any paper (a zip
# bomb) or one declaring entities is not read.
MAX_XML_BYTES = 40 * 1024 * 1024


def is_docx(data: bytes) -> bool:
    if not data or data[:2] != b"PK":
        return False
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            return "word/document.xml" in z.namelist()
    except Exception:  # noqa: BLE001 — not a readable zip: not a .docx
        return False


def _key(text: str) -> str:
    text = htmlmod.unescape(_TAG.sub(" ", text)).replace("\\", "")
    return _NOT_WORD.sub("", text.lower())[:KEY_CHARS]


def _paragraph_lines(paragraph) -> List[str]:
    """A paragraph's text split at its line breaks — a question and the
    statements typed under it are often one paragraph with <w:br/>s."""
    lines, current = [], []
    for node in paragraph.iter():
        if node.tag == _W + "t" and node.text:
            current.append(node.text)
        elif node.tag == _W + "tab":
            current.append(" ")
        elif node.tag in (_W + "br", _W + "cr"):
            lines.append("".join(current))
            current = []
    lines.append("".join(current))
    return lines


def printed_numbers(data: bytes) -> List[Tuple[str, str]]:
    """(number, key) for every line of the document that opens with a
    number, in document order."""
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        if z.getinfo("word/document.xml").file_size > MAX_XML_BYTES:
            return []
        xml = z.read("word/document.xml")
    if b"<!DOCTYPE" in xml[:4096] or b"<!ENTITY" in xml[:4096]:
        return []
    root = ElementTree.fromstring(xml)
    out: List[Tuple[str, str]] = []
    for paragraph in root.iter(_W + "p"):
        for line in _paragraph_lines(paragraph):
            m = _PRINTED_NO.match(line)
            if m:
                out.append((str(int(m.group(1))), _key(m.group(2))))
    return out


def _same(a: str, b: str) -> bool:
    n = min(len(a), len(b))
    return n >= MIN_KEY_CHARS and a[:n] == b[:n]


def restore_numbers(html: str, printed: Sequence[Tuple[str, str]]) -> Tuple[str, int]:
    """`html` with every numbered line carrying the number the document
    prints for it. Matching walks forward through the document, so a line
    repeated later (a question restated in the solutions) is never taken
    for an earlier one. Returns (html, how many numbers changed)."""
    if not printed:
        return html, 0
    cursor = 0
    changed = 0

    def fix(m: "re.Match[str]") -> str:
        nonlocal cursor, changed
        key = _key(m.group(4))
        hit: Optional[int] = next(
            (j for j in range(cursor, len(printed)) if _same(key, printed[j][1])), None
        )
        if hit is None:
            return m.group(0)
        cursor = hit + 1
        number = printed[hit][0]
        if number == m.group(2):
            return m.group(0)
        changed += 1
        return f"{m.group(1)}{number}{m.group(3)}{m.group(4)}{m.group(5)}"

    return _HTML_NO.sub(fix, html), changed


__all__ = ["is_docx", "printed_numbers", "restore_numbers"]
