-- Previous phone numbers of a lead, written when a lead profile edit changes one. Lets
-- Check Lead still find the lead by a number it no longer carries.
CREATE TABLE IF NOT EXISTS lead_contact_history (
    id                   VARCHAR(255) PRIMARY KEY,
    institute_id         VARCHAR(255) NOT NULL,
    user_id              VARCHAR(255),
    audience_response_id VARCHAR(255) NOT NULL,
    contact_type         VARCHAR(20)  NOT NULL,
    old_value            VARCHAR(255) NOT NULL,
    new_value            VARCHAR(255),
    old_phone_last10     VARCHAR(10),
    created_at           TIMESTAMP    NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lead_contact_history_institute_phone
    ON lead_contact_history (institute_id, old_phone_last10);
