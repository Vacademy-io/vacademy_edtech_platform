package vacademy.io.admin_core_service.features.learner_tracking.cbe;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.slide.cbe.CbeConfigSecrets;

/**
 * The {@code quiz_slide_question_tracked.response_json} of a Spreadsheet &amp; Written Response
 * ({@code CBE_RESPONSE}) question inside a quiz attempt. One shape, written only by the server:
 *
 * <pre>
 * {"questionName","questionType":"CBE_RESPONSE","type":"CBE_RESPONSE",
 *  "answer":{"parts":{...}},"evaluation":{...}|null,
 *  "marks","maxMarks","isCorrect","isPartial","gradedBy":"server",
 *  "cbeState":"PENDING|EVALUATING|EVALUATED|FAILED|SKIPPED|UNATTEMPTED|NO_CHECKS_LEFT",
 *  "cbeStartedAt"?: millis, "error"?: "NO_CREDITS|EVALUATION_FAILED"}
 * </pre>
 *
 * The quiz submit stores it as PENDING with 0 marks (a client cannot claim marks for a CBE
 * answer); {@link QuizCbeGradingService} then grades it with ai_service and records the marks.
 * {@code type}, {@code answer} and {@code evaluation} are the same keys a question-slide CBE
 * attempt stores, so the review screens read both alike.
 */
public final class QuizCbeRows {

    public static final String STATE_PENDING = "PENDING";
    public static final String STATE_EVALUATING = "EVALUATING";
    public static final String STATE_EVALUATED = "EVALUATED";
    public static final String STATE_FAILED = "FAILED";
    /** Nothing written: no AI check, no marks. */
    public static final String STATE_SKIPPED = "SKIPPED";
    /** ai_service found nothing beyond the starting template: not graded, not charged. */
    public static final String STATE_UNATTEMPTED = "UNATTEMPTED";
    /** The learner has used the AI checks this question allows. */
    public static final String STATE_NO_CHECKS_LEFT = "NO_CHECKS_LEFT";

    /** response_status of an answer waiting for its AI check; readers treat it as answered, not marked. */
    public static final String STATUS_SUBMITTED = "SUBMITTED";
    public static final String STATUS_SKIPPED = "SKIPPED";

    private static final int MAX_QUESTION_NAME_CHARS = 2_000;
    private static final ObjectMapper MAPPER = new ObjectMapper();

    private QuizCbeRows() {
    }

    /**
     * The learner's answer ({@code {"parts":{...}}}) in what a client sent: under
     * {@code answer} (the learner app), under {@code cbeAnswer}, or the answer itself.
     * Null when there is none.
     */
    public static JsonNode answerOf(String clientResponseJson) {
        JsonNode root = read(clientResponseJson);
        if (root == null || !root.isObject()) {
            return null;
        }
        for (JsonNode candidate : new JsonNode[] {root.get("answer"), root.get("cbeAnswer"), root}) {
            if (candidate != null && candidate.isObject() && candidate.path("parts").isObject()) {
                return candidate;
            }
        }
        return null;
    }

    public static boolean answered(JsonNode answer) {
        return answer != null && CbeSlideSubmitService.hasAnyContent(answer);
    }

    /** The row as the quiz submit stores it: the answer, 0 marks, waiting for its AI check. */
    public static ObjectNode pending(String clientResponseJson, JsonNode answer, double maxMarks) {
        ObjectNode row = MAPPER.createObjectNode();
        JsonNode client = read(clientResponseJson);
        String name = client != null ? client.path("questionName").asText("") : "";
        row.put("questionName", name.length() > MAX_QUESTION_NAME_CHARS
                ? name.substring(0, MAX_QUESTION_NAME_CHARS) : name);
        row.put("questionType", CbeConfigSecrets.QUESTION_TYPE);
        row.put("type", CbeConfigSecrets.QUESTION_TYPE);
        boolean answered = answered(answer);
        if (answered) {
            row.set("answer", answer);
        } else {
            row.putNull("answer");
        }
        row.putNull("evaluation");
        row.put("marks", 0.0);
        row.put("maxMarks", maxMarks);
        row.put("isCorrect", false);
        row.put("isPartial", false);
        row.put("gradedBy", "server");
        row.put("cbeState", answered ? STATE_PENDING : STATE_SKIPPED);
        return row;
    }

    public static String pendingStatus(JsonNode answer) {
        return answered(answer) ? STATUS_SUBMITTED : STATUS_SKIPPED;
    }

    /**
     * The most a question can award inside its quiz: its own marks, else the sum of its
     * parts, else the quiz default. The same number the learner app shows as the question's
     * maximum, since the editor stores a CBE question's marks as the sum of its parts.
     */
    public static double questionMaxMarks(Double questionMarks, String config, Double marksPerQuestion) {
        if (questionMarks != null && questionMarks > 0) {
            return questionMarks;
        }
        Double parts = CbeConfigSecrets.totalPartMarks(config);
        if (parts != null) {
            return parts;
        }
        return marksPerQuestion != null && marksPerQuestion > 0 ? marksPerQuestion : 1.0;
    }

    /** CORRECT for full marks, else WRONG (with isPartial when some marks were earned). */
    public static String gradedStatus(double marks, double maxMarks) {
        return maxMarks > 0 && marks >= maxMarks - 1e-9 ? "CORRECT" : "WRONG";
    }

    public static String state(JsonNode row) {
        String state = row == null ? null : row.path("cbeState").asText(null);
        return StringUtils.hasText(state) ? state : STATE_PENDING;
    }

    static JsonNode read(String json) {
        if (!StringUtils.hasText(json)) {
            return null;
        }
        try {
            return MAPPER.readTree(json);
        } catch (Exception e) {
            return null;
        }
    }
}
