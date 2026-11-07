package vacademy.io.assessment_service.features.assessment.service.evaluation_ai;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.assessment_service.features.assessment.copy_intake.repository.AiCopyIntakeItemRepository;
import vacademy.io.assessment_service.features.assessment.entity.AiEvaluationProcess;
import vacademy.io.assessment_service.features.assessment.entity.Assessment;
import vacademy.io.assessment_service.features.assessment.entity.AssessmentUserRegistration;
import vacademy.io.assessment_service.features.assessment.entity.StudentAttempt;
import vacademy.io.assessment_service.features.assessment.repository.AiEvaluationProcessRepository;
import vacademy.io.assessment_service.features.assessment.repository.AssessmentInstituteMappingRepository;
import vacademy.io.assessment_service.features.assessment.service.AssessmentWorkflowEventPublisher;
import vacademy.io.assessment_service.features.auth_service.service.AuthService;
import vacademy.io.assessment_service.features.notification.service.NotificationService;
import vacademy.io.assessment_service.features.open_evaluation.policy.ApiExamDigestQueries;
import vacademy.io.common.auth.dto.UserWithRolesDTO;

import java.util.Date;
import java.util.List;
import java.util.Optional;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Partner-API exams do not get the per-settle-window bell + email + automation; they get
 * one bell per exam per day (spec 12 item 5).
 */
class AiEvaluationCompletionNotifierApiExamTest {

    private NotificationService notifications;
    private AssessmentWorkflowEventPublisher workflows;
    private AuthService auth;
    private ApiExamDigestQueries digests;
    private AiEvaluationCompletionNotifier notifier;

    @BeforeEach
    void setUp() {
        AssessmentInstituteMappingRepository mappings = mock(AssessmentInstituteMappingRepository.class);
        auth = mock(AuthService.class);
        notifications = mock(NotificationService.class);
        workflows = mock(AssessmentWorkflowEventPublisher.class);
        digests = mock(ApiExamDigestQueries.class);
        notifier = new AiEvaluationCompletionNotifier(mock(AiEvaluationProcessRepository.class),
                mock(AiCopyIntakeItemRepository.class), mappings, auth, notifications, workflows);
        ReflectionTestUtils.setField(notifier, "dashboardBaseUrl", "https://dash.example");
        ReflectionTestUtils.setField(notifier, "apiExamDigestQueries", digests);
        when(mappings.findByAssessmentIdAndInstituteId(anyString(), anyString())).thenReturn(Optional.empty());
        UserWithRolesDTO admin = new UserWithRolesDTO();
        admin.setId("admin-1");
        admin.setEmail("admin@school.in");
        admin.setFullName("Admin");
        when(auth.getUsersByRoles(anyList(), eq("inst-1"))).thenReturn(List.of(admin));
    }

    private static AiEvaluationProcess processOn(Assessment exam) {
        AssessmentUserRegistration r = new AssessmentUserRegistration();
        r.setInstituteId("inst-1");
        r.setAssessment(exam);
        StudentAttempt a = new StudentAttempt();
        a.setId("att-1");
        a.setRegistration(r);
        AiEvaluationProcess p = new AiEvaluationProcess();
        p.setId("p1");
        p.setAssessment(exam);
        p.setStudentAttempt(a);
        p.setStatus("COMPLETED");
        p.setCompletedAt(new Date());
        return p;
    }

    @Test
    void api_exam_settle_window_sends_nothing() {
        Assessment exam = new Assessment();
        exam.setId("a1");
        exam.setName("Science");
        exam.setSource("API");

        notifier.announce(List.of(processOn(exam)));

        verify(notifications, never()).sendSystemAlertToUsers(anyString(), anyList(), anyString(), anyString());
        verify(notifications, never()).sendEmailToUsersReporting(any(), anyString());
        verify(workflows, never()).publishAiEvaluationBatchCompleted(any(), anyString(), any(), any());
    }

    @Test
    void daily_digest_sends_one_bell_per_claimed_exam_and_no_email() {
        when(digests.pendingDigests(any(), any())).thenReturn(List.of(
                new ApiExamDigestQueries.ExamDigest("a1", "inst-1", "Science", "EXAM", "PRIVATE", 12, 2),
                new ApiExamDigestQueries.ExamDigest("a2", "inst-1", "Maths", "EXAM", "PRIVATE", 3, 0)));
        when(digests.claimDigest(eq("a1"), any())).thenReturn(true);
        when(digests.claimDigest(eq("a2"), any())).thenReturn(false); // another pod sent it

        notifier.sendApiExamDigests();

        verify(notifications, times(1)).sendSystemAlertToUsers(eq("inst-1"), eq(List.of("admin-1")),
                contains("Science"), contains("12 copies graded, 2 need review"));
        verify(notifications, never()).sendEmailToUsersReporting(any(), anyString());
        verify(workflows, never()).publishAiEvaluationBatchCompleted(any(), anyString(), any(), any());
    }

    @Test
    void digest_job_is_a_no_op_without_its_queries() {
        ReflectionTestUtils.setField(notifier, "apiExamDigestQueries", null);
        notifier.sendApiExamDigests();
        verify(notifications, never()).sendSystemAlertToUsers(anyString(), anyList(), anyString(), anyString());
    }
}
