-- One-time login codes for "log the buyer in after purchase" on product pages.
-- Only the SHA-256 of the code is stored. A code is minted at most once per
-- payment log and is consumed on first exchange.
CREATE TABLE IF NOT EXISTS product_page_login_code (
    id              VARCHAR(255) PRIMARY KEY,
    code_hash       VARCHAR(64)  NOT NULL,
    user_id         VARCHAR(255) NOT NULL,
    institute_id    VARCHAR(255) NOT NULL,
    product_page_id VARCHAR(255) NOT NULL,
    payment_log_id  VARCHAR(255) NOT NULL,
    expires_at      TIMESTAMP    NOT NULL,
    consumed_at     TIMESTAMP,
    created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_pp_login_code_hash UNIQUE (code_hash),
    CONSTRAINT uq_pp_login_code_payment_log UNIQUE (payment_log_id)
);
