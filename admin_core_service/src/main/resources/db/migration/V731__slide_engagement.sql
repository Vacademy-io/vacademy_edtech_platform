-- "Count as engagement" on a course slide (Question, Quiz, HTML, Flashcards, Poll, Game).
--
-- Daily engagement tasks are bound to a time window; course slides are not. A teacher
-- marks a slide as an engagement and every learner who completes it earns `points`
-- once, into points_ledger (source_type COURSE_ACTIVITY, idempotency key
-- COURSE_ACTIVITY:{slide_id}:{user_id}). No window, nothing expires, and the slide
-- stays in the course to revisit.
--   enabled: false keeps the row (and the points value) but stops new awards.
--            Points already earned are never taken back.
--   points:  per learner, once. Changing it later does not touch earlier awards.
CREATE TABLE IF NOT EXISTS public.slide_engagement (
    slide_id    varchar(255) PRIMARY KEY,
    enabled     boolean      NOT NULL DEFAULT true,
    points      integer      NOT NULL DEFAULT 10,
    updated_by  varchar(255) NULL,
    created_at  timestamp    NOT NULL DEFAULT now(),
    updated_at  timestamp    NOT NULL DEFAULT now(),
    CONSTRAINT ck_slide_engagement_points CHECK (points BETWEEN 1 AND 1000)
);

-- Award counts read points_ledger by (source_type, source_id): idx_points_ledger_source (V512).
