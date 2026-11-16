-- Per-quiz opt-in study mode: after answering a question the learner can check it
-- and see right or wrong, the correct answer and the explanation before moving on.
-- Off for every existing quiz.
-- quiz_slide is read by every slide list: fail fast (and let the old pods keep serving)
-- rather than queue those reads behind this ALTER if a long query holds the table.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';
ALTER TABLE quiz_slide
    ADD COLUMN IF NOT EXISTS show_answer_after_each_question BOOLEAN NOT NULL DEFAULT FALSE;
