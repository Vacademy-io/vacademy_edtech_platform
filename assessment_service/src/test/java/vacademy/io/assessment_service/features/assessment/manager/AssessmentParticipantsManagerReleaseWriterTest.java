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
}
