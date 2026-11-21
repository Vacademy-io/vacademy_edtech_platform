-- Read-only demo user (docs/demo-stage/SPEC.md section 3): a dedicated DEMO_READ_ONLY role.
-- The public product demo signs every visitor in as one user who is ADMIN of the demo
-- institute and also holds this role; the shared JWT filter (common_service
-- DemoReadOnlyGate) and ai_service then refuse every write for that user.
-- Same pattern as the V15 MENTOR seed: roles.role_name is globally unique (uk_roles_name)
-- and add-user-roles resolves roles by name, so ONE system-wide role (institute_id NULL)
-- is enough; the institute lives on the user_role row. The role carries no permissions.
-- ON CONFLICT (role_name) DO NOTHING = idempotent.
INSERT INTO roles (id, role_name, created_at, updated_at)
VALUES (gen_random_uuid()::TEXT, 'DEMO_READ_ONLY', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT (role_name) DO NOTHING;
