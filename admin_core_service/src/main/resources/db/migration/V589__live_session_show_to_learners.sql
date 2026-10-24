-- V589: per-class learner visibility for attendance-only institutes.
--
-- Only read while the institute has LIVE_SESSION_SETTING.attendanceOnlyMode on.
-- TRUE  = the class is shown to learners like a normal online class.
-- FALSE / NULL = attendance only, hidden from learners and parents.
-- NULL on every existing row, so classes created under the mode stay hidden.
ALTER TABLE live_session ADD COLUMN IF NOT EXISTS show_to_learners BOOLEAN NULL;
