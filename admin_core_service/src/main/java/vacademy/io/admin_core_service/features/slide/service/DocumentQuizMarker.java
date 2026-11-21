package vacademy.io.admin_core_service.features.slide.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

/**
 * "Document + Quiz" slides are ordinary QUIZ slides whose {@code quiz_slide.title}
 * column holds a small JSON marker naming the document shown beside the questions:
 *
 * <pre>{"kind":"DOCUMENT_QUIZ","v":1,"file_id":"…","file_name":"…","source":"PDF"}</pre>
 *
 * {@code quiz_slide.title} was never shown to anyone (learners and admins see
 * {@code slide.title}), it is not part of the translation pipeline, every slide
 * query already returns it, and both copy paths copy it verbatim, so the split
 * view needs no migration. Quiz rows whose title is not this marker are plain quizzes.
 * The admin and learner apps parse the same shape (document-quiz-ref.ts).
 */
public final class DocumentQuizMarker {

    public static final String KIND = "DOCUMENT_QUIZ";

    /** quiz_slide.title is varchar(255). */
    public static final int MAX_LENGTH = 255;

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private DocumentQuizMarker() {
    }

    /** True when the value is a well-formed Document + Quiz marker that fits the column. */
    public static boolean isMarker(String value) {
        if (value == null || value.length() > MAX_LENGTH) {
            return false;
        }
        String trimmed = value.trim();
        if (!trimmed.startsWith("{")) {
            return false;
        }
        try {
            JsonNode node = MAPPER.readTree(trimmed);
            if (node == null || !node.isObject()) {
                return false;
            }
            JsonNode fileId = node.get("file_id");
            return KIND.equals(node.path("kind").asText(null))
                    && fileId != null
                    && fileId.isTextual()
                    && !fileId.asText().isBlank();
        } catch (Exception e) {
            return false;
        }
    }
}
