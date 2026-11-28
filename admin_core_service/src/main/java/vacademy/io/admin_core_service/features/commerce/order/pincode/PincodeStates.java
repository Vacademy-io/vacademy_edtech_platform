package vacademy.io.admin_core_service.features.commerce.order.pincode;

import java.util.Map;

/**
 * The state of an Indian pincode from its first digits, as a GST state code. Used only when the
 * pincode directory ({@code commerce_pincode}) has no row for the pincode. A three-digit prefix
 * that is shared by two states or by a state and a union territory answers null (not known), so
 * a wrong state is never guessed; the checkout address then supplies the state.
 */
public final class PincodeStates {

    private static final Map<String, String> NAMES = Map.ofEntries(
            Map.entry("01", "Jammu and Kashmir"), Map.entry("02", "Himachal Pradesh"), Map.entry("03", "Punjab"),
            Map.entry("04", "Chandigarh"), Map.entry("05", "Uttarakhand"), Map.entry("06", "Haryana"),
            Map.entry("07", "Delhi"), Map.entry("08", "Rajasthan"), Map.entry("09", "Uttar Pradesh"),
            Map.entry("10", "Bihar"), Map.entry("11", "Sikkim"), Map.entry("12", "Arunachal Pradesh"),
            Map.entry("13", "Nagaland"), Map.entry("14", "Manipur"), Map.entry("15", "Mizoram"),
            Map.entry("16", "Tripura"), Map.entry("17", "Meghalaya"), Map.entry("18", "Assam"),
            Map.entry("19", "West Bengal"), Map.entry("20", "Jharkhand"), Map.entry("21", "Odisha"),
            Map.entry("22", "Chhattisgarh"), Map.entry("23", "Madhya Pradesh"), Map.entry("24", "Gujarat"),
            Map.entry("26", "Dadra and Nagar Haveli and Daman and Diu"), Map.entry("27", "Maharashtra"),
            Map.entry("29", "Karnataka"), Map.entry("30", "Goa"), Map.entry("31", "Lakshadweep"),
            Map.entry("32", "Kerala"), Map.entry("33", "Tamil Nadu"), Map.entry("34", "Puducherry"),
            Map.entry("35", "Andaman and Nicobar Islands"), Map.entry("36", "Telangana"),
            Map.entry("37", "Andhra Pradesh"), Map.entry("38", "Ladakh"));

    /** Three-digit prefixes that differ from their two-digit region; "" = shared, not known. */
    private static final Map<String, String> THREE = Map.ofEntries(
            Map.entry("160", ""), Map.entry("194", "38"),
            Map.entry("244", ""), Map.entry("246", ""), Map.entry("247", ""), Map.entry("248", "05"),
            Map.entry("249", "05"), Map.entry("262", ""), Map.entry("263", "05"),
            Map.entry("396", ""), Map.entry("403", "30"),
            Map.entry("605", ""), Map.entry("609", ""),
            Map.entry("737", "11"), Map.entry("744", "35"),
            Map.entry("790", "12"), Map.entry("791", "12"), Map.entry("792", "12"), Map.entry("793", "17"),
            Map.entry("794", "17"), Map.entry("795", "14"), Map.entry("796", "15"), Map.entry("797", "13"),
            Map.entry("798", "13"), Map.entry("799", "16"),
            Map.entry("814", "20"), Map.entry("815", "20"), Map.entry("816", "20"), Map.entry("822", "20"),
            Map.entry("825", "20"), Map.entry("826", "20"), Map.entry("827", "20"), Map.entry("828", "20"),
            Map.entry("829", "20"), Map.entry("831", "20"), Map.entry("832", "20"), Map.entry("833", "20"),
            Map.entry("834", "20"), Map.entry("835", "20"));

    private static final Map<String, String> TWO = Map.ofEntries(
            Map.entry("11", "07"), Map.entry("12", "06"), Map.entry("13", "06"), Map.entry("14", "03"),
            Map.entry("15", "03"), Map.entry("16", "03"), Map.entry("17", "02"), Map.entry("18", "01"),
            Map.entry("19", "01"),
            Map.entry("20", "09"), Map.entry("21", "09"), Map.entry("22", "09"), Map.entry("23", "09"),
            Map.entry("24", "09"), Map.entry("25", "09"), Map.entry("26", "09"), Map.entry("27", "09"),
            Map.entry("28", "09"),
            Map.entry("30", "08"), Map.entry("31", "08"), Map.entry("32", "08"), Map.entry("33", "08"),
            Map.entry("34", "08"),
            Map.entry("36", "24"), Map.entry("37", "24"), Map.entry("38", "24"), Map.entry("39", "24"),
            Map.entry("40", "27"), Map.entry("41", "27"), Map.entry("42", "27"), Map.entry("43", "27"),
            Map.entry("44", "27"),
            Map.entry("45", "23"), Map.entry("46", "23"), Map.entry("47", "23"), Map.entry("48", "23"),
            Map.entry("49", "22"),
            Map.entry("50", "36"), Map.entry("51", "37"), Map.entry("52", "37"), Map.entry("53", "37"),
            Map.entry("56", "29"), Map.entry("57", "29"), Map.entry("58", "29"), Map.entry("59", "29"),
            Map.entry("60", "33"), Map.entry("61", "33"), Map.entry("62", "33"), Map.entry("63", "33"),
            Map.entry("64", "33"),
            Map.entry("67", "32"), Map.entry("68", "32"), Map.entry("69", "32"),
            Map.entry("70", "19"), Map.entry("71", "19"), Map.entry("72", "19"), Map.entry("73", "19"),
            Map.entry("74", "19"),
            Map.entry("75", "21"), Map.entry("76", "21"), Map.entry("77", "21"),
            Map.entry("78", "18"),
            Map.entry("80", "10"), Map.entry("81", "10"), Map.entry("82", "10"), Map.entry("83", "10"),
            Map.entry("84", "10"), Map.entry("85", "10"));

    private PincodeStates() {
    }

    /** Six digits, the first not zero. */
    public static boolean isValid(String pincode) {
        return pincode != null && pincode.matches("[1-9][0-9]{5}");
    }

    /** The GST state code, or null when the pincode is malformed or its prefix is not known. */
    public static String stateCode(String pincode) {
        if (!isValid(pincode)) {
            return null;
        }
        String three = THREE.get(pincode.substring(0, 3));
        if (three != null) {
            return three.isEmpty() ? null : three;
        }
        return TWO.get(pincode.substring(0, 2));
    }

    public static String stateName(String stateCode) {
        return stateCode == null ? null : NAMES.get(stateCode.trim());
    }

    /** A two-digit GST state code this class knows. */
    public static boolean isStateCode(String stateCode) {
        return stateCode != null && NAMES.containsKey(stateCode.trim());
    }
}
