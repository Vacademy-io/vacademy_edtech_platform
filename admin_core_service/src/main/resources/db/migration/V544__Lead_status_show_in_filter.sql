-- Per-status control over whether a lead status is offered in the Lead Status
-- FILTER dropdowns. Independent of is_active: a status can stay fully assignable
-- and reportable while being kept out of the filter list, which institutes with a
-- long pipeline asked for. Defaults to true so no existing filter list changes.
ALTER TABLE lead_status
    ADD COLUMN IF NOT EXISTS show_in_filter BOOLEAN NOT NULL DEFAULT TRUE;
