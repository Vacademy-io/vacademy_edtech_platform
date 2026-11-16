package vacademy.io.admin_core_service.features.commerce.storefront.rules;

import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.commerce.storefront.model.StorefrontSnapshot.Translation;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

/** Requested locale, then the site's base locale, then any; per field. */
class StorefrontLocaleTest {

    private static Map<String, Translation> translations() {
        Map<String, Translation> out = new LinkedHashMap<>();
        out.put("hi", new Translation("hi", "लाल साड़ी", null, "  ", List.of()));
        out.put("en", new Translation("en", "Red saree", "A red saree", "<p>English text</p>", List.of()));
        return out;
    }

    @Test
    void theChainIsRequestedThenItsLanguageThenTheBase() {
        assertEquals(List.of("en-in", "en", "hi"), StorefrontLocale.chain("en_IN", "hi"));
        assertEquals(List.of("hi"), StorefrontLocale.chain(null, "hi"));
        assertEquals(List.of("hi"), StorefrontLocale.chain("hi", "HI"));
        assertEquals(List.of("hi"), StorefrontLocale.chain("<script>", "hi"));
    }

    @Test
    void theRequestedLocaleWinsWhenItHasTheField() {
        List<String> chain = StorefrontLocale.chain("en", "hi");
        assertEquals("Red saree", StorefrontLocale.textField(translations(), chain, Translation::name));
        assertEquals("en", StorefrontLocale.served(translations(), chain));
    }

    @Test
    void aMissingFieldFallsBackToTheBaseLocaleAndThenToAnyLocale() {
        // Hindi page: the name is Hindi; the short description exists only in English.
        List<String> hindi = StorefrontLocale.chain("hi", "hi");
        assertEquals("लाल साड़ी", StorefrontLocale.textField(translations(), hindi, Translation::name));
        assertEquals("A red saree", StorefrontLocale.textField(translations(), hindi, Translation::shortDescription));
        // A blank value counts as missing.
        assertEquals("<p>English text</p>",
                StorefrontLocale.textField(translations(), hindi, Translation::descriptionHtml));

        // French was asked for: the base locale (Hindi) serves the name.
        List<String> french = StorefrontLocale.chain("fr", "hi");
        assertEquals("लाल साड़ी", StorefrontLocale.textField(translations(), french, Translation::name));
        assertEquals("hi", StorefrontLocale.served(translations(), french));
    }

    @Test
    void withNeitherTheRequestedNorTheBaseLocaleAnyLocaleServes() {
        Map<String, Translation> onlyEnglish = Map.of("en", new Translation("en", "Red saree", null, null, List.of()));
        List<String> chain = StorefrontLocale.chain("mr", "hi");
        assertEquals("Red saree", StorefrontLocale.textField(onlyEnglish, chain, Translation::name));
        assertEquals("en", StorefrontLocale.served(onlyEnglish, chain));
        assertNull(StorefrontLocale.textField(onlyEnglish, chain, Translation::shortDescription));
    }

    @Test
    void i18nMapsUseTheSameFallback() {
        assertEquals("लाल", StorefrontLocale.text(Map.of("en", "Red", "hi", "लाल"), List.of("hi")));
        assertEquals("Red", StorefrontLocale.text(Map.of("en", "Red"), List.of("hi")));
        assertEquals("Red", StorefrontLocale.text(Map.of("en", "Red", "hi", " "), List.of("hi")));
        assertNull(StorefrontLocale.text(Map.of(), List.of("hi")));
    }
}
