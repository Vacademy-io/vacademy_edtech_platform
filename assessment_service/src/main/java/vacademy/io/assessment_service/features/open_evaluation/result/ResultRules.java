package vacademy.io.assessment_service.features.open_evaluation.result;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import vacademy.io.assessment_service.features.open_evaluation.exam.OpenQuestionService;
import vacademy.io.assessment_service.features.open_evaluation.exam.QuestionMapper;
import vacademy.io.common.core.utils.PlainText;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Per-question results of the partner API (spec 7.8): one entry per question of the paper,
 * from the newest AI row of the submission's latest run, the attempt's
 * {@code question_wise_marks} (objective typed answers are scored there, {@code source: auto})
 * and the reviewer's {@code review_meta}.
 *
 * <p><b>needs_review</b> (question) = FAILED, or graded with confidence below 0.60, or a
 * reason the engine reported ({@code review_reasons}: enforcement changed the marks, answer
 * duplicated or unmapped) — unless a reviewer already edited or approved it. The SQL twin of
 * this rule is {@code ApiSubmissionStore.VIEW_SQL} ({@code question_needs_review}); keep them
 * in step.
 */
public final class ResultRules {

    public static final double LOW_CONFIDENCE = 0.60;

    public static final String Q_GRADED = "graded";
    public static final String Q_FAILED = "failed";
    public static final String Q_PENDING = "pending";
    public static final String Q_CANCELLED = "cancelled";
    public static final String Q_NOT_ANSWERED = "not_answered";

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private ResultRules() {
    }

    /** What to include beyond the defaults. */
    public record Include(boolean annotations, boolean extractedAnswer, boolean modelAnswer) {
        public static Include parse(String include) {
            String inc = include == null ? "" : include.toLowerCase();
            // extracted_answer is on by default; "-extracted_answer" switches it off
            return new Include(inc.contains("annotations"), !inc.contains("-extracted_answer"),
                    inc.contains("model_answer"));
        }
    }

    /** One question's result plus the facts the totals need. */
    public record QuestionResult(Map<String, Object> view, String status, boolean counted, BigDecimal awarded,
            BigDecimal max, boolean needsReview) {
    }

    /**
     * @param runActive the latest AI run is still queued or running (a missing row then means "pending")
     */
    public static QuestionResult question(OpenQuestionService.ExamQuestion q, ResultStore.AiRow row,
            ResultStore.MarksRow marks, boolean runActive, Include include) {
        Map<String, Object> out = new LinkedHashMap<>();
        BigDecimal max = q.maxMarks();
        out.put("question_id", q.id());
        out.put("label", q.label());
        String section = QuestionMapper.sectionName(q.question());
        out.put("section", section != null ? section : q.section() == null ? null : q.section().getName());

        String status;
        boolean counted = true;
        BigDecimal awarded = null;
        String source = null;
        Double confidence = null;
        boolean needsReview = false;
        List<String> reasons = new ArrayList<>();
        List<Map<String, Object>> criteria = new ArrayList<>();
        String feedback = null;
        String extracted = null;
        Map<String, Object> error = null;
        JsonNode json = parse(row == null ? null : row.resultJson());
        ObjectNode meta = object(row == null ? null : row.reviewMetaJson());

        if (row != null) {
            status = questionStatus(row.status());
            if (row.maxMarks() != null && max == null) {
                max = row.maxMarks();
            }
            boolean reviewedByHuman = row.edited() || (marks != null && "AI_REVIEWED".equals(marks.marksSource()));
            source = reviewedByHuman ? "ai_reviewed" : "ai";
            if (Q_GRADED.equals(status)) {
                awarded = row.marksAwarded() != null ? row.marksAwarded()
                        : marks != null ? BigDecimal.valueOf(marks.marks()) : BigDecimal.ZERO;
            }
            if (json.path("counted").isBoolean()) {
                counted = json.path("counted").asBoolean();
            }
            if (json.path("confidence").isNumber()) {
                confidence = json.path("confidence").asDouble();
            }
            criteria = criteria(json.path("criteria_breakdown"));
            feedback = row.feedback();
            if (feedback != null && meta.path("feedback_escaped").asBoolean(false)) {
                feedback = PlainText.unescape(feedback);
            }
            extracted = row.extractedAnswer();
            boolean approved = meta.hasNonNull("approved_by");
            if (!row.edited() && !approved) {
                if (Q_FAILED.equals(status)) {
                    reasons.add("failed");
                } else if (Q_GRADED.equals(status)) {
                    if (confidence != null && confidence < LOW_CONFIDENCE) {
                        reasons.add("low_confidence");
                    }
                    JsonNode extra = json.path("review_reasons");
                    if (extra.isArray()) {
                        extra.forEach(r -> {
                            if (r.isTextual() && !reasons.contains(r.asText())) {
                                reasons.add(r.asText());
                            }
                        });
                    }
                }
            }
            needsReview = !reasons.isEmpty();
            if (Q_FAILED.equals(status)) {
                String code = json.path("error_code").isTextual() ? json.path("error_code").asText() : "ai_error";
                error = new LinkedHashMap<>();
                error.put("code", code);
                error.put("message", "The AI could not grade this answer; review it by hand.");
            }
        } else if (marks != null) {
            status = Q_GRADED;
            awarded = BigDecimal.valueOf(marks.marks());
            source = "AI_REVIEWED".equals(marks.marksSource()) ? "ai_reviewed"
                    : "AI".equals(marks.marksSource()) ? "ai" : "auto";
        } else {
            status = runActive ? Q_PENDING : Q_NOT_ANSWERED;
            if (!runActive) {
                awarded = BigDecimal.ZERO;
            }
        }

        out.put("status", status);
        out.put("counted", counted);
        out.put("awarded", number(awarded));
        out.put("max", number(max));
        out.put("source", source);
        out.put("confidence", confidence);
        out.put("needs_review", needsReview);
        out.put("review_reasons", reasons);
        if (include.extractedAnswer()) {
            out.put("extracted_answer", extracted);
        }
        out.put("feedback", feedback);
        out.put("criteria", criteria);
        if (include.modelAnswer()) {
            out.put("model_answer", QuestionMapper.modelAnswer(q.question()));
        }
        if (include.annotations()) {
            out.put("annotations", json.path("annotations").isArray()
                    ? MAPPER.convertValue(json.path("annotations"), List.class) : List.of());
        }
        Map<String, Object> review = review(meta, row);
        if (review != null) {
            out.put("review", review);
        }
        out.put("error", error);
        return new QuestionResult(out, status, counted, awarded, max, needsReview);
    }

    /** AI row status → public question status. */
    static String questionStatus(String status) {
        if (status == null) {
            return Q_PENDING;
        }
        return switch (status.toUpperCase()) {
            case "COMPLETED" -> Q_GRADED;
            case "FAILED" -> Q_FAILED;
            case "CANCELLED" -> Q_CANCELLED;
            default -> Q_PENDING;
        };
    }

    /**
     * {@code criteria_breakdown} → {@code [{name, awarded, max, reason}]}. ai_service sends
     * {@code criteria_name}, {@code marks}, {@code reason} and, from T1.13, {@code max}.
     */
    static List<Map<String, Object>> criteria(JsonNode breakdown) {
        List<Map<String, Object>> out = new ArrayList<>();
        if (!breakdown.isArray()) {
            return out;
        }
        for (JsonNode c : breakdown) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("name", text(c, "criteria_name", "name"));
            m.put("awarded", num(c, "marks", "marks_awarded", "awarded"));
            m.put("max", num(c, "max", "max_marks"));
            m.put("reason", text(c, "reason"));
            out.add(m);
        }
        return out;
    }

    /** What a reviewer recorded (plain text, stored escaped; shown unescaped). */
    static Map<String, Object> review(ObjectNode meta, ResultStore.AiRow row) {
        if (meta.isEmpty() && (row == null || !row.edited())) {
            return null;
        }
        Map<String, Object> out = new LinkedHashMap<>();
        JsonNode reviewer = meta.path("reviewer");
        if (reviewer.isObject()) {
            Map<String, Object> r = new LinkedHashMap<>();
            r.put("ref", unescaped(reviewer, "ref"));
            r.put("name", unescaped(reviewer, "name"));
            out.put("reviewer", r);
        }
        if (meta.hasNonNull("reason")) {
            out.put("reason", PlainText.unescape(meta.get("reason").asText()));
        }
        out.put("edited", row != null && row.edited());
        out.put("edited_at", row != null && row.editedAt() != null ? row.editedAt().toString() : null);
        out.put("approved", meta.hasNonNull("approved_by"));
        return out;
    }

    /** Totals over counted questions: awarded only from graded ones; max = paper max. */
    public static Map<String, Object> totals(List<QuestionResult> questions, BigDecimal paperMax) {
        BigDecimal awarded = BigDecimal.ZERO;
        BigDecimal sumMax = BigDecimal.ZERO;
        int graded = 0;
        int failed = 0;
        for (QuestionResult q : questions) {
            if (q.max() != null) {
                sumMax = sumMax.add(q.max());
            }
            if (Q_GRADED.equals(q.status())) {
                graded++;
                if (q.counted() && q.awarded() != null) {
                    awarded = awarded.add(q.awarded());
                }
            } else if (Q_FAILED.equals(q.status())) {
                failed++;
            }
        }
        BigDecimal max = paperMax != null && paperMax.signum() > 0 ? paperMax : sumMax;
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("awarded", number(awarded));
        out.put("max", number(max));
        out.put("percentage", max.signum() > 0
                ? awarded.multiply(BigDecimal.valueOf(100)).divide(max, 1, RoundingMode.HALF_UP).doubleValue() : null);
        out.put("questions_graded", graded);
        out.put("questions_failed", failed);
        return out;
    }

    static Number number(BigDecimal value) {
        if (value == null) {
            return null;
        }
        BigDecimal s = value.stripTrailingZeros();
        return s.scale() <= 0 ? (Number) s.longValue() : (Number) s.doubleValue();
    }

    private static Object num(JsonNode node, String... names) {
        for (String n : names) {
            if (node.path(n).isNumber()) {
                return node.path(n).numberValue();
            }
        }
        return null;
    }

    private static String text(JsonNode node, String... names) {
        for (String n : names) {
            if (node.path(n).isTextual()) {
                return node.path(n).asText();
            }
        }
        return null;
    }

    private static String unescaped(JsonNode node, String field) {
        return node.hasNonNull(field) ? PlainText.unescape(node.get(field).asText()) : null;
    }

    static JsonNode parse(String json) {
        if (json == null || json.isBlank()) {
            return MAPPER.createObjectNode();
        }
        try {
            JsonNode node = MAPPER.readTree(json);
            return node == null ? MAPPER.createObjectNode() : node;
        } catch (Exception e) {
            return MAPPER.createObjectNode();
        }
    }

    static ObjectNode object(String json) {
        JsonNode node = parse(json);
        return node instanceof ObjectNode o ? o : MAPPER.createObjectNode();
    }
}
