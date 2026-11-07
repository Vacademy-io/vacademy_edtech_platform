package vacademy.io.admin_core_service.features.regional_pricing.service;

import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.regional_pricing.dto.RegionalQuote;
import vacademy.io.admin_core_service.features.regional_pricing.entity.PaymentPlanRegionalPrice;

import java.math.BigDecimal;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** Lookup order: exact country → currency-wide row for the country's currency → base price. */
class RegionalPriceResolverPickTest {

    private static PaymentPlanRegionalPrice row(String currency, String country, String price) {
        PaymentPlanRegionalPrice r = new PaymentPlanRegionalPrice();
        r.setId(currency + "-" + country);
        r.setPaymentPlanId("plan");
        r.setCurrency(currency);
        r.setCountryCode(country);
        r.setActualPrice(new BigDecimal(price));
        r.setPriceSource("AUTO");
        return r;
    }

    private static final List<PaymentPlanRegionalPrice> ROWS = List.of(
            row("USD", null, "11.99"),
            row("GBP", null, "9.99"),
            row("NPR", "NP", "1200"),
            row("USD", "CA", "8.99"));

    @Test
    void currencyWideRowForTheCountrysCurrency() {
        Optional<RegionalQuote> q = RegionalPriceResolver.pick(ROWS, "plan", "INR", "US", "RAZORPAY");
        assertEquals("USD", q.get().currency());
        assertEquals(new BigDecimal("11.99"), q.get().actualPrice());
        assertEquals("US", q.get().countryCode());
    }

    @Test
    void exactCountryRowWinsEvenInAnotherCurrency() {
        assertEquals(new BigDecimal("1200"), RegionalPriceResolver.pick(ROWS, "plan", "INR", "NP", null).get().actualPrice());
        // Canada is priced in USD by an explicit country row.
        assertEquals("USD", RegionalPriceResolver.pick(ROWS, "plan", "INR", "CA", null).get().currency());
    }

    @Test
    void homeCountryAndUnpricedCountriesGetTheBasePrice() {
        assertTrue(RegionalPriceResolver.pick(ROWS, "plan", "INR", "IN", null).isEmpty());
        assertTrue(RegionalPriceResolver.pick(ROWS, "plan", "INR", "JP", null).isEmpty());
        assertTrue(RegionalPriceResolver.pick(List.of(), "plan", "INR", "US", null).isEmpty());
        assertTrue(RegionalPriceResolver.pick(ROWS, "plan", "INR", null, null).isEmpty());
    }

    @Test
    void currencyTheGatewayCannotChargeIsSkipped() {
        assertTrue(RegionalPriceResolver.pick(ROWS, "plan", "INR", "US", "PHONEPE").isEmpty());
        assertTrue(RegionalPriceResolver.pick(ROWS, "plan", "INR", "GB", "CASHFREE").isEmpty());
    }

    @Test
    void cloudflareNonCountriesAreIgnored() {
        assertEquals(null, ViewerCountryResolver.normalize("XX"));
        assertEquals(null, ViewerCountryResolver.normalize("T1"));
        assertEquals("US", ViewerCountryResolver.normalize(" us "));
        assertEquals("USD", ViewerCountryResolver.currencyOf("US").get());
        assertEquals("INR", ViewerCountryResolver.currencyOf("IN").get());
    }
}
