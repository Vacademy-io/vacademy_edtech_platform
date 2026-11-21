-- Per-assessment proctoring, tier "BASIC" (on-device AI, snapshots only).
--
-- Until now every anti-cheat control lived in the learner's browser (fullscreen,
-- tab-switch counter, copy/paste blocking) and left no server-side trace beyond a
-- tabSwitchCount inside the answers JSON. Nothing verified who sat the exam and
-- nothing could be reviewed afterwards.
--
-- Two things are added here.
--
-- 1. A per-assessment config. NULL means off, so every assessment that exists today
--    behaves exactly as before: no camera prompt, no snapshots, no events. The shape
--    is JSON rather than a column per knob because the tiers will grow (BASIC today;
--    PRO / ULTRA with clips, live rooms and AI review later) and each tier carries a
--    different set of knobs. The tier name is the one field every version will have.
--
--      { "tier": "BASIC", "camera_required": true, "snapshot_interval_sec": 30,
--        "face_check": true, "max_violations": 0, "show_self_view": true }
--
-- 2. An append-only event log per attempt. One row per signal the learner's device
--    reported (check-in selfie, periodic snapshot, no face, several faces, tab switch,
--    fullscreen exit, camera lost ...). Evidence, when there is any, is a media_service
--    file id -- the row never carries image bytes. Reviewers read this log; nothing in
--    the grading path reads it, so a proctoring outage can never affect a score.

ALTER TABLE assessment ADD COLUMN proctoring_config JSONB;

CREATE TABLE IF NOT EXISTS attempt_proctor_event (
    id               VARCHAR(255) PRIMARY KEY,
    attempt_id       VARCHAR(255) NOT NULL,
    assessment_id    VARCHAR(255) NOT NULL,
    user_id          VARCHAR(255),
    event_type       VARCHAR(50)  NOT NULL,
    severity         VARCHAR(20)  NOT NULL,
    -- When the device saw it (client clock) vs when the server stored it. Events
    -- are batched and retried from the client, so the two legitimately differ.
    occurred_at      TIMESTAMP    NOT NULL,
    received_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    evidence_file_id VARCHAR(255),
    meta             JSONB
);

-- The reviewer's only query shape: one attempt, in time order.
CREATE INDEX IF NOT EXISTS idx_attempt_proctor_event_attempt
    ON attempt_proctor_event (attempt_id, occurred_at);

-- The submissions table asks "how many flags per attempt" for a whole assessment.
CREATE INDEX IF NOT EXISTS idx_attempt_proctor_event_assessment_severity
    ON attempt_proctor_event (assessment_id, severity);
