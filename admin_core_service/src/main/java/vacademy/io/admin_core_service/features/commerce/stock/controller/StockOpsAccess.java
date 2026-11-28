package vacademy.io.admin_core_service.features.commerce.stock.controller;

import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.commerce.security.CommerceAccessGuard;
import vacademy.io.admin_core_service.features.commerce.security.CommerceFeature;
import vacademy.io.admin_core_service.features.commerce.security.CommerceRole;
import vacademy.io.admin_core_service.features.commerce.stock.dto.StockOpsDtos.Caller;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.Set;

/**
 * The access checks of the stock operations (transfers, counts, overview, labels, quick add), on
 * top of {@link CommerceAccessGuard}: feature {@code commerce.stock}, the role sets of
 * {@link StockAccess}, and the location the action happens at.
 */
@Component
public class StockOpsAccess {

    public static final Set<CommerceRole> MANAGER = StockAccess.MANAGER;
    public static final Set<CommerceRole> STOCK_STAFF = StockAccess.STOCK_STAFF;
    public static final Set<CommerceRole> STOCK_READERS = StockAccess.STOCK_READERS;
    /** Quick add: manager, warehouse staff and the accountant. */
    public static final Set<CommerceRole> QUICK_ADD = StockAccess.STOCK_READERS;

    private final CommerceAccessGuard guard;
    private final StockAccess stockAccess;

    public StockOpsAccess(CommerceAccessGuard guard, StockAccess stockAccess) {
        this.guard = guard;
        this.stockAccess = stockAccess;
    }

    /** Membership, feature and role; no location. */
    public void require(CustomUserDetails user, String instituteId, Set<CommerceRole> roles) {
        guard.require(user, instituteId, CommerceFeature.INVENTORY, roles);
    }

    /** As {@link #require}, and assigned to the location (ADMIN passes). */
    public void requireAt(CustomUserDetails user, String instituteId, Set<CommerceRole> roles, String locationId) {
        guard.require(user, instituteId, CommerceFeature.INVENTORY, roles, locationId);
    }

    /** As {@link #requireAt} for any one of two locations (a transfer is read at its source or destination). */
    public void requireAtEither(CustomUserDetails user, String instituteId, Set<CommerceRole> roles, String first,
                                String second) {
        try {
            requireAt(user, instituteId, roles, first);
        } catch (RuntimeException firstRefusal) {
            try {
                requireAt(user, instituteId, roles, second);
            } catch (RuntimeException secondRefusal) {
                throw firstRefusal;
            }
        }
    }

    /** The caller's place facts, once the guard has passed. */
    public Caller caller(CustomUserDetails user, String instituteId) {
        boolean admin = StockAccess.isAdmin(user);
        Set<CommerceRole> roles = CommerceAccessGuard.rolesOf(user);
        boolean staff = admin || roles.contains(CommerceRole.STORE_MANAGER)
                || roles.contains(CommerceRole.WAREHOUSE_STAFF);
        return new Caller(user.getUserId(), admin, StockAccess.isManager(user), staff, StockAccess.seesCost(user),
                stockAccess.visibleLocationIds(user, instituteId));
    }
}
