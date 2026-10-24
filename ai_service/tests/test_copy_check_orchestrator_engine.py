"""orchestrator.run() end to end with every external call faked: the engine
items of the AI Evaluation API (spec 7.2, 7.6, 7.8, 8.3).

- T0.21  question callbacks carry the marks on the checked copy: a question
         whose mark changed in enforcement (or that a choice group left out) is
         re-sent before `complete`.
- T0.26  every failure carries a spec 8.3 `error_code`.
- T1.13  criteria_breakdown items carry the rubric's `max`.
- T1.15  a Devanagari copy fails `language_not_supported` before grading and
         is not billed.
- T1.36  choice groups: `counted` on each callback, totals over counted
         questions, paper_max as the grand total.
- T1.9/T1.12  billing: an `apikey:` actor bills copy_check_evaluation_api per
         page (typed: per non-blank answer) with user_id = the actor and
         user_role API_KEY and the rate snapshot; the dashboard path is
         unchanged. run() reports COMPLETED / NO_CHARGE / FAILED.
"""
import asyncio
from types import SimpleNamespace

import pytest

from app.services.copy_check import callbacks, orchestrator
from app.services.copy_check.enforce_bridge import apply_enforcement as real_apply_enforcement
from app.services.copy_check.rubric import RubricSnapshot

RUBRIC = {"max_marks": 5, "partial_marking_enabled": True, "evaluation_instructions": "",
          "rubric": [{"criteria_name": "Point A", "max_marks": 3}, {"criteria_name": "Point B", "max_marks": 2}]}

ENGLISH_LAYOUT = {"pdf_url": "u", "pages": [{"page_id": "p1", "lines": [
    {"line_id": "p1_r1", "text": "Q1 the first answer about light"},
    {"line_id": "p1_r2", "text": "Q2 the second answer about mirrors"},
    {"line_id": "p1_r3", "text": "Q3 the third answer about lenses"},
]}]}
HINDI = "प्रकाश का अपवर्तन तब होता है जब प्रकाश एक माध्यम से दूसरे माध्यम में जाता है"
HINDI_LAYOUT = {"pdf_url": "u", "pages": [{"page_id": "p1", "lines": [
    {"line_id": "p1_r1", "text": HINDI}, {"line_id": "p1_r2", "text": HINDI}]}]}


class _Cancelled(Exception):
    pass


class _OcrCancelled(Exception):
    pass


def _q(qid, label):
    return {"question_id": qid, "question_text": f"Question {label}", "question_type": "LONG_ANSWER",
            "max_marks": 5, "paper_label": label, "section": "A"}


def _payload(**over):
    payload = {
        "process_id": "proc-1", "attempt_id": "att-1", "assessment_id": "asmt-1", "institute_id": "inst-1",
        "answer_mode": "COPY", "pdf_url": "https://media/copy.pdf", "preferred_model": None,
        "callback_base_url": "http://cb", "exam_context": None,
        "questions": [_q("q1", "1"), _q("q2", "2"), _q("q3", "3")],
    }
    payload.update(over)
    return payload


@pytest.fixture
def env(monkeypatch):
    state = {
        "posts": [], "billed": [], "graded": [], "layout": ENGLISH_LAYOUT, "quality": {"gradeable": True},
        "grades": {
            "q1": {"marks_awarded": 2, "extracted_answer": "first answer", "answer_rows": ["p1_r1", "p1_r1"],
                   "criteria_breakdown": [{"criteria_name": "Point A", "marks": 2, "reason": "ok"},
                                          {"criteria_name": "point b", "marks": 0, "reason": "missing"}]},
            "q2": {"marks_awarded": 4, "extracted_answer": "second answer", "answer_rows": ["p1_r2", "p1_r2"]},
            "q3": {"marks_awarded": 3, "extracted_answer": "third answer", "answer_rows": ["p1_r3", "p1_r3"]},
        },
        "grader_kwargs": None,
        "render_error": None,
    }

    async def fake_post(url, payload):
        state["posts"].append((url.rsplit("/", 1)[-1], payload))

    monkeypatch.setattr(callbacks, "_post", fake_post)
    monkeypatch.setattr(orchestrator, "callbacks", callbacks)

    class FakeGrader:
        def __init__(self, llm, **kwargs):
            state["grader_kwargs"] = kwargs
            self.tokens_used = self.prompt_tokens = self.completion_tokens = 0

        async def grade_question(self, q, rubric, layout_map, model=None, page_ids=None):
            state["graded"].append(q["question_id"])
            return dict(state["grades"][q["question_id"]], confidence=0.9, feedback="fb")

    class FakeRender:
        is_configured = True

        async def submit_and_wait(self, pdf_url, **kwargs):
            if state["render_error"]:
                raise state["render_error"]
            return {"pages": []}

    async def fake_vision(pdf_url, layout_map, llm, **kwargs):
        import copy
        layout = copy.deepcopy(state["layout"])
        layout["vision_quality"] = state["quality"]
        return layout

    async def fake_math(pdf_url, layout_map):
        return layout_map

    async def fake_locate(*a, **k):
        state["locate_calls"] = state.get("locate_calls", 0) + 1
        return {}

    async def fake_render_upload(pdf_url, layout_map, verdicts, attempt_id):
        state["rendered"] = [dict(v) for v in verdicts]
        return "checked-copy-1"

    snapshot = RubricSnapshot(rubric_version=4, fixed_rubric={"q1": RUBRIC, "q2": RUBRIC, "q3": RUBRIC})
    monkeypatch.setattr(orchestrator, "load_snapshot", lambda db, assessment_id: snapshot)
    monkeypatch.setattr(orchestrator, "ChatLLMClient", lambda resolver: object())
    monkeypatch.setattr(orchestrator, "ApiKeyResolver", lambda db: object())
    monkeypatch.setattr(orchestrator, "CopyCheckGrader", FakeGrader)
    monkeypatch.setattr(orchestrator, "MathpixFallback",
                        lambda: SimpleNamespace(used=0, enrich_layout_for_math=fake_math))
    monkeypatch.setattr(orchestrator, "_render_client", lambda: FakeRender())
    monkeypatch.setattr(orchestrator, "vision_transcript", SimpleNamespace(enrich_layout_with_vision=fake_vision))
    monkeypatch.setattr(orchestrator, "locate", SimpleNamespace(
        locate_answers=fake_locate, pages_for_question=lambda *a: None,
        paper_order=lambda qs: [q["question_id"] for q in qs]))
    monkeypatch.setattr(orchestrator, "annotator", SimpleNamespace(render_and_upload=fake_render_upload))
    monkeypatch.setattr(orchestrator, "record_tool_billing", lambda **kw: state["billed"].append(kw))
    monkeypatch.setattr(orchestrator, "cancellation", SimpleNamespace(
        Cancelled=_Cancelled, check=lambda *a: None, is_cancelled=lambda *a: False, cleanup=lambda *a, **k: None))
    monkeypatch.setattr(orchestrator, "OcrCancelled", _OcrCancelled)
    monkeypatch.setattr(orchestrator, "HEARTBEAT_SECONDS", 3600)
    monkeypatch.delenv("COPY_CHECK_REFUSE_DEVANAGARI_ALL", raising=False)
    return state


def _run(payload):
    return asyncio.run(orchestrator.run(payload, "job-1", SimpleNamespace(close=lambda: None)))


def _posts(state, kind):
    return [p for k, p in state["posts"] if k == kind]


def test_plain_copy_unchanged_flow_with_criteria_max(env):
    _run(_payload())
    questions = _posts(env, "question")
    assert [p["question_id"] for p in questions] == ["q1", "q2", "q3"]  # no re-sends
    assert all(p["counted"] is True for p in questions)
    assert [c["max"] for c in questions[0]["criteria_breakdown"]] == [3, 2]
    complete = _posts(env, "complete")[0]
    assert complete["total_marks_awarded"] == 9 and complete["total_max_marks"] == 15
    assert complete["evaluated_file_id"] == "checked-copy-1"
    assert _posts(env, "failed") == []
    assert env["billed"][0]["tool_params"] == {"num_questions": 3}


def test_exam_context_reaches_the_grader(env):
    _run(_payload(exam_context={"level": "ug", "subject": "Physics"}))
    assert env["grader_kwargs"]["exam_context"] == {"level": "ug", "subject": "Physics"}


def test_mark_changed_in_enforcement_is_resent_before_complete(env, monkeypatch):
    def enforcing(verdicts, layout_map, meta=None, paper_max=None, choice_groups=None):
        out = real_apply_enforcement(verdicts, layout_map, meta, paper_max=paper_max, choice_groups=choice_groups)
        verdicts[1]["marks_awarded"] = 5.0  # e.g. an MCQ key override
        return out

    monkeypatch.setattr(orchestrator, "apply_enforcement", enforcing)
    _run(_payload())
    kinds = [k for k, _ in env["posts"] if k in ("question", "complete")]
    assert kinds == ["question", "question", "question", "question", "complete"]
    resent = _posts(env, "question")[3]
    assert resent["question_id"] == "q2" and resent["marks_awarded"] == 5.0
    assert _posts(env, "complete")[0]["total_marks_awarded"] == 10


def test_resent_annotations_carry_the_enforced_score(env, monkeypatch):
    env["grades"]["q2"] = dict(env["grades"]["q2"], annotations=[
        {"style": "score", "text": "4/5", "marks": 4, "target": "p1_r2", "placement": "right_margin"},
        {"style": "underline", "text": "", "target": "p1_r2"},
    ])

    def enforcing(verdicts, layout_map, meta=None, paper_max=None, choice_groups=None):
        out = real_apply_enforcement(verdicts, layout_map, meta, paper_max=paper_max, choice_groups=choice_groups)
        verdicts[1]["marks_awarded"] = 5.0
        return out

    monkeypatch.setattr(orchestrator, "apply_enforcement", enforcing)
    _run(_payload())
    first, resent = _posts(env, "question")[1], _posts(env, "question")[3]
    first_scores = [a for a in first["annotations"] if a.get("style") == "score"]
    assert first_scores and first_scores[0]["text"] == "4/5"   # the live send is untouched
    scores = [a for a in resent["annotations"] if a.get("style") == "score"]
    assert scores and all(a["text"] == "5/5" and a["marks"] == 5.0 for a in scores)
    # Everything else in the overlay is the grader's, as first sent.
    assert [a for a in resent["annotations"] if a.get("style") != "score"] == \
        [a for a in first["annotations"] if a.get("style") != "score"]


def test_failed_question_left_out_by_a_group_is_resent_not_counted(env, monkeypatch):
    class FailingGrader:
        def __init__(self, llm, **kwargs):
            self.tokens_used = self.prompt_tokens = self.completion_tokens = 0

        async def grade_question(self, q, rubric, layout_map, model=None, page_ids=None):
            if q["question_id"] == "q2":
                raise RuntimeError("provider down")
            return dict(env["grades"][q["question_id"]], confidence=0.9, feedback="fb")

    monkeypatch.setattr(orchestrator, "CopyCheckGrader", FailingGrader)
    _run(_payload(choice_groups=[{"question_ids": ["q1", "q2"], "attempt": 1, "policy": "first"}]))
    questions = _posts(env, "question")
    assert [p["question_id"] for p in questions] == ["q1", "q2", "q3", "q2"]
    live, resent = questions[1], questions[3]
    assert live["status"] == "FAILED" and live["counted"] is True
    assert resent["status"] == "FAILED" and resent["counted"] is False and resent["marks_awarded"] == 0
    complete = _posts(env, "complete")[0]
    assert complete["total_marks_awarded"] == 5 and complete["total_max_marks"] == 10


def test_failed_question_that_counts_is_not_resent(env, monkeypatch):
    class FailingGrader:
        def __init__(self, llm, **kwargs):
            self.tokens_used = self.prompt_tokens = self.completion_tokens = 0

        async def grade_question(self, q, rubric, layout_map, model=None, page_ids=None):
            if q["question_id"] == "q1":
                raise RuntimeError("provider down")
            return dict(env["grades"][q["question_id"]], confidence=0.9, feedback="fb")

    monkeypatch.setattr(orchestrator, "CopyCheckGrader", FailingGrader)
    _run(_payload(choice_groups=[{"question_ids": ["q1", "q2"], "attempt": 1, "policy": "first"}]))
    questions = _posts(env, "question")
    # q1 FAILED comes first on the paper, so it counts; q2 is the one re-sent.
    assert [p["question_id"] for p in questions] == ["q1", "q2", "q3", "q2"]
    assert questions[3]["counted"] is False and questions[3]["status"] != "FAILED"


def test_choice_groups_mark_counted_and_total_against_paper_max(env):
    _run(_payload(choice_groups=[{"question_ids": ["q1", "q2", "q3"], "attempt": 2, "policy": "best"}],
                  paper_max=10))
    questions = _posts(env, "question")
    assert len(questions) == 4
    resent = questions[3]
    assert resent["question_id"] == "q1" and resent["counted"] is False
    complete = _posts(env, "complete")[0]
    assert complete["total_marks_awarded"] == 7 and complete["total_max_marks"] == 10
    assert complete["questions_evaluated"] == 3  # every question still graded and billed
    assert env["billed"][0]["tool_params"] == {"num_questions": 3}
    assert [v.get("counted") for v in env["rendered"]] == [False, True, True]


def test_choice_groups_derive_paper_max_when_absent(env):
    _run(_payload(choice_groups=[{"question_ids": ["q1", "q2"], "attempt": 1, "policy": "first"}]))
    complete = _posts(env, "complete")[0]
    assert complete["total_max_marks"] == 10       # q3 + one of q1/q2
    assert complete["total_marks_awarded"] == 5    # q1 (first answered) + q3


def test_devanagari_copy_fails_unbilled_for_api_runs(env):
    env["layout"] = HINDI_LAYOUT
    _run(_payload(billing_actor="apikey:key-1"))
    failed = _posts(env, "failed")
    assert failed and failed[0]["error_code"] == "language_not_supported"
    assert env["graded"] == [] and _posts(env, "question") == []
    assert env["billed"] == []


def test_devanagari_copy_on_the_dashboard_is_still_graded(env):
    env["layout"] = HINDI_LAYOUT
    env["grades"] = {q: dict(g, answer_rows=["p1_r1", "p1_r1"]) for q, g in env["grades"].items()}
    _run(_payload())
    assert _posts(env, "failed") == []
    assert env["graded"] == ["q1", "q2", "q3"]


def test_unreadable_copy_code(env):
    env["quality"] = {"gradeable": False, "legible_pages": 0, "pages": 3, "avg_chars_per_page": 4}
    _run(_payload())
    failed = _posts(env, "failed")[0]
    assert failed["error_code"] == "copy_unreadable"
    assert "could not be read reliably" in failed["error_message"]
    assert env["billed"] == []


@pytest.mark.parametrize("error, code", [
    (RuntimeError("render_worker job 9 failed: 404 Client Error: Not Found"), "file_unavailable"),
    (TimeoutError("render_worker job 9 did not complete within 300s"), "engine_unavailable"),
    (_OcrCancelled("stop"), "cancelled"),
])
def test_pipeline_failures_carry_a_code(env, error, code):
    env["render_error"] = error
    _run(_payload())
    assert _posts(env, "failed")[0]["error_code"] == code
    assert env["billed"] == []


def test_no_questions_and_no_file_codes(env):
    _run(_payload(questions=[]))
    assert _posts(env, "failed")[0]["error_code"] == "no_gradable_questions"
    env["posts"].clear()
    _run(_payload(pdf_url=None))
    assert _posts(env, "failed")[0]["error_code"] == "file_missing"


def test_typed_choice_groups(env, monkeypatch):
    async def fake_grade_typed(questions, rubric_resolver, grader, preferred_model, on_verdict, check_cancelled):
        marks = {"q1": 4.0, "q2": 2.0, "q3": 0.0}
        for q in questions:
            v = {"question_id": q["question_id"], "marks_awarded": marks[q["question_id"]], "max_marks": 5.0,
                 "extracted_answer": "typed" if marks[q["question_id"]] else "", "feedback": "",
                 "confidence": 1.0, "criteria_breakdown": [], "annotations": [], "status": "COMPLETED",
                 "verdict": None if marks[q["question_id"]] else "unattempted"}
            await on_verdict(v)
        return 6.0, 15.0, 3, 2

    monkeypatch.setattr(orchestrator, "_grade_typed", fake_grade_typed)
    _run(_payload(answer_mode="TYPED", pdf_url=None,
                  choice_groups=[{"question_ids": ["q1", "q2"], "attempt": 1, "policy": "best"}]))
    questions = _posts(env, "question")
    assert [p["question_id"] for p in questions] == ["q1", "q2", "q3", "q2"]
    assert questions[3]["counted"] is False
    complete = _posts(env, "complete")[0]
    assert complete["total_marks_awarded"] == 4 and complete["total_max_marks"] == 10


# ── billing (spec 10.1, 10.8) ───────────────────────────────────────────────

SNAPSHOT = {"tool_key": "copy_check_evaluation_api", "flat_base_credits": 0, "per_unit_credits": 1,
            "unit_field": "pages", "params": {"fixed_price": True, "typed_per_answer": 1},
            "rate_source": "global"}


def test_dashboard_copy_bills_per_question_without_attribution(env):
    assert _run(_payload()) == orchestrator.RUN_BILLED
    billed = env["billed"][0]
    assert billed["tool_key"] == "copy_check_evaluation"
    assert billed["tool_params"] == {"num_questions": 3}
    assert billed["user_id"] is None and billed["user_role"] is None and billed["rate_snapshot"] is None
    assert billed["idempotency_key"] == "proc-1" and billed["institute_id"] == "inst-1"


def test_api_copy_bills_every_page_at_the_snapshot(env):
    assert _run(_payload(billing_actor="apikey:key-1", page_count=12, rate_snapshot=SNAPSHOT)) == \
        orchestrator.RUN_BILLED
    billed = env["billed"][0]
    assert billed["tool_key"] == "copy_check_evaluation_api"
    assert billed["tool_params"] == {"num_pages": 12}
    assert billed["user_id"] == "apikey:key-1" and billed["user_role"] == "API_KEY"
    assert billed["rate_snapshot"] == SNAPSHOT and billed["idempotency_key"] == "proc-1"


def test_api_copy_without_page_count_bills_the_ocr_pages(env):
    _run(_payload(billing_actor="apikey:key-1"))
    assert env["billed"][0]["tool_params"] == {"num_pages": 1}


def test_api_typed_copy_bills_the_non_blank_answers(env, monkeypatch):
    async def fake_grade_typed(questions, rubric_resolver, grader, preferred_model, on_verdict, check_cancelled):
        return 6.0, 15.0, 3, 2          # 3 evaluated, 2 non-blank answers read

    monkeypatch.setattr(orchestrator, "_grade_typed", fake_grade_typed)
    assert _run(_payload(answer_mode="TYPED", pdf_url=None, billing_actor="apikey:key-1")) == \
        orchestrator.RUN_BILLED
    billed = env["billed"][0]
    assert billed["tool_key"] == "copy_check_evaluation_api"
    assert billed["tool_params"] == {"answer_mode": "TYPED", "num_answers": 2}


def test_dashboard_typed_copy_is_unchanged(env, monkeypatch):
    async def fake_grade_typed(questions, rubric_resolver, grader, preferred_model, on_verdict, check_cancelled):
        return 6.0, 15.0, 3, 2

    monkeypatch.setattr(orchestrator, "_grade_typed", fake_grade_typed)
    _run(_payload(answer_mode="TYPED", pdf_url=None))
    assert env["billed"][0]["tool_key"] == "copy_check_evaluation"
    assert env["billed"][0]["tool_params"] == {"num_questions": 2}


@pytest.mark.parametrize("actor", [None, "apikey:key-1"])
def test_all_blank_typed_copy_is_not_billed(env, monkeypatch, actor):
    async def fake_grade_typed(questions, rubric_resolver, grader, preferred_model, on_verdict, check_cancelled):
        return 0.0, 15.0, 3, 0

    monkeypatch.setattr(orchestrator, "_grade_typed", fake_grade_typed)
    assert _run(_payload(answer_mode="TYPED", pdf_url=None, billing_actor=actor)) == orchestrator.RUN_NO_CHARGE
    assert env["billed"] == []


def test_failed_copy_reports_failed(env):
    env["render_error"] = TimeoutError("render_worker job 9 did not complete within 300s")
    assert _run(_payload(billing_actor="apikey:key-1", page_count=4)) == orchestrator.RUN_FAILED
    assert env["billed"] == []


def test_charge_plan_rules():
    plan = orchestrator.charge_plan
    assert plan({"billing_actor": "user-1"}, typed=False, num_questions=5)["tool_key"] == "copy_check_evaluation"
    assert plan({"billing_actor": "apikey:k", "page_count": 0}, typed=False, num_questions=5, layout_pages=0) is None
    # A snapshot for the other key is not passed on.
    api = plan({"billing_actor": "apikey:k", "page_count": 2,
                "rate_snapshot": dict(SNAPSHOT, tool_key="copy_check_evaluation")}, typed=False, num_questions=5)
    assert api["rate_snapshot"] is None and api["tool_params"] == {"num_pages": 2}
    dash = plan({"rate_snapshot": dict(SNAPSHOT, tool_key="copy_check_evaluation")}, typed=False, num_questions=5)
    assert dash["rate_snapshot"]["tool_key"] == "copy_check_evaluation"


def test_answer_location_runs_by_default(env):
    _run(_payload())
    assert env.get("locate_calls") == 1


def test_skip_answer_location_grades_against_the_whole_copy(env):
    # Assignment AI evaluation: one question whose answer is the whole copy.
    _run(_payload(skip_answer_location=True))
    assert env.get("locate_calls") is None
    assert env["graded"] == ["q1", "q2", "q3"]


def test_outside_template_reaches_the_annotator_with_printed_labels(env, monkeypatch):
    seen = {}

    async def render_upload(pdf_url, layout_map, verdicts, attempt_id, **kwargs):
        seen.update(kwargs)
        return "checked-copy-panel"

    monkeypatch.setattr(orchestrator, "annotator", SimpleNamespace(render_and_upload=render_upload))
    _run(_payload(comment_placement="OUTSIDE"))
    assert seen == {"comment_placement": "OUTSIDE", "question_labels": {"q1": "1", "q2": "2", "q3": "3"}}
    assert _posts(env, "complete")[0]["evaluated_file_id"] == "checked-copy-panel"


def test_any_other_template_value_renders_the_usual_copy(env):
    # The fixture's render_and_upload takes no template arguments: the usual
    # copy must be asked for exactly as before, whatever arrives.
    for value in (None, "INSIDE", "inside", "garbage"):
        env["posts"].clear()
        _run(_payload(comment_placement=value))
        assert _posts(env, "complete")[0]["evaluated_file_id"] == "checked-copy-1"


def _language_env(env, monkeypatch):
    calls = []

    async def find_errors(llm, layout_map, model, **kwargs):
        calls.append(model)
        return {"p1_r1": [{"row": "p1_r1", "page_id": "p1", "wrong": "the first", "correct": "The first",
                           "kind": "punctuation", "why": "capital letter", "span": [0.1, 0.3]}]}

    from app.services.copy_check import language_feedback
    monkeypatch.setattr(language_feedback, "find_errors", find_errors)
    return calls


def test_language_highlight_lists_errors_without_touching_marks(env, monkeypatch):
    calls = _language_env(env, monkeypatch)
    _run(_payload(exam_context={"language_feedback": "HIGHLIGHT"}))
    assert len(calls) == 1
    by_q = {p["question_id"]: p for p in _posts(env, "question")}
    assert by_q["q1"]["marks_awarded"] == 2
    assert by_q["q1"]["feedback"] == ('fb\n\nLanguage: "the first" → "The first" (capital letter).')
    assert by_q["q2"]["feedback"] == "fb"
    # No language mark in the callback's annotations: the dashboard overlay is unchanged.
    assert all(a.get("style") != "language" for a in by_q["q1"]["annotations"])
    assert _posts(env, "complete")[0]["total_marks_awarded"] == 9
    q1 = next(v for v in env["rendered"] if v["question_id"] == "q1")
    marks = [a for a in q1["annotations"] if a["style"] == "language"]
    assert [(m["target"], m["anchor_text"], m["text"]) for m in marks] == [("p1_r1", "the first", "The first")]
    # The deduction remark comes from the grader, never from the language list.
    notes = [a["text"] for a in q1["annotations"] if a["style"] == "margin_note"]
    assert notes and not any("Language" in n for n in notes)
    assert q1["feedback"].endswith("(capital letter).")


def test_language_check_is_off_unless_asked(env, monkeypatch):
    calls = _language_env(env, monkeypatch)
    _run(_payload(exam_context={"subject": "English"}))
    _run(_payload(exam_context={"language_feedback": "HIGHLIGHT", "answer_language": "Hindi"}))
    assert calls == []
    assert all("Language" not in p["feedback"] for p in _posts(env, "question"))


def test_answer_left_out_by_a_choice_group_says_so_on_the_copy(env):
    _run(_payload(choice_groups=[{"question_ids": ["q1", "q2", "q3"], "attempt": 2, "policy": "best"}],
                  paper_max=10))
    notes = {v["question_id"]: [a["text"] for a in v["annotations"] if a.get("style") == "margin_note"]
             for v in env["rendered"]}
    assert orchestrator.NOT_COUNTED_NOTE in notes["q1"]
    assert all(orchestrator.NOT_COUNTED_NOTE not in notes[q] for q in ("q2", "q3"))
    q1 = next(v for v in env["rendered"] if v["question_id"] == "q1")
    note = next(a for a in q1["annotations"] if a.get("text") == orchestrator.NOT_COUNTED_NOTE)
    score = next(a for a in q1["annotations"] if a.get("style") == "score")
    assert note["target"] == score["target"]
    # The dashboard overlay (question callbacks) is unchanged by it.
    assert all(orchestrator.NOT_COUNTED_NOTE not in str(p.get("annotations")) for p in _posts(env, "question"))


def test_no_choice_groups_no_extra_note(env):
    _run(_payload())
    assert all(orchestrator.NOT_COUNTED_NOTE not in str(v["annotations"]) for v in env["rendered"])


def test_instructions_reach_grading_on_dashboard_runs_only(env):
    _run(_payload(exam_context={"instructions": "Format 1."}))
    assert env["grader_kwargs"]["grading_instructions"] is True
    _run(_payload(exam_context={"instructions": "Format 1."}, billing_actor="apikey:key-1",
                  page_count=1, rate_snapshot=SNAPSHOT))
    assert env["grader_kwargs"]["grading_instructions"] is False


def test_partner_copy_is_drawn_as_before_under_internal_choice(env):
    _run(_payload(choice_groups=[{"question_ids": ["q1", "q2", "q3"], "attempt": 2, "policy": "best"}],
                  paper_max=10, billing_actor="apikey:key-1", page_count=1, rate_snapshot=SNAPSHOT))
    assert all(orchestrator.NOT_COUNTED_NOTE not in str(v["annotations"]) for v in env["rendered"])
