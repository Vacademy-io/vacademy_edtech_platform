-- invoice.commerce_order_id (V682) has no index; the commerce invoice backlog and the order desk
-- read invoice rows by it. invoice is a platform-wide table with live rows, so the index is built
-- CONCURRENTLY (no write lock). This file holds ONLY this statement: Flyway runs a script whose
-- statements cannot run in a transaction outside one, and refuses a script that mixes both (V404).
-- No SET here: outside a transaction a SET is session-wide and would stay on the pooled connection.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_invoice_commerce_order
    ON invoice (commerce_order_id)
    WHERE commerce_order_id IS NOT NULL;
