-- Marketing: ad-account spend sync + social posting.
--
-- Why these tables exist:
--   * marketing_connection holds ONE OAuth grant per (institute, provider, external user). Meta keeps
--     a long-lived user token (60 days), Google keeps a refresh token. Both are encrypted with
--     TokenEncryptionService and never leave the server.
--   * ad_account / ad_spend_daily store the spend that Meta Ads and Google Ads report per campaign
--     per day, so the Ad performance screen can put cost next to enquiries and admissions from the CRM.
--   * social_account / social_post / social_post_target drive scheduled posting to Facebook Pages,
--     Instagram, Google Business Profile and YouTube (YouTube reuses institute_youtube_credentials).
CREATE TABLE IF NOT EXISTS marketing_connection (
  id VARCHAR(255) PRIMARY KEY,
  institute_id VARCHAR(255) NOT NULL,
  provider VARCHAR(32) NOT NULL,            -- META_ADS | META_SOCIAL | GOOGLE_ADS | GOOGLE_BUSINESS
  external_user_id VARCHAR(255),            -- Meta user id / Google sub
  external_user_name VARCHAR(255),          -- display name or email
  access_token_enc TEXT,                    -- Meta long-lived user token (60d)
  refresh_token_enc TEXT,                   -- Google refresh token
  token_expires_at TIMESTAMPTZ,
  scopes TEXT,
  status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',   -- ACTIVE | RECONNECT_NEEDED | REVOKED
  status_detail TEXT,
  oauth_state_id VARCHAR(255),              -- oauth_connect_state.id that produced/refreshed it
  connected_by_user_id VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS idx_mkt_conn_institute ON marketing_connection (institute_id, provider);
CREATE UNIQUE INDEX IF NOT EXISTS uq_mkt_conn_state ON marketing_connection (oauth_state_id) WHERE oauth_state_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS ad_account (
  id VARCHAR(255) PRIMARY KEY,
  institute_id VARCHAR(255) NOT NULL,
  connection_id VARCHAR(255) NOT NULL REFERENCES marketing_connection(id),
  platform VARCHAR(16) NOT NULL,            -- META | GOOGLE
  external_account_id VARCHAR(64) NOT NULL, -- Meta: digits without act_ ; Google: customer id digits
  login_customer_id VARCHAR(64),            -- Google manager id when reached through an MCC
  name VARCHAR(255),
  currency VARCHAR(8),
  time_zone VARCHAR(64),
  status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',   -- ACTIVE | ERROR | DISCONNECTED
  status_detail TEXT,
  last_synced_at TIMESTAMPTZ,
  last_sync_status VARCHAR(32),             -- OK | FAILED
  synced_from DATE,                         -- earliest day fetched so far
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE UNIQUE INDEX IF NOT EXISTS uq_ad_account_ext ON ad_account (institute_id, platform, external_account_id);

CREATE TABLE IF NOT EXISTS ad_spend_daily (
  id VARCHAR(255) PRIMARY KEY,
  institute_id VARCHAR(255) NOT NULL,
  ad_account_id VARCHAR(255) NOT NULL REFERENCES ad_account(id) ON DELETE CASCADE,
  platform VARCHAR(16) NOT NULL,            -- META | GOOGLE
  channel VARCHAR(32),                      -- META ; Google advertising_channel_type: SEARCH, PERFORMANCE_MAX, VIDEO, DISPLAY, DEMAND_GEN, ...
  campaign_id VARCHAR(64) NOT NULL,
  campaign_name VARCHAR(512),
  day DATE NOT NULL,                        -- in the ad account time zone
  spend NUMERIC(14,2) NOT NULL DEFAULT 0,   -- account currency
  currency VARCHAR(8),
  impressions BIGINT NOT NULL DEFAULT 0,
  clicks BIGINT NOT NULL DEFAULT 0,
  platform_leads NUMERIC(12,2) NOT NULL DEFAULT 0, -- Meta lead actions / Google conversions (platform-reported, for reference)
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE UNIQUE INDEX IF NOT EXISTS uq_ad_spend_daily ON ad_spend_daily (ad_account_id, campaign_id, day);
CREATE INDEX IF NOT EXISTS idx_ad_spend_daily_inst_day ON ad_spend_daily (institute_id, day);

CREATE TABLE IF NOT EXISTS social_account (
  id VARCHAR(255) PRIMARY KEY,
  institute_id VARCHAR(255) NOT NULL,
  connection_id VARCHAR(255) REFERENCES marketing_connection(id),  -- NULL for YOUTUBE (uses institute_youtube_credentials)
  platform VARCHAR(32) NOT NULL,            -- FACEBOOK | INSTAGRAM | GOOGLE_BUSINESS | YOUTUBE
  external_id VARCHAR(255) NOT NULL,        -- page id | ig user id | GBP location resource "locations/123" | youtube channel id
  parent_external_id VARCHAR(255),          -- IG: page id ; GBP: account resource "accounts/456"
  name VARCHAR(255),
  handle VARCHAR(255),
  avatar_url TEXT,
  followers_count BIGINT,
  access_token_enc TEXT,                    -- FB page token (also used for the IG account linked to that page)
  status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',   -- ACTIVE | RECONNECT_NEEDED | DISCONNECTED
  status_detail TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE UNIQUE INDEX IF NOT EXISTS uq_social_account_ext ON social_account (institute_id, platform, external_id);

CREATE TABLE IF NOT EXISTS social_post (
  id VARCHAR(255) PRIMARY KEY,
  institute_id VARCHAR(255) NOT NULL,
  title VARCHAR(255),
  body TEXT,
  link_url TEXT,
  media_json JSONB,                         -- [{"file_id":"..","type":"IMAGE|VIDEO","name":".."}]
  overrides_json JSONB,                     -- {"INSTAGRAM":"text", "GOOGLE_BUSINESS":"text", ...}
  scheduled_at TIMESTAMPTZ,
  status VARCHAR(32) NOT NULL DEFAULT 'DRAFT', -- DRAFT | NEEDS_APPROVAL | SCHEDULED | PUBLISHING | POSTED | PARTIAL | FAILED | CANCELLED
  source VARCHAR(16) NOT NULL DEFAULT 'MANUAL', -- MANUAL | AGENT
  created_by_user_id VARCHAR(255),
  approved_by_user_id VARCHAR(255),
  approved_at TIMESTAMPTZ,
  last_error TEXT,
  published_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS idx_social_post_inst_sched ON social_post (institute_id, scheduled_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_social_post_due ON social_post (status, scheduled_at) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS social_post_target (
  id VARCHAR(255) PRIMARY KEY,
  post_id VARCHAR(255) NOT NULL REFERENCES social_post(id) ON DELETE CASCADE,
  institute_id VARCHAR(255) NOT NULL,
  social_account_id VARCHAR(255) NOT NULL REFERENCES social_account(id),
  platform VARCHAR(32) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'PENDING', -- PENDING | PUBLISHING | POSTED | FAILED | SKIPPED
  external_post_id VARCHAR(255),
  permalink TEXT,
  container_id VARCHAR(255),                -- IG media container awaiting processing (video/reel)
  error_message TEXT,
  attempts INT NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ,
  posted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE UNIQUE INDEX IF NOT EXISTS uq_social_post_target ON social_post_target (post_id, social_account_id);
CREATE INDEX IF NOT EXISTS idx_social_post_target_due ON social_post_target (status, next_attempt_at);
