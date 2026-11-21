package vacademy.io.assessment_service.features.assessment.manager;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.assessment_service.features.assessment.dto.manual_evaluation.ManualSubmitMarksRequest;
import vacademy.io.assessment_service.features.assessment.entity.Assessment;
import vacademy.io.assessment_service.features.assessment.entity.AssessmentUserRegistration;
import vacademy.io.assessment_service.features.assessment.entity.StudentAttempt;
import vacademy.io.assessment_service.features.assessment.repository.EvaluationDraftRepository;
import vacademy.io.assessment_service.features.assessment.repository.EvaluationLogsRepository;
import vacademy.io.assessment_service.features.assessment.repository.StudentAttemptRepository;
import vacademy.io.assessment_service.features.assessment.service.StudentAttemptService;
import vacademy.io.assessment_service.features.learner_assessment.service.QuestionWiseMarksService;
import vacademy.io.assessment_service.features.open_evaluation.policy.ResultLockGuard;
import vacademy.io.assessment_service.features.submission_review.service.MarkWriter;
import vacademy.io.assessment_service.features.submission_review.service.SubmissionReleaseService;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.HashSet;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * Acceptance 6 (and the no-email half of 9): the PDF tool's submit changes only the rows it
 * sends, through MarkWriter (R6 total, history), and releases the result state with no email.
 */
class AdminManualEvaluationPatchModeTest {

    private AdminManualEvaluationManager manager;
    private MarkWriter markWriter;
    private SubmissionReleaseService release;
    private StudentAttemptRepository attempts;
    private QuestionWiseMarksService legacyMarks;
    private StudentAttempt attempt;

    @BeforeEach
    void setUp() {
        manager = new AdminManualEvaluationManager();
        StudentAttemptService attemptService = mock(StudentAttemptService.class);
        markWriter = mock(MarkWriter.class);
        release = mock(SubmissionReleaseService.class);
        attempts = mock(StudentAttemptRepository.class);
        legacyMarks = mock(QuestionWiseMarksService.class);
        ReflectionTestUtils.setField(manager, "studentAttemptService", attemptService);
        ReflectionTestUtils.setField(manager, "resultLockGuard", new ResultLockGuard());
        ReflectionTestUtils.setField(manager, "evaluationLogsRepository", mock(EvaluationLogsRepository.class));
        ReflectionTestUtils.setField(manager, "evaluationDraftRepository", mock(EvaluationDraftRepository.class));
        ReflectionTestUtils.setField(manager, "questionWiseMarksService", legacyMarks);
        ReflectionTestUtils.setField(manager, "markWriter", markWriter);
        ReflectionTestUtils.setField(manager, "submissionReleaseService", release);
        ReflectionTestUtils.setField(manager, "studentAttemptRepository", attempts);

        Assessment a = new Assessment();
        a.setId("A");
        a.setEvaluationType("MANUAL");
        AssessmentUserRegistration r = new AssessmentUserRegistration();
        r.setAssessment(a);
        r.setUserId("learner-1");
        r.setStudentAttempts(new HashSet<>());
        attempt = new StudentAttempt();
        attempt.setId("att-1");
        attempt.setRegistration(r);
        attempt.setStatus("ENDED");
        when(attemptService.getStudentAttemptById("att-1")).thenReturn(Optional.of(attempt));
    }

    @Test
    @SuppressWarnings("unchecked")
    void acceptance6_submit_of_one_question_changes_only_that_row_and_releases_without_email() {
        CustomUserDetails teacher = mock(CustomUserDetails.class);
        when(teacher.getUserId()).thenReturn("teacher-1");
        ManualSubmitMarksRequest req = new ManualSubmitMarksRequest();
        req.setFileId("checked-copy-1");
        req.setRequest(List.of(ManualSubmitMarksRequest.SubmitMarksDto.builder().sectionId("s1").questionId("q7")
                .marks(6.0).build()));

        manager.submitManualEvaluatedMarks(teacher, "A", "inst-1", "att-1", req);

        ArgumentCaptor<List<MarkWriter.MarkChange>> changes = ArgumentCaptor.forClass(List.class);
        verify(markWriter).applyAll(eq("att-1"), changes.capture(), any());
        assertThat(changes.getValue()).hasSize(1);
        MarkWriter.MarkChange c = changes.getValue().get(0);
        assertThat(c.questionId()).isEqualTo("q7");
        assertThat(c.marks()).isEqualTo(6.0);
        assertThat(c.writer()).isEqualTo(MarkWriter.Writer.LEGACY_MANUAL_SUBMIT);
        assertThat(c.feedback()).isNull(); // not sent -> kept
        verify(attempts).setEvaluatedFileId("att-1", "checked-copy-1");
        ArgumentCaptor<SubmissionReleaseService.ReleaseContext> ctx =
                ArgumentCaptor.forClass(SubmissionReleaseService.ReleaseContext.class);
        verify(release).markReleased(eq("att-1"), isNull(), ctx.capture());
        assertThat(ctx.getValue().source()).isEqualTo(SubmissionReleaseService.Source.MANUAL_SUBMIT);
        // the old whole-attempt rewrite is gone, and nothing here renders or emails
        verify(legacyMarks, never()).createQuestionWiseMarks(anyList());
        verify(release, never()).releaseOne(any(), org.mockito.ArgumentMatchers.anyBoolean(),
                org.mockito.ArgumentMatchers.anyBoolean(), org.mockito.ArgumentMatchers.anyBoolean(), any(), any());
    }

    @Test
    void marks_only_submit_keeps_the_checked_copy() {
        CustomUserDetails teacher = mock(CustomUserDetails.class);
        ManualSubmitMarksRequest req = new ManualSubmitMarksRequest();
        req.setRequest(List.of());
        manager.submitManualEvaluatedMarks(teacher, "A", "inst-1", "att-1", req);
        verify(attempts, never()).setEvaluatedFileId(any(), any());
    }

    @Test
    void live_attempt_is_still_refused() {
        attempt.setStatus("LIVE");
        ManualSubmitMarksRequest req = new ManualSubmitMarksRequest();
        req.setRequest(List.of());
        org.assertj.core.api.Assertions.assertThatThrownBy(() ->
                manager.submitManualEvaluatedMarks(mock(CustomUserDetails.class), "A", "inst-1", "att-1", req))
                .hasMessageContaining("Live");
        verifyNoInteractions(markWriter, release);
    }
}
