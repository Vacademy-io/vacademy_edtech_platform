"""Vsmart Extract — shared structure the model reads loosely, settled without a model.

Written against a school solution paper (2026-11-02) that came out wrong:
- Assertion–Reason questions printed their (a)–(d) list ONCE under the
  section's instructions. The model filed it as a passage, so every A–R
  question had no options and its printed answer "(b)" keyed nothing.
- Each case study printed a numbered stem ("33. … answer the following:")
  with parts numbered 1–5 again. The stem became a phantom long-answer
  question, the duplicate 1–5 numbers made section matching fall back to
  "a lower number opens the next section", and every section after the
  first was shifted by one.
- "SECTION C (Case Study) (5M)" was read as 5 marks per part: 92 against
  a printed maximum of 42.
"""
from __future__ import annotations

from app.services import question_extract_service as qe
from app.services.paper_outline import apply_outline, max_marks_of, outline_of_html

AR_LIST = (
    "<p>Instructions:</p><p>(a) Both Assertion (A) and Reason (R) are true and R explains A.</p>"
    "<p>(b) Both A and R are true but R does not explain A.</p><p>(c) A is true but R is false.</p>"
    "<p>(d) A is false but R is true.</p>"
)
CASE_TEXT = "A shop sells pencils in boxes that grow by ten every week, answer the following questions:"


def _q(no, content, *, options=4, passage=None, ans="", correct=None, marks=1.0, section=None, qtype="MCQS"):
    q = {
        "question_number": str(no),
        "question": {"type": "HTML", "content": content},
        "options": [
            {"type": "HTML", "preview_id": str(i + 1), "option_label": chr(97 + i), "content": f"opt {i + 1}"}
            for i in range(options)
        ],
        "correct_options": correct or [],
        "ans": ans,
        "exp": "",
        "question_type": qtype,
        "marks": marks,
        "negative_marks": None,
    }
    if passage is not None:
        q["passage"] = passage
    if section is not None:
        q["section"] = section
    return q


def _p(text: str) -> str:
    return f"<p>{text}</p>"


# ── case studies ─────────────────────────────────────────────────────────────

def test_case_stem_is_dropped_and_parts_are_numbered_under_it():
    case = f"<p>{CASE_TEXT}<!--DS_TAG:fig1--></p>"
    questions = [
        _q(32, "Assertion and Reason", options=0, ans="(d)"),
        # the model also pointed the stem at the passage it IS
        _q(33, CASE_TEXT + "<!--DS_TAG:fig1-->", options=0, passage=case, qtype="LONG_ANSWER", marks=5.0),
        *[_q(n, f"part {n}", passage=case, marks=5.0) for n in range(1, 4)],
    ]
    out = qe.fold_case_stems(questions, [])
    assert [q["question_number"] for q in out] == ["32", "33.1", "33.2", "33.3"]
    assert all("DS_TAG:fig1" in q["passage"] for q in out[1:])


def test_stem_listed_without_the_passage_keeps_its_figure_on_the_parts():
    case = f"<p>{CASE_TEXT}</p>"
    questions = [
        _q(34, CASE_TEXT + "<!--DS_TAG:fig9-->", options=0, qtype="LONG_ANSWER"),
        *[_q(n, f"part {n}", passage=case) for n in ("i", "ii")],
    ]
    out = qe.fold_case_stems(questions, [])
    assert [q["question_number"] for q in out] == ["34.1", "34.2"]
    assert all("DS_TAG:fig9" in q["passage"] for q in out)


def test_parts_without_a_listed_stem_take_the_number_printed_on_the_paper():
    case = f"<p>{CASE_TEXT}</p>"
    blocks = [_p("12. Which is correct?"), _p(f"13. {CASE_TEXT}"), _p("1. part one")]
    out = qe.fold_case_stems([_q(1, "part one", passage=case), _q(2, "part two", passage=case)], blocks)
    assert [q["question_number"] for q in out] == ["13.1", "13.2"]


def test_a_comprehension_numbered_with_the_paper_is_left_alone():
    """Q16–20 on one passage keep their numbers; nothing is a stem."""
    passage = "<p>" + "A long passage about rivers and the towns along them. " * 3 + "</p>"
    questions = [_q(n, f"question {n}", passage=passage) for n in range(16, 21)]
    out = qe.fold_case_stems(questions, [])
    assert [q["question_number"] for q in out] == [str(n) for n in range(16, 21)]


def test_a_real_long_answer_before_a_passage_is_not_taken_for_its_stem():
    passage = "<p>" + "The table shows rainfall in five cities over a year. " * 2 + "</p>"
    questions = [
        _q(5, "Explain the water cycle with a labelled diagram.", options=0, qtype="LONG_ANSWER"),
        _q(6, "Which city got most rain?", passage=passage),
        _q(7, "Which city got least rain?", passage=passage),
    ]
    out = qe.fold_case_stems(questions, [])
    assert [q["question_number"] for q in out] == ["5", "6", "7"]


# ── shared option lists ──────────────────────────────────────────────────────

def test_assertion_reason_list_in_the_passage_becomes_each_questions_options():
    questions = [
        _q(25, "Assertion (A): x. Reason (R): y.", options=0, passage=AR_LIST, ans="(b)"),
        _q(26, "Assertion: p. Reason: q.", options=0, passage=AR_LIST, ans="d"),
    ]
    assert qe.fill_shared_options(questions, []) == 2
    first = questions[0]
    assert [o["option_label"] for o in first["options"]] == ["a", "b", "c", "d"]
    # "Assertion (A)" inside option (a) is text, not a label
    assert first["options"][0]["content"].startswith("Both Assertion (A) and Reason (R)")
    assert first["correct_options"] == ["2"] and first["ans"] == ""
    assert questions[1]["correct_options"] == ["4"]
    assert first["passage"] is None  # it was nothing but the list


def test_list_in_the_section_instructions_is_used_when_there_is_no_passage():
    sections = [{"name": "Section B: Assertion-Reason",
                 "instruction": "Instructions: (a) Both true, R explains A. (b) Both true, R does not "
                                "explain A. (c) A true, R false (d) A false, R true."}]
    q = _q(27, "Assertion (A): m. Reason (R): n.", options=0, ans="(a)", section=sections[0]["name"])
    assert qe.fill_shared_options([q], sections) == 1
    assert len(q["options"]) == 4 and q["correct_options"] == ["1"]


def test_questions_with_options_or_without_a_choice_answer_are_untouched():
    with_options = _q(1, "Which?", ans="")
    long_answer = _q(2, "Describe photosynthesis.", options=0, qtype="LONG_ANSWER", passage=AR_LIST)
    numeric = _q(3, "Find x.", options=0, qtype="NUMERIC", ans="4", passage=AR_LIST)
    assert qe.fill_shared_options([with_options, long_answer, numeric], []) == 0
    assert long_answer["options"] == [] and numeric["options"] == []


# ── marks ────────────────────────────────────────────────────────────────────

def test_case_marks_are_spread_over_parts_when_that_meets_the_printed_maximum():
    questions = [_q(n, "mcq") for n in range(1, 5)] + [_q(f"5.{k}", "part", marks=5.0) for k in range(1, 6)]
    assert qe.settle_group_marks(questions, 9.0) == 5
    assert [q["marks"] for q in questions[4:]] == [1.0] * 5


def test_marks_stay_when_the_total_already_matches_or_the_spread_does_not():
    matching = [_q(n, "mcq") for n in range(1, 3)] + [_q(f"3.{k}", "part", marks=1.0) for k in range(1, 4)]
    assert qe.settle_group_marks(matching, 5.0) == 0
    other = [_q(f"1.{k}", "part", marks=4.0) for k in range(1, 3)]
    assert qe.settle_group_marks(other, 3.0) == 0  # 8 → 4, still not 3
    assert [q["marks"] for q in other] == [4.0, 4.0]
    assert qe.settle_group_marks(other, None) == 0


# ── outline ──────────────────────────────────────────────────────────────────

def _paper() -> str:
    return (
        _p("| Time : | 40 Minutes |") + _p("| :--- | :--- |") + _p("| M.M : | 8 |")
        + _p("SECTION - A ( MCQ's) (1M)")
        + "".join(_p(f"{n}. question {n}") + _p("(a) 1") + _p("(b) 2") for n in (1, 2))
        + _p("SECTION - B (Assertion-Reason) (1M)") + AR_LIST
        + _p("3. Assertion (A): x. Reason (R): y.") + _p("Ans. (b)")
        + _p("SECTION - C (Case Study) (5M)") + _p("Case Study - 1") + _p(f"4. {CASE_TEXT}")
        # three parts: a fifth part right after stem "4." would read as question 5
        + "".join(_p(f"{n}. part {n}") + _p("(a) 1") + _p("(b) 2") for n in range(1, 4))
    )


def test_table_front_page_gives_time_and_maximum_marks():
    outline = outline_of_html(_paper())
    assert outline["duration_minutes"] == 40
    assert outline["max_marks"] == 8.0
    assert max_marks_of("Maximum Marks: 80 Time: 3 hours") == 80.0
    assert max_marks_of("Time 10 a.m. to 1 p.m.") is None


def test_case_parts_do_not_stretch_the_section_range_and_land_in_it():
    outline = outline_of_html(_paper())
    assert [(s["name"].split(":")[0], s["from"], s["to"]) for s in outline["sections"]] == [
        ("Section A", 1, 2), ("Section B", 3, 3), ("Section C", 4, 4)]
    questions = [_q(1, "q"), _q(2, "q"), _q(3, "ar", options=0)] + [_q(f"4.{k}", "part") for k in range(1, 4)]
    apply_outline(questions, outline)
    assert [q["section"].split(":")[0] for q in questions] == ["Section A"] * 2 + ["Section B"] + ["Section C"] * 3


# ── vendor figures ───────────────────────────────────────────────────────────

def test_mathpix_figures_are_pointed_at_our_copy_and_a_failure_keeps_the_original(monkeypatch):
    from app.utils import html_images

    good = "https://cdn.mathpix.com/cropped/abc-1.jpg?height=304&amp;width=533"
    bad = "https://cdn.mathpix.com/cropped/abc-2.jpg?height=10&amp;width=10"
    seen = []

    def fake(url):
        seen.append(url)
        return "https://our-bucket.example/fig-1.jpg" if url == good else None

    monkeypatch.setattr(html_images, "_rehost_one", fake)
    html = (f'<p>Q<img alt="" src="{good}"/></p><p><img src="{good}"/></p>'
            f'<img src="{bad}"/><img src="https://example.org/keep.png"/>')
    out = html_images.rehost_vendor_images(html)
    assert out.count("https://our-bucket.example/fig-1.jpg") == 2
    assert bad in out and "https://example.org/keep.png" in out
    assert sorted(seen) == sorted([good, bad])  # each vendor URL fetched once
    assert html_images.rehost_vendor_images("<p>no figures</p>") == "<p>no figures</p>"


# ── what a model reading the paper in parts drops (aptitude mocks, 10-2026) ────

def _mcq_blocks(no, stem="Which value is right?", answer=None, solution=()):
    out = [_p(f"{no}. {stem}")] + [_p(f"{c}) {v}") for c, v in zip("ABCD", (10, 20, 30, 40))]
    if answer:
        out.append(_p(f"Ans: ({answer})"))
    out += [_p(line) for line in solution]
    return out


SOLUTION = ("APPROACH added the two shares and scaled by the total of the four bars",
            "WHY THE OTHER OPTIONS FAIL",
            "A) uses the wrong bar for the base of the percentage.",
            "D) applies the share to the whole total rather than to the advertising bar.")


def test_inline_solution_fills_an_empty_or_cut_short_explanation():
    blocks = (_mcq_blocks(1, answer="C", solution=SOLUTION) + _mcq_blocks(2, answer="B", solution=SOLUTION)
              + _mcq_blocks(3, answer="A", solution=SOLUTION))
    cut = "<p>APPROACH added the two shares and scaled by the total of the four bars</p>"
    whole = "".join(_p(x) for x in SOLUTION)
    questions = [_q(1, "Which value is right?"), _q(2, "Which value is right?"), _q(3, "Which value is right?")]
    questions[1]["exp"] = cut
    questions[2]["exp"] = whole
    assert qe.read_inline_solutions(questions, blocks) == 2
    assert "WHY THE OTHER OPTIONS FAIL" in questions[0]["exp"]
    assert "applies the share to the whole total" in questions[1]["exp"]
    assert questions[2]["exp"] == whole  # complete already: left as the model wrote it


def test_inline_solution_stops_at_the_next_set_and_skips_running_headers():
    header = _p("Sample Paper | Quantitative Ability")
    blocks = ([header] + _mcq_blocks(1, answer="C", solution=SOLUTION) + [header]
              + _mcq_blocks(2, answer="B", solution=SOLUTION) + [header]
              + _mcq_blocks(3, answer="A", solution=SOLUTION[:1]) + [header]
              + [_p("Directions (4-5): Study the table below and answer the questions.")]
              + _mcq_blocks(4) + _mcq_blocks(5))
    questions = [_q(n, "Which value is right?") for n in range(1, 6)]
    qe.read_inline_solutions(questions, blocks)
    assert "Sample Paper" not in questions[0]["exp"]
    assert "Study the table" not in questions[2]["exp"]


def test_no_solution_is_read_across_a_question_the_numbering_missed():
    long_reason = "Reason: the tangents at the two ends of a diameter of a circle are parallel to each other."
    blocks = (_mcq_blocks(1, "Assertion: x. Reason: y.", answer="a")
              + [_p("2 Assertion: the distance between two parallel tangents is 11 cm."), _p(long_reason), _p("Ans. (d)")]
              + _mcq_blocks(3, answer="b", solution=SOLUTION))
    questions = [_q(1, "Assertion: x. Reason: y."), _q(2, "Assertion: p. Reason: q."), _q(3, "q")]
    assert set(qe._starts_by_number(blocks)) == {"1", "3"}  # "2 Assertion" has no dot
    assert qe.read_inline_solutions(questions, blocks) == 1
    assert questions[0]["exp"] == "" and "WHY THE OTHER OPTIONS FAIL" in questions[2]["exp"]


DI_SET = ("<p>Directions(2-6): These questions are based on the information given below:</p>"
          "<p>A company makes five phone models; the line graph gives each price from 2000 to 2003 "
          "and the pie chart the share of sales by volume in 2000.</p><!--DS_TAG:chart1--><!--DS_TAG:chart2-->")


def test_a_dropped_set_gets_its_printed_material_back():
    blocks = _mcq_blocks(1) + [DI_SET] + sum((_mcq_blocks(n, f"set question {n}") for n in range(2, 7)), [])
    questions = [_q(1, "Which value is right?")] + [_q(n, f"set question {n}") for n in range(2, 7)]
    assert qe.restore_set_passages(questions, blocks) == 5
    assert questions[0].get("passage") is None
    assert all("DS_TAG:chart2" in q["passage"] for q in questions[1:])


def test_a_set_the_model_attached_in_the_same_part_is_its_call():
    blocks = _mcq_blocks(1) + [DI_SET] + sum((_mcq_blocks(n, f"set question {n}") for n in range(2, 7)), [])
    questions = [_q(n, f"set question {n}") for n in range(2, 7)]
    questions[0]["passage"] = DI_SET
    assert qe.restore_set_passages(questions, blocks, part_ranges=[(0, len(blocks))]) == 0
    # …but a question read in a later part never saw it
    later = next(i for i, b in enumerate(blocks) if b.startswith("<p>4."))
    assert qe.restore_set_passages(questions, blocks, part_ranges=[(0, later), (later, len(blocks))]) == 3


def test_a_one_line_direction_is_not_material():
    blocks = ([_p("Direction(1-4): In each question below some statements are followed by conclusions.")]
              + sum((_mcq_blocks(n, f"puzzle {n}") for n in range(1, 5)), []))
    questions = [_q(n, f"puzzle {n}") for n in range(1, 5)]
    assert qe.restore_set_passages(questions, blocks) == 0


def test_a_lost_figure_goes_back_after_the_text_it_was_printed_under():
    passage = "<p>The pie chart gives the share of each model in the total sales by volume for the year 2000.</p>"
    body = ["<p>Directions: study the chart.</p>", passage, "<!--DS_TAG:pie-->", "<p>1. Which model sold most?</p>"]
    cover = ["<p>Page 1</p>", "<!--DS_TAG:logo-->"]
    questions = [_q(1, "Which model sold most?", passage=passage)]
    assert qe.restore_lost_figures(questions, cover + body) == 1
    assert "DS_TAG:pie" in questions[0]["passage"] and "DS_TAG:logo" not in questions[0]["passage"]


def test_material_before_a_cut_travels_with_the_next_part():
    filler = "".join(_p("x" * 900) for _ in range(3))
    blocks = (sum((_mcq_blocks(n, "q " + "w" * 1200) for n in range(1, 13)), [])
              + [_p("&gt; Study the following pie chart carefully and answer the questions."), _p("PASSAGE / DIRECTIONS"),
                 "<!--DS_TAG:pie-->"]
              + sum((_mcq_blocks(n, "about the pie " + filler) for n in range(13, 19)), []))
    start_of = {qe._question_no(b): i for i, b in enumerate(blocks) if qe._question_no(b)}
    # a part opening one question into the set gets the chart and its intro
    carried = qe.carried_material(blocks, start_of["14"])
    assert "DS_TAG:pie" in carried and "Study the following" in carried
    # with no printed range, a set four questions in is taken to be over
    assert qe.carried_material(blocks, start_of["17"]) == ""
    # the cut never falls between the chart's intro and its first question
    intro = next(i for i, b in enumerate(blocks) if "Study the following" in b)
    assert all(not (a < intro < b <= intro + 3) for a, b in qe.chunk_ranges(blocks, material_cut=True))


def test_a_solution_paragraph_is_not_shared_material():
    solution = ["Ans: (b)", "Consider the given expression and factorise it first.", "Read the question again: x is positive."]
    blocks = (sum((_mcq_blocks(n, "q " + "w" * 1500, answer="b", solution=solution) for n in range(1, 14)), []))
    for a, _b in qe.chunk_ranges(blocks, material_cut=True)[1:]:
        assert qe._question_no(blocks[a])  # every part opens on a question, never inside a solution
        assert qe.carried_material(blocks, a) == ""


def test_short_answer_papers_get_no_explanation_copied_from_their_answer():
    blocks = [_p("1. Define photosynthesis."), _p("Ans. Photosynthesis is how green plants make food from light."),
              _p("2. Define respiration."), _p("Ans. Respiration releases energy from food in every living cell.")]
    questions = [_q(1, "Define photosynthesis.", options=0, qtype="LONG_ANSWER"),
                 _q(2, "Define respiration.", options=0, qtype="LONG_ANSWER")]
    assert qe.read_inline_solutions(questions, blocks) == 0
    assert all(q["exp"] == "" for q in questions)


def test_a_complete_explanation_is_not_extended_into_the_next_set():
    blocks = (_mcq_blocks(1, answer="b", solution=("The capital moved in 1911 and the parliament moved there.",))
              + [_p("Below is given a table showing the production of three companies over five years in thousands.")]
              + _mcq_blocks(2, "From the table, which company produced most?"))
    questions = [_q(1, "Which value is right?"), _q(2, "From the table, which company produced most?")]
    questions[0]["exp"] = "<p>The capital moved in 1911 and the parliament moved there.</p>"
    qe.read_inline_solutions(questions, blocks)
    assert "Below is given" not in questions[0]["exp"]


def test_general_instructions_are_not_a_shared_option_list():
    sections = [{"name": "SECTION A", "instruction": "(a) All questions are compulsory. (b) Only one option is correct. "
                                                    "(c) Both sections carry equal weight. (d) There is no negative marking."}]
    q = _q(3, "Which value is right?", options=0, ans="c", section="SECTION A")
    assert qe.fill_shared_options([q], sections) == 0
    assert q["options"] == [] and q["ans"] == "c"


def test_markdown_escapes_in_prose_are_undone_but_math_is_kept():
    assert qe.unescape_prose(r"Fill \_\_\_\_ in Q\#3, set \{1\} and $\{x\}$") == r"Fill ____ in Q#3, set {1} and $\{x\}$"


# ── an independent review's counter-examples (11-02): ordinary papers stay as they were ──

DS_DIRECTIONS = (
    "Directions (1-5): Each of the questions below consists of a question and two statements numbered I and II "
    "given below it. You have to decide whether the data provided in the statements are sufficient to answer the "
    "question. Read both the statements and give your answer accordingly, choosing the option that applies to "
    "each case, taking care to read every statement, and marking only one answer for each of the questions "
    "that follow in this set of five questions in the section."
)


def test_instruction_directions_in_a_restarting_paper_go_on_no_question():
    section_a = [_p("SECTION A")] + sum((_mcq_blocks(n, f"quant {n}") for n in range(1, 6)), [])
    section_b = [_p("SECTION B"), _p(DS_DIRECTIONS)] + sum((_mcq_blocks(n, f"ds {n}") for n in range(1, 6)), [])
    questions = [_q(n, f"quant {n}") for n in range(1, 6)] + [_q(n, f"ds {n}") for n in range(1, 6)]
    assert qe.restore_set_passages(questions, section_a + section_b) == 0
    assert all(not q.get("passage") for q in questions)


def test_a_comprehension_with_numbered_paragraphs_keeps_its_numbers():
    passage = ("<p>1. The monsoon arrived late in the valley that year, and the farmers waited.</p>"
               "<p>2. When the rain finally came it fell for nine days without a break.</p>")
    blocks = [_p("Read the passage and answer the questions."), passage] + sum(
        (_mcq_blocks(n, f"about the monsoon {n}") for n in range(1, 6)), [])
    questions = [_q(n, f"about the monsoon {n}", passage=passage) for n in range(1, 6)]
    out = qe.fold_case_stems(questions, blocks)
    assert [q["question_number"] for q in out] == ["1", "2", "3", "4", "5"]


def test_a_one_word_answer_letter_is_not_a_shared_option_question():
    sections = [{"name": "Grammar", "instruction": "(a) only one is true (b) both are true (c) neither is true (d) only two"}]
    q = _q(6, "He is ___ honest man.", options=0, qtype="ONE_WORD", ans="an", section="Grammar")
    q2 = _q(7, "Pick the article: ___ apple.", options=0, qtype="ONE_WORD", ans="a", section="Grammar")
    assert qe.fill_shared_options([q, q2], sections) == 0
    assert q2["question_type"] == "ONE_WORD" and q2["options"] == []
