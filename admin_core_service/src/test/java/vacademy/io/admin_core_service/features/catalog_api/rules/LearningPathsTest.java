package vacademy.io.admin_core_service.features.catalog_api.rules;

import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.catalog_api.CatalogTestData;
import vacademy.io.admin_core_service.features.catalog_api.rules.CourseLanguages.Language;
import vacademy.io.admin_core_service.features.catalog_api.rules.LearningPaths.PathMapping;
import vacademy.io.admin_core_service.features.catalog_api.rules.LearningPaths.Step;

import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/** Cases from learning-path-utils.test.ts, plus the BV learning-path library and product page. */
class LearningPathsTest {

    static final List<Language> LANGS = CourseLanguages.DEFAULT_LANGUAGES;

    static PathMapping row(String pkg, String ps, String level, double price, String status) {
        return new PathMapping(pkg, ps, level, "Course " + pkg, status, null, price, price * 2, "INR", null, null);
    }

    static final List<PathMapping> MAPPINGS = List.of(
            row("c1", "c1-en", "English", 500, "ACTIVE"),
            row("c1", "c1-hi", "Hindi", 400, "ACTIVE"),
            row("c2", "c2-hi", "Hindi", 300, "ACTIVE"),
            row("c3", "c3-en", "English", 200, "DELETED"),
            row("c2", "c2-hi", "Hindi", 300, "ACTIVE"),
            row("c4", "c4-en", "English", 0, "ACTIVE"));

    private static List<List<String>> codes(List<Step> steps) {
        List<List<String>> out = new ArrayList<>();
        for (Step s : steps) out.add(s.variants().stream().map(PathMapping::packageSessionId).toList());
        return out;
    }

    @Test
    void groupsACoursesLanguageVersionsIntoOneStep() {
        List<Step> steps = LearningPaths.buildPathSteps(MAPPINGS, true, LANGS, null);
        assertEquals(List.of("c1", "c2", "c4"), steps.stream().map(Step::courseId).toList());
        assertEquals(List.of("c1-en", "c1-hi"), codes(steps).get(0));
        assertEquals(List.of("en", "hi"), steps.get(0).languages().stream().map(Language::code).toList());
        assertEquals(1, steps.get(1).variants().size());
        assertEquals("c1-en", steps.get(0).key());
    }

    @Test
    void startsEachCourseInThePreferredLanguage() {
        List<Step> steps = LearningPaths.buildPathSteps(MAPPINGS, true, LANGS, "hi");
        assertEquals(List.of("c1-hi", "c2-hi", "c4-en"), steps.stream().map(s -> s.primary().packageSessionId()).toList());
    }

    @Test
    void keepsOneStepPerMappingWithoutGrouping() {
        List<Step> steps = LearningPaths.buildPathSteps(MAPPINGS, false, LANGS, null);
        assertEquals(List.of("c1-en", "c1-hi", "c2-hi", "c4-en"), steps.stream().map(s -> s.primary().packageSessionId()).toList());
        assertEquals(List.of(), LearningPaths.buildPathSteps(null, true, LANGS, null));
    }

    @Test
    void stripsALevelsLanguageWords() {
        Language en = LANGS.get(0);
        Language hi = LANGS.get(1);
        assertEquals("", LearningPaths.levelWithoutLanguage("Hindi", hi));
        assertEquals("beginner", LearningPaths.levelWithoutLanguage("Beginner Hindi", hi));
        assertEquals("beginner", LearningPaths.levelWithoutLanguage("Beginner (English)", en));
        assertEquals("batch 2", LearningPaths.levelWithoutLanguage("हिन्दी - Batch 2", hi));
        assertEquals("engineering", LearningPaths.levelWithoutLanguage("Engineering English", en));
    }

    @Test
    void keepsLevelsThatAreNotLanguageVersionsAsTheirOwnSteps() {
        List<Step> steps = LearningPaths.buildPathSteps(List.of(row("p", "p-l1", "Level 1", 1, null),
                row("p", "p-l2", "Level 2", 1, null), row("q", "q1", "Hindi", 1, null)), true, LANGS, null);
        assertEquals(List.of(List.of("p-l1"), List.of("p-l2"), List.of("q1")), codes(steps));
        // two rows in the same language are two courses
        List<Step> same = LearningPaths.buildPathSteps(List.of(row("p", "a", "Hindi", 1, null),
                row("p", "b", "Hindi", 1, null)), true, LANGS, null);
        assertEquals(2, same.size());
    }

    @Test
    void brahmVarchasLibraryPathsAndScopes() {
        List<CatalogStreams.FolderNode> roots = CatalogTestData.bvTree();
        List<LearningPaths.PathEntry> all = LearningPaths.collectPathEntries(roots);
        assertEquals(List.of("u5rgwb", "92ogt2", "ks61g1", "forbvy"), all.stream().map(LearningPaths.PathEntry::code).toList());
        assertEquals(List.of("forbvy"),
                LearningPaths.pathsInScope(roots, "swasthya").stream().map(LearningPaths.PathEntry::code).toList());
        assertEquals(List.of(), LearningPaths.pathsInScope(roots, "nope"));
        assertEquals(List.of(), LearningPaths.pathsInScope(roots, "khagol")); // a coming-soon folder
        assertEquals("mandir", CatalogStreams.folderSlug(LearningPaths.findFolderBySlug(roots, "MANDIR")));
    }
}
