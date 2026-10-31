package vacademy.io.admin_core_service.features.catalog_api.website;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class DohTxtLookupTest {

    @Test
    void quotedPiecesAreJoined() {
        assertEquals("vacademy-site-verification=abc", DohTxtLookup.joinTxtData("\"vacademy-site-verification=abc\""));
        assertEquals("vacademy-site-verification=abcdef",
                DohTxtLookup.joinTxtData("\"vacademy-site-verification=abc\" \"def\""));
        assertEquals("a\"b\\c", DohTxtLookup.joinTxtData("\"a\\\"b\\\\c\""));
        assertEquals("v=spf1 -all", DohTxtLookup.joinTxtData("v=spf1 -all"));
        assertEquals("", DohTxtLookup.joinTxtData(null));
    }

    @Test
    void cloudflareStyleAnswerIsParsed() {
        String body = """
                {"Status":0,"TC":false,"Question":[{"name":"_vacademy-verification.x.com","type":16}],
                 "Answer":[
                   {"name":"_vacademy-verification.x.com","type":5,"TTL":300,"data":"other.x.com."},
                   {"name":"other.x.com","type":16,"TTL":300,"data":"\\"vacademy-site-verification=0123\\" \\"4567\\""},
                   {"name":"other.x.com","type":16,"TTL":300,"data":"\\"google-site-verification=zzz\\""}
                 ]}""";
        TxtLookup.Result r = DohTxtLookup.parseDohJson(body, "Cloudflare DNS");
        assertFalse(r.failed());
        assertEquals(List.of("vacademy-site-verification=01234567", "google-site-verification=zzz"), r.values());
    }

    @Test
    void nxdomainAndNoAnswerAreEmptyNotFailures() {
        TxtLookup.Result nx = DohTxtLookup.parseDohJson("{\"Status\":3}", "Google DNS");
        assertFalse(nx.failed());
        assertTrue(nx.values().isEmpty());
        TxtLookup.Result none = DohTxtLookup.parseDohJson("{\"Status\":0}", "Google DNS");
        assertFalse(none.failed());
        assertTrue(none.values().isEmpty());
    }

    @Test
    void servfailAndGarbageAreFailures() {
        assertTrue(DohTxtLookup.parseDohJson("{\"Status\":2}", "Cloudflare DNS").failed());
        assertTrue(DohTxtLookup.parseDohJson("<html>", "Cloudflare DNS").failed());
        assertTrue(DohTxtLookup.parseDohJson("[]", "Cloudflare DNS").failed());
    }

    @Test
    void onlyTheVerificationNameOfAValidHostIsEverQueried() {
        DohTxtLookup lookup = new DohTxtLookup();
        // Invalid hosts are refused before any network call.
        for (String bad : List.of("localhost", "127.0.0.1", "a b", "", "x.com&type=A", "_dmarc.x.com")) {
            assertThrows(IllegalArgumentException.class, () -> lookup.lookupVerificationRecord(bad), bad);
        }
        // A smuggled query string is cut off by normalisation: still only _vacademy-verification.evil.io.
        assertEquals("evil.io", WebsiteHosts.normalize("evil.io?name=x"));
    }
}
