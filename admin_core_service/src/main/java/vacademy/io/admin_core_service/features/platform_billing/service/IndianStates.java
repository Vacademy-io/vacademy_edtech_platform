package vacademy.io.admin_core_service.features.platform_billing.service;

import java.util.Map;
import java.util.regex.Pattern;

/**
 * GST state codes (first two digits of a GSTIN) → state/UT name.
 * Also holds the GSTIN format regex shared by purchase validation.
 */
public final class IndianStates {

    private IndianStates() {}

    /** Standard 15-char GSTIN: 2 state digits, 10-char PAN, entity digit, 'Z', checksum. */
    public static final Pattern GSTIN_PATTERN =
            Pattern.compile("^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$");

    private static final Map<String, String> CODES = Map.ofEntries(
            Map.entry("01", "Jammu & Kashmir"), Map.entry("02", "Himachal Pradesh"),
            Map.entry("03", "Punjab"), Map.entry("04", "Chandigarh"),
            Map.entry("05", "Uttarakhand"), Map.entry("06", "Haryana"),
            Map.entry("07", "Delhi"), Map.entry("08", "Rajasthan"),
            Map.entry("09", "Uttar Pradesh"), Map.entry("10", "Bihar"),
            Map.entry("11", "Sikkim"), Map.entry("12", "Arunachal Pradesh"),
            Map.entry("13", "Nagaland"), Map.entry("14", "Manipur"),
            Map.entry("15", "Mizoram"), Map.entry("16", "Tripura"),
            Map.entry("17", "Meghalaya"), Map.entry("18", "Assam"),
            Map.entry("19", "West Bengal"), Map.entry("20", "Jharkhand"),
            Map.entry("21", "Odisha"), Map.entry("22", "Chhattisgarh"),
            Map.entry("23", "Madhya Pradesh"), Map.entry("24", "Gujarat"),
            Map.entry("26", "Dadra & Nagar Haveli and Daman & Diu"),
            Map.entry("27", "Maharashtra"), Map.entry("29", "Karnataka"),
            Map.entry("30", "Goa"), Map.entry("31", "Lakshadweep"),
            Map.entry("32", "Kerala"), Map.entry("33", "Tamil Nadu"),
            Map.entry("34", "Puducherry"), Map.entry("35", "Andaman & Nicobar Islands"),
            Map.entry("36", "Telangana"), Map.entry("37", "Andhra Pradesh"),
            Map.entry("38", "Ladakh"), Map.entry("97", "Other Territory"));

    public static String nameFor(String code) {
        return code == null ? null : CODES.get(code);
    }

    public static boolean isValidCode(String code) {
        return code != null && CODES.containsKey(code);
    }

    public static boolean isValidGstin(String gstin) {
        return gstin != null && GSTIN_PATTERN.matcher(gstin).matches()
                && isValidCode(gstin.substring(0, 2));
    }
}
