-- The learner streak (PointsLedgerService.loadActiveDays) now counts days the learner
-- was marked PRESENT in a live class. That lookup is by learner, and every existing
-- live_session_logs index leads with schedule_id or session_id (V408, V415), so without
-- this it scans the whole table on each points-summary call.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lsl_attendance_user_status
    ON live_session_logs (user_source_id, status)
    WHERE log_type = 'ATTENDANCE_RECORDED';
