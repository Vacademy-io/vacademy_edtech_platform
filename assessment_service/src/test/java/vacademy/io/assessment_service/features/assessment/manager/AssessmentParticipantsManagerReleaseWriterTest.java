package vacademy.io.assessment_service.features.assessment.manager;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.assessment_service.features.assessment.entity.Assessment;
import vacademy.io.assessment_service.features.assessment.entity.AssessmentUserRegistration;
import vacademy.io.assessment_service.features.assessment.entity.StudentAttempt;
import vacademy.io.assessment_service.features.assessment.notification.AssessmentReportNotificationService;
import vacademy.io.assessment_service.features.assessment.service.AssessmentWorkflowEventPublisher;
import vacademy.io.assessment_service.features.assessment.service.ReleaseStateWriter;
import vacademy.io.assessment_service.features.client.AdminCoreServiceClient;

import java.util.HashSet;
import java.util.List;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * Release Result writes through ReleaseStateWriter: per attempt on dashboard exams (as
 * before), and for partner-API exams the state change only — no report, no email, no
 * workflow event (spec 12).
 */
class AssessmentParticipantsManagerReleaseWriterTest {

    private AssessmentParticipantsManager manager;
    private ReleaseStateWriter writer;
    private AssessmentReportNotificationService reports;
    private AssessmentWorkflowEventPublisher events;
    private AdminCoreServiceClient adminCore;

    @BeforeEach
    void setUp() {
        manager = new AssessmentParticipantsManager();
        writer = mock(ReleaseStateWriter.class);
        reports = mock(AssessmentReportNotificationService.class);
        events = mock(AssessmentWorkflowEventPublisher.class);
        adminCore = mock(AdminCoreServiceClient.class);
        ReflectionTestUtils.setField(manager, "releaseStateWriter", writer);
        ReflectionTestUtils.setField(manager, "assessmentReportNotificationService", reports);
        ReflectionTestUtils.setField(manager, "assessmentWorkflowEventPublisher", events);
        ReflectionTestUtils.setField(manager, "adminCoreServiceClient", adminCore);
        when(adminCore.isLearnerResultNotificationEnabled(anyString())).thenReturn(true);
    }

    private static Assessment exam(String source, String evaluationType) {
        Assessment a = new Assessment();
        a.setId("a1");
        a.setSource(source);
        a.setEvaluationType(evaluationType);
        return a;
    }

    private static StudentAttempt attempt(String id, Assessment exam) {
        AssessmentUserRegistration r = new AssessmentUserRegistration();
        r.setAssessment(exam);
        r.setStudentAttempts(new HashSet<>());
        StudentAttempt a = new StudentAttempt();
        a.setId(id);
        a.setRegistration(r);
        a.setStatus("ENDED");
        return a;
    }

    @Test
    void api_exam_release_is_the_state_change_only() {
        Assessment api = exam("API", "AUTO"); // typed API exam: AUTO would otherwise render PDFs
        List<StudentAttempt> attempts = List.of(attempt("x1", api), attempt("x2", api));

        ReflectionTestUtils.invokeMethod(manager, "createParticipantsReportAndSendEmail", attempts, api, "inst-1");

        verify(writer).release(attempts);
        verifyNoInteractions(reports);
        verify(events, never()).publishResultReleased(anyList());
    }

    @Test
    void dashboard_manual_release_still_writes_per_attempt() {
        Assessment dashboard = exam(null, "MANUAL");
        StudentAttempt a1 = attempt("d1", dashboard);
        StudentAttempt a2 = attempt("d2", dashboard);

        ReflectionTestUtils.invokeMethod(manager, "createParticipantsReportAndSendEmail", List.of(a1, a2), dashboard,
                "inst-1");

        verify(writer).release(a1);
        verify(writer).release(a2);
        verify(writer, times(0)).release(anyList());
        // no checked copies → empty report map, the email service is still called as before
        verify(reports).sendAssessmentReportsToLearners(anyMap(), any(), any());
    }

    private StudentAttempt checkedCopyAttempt(String id, Assessment exam) {
        StudentAttempt a = attempt(id, exam);
        a.setEvaluatedFileId("file-" + id);
        return a;
    }

    @Test
    void automatic_release_after_end_emails_and_fires_the_workflow() {
        vacademy.io.common.media.service.FileService files = mock(vacademy.io.common.media.service.FileService.class);
        when(files.getFileFromFileId(anyString())).thenReturn(new byte[] {1});
        ReflectionTestUtils.setField(manager, "fileService", files);
        Assessment dashboard = exam(null, "MANUAL");
        StudentAttempt a1 = checkedCopyAttempt("m1", dashboard);

        manager.releaseAutomatically(List.of(a1), dashboard, "inst-1", true);

        verify(writer).release(a1);
        verify(reports).sendAssessmentReportsToLearners(anyMap(), any(), any());
        verify(events).publishResultReleased(anyList());
    }

    @Test
    void automatic_release_of_a_submit_time_release_does_not_fire_the_workflow_twice() {
        vacademy.io.common.media.service.FileService files = mock(vacademy.io.common.media.service.FileService.class);
        when(files.getFileFromFileId(anyString())).thenReturn(new byte[] {1});
        ReflectionTestUtils.setField(manager, "fileService", files);
        Assessment dashboard = exam(null, "MANUAL");
        StudentAttempt a1 = checkedCopyAttempt("m1", dashboard);

        manager.releaseAutomatically(List.of(a1), dashboard, "inst-1", false);

        verify(reports).sendAssessmentReportsToLearners(anyMap(), any(), any());
        verify(events, never()).publishResultReleased(anyList());
    }

    @Test
    void automatic_release_with_nothing_claimed_does_nothing() {
        manager.releaseAutomatically(List.of(), exam(null, "AUTO"), "inst-1", true);
        verifyNoInteractions(writer, reports, events);
    }

    // ---------------------------------------------------------------- pre-ship review R7

    private vacademy.io.assessment_service.features.submission_review.service.SubmissionReleaseService
            releaseFailingFor(String failingId) {
        var release = mock(vacademy.io.assessment_service.features.submission_review.service.SubmissionReleaseService.class);
        var ok = new vacademy.io.assessment_service.features.submission_review.service.SubmissionReleaseService
                .ReleaseOutcome(false, 0, List.of(), true);
        when(release.markReleased(anyString(), any(), any())).thenAnswer(i -> {
            if (failingId.equals(i.getArgument(0))) throw new IllegalStateException("lock wait timeout");
            return ok;
        });
        ReflectionTestUtils.setField(manager, "submissionReleaseService", release);
        return release;
    }

    /** One attempt's release throws: the others are released, and their emails still go out. */
    @Test
    @SuppressWarnings("unchecked")
    void manual_release_continues_after_one_attempt_fails() {
        vacademy.io.common.media.service.FileService files = mock(vacademy.io.common.media.service.FileService.class);
        when(files.getFileFromFileId(anyString())).thenReturn(new byte[] {1});
        ReflectionTestUtils.setField(manager, "fileService", files);
        var release = releaseFailingFor("m2");
        Assessment dashboard = exam(null, "MANUAL");
        StudentAttempt a1 = checkedCopyAttempt("m1", dashboard);
        StudentAttempt a2 = checkedCopyAttempt("m2", dashboard);
        StudentAttempt a3 = checkedCopyAttempt("m3", dashboard);

        manager.releaseAutomatically(List.of(a1, a2, a3), dashboard, "inst-1", true);

        verify(release, times(3)).markReleased(anyString(), any(), any());
        org.mockito.ArgumentCaptor<java.util.Map<StudentAttempt, byte[]>> emailed =
                org.mockito.ArgumentCaptor.forClass(java.util.Map.class);
        verify(reports).sendAssessmentReportsToLearners(emailed.capture(), any(), any());
        org.assertj.core.api.Assertions.assertThat(emailed.getValue().keySet()).containsExactlyInAnyOrder(a1, a3);
        verify(events).publishResultReleased(anyList());
    }

    /** The same for the report loop (AUTO tests): the batch emails go out for the others. */
    @Test
    @SuppressWarnings("unchecked")
    void report_release_continues_after_one_attempt_fails() throws Exception {
        AssessmentParticipantsManager spy = org.mockito.Mockito.spy(manager);
        var learnerReports = mock(vacademy.io.assessment_service.features.learner_assessment.service.LearnerReportService.class);
        var aiPdf = mock(vacademy.io.assessment_service.features.assessment.service.aireport.AiReportPdfService.class);
        var upload = mock(vacademy.io.assessment_service.features.assessment.service.ReportPdfUploadService.class);
        var notify = mock(vacademy.io.assessment_service.features.assessment.notification.ResultNotificationService.class);
        ReflectionTestUtils.setField(spy, "learnerReportService", learnerReports);
        ReflectionTestUtils.setField(spy, "aiReportPdfService", aiPdf);
        ReflectionTestUtils.setField(spy, "reportPdfUploadService", upload);
        ReflectionTestUtils.setField(spy, "resultNotificationService", notify);
        ReflectionTestUtils.setField(spy, "reportPdfRenderService",
                mock(vacademy.io.assessment_service.features.assessment.service.ReportPdfRenderService.class));
        manager = spy;
        var release = releaseFailingFor("r2");
        org.mockito.Mockito.doReturn(new vacademy.io.assessment_service.features.assessment.dto.admin_get_dto.response
                .StudentReportOverallDetailDto()).when(spy).createStudentReportDetailResponse(
                org.mockito.ArgumentMatchers.nullable(
                        vacademy.io.assessment_service.features.learner_assessment.dto.ReportClassContext.class),
                anyString(), anyString());
        when(aiPdf.renderWithVariables(any(), any(), any(), any(), any(), any())).thenReturn(
                new vacademy.io.assessment_service.features.assessment.service.aireport.AiReportPdfService.Rendered(
                        new byte[] {1}, java.util.Map.of()));
        when(upload.upload(any(), anyString(), anyString(), anyString())).thenReturn("pdf-id");

        Assessment auto = exam(null, "AUTO");
        StudentAttempt r1 = attempt("r1", auto);
        StudentAttempt r2 = attempt("r2", auto);
        StudentAttempt r3 = attempt("r3", auto);
        spy.releaseAutomatically(List.of(r1, r2, r3), auto, "inst-1", true);

        // r2 failed (logged, recorded); the others are released once each.
        verify(release, times(1)).markReleased(org.mockito.ArgumentMatchers.eq("r1"), any(), any());
        verify(release, times(1)).markReleased(org.mockito.ArgumentMatchers.eq("r3"), any(), any());
        org.mockito.ArgumentCaptor<List<vacademy.io.assessment_service.features.assessment.notification
                .ResultNotificationService.Item>> items = org.mockito.ArgumentCaptor.forClass(List.class);
        verify(notify).sendEmails(items.capture(), any(), any(), any());
        org.assertj.core.api.Assertions.assertThat(items.getValue()).extracting(i -> i.attempt().getId())
                .containsExactlyInAnyOrder("r1", "r3");
        verify(events).publishResultReleased(anyList());
    }
}
