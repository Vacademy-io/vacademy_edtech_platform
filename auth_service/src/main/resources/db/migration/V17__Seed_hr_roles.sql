-- HR & Payroll module: dedicated HR_ADMIN and HR_MANAGER roles.
-- Same pattern as V15's MENTOR seed: roles.role_name is globally unique
-- (uk_roles_name) and RoleService.addRolesToUser resolves by name, so one
-- system-wide row per role (institute_id NULL) serves every institute — the
-- per-institute scoping lives on the user_role row. CustomUserDetails mints
-- authorities from the role NAME for the clientId institute, so assigning
-- these roles yields the 'HR_ADMIN'/'HR_MANAGER' authorities that
-- admin_core_service's HrAccessGuard checks.
INSERT INTO roles (id, role_name, created_at, updated_at)
VALUES (gen_random_uuid()::TEXT, 'HR_ADMIN', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT (role_name) DO NOTHING;

INSERT INTO roles (id, role_name, created_at, updated_at)
VALUES (gen_random_uuid()::TEXT, 'HR_MANAGER', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT (role_name) DO NOTHING;
