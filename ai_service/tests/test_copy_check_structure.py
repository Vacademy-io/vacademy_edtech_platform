"""Offline tests: the copy's structure steers the grader to the right row, lays
marks out row by row on a list of one-line answers, and a letter printed inside
an option means that option.

Cases come from a real 50-question MCQ copy: "7 B. was cooking" was given 0
with question 6's row as its answer, the option printed "B" was third in the
list, and scores taller than the rows drifted beside other questions' answers.

No network. Run:
    cd vacademy_platform/ai_service && PYTHONPATH=.. APP_ENV=local \
        .venv/bin/python tests/test_copy_check_structure.py
"""
from __future__ import annotations

import asyncio
import copy
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

import fitz

from ai_service.app.services.copy_check import annotator, copy_structure as cs
from ai_service.app.services.copy_check.option_letter import (
    chosen_position,
    honour_option_letter,
    letters_out_of_order,
    printed_letters,
    refuse_wrong_option,
    text_position,
)
from ai_service.app.services.copy_check.prompt_builder import _answer_rows_hint, _question_context, build_grading_prompt

failures: list[str] = []


def check(label: str, cond: bool, detail: str = "") -> None:
    if cond:
        print(f"  PASS  {label}")
    else:
        failures.append(f"{label}: {detail}")
        print(f"  FAIL  {label} — {detail}")


def row(i: int, text: str, y: int = 0, printed: bool = False, page: str = "p1", x: int = 100, w: int = 300) -> dict:
    return {"line_id": f"{page}_r{i}", "text": text, "box": [x, y or 60 * i, w, 50], "printed": printed}


def layout(rows: list[dict], page: str = "p1") -> dict:
    return {"pages": [{"page_id": page, "page_index": 0, "width": 1000, "height": 1400, "lines": rows}]}


def questions(n: int) -> list[dict]:
    return [{"question_id": f"q{i}", "question_number": i, "question_type": "MCQS", "max_marks": 1.0}
            for i in range(1, n + 1)]


def numbered_copy(n: int = 12) -> dict:
    # The real sheet's shape: a title, a printed heading, "Q. 1" alone on a row.
    rows = [row(1, "Grammar - Revision test 2187"), row(2, "Sub-question No.", printed=True), row(3, "Q. 1"),
            row(4, "B. will have started")]
    for i in range(2, n + 1):
        rows.append(row(i + 3, f"{i} C. answer {i}"))
    return layout(rows)


OPTIONS = [{"text": "C. has cooked"}, {"text": "D. cooks"}, {"text": "B. was cooking"}, {"text": "A. cooked"}]


def test_numbering():
    print("numbering finds each answer's row")
    answers = cs.numbered_answers(questions(12), numbered_copy())
    check("label alone on its row: the answer is the next row", answers.get("q1") == ["p1_r4"], str(answers.get("q1")))
    check("question 7 is the row numbered 7", answers.get("q7") == ["p1_r10"], str(answers.get("q7")))

    two_lines = layout([row(1, "1 A. first line"), row(2, "continues here"), row(3, "2 B. second")]
                       + [row(i + 2, f"{i} C. x") for i in range(3, 8)])
    check("an answer runs until the next number", cs.numbered_answers(questions(7), two_lines).get("q1")
          == ["p1_r1", "p1_r2"])

    check("a header on the next page is not part of the last answer",
          cs.numbered_answers(questions(3), {"pages": [
              {"page_id": "p1", "lines": [row(1, "1 A. x"), row(2, "2 B. y"), row(3, "3 C. z")]},
              {"page_id": "p2", "lines": [row(1, "2187", page="p2")]},
          ]}).get("q3") == ["p1_r3"])

    worked = layout([row(1, "1 A. x"), row(2, "2 B. y"), row(3, "25 cm is the length"), row(4, "3 C. z")])
    check("a number in the writing is not a label", cs.numbered_answers(questions(3), worked).get("q2")
          == ["p1_r2", "p1_r3"])

    # Real copies: section D answered first; the first answers left unnumbered.
    backwards = {"pages": [
        {"page_id": "p1", "lines": [row(1, "2188"), row(2, "Sec:- D"), row(3, "4. x (b)"), row(4, "5. y"),
                                    row(5, "6. z"), row(6, "Sec:- E"), row(7, "7. w")]},
        {"page_id": "p2", "lines": [row(1, "1. a", page="p2"), row(2, "2. b", page="p2"), row(3, "3. c", page="p2")]},
    ]}
    got = cs.numbered_answers(questions(7), backwards)
    check("sections answered out of order", got.get("q1") == ["p2_r1"] and got.get("q6") == ["p1_r5"], str(got))
    check("a section heading belongs to no answer", got.get("q6") == ["p1_r5"], str(got.get("q6")))

    late = layout([row(i, f"c) answer {i}") for i in range(1, 4)] + [row(3 + i, f"{i + 3}) B) x") for i in range(1, 8)])
    got = cs.numbered_answers(questions(10), late)
    check("numbering that starts late still places what it can", got.get("q5") == ["p1_r5"] and "q2" not in got, str(got))

    twice = layout([row(1, "1) a"), row(2, "2) b"), row(3, "3) c"), row(4, "4) d"), row(5, "2) again"), row(6, "3) again")])
    check("answered twice: the longer run", cs.numbered_answers(questions(4), twice).get("q2") == ["p1_r2"])

    check("numbering that covers little of the paper is not believed",
          cs.numbered_answers(questions(12), layout([row(1, "1 A. x"), row(2, "written work")])) == {})
    repeated = questions(4)
    repeated[2]["paper_label"] = "1"
    repeated[0]["paper_label"] = "1"
    check("numbers that restart by section are not believed", cs.numbered_answers(repeated, numbered_copy(4)) == {})


def test_layouts():
    print("page layout from the numbering")
    check("a numbered list is a list", cs.measured_layouts(numbered_copy()) == {"p1": cs.ONE_LINE_LIST})
    essay = layout([row(i, "the words of an essay run on") for i in range(1, 20)])
    check("an essay is not", cs.measured_layouts(essay) == {"p1": cs.WRITTEN})
    check("a short list is not worth a layout", cs.measured_layouts(numbered_copy(4)) == {"p1": cs.WRITTEN})


def test_parse_reply():
    print("the model's reply is checked against the copy")
    qs = questions(3)
    lay = layout([row(1, "1 a"), row(2, "2 b"), row(3, "more b"), row(4, "3 c")])
    reply = json.dumps({"pages": {"p1": "one_line_list", "p9": "written"},
                        "answers": {"1": ["p1_r1", "p1_r1"], "2": ["p1_r2", "p1_r3"], "3": ["p1_r99", "p1_r99"]}})
    pages, answers = cs.parse_reply(reply, qs, lay)
    check("invented page dropped", pages == {"p1": cs.ONE_LINE_LIST}, str(pages))
    check("a span is expanded", answers.get("q2") == ["p1_r2", "p1_r3"], str(answers))
    check("invented row dropped", "q3" not in answers)

    _p, answers = cs.parse_reply('```json\n{"answers": {"1": ["p1_r2"], "2": ["p1_r2"], "3": ["p1_r4"]}}\n```', qs, lay)
    check("two questions on one row: neither is believed", "q1" not in answers and "q2" not in answers, str(answers))
    check("the third stands", answers.get("q3") == ["p1_r4"], str(answers))


class FakeLLM:
    def __init__(self, reply=None, error=None):
        self.reply, self.error, self.calls = reply, error, 0

    async def chat_completion(self, **_kw):
        self.calls += 1
        if self.error:
            raise self.error
        return {"content": self.reply, "usage": {}}


def test_analyse():
    print("the pass stays advisory")
    run = lambda llm, qs, lay: asyncio.run(cs.analyse(llm, qs, lay, None, "m"))

    llm = FakeLLM("{}")
    check("a paper with few objective questions takes no call", run(llm, questions(3), numbered_copy(3)) == {}
          and llm.calls == 0)
    written = [dict(q, question_type="LONG_ANSWER") for q in questions(8)]
    llm = FakeLLM("{}")
    check("a written paper takes no call", run(llm, written, numbered_copy(8)) == {} and llm.calls == 0)

    llm = FakeLLM(error=RuntimeError("provider down"))
    got = run(llm, questions(12), numbered_copy())
    check("a failed call still gives the numbering", got["answers"].get("q7") == ["p1_r10"] and "q7" in got["pinned"])
    check("a failed call still gives the layout", got["pages"] == {"p1": cs.ONE_LINE_LIST}, str(got["pages"]))

    llm = FakeLLM("not json at all")
    check("a bad reply still gives the numbering", run(llm, questions(12), numbered_copy())["answers"].get("q2")
          == ["p1_r5"])

    # The model read one question's row wrong: the student's own numbering wins.
    llm = FakeLLM(json.dumps({"pages": {"p1": "written"}, "answers": {"7": ["p1_r9", "p1_r9"]}}))
    got = run(llm, questions(12), numbered_copy())
    check("the numbering beats the reading", got["answers"]["q7"] == ["p1_r10"], str(got["answers"]["q7"]))
    check("the model's page layout is used", got["pages"] == {"p1": cs.WRITTEN})

    unnumbered = layout([row(i, f"answer words {i}") for i in range(1, 9)])
    llm = FakeLLM(json.dumps({"pages": {"p1": "one_line_list"},
                              "answers": {str(i): [f"p1_r{i}", f"p1_r{i}"] for i in range(1, 9)}}))
    got = run(llm, questions(8), unnumbered)
    check("no numbering: the model places the answers", got["answers"].get("q3") == ["p1_r3"])
    check("...but nothing is pinned to its reading", got["pinned"] == [])


def test_guard():
    print("the guard catches a verdict on another question's row")
    v = {"annotations": [{"target": "p1_r9", "style": "cross"}, {"target": "p1_r9", "style": "score"}]}
    check("off target", cs.off_target(v, ["p1_r10"]) == "p1_r9")
    check("on target", cs.off_target({"annotations": [{"target": "p1_r10", "style": "tick"}]}, ["p1_r10"]) is None)
    check("no structure, no opinion", cs.off_target(v, []) is None)
    check("found nothing where an answer is", cs.off_target({"annotations": []}, ["p1_r10"]) == "unmarked")
    check("a multi-row answer's rows all count",
          cs.off_target({"annotations": [{"target": "p1_r2", "style": "tick"}, {"target": "p1_r3", "style": "score"}]},
                        ["p1_r2", "p1_r3"]) is None)

    lay = layout([row(9, "6 D. boils"), row(10, "7 B. was cooking")])
    question = {"question_id": "q", "question_type": "MCQS", "max_marks": 1.0, "options": OPTIONS,
                "correct_answer": "Option 3: B. was cooking"}
    v = {"marks_awarded": 0.0, "max_marks": 1.0, "extracted_answer": "6 D. boils", "confidence": 0.75,
         "feedback": "The student chose D. boils", "criteria_breakdown": [{"marks": 0.0, "reason": "wrote D. boils"}],
         "annotations": [{"target": "p1_r9", "page_id": "p1", "style": "cross"},
                         {"target": "p1_r9", "page_id": "p1", "style": "score", "text": "0/1"},
                         {"target": "p1_r9", "page_id": "p1", "style": "margin_note", "text": "Correct: B. was cooking"}]}
    cs.pin_to_rows(v, ["p1_r10"], lay, question)
    check("the answer is what the row says", v["extracted_answer"] == "7 B. was cooking", v["extracted_answer"])
    check("every mark moves to the row", {a["target"] for a in v["annotations"]} == {"p1_r10"})
    check("a pinned verdict asks for a look", v["confidence"] <= 0.4)
    check("and the right answer then scores", honour_option_letter(v, question) and v["marks_awarded"] == 1.0)
    check("with a tick", {a["style"] for a in v["annotations"]} >= {"tick", "score"})

    # The other way: full marks given for another row's answer.
    v = {"marks_awarded": 1.0, "max_marks": 1.0, "extracted_answer": "6 D. boils", "confidence": 0.9,
         "annotations": [{"target": "p1_r9", "style": "tick"}, {"target": "p1_r9", "style": "score", "text": "1/1"}]}
    lay2 = layout([row(9, "6 D. boils"), row(10, "7 A. cooked")])
    cs.pin_to_rows(v, ["p1_r10"], lay2, question)
    check("a mark for another row does not survive", v["marks_awarded"] == 0.0 and
          {"cross"} <= {a["style"] for a in v["annotations"]}, str(v))


def test_printed_letters():
    print("a letter printed in the option means that option")
    check("found, whatever the order", printed_letters(OPTIONS) == {"c": 1, "d": 2, "b": 3, "a": 4})
    check("plain options have none", printed_letters([{"text": "Himalayas"}, {"text": "Alps"}]) == {})
    check("all must carry one", printed_letters([{"text": "A. x"}, {"text": "Alps"}]) == {})
    check("no repeats", printed_letters([{"text": "A. x"}, {"text": "A. y"}]) == {})

    check("7 B. was cooking is the printed B", chosen_position("7 B. was cooking", OPTIONS) == 3)
    check("(B) alone", chosen_position("(B)", OPTIONS) == 3)
    check("7) C is the printed C, not position 3", chosen_position("7) C", OPTIONS) == 1)
    check("words of an option are not a letter",
          chosen_position("a little", [{"text": "B. the little"}, {"text": "A. a little"}]) is None)
    check("the words find the option", text_position("7 A. cooked", OPTIONS) == 4)

    question = {"question_id": "q", "question_type": "MCQS", "max_marks": 1.0, "options": OPTIONS,
                "correct_answer": "Option 3: B. was cooking"}
    wrong = {"marks_awarded": 0.0, "max_marks": 1.0, "extracted_answer": "7) C", "annotations": []}
    check("the wrong letter gets nothing for being in the key's position",
          not honour_option_letter(wrong, question) and wrong["marks_awarded"] == 0.0)
    right = {"marks_awarded": 0.0, "max_marks": 1.0, "extracted_answer": "7 B. was cooking", "annotations": []}
    check("the right letter scores", honour_option_letter(right, question) and right["marks_awarded"] == 1.0)
    check("and is named as printed", "(b)" in right["feedback"], right["feedback"])

    plain = [{"text": "Himalayas"}, {"text": "Alps"}]
    check("plain options still go by position", chosen_position("7) b) Alps", plain) == 2)
    check("a plain paper is untouched by the dot form", chosen_position("7 B. Alps", plain) is None)

    shown = _question_context({"options": OPTIONS, "correct_answer": "Option 3: B. was cooking"})
    check("one letter per option", "position" not in shown and "B. was cooking" in shown, shown)
    check("in printed order", shown.index("A. cooked") < shown.index("B. was cooking") < shown.index("C. has cooked"))
    check("no position in the key", "Option 3" not in shown, shown)
    check("plain options keep their positions", "position 2" in _question_context({"options": plain}))


def test_refuse_wrong_option():
    print("an answer naming another printed option keeps no marks")
    options = [{"text": "A. knows"}, {"text": "C. has known"}, {"text": "D. had known"}, {"text": "B. knew"}]
    question = {"question_id": "q", "question_type": "MCQS", "max_marks": 1.0, "options": options,
                "correct_answer": "Option 4: B. knew"}
    verdict = lambda answer, marks=1.0: {
        "marks_awarded": marks, "max_marks": 1.0, "extracted_answer": answer, "feedback": "correct",
        "criteria_breakdown": [{"marks": marks, "reason": "chose B"}],
        "annotations": [{"style": "tick", "target": "p1_r13", "page_id": "p1"},
                        {"style": "score", "target": "p1_r13", "page_id": "p1", "text": "1/1"}]}

    v = verdict("10 A. Knows (A written over B)")
    check("the real case", refuse_wrong_option(v, question) and v["marks_awarded"] == 0.0)
    check("the copy says so", [a["style"] for a in v["annotations"]] == ["cross", "score", "margin_note"]
          and v["annotations"][1]["text"] == "0/1" and "B. knew" in v["annotations"][2]["text"], str(v["annotations"]))
    check("the audit trail agrees", v["criteria_breakdown"][0]["marks"] == 0.0)
    check("the key's letter stays", not refuse_wrong_option(verdict("10 B. knew"), question))
    check("the key's words under another letter stay", not refuse_wrong_option(verdict("10 A. knew"), question))
    check("nothing to take", not refuse_wrong_option(verdict("10 A. knows", 0.0), question))
    check("no letter to go on is left to the grader", not refuse_wrong_option(verdict("he knows it all"), question))

    plain = dict(question, options=[{"text": "knows"}, {"text": "has known"}, {"text": "had known"}, {"text": "knew"}])
    check("options without letters: a letter proves nothing", not refuse_wrong_option(verdict("10) a) knows"), plain))
    multi = dict(question, correct_answer="Option 4: B. knew; Option 1: A. knows")
    check("several keys are left to the grader", not refuse_wrong_option(verdict("10 C. has known"), multi))


def test_real_position_collisions():
    print("a letter that lands on the key's position is not the key")
    # Options stored out of order; prod gave each of these 1/1.
    boils = [{"text": "B. boiled"}, {"text": "C. is boiling"}, {"text": "D. boils"}, {"text": "A. boil"}]
    question = {"question_id": "q", "question_type": "MCQS", "max_marks": 1.0, "options": boils,
                "correct_answer": "Option 3: D. boils"}
    wrong = {"marks_awarded": 0.0, "max_marks": 1.0, "extracted_answer": "6) c) is boiling", "annotations": []}
    check("c) is the printed C, not the third option", chosen_position("6) c) is boiling", boils) == 2)
    check("so it does not score", not honour_option_letter(wrong, question) and wrong["marks_awarded"] == 0.0)
    given = dict(wrong, marks_awarded=1.0)
    check("and a grader's 1/1 for it is taken back", refuse_wrong_option(given, question) and given["marks_awarded"] == 0.0)

    goes = [{"text": "B. went"}, {"text": "C. is going"}, {"text": "A. goes"}, {"text": "D. has gone"}]
    q3 = {"question_id": "q", "question_type": "MCQS", "max_marks": 1.0, "options": goes,
          "correct_answer": "Option 3: A. goes"}
    struck = {"marks_awarded": 1.0, "max_marks": 1.0, "extracted_answer": "3) b) will struck out, goes", "annotations": []}
    check("the struck word is not the answer", text_position(struck["extracted_answer"], goes) == 3)
    check("so the key's words keep their mark", not refuse_wrong_option(struck, q3) and struck["marks_awarded"] == 1.0)
    shall = [{"text": "C. shall"}, {"text": "D. would"}, {"text": "A. must"}, {"text": "B. can"}]
    check("the letter after a struck letter counts", chosen_position("17 B struck out, C. Shall", shall) == 1)
    check("the letter goes with the struck words", chosen_position("13) (B) test struck out, (A) Ought", shall) == 3)
    check("a reader's note is not the student's words", chosen_position("10 A. Knows (A written over B)", shall) == 3)


def test_letters_in_order():
    print("letters already matching their positions change nothing in the prompt")
    in_order = [{"text": "(a) Alps"}, {"text": "(b) Himalayas"}]
    check("in order", letters_out_of_order(in_order) == {})
    check("positions stay", "position 2 / B" in _question_context({"options": in_order}))
    check("out of order", letters_out_of_order(OPTIONS) != {})


def test_prompt_hint():
    print("the grader is told where the answer is")
    lay = layout([row(9, "6 D. boils"), row(10, "7 B. was cooking")])
    q = {"question_id": "q", "question_text": "My mother ____ food", "question_type": "MCQS", "max_marks": 1.0,
         "options": OPTIONS, "answer_rows_hint": ["p1_r10"]}
    rubric = {"max_marks": 1.0, "criteria": []}
    prompt = build_grading_prompt(q, rubric, lay)
    check("names the row and its words", 'row(s) p1_r10, which read: "7 B. was cooking"' in prompt)
    check("no second chance needed yet", "previously marked" not in prompt)
    check("the second ask names the mistake", "previously marked row p1_r9" in build_grading_prompt(
        dict(q, answer_rows_missed="p1_r9"), rubric, lay))
    check("no hint, no line", "Where this answer is" not in build_grading_prompt(
        dict(q, answer_rows_hint=[]), rubric, lay))


def _blank_pdf() -> bytes:
    doc = fitz.open()
    page = doc.new_page(width=595, height=842)
    page.draw_rect(page.rect, color=(0.97, 0.97, 0.95), fill=(0.97, 0.97, 0.95))
    for i in range(1, 31):
        # Heavy enough for the ink map, the way pen on a photographed page is.
        page.insert_text((60, 41 + i * 24), f"{i} B. answer {i}", fontname="hebo", fontsize=15, color=(0.05, 0.05, 0.3))
    # A photographed page, as a real copy is: the sheet is then the whole picture.
    pix = page.get_pixmap(dpi=150)
    scan = fitz.open()
    scan.new_page(width=595, height=842).insert_image(fitz.Rect(0, 0, 595, 842), stream=pix.tobytes("jpeg"))
    data = scan.tobytes()
    scan.close()
    doc.close()
    return data


def _list_layout() -> dict:
    sx = 1654 / 595.0
    rows = []
    for i in range(1, 31):
        y = (41 + i * 24 - 13) * sx
        width = fitz.get_text_length(f"{i} B. answer {i}", fontname="hebo", fontsize=15)
        rows.append({"line_id": f"p1_r{i}", "text": f"{i} B. answer {i}", "box": [60 * sx, y, width * sx, 16 * sx],
                     "printed": False})
    return {"pages": [{"page_id": "p1", "page_index": 0, "width": 1654, "height": 2339, "lines": rows}]}


def _list_verdicts() -> list[dict]:
    out = []
    for i in range(1, 31):
        right = i % 3 != 0
        anns = [{"style": "tick" if right else "cross", "target": f"p1_r{i}", "page_id": "p1"},
                {"style": "score", "target": f"p1_r{i}", "page_id": "p1", "text": f"{int(right)}/1"}]
        if not right:
            anns.append({"style": "margin_note", "target": f"p1_r{i}", "page_id": "p1", "text": "Correct: (B) was"})
        out.append({"question_id": f"q{i}", "question_number": i, "marks_awarded": float(right), "max_marks": 1.0,
                    "annotations": anns})
    return out


def _render(pdf: bytes, lay: dict, verdicts: list | None = None) -> tuple[list, list]:
    """Draw the copy; what was written where: [(text, x, y, size)], [(style, x, y, size)]."""
    texts, marks = [], []
    pen_text, tick = annotator._pen_text, annotator._draw_tick_or_cross

    def spy_text(page, origin, text, size, *a, **k):
        texts.append((text, origin.x, origin.y, size))
        return pen_text(page, origin, text, size, *a, **k)

    def spy_tick(page, style, cx, cy, size, *a, **k):
        marks.append((style, cx, cy, size))
        return tick(page, style, cx, cy, size, *a, **k)

    annotator._pen_text, annotator._draw_tick_or_cross = spy_text, spy_tick
    try:
        annotator.build_annotated_pdf(pdf, lay, verdicts or _list_verdicts(), total_ring=False)
    finally:
        annotator._pen_text, annotator._draw_tick_or_cross = pen_text, tick
    return texts, marks


def test_list_layout_render():
    print("a list page is marked row by row")
    lay = _list_layout()
    lay["structure"] = {"pages": {"p1": cs.ONE_LINE_LIST},
                        "answers": {f"q{i}": [f"p1_r{i}"] for i in range(1, 31)}, "pinned": []}
    pdf = _blank_pdf()
    texts, marks = _render(pdf, lay)
    scores = [t for t in texts if "/1" in t[0]]
    row_of = lambda y: round((y - 36) / 24)
    text_row = lambda t: row_of(t[2] - t[3] * 0.35)
    check("every row has one score", sorted(text_row(t) for t in scores) == list(range(1, 31)),
          str(sorted(text_row(t) for t in scores)))
    check("each score is that row's", all((t[0] == "0/1") == (text_row(t) % 3 == 0) for t in scores))
    check("scores make one column", max(t[1] for t in scores) - min(t[1] for t in scores) < 12,
          str(sorted(round(t[1]) for t in scores)[:5]))
    check("no score taller than its row", max(t[3] for t in scores) * 1.2 <= 24.0, str(max(t[3] for t in scores)))
    check("every row has one tick or cross", sorted(row_of(m[2] + m[3] / 2) for m in marks) == list(range(1, 31)),
          str(sorted(row_of(m[2] + m[3] / 2) for m in marks)))
    check("beside the words, not on them or in the margin", all(150 < m[1] < 240 for m in marks),
          str(sorted(round(m[1]) for m in marks)[:5]))
    notes = [t for t in texts if "/1" not in t[0]]
    check("every wrong answer has its correction on its row",
          sorted(text_row(t) for t in notes) == list(range(3, 31, 3)), str(sorted(text_row(t) for t in notes)))
    check("before the score", all(t[1] < min(s[1] for s in scores) for t in notes))

    # Enforcement left one verdict with only its score, a grader gave another a second tick.
    verdicts = _list_verdicts()
    verdicts[0]["annotations"] = [a for a in verdicts[0]["annotations"] if a["style"] == "score"]
    verdicts[1]["annotations"].append({"style": "tick", "target": "p1_r1", "page_id": "p1"})
    _t, sparse = _render(pdf, lay, verdicts)
    check("every answer still has exactly one mark, on its own row",
          sorted(row_of(m[2] + m[3] / 2) for m in sparse) == list(range(1, 31)),
          str(sorted(row_of(m[2] + m[3] / 2) for m in sparse)))

    # A sheet detected as a strip at the page's foot must not cost a page its marks.
    strip = _list_layout()
    strip["structure"] = lay["structure"]
    strip["pages"][0]["paper_box"] = [100, 2250, 1400, 60]
    s_texts, _m = _render(pdf, strip)
    check("a sheet that misses the rows is not believed", len([t for t in s_texts if "/1" in t[0]]) == 30,
          str(len(s_texts)))

    plain_texts, plain_marks = _render(pdf, _list_layout())
    written = _list_layout()
    written["structure"] = {"pages": {"p1": cs.WRITTEN}, "answers": {}, "pinned": []}
    w_texts, w_marks = _render(pdf, written)
    check("a page read as written work draws exactly as a copy with no structure",
          w_texts == plain_texts and w_marks == plain_marks)
    check("and that is the old placement, not this one", plain_marks != marks)


def test_review_regressions() -> None:
    print("review: answers that must keep reading as they did")
    lettered = [{"text": t} for t in ("A. Knows", "B. knew", "C. known", "D. knowing")]
    for form in ("6)b", "6.b", "7)B. knew", "6) b", "Q6 (b)", "b", "(b)", "b.", "6 b) knew", "Ans: b"):
        check(f"{form!r} still names (b)", chosen_position(form, lettered) == 2, str(chosen_position(form, lettered)))

    print("review: the letter after the words")
    check("'3. known (c)' is (c) by both", chosen_position("3. known (c)", lettered) == 3 and text_position("3. known (c)", lettered) == 3)
    check("'7. knew d)': the words are (b), the letter (d)",
          text_position("7. knew d)", lettered) == 2 and chosen_position("7. knew d)", lettered) == 4)
    v = {"marks_awarded": 0.0, "max_marks": 1.0, "extracted_answer": "3. knew (c)", "annotations": [], "feedback": ""}
    check("the key's words under another letter still earn the mark, as a teacher gave them",
          honour_option_letter(v, {"question_type": "MCQS", "options": lettered, "correct_answer": "Option 2: B. knew"}))
    check("an option's own wording is not a letter",
          chosen_position("Both (b) and (c)", [{"text": "A. one"}, {"text": "B. two"}, {"text": "C. Both (b) and (c)"}]) is None)

    print("review: struck-out words are not the answer")
    for said, want in (("(B) struck out, (A) Knows", 1), ("(C) known struck out, (B) knew", 2),
                       ("(C) was cooking struck out, (B) knew", 2), ("6 c) will struck out, b) knew", 2),
                       ("A struck out, B", 2)):
        check(f"{said!r}", chosen_position(said, lettered) == want, str(chosen_position(said, lettered)))
    check("the letter stays when only the words were changed",
          chosen_position("6 b) will struck out, goes", lettered) == 2)
    check("all of it struck is no answer", chosen_position("b) knew struck out", lettered) is None)

    print("review: an option whose words look like a letter")
    science = [{"text": "A. D.C."}, {"text": "B. A.C."}, {"text": "C. E. coli"}, {"text": "D. B-12"}]
    for said, want in (("A.C.", 2), ("7 A.C.", 2), ("D.C.", 1), ("E. coli", 3), ("B-12", 4)):
        check(f"{said!r} is that option's words, not a letter",
              text_position(said, science) == want and chosen_position(said, science) is None,
              f"{text_position(said, science)} {chosen_position(said, science)}")
    check("a lone letter is still a letter", chosen_position("A", science) == 1)
    v = {"marks_awarded": 1.0, "max_marks": 1.0, "extracted_answer": "A.C.", "annotations": []}
    check("the right words are not refused for looking like (A)",
          not refuse_wrong_option(v, {"question_type": "MCQS", "options": science, "correct_answer": "Option 2: B. A.C."}))
    check("options that only begin like labels are not lettered",
          printed_letters([{"text": "A.C."}, {"text": "D.C."}]) == {})

    print("review: refusing a mark stays narrow")
    q = {"question_type": "MCQS", "options": lettered, "correct_answer": "Option 2: B. knew"}
    check("a key past the end of the options does nothing, and does not raise",
          not refuse_wrong_option({"marks_awarded": 1.0, "max_marks": 1.0, "extracted_answer": "A. Knows", "annotations": []},
                                  dict(q, correct_answer="Option 9: gone")))
    check("words close to the key under a wrong letter are left to the grader",
          not refuse_wrong_option({"marks_awarded": 1.0, "max_marks": 1.0, "extracted_answer": "c) knw", "annotations": []}, q))
    check("another option's own words are still refused",
          refuse_wrong_option({"marks_awarded": 1.0, "max_marks": 1.0, "extracted_answer": "A. Knows", "annotations": []}, q))

    check("'A-27) (b) is' is answer 27, option (b)", chosen_position("A-27) (b) is", lettered) == 2)
    check("two letters in one answer are left to the grader",
          not refuse_wrong_option({"marks_awarded": 1.0, "max_marks": 1.0, "extracted_answer": "41 d) knowing b) knew",
                                   "annotations": []}, q))

    print("review: pinning only what the row can re-judge")
    rows = [row(i, f"{i} answer", page="p1") for i in range(1, 11)]
    qs = [dict(q_, paper_label=str(q_["question_number"])) for q_ in questions(10)]
    for q_ in qs:
        q_["question_type"] = "NUMERIC"
    qs[0]["question_type"] = "MCQS"
    got = asyncio.run(cs.analyse(None, qs, layout(rows), None, "m"))
    check("a numeric answer is steered but never pinned", got["pinned"] == ["q1"] and "q2" in got["answers"], str(got.get("pinned")))

    print("review: a short answer may run onto the next page")
    two = {"pages": [{"page_id": "p1", "lines": [row(1, "1 first"), row(2, "2 second"), row(3, "3 third")]},
                     {"page_id": "p2", "lines": [row(1, "and more of it", page="p2"), row(2, "4 fourth", page="p2")]}]}
    qs = [dict(q_, paper_label=str(q_["question_number"])) for q_ in questions(4)]
    for q_ in qs:
        q_["question_type"] = "SHORT_ANSWER"
    check("its next-page rows belong to it", "p2_r1" in cs.numbered_answers(qs, two)["q3"], str(cs.numbered_answers(qs, two)))
    for q_ in qs:
        q_["question_type"] = "MCQS"
    check("a chosen option still stops with its page", cs.numbered_answers(qs, two)["q3"] == ["p1_r3"])

    print("review: the second ask says what really happened")
    prompt = _answer_rows_hint({"answer_rows_hint": ["p1_r1"], "answer_rows_missed": "unmarked"}, layout([row(1, "1 a")]))
    check("no answer found is not reported as a row", "row unmarked" not in prompt and "no answer" in prompt, prompt)
    check("the structure prompt says which number to key by", "not the printed one" in cs.build_prompt(qs, two))


def test_review_render() -> None:
    print("review: rendering a list page")
    pdf = _blank_pdf()
    lay = _list_layout()
    structure = {"pages": {"p1": cs.ONE_LINE_LIST}, "answers": {f"q{i}": [f"p1_r{i}"] for i in range(1, 31)}, "pinned": []}
    lay["structure"] = structure

    calls = []
    real = annotator._draw_tick_or_cross
    annotator._draw_tick_or_cross = lambda *a, **k: (calls.append(a[1]), real(*a, **k))[1]
    try:
        v = _list_verdicts()
        v[0]["annotations"] = [a for a in v[0]["annotations"] if a["style"] not in ("tick", "cross")]
        annotator.build_annotated_pdf(pdf, copy.deepcopy(lay), copy.deepcopy(v))
        first = len(calls)
        calls.clear()
        edited = copy.deepcopy(v)
        edited[0]["annotations_edited"] = True
        annotator.build_annotated_pdf(pdf, copy.deepcopy(lay), edited)
        check("a mark the teacher removed is not drawn back", len(calls) == first - 1, f"{first} then {len(calls)}")
    finally:
        annotator._draw_tick_or_cross = real

    panels = []
    real_panels = annotator._draw_comment_panels
    annotator._draw_comment_panels = lambda doc, p, anchors, *a, **k: (panels.append(dict(anchors)), real_panels(doc, p, anchors, *a, **k))[1]
    try:
        annotator.build_annotated_pdf(pdf, copy.deepcopy(lay), _list_verdicts(), comment_placement="OUTSIDE")
        with_list = {k[1] for k in panels[-1]}
        annotator.build_annotated_pdf(pdf, _list_layout(), _list_verdicts(), comment_placement="OUTSIDE")
        plain = {k[1] for k in panels[-1]}
        check("the comments panel lists the same questions as before", with_list == plain and plain,
              f"{sorted(plain - with_list)} missing")
    finally:
        annotator._draw_comment_panels = real_panels

    written = []
    real_pen = annotator._pen_text
    annotator._pen_text = lambda page, origin, text, *a, **k: (written.append(text), real_pen(page, origin, text, *a, **k))[1]
    try:
        v = _list_verdicts()
        target = next(a for a in v[0]["annotations"] if a["style"] == "score")
        v[0]["annotations"].append({"style": "margin_note", "target": target["target"], "page_id": target["page_id"],
                                    "placement": "below_line", "text": "\u0938\u0939\u0940: \u0916\u093e\u0928\u093e"})
        annotator.build_annotated_pdf(pdf, copy.deepcopy(lay), v)
        check("a Hindi note is not written letter by letter on a row",
              not any("\u0938" in str(t) for t in written), str([t for t in written if "\u0938" in str(t)]))
    finally:
        annotator._pen_text = real_pen

    real_pages = annotator._draw_list_pages
    annotator._draw_list_pages = lambda *a, **k: (_ for _ in ()).throw(ValueError("boom"))
    try:
        out = annotator.build_annotated_pdf(pdf, copy.deepcopy(lay), _list_verdicts())
        check("a failure in the row layout still gives a checked copy", bool(out))
    finally:
        annotator._draw_list_pages = real_pages


if __name__ == "__main__":
    test_numbering()
    test_layouts()
    test_parse_reply()
    test_analyse()
    test_guard()
    test_printed_letters()
    test_refuse_wrong_option()
    test_real_position_collisions()
    test_letters_in_order()
    test_prompt_hint()
    test_list_layout_render()
    test_review_regressions()
    test_review_render()
    print()
    if failures:
        print(f"{len(failures)} FAILED")
        for f in failures:
            print(" -", f)
        sys.exit(1)
    print("ALL PASS")
