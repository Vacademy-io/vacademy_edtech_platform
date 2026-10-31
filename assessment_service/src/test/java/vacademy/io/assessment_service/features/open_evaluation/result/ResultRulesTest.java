package vacademy.io.assessment_service.features.open_evaluation.result;

import org.junit.jupiter.api.Test;
import vacademy.io.assessment_service.features.open_evaluation.exam.OpenFixtures;
import vacademy.io.assessment_service.features.open_evaluation.exam.OpenQuestionService;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class ResultRulesTest {

    private static final ResultRules.Include DEFAULT = ResultRules.Include.parse(null);
    private static final OpenQuestionService.ExamQuestion Q21 =
            OpenFixtures.question("q21", "21", "LONG_ANSWER", "2", "B", 1);

    static ResultStore.AiRow row(String status, String awarded, String json, boolean edited, String meta) {
        return new ResultStore.AiRow("q21", status, awarded == null ? null : new BigDecimal(awarded), new BigDecimal("2"),
                "Explains glucose breakdown.", "glucose breaks down", json, edited, edited ? "apikey:key-1" : null, null,
                meta, 4);
    }

    @Test
    void low_confidence_answer_needs_review_with_criteria_max() {
        String json = "{\"confidence\":0.54,\"criteria_breakdown\":["
                + "{\"criteria_name\":\"Oxidation of glucose\",\"marks\":1,\"max\":1,\"reason\":\"Mentions breakdown.\"},"
                + "{\"criteria_name\":\"Energy released\",\"marks\":0,\"max\":1,\"reason\":\"No energy.\"}]}";
        ResultRules.QuestionResult r = ResultRules.question(Q21, row("COMPLETED", "1", json, false, null), null, false, DEFAULT);

        Map<String, Object> v = r.view();
        assertThat(v.get("status")).isEqualTo("graded");
        assertThat(v.get("awarded")).isEqualTo(1L);
        assertThat(v.get("max")).isEqualTo(2L);
        assertThat(v.get("source")).isEqualTo("ai");
        assertThat(v.get("needs_review")).isEqualTo(true);
        assertThat(v.get("review_reasons")).isEqualTo(List.of("low_confidence"));
        assertThat(v.get("counted")).isEqualTo(true);
        assertThat(v.get("extracted_answer")).isEqualTo("glucose breaks down");
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> criteria = (List<Map<String, Object>>) v.get("criteria");
        assertThat(criteria).hasSize(2);
        assertThat(criteria.get(0)).containsEntry("name", "Oxidation of glucose").containsEntry("awarded", 1)
                .containsEntry("max", 1).containsEntry("reason", "Mentions breakdown.");
        assertThat(v).doesNotContainKey("annotations").doesNotContainKey("model_answer");
    }

    @Test
    void failed_question_needs_review_and_reports_its_code() {
        ResultRules.QuestionResult r = ResultRules.question(Q21,
                row("FAILED", null, "{\"error_code\":\"ai_timeout\",\"error_detail\":\"TimeoutError: x\"}", false, null),
                null, false, DEFAULT);

        assertThat(r.status()).isEqualTo("failed");
        assertThat(r.needsReview()).isTrue();
        assertThat(r.view().get("review_reasons")).isEqualTo(List.of("failed"));
        assertThat(((Map<?, ?>) r.view().get("error")).get("code")).isEqualTo("ai_timeout");
        assertThat(r.view().toString()).doesNotContain("TimeoutError");
    }

    @Test
    void engine_reasons_and_uncounted_answers_are_reported() {
        ResultRules.QuestionResult r = ResultRules.question(Q21, row("COMPLETED", "2",
                "{\"confidence\":0.9,\"counted\":false,\"review_reasons\":[\"enforcement_changed_marks\"]}", false, null),
                null, false, DEFAULT);

        assertThat(r.counted()).isFalse();
        assertThat(r.view().get("review_reasons")).isEqualTo(List.of("enforcement_changed_marks"));
    }

    @Test
    void an_edited_or_approved_answer_no_longer_needs_review() {
        ResultRules.QuestionResult edited = ResultRules.question(Q21, row("COMPLETED", "1.5", "{\"confidence\":0.4}", true,
                "{\"reviewer\":{\"ref\":\"T-0042\",\"name\":\"Mrs. Iyer &amp; Co\"},\"feedback_escaped\":true}"),
                new ResultStore.MarksRow("q21", 1.5, "AI_REVIEWED", "COMPLETED"), false, DEFAULT);
        assertThat(edited.needsReview()).isFalse();
        assertThat(edited.view().get("source")).isEqualTo("ai_reviewed");
        assertThat(edited.view().get("awarded")).isEqualTo(1.5);
        @SuppressWarnings("unchecked")
        Map<String, Object> review = (Map<String, Object>) edited.view().get("review");
        assertThat(((Map<?, ?>) review.get("reviewer")).get("name")).isEqualTo("Mrs. Iyer & Co");

        ResultRules.QuestionResult approved = ResultRules.question(Q21, row("COMPLETED", "1", "{\"confidence\":0.4}", false,
                "{\"approved_by\":{\"key_id\":\"key-1\"}}"), null, false, DEFAULT);
        assertThat(approved.needsReview()).isFalse();
        assertThat(((Map<?, ?>) approved.view().get("review")).get("approved")).isEqualTo(true);
    }

    @Test
    void partner_feedback_is_shown_unescaped_ai_feedback_as_is() {
        ResultStore.AiRow api = new ResultStore.AiRow("q21", "COMPLETED", BigDecimal.ONE, new BigDecimal("2"),
                "Use &lt;b&gt; tags", null, "{}", true, "apikey:key-1", null, "{\"feedback_escaped\":true}", 4);
        assertThat(ResultRules.question(Q21, api, null, false, DEFAULT).view().get("feedback")).isEqualTo("Use <b> tags");

        ResultStore.AiRow ai = new ResultStore.AiRow("q21", "COMPLETED", BigDecimal.ONE, new BigDecimal("2"),
                "A &amp; B", null, "{}", false, null, null, null, 4);
        assertThat(ResultRules.question(Q21, ai, null, false, DEFAULT).view().get("feedback")).isEqualTo("A &amp; B");
    }

    @Test
    void objective_typed_answers_are_auto_and_missing_ones_pending_or_not_answered() {
        OpenQuestionService.ExamQuestion mcq = OpenFixtures.question("q1", "1", "MCQS", "1", "A", 1);
        ResultRules.QuestionResult auto = ResultRules.question(mcq, null,
                new ResultStore.MarksRow("q1", 1.0, null, "CORRECT"), false, DEFAULT);
        assertThat(auto.view().get("source")).isEqualTo("auto");
        assertThat(auto.view().get("status")).isEqualTo("graded");
        assertThat(auto.view().get("needs_review")).isEqualTo(false);

        assertThat(ResultRules.question(mcq, null, null, true, DEFAULT).status()).isEqualTo("pending");
        ResultRules.QuestionResult skipped = ResultRules.question(mcq, null, null, false, DEFAULT);
        assertThat(skipped.status()).isEqualTo("not_answered");
        assertThat(skipped.view().get("awarded")).isEqualTo(0L);
    }

    @Test
    void totals_add_counted_graded_answers_over_the_paper_max() {
        List<ResultRules.QuestionResult> qs = List.of(
                new ResultRules.QuestionResult(Map.of(), "graded", true, new BigDecimal("1.5"), new BigDecimal("2"), false),
                new ResultRules.QuestionResult(Map.of(), "graded", false, new BigDecimal("2"), new BigDecimal("2"), false),
                new ResultRules.QuestionResult(Map.of(), "failed", true, null, new BigDecimal("5"), true),
                new ResultRules.QuestionResult(Map.of(), "graded", true, new BigDecimal("4"), new BigDecimal("5"), false));

        Map<String, Object> plain = ResultRules.totals(qs, null);
        assertThat(plain.get("awarded")).isEqualTo(5.5);
        assertThat(plain.get("max")).isEqualTo(14L);
        assertThat(plain.get("questions_graded")).isEqualTo(3);
        assertThat(plain.get("questions_failed")).isEqualTo(1);
        assertThat(plain.get("percentage")).isEqualTo(39.3);

        Map<String, Object> choice = ResultRules.totals(qs, new BigDecimal("12"));
        assertThat(choice.get("max")).isEqualTo(12L);
        assertThat(choice.get("percentage")).isEqualTo(45.8);
    }

    @Test
    void include_switches() {
        ResultRules.Include inc = ResultRules.Include.parse("annotations,model_answer,-extracted_answer");
        assertThat(inc.annotations()).isTrue();
        assertThat(inc.modelAnswer()).isTrue();
        assertThat(inc.extractedAnswer()).isFalse();
        ResultRules.QuestionResult r = ResultRules.question(Q21, row("COMPLETED", "1",
                "{\"annotations\":[{\"target\":\"r1\",\"text\":\"good\"}]}", false, null), null, false, inc);
        assertThat(r.view()).containsKey("annotations").containsKey("model_answer").doesNotContainKey("extracted_answer");
        assertThat((List<?>) r.view().get("annotations")).hasSize(1);
    }
}
