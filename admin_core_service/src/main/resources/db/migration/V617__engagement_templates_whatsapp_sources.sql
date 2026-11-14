-- WhatsApp template proposals: where each variable gets its value (same vocabulary as
-- engagement_email_template.variable_sources) and what the template is for.
-- Status META_DISABLED marks an approved template that Meta later disabled or paused.
ALTER TABLE engagement_template_proposal
    ADD COLUMN IF NOT EXISTS variable_sources JSONB NOT NULL DEFAULT '{}';

ALTER TABLE engagement_template_proposal
    ADD COLUMN IF NOT EXISTS purpose VARCHAR(120);
