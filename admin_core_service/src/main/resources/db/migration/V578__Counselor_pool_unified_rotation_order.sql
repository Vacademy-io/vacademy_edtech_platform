-- Opt-in flag so a pool rotates in ONE pool-wide order instead of reading
-- "who is next" from each list's own display_order. Lists of a pool can end up
-- in different orders, and with the pool-wide pointer that skips some
-- counsellors and doubles others. When false (default, and for all existing
-- pools), routing behaves exactly as before and per-campaign orders apply.
-- A constant default makes the ADD COLUMN a metadata-only change.
ALTER TABLE counselor_pool
    ADD COLUMN IF NOT EXISTS unified_rotation_order BOOLEAN NOT NULL DEFAULT FALSE;
