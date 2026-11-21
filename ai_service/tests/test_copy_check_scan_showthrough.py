"""Scan Station show-through pairing (scan/showthrough.py). Synthetic sheets, no network.

Six sheets whose backs are faint mirrored copies of their fronts plus their
own blue-pen writing. The pairing must find the backs' order and rotation, put
a single swapped pair on review, block a pile shifted by one sheet, ask when
the evidence is weak, and never build the n x n matrix.
"""
from __future__ import annotations

import pytest

from app.services.copy_check.scan import showthrough as st
from copy_check_scan_synth import back_page, dmap, paper, pile, rot180, write_lines

N = 6
MARGIN = 0.15


@pytest.fixture(scope="module")
def sheets():
    fronts, backs = pile(N, labels={0, 2, 4}, written_backs={0, 1, 3, 5}, seed=11)
    return [dmap(f) for f in fronts], [dmap(b) for b in backs], fronts


def test_same_order(sheets):
    f, b, _ = sheets
    lay = st.choose_layout(f, b, MARGIN)
    assert (lay.backs_order, lay.backs_rotation) == ("SAME", 0)
    assert not lay.order_uncertain and lay.order_margin >= MARGIN
    assert all(r.is_row_max for r in lay.rows) and lay.not_row_max == [] and lay.shift is None


def test_reversed_order(sheets):
    f, b, _ = sheets
    lay = st.choose_layout(f, list(reversed(b)), MARGIN)
    assert (lay.backs_order, lay.backs_rotation) == ("REVERSED", 0)
    assert not lay.order_uncertain
    assert lay.not_row_max == [] and lay.shift is None


def test_backs_upside_down(sheets):
    _f, _b, fronts = sheets
    f = [dmap(x) for x in fronts]
    # the backs pass went through the feeder the other way up
    _, backs = pile(N, labels={0, 2, 4}, written_backs={0, 1, 3, 5}, seed=11)
    b = [dmap(rot180(x)) for x in reversed(backs)]
    lay = st.choose_layout(f, b, MARGIN)
    assert (lay.backs_order, lay.backs_rotation) == ("REVERSED", 180)
    assert lay.not_row_max == [] and lay.shift is None


def test_one_swapped_pair_is_flagged_on_exactly_those_rows(sheets):
    f, b, _ = sheets
    swapped = list(b)
    # (not 2 and 3: with 6 sheets those are each other's REVERSED partners)
    swapped[1], swapped[2] = swapped[2], swapped[1]
    lay = st.choose_layout(f, swapped, MARGIN)
    assert lay.backs_order == "SAME"
    assert lay.not_row_max == [1, 2]
    assert lay.shift is None
    assert lay.rows[1].row_max_offset == 1 and lay.rows[2].row_max_offset == -1


def test_one_sheet_offset_from_row_3_is_a_shift(sheets):
    f, b, _ = sheets
    extra = dmap(back_page(write_lines(paper(), seed=999, top=200), seed=999, written=True))
    shifted = b[:3] + [extra] + b[3:5]      # a stray sheet in the backs pile from position 3
    lay = st.choose_layout(f, shifted, MARGIN)
    assert lay.backs_order == "SAME"
    assert lay.shift == {"from_sheet": 3, "offset": 1}
    assert 3 not in lay.not_row_max and 4 not in lay.not_row_max


def test_no_show_through_is_order_uncertain_and_prefers_reversed():
    fronts = [dmap(write_lines(paper(), seed=300 + i, top=200)) for i in range(N)]
    # backs from different sheets: no show-through of these fronts at all
    backs = [dmap(write_lines(paper(), seed=700 + i, top=200)) for i in range(N)]
    lay = st.choose_layout(fronts, backs, MARGIN)
    assert lay.order_uncertain
    assert lay.backs_order == "REVERSED"


def test_single_sheet_scores_rotations_only(sheets):
    f, b, _ = sheets
    lay = st.choose_layout([f[1]], [st.rot180(b[1])], MARGIN)
    assert (lay.backs_order, lay.backs_rotation) == ("SAME", 180)
    assert lay.rows[0].is_row_max and lay.rows[0].runner_up is None
    assert set(lay.hypothesis_scores) == {"rot0_SAME", "rot180_SAME"}


def test_unreadable_page_scores_zero(sheets):
    f, b, _ = sheets
    lay = st.choose_layout(f, b[:2] + [None] + b[3:], MARGIN)
    assert lay.backs_order == "SAME"
    assert lay.rows[2].pair_score == 0.0


def test_pair_score_is_called_linearly_not_n_squared(monkeypatch):
    n = 12
    fronts, backs = pile(n, labels={0, 4, 8}, written_backs=set(range(0, n, 2)), seed=5)
    f = [dmap(x) for x in fronts]
    b = [dmap(x) for x in reversed(backs)]
    calls = {"n": 0}
    real = st.pair_score

    def counting(a, c):
        calls["n"] += 1
        return real(a, c)

    monkeypatch.setattr(st, "pair_score", counting)
    lay = st.choose_layout(f, b, MARGIN)
    assert lay.backs_order == "REVERSED"
    assert calls["n"] <= 4 * n + 5 * n
    assert calls["n"] < n * n
    assert calls["n"] <= st.count_calls_bound(n)


def test_dark_map_ignores_rules_and_margin():
    blank = dmap(paper())
    assert blank.shape == (212, 150)
    assert float(blank.max()) < 1.0
