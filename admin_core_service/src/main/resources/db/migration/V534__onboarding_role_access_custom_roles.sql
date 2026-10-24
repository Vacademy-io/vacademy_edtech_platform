-- Onboarding role access: allow ANY institute role (custom roles such as COUNSELLOR, plus the
-- auth_service system roles) in a step's/field's role_access JSON, not just the built-in
-- ADMIN/STUDENT/PARENT trio.
--
-- The role_access / fields_config columns are already free-form JSON, so the grid itself needs
-- no schema change -- role_key just stops being restricted to the three built-ins. What DOES
-- need changing is where a resolved role name is written into a real column:
-- onboarding_step_instance.completed_by_role was sized VARCHAR(16) back when the only values it
-- could ever hold were ADMIN/STUDENT/PARENT/SYSTEM. An institute role name is a free-text
-- auth_service roles.name (e.g. 'SCHOOL_PRINCIPAL' is already exactly 16), so a counsellor
-- completing a step would have failed the insert on any longer role name.
--
-- 64 comfortably covers auth_service's roles.role_name values while keeping this an audit
-- stamp rather than a free-text column.
ALTER TABLE onboarding_step_instance
    ALTER COLUMN completed_by_role TYPE VARCHAR(64);
