-- Team members an engine alerts (bell alert + email) whenever it needs a human: an escalated
-- reply, a request for material the assets don't hold. Staff user ids of the engine's institute.
ALTER TABLE engagement_engine
    ADD COLUMN IF NOT EXISTS notify_user_ids JSONB NOT NULL DEFAULT '[]';
