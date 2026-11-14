"""The institute's marking instructions (exam_context.instructions) reach the
grading prompt, not only the criteria prompt; absent, the prompt is unchanged."""
from app.services.copy_check.grader import CopyCheckGrader
from app.services.copy_check.prompt_builder import examiner_instructions_block


def test_examiner_instructions_reach_the_grading_prompt_only_when_given():
    assert examiner_instructions_block(None) == ""
    assert examiner_instructions_block({"instructions": "  "}) == ""
    block = examiner_instructions_block({"instructions": "Format 1, content 2, expression 2."})
    assert "EXAMINER'S INSTRUCTIONS" in block and "Format 1, content 2, expression 2." in block

    plain = CopyCheckGrader(object(), exam_context={"subject": "English"}, grading_instructions=True)
    told = CopyCheckGrader(object(), exam_context={"subject": "English", "instructions": "Letter: format 1."},
                           grading_instructions=True)
    q = {"question_id": "q1"}
    assert "EXAMINER'S INSTRUCTIONS" not in plain._system_for(q, typed=False)
    assert told._system_for(q, typed=False).startswith(plain._system_for(q, typed=False))
    assert told._system_for(q, typed=False).endswith("Letter: format 1.\nINSTRUCTIONS>>>")
    assert "Letter: format 1." in told._system_for(q, typed=True)


def test_partner_api_instructions_stay_out_of_the_grading_prompt():
    """The default (and every API run): instructions shape the rubric only, as before."""
    api = CopyCheckGrader(object(), exam_context={"subject": "English", "instructions": "Letter: format 1."})
    plain = CopyCheckGrader(object(), exam_context={"subject": "English"})
    q = {"question_id": "q1"}
    assert api._system_for(q, typed=False) == plain._system_for(q, typed=False)
    assert api._system_for(q, typed=True) == plain._system_for(q, typed=True)
