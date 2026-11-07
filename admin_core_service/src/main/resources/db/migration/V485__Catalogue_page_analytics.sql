-- First-party analytics for catalogue (page-builder) sites.
--
-- WHY: catalogue sites fire GA4/Meta/GTM events but nothing is recorded here,
-- so an admin can only see traffic by logging into a Google property they
-- usually have not connected. Leads already live in audience_response, which
-- means we know who converted and never how many arrived — the two halves of
-- the funnel sit on opposite sides of a boundary we cannot join. This table is
-- the missing half.
--
-- PRIVACY: no cookies, no PII, no raw IP. visitor_hash is a salted hash of
-- IP + user-agent that ROTATES DAILY, so it supports "unique visitors today"
-- while making cross-day tracking of an individual impossible by construction.
CREATE TABLE IF NOT EXISTS catalogue_page_event (
    id VARCHAR(36) PRIMARY KEY,
    institute_id VARCHAR(36) NOT NULL,
    catalogue_id VARCHAR(36),
    -- '' is the site root; otherwise the page's route slug.
    page_route VARCHAR(255) NOT NULL DEFAULT '',
    -- VIEW today; CTA/LEAD reserved so click tracking can be added without a
    -- second table or a migration.
    event_type VARCHAR(32) NOT NULL DEFAULT 'VIEW',
    -- Daily-rotating, salted. Not a stable identifier.
    visitor_hash VARCHAR(64),
    -- Client-generated per browsing session (sessionStorage), so a session can
    -- be reconstructed without any persistent identifier.
    session_id VARCHAR(64),
    -- Host only, never the full referring URL: a path can carry PII in query
    -- strings and we have no reason to keep it.
    referrer_host VARCHAR(255),
    utm_source VARCHAR(128),
    utm_medium VARCHAR(128),
    utm_campaign VARCHAR(191),
    device VARCHAR(16),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- The dashboard's three questions: how did this SITE do, how did this PAGE do,
-- and where did traffic come from — each over a date range.
CREATE INDEX IF NOT EXISTS idx_cpe_institute_created
    ON catalogue_page_event (institute_id, created_at);
CREATE INDEX IF NOT EXISTS idx_cpe_catalogue_route_created
    ON catalogue_page_event (catalogue_id, page_route, created_at);
CREATE INDEX IF NOT EXISTS idx_cpe_institute_source_created
    ON catalogue_page_event (institute_id, utm_source, created_at);
-- Unique-visitor counts scan (institute, day, hash); without this they become
-- a full scan once a busy site has a few million rows.
CREATE INDEX IF NOT EXISTS idx_cpe_institute_visitor_created
    ON catalogue_page_event (institute_id, visitor_hash, created_at);
