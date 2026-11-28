"""Objective questions on a handwritten sheet are graded against the KEY, not
the model's opinion — so the key has to reach the prompt for every objective
type the platform stores (MCQS/MCQM/TRUE_FALSE with options, ONE_WORD/NUMERIC
without), and those types must get the position-matching rules."""
from app.services.copy_check import prompt_builder as pb


def _prompt(question, max_marks=1.0):
    rubric = {"max_marks": max_marks, "rubric": [{"criteria_name": "Correct answer", "max_marks": max_marks}]}
    return pb.build_grading_prompt(question, rubric, {"pages": []})


def test_mcqs_prompt_lists_options_positions_and_the_key():
    prompt = _prompt({
        "question_id": "q1", "question_text": "Which is a mountain range?", "question_type": "MCQS",
        "max_marks": 1,
        "options": [{"text": "(a) Sahara"}, {"text": "(b) Himalayas"}, {"text": "(c) Andes"}],
        "correct_answer": "Option 2: (b) Himalayas",
    })
    assert "2. (position 2 / B / ii): (b) Himalayas" in prompt
    assert "**Correct answer:** Option 2: (b) Himalayas" in prompt
    assert "Match the option POSITION" in prompt
    assert "never decide the key yourself" in prompt
    assert "Objective/short answer" in prompt


def test_mcqm_gets_the_exact_set_rule_and_true_false_is_objective_at_any_marks():
    mcqm = _prompt({"question_id": "q", "question_text": "t", "question_type": "MCQM", "max_marks": 2,
                    "options": [{"text": "A"}, {"text": "B"}], "correct_answer": "Option 1: A; Option 2: B"}, 2)
    assert "MCQM has several correct options" in mcqm
    tf = _prompt({"question_id": "q", "question_text": "t", "question_type": "TRUE_FALSE", "max_marks": 2,
                  "options": [{"text": "True"}, {"text": "False"}], "correct_answer": "Option 2: False"}, 2)
    assert "Objective/short answer" in tf and "Match the option POSITION" in tf


def test_one_word_and_numeric_show_the_key_without_options():
    one = _prompt({"question_id": "q", "question_text": "The capital of India is ____.", "question_type": "ONE_WORD",
                   "max_marks": 1, "options": None, "correct_answer": "New Delhi"})
    assert "**Correct answer:** New Delhi" in one
    assert "**Options:**" not in one
    assert "ONE_WORD / NUMERIC" in one
    num = _prompt({"question_id": "q", "question_text": "2+2", "question_type": "NUMERIC", "max_marks": 2,
                   "options": None, "correct_answer": "4"}, 2)
    assert "**Correct answer:** 4" in num and "Objective/short answer" in num


def test_written_answer_keeps_the_written_regime():
    prompt = _prompt({"question_id": "q", "question_text": "Explain photosynthesis.", "question_type": "LONG_ANSWER",
                      "max_marks": 5, "options": None, "correct_answer": None}, 5)
    assert "Written answer: up to FOUR" in prompt
    assert "**Correct answer:**" not in prompt


def test_without_a_stored_key_the_grader_keeps_its_own_judgement():
    prompt = _prompt({"question_id": "q", "question_text": "Which is a prime?", "question_type": "MCQS",
                      "max_marks": 1, "options": [{"text": "4"}, {"text": "7"}], "correct_answer": None})
    assert "Match the option POSITION" in prompt
    assert "never decide the key yourself" not in prompt
    assert "**Correct answer:**" not in prompt


# ---- 2026-09-21: the number on the paper ---------------------------------------

def test_prompt_names_the_printed_number_and_section_not_the_uuid():
    from app.services.copy_check.prompt_builder import build_grading_prompt, paper_label_for
    layout = {"pages": [{"page": 1, "rows": [{"row_id": "r1", "text": "2. Failed"}]}], "text": ""}
    rubric = {"max_marks": 1, "rubric": []}
    q = {"question_id": "0f3c-uuid", "question_type": "ONE_WORD", "question_text": "…(fail)…", "max_marks": 1,
         "options": [], "correct_answer": "failed", "paper_label": "2", "section": "Section B",
         "neighbour_labels": ["Passage I · 2", "Section B · 1", "Section B · 3"]}
    p = build_grading_prompt(q, rubric, layout, neighbour_question_labels=q["neighbour_labels"])
    assert "**Question as numbered on the paper:** Section B · 2" in p
    assert "labelled \"2\" under the heading \"Section B\"" in p
    assert "Passage I · 2, Section B · 1, Section B · 3" in p
    assert "0f3c-uuid" not in p.split("**Question type:**")[0]  # the id is no longer the "number"
    # fallbacks: position, then id
    assert paper_label_for({"question_id": "x", "question_number": 7}) == "Q7"
    assert paper_label_for({"question_id": "x"}) == "x"
