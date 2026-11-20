package vacademy.io.assessment_service.features.assessment.manager;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.assessment_service.features.assessment.dto.admin_get_dto.response.StudentReportOverallDetailDto;
import vacademy.io.assessment_service.features.assessment.entity.Assessment;
import vacademy.io.assessment_service.features.assessment.entity.AssessmentUserRegistration;
import vacademy.io.assessment_service.features.assessment.entity.StudentAttempt;
import vacademy.io.assessment_service.features.assessment.notification.AssessmentReportNotificationService;
import vacademy.io.assessment_service.features.assessment.notification.ResultNotificationService;
import vacademy.io.assessment_service.features.assessment.service.AssessmentWorkflowEventPublisher;
import vacademy.io.assessment_service.features.assessment.service.ReleaseStateWriter;
import vacademy.io.assessment_service.features.assessment.service.ReportPdfRenderService;
import vacademy.io.assessment_service.features.assessment.service.aireport.AiReportPdfService;
import vacademy.io.assessment_service.features.client.AdminCoreServiceClient;
import vacademy.io.assessment_service.features.learner_assessment.dto.ReportClassContext;
import vacademy.io.assessment_service.features.learner_assessment.service.LearnerReportService;
import vacademy.io.common.media.service.FileService;

import java.util.HashSet;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.spy;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * A MANUAL assessment is not only a hand-checked copy: it is also used for objective tests whose
 * result is released days later. Learners with a checked copy keep getting it; learners without
 * one now get the standard result report (they used to get no email at all).
 */
class ManualReleaseStandardReportTest {

    private AssessmentParticipantsManager manager;
    private ReleaseStateWriter writer;
    private AssessmentReportNotificationService checkedCopyMailer;
    private ResultNotificationService resultMailer;
    private AdminCoreServiceClient adminCore;
    private LearnerReportService learnerReports;
    private AiReportPdfService aiReports;
    private FileService files;

    @BeforeEach
    void setUp() throws Exception {
        AssessmentParticipantsManager real = new AssessmentParticipantsManager();
        writer = mock(ReleaseStateWriter.class);
        checkedCopyMailer = mock(AssessmentReportNotificationService.class);
        resultMailer = mock(ResultNotificationService.class);
        adminCore = mock(AdminCoreServiceClient.class);
        learnerReports = mock(LearnerReportService.class);
        aiReports = mock(AiReportPdfService.class);
        files = mock(FileService.class);
        ReflectionTestUtils.setField(real, "releaseStateWriter", writer);
        ReflectionTestUtils.setField(real, "assessmentReportNotificationService", checkedCopyMailer);
        ReflectionTestUtils.setField(real, "assessmentWorkflowEventPublisher", mock(AssessmentWorkflowEventPublisher.class));
        ReflectionTestUtils.setField(real, "adminCoreServiceClient", adminCore);
        ReflectionTestUtils.setField(real, "resultNotificationService", resultMailer);
        ReflectionTestUtils.setField(real, "learnerReportService", learnerReports);
        ReflectionTestUtils.setField(real, "aiReportPdfService", aiReports);
        ReflectionTestUtils.setField(real, "reportPdfRenderService", mock(ReportPdfRenderService.class));
        ReflectionTestUtils.setField(real, "fileService", files);

        when(adminCore.isLearnerResultNotificationEnabled(anyString())).thenReturn(true);
        when(learnerReports.loadClassContext(anyString(), anyString())).thenReturn(mock(ReportClassContext.class));
        when(resultMailer.resolve(anyString(), anyString())).thenReturn(new ResultNotificationService.Templates(null, null));
        when(files.getFileFromFileId("copy-c1")).thenReturn(new byte[] {9});
        when(aiReports.renderWithVariables(any(), anyString(), anyString(), anyString(), any(), any()))
                .thenReturn(new AiReportPdfService.Rendered(new byte[] {1}, Map.of("assessment_name", "Unit Test 3")));

        manager = spy(real);
        doReturn(mock(StudentReportOverallDetailDto.class)).when(manager)
                .createStudentReportDetailResponse(any(ReportClassContext.class), anyString(), anyString());
    }

    private static Assessment manualExam() {
        Assessment a = new Assessment();
        a.setId("asmt-1");
        a.setName("Unit Test 3");
        a.setEvaluationType("MANUAL");
        return a;
    }

    private static StudentAttempt attempt(String id, Assessment exam, String status, String checkedCopyId) {
        AssessmentUserRegistration r = new AssessmentUserRegistration();
        r.setAssessment(exam);
        r.setUserId("user-" + id);
        r.setUserEmail(id + "@example.com");
        r.setStudentAttempts(new HashSet<>());
        StudentAttempt a = new StudentAttempt();
        a.setId(id);
        a.setRegistration(r);
        a.setStatus(status);
        a.setEvaluatedFileId(checkedCopyId);
        return a;
    }

    @Test
    @SuppressWarnings("unchecked")
    void checked_copy_learners_keep_the_copy_and_the_rest_get_the_standard_report() {
        Assessment exam = manualExam();
        StudentAttempt withCopy = attempt("c1", exam, "ENDED", "copy-c1");
        StudentAttempt mcqOnly = attempt("m1", exam, "ENDED", null);

        ReflectionTestUtils.invokeMethod(manager, "createParticipantsReportAndSendEmail",
                List.of(withCopy, mcqOnly), exam, "inst-1");

        verify(writer).release(withCopy);
        verify(writer).release(mcqOnly);

        ArgumentCaptor<Map<StudentAttempt, byte[]>> copies = ArgumentCaptor.forClass(Map.class);
        verify(checkedCopyMailer).sendAssessmentReportsToLearners(copies.capture(), eq("asmt-1"), eq("inst-1"));
        assertEquals(List.of(withCopy), List.copyOf(copies.getValue().keySet()));

        ArgumentCaptor<List<ResultNotificationService.Item>> items = ArgumentCaptor.forClass(List.class);
        verify(resultMailer).sendEmails(items.capture(), eq("asmt-1"), eq("inst-1"), any());
        assertEquals(1, items.getValue().size());
        assertEquals("m1", items.getValue().get(0).attempt().getId());
    }

    @Test
    void an_attempt_that_was_never_submitted_gets_no_report() {
        Assessment exam = manualExam();
        StudentAttempt notSubmitted = attempt("n1", exam, "PREVIEW", null);

        ReflectionTestUtils.invokeMethod(manager, "createParticipantsReportAndSendEmail",
                List.of(notSubmitted), exam, "inst-1");

        verify(writer).release(notSubmitted);
        verify(resultMailer, never()).sendEmails(anyList(), anyString(), anyString(), any());
    }

    @Test
    void a_checked_copy_that_cannot_be_fetched_does_not_turn_into_a_standard_report() throws Exception {
        when(files.getFileFromFileId("copy-x1")).thenThrow(new RuntimeException("storage down"));
        Assessment exam = manualExam();
        StudentAttempt copyMissing = attempt("x1", exam, "ENDED", "copy-x1");

        ReflectionTestUtils.invokeMethod(manager, "createParticipantsReportAndSendEmail",
                List.of(copyMissing), exam, "inst-1");

        verify(writer).release(copyMissing);
        verify(aiReports, never()).renderWithVariables(any(), anyString(), anyString(), anyString(), any(), any());
        verify(resultMailer, never()).sendEmails(anyList(), anyString(), anyString(), any());
    }

    @Test
    void notifications_turned_off_means_no_report_is_even_rendered() throws Exception {
        when(adminCore.isLearnerResultNotificationEnabled(anyString())).thenReturn(false);
        Assessment exam = manualExam();
        StudentAttempt mcqOnly = attempt("m1", exam, "ENDED", null);

        ReflectionTestUtils.invokeMethod(manager, "createParticipantsReportAndSendEmail",
                List.of(mcqOnly), exam, "inst-1");

        verify(writer).release(mcqOnly);
        verify(learnerReports, never()).loadClassContext(anyString(), anyString());
        verify(aiReports, never()).renderWithVariables(any(), anyString(), anyString(), anyString(), any(), any());
        verify(resultMailer, never()).sendEmails(anyList(), anyString(), anyString(), any());
    }

    @Test
    void one_learner_failing_to_render_does_not_stop_the_others() throws Exception {
        Assessment exam = manualExam();
        StudentAttempt bad = attempt("b1", exam, "ENDED", null);
        StudentAttempt good = attempt("g1", exam, "ENDED", null);
        doReturn(mock(StudentReportOverallDetailDto.class)).when(manager)
                .createStudentReportDetailResponse(any(ReportClassContext.class), eq("g1"), anyString());
        org.mockito.Mockito.doThrow(new RuntimeException("boom")).when(manager)
                .createStudentReportDetailResponse(any(ReportClassContext.class), eq("b1"), anyString());

        ReflectionTestUtils.invokeMethod(manager, "createParticipantsReportAndSendEmail",
                List.of(bad, good), exam, "inst-1");

        verify(writer).release(bad);
        verify(writer).release(good);
        @SuppressWarnings("unchecked")
        ArgumentCaptor<List<ResultNotificationService.Item>> items = ArgumentCaptor.forClass(List.class);
        verify(resultMailer).sendEmails(items.capture(), eq("asmt-1"), eq("inst-1"), any());
        assertEquals(1, items.getValue().size());
        assertEquals("g1", items.getValue().get(0).attempt().getId());
        verify(checkedCopyMailer).sendAssessmentReportsToLearners(anyMap(), anyString(), anyString());
    }
}
