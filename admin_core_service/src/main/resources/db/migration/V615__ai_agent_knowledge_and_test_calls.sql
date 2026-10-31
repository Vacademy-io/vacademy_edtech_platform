-- AI agent setup: reference documents and test calls from the agent editor.
--
-- knowledge_documents: JSON array of {id, name, kind, text, chars, added_at}. The text was
-- extracted from an uploaded PDF / DOCX / TXT when the admin added it, and is appended to
-- the agent's system prompt at call time (VoiceBotInternalController). NULL = no
-- documents, which is every agent that existed before this migration.
ALTER TABLE ai_agent ADD COLUMN IF NOT EXISTS knowledge_documents TEXT;

-- One row per test call placed from the agent editor. The call's subject is AGENT_TEST
-- with subject_id = this row, so the voice bot can address the tester by the name typed
-- in the editor, and the outcome pipeline never treats the number as a lead.
CREATE TABLE IF NOT EXISTS ai_agent_test_call (
    id            VARCHAR(36)  PRIMARY KEY,
    institute_id  VARCHAR(255) NOT NULL,
    agent_id      VARCHAR(255) NOT NULL,
    phone_number  VARCHAR(32)  NOT NULL,
    contact_name  VARCHAR(120),
    created_by    VARCHAR(255),
    call_log_id   VARCHAR(255),
    created_at    TIMESTAMP    NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_agent_test_call_institute
    ON ai_agent_test_call (institute_id, created_at DESC);
