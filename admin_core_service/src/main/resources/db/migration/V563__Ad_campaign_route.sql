-- Route ad-platform leads to a lead list per campaign.
--
-- WHY: one Google Ads lead form usually runs in several campaigns, and its
-- webhook connector delivered every lead to the connector's single audience.
-- Institutes want each campaign's leads in that campaign's own list (its own
-- workflows, counsellor pool, reports). One row per (connector, campaign):
-- audience_id is where that campaign's leads go; NULL means "not mapped yet",
-- and those leads keep going to the connector's own audience (the catch-all).
-- Rows appear on a campaign's first lead, or when an admin maps a campaign id
-- before any lead has arrived (added_manually).
CREATE TABLE IF NOT EXISTS ad_campaign_route (
    id VARCHAR(36) PRIMARY KEY,
    connector_id VARCHAR(255) NOT NULL,
    institute_id VARCHAR(255) NOT NULL,
    -- Google: the numeric campaign_id from the lead form webhook.
    campaign_id VARCHAR(64) NOT NULL,
    audience_id VARCHAR(255),
    lead_count INTEGER NOT NULL DEFAULT 0,
    first_lead_at TIMESTAMP,
    last_lead_at TIMESTAMP,
    added_manually BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_ad_campaign_route_connector_campaign UNIQUE (connector_id, campaign_id)
);

CREATE INDEX IF NOT EXISTS idx_ad_campaign_route_institute
    ON ad_campaign_route (institute_id);

-- Campaigns that already sent leads before this table existed: Google leads
-- carry their campaign id in audience_response.source_id. Unmapped, so their
-- routing is unchanged until an admin maps them.
INSERT INTO ad_campaign_route (id, connector_id, institute_id, campaign_id,
                               lead_count, first_lead_at, last_lead_at)
SELECT md5(c.id || ':' || ar.source_id),
       c.id,
       c.institute_id,
       ar.source_id,
       COUNT(*),
       MIN(ar.created_at),
       MAX(ar.created_at)
  FROM audience_response ar
  JOIN form_webhook_connector c
    ON c.audience_id = ar.audience_id
   AND c.vendor = 'GOOGLE_LEAD_ADS'
   AND c.is_active = TRUE
 WHERE ar.source_type = 'GOOGLE_LEAD_ADS'
   AND ar.source_id ~ '^[0-9]{1,64}$'
 GROUP BY c.id, c.institute_id, ar.source_id
ON CONFLICT (connector_id, campaign_id) DO NOTHING;
