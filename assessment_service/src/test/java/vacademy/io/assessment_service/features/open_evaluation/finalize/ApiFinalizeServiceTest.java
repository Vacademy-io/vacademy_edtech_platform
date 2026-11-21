package vacademy.io.assessment_service.features.open_evaluation.finalize;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import vacademy.io.assessment_service.features.assessment.entity.StudentAttempt;
import vacademy.io.assessment_service.features.assessment.repository.StudentAttemptRepository;
import vacademy.io.assessment_service.features.assessment.service.ReleaseStateWriter;
import vacademy.io.assessment_service.features.open_evaluation.audit.OpenApiAudit;
import vacademy.io.assessment_service.features.open_evaluation.error.ApiErrorCode;
import vacademy.io.assessment_service.features.open_evaluation.error.OpenApiException;
import vacademy.io.assessment_service.features.open_evaluation.exam.ApiExamStore;
import vacademy.io.assessment_service.features.open_evaluation.exam.OpenFixtures;
import vacademy.io.assessment_service.features.open_evaluation.submission.ApiSubmissionStore;
import vacademy.io.assessment_service.features.open_evaluation.submission.OpenSubmissionService;
import vacademy.io.assessment_service.features.open_evaluation.submission.SubmissionFixtures;
import vacademy.io.assessment_service.features.open_evaluation.submission.dto.SubmissionInputs;
import vacademy.io.common.auth.apikey.ApiKeyPrincipal;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class ApiFinalizeServiceTest {

    private ApiExamStore examStore;
    private ApiSubmissionStore store;
    private StudentAttemptRepository attempts;
    private ReleaseStateWriter writer;
    private OpenSubmissionService submissions;
    private OpenApiAudit audit;
    private ApiFinalizeService service;
    private final ApiKeyPrincipal key = OpenFixtures.key();

    @BeforeEach
    void setUp() {
        examStore = mock(ApiExamStore.class);
        store = mock(ApiSubmissionStore.class);
        attempts = mock(StudentAttemptRepository.class);
        writer = mock(ReleaseStateWriter.class);
        submissions = mock(OpenSubmissionService.class);
        audit = mock(OpenApiAudit.class);
        service = new ApiFinalizeService(examStore, store, attempts, writer, submissions, audit);
        when(examStore.findForUpdate("inst-1", "exam-1")).thenReturn(Optional.of(
                OpenFixtures.exam("exam-1", "PUBLISHED", "handwritten", LocalDate.of(2026, 10, 1), null)));
    }

    private static ApiSubmissionStore.SubmissionView sub(String id, String processStatus, boolean anyFailed, String release) {
        SubmissionFixtures.View v = SubmissionFixtures.view();
        v.attemptId = id;
        v.processStatus = processStatus;
        v.anyFailed = anyFailed;
        v.release = release;
        return v.build();
    }

    private static StudentAttempt attempt(String id, String release) {
        StudentAttempt a = new StudentAttempt();
        a.setId(id);
        a.setReportReleaseStatus(release);
        return a;
    }

    private static SubmissionInputs.Finalize ids(String... ids) {
        SubmissionInputs.Finalize f = new SubmissionInputs.Finalize();
        f.setSubmissionIds(List.of(ids));
        return f;
    }

    @Test
    void only_graded_submissions_are_finalized_without_allow_partial() {
        when(store.findViews(eq("inst-1"), anyCollection())).thenReturn(List.of(
                sub("s1", "COMPLETED", false, "PENDING"),
                sub("s2", "COMPLETED", true, "PENDING"),
                sub("s3", "EVALUATING", false, "PENDING"),
                sub("s4", "COMPLETED", false, "RELEASED"),
                sub("s5", "FAILED", false, "PENDING")));
        when(attempts.findAllById(List.of("s1"))).thenReturn(List.of(attempt("s1", "PENDING")));
        when(store.allFinalized("exam-1")).thenReturn(false);

        Map<String, Object> out = service.finalizeExam(key, "exam-1", ids("s1", "s2", "s3", "s4", "s5"));

        assertThat(out.get("finalized")).isEqualTo(List.of("s1"));
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> skipped = (List<Map<String, Object>>) out.get("skipped");
        assertThat(skipped).extracting(m -> m.get("id") + ":" + m.get("reason"))
                .containsExactly("s2:partially_graded", "s3:not_graded", "s4:already_finalized", "s5:failed");
        assertThat(out.get("has_more")).isEqualTo(false);
        verify(store).lockAttempts(List.of("s1"));
        ArgumentCaptor<Collection<StudentAttempt>> released = ArgumentCaptor.forClass(Collection.class);
        verify(writer).release(released.capture());
        assertThat(released.getValue()).extracting(StudentAttempt::getId).containsExactly("s1");
        verify(examStore, never()).markFinalized(anyString());
        verify(audit).record(eq(key), eq(OpenApiAudit.ACTION_FINALIZE), eq("exam-1"), anyString(), any());
    }

    @Test
    void a_rerun_queued_between_the_pick_and_the_lock_is_skipped_not_released() {
        // First read (unlocked): graded. After re-evaluate's lock is taken: a new run is queued.
        when(store.findViews(eq("inst-1"), anyCollection()))
                .thenReturn(List.of(sub("s1", "COMPLETED", false, "PENDING"), sub("s2", "COMPLETED", false, "PENDING")))
                .thenReturn(List.of(sub("s1", "PENDING", false, "PENDING"), sub("s2", "COMPLETED", false, "PENDING")));
        when(attempts.findAllById(List.of("s2"))).thenReturn(List.of(attempt("s2", "PENDING")));

        Map<String, Object> out = service.finalizeExam(key, "exam-1", ids("s1", "s2"));

        assertThat(out.get("finalized")).isEqualTo(List.of("s2"));
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> skipped = (List<Map<String, Object>>) out.get("skipped");
        assertThat(skipped).extracting(m -> m.get("id") + ":" + m.get("reason")).containsExactly("s1:not_graded");
        org.mockito.InOrder order = org.mockito.Mockito.inOrder(store);
        order.verify(store).lockSubmissions(List.of("s1", "s2"));
        order.verify(store).lockAttempts(List.of("s2"));
    }

    @Test
    void allow_partial_finalizes_partly_graded_and_failed_but_never_running_copies() {
        assertThat(ApiFinalizeService.skipReason(sub("a", "COMPLETED", true, "PENDING"), true)).isNull();
        assertThat(ApiFinalizeService.skipReason(sub("a", "FAILED", false, "PENDING"), true)).isNull();
        assertThat(ApiFinalizeService.skipReason(sub("a", "PENDING", false, "PENDING"), true)).isEqualTo("not_graded");
        assertThat(ApiFinalizeService.skipReason(sub("a", "CANCELLED", false, "PENDING"), true)).isEqualTo("not_graded");
        assertThat(ApiFinalizeService.skipReason(sub("a", null, false, "PENDING"), false)).isNull();
    }

    @Test
    void ids_that_are_not_live_submissions_of_this_exam_are_404() {
        SubmissionFixtures.View other = SubmissionFixtures.view();
        other.attemptId = "s9";
        other.examId = "exam-2";
        when(store.findViews(eq("inst-1"), anyCollection())).thenReturn(List.of(sub("s1", "COMPLETED", false, "PENDING"),
                other.build()));

        assertThatThrownBy(() -> service.finalizeExam(key, "exam-1", ids("s1", "s9", "ghost")))
                .isInstanceOfSatisfying(OpenApiException.class, e -> {
                    assertThat(e.getCode()).isEqualTo(ApiErrorCode.SUBMISSION_NOT_FOUND);
                    assertThat(e.getDetails().get("submission_ids")).isEqualTo(List.of("s9", "ghost"));
                });
        verify(writer, never()).release(anyList());
    }

    @Test
    void all_graded_takes_500_at_a_time_and_marks_the_exam_finalized_when_nothing_is_left() {
        List<ApiSubmissionStore.SubmissionView> many = new ArrayList<>();
        for (int i = 0; i < 501; i++) {
            many.add(sub("s" + i, "COMPLETED", false, "PENDING"));
        }
        when(store.unfinalizedForExam("inst-1", "exam-1", List.of("graded"), 501)).thenReturn(many);
        when(store.findViews(eq("inst-1"), anyCollection())).thenReturn(many);
        when(attempts.findAllById(anyList())).thenReturn(List.of(attempt("s0", "PENDING")));
        when(store.allFinalized("exam-1")).thenReturn(true);
        SubmissionInputs.Finalize all = new SubmissionInputs.Finalize();
        all.setAllGraded(true);

        Map<String, Object> out = service.finalizeExam(key, "exam-1", all);

        assertThat(out.get("has_more")).isEqualTo(true);
        ArgumentCaptor<List<String>> locked = ArgumentCaptor.forClass(List.class);
        verify(store).lockAttempts(locked.capture());
        assertThat(locked.getValue()).hasSize(500);
        verify(examStore).markFinalized("exam-1");
    }

    @Test
    void body_and_exam_state_are_validated() {
        assertThatThrownBy(() -> service.finalizeExam(key, "exam-1", new SubmissionInputs.Finalize()))
                .isInstanceOf(OpenApiException.class);
        SubmissionInputs.Finalize both = ids("s1");
        both.setAllGraded(true);
        assertThatThrownBy(() -> service.finalizeExam(key, "exam-1", both)).isInstanceOf(OpenApiException.class);

        when(examStore.findForUpdate("inst-1", "exam-1")).thenReturn(Optional.of(
                OpenFixtures.exam("exam-1", "DRAFT", "handwritten", LocalDate.of(2026, 10, 1), null)));
        assertThatThrownBy(() -> service.finalizeExam(key, "exam-1", ids("s1")))
                .isInstanceOfSatisfying(OpenApiException.class, e -> assertThat(e.getCode()).isEqualTo(ApiErrorCode.EXAM_NOT_OPEN));
    }

    @Test
    void unfinalize_needs_a_reason_and_a_finalized_result() {
        when(submissions.requireLive(key, "s1")).thenReturn(
                new ApiSubmissionStore.SubmissionRow("s1", "exam-1", "cand-1", "inst-1", "LIVE", "handwritten", 10));
        StudentAttempt a = attempt("s1", "PENDING");
        when(attempts.findById("s1")).thenReturn(Optional.of(a));

        assertThatThrownBy(() -> service.unfinalize(key, "s1", new SubmissionInputs.Unfinalize()))
                .isInstanceOfSatisfying(OpenApiException.class, e -> assertThat(e.getCode()).isEqualTo(ApiErrorCode.VALIDATION_FAILED));
        SubmissionInputs.Unfinalize body = new SubmissionInputs.Unfinalize();
        body.setReason("Revaluation request RV-2026-118");
        assertThatThrownBy(() -> service.unfinalize(key, "s1", body))
                .isInstanceOfSatisfying(OpenApiException.class, e -> assertThat(e.getCode()).isEqualTo(ApiErrorCode.SUBMISSION_NOT_FINALIZED));

        a.setReportReleaseStatus("RELEASED");
        service.unfinalize(key, "s1", body);
        verify(writer).withdraw(a);
        verify(examStore).clearFinalized("exam-1");
        ArgumentCaptor<Object> payload = ArgumentCaptor.forClass(Object.class);
        verify(audit).record(eq(key), eq(OpenApiAudit.ACTION_UNFINALIZE), eq("exam-1"), anyString(), payload.capture());
        assertThat(payload.getValue().toString()).contains("RV-2026-118");
    }
}
