-- Telleo AI calling API v1: finaliser fixes (2026-10-14).
--
-- checked_at: when the finaliser last looked at a not-yet-final call. The scan orders by
-- it (oldest check first), so a backlog of one institute's waiting calls can no longer pin
-- the scan window and starve every other institute's webhooks.
-- terminal_seen_at: when the call was first seen ended. The outcome wait counts from here
-- (telephony_call_log.updated_at is never bumped, so it measured from the dial).
ALTER TABLE ai_call_api_call ADD COLUMN IF NOT EXISTS checked_at TIMESTAMPTZ;
ALTER TABLE ai_call_api_call ADD COLUMN IF NOT EXISTS terminal_seen_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_ai_call_api_call_open_checked
    ON ai_call_api_call (checked_at NULLS FIRST) WHERE finalized_at IS NULL;
-- Test-mode metering counts recent test calls per institute.
CREATE INDEX IF NOT EXISTS idx_ai_call_api_call_test_recent
    ON ai_call_api_call (institute_id, created_at) WHERE test_mode;
