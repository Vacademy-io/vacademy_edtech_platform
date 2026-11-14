package vacademy.io.assessment_service.features.assessment.service.evaluation_ai;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import vacademy.io.assessment_service.features.assessment.client.AiServiceCopyCheckClient;
import vacademy.io.assessment_service.features.assessment.dto.evaluation_ai.QuestionOverrideRequest.AnnotationEdit;
import vacademy.io.assessment_service.features.assessment.entity.AiEvaluationProcess;
import vacademy.io.assessment_service.features.assessment.entity.AiQuestionEvaluation;
import vacademy.io.assessment_service.features.assessment.entity.StudentAttempt;
import vacademy.io.assessment_service.features.assessment.repository.AiEvaluationProcessRepository;
import vacademy.io.assessment_service.features.assessment.repository.AiQuestionEvaluationRepository;
import vacademy.io.assessment_service.features.assessment.repository.StudentAttemptRepository;
import vacademy.io.common.exceptions.VacademyException;

import java.math.BigDecimal;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** Re-drawing a checked copy with the teacher's corrections, and the pen-style setting. */
class CopyCheckReRenderServiceTest {

    private final ObjectMapper json = new ObjectMapper();
    private AiEvaluationProcessRepository processes;
    private AiQuestionEvaluationRepository rows;
    private StudentAttemptRepository attempts;
    private EvaluationUtilityService utility;
    private CopyCheckOrchestratorService orchestrator;
    private AiServiceCopyCheckClient ai;
    private TypedAnswerEvaluation typed;
    private CopyCheckReRenderService service;
    private AiEvaluationProcess process;
    private StudentAttempt attempt;

    @BeforeEach
    void setUp() {
        processes = mock(AiEvaluationProcessRepository.class);
        rows = mock(AiQuestionEvaluationRepository.class);
        attempts = mock(StudentAttemptRepository.class);
        utility = mock(EvaluationUtilityService.class);
        orchestrator = mock(CopyCheckOrchestratorService.class);
        ai = mock(AiServiceCopyCheckClient.class);
        typed = mock(TypedAnswerEvaluation.class);
        when(typed.notCountedQuestionIds(any(), any())).thenReturn(java.util.Set.of());
        service = new CopyCheckReRenderService(processes, rows, attempts, utility, orchestrator, ai, json,
                new NoopTransactionManager(), typed,
                new vacademy.io.assessment_service.features.open_evaluation.policy.ResultLockGuard());

        attempt = new StudentAttempt();
        attempt.setId("att-1");
        attempt.setAttemptData("{\"fileId\":\"raw-1\"}");
        attempt.setEvaluatedFileId("ai-copy-1");
        process = new AiEvaluationProcess();
        process.setId("p1");
        process.setStatus("COMPLETED");
        process.setStudentAttempt(attempt);
        process.setEvaluationJson("{\"evaluated_file_id\":\"ai-copy-1\",\"total_marks_awarded\":7}");
        when(processes.findByIdWithStudentAttempt("p1")).thenReturn(Optional.of(process));
        when(attempts.findById("att-1")).thenReturn(Optional.of(attempt));
        when(utility.extractFileId(any())).thenReturn("raw-1");
        when(orchestrator.answerSheetUrl(any(), eq("raw-1"))).thenReturn("https://media/raw-1.pdf");
    }

    private AiQuestionEvaluation row(String qid, int marks, boolean edited, String resultJson) {
        AiQuestionEvaluation r = Rows.row("r-" + qid, qid, "COMPLETED", marks, 1);
        r.setIsEdited(edited);
        r.setFeedback("fb " + qid);
        r.setMaxMarks(BigDecimal.valueOf(5));
        r.setEvaluationResultJson(resultJson);
        return r;
    }

    @Test
    void sends_only_corrected_questions_with_their_pen_note_edits_and_moves_the_copy() throws Exception {
        String edited = AiEvaluationReviewService.withAnnotationEdits("{\"annotations\":[]}", List.of(
                AnnotationEdit.builder().style("margin_note").target("L3").pageId("P1").text("why?")
                        .action("EDIT").newText("Good point").build()));
        when(rows.findByEvaluationProcessIdOrderByQuestionNumberAsc("p1")).thenReturn(List.of(
                row("q1", 3, false, "{}"), row("q2", 5, true, edited)));
        Map<String, Object> reply = new HashMap<>();
        reply.put("evaluated_file_id", "new-copy");
        reply.put("total_marks_awarded", 8.0);
        reply.put("total_max_marks", 10.0);
        when(ai.reRender(any())).thenReturn(reply);

        CopyCheckReRenderService.Result result = service.reRender("p1", "inst-1",
                Map.of("ink", "blue", "size", "LARGE", "font", "DAWNING_OF_A_NEW_DAY"), null, "teacher-1");

        @SuppressWarnings("unchecked")
        ArgumentCaptor<Map<String, Object>> sent = ArgumentCaptor.forClass(Map.class);
        verify(ai).reRender(sent.capture());
        Map<String, Object> body = sent.getValue();
        assertThat(body).containsEntry("process_id", "p1").containsEntry("institute_id", "inst-1")
                .containsEntry("pdf_url", "https://media/raw-1.pdf")
                .containsEntry("pen_style", Map.of("ink", "BLUE", "size", "LARGE"))
                .doesNotContainKey("comment_placement");
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> overrides = (List<Map<String, Object>>) body.get("overrides");
        assertThat(overrides).hasSize(1);
        assertThat(overrides.get(0)).containsEntry("question_id", "q2").containsEntry("marks_awarded", 5.0)
                .containsEntry("feedback", "fb q2");
        @SuppressWarnings("unchecked")
        Map<String, Object> edit = ((List<Map<String, Object>>) overrides.get(0).get("annotation_edits")).get(0);
        assertThat(edit).containsEntry("action", "EDIT").containsEntry("new_text", "Good point")
                .containsEntry("page_id", "P1");

        assertThat(result.evaluatedFileId()).isEqualTo("new-copy");
        JsonNode saved = json.readTree(process.getEvaluationJson());
        assertThat(saved.get("evaluated_file_id").asText()).isEqualTo("new-copy");
        assertThat(saved.get("ai_evaluated_file_id").asText()).isEqualTo("ai-copy-1");
        assertThat(saved.get("total_marks_awarded").asInt()).isEqualTo(7);
        assertThat(attempt.getEvaluatedFileId()).isEqualTo("new-copy");
    }

    @Test
    void the_copy_gets_the_systems_choice_group_decision_and_total() {
        when(rows.findByEvaluationProcessIdOrderByQuestionNumberAsc("p1")).thenReturn(List.of(
                row("q1", 4, false, "{}"), row("q2", 5, true, "{}")));
        when(typed.notCountedQuestionIds(any(), any())).thenReturn(java.util.Set.of("q1"));
        when(typed.attemptTotal(any(), any())).thenReturn(5.0);
        when(ai.reRender(any())).thenReturn(Map.of("evaluated_file_id", "x"));

        service.reRender("p1", "inst-1", null, null, "t");

        @SuppressWarnings("unchecked")
        ArgumentCaptor<Map<String, Object>> sent = ArgumentCaptor.forClass(Map.class);
        verify(ai).reRender(sent.capture());
        assertThat(sent.getValue()).containsEntry("counted", Map.of("q1", false, "q2", true))
                .containsEntry("total_marks_awarded", 5.0);
    }

    @Test
    void a_finalized_partner_api_result_is_not_redrawn() {
        vacademy.io.assessment_service.features.assessment.entity.Assessment exam =
                new vacademy.io.assessment_service.features.assessment.entity.Assessment();
        exam.setId("a1");
        exam.setSource("API");
        vacademy.io.assessment_service.features.assessment.entity.AssessmentUserRegistration r =
                new vacademy.io.assessment_service.features.assessment.entity.AssessmentUserRegistration();
        r.setAssessment(exam);
        r.setStudentAttempts(new java.util.HashSet<>());
        attempt.setRegistration(r);
        attempt.setReportReleaseStatus("RELEASED");

        assertThatThrownBy(() -> service.reRender("p1", "inst-1", null, null, "t"))
                .isInstanceOf(vacademy.io.assessment_service.features.open_evaluation.policy.ResultLockedException.class);
        verify(ai, never()).reRender(any());
    }

    @Test
    void a_later_runs_copy_on_the_attempt_is_left_alone() {
        attempt.setEvaluatedFileId("later-run-copy");
        when(rows.findByEvaluationProcessIdOrderByQuestionNumberAsc("p1")).thenReturn(List.of());
        when(ai.reRender(any())).thenReturn(Map.of("evaluated_file_id", "new-copy"));

        service.reRender("p1", "inst-1", null, "OUTSIDE", "t");

        assertThat(attempt.getEvaluatedFileId()).isEqualTo("later-run-copy");
        verify(attempts, never()).save(any());
    }

    @Test
    void the_usual_pen_is_sent_as_an_empty_choice_not_omitted() {
        when(rows.findByEvaluationProcessIdOrderByQuestionNumberAsc("p1")).thenReturn(List.of());
        when(ai.reRender(any())).thenReturn(Map.of("evaluated_file_id", "x"));

        service.reRender("p1", null, Map.of("ink", "RED"), "inside", "t");

        @SuppressWarnings("unchecked")
        ArgumentCaptor<Map<String, Object>> sent = ArgumentCaptor.forClass(Map.class);
        verify(ai).reRender(sent.capture());
        assertThat(sent.getValue()).containsEntry("pen_style", Map.of()).containsEntry("comment_placement", "INSIDE");
    }

    @Test
    void an_old_copy_without_a_saved_render_asks_for_a_re_check_and_changes_nothing() {
        when(rows.findByEvaluationProcessIdOrderByQuestionNumberAsc("p1")).thenReturn(List.of());
        when(ai.reRender(any())).thenThrow(new AiServiceCopyCheckClient.ReRenderUnavailableException("404"));

        assertThatThrownBy(() -> service.reRender("p1", "inst-1", null, null, "t"))
                .isInstanceOf(VacademyException.class).hasMessageContaining("Run the AI check again");
        verify(processes, never()).save(any());
        assertThat(attempt.getEvaluatedFileId()).isEqualTo("ai-copy-1");
    }

    @Test
    void an_unfinished_run_is_refused_before_ai_service_is_called() {
        process.setStatus("PROCESSING");
        assertThatThrownBy(() -> service.reRender("p1", "inst-1", null, null, "t"))
                .isInstanceOf(VacademyException.class);
        verify(ai, never()).reRender(any());
    }

    @Test
    void the_review_page_payload_reads_into_the_override_request() throws Exception {
        // Exactly what the admin FE sends (overrideQuestionEvaluation).
        String fe = "{\"marks_awarded\":4.5,\"feedback\":\"ok\",\"annotation_edits\":["
                + "{\"style\":\"margin_note\",\"target\":\"L2\",\"page_id\":\"P1\",\"text\":\"why?\","
                + "\"action\":\"EDIT\",\"new_text\":\"Good\"},"
                + "{\"style\":\"tick\",\"target\":\"L1\",\"page_id\":null,\"text\":null,\"action\":\"DELETE\"}]}";
        var req = json.readValue(fe,
                vacademy.io.assessment_service.features.assessment.dto.evaluation_ai.QuestionOverrideRequest.class);
        assertThat(req.getMarksAwarded()).isEqualTo(4.5);
        assertThat(req.getAnnotationEdits()).hasSize(2);
        assertThat(req.getAnnotationEdits().get(0).getPageId()).isEqualTo("P1");
        assertThat(req.getAnnotationEdits().get(0).getNewText()).isEqualTo("Good");
        // An older FE without the field leaves the saved edits alone (null, not empty).
        assertThat(json.readValue("{\"marks_awarded\":1}",
                vacademy.io.assessment_service.features.assessment.dto.evaluation_ai.QuestionOverrideRequest.class)
                .getAnnotationEdits()).isNull();
        // What is stored is what the FE reads back and what ai_service matches on.
        JsonNode stored = json.readTree(AiEvaluationReviewService.withAnnotationEdits("{}", req.getAnnotationEdits()))
                .get(AiEvaluationReviewService.ANNOTATION_EDITS_KEY).get(0);
        assertThat(stored.get("page_id").asText()).isEqualTo("P1");
        assertThat(stored.get("new_text").asText()).isEqualTo("Good");
    }

    @Test
    void pen_note_edits_replace_the_saved_list_and_keep_the_verdict() throws Exception {
        String once = AiEvaluationReviewService.withAnnotationEdits("{\"feedback\":\"ok\",\"annotations\":[1]}",
                List.of(AnnotationEdit.builder().style("tick").target("L1").action("delete").build(),
                        AnnotationEdit.builder().style("margin_note").text("x").action("EDIT").newText("y").build()));
        String twice = AiEvaluationReviewService.withAnnotationEdits(once, List.of());
        JsonNode a = json.readTree(once);
        assertThat(a.get("feedback").asText()).isEqualTo("ok");
        assertThat(a.get("annotations")).hasSize(1);
        assertThat(a.get(AiEvaluationReviewService.ANNOTATION_EDITS_KEY)).hasSize(2);
        assertThat(a.get(AiEvaluationReviewService.ANNOTATION_EDITS_KEY).get(0).get("action").asText()).isEqualTo("DELETE");
        assertThat(a.get(AiEvaluationReviewService.ANNOTATION_EDITS_KEY).get(0).has("new_text")).isFalse();
        assertThat(json.readTree(twice).get(AiEvaluationReviewService.ANNOTATION_EDITS_KEY)).isEmpty();
        assertThat(json.readTree(AiEvaluationReviewService.withAnnotationEdits("not json", List.of()))
                .has(AiEvaluationReviewService.ANNOTATION_EDITS_KEY)).isTrue();
    }
}
