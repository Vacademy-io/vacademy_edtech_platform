-- The "You're registered" email now goes out only after the learner verifies their email with
-- the OTP (it used to go the moment the form was submitted, before any verification). The learner
-- page can ask for it more than once (a repeat submission, or signing in again through
-- "Continue with email"), so this records that it was sent and the claim sends it exactly once.
ALTER TABLE assessment_user_registration
    ADD COLUMN IF NOT EXISTS confirmation_email_sent_at timestamp NULL;
