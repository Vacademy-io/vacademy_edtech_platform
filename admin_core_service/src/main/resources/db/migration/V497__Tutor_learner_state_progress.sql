-- Live AI Tutor (docs/ai-tutor/LIVE_TUTOR_DESIGN.md §13): resume exactly where
-- the learner stopped, per slide. current_concept_id alone lost the position
-- whenever a session ended on a topic summary or at slide-done (no current
-- concept there), and switching slides discarded the other slide's progress.
ALTER TABLE tutor_learner_state
    ADD COLUMN IF NOT EXISTS current_phase VARCHAR(32),
    ADD COLUMN IF NOT EXISTS progress_json JSONB NOT NULL DEFAULT '{}'::jsonb;
COMMENT ON COLUMN tutor_learner_state.progress_json IS
    'Per slide: {slide_id: {topic_id, concept_id, phase, done, total, slide_title, updated_at}}';
