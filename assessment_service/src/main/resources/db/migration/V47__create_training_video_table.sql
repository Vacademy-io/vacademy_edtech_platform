-- LMS training videos: super admins publish them from the health-check dashboard (the video
-- bytes live in S3 via media-service; only metadata lands here), and every admin-dashboard user
-- plays them in the Assist Dock "Training" popup. Owned by community_service
-- (feature/trainingvideo), which shares this database with assessment_service.
CREATE TABLE IF NOT EXISTS public.training_video (
    id varchar(255) PRIMARY KEY,
    title varchar(500) NOT NULL,
    description text,
    -- media-service (S3) file id, when the video was uploaded through the platform pipeline.
    file_id varchar(255),
    -- Public S3 URL the admin popup streams the video from.
    file_url varchar(2048) NOT NULL,
    -- jsonb array of 1..3 breadcrumb segments (e.g. ["LMS","Course creation","AI based course"])
    -- that the admin popup renders as a collapsible module tree.
    module_path jsonb NOT NULL,
    active boolean NOT NULL DEFAULT TRUE,
    created_at timestamp,
    updated_at timestamp
);

-- Institute-facing listing: active videos, newest first.
CREATE INDEX IF NOT EXISTS idx_training_video_active_created_at
    ON public.training_video (active, created_at DESC);