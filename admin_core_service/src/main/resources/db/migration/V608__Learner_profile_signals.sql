-- Learner profile, phase 1: what the Student AI notices about a learner, kept as
-- evidence rows (one observation each) rather than overwriting strengths/weaknesses.
-- ai_service's learner_profile poller writes them after a chat goes idle; admins
-- read and dismiss them (admin_core LearnerProfileController). Scoped per institute:
-- a learner in two institutes has two separate profiles.

CREATE TABLE IF NOT EXISTS learner_profile_signal (
    id                   BIGSERIAL PRIMARY KEY,
    institute_id         VARCHAR(255) NOT NULL,
    user_id              VARCHAR(255) NOT NULL,
    source               VARCHAR(20)  NOT NULL,              -- CHAT (phase 1); TEST, TUTOR later
    kind                 VARCHAR(30)  NOT NULL,              -- STRENGTH, WEAKNESS, MISCONCEPTION, GOAL, PREFERENCE, INTEREST
    topic                VARCHAR(255),
    detail               TEXT         NOT NULL,              -- one-sentence observation
    confidence           NUMERIC(3, 2),                      -- 0.00-1.00, the extractor's own estimate
    stated               BOOLEAN      NOT NULL DEFAULT FALSE, -- the learner said it themselves (goal, preference)
    evidence_session_id  VARCHAR(255),
    evidence_message_ids JSONB        NOT NULL DEFAULT '[]'::jsonb,
    evidence_quote       TEXT,                               -- copied from the message, never model-written
    model                VARCHAR(120),
    status               VARCHAR(20)  NOT NULL DEFAULT 'ACTIVE', -- ACTIVE | DISMISSED
    dismissed_by         VARCHAR(255),
    dismissed_at         TIMESTAMP,
    observed_at          TIMESTAMP    NOT NULL,
    created_at           TIMESTAMP    NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_learner_profile_signal_learner
    ON learner_profile_signal (institute_id, user_id, observed_at DESC);

-- One row per chat session: how far the extractor has read it.
CREATE TABLE IF NOT EXISTS learner_profile_cursor (
    session_id       VARCHAR(255) PRIMARY KEY,
    institute_id     VARCHAR(255) NOT NULL,
    user_id          VARCHAR(255) NOT NULL,
    last_message_id  BIGINT       NOT NULL DEFAULT 0,
    status           VARCHAR(20)  NOT NULL DEFAULT 'IDLE',   -- IDLE | RUNNING
    attempts         INT          NOT NULL DEFAULT 0,        -- consecutive failures
    last_error       TEXT,
    updated_at       TIMESTAMP    NOT NULL DEFAULT now()
);
