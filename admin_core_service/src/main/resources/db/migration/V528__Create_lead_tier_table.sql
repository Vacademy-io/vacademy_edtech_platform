-- ============================================================
-- V528: Per-institute lead tier catalog.
-- Replaces the hard-coded HOT / WARM / COLD vocabulary so institutes can
-- rename, recolour and add their own tiers (e.g. an Eduzilla-style
-- "Interest Level": Very Cold -> Super Hot).
--   * min_score NULL  -> manual-only tier (counsellor-picked, never derived)
--   * min_score set   -> lead auto-lands in the highest band whose min_score
--                        <= best_score, unless user_lead_profile.lead_tier
--                        holds an explicit override.
-- Seeded lazily with HOT(80) / WARM(50) / COLD(0) on first access so
-- existing institutes keep today's behaviour unchanged.
-- ============================================================
CREATE TABLE IF NOT EXISTS lead_tier (
    id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    institute_id  VARCHAR(255) NOT NULL,
    tier_key      VARCHAR(100) NOT NULL,      -- stable code stored on user_lead_profile.lead_tier
    label         VARCHAR(255) NOT NULL,      -- display name
    color         VARCHAR(20),                -- hex chip colour
    display_order INTEGER NOT NULL DEFAULT 0, -- 1 = most important (drives sort + board columns)
    min_score     INTEGER,                    -- NULL = manual-only
    is_active     BOOLEAN NOT NULL DEFAULT TRUE,
    is_system     BOOLEAN NOT NULL DEFAULT FALSE,
    created_at    TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_lead_tier_institute_key ON lead_tier(institute_id, tier_key);
CREATE INDEX IF NOT EXISTS idx_lead_tier_institute ON lead_tier(institute_id, is_active, display_order);
