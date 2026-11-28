-- Per-post article layout and the courses recommended under the article.
--
-- template: how the learner site lays the article out.
--   CLASSIC      one centred column (the layout every post had before this column)
--   SIDEBAR_TOC  sticky table of contents on the left with reading progress
--   MAGAZINE     full-width cover with the title over it, related posts below
--   FOCUS        narrow column, reading-progress bar, floating share buttons
-- Existing rows take CLASSIC, so nothing already published changes.
ALTER TABLE catalogue_blog_post
    ADD COLUMN IF NOT EXISTS template VARCHAR(32) NOT NULL DEFAULT 'CLASSIC';

-- JSON array of course (package) ids, in display order, shown as course cards
-- after the article body. NULL or an empty array shows no course band.
ALTER TABLE catalogue_blog_post
    ADD COLUMN IF NOT EXISTS recommended_course_ids TEXT;
