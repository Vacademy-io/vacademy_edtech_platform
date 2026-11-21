-- WhatsApp template proposals:
--  header_type / header_text / header_media_url and buttons (W13, W14): passed to the notification
--    template (headerType, headerText, headerSampleUrl, buttons); media is uploaded to Meta at submit.
--  replaces_id (W15): this proposal is the edited version of an approved template; the old one is
--    SUPERSEDED when this one is approved by Meta.
--  submitted_at (W10): when it was sent to Meta, to keep under Meta's templates-per-hour limit.
--    Proposals over the limit wait in status QUEUED and are submitted by the sync job.
ALTER TABLE engagement_template_proposal
    ADD COLUMN IF NOT EXISTS header_type VARCHAR(20) NOT NULL DEFAULT 'NONE';

ALTER TABLE engagement_template_proposal
    ADD COLUMN IF NOT EXISTS header_text VARCHAR(60);

ALTER TABLE engagement_template_proposal
    ADD COLUMN IF NOT EXISTS header_media_url TEXT;

ALTER TABLE engagement_template_proposal
    ADD COLUMN IF NOT EXISTS buttons JSONB NOT NULL DEFAULT '[]';

ALTER TABLE engagement_template_proposal
    ADD COLUMN IF NOT EXISTS replaces_id VARCHAR(255);

ALTER TABLE engagement_template_proposal
    ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_etp_institute_submitted
    ON engagement_template_proposal (institute_id, submitted_at);
