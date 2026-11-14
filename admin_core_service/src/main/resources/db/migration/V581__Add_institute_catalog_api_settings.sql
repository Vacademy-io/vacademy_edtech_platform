-- Catalogue API v1: which catalogue site drives an institute's public catalogue API (formats,
-- streams, languages, payment visibility, custom course pages) and where its course pages live.
-- Both columns are optional overrides; when null the API derives them (CatalogSiteResolver):
-- site_tag from the LEARNER domain routing row / default catalogue, course_base_url from the
-- LEARNER routing host (+ /<site tag>) or institutes.learner_portal_base_url.
CREATE TABLE IF NOT EXISTS institute_catalog_api_settings (
    institute_id    VARCHAR(255) PRIMARY KEY,
    site_tag        VARCHAR(255),
    course_base_url VARCHAR(500),
    updated_by      VARCHAR(255),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);
