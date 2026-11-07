-- A learner's own marks on a lesson: highlights, marked areas, bookmarks and
-- notes. Private to the learner. The id is generated on the device so a note
-- written offline can be sent again without creating a duplicate.
CREATE TABLE IF NOT EXISTS learner_note (
    id                  VARCHAR(36)  PRIMARY KEY,
    user_id             VARCHAR(255) NOT NULL,
    institute_id        VARCHAR(255) NOT NULL,
    slide_id            VARCHAR(255) NOT NULL,
    slide_type          VARCHAR(50),
    slide_title         VARCHAR(500),
    chapter_name        VARCHAR(500),
    course_name         VARCHAR(500),
    course_id           VARCHAR(255),
    level_id            VARCHAR(255),
    subject_id          VARCHAR(255),
    module_id           VARCHAR(255),
    chapter_id          VARCHAR(255),
    package_session_id  VARCHAR(255),
    kind                VARCHAR(20)  NOT NULL,
    color               VARCHAR(20),
    page_index          INTEGER,
    time_ms             BIGINT,
    anchor_json         TEXT,
    quote_text          TEXT,
    note_text           TEXT,
    review_stage        INTEGER      NOT NULL DEFAULT 0,
    next_review_at      TIMESTAMPTZ,
    last_reviewed_at    TIMESTAMPTZ,
    deleted_at          TIMESTAMPTZ,
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_learner_note_user_slide
    ON learner_note (user_id, slide_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_learner_note_user_institute_created
    ON learner_note (user_id, institute_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_learner_note_due
    ON learner_note (user_id, institute_id, next_review_at)
    WHERE deleted_at IS NULL AND next_review_at IS NOT NULL;
