"""Vsmart Extract (mode=extract) — the deterministic half of digitising a
question paper: where the paper is cut, where the answer key starts, how the
parts merge, how a printed key lands on the options.

Written against the failure that motivated it (2026-09-21): a 60-question
IPMAT mock with two comprehension passages, a DI table, +3/−1 marking and a
printed key on p.24 had to be put into Vacademy by hand, because the tool sent
"Generate 10 MCQ questions" and the backend capped at "first 20 questions"
in a single model call.
"""
from app.services import question_extract_service as qe


def _p(text: str) -> str:
    return f"<p>{text}</p>"


def _question(no: int, body: str = "Which is correct?", options: int = 4) -> str:
    return _p(f"{no}. {body}") + "".join(_p(f"({chr(97 + i)}) option {i + 1}") for i in range(options))


# ── blocks ───────────────────────────────────────────────────────────────────

def test_blocks_keep_their_closing_tags_and_order():
    html = "<h2>Section A</h2><p>1. Q?</p><table><tr><td>x</td></tr></table><p>(a) 1</p>"
    assert qe.split_blocks(html) == [
        "<h2>Section A</h2>", "<p>1. Q?</p>", "<table><tr><td>x</td></tr></table>", "<p>(a) 1</p>",
    ]


def test_question_start_recognises_the_common_numberings():
    for text in ("1. What", "12) What", "(3) What", "Q4. What", "Q. 5 What", "Question 6: What", "7 – What"):
        assert qe._question_no(_p(text)) is not None, text
    for text in ("Section A", "(a) option", "2024 was a leap year", "Read the passage"):
        assert qe._question_no(_p(text)) is None, text


# ── answer key ───────────────────────────────────────────────────────────────

def test_answer_key_heading_in_the_second_half_is_found_and_not_the_first_half_one():
    blocks = [_p("Answers must be marked on the OMR sheet")]  # instructions on p.1
    blocks += [_question(i) for i in range(1, 21)]
    blocks += [_p("ANSWER KEY"), _p("1. b 2. c 3. a 4. d")]
    idx = qe.find_answer_key(blocks)
    assert idx == len(blocks) - 2
    assert qe._text_of(blocks[idx]) == "ANSWER KEY"


def test_answer_key_without_heading_is_found_by_its_dense_run():
    blocks = [_question(i) for i in range(1, 16)]
    blocks += [_p("1. b 2. c 3. a 4. d 5. a 6. b 7. c 8. d 9. a 10. b 11. c 12. d 13. a 14. b 15. c")]
    assert qe.find_answer_key(blocks) == len(blocks) - 1


def test_no_key_when_there_is_none():
    assert qe.find_answer_key([_question(i) for i in range(1, 10)]) is None


def test_hindi_key_heading():
    blocks = [_question(i) for i in range(1, 12)] + [_p("उत्तरमाला"), _p("1. ख 2. ग")]
    assert qe.find_answer_key(blocks) == 11


# ── chunking ─────────────────────────────────────────────────────────────────

def test_parts_are_cut_only_at_question_starts():
    body = "x" * 900
    blocks = []
    for i in range(1, 41):
        blocks += qe.split_blocks(_question(i, body))
    parts = qe.chunk_blocks(blocks)
    assert len(parts) > 1
    for part in parts:
        first = qe.split_blocks(part)[0]
        assert qe._question_no(first) is not None, first[:60]
    # Every question lands in exactly one part.
    numbered = [qe._question_no(b) for p in parts for b in qe.split_blocks(p) if qe._question_no(b)]
    assert numbered == [str(i) for i in range(1, 41)]


def test_a_passage_travels_with_the_questions_after_it():
    """A cut must never fall between a passage and its first question."""
    blocks = []
    for i in range(1, 15):
        blocks += qe.split_blocks(_question(i, "y" * 1000))
    passage = _p("Read the following passage. " + "words " * 400)   # ~2.4k, unnumbered
    blocks.append(passage)
    for i in range(15, 30):
        blocks += qe.split_blocks(_question(i, "z" * 1000))
    parts = qe.chunk_blocks(blocks)
    holder = next(p for p in parts if "Read the following passage" in p)
    assert "<p>15. " in holder, "the passage was separated from question 15"


def test_small_paper_is_one_part():
    blocks = []
    for i in range(1, 6):
        blocks += qe.split_blocks(_question(i))
    assert len(qe.chunk_blocks(blocks)) == 1


# ── merge + key ──────────────────────────────────────────────────────────────

def _q(no, content="Q", options=("A", "B", "C", "D"), qtype="MCQS", **extra):
    return {
        "question_number": str(no), "question_type": qtype,
        "question": {"type": "HTML", "content": content},
        "options": [{"type": "HTML", "preview_id": str(i + 1), "option_label": lab, "content": f"opt {lab}"}
                    for i, lab in enumerate(options)],
        "correct_options": [], "ans": "", **extra,
    }


def test_merge_keeps_order_drops_repeats_and_prefers_the_fuller_reading():
    part1 = [_q(1), _q(2, content="short", options=("A", "B"))]
    part2 = [_q(2, content="the whole question read properly"), _q(3)]
    merged = qe.merge_questions([part1, part2])
    assert [q["question_number"] for q in merged] == ["1", "2", "3"]
    assert merged[1]["question"]["content"].startswith("the whole")
    assert [o["preview_id"] for o in merged[1]["options"]] == ["1", "2", "3", "4"]


def test_merge_skips_empty_questions_and_keeps_unnumbered_ones():
    merged = qe.merge_questions([[{"question": {"content": ""}}, _q("", content="unnumbered")]])
    assert len(merged) == 1 and merged[0]["question"]["content"] == "unnumbered"


def test_key_maps_printed_labels_onto_options():
    qs = [_q(1), _q(2, options=("i", "ii", "iii", "iv")), _q(3, options=(), qtype="NUMERIC"), _q(4)]
    key = {
        "1": {"options": ["C"], "ans": "", "exp": ""},
        "2": {"options": ["(iii)"], "ans": "", "exp": "because"},
        "3": {"options": [], "ans": "42", "exp": ""},
        "9": {"options": ["A"]},                     # not in the paper: ignored
    }
    keyed = qe.apply_answer_key(qs, key)
    assert keyed == 3
    assert qs[0]["correct_options"] == ["3"]
    assert qs[1]["correct_options"] == ["3"] and qs[1]["exp"] == "because"
    assert qs[2]["ans"] == "42"
    assert qs[3]["correct_options"] == []          # no key line for 4


def test_a_markdown_key_table_cut_by_a_page_break_reads_whole():
    """EUG-03 via MathPix: one <p> per "| … |" row, the VARC row cut at a page
    break into 6 pairs + "7-" / repeated header / "C, 8-B …". A 60-question
    paper needs 8 pairs a line, so Q1–7 went unanswered."""
    head = _p("| Section | Questions | Answers |") + _p("| :--- | :--- | :--- |")
    blocks = qe.split_blocks(
        _p("CONSOLIDATED ANSWER KEY") + head
        + _p("| VARC | 1-15 | 1-C, 2-C, 3-D, 4-C, 5-A, 6-A, 7- |") + head
        + _p("|  |  | C, 8-B, 9-A, 10-A, 11-B, 12-A, 13-A, 14-B, 15-C |")
        + _p("| LR | 16-30 | " + ", ".join(f"{n}-B" for n in range(16, 31)) + " |")
        + _p("Q16 — B, Aarav") + _p("Gauri's statement is the false one, so Aarav is in the team.")
    )
    key, explained = qe.read_key_region(blocks, min_hits=8)
    assert {n: key[str(n)]["options"] for n in (1, 6, 7, 8, 15, 16, 30)} == {
        1: ["C"], 6: ["A"], 7: ["C"], 8: ["B"], 15: ["C"], 16: ["B"], 30: ["B"]}
    assert explained == 1 and "Aarav is in the team" in key["16"]["exp"]
    # Only a row cut mid-answer is stitched: small tables of short rows (a
    # quiz key per table, numeric answers "2. 1") are read row by row as before.
    quiz = qe.split_blocks(_p("| 1. a, b | 5. c |") + _p("| 2. 1 | 6. c |") + _p("| 3. c | 7. b |")
                           + _p("Q2. (d) The relation is in BCNF after the split."))
    assert qe.read_key_region(quiz, min_hits=3)[0]["2"]["options"] == ["d"]


def test_key_never_overrides_an_answer_printed_at_the_question():
    qs = [_q(1, correct_options=["2"])]
    assert qe.apply_answer_key(qs, {"1": {"options": ["D"]}}) == 0
    assert qs[0]["correct_options"] == ["2"]


def test_key_falls_back_to_letter_position_when_labels_are_missing():
    qs = [_q(1, options=("", "", "", ""))]
    qe.apply_answer_key(qs, {"1": {"options": ["b"]}})
    assert qs[0]["correct_options"] == ["2"]


def test_multi_answer_key_gives_mcqm_all_its_options():
    qs = [_q(1, qtype="MCQM")]
    qe.apply_answer_key(qs, {"1": {"options": ["A", "D"]}})
    assert qs[0]["correct_options"] == ["1", "4"]


# ── heading false positives / solutions in parts / number stripping ──────────

def test_key_heading_variants_and_non_headings():
    yes = ["ANSWER KEY", "Answers", "Answers and Explained Solutions", "Hints & Solutions",
           "Part Two: Solutions", "Key", "Solutions to Section A", "उत्तरमाला"]
    no = ["Answer the following questions", "Answers must be marked on the OMR sheet",
          "letter counts down first; the cases then answer themselves.", "3. The key to this problem is"]
    for t in yes:
        assert qe._KEY_HEADING.match(t), t
    for t in no:
        assert not (qe._KEY_HEADING.match(t) and not qe._question_no(_p(t))), t


def test_first_key_heading_opens_the_section_not_a_later_one():
    blocks = [_question(i) for i in range(1, 21)]
    blocks += [_p("Answers and Explained Solutions"), _p("1 A 2 B"), _p("Solutions"), _p("1. Because…")]
    assert qe.find_answer_key(blocks) == 20


def test_merge_keys_takes_first_option_and_longest_explanation():
    merged = qe.merge_keys([
        {"1": {"options": ["A"], "ans": "", "exp": ""}, "2": {"options": ["C"], "ans": "", "exp": "short"}},
        {"1": {"options": ["B"], "ans": "", "exp": "<p>the full working</p>"}, "2": {"options": [], "exp": "s"}},
    ])
    assert merged["1"] == {"options": ["A"], "ans": "", "exp": "<p>the full working</p>"}
    assert merged["2"]["exp"] == "short"


def test_leading_question_number_is_stripped_only_when_it_is_the_number():
    q = _q(7, content="<p>Q7. What is x?</p>")
    qe.strip_question_number(q)
    assert q["question"]["content"] == "<p>What is x?</p>"
    q = _q(3, content="2024. is a leap year — true or false?")
    qe.strip_question_number(q)
    assert q["question"]["content"].startswith("2024.")
    q = _q(12, content="(12) Find y")
    qe.strip_question_number(q)
    assert q["question"]["content"] == "Find y"


def test_numbered_statements_inside_a_question_are_not_question_starts():
    """IPMAT Q14: five statements 1)–5) then options A) 1 … D) 5. A cut at
    "4) The economics…" split the question and lost its options."""
    blocks = []
    for i in range(1, 14):
        blocks += qe.split_blocks(_question(i, "w" * 1100))
    blocks += [_p("Q14. Five statements are given below; identify the odd one.")]
    blocks += [_p(f"{k}) statement {k} " + "s" * 300) for k in range(1, 6)]
    blocks += [_p("A) 1"), _p("B) 4"), _p("C) 2"), _p("D) 5")]
    blocks += qe.split_blocks(_question(15, "v" * 1100))
    starts = qe.question_starts(blocks)
    assert sum(starts) == 15
    parts = qe.chunk_blocks(blocks)
    holder = next(p for p in parts if "Q14." in p)
    assert "5) statement 5" in holder and "D) 5" in holder


def test_sequence_tolerates_a_skipped_number_and_an_explicit_restart():
    blocks = [_p("1. a"), _p("2. b"), _p("4. d"), _p("Q1. section B first"), _p("2. second")]
    assert qe.question_starts(blocks) == [True, True, True, True, True]


# ── the key and solutions without a model ────────────────────────────────────

def test_key_region_reads_tables_runs_and_solution_entries():
    blocks = [
        _p("ANSWER KEY"),
        "<table><tr><td>1</td><td>2</td><td>3</td><td>4</td></tr><tr><td>B</td><td>C</td><td>A</td><td>D</td></tr></table>",
        _p("5. a 6. b 7. c 8. d 9. a 10. b"),
        _p("Q1. (B) The first is correct because the passage says so, at length."),
        _p("It continues on a second line with more working."),
        _p("Q2. Answer: C"),
        _p("Because of the second reason, explained in some detail here for the student."),
        _p("Q3. (A) short."),
    ]
    answers, explained = qe.read_key_region(blocks)
    assert [answers[str(n)]["options"] for n in range(1, 11)] == [["B"], ["C"], ["A"], ["D"], ["a"], ["b"], ["c"], ["d"], ["a"], ["b"]]
    assert "second line" in answers["1"]["exp"] and "Q1." not in answers["1"]["exp"]
    assert "second reason" in answers["2"]["exp"]
    assert answers["3"]["exp"] == ""            # too short to be an explanation
    assert explained == 2


def test_passages_written_once_are_put_back_on_every_question():
    part = {
        "passages": {"P1": "<p>Read this passage.</p>"},
        "questions": [
            {"question_number": "1", "passage_id": "P1", "question": {"content": "a"}},
            {"question_number": "2", "passage_id": "P1", "question": {"content": "b"}},
            {"question_number": "3", "passage_id": None, "question": {"content": "c"}},
        ],
    }
    qs = qe.expand_passages(part)
    assert [q.get("passage") for q in qs] == ["<p>Read this passage.</p>", "<p>Read this passage.</p>", None]
    assert all("passage_id" not in q for q in qs)


def test_options_the_model_dropped_are_taken_back_from_the_paper():
    body = qe.split_blocks(
        "<p>1. First?</p><p>(a) x (b) y</p>"
        "<p>3. If a² + b² = c² with a = 6 and b = 8, then c is<br>(a) 10 (b) 12 (c) 14 (d) 100</p>"
        "<p>4. Explain photosynthesis.<br>The process has two stages: (i) light and (ii) dark.</p>"
    )
    qs = [
        _q(1),
        {"question_number": "3", "question_type": "NUMERIC", "question": {"content": "…"}, "options": [], "ans": ""},
        {"question_number": "4", "question_type": "LONG_ANSWER", "question": {"content": "…"}, "options": [], "ans": ""},
    ]
    assert qe.repair_missing_options(qs, body) == 1
    assert qs[1]["question_type"] == "MCQS"
    assert [(o["option_label"], o["content"]) for o in qs[1]["options"]] == [("a", "10"), ("b", "12"), ("c", "14"), ("d", "100")]
    assert qs[2]["options"] == []          # (i)/(ii) is not an option run
    assert qs[0]["options"][0]["content"] == "opt A"   # untouched


def test_an_option_line_with_numeric_options_is_never_a_key():
    assert qe._key_pairs("(a) 10 (b) 12 (c) 14 (d) 100") == []
    assert qe._key_pairs("The values 10 (b) and 12 (c) appear") == []
    assert qe._key_pairs("1. b 2. c 3. a") == [("1", "b"), ("2", "c"), ("3", "a")]
    assert qe._key_pairs("1 A 2 B 3 C 4 D") == [("1", "A"), ("2", "B"), ("3", "C"), ("4", "D")]
    assert qe._key_pairs("Q1) (b) Q2) (d)") == [("1", "b"), ("2", "d")]
    blocks = qe.split_blocks("<p>1. Q?</p><p>(a) 1 (b) 2</p><p>2. Q?</p><p>(a) 1 (b) 2</p><p>3. Q?</p><p>(a) 10 (b) 12 (c) 14 (d) 100</p><p>Answers: 1. b 2. c 3. a</p>")
    k = qe.find_answer_key(blocks)
    assert qe._text_of(blocks[k]).startswith("Answers:")


def test_markdown_escapes_in_prose_are_dropped_but_math_is_left_alone():
    assert qe.unescape_prose("A) 12.5\\% increase") == "A) 12.5% increase"
    assert qe.unescape_prose("QA \\&amp; DI") == "QA &amp; DI"
    assert qe.unescape_prose("rate $r = 5\\%$ and 20\\%") == "rate $r = 5\\%$ and 20%"
    assert qe.unescape_prose("costs \\$5, a rise of 3\\%") == "costs \\$5, a rise of 3%"
    assert qe.unescape_prose("$$\\begin{aligned} & x \\\\ & y \\end{aligned}$$") == \
        "$$\\begin{aligned} & x \\\\ & y \\end{aligned}$$"
    q = {"question": {"content": "Growth?"}, "options": [{"content": "20\\%"}], "exp": "1.2 \\% more"}
    qe.unescape_question_prose(q)
    assert q["options"][0]["content"] == "20%" and q["exp"] == "1.2 % more" and "passage" not in q
