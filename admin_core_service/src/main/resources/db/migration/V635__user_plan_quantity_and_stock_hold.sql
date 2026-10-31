-- Per-line quantity on a purchase, and stock holds taken while a learner pays.
--
-- user_plan.quantity: copies bought on this line (e.g. 4 copies of one book). Every
-- existing plan bought exactly one, so DEFAULT 1 is correct for all old rows. The plan's
-- payment_plan.actual_price stays the UNIT price; line total = unit price x quantity.
ALTER TABLE user_plan ADD COLUMN IF NOT EXISTS quantity INTEGER NOT NULL DEFAULT 1;

-- stock_hold: every stock movement a checkout makes on a stock-tracked package session
-- (package_session.max_seats set; unlimited sessions never get a row).
--
--   kind    PURCHASE        - stock for the plan's own package session(s)
--           RENT_PREFERENCE - a book picked at rent checkout; the membership plan owns the
--                             hold until an admin assigns the book (claimed_by_user_plan_id)
--   status  HELD     - taken from available_slots, payment not confirmed yet
--           SOLD     - payment confirmed (or a free / admin enrollment)
--           RELEASED - given back unpaid (window closed or expires_at passed)
--           RESTORED - given back after a sale (cancel, return, de-assign)
--
-- payment_log_id is the order's gateway payment log (the one the storefront polls and
-- releases by), so every hold of a multi-item order shares it.
CREATE TABLE IF NOT EXISTS stock_hold (
    id                      VARCHAR(255) PRIMARY KEY,
    package_session_id      VARCHAR(255) NOT NULL,
    user_id                 VARCHAR(255),
    institute_id            VARCHAR(255),
    user_plan_id            VARCHAR(255),
    payment_log_id          VARCHAR(255),
    kind                    VARCHAR(32)  NOT NULL,
    quantity                INTEGER      NOT NULL,
    status                  VARCHAR(32)  NOT NULL,
    claimed_by_user_plan_id VARCHAR(255),
    oversold                BOOLEAN      NOT NULL DEFAULT FALSE,
    expires_at              TIMESTAMP,
    created_at              TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at              TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_stock_hold_status_expires ON stock_hold (status, expires_at);
CREATE INDEX IF NOT EXISTS idx_stock_hold_user_plan ON stock_hold (user_plan_id);
CREATE INDEX IF NOT EXISTS idx_stock_hold_claimed_by ON stock_hold (claimed_by_user_plan_id);
CREATE INDEX IF NOT EXISTS idx_stock_hold_payment_log ON stock_hold (payment_log_id);
CREATE INDEX IF NOT EXISTS idx_stock_hold_ps_status ON stock_hold (package_session_id, status);
CREATE INDEX IF NOT EXISTS idx_stock_hold_user_kind_status ON stock_hold (user_id, kind, status);
