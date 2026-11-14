-- B4: CRM activity wakes the engine for that lead.
--
-- woken_at       when CRM activity last asked for a look at this member. The wake gate lets the
--                LLM run when it is later than last_decided_at, so a note or a call outcome is not
--                slept through; a decision that started before it schedules another look soon.
-- wake_reason    what that activity was (NOTE, FOLLOWUP, STATUS, AI_CALL, CALL_ANALYZED, ...).
-- human_touch_at when a person last spoke to or wrote about the lead (a note, a call, a follow-up).
--                A decision made after it can only draft for the inbox, never auto-send, so the
--                engine does not message a family minutes after their counsellor did.
--
-- Written only by targeted UPDATEs (the entity maps them read-only), so a full-row save of a
-- member read earlier can never roll a wake back.
ALTER TABLE engagement_member ADD COLUMN IF NOT EXISTS woken_at TIMESTAMP;
ALTER TABLE engagement_member ADD COLUMN IF NOT EXISTS wake_reason VARCHAR(40);
ALTER TABLE engagement_member ADD COLUMN IF NOT EXISTS human_touch_at TIMESTAMP;

-- Finding a lead's members by its lead row: until now only (engine_id, ...) and (institute_id,
-- user_id) were indexed, so a wake for a lead without an account scanned every member.
CREATE INDEX IF NOT EXISTS idx_em_subject_lead ON engagement_member (institute_id, audience_response_id)
    WHERE audience_response_id IS NOT NULL;
