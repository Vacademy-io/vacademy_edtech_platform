package vacademy.io.admin_core_service.features.commerce.security;

/**
 * The four commerce staff roles. They are platform rows in auth_service
 * {@code roles}; a grant is a {@code user_role} row, so the role name arrives as an authority
 * for the clientId institute.
 */
public enum CommerceRole {
    STORE_MANAGER,
    WAREHOUSE_STAFF,
    POS_CASHIER,
    ACCOUNTANT;

    /** The authority name carried by the principal, e.g. {@code COMMERCE_STORE_MANAGER}. */
    public String authority() {
        return "COMMERCE_" + name();
    }
}
