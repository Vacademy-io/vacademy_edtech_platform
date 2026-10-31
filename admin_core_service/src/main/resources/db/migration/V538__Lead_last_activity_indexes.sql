-- Supporting indexes for the "worked in the last 24h / 7d" windows and the
-- Activity-column sort on the leads lists (AudienceResponseRepository's
-- findLeadsWithFilters / findInstituteLeadsWithFilters LATERAL).
--
-- Both read MAX(created_at) per lead from timeline_event keyed on
-- student_user_id. V191 already indexes that column, but WITHOUT created_at:
--
--     idx_timeline_student ON timeline_event(student_user_id)
--
-- so the MAX degrades to "fetch every event this lead ever had, then sort".
-- On leads with a long history that is the dominant cost of the whole filter.
-- Adding created_at DESC turns it into a single index lookup.
--
-- The other three arms of the LATERAL are already covered:
--   idx_timeline_event_type_type_id (type, type_id, created_at DESC)  -- V127
--   idx_tcl_response                (response_id, created_at DESC)    -- V319
--   idx_tcl_user                    (user_id, created_at DESC)        -- V319
--   idx_tcl_subject                 (subject_id, subject_type)        -- V407
CREATE INDEX IF NOT EXISTS idx_timeline_student_recent
    ON timeline_event (student_user_id, created_at DESC)
    WHERE student_user_id IS NOT NULL;
