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


def test_enabled_only_for_highlight_in_english():
    assert lf.enabled({"language_feedback": "HIGHLIGHT"})
    assert lf.enabled({"language_feedback": "highlight", "answer_language": "English"})
    assert not lf.enabled({"language_feedback": "HIGHLIGHT", "answer_language": "Hindi"})
    assert not lf.enabled({"language_feedback": "OFF"})
    assert not lf.enabled({})
    assert not lf.enabled(None)


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
    assert len(anns) == lf.MAX_MARKS_PER_QUESTION
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
