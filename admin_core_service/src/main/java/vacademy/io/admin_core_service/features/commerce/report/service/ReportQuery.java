package vacademy.io.admin_core_service.features.commerce.report.service;

import lombok.Builder;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * The checked request of one report: who may see what ({@link ReportScope}), the India range and
 * the filters. Built by the controller after {@link ReportAccess}; services never see a raw
 * parameter.
 *
 * @param channel     ONLINE, ADMIN or POS; null for all
 * @param sellerGstin the GSTIN the caller named (upper case); null when none was named
 * @param status      sales register: ACTIVE, CANCELLED or null for both
 * @param b2clLimit   GSTR-1: invoices above this total (inter-state, no GSTIN) are B2C large
 * @param cursor      registers: the {@code next_cursor} of the previous page; null for the first
 * @param size        registers: rows (documents) per page, 1 to 200
 * @param hindi       Excel header labels in Hindi
 * @param groupBy     sales and products: the grouping (B2)
 * @param asOf        COD outstanding: the as-of date (B2)
 * @param today       the India date "today" from the clock
 * @param staffNames  full names of the staff the answer names, read before the report's
 *                    transaction (never inside it); null or missing: the user id is shown
 */
@Builder(toBuilder = true)
public record ReportQuery(String instituteId, ReportRange range, ReportScope scope, String channel,
                          String sellerGstin, String status, BigDecimal b2clLimit, String cursor, int size,
                          boolean hindi, String groupBy, LocalDate asOf, LocalDate today, String month,
                          Map<String, String> staffNames) {

    public static final int DEFAULT_SIZE = 100;
    public static final int MAX_SIZE = 200;
    public static final BigDecimal DEFAULT_B2CL_LIMIT = new BigDecimal("100000");

    /** The page size, 100 by default and at most 200. */
    public int pageSize() {
        if (size <= 0) {
            return DEFAULT_SIZE;
        }
        return Math.min(size, MAX_SIZE);
    }

    /** The full name of a staff user; the id when the account service gave none; null for null. */
    public String staffName(String userId) {
        if (userId == null) {
            return null;
        }
        String name = staffNames == null ? null : staffNames.get(userId);
        return name == null || name.isBlank() ? userId : name;
    }

    public BigDecimal b2clLimitOrDefault() {
        return b2clLimit == null ? DEFAULT_B2CL_LIMIT : b2clLimit;
    }

    /** The named location, or null. */
    public String locationId() {
        return scope == null ? null : scope.locationId();
    }

    /** The filters as the answer echoes them (snake_case keys; nulls left out). */
    public Map<String, Object> filters() {
        Map<String, Object> out = new LinkedHashMap<>();
        if (month != null) {
            out.put("month", month);
        }
        if (locationId() != null) {
            out.put("location_id", locationId());
        }
        if (channel != null) {
            out.put("channel", channel);
        }
        if (sellerGstin != null) {
            out.put("seller_gstin", sellerGstin);
        }
        if (status != null) {
            out.put("status", status);
        }
        if (b2clLimit != null) {
            out.put("b2cl_limit", b2clLimit.toPlainString());
        }
        if (groupBy != null) {
            out.put("group_by", groupBy);
        }
        if (asOf != null) {
            out.put("as_of", asOf.toString());
        }
        return out;
    }
}
