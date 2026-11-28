package vacademy.io.admin_core_service.features.catalog_api.website;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.*;

class WebsiteHostsTest {

    @Test
    void normalizeAcceptsUrlsHostsAndPorts() {
        assertEquals("www.x.com", WebsiteHosts.normalize("https://www.x.com/path?q=1#top"));
        assertEquals("x.com", WebsiteHosts.normalize("x.com:3000"));
        assertEquals("x.com", WebsiteHosts.normalize("  HTTP://X.COM.  "));
        assertEquals("learning.brahmvarchas.org", WebsiteHosts.normalize("learning.brahmvarchas.org/store"));
        assertEquals("a-b.co.uk", WebsiteHosts.normalize("A-B.co.uk"));
    }

    @Test
    void normalizeConvertsIdnToPunycode() {
        assertEquals("xn--bcher-kva.example", WebsiteHosts.normalize("https://bücher.example/"));
    }

    @Test
    void normalizeRejectsWhatCannotBeAWebsite() {
        for (String bad : List.of("", "   ", "localhost", "localhost:3000", "http://localhost", "app.localhost",
                "127.0.0.1", "http://10.0.0.1:8080", "[::1]", "http://[2001:db8::1]/", "intranet",
                "ftp://x.com", "user@x.com", "https://user:pw@x.com", "x..com", "-x.com", "x-.com",
                "x_y.com", "*.x.com", "x.com:abc", "x.com:", "x.123", "a b.com",
                "a".repeat(64) + ".com", ("abcdefghij.".repeat(25)) + "com")) {
            assertThrows(IllegalArgumentException.class, () -> WebsiteHosts.normalize(bad), bad);
        }
        assertThrows(IllegalArgumentException.class, () -> WebsiteHosts.normalize(null));
    }

    @Test
    void originHostParsesBrowserOrigins() {
        assertEquals("www.x.com", WebsiteHosts.originHost("https://www.x.com"));
        assertEquals("x.com", WebsiteHosts.originHost("http://X.com:8080"));
        assertEquals("localhost", WebsiteHosts.originHost("http://localhost:3000"));
        assertEquals("127.0.0.1", WebsiteHosts.originHost("http://127.0.0.1:5173"));
        assertEquals("[::1]", WebsiteHosts.originHost("http://[::1]:3000"));
        assertEquals("xn--bcher-kva.example", WebsiteHosts.originHost("https://xn--bcher-kva.example"));
        assertNull(WebsiteHosts.originHost("null"));
        assertNull(WebsiteHosts.originHost("file://"));
        assertNull(WebsiteHosts.originHost("chrome-extension://abcdef"));
        assertNull(WebsiteHosts.originHost("https://user@x.com"));
        assertNull(WebsiteHosts.originHost("https://x.com:abc"));
        assertNull(WebsiteHosts.originHost("x.com"));
        assertNull(WebsiteHosts.originHost(""));
        assertNull(WebsiteHosts.originHost(null));
    }

    @Test
    void localDevHostsAreExactlyLocalhostAndLoopback() {
        assertTrue(WebsiteHosts.isLocalDevHost("localhost"));
        assertTrue(WebsiteHosts.isLocalDevHost("127.0.0.1"));
        assertTrue(WebsiteHosts.isLocalDevHost("[::1]"));
        assertFalse(WebsiteHosts.isLocalDevHost("localhost.evil.io"));
        assertFalse(WebsiteHosts.isLocalDevHost("127.0.0.2"));
        assertFalse(WebsiteHosts.isLocalDevHost(WebsiteHosts.originHost("http://localhost.evil.io")));
    }

    @Test
    void coversExactAndSubdomainsOnLabelBoundariesOnly() {
        assertTrue(WebsiteHosts.covers("x.com", "x.com"));
        assertTrue(WebsiteHosts.covers("x.com", "www.x.com"));
        assertTrue(WebsiteHosts.covers("x.com", "a.b.x.com"));
        assertFalse(WebsiteHosts.covers("x.com", "evilx.com"));
        assertFalse(WebsiteHosts.covers("x.com", "x.com.evil.io"));
        assertFalse(WebsiteHosts.covers("x.com", "xcom"));
        assertFalse(WebsiteHosts.covers("x.com", "com"));
        assertFalse(WebsiteHosts.covers("www.x.com", "x.com"));
        assertFalse(WebsiteHosts.covers("", "x.com"));
        assertFalse(WebsiteHosts.covers(null, "x.com"));
        assertFalse(WebsiteHosts.covers("x.com", null));
        assertTrue(WebsiteHosts.coveredByAny(Set.of("a.org", "x.com"), "shop.x.com"));
        assertFalse(WebsiteHosts.coveredByAny(Set.of(), "x.com"));
    }

    @Test
    void lookAlikeOriginsNeverMatch() {
        Set<String> verified = Set.of("x.com");
        for (String origin : List.of("https://evilx.com", "https://x.com.evil.io", "https://x.co",
                "https://wwwx.com", "http://x.com@evil.io", "https://evil.io/x.com", "null")) {
            String host = WebsiteHosts.originHost(origin);
            assertFalse(host != null && WebsiteHosts.coveredByAny(verified, host), origin);
        }
        assertTrue(WebsiteHosts.coveredByAny(verified, WebsiteHosts.originHost("https://WWW.X.COM.")));
    }

    @Test
    void verificationRecordName() {
        assertEquals("_vacademy-verification.x.com", WebsiteHosts.verificationRecordName("x.com"));
    }
}
