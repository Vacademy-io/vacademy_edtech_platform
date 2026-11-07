package vacademy.io.admin_core_service.features.regional_pricing.service;

import java.util.Map;
import java.util.Set;

/**
 * Which currencies a gateway can actually charge in. A regional price in a currency the
 * invite's gateway cannot take is skipped at checkout (the learner gets the base price)
 * rather than failing at the gateway.
 *
 * <p>Gateways not listed here (Razorpay with international payments, Stripe, PayPal,
 * manual) are treated as multi-currency. Razorpay accounts without international payments
 * enabled will still reject non-INR orders — the admin screen says so next to the toggle.
 */
public final class GatewayCurrencySupport {

    private GatewayCurrencySupport() {}

    private static final Map<String, Set<String>> RESTRICTED = Map.of(
            "PHONEPE", Set.of("INR"),
            "CASHFREE", Set.of("INR"),
            "EWAY", Set.of("AUD", "NZD"));

    public static boolean supports(String vendor, String currency) {
        if (currency == null) {
            return false;
        }
        if (vendor == null) {
            return true;
        }
        Set<String> allowed = RESTRICTED.get(vendor.toUpperCase());
        return allowed == null || allowed.contains(currency.toUpperCase());
    }

    /** Null when the gateway takes any currency; otherwise the fixed set it accepts. */
    public static Set<String> restrictedTo(String vendor) {
        return vendor == null ? null : RESTRICTED.get(vendor.toUpperCase());
    }
}
