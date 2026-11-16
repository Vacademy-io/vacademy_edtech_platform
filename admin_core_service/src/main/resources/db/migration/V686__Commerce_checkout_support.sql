-- Commerce checkout support (docs/commerce/ARCHITECTURE.md sections 4.1, 5 and 7.3,
-- SPIKES d and g, BUILD_PLAN WP-12).
-- New tables only: no existing table is altered, and no table of V685 is touched.

-- Every order created at the payment gateway for a commerce order. This row is what ties a
-- payment to an order: the webhook and the client confirmation find the commerce order by the
-- gateway order id of the PAYMENT (never by the payment notes) and compare the amount with it.
-- One commerce order may have several rows, one per attempt; a payment on any of them pays it.
--   status CREATED     the gateway order exists, no payment seen
--          AUTHORIZED  a payment was authorised and is waiting for capture
--          PAID        a captured payment was seen
--          FAILED      the last payment attempt failed (a later capture still pays the order)
-- paying is TRUE on the one row whose payment claimed the payment logs of the order (set in
-- the claim transaction). A captured payment that claims nothing and is not that payment is a
-- second payment for a paid order: see commerce_payment_exception.
-- settled_at is set when the order code has dealt with the payment (confirmed, or left the
-- order cancelled on purpose); the reconcile job retries the rows where it is still empty.
CREATE TABLE IF NOT EXISTS commerce_gateway_order (
    id                  VARCHAR(36)   PRIMARY KEY,
    institute_id        VARCHAR(36)   NOT NULL,
    commerce_order_id   VARCHAR(36)   NOT NULL,
    vendor              VARCHAR(32)   NOT NULL,
    gateway_order_id    VARCHAR(64)   NOT NULL,
    key_id              VARCHAR(64),
    amount_minor        BIGINT        NOT NULL,
    currency            VARCHAR(8)    NOT NULL,
    receipt             VARCHAR(64),
    status              VARCHAR(16)   NOT NULL DEFAULT 'CREATED',
    gateway_payment_id  VARCHAR(64),
    status_at           TIMESTAMP,
    settled_at          TIMESTAMP,
    paying              BOOLEAN       NOT NULL DEFAULT FALSE,
    created_at          TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_commerce_gateway_order_vendor_order UNIQUE (vendor, gateway_order_id),
    CONSTRAINT ck_commerce_gateway_order_status
        CHECK (status IN ('CREATED', 'AUTHORIZED', 'PAID', 'FAILED')),
    CONSTRAINT ck_commerce_gateway_order_amount CHECK (amount_minor > 0)
);
CREATE INDEX IF NOT EXISTS idx_commerce_gateway_order_order
    ON commerce_gateway_order (commerce_order_id);
-- The reconcile job reads only the rows the order code has not dealt with yet.
CREATE INDEX IF NOT EXISTS idx_commerce_gateway_order_unsettled
    ON commerce_gateway_order (created_at) WHERE settled_at IS NULL;

-- One one-time code sent to a shopper. Commerce makes the code itself and keeps only its
-- HMAC-SHA256 (code_hash, keyed with a server secret and bound to the institute, the phone and
-- the purpose); the platform only delivers the message, and its shared OTP store is not used.
-- The row carries the wrong-guess limit, single use, the institute and the purpose. The phone
-- is stored as a SHA-256 hash only.
--   status SENT        a code was sent and can still be tried
--          VERIFIED    the code was accepted once; token_key signs the verified-phone token
--          CONSUMED    the verified-phone token was spent (for example on one COD order)
--          LOCKED      too many wrong guesses
--          SUPERSEDED  a newer code was sent to the same phone for the same purpose
CREATE TABLE IF NOT EXISTS commerce_otp_challenge (
    id                VARCHAR(36)  PRIMARY KEY,
    institute_id      VARCHAR(36)  NOT NULL,
    phone_hash        VARCHAR(64)  NOT NULL,
    purpose           VARCHAR(32)  NOT NULL,
    status            VARCHAR(16)  NOT NULL DEFAULT 'SENT',
    attempts          INTEGER      NOT NULL DEFAULT 0,
    code_hash         VARCHAR(64),
    expires_at        TIMESTAMP    NOT NULL,
    verified_at       TIMESTAMP,
    token_key         VARCHAR(64),
    token_expires_at  TIMESTAMP,
    consumed_at       TIMESTAMP,
    created_at        TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at        TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_commerce_otp_challenge_status
        CHECK (status IN ('SENT', 'VERIFIED', 'CONSUMED', 'LOCKED', 'SUPERSEDED')),
    CONSTRAINT ck_commerce_otp_challenge_attempts CHECK (attempts >= 0)
);
CREATE INDEX IF NOT EXISTS idx_commerce_otp_challenge_phone
    ON commerce_otp_challenge (institute_id, phone_hash, purpose, created_at);
-- For deleting old rows.
CREATE INDEX IF NOT EXISTS idx_commerce_otp_challenge_created
    ON commerce_otp_challenge (created_at);

-- Money that arrived and that a person must look at, because the system could not use it:
--   kind OVERSOLD_PAID      an order was paid after its hold ended and the stock was gone; the
--                           order is CANCELLED and the whole amount is due back
--        DUPLICATE_PAYMENT  a second captured payment arrived for an order that was already
--                           paid (two gateway orders of one order, or two payments on one);
--                           that payment is due back
-- The automatic refund is WP-32; until then staff work from this list. One row per order, kind
-- and gateway payment, so a webhook delivered again adds nothing.
--   status OPEN      nobody has dealt with it
--          RESOLVED  refunded or otherwise settled, by resolved_by, with resolution_note
CREATE TABLE IF NOT EXISTS commerce_payment_exception (
    id                  VARCHAR(36)   PRIMARY KEY,
    institute_id        VARCHAR(36)   NOT NULL,
    commerce_order_id   VARCHAR(36)   NOT NULL,
    order_number        VARCHAR(40),
    kind                VARCHAR(32)   NOT NULL,
    gateway_order_id    VARCHAR(64),
    gateway_payment_id  VARCHAR(64)   NOT NULL DEFAULT '',
    amount              NUMERIC(14, 2),
    currency            VARCHAR(8),
    status              VARCHAR(16)   NOT NULL DEFAULT 'OPEN',
    detail              VARCHAR(500),
    resolved_at         TIMESTAMP,
    resolved_by         VARCHAR(36),
    resolution_note     VARCHAR(500),
    created_at          TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_commerce_payment_exception UNIQUE (commerce_order_id, kind, gateway_payment_id),
    CONSTRAINT ck_commerce_payment_exception_kind CHECK (kind IN ('OVERSOLD_PAID', 'DUPLICATE_PAYMENT')),
    CONSTRAINT ck_commerce_payment_exception_status CHECK (status IN ('OPEN', 'RESOLVED'))
);
CREATE INDEX IF NOT EXISTS idx_commerce_payment_exception_open
    ON commerce_payment_exception (institute_id, created_at) WHERE status = 'OPEN';

-- Old URLs of a shop that moved here (ARCHITECTURE.md section 3.3, STOREFRONT.md section 2).
-- The edge asks /open/commerce/v1/redirects/resolve for a path that is no page of the site.
--   from_path    normalised: percent-decoded, Unicode NFC, ASCII lower case, no trailing
--                slash; an EXACT row may carry a query string
--   match_type   EXACT   the whole path (first with its query string, then without)
--                PREFIX  the path starts with from_path; the longest row wins
--   status_code  301 with to_path (a path on the same site, may carry a query string)
--                410 with no to_path: the page is gone
CREATE TABLE IF NOT EXISTS site_redirect (
    id            VARCHAR(36)    PRIMARY KEY,
    institute_id  VARCHAR(36)    NOT NULL,
    from_path     VARCHAR(1024)  NOT NULL,
    match_type    VARCHAR(16)    NOT NULL DEFAULT 'EXACT',
    to_path       VARCHAR(1024),
    status_code   INTEGER        NOT NULL DEFAULT 301,
    created_at    TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_site_redirect_from UNIQUE (institute_id, match_type, from_path),
    CONSTRAINT ck_site_redirect_match_type CHECK (match_type IN ('EXACT', 'PREFIX')),
    CONSTRAINT ck_site_redirect_status
        CHECK ((status_code = 301 AND to_path IS NOT NULL) OR (status_code = 410 AND to_path IS NULL))
);
