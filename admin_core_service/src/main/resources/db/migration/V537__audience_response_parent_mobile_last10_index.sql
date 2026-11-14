-- V537: index the "is this phone already a lead in the institute" lookup.
--
-- WhatsApp chatbot flows (CRM_LEAD_CHECK) look a sender up by the last 10 digits of
-- audience_response.parent_mobile on the first message of every flow, and the institute
-- dedup setting (LeadDeduplicationService, field PHONE) and telephony attribution use the
-- same expression:
--
--     RIGHT(regexp_replace(parent_mobile, '[^0-9]', '', 'g'), 10) = :last10
--
-- A plain index on parent_mobile cannot serve that predicate, so each lookup scanned every
-- lead of the institute. An expression index on exactly that expression lets it probe instead.
-- Partial on parent_mobile IS NOT NULL, matching the queries.
--
-- Plain CREATE INDEX rather than CONCURRENTLY: Flyway runs each migration inside a transaction
-- (see V467). On a large audience_response the brief write lock can be avoided by creating the
-- same index CONCURRENTLY by hand before deploying; IF NOT EXISTS then makes this a no-op.

CREATE INDEX IF NOT EXISTS idx_audience_response_parent_mobile_last10
    ON audience_response ((RIGHT(regexp_replace(parent_mobile, '[^0-9]', '', 'g'), 10)))
    WHERE parent_mobile IS NOT NULL;
