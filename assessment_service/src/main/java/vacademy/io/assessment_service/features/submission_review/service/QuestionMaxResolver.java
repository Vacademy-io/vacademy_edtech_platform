package vacademy.io.assessment_service.features.submission_review.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import vacademy.io.assessment_service.features.submission_review.model.QuestionKinds;

/**
 * The range a mark may take (contract 4.3). Max: the mapping's marking JSON
 * {@code data.totalMark} when positive (as DashboardChoiceGroups reads it), else the
 * section's marks_per_question when positive, else none. Min: minus the negative mark for
 * answer-key types, else 0.
 */
public final class QuestionMaxResolver {

    private static final ObjectMapper JSON = new ObjectMapper();

    private QuestionMaxResolver() {
    }

    public static Double max(Review.PaperKey key) {
        if (key == null) return null;
        Double fromJson = number(key.markingJson(), "totalMark");
        if (fromJson != null && fromJson > 0) return fromJson;
        if (key.marksPerQuestion() != null && key.marksPerQuestion() > 0) return key.marksPerQuestion();
        return null;
    }

    public static double min(Review.PaperKey key) {
        if (key == null || !QuestionKinds.isObjective(key.questionType())) return 0.0;
        Double negative = number(key.markingJson(), "negativeMark");
        return negative == null || negative <= 0 ? 0.0 : -negative;
    }

    private static Double number(String markingJson, String field) {
        if (markingJson == null || markingJson.isBlank()) return null;
        try {
            JsonNode n = JSON.readTree(markingJson).path("data").path(field);
            if (n.isNumber()) return n.asDouble();
            if (n.isTextual() && !n.asText().isBlank()) return Double.parseDouble(n.asText().trim());
            return null;
        } catch (Exception e) {
            return null;
        }
    }

    public static double round2(double v) {
        return Math.round(v * 100.0) / 100.0;
    }
}
