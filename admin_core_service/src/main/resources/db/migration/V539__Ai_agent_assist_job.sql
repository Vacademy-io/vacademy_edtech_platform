-- Background jobs for the AI-agent prompt assistant (AiAgentAssistService).
--
-- A full rewrite of a long voice-agent prompt on a reasoning model runs for
-- minutes — longer than a proxy keeps an HTTP request open — so the admin UI
-- starts a job and polls it. State lives here rather than in memory so a poll
-- that lands on another admin_core replica still finds it.
CREATE TABLE IF NOT EXISTS ai_agent_assist_job (
    id            VARCHAR(36)  PRIMARY KEY,
    institute_id  VARCHAR(255) NOT NULL,
    agent_id      VARCHAR(255),
    operation     VARCHAR(32)  NOT NULL,
    status        VARCHAR(16)  NOT NULL,
    model         VARCHAR(128),
    result        JSONB,
    error         TEXT,
    created_at    TIMESTAMP    NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMP    NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_agent_assist_job_institute
    ON ai_agent_assist_job (institute_id, created_at DESC);
