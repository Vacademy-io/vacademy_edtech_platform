package vacademy.io.admin_core_service.features.catalog_api.rules;

import com.fasterxml.jackson.databind.JsonNode;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.catalog_api.CatalogTestData;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/**
 * The Courses section's discovery props (catalog-config.test.ts, catalog-custom-filters.test.ts,
 * catalog-hero-config.test.ts cases) and the real Brahm Varchas section.
 */
class CatalogDiscoveryTest {

    private static JsonNode json(String s) {
        try {
            return CatalogTestData.MAPPER.readTree(s);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    private static CatalogDiscovery resolve(String props) {
        return CatalogDiscovery.resolve(json(props), true, CourseLanguages.DEFAULT_LANGUAGES, null, null);
    }

    @Test
    void anEmptySectionIsInactiveWithTheHistoricSortMenu() {
        CatalogDiscovery d = resolve("{}");
        assertFalse(d.active());
        assertEquals("newest", d.defaultSort());
        assertFalse(d.sortOptions().contains("popular"));
        assertEquals(7, d.sortOptions().size());
        assertNull(d.badges());
        assertTrue(d.quickFilters().isEmpty());
        assertTrue(d.customFilters().isEmpty());
        assertFalse(d.priceFilter().enabled());
        assertTrue(d.priceFilter().showFree());
        // A pinned Popular default brings Popular back; an unknown default falls back to Newest.
        assertTrue(resolve("{\"defaultSort\":\"Popular\"}").sortOptions().contains("popular"));
        assertEquals("popular", resolve("{\"defaultSort\":\"Popular\"}").defaultSort());
        assertEquals("price_asc", resolve("{\"defaultSort\":\"Price: Low to High\"}").defaultSort());
        assertEquals("newest", resolve("{\"defaultSort\":\"Cheapest\"}").defaultSort());
    }

    @Test
    void badgeRules() {
        assertNull(CatalogDiscovery.resolveBadges(json("{\"enabled\":\"yes\"}")));
        CatalogDiscovery.BadgeRules all = CatalogDiscovery.resolveBadges(json("{\"enabled\":true}"));
        assertEquals(CourseBadges.ALL_BADGES, all.types());
        assertEquals(60, all.newDaysOrDefault());
        assertEquals(3, all.bestsellerTopOrDefault());
        assertEquals(2, all.maxOrDefault());
        CatalogDiscovery.BadgeRules some = CatalogDiscovery.resolveBadges(json(
                "{\"enabled\":true,\"types\":[\"new\",\"bogus\",\"free\",\"new\"],\"newDays\":\"30\",\"bestsellerTop\":5.7,\"max\":0}"));
        assertEquals(List.of("new", "free"), some.types());
        assertEquals(30, some.newDaysOrDefault());
        assertEquals(5, some.bestsellerTopOrDefault());
        assertEquals(2, some.maxOrDefault());
        // Every box unticked = badges off.
        assertNull(CatalogDiscovery.resolveBadges(json("{\"enabled\":true,\"types\":[\"bogus\"]}")));
        assertTrue(resolve("{\"badges\":{\"enabled\":true}}").active());
    }

    @Test
    void quickFilters() {
        List<CatalogDiscovery.QuickFilter> qf = CatalogDiscovery.resolveQuickFilters(json("""
                [{"kind":"popular"},{"kind":"language","value":"HI"},{"kind":"language","value":"fr"},
                 {"kind":"priceMax","value":"500"},{"kind":"priceMax","value":-1},{"kind":"bogus"},
                 {"kind":"free","id":"x"},{"kind":"new","id":"x"}]"""), true, CourseLanguages.DEFAULT_LANGUAGES);
        assertEquals(List.of("popular-0", "language-1", "priceMax-3", "x", "x-7"),
                qf.stream().map(CatalogDiscovery.QuickFilter::id).toList());
        assertEquals("hi", qf.get(1).value());
        assertEquals(500.0, qf.get(2).value());
        assertTrue(CatalogDiscovery.resolveQuickFilters(json("[{\"kind\":\"language\",\"value\":\"hi\"}]"), false,
                CourseLanguages.DEFAULT_LANGUAGES).isEmpty(), "language chips need course languages on");
    }

    @Test
    void priceAmountsAreUniqueSortedAndCapped() {
        CatalogDiscovery d = resolve("{\"priceFilter\":{\"enabled\":true,\"showFree\":false,"
                + "\"maxOptions\":[500,\"250\",500,0,-3,\"x\",1,2,3,4,5,6,7]}}");
        assertTrue(d.priceFilter().enabled());
        assertFalse(d.priceFilter().showFree());
        assertEquals(List.of(1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 250.0), d.priceFilter().maxOptions());
    }

    @Test
    void customFilters() {
        CourseFormats.Resolved formats = CourseFormats.resolve(json(
                "{\"courseFormats\":{\"ebook\":{\"label\":\"E-books\",\"levels\":[\"eBook\"]},\"live\":{\"label\":\"Live\"}}}"));
        List<CatalogDiscovery.CustomFilter> groups = CatalogDiscovery.resolveCustomFilters(json("""
                [{"id":"Format","label":"Format","source":"courseFormats","showCounts":false},
                 {"id":"for","label":"For","showEmpty":false,"visibleCount":"4",
                  "options":[{"label":"Parents","tags":["For-Parents"]},{"id":"x","label":"No match"},
                             {"id":"students","label":"Students","levels":["Class 10"]}]},
                 {"id":"price","label":"Reserved","options":[{"id":"a","label":"A","tags":["a"]}]},
                 {"id":"utm_source","label":"Reserved","options":[{"id":"a","label":"A","tags":["a"]}]},
                 {"id":"off","enabled":false,"options":[{"id":"a","label":"A","tags":["a"]}]},
                 {"id":"empty","options":[]},
                 {"id":"for","label":"Duplicate","options":[{"id":"a","label":"A","tags":["a"]}]}]"""), formats);
        assertEquals(List.of("format", "for"), groups.stream().map(CatalogDiscovery.CustomFilter::id).toList());
        CatalogDiscovery.CustomFilter format = groups.get(0);
        assertEquals("courseFormats", format.source());
        assertEquals(false, format.showCounts());
        assertTrue(format.showEmpty());
        assertEquals(List.of("ebook", "live"), format.options().stream().map(CatalogDiscovery.CustomOption::id).toList());
        assertEquals(List.of("format-ebook"), format.options().get(0).tags());
        CatalogDiscovery.CustomFilter forGroup = groups.get(1);
        assertNull(forGroup.showCounts());
        assertFalse(forGroup.showEmpty());
        assertEquals(4, forGroup.visibleCount());
        assertEquals(List.of("parents", "students"), forGroup.options().stream().map(CatalogDiscovery.CustomOption::id).toList());

        CatalogRow tagged = CatalogTestData.row("p", "ps").tags("hindi, FOR-PARENTS").level("default").build();
        CatalogRow classTen = CatalogTestData.row("q", "qs").level(" class 10").build();
        CatalogRow ebook = CatalogTestData.row("r", "rs").level("eBook").build();
        assertTrue(CatalogDiscovery.rowMatchesCustomOption(tagged, forGroup.options().get(0)));
        assertFalse(CatalogDiscovery.rowMatchesCustomOption(tagged, forGroup.options().get(1)));
        assertTrue(CatalogDiscovery.rowMatchesCustomOption(classTen, forGroup.options().get(1)));
        assertTrue(CatalogDiscovery.rowMatchesCustomOption(ebook, format.options().get(0)));
    }

    @Test
    void heroPopularChipsNeedAnEnabledBand() {
        String chips = "[{\"label\":\"Gita\",\"searchValue\":\"gita\"},{\"label\":\"Ayurveda\",\"streamSlug\":\"swasthya\","
                + "\"categorySlug\":\"garbh-vigyan\"},{\"label\":\"Free\",\"quickFilterId\":\"free-1\"},"
                + "{\"label\":\"About\",\"route\":\"about\"},{\"label\":\"\",\"searchValue\":\"x\"},{\"label\":\"Nothing\"}]";
        assertTrue(CatalogDiscovery.resolvePopular(json("{\"popular\":" + chips + "}")).isEmpty());
        List<CatalogDiscovery.PopularChip> out = CatalogDiscovery.resolvePopular(json("{\"enabled\":true,\"popular\":" + chips + "}"));
        assertEquals(List.of("search", "stream", "quick", "route"), out.stream().map(CatalogDiscovery.PopularChip::kind).toList());
        assertEquals("gita", out.get(0).search());
        assertEquals("garbh-vigyan", out.get(1).categorySlug());
        assertEquals("free-1", out.get(2).quickFilterId());
        assertEquals("about", out.get(3).route());
    }

    @Test
    void theBrahmVarchasSection() {
        CatalogDiscovery d = CatalogTestData.bvSite().discovery();
        assertTrue(d.active()); // streams + grouping + filters
        assertEquals("newest", d.defaultSort());
        assertTrue(d.sortOptions().contains("popular"));
        assertTrue(d.languageFilter().enabled());
        assertEquals("Language", d.languageFilter().label());
        assertTrue(d.categoryFilter().enabled());
        assertEquals("all", d.categoryFilter().scope());
        assertEquals("count", d.categoryFilter().sort());
        assertEquals(6, d.categoryFilter().visibleCount());
        assertNull(d.badges());
    }
}
