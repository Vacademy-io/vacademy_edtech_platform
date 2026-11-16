package vacademy.io.admin_core_service.features.commerce.order.cod;

import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.commerce.order.checkout.BuyerIdentity;
import vacademy.io.admin_core_service.features.commerce.order.checkout.CommerceCheckoutConfig;
import vacademy.io.admin_core_service.features.commerce.otp.CommerceBotCheck;
import vacademy.io.admin_core_service.features.commerce.stock.service.CommerceStockSettings;
import vacademy.io.admin_core_service.features.commerce.storefront.model.StorefrontSettings;
import vacademy.io.admin_core_service.features.commerce.storefront.service.CommerceStorefrontSettings;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/** {@code GET /checkout/config}: {@code cod.online} is the effective switch; COD is listed only then. */
class CommerceCheckoutConfigTest {

    private static Map<String, Object> config(boolean placement, boolean shop) {
        CommerceStorefrontSettings settings = mock(CommerceStorefrontSettings.class);
        StorefrontSettings d = StorefrontSettings.defaults();
        when(settings.read("inst-1")).thenReturn(new StorefrontSettings(d.baseLocale(), d.lowStockThreshold(),
                d.leadMediaTag(), d.priceBands(), d.dispatchPromise(), new StorefrontSettings.Cod(shop,
                new BigDecimal("5000.00"), new BigDecimal("3000.00"), Set.of()), d.pricingRulesJson(),
                d.maxOrderQuantity(), d.mediaTags(), BuyerIdentity.EITHER, d.otpInstituteHourlyCap()));
        CommerceStockSettings stock = mock(CommerceStockSettings.class);
        when(stock.holdMinutes("inst-1")).thenReturn(15);
        return new CommerceCheckoutConfig(settings, stock, mock(CommerceBotCheck.class),
                new CommerceCodAvailability(placement), "").config("inst-1");
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> cod(Map<String, Object> config) {
        return (Map<String, Object>) config.get("cod");
    }

    @Test
    void codIsOnlineOnlyWithTheSwitchAndTheShopSetting() {
        Map<String, Object> both = config(true, true);
        assertEquals(true, cod(both).get("online"));
        assertEquals(true, cod(both).get("enabled"));
        assertEquals(List.of("PREPAID", "COD"), both.get("payment_methods"));
        assertEquals(new BigDecimal("3000.00"), cod(both).get("staff_confirm_threshold"));

        Map<String, Object> switchOff = config(false, true);
        assertEquals(false, cod(switchOff).get("online"));
        assertEquals(true, cod(switchOff).get("enabled"), "enabled is the shop's own setting");
        assertEquals(List.of("PREPAID"), switchOff.get("payment_methods"));

        Map<String, Object> shopOff = config(true, false);
        assertEquals(false, cod(shopOff).get("online"));
        assertEquals(false, cod(shopOff).get("enabled"));
        assertEquals(List.of("PREPAID"), shopOff.get("payment_methods"));
    }
}
