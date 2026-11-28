package vacademy.io.admin_core_service.features.regional_pricing.service;

import org.junit.jupiter.api.Test;

import java.math.BigDecimal;

import static org.junit.jupiter.api.Assertions.assertEquals;

class PriceRoundingTest {

    private static String r(String amount, String currency) {
        return PriceRounding.round(new BigDecimal(amount), currency).toPlainString();
    }

    @Test
    void smallCentPricesGoToNextNinetyNine() {
        assertEquals("11.99", r("11.87", "USD"));
        assertEquals("9.99", r("9.20", "GBP"));
    }

    @Test
    void exactWholeAmountIsKeptRatherThanUndercut() {
        assertEquals("12.00", r("12.00", "USD"));
        assertEquals("12.00", r("11.995", "USD"));
    }

    @Test
    void hundredsEndInNine() {
        assertEquals("439.00", r("437.20", "AED"));
        assertEquals("440.00", r("440", "AED"));
    }

    @Test
    void thousandsEndInNinetyNine() {
        assertEquals("4399.00", r("4321", "INR"));
        assertEquals("4399", r("4321", "JPY"));
    }

    @Test
    void zeroDecimalCurrenciesStayWhole() {
        assertEquals("88", r("87.2", "JPY"));
    }

    @Test
    void neverRoundsBelowTheConvertedAmount() {
        for (String a : new String[] {"0.47", "1.01", "99.99", "100.01", "999.5", "1000.01", "12345.67"}) {
            BigDecimal in = new BigDecimal(a);
            assertEquals(true, PriceRounding.round(in, "USD").compareTo(in) >= 0, a);
        }
    }

    @Test
    void nonPositiveIsZero() {
        assertEquals(0, PriceRounding.round(BigDecimal.ZERO, "USD").signum());
        assertEquals(0, PriceRounding.round(null, "USD").signum());
    }
}
