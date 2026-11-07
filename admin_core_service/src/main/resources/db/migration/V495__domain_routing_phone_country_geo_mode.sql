-- =====================================================================
-- V495: Let a white-label portal say HOW a phone field picks its country
-- =====================================================================
-- Every phone field on the platform -- lead capture, enroll-by-invite,
-- mentorship booking, audience/enquiry response, sub-org registration,
-- checkout, login -- already reads
-- institute_domain_routing.comma_separated_preferred_country to decide
-- which flag is pre-selected and how the picker is ordered.
--
-- That value is a fixed institute-wide list, so a form opened in Moscow
-- and a form opened in Delhi show the same +91. For institutes whose
-- audience is genuinely one country that is correct and must stay
-- correct. For institutes selling across borders it is a per-visitor
-- edit on every submission.
--
-- This column decides which of the two wins, per portal:
--
--   INSTITUTE_FIRST (null default) -- the configured list wins. Only when
--       the institute has configured NOTHING does the form fall back to
--       the country the visitor is actually in.
--   GEO_FIRST -- the visitor's own country is pre-selected; the
--       configured list still orders the rest of the picker.
--   INSTITUTE_ONLY -- never look at the visitor. The configured list, or
--       the platform default, and nothing else.
--
-- Null means INSTITUTE_FIRST, which is what every existing row already
-- does whenever comma_separated_preferred_country is set -- so no
-- backfill is needed for a configured portal. Rows that configured NO
-- countries do change: they stop hard-defaulting to India and start
-- following the visitor. That is the point of the feature; a portal that
-- wants the old behaviour sets INSTITUTE_ONLY.
--
-- The detection itself is client-side (the browser's own IANA timezone,
-- then its locale region), so it costs no request, cannot flicker after
-- the input has mounted, and never sends an IP anywhere.
-- =====================================================================

ALTER TABLE institute_domain_routing
    ADD COLUMN IF NOT EXISTS phone_country_geo_mode VARCHAR(30);

COMMENT ON COLUMN institute_domain_routing.phone_country_geo_mode IS
    'How phone inputs choose their country code: INSTITUTE_FIRST (default, null) uses comma_separated_preferred_country and falls back to the visitor''s detected country; GEO_FIRST pre-selects the visitor''s country; INSTITUTE_ONLY ignores the visitor entirely.';
