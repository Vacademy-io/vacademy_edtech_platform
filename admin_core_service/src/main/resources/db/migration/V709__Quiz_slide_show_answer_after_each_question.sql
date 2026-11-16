-- Per-quiz opt-in study mode: after answering a question the learner can check it
-- and see right or wrong, the correct answer and the explanation before moving on.
-- Off for every existing quiz.
ALTER TABLE quiz_slide
    ADD COLUMN IF NOT EXISTS show_answer_after_each_question BOOLEAN NOT NULL DEFAULT FALSE;
