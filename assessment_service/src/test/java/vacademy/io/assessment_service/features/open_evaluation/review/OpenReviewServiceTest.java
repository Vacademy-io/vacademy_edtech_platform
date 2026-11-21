package vacademy.io.assessment_service.features.open_evaluation.review;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import vacademy.io.assessment_service.features.assessment.entity.StudentAttempt;
import vacademy.io.assessment_service.features.assessment.repository.StudentAttemptRepository;
import vacademy.io.assessment_service.features.assessment.service.evaluation_ai.AiEvaluationReviewService;
import vacademy.io.assessment_service.features.open_evaluation.audit.OpenApiAudit;
import vacademy.io.assessment_service.features.open_evaluation.error.ApiErrorCode;
import vacademy.io.assessment_service.features.open_evaluation.error.OpenApiException;
import vacademy.io.assessment_service.features.open_evaluation.exam.OpenFixtures;
import vacademy.io.assessment_service.features.open_evaluation.exam.OpenQuestionService;
import vacademy.io.assessment_service.features.open_evaluation.policy.ResultLockGuard;
import vacademy.io.assessment_service.features.open_evaluation.policy.ResultLockedException;
import vacademy.io.assessment_service.features.open_evaluation.result.ResultStore;
import vacademy.io.assessment_service.features.open_evaluation.submission.ApiSubmissionStore;
import vacademy.io.assessment_service.features.open_evaluation.submission.OpenSubmissionService;
import vacademy.io.assessment_service.features.open_evaluation.submission.SubmissionFixtures;
import vacademy.io.assessment_service.features.open_evaluation.submission.dto.SubmissionInputs;
import vacademy.io.common.auth.apikey.ApiKeyPrincipal;

import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyDouble;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class OpenReviewServiceTest {

    private OpenSubmissionService submissions;
    private OpenQuestionService questions;
    private ApiSubmissionStore store;
    private ResultStore resultStore;
    private AiEvaluationReviewService reviewService;
    private StudentAttemptRepository attempts;
    private OpenApiAudit audit;
    private OpenReviewService service;
    private StudentAttempt attempt;
    private SubmissionFixtures.View view;
    private final ApiKeyPrincipal key = OpenFixtures.key();

    @BeforeEach
    void setUp() {
        submissions = mock(OpenSubmissionService.class);
        questions = mock(OpenQuestionService.class);
        store = mock(ApiSubmissionStore.class);
        resultStore = mock(ResultStore.class);
        reviewService = mock(AiEvaluationReviewService.class);
        attempts = mock(StudentAttemptRepository.class);
        audit = mock(OpenApiAudit.class);
        service = new OpenReviewService(submissions, questions, store, resultStore, reviewService, attempts,
                new ResultLockGuard(), audit, new ObjectMapper());
        service.setClock(Clock.fixed(Instant.parse("2026-10-01T10:00:00Z"), ZoneOffset.UTC));
        service.setEntityManager(null);

        when(submissions.requireLive(key, "sub-1")).thenReturn(
                new ApiSubmissionStore.SubmissionRow("sub-1", "exam-1", "cand-1", "inst-1", "LIVE", "handwritten", 10));
        attempt = new StudentAttempt();
        attempt.setId("sub-1");
        attempt.setReportReleaseStatus("PENDING");
        when(attempts.findById("sub-1")).thenReturn(Optional.of(attempt));
        view = SubmissionFixtures.view();
        view.processStatus = "COMPLETED";
        when(submissions.requireView(key, "sub-1")).thenAnswer(i -> view.build());
        when(questions.load("exam-1")).thenReturn(List.of(OpenFixtures.question("q21", "21", "LONG_ANSWER", "2", "B", 1)));
    }

    private void aiRow(String status) {
        when(resultStore.aiRows("p-1")).thenReturn(Map.of("q21", new ResultStore.AiRow("q21", status, BigDecimal.ONE,
                new BigDecimal("2"), "ok", null, "{\"confidence\":0.5}", false, null, null, null, 4)));
    }

    private static SubmissionInputs.ReviewQuestion body(String awarded) {
        SubmissionInputs.ReviewQuestion b = new SubmissionInputs.ReviewQuestion();
        b.setAwarded(awarded == null ? null : new BigDecimal(awarded));
        b.setFeedback("Energy release <implied>.");
        b.setReviewer(new SubmissionInputs.Reviewer("T-0042", "Mrs. Iyer"));
        b.setReason("teacher review");
        return b;
    }

    @Test
    void override_calls_the_dashboard_review_with_the_key_as_editor_and_records_the_reviewer() {
        aiRow("COMPLETED");

        service.overrideQuestion(key, "sub-1", "q21", body("1.5"));

        verify(reviewService).overrideQuestion("p-1", "q21", 1.5, "Energy release &lt;implied&gt;.", "apikey:key-1");
        ArgumentCaptor<String> meta = ArgumentCaptor.forClass(String.class);
        verify(resultStore).mergeReviewMeta(eq("p-1"), eq("q21"), meta.capture());
        assertThat(meta.getValue()).contains("\"ref\":\"T-0042\"", "\"name\":\"Mrs. Iyer\"", "\"reason\":\"teacher review\"",
                "\"via\":\"api\"", "\"feedback_escaped\":true");
        verify(audit).record(eq(key), eq(OpenApiAudit.ACTION_OVERRIDE), eq("exam-1"), anyString(), any());
    }

    @Test
    void marks_must_be_half_steps_within_the_maximum() {
        aiRow("COMPLETED");
        for (String bad : new String[]{"1.25", "2.5", "-0.5"}) {
            assertThatThrownBy(() -> service.overrideQuestion(key, "sub-1", "q21", body(bad)))
                    .isInstanceOfSatisfying(OpenApiException.class, e -> assertThat(e.getCode()).isEqualTo(ApiErrorCode.INVALID_MARKS));
        }
        assertThatThrownBy(() -> service.overrideQuestion(key, "sub-1", "q21", body(null)))
                .isInstanceOfSatisfying(OpenApiException.class, e -> assertThat(e.getCode()).isEqualTo(ApiErrorCode.VALIDATION_FAILED));
        verify(reviewService, never()).overrideQuestion(any(), any(), anyDouble(), any(), any());
        assertThat(OpenReviewService.validMarks(new BigDecimal("2.0"), new BigDecimal("2"))).isEqualByComparingTo("2");
        assertThat(OpenReviewService.validMarks(BigDecimal.ZERO, new BigDecimal("2"))).isEqualByComparingTo("0");
    }

    @Test
    void a_question_still_being_graded_is_409() {
        aiRow("PENDING");
        assertThatThrownBy(() -> service.overrideQuestion(key, "sub-1", "q21", body("1")))
                .isInstanceOfSatisfying(OpenApiException.class, e -> assertThat(e.getCode()).isEqualTo(ApiErrorCode.EVALUATION_IN_PROGRESS));
    }

    @Test
    void finalized_submissions_and_unknown_questions_are_refused() {
        aiRow("COMPLETED");
        assertThatThrownBy(() -> service.overrideQuestion(key, "sub-1", "nope", body("1")))
                .isInstanceOfSatisfying(OpenApiException.class, e -> assertThat(e.getCode()).isEqualTo(ApiErrorCode.QUESTION_NOT_FOUND));

        attempt.setReportReleaseStatus("RELEASED");
        assertThatThrownBy(() -> service.overrideQuestion(key, "sub-1", "q21", body("1"))).isInstanceOf(ResultLockedException.class);
        assertThatThrownBy(() -> service.approve(key, "sub-1", null)).isInstanceOf(ResultLockedException.class);
    }

    @Test
    void an_auto_marked_question_has_nothing_to_review() {
        when(resultStore.aiRows("p-1")).thenReturn(Map.of());
        assertThatThrownBy(() -> service.overrideQuestion(key, "sub-1", "q21", body("1")))
                .isInstanceOfSatisfying(OpenApiException.class, e -> assertThat(e.getCode()).isEqualTo(ApiErrorCode.VALIDATION_FAILED));
    }

    @Test
    void approve_marks_every_question_and_the_submission() {
        SubmissionInputs.Approve body = new SubmissionInputs.Approve();
        body.setReviewer(new SubmissionInputs.Reviewer("T-1", null));

        service.approve(key, "sub-1", body);

        ArgumentCaptor<String> meta = ArgumentCaptor.forClass(String.class);
        verify(resultStore).mergeReviewMetaAll(eq("p-1"), meta.capture());
        assertThat(meta.getValue()).contains("\"approved_by\":{\"key_id\":\"key-1\"", "\"ref\":\"T-1\"");
        verify(store).setApproved("sub-1", "apikey:key-1");
    }

    @Test
    void approve_waits_for_a_running_evaluation() {
        view.processStatus = "EVALUATING";
        assertThatThrownBy(() -> service.approve(key, "sub-1", null))
                .isInstanceOfSatisfying(OpenApiException.class, e -> assertThat(e.getCode()).isEqualTo(ApiErrorCode.EVALUATION_IN_PROGRESS));
    }
}
