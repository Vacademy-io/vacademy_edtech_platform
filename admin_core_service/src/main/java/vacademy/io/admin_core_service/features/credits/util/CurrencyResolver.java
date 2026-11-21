package vacademy.io.admin_core_service.features.credits.util;

import org.springframework.stereotype.Component;
import vacademy.io.common.institute.entity.Institute;

import java.util.Locale;
import java.util.Set;

/**
 * Resolve which currency a given institute should be billed in for AI credit
 * pack purchases.
 *
 * Decision tree (first match wins):
 *   1. Institute `currency` is one we bill in (INR / USD) → use it.
 *   2. Institute country looks Indian → INR.
 *   3. Otherwise → USD (MVP fallback).
 *
 * `institutes.currency` is the institute's OWN operating currency (what it charges its
 * learners, e.g. AED for a UAE institute). It is only honoured when Vacademy prices packs in
 * it; any other value falls through, otherwise a UAE institute found no AED pack prices and
 * saw "No credit packs are available for your region" (EduStream, 2026-10-21).
 *
 * Country values are free-text in `institutes.country`, so we do best-effort
 * normalization. Add more synonyms here as we discover them in production.
 */
@Component
public class CurrencyResolver {

    public static final String INR = "INR";
    public static final String USD = "USD";

    /** Currencies credit packs are priced in (credit_pack_price rows). */
    private static final Set<String> BILLING_CURRENCIES = Set.of(INR, USD);

    private static final Set<String> INDIA_COUNTRY_TOKENS = Set.of(
            "IN", "IND", "INDIA", "BHARAT");

    public String resolveCurrency(Institute institute) {
        if (institute == null) {
            return USD;
        }

        String override = trimToNull(institute.getCurrency());
        if (override != null && BILLING_CURRENCIES.contains(override.toUpperCase(Locale.ROOT))) {
            return override.toUpperCase(Locale.ROOT);
        }

        String country = trimToNull(institute.getCountry());
        if (country != null && INDIA_COUNTRY_TOKENS.contains(country.toUpperCase(Locale.ROOT))) {
            return INR;
        }

        return USD;
    }

    private static String trimToNull(String s) {
        if (s == null) return null;
        String t = s.trim();
        return t.isEmpty() ? null : t;
    }
}
