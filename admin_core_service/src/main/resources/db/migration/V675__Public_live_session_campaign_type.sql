-- Public live sessions and open assessments now get one lead list each, with the readable
-- campaign types "Public Live Session" and "Open Assessment" (AutoLeadListProvisioner).
-- The old single per-institute webinar list was auto-created with campaign_type WEBSITE;
-- give it the same type so the campaign-type filter groups every webinar list together.
-- Only the auto-created rows are touched: exact name and the WEBSITE type it was given.
UPDATE audience
SET campaign_type = 'Public Live Session'
WHERE campaign_name = 'Public Webinar - Live Session'
  AND campaign_type = 'WEBSITE';
