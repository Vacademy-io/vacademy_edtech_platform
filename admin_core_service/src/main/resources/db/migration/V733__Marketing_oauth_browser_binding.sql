-- Binds a marketing OAuth flow to the browser that started it: /initiate sets a random nonce in an
-- HttpOnly cookie and stores its SHA-256 (hex) here; the public callback refuses a browser whose
-- cookie is missing or does not match, so a consent link sent to someone else cannot attach their
-- Meta / Google account to the sender's institute. Null for every other OAuth flow.
ALTER TABLE oauth_connect_state ADD COLUMN IF NOT EXISTS browser_nonce_hash VARCHAR(64);
