-- Commerce module: the four shop staff roles.
-- Same pattern as V15 (MENTOR) and V17 (HR roles): one system-wide row per role
-- (institute_id NULL); the per-institute scope lives on the user_role row, and the
-- role NAME becomes the authority that admin_core_service CommerceAccessGuard checks.
-- Granting or removing these roles is ADMIN-only (AdminRoleGrantGuard).
INSERT INTO roles (id, role_name, created_at, updated_at)
VALUES (gen_random_uuid()::TEXT, 'COMMERCE_STORE_MANAGER', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT (role_name) DO NOTHING;

INSERT INTO roles (id, role_name, created_at, updated_at)
VALUES (gen_random_uuid()::TEXT, 'COMMERCE_WAREHOUSE_STAFF', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT (role_name) DO NOTHING;

INSERT INTO roles (id, role_name, created_at, updated_at)
VALUES (gen_random_uuid()::TEXT, 'COMMERCE_POS_CASHIER', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT (role_name) DO NOTHING;

INSERT INTO roles (id, role_name, created_at, updated_at)
VALUES (gen_random_uuid()::TEXT, 'COMMERCE_ACCOUNTANT', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT (role_name) DO NOTHING;
