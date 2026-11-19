package vacademy.io.admin_core_service.features.commerce.report.service;

import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.commerce.report.repository.ReportReadRepository;
import vacademy.io.admin_core_service.features.commerce.security.CommerceAccessDeniedException;
import vacademy.io.admin_core_service.features.commerce.security.CommerceAccessGuard;
import vacademy.io.admin_core_service.features.commerce.security.CommerceFeature;
import vacademy.io.admin_core_service.features.commerce.security.CommerceRole;
import vacademy.io.admin_core_service.features.commerce.stock.controller.StockAccess;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Who may read which report (contract section 3.5). Every check goes through
 * {@link CommerceAccessGuard}: membership of the institute, the feature, then the role (institute
 * ADMIN always, else store manager or accountant). Cashiers and warehouse staff are refused.
 *
 * <ul>
 *   <li>GST reports ({@code commerce.tax_reports}): the caller must be ADMIN or assigned to every
 *       active location, because a GST return covers the whole GSTIN.</li>
 *   <li>Day book and POS sessions ({@code commerce.tax_reports}) and the sales and money reports
 *       ({@code commerce.orders}): rows of the caller's locations; a named location must be one.</li>
 *   <li>Audit ({@code commerce.tax_reports} or {@code commerce.orders}): as the second rule.</li>
 * </ul>
 */
@Component
public class ReportAccess {

    /** The roles that read reports (institute ADMIN always passes). */
    public static final Set<CommerceRole> READERS = Set.of(CommerceRole.STORE_MANAGER, CommerceRole.ACCOUNTANT);

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
        if (StockAccess.isAdmin(user)) {
            return new ReportScope(true, null, true, named);
        }
        Set<String> visible = stockAccess.visibleLocationIds(user, instituteId);
        List<String> active = readRepository.activeLocationIds(instituteId);
        boolean everyLocation = visible != null && visible.containsAll(active);
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

    /** The GST pack rule. */
    public ReportScope gst(CustomUserDetails user, String instituteId, String locationId) {
        return require(Kind.GST, user, instituteId, locationId);
    }
}
