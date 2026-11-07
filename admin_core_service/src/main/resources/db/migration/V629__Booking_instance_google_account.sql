-- The Google account a booking's Meet link + calendar event were created under. NULL = booked
-- before this column existed (resolve from the host); '' = the institute default account.
ALTER TABLE booking_instance ADD COLUMN IF NOT EXISTS google_account_id VARCHAR(255);
