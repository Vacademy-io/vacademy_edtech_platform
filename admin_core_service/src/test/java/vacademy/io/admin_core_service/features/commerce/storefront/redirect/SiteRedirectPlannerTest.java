package vacademy.io.admin_core_service.features.commerce.storefront.redirect;

import org.junit.jupiter.api.Test;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.text.Normalizer;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class SiteRedirectPlannerTest {

    private static final String DEVANAGARI = Normalizer.normalize("लाल-साड़ी", Normalizer.Form.NFC);
    private static final Set<String> PRODUCTS = Set.of("red-saree", DEVANAGARI);
    private static final Set<String> COLLECTIONS = Set.of("sarees");

    private static SiteRedirectCsv.Row row(int n, String from, String to, String status, String match) {
        return new SiteRedirectCsv.Row(n, from, to, status, match);
    }

    private static SiteRedirectCsv.Row row(int n, String from, String to) {
        return row(n, from, to, "301", "");
    }

    private static SiteRedirectPlanner.Plan plan(List<SiteRedirectPlanner.Existing> existing,
                                                 SiteRedirectCsv.Row... rows) {
        return SiteRedirectPlanner.plan(List.of(rows), existing, PRODUCTS, COLLECTIONS);
    }

    private static SiteRedirectPlanner.Plan plan(SiteRedirectCsv.Row... rows) {
        return plan(List.of(), rows);
    }

    private static List<String> codes(SiteRedirectPlanner.Plan plan, int row) {
        return plan.issues().stream().filter(i -> i.row() == row).map(SiteRedirectPlanner.Issue::code).toList();
    }

    private static void assertError(String code, SiteRedirectCsv.Row row) {
        SiteRedirectPlanner.Plan plan = plan(row);
        assertTrue(plan.hasErrors(), code);
        assertTrue(codes(plan, row.row()).contains(code), code + " in " + plan.issues());
        assertTrue(plan.creates().isEmpty(), code);
    }

    private static String enc(String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8);
    }

    // ------------------------------------------------------------ from_path

    @Test
    void fromPathIsStoredAsTheResolverLooksItUpWhateverTheSpelling() {
        String raw = "/hi/product/" + enc(DEVANAGARI) + "/";
        for (String spelling : List.of(raw, raw.toLowerCase(), "/hi/product/" + DEVANAGARI, "/HI/Product/" + DEVANAGARI + "/",
                "https://old.example" + raw)) {
            SiteRedirectPlanner.Plan plan = plan(row(2, spelling, "/p/red-saree"));
            assertEquals(List.of(), plan.issues(), spelling);
            String stored = plan.creates().get(0).fromPath();
            assertEquals("/hi/product/" + DEVANAGARI, stored, spelling);
            // The resolver normalises every request spelling to the stored form.
            for (String request : List.of(raw, raw.toLowerCase(), "/hi/product/" + DEVANAGARI, raw.substring(0, raw.length() - 1))) {
                assertEquals(stored, SiteRedirectResolver.normalise(request), request);
            }
        }
    }

    @Test
    void theQueryOfAnExactAddressIsKept() {
        SiteRedirectPlanner.Plan plan = plan(row(2, "/product/x/?attribute_pa_size=m", "/p/red-saree?v=RS-M"));
        assertEquals("/product/x?attribute_pa_size=m", plan.creates().get(0).fromPath());
        assertEquals("/p/red-saree?v=RS-M", plan.creates().get(0).toPath());
    }

    @Test
    void aFullOldAddressIsReducedToItsPath() {
        SiteRedirectPlanner.Plan plan = plan(row(2, "https://old.example/Product/Blue-Shirt/#reviews", "/p/red-saree"));
        assertEquals("/product/blue-shirt", plan.creates().get(0).fromPath());
        assertEquals(List.of("FRAGMENT_DROPPED"), codes(plan, 2));
        assertFalse(plan.hasErrors());
    }

    @Test
    void anAddressTheResolverCannotStoreIsRefused() {
        assertError("FROM_PATH_REQUIRED", row(2, " ", "/p/x"));
        assertError("INVALID_FROM_PATH", row(2, "product/x", "/p/x"));
        assertError("INVALID_FROM_PATH", row(2, "/a%0Ab", "/p/x"));
        assertError("INVALID_FROM_PATH", row(2, "/" + "x".repeat(1100), "/p/x"));
        assertError("HOME_PAGE", row(2, "/", "/p/x"));
        assertError("HOME_PAGE", row(2, "https://old.example/", "/p/x"));
        assertError("HOME_PAGE", row(2, "/?p=1", "/p/x"));
    }

    @Test
    void anAddressEndingInAFileNameIsWarnedAbout() {
        SiteRedirectPlanner.Plan plan = plan(row(2, "/wp-content/uploads/2024/01/photo.jpg", "/p/red-saree"));
        assertEquals(List.of("FILE_ADDRESS"), codes(plan, 2));
        assertFalse(plan.hasErrors());
    }

    // --------------------------------------------------------- match, status

    @Test
    void matchTypeIsExactUnlessSaidOtherwise() {
        SiteRedirectPlanner.Plan plan = plan(row(2, "/a", "/p/red-saree", "301", ""),
                row(3, "/b", "/p/red-saree", "301", "prefix"),
                row(4, "/c", "/p/red-saree", "301", " Exact "));
        assertEquals(List.of("EXACT", "PREFIX", "EXACT"),
                plan.creates().stream().map(SiteRedirectPlanner.Change::matchType).toList());
        assertError("INVALID_MATCH_TYPE", row(2, "/a", "/p/x", "301", "REGEX"));
    }

    @Test
    void statusIs301Or410AndTheTargetFollowsIt() {
        SiteRedirectPlanner.Plan plan = plan(row(2, "/a", "/p/red-saree", "", ""), row(3, "/b", "", "410", ""));
        assertEquals(301, plan.creates().get(0).statusCode());
        assertEquals(410, plan.creates().get(1).statusCode());
        assertNull(plan.creates().get(1).toPath());
        assertFalse(plan.hasErrors());

        assertError("INVALID_STATUS_CODE", row(2, "/a", "/p/x", "302", ""));
        assertError("INVALID_STATUS_CODE", row(2, "/a", "/p/x", "abc", ""));
        assertError("GONE_WITH_TARGET", row(2, "/a", "/p/x", "410", ""));
        assertError("TO_PATH_REQUIRED", row(2, "/a", " ", "301", ""));
        assertError("TO_PATH_REQUIRED", row(2, "/a", "", "", ""));
    }

    // -------------------------------------------------------------- to_path

    @Test
    void aTargetOffTheSiteIsAnOpenRedirectAndRefused() {
        for (String to : List.of("https://evil.example/", "http://evil.example", "//evil.example/x", "/\\evil.example",
                "\\\\evil.example", "javascript:alert(1)", "/p/x\\y")) {
            assertError("OFF_SITE_TARGET", row(2, "/old", to));
        }
        assertError("INVALID_TO_PATH", row(2, "/old", "p/red-saree"));
        assertError("INVALID_TO_PATH", row(2, "/old", "/p/x\r\nSet-Cookie: a=b"));
        assertError("INVALID_TO_PATH", row(2, "/old", "/p/x\ty"));
    }

    @Test
    void aNonAsciiTargetIsStoredPercentEncoded() {
        SiteRedirectPlanner.Plan plan = plan(row(2, "/hi/product/old", "/p/" + DEVANAGARI + "?lang=en"));
        String to = plan.creates().get(0).toPath();
        assertEquals("/p/" + enc(DEVANAGARI) + "?lang=en", to);
        assertTrue(to.chars().allMatch(c -> c > 0x20 && c < 0x7F));
        // The product exists under its Devanagari slug: no warning for an encoded target.
        assertEquals(List.of(), plan.issues());
        // Already encoded: stored as it is.
        assertEquals("/p/" + enc(DEVANAGARI), plan(row(2, "/x", "/p/" + enc(DEVANAGARI))).creates().get(0).toPath());
    }

    @Test
    void aTargetTooLongOnceEncodedIsRefused() {
        assertError("TO_PATH_TOO_LONG", row(2, "/old", "/p/" + "स".repeat(120)));
    }

    @Test
    void aTargetThatLeadsBackToItsOwnAddressIsRefused() {
        assertError("SELF_REDIRECT", row(2, "/old", "/old"));
        assertError("SELF_REDIRECT", row(2, "/Old/", "/old?lang=en"));
        assertError("SELF_REDIRECT", row(2, "/hi/" + DEVANAGARI, "/hi/" + enc(DEVANAGARI) + "/"));
        assertError("SELF_REDIRECT", row(2, "/old?x=1", "/old"));
        assertError("SELF_REDIRECT", row(2, "/old", "/old#top"));
        assertError("SELF_REDIRECT", row(2, "/shop-old", "/shop-old", "301", "PREFIX"));
    }

    // -------------------------------------------------------------- chains

    @Test
    void aTargetThatIsAnotherAddressOfTheFileIsAChain() {
        SiteRedirectPlanner.Plan plan = plan(row(2, "/a", "/b"), row(3, "/b", "/p/red-saree"));
        assertEquals(List.of("REDIRECT_CHAIN"), codes(plan, 2));
        assertEquals(List.of(), codes(plan, 3));
        assertTrue(plan.hasErrors());
        // A loop of two rows: both refused.
        SiteRedirectPlanner.Plan loop = plan(row(2, "/a", "/b"), row(3, "/b", "/A/"));
        assertEquals(List.of("REDIRECT_CHAIN"), codes(loop, 2));
        assertEquals(List.of("REDIRECT_CHAIN"), codes(loop, 3));
        // The target's query does not hide the hop: /b?lang=en is looked up as /b too.
        assertEquals(List.of("REDIRECT_CHAIN"), codes(plan(row(2, "/a", "/b?lang=en"), row(3, "/b", "/p/red-saree")), 2));
        // Nor does a different spelling of the same path.
        assertEquals(List.of("REDIRECT_CHAIN"),
                codes(plan(row(2, "/a", "/hi/" + DEVANAGARI), row(3, "/hi/" + enc(DEVANAGARI) + "/", "/p/red-saree")), 2));
    }

    @Test
    void aTargetThatIsAStoredAddressIsAChainEvenToAGonePage() {
        List<SiteRedirectPlanner.Existing> stored = List.of(new SiteRedirectPlanner.Existing("id-1", "EXACT", "/gone", null, 410));
        SiteRedirectPlanner.Plan plan = plan(stored, row(2, "/a", "/gone"));
        assertEquals(List.of("REDIRECT_CHAIN"), codes(plan, 2));
    }

    @Test
    void aStoredRowThatWouldLeadToANewAddressIsAChain() {
        List<SiteRedirectPlanner.Existing> stored = List.of(new SiteRedirectPlanner.Existing("id-1", "EXACT", "/y", "/x", 301));
        SiteRedirectPlanner.Plan plan = plan(stored, row(2, "/x", "/p/red-saree"));
        assertEquals(List.of("REDIRECT_CHAIN"), codes(plan, 2));
        // Unless the same file moves that stored row elsewhere.
        SiteRedirectPlanner.Plan fixed = plan(stored, row(2, "/x", "/p/red-saree"), row(3, "/y", "/p/red-saree"));
        assertFalse(fixed.hasErrors(), fixed.issues().toString());
        assertEquals(1, fixed.creates().size());
        assertEquals(1, fixed.updates().size());
    }

    @Test
    void aPrefixRowIsNoChainButATargetItCatchesIsWarnedAbout() {
        SiteRedirectPlanner.Plan plan = plan(row(2, "/hi", "/", "301", "PREFIX"), row(3, "/old", "/hi/news"));
        assertFalse(plan.hasErrors(), plan.issues().toString());
        assertEquals(List.of("TARGET_CAUGHT_BY_PREFIX"), codes(plan, 3));
        assertEquals(List.of(), codes(plan, 2));
    }

    @Test
    void twoRowsForOneAddressAreRefused() {
        SiteRedirectPlanner.Plan plan = plan(row(2, "/old/", "/p/red-saree"), row(3, "/OLD", "/c/sarees"));
        assertEquals(List.of("DUPLICATE_FROM_PATH"), codes(plan, 3));
        assertEquals(1, plan.creates().size());
        // The same address once EXACT and once PREFIX is two rows.
        assertFalse(plan(row(2, "/old", "/p/red-saree"), row(3, "/old", "/c/sarees", "301", "PREFIX")).hasErrors());
    }

    // ------------------------------------------------------------- targets

    @Test
    void aTargetProductOrCollectionThatIsNotActiveIsAWarning() {
        SiteRedirectPlanner.Plan plan = plan(row(2, "/a", "/p/missing?lang=en"), row(3, "/b", "/c/missing"),
                row(4, "/c", "/c/sarees/"), row(5, "/d", "/p/red-saree"), row(6, "/e", "/news#about"));
        assertEquals(List.of("TARGET_PRODUCT_NOT_ACTIVE"), codes(plan, 2));
        assertEquals(List.of("TARGET_COLLECTION_NOT_ACTIVE"), codes(plan, 3));
        assertEquals(List.of(), codes(plan, 4));
        assertEquals(List.of(), codes(plan, 5));
        assertEquals(List.of(), codes(plan, 6));
        assertFalse(plan.hasErrors());
        assertEquals(5, plan.creates().size());
        assertEquals(2, plan.warningCount());
    }

    // ------------------------------------------------------ create, update

    @Test
    void storedRowsAreUpdatedOrLeftAloneAndTheOldValuesAreKept() {
        List<SiteRedirectPlanner.Existing> stored = List.of(
                new SiteRedirectPlanner.Existing("id-1", "EXACT", "/same", "/p/red-saree", 301),
                new SiteRedirectPlanner.Existing("id-2", "EXACT", "/moved", "/p/old", 301),
                new SiteRedirectPlanner.Existing("id-3", "PREFIX", "/same", "/shop", 301));
        SiteRedirectPlanner.Plan plan = plan(stored, row(2, "/same/", "/p/red-saree"), row(3, "/moved", "", "410", ""),
                row(4, "/new", "/c/sarees"));
        assertFalse(plan.hasErrors());
        assertEquals(1, plan.unchanged());
        assertEquals(1, plan.creates().size());
        SiteRedirectPlanner.Change update = plan.updates().get(0);
        assertEquals("id-2", update.id());
        assertEquals("/p/old", update.oldToPath());
        assertEquals(301, update.oldStatusCode());
        assertEquals(410, update.statusCode());
        assertNull(update.toPath());
    }

    @Test
    void theSameFileAgainPlansNothing() {
        SiteRedirectPlanner.Plan first = plan(row(2, "/a", "/p/red-saree"), row(3, "/b", "", "410", ""));
        List<SiteRedirectPlanner.Existing> stored = new ArrayList<>();
        for (SiteRedirectPlanner.Change c : first.creates()) {
            stored.add(new SiteRedirectPlanner.Existing("id-" + c.row(), c.matchType(), c.fromPath(), c.toPath(), c.statusCode()));
        }
        SiteRedirectPlanner.Plan second = plan(stored, row(2, "/a", "/p/red-saree"), row(3, "/b", "", "410", ""));
        assertEquals(0, second.creates().size());
        assertEquals(0, second.updates().size());
        assertEquals(2, second.unchanged());
    }

    @Test
    void theFingerprintIgnoresRowOrderButNotTheStoredValues() {
        SiteRedirectCsv.Row a = row(2, "/a", "/p/red-saree");
        SiteRedirectCsv.Row b = row(3, "/b", "/c/sarees");
        SiteRedirectCsv.Row bFirst = row(2, "/b", "/c/sarees");
        SiteRedirectCsv.Row aSecond = row(3, "/a", "/p/red-saree");
        assertEquals(plan(a, b).fingerprint(), plan(bFirst, aSecond).fingerprint());

        List<SiteRedirectPlanner.Existing> before = List.of(new SiteRedirectPlanner.Existing("id-1", "EXACT", "/a", "/p/x", 301));
        List<SiteRedirectPlanner.Existing> after = List.of(new SiteRedirectPlanner.Existing("id-1", "EXACT", "/a", "/p/y", 301));
        assertNotEquals(plan(before, a).fingerprint(), plan(after, a).fingerprint());
        assertNotEquals(plan(a).fingerprint(), plan(before, a).fingerprint());
    }

    @Test
    void anInstituteHoldsAtMostFiftyThousandRows() {
        List<SiteRedirectPlanner.Existing> stored = new ArrayList<>();
        for (int i = 0; i < SiteRedirectPlanner.MAX_ROWS_PER_INSTITUTE; i++) {
            stored.add(new SiteRedirectPlanner.Existing("id-" + i, "EXACT", "/s/" + i, "/p/red-saree", 301));
        }
        SiteRedirectPlanner.Plan plan = plan(stored, row(2, "/one-more", "/p/red-saree"));
        assertEquals(List.of("TOO_MANY_REDIRECTS"), codes(plan, 0));
        assertTrue(plan.hasErrors());
        // Updating a stored row adds none.
        assertFalse(plan(stored, row(2, "/s/1", "/c/sarees")).hasErrors());
    }

    @Test
    void errorsComeFirstThenWarningsEachByRow() {
        SiteRedirectPlanner.Plan plan = plan(row(2, "/a", "/p/missing"), row(3, "/b", "https://evil.example"),
                row(4, "/c", "/c/missing"), row(5, "/d", "/d"));
        assertEquals(List.of(3, 5, 2, 4), plan.issues().stream().map(SiteRedirectPlanner.Issue::row).toList());
        assertEquals(2, plan.errorCount());
        assertEquals(2, plan.warningCount());
    }
}
