package vacademy.io.admin_core_service.features.catalog_api.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import vacademy.io.admin_core_service.features.catalog_api.CatalogApiException;
import vacademy.io.admin_core_service.features.catalog_api.CatalogTestData;
import vacademy.io.admin_core_service.features.catalog_api.rules.CatalogRow;
import vacademy.io.admin_core_service.features.catalog_api.rules.CatalogStreams;
import vacademy.io.admin_core_service.features.catalog_api.rules.SiteConfig;
import vacademy.io.admin_core_service.features.catalog_api.settings.CatalogSiteResolver;
import vacademy.io.admin_core_service.features.learner_study_library.service.LearnerOpenStudyLibraryService;
import vacademy.io.admin_core_service.features.packages.service.PackagePageContentService;
import vacademy.io.common.auth.dto.UserDTO;

import java.util.*;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static vacademy.io.admin_core_service.features.catalog_api.CatalogTestData.BV_INSTITUTE;
import static vacademy.io.admin_core_service.features.catalog_api.CatalogTestData.BV_LIBRARY;

/**
 * The read views over Brahm Varchas' real catalogue (fixtures read from prod's public endpoints
 * on 2026-10-15): 35 search rows, the "store" site, the Knowledge Streams library and the
 * "A woman's life stages" learning path.
 */
class CatalogApiServiceTest {

    static final String BASE = "https://learning.brahmvarchas.org/store";
    static final String EBOOK_EN = "7c12a9ec-22c3-4c55-ada1-2a93e107816f";
    static final String EBOOK_HI = "c150dfcf-96e0-4712-b709-b0528e1f4a09";
    static final String PAGE_JSON = "{\"v\":1,\"mode\":\"SELF_PACED\",\"faqs\":[{\"q\":\"Who is it for?\","
            + "\"a\":\"<p>Parents</p><script>alert(1)</script>\"}]}";

    CatalogDataLoader loader;
    CatalogApiService service;

    static CatalogSnapshot snapshot(SiteConfig site) {
        List<CatalogRow> rows = CatalogTestData.bvRows();
        Map<String, String> media = new HashMap<>();
        for (CatalogRow r : rows) {
            for (String id : new String[]{r.imageMediaId(), r.bannerImageId(), r.thumbnailId()}) {
                if (id != null) media.put(id, "https://cdn.example.com/" + id + ".png");
            }
        }
        media.put("logo-1", "https://cdn.example.com/logo.png");
        List<CatalogStreams.FolderNode> roots = CatalogTestData.bvTree();
        return new CatalogSnapshot(BV_INSTITUTE, "Brahm Varchas Shiksha", "logo-1", null,
                new CatalogSiteResolver.Resolution("store", "domain_routing", BASE, "domain_routing"),
                site, rows, "folder_library", CatalogStreams.streamsFromFolderTree(roots), roots, media);
    }

    @BeforeEach
    void setUp() {
        loader = mock(CatalogDataLoader.class);
        when(loader.snapshot(BV_INSTITUTE)).thenReturn(snapshot(CatalogTestData.bvSite()));
        when(loader.folderTree(BV_INSTITUTE, BV_LIBRARY)).thenReturn(Optional.of(CatalogTestData.bvTree()));
        when(loader.productPage(eq(BV_INSTITUTE), anyString())).thenReturn(Optional.empty());
        when(loader.productPage(BV_INSTITUTE, "forbvy")).thenReturn(Optional.of(CatalogTestData.bvProductPage()));
        UserDTO author = UserDTO.builder().id("u1").fullName("Jigyasa Acharya").email("never@shown.example")
                .authorSubtitle("Founder").authorDescription("<p>Guru Maa</p>").profilePicFileId("pic-1").build();
        var courseInit = CatalogTestData.bvCourseInit(PAGE_JSON, List.of(author)); // stubs a mock: build first
        when(loader.courseInit(eq(BV_INSTITUTE), anyString())).thenReturn(Optional.empty());
        when(loader.courseInit(BV_INSTITUTE, EBOOK_EN)).thenReturn(Optional.of(courseInit));
        when(loader.resolveMedia(any())).thenAnswer(inv -> {
            Map<String, String> out = new HashMap<>();
            for (Object id : (Collection<?>) inv.getArgument(0)) out.put((String) id, "https://cdn.example.com/" + id);
            return out;
        });
        service = new CatalogApiService(loader, mock(LearnerOpenStudyLibraryService.class),
                mock(PackagePageContentService.class));
    }

    private static CatalogApiService.CourseQuery query() {
        return new CatalogApiService.CourseQuery(null, null, null, null, null, null, null, 1, 100, null);
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> data(Map<String, Object> page) {
        return (List<Map<String, Object>>) page.get("data");
    }

    @SuppressWarnings("unchecked")
    private static <T> T at(Map<String, Object> m, String key) {
        return (T) m.get(key);
    }

    @Test
    void site() {
        Map<String, Object> site = service.site(BV_INSTITUTE);
        Map<String, Object> institute = at(site, "institute");
        assertEquals("Brahm Varchas Shiksha", institute.get("name"));
        assertEquals("https://cdn.example.com/logo.png", institute.get("logo_url"));
        assertEquals(BASE, site.get("course_base_url"));
        assertEquals(List.of(Map.of("code", "en", "label", "English", "chip", "EN"), Map.of("code", "hi", "label", "Hindi", "chip", "हिं")),
                site.get("languages"));
        assertEquals(8, ((List<?>) site.get("formats")).size());
        assertEquals("INR", site.get("currency"));
        assertEquals(true, site.get("price_visible"));
    }

    @Test
    void listsOneSummaryPerCourseNewestFirstAndPages() {
        Map<String, Object> page = service.courses(BV_INSTITUTE,
                new CatalogApiService.CourseQuery(null, null, null, null, null, null, null, 1, 24, null));
        assertEquals(34, page.get("total")); // 35 rows, the eBook's two language packages are one course
        assertEquals(24, data(page).size());
        assertEquals(true, page.get("has_more"));
        assertEquals("2026-10-14T20:47:05.450Z", data(page).get(0).get("created_at"));
        Map<String, Object> last = service.courses(BV_INSTITUTE,
                new CatalogApiService.CourseQuery(null, null, null, null, null, null, null, 2, 24, null));
        assertEquals(10, data(last).size());
        assertEquals(false, last.get("has_more"));
    }

    @Test
    void theVedicParentingEbookSummary() {
        // Word search: every course with "vedic" and "parenting" ("ebook" is filler); relevance puts the
        // course whose title holds the whole query first.
        Map<String, Object> page = service.courses(BV_INSTITUTE, new CatalogApiService.CourseQuery(
                "vedic parenting - ebook", null, null, null, null, null, null, 1, 24, "relevance"));
        assertEquals(7, page.get("total"));
        Map<String, Object> c = data(page).get(0);
        assertEquals(EBOOK_EN, c.get("id"));
        assertEquals("Vedic Parenting - eBook", c.get("title"));
        assertEquals(BASE + "/" + EBOOK_EN + "?enrollInviteId=5a975e3c-429f-4bfe-9143-43ffcf807748"
                + "&packageSessionId=92e89046-5865-4cf7-bea6-ac1e8b7bd328&level=default", c.get("url"));
        assertEquals("https://cdn.example.com/32aa2224-c7b1-46cf-b7ae-ebf1a37c5e34.png", c.get("image_url"));
        assertEquals(List.of(Map.of("key", "ebook", "label", "E-books")), c.get("formats"));
        assertEquals(Map.of("slug", "dharma", "label", "Virtue | Civilisation"), c.get("stream"));
        assertEquals(Map.of("slug", "vedic-parenting", "label", "Holistic Parenting"), c.get("category"));
        assertEquals(List.of(Map.of("code", "en", "label", "English", "chip", "EN"), Map.of("code", "hi", "label", "Hindi", "chip", "हिं")),
                c.get("languages"));
        assertEquals("available", c.get("availability"));
        assertEquals(true, c.get("price_visible"));
        Map<String, Object> price = at(c, "price");
        assertEquals(251.0, price.get("amount"));
        assertNull(price.get("compare_at_amount")); // elevated == actual
        assertEquals("INR", price.get("currency"));
        assertEquals(false, price.get("is_free"));
        assertEquals(false, price.get("varies"));
        assertNull(c.get("level")); // the platform's "default" level
        assertEquals("2026-09-22T09:05:02.499Z", c.get("created_at"));
        List<Map<String, Object>> variants = at(c, "variants");
        assertEquals(2, variants.size());
        assertEquals(Map.of("code", "hi", "label", "Hindi", "chip", "हिं"), variants.get(1).get("language"));
        assertTrue(((String) variants.get(1).get("url")).startsWith(BASE + "/" + EBOOK_HI + "?"));
        assertNotNull(c.get("subtitle"));
        assertTrue(((String) c.get("subtitle")).length() <= 300);
    }

    @Test
    void languageMakesThatVersionThePrimaryAndDropsCoursesWithoutIt() {
        Map<String, Object> hi = service.courses(BV_INSTITUTE, new CatalogApiService.CourseQuery(
                "vedic parenting - ebook", null, null, null, "hi", null, null, 1, 24, null));
        Map<String, Object> c = data(hi).get(0);
        assertEquals(EBOOK_EN, c.get("id")); // the course id stays stable
        assertEquals("वैदिक पेरेंटिंग - ई पुस्तक", c.get("title"));
        assertTrue(((String) c.get("url")).contains(EBOOK_HI));
        Map<String, Object> all = service.courses(BV_INSTITUTE, new CatalogApiService.CourseQuery(
                null, null, null, null, "hi", null, null, 1, 100, null));
        for (Map<String, Object> course : data(all)) {
            assertTrue(((List<?>) course.get("languages")).contains(Map.of("code", "hi", "label", "Hindi", "chip", "हिं")));
        }
        assertEquals(0, service.courses(BV_INSTITUTE, new CatalogApiService.CourseQuery(
                null, null, null, null, "fr", null, null, 1, 24, null)).get("total"));
    }

    @Test
    void filtersByStreamCategoryFormatTagAndAvailability() {
        List<Map<String, Object>> dharma = data(service.courses(BV_INSTITUTE, new CatalogApiService.CourseQuery(
                null, "dharma", null, null, null, null, null, 1, 100, null)));
        assertFalse(dharma.isEmpty());
        // a course tagged into two streams lists its first (folder order) stream, but every hit carries a
        // dharma tag or is levelled "Vedic Parenting" (level keys, 2026-10-16)
        for (Map<String, Object> c : dharma) {
            assertTrue(((List<?>) c.get("tags")).stream().map(t -> ((String) t).toLowerCase())
                    .anyMatch(t -> t.equals("dharma") || t.equals("vedic-parenting"))
                    || "Vedic Parenting".equals(c.get("level")), String.valueOf(c.get("title")));
        }
        assertTrue(dharma.stream().anyMatch(c -> "Vedic Parenting".equals(c.get("level"))
                && ((List<?>) c.get("tags")).stream().noneMatch(t -> "vedic-parenting".equalsIgnoreCase((String) t))),
                "a course only levelled Vedic Parenting is in Dharma");
        List<Map<String, Object>> ebooks = data(service.courses(BV_INSTITUTE, new CatalogApiService.CourseQuery(
                null, null, null, "ebook", null, null, null, 1, 100, null)));
        assertFalse(ebooks.isEmpty());
        for (Map<String, Object> c : ebooks) assertTrue(((List<?>) c.get("formats")).contains(Map.of("key", "ebook", "label", "E-books")));
        List<Map<String, Object>> parenting = data(service.courses(BV_INSTITUTE, new CatalogApiService.CourseQuery(
                null, "dharma", "vedic-parenting", null, null, null, null, 1, 100, null)));
        assertFalse(parenting.isEmpty());
        assertTrue(parenting.size() <= dharma.size());
        for (Map<String, Object> c : parenting) {
            assertTrue(((List<?>) c.get("tags")).stream().anyMatch(t -> "vedic-parenting".equalsIgnoreCase((String) t))
                    || "Vedic Parenting".equals(c.get("level")));
        }
        assertEquals(0, service.courses(BV_INSTITUTE, new CatalogApiService.CourseQuery(
                null, "no-such-stream", null, null, null, null, null, 1, 24, null)).get("total"));
        assertEquals(34, service.courses(BV_INSTITUTE, new CatalogApiService.CourseQuery(
                null, null, null, null, null, null, "available", 1, 24, null)).get("total"));
        assertFalse(data(service.courses(BV_INSTITUTE, new CatalogApiService.CourseQuery(
                null, null, null, null, null, "for-parents", null, 1, 24, null))).isEmpty());
    }

    @Test
    void sortsByPrice() {
        List<Map<String, Object>> asc = data(service.courses(BV_INSTITUTE, new CatalogApiService.CourseQuery(
                null, null, null, null, null, null, null, 1, 100, "price_asc")));
        double prev = -1;
        for (Map<String, Object> c : asc) {
            double amount = (double) ((Map<?, ?>) c.get("price")).get("amount");
            assertTrue(amount >= prev, "price_asc out of order");
            prev = amount;
        }
        List<Map<String, Object>> title = data(service.courses(BV_INSTITUTE, new CatalogApiService.CourseQuery(
                null, null, null, null, null, null, null, 1, 100, "title")));
        assertEquals(34, title.size());
    }

    @Test
    void aHugePageIsEmptyNotAnError() {
        Map<String, Object> page = service.courses(BV_INSTITUTE,
                new CatalogApiService.CourseQuery(null, null, null, null, null, null, null, 30_000_000, 100, null));
        assertTrue(data(page).isEmpty());
        assertEquals(34, page.get("total"));
    }

    @Test
    void rejectsBadParameters() {
        for (CatalogApiService.CourseQuery bad : List.of(
                new CatalogApiService.CourseQuery(null, null, null, null, null, null, null, 1, 24, "trending"),
                new CatalogApiService.CourseQuery(null, null, null, null, null, null, null, 0, 24, null),
                new CatalogApiService.CourseQuery(null, null, null, null, null, null, null, 1, 101, null),
                new CatalogApiService.CourseQuery(null, null, null, null, null, null, "soon", 1, 24, null))) {
            CatalogApiException e = assertThrows(CatalogApiException.class, () -> service.courses(BV_INSTITUTE, bad));
            assertEquals(HttpStatus.BAD_REQUEST, e.getStatus());
            assertEquals("invalid_request", e.getCode());
        }
    }

    @Test
    void paymentOffHidesPaidPricesButNotFree() {
        String json = CatalogTestData.json("bv_catalogue_store.json").get("catalogue_json").asText()
                .replace("\"payment\": {\"enabled\": true", "\"payment\": {\"enabled\": false");
        SiteConfig off = SiteConfig.parse("store", json, CatalogTestData.MAPPER);
        assertFalse(off.paymentEnabled());
        when(loader.snapshot(BV_INSTITUTE)).thenReturn(snapshot(off));
        for (Map<String, Object> c : data(service.courses(BV_INSTITUTE, query()))) {
            Map<?, ?> price = (Map<?, ?>) c.get("price");
            if (price == null) {
                assertEquals(false, c.get("price_visible"));
            } else {
                assertEquals(true, price.get("is_free"));
            }
        }
        assertEquals(false, service.site(BV_INSTITUTE).get("price_visible"));
    }

    @Test
    void courseDetail() {
        Map<String, Object> c = service.course(BV_INSTITUTE, EBOOK_EN, null);
        assertEquals(EBOOK_EN, c.get("id"));
        assertEquals("self_paced", c.get("mode"));
        List<Map<String, Object>> faqs = at(c, "faqs");
        assertEquals("Who is it for?", faqs.get(0).get("question"));
        assertFalse(((String) faqs.get(0).get("answer_html")).contains("script"));
        assertNotNull(c.get("about_html"));
        assertTrue(((String) c.get("about_text")).startsWith("Vedic Parenting is a comprehensive science"));
        assertNull(c.get("why_learn_html")); // "<p></p>" is no content
        assertNull(c.get("preview_video")); // the course media is an image
        List<Map<String, Object>> authors = at(c, "authors");
        assertEquals(1, authors.size());
        assertEquals("Jigyasa Acharya", authors.get(0).get("name"));
        assertEquals("Founder", authors.get(0).get("subtitle"));
        assertEquals("https://cdn.example.com/pic-1", authors.get(0).get("image_url"));
        assertFalse(authors.get(0).toString().contains("never@shown.example"));

        Map<String, Object> seo = at(c, "seo");
        assertEquals("Vedic Parenting - eBook", seo.get("title"));
        assertTrue(((String) seo.get("description")).length() <= 160);
        // Canonical = the bare page address; the enrolment query stays on "url".
        assertEquals(BASE + "/7c12a9ec-22c3-4c55-ada1-2a93e107816f", seo.get("canonical_url"));
        assertTrue(((String) c.get("url")).startsWith(seo.get("canonical_url") + "?"));

        Map<String, Object> ld = at(c, "structured_data");
        assertEquals("https://schema.org", ld.get("@context"));
        assertEquals("Course", ld.get("@type"));
        assertEquals("en", ld.get("inLanguage"));
        assertEquals("Brahm Varchas Shiksha", ((Map<?, ?>) ld.get("provider")).get("name"));
        assertEquals("https://learning.brahmvarchas.org/", ((Map<?, ?>) ld.get("provider")).get("sameAs"));
        Map<?, ?> offer = (Map<?, ?>) ((List<?>) ld.get("offers")).get(0);
        assertEquals(251.0, offer.get("price"));
        assertEquals("INR", offer.get("priceCurrency"));
        assertEquals("Paid", offer.get("category"));
        assertEquals("https://schema.org/InStock", offer.get("availability"));

        Map<String, Object> series = at(c, "series");
        assertEquals("A woman's life stages", series.get("name"));
        List<Map<String, Object>> steps = at(series, "steps");
        assertEquals(3, steps.size());
        assertEquals(List.of(false, false, true), steps.stream().map(s -> s.get("current")).toList());
        assertTrue(((String) steps.get(0).get("url")).startsWith(BASE + "/8610911c-382c-41a9-9e33-2e4e0882282f?"));
    }

    @Test
    void courseDetailByTheOtherLanguagesPackageShowsThatVersion() {
        Map<String, Object> c = service.course(BV_INSTITUTE, EBOOK_HI, null);
        assertEquals(EBOOK_EN, c.get("id"));
        assertEquals("वैदिक पेरेंटिंग - ई पुस्तक", c.get("title"));
        assertEquals("Vedic Parenting - eBook", service.course(BV_INSTITUTE, EBOOK_HI, "en").get("title"));
    }

    @Test
    void anUnknownCourseIsNotFound() {
        CatalogApiException e = assertThrows(CatalogApiException.class,
                () -> service.course(BV_INSTITUTE, "8610911c-382c-41a9-9e33-2e4e0882282f", null));
        assertEquals(HttpStatus.NOT_FOUND, e.getStatus());
        assertEquals("not_found", e.getCode());
    }

    @Test
    void streams() {
        Map<String, Object> out = service.streams(BV_INSTITUTE);
        assertEquals("folder_library", out.get("source"));
        List<Map<String, Object>> streams = at(out, "streams");
        assertEquals(List.of("shastra", "bharat", "shiksha", "swasthya", "dharma", "kala"),
                streams.stream().map(s -> s.get("slug")).toList());
        Map<String, Object> dharma = streams.get(4);
        assertEquals("धर्म | संस्कृति", dharma.get("label"));
        assertEquals("Virtue | Civilisation", dharma.get("subtitle"));
        assertEquals("#82b74b", dharma.get("accent_color"));
        assertTrue((int) dharma.get("course_count") >= 1);
        assertTrue(((String) dharma.get("image_url")).startsWith("https://d1om4dxj9e7kkd.cloudfront.net/"));
        List<Map<String, Object>> shikshaCats = at(streams.get(2), "categories");
        assertEquals(true, shikshaCats.stream().filter(c -> "khagol".equals(c.get("slug"))).findFirst().orElseThrow()
                .get("coming_soon"));
    }

    @Test
    void learningPaths() {
        List<Map<String, Object>> all = data(service.learningPaths(BV_INSTITUTE, null));
        assertEquals(List.of("u5rgwb", "92ogt2", "ks61g1", "forbvy"), all.stream().map(p -> p.get("code")).toList());
        Map<String, Object> forbvy = all.get(3);
        assertEquals("A woman's life stages", forbvy.get("name"));
        assertEquals("swasthya", forbvy.get("stream_slug"));
        assertEquals(3, forbvy.get("step_count"));
        assertEquals(0, all.get(0).get("step_count")); // its product page is unreadable here
        assertEquals(List.of("forbvy"), data(service.learningPaths(BV_INSTITUTE, "swasthya")).stream()
                .map(p -> p.get("code")).toList());

        Map<String, Object> path = service.learningPath(BV_INSTITUTE, "forbvy");
        List<Map<String, Object>> steps = at(path, "steps");
        assertEquals(List.of(1, 2, 3), steps.stream().map(s -> s.get("position")).toList());
        Map<String, Object> notInCatalogue = at(steps.get(0), "course");
        assertEquals("Rajaswala Paricharya", notInCatalogue.get("title"));
        assertEquals(1001.0, ((Map<?, ?>) notInCatalogue.get("price")).get("amount"));
        assertEquals(List.of(Map.of("key", "elearning", "label", "Interactive, self-paced E-learning"),
                Map.of("key", "live", "label", "Live sessions")), notInCatalogue.get("formats"));
        Map<String, Object> inCatalogue = at(steps.get(2), "course");
        assertEquals(EBOOK_EN, inCatalogue.get("id"));
        assertEquals(2, ((List<?>) inCatalogue.get("variants")).size());

        assertEquals("not_found", assertThrows(CatalogApiException.class,
                () -> service.learningPath(BV_INSTITUTE, "zzzzzz")).getCode());
    }

    @Test
    void sitemapListsEveryCourseOnTheHostedSite() {
        List<Map<String, Object>> entries = data(service.sitemap(BV_INSTITUTE));
        assertEquals(34, entries.size());
        for (Map<String, Object> e : entries) {
            assertTrue(((String) e.get("url")).startsWith(BASE + "/"));
            assertFalse(((String) e.get("url")).contains("?"), "sitemap lists canonical addresses");
            assertEquals("course", e.get("type"));
        }
    }

    @Test
    void withoutABaseUrlCourseUrlsAreNull() {
        CatalogSnapshot s = snapshot(CatalogTestData.bvSite());
        CatalogSnapshot noBase = new CatalogSnapshot(s.instituteId(), s.instituteName(), null, null,
                new CatalogSiteResolver.Resolution("store", null, null, null), s.site(), s.rows(), s.streamsSource(),
                s.streams(), s.streamRoots(), s.media());
        when(loader.snapshot(BV_INSTITUTE)).thenReturn(noBase);
        assertNull(data(service.courses(BV_INSTITUTE, query())).get(0).get("url"));
        verify(loader, never()).courseInit(any(), any());
    }
}
