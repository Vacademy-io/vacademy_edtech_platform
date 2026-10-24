-- Per-quiz opt-in: a multiple-correct question answered with only some of the
-- correct options (and no wrong one) earns a proportional share of its marks.
ALTER TABLE quiz_slide
    ADD COLUMN IF NOT EXISTS partial_marking BOOLEAN NOT NULL DEFAULT FALSE;
