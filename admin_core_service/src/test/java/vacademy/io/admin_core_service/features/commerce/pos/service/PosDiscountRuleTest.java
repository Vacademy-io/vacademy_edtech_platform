package vacademy.io.admin_core_service.features.commerce.pos.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** The cashier's discount limit (percent of the bill's gross) and the counter limits' defaults. */
class PosDiscountRuleTest {

    private static final BigDecimal GROSS = new BigDecimal("2000.00");

    @Test
    void atTheLimitIsAllowedAndOnePaisaOverNeedsAPin() {
        BigDecimal five = new BigDecimal("5.00");
        assertFalse(PosSaleService.discountNeedsApproval(false, new BigDecimal("100.00"), GROSS, five));
        assertTrue(PosSaleService.discountNeedsApproval(false, new BigDecimal("100.01"), GROSS, five));
    }

    @Test
    void aManagerNeverNeedsAPinAndNoDiscountNeedsNone() {
        assertFalse(PosSaleService.discountNeedsApproval(true, new BigDecimal("2000.00"), GROSS, BigDecimal.ZERO));
        assertFalse(PosSaleService.discountNeedsApproval(false, BigDecimal.ZERO, GROSS, BigDecimal.ZERO));
        assertFalse(PosSaleService.discountNeedsApproval(false, null, GROSS, BigDecimal.ZERO));
    }

    @Test
    void unsetLimitsAreFivePercentAndZero() throws Exception {
        PosSettingsService.Limits none = PosSettingsService.parse(new ObjectMapper().readTree("{}"));
        assertEquals(0, new BigDecimal("5").compareTo(none.cashierDiscountPercent()));
        assertEquals(0, BigDecimal.ZERO.compareTo(none.cashRefundLimit()));
        assertEquals(0, BigDecimal.ZERO.compareTo(none.cashVarianceLimit()));
        assertFalse(none.configured());
    }

    @Test
    void storedLimitsAreReadAndUnreadableOnesTakeTheirDefault() throws Exception {
        PosSettingsService.Limits set = PosSettingsService.parse(new ObjectMapper().readTree(
                "{\"cashierDiscountPercent\": 7.5, \"cashRefundLimit\": \"500\", \"cashVarianceLimit\": \"x\","
                        + " \"adjustmentQuantity\": 3}"));
        assertEquals(0, new BigDecimal("7.50").compareTo(set.cashierDiscountPercent()));
        assertEquals(0, new BigDecimal("500.00").compareTo(set.cashRefundLimit()));
        assertEquals(0, BigDecimal.ZERO.compareTo(set.cashVarianceLimit()));
        assertTrue(set.configured());
        PosSettingsService.Limits wild = PosSettingsService.parse(new ObjectMapper().readTree(
                "{\"cashierDiscountPercent\": 250}"));
        assertEquals(0, new BigDecimal("5").compareTo(wild.cashierDiscountPercent()));
    }
}
