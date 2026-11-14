package vacademy.io.assessment_service.features.assessment.service.aireport;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import vacademy.io.assessment_service.features.assessment.dto.admin_get_dto.response.StudentReportAnswerReviewDto;
import vacademy.io.assessment_service.features.assessment.dto.admin_get_dto.response.StudentReportOverallDetailDto;

/**
 * What a student's report shows about each question (V69, assessment.report_options).
 *
 * <p>Wire shape (snake_case, every key optional, missing = shown):
 * <pre>
 * { "show_question_wise": true,     // the question-by-question section at all
 *   "show_your_answer": true,       // what the student answered
 *   "show_correct_answer": true,    // the right answer
 *   "show_explanation": true }      // the solution / explanation
 * </pre>
 *
 * <p>Resolution: the assessment's own value, else the institute's default report
 * profile ({@code report_options} in its config, where {@code question_wise: HIDE}
 * still means "no question-wise section"), else everything shown.
 */
public record ReportOptions(boolean showQuestionWise, boolean showYourAnswer, boolean showCorrectAnswer,
                            boolean showExplanation) {

    public static final ReportOptions ALL = new ReportOptions(true, true, true, true);

    static final String SHOW_QUESTION_WISE = "show_question_wise";
    static final String SHOW_YOUR_ANSWER = "show_your_answer";
    static final String SHOW_CORRECT_ANSWER = "show_correct_answer";
    static final String SHOW_EXPLANATION = "show_explanation";

    /** Reads an options object; a missing or non-object node means everything shown. */
    public static ReportOptions fromJson(JsonNode node) {
        if (node == null || !node.isObject()) return ALL;
        boolean questionWise = flag(node, SHOW_QUESTION_WISE)
                // The profile's older switch: report_options.question_wise = HIDE.
                && !"HIDE".equalsIgnoreCase(node.path("question_wise").asText(""));
        return new ReportOptions(questionWise, flag(node, SHOW_YOUR_ANSWER), flag(node, SHOW_CORRECT_ANSWER),
                flag(node, SHOW_EXPLANATION));
    }

    /** Refuses anything but an object of booleans, so a typo never silently shows answers. */
    public static void validate(JsonNode node) {
        if (node == null || node.isNull()) return;
        if (!node.isObject()) throw new IllegalArgumentException("report_options must be a JSON object");
        for (String key : new String[]{SHOW_QUESTION_WISE, SHOW_YOUR_ANSWER, SHOW_CORRECT_ANSWER, SHOW_EXPLANATION}) {
            JsonNode v = node.get(key);
            if (v != null && !v.isNull() && !v.isBoolean()) {
                throw new IllegalArgumentException("report_options." + key + " must be true or false");
            }
        }
    }

    public ObjectNode toJson() {
        ObjectNode n = JsonNodeFactory.instance.objectNode();
        n.put(SHOW_QUESTION_WISE, showQuestionWise);
        n.put(SHOW_YOUR_ANSWER, showYourAnswer);
        n.put(SHOW_CORRECT_ANSWER, showCorrectAnswer);
        n.put(SHOW_EXPLANATION, showExplanation);
        return n;
    }

    /**
     * Removes what the student may not see from a report detail, in place, and
     * records the options on it so the learner app can say why a field is absent.
     * For API responses only - the PDF builders take the options directly.
     */
    public void stripFrom(StudentReportOverallDetailDto detail) {
        if (detail == null) return;
        detail.setReportOptions(toJson());
        if (detail.getAllSections() == null) return;
        // Rows stay even with the question-wise section off: the app counts
        // correct / wrong / skipped per section from their status and marks.
        for (java.util.List<StudentReportAnswerReviewDto> rows : detail.getAllSections().values()) {
            if (rows == null) continue;
            for (StudentReportAnswerReviewDto row : rows) {
                if (row == null) continue;
                if (!showQuestionWise) {
                    row.setQuestionName(null);
                    row.setQuestionText(null);
                    row.setParentRichText(null);
                }
                if (!showQuestionWise || !showYourAnswer) row.setStudentResponseOptions(null);
                if (!showQuestionWise || !showCorrectAnswer) row.setCorrectOptions(null);
                if (!showQuestionWise || !showExplanation) {
                    row.setExplanation(null);
                    row.setExplanationId(null);
                    row.setExplanationText(null);
                }
            }
        }
    }

    private static boolean flag(JsonNode node, String key) {
        JsonNode v = node.get(key);
        return v == null || v.isNull() || !v.isBoolean() || v.asBoolean();
    }
}
