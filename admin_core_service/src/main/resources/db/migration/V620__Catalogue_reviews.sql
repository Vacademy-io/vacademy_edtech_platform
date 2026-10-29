-- Reviews and feedback that site visitors leave on an institute's catalogue
-- sites (the page-builder `reviewCollector` block), moderated by the admin.
--
-- A review is written by a visitor, waits as PENDING, and only an APPROVED one
-- is ever public: the `testimonialSection` block can read approved reviews
-- live next to (or instead of) its hand-written quotes, so approving a review
-- puts it on the site without republishing anything. REJECTED ones are kept
-- so the admin can change their mind.
--
-- Scope is the INSTITUTE, like blog posts: every site of the institute shares
-- one pool. catalogue_tag and page_route only record where it was written.
CREATE TABLE IF NOT EXISTS catalogue_review (
    id             VARCHAR(36)  PRIMARY KEY,
    institute_id   VARCHAR(36)  NOT NULL,
    catalogue_tag  VARCHAR(191),
    page_route     VARCHAR(255),
    rating         INTEGER      NOT NULL CHECK (rating BETWEEN 1 AND 5),
    review_text    TEXT,
    reviewer_name  VARCHAR(120) NOT NULL,
    city           VARCHAR(120),
    course_name    VARCHAR(255),
    designation    VARCHAR(255),
    status         VARCHAR(16)  NOT NULL DEFAULT 'PENDING',
    -- random id the browser keeps for this site; used to slow down repeat posting
    visitor_key    VARCHAR(64),
    reviewed_by    VARCHAR(36),
    reviewed_at    TIMESTAMP,
    created_at     TIMESTAMP    NOT NULL DEFAULT now(),
    updated_at     TIMESTAMP    NOT NULL DEFAULT now()
);

-- Admin tabs (status) newest first, and the public approved list.
CREATE INDEX IF NOT EXISTS idx_catalogue_review_institute_status_created
    ON catalogue_review (institute_id, status, created_at DESC);

-- Per-visitor rate limit on submit.
CREATE INDEX IF NOT EXISTS idx_catalogue_review_visitor_created
    ON catalogue_review (visitor_key, created_at DESC);
