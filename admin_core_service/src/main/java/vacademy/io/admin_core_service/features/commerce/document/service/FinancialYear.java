package vacademy.io.admin_core_service.features.commerce.document.service;

import java.time.LocalDate;

/**
 * Financial-year labels for document series. A year that starts in April 2026 is "2026-27"; a
 * year that starts in January is "2026". A series row belongs to one financial year, so its
 * numbers start again at 1 when the year turns.
 */
public final class FinancialYear {

    private FinancialYear() {
    }

    /** The label of the financial year that holds {@code date}. */
    public static String of(LocalDate date, int startMonth) {
        if (startMonth < 1 || startMonth > 12) {
            throw new IllegalArgumentException("financial year start month must be 1 to 12");
        }
        int startYear = date.getMonthValue() >= startMonth ? date.getYear() : date.getYear() - 1;
        if (startMonth == 1) {
            return String.valueOf(startYear);
        }
        return startYear + "-" + String.format("%02d", (startYear + 1) % 100);
    }

    /** The part of a document number that names the year: "2026-27" gives "2627", "2026" gives "2026". */
    public static String token(String financialYear) {
        if (financialYear == null || !financialYear.matches("^[0-9]{4}(-[0-9]{2})?$")) {
            throw new IllegalArgumentException("not a financial year label: " + financialYear);
        }
        return financialYear.length() == 4
                ? financialYear
                : financialYear.substring(2, 4) + financialYear.substring(5, 7);
    }

    /** The first calendar year of the label, for ordering. */
    public static int startYear(String financialYear) {
        return Integer.parseInt(financialYear.substring(0, 4));
    }
}
