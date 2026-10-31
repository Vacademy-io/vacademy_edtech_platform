package vacademy.io.admin_core_service.features.catalog_api.rules;

import com.fasterxml.jackson.databind.JsonNode;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.catalog_api.CatalogTestData;

import static org.junit.jupiter.api.Assertions.*;

/** findCatalogSection / findPathLibraryId (course-page-context.test.ts) and the BV site config. */
class SiteConfigTest {

    private static JsonNode pages(String json) {
        try {
            return CatalogTestData.MAPPER.readTree(json);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    @Test
    void prefersTheCoursesPagesCatalogueOverTheHomePages() {
        JsonNode p = pages("""
                [{"route":"home","title":"Home","components":[{"type":"courseCatalog","props":{"streams":{"enabled":true}}}]},
                 {"route":"courses","title":"All courses","components":[{"type":"courseCatalog","props":{}}]},
                 {"route":"about","components":[{"type":"courseCatalog","enabled":false,"props":{}}]}]
                """);
        SiteSections.CatalogSection found = SiteSections.findCatalogSection(p);
        assertEquals("courses", found.route());
        assertEquals("All courses", found.title());
        assertEquals("home", SiteSections.findCatalogSection(pages("[" + p.get(0) + "]")).route());
        assertNull(SiteSections.findCatalogSection(pages("[]")));
        assertNull(SiteSections.findCatalogSection(pages("[" + p.get(2) + "]")));
    }

    @Test
    void findsTheFirstEnabledLearningPathLibrary() {
        assertEquals("lib-2", SiteSections.findPathLibraryId(pages("""
                [{"components":[{"type":"learningPath","enabled":false,"props":{"libraryId":"lib-1"}},
                                {"type":"learningPath","props":{"libraryId":" "}},
                                {"type":"learningPath","props":{"libraryId":"lib-2"}}]}]
                """)));
        assertNull(SiteSections.findPathLibraryId(pages("[]")));
    }

    @Test
    void brahmVarchasSite() {
        SiteConfig site = CatalogTestData.bvSite();
        assertEquals("courses", site.catalog().route());
        assertTrue(site.paymentEnabled());
        assertTrue(site.grouping());
        assertEquals("folderLibrary", site.streams().source());
        assertEquals(CatalogTestData.BV_LIBRARY, site.streams().libraryId());
        assertEquals("both", site.labelMode());
        assertEquals(CatalogTestData.BV_LIBRARY, site.pathLibraryId());
        assertEquals(5, site.versionGroups().size());
        assertEquals("The Vedic science of conception, pregnancy and newborn care.",
                site.descriptions().get("f7c3b58e-b3bc-4d04-b897-e250ecf60b3a"));
    }

    @Test
    void paymentOffHidesPricesAndNoCatalogueIsHarmless() {
        SiteConfig off = SiteConfig.parse("x", "{\"globalSettings\":{\"payment\":{\"enabled\":false}}}", CatalogTestData.MAPPER);
        assertFalse(off.paymentEnabled());
        SiteConfig empty = SiteConfig.parse(null, "not json", CatalogTestData.MAPPER);
        assertTrue(empty.paymentEnabled());
        assertNull(empty.formats());
        assertNull(empty.streams());
        assertFalse(empty.grouping());
        assertEquals(CourseLanguages.DEFAULT_LANGUAGES, empty.languages());
    }
}
