-- A white-label domain can mount ONE course catalogue at its root, so the
-- marketing site answers on https://example.com/ and /about instead of
-- /<tag> and /<tag>/about. Null = today's behaviour (the root redirects to
-- `redirect`, and every catalogue keeps its /<tag> prefix).
ALTER TABLE institute_domain_routing
    ADD COLUMN IF NOT EXISTS root_catalogue_tag VARCHAR(255);
