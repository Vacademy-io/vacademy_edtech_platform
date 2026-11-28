-- Campaign (UTM) filters on the admin list pages match a lead by the contact
-- details the form captured when no user id existed yet (see
-- UtmListFilterResolver). audience_response already indexes user_id and
-- student_user_id; these two cover the remaining identity keys so the
-- email / mobile branches are index lookups rather than a scan of every lead
-- in the table for each filter application.
CREATE INDEX IF NOT EXISTS idx_audience_response_parent_email_lower
    ON audience_response (LOWER(parent_email))
    WHERE parent_email IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_audience_response_parent_mobile
    ON audience_response (parent_mobile)
    WHERE parent_mobile IS NOT NULL;
