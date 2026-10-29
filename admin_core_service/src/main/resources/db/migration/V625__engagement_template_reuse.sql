-- A template an engine took over from another engine of the same institute (already approved there),
-- instead of generating and submitting a new one. Points at the template it was copied from.
ALTER TABLE engagement_template_proposal ADD COLUMN IF NOT EXISTS reused_from_id VARCHAR(255);
ALTER TABLE engagement_email_template ADD COLUMN IF NOT EXISTS reused_from_id VARCHAR(255);
