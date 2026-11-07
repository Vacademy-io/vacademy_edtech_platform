"""md_to_html: a multi-line display equation stays one math block."""
from __future__ import annotations

from app.services import question_extract_service as qe
from app.services.md_to_html import convert_markdown_to_html


def _body(md: str) -> str:
    return convert_markdown_to_html(md).split("<body>", 1)[1].split("</body>", 1)[0].strip()


# MathPix's Markdown for a Word equation of several rows (a worked solution).
_ALIGNED = "\n".join([
    "Q31. (a)",
    "Sum of ages of all workers $=50(\\mathrm{~m}+\\mathrm{f})$ years",
    "$$",
    "\\begin{aligned}",
    "& \\text { So, } 52 \\mathrm{~m}+42 \\mathrm{f}=50(\\mathrm{~m}+\\mathrm{f}) \\\\",
    "& \\qquad \\Rightarrow \\text { Or, } \\mathrm{m}=4 \\mathrm{f}",
    "\\end{aligned}",
    "$$",
    "Let the total number of workers be 100.",
])


def test_multi_line_dollar_block_is_one_math_block():
    body = _body(_ALIGNED)
    assert body.count('<div class="math-block">') == 1
    assert "<p>\\begin{aligned}</p>" not in body
    assert "<p>\\end{aligned}</p>" not in body
    block = body.split('<div class="math-block">', 1)[1].split("</div>", 1)[0]
    assert block.startswith("$$\n\\begin{aligned}")
    assert block.endswith("\\end{aligned}\n$$")
    assert "<p>Let the total number of workers be 100.</p>" in body


def test_extraction_keeps_the_equation_in_one_block():
    blocks = qe.split_blocks(_body(_ALIGNED))
    math = [b for b in blocks if "aligned" in b]
    assert len(math) == 1
    assert math[0].count("$$") == 2


def test_multi_line_bracket_block_is_one_math_block():
    body = _body("Solve:\n\\[\n\\begin{gathered}\nx+y=2 \\\\\nx-y=0\n\\end{gathered}\n\\]\nDone.")
    assert body.count('<div class="math-block">') == 1
    assert "\\[\n\\begin{gathered}" in body and "\\end{gathered}\n\\]" in body
    assert "<p>Done.</p>" in body


def test_blank_lines_inside_the_block_are_dropped():
    body = _body("$$\n\n\\begin{aligned}\na=1\n\n\\end{aligned}\n$$")
    assert '<div class="math-block">$$\n\\begin{aligned}\na=1\n\\end{aligned}\n$$</div>' in body


def test_single_line_display_math_unchanged():
    assert '<div class="math-block">$$x^2+1$$</div>' in _body("$$x^2+1$$")
    assert '<div class="math-block">$$a$$ and $$b$$</div>' in _body("$$a$$ and $$b$$")
    assert "<p>\\[x=1\\]</p>" in _body("\\[x=1\\]")


def test_unclosed_block_falls_back_to_line_by_line():
    body = _body("$$\n\\begin{aligned}\na=1")
    assert '<div class="math-block">$$</div>' in body
    assert "<p>\\begin{aligned}</p>" in body
    assert "<p>a=1</p>" in body


# A "<" inside math ("3<x") must not open a tag once the page is parsed as
# HTML (extract_body): it swallowed the block's closing tag and the rest of
# the solution.
_CASES = "\n".join([
    "Q50. (a)",
    "$$",
    "g(x)= \\begin{cases}k \\sqrt{x+1}, & 0 \\leq x \\leq 3 \\\\ m x+2, & 3<x \\leq 5\\end{cases}",
    "$$",
    "R.H.D.",
])


def test_less_than_inside_a_math_block_survives_the_html_parser():
    from bs4 import BeautifulSoup

    from app.utils.html_images import extract_body

    body = extract_body(convert_markdown_to_html(_CASES))
    soup = BeautifulSoup(body, "html.parser")
    blocks = soup.select("div.math-block")
    assert len(blocks) == 1
    assert "3<x \\leq 5\\end{cases}" in blocks[0].get_text()
    assert blocks[0].get_text().strip().endswith("$$")
    assert soup.find("x") is None
    assert [p.get_text() for p in soup.find_all("p")] == ["Q50. (a)", "R.H.D."]


def test_less_than_inside_inline_math_is_escaped_prose_is_not():
    body = _body("If $3<\\mathrm{x}$ and a <b>bold</b> word")
    assert "$3&lt;\\mathrm{x}$" in body
    assert "<b>bold</b>" in body


def test_ampersand_inside_math_is_left_to_the_parser():
    body = _body("$$\n\\begin{aligned}\n& a=1 \\\\\n& b=2\n\\end{aligned}\n$$")
    assert "& a=1" in body and "&amp;" not in body


def test_line_break_between_two_dollar_amounts_stays_a_break():
    body = _body("Pay $5 <br> or $6 later")
    assert "$5 <br> or $6" in body
