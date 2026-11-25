-- Syllabus progress: a course stage's syllabus as week blocks of numbered points, and each
-- learner's progress through it, marked by teachers and shown to the learner. Off per institute
-- (SYLLABUS_PROGRESS_SETTING.data.enabled).

CREATE TABLE IF NOT EXISTS syllabus_block (
    id           VARCHAR(255) PRIMARY KEY,
    institute_id VARCHAR(255) NOT NULL,
    package_id   VARCHAR(255) NOT NULL,
    level_id     VARCHAR(255) NOT NULL,
    trimester    VARCHAR(100),
    month_no     INTEGER,
    week_from    INTEGER      NOT NULL,
    week_to      INTEGER      NOT NULL,
    block_order  INTEGER      NOT NULL DEFAULT 0,
    status       VARCHAR(20)  NOT NULL DEFAULT 'ACTIVE',
    created_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_syllabus_block UNIQUE (package_id, level_id, week_from, week_to)
);
CREATE INDEX IF NOT EXISTS idx_syllabus_block_course ON syllabus_block (package_id, level_id, block_order);

CREATE TABLE IF NOT EXISTS syllabus_point (
    id         VARCHAR(255) PRIMARY KEY,
    block_id   VARCHAR(255) NOT NULL REFERENCES syllabus_block (id) ON DELETE CASCADE,
    seq        INTEGER      NOT NULL,
    text       TEXT         NOT NULL,
    created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_syllabus_point UNIQUE (block_id, seq)
);

CREATE TABLE IF NOT EXISTS learner_syllabus_progress (
    id                 VARCHAR(255) PRIMARY KEY,
    institute_id       VARCHAR(255) NOT NULL,
    user_id            VARCHAR(255) NOT NULL,
    package_session_id VARCHAR(255) NOT NULL,
    block_id           VARCHAR(255) NOT NULL REFERENCES syllabus_block (id) ON DELETE CASCADE,
    status             VARCHAR(20)  NOT NULL,
    started_on         DATE,
    completed_on       DATE,
    points_done        TEXT,
    teacher_note       TEXT,
    marked_by_user_id  VARCHAR(255),
    marked_by_name     VARCHAR(255),
    created_at         TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at         TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_learner_syllabus_progress UNIQUE (user_id, package_session_id, block_id)
);
CREATE INDEX IF NOT EXISTS idx_learner_syllabus_progress_batch ON learner_syllabus_progress (package_session_id);
CREATE INDEX IF NOT EXISTS idx_learner_syllabus_progress_user ON learner_syllabus_progress (user_id, institute_id);
