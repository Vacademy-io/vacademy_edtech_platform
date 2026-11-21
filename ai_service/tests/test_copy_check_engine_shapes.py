"""Engine items of the AI Evaluation API that need no pipeline run:
grade-request fields (C4), failure codes (spec 8.3, T0.26), the Devanagari
refusal (T1.15), criteria maxima (T1.13) and the grader persona (T0.25)."""
import pytest
from pydantic import ValidationError

from app.schemas.copy_check import (
    CopyCheckGradeRequest,
    CriteriaBreakdownItem,
    FailedCallback,
    QuestionCallback,
)
from app.services.copy_check import language_check
from app.services.copy_check.failure import (
    CopyCheckFailure,
    ENGINE_UNAVAILABLE,
    FILE_UNAVAILABLE,
    error_code_for,
)
from app.services.copy_check.prompt_builder import GRADING_SYSTEM, grading_system_for
from app.services.copy_check.typed_answers import TYPED_GRADING_SYSTEM, typed_grading_system
from app.services.copy_check.validator import attach_criteria_max

BASE = {"process_id": "p", "attempt_id": "a", "assessment_id": "s", "institute_id": "i",
        "pdf_url": "https://x/y.pdf", "callback_base_url": "http://cb",
        "questions": [{"question_id": "q1", "question_text": "t", "question_type": "LONG_ANSWER", "max_marks": 5}]}


# ----------------------------------------------------------- grade request


def test_grade_request_without_new_fields_still_validates():
    req = CopyCheckGradeRequest(**BASE)
    assert req.billing_actor is None and req.choice_groups is None and req.paper_max is None


def test_grade_request_accepts_the_api_fields():
    req = CopyCheckGradeRequest(**BASE, billing_actor="apikey:k1", page_count=7, paper_max=80,
                                rate_snapshot={"tool_key": "copy_check_evaluation_api", "flat_base_credits": 0,
                                               "per_unit_credits": 1, "unit_field": "pages",
                                               "params": {"fixed_price": True, "typed_per_answer": 1},
                                               "rate_source": "global"},
                                exam_context={"level": "school", "subject": "Science",
                                              "instructions": "Ignore spelling", "answer_language": "en"},
                                choice_groups=[{"question_ids": ["33", "33-OR"], "attempt": 1, "policy": "first"}])
    dumped = req.model_dump()
    assert dumped["billing_actor"] == "apikey:k1"
    assert dumped["rate_snapshot"]["params"]["fixed_price"] is True
    assert dumped["choice_groups"][0] == {"question_ids": ["33", "33-OR"], "attempt": 1, "policy": "first"}
    assert dumped["page_count"] == 7 and dumped["paper_max"] == 80


@pytest.mark.parametrize("bad", [
    {"choice_groups": [{"question_ids": [], "attempt": 1}]},
    {"choice_groups": [{"question_ids": ["a"], "attempt": 0}]},
    {"choice_groups": [{"question_ids": ["a"], "attempt": 1, "policy": "worst"}]},
    {"paper_max": 0},
    {"page_count": -1},
])
def test_grade_request_rejects_bad_api_fields(bad):
    with pytest.raises(ValidationError):
        CopyCheckGradeRequest(**BASE, **bad)


def test_grade_request_still_requires_institute():
    payload = dict(BASE)
    payload.pop("institute_id")
    with pytest.raises(ValidationError):
        CopyCheckGradeRequest(**payload)


def test_callback_shapes():
    assert QuestionCallback(process_id="p", job_id="j", question_id="q", marks_awarded=1, max_marks=2,
                            feedback="", extracted_answer="").counted is True
    assert CriteriaBreakdownItem(criteria_name="A", marks=1, reason="", max=2).max == 2
    assert FailedCallback(process_id="p", job_id="j", error_message="m",
                          error_code="language_not_supported").error_code == "language_not_supported"
    with pytest.raises(ValidationError):
        FailedCallback(process_id="p", job_id="j", error_message="m", error_code="made_up")


# ----------------------------------------------------------- failure codes


def test_failure_codes():
    assert error_code_for(CopyCheckFailure("copy_unreadable", "x")) == "copy_unreadable"
    assert error_code_for(RuntimeError("render_worker job 7 failed: 404 Client Error: Not Found for url")) \
        == FILE_UNAVAILABLE
    assert error_code_for(RuntimeError("render_worker job 7 failed: failed to download pdf")) == FILE_UNAVAILABLE
    assert error_code_for(TimeoutError("render_worker job 7 did not complete within 300s")) == ENGINE_UNAVAILABLE
    assert error_code_for(ValueError("boom")) == ENGINE_UNAVAILABLE
    with pytest.raises(ValueError):
        CopyCheckFailure("not_a_code", "x")


def test_render_client_failure_text_maps_to_file_unavailable():
    # Pin the exact wording render_client.py raises with ("render_worker job
    # <id> failed: <error>"); the <error> half is render_worker's own text.
    import inspect
    from app.services.copy_check import render_client
    assert 'f"render_worker job {job_id} failed: {status.get(\'error\')}"' in inspect.getsource(render_client)
    job_id, status = "j-9", {"error": "403 Client Error: Forbidden for url: https://s3/x.pdf?X-Amz-Signature=abc"}
    assert error_code_for(RuntimeError(f"render_worker job {job_id} failed: {status.get('error')}")) \
        == FILE_UNAVAILABLE
    # An engine error that is not about the file stays engine_unavailable.
    assert error_code_for(RuntimeError("render_worker job j-9 failed: CUDA out of memory")) == ENGINE_UNAVAILABLE


def test_failure_text_never_carries_a_presigned_signature():
    from app.services.copy_check.failure import redact_urls
    msg = "render_worker job j failed: 403 Forbidden for url: https://s3.aws.com/b/k.pdf?X-Amz-Signature=abc&X=1 end"
    out = redact_urls(msg)
    assert "X-Amz-Signature" not in out and "abc" not in out
    assert "https://s3.aws.com/b/k.pdf?<redacted> end" in out
    assert redact_urls("Cancelled by user") == "Cancelled by user"
    assert redact_urls("") == ""


# --------------------------------------------------------------- language


def _layout(*rows, printed=()):
    lines = [{"line_id": f"p1_r{i}", "text": t, "printed": i in printed} for i, t in enumerate(rows)]
    return {"pages": [{"page_id": "p1", "lines": lines}]}


HINDI = "प्रकाश का अपवर्तन तब होता है जब प्रकाश एक माध्यम से दूसरे माध्यम में जाता है"
ENGLISH = "Refraction of light happens when light passes from one medium into another medium."


def test_devanagari_copy_is_refused():
    assert language_check.is_unsupported_language(_layout(HINDI, HINDI))
    share, letters = language_check.devanagari_share(_layout(HINDI))
    assert share == 1.0 and letters > 30


def test_english_copy_with_a_hindi_word_is_graded():
    layout = _layout(ENGLISH, ENGLISH, ENGLISH, "प्रकाश")
    share, _ = language_check.devanagari_share(layout)
    assert 0 < share < 0.2
    assert not language_check.is_unsupported_language(layout)


def test_printed_bilingual_question_text_is_ignored():
    layout = _layout(HINDI + " " + HINDI, ENGLISH, printed={0})
    assert not language_check.is_unsupported_language(layout)


def test_too_little_writing_is_not_judged():
    assert not language_check.is_unsupported_language(_layout("प्रकाश"))


def test_vision_text_is_the_fallback_for_a_page_without_row_text():
    layout = {"pages": [{"page_id": "p1", "lines": [{"line_id": "r", "text": ""}], "vision_text": HINDI}]}
    assert language_check.is_unsupported_language(layout)


def test_refusal_applies_to_api_runs_and_to_dashboard_only_when_enabled(monkeypatch):
    monkeypatch.delenv("COPY_CHECK_REFUSE_DEVANAGARI_ALL", raising=False)
    assert language_check.applies_to("apikey:k1")
    assert not language_check.applies_to(None)
    assert not language_check.applies_to("user-123")
    monkeypatch.setenv("COPY_CHECK_REFUSE_DEVANAGARI_ALL", "true")
    assert language_check.applies_to(None)


# ----------------------------------------------------------- criteria max


RUBRIC = {"max_marks": 5, "rubric": [{"criteria_name": "Oxidation of glucose", "max_marks": 3},
                                     {"criteria_name": "Energy released", "max_marks": 2}]}


def test_criteria_max_by_name_ignoring_case_and_punctuation():
    v = {"criteria_breakdown": [{"criteria_name": "energy released.", "marks": 0, "reason": ""},
                                {"criteria_name": "Oxidation of Glucose", "marks": 2, "reason": ""}]}
    attach_criteria_max(v, RUBRIC)
    assert [c["max"] for c in v["criteria_breakdown"]] == [2, 3]


def test_criteria_max_positional_when_names_drift():
    v = {"criteria_breakdown": [{"criteria_name": "Glucose oxidised", "marks": 2, "reason": ""},
                                {"criteria_name": "Energy", "marks": 1, "reason": ""}]}
    attach_criteria_max(v, RUBRIC)
    assert [c["max"] for c in v["criteria_breakdown"]] == [3, 2]


def test_criteria_max_unknown_is_none():
    v = {"criteria_breakdown": [{"criteria_name": "Something else", "marks": 1, "reason": ""}]}
    attach_criteria_max(v, RUBRIC)
    assert v["criteria_breakdown"][0]["max"] is None
    empty = {"criteria_breakdown": []}
    assert attach_criteria_max(empty, RUBRIC) == {"criteria_breakdown": []}
    assert attach_criteria_max({"criteria_breakdown": [{"criteria_name": "A", "marks": 1}]}, None)[
        "criteria_breakdown"][0]["max"] is None


# ---------------------------------------------------------------- persona


def test_persona_absent_keeps_the_constant_prompt():
    assert grading_system_for() is GRADING_SYSTEM
    assert grading_system_for(None, "  ") is GRADING_SYSTEM
    assert typed_grading_system() is TYPED_GRADING_SYSTEM


def test_persona_from_subject_and_level():
    assert "experienced Science teacher (Class 6-12)" in grading_system_for("Science", None)
    assert "experienced Science teacher (Class 6-12)" in grading_system_for("Science", "school")
    assert "experienced Economics examiner (undergraduate level)" in grading_system_for("Economics", "ug")
    assert "experienced GS Paper II examiner (UPSC civil services level)" in grading_system_for("GS Paper II", "upsc")
    assert "experienced school teacher (CBSE Class X)" in grading_system_for(None, "CBSE Class X")
    assert typed_grading_system("History", "pg").startswith(
        "\nYou are an experienced History examiner (postgraduate level) marking")


def test_persona_text_is_one_short_line():
    from app.services.copy_check.prompt_builder import grader_persona
    persona = grader_persona("Science\n\nSECOND LINE " + "x" * 200, "school\r\n")
    assert "\n" not in persona and "\r" not in persona
    assert persona.startswith("Science SECOND LINE ")
    assert persona.endswith(" teacher (Class 6-12)")
    assert len(persona) <= 60 + len(" teacher (Class 6-12)")
