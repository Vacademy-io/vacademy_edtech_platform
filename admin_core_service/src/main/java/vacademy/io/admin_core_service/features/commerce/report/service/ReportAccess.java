package vacademy.io.admin_core_service.features.commerce.report.service;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.commerce.report.repository.ReportReadRepository;
import vacademy.io.admin_core_service.features.commerce.report.repository.ReportReadRepository.Place;
import vacademy.io.admin_core_service.features.commerce.security.CommerceAccessDeniedException;
import vacademy.io.admin_core_service.features.commerce.security.CommerceAccessGuard;
import vacademy.io.admin_core_service.features.commerce.security.CommerceFeature;
import vacademy.io.admin_core_service.features.commerce.security.CommerceRole;
import vacademy.io.admin_core_service.features.commerce.stock.controller.StockAccess;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * Who may read which report (contract section 3.5). Every check goes through
 * {@link CommerceAccessGuard}: membership of the institute, the feature, then the role (institute
 * ADMIN always, else store manager or accountant). Cashiers and warehouse staff are refused.
 *
 * <ul>
 *   <li>GST reports ({@code commerce.tax_reports}): the caller must be ADMIN or assigned to every
 *       location of the institute, because a GST return covers the whole GSTIN. "Every location"
 *       counts every location whatever its status (ACTIVE or INACTIVE; the platform has no
 *       archived state): switching a place to INACTIVE must not widen what a reader assigned to
 *       the others sees. An institute with no location gives "every location" to ADMIN only.</li>
 *   <li>Day book and POS sessions ({@code commerce.tax_reports}) and the sales and money reports
 *       ({@code commerce.orders}): rows of the caller's locations; a named location must be one.</li>
 *   <li>Audit ({@code commerce.tax_reports} or {@code commerce.orders}): as the second rule.</li>
 * </ul>
 */
@Component
public class ReportAccess {

    /** The roles that read reports (institute ADMIN always passes). */
    public static final Set<CommerceRole> READERS = Set.of(CommerceRole.STORE_MANAGER, CommerceRole.ACCOUNTANT);
    /** A location id as the platform writes them; anything else is no location of the institute. */
    private static final Pattern LOCATION_ID = Pattern.compile("^[A-Za-z0-9_\\-]{1,64}$");

    /** Which rule a report follows. */
    public enum Kind {
        /** GST pack: every location. */
        GST,
        /** Day book, POS sessions: tax reports feature, own locations. */
        COUNTER,
        /** Sales, products, payment modes, COD, dues: orders feature, own locations. */
        ORDERS,
        /** Audit list: either feature, own locations. */
        AUDIT
    }

    /** The rule of each report name of {@code /reports/{name}} (contract section 3.5). */
    public static final Map<String, Kind> REPORT_KINDS = Map.ofEntries(
            Map.entry("sales-register", Kind.GST),
            Map.entry("credit-notes", Kind.GST),
            Map.entry("tax-by-rate", Kind.GST),
            Map.entry("hsn-summary", Kind.GST),
            Map.entry("gstr1", Kind.GST),
            Map.entry("documents-issued", Kind.GST),
            Map.entry("gst-pack", Kind.GST),
            Map.entry("day-book", Kind.COUNTER),
            Map.entry("pos-sessions", Kind.COUNTER),
            Map.entry("sales", Kind.ORDERS),
            Map.entry("products", Kind.ORDERS),
            Map.entry("payment-modes", Kind.ORDERS),
            Map.entry("cod-outstanding", Kind.ORDERS),
            Map.entry("customer-dues", Kind.ORDERS));

    /** The rule of a report name; null for a name that is not a report. */
    public static Kind kindOf(String reportName) {
        return reportName == null ? null : REPORT_KINDS.get(reportName);
    }

    private final CommerceAccessGuard guard;
    private final StockAccess stockAccess;
    private final ReportReadRepository readRepository;

    public ReportAccess(CommerceAccessGuard guard, StockAccess stockAccess, ReportReadRepository readRepository) {
        this.guard = guard;
        this.stockAccess = stockAccess;
        this.readRepository = readRepository;
    }

    /** Checks the caller for a report of this kind and returns what they may see. */
    public ReportScope require(Kind kind, CustomUserDetails user, String instituteId, String locationId) {
        switch (kind) {
            case GST, COUNTER -> guard.require(user, instituteId, CommerceFeature.REPORTS, READERS);
            case ORDERS -> guard.require(user, instituteId, CommerceFeature.ORDERS, READERS);
            case AUDIT -> guard.requireEither(user, instituteId, CommerceFeature.REPORTS, READERS,
                    CommerceFeature.ORDERS, READERS);
            default -> throw new IllegalArgumentException("unknown report kind " + kind);
        }
        String named = locationId == null || locationId.isBlank() ? null : locationId.trim();
        if (named != null && !LOCATION_ID.matcher(named).matches()) {
            throw new CommerceAccessDeniedException(CommerceAccessDeniedException.LOCATION_NOT_ALLOWED,
                    "this is not a location of the institute");
        }
        List<String> all = readRepository.locationIds(instituteId);
        if (StockAccess.isAdmin(user)) {
            if (named != null && !all.contains(named)) {
                throw new CommerceAccessDeniedException(CommerceAccessDeniedException.LOCATION_NOT_ALLOWED,
                        "this is not a location of the institute");
            }
            return new ReportScope(true, null, true, named);
        }
        Set<String> visible = stockAccess.visibleLocationIds(user, instituteId);
        boolean everyLocation = visible != null && !all.isEmpty() && visible.containsAll(all);
        if (kind == Kind.GST && !everyLocation) {
            throw new CommerceAccessDeniedException(CommerceAccessDeniedException.LOCATION_NOT_ALLOWED,
                    "the GST reports cover every location of the GSTIN; they need access to every location");
        }
        if (named != null && (visible == null || !visible.contains(named))) {
            throw new CommerceAccessDeniedException(CommerceAccessDeniedException.LOCATION_NOT_ALLOWED,
                    "you are not assigned to this location");
        }
        return new ReportScope(false, visible, everyLocation, named);
    }

    /**
     * The places a reader may report on and what they may open (the screens' place picker and
     * the GST cards): any report feature, a reader role. ADMIN and staff of every location get
     * every location of the institute; others their own.
     */
    public Places places(CustomUserDetails user, String instituteId) {
        ReportScope scope = require(Kind.AUDIT, user, instituteId, null);
        boolean taxReports = guard.featureOn(instituteId, CommerceFeature.REPORTS);
        boolean orders = guard.featureOn(instituteId, CommerceFeature.ORDERS);
        List<Place> places = new ArrayList<>();
        for (Place place : readRepository.places(instituteId)) {
            if (scope.allLocations() || (scope.visibleLocationIds() != null
                    && scope.visibleLocationIds().contains(place.id()))) {
                places.add(place);
            }
        }
        return new Places(places, scope.allLocations(), taxReports && scope.allLocations(), taxReports, orders);
    }

    /**
     * The places answer.
     *
     * @param allPlaces    ADMIN, or assigned to every location of the institute (whatever its status): the
     *                     caller sees every location and documents with none, and passes the GST-pack rule
     * @param gstReports   the GST reports will answer (feature on and every location)
     * @param taxReports   feature {@code commerce.tax_reports} is on (GST pack, day book, POS sessions)
     * @param orders       feature {@code commerce.orders} is on (sales, products, money, COD, dues)
     */
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record Places(List<Place> places, boolean allPlaces, boolean gstReports, boolean taxReports,
                         boolean orders) {
    }

    /** The GST pack rule. */
    public ReportScope gst(CustomUserDetails user, String instituteId, String locationId) {
        return require(Kind.GST, user, instituteId, locationId);
    }
}
