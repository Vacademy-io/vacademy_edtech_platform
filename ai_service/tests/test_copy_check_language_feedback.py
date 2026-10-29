"""Language accuracy on a checked copy (language_feedback.py): errors are kept
only where the model's wrong words really are on the row it names, mapped to
the answer whose rows hold them, and written into feedback and annotations
without touching marks."""
import asyncio
import json

import fitz

from app.services.copy_check import annotator, language_feedback as lf

ROWS = {
    "p1_r1": {"line_id": "p1_r1", "text": "Ans 4. The poet say that he go to the market", "_page_id": "p1"},
    "p1_r2": {"line_id": "p1_r2", "text": "every day and recieve fresh fruits.", "_page_id": "p1"},
}


def _reply(*errors):
    return json.dumps({"errors": list(errors)})


def test_enabled_only_for_highlight_in_english_or_hindi():
    assert lf.enabled({"language_feedback": "HIGHLIGHT"})
    assert lf.enabled({"language_feedback": "highlight", "answer_language": "English"})
    assert lf.enabled({"language_feedback": "HIGHLIGHT", "answer_language": "Hindi"})
    assert lf.enabled({"language_feedback": "HIGHLIGHT", "answer_language": "hi"})
    assert not lf.enabled({"language_feedback": "HIGHLIGHT", "answer_language": "Kannada"})
    assert not lf.enabled({"language_feedback": "OFF"})
    assert not lf.enabled({})
    assert not lf.enabled(None)


def test_hindi_is_checked_unless_the_paper_says_english():
    # The dashboard sends no answer_language; a partner exam that declares
    # "en" keeps the English-only check.
    assert lf.allows_hindi({"language_feedback": "HIGHLIGHT"})
    assert lf.allows_hindi({"answer_language": "Hindi"})
    assert not lf.allows_hindi({"answer_language": "en"})
    assert not lf.allows_hindi({"answer_language": "English"})
    hindi = [{"line_id": "p1_r1", "text": "मेरा माता बाजार गया।"}]
    english = [{"line_id": "p1_r1", "text": "The poet say that."}]
    assert lf.system_prompt(hindi, True) == lf.LANGUAGE_SYSTEM_HINDI
    assert lf.system_prompt(hindi, False) == lf.LANGUAGE_SYSTEM
    assert lf.system_prompt(english, True) == lf.LANGUAGE_SYSTEM


def test_find_errors_sends_a_hindi_page_the_hindi_prompt():
    layout = {"pages": [{"page_id": "p1", "lines": [
        {"line_id": "p1_r1", "text": "मेरा माता बाजार गई।"}]}]}
    reply = _reply({"row": "p1_r1", "wrong": "मेरा माता", "correct": "मेरी माता",
                    "kind": "grammar", "why": "लिंग"})
    systems = []

    class LLM:
        async def chat_completion(self, messages, **kwargs):
            systems.append(messages[0]["content"])
            return {"content": reply, "usage": {}}

    found = asyncio.run(lf.find_errors(LLM(), layout, "m", allow_hindi=True))
    assert systems == [lf.LANGUAGE_SYSTEM_HINDI]
    (err,) = found["p1_r1"]
    assert (err["wrong"], err["correct"]) == ("मेरा माता", "मेरी माता")
    assert err["words"] == [0, 1, 4]
    # The matra and the halant carry no width: the span is measured on what is drawn.
    assert 0.0 == err["span"][0] < err["span"][1] < 0.6
    asyncio.run(lf.find_errors(LLM(), layout, "m"))
    assert systems[-1] == lf.LANGUAGE_SYSTEM


def test_parse_matches_decomposed_nukta():
    rows = {"p1_r1": {"line_id": "p1_r1", "text": "वह ज़रूरी काम है", "_page_id": "p1"}}
    decomposed = "\u091c\u093c\u0930\u0942\u0930\u0940"     # ज + nukta + रूरी
    errors = lf.parse_errors(_reply({"row": "p1_r1", "wrong": decomposed, "correct": "आवश्यक"}), rows)
    assert [e["words"] for e in errors] == [[1, 1, 4]]


def test_objective_answers_are_left_alone():
    assert lf.applies_to_question({"question_type": "LONG_ANSWER"})
    assert lf.applies_to_question({})
    for t in ("MCQS", "MCQM", "ONE_WORD", "FILL_IN_THE_BLANK", "TRUE_FALSE", "NUMERIC"):
        assert not lf.applies_to_question({"question_type": t})


def test_parse_keeps_errors_that_are_on_their_row():
    errors = lf.parse_errors(_reply(
        {"row": "p1_r1", "wrong": "he go", "correct": "he goes", "kind": "grammar", "why": "subject-verb agreement"},
        {"row": "p1_r2", "wrong": "Recieve", "correct": "receive", "kind": "spelling"},
    ), ROWS)
    assert [(e["row"], e["wrong"], e["correct"]) for e in errors] == [
        ("p1_r1", "he go", "he goes"),
        ("p1_r2", "recieve", "receive"),   # the student's own casing, found ignoring case
    ]
    text = ROWS["p1_r1"]["text"]
    f0, f1 = errors[0]["span"]
    assert text[round(f0 * len(text)):round(f1 * len(text))] == "he go"
    assert errors[0]["page_id"] == "p1"


def test_parse_drops_invented_rows_words_and_non_corrections():
    errors = lf.parse_errors(_reply(
        {"row": "p9_r1", "wrong": "he go", "correct": "he goes"},          # no such row
        {"row": "p1_r1", "wrong": "they goes", "correct": "they go"},      # not written there
        {"row": "p1_r1", "wrong": "market", "correct": "market"},          # no change
        {"row": "p1_r1", "wrong": "he go", "correct": "he goes"},
        {"row": "p1_r1", "wrong": "He go", "correct": "he goes"},          # repeat
    ), ROWS)
    assert [e["wrong"] for e in errors] == ["he go"]


def test_parse_survives_fences_prose_and_garbage():
    fenced = "```json\n" + _reply({"row": "p1_r1", "wrong": "say", "correct": "says"}) + "\n```"
    assert [e["correct"] for e in lf.parse_errors(fenced, ROWS)] == ["says"]
    assert lf.parse_errors("Here you go: " + _reply({"row": "p1_r1", "wrong": "say", "correct": "says"}),
                           ROWS)[0]["kind"] == "grammar"
    assert lf.parse_errors("not json", ROWS) == []
    assert lf.parse_errors(json.dumps({"errors": "none"}), ROWS) == []


class _FakeLLM:
    def __init__(self, replies):
        self.replies = replies
        self.prompts = []

    async def chat_completion(self, messages, **kwargs):
        prompt = messages[1]["content"]
        self.prompts.append(prompt)
        page = prompt.split("]")[0].strip("[").split("_")[0]
        reply = self.replies[page]
        if isinstance(reply, Exception):
            raise reply
        return {"content": reply, "usage": {"prompt_tokens": 10, "completion_tokens": 5}}


class _Sink:
    def __init__(self):
        self.usage = []

    def add_usage(self, usage):
        self.usage.append(usage)


LAYOUT = {"pages": [
    {"page_id": "p1", "lines": [
        {"line_id": "p1_r1", "text": "Q4. Answer the following question.", "printed": True},
        {"line_id": "p1_r2", "text": "The poet say that he go"},
        {"line_id": "p1_r3", "text": "[illegible]", "illegible": True},
        {"line_id": "p1_r4", "text": "to market."},
    ]},
    {"page_id": "p2", "lines": [{"line_id": "p2_r1", "text": "I has finished."}]},
    {"page_id": "p3", "lines": [{"line_id": "p3_r1", "text": "", "printed": False}]},
]}


def test_find_errors_reads_each_page_once_and_never_raises():
    llm = _FakeLLM({
        "p1": _reply({"row": "p1_r2", "wrong": "he go", "correct": "he goes"}),
        "p2": RuntimeError("provider down"),
    })
    sink = _Sink()
    found = asyncio.run(lf.find_errors(llm, LAYOUT, "m", institute_id="i", token_sink=sink))
    assert list(found) == ["p1_r2"]
    # Printed and illegible rows are not sent; a page with no writing is not called.
    assert len(llm.prompts) == 2
    assert "Answer the following" not in llm.prompts[0] and "illegible" not in llm.prompts[0]
    assert len(sink.usage) == 1


def test_errors_map_to_the_answer_holding_their_rows():
    by_row = {"p1_r2": [{"row": "p1_r2", "wrong": "a"}], "p2_r1": [{"row": "p2_r1", "wrong": "b"}]}
    pos = lf.row_positions(LAYOUT)
    assert [e["wrong"] for e in lf.errors_for_answer(by_row, ["p1_r2", "p2_r1"], pos)] == ["a", "b"]
    assert [e["wrong"] for e in lf.errors_for_answer(by_row, ["p1_r4", "p1_r4"], pos)] == []
    assert [e["wrong"] for e in lf.errors_for_answer(by_row, ["p2_r1"], pos)] == ["b"]
    assert lf.errors_for_answer(by_row, [], pos) == []
    assert lf.errors_for_answer(by_row, ["nope", "p2_r1"], pos) == []


def test_feedback_paragraph_and_annotations():
    errors = [{"row": f"p1_r{i}", "page_id": "p1", "wrong": f"w{i}", "correct": f"c{i}", "why": "tense",
               "kind": "grammar", "span": [0.1, 0.2]} for i in range(25)]
    fb = lf.with_language_feedback("Good points made.", errors)
    assert fb.startswith("Good points made.\n\nLanguage: \"w0\" → \"c0\" (tense); ")
    assert fb.endswith("; and 5 more.")
    assert lf.with_language_feedback("Fine.", []) == "Fine."
    anns = lf.annotations(errors, "q7")
    assert len(anns) == 25          # well past the old cap of 8
    many = errors * 3
    assert len(lf.annotations(many, "q7")) == lf.MAX_MARKS_PER_QUESTION == 40
    assert anns[0] == {"style": "language", "q": "q7", "target": "p1_r0", "page_id": "p1",
                       "anchor_text": "w0", "text": "c0", "span": [0.1, 0.2], "kind": "grammar"}


def _scan():
    src = fitz.open()
    page = src.new_page(width=595, height=842)
    lines = []
    y = 120
    for i, text in enumerate(["The poet say that he go to the market",
                              "every day and buy fresh fruits."]):
        page.insert_text((48, y), text, fontsize=13, color=(0.1, 0.15, 0.5))
        lines.append({"line_id": f"L{i}", "text": text, "box": [92, (y - 13) * 2, 700, 34]})
        y += 60
    pix = page.get_pixmap(dpi=144)
    scan = fitz.open()
    scan.new_page(width=595, height=842).insert_image(fitz.Rect(0, 0, 595, 842), pixmap=pix)
    layout = {"pages": [{"page_id": "P1", "width": 1190, "height": 1684, "lines": lines}]}
    text = lines[0]["text"]
    i = text.index("he go")
    verdicts = [{
        "question_id": "q1", "question_number": 1, "marks_awarded": 3, "max_marks": 3,
        "feedback": "Clear answer.\n\nLanguage: \"he go\" → \"he goes\".",
        "annotations": [
            {"target": "L1", "style": "tick"},
            {"style": "language", "target": "L0", "page_id": "P1", "anchor_text": "he go",
             "text": "he goes", "span": [i / len(text), (i + 5) / len(text)]},
        ],
    }]
    return scan.tobytes(), layout, verdicts


def test_language_correction_is_listed_in_the_outside_panel():
    pdf, layout, verdicts = _scan()
    out = annotator.build_annotated_pdf(pdf, layout, verdicts, comment_placement="OUTSIDE",
                                        question_labels={"q1": "4"})
    page = fitz.open(stream=out, filetype="pdf")[0]
    panel = page.get_text("text", clip=fitz.Rect(595, 0, page.rect.width, page.rect.height))
    assert "Q4: Correct" in panel
    assert "Clear answer." in panel
    assert "Language: he go -> he goes" in panel
    # The grader's feedback is shown without its own copy of the language list.
    assert panel.count("he goes") == 1


def test_language_correction_is_drawn_on_the_usual_copy():
    pdf, layout, verdicts = _scan()
    plain = fitz.open(stream=annotator.build_annotated_pdf(pdf, layout, [dict(verdicts[0], annotations=[
        verdicts[0]["annotations"][0]])]), filetype="pdf")[0]
    marked = fitz.open(stream=annotator.build_annotated_pdf(pdf, layout, verdicts), filetype="pdf")[0]
    assert (marked.rect.width, marked.rect.height) == (595, 842)
    assert len(marked.get_drawings()) + len(marked.get_images()) > len(plain.get_drawings()) + len(plain.get_images())


# ---- drawing: a correction is always written, in any script ---------------

def _ink_map(inked):
    """An ink map at 1pt per cell over an A4 page; `inked` = [(x0, x1)] columns
    inked from top to bottom."""
    import numpy as np

    ink = np.zeros((842, 595), dtype=bool)
    for a, b in inked:
        ink[:, a:b] = True
    return {"ink": ink, "sx": 1.0, "sy": 1.0, "x0": 0}


def _draw_one(monkeypatch, inked, text="cases", words=None):
    doc = fitz.open()
    page = doc.new_page(width=595, height=842)
    # Fresh per-page drawing state (module globals), restored after the test.
    monkeypatch.setattr(annotator, "_PEN", [None])        # the vector pen: drawings, not images
    monkeypatch.setattr(annotator, "_CLIP", [fitz.Rect(20, 20, 575, 822)])
    monkeypatch.setattr(annotator, "_INK_MAP", [_ink_map(inked)])
    monkeypatch.setattr(annotator, "_INK_SPAN", [(100.0, 500.0)])
    monkeypatch.setattr(annotator, "_PAPER", [None])
    row = fitz.Rect(100, 400, 500, 416)
    ann = {"style": "language", "text": text, "anchor_text": "case", "span": [0.4, 0.5]}
    if words:
        ann["words"] = words
    boxes: list = []
    where = annotator._draw_language(page, row, ann, 16.0, boxes, markers=[0])
    return where, page, boxes


def test_correction_goes_to_the_margin_when_above_and_below_are_inked(monkeypatch):
    # Writing runs from x=100 to x=500 on every row: no gap above or below.
    where, page, boxes = _draw_one(monkeypatch, [(100, 500)])
    assert where == "margin"
    # The number at the end of the rule, then the note itself.
    number, note = boxes
    assert note.x1 <= 100 or note.x0 >= 500                # in a margin, off the writing
    assert abs((note.y0 + note.y1) / 2 - 408) <= 16 * 3    # beside its row
    inked_margin = [d for d in page.get_drawings()
                    if d["rect"].x1 <= 100 or d["rect"].x0 >= 500]
    assert inked_margin, "the correction was not written in the margin"
    assert 100 <= number.x0 <= 500 and number.y0 < 420      # on the rule, by the words


def test_correction_is_forced_onto_the_page_when_there_is_no_blank_paper(monkeypatch):
    where, page, boxes = _draw_one(monkeypatch, [(0, 595)])
    assert where == "forced"
    assert boxes and len(page.get_drawings()) > 3            # rule + letters


def test_correction_above_the_words_when_the_gap_is_blank(monkeypatch):
    where, _page, boxes = _draw_one(monkeypatch, [])
    assert where == "inline"
    assert boxes[0].y1 <= 400                                 # above the row


def test_devanagari_correction_is_set_whole_in_kalam(monkeypatch):
    where, page, boxes = _draw_one(monkeypatch, [], text="मेरी माता")
    assert where == "inline"
    assert "मेरी माता" in page.get_text()
    assert any("Kalam" in f[3] for f in page.get_fonts())


def test_script_safe_keeps_hindi_and_leaves_latin_as_before():
    assert annotator._script_safe("मेरी माता → ठीक") == "मेरी माता -> ठीक"
    assert annotator._script_safe("don’t → do not") == annotator._latin1("don’t → do not")
    # Other scripts are kept for the shaper (answer_language.py); a symbol outside
    # every script range still becomes a blank.
    assert annotator._script_safe("x中y") == "x中y"
    assert annotator._script_safe("x\U0001F600y") == "x y"


def test_words_are_found_on_the_rows_ink():
    m = _ink_map([])
    # Five words, 30pt wide, 12pt apart; letters 2pt apart inside each word.
    for k in range(5):
        x = 100 + k * 42
        for c in range(x, x + 30, 4):
            m["ink"][402:414, c:c + 2] = True
    row = fitz.Rect(100, 400, 400, 416)
    left, right = annotator._ink_words(m, row, 100, 400, [2, 3, 5], 16.0)
    assert (round(left), round(right)) == (184, 256)
    # Gaps that do not stand out from the letter spacing are not trusted.
    flat = _ink_map([])
    flat["ink"][402:414, 100:300:6] = True
    assert annotator._ink_words(flat, row, 100, 400, [1, 2, 5], 16.0) is None
    assert annotator._ink_words(m, row, 100, 400, None, 16.0) is None


def _many_errors_scan(n, text=None):
    pdf, layout, verdicts = _scan()
    anns = [verdicts[0]["annotations"][0]]
    row = layout["pages"][0]["lines"][0]["text"]
    words = row.split()
    for i in range(n):
        w = words[i % len(words)]
        at = row.index(w)
        anns.append({"style": "language", "target": "L0", "page_id": "P1", "anchor_text": w,
                     "text": text or f"fix{i}", "span": [at / len(row), (at + len(w)) / len(row)],
                     "words": [i % len(words), i % len(words), len(words)]})
    return pdf, layout, [dict(verdicts[0], annotations=anns)]


def test_more_than_eight_corrections_are_all_written(monkeypatch):
    seen = []
    real = annotator._draw_language

    def spy(*args, **kwargs):
        where = real(*args, **kwargs)
        seen.append(where)
        return where

    monkeypatch.setattr(annotator, "_draw_language", spy)
    pdf, layout, verdicts = _many_errors_scan(14)
    annotator.build_annotated_pdf(pdf, layout, verdicts)
    assert len(seen) == 14
    assert None not in seen


def test_hindi_corrections_reach_the_copy_and_the_panel():
    pdf, layout, verdicts = _many_errors_scan(2, text="मेरी माता")
    page = fitz.open(stream=annotator.build_annotated_pdf(pdf, layout, verdicts), filetype="pdf")[0]
    assert "मेरी माता" in page.get_text()
    assert any("Kalam" in f[3] for f in page.get_fonts())
    out = annotator.build_annotated_pdf(pdf, layout, verdicts, comment_placement="OUTSIDE")
    page = fitz.open(stream=out, filetype="pdf")[0]
    panel = page.get_text("text", clip=fitz.Rect(595, 0, page.rect.width, page.rect.height))
    assert "मेरी माता" in panel
