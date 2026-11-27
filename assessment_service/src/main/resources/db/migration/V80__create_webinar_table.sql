-- Webinars shown in the admin dashboard's Assist Dock "Webinars" panel (community_service
-- feature/webinar, which shares this database with assessment_service). Super admins add each
-- webinar from the health-check dashboard; every institute admin sees it with a Join button.
-- A table of its own: training videos (training_video, V47) are a separate feature and are not
-- touched.
CREATE TABLE IF NOT EXISTS public.webinar (
    id varchar(255) PRIMARY KEY,
    title varchar(500) NOT NULL,
    description text,
    -- The panel shows a webinar as LIVE from starts_at until ends_at.
    starts_at timestamptz NOT NULL,
    ends_at timestamptz NOT NULL,
    -- Public join link (Zoom / Meet / registration page). Optional until it exists.
    join_url varchar(2048),
    -- Recording, added after the webinar: public URL and, when uploaded through media-service,
    -- its file id.
    recording_url varchar(2048),
    recording_file_id varchar(255),
    -- The webinar's live class (session_schedules.id in the institute that runs the webinars).
    -- Admins of PROD institutes join it in one click from their dashboard.
    live_schedule_id varchar(255),
    -- false = hidden from institute admins.
    active boolean NOT NULL DEFAULT TRUE,
    created_at timestamp,
    updated_at timestamp
);

-- Panel listing: published webinars, newest start first.
CREATE INDEX IF NOT EXISTS idx_webinar_active_starts_at
    ON public.webinar (active, starts_at DESC);
