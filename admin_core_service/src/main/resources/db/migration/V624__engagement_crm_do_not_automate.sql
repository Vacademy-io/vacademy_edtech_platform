-- B5: a counsellor can mark a lead "do not automate" (sensitive leads). The engine still reads
-- the lead and drafts for the inbox, but never sends to it on its own. One row per lead row,
-- kept apart from audience_response so the CRM tables stay untouched. A row with
-- do_not_automate = false is a flag that was switched off again (kept for who and when).
CREATE TABLE IF NOT EXISTS engagement_lead_flag (
    institute_id         VARCHAR(255) NOT NULL,
    audience_response_id VARCHAR(255) NOT NULL,
    do_not_automate      BOOLEAN      NOT NULL DEFAULT FALSE,
    set_by               VARCHAR(255),
    set_at               TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (institute_id, audience_response_id)
);
