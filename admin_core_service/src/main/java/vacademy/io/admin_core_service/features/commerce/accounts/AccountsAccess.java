package vacademy.io.admin_core_service.features.commerce.accounts;

import vacademy.io.admin_core_service.features.commerce.security.CommerceRole;

import java.util.Set;

/**
 * Role sets of the accounts routes. An institute ADMIN passes every role test, so
 * {@link #ADMIN_ONLY} (empty) lets in the ADMIN alone.
 */
public final class AccountsAccess {

    /** Store manager and accountant. */
    public static final Set<CommerceRole> ACCOUNTS_STAFF = Set.of(CommerceRole.STORE_MANAGER, CommerceRole.ACCOUNTANT);
    /** Store manager. */
    public static final Set<CommerceRole> MANAGER = Set.of(CommerceRole.STORE_MANAGER);
    /** Every commerce role. */
    public static final Set<CommerceRole> ANY_STAFF = Set.of(CommerceRole.STORE_MANAGER, CommerceRole.ACCOUNTANT,
            CommerceRole.WAREHOUSE_STAFF, CommerceRole.POS_CASHIER);
    /** No commerce role: an institute ADMIN only. */
    public static final Set<CommerceRole> ADMIN_ONLY = Set.of();

    private AccountsAccess() {
    }
}
