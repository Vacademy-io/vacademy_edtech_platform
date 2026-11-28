package vacademy.io.admin_core_service.features.regional_pricing.service;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.Currency;

/**
 * Turns an exchange-rate converted amount into a price a person would actually set.
 * Always rounds UP so the converted price never undercuts the base price.
 *
 * <ul>
 *   <li>below 1 — kept to the currency's minor unit (0.47)</li>
 *   <li>below 100 in a currency with cents — next .99 (11.87 → 11.99)</li>
 *   <li>below 100 otherwise — next whole unit (JPY 87.2 → 88)</li>
 *   <li>100 – 999 — next amount ending in 9 (437.20 → 439)</li>
 *   <li>1,000 and above — next amount ending in 99 (4,321 → 4,399)</li>
 * </ul>
 */
public final class PriceRounding {

    private PriceRounding() {}

    public static BigDecimal round(BigDecimal amount, String currency) {
        if (amount == null || amount.signum() <= 0) {
            return BigDecimal.ZERO;
        }
        int minor = minorUnits(currency);
        if (amount.compareTo(BigDecimal.ONE) < 0) {
            return amount.setScale(minor, RoundingMode.CEILING);
        }
        if (amount.compareTo(BigDecimal.valueOf(100)) < 0) {
            BigDecimal whole = amount.setScale(0, RoundingMode.CEILING);
            if (minor == 0) {
                return whole;
            }
            BigDecimal charm = whole.subtract(new BigDecimal("0.01"));
            // 12.00 exactly → 12.99 would overshoot by almost a unit; 11.99 undercuts. Keep 12.00.
            return charm.compareTo(amount) >= 0 ? charm : whole.setScale(minor, RoundingMode.UNNECESSARY);
        }
        long step = amount.compareTo(BigDecimal.valueOf(1000)) < 0 ? 10 : 100;
        BigDecimal stepBd = BigDecimal.valueOf(step);
        BigDecimal ceil = amount.divide(stepBd, 0, RoundingMode.CEILING).multiply(stepBd);
        BigDecimal charm = ceil.subtract(BigDecimal.ONE);
        BigDecimal result = charm.compareTo(amount) >= 0 ? charm : ceil;
        return result.setScale(minor, RoundingMode.UNNECESSARY);
    }

    public static int minorUnits(String currency) {
        try {
            int d = Currency.getInstance(currency.toUpperCase()).getDefaultFractionDigits();
            return d < 0 ? 2 : d;
        } catch (Exception e) {
            return 2;
        }
    }
}
