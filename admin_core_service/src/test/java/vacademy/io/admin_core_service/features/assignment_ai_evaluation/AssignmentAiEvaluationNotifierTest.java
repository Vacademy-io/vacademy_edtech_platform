package vacademy.io.admin_core_service.features.assignment_ai_evaluation;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.assignment_ai_evaluation.entity.AssignmentAiEvaluation;
import vacademy.io.admin_core_service.features.assignment_ai_evaluation.entity.AssignmentAiEvaluationBatch;
import vacademy.io.admin_core_service.features.assignment_ai_evaluation.repository.AssignmentAiEvaluationBatchRepository;
import vacademy.io.admin_core_service.features.assignment_ai_evaluation.repository.AssignmentAiEvaluationRepository;
import vacademy.io.admin_core_service.features.assignment_ai_evaluation.service.AssignmentAiEvaluationNotifier;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.admin_core_service.features.notification_service.service.NotificationService;
import vacademy.io.admin_core_service.features.slide.entity.Slide;
import vacademy.io.admin_core_service.features.slide.repository.SlideRepository;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.institute.entity.Institute;

import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class AssignmentAiEvaluationNotifierTest {

    private AssignmentAiEvaluationRepository evaluationRepository;
    private InstituteRepository instituteRepository;
    private AuthService authService;
    private NotificationService notificationService;
    private AssignmentAiEvaluationNotifier notifier;
    private AssignmentAiEvaluationBatchRepository batchRepository;
    private AssignmentAiEvaluation evaluation;
    private Institute institute;

    @BeforeEach
    void setUp() {
        evaluationRepository = mock(AssignmentAiEvaluationRepository.class);
        SlideRepository slideRepository = mock(SlideRepository.class);
        instituteRepository = mock(InstituteRepository.class);
        authService = mock(AuthService.class);
        notificationService = mock(NotificationService.class);
        batchRepository = mock(AssignmentAiEvaluationBatchRepository.class);
        notifier = new AssignmentAiEvaluationNotifier(evaluationRepository, batchRepository, slideRepository,
                instituteRepository, authService, notificationService);

        evaluation = new AssignmentAiEvaluation();
        evaluation.setId("run-1");
        evaluation.setInstituteId("inst-1");
        evaluation.setSlideId("slide-1");
        evaluation.setUserId("learner-1");
        evaluation.setTriggeredBy("teacher-1");
        evaluation.setStatus(AssignmentAiEvaluation.STATUS_COMPLETED);
        evaluation.setMarksAwarded(14.0);
        evaluation.setMaxMarks(20.0);
        evaluation.setFeedback("Clear <b>diagram</b>");
        when(evaluationRepository.findById("run-1")).thenReturn(Optional.of(evaluation));

        Slide slide = new Slide();
        slide.setTitle("Photosynthesis");
        when(slideRepository.findById("slide-1")).thenReturn(Optional.of(slide));

        institute = new Institute();
        institute.setInstituteName("Green Valley School");
        institute.setInstituteThemeCode("2E7D32");
        when(instituteRepository.findById("inst-1")).thenReturn(Optional.of(institute));

        when(authService.getUsersFromAuthServiceByUserIds(List.of("teacher-1")))
                .thenReturn(List.of(user("teacher-1", "Asha Rao", "asha@school.test")));
        when(authService.getUsersFromAuthServiceByUserIds(List.of("learner-1")))
                .thenReturn(List.of(user("learner-1", "Ravi Kumar", "ravi@school.test")));
    }

    @Test
    void completedRunAlertsAndEmailsOnlyTheTeacherWhoStartedIt() {
        notifier.notifyFinished("run-1");

        verify(notificationService).createSystemAlertAnnouncement(eq("inst-1"), eq(List.of("teacher-1")),
                contains("Ravi Kumar"), contains("14 / 20"), anyString(), eq("Green Valley School"), isNull(), anyMap());
        verify(notificationService, times(1)).sendHtmlEmailViaUnified(eq("asha@school.test"), contains("review"),
                argThat(body -> body.contains("Save Grade") && body.contains("Green Valley School")
                        && body.contains("#2E7D32") && body.contains("Clear &lt;b&gt;diagram&lt;/b&gt;")),
                eq("inst-1"), isNull(), eq("Green Valley School"), anyString());
        // The learner is never a recipient.
        verify(notificationService, never()).sendHtmlEmailViaUnified(eq("ravi@school.test"), anyString(), anyString(),
                anyString(), any(), any(), anyString());
    }

    @Test
    void failedRunSaysWhyAndSuggestsManualGrading() {
        evaluation.setStatus(AssignmentAiEvaluation.STATUS_FAILED);
        evaluation.setErrorMessage("unreadable copy");

        notifier.notifyFinished("run-1");

        verify(notificationService).createSystemAlertAnnouncement(eq("inst-1"), eq(List.of("teacher-1")),
                contains("could not check"), contains("unreadable copy"), anyString(), anyString(), isNull(), anyMap());
    }

    @Test
    void noInstituteNameMeansNoEmailRatherThanAPlatformDefault() {
        institute.setInstituteName(null);

        notifier.notifyFinished("run-1");

        verify(notificationService).createSystemAlertAnnouncement(anyString(), anyList(), anyString(), anyString(),
                anyString(), anyString(), isNull(), anyMap());
        verify(notificationService, never()).sendHtmlEmailViaUnified(anyString(), anyString(), anyString(),
                anyString(), any(), any(), anyString());
    }

    @Test
    void aNoticeFailureNeverEscapes() {
        doThrow(new RuntimeException("auth down")).when(authService).getUsersFromAuthServiceByUserIds(anyList());
        assertDoesNotThrow(() -> notifier.notifyFinished("run-1"));
    }

    @Test
    void aFinishedBatchSendsOneSummaryToTheTeacher() {
        AssignmentAiEvaluationBatch batch = new AssignmentAiEvaluationBatch();
        batch.setId("batch-1");
        batch.setSlideId("slide-1");
        batch.setInstituteId("inst-1");
        batch.setTriggeredBy("teacher-1");
        when(batchRepository.claimNotice("batch-1")).thenReturn(1).thenReturn(0);
        when(batchRepository.findById("batch-1")).thenReturn(Optional.of(batch));
        when(evaluationRepository.countByStatusForBatch("batch-1")).thenReturn(List.of(
                new Object[]{"COMPLETED", 28L}, new Object[]{"FAILED", 2L}));

        notifier.notifyBatchFinished("batch-1");
        notifier.notifyBatchFinished("batch-1"); // the last two copies finished together

        verify(notificationService, times(1)).createSystemAlertAnnouncement(eq("inst-1"), eq(List.of("teacher-1")),
                contains("28 of 30"), argThat(text -> text.contains("2 could not be checked")
                        && text.contains("Photosynthesis") && text.contains("Save Grade")),
                anyString(), anyString(), isNull(), anyMap());
        verify(notificationService, times(1)).sendHtmlEmailViaUnified(eq("asha@school.test"), contains("28 of 30"),
                anyString(), eq("inst-1"), isNull(), eq("Green Valley School"), anyString());
    }

    @Test
    void anUnfinishedBatchSendsNothing() {
        when(batchRepository.claimNotice("batch-1")).thenReturn(0);
        notifier.notifyBatchFinished("batch-1");
        verifyNoInteractions(notificationService);
    }

    private static UserDTO user(String id, String name, String email) {
        UserDTO user = new UserDTO();
        user.setId(id);
        user.setFullName(name);
        user.setEmail(email);
        return user;
    }
}
