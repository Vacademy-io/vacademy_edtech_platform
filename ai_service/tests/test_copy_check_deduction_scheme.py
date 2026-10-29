"""A paper's printed deduction scheme (deduction_scheme.py), the vision
language pass's pure parts (language_vision.py) and the evaluation table's
geometry (evaluation_table.py)."""
import asyncio
import json

import numpy as np
from PIL import Image, ImageDraw

from app.services.copy_check import (deduction_scheme as ds, evaluation_table as et,
                                     language_feedback as lf, language_vision as lv)

SCHEME = [
    {"symbol": "X", "marks": 1, "label": "1-mark deduction",
     "covers": ["wrong synonym", "grammatical mistake", "spelling mistake", "omission of word"]},
    {"symbol": "/", "marks": "1/2", "covers": ["punctuation", "careless repetition", "omission of article"]},
    {"symbol": "#", "marks": 5, "scope": "sentence", "covers": ["wrong translation"]},
]


# ------------------------------------------------------------------ scheme

def test_parse_reads_a_valid_scheme_and_refuses_a_broken_one():
    scheme = ds.parse({"deduction_scheme": SCHEME})
    assert [(e.symbol, e.marks, e.scope) for e in scheme] == [("X", 1.0, "word"), ("/", 0.5, "word"),
                                                              ("#", 5.0, "sentence")]
    assert ds.parse({}) == [] and ds.parse(None) == []
    # A scheme that cannot be applied exactly is not applied at all.
    assert ds.parse({"deduction_scheme": [{"symbol": "X", "marks": 0}]}) == []
    assert ds.parse({"deduction_scheme": [{"symbol": "X", "marks": 1}, {"symbol": "X", "marks": 2}]}) == []
    assert ds.parse({"deduction_scheme": [{"symbol": "", "marks": 1}]}) == []


def test_a_scheme_turns_the_language_pass_on():
    assert lf.enabled({"deduction_scheme": SCHEME})
    assert not lf.enabled({"deduction_scheme": SCHEME, "answer_language": "French"})


def test_entry_for_takes_the_models_symbol_else_the_kind():
    scheme = ds.parse({"deduction_scheme": SCHEME})
    assert ds.entry_for(scheme, "/").symbol == "/"
    assert ds.entry_for(scheme, "XX").symbol == "X"
    assert ds.entry_for(scheme, None, "punctuation").symbol == "/"
    assert ds.entry_for(scheme, "?", "spelling").symbol == "X"
    assert ds.entry_for(scheme, None, "sentence").symbol == "#"
    # Unknown kind: the cheapest word-level entry.
    assert ds.entry_for(scheme, None, "style").symbol == "/"
    assert ds.count_of("XX", scheme[0]) == 2
    assert ds.count_of("X", scheme[0], 9) == ds.MAX_COUNT_PER_ERROR


def test_apply_marks_max_minus_deductions_and_never_below_zero():
    scheme = ds.parse({"deduction_scheme": SCHEME})
    verdict = {"marks_awarded": 30, "max_marks": 50, "feedback": "Good attempt.",
               "annotations": [{"style": "score", "text": "30/50"}, {"style": "tick"}]}
    errors = [{"symbol": "X", "count": 2}, {"symbol": "/", "count": 1}, {"symbol": "#", "count": 1}]
    t = ds.apply(verdict, scheme, errors)
    assert (t.counts, t.deducted, t.awarded) == ({"X": 2, "/": 1, "#": 1}, 7.5, 42.5)
    assert verdict["marks_awarded"] == 42.5
    assert verdict["annotations"][0]["text"] == "42.5/50"
    row = verdict["criteria_breakdown"]
    assert len(row) == 1 and row[0]["marks"] == 42.5 and row[0]["max"] == 50.0
    assert "50 − 7.5 = 42.5" in verdict["feedback"] and verdict["feedback"].startswith("Good attempt.")

    many = [{"symbol": "#", "count": 1}] * 12
    v2 = {"max_marks": 50, "annotations": []}
    assert ds.apply(v2, scheme, many).awarded == 0.0 and v2["marks_awarded"] == 0.0


def test_table_rows_per_part_and_total():
    scheme = ds.parse({"deduction_scheme": SCHEME})
    a = ds.tally(scheme, [{"symbol": "X", "count": 3}], 50)
    b = ds.tally(scheme, [{"symbol": "#", "count": 1}, {"symbol": "/", "count": 2}], 50)
    table = ds.table_rows(scheme, [("A", a), ("B", b)])
    assert table["rows"][0] == {"part": "A", "counts": {"X": 3, "/": 0, "#": 0}, "deducted": 3.0,
                                "obtained": 47.0, "max": 50.0, "percent": 94.0}
    assert table["rows"][1]["obtained"] == 44.0
    assert table["total"] == {"obtained": 91.0, "max": 100.0, "percent": 91.0}


def test_labels_on_the_copy_carry_the_symbol():
    assert lf.correction_label({"correct": "Telugu", "symbol": "X"}) == "Telugu X"
    assert lf.correction_label({"correct": "landscape", "symbol": "X", "count": 2}) == "landscape XX"
    long = "India has a rich medical heritage in the form of Ayurveda, which evolved over millennia."
    label = lf.correction_label({"correct": long, "symbol": "#", "kind": "sentence"})
    assert label.startswith("# India has") and label.endswith("...") and len(label) < len(long)
    assert lf.correction_label({"correct": "receive"}) == "receive"
    ann = lf.annotations([{"row": "p1_r1", "wrong": "Telgu", "correct": "Telugu", "span": [0.1, 0.2],
                           "symbol": "X", "kind": "spelling"}], "q1")[0]
    assert ann["text"] == "Telugu X" and ann["symbol"] == "X"


# ------------------------------------------------------------------ vision pass

def test_reading_slip_drops_shape_misreads_and_keeps_real_misspellings():
    for wrong, correct in (("enchange", "exchange"), ("econouy", "economy"), ("Jake", "fake"),
                           ("privalt", "private"), ("Manmohau", "Manmohan"), ("gines", "gives"),
                           ("tability", "stability"), ("same", "same")):
        assert lv.reading_slip(wrong, correct, "spelling"), (wrong, correct)
    for wrong, correct in (("Narsimha", "Narasimha"), ("Sigh", "Singh"), ("preffered", "preferred"),
                           ("recieve", "receive"), ("seperate", "separate"), ("reform", "reforms")):
        assert not lv.reading_slip(wrong, correct, "spelling"), (wrong, correct)
    # Only spelling is judged: a wrong word or an article is never a misread.
    assert not lv.reading_slip("democratic", "dramatic", "word")
    assert not lv.reading_slip("Election Commission", "the Election Commission", "article")
    # Hindi is not judged by Latin letter shapes.
    assert not lv.reading_slip("बुद्धिमता", "बुद्धिमत्ता", "spelling")


PAGE = {"page_id": "p2", "width": 1000, "height": 1000, "lines": [
    {"line_id": "p2_r1", "text": "Minister P.V. Narasimha Rao and Finance Minister", "box": [50, 100, 900, 60]},
    {"line_id": "p2_r2", "text": "results were democratic: India's GDP growth", "box": [50, 500, 900, 60]},
    {"line_id": "p2_h", "text": "Page No. 2", "printed": True, "box": [50, 950, 200, 30]},
]}


def test_band_rows_and_row_matching_tolerate_the_readers_own_correction():
    assert [r["line_id"] for r in lv.band_rows(PAGE, 0.0, 0.4)] == ["p2_r1"]
    assert [r["line_id"] for r in lv.band_rows(PAGE, 0.3, 0.7)] == ["p2_r2"]
    rows = lv.band_rows(PAGE, 0.0, 1.0)
    assert [r["line_id"] for r in rows] == ["p2_r1", "p2_r2"]       # printed rows are not the student's
    # The transcript already reads "Narasimha"; the ink says "Narsimha".
    row, start, end, score = lv.match_row("P.V. Narsimha Rao", "P.V. Narasimha Rao", rows)
    assert row["line_id"] == "p2_r1" and row["text"][start:end] == "P.V. Narasimha Rao"
    assert lv.match_row("completely unrelated words here", "other words", rows) is None


def test_hindi_marks_need_the_transcript_to_agree():
    page = {"page_id": "p4", "width": 1000, "height": 1000, "lines": [
        {"line_id": "p4_r1", "text": "यह बुद्धिमता का काम है", "box": [50, 100, 900, 60]}]}
    rows = lv.band_rows(page, 0.0, 1.0)
    assert lv.match_row("बुद्धिमता", "बुद्धिमत्ता", rows, strict=True)[0]["line_id"] == "p4_r1"
    # A reading of the band the transcript does not share is not marked.
    assert lv.match_row("भारतीय दोनों का आधार", "भारत के पास आधार", rows, strict=True) is None


def test_to_error_classifies_into_the_scheme_and_dedupe_merges_bands():
    scheme = ds.parse({"deduction_scheme": SCHEME})
    rows = lv.band_rows(PAGE, 0.0, 1.0)
    e = lv.to_error({"wrong": "were democratic", "correct": "were dramatic", "kind": "word",
                     "why": "wrong word", "symbol": "X"}, "p2", rows, scheme)
    assert e["row"] == "p2_r2" and e["symbol"] == "X" and e["count"] == 1 and e["words"][:2] == [1, 2]
    s = lv.to_error({"wrong": "results were democratic", "correct": "The results were dramatic.",
                     "kind": "sentence", "symbol": "#", "count": 3}, "p2", rows, scheme)
    assert s["kind"] == "sentence" and s["count"] == 1
    again = dict(e, wrong="democratic", correct="were dramatic")
    assert lv.dedupe([e, again]) == [e]
    other_row = dict(again, row="p2_r1")
    assert lv.dedupe([e, other_row]) == [e, other_row]


class _FakeLLM:
    """Spot then verify, per band, in call order."""

    def __init__(self):
        self.calls = []

    async def chat_completion(self, messages, **kw):
        self.calls.append(kw)
        system = messages[0]["content"]
        if system.startswith("You are checking"):
            return {"content": json.dumps({"checks": [{"n": 1, "ink": "Narsimha"}], "keep": [1, 3]})}
        return {"content": json.dumps({"errors": [
            {"wrong": "P.V. Narsimha Rao", "correct": "P.V. Narasimha Rao", "kind": "spelling", "symbol": "X"},
            {"wrong": "Jake", "correct": "fake", "kind": "spelling"},          # misread: filtered
            {"wrong": "were democratic", "correct": "were dramatic", "kind": "word"},
        ]})}


def test_find_errors_runs_bands_without_failover_and_reports_checked_pages():
    img = Image.new("RGB", (1000, 1000), "white")
    llm = _FakeLLM()
    by_row, checked = asyncio.run(lv.find_errors(
        llm, {"pages": [PAGE]}, None, model="z-ai/glm-5.3-flashx",
        scheme=ds.parse({"deduction_scheme": SCHEME}), images={"p2": img}))
    assert checked == {"p2"}
    assert all(c.get("fallback_models") == [] for c in llm.calls)       # GLM only
    assert by_row["p2_r1"][0]["correct"] == "P.V. Narasimha Rao"
    # "were democratic" was not kept by the verifier (keep = [1, 3] of 2 candidates).
    assert "p2_r2" not in by_row
    # No images: the caller falls back to the transcript pass.
    assert asyncio.run(lv.find_errors(llm, {"pages": [PAGE]}, None, model="m")) is None


def test_answer_pages():
    layout = {"pages": [{"page_id": "p1", "lines": [{"line_id": "p1_r1"}]},
                        {"page_id": "p2", "lines": [{"line_id": "p2_r1"}]},
                        {"page_id": "p3", "lines": [{"line_id": "p3_r1"}]}]}
    assert lf.answer_pages(["p1_r1", "p2_r1"], layout) == {"p1", "p2"}
    assert lf.answer_pages(None, layout) == set()


# ------------------------------------------------------------------ evaluation table

def _sheet():
    """A grey photographed page with a ruled table: a header row and two part
    rows, ten columns, and the page's own border ruled below it."""
    img = Image.new("L", (1200, 900), 200)
    d = ImageDraw.Draw(img)
    xs = [100 + i * 100 for i in range(11)]
    for y in (100, 300, 400, 480):
        d.line([(xs[0], y), (xs[-1], y)], fill=120, width=2)
    for x in xs:
        d.line([(x, 300), (x, 480)], fill=120, width=2)
        if x in (xs[0], xs[1], xs[2], xs[6], xs[7], xs[8], xs[9], xs[10]):
            d.line([(x, 100), (x, 300)], fill=120, width=2)
    d.line([(0, 560), (1199, 560)], fill=120, width=2)       # page border, not the table
    return img, xs


def test_grid_finds_the_part_rows_and_columns_of_a_faint_table():
    img, xs = _sheet()
    bands, vs = et.grid(et.dark_mask(img))
    assert len(bands) == 3
    assert abs(bands[-1][0] - 400) <= 3 and abs(bands[-1][1] - 480) <= 3
    assert len(vs) == 11 and all(abs(a - b) <= 3 for a, b in zip(vs, xs))
    cells = et.cells(bands, vs, 2)
    assert len(cells) == 2 and len(cells[0]) == 10


def test_assign_writes_counts_and_marks_into_their_columns():
    columns = [{"role": "sn"}, {"role": "code"}, {"role": "part"}, {"role": "count", "symbol": "/"},
               {"role": "count", "symbol": "X"}, {"role": "count", "symbol": "#"}, {"role": "deducted"},
               {"role": "obtained"}, {"role": "percent"}, {"role": "remarks"}]
    row = {"part": "A", "counts": {"X": 12, "/": 3, "#": 1}, "deducted": 18.5, "obtained": 31.5,
           "max": 50.0, "percent": 63.0}
    cells = [(i, 0, i + 1, 1) for i in range(10)]
    got = {c[0]: t for c, t in et.assign(columns, cells, row)}
    assert got == {3: "3", 4: "12", 5: "1", 6: "18.5", 7: "31.5", 8: "63%"}
    assert et.assign(columns[:-1], cells, row) == []          # column count must agree


def test_table_box_from_printed_rows():
    page = {"page_id": "p1", "width": 1000, "height": 2000, "lines": [
        {"line_id": "p1_r1", "printed": True, "text": "FORMAT FOR EVALUATION SHEET", "box": [100, 500, 800, 40]},
        {"line_id": "p1_r2", "text": "Marks deducted", "box": [100, 600, 800, 40]},     # not printed
    ]}
    assert et.table_box(page) == (0, 440, 1000, 1200)
    assert et.table_box({"lines": []}) is None
    cols, parts = et.parse_layout('```json\n{"columns": [{"role": "sn"}], "parts": ["A", "B"]}\n```')
    assert cols == [{"role": "sn"}] and parts == ["A", "B"]


def test_apply_scheme_marks_read_answers_and_letters_parts_in_written_order():
    from app.services.copy_check import orchestrator

    layout = {"pages": [{"page_id": "p1", "lines": [{"line_id": "p1_r1"}, {"line_id": "p1_r2"}]},
                        {"page_id": "p2", "lines": [{"line_id": "p2_r1"}]},
                        {"page_id": "p3", "lines": [{"line_id": "p3_r1"}]}]}
    questions = [{"question_id": "q1", "question_type": "LONG_ANSWER"},
                 {"question_id": "q2", "question_type": "LONG_ANSWER"},
                 {"question_id": "q3", "question_type": "LONG_ANSWER"},
                 {"question_id": "q4", "question_type": "MCQS"}]
    verdicts = [
        # Q1 written second (page 2), Q2 first (page 1).
        {"question_id": "q1", "marks_awarded": 10, "max_marks": 50, "answer_rows": ["p2_r1", "p2_r1"],
         "annotations": [{"style": "score", "text": "10/50"}]},
        {"question_id": "q2", "marks_awarded": 10, "max_marks": 50, "answer_rows": ["p1_r1", "p1_r2"],
         "annotations": []},
        # On a page the language pass did not read: keeps the grader's mark.
        {"question_id": "q3", "marks_awarded": 7, "max_marks": 50, "answer_rows": ["p3_r1", "p3_r1"]},
        {"question_id": "q4", "marks_awarded": 1, "max_marks": 1, "answer_rows": ["p1_r2", "p1_r2"]},
    ]
    found = {"q1": [{"symbol": "#", "count": 1}], "q2": [{"symbol": "X", "count": 2}, {"symbol": "/", "count": 1}]}
    table = asyncio.run(orchestrator._apply_scheme(
        verdicts, questions, ds.parse({"deduction_scheme": SCHEME}), found, {"p1", "p2"}, layout,
        llm=None, model="m", page_images=None, institute_id=None, token_sink=None))
    marks = {v["question_id"]: v["marks_awarded"] for v in verdicts}
    assert marks == {"q1": 45.0, "q2": 47.5, "q3": 7, "q4": 1}
    assert verdicts[0]["annotations"][0]["text"] == "45/50"
    assert [(r["part"], r["obtained"]) for r in table["rows"]] == [("A", 47.5), ("B", 45.0)]
    assert "located" not in table


def test_a_hindi_answer_keeps_the_graders_mark_under_the_scheme():
    from app.services.copy_check import orchestrator

    layout = {"pages": [{"page_id": "p1", "lines": [
        {"line_id": "p1_r1", "text": "भारत के पास आयुर्वेद के रूप में समृद्ध विरासत है"}]}]}
    v = {"question_id": "q1", "marks_awarded": 17, "max_marks": 50, "answer_rows": ["p1_r1", "p1_r1"],
         "feedback": "Paragraph-wise deductions."}
    table = asyncio.run(orchestrator._apply_scheme(
        [v], [{"question_id": "q1", "question_type": "LONG_ANSWER"}], ds.parse({"deduction_scheme": SCHEME}),
        {"q1": [{"symbol": "X", "count": 1}]}, {"p1"}, layout, llm=None, model="m", page_images=None,
        institute_id=None, token_sink=None))
    assert v["marks_awarded"] == 17
    assert table["rows"][0] == {"part": "A", "counts": {"X": 1, "/": 0, "#": 0}, "deducted": 33.0,
                                "obtained": 17.0, "max": 50.0, "percent": 34.0,
                                "paragraph_wise": True, "remarks": "Para-wise"}
    assert "marked on the copy" in v["feedback"]
