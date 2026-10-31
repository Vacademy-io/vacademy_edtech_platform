package vacademy.io.admin_core_service.features.learner.service;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.NullSource;
import org.junit.jupiter.params.provider.ValueSource;
import vacademy.io.admin_core_service.features.learner.service.ShippingZoneMatcher.Zone;

import java.util.Arrays;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * The delivery-zone rules of a zone-priced shipping charge. The storefront applies the same rules
 * to show the rate; if the two disagree, a buyer is shown one price and the server demands another.
 */
class ShippingZoneMatcherTest {

    /** Maharashtra PINs start 40–44, but 403 is Goa. */
    private static final Zone MAHARASHTRA = new Zone("MAHARASHTRA",
            List.of("40", "41", "42", "43", "44"), List.of("403"), "plan-mh", 70d);
    private static final Zone REST_OF_INDIA = new Zone("REST_OF_INDIA", null, null, "plan-roi", 90d);
    private static final List<Zone> ZONES = List.of(MAHARASHTRA, REST_OF_INDIA);

    private static String zoneKey(List<Zone> zones, String pin) {
        return ShippingZoneMatcher.match(zones, pin).map(Zone::key).orElse(null);
    }

    @ParameterizedTest(name = "{0} → {1}")
    @CsvSource({
            "400001, MAHARASHTRA",
            "411001, MAHARASHTRA",
            "440001, MAHARASHTRA",
            "445001, MAHARASHTRA",
            "403001, REST_OF_INDIA",
            "110001, REST_OF_INDIA",
            "560001, REST_OF_INDIA",
    })
    @DisplayName("each PIN lands in the first zone that serves it")
    void picksTheZoneOfThePin(String pin, String expectedZone) {
        assertEquals(expectedZone, zoneKey(ZONES, pin));
    }

    @ParameterizedTest(name = "\"{0}\" is not a PIN")
    @NullSource
    @ValueSource(strings = {"", "   ", "4000", "abcdef", "4000011", "40000a", "400 001", "४००००१"})
    @DisplayName("anything but six digits is no PIN and matches no zone, not even a catch-all")
    void rejectsAnythingButSixDigits(String pin) {
        assertNull(ShippingZoneMatcher.normalisePin(pin));
        assertTrue(ShippingZoneMatcher.match(ZONES, pin).isEmpty());
    }

    @Test
    @DisplayName("surrounding whitespace is trimmed before the PIN is judged")
    void trimsThePin() {
        assertEquals("400001", ShippingZoneMatcher.normalisePin(" 400001 "));
        assertEquals("MAHARASHTRA", zoneKey(ZONES, " 400001 "));
        assertEquals("REST_OF_INDIA", zoneKey(ZONES, "\t110001\n"));
    }

    @Test
    @DisplayName("array order decides: a catch-all listed first takes every PIN")
    void firstMatchingZoneWins() {
        assertEquals("REST_OF_INDIA", zoneKey(List.of(REST_OF_INDIA, MAHARASHTRA), "400001"));

        Zone mumbai = new Zone("MUMBAI", List.of("400"), null, "plan-mumbai", 50d);
        List<Zone> nested = List.of(mumbai, MAHARASHTRA, REST_OF_INDIA);
        assertEquals("MUMBAI", zoneKey(nested, "400001"));
        assertEquals("MAHARASHTRA", zoneKey(nested, "411001"));
    }

    @Test
    @DisplayName("an excluded prefix beats an included one, also on a catch-all zone")
    void excludeWinsOverInclude() {
        Zone contradictory = new Zone("GOA_OR_NOT", List.of("403"), List.of("403"), "plan-x", 1d);
        assertTrue(ShippingZoneMatcher.match(List.of(contradictory), "403001").isEmpty());

        Zone everywhereButNorthEast = new Zone("MAINLAND", List.of(), List.of("78", "79"), "plan-mainland", 1d);
        assertTrue(ShippingZoneMatcher.match(List.of(everywhereButNorthEast), "781001").isEmpty());
        assertEquals("MAINLAND", zoneKey(List.of(everywhereButNorthEast), "560001"));
    }

    @Test
    @DisplayName("without a catch-all, a PIN outside every zone is not deliverable")
    void noCatchAllLeavesUnservedPinsUnmatched() {
        assertTrue(ShippingZoneMatcher.match(List.of(MAHARASHTRA), "110001").isEmpty());
        assertTrue(ShippingZoneMatcher.match(List.of(MAHARASHTRA), "403001").isEmpty());
        assertEquals("MAHARASHTRA", zoneKey(List.of(MAHARASHTRA), "400001"));
    }

    @Test
    @DisplayName("no zones at all serve nothing")
    void noZonesServeNothing() {
        assertTrue(ShippingZoneMatcher.match(List.of(), "400001").isEmpty());
        assertTrue(ShippingZoneMatcher.match(null, "400001").isEmpty());
    }

    @Test
    @DisplayName("an unreadable prefix (null) matches nothing but keeps the zone from being a catch-all")
    void unreadablePrefixIsNotACatchAll() {
        Zone unreadable = new Zone("BROKEN", Arrays.asList((String) null), null, "plan-x", 1d);
        assertTrue(ShippingZoneMatcher.match(List.of(unreadable), "400001").isEmpty());
        assertEquals("REST_OF_INDIA", zoneKey(List.of(unreadable, REST_OF_INDIA), "400001"));
    }

    @Test
    @DisplayName("a zone is priced only with both a plan and an amount")
    void pricedNeedsPlanAndAmount() {
        assertTrue(MAHARASHTRA.priced());
        assertFalse(new Zone("NO_PLAN", null, null, null, 70d).priced());
        assertFalse(new Zone("NO_AMOUNT", null, null, "plan-x", null).priced());
    }
}
