package vacademy.io.admin_core_service.features.catalog_api.rules;

import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.catalog_api.CatalogTestData;
import vacademy.io.admin_core_service.features.catalog_api.rules.CatalogStreams.FolderNode;
import vacademy.io.admin_core_service.features.catalog_api.rules.CatalogStreams.Stream;

import java.util.*;

import static org.junit.jupiter.api.Assertions.*;

/** Cases from catalog-streams.test.ts (and folder-library-service / header-links rules). */
class CatalogStreamsTest {

    /** The real course tags of a list, without level keys. */
    private static List<String> real(List<String> tags) {
        return tags.stream().filter(t -> !LevelKeys.isLevelKey(t)).toList();
    }


    static FolderNode folder(String id, String title, String subtitle, String slug, String courseTag, boolean comingSoon,
                             String audienceId, FolderNode... children) {
        return new FolderNode(id, "FOLDER", title, subtitle, null, slug, courseTag, null, null, null, null, comingSoon,
                audienceId, List.of(children));
    }

    static FolderNode page(String code) {
        return new FolderNode(code, "PRODUCT_PAGE", null, null, null, null, null, code, null, null, null, false, null,
                List.of());
    }

    static final List<FolderNode> TREE = List.of(
            folder("s1", "शिक्षा", "EDUCATION", "shiksha", null, false, null,
                    folder("c1", "वैदिक गणित", "Vedic Maths", null, "Vedic-Maths", false, null,
                            folder("c1a", "Deep", null, "vedic-advanced", null, false, null),
                            page("pp-1")),
                    folder("c2", "संस्कृत", "Sanskrit", null, null, true, "aud-1"),
                    folder("c3", "Dup", null, "sanskrit", null, false, null),
                    page("pp-2")),
            folder("s2", "Kala", null, null, null, true, " aud-2 "),
            page("top-level-page"),
            folder("s3", "Again", null, "shiksha", null, false, null));

    @Test
    void makesTopLevelFoldersStreamsAndKeepsEmptyOrComingSoonOnes() {
        List<Stream> streams = CatalogStreams.streamsFromFolderTree(TREE);
        assertEquals(List.of("shiksha", "kala"), streams.stream().map(Stream::slug).toList());
        assertEquals("Kala", streams.get(1).title());
        assertTrue(streams.get(1).comingSoon());
        assertEquals("aud-2", streams.get(1).audienceId());
        assertEquals(List.of(), streams.get(1).categories());
    }

    @Test
    void collectsTheStreamsOwnTagPlusEveryFolderTagBelow() {
        Stream s = CatalogStreams.streamsFromFolderTree(TREE).get(0);
        assertEquals("shiksha", s.tag());
        assertEquals(new TreeSet<>(List.of("sanskrit", "shiksha", "vedic-advanced", "vedic-maths")), new TreeSet<>(real(s.tags())));
    }

    @Test
    void makesDirectSubFoldersCategoriesDeDuplicatedBySlug() {
        Stream s = CatalogStreams.streamsFromFolderTree(TREE).get(0);
        assertEquals(List.of("vedic-maths", "sanskrit"), s.categories().stream().map(CatalogStreams.Category::slug).toList());
        assertEquals("वैदिक गणित", s.categories().get(0).title());
        assertTrue(s.categories().get(1).comingSoon());
        assertEquals("aud-1", s.categories().get(1).audienceId());
        assertEquals(new TreeSet<>(List.of("vedic-advanced", "vedic-maths")), new TreeSet<>(real(s.categories().get(0).tags())));
        assertEquals(List.of(), CatalogStreams.streamsFromFolderTree(null));
        assertEquals(List.of(), CatalogStreams.folderTagSet(page("x")));
    }

    @Test
    void slugFromSubtitleOrTitleWhenNoneIsSet() {
        assertEquals("vedic-maths", CatalogStreams.folderSlug(folder("x", "वैदिक", "Vedic Maths", null, null, false, null)));
        assertEquals("cafe-creme", CatalogStreams.folderSlug(folder("x", "Café Crème", "", null, null, false, null)));
        assertEquals("x", CatalogStreams.folderSlug(folder("x", "शिक्षा", null, null, null, false, null)));
        assertEquals("shiksha", CatalogStreams.toSlug("  Shiksha!! "));
    }

    @Test
    void tagStreamsAndSafeImagesAndColours() {
        List<Stream> streams = CatalogStreams.streamsFromTagItems(List.of(
                new CatalogStreams.StreamItem("A", "a", "A", "https://cdn.example.com/a.png"),
                new CatalogStreams.StreamItem("B", "b", "b", "javascript:alert(1)")));
        assertEquals(List.of("a", "level:a"), streams.get(0).tags());
        assertEquals("https://cdn.example.com/a.png", streams.get(0).imageUrl());
        assertNull(streams.get(1).imageUrl());
        assertNull(CatalogStreams.safeImageSrc("//evil.example/x.png"));
        assertEquals("/img/x.png", CatalogStreams.safeImageSrc(" /img/x.png "));
        assertEquals("#abc", CatalogStreams.safeAccentColor("#abc"));
        assertNull(CatalogStreams.safeAccentColor("red"));
    }

    @Test
    void placeLabelFollowsTheLabelMode() {
        assertEquals("Health | Ayurveda", CatalogStreams.placeLabel("स्वास्थ्य", "Health | Ayurveda", "subtitle", null));
        assertEquals("Health | Ayurveda", CatalogStreams.placeLabel("स्वास्थ्य", "Health | Ayurveda", "both", "en"));
        assertEquals("स्वास्थ्य", CatalogStreams.placeLabel("स्वास्थ्य", "Health | Ayurveda", "both", "hi"));
        assertEquals("स्वास्थ्य", CatalogStreams.placeLabel("स्वास्थ्य", "Health | Ayurveda", "title", null));
    }

    @Test
    void brahmVarchasStreamsAndCounts() {
        List<Stream> streams = CatalogStreams.streamsFromFolderTree(CatalogTestData.bvTree());
        assertEquals(List.of("shastra", "bharat", "shiksha", "swasthya", "dharma", "kala"),
                streams.stream().map(Stream::slug).toList());
        Stream dharma = streams.get(4);
        assertEquals(List.of("dharma", "vedic-parenting"), real(dharma.tags()));
        assertTrue(dharma.tags().containsAll(List.of("level:vedic-parenting", "level:holistic-parenting")));
        assertEquals("#82b74b", dharma.accentColor());
        Set<String> ebookTags = new HashSet<>(CourseFormats.rowTags("english,dharma,vedic-parenting,format-ebook,for-parents", null));
        assertEquals("dharma", CatalogStreams.streamOf(ebookTags, streams).slug());
        assertEquals("vedic-parenting", CatalogStreams.categoryOf(dharma, ebookTags).slug());
        Map<String, Integer> counts = CatalogStreams.countCardsByStream(List.of(ebookTags, Set.of("kala")), streams);
        assertEquals(1, counts.get("dharma"));
        assertEquals(1, counts.get("kala"));
        assertEquals(0, counts.get("shastra"));
    }
}
