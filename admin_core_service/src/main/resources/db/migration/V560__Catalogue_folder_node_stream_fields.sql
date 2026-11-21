-- Knowledge streams: what a folder needs to drive a site's mega menu and the
-- Courses page stream tabs, on top of the browsable tree V556 created.
--
-- A top-level folder is a stream ("Shiksha"), its child folders are the
-- stream's categories. Each one now carries:
--   slug          url key used in links (?stream=shiksha); unique per library when set
--   course_tag    the course tag the folder filters the Courses page by (default: the slug)
--   subtitle      second line under the title, e.g. the English caption under a Hindi title
--   tagline       headline when the folder is featured (mega menu detail panel)
--   cta_label     call-to-action label ("Explore Education")
--   link_url      where the folder links: a site route (/courses?stream=x) or an http(s) URL
--   accent_color  hex colour behind the folder's image or icon (#rgb, #rrggbb, #rrggbbaa)
--   coming_soon   shown but not open yet; clicking collects an email ("notify me")
--   audience_id   the lead campaign that collects those "notify me" sign-ups
--
-- All optional and additive: existing rows read as before (NULL, coming_soon
-- false), so a library that never sets them renders exactly as it does today.
-- The service validates every value (format, length, uniqueness); the column
-- sizes only back that up.
ALTER TABLE catalogue_folder_node ADD COLUMN IF NOT EXISTS slug VARCHAR(120);
ALTER TABLE catalogue_folder_node ADD COLUMN IF NOT EXISTS course_tag VARCHAR(191);
ALTER TABLE catalogue_folder_node ADD COLUMN IF NOT EXISTS subtitle VARCHAR(255);
ALTER TABLE catalogue_folder_node ADD COLUMN IF NOT EXISTS tagline VARCHAR(255);
ALTER TABLE catalogue_folder_node ADD COLUMN IF NOT EXISTS cta_label VARCHAR(120);
ALTER TABLE catalogue_folder_node ADD COLUMN IF NOT EXISTS link_url TEXT;
ALTER TABLE catalogue_folder_node ADD COLUMN IF NOT EXISTS accent_color VARCHAR(9);
ALTER TABLE catalogue_folder_node ADD COLUMN IF NOT EXISTS coming_soon BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE catalogue_folder_node ADD COLUMN IF NOT EXISTS audience_id VARCHAR(255);

-- One slug per library, so ?stream=shiksha always names exactly one folder.
-- Partial: folders without a slug (the default) never collide. Every tree
-- change already runs under the library's row lock, so this only backs that up.
CREATE UNIQUE INDEX IF NOT EXISTS uq_cfn_library_slug
    ON catalogue_folder_node (library_id, slug)
    WHERE slug IS NOT NULL;
