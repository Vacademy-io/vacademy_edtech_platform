-- Commerce P2: shopper sessions, proved-phone flag on orders, lost-webhook payment fetch.
-- Commerce tables only. All three tables are empty in production when this runs.

-- Raising it ends every shopper session of that phone in that shop ("sign out everywhere").
ALTER TABLE commerce_customer      ADD COLUMN IF NOT EXISTS session_epoch    INTEGER   NOT NULL DEFAULT 0;

-- True when the buyer proved the phone of the order (OTP or shopper session). Orders placed
-- with a phone that was not proved show as masked rows in that phone's account.
ALTER TABLE commerce_order         ADD COLUMN IF NOT EXISTS phone_verified   BOOLEAN   NOT NULL DEFAULT FALSE;

-- Lost-webhook fetch: how often the gateway was asked about this gateway order, and when next.
ALTER TABLE commerce_gateway_order ADD COLUMN IF NOT EXISTS fetch_count      INTEGER   NOT NULL DEFAULT 0;
ALTER TABLE commerce_gateway_order ADD COLUMN IF NOT EXISTS next_fetch_at    TIMESTAMP;
ALTER TABLE commerce_gateway_order ADD COLUMN IF NOT EXISTS last_fetched_at  TIMESTAMP;
ALTER TABLE commerce_gateway_order ADD COLUMN IF NOT EXISTS final_fetched_at TIMESTAMP;
-- Gateway errors in a row for this gateway order (0 after a fetch that got an answer); the
-- retry waits longer as it grows.
ALTER TABLE commerce_gateway_order ADD COLUMN IF NOT EXISTS fetch_errors     INTEGER   NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_commerce_gateway_order_fetch
    ON commerce_gateway_order (next_fetch_at) WHERE settled_at IS NULL AND paying = false;
