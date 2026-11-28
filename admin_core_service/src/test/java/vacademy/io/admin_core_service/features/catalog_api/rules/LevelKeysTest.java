package vacademy.io.admin_core_service.features.catalog_api.rules;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.*;

/** Mirrors the learner level-key tests (catalog-streams.test.ts, "level keys"). */
class LevelKeysTest {

    @Test
    void keysAreSlugsWithAPrefixAndSkipPlaceholders() {
        assertEquals("level:india-of-temples", LevelKeys.levelKey("India of temples"));
        assertEquals("level:gurukul-education-indian-education",
                LevelKeys.levelKey("Gurukul Education | Indian Education"));
        assertNull(LevelKeys.levelKey("default"));
        assertNull(LevelKeys.levelKey("इतिहास"));
        assertNull(LevelKeys.levelKey(null));
        assertEquals(List.of("level:mandir", "level:india-of-temples"),
                LevelKeys.levelKeys("mandir", "मंदिरों का भारत", "India of temples", "mandir"));
    }

    @Test
    void aFolderMatchesTheLevelNamedLikeItsTagTitleOrSubtitle() {
        CatalogStreams.FolderNode mandir = new CatalogStreams.FolderNode("mandir", "FOLDER", "मंदिरों का भारत",
                "India of temples", null, null, "mandir", null, null, null, null, false, null, List.of());
        List<String> tags = CatalogStreams.folderTagSet(mandir);
        assertTrue(tags.contains("mandir"));
        assertTrue(tags.contains("level:india-of-temples"));
        assertTrue(CatalogStreams.matchesAny(tags, Set.of("ebook", "level:india-of-temples")));
        assertFalse(CatalogStreams.matchesAny(tags, Set.of("ebook", "level:history")));
    }
}
