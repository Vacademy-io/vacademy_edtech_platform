package vacademy.io.assessment_service.features.assessment.service.aireport;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
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
 *   "show_explanation": true,       // the solution / explanation
 *   "student_fields": ["Student Roll Number", "College"] }  // registration answers printed
 *                                                           // under the student's name
 * </pre>
 *
 * <p>Resolution: the assessment's own value, else the institute's default report
 * profile ({@code report_options} in its config, where {@code question_wise: HIDE}
 * still means "no question-wise section"), else everything shown.
 *
 * <p>{@code student_fields} belongs to that one assessment only: it is never read from
 * the institute profile. An object holding {@code student_fields} and none of the four
 * switches keeps the switches on the institute default.
 */
public record ReportOptions(boolean showQuestionWise, boolean showYourAnswer, boolean showCorrectAnswer,
                            boolean showExplanation) {

    public static final ReportOptions ALL = new ReportOptions(true, true, true, true);

    static final String SHOW_QUESTION_WISE = "show_question_wise";
    static final String SHOW_YOUR_ANSWER = "show_your_answer";
    static final String SHOW_CORRECT_ANSWER = "show_correct_answer";
    static final String SHOW_EXPLANATION = "show_explanation";
    public static final String STUDENT_FIELDS = "student_fields";
    static final int MAX_STUDENT_FIELDS = 20;
    static final int MAX_STUDENT_FIELD_LENGTH = 120;
    private static final String[] FLAG_KEYS = {SHOW_QUESTION_WISE, SHOW_YOUR_ANSWER, SHOW_CORRECT_ANSWER, SHOW_EXPLANATION};

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
        for (String key : FLAG_KEYS) {
            JsonNode v = node.get(key);
            if (v != null && !v.isNull() && !v.isBoolean()) {
                throw new IllegalArgumentException("report_options." + key + " must be true or false");
            }
        }
        JsonNode fields = node.get(STUDENT_FIELDS);
        if (fields == null || fields.isNull()) return;
        if (!fields.isArray()) throw new IllegalArgumentException("report_options." + STUDENT_FIELDS + " must be a list of field names");
        if (fields.size() > MAX_STUDENT_FIELDS) {
            throw new IllegalArgumentException("report_options." + STUDENT_FIELDS + " can hold at most " + MAX_STUDENT_FIELDS + " fields");
        }
        for (JsonNode f : fields) {
            if (!f.isTextual() || f.asText().length() > MAX_STUDENT_FIELD_LENGTH) {
                throw new IllegalArgumentException("report_options." + STUDENT_FIELDS
                        + " must hold field names of at most " + MAX_STUDENT_FIELD_LENGTH + " characters");
            }
        }
    }

    /** Whether the object sets any of the four per-question switches. */
    public static boolean hasFlags(JsonNode node) {
        if (node == null || !node.isObject()) return false;
        for (String key : FLAG_KEYS) {
            if (node.has(key)) return true;
        }
        return false;
    }

    /**
     * Only {@code student_fields}, none of the four switches: the switches follow the
     * institute default, exactly as a stored null would.
     */
    public static boolean followsInstituteDefault(JsonNode node) {
        return node != null && node.isObject() && !hasFlags(node) && node.has(STUDENT_FIELDS);
    }

    /** The registration fields to print under the student's name, trimmed, blanks and repeats dropped, in order. */
    public static java.util.List<String> studentFields(JsonNode node) {
        if (node == null || !node.isObject()) return java.util.List.of();
        JsonNode fields = node.get(STUDENT_FIELDS);
        if (fields == null || !fields.isArray()) return java.util.List.of();
        java.util.List<String> out = new java.util.ArrayList<>();
        java.util.Set<String> seen = new java.util.HashSet<>();
        for (JsonNode f : fields) {
            if (!f.isTextual()) continue;
            String name = f.asText().trim();
            if (name.isEmpty() || name.length() > MAX_STUDENT_FIELD_LENGTH) continue;
            if (seen.add(name.toLowerCase(java.util.Locale.ROOT)) && out.size() < MAX_STUDENT_FIELDS) out.add(name);
        }
        return out;
    }

    /**
     * What Step 1 stores: the four switches (all present) unless the object carries only
     * {@code student_fields}, plus the cleaned field list when it is not empty. Null when
     * nothing is left, so the column goes back to "institute default". Call {@link #validate} first.
     */
    public static ObjectNode normalise(JsonNode node) {
        if (node == null || !node.isObject()) return null;
        ObjectNode out = followsInstituteDefault(node) ? JsonNodeFactory.instance.objectNode() : fromJson(node).toJson();
        java.util.List<String> fields = studentFields(node);
        if (!fields.isEmpty()) {
            ArrayNode list = out.putArray(STUDENT_FIELDS);
            fields.forEach(list::add);
        }
        return out.isEmpty() ? null : out;
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
