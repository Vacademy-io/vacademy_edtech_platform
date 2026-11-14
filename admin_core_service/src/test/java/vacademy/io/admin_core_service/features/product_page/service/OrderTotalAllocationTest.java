package vacademy.io.admin_core_service.features.product_page.service;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * A product-page order is paid ONCE and recorded per course — one child payment
 * log, one invoice, one ledger credit each. If those parts do not add up to what
 * the gateway took, the learner's invoices and the institute's ledger disagree
 * with the bank. They used to: a real ₹949 checkout for four ₹349 subjects
 * produced four ₹349 invoices and credited ₹1,396.
 */
class OrderTotalAllocationTest {

    private static double sum(double[] parts) {
        double total = 0;
        for (double part : parts) {
            total += part;
        }
        return total;
    }

    private static double[] equalPriced(int n, double price) {
        double[] out = new double[n];
        java.util.Arrays.fill(out, price);
        return out;
    }

    @Test
    @DisplayName("splits the real ₹949 four-subject order back to ₹949")
    void theReportedOrder() {
        double[] parts = ProductPageEnrollmentService.splitProportionally(equalPriced(4, 349), 949, 2);
        assertEquals(949d, sum(parts), 0.0001);
        // Evenly as the pennies allow, remainder on the first line.
        assertArrayEqualsIsh(new double[] { 237.25, 237.25, 237.25, 237.25 }, parts);
    }

    @ParameterizedTest(name = "{0} subjects still sum to the order total")
    @ValueSource(ints = { 1, 2, 3, 4, 5, 6, 7, 8 })
    void everyBasketSumsToTheTotal(int n) {
        // The published card, so the awkward remainders are the real ones.
        double[] card = { 349, 599, 799, 949, 1099, 1249, 1399, 1549 };
        double total = card[n - 1];
        double[] parts = ProductPageEnrollmentService.splitProportionally(equalPriced(n, 349), total, 2);
        assertEquals(total, sum(parts), 0.0001);
        for (double part : parts) {
            assertTrue(part > 0, "no course may be recorded as free");
        }
    }

    @Test
    @DisplayName("weights the split by what each course lists for")
    void proportionalToListPrice() {
        double[] parts = ProductPageEnrollmentService.splitProportionally(
                new double[] { 300, 100 }, 200, 2);
        assertArrayEqualsIsh(new double[] { 150, 50 }, parts);
    }

    @Test
    @DisplayName("splits evenly when nothing carries a price")
    void unpricedCoursesSplitEvenly() {
        double[] parts = ProductPageEnrollmentService.splitProportionally(new double[] { 0, 0, 0 }, 100, 2);
        assertEquals(100d, sum(parts), 0.0001);
        assertArrayEqualsIsh(new double[] { 33.34, 33.33, 33.33 }, parts);
    }

    @Test
    @DisplayName("a free order records nothing against any course")
    void freeOrder() {
        double[] parts = ProductPageEnrollmentService.splitProportionally(equalPriced(3, 349), 0, 2);
        assertEquals(0d, sum(parts), 0.0001);
    }

    @Test
    @DisplayName("an order with no courses allocates nothing")
    void emptyOrder() {
        assertEquals(0, ProductPageEnrollmentService.splitProportionally(new double[0], 500, 2).length);
    }

    @Test
    @DisplayName("splits in the currency's OWN smallest unit, not always hundredths")
    void minorUnitsFollowTheCurrency() {
        // JPY has no minor unit: thirds of ¥1000 must stay whole yen, because a
        // gateway cannot charge ¥333.34 and an invoice cannot print it.
        double[] yen = ProductPageEnrollmentService.splitProportionally(
                equalPriced(3, 1000), 1000, ProductPageEnrollmentService.minorUnitScale("JPY"));
        assertEquals(1000d, sum(yen), 0.0001);
        for (double part : yen) {
            assertEquals(part, Math.rint(part), 0.0001, "yen must not be fractional");
        }

        // KWD has three, so a third of 1.000 keeps its extra decimal place.
        double[] dinar = ProductPageEnrollmentService.splitProportionally(
                equalPriced(3, 1), 1, ProductPageEnrollmentService.minorUnitScale("KWD"));
        assertEquals(1d, sum(dinar), 0.0001);
        assertArrayEqualsIsh(new double[] { 0.334, 0.333, 0.333 }, dinar);
    }

    @Test
    @DisplayName("reads the scale from the currency table, and falls back safely")
    void minorUnitScales() {
        assertEquals(2, ProductPageEnrollmentService.minorUnitScale("INR"));
        assertEquals(2, ProductPageEnrollmentService.minorUnitScale("usd"));
        assertEquals(0, ProductPageEnrollmentService.minorUnitScale("JPY"));
        assertEquals(3, ProductPageEnrollmentService.minorUnitScale("KWD"));
        // Unknown / missing codes must not throw mid-checkout.
        assertEquals(2, ProductPageEnrollmentService.minorUnitScale("NOTACURRENCY"));
        assertEquals(2, ProductPageEnrollmentService.minorUnitScale(null));
        assertEquals(2, ProductPageEnrollmentService.minorUnitScale("  "));
    }

    private static void assertArrayEqualsIsh(double[] expected, double[] actual) {
        assertEquals(expected.length, actual.length);
        for (int i = 0; i < expected.length; i++) {
            assertEquals(expected[i], actual[i], 0.0001, "index " + i);
        }
    }
}
