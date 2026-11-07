package vacademy.io.admin_core_service.features.credits.util;

import org.junit.jupiter.api.Test;
import vacademy.io.common.institute.entity.Institute;

import static org.junit.jupiter.api.Assertions.assertEquals;

/**
 * Credit packs are billed in INR (India) or USD (everyone else). An institute's own operating
 * currency (e.g. AED) must not become the billing currency: no pack is priced in it, so the
 * top-up dialog showed no packs at all.
 */
class CurrencyResolverTest {

    private final CurrencyResolver resolver = new CurrencyResolver();

    private static Institute inst(String currency, String country) {
        Institute i = new Institute();
        i.setCurrency(currency);
        i.setCountry(country);
        return i;
    }

    @Test
    void anOperatingCurrencyWeDoNotBillInFallsBackToUsd() {
        assertEquals("USD", resolver.resolveCurrency(inst("AED", "")));
        assertEquals("USD", resolver.resolveCurrency(inst("aed", null)));
    }

    @Test
    void aForeignOperatingCurrencyStillBillsAnIndianInstituteInInr() {
        assertEquals("INR", resolver.resolveCurrency(inst("AED", "India")));
    }

    @Test
    void billingCurrenciesAreHonoured() {
        assertEquals("INR", resolver.resolveCurrency(inst("inr", "")));
        assertEquals("USD", resolver.resolveCurrency(inst("USD", "India")));
    }

    @Test
    void noCurrencyFollowsTheCountry() {
        assertEquals("INR", resolver.resolveCurrency(inst(null, "IN")));
        assertEquals("USD", resolver.resolveCurrency(inst("  ", "United Arab Emirates")));
        assertEquals("USD", resolver.resolveCurrency(null));
    }
}
