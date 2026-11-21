-- Freebie downloads from catalogue (page-builder) sites.
--
-- WHY: resource cards gate their files behind an Audience form, but only the
-- form submission was recorded. Which files a lead then opened, and how many,
-- was invisible: the unlock lives in the visitor's browser and every later
-- click was a plain link. One row per opened resource answers "who took what"
-- per lead, and "what is popular" per file.
--
-- audience_response_id is NULL when the visitor never filled a form in that
-- browser (or the form was a spam verdict). Those rows still count towards a
-- file's total, they just belong to nobody.
CREATE TABLE IF NOT EXISTS catalogue_resource_download (
    id VARCHAR(36) PRIMARY KEY,
    institute_id VARCHAR(36) NOT NULL,
    catalogue_id VARCHAR(36),
    -- '' is the site root; otherwise the page's route slug.
    page_route VARCHAR(255) NOT NULL DEFAULT '',
    -- The gate list of the card that was clicked, when it had one.
    audience_id VARCHAR(36),
    audience_response_id VARCHAR(36),
    user_id VARCHAR(36),
    resource_title VARCHAR(255),
    -- The file or link itself. Cards are identified by URL because a title
    -- can be edited while the file stays the same.
    resource_url VARCHAR(1024) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Top freebies over a date range.
CREATE INDEX IF NOT EXISTS idx_crd_institute_created
    ON catalogue_resource_download (institute_id, created_at);
-- Per-lead history and the repeat-click guard.
CREATE INDEX IF NOT EXISTS idx_crd_response_created
    ON catalogue_resource_download (audience_response_id, created_at)
    WHERE audience_response_id IS NOT NULL;
-- The Lead Profile card: one lead's freebies.
CREATE INDEX IF NOT EXISTS idx_crd_user_created
    ON catalogue_resource_download (user_id, created_at)
    WHERE user_id IS NOT NULL;
