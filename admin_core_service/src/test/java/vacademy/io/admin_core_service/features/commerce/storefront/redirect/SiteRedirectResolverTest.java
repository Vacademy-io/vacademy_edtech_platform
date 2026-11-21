package vacademy.io.admin_core_service.features.commerce.storefront.redirect;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class SiteRedirectResolverTest {

    @Test
    void aPathIsDecodedLowerCasedAndLosesItsTrailingSlash() {
        assertEquals("/product/khadi-kurta", SiteRedirectResolver.normalise("/Product/Khadi-Kurta/"));
        assertEquals("/a/b", SiteRedirectResolver.normalise("//a///b//"));
        assertEquals("/", SiteRedirectResolver.normalise("/"));
        // Either hex case decodes to the same Devanagari text; non-ASCII letters keep their case.
        assertEquals("/hi/product/खादी",
                SiteRedirectResolver.normalise("/hi/product/%e0%a4%96%E0%A4%BE%e0%a4%a6%E0%A5%80/"));
        // NFC: e + combining acute becomes one letter.
        assertEquals("/café", SiteRedirectResolver.normalise("/café"));
        // A plus stays a plus.
        assertEquals("/a+b", SiteRedirectResolver.normalise("/a+b"));
    }

    @Test
    void theQueryStringIsKeptAsSent() {
        assertEquals("/product/x?attribute_pa_Colour=Red", SiteRedirectResolver.normalise("/Product/X/?attribute_pa_Colour=Red"));
        assertEquals("/product/x", SiteRedirectResolver.normalise("/product/x?"));
    }

    @Test
    void aPathThatCannotBeARowIsRefused() {
        assertNull(SiteRedirectResolver.normalise(null));
        assertNull(SiteRedirectResolver.normalise(" "));
        assertNull(SiteRedirectResolver.normalise("product/x"));
        assertNull(SiteRedirectResolver.normalise("https://example.com/x"));
        assertNull(SiteRedirectResolver.normalise("/a%0Ab"));
        assertNull(SiteRedirectResolver.normalise("/" + "x".repeat(SiteRedirectResolver.MAX_PATH_LENGTH)));
        // A malformed escape is compared as sent.
        assertEquals("/a%zz", SiteRedirectResolver.normalise("/a%zz"));
    }

    @Test
    void onlyAPathOnTheSameSiteIsHandedOut() {
        assertTrue(SiteRedirectResolver.safe(new SiteRedirectResolver.Redirect(301, "/p/new?lang=en"), "/old"));
        assertTrue(SiteRedirectResolver.safe(new SiteRedirectResolver.Redirect(410, null), "/old"));
        assertFalse(SiteRedirectResolver.safe(new SiteRedirectResolver.Redirect(301, "https://evil.example/x"), "/old"));
        assertFalse(SiteRedirectResolver.safe(new SiteRedirectResolver.Redirect(301, "//evil.example/x"), "/old"));
        assertFalse(SiteRedirectResolver.safe(new SiteRedirectResolver.Redirect(301, "/\\evil"), "/old"));
        assertFalse(SiteRedirectResolver.safe(new SiteRedirectResolver.Redirect(301, null), "/old"));
        assertFalse(SiteRedirectResolver.safe(new SiteRedirectResolver.Redirect(302, "/x"), "/old"));
        assertFalse(SiteRedirectResolver.safe(new SiteRedirectResolver.Redirect(410, "/x"), "/old"));
        // A row that points at the path that was asked would loop.
        assertFalse(SiteRedirectResolver.safe(new SiteRedirectResolver.Redirect(301, "/Old/?x=1"), "/old"));
    }

    @Test
    void aTargetThatLeavesTheSiteOnceDecodedOrClimbsIsNeverHandedOut() {
        for (String to : List.of("/%2F%2Fevil.example", "/%2f/evil.example", "/%5Cevil.example", "/..//evil.example",
                "/a/../b", "/%2E%2E/x", "/p/%00x")) {
            assertFalse(SiteRedirectResolver.safe(new SiteRedirectResolver.Redirect(301, to), "/old"), to);
        }
        assertTrue(SiteRedirectResolver.safe(new SiteRedirectResolver.Redirect(301, "/p/a%2Fb?lang=en"), "/old"));
    }

    @Test
    void aQueryIsStoredAndLookedUpInTheAsciiFormABrowserSends() {
        assertEquals("/a?q=%E0%A4%96", SiteRedirectResolver.normalise("/a?q=ख"));
        assertEquals("/a?q=%E0%A4%96", SiteRedirectResolver.normalise("/a?q=%E0%A4%96"));
        assertEquals("/a?q=100%25", SiteRedirectResolver.normalise("/a?q=100%"));
        assertEquals("/a?q=a%20b", SiteRedirectResolver.normalise("/a?q=a b"));
    }
}
