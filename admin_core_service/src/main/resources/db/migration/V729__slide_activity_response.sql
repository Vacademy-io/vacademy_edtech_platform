-- Poll and Game slides.
--
-- Both are DOCUMENT slides (document_slide.type = 'POLL' / 'GAME') whose question,
-- options and settings (or game page) live in the slide's data / published_data JSON,
-- so drafts, publishing, copy, move and drip work as for any document. This table holds
-- what learners did: one row per (slide, learner, kind).
--   kind:      POLL | GAME
--   option_id: POLL — the option voted for.
--   score / max_score: GAME — the latest reported result; best_score the highest.
--              Self-reported by the game page, clamped to the slide's max score.
--   package_session_id: the learner's batch when they answered (results are per batch).
CREATE TABLE IF NOT EXISTS public.slide_activity_response (
    id                 varchar(36)   PRIMARY KEY,
    slide_id           varchar(255)  NOT NULL,
    institute_id       varchar(255)  NOT NULL,
    package_session_id varchar(255)  NULL,
    user_id            varchar(255)  NOT NULL,
    kind               varchar(16)   NOT NULL,
    option_id          varchar(64)   NULL,
    score              double precision NULL,
    max_score          double precision NULL,
    best_score         double precision NULL,
    attempts           integer       NOT NULL DEFAULT 1,
    created_at         timestamp     NOT NULL DEFAULT now(),
    updated_at         timestamp     NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_slide_activity_response
    ON public.slide_activity_response (slide_id, user_id, kind);
CREATE INDEX IF NOT EXISTS idx_slide_activity_response_slide_batch
    ON public.slide_activity_response (slide_id, kind, package_session_id);
