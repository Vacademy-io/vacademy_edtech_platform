"""Offline tests for the copy-check vision transcription stage.

Covers the parts that decide whether a student's mark is trustworthy:
  - word-level OCR boxes merge into real visual rows (annotation anchoring)
  - an oversized artefact box cannot swallow the lines below it
  - the transcript quality gate refuses to grade an unreadable copy
  - the grading prompt prefers the vision reading and labels a raw-OCR page
    as unreliable instead of presenting it as fact
  - the reasoning shape is seeded for models that cannot disable reasoning

No network. Run:
    cd vacademy_platform/ai_service && PYTHONPATH=.. APP_ENV=local \
        .venv/bin/python tests/test_copy_check_vision_transcript.py
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from ai_service.app.services.chat_llm_client import (
    apply_reasoning_mode,
    payload_variants,
    reasoning_mode_for,
)
from ai_service.app.services.copy_check.annotator import _free_slot, _latin1, _note_rect
from ai_service.app.services.copy_check.validator import validate_and_cap
from ai_service.app.services.copy_check.grader import _breakdown_contradicts_total
from ai_service.app.services.copy_check.prompt_builder import _transcript_for_prompt
from ai_service.app.services.copy_check.vision_transcript import (
    MAX_UNLISTED_PER_PAGE,
    _build_page_prompt,
    add_unlisted_rows,
    assess_quality,
    merge_words_into_rows,
)

failures: list[str] = []


def check(label: str, cond: bool, detail: str = "") -> None:
    if cond:
        print(f"  PASS  {label}")
    else:
        failures.append(f"{label}: {detail}")
        print(f"  FAIL  {label} — {detail}")


def _word(page_id: str, n: int, text: str, box: list[int], conf: float = 0.5) -> dict:
    return {"line_id": f"{page_id}_{n}", "text": text, "box": box, "conf": conf}


def test_rows_from_words() -> None:
    print("\nmerge_words_into_rows — three clean lines")
    page = {"page_id": "p1", "lines": []}
    n = 0
    for r, y in enumerate((100, 140, 180)):
        for c in range(4):
            n += 1
            page["lines"].append(_word("p1", n, f"w{r}{c}", [50 + c * 90, y, 80, 24]))
    rows = merge_words_into_rows(page)
    check("three rows recovered", len(rows) == 3, f"got {len(rows)}")
    check("words joined in x order", rows[0]["text"] == "w00 w01 w02 w03", rows[0]["text"])
    check("row box spans the whole line", rows[0]["box"] == [50, 100, 350, 24], str(rows[0]["box"]))
    check("row ids are page-scoped", rows[0]["line_id"] == "p1_r1", rows[0]["line_id"])
    check(
        "source word ids retained",
        rows[0]["source_word_ids"] == ["p1_1", "p1_2", "p1_3", "p1_4"],
        str(rows[0]["source_word_ids"]),
    )


def test_artefact_does_not_swallow_lines() -> None:
    print("\nmerge_words_into_rows — an oversized artefact box stays isolated")
    # A scan artefact 1200px tall. Without the height guard its band absorbs
    # every word below it and a `strike` anchored to the row is drawn across
    # the entire answer.
    page = {
        "page_id": "p2",
        "lines": [
            _word("p2", 1, "blob", [10, 0, 1400, 1200], 0.2),
            _word("p2", 2, "real", [50, 1210, 300, 26], 0.6),
            _word("p2", 3, "line", [360, 1212, 300, 26], 0.6),
        ],
    }
    rows = merge_words_into_rows(page)
    check("artefact did not absorb the text line", len(rows) == 2, f"got {len(rows)} rows")
    check("real line survived intact", rows[-1]["text"] == "real line", rows[-1]["text"])
    check("real line's box is line-height", rows[-1]["box"][3] < 60, str(rows[-1]["box"]))


def test_sloping_line_stays_one_row() -> None:
    print("\nmerge_words_into_rows — a sloping handwritten line stays one row")
    page = {
        "page_id": "p3",
        "lines": [_word("p3", i, f"x{i}", [50 + i * 90, 100 + i * 3, 80, 24]) for i in range(6)],
    }
    rows = merge_words_into_rows(page)
    check("slope did not split the line", len(rows) == 1, f"got {len(rows)} rows")


def test_empty_page() -> None:
    print("\nmerge_words_into_rows — a page with no boxes")
    check("no rows, no crash", merge_words_into_rows({"page_id": "p9", "lines": []}) == [])
    check("missing boxes ignored", merge_words_into_rows(
        {"page_id": "p9", "lines": [{"line_id": "a", "text": "x"}]}) == [])


def test_quality_gate() -> None:
    print("\nassess_quality — the gate that keeps unreadable copies away from a grade")
    garbage = {"pages": [{"page_id": "p1", "lines": [{"line_id": "a", "text": "yr"}]}]}
    q = assess_quality(garbage)
    check("garbage copy is not gradeable", q["gradeable"] is False, str(q))

    good = {"pages": [{"page_id": "p1", "vision_text": "x" * 900,
                       "vision_ocr": True, "vision_legible": True, "lines": []}]}
    check("a real read is gradeable", assess_quality(good)["gradeable"] is True)

    # Half the pages legible is the documented floor, so a 4-page copy with 2
    # good pages must still pass — a student who left pages blank is not an
    # unreadable scan.
    mixed = {"pages": [
        {"page_id": "p1", "vision_text": "x" * 900, "vision_ocr": True},
        {"page_id": "p2", "vision_text": "y" * 900, "vision_ocr": True},
        {"page_id": "p3", "vision_text": "", "vision_ocr": True},
        {"page_id": "p4", "vision_text": "", "vision_ocr": True},
    ]}
    check("half-legible copy still grades", assess_quality(mixed)["gradeable"] is True,
          str(assess_quality(mixed)))

    check("no pages is not gradeable", assess_quality({"pages": []})["gradeable"] is False)


def test_prompt_prefers_vision_text() -> None:
    print("\n_transcript_for_prompt — the grader reads the vision transcript")
    layout = {"pages": [{
        "page_id": "p1",
        "vision_text": "Master Dev was admitted to the benefits of partnership as a minor.",
        "vision_ocr": True,
        "lines": [
            {"line_id": "p1_r1", "text": "Q3. Discuss Dev's liability.", "printed": True},
            {"line_id": "p1_r2", "text": "Master Dev was admitted to the benefits"},
            {"line_id": "p1_r3", "text": "", "illegible": True},
        ],
        "regions": [],
    }]}
    out = _transcript_for_prompt(layout)
    check("verbatim reading is present", "Verbatim reading of this page:" in out)
    check("page text is included", "benefits of partnership as a minor" in out)
    check("row ids remain available as anchors", "[p1_r2]" in out)
    check("printed question text is labelled", "(printed question text)" in out)
    check("illegible row is marked, not blank", "[p1_r3] <illegible>" in out)
    check("no unreliable-OCR warning on a vision page", "NOT read by the handwriting model" not in out)


def test_prompt_flags_raw_ocr() -> None:
    print("\n_transcript_for_prompt — a raw-OCR page is labelled unreliable")
    layout = {"pages": [{
        "page_id": "p1",
        "lines": [{"line_id": "p1_r1", "text": "yromrp Maccidinta!"}],
        "regions": [],
    }]}
    out = _transcript_for_prompt(layout)
    check("raw OCR page carries the warning", "NOT read by the handwriting model" in out)
    check("model is told to lower confidence", "LOW confidence" in out)
    check("text is still supplied", "yromrp" in out)


def test_marks_quantised_to_halves() -> None:
    print("\nvalidator — marks are awarded in halves, the way an examiner writes them")
    q = {"question_id": "Q1", "max_marks": 10.0}
    layout = {"pages": []}

    def grade(m):
        return validate_and_cap(
            {"marks_awarded": m, "criteria_breakdown": [
                {"criteria_name": "a", "marks": m * 0.6},
                {"criteria_name": "b", "marks": m * 0.4}]}, q, layout)

    # 4.4/10 is not a mark any human writes on a script; it is a tell that the
    # paper was machine-marked.
    check("4.4 rounds to 4.5", grade(4.4)["marks_awarded"] == 4.5)
    check("3.3 rounds to 3.5", grade(3.3)["marks_awarded"] == 3.5)
    check("a half mark is left alone", grade(6.5)["marks_awarded"] == 6.5)
    check("a whole mark is left alone", grade(6.0)["marks_awarded"] == 6.0)

    # The per-criterion trace must still add up to the number actually awarded,
    # or the audit trail contradicts the mark it justifies.
    for m in (4.4, 7.75, 3.3, 9.9):
        r = grade(m)
        bsum = round(sum(c["marks"] for c in r["criteria_breakdown"]), 2)
        check(f"breakdown still sums after quantising {m}",
              abs(bsum - r["marks_awarded"]) < 0.02, f"{bsum} vs {r['marks_awarded']}")

    # Rounding must never push a student above the maximum.
    check("9.9 cannot exceed the max", grade(9.9)["marks_awarded"] <= 10.0)
    check("a full mark stays full", grade(10.0)["marks_awarded"] == 10.0)
    check("zero stays zero", grade(0.0)["marks_awarded"] == 0.0)


def test_latin1_transliteration() -> None:
    print("\nannotator — pen notes survive a Latin-1-only font")
    # PyMuPDF base-14 fonts are Latin-1; unmapped glyphs render as "?", which
    # made feedback read like corrupted output ("s.16 never appears ? and...").
    out = _latin1("cite s.21 \u2014 refund \u20b985,000 \u2026")
    check("em dash transliterated", "\u2014" not in out, out)
    check("rupee sign transliterated", "Rs." in out, out)
    check("ellipsis transliterated", "..." in out, out)
    check("nothing became a question mark", "?" not in out, out)
    check("a real question mark survives", _latin1("why? ok") == "why? ok", _latin1("why? ok"))
    check("empty input is safe", _latin1("") == "")


def test_note_slot_avoids_occupied() -> None:
    print("\nannotator — a pen note never lands on the student's writing")
    try:
        import fitz  # PyMuPDF: in requirements.txt, but often absent locally
    except ModuleNotFoundError:
        print("  SKIP  PyMuPDF not installed in this venv (pip install pymupdf to run)")
        return

    class FakePage:
        rect = fitz.Rect(0, 0, 595, 842)

    page = FakePage()
    # One line of writing across the middle of the page.
    writing = [fitz.Rect(50, 400, 500, 424)]

    # A candidate sitting on top of the writing must be rejected...
    on_top = _free_slot([(60, 405)], writing, 200, 12, page)
    check("a slot overlapping writing is refused", on_top is None, str(on_top))

    # ...and a clear one below it accepted.
    clear = _free_slot([(60, 405), (60, 440)], writing, 200, 12, page)
    check("the first clear slot is used", clear == (60, 440), str(clear))

    off_page = _free_slot([(60, 838)], [], 200, 12, page)
    check("a slot running off the page bottom is refused", off_page is None, str(off_page))

    too_wide = _free_slot([(500, 100)], [], 200, 12, page)
    check("a slot running off the right edge is refused", too_wide is None, str(too_wide))

    r = _note_rect((60, 440), 200, 12)
    check("a placed note reports its own rect", (r.x0, r.y0, r.x1, r.y1) == (60, 440, 260, 452), str(r))
    # That rect is what stops a second note printing on top of the first.
    check("a placed note blocks the same slot",
          _free_slot([(60, 440)], [r], 200, 12, page) is None)


def test_breakdown_contradiction_detected() -> None:
    print("\ngrader — a per-criterion trace that contradicts the mark is caught")
    # The model sometimes zeroes every criterion while its own `reason` text says
    # "Full marks" and marks_awarded is non-zero. validator cannot repair that
    # (its rescale divides by the breakdown sum), so it must be caught earlier.
    bad = {"marks_awarded": 6.0, "criteria_breakdown": [
        {"criteria_name": "A", "marks": 0, "reason": "Full marks"},
        {"criteria_name": "B", "marks": 0, "reason": "Full marks"},
    ]}
    check("all-zero breakdown against a non-zero mark is flagged",
          _breakdown_contradicts_total(bad) is True)

    good = {"marks_awarded": 6.0, "criteria_breakdown": [
        {"criteria_name": "A", "marks": 3.0, "reason": "ok"},
        {"criteria_name": "B", "marks": 3.0, "reason": "ok"},
    ]}
    check("a consistent breakdown is not flagged", _breakdown_contradicts_total(good) is False)

    # A genuinely zero answer is consistent, not contradictory — it must not
    # trigger a pointless re-ask on every unattempted question.
    zero = {"marks_awarded": 0.0, "criteria_breakdown": [
        {"criteria_name": "A", "marks": 0, "reason": "not attempted"},
    ]}
    check("zero marks with a zero breakdown is fine", _breakdown_contradicts_total(zero) is False)

    check("no breakdown at all is not flagged",
          _breakdown_contradicts_total({"marks_awarded": 5.0, "criteria_breakdown": []}) is False)
    check("non-numeric marks are flagged",
          _breakdown_contradicts_total({"marks_awarded": 5.0, "criteria_breakdown": [
              {"criteria_name": "A", "marks": "three"}]}) is True)


def test_reasoning_shape_seeded() -> None:
    print("\nchat_llm_client — GLM's mandatory-reasoning shape is seeded")
    # Without this, copy-check (which runs with reasoning suppression OFF) sends
    # no reasoning key at all, and the model spends the whole max_tokens budget
    # thinking and returns empty content.
    check("glm-5.3-flash seeded on-low", reasoning_mode_for("z-ai/glm-5.3-flash") == "on-low",
          str(reasoning_mode_for("z-ai/glm-5.3-flash")))

    base = {"model": "z-ai/glm-5.3-flash", "messages": [], "temperature": 0.1, "max_tokens": 4000}
    variants = payload_variants("z-ai/glm-5.3-flash", base)
    check("a seeded model sends exactly one shape", len(variants) == 1, str(len(variants)))
    label, payload = variants[0]
    check("that shape is on-low", label == "on-low", label)
    check("reasoning is explicitly enabled",
          payload["reasoning"] == {"enabled": True, "effort": "low"}, str(payload.get("reasoning")))
    check("output cap raised above the caller's ask",
          payload["max_tokens"] > 4000, str(payload["max_tokens"]))

    # An un-seeded model must be untouched — this seeding is a targeted fix,
    # not a global behaviour change.
    plain = payload_variants("google/gemini-2.5-flash", dict(base, model="google/gemini-2.5-flash"))
    check("un-seeded model still sends as-configured", plain[0][0] == "as-configured", plain[0][0])
    check("un-seeded model gets no reasoning key", "reasoning" not in plain[0][1])

    bumped = apply_reasoning_mode({"max_tokens": 8000}, "on-low")
    check("grading cap leaves room to think", bumped["max_tokens"] >= 8000, str(bumped["max_tokens"]))


def _row(n: int, y: int, text: str, h: int = 150, x: int = 300, w: int = 1200) -> dict:
    return {"line_id": f"p1_r{n}", "text": text, "box": [x, y, w, h], "conf": 0.9}


def test_unlisted_line_gets_a_row() -> None:
    print("\nadd_unlisted_rows — a line the OCR missed gets a row in its gap")
    # 2026-09-30: the detector's box for "ans3. We, the People of India" was
    # dropped, and the vision prompt forbade inventing rows - so the answer
    # never reached the grader and was marked "not attempted".
    rows = [_row(1, 1268, "ans2. Rule by the people"), _row(2, 1867, "ans4. Temperature.")]
    out, orphans = add_unlisted_rows(
        rows, [{"after": "p1_r1", "text": "ans3. We, the People of India."}], "p1", 5556)
    new = [r for r in out if r.get("unlisted")]
    check("one row added", len(new) == 1, str(new))
    check("no orphans", orphans == [], str(orphans))
    if new:
        r = new[0]
        top, bottom = 1268 + 150, 1867
        check("it sits in the gap between its neighbours",
              top <= r["box"][1] and r["box"][1] + r["box"][3] <= bottom, str(r["box"]))
        check("it keeps the model's text", r["text"] == "ans3. We, the People of India.")
        check("its id cannot collide with an OCR row", r["line_id"] == "p1_u1", r["line_id"])
        check("rows stay in reading order",
              [x["line_id"] for x in out] == ["p1_r1", "p1_u1", "p1_r2"],
              str([x["line_id"] for x in out]))
        check("it is not sent to Mathpix", r["needs_math_fallback"] is False)


def test_unlisted_rows_never_forced_in() -> None:
    print("\nadd_unlisted_rows — no box on top of another line, no duplicates")
    rows = [_row(1, 1000, "ans1. Economics."), _row(2, 1160, "ans2. Rule by the people"),
            _row(3, 1700, "ans4. Temperature.")]
    out, orphans = add_unlisted_rows(rows, [
        {"after": "p1_r1", "text": "squeezed line"},           # 10px gap
        {"after": "p1_r9", "text": "unknown anchor"},
        {"after": "p1_r2", "text": "ANS2.  rule by the people"},  # already a row
        {"after": "p1_r2", "text": "ans3. first"},
        {"after": "p1_r2", "text": "ans3. second"},
        {"after": None, "text": "a heading above everything"},
        {"after": "p1_r2", "text": "[illegible]"},
        "not a dict",
    ], "p1", 5556)
    new = [r for r in out if r.get("unlisted")]
    texts = [r["text"] for r in new]
    check("a gap too thin for a line gets no row", "squeezed line" not in texts, str(texts))
    check("...but its text is handed back for the prose", "squeezed line" in orphans, str(orphans))
    check("an unknown anchor is handed back, not guessed", "unknown anchor" in orphans, str(orphans))
    check("a re-listed existing row is ignored",
          not any("rule by the people" in t.lower() for t in texts + orphans), str(texts + orphans))
    check("illegible adds nothing", "[illegible]" not in texts + orphans)
    two = [r for r in new if r["text"].startswith("ans3.")]
    check("two lines after one row both get rows", len(two) == 2, str(texts))
    if len(two) == 2:
        a, b = sorted(two, key=lambda r: r["box"][1])
        check("...that do not overlap", a["box"][1] + a["box"][3] <= b["box"][1], f"{a['box']} {b['box']}")
        check("...and stay inside the gap",
              a["box"][1] >= 1160 + 150 and b["box"][1] + b["box"][3] <= 1700, f"{a['box']} {b['box']}")
    head = next((r for r in new if r["text"].startswith("a heading")), None)
    check("after=None goes above the first row", head is not None and head["box"][1] + head["box"][3] <= 1000,
          str(head))
    check("ids stay unique", len({r["line_id"] for r in out}) == len(out))

    flood = [{"after": "p1_r2", "text": f"line {i}"} for i in range(MAX_UNLISTED_PER_PAGE + 5)]
    out, orphans = add_unlisted_rows(rows, flood, "p1", 5556)
    check("a model re-transcribing the page is capped",
          len(out) - len(rows) + len(orphans) <= MAX_UNLISTED_PER_PAGE, f"{len(out) - len(rows)} + {len(orphans)}")

    same, none = add_unlisted_rows(rows, None, "p1", 5556)
    check("no unlisted lines leaves the rows alone", same is rows and none == [])


def test_unlisted_line_fills_the_blank_row() -> None:
    print("\nadd_unlisted_rows — a line the model left blank goes back in ITS box")
    # 2026-10-01 run: the model returned the unread ans3/ans7 rows blank and
    # listed their text as unlisted. A new box squeezed into the gap above
    # put ans7's tick half a line high; ans3, with no gap, got no row and its
    # tick went on ans2.
    rows = [_row(1, 1268, "ans2. Rule by the people"), _row(2, 1571, "", h=229),
            _row(3, 1867, "ans4. Temperature.")]
    out, orphans = add_unlisted_rows(
        rows, [{"after": "p1_r1", "text": "ans3. We, the People of India."}], "p1", 5556)
    check("no new row is invented", not any(r.get("unlisted") for r in out), str(out))
    check("nothing orphaned", orphans == [], str(orphans))
    filled = next(r for r in out if r["line_id"] == "p1_r2")
    check("the blank OCR row now holds the line",
          filled["text"] == "ans3. We, the People of India." and filled.get("recovered"), str(filled))
    check("it keeps the OCR's own box", filled["box"] == [300, 1571, 1200, 229], str(filled["box"]))

    rows = [_row(1, 1268, "ans2"), _row(2, 1500, "", h=60), _row(3, 1867, "ans4")]
    out, _ = add_unlisted_rows(rows, [{"after": "p1_r1", "text": "one"},
                                      {"after": "p1_r1", "text": "two"}], "p1", 5556)
    new = [r for r in out if r.get("unlisted")]
    check("a second line takes the gap after the filled row",
          len(new) == 1 and new[0]["box"][1] >= 1560 and new[0]["box"][1] + new[0]["box"][3] <= 1867,
          str([r["box"] for r in new]))


def test_prompt_admits_missed_lines() -> None:
    print("\n_build_page_prompt — the model may add a line the OCR missed")
    prompt = _build_page_prompt([_row(1, 100, "")], "p1", 5556)
    check("asks for unlisted_lines", '"unlisted_lines"' in prompt)
    check("no longer claims the OCR found every line", "located every line" not in prompt)
    check("page prose must include unlisted lines", "unlisted lines included" in prompt)
    check("an unread row is announced as writing, not as empty",
          "(writing the OCR could not read)" in prompt and "(no OCR text)" not in prompt)


if __name__ == "__main__":
    test_unlisted_line_gets_a_row()
    test_unlisted_rows_never_forced_in()
    test_unlisted_line_fills_the_blank_row()
    test_prompt_admits_missed_lines()
    test_rows_from_words()
    test_artefact_does_not_swallow_lines()
    test_sloping_line_stays_one_row()
    test_empty_page()
    test_quality_gate()
    test_prompt_prefers_vision_text()
    test_prompt_flags_raw_ocr()
    test_marks_quantised_to_halves()
    test_latin1_transliteration()
    test_note_slot_avoids_occupied()
    test_breakdown_contradiction_detected()
    test_reasoning_shape_seeded()

    print()
    if failures:
        print(f"{len(failures)} FAILURE(S):")
        for f in failures:
            print("  -", f)
        sys.exit(1)
    print("All copy-check vision transcription tests passed.")
