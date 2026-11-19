package vacademy.io.admin_core_service.features.commerce.report.controller;

import vacademy.io.admin_core_service.features.commerce.report.service.ReportQuery;
import vacademy.io.common.exceptions.InvalidRequestException;

import java.math.BigDecimal;
import java.util.regex.Pattern;

/**
 * Strict parsing of the report and audit request parameters: every number is bounded and parsed
 * from a checked text (a huge exponent never reaches {@link BigDecimal}), and free text carries
 * no control character. Anything else: 400 {@code VALIDATION}.
 */
final class ReportParams {

    /** The B2C large limit in rupees: 1 to 1,00,00,000, at most two decimals, plain digits. */
    static final BigDecimal B2CL_MIN = BigDecimal.ONE;
    static final BigDecimal B2CL_MAX = new BigDecimal("10000000");
    private static final Pattern AMOUNT = Pattern.compile("^[0-9]{1,8}(\\.[0-9]{1,2})?$");
    private static final Pattern CONTROL = Pattern.compile("\\p{Cntrl}");

    private ReportParams() {
    }

    /** The page size: absent → the default; else 1 to 200. */
    static int size(Integer size) {
        if (size == null) {
            return 0;
        }
        if (size < 1 || size > ReportQuery.MAX_SIZE) {
            throw new InvalidRequestException("VALIDATION: size must be between 1 and " + ReportQuery.MAX_SIZE);
        }
        return size;
    }

    /** The B2C large limit; null when absent. */
    static BigDecimal b2clLimit(String limit) {
        if (limit == null || limit.isBlank()) {
            return null;
        }
        String text = limit.trim();
        if (!AMOUNT.matcher(text).matches()) {
            throw new InvalidRequestException("VALIDATION: b2clLimit must be an amount in rupees (1 to 10000000, "
                    + "at most 2 decimals)");
        }
        BigDecimal value = new BigDecimal(text);
        if (value.compareTo(B2CL_MIN) < 0 || value.compareTo(B2CL_MAX) > 0) {
            throw new InvalidRequestException("VALIDATION: b2clLimit must be between 1 and 10000000 rupees");
        }
        return value;
    }

    /** Trimmed text of at most {@code max} characters with no control character; null when blank. */
    static String text(String value, int max, String field) {
        if (value == null || value.isBlank()) {
            return null;
        }
        String trimmed = value.trim();
        if (trimmed.length() > max) {
            throw new InvalidRequestException("VALIDATION: " + field + " is at most " + max + " characters");
        }
        if (CONTROL.matcher(trimmed).find()) {
            throw new InvalidRequestException("VALIDATION: " + field + " has a character that is not allowed");
        }
        return trimmed;
    }

    /** A filter this report does not take: refused rather than ignored. */
    static void refuse(boolean given, String name, String report) {
        if (given) {
            throw new InvalidRequestException("VALIDATION: " + name + " is not a filter of " + report);
        }
    }

    static boolean given(String value) {
        return value != null && !value.isBlank();
    }
}
