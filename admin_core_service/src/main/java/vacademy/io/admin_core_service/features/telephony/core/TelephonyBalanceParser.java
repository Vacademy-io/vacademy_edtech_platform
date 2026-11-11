package vacademy.io.admin_core_service.features.telephony.core;

import java.util.Map;

/**
 * Reads the balance out of a telephony provider's account response. Pure, so the shapes the
 * providers actually send are pinned by tests.
 */
public final class TelephonyBalanceParser {

    private TelephonyBalanceParser() {}

    /**
     * Exotel's amount. Production sends {@code {"Balance": {"Amount": 618.3}}} (verified on
     * 2026-06-05); the documented {@code Account.BalanceData.Balance} nesting is the fallback.
     * Returns the value as Exotel sent it (number or string), or null.
     */
    public static Object exotelAmount(Map<String, Object> raw) {
        if (raw == null) return null;
        Object balanceObj = raw.get("Balance");
        if (balanceObj instanceof Map<?, ?> bMap) {
            Object amount = bMap.get("Amount");
            if (amount == null) amount = bMap.get("amount");
            if (amount == null) amount = bMap.get("value");
            if (amount instanceof Number || amount instanceof String) return amount;
        }
        if (balanceObj instanceof Number || balanceObj instanceof String) return balanceObj;

        Object account = raw.get("Account");
        if (account instanceof Map<?, ?> aMap) {
            Object bd = aMap.get("BalanceData");
            if (bd instanceof Map<?, ?> bdMap) {
                Object b = bdMap.get("Balance");
                if (b instanceof Number || b instanceof String) return b;
                if (b instanceof Map<?, ?> bMap2) {
                    Object inner = bMap2.get("Amount");
                    if (inner == null) inner = bMap2.get("amount");
                    if (inner instanceof Number || inner instanceof String) return inner;
                }
            }
        }
        return null;
    }

    /** Exotel's currency when it sends one; production omits it, and Exotel bills in INR. */
    public static String exotelCurrency(Map<String, Object> raw) {
        if (raw == null) return "INR";
        Object top = raw.get("Currency");
        if (top instanceof String s && !s.isBlank()) return s.trim().toUpperCase();
        if (raw.get("Account") instanceof Map<?, ?> a && a.get("BalanceData") instanceof Map<?, ?> bd
                && bd.get("Currency") instanceof String s && !s.isBlank()) {
            return s.trim().toUpperCase();
        }
        return "INR";
    }

    /** Plivo's {@code cash_credits}, a USD amount sent as a string such as "1.80900". */
    public static Double plivoCashCredits(Map<String, Object> raw) {
        return raw == null ? null : toDouble(raw.get("cash_credits"));
    }

    public static Double toDouble(Object value) {
        if (value instanceof Number n) return n.doubleValue();
        if (value instanceof String s) {
            try {
                return Double.parseDouble(s.trim());
            } catch (NumberFormatException e) {
                return null;
            }
        }
        return null;
    }
}
