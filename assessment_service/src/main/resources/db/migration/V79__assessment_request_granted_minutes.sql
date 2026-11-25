-- Approving a TIME_INCREASE request now adds the admin's minutes to the learner's live attempt
-- (student_attempt.max_time); granted_minutes records how many. Before this, approving one only
-- changed the request status and the learner got no extra time. Null when nothing was added
-- (the test had already ended, or the approval named no minutes).
ALTER TABLE assessment_reattempt_request ADD COLUMN IF NOT EXISTS granted_minutes INTEGER;
