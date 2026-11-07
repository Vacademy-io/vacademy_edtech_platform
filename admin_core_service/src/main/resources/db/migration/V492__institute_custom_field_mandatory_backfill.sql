-- Make institute_custom_fields.is_mandatory trustworthy, so a form builder's Required switch can
-- finally decide what that ONE form asks for.
--
-- The switch has always written this per-form column, while every learner form read the SHARED
-- custom_fields.is_mandatory of the master row — so turning Required off saved a value nothing
-- rendered, and the switch flipped back on the next open. The fix is entirely in the frontends
-- (they now read this column and fall back to the master when it is NULL); the one thing they
-- cannot do is repair the data, which is what this migration is for.
--
-- The rows in the way are "unanswered", not intent: the column defaults to false, so every mapping
-- created by a client that never sent the flag stored false against a required master. On
-- 2 Sep 2026 that was 888 ACTIVE rows — 872 of them across 337 live enrolment invites, and all of
-- them Full Name / Email / Phone Number, fields whose Required switch was hard-locked in the
-- builder, so no admin could have turned them off. Nothing anywhere stored `true` against a
-- non-mandatory master, so this is the only direction the two ever diverge.
--
-- Aligning them makes the frontend switching to this column a no-op on the day it ships: every
-- form keeps asking for exactly what it asks for today, and the Required switch starts deciding
-- from the next save on.
UPDATE institute_custom_fields icf
SET is_mandatory = cf.is_mandatory
FROM custom_fields cf
WHERE cf.id = icf.custom_field_id
  AND icf.is_mandatory IS NOT NULL
  AND cf.is_mandatory IS NOT NULL
  AND icf.is_mandatory IS DISTINCT FROM cf.is_mandatory;
