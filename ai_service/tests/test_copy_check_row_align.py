"""row_align: OCR rows paired with the ink lines they are written on."""
import numpy as np

from app.services.copy_check import deduction_scheme, evaluation_table, row_align


def _page(lines_words, line_h=20, gap=20, width=600, top=40):
    """A boolean ink image with one line of writing per entry (n words each)."""
    h = top + len(lines_words) * (line_h + gap) + 40
    ink = np.zeros((h, width), dtype=bool)
    tops = []
    for k, n in enumerate(lines_words):
        t = top + k * (line_h + gap)
        tops.append(t)
        x = 20
        for _ in range(n):
            ink[t:t + line_h, x:x + 40] = True
            x += 40 + 20
    return ink, tops


def _near(band, top, h=20):
    return band is not None and abs(band[0] - top) <= 2 and abs(band[1] - (top + h)) <= 2


def test_ink_lines_finds_each_line_and_counts_words():
    ink, tops = _page([3, 5, 2])
    lines = row_align.ink_lines(ink)
    assert all(_near(l, t) for l, t in zip(lines, tops)) and len(lines) == 3
    assert [row_align.word_count(ink, a, b) for a, b in lines] == [3, 5, 2]


def test_rows_boxed_a_line_high_go_to_their_own_words():
    # Five lines of writing; the OCR boxed every row one line above its words.
    words = [6, 3, 7, 4, 5]
    ink, tops = _page(words)
    layout = {"lines": [
        {"line_id": f"p1_r{k + 1}", "text": " ".join(["w"] * n),
         "box": [20, tops[k] - 40, 500, 20]} for k, n in enumerate(words)]}
    bands = row_align.row_bands({"ink": ink, "sy": 1.0}, layout, 1.0)
    for k in range(5):
        assert _near(bands.get(f"p1_r{k + 1}"), tops[k])


def test_header_rows_without_ink_lines_shift_the_pairing():
    # Two header rows (no ink line found for them) push the body down a line.
    words = [4, 6, 3, 5]
    ink, tops = _page(words)
    rows = [{"line_id": "p1_r1", "text": "Name", "box": [20, 0, 100, 10]},
            {"line_id": "p1_r2", "text": "Time 40 min", "box": [20, 10, 100, 10]}]
    rows += [{"line_id": f"p1_r{k + 3}", "text": " ".join(["w"] * n), "box": [20, tops[k] - 40, 500, 20]}
             for k, n in enumerate(words)]
    bands = row_align.row_bands({"ink": ink, "sy": 1.0}, {"lines": rows}, 1.0)
    assert _near(bands.get("p1_r3"), tops[0])
    assert _near(bands.get("p1_r6"), tops[3])


def test_a_far_pairing_is_not_trusted():
    ink, tops = _page([3, 3, 3])
    layout = {"lines": [{"line_id": "p1_r1", "text": "a b c", "box": [20, tops[2] + 200, 500, 20]}]}
    assert row_align.row_bands({"ink": ink, "sy": 1.0}, layout, 1.0) == {}


def test_missing_ink_map_keeps_the_boxes():
    assert row_align.row_bands(None, {"lines": []}, 1.0) == {}
    assert row_align.row_bands({"ink": None, "sy": 1.0}, {"lines": []}, 1.0) == {}


def test_paragraph_wise_part_shows_no_counts_in_the_table():
    scheme = deduction_scheme.parse({"deduction_scheme": [
        {"symbol": "X", "marks": 1}, {"symbol": "/", "marks": 0.5}, {"symbol": "#", "marks": 5}]})
    a = deduction_scheme.Tally(counts={"X": 4, "/": 2, "#": 0}, deducted=5.0, max_marks=50.0)
    b = deduction_scheme.Tally(counts={"X": 2, "/": 0, "#": 1}, deducted=33.0, max_marks=50.0, paragraph_wise=True)
    table = deduction_scheme.table_rows(scheme, [("A", a), ("B", b)])
    row_b = table["rows"][1]
    assert row_b["paragraph_wise"] and row_b["remarks"] == "Para-wise"
    columns = [{"role": "count", "symbol": "X"}, {"role": "deducted"}, {"role": "remarks"}]
    cells = [(0, 0, 1, 1), (1, 0, 2, 1), (2, 0, 3, 1)]
    assert [t for _c, t in evaluation_table.assign(columns, cells, row_b)] == ["-", "33", "Para-wise"]
    assert [t for _c, t in evaluation_table.assign(columns, cells, table["rows"][0])] == ["4", "5"]


def test_each_scheme_correction_carries_what_it_cost():
    verdicts = [
        {"question_id": "q1", "annotations": [
            {"style": "language", "symbol": "X"}, {"style": "language", "symbol": "XX"},
            {"style": "language", "symbol": "/"}, {"style": "language", "symbol": "#×2"},
            {"style": "language"}, {"style": "tick", "symbol": "X"}]},
        {"question_id": "q2", "annotations": [{"style": "language", "symbol": "X"}]},
    ]
    deduction_scheme.mark_deductions(verdicts, {"X": 1, "/": 0.5, "#": 5}, skip=["q2"])
    got = [a.get("deduct") for a in verdicts[0]["annotations"]]
    assert got == [1, 2, 0.5, 10, None, None]
    assert "deduct" not in verdicts[1]["annotations"][0]
