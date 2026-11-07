-- Likes on blog posts.
--
-- Catalogue sites are public and most readers never log in, so a like is keyed
-- by (post, visitor): the visitor is a random id the browser keeps in local
-- storage. The primary key makes a second like from the same browser a no-op,
-- and an unlike removes exactly that row.
--
-- like_count is the running total the cards and the article read. It moves only
-- together with an inserted or deleted like row, so lists never count rows.
--
-- Whether a site shows the button at all is a setting of its blog section
-- (allowLikes in catalogue_json), not of the post: the same post can sit in a
-- blog section with likes and in an exam-guides section without them.
ALTER TABLE catalogue_blog_post ADD COLUMN IF NOT EXISTS like_count INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS catalogue_blog_post_like (
    post_id     VARCHAR(36) NOT NULL REFERENCES catalogue_blog_post (id) ON DELETE CASCADE,
    visitor_key VARCHAR(64) NOT NULL,
    created_at  TIMESTAMP   NOT NULL DEFAULT now(),
    PRIMARY KEY (post_id, visitor_key)
);
