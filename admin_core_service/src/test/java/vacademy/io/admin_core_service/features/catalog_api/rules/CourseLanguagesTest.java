package vacademy.io.admin_core_service.features.catalog_api.rules;

import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.catalog_api.CatalogTestData;
import vacademy.io.admin_core_service.features.catalog_api.rules.CourseLanguages.Group;
import vacademy.io.admin_core_service.features.catalog_api.rules.CourseLanguages.Language;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;
import static vacademy.io.admin_core_service.features.catalog_api.CatalogTestData.row;

/**
 * course-variants.ts ({@code languageOfLevel}, {@code languageOfTags}, {@code groupCourseVariants})
 * with the cases of catalog-cards.test.ts, plus Brahm Varchas' authored version groups.
 */
class CourseLanguagesTest {

    private static final List<Language> LANGS = CourseLanguages.DEFAULT_LANGUAGES;

    private static String code(Language l) {
        return l == null ? null : l.code();
    }

    @Test
    void readsTheLanguageFromTheLevelNameAsWholeAsciiWords() {
        assertEquals("hi", code(CourseLanguages.languageOfLevel("Hindi", LANGS)));
        assertEquals("hi", code(CourseLanguages.languageOfLevel("Beginner Hindi", LANGS)));
        assertEquals("hi", code(CourseLanguages.languageOfLevel("hindi - batch 2", LANGS)));
        assertEquals("hi", code(CourseLanguages.languageOfLevel("कक्षा हिन्दी", LANGS)));
        assertEquals("en", code(CourseLanguages.languageOfLevel("English (UK)", LANGS)));
        assertNull(CourseLanguages.languageOfLevel("Engineering", LANGS)); // "eng" is not a word here
        assertNull(CourseLanguages.languageOfLevel("  ", LANGS));
        assertNull(CourseLanguages.languageOfLevel(null, LANGS));
    }

    @Test
    void aTagNamesALanguageOnlyWhenItIsExactlyOne() {
        assertEquals("hi", code(CourseLanguages.languageOfTags("shastra, Hindi ,gita", LANGS)));
        assertNull(CourseLanguages.languageOfTags("English literature", LANGS));
        assertEquals("en", code(CourseLanguages.languageOfRow("default", "english,dharma", LANGS)));
        assertEquals("hi", code(CourseLanguages.languageOfRow("Hindi", "english", LANGS))); // level wins
    }

    private static final List<CatalogRow> ROWS = List.of(
            row("c1", "c1-en").level("English").price(1200).tags("shiksha, yoga").build(),
            row("c2", "c2-hi").level("Hindi").price(500).tags("kala").build(),
            row("c1", "c1-hi").level("Hindi").price(800).tags("Yoga,  hindi-medium").build(),
            row("c3", "c3-x").level(null).price(300).build());

    @Test
    void groupingOffKeepsOneGroupPerRow() {
        List<Group<CatalogRow>> groups = CourseLanguages.groupRows(ROWS, false, LANGS, null, null);
        assertEquals(4, groups.size());
        assertTrue(groups.stream().allMatch(g -> g.variants().size() == 1));
    }

    @Test
    void foldsACoursesVersionsWhereItsFirstRowSat() {
        List<Group<CatalogRow>> groups = CourseLanguages.groupRows(ROWS, true, LANGS, null, null);
        assertEquals(List.of("c1", "c2", "c3"), groups.stream().map(Group::courseId).toList());
        assertEquals(List.of("c1-en", "c1-hi"),
                groups.get(0).variants().stream().map(CatalogRow::packageSessionId).toList());
        assertEquals(List.of("EN", "हिं"), groups.get(0).languages().stream().map(Language::chip).toList());
        assertEquals("c1-en", groups.get(0).primary().packageSessionId());
    }

    @Test
    void opensThePreferredLanguagesVersion() {
        List<Group<CatalogRow>> groups = CourseLanguages.groupRows(ROWS, true, LANGS, "hi", null);
        assertEquals("c1-hi", groups.get(0).primary().packageSessionId());
        assertEquals("c3-x", groups.get(2).primary().packageSessionId());
    }

    @Test
    void foldsAuthoredVersionGroupsOfSeparatePackages() {
        List<CatalogRow> rows = List.of(
                row("en-pkg", "a").tags("english").build(),
                row("other", "b").build(),
                row("hi-pkg", "c").tags("hindi").build());
        List<Group<CatalogRow>> groups = CourseLanguages.groupRows(rows, true, LANGS, "hi",
                List.of(List.of("en-pkg", "hi-pkg")));
        assertEquals(2, groups.size());
        assertEquals("en-pkg", groups.get(0).courseId());
        assertEquals("c", groups.get(0).primary().packageSessionId());
        assertEquals(List.of("en", "hi"), groups.get(0).languages().stream().map(Language::code).toList());
        assertEquals(java.util.Map.of("en-pkg", "vg:0", "hi-pkg", "vg:0"),
                CourseLanguages.versionGroupIndex(List.of(List.of("en-pkg", " hi-pkg "))));
    }

    @Test
    void brahmVarchasVedicParentingEbookIsOneCourseInTwoLanguages() {
        SiteConfig site = CatalogTestData.bvSite();
        assertTrue(site.courseLanguagesOn());
        assertTrue(site.grouping());
        List<Group<CatalogRow>> groups = CourseLanguages.groupRows(CatalogTestData.bvRows(), true, site.languages(),
                null, site.versionGroups());
        Group<CatalogRow> ebook = groups.stream()
                .filter(g -> g.variants().stream().anyMatch(r -> r.packageId().startsWith("c150dfcf"))).findFirst()
                .orElseThrow();
        assertEquals(2, ebook.variants().size());
        assertEquals(List.of("en", "hi"), ebook.languages().stream().map(Language::code).toList());
        assertEquals(34, groups.size()); // 35 rows, one pair folded
    }
}
