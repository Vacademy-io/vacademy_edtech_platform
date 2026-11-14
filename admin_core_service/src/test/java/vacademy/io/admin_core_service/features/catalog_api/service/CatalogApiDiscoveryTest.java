package vacademy.io.admin_core_service.features.catalog_api.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import vacademy.io.admin_core_service.features.catalog_api.CatalogApiException;
import vacademy.io.admin_core_service.features.catalog_api.CatalogTestData;
import vacademy.io.admin_core_service.features.catalog_api.rules.CatalogRow;
import vacademy.io.admin_core_service.features.catalog_api.rules.SiteConfig;
import vacademy.io.admin_core_service.features.catalog_api.settings.CatalogSiteResolver;
import vacademy.io.admin_core_service.features.packages.dto.CatalogPopularityDTO;
import vacademy.io.admin_core_service.features.packages.dto.PackageDetailV2DTO;
import vacademy.io.admin_core_service.features.packages.service.CatalogPopularityService;

import java.io.InputStream;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.*;
import java.util.function.Consumer;
import java.util.stream.Collectors;
import java.util.zip.GZIPInputStream;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static vacademy.io.admin_core_service.features.catalog_api.CatalogTestData.BV_INSTITUTE;

/**
 * The catalogue's discovery data over Brahm Varchas' real catalogue: sorts, popularity, badges,
 * price / level / instructor / session / custom filters, comma lists, facets, search, the new
 * course fields, /site catalog and /streams additions — and that every v1.0 call answers exactly
 * as it did before (golden_v1_0.json.gz, captured from the v1.0 code on 2026-10-16).
 */
class CatalogApiDiscoveryTest {

    static final String EBOOK_EN = CatalogApiServiceTest.EBOOK_EN;
    static final String EBOOK_HI = CatalogApiServiceTest.EBOOK_HI;
    static final String WELLNESS = "c59a3aaf-f108-4567-a1a1-ff9231e83265";
    static final String MITRAMELA = "212026a8-8251-4315-ab08-b5c399d1ae16";
    static final String MARTAND = "376ee0e7-4303-4ab7-ac57-179687cae8cf";
    static final String RAGHUVEER = "85ac1843-6261-4bc3-8c42-cca1768ce77c";
    static final Instant NOW = Instant.parse("2026-10-16T06:00:00Z");

    CatalogDataLoader loader;
    CatalogApiService service;

    @BeforeEach
    void setUp() {
        CatalogApiServiceTest base = new CatalogApiServiceTest();
        base.setUp();
        loader = base.loader;
        service = base.service;
        service.clock = Clock.fixed(NOW, ZoneOffset.UTC);
    }

    // ── helpers ─────────────────────────────────────────────────────────────────

    /** Builds a query from name → value pairs ("q", "stream", …, "facets"). */
    static CatalogApiService.CourseQuery q(String... kv) {
        Map<String, String> m = new HashMap<>();
        for (int i = 0; i < kv.length; i += 2) m.put(kv[i], kv[i + 1]);
        return new CatalogApiService.CourseQuery(m.get("q"), m.get("stream"), m.get("category"), m.get("format"),
                m.get("language"), m.get("tag"), m.get("availability"), 1, 100, m.get("sort"), m.get("level"),
                m.get("instructor"), m.get("session"), m.get("badge"), m.get("price"), m.get("price_min"),
                m.get("price_max"), m.get("custom"), "true".equals(m.get("facets")));
    }

    Map<String, Object> run(String... kv) {
        return service.courses(BV_INSTITUTE, q(kv));
    }

    @SuppressWarnings("unchecked")
    static List<Map<String, Object>> data(Map<String, Object> page) {
        return (List<Map<String, Object>>) page.get("data");
    }

    List<String> ids(String... kv) {
        return data(run(kv)).stream().map(c -> (String) c.get("id")).toList();
    }

    Set<String> idSet(String... kv) {
        return new HashSet<>(ids(kv));
    }

    @SuppressWarnings("unchecked")
    static <T> T at(Object m, String key) {
        return (T) ((Map<String, Object>) m).get(key);
    }

    /** The BV store site with extra Courses-section props (a JSON fragment ending in a comma). */
    static SiteConfig bvSiteWith(String props) {
        String json = CatalogTestData.json("bv_catalogue_store.json").get("catalogue_json").asText()
                .replace("\"groupLanguageVersions\": true, \"languageFilter\"",
                        "\"groupLanguageVersions\": true, " + props + " \"languageFilter\"");
        return SiteConfig.parse("store", json, CatalogTestData.MAPPER);
    }

    void useSite(SiteConfig site) {
        when(loader.snapshot(BV_INSTITUTE)).thenReturn(CatalogApiServiceTest.snapshot(site));
    }

    /** A catalogue of hand-built rows on the BV site (no streams). */
    void useRows(SiteConfig site, CatalogRow... rows) {
        when(loader.snapshot(BV_INSTITUTE)).thenReturn(new CatalogSnapshot(BV_INSTITUTE, "Brahm Varchas Shiksha",
                null, null, new CatalogSiteResolver.Resolution("store", "domain_routing", CatalogApiServiceTest.BASE,
                "domain_routing"), site, List.of(rows), null, List.of(), List.of(), Map.of()));
    }

    void assertInvalid(String param, String... kv) {
        CatalogApiException e = assertThrows(CatalogApiException.class, () -> run(kv));
        assertEquals(HttpStatus.BAD_REQUEST, e.getStatus());
        assertEquals("invalid_request", e.getCode());
        assertEquals(param, e.getDetails().get("param"));
    }

    /** The catalogue order of the cards (the search's row order, a course where its first row sat). */
    List<String> catalogueOrder() {
        return service.cards(loader.snapshot(BV_INSTITUTE), null).stream().map(c -> c.group().courseId()).toList();
    }

    // ── v1.0 behaviour is unchanged ─────────────────────────────────────────────

    /** Every field v1.0 returned is still there with the same value (new fields may be added). */
    @SuppressWarnings("unchecked")
    static void assertSuperset(Object old, Object now, String path) {
        if (old instanceof Map<?, ?> om) {
            assertInstanceOf(Map.class, now, path);
            Map<String, Object> nm = (Map<String, Object>) now;
            for (Map.Entry<?, ?> e : om.entrySet()) {
                assertTrue(nm.containsKey((String) e.getKey()), path + "." + e.getKey() + " is gone");
                assertSuperset(e.getValue(), nm.get(e.getKey()), path + "." + e.getKey());
            }
        } else if (old instanceof List<?> ol) {
            assertInstanceOf(List.class, now, path);
            List<?> nl = (List<?>) now;
            assertEquals(ol.size(), nl.size(), path + " size");
            for (int i = 0; i < ol.size(); i++) assertSuperset(ol.get(i), nl.get(i), path + "[" + i + "]");
        } else if (old instanceof Number on) {
            assertInstanceOf(Number.class, now, path);
            assertEquals(on.doubleValue(), ((Number) now).doubleValue(), 0.0, path);
        } else {
            assertEquals(old, now, path);
        }
    }

    @Test
    @SuppressWarnings("unchecked")
    void everyV1CallAnswersAsBefore() throws Exception {
        Map<String, Object> golden;
        try (InputStream in = new GZIPInputStream(Objects.requireNonNull(
                getClass().getResourceAsStream("/catalog_api/golden_v1_0.json.gz")))) {
            golden = new ObjectMapper().readValue(in, Map.class);
        }
        int compared = 0;
        for (Map.Entry<String, Object> e : golden.entrySet()) {
            String key = e.getKey();
            Object now;
            if (key.startsWith("course:")) {
                String[] parts = key.split(":");
                String id = parts[1].equals("7c12a9ec") ? EBOOK_EN : EBOOK_HI;
                now = service.course(BV_INSTITUTE, id, parts.length > 2 ? parts[2] : null);
            } else if (key.equals("streams")) {
                now = service.streams(BV_INSTITUTE);
            } else if (key.equals("site")) {
                now = service.site(BV_INSTITUTE);
            } else if (key.startsWith("path:")) {
                now = service.learningPath(BV_INSTITUTE, key.substring(5));
            } else {
                String[] p = key.split("\\|", -1); // q|stream|category|format|language|tag|availability|sort
                now = service.courses(BV_INSTITUTE, new CatalogApiService.CourseQuery(blank(p[0]), blank(p[1]),
                        blank(p[2]), blank(p[3]), blank(p[4]), blank(p[5]), blank(p[6]), 1, 100, blank(p[7])));
                if (!p[0].isEmpty()) {
                    // q now also searches descriptions and instructors: every v1.0 hit is still a hit.
                    Set<Object> before = data((Map<String, Object>) e.getValue()).stream().map(c -> c.get("id"))
                            .collect(Collectors.toSet());
                    Set<Object> after = data((Map<String, Object>) now).stream().map(c -> c.get("id"))
                            .collect(Collectors.toSet());
                    assertTrue(after.containsAll(before), key);
                    compared++;
                    continue;
                }
            }
            assertSuperset(e.getValue(), now, key);
            compared++;
        }
        assertEquals(27, compared);
    }

    private static String blank(String s) {
        return s.isEmpty() ? null : s;
    }

    // ── sorts and popularity ────────────────────────────────────────────────────

    @Test
    void popularSortsRankedCoursesFirstThenCatalogueOrder() {
        // The Hindi eBook's rank speaks for the folded EN+HI card (bestRankedId).
        when(loader.ranks(BV_INSTITUTE)).thenReturn(Map.of(EBOOK_HI, 1, WELLNESS, 2, "not-in-catalogue", 3));
        List<Map<String, Object>> popular = data(run("sort", "popular"));
        assertEquals(EBOOK_EN, popular.get(0).get("id"));
        assertEquals(1, popular.get(0).get("popularity_rank"));
        assertEquals(WELLNESS, popular.get(1).get("id"));
        assertEquals(2, popular.get(1).get("popularity_rank"));
        List<String> rest = popular.subList(2, popular.size()).stream().map(c -> (String) c.get("id")).toList();
        List<String> expected = new ArrayList<>(catalogueOrder());
        expected.removeAll(List.of(EBOOK_EN, WELLNESS));
        assertEquals(expected, rest);
        for (Map<String, Object> c : popular.subList(2, popular.size())) assertNull(c.get("popularity_rank"));
    }

    @Test
    void unreadableRanksNeverFailTheRequest() {
        when(loader.ranks(BV_INSTITUTE)).thenThrow(new IllegalStateException("replica down"));
        List<Map<String, Object>> popular = data(run("sort", "popular", "facets", "true"));
        assertEquals(catalogueOrder(), popular.stream().map(c -> c.get("id")).toList());
        for (Map<String, Object> c : popular) assertNull(c.get("popularity_rank"));
        doReturn(null).when(loader).ranks(BV_INSTITUTE);
        assertEquals(34, run("sort", "popular").get("total"));
    }

    @Test
    void theLoaderAnswersNoRanksWhenThePopularitySourceFails() {
        CatalogPopularityService popularity = mock(CatalogPopularityService.class);
        CatalogDataLoader real = new CatalogDataLoader(null, null, null, null, null, null, null, null, null,
                popularity);
        when(popularity.getPopularity("i1")).thenReturn(new CatalogPopularityDTO("i1", List.of(
                new CatalogPopularityDTO.PackageRank("a", 2), new CatalogPopularityDTO.PackageRank(" a ", 1),
                new CatalogPopularityDTO.PackageRank("b", 3), new CatalogPopularityDTO.PackageRank(" ", 4))));
        assertEquals(Map.of("a", 1, "b", 3), real.ranks("i1"));
        when(popularity.getPopularity("i2")).thenThrow(new RuntimeException("boom"));
        assertEquals(Map.of(), real.ranks("i2"));
        when(popularity.getPopularity("i3")).thenReturn(CatalogPopularityDTO.unavailable("i3"));
        assertEquals(Map.of(), real.ranks("i3"));
    }

    @Test
    void oldestTitleDescAndRatingSorts() {
        List<Map<String, Object>> oldest = data(run("sort", "oldest"));
        List<Map<String, Object>> newest = data(run());
        assertEquals(reversed(newest.stream().map(c -> c.get("id")).toList()),
                oldest.stream().map(c -> c.get("id")).toList()); // distinct dates in the fixture
        List<String> titles = data(run("sort", "title")).stream().map(c -> (String) c.get("title")).toList();
        List<String> desc = data(run("sort", "title_desc")).stream().map(c -> (String) c.get("title")).toList();
        assertEquals(reversed(titles), desc);

        SiteConfig site = CatalogTestData.bvSite();
        useRows(site, rated("a", 0.0), rated("b", 4.5), rated("c", 3.0), rated("d", 4.5));
        assertEquals(List.of("b", "d", "c", "a"), ids("sort", "rating"));
        assertNull(data(run("sort", "rating")).get(3).get("rating")); // 0 = unrated
    }

    static <T> List<T> reversed(List<T> list) {
        List<T> out = new ArrayList<>(list);
        Collections.reverse(out);
        return out;
    }

    static CatalogRow rated(String id, double rating) {
        return new CatalogRow(id, id + "-ps", "Course " + id, "default", null, null, null, 10, null, "INR",
                "inv-" + id, "AVAILABLE", null, null, null, null, null, null, null, List.of(), rating, null);
    }

    @Test
    void rejectsBadDiscoveryParameters() {
        assertInvalid("sort", "sort", "trending");
        assertInvalid("badge", "badge", "new,hot");
        assertInvalid("price", "price", "cheap");
        assertInvalid("price_min", "price_min", "-1");
        assertInvalid("price_max", "price_max", "abc");
        assertInvalid("custom", "custom", "parents");
        assertInvalid("custom", "custom", "for:");
    }

    // ── price filters ───────────────────────────────────────────────────────────

    @Test
    void priceFiltersMatchPerVersion() {
        Map<String, Object> free = run("price", "free");
        Map<String, Object> paid = run("price", "paid");
        for (Map<String, Object> c : data(free)) assertEquals(true, at(c.get("price"), "is_free"), (String) c.get("title"));
        for (Map<String, Object> c : data(paid)) assertTrue((double) at(c.get("price"), "amount") > 0);
        assertEquals(11, free.get("total")); // the fixture's free courses
        assertEquals(23, paid.get("total"));
        assertEquals(34, (int) free.get("total") + (int) paid.get("total"));
        for (Map<String, Object> c : data(run("price_min", "200", "price_max", "300"))) {
            double amount = at(c.get("price"), "amount");
            assertTrue(amount >= 200 && amount <= 300, String.valueOf(amount));
        }
        assertEquals(run("price", "free").get("total"), run("price_max", "0").get("total"));
        assertEquals(idSet("price", "paid"), idSet("price_min", "0.01"));
        // inclusive ends: the 251 eBook
        assertTrue(ids("price_min", "251", "price_max", "251").contains(EBOOK_EN));
    }

    @Test
    void comingSoonVersionsNeverMatchAPriceAndCarryTheirNotice() {
        CatalogRow soon = new CatalogRow("soon", "soon-ps", "Kashi Yatra", "default", null, null, null, 0, null, "INR",
                "inv-soon", "AVAILABLE", new CatalogRow.ComingSoon("2026-12-01", "aud-1", "Launching soon",
                "Notify me"), null, null, null, null, null, null, List.of(), 0.0, null);
        CatalogRow free = CatalogTestData.row("free", "free-ps").title("Free intro").price(0).build();
        useRows(CatalogTestData.bvSite(), soon, free);
        assertEquals(List.of("free"), ids("price", "free"));
        assertEquals(List.of(), ids("price", "paid"));
        assertEquals(List.of("free"), ids("price_max", "100"));
        Map<String, Object> card = data(run("availability", "coming_soon")).get(0);
        assertEquals(Map.of("launch_date", "2026-12-01", "button_text", "Notify me", "ribbon_text", "Launching soon",
                "notify_campaign_id", "aud-1"), card.get("coming_soon"));
        assertNull(data(run("price", "free")).get(0).get("coming_soon"));
    }

    @Test
    void withPricesHiddenPriceFiltersStillApplyButAmountsStayHidden() {
        String json = CatalogTestData.json("bv_catalogue_store.json").get("catalogue_json").asText()
                .replace("\"payment\": {\"enabled\": true", "\"payment\": {\"enabled\": false");
        useSite(SiteConfig.parse("store", json, CatalogTestData.MAPPER));
        Map<String, Object> paid = run("price", "paid", "price_min", "100");
        assertTrue((int) paid.get("total") > 0);
        for (Map<String, Object> c : data(paid)) {
            assertNull(c.get("price"));
            assertEquals(false, c.get("price_visible"));
        }
    }

    // ── badges ──────────────────────────────────────────────────────────────────

    @Test
    void badgesAreEarnedWithTheSiteRulesInItsPriorityOrder() {
        useSite(bvSiteWith("\"badges\": {\"enabled\": true, \"types\": [\"bestseller\", \"new\", \"free\"], \"max\": 2},"));
        when(loader.ranks(BV_INSTITUTE)).thenReturn(Map.of(EBOOK_HI, 1, RAGHUVEER, 3));
        Map<String, Map<String, Object>> byId = data(run()).stream()
                .collect(Collectors.toMap(c -> (String) c.get("id"), c -> c));
        // rank 1 paid (bestseller), 24 days old (new), best of the dharma stream (popular, after the site's types)
        assertEquals(List.of("bestseller", "new", "popular"), byId.get(EBOOK_EN).get("badges"));
        // free + ranked best in shastra; created 2026-09-28
        assertEquals(List.of("new", "free", "popular"), byId.get(RAGHUVEER).get("badges"));
        // 2026-09-16: 30 days old → new; paid, unranked
        assertEquals(List.of("new"), byId.get(MITRAMELA).get("badges"));
        Map<String, Object> site = at(service.site(BV_INSTITUTE), "catalog");
        assertEquals(Map.of("enabled", true, "types", List.of("bestseller", "new", "free"), "new_days", 60,
                "bestseller_top", 3, "max", 2), site.get("badges"));

        // A shorter window drops it.
        useSite(bvSiteWith("\"badges\": {\"enabled\": true, \"newDays\": 20},"));
        assertEquals(List.of(), data(run()).stream().filter(c -> MITRAMELA.equals(c.get("id"))).findFirst()
                .orElseThrow().get("badges"));

    }

    @Test
    void theBadgeFilterOrsItsValuesAndWorksWithBadgesOff() {
        when(loader.ranks(BV_INSTITUTE)).thenReturn(Map.of(EBOOK_HI, 1));
        // BV shows no badge pills, but a course still earns them (the site's earnedBadges).
        for (Map<String, Object> c : data(run("badge", "free"))) {
            assertTrue(((List<?>) c.get("badges")).contains("free"));
            assertEquals(true, at(c.get("price"), "is_free"));
        }
        assertEquals(run("price", "free").get("total"), run("badge", "free").get("total"));
        assertEquals(List.of(EBOOK_EN), ids("badge", "bestseller"));
        Set<String> union = new HashSet<>(ids("badge", "bestseller"));
        union.addAll(ids("badge", "free"));
        assertEquals(union, idSet("badge", "free,bestseller"));
        assertEquals(List.of(), ids("badge", "popular", "stream", "kala")); // nobody ranked in kala
    }

    // ── comma lists, level, instructor, session ─────────────────────────────────

    @Test
    void commaListsAreOrInsideAParameterAndAndAcrossParameters() {
        Set<String> dharma = idSet("stream", "dharma");
        Set<String> shastra = idSet("stream", "shastra");
        Set<String> union = new HashSet<>(dharma);
        union.addAll(shastra);
        assertEquals(union, idSet("stream", "dharma,shastra"));
        assertEquals(dharma, idSet("stream", "dharma,no-such-stream"));
        assertEquals(Set.of(), idSet("stream", "no-such,nor-this"));

        Set<String> formats = idSet("format", "ebook");
        formats.addAll(idSet("format", "live"));
        assertEquals(formats, idSet("format", "ebook,LIVE"));

        Set<String> both = new HashSet<>(dharma);
        both.retainAll(idSet("format", "ebook"));
        assertEquals(both, idSet("stream", "dharma", "format", "ebook"));

        Set<String> languages = idSet("language", "en");
        languages.addAll(idSet("language", "hi"));
        assertEquals(languages, idSet("language", "en,hi"));
        assertEquals(idSet("category", "vedic-parenting"), idSet("category", "vedic-parenting,zzz"));
    }

    @Test
    @SuppressWarnings("unchecked")
    void levelInstructorAndSessionFilters() {
        List<CatalogRow> rows = CatalogTestData.bvRows();
        List<Map<String, Object>> ebooks = data(run("level", "EBOOK"));
        assertFalse(ebooks.isEmpty());
        for (Map<String, Object> c : ebooks) {
            assertTrue(((List<Map<String, Object>>) c.get("variants")).stream()
                    .anyMatch(v -> "eBook".equals(v.get("level"))));
        }
        assertEquals(idSet("level", "eBook"), idSet("level", " ebook ,no-such-level"));

        // First instructor's name, case-insensitive (the site's Instructor filter).
        Set<String> byAbhishek = rows.stream().filter(r -> "Abhishek".equals(r.firstInstructorName()))
                .map(CatalogRow::packageId).collect(Collectors.toSet());
        Set<String> found = idSet("instructor", "abhishek");
        assertFalse(found.isEmpty());
        for (String id : found) {
            boolean folded = id.equals(EBOOK_EN); // EN+HI eBook: both by Abhishek
            assertTrue(byAbhishek.contains(id) || folded, id);
        }
        Set<String> two = idSet("instructor", "Abhishek");
        two.addAll(idSet("instructor", "Admin Brahmvarchas"));
        assertEquals(two, idSet("instructor", "ABHISHEK,admin brahmvarchas"));

        String session = "9a2080b7-5b32-471a-ae5d-e9b3c9531605"; // Scriptures | Texts
        List<Map<String, Object>> inSession = data(run("session", session));
        assertEquals(3, inSession.size());
        for (Map<String, Object> c : inSession) {
            Map<String, Object> v = ((List<Map<String, Object>>) c.get("variants")).get(0);
            assertEquals(session, v.get("session_id"));
            assertEquals("Scriptures | Texts", v.get("session_name"));
        }
    }

    @Test
    void versionFiltersMustHoldOnTheSameVersion() {
        // One course, two versions: a free Hindi one and a ₹500 English one.
        CatalogRow hindi = CatalogTestData.row("gita", "gita-hi").title("Gita").level("Hindi").price(0).build();
        CatalogRow english = CatalogTestData.row("gita", "gita-en").title("Gita").level("English").price(500).build();
        useRows(CatalogTestData.bvSite(), hindi, english);
        assertEquals(List.of(), ids("language", "hi", "price", "paid"));
        assertEquals(List.of("gita"), ids("language", "hi", "price", "free"));
        assertEquals(List.of("gita"), ids("language", "en", "price_min", "400"));
        assertEquals(List.of(), ids("level", "Hindi", "price_min", "1"));
        // The card prices over the versions that match.
        Map<String, Object> paid = data(run("price", "paid")).get(0);
        assertEquals(500.0, at(paid.get("price"), "amount"));
        Map<String, Object> any = data(run()).get(0);
        assertEquals(0.0, at(any.get("price"), "min_amount"));
        assertEquals(500.0, at(any.get("price"), "max_amount"));
        assertEquals(true, at(any.get("price"), "varies"));

        // Facets: each group counted against the OTHER active groups only.
        Map<String, Object> facets = at(run("language", "hi", "price", "paid", "facets", "true"), "facets");
        assertEquals(List.of(Map.of("code", "en", "label", "English", "count", 1)), facets.get("languages"));
        assertEquals((Object) 1, at(facets.get("price"), "free")); // given Hindi: the free Hindi version
        assertEquals((Object) 0, at(facets.get("price"), "paid"));
    }

    // ── authored filter groups ──────────────────────────────────────────────────

    static final String CUSTOM = "\"customFilters\": [{\"id\": \"for\", \"label\": \"For\", \"showEmpty\": false, "
            + "\"options\": [{\"id\": \"parents\", \"label\": \"Parents\", \"tags\": [\"for-parents\"]}, "
            + "{\"id\": \"students\", \"label\": \"Students\", \"tags\": [\"for-students\"]}, "
            + "{\"id\": \"teachers\", \"label\": \"Teachers\", \"tags\": [\"for-teachers\"]}]}, "
            + "{\"id\": \"format\", \"label\": \"Format\", \"source\": \"courseFormats\"}],";

    @Test
    void customFilterGroups() {
        useSite(bvSiteWith(CUSTOM));
        Set<String> parents = idSet("custom", "for:parents");
        assertEquals(idSet("tag", "for-parents"), parents);
        Set<String> either = new HashSet<>(parents);
        either.addAll(idSet("custom", "for:students"));
        assertEquals(either, idSet("custom", "for:parents,FOR:students"));
        Set<String> andFormat = new HashSet<>(either);
        andFormat.retainAll(idSet("format", "ebook"));
        assertEquals(andFormat, idSet("custom", "for:parents,for:students,format:ebook"));
        assertEquals(idSet("format", "ebook"), idSet("custom", "format:ebook"));
        assertEquals(Set.of(), idSet("custom", "for:nobody"));
        assertEquals(Set.of(), idSet("custom", "who:parents"));

        Map<String, Object> facets = at(run("custom", "for:parents", "facets", "true"), "facets");
        Map<String, Object> custom = at(facets, "custom");
        // "for" is counted without its own selection; showEmpty false drops teachers (0).
        assertEquals(Map.of("parents", parents.size(), "students", idSet("custom", "for:students").size()),
                custom.get("for"));
        Map<String, Integer> format = at(custom, "format"); // showEmpty defaults to true: zeros kept
        assertEquals(8, format.size());
        assertEquals(0, format.get("merch"));

        Map<String, Object> site = at(service.site(BV_INSTITUTE), "catalog");
        List<Map<String, Object>> groups = at(site, "custom_filters");
        assertEquals(List.of("for", "format"), groups.stream().map(g -> g.get("id")).toList());
        assertEquals("course_formats", groups.get(1).get("source"));
        assertEquals(Map.of("id", "ebook", "label", "E-books"), ((List<?>) groups.get(1).get("options")).get(1));
        assertEquals(false, groups.get(0).get("show_empty"));
    }

    // ── facets ──────────────────────────────────────────────────────────────────

    @Test
    void facetsAreOffByDefault() {
        assertFalse(run().containsKey("facets"));
        assertTrue(run("facets", "true").containsKey("facets"));
    }

    @Test
    @SuppressWarnings("unchecked")
    void eachFacetCountIsWhatSelectingThatOptionInsteadWouldReturn() {
        when(loader.ranks(BV_INSTITUTE)).thenReturn(Map.of(EBOOK_HI, 1, WELLNESS, 2));
        String[] filters = {"stream", "dharma", "format", "ebook", "language", "en,hi", "price", "paid"};
        Map<String, Object> page = run(append(filters, "facets", "true"));
        Map<String, Object> facets = at(page, "facets");

        Consumer<Object[]> check = spec -> {
            String facet = (String) spec[0], key = (String) spec[1], param = (String) spec[2];
            for (Map<String, Object> option : (List<Map<String, Object>>) facets.get(facet)) {
                String[] replaced = replace(filters, param, (String) option.get(key));
                assertEquals(run(replaced).get("total"), option.get("count"), facet + "=" + option.get(key));
            }
        };
        check.accept(new Object[]{"streams", "slug", "stream"});
        check.accept(new Object[]{"formats", "key", "format"});
        check.accept(new Object[]{"languages", "code", "language"});
        check.accept(new Object[]{"tags", "key", "tag"});
        check.accept(new Object[]{"instructors", "key", "instructor"});
        check.accept(new Object[]{"sessions", "id", "session"});
        check.accept(new Object[]{"badges", "key", "badge"});
        check.accept(new Object[]{"categories", "slug", "category"});
        Map<String, Object> price = at(facets, "price");
        assertEquals(run(replace(filters, "price", "free")).get("total"), price.get("free"));
        assertEquals(page.get("total"), price.get("paid")); // paid is the active choice
        // The stream facet lists streams other than the selected one, counted with the other filters.
        assertTrue(((List<Map<String, Object>>) facets.get("streams")).stream().anyMatch(s -> !"dharma".equals(s.get("slug"))));
        for (Map<String, Object> s : (List<Map<String, Object>>) facets.get("streams")) assertTrue((int) s.get("count") > 0);
    }

    @Test
    @SuppressWarnings("unchecked")
    void facetLabelsAndLevels() {
        Map<String, Object> facets = at(run("facets", "true"), "facets");
        List<Map<String, Object>> streams = at(facets, "streams");
        assertEquals(Map.of("slug", "dharma", "label", "Virtue | Civilisation", "count", run("stream", "dharma").get("total")),
                streams.stream().filter(s -> "dharma".equals(s.get("slug"))).findFirst().orElseThrow());
        List<Map<String, Object>> levels = at(facets, "levels");
        List<Object> levelKeys = levels.stream().map(l -> l.get("key")).toList();
        assertTrue(levelKeys.contains("eBook"));
        assertFalse(levelKeys.contains("default"), "the placeholder level is never an option");
        for (Map<String, Object> l : levels) {
            assertEquals(run("level", (String) l.get("key")).get("total"), l.get("count"), String.valueOf(l.get("key")));
        }
        List<Map<String, Object>> tags = at(facets, "tags");
        assertTrue(tags.stream().noneMatch(t -> ((String) t.get("key")).startsWith("level:")));
        // Nothing ranked: no bestseller / popular; every badge listed is earned by some course.
        List<Map<String, Object>> badges = at(facets, "badges");
        assertEquals(List.of("new", "free"), badges.stream().map(b -> b.get("key")).toList());
        assertEquals("New", badges.get(0).get("label"));
        Map<String, Object> price = at(facets, "price");
        assertEquals(List.of(), price.get("under")); // BV lists no "Under X" amounts
    }

    static String[] append(String[] a, String... more) {
        String[] out = Arrays.copyOf(a, a.length + more.length);
        System.arraycopy(more, 0, out, a.length, more.length);
        return out;
    }

    static String[] replace(String[] kv, String param, String value) {
        List<String> out = new ArrayList<>();
        boolean done = false;
        for (int i = 0; i < kv.length; i += 2) {
            if (kv[i].equals(param)) {
                out.add(param);
                out.add(value);
                done = true;
            } else {
                out.add(kv[i]);
                out.add(kv[i + 1]);
            }
        }
        if (!done) {
            out.add(param);
            out.add(value);
        }
        return out.toArray(String[]::new);
    }

    // ── search ──────────────────────────────────────────────────────────────────

    @Test
    void searchCoversDescriptionsAndInstructorsButNeverLevelKeys() {
        // "Ayurveda's gift to Humankind" is only in the description.
        assertTrue(ids("q", "ayurveda").contains(WELLNESS));
        assertTrue(ids("q", "HUMANKIND").contains(WELLNESS));
        Set<String> neha = idSet("q", "neha biyani");
        assertFalse(neha.isEmpty());
        assertEquals(idSet("instructor", "Neha Biyani"), neha);
        assertEquals(List.of(), ids("q", "level:"));
    }

    // ── course fields ───────────────────────────────────────────────────────────

    @Test
    @SuppressWarnings("unchecked")
    void newCourseFields() {
        Map<String, Map<String, Object>> byId = data(run()).stream()
                .collect(Collectors.toMap(c -> (String) c.get("id"), c -> c));
        Map<String, Object> health = byId.get("1750f895-5219-4b51-903e-93d271694653");
        assertEquals(Map.of("preview_url", "https://cdn.example.com/fa86d935-9a50-4dd5-8d3a-80eec875ad36.png",
                        "banner_url", "https://cdn.example.com/1f1deb79-f74e-42b6-bcb8-0dfd1032f456.png"),
                withoutNulls(at(health, "images")));
        assertNull(at(health.get("images"), "thumbnail_url")); // "" in the search row
        assertEquals(at(health.get("images"), "preview_url"), health.get("image_url"));
        assertNull(health.get("duration_minutes")); // read time 0 = not set
        assertEquals(7L, byId.get(MARTAND).get("duration_minutes"));
        assertNull(health.get("coming_soon"));
        assertTrue(health.containsKey("available_slots"));
        assertTrue(health.containsKey("max_seats"));
        assertTrue(health.containsKey("package_type"));

        Map<String, Object> ebook = byId.get(EBOOK_EN);
        List<Map<String, Object>> variants = at(ebook, "variants");
        assertEquals("Vedic Parenting - eBook", variants.get(0).get("title"));
        assertEquals("वैदिक पेरेंटिंग - ई पुस्तक", variants.get(1).get("title"));
        assertEquals("5416ef11-e765-4052-95f0-dff187076250", variants.get(0).get("session_id"));
        assertEquals("Virtue | Civilisation", variants.get(0).get("session_name"));
        assertEquals("हिं", at(variants.get(1).get("language"), "chip"));
        assertEquals(251.0, at(ebook.get("price"), "min_amount"));
        assertEquals(251.0, at(ebook.get("price"), "max_amount"));
        assertEquals(List.of("new"), ebook.get("badges")); // 2026-09-22; nothing ranked in this setup
        assertNull(ebook.get("popularity_rank"));

        Map<String, Object> detail = service.course(BV_INSTITUTE, EBOOK_EN, null);
        assertEquals(ebook.get("images"), detail.get("images"));
        assertTrue(detail.containsKey("badges"));
    }

    private static Map<String, Object> withoutNulls(Map<String, Object> m) {
        Map<String, Object> out = new LinkedHashMap<>();
        m.forEach((k, v) -> {
            if (v != null) out.put(k, v);
        });
        return out;
    }

    @Test
    void catalogRowReadsTheNewSearchFields() {
        JsonNode n = CatalogTestData.MAPPER.valueToTree(Map.ofEntries(Map.entry("id", "p1"),
                Map.entry("package_session_id", "ps1"), Map.entry("package_name", "Gita"),
                Map.entry("session_name", " Scriptures "), Map.entry("package_type", "COURSE"),
                Map.entry("course_banner_media_id", "banner-1"), Map.entry("thumbnail_file_id", "null"),
                Map.entry("read_time_in_minutes", 45), Map.entry("available_slots", 12), Map.entry("max_seats", 40),
                Map.entry("coming_soon", Map.of("enabled", true, "launch_date", "2026-12-01",
                        "button_text", " Notify me ", "ribbon_text", ""))));
        CatalogRow r = CatalogRow.from(CatalogTestData.MAPPER.convertValue(n, PackageDetailV2DTO.class));
        assertEquals("Scriptures", r.sessionName());
        assertEquals("COURSE", r.packageType());
        assertNull(r.previewImageId());
        assertEquals("banner-1", r.bannerImageId());
        assertNull(r.thumbnailId()); // "null" text is no id
        assertEquals("banner-1", r.imageMediaId());
        assertEquals(45L, r.readTimeMinutes());
        assertEquals(Integer.valueOf(12), r.availableSlots());
        assertEquals(Integer.valueOf(40), r.maxSeats());
        assertEquals("Notify me", r.comingSoon().buttonText());
        assertNull(r.comingSoon().ribbonText());
        assertEquals("2026-12-01", r.comingSoon().launchDate());
    }

    // ── /site catalog and /streams ──────────────────────────────────────────────

    @Test
    @SuppressWarnings("unchecked")
    void siteCatalogMirrorsTheCoursesSection() {
        Map<String, Object> bv = at(service.site(BV_INSTITUTE), "catalog");
        assertEquals("newest", bv.get("default_sort"));
        assertEquals(List.of("newest", "oldest", "price_asc", "price_desc", "rating", "title", "title_desc", "popular"),
                bv.get("sort_options"));
        assertEquals(Map.of("enabled", true, "label", "Language"), bv.get("language_filter"));
        Map<String, Object> category = at(bv, "category_filter");
        assertEquals(true, category.get("enabled"));
        assertEquals("all", category.get("scope"));
        assertEquals("both", category.get("label_mode"));
        assertEquals(6, category.get("visible_count"));
        assertEquals(false, at(bv.get("badges"), "enabled"));
        assertEquals(List.of(), bv.get("quick_filters"));
        assertEquals(List.of(), bv.get("popular_searches"));

        useSite(bvSiteWith("\"defaultSort\": \"Popular\", \"quickFilters\": [{\"kind\": \"popular\"}, "
                + "{\"kind\": \"language\", \"value\": \"hi\", \"label\": \"हिंदी\"}, {\"kind\": \"priceMax\", \"value\": 250}, "
                + "{\"kind\": \"new\"}], \"priceFilter\": {\"enabled\": true, \"maxOptions\": [500, 250]}, "
                + "\"hero\": {\"enabled\": true, \"popular\": [{\"label\": \"Vedic Parenting\", \"searchValue\": \"vedic parenting\"}, "
                + "{\"label\": \"Ayurveda\", \"streamSlug\": \"swasthya\"}, {\"label\": \"Free\", \"quickFilterId\": \"free-1\"}]},"));
        Map<String, Object> c = at(service.site(BV_INSTITUTE), "catalog");
        assertEquals("popular", c.get("default_sort"));
        List<Map<String, Object>> quick = at(c, "quick_filters");
        assertEquals(Map.of("sort", "popular"), quick.get(0).get("params"));
        assertEquals("Popular", quick.get(0).get("label"));
        assertEquals("हिंदी", quick.get(1).get("label"));
        assertEquals(Map.of("language", "hi"), quick.get(1).get("params"));
        assertEquals("price_max", quick.get(2).get("kind"));
        assertEquals("Under 250", quick.get(2).get("label"));
        assertEquals(Map.of("price_max", 250.0), quick.get(2).get("params"));
        assertEquals(Map.of("badge", "new"), quick.get(3).get("params"));
        assertEquals(List.of(250.0, 500.0), at(c.get("price_filter"), "max_options"));
        List<Map<String, Object>> popular = at(c, "popular_searches");
        assertEquals("search", popular.get(0).get("kind"));
        assertEquals("vedic parenting", popular.get(0).get("search"));
        assertEquals("swasthya", popular.get(1).get("stream"));
        assertEquals("quick_filter", popular.get(2).get("kind"));
        assertEquals("free-1", popular.get(2).get("quick_filter"));
        // the "under" price facet follows the section's amounts
        Map<String, Object> price = at(at(run("facets", "true"), "facets"), "price");
        List<Map<String, Object>> under = at(price, "under");
        assertEquals(List.of(250.0, 500.0), under.stream().map(u -> u.get("max")).toList());
        assertEquals(run("price_max", "250").get("total"), under.get(0).get("count"));
    }

    @Test
    @SuppressWarnings("unchecked")
    void streamsCarryTheirTagAndNotifyCampaign() {
        List<Map<String, Object>> streams = at(service.streams(BV_INSTITUTE), "streams");
        Map<String, Object> dharma = streams.get(4);
        assertEquals("dharma", dharma.get("tag"));
        assertTrue(dharma.containsKey("notify_campaign_id"));
        Map<String, Object> parenting = ((List<Map<String, Object>>) dharma.get("categories")).stream()
                .filter(c -> "vedic-parenting".equals(c.get("slug"))).findFirst().orElseThrow();
        assertEquals("#82b74b", parenting.get("accent_color"));
        assertTrue(parenting.containsKey("notify_campaign_id"));
    }
}
