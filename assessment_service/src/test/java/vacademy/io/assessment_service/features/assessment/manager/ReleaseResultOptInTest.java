package vacademy.io.assessment_service.features.assessment.manager;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.assessment_service.features.assessment.dto.admin_get_dto.request.ReleaseRequestDto;
import vacademy.io.assessment_service.features.assessment.entity.Assessment;
import vacademy.io.assessment_service.features.assessment.entity.AssessmentUserRegistration;
import vacademy.io.assessment_service.features.assessment.entity.StudentAttempt;
import vacademy.io.assessment_service.features.assessment.notification.AssessmentReportNotificationService;
import vacademy.io.assessment_service.features.assessment.repository.AssessmentRepository;
import vacademy.io.assessment_service.features.assessment.repository.StudentAttemptRepository;
import vacademy.io.assessment_service.features.assessment.service.AssessmentWorkflowEventPublisher;
import vacademy.io.assessment_service.features.assessment.service.ReleaseStateWriter;
import vacademy.io.assessment_service.features.client.AdminCoreServiceClient;
import vacademy.io.assessment_service.features.submission_review.service.SubmissionReleaseService;
import vacademy.io.assessment_service.features.submission_review.service.SubmissionReviewStore;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.media.service.FileService;

import java.util.HashSet;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Contract 6.1 / acceptance 9-10: release-result's opt-in flags decide in the request which
 * attempts go out; an old caller's body (the PDF tool) keeps today's re-release with one email.
 */
class ReleaseResultOptInTest {

    private AssessmentParticipantsManager manager;
    private SubmissionReleaseService release;
    private SubmissionReviewStore store;
    private StudentAttemptRepository attempts;
    private AssessmentReportNotificationService reports;
    private ReleaseStateWriter writer;
    private Assessment manual;

    @BeforeEach
    void setUp() {
        manager = new AssessmentParticipantsManager();
        release = mock(SubmissionReleaseService.class);
        store = mock(SubmissionReviewStore.class);
        attempts = mock(StudentAttemptRepository.class);
        reports = mock(AssessmentReportNotificationService.class);
        writer = mock(ReleaseStateWriter.class);
        AdminCoreServiceClient adminCore = mock(AdminCoreServiceClient.class);
        when(adminCore.isLearnerResultNotificationEnabled(anyString())).thenReturn(true);
        FileService files = mock(FileService.class);
        when(files.getFileFromFileId(anyString())).thenReturn(new byte[]{1});
        AssessmentRepository assessments = mock(AssessmentRepository.class);
        ReflectionTestUtils.setField(manager, "submissionReleaseService", release);
        ReflectionTestUtils.setField(manager, "submissionReviewStore", store);
        ReflectionTestUtils.setField(manager, "studentAttemptRepository", attempts);
        ReflectionTestUtils.setField(manager, "assessmentRepository", assessments);
        ReflectionTestUtils.setField(manager, "assessmentReportNotificationService", reports);
        ReflectionTestUtils.setField(manager, "assessmentWorkflowEventPublisher", mock(AssessmentWorkflowEventPublisher.class));
        ReflectionTestUtils.setField(manager, "adminCoreServiceClient", adminCore);
        ReflectionTestUtils.setField(manager, "releaseStateWriter", writer);
        ReflectionTestUtils.setField(manager, "fileService", files);
        ReflectionTestUtils.setField(manager, "assessmentNotificationService",
                mock(vacademy.io.assessment_service.features.notification.service.AssessmentNotificationService.class));
        manual = new Assessment();
        manual.setId("A");
        manual.setEvaluationType("MANUAL");
        when(assessments.findByAssessmentIdAndInstituteId("A", "inst-1")).thenReturn(Optional.of(manual));
        when(release.markReleased(anyString(), any(), any()))
                .thenReturn(new SubmissionReleaseService.ReleaseOutcome(false, 0, List.of(), true));
    }

    private StudentAttempt attempt(String id) {
        AssessmentUserRegistration r = new AssessmentUserRegistration();
        r.setAssessment(manual);
        r.setStudentAttempts(new HashSet<>());
        StudentAttempt a = new StudentAttempt();
        a.setId(id);
        a.setRegistration(r);
        a.setStatus("ENDED");
        a.setEvaluatedFileId("copy-" + id);
        return a;
    }

    @Test
    void opt_in_flags_plan_the_release_in_the_request() {
        CustomUserDetails admin = mock(CustomUserDetails.class);
        when(admin.getUserId()).thenReturn("admin-1");
        ReleaseRequestDto req = new ReleaseRequestDto(List.of("a1", "a2", "a3"));
        req.setSkipUnready(true);
        req.setReleaseWhenMarked(true);
        when(release.planBulkRelease(any(), anyList(), any(), any(), any(), any())).thenReturn(List.of("a1"));

        manager.releaseParticipantsResult(admin, "A", "inst-1", req, "PARTICIPANTS");

        verify(release).planBulkRelease(eq(manual), eq(List.of("a1", "a2", "a3")), eq(true), eq(null), eq(null),
                eq(true));
    }

    @Test
    void the_planned_ids_are_the_only_ones_rendered() {
        when(attempts.findAllById(List.of("a1"))).thenReturn(List.of(attempt("a1")));
        var ctx = new SubmissionReleaseService.ReleaseContext("admin-1", SubmissionReleaseService.Source.BULK, false);
        manager.releaseResultWrapperForIds(manual, "inst-1", List.of("a1"), ctx).join();
        verify(release, times(1)).markReleased(eq("a1"), any(), eq(ctx));
        verify(release, never()).markReleased(eq("a2"), any(), any());
        verify(reports).sendAssessmentReportsToLearners(anyMap(), any(), any());
    }

    @Test
    void acceptance9_old_caller_body_re_releases_through_the_review_write_and_emails_once() {
        StudentAttempt a1 = attempt("a1");
        ReflectionTestUtils.invokeMethod(manager, "createParticipantsReportAndSendEmail", List.of(a1), manual, "inst-1");
        ArgumentCaptor<SubmissionReleaseService.ReleaseContext> ctx =
                ArgumentCaptor.forClass(SubmissionReleaseService.ReleaseContext.class);
        verify(release, times(1)).markReleased(eq("a1"), any(), ctx.capture());
        assertThat(ctx.getValue().source()).isEqualTo(SubmissionReleaseService.Source.LEGACY);
        verify(reports, times(1)).sendAssessmentReportsToLearners(anyMap(), any(), any());
        verify(writer, never()).release(any(StudentAttempt.class));
    }

    /** Review 2 #2: hidden ("Hide result again") before the async render ran: no email. */
    @Test
    void an_attempt_hidden_before_the_render_gets_no_email() {
        when(release.markReleased(eq("a1"), any(), any()))
                .thenReturn(new SubmissionReleaseService.ReleaseOutcome(false, 0, List.of(), false));
        when(attempts.findAllById(List.of("a1", "a2"))).thenReturn(List.of(attempt("a1"), attempt("a2")));
        var ctx = new SubmissionReleaseService.ReleaseContext("admin-1", SubmissionReleaseService.Source.BULK, false);
        manager.releaseResultWrapperForIds(manual, "inst-1", List.of("a1", "a2"), ctx).join();
        @SuppressWarnings("unchecked")
        ArgumentCaptor<java.util.Map<StudentAttempt, byte[]>> sent = ArgumentCaptor.forClass(java.util.Map.class);
        verify(reports).sendAssessmentReportsToLearners(sent.capture(), any(), any());
        assertThat(sent.getValue().keySet()).extracting(StudentAttempt::getId).containsExactly("a2");
    }

    @Test
    void old_caller_body_has_no_options() {
        assertThat(new ReleaseRequestDto(List.of("a1")).hasReleaseOptions()).isFalse();
        ReleaseRequestDto withFlag = new ReleaseRequestDto(List.of("a1"));
        withFlag.setSkipAlreadyReleased(true);
        assertThat(withFlag.hasReleaseOptions()).isTrue();
    }

    @Test
    void cron_release_uses_the_auto_context() {
        manager.releaseAutomatically(List.of(attempt("a1")), manual, "inst-1", true);
        ArgumentCaptor<SubmissionReleaseService.ReleaseContext> ctx =
                ArgumentCaptor.forClass(SubmissionReleaseService.ReleaseContext.class);
        verify(release).markReleased(eq("a1"), any(), ctx.capture());
        assertThat(ctx.getValue().source()).isEqualTo(SubmissionReleaseService.Source.AUTO);
    }
}
