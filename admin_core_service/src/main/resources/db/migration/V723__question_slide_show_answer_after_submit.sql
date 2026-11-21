-- Question slides: whether a learner is told, right after submitting, if the answer was
-- correct and what the correct answer is. Set per slide by the author in the slide editor,
-- on unless turned off. NULL reads as on. CBE_RESPONSE slides ignore it (they have their
-- own AI feedback).
ALTER TABLE question_slide ADD COLUMN IF NOT EXISTS show_answer_after_submit BOOLEAN DEFAULT TRUE;
