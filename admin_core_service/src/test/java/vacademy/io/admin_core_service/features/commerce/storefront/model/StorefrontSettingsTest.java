package vacademy.io.admin_core_service.features.commerce.storefront.model;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.commerce.order.checkout.BuyerIdentity;

import java.math.BigDecimal;
import java.util.List;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** The storefront part of COMMERCE_SETTING: defaults, and nothing switched on by a broken value. */
class StorefrontSettingsTest {

    private static StorefrontSettings parse(String json) throws Exception {
        return StorefrontSettings.parse(new ObjectMapper().readTree(json));
    }

    @Test
    void anEmptySettingGivesTheDefaults() throws Exception {
        for (StorefrontSettings settings : List.of(StorefrontSettings.parse(null), parse("{}"), parse("[]"))) {
            assertEquals("en", settings.baseLocale());
            assertEquals(3, settings.lowStockThreshold());
            assertFalse(settings.cod().enabled());
            assertEquals(0, new BigDecimal("5000").compareTo(settings.cod().maxOrderValue()));
            assertEquals(0, new BigDecimal("3000").compareTo(settings.cod().staffConfirmThreshold()));
            assertTrue(settings.cod().blockedPincodes().isEmpty());
            assertTrue(settings.priceBands().isEmpty());
            assertNull(settings.pricingRulesJson());
            assertNull(settings.leadMediaTag());
        }
    }

    @Test
    void savedValuesAreRead() throws Exception {
        StorefrontSettings settings = parse("""
                {"baseLocale": "HI", "lowStockThreshold": "5", "leadMediaTag": "REAL",
                 "priceBands": [2500, "1000", -3, "x"],
                 "dispatchPromise": {"EN": "Ships in 2 days", "hi": "2 दिन में"},
                 "cod": {"enabled": true, "maxOrderValue": 7500, "staffConfirmThreshold": "2000.5",
                         "blockedPincodes": ["190 001", 744101, ""]},
                 "offers": {"enabled": true, "rules": []},
                 "holdMinutes": 20}
                """);
        assertEquals("hi", settings.baseLocale());
        assertEquals(5, settings.lowStockThreshold());
        assertEquals("REAL", settings.leadMediaTag());
        assertEquals(List.of(new BigDecimal("1000.00"), new BigDecimal("2500.00")), settings.priceBands());
        assertEquals("Ships in 2 days", settings.dispatchPromise().get("en"));
        assertTrue(settings.cod().enabled());
        assertEquals(new BigDecimal("7500.00"), settings.cod().maxOrderValue());
        assertEquals(new BigDecimal("2000.50"), settings.cod().staffConfirmThreshold());
        assertEquals(Set.of("190001", "744101"), settings.cod().blockedPincodes());
        // Only the pricing rules are handed to the calculators, not the rest of the setting.
        assertTrue(settings.pricingRulesJson().contains("\"offers\""));
        assertFalse(settings.pricingRulesJson().contains("holdMinutes"));
        assertFalse(settings.pricingRulesJson().contains("cod"));
    }

    @Test
    void aBrokenValueNeverSwitchesAThingOn() throws Exception {
        StorefrontSettings settings = parse("""
                {"lowStockThreshold": 5000, "cod": {"enabled": "yes", "maxOrderValue": -1,
                 "staffConfirmThreshold": "a lot"}}
                """);
        assertEquals(3, settings.lowStockThreshold());
        assertFalse(settings.cod().enabled());
        assertEquals(0, new BigDecimal("5000").compareTo(settings.cod().maxOrderValue()));
        assertEquals(0, new BigDecimal("3000").compareTo(settings.cod().staffConfirmThreshold()));
        assertFalse(parse("{\"cod\": {\"enabled\": 1}}").cod().enabled());
    }

    @Test
    void theLargestQuantityOfACartLineHasADefaultAndCannotBeSwitchedOffByABrokenValue() throws Exception {
        assertEquals(25, StorefrontSettings.defaults().maxOrderQuantity());
        assertEquals(40, parse("{\"maxOrderQuantity\": 40}").maxOrderQuantity());
        for (String broken : List.of("0", "-5", "1000000", "\"many\"", "null")) {
            assertEquals(25, parse("{\"maxOrderQuantity\": " + broken + "}").maxOrderQuantity(), broken);
        }
        // Cloth with a base unit of 10 cm: 25 metres are 250 base units.
        assertEquals(250, StorefrontSettings.defaults().maxLineBaseUnits(10));
        assertEquals(25, StorefrontSettings.defaults().maxLineBaseUnits(1));
    }

    @Test
    void thePhotoTagsOfferedInTheEditorAreTheInstitutesListWithTheLeadTagFirst() throws Exception {
        assertEquals(List.of("HERO", "SWATCH", "SIZE_CHART"), StorefrontSettings.defaults().offeredMediaTags());
        assertEquals(List.of("REAL", "RENDER"),
                parse("{\"leadMediaTag\": \"real\", \"mediaTags\": [\"render\", \"REAL\", 7, \"\"]}").offeredMediaTags());
        assertEquals(List.of("REAL"), parse("{\"leadMediaTag\": \"REAL\"}").offeredMediaTags());
    }

    // ------------------------------------------------------------------ checkout keys (P2)

    @Test
    void buyerIdentityIsEitherUnlessAKnownModeIsSet_caseIgnored() throws Exception {
        assertEquals(BuyerIdentity.EITHER, parse("{}").buyerIdentity());
        assertEquals(BuyerIdentity.EITHER, StorefrontSettings.parse(null).buyerIdentity());
        assertEquals(BuyerIdentity.EITHER, parse("{\"buyerIdentity\": \"PHONE\"}").buyerIdentity());
        assertEquals(BuyerIdentity.EITHER, parse("{\"buyerIdentity\": 3}").buyerIdentity());
        assertEquals(BuyerIdentity.PHONE_OTP, parse("{\"buyerIdentity\": \"phone_otp\"}").buyerIdentity());
        assertEquals(BuyerIdentity.EMAIL, parse("{\"buyerIdentity\": \" Email \"}").buyerIdentity());
    }

    @Test
    void theOtpCapIsBoundedTo10Through2000_elseThe300Default() throws Exception {
        assertEquals(300, parse("{}").otpInstituteHourlyCap());
        assertEquals(10, parse("{\"otp\": {\"instituteHourlyCap\": 10}}").otpInstituteHourlyCap());
        assertEquals(2000, parse("{\"otp\": {\"instituteHourlyCap\": \"2000\"}}").otpInstituteHourlyCap());
        assertEquals(300, parse("{\"otp\": {\"instituteHourlyCap\": 9}}").otpInstituteHourlyCap());
        assertEquals(300, parse("{\"otp\": {\"instituteHourlyCap\": 2001}}").otpInstituteHourlyCap());
        assertEquals(300, parse("{\"otp\": {\"instituteHourlyCap\": 50.5}}").otpInstituteHourlyCap());
        assertEquals(300, parse("{\"otp\": {\"instituteHourlyCap\": \"lots\"}}").otpInstituteHourlyCap());
    }

    @Test
    void theNewCodLimitsHaveDefaultsAndBounds() throws Exception {
        StorefrontSettings.Cod defaults = parse("{}").cod();
        assertEquals(2, defaults.maxOpenOrdersPerPhone());
        assertEquals(2, defaults.maxRefusals());
        StorefrontSettings.Cod set = parse("{\"cod\": {\"maxOpenOrdersPerPhone\": 5, \"maxRefusals\": 0}}").cod();
        assertEquals(5, set.maxOpenOrdersPerPhone());
        assertEquals(0, set.maxRefusals());
        StorefrontSettings.Cod out = parse("{\"cod\": {\"maxOpenOrdersPerPhone\": 0, \"maxRefusals\": 21}}").cod();
        assertEquals(2, out.maxOpenOrdersPerPhone());
        assertEquals(2, out.maxRefusals());
    }
}
