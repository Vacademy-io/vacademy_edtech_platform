package vacademy.io.admin_core_service.features.commerce.order.cod;

import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.commerce.storefront.model.StorefrontSettings;

import java.math.BigDecimal;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** COD eligibility and its reason codes. */
class CodEligibilityTest {

    private static final BigDecimal CHARGE = new BigDecimal("40.00");

    private static StorefrontSettings.Cod cod(boolean enabled) {
        return new StorefrontSettings.Cod(enabled, new BigDecimal("5000.00"), new BigDecimal("3000.00"),
                Set.of("190001", "744101"));
    }

    private static CodEligibility.Result check(boolean enabled, String total, String pincode) {
        return CodEligibility.check(cod(enabled), new BigDecimal(total), pincode, CHARGE);
    }

    @Test
    void codIsOffUnlessTheSellerSwitchedItOn() {
        CodEligibility.Result off = check(false, "500.00", "226001");
        assertFalse(off.eligible());
        assertEquals(CodEligibility.COD_DISABLED, off.reasonCode());

        CodEligibility.Result none = CodEligibility.check(null, new BigDecimal("500.00"), "226001", CHARGE);
        assertEquals(CodEligibility.COD_DISABLED, none.reasonCode());

        // The defaults are 5,000 and 3,000, with COD off.
        StorefrontSettings.Cod defaults = StorefrontSettings.defaults().cod();
        assertFalse(defaults.enabled());
        assertEquals(0, new BigDecimal("5000").compareTo(defaults.maxOrderValue()));
        assertEquals(0, new BigDecimal("3000").compareTo(defaults.staffConfirmThreshold()));
    }

    @Test
    void anOrderUpToTheMaximumQualifiesAndOneAboveItDoesNot() {
        assertTrue(check(true, "5000.00", "226001").eligible());
        assertNull(check(true, "5000.00", "226001").reasonCode());

        CodEligibility.Result above = check(true, "5000.01", "226001");
        assertFalse(above.eligible());
        assertEquals(CodEligibility.ORDER_ABOVE_COD_LIMIT, above.reasonCode());
        assertFalse(above.needsStaffConfirmation());
    }

    @Test
    void aBlockedPincodeIsRefusedBeforeTheAmountIsLookedAt() {
        CodEligibility.Result blocked = check(true, "9000.00", "190001");
        assertEquals(CodEligibility.PINCODE_BLOCKED, blocked.reasonCode());
        assertTrue(blocked.pincodeChecked());
        assertEquals(CodEligibility.PINCODE_BLOCKED, check(true, "100.00", "744 101").reasonCode());
    }

    @Test
    void aMalformedPincodeIsRefused() {
        assertEquals(CodEligibility.PINCODE_INVALID, check(true, "100.00", "12345").reasonCode());
        assertEquals(CodEligibility.PINCODE_INVALID, check(true, "100.00", "012345").reasonCode());
        assertFalse(check(true, "100.00", "abcdef").pincodeChecked());
    }

    @Test
    void withoutAPincodeTheAmountAloneDecidesAndTheAnswerSaysSo() {
        CodEligibility.Result unknown = check(true, "100.00", null);
        assertTrue(unknown.eligible());
        assertFalse(unknown.pincodeChecked());
        assertTrue(check(true, "100.00", "226001").pincodeChecked());
    }

    @Test
    void anOrderAboveTheConfirmAmountNeedsACall() {
        assertFalse(check(true, "3000.00", "226001").needsStaffConfirmation());
        assertTrue(check(true, "3000.01", "226001").needsStaffConfirmation());
    }

    @Test
    void anEmptyCartDoesNotQualify() {
        assertEquals(CodEligibility.CART_EMPTY, check(true, "0.00", "226001").reasonCode());
    }

    @Test
    void theAnswerCarriesTheChargeAndTheLimit() {
        CodEligibility.Result result = check(true, "640.00", "226001");
        assertEquals(0, CHARGE.compareTo(result.charge()));
        assertEquals(0, new BigDecimal("5000").compareTo(result.maxOrderValue()));
        assertEquals(0, new BigDecimal("640").compareTo(result.totalWithCod()));
    }
}
