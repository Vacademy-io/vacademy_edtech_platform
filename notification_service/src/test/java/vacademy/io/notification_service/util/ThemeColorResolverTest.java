package vacademy.io.notification_service.util;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ThemeColorResolverTest {

    @Test
    void presetCodesBecomeHex() {
        assertEquals("#ED7424", ThemeColorResolver.resolve("primary"));
        assertEquals("#1E88E5", ThemeColorResolver.resolve("Blue"));
        assertEquals("#FFB300", ThemeColorResolver.resolve("amber"));
    }

    @Test
    void hexIsNormalisedToSixDigitUpperCase() {
        assertEquals("#2E86AB", ThemeColorResolver.resolve("#2E86AB"));
        assertEquals("#323E3D", ThemeColorResolver.resolve("#323e3d"));
        assertEquals("#ED7424", ThemeColorResolver.resolve(" ED7424 "));
        assertEquals("#AABBCC", ThemeColorResolver.resolve("#abc"));
        assertEquals("#112233", ThemeColorResolver.resolve("#11223380"));
    }

    @Test
    void blankOrUnknownIsNullAndDefaultsToTheAppsOrange() {
        assertNull(ThemeColorResolver.resolve(null));
        assertNull(ThemeColorResolver.resolve(""));
        assertNull(ThemeColorResolver.resolve("string"));
        assertNull(ThemeColorResolver.resolve("dark"));
        assertEquals("#ED7424", ThemeColorResolver.resolveOrDefault(null));
        assertEquals("#ED7424", ThemeColorResolver.resolveOrDefault("default"));
    }

    /** Every distinct value stored in institutes.institute_theme_code on 2026-11-12. */
    @ParameterizedTest
    @ValueSource(strings = { "", "blue", "primary", "green", "red", "purple", "pink", "indigo", "cyan", "amber",
            "lime", "#2E86AB", "navy", "string", "teal", "#1E90FF", "brown", "charcoal", "violet", "#E67E22",
            "#D81B60", "#883001", "default", "#43A047", "#131953", "ED7424", "#1F89E5", "#6C00FF", "maroon",
            "#FF6B00", "#323e3d", "#622335", "#079277", "#5d91b1", "#FFB300", "#1E88E5", "#8A5A00", "#283618",
            "dark", "#3949AB", "#E53935", "#ca1052", "#3db89f" })
    void everyStoredCodeGivesAPaintableColour(String code) {
        assertTrue(ThemeColorResolver.resolveOrDefault(code).matches("#[0-9A-F]{6}"), code);
    }
}
