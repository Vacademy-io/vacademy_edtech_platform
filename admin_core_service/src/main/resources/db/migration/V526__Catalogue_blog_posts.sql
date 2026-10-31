-- Blog posts for catalogue (page-builder) sites.
--
-- WHY A TABLE, NOT PAGES IN catalogue_json: a post is content that changes on
-- its own cadence — a new article a week, written by whoever writes, possibly
-- by an AI app over MCP — while the site JSON is a design artefact that goes
-- through draft → publish as one unit. Keeping posts inside catalogue_json
-- would make "publish this article" mean "republish the whole site", bloat a
-- blob that already reaches megabytes on imported HTML sites, and leave no way
-- to page, filter or count posts without parsing every site. So posts are rows;
-- the site only carries a `blog` section that reads them live, exactly the way
-- productPageOffer reads a product page's courses.
--
-- Scope is the INSTITUTE, not one site: every catalogue of the institute may
-- place a blog section (optionally filtered by category), so an institute with
-- a main site and a campaign microsite shares one editorial library.
CREATE TABLE IF NOT EXISTS catalogue_blog_post (
    id VARCHAR(36) PRIMARY KEY,
    institute_id VARCHAR(36) NOT NULL,
    -- URL segment under the blog page: /<site>/<blog-page>/<slug>. Unique per
    -- institute so the public lookup (institute, slug) is unambiguous.
    slug VARCHAR(191) NOT NULL,
    title VARCHAR(255) NOT NULL,
    -- Card teaser + default meta description. Plain text.
    excerpt TEXT,
    -- The body. Stored as authored (visual editor, pasted HTML, or MCP); the
    -- learner renderer sanitises at render time like every other custom HTML
    -- (catalogue-html.ts), and ai_service nh3-cleans what an AI app sends.
    content_html TEXT,
    cover_image_url TEXT,
    author_name VARCHAR(255),
    author_user_id VARCHAR(36),
    category VARCHAR(128),
    -- JSON array of strings, e.g. ["NEET","Study tips"].
    tags TEXT,
    -- DRAFT | PUBLISHED | ARCHIVED. Only PUBLISHED rows are ever served publicly.
    status VARCHAR(32) NOT NULL DEFAULT 'DRAFT',
    -- Set on first publish; editable so a post can be back-dated or scheduled
    -- (a PUBLISHED post with a future published_at is not public yet).
    published_at TIMESTAMP,
    seo_title VARCHAR(255),
    seo_description VARCHAR(512),
    -- EDITOR (dashboard) | MCP (an AI app over the MCP server) | AI (in-product assistant).
    source VARCHAR(32) NOT NULL DEFAULT 'EDITOR',
    reading_minutes INTEGER,
    created_by VARCHAR(36),
    updated_by VARCHAR(36),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_catalogue_blog_post_slug UNIQUE (institute_id, slug)
);

-- The public list: newest published first, per institute (optionally per
-- category — a filtered scan over an institute's few hundred posts is fine).
CREATE INDEX IF NOT EXISTS idx_cbp_institute_status_published
    ON catalogue_blog_post (institute_id, status, published_at DESC);
