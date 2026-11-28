"""Hindi and Sanskrit copies: remarks in Hindi, on the copy and in the panel.

A Sanskrit/Hindi copy (shlokas with a Hindi भावार्थ) came back with the Hindi
reason missing beside every cut ("0 deducted because (-0.5)"), an English
comments panel that never said why a mark went, and English feedback.
"""
import fitz

from app.services.copy_check import annotator, language_feedback, prompt_builder, raster, remarks


# ------------------------------------------------------------------ remarks.py

def test_hindi_reason_loses_the_marks_lead_even_without_the_word_mark():
    assert remarks._short("0 deducted because श्लोक अशुद्ध और गलत लिखा (p2_r13)") == "श्लोक अशुद्ध और गलत लिखा"
    assert remarks._short("0.5 mark deducted because बिना घास खाए जीवित रहने का भाव छूटा (p2_r10)") \
        == "बिना घास खाए जीवित रहने का भाव छूटा"
    assert remarks._short("0.5 अंक कटे क्योंकि याचक की जगह पाचक लिखा (p5_r9)") == "याचक की जगह पाचक लिखा"
    # English reasons are cut exactly as before.
    assert remarks._short("1 mark deducted because Section 4/6 definition of partnership not stated (p6_r7)") \
        == "Section 4/6 definition of partnership not stated"


def test_a_hindi_part_left_unwritten_is_said_in_hindi():
    verdict = {
        "status": "COMPLETED",
        "annotations": [{"style": "score", "target": "p2_r13", "text": "0/2"}],
        "criteria_breakdown": [
            {"criteria_name": "Point 1", "marks": 0, "max": 0.5,
             "reason": "0 deducted because श्लोक अशुद्ध लिखा (p2_r13)"},
            {"criteria_name": "Point 2", "marks": 0, "max": 0.5, "reason": "0 deducted because भावार्थ लिखा ही नहीं"},
            {"criteria_name": "Point 3", "marks": 0, "max": 0.5, "reason": "0 deducted because भावार्थ लिखा ही नहीं"},
        ],
    }
    assert remarks.add_cut_remarks(verdict, {"p2_r13"}) == 2
    texts = [a["text"] for a in verdict["annotations"] if a["style"] == "deduction_reason"]
    assert texts == ["श्लोक अशुद्ध लिखा (-0.5)", "भावार्थ लिखा ही नहीं (-1)"]
    assert not any("not attempted" in t or "deducted" in t for t in texts)


def test_english_remarks_are_cut_exactly_as_before():
    assert remarks._short("3 deducted because answer incomplete") == "3 deducted because answer incomplete"
    assert remarks._short("2 lost cases not explained") == "2 lost cases not explained"


def test_different_hindi_cuts_keep_their_own_remarks():
    verdict = {"status": "COMPLETED",
               "annotations": [{"style": "score", "target": "p1_r9", "text": "0/2"}],
               "criteria_breakdown": [
                   {"marks": 0, "max": 1, "reason": "0 deducted because भावार्थ नहीं मिला (p1_r3)"},
                   {"marks": 0, "max": 1, "reason": "0 deducted because सही उत्तर नहीं लिखा, याचक की जगह पाचक (p1_r5)"}]}
    remarks.add_cut_remarks(verdict, {"p1_r3", "p1_r5", "p1_r9"})
    got = [(a["target"], a["text"]) for a in verdict["annotations"] if a["style"] == "deduction_reason"]
    assert got == [("p1_r3", "भावार्थ नहीं मिला (-1)"),
                   ("p1_r5", "सही उत्तर नहीं लिखा, याचक की जगह पाचक (-1)")]


def test_reason_text_keeps_the_whole_reason():
    assert remarks.reason_text("1 mark deducted because Good start, but explain both sides (p1_r2)") \
        == "Good start, but explain both sides"
    assert remarks.reason_text("0 deducted because भावार्थ अधूरा (p2_r12)") == "भावार्थ अधूरा"


# ------------------------------------------------------------- grading prompt

def test_only_a_flagged_dashboard_check_is_told_to_write_remarks_in_hindi():
    block = prompt_builder.examiner_instructions_block({"feedback_language": "hi"})
    assert "FEEDBACK LANGUAGE" in block and "Hindi" in block
    # A declared language alone (a partner API, an English paper) keeps the prompt as it was.
    for ctx in ({"answer_language": "hi"}, {"answer_language": "en"}, {"answer_language": "mr"}, {}):
        assert "FEEDBACK LANGUAGE" not in prompt_builder.examiner_instructions_block(ctx)
    assert prompt_builder.examiner_instructions_block({}) == ""


def test_remarks_language_setting():
    assert prompt_builder.remarks_in_copy_language(None)
    assert prompt_builder.remarks_in_copy_language({})
    assert prompt_builder.remarks_in_copy_language({"remarks_language": "AUTO"})
    assert prompt_builder.remarks_in_copy_language({"remarks_language": "something else"})
    assert not prompt_builder.remarks_in_copy_language({"remarks_language": "ENGLISH"})
    assert not prompt_builder.remarks_in_copy_language({"remarks_language": " english "})


def test_the_language_check_prompt_changes_only_when_hindi_notes_are_asked_for():
    from app.services.copy_check import language_vision as lv

    plain = lv.spot_prompt(True, [], "", "hi")
    assert lv.SPOT_HINDI_NOTES.strip() not in plain
    assert lv.SPOT_HINDI_NOTES.strip() in lv.spot_prompt(True, [], "", "hi", hindi_notes=True)
    assert "`why` is written in English" in lv.spot_prompt(False, [], "", "sa")
    assert "`why` is written in Hindi" in lv.spot_prompt(False, [], "", "sa", hindi_notes=True)
    assert lv.spot_prompt(False, [], "", "en", hindi_notes=True) == lv.spot_prompt(False, [], "", "en")
    # A deduction-scheme paper keeps the Hindi check as strict as it was (no spelling line).
    from app.services.copy_check import deduction_scheme as ds
    scheme = ds.parse({"deduction_scheme": [{"symbol": "S", "marks": 0.5, "label": "spelling"}]})
    assert scheme
    with_scheme = lv.spot_prompt(True, scheme, "", "hi", hindi_notes=True)
    assert lv.SPOT_HINDI_SPELLING.strip() not in with_scheme
    assert lv.SPOT_HINDI_NOTES.strip() in with_scheme


def test_indian_script_copies_are_read_by_their_own_model(monkeypatch):
    from app.services.copy_check import answer_language, language_vision

    monkeypatch.setattr(language_vision, "indic_reader_model", lambda: "reader-model")
    assert answer_language.reading_model({"answer_language": "hi"}, "grading-model") == "reader-model"
    assert answer_language.reading_model({"answer_language": "en"}, "grading-model") == "grading-model"
    assert answer_language.reading_model({}, "grading-model") == "grading-model"
    assert language_vision.HARD_FALLBACK_MODEL == "z-ai/glm-5.3-flashx"   # English language check unchanged


# ---------------------------------------------------------- the checked copy

def _scan() -> tuple[bytes, dict]:
    src = fitz.open()
    page = src.new_page(width=595, height=842)
    lines = []
    y = 90
    for i, text in enumerate(["line one of the answer", "line two of the answer", "line three"]):
        page.insert_text((48, y), text, fontsize=12, color=(0.1, 0.15, 0.5))
        lines.append({"line_id": f"L{i}", "text": text, "box": [92, (y - 12) * 2, 900, 32]})
        y += 34
    pix = page.get_pixmap(dpi=144)
    scan = fitz.open()
    scan.new_page(width=595, height=842).insert_image(fitz.Rect(0, 0, 595, 842), pixmap=pix)
    return scan.tobytes(), {"pages": [{"page_id": "P1", "width": 1190, "height": 1684, "lines": lines}]}


def _hindi_verdicts() -> list:
    return [
        {"question_id": "q1", "question_number": 1, "marks_awarded": 0, "max_marks": 2,
         "feedback": "कॉपी में इस श्लोक का भावार्थ नहीं मिला।", "annotations": []},
        {"question_id": "q2", "question_number": 2, "marks_awarded": 1, "max_marks": 2,
         "feedback": "श्लोक सही लिखा है, भावार्थ अधूरा है।",
         "criteria_breakdown": [
             {"criteria_name": "Point 1", "marks": 0.5, "max": 0.5, "reason": "श्लोक सही"},
             {"criteria_name": "Point 3", "marks": 0, "max": 0.5,
              "reason": "0.5 mark deducted because बिना घास खाए जीवित रहने का भाव छूटा (p1_r2)"},
         ],
         "annotations": [{"target": "L1", "style": "cross"},
                         {"target": "L1", "style": "margin_note", "text": "भावार्थ अधूरा"}]},
    ]


# Shaped Devanagari comes back from get_text with some conjuncts and vowel signs
# as private-use glyphs, so the checks below use words that extract whole.

def test_outside_panel_is_in_hindi_and_says_why_each_mark_went():
    pdf, layout = _scan()
    out = annotator.build_annotated_pdf(pdf, layout, _hindi_verdicts(), comment_placement="OUTSIDE")
    page = fitz.open(stream=out, filetype="pdf")[0]
    panel = page.get_text("text", clip=fitz.Rect(595, 0, page.rect.width, page.rect.height))
    assert "TEACHER COMMENTS" not in panel and "Total" not in panel
    assert "कुल अंक: 1/4" in panel
    assert "2: 1/2 (" in panel and "Partial" not in panel
    # The cut's reason, read from "max" (the grader's key), without its English lead.
    assert "-0.5" in panel and "घास खाए" in panel and "छूटा" in panel
    assert "deducted" not in panel and "p1_r2" not in panel
    # Question 1 had nothing marked on the page: still listed, with its mark and feedback.
    assert "1: 0/2 (गलत)" in panel and "कॉपी" in panel


def _edge_layout():
    return {"pages": [{"page_id": "p1", "width": 595.0, "height": 842.0, "vision_ocr": True,
                       "lines": [{"line_id": f"p1_r{i}", "box": [30.0, 80.0 + 50 * i, 555.0, 40.0],
                                  "text": "उत्तर के शब्द"} for i in range(14)]}]}


def _edge_copy():
    doc = fitz.open()
    page = doc.new_page(width=595.0, height=842.0)
    for i in range(14):
        y = 80 + 50 * i
        page.draw_line(fitz.Point(30, y + 30), fitz.Point(585, y + 30), color=(0.2, 0.2, 0.6), width=8)
    return doc.tobytes()


def test_inside_copy_writes_the_hindi_reason_beside_the_cut_instead_of_dropping_it():
    verdicts = [{"question_number": 2, "status": "COMPLETED", "marks_awarded": 1.5, "max_marks": 2.0,
                 "criteria_breakdown": [
                     {"marks": 0.0, "max": 0.5,
                      "reason": "0.5 mark deducted because बिना घास खाए जीवित रहने का भाव छूटा (p1_r3)"}],
                 "annotations": [{"style": "cross", "target": "p1_r3"},
                                 {"style": "score", "target": "p1_r9", "text": "1.5/2"}]}]
    out = fitz.open(stream=annotator._render_with_pen(_edge_copy(), _edge_layout(), verdicts), filetype="pdf")
    text = out[0].get_text("text")
    assert "घास खाए" in text and "(-0.5)" in text
    assert "deducted" not in text


def test_an_english_note_with_other_characters_goes_to_the_pen_as_before():
    # Fullwidth punctuation, a BOM or a quoted non-Devanagari letter: blanked by
    # _latin1 exactly as before, never typeset (which embedded big fonts).
    for note in ("Good\uff0c explain more", "\ufeffDefinition missing", "Write \u0995 clearly"):
        assert annotator._note_text(note) == annotator._latin1(note)
    assert annotator._note_text("भावार्थ अधूरा") == "भावार्थ अधूरा"


def test_hindi_is_measured_as_set_not_as_pen_strokes():
    assert annotator._text_width("भावार्थ अधूरा", "x", 12.0, None) > 30.0


def test_english_copies_keep_the_english_panel():
    pdf, layout = _scan()
    verdicts = [{"question_id": "q1", "question_number": 1, "marks_awarded": 1, "max_marks": 2,
                 "feedback": "Good start.",
                 "criteria_breakdown": [{"criteria_name": "C", "marks": 0, "max": 1,
                                         "reason": "1 mark deducted because example missing (L1)"}],
                 "annotations": [{"target": "L1", "style": "cross"}]},
                {"question_id": "q2", "question_number": 2, "marks_awarded": 0, "max_marks": 3,
                 "feedback": "Not attempted.", "annotations": []}]
    out = annotator.build_annotated_pdf(pdf, layout, verdicts, comment_placement="OUTSIDE")
    page = fitz.open(stream=out, filetype="pdf")[0]
    panel = page.get_text("text", clip=fitz.Rect(595, 0, page.rect.width, page.rect.height))
    assert "TEACHER COMMENTS" in panel and "Q1: 1/2 (Partial)" in panel
    # The English template reads cuts from "max_marks" as it always has.
    assert "-1" not in panel
    # The English template is otherwise as before: an unanswered question is not
    # listed, and nothing on it went through the shaper (saved as before).
    assert "Q2" not in panel
    assert annotator._SHAPED_WRITES[0] == 0


# ------------------------------------------------------------ language label

def test_hindi_language_errors_are_listed_under_bhasha_only_when_asked():
    errors = [{"wrong": "मे", "correct": "में", "why": "अनुस्वार छूटा", "row": "r1"},
              {"wrong": "नही", "correct": "नहीं", "why": "अनुस्वार छूटा", "row": "r2"}]
    text = language_feedback.feedback_text(errors, hindi=True)
    assert text.startswith("भाषा: ")
    assert annotator._before_language("भावार्थ अधूरा।\n\n" + text) == "भावार्थ अधूरा।"
    # Without the flag (partner API, English copies) the paragraph is as before.
    assert language_feedback.feedback_text(errors).startswith("Language: ")
    assert language_feedback.with_language_feedback("x", errors) == "x\n\n" + language_feedback.feedback_text(errors)


# ------------------------------------------------------------------- raster

def test_a_phone_pdf_page_is_drawn_no_larger_than_the_cap():
    huge = fitz.Rect(0, 0, 1899, 2463)            # a 72-dpi photo saved as a PDF page
    zoom = raster.capped_zoom(huge, 200)
    assert round(2463 * zoom) == raster.MAX_RASTER_EDGE
    a4 = fitz.Rect(0, 0, 595, 842)
    assert raster.capped_zoom(a4, 300) == 300 / 72.0   # ordinary scans unchanged
    assert raster.capped_zoom(a4, 200) == 200 / 72.0


def test_page_images_stay_at_200_dpi_unless_a_cap_is_asked_for(tmp_path):
    from app.services.copy_check.mathpix_fallback import _rasterize_pages

    doc = fitz.open()
    doc.new_page(width=1899, height=2463)
    path = tmp_path / "phone.pdf"
    doc.save(path)
    # Crops by layout box rely on 200 dpi: the default is exactly as before.
    assert _rasterize_pages(path)["p1"].size == (round(1899 * 200 / 72), round(2463 * 200 / 72))
    assert max(_rasterize_pages(path, max_edge=raster.MAX_RASTER_EDGE)["p1"].size) == raster.MAX_RASTER_EDGE


# ------------------------------------------------------- remarks on every answer

def test_full_remarks_prompt_only_when_flagged():
    assert "REMARKS ON EVERY ANSWER" in prompt_builder.examiner_instructions_block({"full_remarks": True})
    for ctx in ({}, {"full_remarks": False}, {"full_remarks": "yes"}):
        assert "REMARKS ON EVERY ANSWER" not in prompt_builder.examiner_instructions_block(ctx)


def _full_marks_verdicts():
    layout = {"pages": [{"page_id": "p1", "width": 1000, "height": 1400, "lines": [
        {"line_id": f"p1_r{i}", "text": f"answer line {i}", "box": [50, 100 + 60 * i, 800, 40]} for i in range(1, 9)]}]}
    questions = [{"question_id": f"q{i}", "max_marks": 2, "question_type": "LONG_ANSWER"} for i in (1, 2)]
    results = [{"question_id": f"q{i}", "paper_label": f"q{i}", "marks_awarded": 2, "max_marks": 2,
                "answer_rows": [f"p1_r{2 * i - 1}", f"p1_r{2 * i}"],
                "annotations": [{"style": "tick", "target": f"p1_r{2 * i - 1}"},
                                {"style": "margin_note", "target": f"p1_r{2 * i}",
                                 "text": "All three reasons given" if i == 1 else "Diagram labelled, process correct"}]}
               for i in (1, 2)]
    return results, layout, questions


def test_a_dashboard_copy_keeps_a_remark_on_every_full_mark_answer():
    from app.services.copy_check.enforce import enforce
    results, layout, questions = _full_marks_verdicts()
    fixed = enforce(results, layout, questions, full_remarks=True)
    notes = [a["text"] for a in fixed.annotations if a.get("style") == "margin_note"]
    assert "All three reasons given" in notes and "Diagram labelled, process correct" in notes
    # Without the flag (partner API) only praise survives on full marks, as before.
    results, layout, questions = _full_marks_verdicts()
    fixed = enforce(results, layout, questions)
    assert not [a for a in fixed.annotations if a.get("style") == "margin_note"]
