-- Question of the day: formats beyond multiple choice, and the option to keep the
-- result hidden until the reveal time.
--
-- WHY hidden results: with the outcome shown at submit, the first learners to answer
-- learn the answer and can pass it on well before the reveal, which is exactly what
-- the reveal time exists to prevent. When this is on, the learner is told their
-- answer is locked in and nothing more until reveal.
--
-- The correctness BONUS is then withheld too, and awarded by the reveal sweep. A
-- learner who saw "+30" when completion alone is worth 10 would know they were right
-- without being told — the points are a side channel for the same secret.
--
-- The question FORMAT (MCQ | TEXT | UPLOAD) lives in engagement_item.payload_json
-- rather than a column: it changes how one item type is authored and graded, not
-- what the row is, and the payload already carries the options and the answer key.

ALTER TABLE public.engagement_item
    ADD COLUMN hide_result_until_reveal boolean NOT NULL DEFAULT false;

-- Finds attempts still owed their bonus when a slot's reveal time passes.
CREATE INDEX idx_engagement_attempt_pending_bonus
    ON public.engagement_attempt USING btree (item_id, is_correct)
    WHERE status = 'COMPLETED' AND is_correct = true;
