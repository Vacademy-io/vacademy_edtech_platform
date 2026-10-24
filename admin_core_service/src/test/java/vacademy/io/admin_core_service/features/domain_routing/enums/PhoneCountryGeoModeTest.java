package vacademy.io.admin_core_service.features.domain_routing.enums;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.NullAndEmptySource;
import org.junit.jupiter.params.provider.ValueSource;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

/**
 * Pins the two properties this enum exists to guarantee.
 *
 * <p>
 * First, that a bad value cannot break anything. This mode is read on the
 * PUBLIC domain-resolve endpoint — the one every dashboard calls before login,
 * on every portal — and written from a white-label save. It decides nothing but
 * which flag a phone field starts on. A stray value in the column, or a client
 * posting a mode this build has never heard of, must degrade to the default,
 * never throw: a 500 here takes the login page's branding down with it.
 *
 * <p>
 * Second, that the default is the mode which preserves the behaviour every
 * existing row already has. {@code phone_country_geo_mode} was added to a table
 * with live rows and no backfill, so every one of them reads null — and an
 * institute that configured preferred countries must keep seeing those
 * countries until it deliberately chooses otherwise.
 */
class PhoneCountryGeoModeTest {

    @Nested
    @DisplayName("fromNullable()")
    class FromNullable {

        @Test
        @DisplayName("An unset column keeps the institute's own list authoritative")
        void nullIsInstituteFirst() {
            // Not an arbitrary pick: this is the value every pre-migration row
            // holds, and INSTITUTE_FIRST is the only mode under which those rows
            // behave exactly as they did before the column existed.
            assertEquals(PhoneCountryGeoMode.INSTITUTE_FIRST, PhoneCountryGeoMode.fromNullable(null));
            assertEquals(PhoneCountryGeoMode.getDefault(), PhoneCountryGeoMode.fromNullable(null));
        }

        @ParameterizedTest
        @NullAndEmptySource
        @ValueSource(strings = { "   ", "\t" })
        @DisplayName("Blank input is the default, not an error")
        void blankIsDefault(String raw) {
            assertEquals(PhoneCountryGeoMode.getDefault(), PhoneCountryGeoMode.fromNullable(raw));
        }

        @ParameterizedTest
        @ValueSource(strings = { "GEO_FIRST", "geo_first", "  Geo_First  " })
        @DisplayName("Case and padding are tolerated — a mode is a mode")
        void parsesLoosely(String raw) {
            assertEquals(PhoneCountryGeoMode.GEO_FIRST, PhoneCountryGeoMode.fromNullable(raw));
        }

        @ParameterizedTest
        @ValueSource(strings = { "IP_LOOKUP", "TRUE", "in", "GEO", "INSTITUTE" })
        @DisplayName("An unrecognised value degrades to the default instead of throwing")
        void unknownDoesNotThrow(String raw) {
            assertEquals(PhoneCountryGeoMode.getDefault(), PhoneCountryGeoMode.fromNullable(raw));
        }

        @Test
        @DisplayName("Every declared mode round-trips through its own name")
        void everyModeRoundTrips() {
            for (PhoneCountryGeoMode mode : PhoneCountryGeoMode.values()) {
                assertEquals(mode, PhoneCountryGeoMode.fromNullable(mode.name()),
                        mode + " did not survive a name round-trip");
            }
        }
    }

    @Nested
    @DisplayName("normalizeForStorage()")
    class NormalizeForStorage {

        @Test
        @DisplayName("Unset stays null rather than being stamped with a redundant default")
        void blankStoresNull() {
            // A portal that never opened this setting should be distinguishable
            // from one that deliberately chose INSTITUTE_FIRST, and null costs
            // nothing to read: fromNullable() already resolves it.
            assertNull(PhoneCountryGeoMode.normalizeForStorage(null));
            assertNull(PhoneCountryGeoMode.normalizeForStorage(""));
            assertNull(PhoneCountryGeoMode.normalizeForStorage("   "));
        }

        @Test
        @DisplayName("A recognised mode is stored in canonical upper case")
        void canonicalises() {
            assertEquals("GEO_FIRST", PhoneCountryGeoMode.normalizeForStorage("  geo_first "));
            assertEquals("INSTITUTE_ONLY", PhoneCountryGeoMode.normalizeForStorage("institute_only"));
        }

        @Test
        @DisplayName("Junk is stored as the default, so the column never holds a value we cannot read")
        void junkStoresDefault() {
            assertEquals(PhoneCountryGeoMode.getDefault().name(),
                    PhoneCountryGeoMode.normalizeForStorage("IP_LOOKUP"));
        }
    }
}
