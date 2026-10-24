-- Structured record of how an offline payment was made (cash, UPI via PhonePe, bank transfer
-- into a given account, cheque ...), set by admins when they mark a payment as received.
-- See docs/OFFLINE_PAYMENT_RECORDING.md. All additive and nullable: gateway payments and
-- payments recorded before this migration keep null here.

-- payment_log is busy: never queue behind a long transaction holding it (and block every
-- payment behind us meanwhile). If the lock is not free within 10 s the migration fails
-- cleanly and the next deploy retries; the old pods keep serving.
SET LOCAL lock_timeout = '10s';

ALTER TABLE payment_log
    ADD COLUMN IF NOT EXISTS payment_mode VARCHAR(40) NULL,
    ADD COLUMN IF NOT EXISTS payment_sub_mode VARCHAR(80) NULL,
    ADD COLUMN IF NOT EXISTS payment_reference VARCHAR(255) NULL,
    -- Mode/sub-mode labels as shown when recorded, plus mode-specific extras (cheque date,
    -- bank name, payer name), notes and the proof file id.
    ADD COLUMN IF NOT EXISTS payment_details_json TEXT NULL,
    ADD COLUMN IF NOT EXISTS recorded_by_user_id VARCHAR(255) NULL;

-- The offline payment modes and sub-options an institute offers. Kept out of
-- institutes.setting_json on purpose: parts of that blob are served to learners and the
-- public, and these options can name bank accounts. One row per institute; read by staff only.
CREATE TABLE IF NOT EXISTS institute_offline_payment_setting (
    institute_id VARCHAR(255) PRIMARY KEY REFERENCES institutes (id),
    setting_json TEXT NOT NULL,
    updated_by_user_id VARCHAR(255) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
