-- BBB reports each attendee's time in the room in SECONDS, but we stored only
-- (seconds / 60) as an integer — a floor, so every learner silently lost up to
-- 59 seconds and the loss always counted against them.
--
-- That is invisible on a long class but decides borderline cases: on a 7-minute
-- class at 60% the bar is 4.2 minutes, so a learner present for 4m50s (69%) was
-- truncated to 4 and marked ABSENT for a class they clearly attended.
--
-- Keep provider_total_duration_minutes exactly as it is — reports, exports and
-- the workflow query layer all read it. This adds the precise value alongside,
-- so the attendance rule can compare in seconds and the UI can show m:ss.
-- NULL means the provider gave us no better than minutes (Zoom reports whole
-- minutes only), and callers fall back to the minutes column.
ALTER TABLE live_session_logs
    ADD COLUMN IF NOT EXISTS provider_total_duration_seconds INTEGER;

COMMENT ON COLUMN live_session_logs.provider_total_duration_seconds IS
    'Exact seconds the attendee was in the meeting, as reported by the provider (BBB). NULL when only whole minutes are available (Zoom). provider_total_duration_minutes remains the floored minute value for existing consumers.';
