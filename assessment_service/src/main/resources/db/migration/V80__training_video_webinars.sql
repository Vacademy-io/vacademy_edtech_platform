-- Webinars in the admin dashboard's Assist Dock "Webinars" panel. Super admins add each live
-- webinar (date, join link, later its recording) from the health-check dashboard, and every
-- institute admin sees it with a Join button. They live in training_video (created in V47, read by
-- community_service feature/trainingvideo and feature/webinar) rather than a table of their own:
--  * kind      - TRAINING (every existing row, the Training popup) or WEBINAR (the Webinars panel).
--  * starts_at - when the webinar starts. ends_at - when it ends; the panel shows LIVE in between.
--  * join_url  - the link admins open to join.
--  * file_url  - now optional: it holds the recording, and an upcoming webinar has none yet.
-- All additive (or relaxing), so existing rows and older community_service builds keep working.
ALTER TABLE public.training_video
    ADD COLUMN IF NOT EXISTS kind varchar(32) NOT NULL DEFAULT 'TRAINING';

ALTER TABLE public.training_video
    ADD COLUMN IF NOT EXISTS starts_at timestamptz;

ALTER TABLE public.training_video
    ADD COLUMN IF NOT EXISTS ends_at timestamptz;

ALTER TABLE public.training_video
    ADD COLUMN IF NOT EXISTS join_url varchar(2048);

ALTER TABLE public.training_video
    ALTER COLUMN file_url DROP NOT NULL;

-- Webinars panel listing: one kind, newest first.
CREATE INDEX IF NOT EXISTS idx_training_video_kind_starts_at
    ON public.training_video (kind, starts_at DESC);
