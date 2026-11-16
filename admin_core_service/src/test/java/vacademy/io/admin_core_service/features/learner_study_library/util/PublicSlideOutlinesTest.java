package vacademy.io.admin_core_service.features.learner_study_library.util;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.learner_study_library.dto.LearnerSlidesDetailDTO;
import vacademy.io.admin_core_service.features.learner_study_library.dto.PublicChapterOutlineDTO;
import vacademy.io.admin_core_service.features.learner_study_library.dto.PublicSlideOutlineDTO;
import vacademy.io.admin_core_service.features.study_library.dto.ChapterDTOWithDetails;

import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class PublicSlideOutlinesTest {

    private static final ObjectMapper MAPPER = new ObjectMapper()
            .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

    /** Every content value in the fixtures contains this marker, so none may reach the output. */
    private static final String MARKER = "CONTENT-MARKER";

    private static final Set<String> SLIDE_KEYS = Set.of(
            "id", "source_type", "title", "image_file_id", "status", "slide_order",
            "video_slide", "document_slide", "question_slide", "assignment_slide", "quiz_slide",
            "html_video_slide", "audio_slide", "scorm_slide", "assessment_slide");

    private static final Set<String> PART_KEYS = Set.of(
            "type", "total_pages", "published_document_total_pages", "video_length_in_millis",
            "published_video_length_in_millis", "audio_length_in_millis",
            "published_audio_length_in_millis", "time_limit_in_minutes");

    private static final Set<String> CHAPTER_KEYS = Set.of(
            "id", "chapter_name", "status", "file_id", "description", "chapter_order");

    private static String rich(String id) {
        return "{\"id\":\"" + id + "\",\"type\":\"HTML\",\"content\":\"<p>" + MARKER + " " + id + "</p>\"}";
    }

    /** One slide of every type, shaped like the open slides query output, with all content set. */
    private static String allTypesJson(String status) {
        return "["
                + "{\"id\":\"s-doc\",\"source_id\":\"d1\",\"source_type\":\"DOCUMENT\",\"title\":\"Notes\","
                + "\"image_file_id\":\"img-1\",\"description\":\"" + MARKER + " description\",\"status\":\"" + status + "\","
                + "\"slide_order\":1,\"drip_condition\":\"{\\\"rule\\\":\\\"" + MARKER + "\\\"}\",\"is_locked\":false,\"is_hidden\":false,"
                + "\"document_slide\":{\"id\":\"d1\",\"type\":\"PDF\",\"data\":\"" + MARKER + " file\",\"title\":\"Notes\","
                + "\"cover_file_id\":\"" + MARKER + "-cover\",\"total_pages\":12,\"published_data\":\"" + MARKER + " published\","
                + "\"published_document_total_pages\":12}},"
                + "{\"id\":\"s-video\",\"source_type\":\"VIDEO\",\"title\":\"Intro\",\"status\":\"" + status + "\",\"slide_order\":2,"
                + "\"video_slide\":{\"id\":\"v1\",\"description\":\"" + MARKER + "\",\"title\":\"Intro\",\"url\":\"https://media.example/" + MARKER + "\","
                + "\"video_length_in_millis\":60000,\"published_url\":\"https://media.example/" + MARKER + "-p\","
                + "\"published_video_length_in_millis\":61000,\"source_type\":\"FILE_ID\",\"embedded_type\":\"CODE\","
                + "\"embedded_data\":\"" + MARKER + "\",\"questions\":[{\"id\":\"vq1\",\"text_data\":" + rich("vq1") + ","
                + "\"auto_evaluation_json\":\"" + MARKER + "\"}]}},"
                + "{\"id\":\"s-question\",\"source_type\":\"QUESTION\",\"title\":\"Check\",\"status\":\"" + status + "\",\"slide_order\":3,"
                + "\"question_slide\":{\"id\":\"q1\",\"text_data\":" + rich("q1") + ",\"parent_rich_text\":" + rich("q1p") + ","
                + "\"explanation_text_data\":" + rich("q1e") + ",\"media_id\":\"" + MARKER + "\","
                + "\"auto_evaluation_json\":\"{\\\"correct\\\":\\\"" + MARKER + "\\\"}\","
                + "\"options\":[{\"id\":\"o1\",\"text\":" + rich("o1") + "}]}},"
                + "{\"id\":\"s-assignment\",\"source_type\":\"ASSIGNMENT\",\"title\":\"Task\",\"status\":\"" + status + "\",\"slide_order\":4,"
                + "\"assignment_slide\":{\"id\":\"a1\",\"text_data\":" + rich("a1") + ",\"parent_rich_text\":" + rich("a1p") + ","
                + "\"comma_separated_media_ids\":\"" + MARKER + "\"}},"
                + "{\"id\":\"s-quiz\",\"source_type\":\"QUIZ\",\"title\":\"Quiz\",\"status\":\"" + status + "\",\"slide_order\":5,"
                + "\"quiz_slide\":{\"id\":\"z1\",\"title\":\"Quiz\",\"description\":" + rich("z1") + ",\"time_limit_in_minutes\":10,"
                + "\"questions\":[{\"id\":\"zq1\",\"text_data\":" + rich("zq1") + "}]}},"
                + "{\"id\":\"s-html\",\"source_type\":\"HTML_VIDEO\",\"title\":\"Lesson\",\"status\":\"" + status + "\",\"slide_order\":6,"
                + "\"html_video_slide\":{\"id\":\"h1\",\"ai_gen_video_id\":\"" + MARKER + "\",\"url\":\"https://media.example/" + MARKER + "\","
                + "\"video_length_in_millis\":30000,\"code_editor_config\":\"" + MARKER + "\"}},"
                + "{\"id\":\"s-audio\",\"source_type\":\"AUDIO\",\"title\":\"Talk\",\"status\":\"" + status + "\",\"slide_order\":7,"
                + "\"audio_slide\":{\"id\":\"au1\",\"audio_file_id\":\"" + MARKER + "\",\"published_audio_file_id\":\"" + MARKER + "\","
                + "\"external_url\":\"https://media.example/" + MARKER + "\",\"transcript\":\"" + MARKER + "\","
                + "\"thumbnail_file_id\":\"" + MARKER + "\",\"audio_length_in_millis\":5000,\"published_audio_length_in_millis\":5000}},"
                + "{\"id\":\"s-scorm\",\"source_type\":\"SCORM\",\"title\":\"Package\",\"status\":\"" + status + "\",\"slide_order\":8,"
                + "\"scorm_slide\":{\"id\":\"sc1\",\"launch_url\":\"https://media.example/" + MARKER + "\",\"launch_path\":\"" + MARKER + "\","
                + "\"original_file_id\":\"" + MARKER + "\",\"scorm_version\":\"1.2\"}},"
                + "{\"id\":\"s-assessment\",\"source_type\":\"ASSESSMENT\",\"title\":\"Test\",\"status\":\"" + status + "\",\"slide_order\":9,"
                + "\"assessment_slide\":{\"id\":\"as1\",\"assessment_id\":\"" + MARKER + "\",\"allow_reattempt\":true,\"show_result\":true}}"
                + "]";
    }

    private static List<LearnerSlidesDetailDTO> learnerSlides(String json) throws Exception {
        return MAPPER.readValue(json, new TypeReference<List<LearnerSlidesDetailDTO>>() {});
    }

    /** Fails on any key outside the allowed outline fields, at every depth. */
    private static void assertOnlyOutlineKeys(JsonNode slide) {
        Iterator<Map.Entry<String, JsonNode>> fields = slide.fields();
        while (fields.hasNext()) {
            Map.Entry<String, JsonNode> field = fields.next();
            assertTrue(SLIDE_KEYS.contains(field.getKey()), "unexpected slide key " + field.getKey());
            if (field.getKey().endsWith("_slide")) {
                field.getValue().fieldNames().forEachRemaining(name ->
                        assertTrue(PART_KEYS.contains(name), "unexpected key " + field.getKey() + "." + name));
            }
        }
    }

    @Test
    void learnerSlidesKeepOutlineAndDropEveryContentField() throws Exception {
        List<PublicSlideOutlineDTO> outline = PublicSlideOutlines.fromLearnerSlides(learnerSlides(allTypesJson("PUBLISHED")));
        String json = MAPPER.writeValueAsString(outline);

        assertFalse(json.contains(MARKER), "content reached the public outline: " + json);
        JsonNode tree = MAPPER.readTree(json);
        assertEquals(9, tree.size());
        tree.forEach(PublicSlideOutlinesTest::assertOnlyOutlineKeys);
    }

    @Test
    void learnerSlidesKeepWhatThePublicPagesRead() throws Exception {
        JsonNode tree = MAPPER.valueToTree(
                PublicSlideOutlines.fromLearnerSlides(learnerSlides(allTypesJson("PUBLISHED"))));

        JsonNode doc = tree.get(0);
        assertEquals("s-doc", doc.get("id").asText());
        assertEquals("Notes", doc.get("title").asText());
        assertEquals("DOCUMENT", doc.get("source_type").asText());
        assertEquals("PUBLISHED", doc.get("status").asText());
        assertEquals(1, doc.get("slide_order").asInt());
        assertEquals("img-1", doc.get("image_file_id").asText());
        assertEquals("PDF", doc.get("document_slide").get("type").asText());
        assertEquals(12, doc.get("document_slide").get("total_pages").asInt());

        JsonNode video = tree.get(1);
        assertEquals(60000L, video.get("video_slide").get("video_length_in_millis").asLong());
        assertEquals(61000L, video.get("video_slide").get("published_video_length_in_millis").asLong());

        // Type markers stay present (as objects) so an icon can be chosen from them.
        assertTrue(tree.get(2).get("question_slide").isObject());
        assertTrue(tree.get(3).get("assignment_slide").isObject());
        assertEquals(10, tree.get(4).get("quiz_slide").get("time_limit_in_minutes").asInt());
        assertEquals(30000L, tree.get(5).get("html_video_slide").get("video_length_in_millis").asLong());
        assertEquals(5000L, tree.get(6).get("audio_slide").get("audio_length_in_millis").asLong());
        assertTrue(tree.get(7).get("scorm_slide").isObject());
        assertTrue(tree.get(8).get("assessment_slide").isObject());

        // A slide has only its own type's object.
        assertNull(doc.get("video_slide"));
        assertNull(video.get("document_slide"));
    }

    @Test
    void hiddenAndNullSlidesAreLeftOut() throws Exception {
        List<LearnerSlidesDetailDTO> slides = new ArrayList<>(learnerSlides(allTypesJson("PUBLISHED")));
        slides.get(0).setIsHidden(true);
        slides.add(null);

        List<PublicSlideOutlineDTO> outline = PublicSlideOutlines.fromLearnerSlides(slides);

        assertEquals(8, outline.size());
        assertTrue(outline.stream().noneMatch(s -> "s-doc".equals(s.getId())));
    }

    @Test
    void nullOrEmptyInputGivesEmptyList() {
        assertTrue(PublicSlideOutlines.fromLearnerSlides(null).isEmpty());
        assertTrue(PublicSlideOutlines.fromLearnerSlides(List.of()).isEmpty());
        assertTrue(PublicSlideOutlines.fromChapters(null).isEmpty());
        assertTrue(PublicSlideOutlines.fromChapters(List.of()).isEmpty());
    }

    @Test
    void chaptersKeepOutlineDropContentAndDraftSlides() throws Exception {
        String published = allTypesJson("PUBLISHED");
        String drafts = allTypesJson("DRAFT").replace("\"id\":\"s-", "\"id\":\"draft-");
        String slides = published.substring(0, published.length() - 1) + "," + drafts.substring(1);
        String json = "[{\"chapter\":{\"id\":\"c1\",\"chapter_name\":\"Basics\",\"status\":\"ACTIVE\",\"file_id\":\"f1\","
                + "\"description\":\"About the chapter\",\"chapter_order\":2,\"parent_id\":\"p1\","
                + "\"drip_condition_json\":\"" + MARKER + "\"},\"slides\":" + slides + "},"
                + "{\"chapter\":null,\"slides\":null}]";
        List<ChapterDTOWithDetails> chapters = MAPPER.readValue(json, new TypeReference<List<ChapterDTOWithDetails>>() {});

        List<PublicChapterOutlineDTO> outline = PublicSlideOutlines.fromChapters(chapters);
        String out = MAPPER.writeValueAsString(outline);

        assertFalse(out.contains(MARKER), "content reached the public outline: " + out);
        assertFalse(out.contains("draft-"), "draft slides reached the public outline: " + out);
        JsonNode tree = MAPPER.readTree(out);
        assertEquals(2, tree.size());

        JsonNode chapter = tree.get(0).get("chapter");
        chapter.fieldNames().forEachRemaining(name ->
                assertTrue(CHAPTER_KEYS.contains(name), "unexpected chapter key " + name));
        assertEquals("Basics", chapter.get("chapter_name").asText());
        assertEquals(2, chapter.get("chapter_order").asInt());

        JsonNode chapterSlides = tree.get(0).get("slides");
        assertEquals(9, chapterSlides.size());
        chapterSlides.forEach(PublicSlideOutlinesTest::assertOnlyOutlineKeys);
        assertEquals("PDF", chapterSlides.get(0).get("document_slide").get("type").asText());

        PublicChapterOutlineDTO empty = outline.get(1);
        assertNull(empty.getChapter());
        assertNotNull(empty.getSlides());
        assertTrue(empty.getSlides().isEmpty());
    }
}
