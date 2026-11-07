"""docx_numbering: a Word paper's printed question numbers survive MathPix."""
from __future__ import annotations

import io
import zipfile

from app.services import question_extract_service as qe
from app.services.docx_numbering import is_docx, printed_numbers, restore_numbers
from app.services.md_to_html import convert_markdown_to_html
from app.services.paper_outline import outline_of_html

_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'


def _docx(paragraphs) -> bytes:
    """A minimal .docx; each paragraph is a list of lines joined by <w:br/>."""
    body = "".join(
        "<w:p><w:r>" + "<w:br/>".join(f"<w:t>{line}</w:t>" for line in lines) + "</w:r></w:p>"
        for lines in paragraphs
    )
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("word/document.xml", f"<w:document {_NS}><w:body>{body}</w:body></w:document>")
    return buf.getvalue()


# A 60-question mock: Q13 types its four statements under it as "1." – "4."
# in the same paragraph; MathPix continues Q13's list, so they come back as
# 14–17 and the paper's Q14, Q15 as 18, 19.
_LEAD = [f"{n}. Question {n} of the reading comprehension passage set" for n in range(1, 13)]
_PAPER = _docx(
    [["SECTION A: VERBAL ABILITY &amp; READING COMPREHENSION (Q1 – Q15)"]]
    + [[line] for line in _LEAD]
    + [
        ["13. Direction: Identify the sentence that is not part of the paragraph.",
         "1. It does not hurt my pride to acknowledge the mission of the West.",
         "2. I have known that they seek the same God, who is my God.",
         "3. I have been fortunate in coming into close touch with individual men.",
         "4. The world today is offered to the West; she will destroy it."],
        ["(a) Statement 1"],
        ["14. Direction: Fill in the blanks with the most appropriate word."],
        ["15. Direction: Identify the sentences that are correct in grammar and usage."],
    ]
)

_OPTIONS = "(a) one\n(b) two\n(c) three\n(d) four\n"
_MATHPIX = (
    "## MOCK ADMISSION TEST - 03 <br> SECTION A: VERBAL ABILITY \\& READING COMPREHENSION (Q1 - Q15)\n"
    + "".join(f"{line}\n{_OPTIONS}" for line in _LEAD)
    + "13. Direction: Identify the sentence that is not part of the paragraph.\n"
    "14. It does not hurt my pride to acknowledge the mission of the West.\n"
    "15. I have known that they seek the same God, who is my God.\n"
    "16. I have been fortunate in coming into close touch with individual men.\n"
    "17. The world today is offered to the West; she will destroy it.\n"
    "(a) Statement 1\n(b) Statement 2\n(c) Statement 3\n(d) Statement 4\n"
    "18. Direction: Fill in the blanks with the most appropriate word.\n" + _OPTIONS
    + "19. Direction: Identify the sentences that are correct in grammar and usage.\n" + _OPTIONS
)
_UPTO = [str(n) for n in range(1, 13)]


def _numbers(html: str):
    blocks = qe.split_blocks(html)
    return [qe._question_no(b) for b, start in zip(blocks, qe.question_starts(blocks)) if start]


def test_is_docx():
    assert is_docx(_PAPER)
    assert not is_docx(b"%PDF-1.7")
    assert not is_docx(b"PK\x03\x04 not a zip")


def test_printed_numbers_split_a_paragraph_at_its_line_breaks():
    assert [no for no, _ in printed_numbers(_PAPER)] == [*_UPTO, "13", "1", "2", "3", "4", "14", "15"]


def test_renumbered_statements_get_their_printed_numbers_back():
    html = convert_markdown_to_html(_MATHPIX)
    assert _numbers(html) == [*_UPTO, "13", "14", "15", "16", "17", "18", "19"]

    restored, changed = restore_numbers(html, printed_numbers(_PAPER))

    assert changed == 6
    assert '<div class="question">1. It does not hurt' in restored
    assert '<div class="question">14. Direction: Fill' in restored
    # The statements are Q13's own list again: fifteen questions, not nineteen.
    assert _numbers(restored) == [*_UPTO, "13", "14", "15"]


def test_a_line_the_document_does_not_print_keeps_its_number():
    html = '<div class="question">7. $\\frac{a}{b}$ is equal to</div>'
    assert restore_numbers(html, printed_numbers(_PAPER)) == (html, 0)


def test_a_heading_broken_over_two_lines_is_two_headings():
    html = convert_markdown_to_html(_MATHPIX)
    assert "<h2>MOCK ADMISSION TEST - 03</h2>" in html
    assert "<h2>SECTION A: VERBAL ABILITY \\&amp; READING COMPREHENSION (Q1 - Q15)</h2>" in html


def test_section_behind_the_title_is_found_and_its_name_unescaped():
    markdown = _MATHPIX + "## SECTION B: LOGICAL REASONING (Q16 - Q16)\n16. Seven people stand in a row.\n" + _OPTIONS
    html, _ = restore_numbers(convert_markdown_to_html(markdown), printed_numbers(_PAPER))
    sections = outline_of_html(html)["sections"]
    assert [(s["from"], s["to"], s["count"]) for s in sections] == [(1, 15, 15), (16, 16, 1)]
    assert "&" in sections[0]["name"] and "\\" not in sections[0]["name"] and "amp;" not in sections[0]["name"]


def test_a_bare_label_over_its_name_stays_one_heading():
    """A chemistry mock: "Section A <br> THERMODYNAMICS" names Section A."""
    html = convert_markdown_to_html("## Section A <br> THERMODYNAMICS\n## Plain heading\n")
    assert "<h2>Section A: THERMODYNAMICS</h2>" in html
    assert "<h2>Plain heading</h2>" in html
    assert "br" not in html.split("<body>")[1]
