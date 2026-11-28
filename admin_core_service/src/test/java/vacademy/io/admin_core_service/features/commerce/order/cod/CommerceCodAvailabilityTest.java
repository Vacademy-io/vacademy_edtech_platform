package vacademy.io.admin_core_service.features.commerce.order.cod;

import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.commerce.storefront.model.StorefrontSettings;

import java.math.BigDecimal;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** COD can be placed only when the deployment switch and the shop's own setting both say so. */
class CommerceCodAvailabilityTest {

    private static StorefrontSettings.Cod cod(boolean enabled) {
        return new StorefrontSettings.Cod(enabled, new BigDecimal("5000.00"), new BigDecimal("3000.00"),
                Set.of("190001"), 3, 1, 24);
    }

    @Test
    void theEffectiveAnswerIsTheSwitchAndTheShop() {
        assertTrue(new CommerceCodAvailability(true).effective(cod(true)));
        assertFalse(new CommerceCodAvailability(true).effective(cod(false)));
        assertFalse(new CommerceCodAvailability(false).effective(cod(true)));
        assertFalse(new CommerceCodAvailability(false).effective(cod(false)));
        assertFalse(new CommerceCodAvailability(true).effective(null));
        assertFalse(CommerceCodAvailability.off().placementEnabled());
        assertFalse(CommerceCodAvailability.off().effective(cod(true)));
    }

    @Test
    void theEffectiveSettingsChangeOnlyTheSwitch() {
        StorefrontSettings.Cod off = CommerceCodAvailability.off().effectiveCod(cod(true));
        assertFalse(off.enabled());
        assertEquals(new BigDecimal("5000.00"), off.maxOrderValue());
        assertEquals(new BigDecimal("3000.00"), off.staffConfirmThreshold());
        assertEquals(Set.of("190001"), off.blockedPincodes());
        assertEquals(3, off.maxOpenOrdersPerPhone());
        assertEquals(1, off.maxRefusals());
        assertEquals(24, off.confirmWithinHours());
        StorefrontSettings.Cod on = cod(true);
        assertSame(on, new CommerceCodAvailability(true).effectiveCod(on));
        assertNull(new CommerceCodAvailability(true).effectiveCod(null));
        // A cart with the switch off answers COD_DISABLED.
        assertEquals(CodEligibility.COD_DISABLED, CodEligibility.check(off, new BigDecimal("500.00"), "226001",
                new BigDecimal("40.00")).reasonCode());
    }

    @Test
    void theSwitchIsOffUnlessTheDeploymentSaysSo() throws Exception {
        java.util.Properties props = new java.util.Properties();
        try (java.io.InputStream in = getClass().getResourceAsStream("/application.properties")) {
            props.load(in);
        }
        assertEquals("${COMMERCE_COD_PLACEMENT_ENABLED:false}", props.getProperty("commerce.cod.placement-enabled"));
        org.springframework.beans.factory.annotation.Value value = CommerceCodAvailability.class.getConstructor(
                boolean.class).getParameters()[0].getAnnotation(org.springframework.beans.factory.annotation.Value.class);
        assertEquals("${commerce.cod.placement-enabled:false}", value.value());
    }
}
