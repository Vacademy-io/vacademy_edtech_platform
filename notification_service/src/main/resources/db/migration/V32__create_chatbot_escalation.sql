-- V32: chatbot_escalation — "a learner is waiting for a human reply".
--
-- Raised by the chatbot when it cannot answer from its own context (the AI emits an escalation
-- marker), when the AI conversation hits its turn ceiling, or when the AI call itself fails.
-- Two consumers:
--   1. WhatsApp Inbox — a conversation with a PENDING row renders as "Unanswered" so an admin
--      can see, at a glance, which learners the bot handed over. Answering from the Inbox
--      resolves it automatically (WhatsAppInboxService.sendReply).
--   2. Notifier — the flow's configured recipients get "a learner is waiting for your reply" over
--      email and/or WhatsApp, rendered from the institute's own notification_template rows, with
--      notified_at gating re-notification so a chatty learner can't spam the admins.
--
-- At most ONE pending row per (institute_id, user_phone): a second escalation on a conversation
-- that is still unanswered updates the existing row rather than stacking. Enforced by the partial
-- unique index below, so concurrent webhook threads for the same phone cannot both insert.

CREATE TABLE IF NOT EXISTS chatbot_escalation (
    id                  VARCHAR(255) PRIMARY KEY,
    institute_id        VARCHAR(255) NOT NULL,
    flow_id             VARCHAR(255),
    session_id          VARCHAR(255),
    node_id             VARCHAR(255),
    user_phone          VARCHAR(255) NOT NULL,
    user_id             VARCHAR(255),
    user_name           VARCHAR(255),
    channel_type        VARCHAR(50),
    business_channel_id VARCHAR(255),
    -- NO_CONTEXT | MAX_TURNS | AI_ERROR | MANUAL
    reason              VARCHAR(50)  NOT NULL,
    user_message        TEXT,
    bot_reply           TEXT,
    error_message       TEXT,
    -- PENDING | RESOLVED
    status              VARCHAR(20)  NOT NULL DEFAULT 'PENDING',
    -- Last time an admin notification went out for THIS row; null = never notified. One
    -- timestamp covers both channels: they are sent together, so a per-channel clock would
    -- let a half-failed notify slip past the re-notify gate on the next escalation.
    notified_at         TIMESTAMP,
    notified_emails     TEXT,
    notified_phones     TEXT,
    resolved_at         TIMESTAMP,
    resolved_by         VARCHAR(255),
    created_at          TIMESTAMP    NOT NULL DEFAULT now(),
    updated_at          TIMESTAMP    NOT NULL DEFAULT now()
);

-- One open escalation per conversation. Partial (PENDING only) so the history of resolved
-- hand-overs is kept in full.
CREATE UNIQUE INDEX IF NOT EXISTS uq_chatbot_escalation_pending
    ON chatbot_escalation (institute_id, user_phone)
    WHERE status = 'PENDING';

-- Inbox "Unanswered" filter + the escalation list screen.
CREATE INDEX IF NOT EXISTS idx_chatbot_escalation_institute_status
    ON chatbot_escalation (institute_id, status, created_at DESC);
