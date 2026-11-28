package vacademy.io.admin_core_service.features.commerce.report.service;

import java.util.Set;

/**
 * Which documents a guarded caller may see in a report.
 *
 * @param admin              an institute ADMIN
 * @param visibleLocationIds null for every location (ADMIN); else the caller's assigned locations
 * @param allLocations       ADMIN, or assigned to every active location: such a caller also sees
 *                           documents without a location
 * @param locationId         the location the caller named, already checked; null for "all my places"
 */
public record ReportScope(boolean admin, Set<String> visibleLocationIds, boolean allLocations, String locationId) {

    /**
     * The location filter for SQL: null when nothing restricts the rows (all locations, documents
     * without one included); otherwise the set the location column must be in (may be empty).
     */
    public Set<String> locationIn() {
        if (locationId != null) {
            return Set.of(locationId);
        }
        return allLocations ? null : (visibleLocationIds == null ? Set.of() : visibleLocationIds);
    }
}
