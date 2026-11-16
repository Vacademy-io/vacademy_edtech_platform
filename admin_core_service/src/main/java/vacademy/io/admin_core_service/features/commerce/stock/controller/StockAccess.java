package vacademy.io.admin_core_service.features.commerce.stock.controller;

import org.springframework.security.core.GrantedAuthority;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.commerce.security.CommerceAccessGuard;
import vacademy.io.admin_core_service.features.commerce.security.CommerceRole;
import vacademy.io.admin_core_service.features.commerce.security.entity.CommerceStaffLocation;
import vacademy.io.admin_core_service.features.commerce.security.repository.CommerceStaffLocationRepository;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.LinkedHashSet;
import java.util.Set;

/**
 * What a guarded caller may see in the stock endpoints. It is used only after
 * {@link CommerceAccessGuard#require} has passed, and adds nothing to that check: it answers
 * "which locations" and "may this role see cost" for the response.
 */
@Component
public class StockAccess {

    static final Set<CommerceRole> MANAGER = Set.of(CommerceRole.STORE_MANAGER);
    static final Set<CommerceRole> STOCK_STAFF = Set.of(CommerceRole.STORE_MANAGER, CommerceRole.WAREHOUSE_STAFF);
    static final Set<CommerceRole> STOCK_READERS = Set.of(CommerceRole.STORE_MANAGER, CommerceRole.WAREHOUSE_STAFF,
            CommerceRole.ACCOUNTANT);
    static final Set<CommerceRole> COST_WRITERS = Set.of(CommerceRole.STORE_MANAGER, CommerceRole.ACCOUNTANT);
    static final Set<CommerceRole> ANY_STAFF = Set.of(CommerceRole.values());

    private final CommerceStaffLocationRepository staffLocationRepository;

    public StockAccess(CommerceStaffLocationRepository staffLocationRepository) {
        this.staffLocationRepository = staffLocationRepository;
    }

    /** An institute ADMIN: a store manager at every location. */
    public static boolean isAdmin(CustomUserDetails user) {
        if (user == null || user.getAuthorities() == null) {
            return false;
        }
        for (GrantedAuthority authority : user.getAuthorities()) {
            if (authority != null && authority.getAuthority() != null
                    && "ADMIN".equals(authority.getAuthority().trim().toUpperCase())) {
                return true;
            }
        }
        return false;
    }

    public static boolean isManager(CustomUserDetails user) {
        return isAdmin(user) || CommerceAccessGuard.rolesOf(user).contains(CommerceRole.STORE_MANAGER);
    }

    /** Cost is for the manager and the accountant; never for warehouse staff or a cashier. */
    public static boolean seesCost(CustomUserDetails user) {
        return isManager(user) || CommerceAccessGuard.rolesOf(user).contains(CommerceRole.ACCOUNTANT);
    }

    /** Piece status and location are for everyone who handles goods. */
    public static boolean seesStock(CustomUserDetails user) {
        Set<CommerceRole> roles = CommerceAccessGuard.rolesOf(user);
        return isManager(user) || roles.contains(CommerceRole.WAREHOUSE_STAFF)
                || roles.contains(CommerceRole.POS_CASHIER);
    }

    /**
     * The locations a list may show: null for an institute ADMIN (all of them), otherwise the
     * caller's rows in {@code commerce_staff_location}, which may be none.
     */
    public Set<String> visibleLocationIds(CustomUserDetails user, String instituteId) {
        if (isAdmin(user)) {
            return null;
        }
        Set<String> ids = new LinkedHashSet<>();
        for (CommerceStaffLocation row : staffLocationRepository.findByInstituteIdAndUserId(instituteId, user.getUserId())) {
            ids.add(row.getLocationId());
        }
        return ids;
    }
}
