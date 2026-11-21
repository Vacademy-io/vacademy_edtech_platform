package vacademy.io.admin_core_service.features.catalog_api.rules;

import com.fasterxml.jackson.databind.JsonNode;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.catalog_api.CatalogTestData;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/** Cases from frontend-learner-dashboard-app/src/routes/$tagName/-utils/course-format.test.ts. */
class CourseFormatsTest {

    private static JsonNode gs(String json) {
        try {
            return CatalogTestData.MAPPER.readTree(json);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    private static final JsonNode GS = gs("""
            {"courseFormats": {
               "elearning": {"label": "Interactive, self-paced E-learning"},
               "ebook": {"label": "E-books", "levels": ["eBook"], "tags": ["e-book"]},
               "live": {"label": "Live sessions"},
               "animation": {"label": "Short film / Animation", "levels": ["Short Film"]},
               "article": {"label": "Articles-essays", "levels": ["Article/Essay"]},
               "merch": {"label": "Merchandise (in collaboration)"},
               "bad": {"levels": ["x"]},
               "": {"label": "No key"}
             },
             "courseFormatOrder": ["ebook", "elearning"]}
            """);

    @Test
    void isNullWhenTheSiteAuthorsNone() {
        assertNull(CourseFormats.resolve(null));
        assertNull(CourseFormats.resolve(gs("{}")));
        assertNull(CourseFormats.resolve(gs("{\"courseFormats\": []}")));
        assertNull(CourseFormats.resolve(gs("{\"courseFormats\": {\"a\": {\"label\": \" \"}}}")));
    }

    @Test
    void validatesLowerCasesAndOrders() {
        CourseFormats.Resolved f = CourseFormats.resolve(GS);
        assertEquals(List.of("ebook", "elearning", "live", "animation", "article", "merch"),
                f.list().stream().map(CourseFormats.Format::key).toList());
        assertEquals(new CourseFormats.Format("ebook", "E-books", List.of("ebook"), List.of("format-ebook", "e-book")),
                f.byKey().get("ebook"));
    }

    @Test
    void takesTheFormatTagFirstThenAListedTagThenTheLevelName() {
        CourseFormats.Resolved f = CourseFormats.resolve(GS);
        assertEquals(List.of("live", "elearning", "ebook"),
                CourseFormats.courseFormatKeys("shiksha, Format-Live ,format-elearning", "eBook", f));
        assertEquals(List.of("ebook"), CourseFormats.courseFormatKeys("e-book", null, f));
        assertEquals(List.of("animation"), CourseFormats.courseFormatKeys(null, " short film ", f));
        assertEquals(List.of("article"), CourseFormats.courseFormatKeys(null, "Article/Essay", f));
    }

    @Test
    void ignoresUnknownFormatTagsAndLevels() {
        CourseFormats.Resolved f = CourseFormats.resolve(GS);
        assertEquals(List.of(), CourseFormats.courseFormatKeys("format-podcast", "default", f));
    }

    @Test
    void readsTagsFromCommaStrings() {
        assertEquals(List.of("a", "b"), CourseFormats.rowTags("a, B", null));
        assertEquals(List.of("x", "y"), CourseFormats.rowTags(null, List.of("x", " Y ")));
    }

    @Test
    void returnsNothingWithoutSettings() {
        assertEquals(List.of(), CourseFormats.courseFormatKeys("format-ebook", "eBook", null));
    }

    @Test
    void unionsAGroupedCardsVersions() {
        CourseFormats.Resolved f = CourseFormats.resolve(GS);
        List<CatalogRow> rows = List.of(
                CatalogTestData.row("p", "a").level("eBook").build(),
                CatalogTestData.row("p", "b").tags("format-live").build(),
                CatalogTestData.row("p", "c").level("eBook").build());
        assertEquals(List.of("ebook", "live"), CourseFormats.cardFormatKeys(rows, f));
    }

    @Test
    void brahmVarchasFormats() {
        CourseFormats.Resolved f = CatalogTestData.bvSite().formats();
        assertEquals(List.of("elearning", "ebook", "live", "video", "animation", "article", "merch", "audiobook"),
                f.list().stream().map(CourseFormats.Format::key).toList());
        // "Vedic Parenting - eBook": tags english,dharma,vedic-parenting,format-ebook,for-parents
        assertEquals(List.of("ebook"), CourseFormats.courseFormatKeys(
                "english,dharma,vedic-parenting,format-ebook,for-parents", "default", f));
        // A BV row whose only tag is "ebook" (not format-ebook) has no format, as on the site.
        assertEquals(List.of(), CourseFormats.courseFormatKeys("ebook", "Swasthavritta", f));
    }
}
