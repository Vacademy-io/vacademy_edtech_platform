-- Approved websites of an institute for the public Catalogue API (catalog_api/website).
-- A browser call to /open/catalog/v1 with a publishable key (vak_pub_...) is accepted only
-- when its Origin host equals, or is a subdomain of, a VERIFIED row of the key's institute.
-- Verification is self-serve: the institute adds the DNS TXT record
--   _vacademy-verification.<host>  "vacademy-site-verification=<verification_token>"
-- and the admin clicks Verify. Platform staff can REVOKE a row; a REVOKED row stays so the
-- institute cannot simply add the host again. A row the institute removes is deleted.
-- host is the normalised ASCII host (lower case, punycode, no port, no trailing dot).
CREATE TABLE IF NOT EXISTS institute_website (
    id VARCHAR(36) PRIMARY KEY,
    institute_id VARCHAR(255) NOT NULL,
    host VARCHAR(253) NOT NULL,
    status VARCHAR(20) NOT NULL,
    verification_token VARCHAR(64) NOT NULL,
    verified_at TIMESTAMPTZ NULL,
    last_checked_at TIMESTAMPTZ NULL,
    last_error VARCHAR(500) NULL,
    created_by VARCHAR(255) NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at TIMESTAMPTZ NULL,
    revoked_by VARCHAR(255) NULL,
    revoked_reason VARCHAR(500) NULL,
    CONSTRAINT uq_institute_website_institute_host UNIQUE (institute_id, host)
);

CREATE INDEX IF NOT EXISTS idx_institute_website_host ON institute_website (host);
CREATE INDEX IF NOT EXISTS idx_institute_website_institute_status ON institute_website (institute_id, status);
