package vacademy.io.assessment_service.features.assessment.manager;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.Mockito;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.assessment_service.features.assessment.dto.admin_get_dto.response.StudentReportOverallDetailDto;
import vacademy.io.assessment_service.features.assessment.entity.Assessment;
import vacademy.io.assessment_service.features.assessment.entity.AssessmentUserRegistration;
import vacademy.io.assessment_service.features.assessment.entity.StudentAttempt;
import vacademy.io.assessment_service.features.assessment.notification.AssessmentReportNotificationService;
import vacademy.io.assessment_service.features.assessment.notification.ResultNotificationService;
import vacademy.io.assessment_service.features.assessment.repository.StudentAttemptRepository;
import vacademy.io.assessment_service.features.assessment.service.AssessmentWorkflowEventPublisher;
import vacademy.io.assessment_service.features.assessment.service.ReleaseStateWriter;
import vacademy.io.assessment_service.features.assessment.service.ReportPdfRenderService;
import vacademy.io.assessment_service.features.assessment.service.ReportPdfUploadService;
import vacademy.io.assessment_service.features.assessment.service.aireport.AiReportPdfService;
import vacademy.io.assessment_service.features.client.AdminCoreServiceClient;
import vacademy.io.assessment_service.features.learner_assessment.dto.ReportClassContext;
import vacademy.io.assessment_service.features.learner_assessment.service.LearnerReportService;
import vacademy.io.assessment_service.features.submission_review.service.SubmissionReleaseService;
import vacademy.io.assessment_service.features.submission_review.service.SubmissionReleaseService.ReleaseContext;
import vacademy.io.assessment_service.features.submission_review.service.SubmissionReleaseService.Source;
import vacademy.io.assessment_service.features.submission_review.service.SubmissionResultMailer;
import vacademy.io.common.media.service.FileService;

import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Live follow-up B2 (2026-11-19), owner decision 4: "Send updated result" sends the learner
 * ONE "your result was updated" email. It must not publish ASSESSMENT_RESULT_RELEASED again
 * (institute workflows / WhatsApp automations fired a second time on prod) nor resend the
 * "result released" email / WhatsApp templates. A real first release (also the one after
 * "Hide result again") still does both.
 */
class ResultUpdateMessageTest {

    private AssessmentParticipantsManager manager;
    private AssessmentWorkflowEventPublisher events;
    private ResultNotificationService notify;
    private AssessmentReportNotificationService reports;

    @BeforeEach
    void setUp() throws Exception {
        AssessmentParticipantsManager real = new AssessmentParticipantsManager();
        manager = Mockito.spy(real);
        events = mock(AssessmentWorkflowEventPublisher.class);
        notify = mock(ResultNotificationService.class);
        reports = mock(AssessmentReportNotificationService.class);
        AdminCoreServiceClient adminCore = mock(AdminCoreServiceClient.class);
        when(adminCore.isLearnerResultNotificationEnabled(anyString())).thenReturn(true);
        AiReportPdfService aiPdf = mock(AiReportPdfService.class);
        ReportPdfUploadService upload = mock(ReportPdfUploadService.class);
        SubmissionReleaseService release = mock(SubmissionReleaseService.class);
        FileService files = mock(FileService.class);
        ReflectionTestUtils.setField(manager, "assessmentWorkflowEventPublisher", events);
        ReflectionTestUtils.setField(manager, "resultNotificationService", notify);
        ReflectionTestUtils.setField(manager, "assessmentReportNotificationService", reports);
        ReflectionTestUtils.setField(manager, "adminCoreServiceClient", adminCore);
        ReflectionTestUtils.setField(manager, "learnerReportService", mock(LearnerReportService.class));
        ReflectionTestUtils.setField(manager, "aiReportPdfService", aiPdf);
        ReflectionTestUtils.setField(manager, "reportPdfUploadService", upload);
        ReflectionTestUtils.setField(manager, "reportPdfRenderService", mock(ReportPdfRenderService.class));
        ReflectionTestUtils.setField(manager, "releaseStateWriter", mock(ReleaseStateWriter.class));
        ReflectionTestUtils.setField(manager, "submissionReleaseService", release);
        ReflectionTestUtils.setField(manager, "fileService", files);
        when(release.markReleased(anyString(), any(), any()))
                .thenReturn(new SubmissionReleaseService.ReleaseOutcome(true, 0, List.of(), true));
        Mockito.doReturn(new StudentReportOverallDetailDto()).when(manager).createStudentReportDetailResponse(
                Mockito.nullable(ReportClassContext.class), anyString(), anyString());
        when(aiPdf.renderWithVariables(any(), any(), any(), any(), any(), any()))
                .thenReturn(new AiReportPdfService.Rendered(new byte[] {1}, Map.of("assessment_name", "Accounts 1")));
        when(upload.upload(any(), anyString(), anyString(), anyString())).thenReturn("pdf-id");
        when(files.getFileFromFileId(anyString())).thenReturn(new byte[] {1});
        when(notify.resolve(anyString(), anyString())).thenReturn(new ResultNotificationService.Templates(
                Map.of("subject", "Results are out", "content", "<p>released</p>"), Map.of("name", "result_wa")));
    }

    private static Assessment exam(String evaluationType) {
        Assessment a = new Assessment();
        a.setId("a1");
        a.setName("Accounts 1");
        a.setEvaluationType(evaluationType);
        return a;
    }

    private static StudentAttempt attempt(Assessment exam) {
        AssessmentUserRegistration r = new AssessmentUserRegistration();
        r.setAssessment(exam);
        r.setInstituteId("inst-1");
        r.setStudentAttempts(new HashSet<>());
        StudentAttempt a = new StudentAttempt();
        a.setId("att-1");
        a.setRegistration(r);
        a.setStatus("ENDED");
        a.setReportReleaseStatus("RELEASED");
        a.setEvaluatedFileId("copy-1");
        return a;
    }

    private static ReleaseContext ctx(Source source) {
        return new ReleaseContext("teacher-1", source, false);
    }

    @Test
    void send_update_sends_one_updated_email_and_no_release_event_or_release_templates() {
        Assessment exam = exam("AUTO");
        // Even if a caller still asks for the workflow, an update never fires it.
        manager.releaseAutomatically(List.of(attempt(exam)), exam, "inst-1", true, ctx(Source.SEND_UPDATE));

        ArgumentCaptor<ResultNotificationService.Templates> templates =
                ArgumentCaptor.forClass(ResultNotificationService.Templates.class);
        verify(notify).sendEmails(anyList(), eq("a1"), eq("inst-1"), templates.capture());
        assertThat(templates.getValue().email().get("subject")).isEqualTo("Your result for Accounts 1 was updated");
        assertThat((String) templates.getValue().email().get("content")).contains("Your result was updated");
        assertThat(templates.getValue().whatsapp()).isNull();
        verify(notify, never()).resolve(anyString(), anyString());
        verify(events, never()).publishResultReleased(anyList());
    }

    @Test
    void first_release_render_still_sends_the_release_templates_and_fires_the_event() {
        Assessment exam = exam("AUTO");
        manager.releaseAutomatically(List.of(attempt(exam)), exam, "inst-1", true, ctx(Source.RENDER));

        ArgumentCaptor<ResultNotificationService.Templates> templates =
                ArgumentCaptor.forClass(ResultNotificationService.Templates.class);
        verify(notify).sendEmails(anyList(), eq("a1"), eq("inst-1"), templates.capture());
        assertThat(templates.getValue().email().get("subject")).isEqualTo("Results are out");
        verify(notify).sendWhatsApps(anyList(), eq("a1"), eq("inst-1"), any());
        verify(events).publishResultReleased(anyList());
    }

    @Test
    void send_update_on_a_hand_marked_test_emails_the_checked_copy_as_an_update() {
        Assessment exam = exam("MANUAL");
        manager.releaseAutomatically(List.of(attempt(exam)), exam, "inst-1", true, ctx(Source.SEND_UPDATE));

        verify(reports).sendAssessmentReportsToLearners(anyMap(), eq("a1"), eq("inst-1"),
                eq("Your result for Accounts 1 was updated"), Mockito.contains("Your result was updated"));
        verify(reports, never()).sendAssessmentReportsToLearners(anyMap(), anyString(), anyString());
        verify(events, never()).publishResultReleased(anyList());
    }

    @Test
    void release_again_after_a_hide_on_a_hand_marked_test_is_a_release() {
        Assessment exam = exam("MANUAL");
        manager.releaseAutomatically(List.of(attempt(exam)), exam, "inst-1", true, ctx(Source.RENDER));

        verify(reports).sendAssessmentReportsToLearners(anyMap(), eq("a1"), eq("inst-1"));
        verify(events).publishResultReleased(anyList());
    }

    @Test
    void mailer_asks_for_the_release_event_only_on_a_release() {
        StudentAttemptRepository attempts = mock(StudentAttemptRepository.class);
        AssessmentParticipantsManager pm = mock(AssessmentParticipantsManager.class);
        SubmissionResultMailer mailer = new SubmissionResultMailer(attempts);
        ReflectionTestUtils.setField(mailer, "participantsManager", pm);
        Assessment exam = exam("AUTO");
        StudentAttempt a = attempt(exam);
        when(attempts.findById("att-1")).thenReturn(Optional.of(a));

        mailer.renderNow("att-1", Source.SEND_UPDATE, "teacher-1");
        verify(pm).releaseAutomatically(eq(List.of(a)), eq(exam), eq("inst-1"), eq(false), any(ReleaseContext.class));

        mailer.renderNow("att-1", Source.RENDER, "teacher-1");
        verify(pm).releaseAutomatically(eq(List.of(a)), eq(exam), eq("inst-1"), eq(true), any(ReleaseContext.class));
    }
}
