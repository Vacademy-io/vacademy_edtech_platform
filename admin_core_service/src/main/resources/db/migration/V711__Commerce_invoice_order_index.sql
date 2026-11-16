-- invoice.commerce_order_id (V682) has no index; the commerce invoice backlog and the order desk
-- read invoice rows by it. Partial index: only rows that belong to a commerce order. The invoice
-- table is small (about 20k rows, a few hundred writes a day) and almost no row has a commerce
-- order yet, so a plain build inside the migration's transaction takes milliseconds; it holds a
-- SHARE lock on invoice only for that time. lock_timeout makes it give up instead of queueing
-- behind a long writer. A CONCURRENTLY build would instead wait for every older transaction in
-- the database and can hit the server's statement timeout.
SET LOCAL lock_timeout = '5s';
CREATE INDEX IF NOT EXISTS idx_invoice_commerce_order
    ON invoice (commerce_order_id)
    WHERE commerce_order_id IS NOT NULL;
