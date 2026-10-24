"""paper_outline: the sections and marking a paper prints, read without a model."""
from __future__ import annotations

from app.services import question_extract_service as qe
from app.services.paper_outline import apply_outline, duration_of, marking_of, outline_of_html


def _p(text: str) -> str:
    return f"<p>{text}</p>"


def _mcq(no: int, text: str = "q") -> str:
    return _p(f"{no}. {text}") + _p("(a) 1 (b) 2 (c) 3 (d) 4")


def _names(outline):
    return [(s["name"], s["from"], s["to"]) for s in outline["sections"]]


# ── sections ─────────────────────────────────────────────────────────────────

def test_front_page_table_of_ranges_names_the_sections():
    """IPMAT: the table on page 1 is read cell by cell by the text layer, and
    the "1–15" cell must not be taken for question 1."""
    html = (
        _p("IPMAT Mock Test 2") + _p("S E C T I O N") + _p("Q U E S T I O N S") + _p("T I M E")
        + _p("English Comprehension") + _p("1–15") + _p("30 minutes")
        + _p("Logical Reasoning") + _p("16–30") + _p("30 minutes")
        + _p("Quantitative Ability and Data Interpretation") + _p("31–60") + _p("60 minutes")
        + _p("Marking · +3 for a correct answer, −1 for an incorrect answer, 0 if unattempted")
        + _p("Instructions to Candidates") + _p("1.") + _p("The paper carries 60 questions.")
        + _p("2.") + _p("Each section is separately timed.")
        + "".join(_mcq(i) for i in range(1, 61))
    )
    o = outline_of_html(html)
    assert o["question_count"] == 60
    assert _names(o) == [
        ("English Comprehension", 1, 15), ("Logical Reasoning", 16, 30),
        ("Quantitative Ability and Data Interpretation", 31, 60),
    ]
    assert [s["source"] for s in o["sections"]] == ["table"] * 3
    assert o["marking"] == {"marks": 3.0, "negative_marks": 1.0}
    assert all(s["marks"] == 3.0 and s["negative_marks"] == 1.0 for s in o["sections"])
    # Each section's time from its table row; the paper's is their sum.
    assert [s["duration_minutes"] for s in o["sections"]] == [30, 30, 60]
    assert o["duration_minutes"] == 120


def test_body_headings_with_marks_from_the_general_instructions():
    """CBSE: numbered general instructions are not questions; "Section B has
    5 questions carrying 02 marks each" gives Section B its marks; a mark
    printed at the question ("[2]") is kept as it is."""
    html = (
        _p("Time allowed: 3 hours") + _p("Maximum Marks: 80")
        + _p("General Instructions:")
        + _p("1. This question paper has 3 sections A-C.")
        + _p("2. Section A has 2 MCQs carrying 1 mark each.")
        + _p("3. Section B has 2 questions carrying 02 marks each.")
        + _p("4. Section C has 1 question carrying 05 marks each.")
        + _p("SECTION A") + _p("Section A consists of 2 questions of 1 mark each.")
        + _mcq(1) + _mcq(2)
        + _p("SECTION – B") + _p("3. Prove that root 2 is irrational. [2]") + _p("4. Find the zeroes.")
        + _p("Section C (Long answer)") + _p("5. Solve the pair of equations.")
        + _p("ANSWER KEY") + _p("1. c 2. c")
    )
    o = outline_of_html(html)
    assert o["question_count"] == 5
    assert _names(o) == [("Section A", 1, 2), ("Section B", 3, 4), ("Section C: Long answer", 5, 5)]
    assert o["duration_minutes"] == 180 and all(s["duration_minutes"] is None for s in o["sections"])
    assert [s["marks"] for s in o["sections"]] == [1.0, 2.0, 5.0]
    qs = [{"question_number": str(i), "question": {"content": "x"}} for i in range(1, 6)]
    qs[2]["marks"] = 3  # the model read "[3]" at Q3: printed at the question wins
    apply_outline(qs, o)
    assert [(q["section"], q["marks"]) for q in qs] == [
        ("Section A", 1.0), ("Section A", 1.0), ("Section B", 3.0), ("Section B", 2.0), ("Section C: Long answer", 5.0),
    ]


def test_a_section_may_restart_numbering_from_one():
    html = _p("PART A") + _mcq(1) + _mcq(2) + _mcq(3) + _p("PART B") + _mcq(1) + _mcq(2)
    o = outline_of_html(html)
    assert o["question_count"] == 5  # every section counts, whatever its numbering
    assert _names(o) == [("Part A", 1, 3), ("Part B", 1, 2)]
    qs = [{"question_number": n, "question": {"content": "x"}} for n in ["1", "2", "3", "1", "2"]]
    apply_outline(qs, o)
    assert [q["section"] for q in qs] == ["Part A", "Part A", "Part A", "Part B", "Part B"]


def test_numbered_statements_inside_a_question_make_no_section():
    html = (
        _mcq(1) + _mcq(2)
        + _p("3. Which statements are true?") + _p("1) s1") + _p("2) s2") + _p("3) s3")
        + _p("(a) 1 and 2 (b) 2 and 3") + _mcq(4) + _mcq(5)
    )
    o = outline_of_html(html)
    assert o["question_count"] == 5
    assert o["sections"] == []


def test_a_plain_paper_has_no_sections_and_no_scheme():
    o = outline_of_html(_mcq(1) + _mcq(2))
    assert o["sections"] == [] and o["marking"] == {"marks": None, "negative_marks": None}
    qs = [{"question_number": "1", "question": {"content": "x"}}]
    apply_outline(qs, o)
    assert qs[0]["section"] is None and qs[0]["marks"] is None and qs[0]["negative_marks"] is None


def test_end_of_section_markers_split_when_nothing_else_does():
    html = _mcq(1) + _mcq(2) + _p("END OF SECTION I") + _mcq(3) + _p("E ND OF SECTION II") + _mcq(4)
    assert _names(outline_of_html(html)) == [("Section I", 1, 2), ("Section II", 3, 3), ("Section 3", 4, 4)]


def test_subject_headings_but_not_instruction_lines():
    html = (
        _p("Read the following passage on economics") + _p("Physics") + _mcq(1) + _mcq(2)
        + _p("Chemistry") + _mcq(3) + _p("Section 3.2 of the Act says") + _mcq(4)
    )
    assert _names(outline_of_html(html)) == [("Physics", 1, 2), ("Chemistry", 3, 4)]


def test_a_caption_for_a_set_of_questions_is_not_a_section():
    """EUG-03: "(Science fair scores logic)" under "Directions for Questions
    25–28:" split Logical Reasoning in two ("science" is a subject word)."""
    html = (
        _p("SECTION 1: ENGLISH COMPREHENSION (VARC)") + _mcq(1) + _mcq(2)
        + _p("SECTION 2: LOGICAL REASONING") + _mcq(3)
        + _p("Directions for Questions 4-5:") + _p("(Science fair scores logic)") + _mcq(4) + _mcq(5)
        + _p("SECTION 3: QUANTITATIVE ABILITY") + _mcq(6)
    )
    assert _names(outline_of_html(html)) == [
        ("Section 1: English Comprehension (VARC)", 1, 2),
        ("Section 2: Logical Reasoning", 3, 5),
        ("Section 3: Quantitative Ability", 6, 6),
    ]
    assert _names(outline_of_html(html.replace("Directions for Questions 4-5:", "Directions (Q. 4-5):")))[1] == (
        "Section 2: Logical Reasoning", 3, 5)
    # Only the two together: a bracketed subject line or a heading under a
    # directions line on its own is read exactly as before.
    for alone in (html.replace(_p("Directions for Questions 4-5:"), ""),
                  html.replace("(Science fair scores logic)", "Science fair scores")):
        assert len(outline_of_html(alone)["sections"]) == 4
    brackets = _p("(PHYSICS)") + _mcq(1) + _mcq(2) + _p("(CHEMISTRY)") + _mcq(3)
    assert _names(outline_of_html(brackets)) == [("Physics", 1, 2), ("Chemistry", 3, 3)]
    candidates = _p("Instructions for candidates 1-3 compulsory") + _p("(PHYSICS)") + _mcq(1) + _mcq(2) + _p(
        "(CHEMISTRY)") + _mcq(3)
    assert _names(outline_of_html(candidates)) == [("Physics", 1, 2), ("Chemistry", 3, 3)]


def test_a_section_name_keeps_its_own_brackets():
    from app.services.paper_outline import _label_heading, _subject_heading

    assert _label_heading("SECTION 1: ENGLISH COMPREHENSION (VARC)")["name"] == "Section 1: English Comprehension (VARC)"
    assert _label_heading("Section A: Physics (Theory)")["name"] == "Section A: Physics (Theory)"
    # A name wholly in brackets, or a range in brackets, loses them as before.
    assert _label_heading("SECTION – B (Physics)")["name"] == "Section B: Physics"
    assert _label_heading("Section C (Long answer)")["name"] == "Section C: Long answer"
    assert _subject_heading("PHYSICS (THEORY)") == "Physics (Theory)"
    assert _subject_heading("(PHYSICS)") == "Physics"


def test_a_single_heading_is_not_a_split():
    assert outline_of_html(_p("SECTION A") + _mcq(1) + _mcq(2))["sections"] == []


# ── the marking scheme ───────────────────────────────────────────────────────

def test_marking_phrasings():
    assert marking_of("+4 for correct, -1 for wrong")["marks"] == 4.0
    assert marking_of("+4 for correct, -1 for wrong")["negative_marks"] == 1.0
    assert marking_of("Each question carries 4 marks. 1 mark will be deducted for each wrong answer.") == {
        "marks": 4.0, "negative_marks": 1.0, "negative_fraction": None}
    assert marking_of("There is no negative marking. Each question carries 2 marks")["negative_marks"] == 0.0
    assert marking_of("Negative marking: 0.25")["negative_marks"] == 0.25
    assert marking_of("Section A (20 x 1 = 20)")["marks"] == 1.0
    assert marking_of("Maximum Marks: 80. Time: 3 hours") == {"marks": None, "negative_marks": None, "negative_fraction": None}


def test_fraction_negative_marking_is_taken_from_the_marks():
    m = marking_of("Each question carries 4 marks. 1/4th of the marks assigned to the question will be deducted for each wrong answer.")
    assert m["marks"] == 4.0 and m["negative_marks"] == 1.0


def test_explicit_deduction_beats_a_no_negative_clause_for_a_subset():
    m = marking_of("For each incorrect answer 1 mark will be deducted. No negative marking for numerical value questions.")
    assert m["negative_marks"] == 1.0


def test_a_section_without_negative_marking_overrides_the_paper():
    html = (
        _p("Each question carries 4 marks. For each incorrect answer 1 mark will be deducted.")
        + _p("SECTION – I (Single Correct)") + _mcq(1) + _mcq(2)
        + _p("SECTION – II (Numerical)") + _p("No negative marking in this section.") + _p("3. The value of g is")
    )
    o = outline_of_html(html)
    assert [(s["marks"], s["negative_marks"]) for s in o["sections"]] == [(4.0, 1.0), (4.0, 0.0)]


# ── the question cursor around instructions ──────────────────────────────────

def test_numbered_general_instructions_are_not_questions():
    blocks = qe.split_blocks(
        _p("General Instructions:") + _p("1. All questions are compulsory.") + _p("2. Use of calculator is not allowed.")
        + _p("SECTION A") + _mcq(1) + _mcq(2) + _mcq(3)
    )
    starts = qe.question_starts(blocks)
    assert sum(starts) == 3 and not starts[1] and not starts[2]


def test_a_short_leading_list_before_a_longer_restart_is_dropped_even_without_a_heading_word():
    blocks = qe.split_blocks(
        _p("Please read:") + _p("1. Be seated.") + _p("2. Keep quiet.")
        + _p("Physics") + "".join(_mcq(i) for i in range(1, 5))
    )
    assert sum(qe.question_starts(blocks)) == 4


def test_a_range_cell_is_not_question_one():
    blocks = qe.split_blocks(_p("English") + _p("1–15") + _p("Maths") + _p("16–30") + _mcq(1) + _mcq(2))
    starts = qe.question_starts(blocks)
    assert sum(starts) == 2 and not starts[1]


def test_a_short_first_section_with_options_is_not_taken_for_a_list():
    """Q1–Q3 with options, no heading, then "SECTION B" restarting at 1 with
    more questions: the first three are questions, not instructions."""
    blocks = qe.split_blocks(_mcq(1) + _mcq(2) + _mcq(3) + _p("SECTION B") + "".join(_mcq(i) for i in range(1, 6)))
    assert sum(qe.question_starts(blocks)) == 8


def test_merge_keeps_both_questions_when_a_section_restarts_numbering():
    q = lambda no, part: {"question_number": no, "question": {"content": f"{part} {no}"}, "options": []}
    merged = qe.merge_questions([[q("1", "A"), q("2", "A"), q("3", "A")], [q("3", "B"), q("1", "B"), q("2", "B")]])
    assert [(x["question_number"], x["question"]["content"][0]) for x in merged] == [
        ("1", "A"), ("2", "A"), ("3", "A"), ("1", "B"), ("2", "B")]


# ── the whole pipeline, model stubbed ────────────────────────────────────────

def test_extract_from_html_names_sections_and_settles_marks(monkeypatch):
    import asyncio
    import json

    html = (
        _p("Each question carries 4 marks. 1 mark will be deducted for each wrong answer.")
        + _p("PHYSICS") + _mcq(1, "A ball") + _mcq(2, "A force")
        + _p("CHEMISTRY") + _p("3. Atomic number of He is [2]")
    )

    async def fake_generate_json(prompt, models, label=""):
        # The model returns the questions of the one part, no marks, no sections.
        data = {"questions": [
            {"question_number": "1", "question": {"type": "HTML", "content": "1. A ball"},
             "options": [{"type": "HTML", "preview_id": "1", "content": "1"}], "question_type": "MCQS", "correct_options": []},
            {"question_number": "2", "question": {"type": "HTML", "content": "2. A force"},
             "options": [{"type": "HTML", "preview_id": "1", "content": "1"}], "question_type": "MCQS", "correct_options": []},
            {"question_number": "3", "question": {"type": "HTML", "content": "3. Atomic number of He is [2]"},
             "options": [], "question_type": "NUMERIC", "ans": "2"},
        ], "title": "Mock"}
        return json.dumps(data), "stub-model", {"prompt_tokens": 10, "completion_tokens": 10}

    monkeypatch.setattr(qe.llm_json, "generate_json", fake_generate_json)
    monkeypatch.setattr(qe, "_charge", lambda **kw: None)
    monkeypatch.setattr(qe, "_estimated_credits", lambda *a: 3.0)

    raw = json.loads(asyncio.run(qe.extract_from_html(html=html, models=["stub"], section_mode=None)))
    assert [(q["section"], q["marks"], q["negative_marks"]) for q in raw["questions"]] == [
        ("Physics", 4.0, 1.0), ("Physics", 4.0, 1.0), ("Chemistry", 2.0, 1.0)]
    summary = raw["extraction"]
    assert summary["section_mode"] == "split"
    assert [(s["name"], s["count"]) for s in summary["sections"]] == [("Physics", 2), ("Chemistry", 1)]
    assert summary["marking"] == {"marks": 4.0, "negative_marks": 1.0}

    raw = json.loads(asyncio.run(qe.extract_from_html(html=html, models=["stub"], section_mode="single")))
    assert raw["extraction"]["section_mode"] == "single"
    assert raw["questions"][0]["section"] == "Physics"  # still named; the preview decides


def test_time_allowed_phrasings():
    from app.services.paper_outline import duration_of

    assert duration_of("Time allowed: 3 hours") == 180
    assert duration_of("Time: 1 hr 30 min · Maximum Marks: 80") == 90
    assert duration_of("Duration – 90 minutes") == 90
    assert duration_of("a 120-minute limit") == 120
    assert duration_of("Maximum Marks: 80") is None
    assert duration_of("Questions 1 to 15 · 30 minutes") is None  # bare minutes only count on a section's own line
    assert duration_of("Questions 1 to 15 · 30 minutes", loose=True) == 30


# ── review findings ──────────────────────────────────────────────────────────

def test_a_note_or_directions_line_above_q1_does_not_make_the_questions_a_list():
    ten = "".join(_mcq(i) for i in range(1, 11))
    assert outline_of_html(_p("Note: All questions are compulsory.") + ten)["question_count"] == 10
    assert outline_of_html(_p("General Instructions") + ten)["question_count"] == 10
    rc = _p("Instructions for Questions 1 to 5: read the passage and answer.") + "".join(_mcq(i) for i in range(1, 6))
    assert outline_of_html(rc)["question_count"] == 5


def test_the_instructions_own_section_list_does_not_name_the_first_section():
    instr = (_p("General Instructions") + _p("Section A: Questions 1 to 2 (2 marks)")
             + _p("Section B: Questions 3 to 4 (4 marks)"))
    body = _mcq(1) + _mcq(2) + _p("SECTION B") + _mcq(3) + _mcq(4)
    # No heading above Q1: the instructions' line for Section A is the
    # nearest true one; Section B's line names other questions.
    assert _names(outline_of_html(instr + body)) == [("Section A", 1, 2), ("Section B", 3, 4)]
    # A heading right above Q1 wins over the list, marks note and all.
    o = outline_of_html(instr + _p("SECTION A (2 Marks)") + body)
    assert _names(o) == [("Section A", 1, 2), ("Section B", 3, 4)]
    # Only Section B's line in the list and no heading above Q1: nothing to
    # name the first section by, so no sections rather than a wrong one.
    assert outline_of_html(_p("Section B: Questions 3 to 4 (4 marks)") + body)["sections"] == []


def test_a_marks_note_on_a_heading_is_neither_its_name_nor_a_per_question_mark():
    o = outline_of_html(_p("SECTION A (20 Marks)") + _mcq(1) + _mcq(2) + _p("SECTION B (10 M)") + _mcq(3))
    assert [(s["name"], s["marks"], s["duration_minutes"]) for s in o["sections"]] == [
        ("Section A", None, None), ("Section B", None, None)]


def test_a_bracketed_number_at_the_end_is_marks_unless_it_is_a_call():
    from app.services.paper_outline import _printed_marks

    assert _printed_marks({"question": {"content": "Find f(3)"}}) is None
    assert _printed_marks({"question": {"content": "Evaluate g(2)"}}) is None
    assert _printed_marks({"question": {"content": "Prove it. (2)"}}) == 2.0  # the common convention stays
    assert _printed_marks({"question": {"content": "Prove it [3]"}}) == 3.0
    assert _printed_marks({"question": {"content": "Solve (2 M)"}}) == 2.0
    assert _printed_marks({"question": {"content": "Derive it. 5 marks"}}) == 5.0


def test_a_marks_note_is_stripped_from_a_section_name_but_not_a_word_starting_with_m():
    from app.services.paper_outline import _label_heading, _subject_heading

    assert _label_heading("Part B: Chapter 5 Mechanics (10 Marks)")["name"] == "Part B: Chapter 5 Mechanics"
    assert _label_heading("Section A: Physics (35 M)")["name"] == "Section A: Physics"
    assert _label_heading("Section C: Reading 2 marks each")["name"] == "Section C: Reading"
    # Subject headings are as before: a marks note keeps a line from being one.
    assert _subject_heading("Physics (35 Marks)") is None and _subject_heading("PHYSICS") == "Physics"


def test_section_time_in_hours_short_form_still_counts_but_not_a_marks_m():
    assert duration_of("Section A · 2 h", loose=True) == 120
    assert duration_of("Section A · 1 hr 30 m", loose=True) == 90
    assert duration_of("SECTION B (20 M)", loose=True) is None


def test_statements_under_the_last_question_are_not_extra_questions():
    # "1) 2) 3)" inside Q4 with nothing after to resume the outer run: the
    # same starts as before, but the count is the paper's four.
    html = "".join(_mcq(i) for i in range(1, 4)) + _p("4. Which are true?") + _p("1) x") + _p("2) y") + _p("3) z")
    blocks = qe.split_blocks(html)
    assert [len(r) for r in qe.question_runs(blocks)] == [7]
    assert outline_of_html(html)["question_count"] == 4


def test_a_code_word_starting_with_q_and_a_number_is_not_a_question():
    blocks = qe.split_blocks(_p("Q28. Which replaces the mark?") + _p("A) Q30S") + _p("B) R30T") + _p("Q29. Next?") + _p("A) x"))
    assert qe.question_starts(blocks) == [True, False, False, True, False]


def test_a_question_marker_takes_back_the_list_item_the_run_took_for_it():
    # Q2's solution ends with a "1. 2. 3." list; its "3." is the number the
    # run expects next. "Question 3" that follows is the real entry: it
    # takes the number back and the list stays inside Q2 (IPMAT, Q3).
    html = (_p("Question 2 ANSWER A") + _p("because") + _p("1. one") + _p("2. two") + _p("3. three")
            + _p("Question 3 ANSWER C") + _p("why") + _p("Question 4 ANSWER B"))
    blocks = qe.split_blocks(html)
    assert [i for i, s in enumerate(qe.question_starts(blocks)) if s] == [0, 5, 7]
    key, _ = qe.read_key_region(blocks, min_hits=3)
    assert [key[n]["options"] for n in ("2", "3", "4")] == [["A"], ["C"], ["B"]]
    assert "three" in key["2"]["exp"] and "three" not in key["3"]["exp"]
    # A bare-numbered run is never rewound: a stray "Q 6 …" (a table with
    # a Q column) must not evict question 6, near or far.
    html = "".join(_mcq(i) for i in range(1, 8)) + _p("Q 6 7 : 5") + _mcq(8)
    assert [i for i, s in enumerate(qe.question_starts(qe.split_blocks(html))) if s] == [0, 2, 4, 6, 8, 10, 12, 15]
    html = "".join(_mcq(i) for i in range(1, 8)) + _p("Q 3 7 : 5") + _mcq(8)
    assert sum(qe.question_starts(qe.split_blocks(html))) == 8
    # Key lines "1. (a) … 20. (a)" then solutions "Q19." "Q20.": the lines
    # keep their letters and the solutions still become entries.
    key_html = "".join(_p(f"{i}. (a)") for i in range(1, 21)) + _p("Q19. Because …") + _p("Q20. Since …")
    key, _ = qe.read_key_region(qe.split_blocks(key_html), min_hits=3)
    assert key["19"]["options"] == ["a"] and key["20"]["options"] == ["a"]


def test_a_table_row_or_a_timing_at_the_start_of_a_block_is_not_a_question():
    assert qe._question_no(_p("Q 30% 7 : 5")) is None  # a DI table row labelled Q
    assert qe._question_no(_p("Q 1,20,000 5 12")) is None
    assert qe._question_no(_p("1.9 min")) is None
    assert qe._question_no(_p("Q1, which is …")) == "1"
    assert qe._question_no(_p("1.The first")) == "1"
    # A stray "Q 30 …" inside a run (a table with a city called Q) neither
    # splits the run nor counts: the run resumes and drops it.
    html = "".join(_mcq(i) for i in range(1, 5)) + _p("City share") + _p("Q 30 7 : 5") + _mcq(5) + _mcq(6)
    assert [len(r) for r in qe.question_runs(qe.split_blocks(html))] == [6]
    assert outline_of_html(html)["question_count"] == 6


def test_a_key_that_restarts_with_the_sections_is_applied_section_by_section(monkeypatch):
    import asyncio
    import json

    html = (
        _p("PART A") + _mcq(1) + _mcq(2) + _mcq(3)
        + _p("PART B") + _mcq(1) + _mcq(2) + _mcq(3)
        + _p("ANSWER KEY") + _p("Part A") + _p("1. a 2. b 3. c") + _p("Part B") + _p("1. d 2. d 3. d")
    )
    opts = [{"type": "HTML", "preview_id": str(i), "option_label": l, "content": str(i)} for i, l in enumerate("abcd", 1)]

    async def fake_generate_json(prompt, models, label=""):
        qs = [{"question_number": n, "question": {"type": "HTML", "content": f"{n}. q"}, "options": list(opts),
               "question_type": "MCQS", "correct_options": []} for n in ["1", "2", "3", "1", "2", "3"]]
        return json.dumps({"questions": qs, "title": "t"}), "stub", {"prompt_tokens": 1, "completion_tokens": 1}

    monkeypatch.setattr(qe.llm_json, "generate_json", fake_generate_json)
    monkeypatch.setattr(qe, "_charge", lambda **kw: None)
    monkeypatch.setattr(qe, "_estimated_credits", lambda *a: 1.0)
    raw = json.loads(asyncio.run(qe.extract_from_html(html=html, models=["stub"])))
    assert [(q["section"], q["correct_options"]) for q in raw["questions"]] == [
        ("Part A", ["1"]), ("Part A", ["2"]), ("Part A", ["3"]),
        ("Part B", ["4"]), ("Part B", ["4"]), ("Part B", ["4"]),
    ]
    assert raw["extraction"]["keyed"] == 6 and raw["extraction"]["key_found"]


def test_a_split_key_that_reads_poorly_falls_back_to_the_whole_key(monkeypatch):
    import asyncio
    import json

    # Part B's key line carries no letters: the split read covers 3 of 6,
    # so the whole-key path applies as before (B gets A's answers, as on
    # main) rather than leaving B unkeyed.
    html = (
        _p("PART A") + _mcq(1) + _mcq(2) + _mcq(3)
        + _p("PART B") + _mcq(1) + _mcq(2) + _mcq(3)
        + _p("ANSWER KEY") + _p("Part A") + _p("1. a 2. b 3. c") + _p("Part B") + _p("1. ? 2. ? 3. ?")
    )
    opts = [{"type": "HTML", "preview_id": str(i), "option_label": l, "content": str(i)} for i, l in enumerate("abcd", 1)]

    async def fake_generate_json(prompt, models, label=""):
        qs = [{"question_number": n, "question": {"type": "HTML", "content": f"{n}. q"}, "options": list(opts),
               "question_type": "MCQS", "correct_options": []} for n in ["1", "2", "3", "1", "2", "3"]]
        return json.dumps({"questions": qs, "title": "t"}), "stub", {"prompt_tokens": 1, "completion_tokens": 1}

    monkeypatch.setattr(qe.llm_json, "generate_json", fake_generate_json)
    monkeypatch.setattr(qe, "_charge", lambda **kw: None)
    monkeypatch.setattr(qe, "_estimated_credits", lambda *a: 1.0)
    raw = json.loads(asyncio.run(qe.extract_from_html(html=html, models=["stub"])))
    assert [q["correct_options"] for q in raw["questions"]] == [["1"], ["2"], ["3"], ["1"], ["2"], ["3"]]
    assert raw["extraction"]["keyed"] == 6


def test_numbering_runs_and_key_region_split():
    qs = [{"question_number": n} for n in ["1", "2", "3", "1", "2"]]
    assert qe.numbering_runs(qs) == [[0, 1, 2], [3, 4]]
    assert qe.numbering_runs([{"question_number": n} for n in ["1", "2", "3"]]) == [[0, 1, 2]]
    # A misread "7" for "17" is not a section starting over.
    assert qe.numbering_runs([{"question_number": n} for n in ["16", "7", "18"]]) == [[0, 1, 2]]
    regions = qe.split_key_region(qe.split_blocks(_p("Answers") + _p("1. a 2. b 3. c") + _p("1. d 2. d")))
    assert [len(r) for r in regions] == [2, 1]
    # Solutions that start over at 1 after the key lines cut too, so key
    # lines and solutions each give a region per section (cycled in
    # extract_from_html); a numbered list inside an explanation does not.
    sol = (_p("Answers") + _p("1. a 2. b 3. c") + _p("Part B") + _p("1. d 2. d 3. d")
           + _p("Solutions") + _p("Part A") + _p("1. Because of steps") + _p("1) first 2) second") + _p("2. x") + _p("3. y")
           + _p("Part B") + _p("1. z") + _p("2. w") + _p("3. v"))
    assert [len(r) for r in qe.split_key_region(qe.split_blocks(sol))] == [3, 3, 5, 3]


def test_a_time_under_the_first_section_heading_is_that_sections_not_the_papers():
    """EUG-03: each section prints its own time, the paper none above them;
    the paper is 30 + 45 + 60, not Section 1's 30."""
    html = (
        _p("IPMAT Mock Test") + _p("SECTION 1: ENGLISH") + _p("Time: 30 minutes | Marking: +3 correct, -1 wrong")
        + _mcq(1) + _mcq(2) + _p("SECTION 2: REASONING") + _p("Time: 45 minutes") + _mcq(3)
        + _p("SECTION 3: QUANTITATIVE ABILITY") + _p("Time: 60 minutes") + _mcq(4)
    )
    o = outline_of_html(html)
    assert [s["duration_minutes"] for s in o["sections"]] == [30, 45, 60] and o["duration_minutes"] == 135
    # A time printed above the first heading is the paper's, as before.
    assert outline_of_html(_p("Time allowed: 2 hours") + html)["duration_minutes"] == 120
    # Not every section timed: the paper keeps what it read.
    untimed = html.replace(_p("Time: 45 minutes"), "")
    assert outline_of_html(untimed)["duration_minutes"] == 30
