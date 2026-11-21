package vacademy.io.admin_core_service.features.commerce.storefront.redirect;

import org.junit.jupiter.api.Test;

import java.net.URLDecoder;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.text.Normalizer;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class SiteRedirectPathsTest {

    private static final String SLUG = Normalizer.normalize("लाल-साड़ी", Normalizer.Form.NFC);

    private static String enc(String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8);
    }

    @Test
    void aDevanagariTargetBecomesAsciiAndReadsBackTheSame() {
        String ascii = SiteRedirectPaths.ascii("/p/" + SLUG + "?lang=en");
        assertEquals("/p/" + enc(SLUG) + "?lang=en", ascii);
        assertTrue(ascii.chars().allMatch(c -> c > 0x20 && c < 0x7F), ascii);
        assertEquals("/p/" + SLUG, URLDecoder.decode(SiteRedirectPaths.pathPart(ascii), StandardCharsets.UTF_8));
    }

    @Test
    void anEncodedTargetIsNotEncodedAgain() {
        String encoded = "/p/" + enc(SLUG);
        assertEquals(encoded, SiteRedirectPaths.ascii(encoded));
        assertEquals(encoded.toLowerCase(), SiteRedirectPaths.ascii(encoded.toLowerCase()));
        assertEquals("/shop?filter.colour=red&lang=en#top", SiteRedirectPaths.ascii("/shop?filter.colour=red&lang=en#top"));
    }

    @Test
    void spacesStrayPercentSignsAndBrokenCharactersAreEncoded() {
        assertEquals("/p/a%20b", SiteRedirectPaths.ascii("/p/a b"));
        assertEquals("/p/100%25", SiteRedirectPaths.ascii("/p/100%"));
        assertEquals("/p/50%25zz", SiteRedirectPaths.ascii("/p/50%zz"));
        assertEquals("/p/%EF%BF%BDx", SiteRedirectPaths.ascii("/p/\uD800x"));
        assertEquals("/p/caf%C3%A9", SiteRedirectPaths.ascii("/p/café"));
        assertEquals("/p/%F0%9F%99%82", SiteRedirectPaths.ascii("/p/🙂"));
        assertNull(SiteRedirectPaths.ascii(null));
    }

    @Test
    void aFullOldAddressIsReducedToItsPathAndQuery() {
        assertEquals("/product/red-saree/", SiteRedirectPaths.pathOfOldAddress("https://old.example/product/red-saree/"));
        assertEquals("/product/x?attribute_pa_size=m",
                SiteRedirectPaths.pathOfOldAddress(" HTTP://old.example/product/x?attribute_pa_size=m#reviews "));
        assertEquals("/", SiteRedirectPaths.pathOfOldAddress("https://old.example"));
        assertEquals("/?p=12", SiteRedirectPaths.pathOfOldAddress("https://old.example?p=12"));
        assertEquals("/hi/news", SiteRedirectPaths.pathOfOldAddress("/hi/news#top"));
        assertTrue(SiteRedirectPaths.hasFragment("/hi/news#top"));
        assertFalse(SiteRedirectPaths.hasFragment("/hi/news"));
    }

    @Test
    void anAddressThatLeavesTheSiteIsRecognised() {
        for (String value : new String[]{"https://evil.example/", "http://x", "//evil.example/x", "/\\evil.example",
                "\\\\evil.example", "javascript:alert(1)", "mailto:a@b.c"}) {
            assertTrue(SiteRedirectPaths.leavesSite(value), value);
        }
        for (String value : new String[]{"/p/x", "/shop?x=https://a", "/a:b", "p/x"}) {
            assertFalse(SiteRedirectPaths.leavesSite(value), value);
        }
    }
}
