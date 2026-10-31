-- Automatic lead list per ad campaign, plus admin-entered campaign names.
--
-- WHY: Google lead form webhooks carry only the numeric campaign id. With
-- auto_create_campaign_lists on, a connector gives each new campaign its own
-- list on the first lead instead of leaving it on the main list. The list is
-- named after campaign_name when the admin entered one (Google never sends it).
--
-- Both columns are nullable and default to off / no name, so every existing
-- connector keeps routing exactly as before until an admin turns this on.
ALTER TABLE form_webhook_connector
    ADD COLUMN IF NOT EXISTS auto_create_campaign_lists BOOLEAN DEFAULT FALSE;

ALTER TABLE ad_campaign_route
    ADD COLUMN IF NOT EXISTS campaign_name VARCHAR(255);
