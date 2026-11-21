-- Per-user Google account: each host (counsellor, mentor, any staff member) connects THEIR OWN
-- Google account from My Schedule so their bookings use it for Meet + Calendar, instead of the
-- institute default from Live Session settings. google_account_id points at the
-- institute_live_session_provider_mapping row id (GoogleAccount.id).
CREATE TABLE IF NOT EXISTS user_google_account (
    id VARCHAR(255) PRIMARY KEY,
    institute_id VARCHAR(255) NOT NULL,
    user_id VARCHAR(255) NOT NULL,
    google_account_id VARCHAR(255) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now(),
    CONSTRAINT uq_user_google_account UNIQUE (institute_id, user_id)
);

-- The connect flow carries the link-to-user intent and where to land the browser afterwards.
ALTER TABLE oauth_connect_state ADD COLUMN IF NOT EXISTS link_to_user BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE oauth_connect_state ADD COLUMN IF NOT EXISTS return_path VARCHAR(255);
