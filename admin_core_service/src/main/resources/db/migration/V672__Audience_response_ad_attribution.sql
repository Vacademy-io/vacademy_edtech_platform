-- ================================================================================
-- V672: the ad an ad-platform lead came from
-- ================================================================================
--
-- Revenue and lead reports group by campaign, ad set and ad. A Meta Lead Ads lead
-- carries its ad id, ad set id and form id in the webhook, and the Graph lead
-- lookup can add the campaign id and the names; a Google lead form lead carries its
-- campaign, ad group (or asset group), creative and form ids. These columns keep
-- them on the lead row so a report can group by them.
--
-- Written once when the lead is created; NULL for every other source. Names are
-- only filled when the platform returned them. Nothing is backfilled.
-- No index: reports filter by institute and window first and group these columns
-- within that set.

ALTER TABLE audience_response
    ADD COLUMN IF NOT EXISTS ad_campaign_id VARCHAR(100),
    ADD COLUMN IF NOT EXISTS ad_campaign_name VARCHAR(255),
    ADD COLUMN IF NOT EXISTS ad_set_id VARCHAR(100),
    ADD COLUMN IF NOT EXISTS ad_set_name VARCHAR(255),
    ADD COLUMN IF NOT EXISTS ad_id VARCHAR(100),
    ADD COLUMN IF NOT EXISTS ad_name VARCHAR(255),
    ADD COLUMN IF NOT EXISTS ad_form_id VARCHAR(100);
