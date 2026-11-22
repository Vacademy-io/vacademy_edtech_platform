package vacademy.io.assessment_service.features.assessment.controller.evaluation_ai;

import org.junit.jupiter.api.Test;
import vacademy.io.assessment_service.features.assessment.dto.evaluation_ai.CreateCriteriaTemplateRequest;
import vacademy.io.assessment_service.features.assessment.dto.evaluation_ai.GenerateCriteriaRequest;
import vacademy.io.assessment_service.features.assessment.repository.AiEvaluationProcessRepository;
import vacademy.io.assessment_service.features.assessment.repository.AssessmentInstituteMappingRepository;
import vacademy.io.assessment_service.features.assessment.repository.StudentAttemptRepository;
import vacademy.io.assessment_service.features.assessment.service.evaluation_ai.AiCriteriaGenerationService;
import vacademy.io.assessment_service.features.assessment.service.evaluation_ai.EvaluationAccessValidator;
import vacademy.io.assessment_service.features.assessment.service.evaluation_ai.EvaluationCriteriaService;
import vacademy.io.assessment_service.features.notification.controller.AssessmentNotificationController;
import vacademy.io.assessment_service.features.notification.service.LearnerAssessmentNoticeService;
import vacademy.io.assessment_service.features.scheduler.controller.SchedulerTestController;
import vacademy.io.assessment_service.features.scheduler.service.LearnerSchedulerRunner;
import vacademy.io.common.auth.dto.UserServiceDTO;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * Rubric template writes and AI rubric generation are for institute staff; template reads are
 * unchanged. The manual attempt sweep and reminder-mail triggers are for platform super admins
 * (SUPER_ADMIN_USER_IDS is unset in tests, so everyone is refused).
 */
class OperationalRoutesAccessTest {

    private final EvaluationCriteriaService criteriaService = mock(EvaluationCriteriaService.class);
    private final AiCriteriaGenerationService aiService = mock(AiCriteriaGenerationService.class);
    private final EvaluationAccessValidator validator = new EvaluationAccessValidator(
            mock(StudentAttemptRepository.class), mock(AiEvaluationProcessRepository.class),
            mock(AssessmentInstituteMappingRepository.class));
    private final EvaluationCriteriaController controller =
            new EvaluationCriteriaController(criteriaService, aiService, validator);

    private static CustomUserDetails user(String... authorities) {
        UserServiceDTO dto = new UserServiceDTO();
        dto.setUserId("u-1");
        dto.setUsername("u-1");
        dto.setFullName("Test User");
        dto.setRootUser(true);
        dto.setAuthorities(List.of(authorities));
        return new CustomUserDetails(dto);
    }

    @Test
    void learnersCannotChangeRubricTemplatesOrGenerateThem() {
        CustomUserDetails learner = user("STUDENT", "TEACHER");
        CreateCriteriaTemplateRequest body = new CreateCriteriaTemplateRequest();
        assertThatThrownBy(() -> controller.createTemplate(body, learner)).isInstanceOf(RuntimeException.class);
        assertThatThrownBy(() -> controller.updateTemplate("t-1", body, learner)).isInstanceOf(RuntimeException.class);
        assertThatThrownBy(() -> controller.deleteTemplate("t-1", learner)).isInstanceOf(RuntimeException.class);
        assertThatThrownBy(() -> controller.generateCriteriaWithAi(new GenerateCriteriaRequest(), false, learner))
                .isInstanceOf(RuntimeException.class);
        verifyNoInteractions(criteriaService, aiService);
    }

    @Test
    void staffCanChangeRubricTemplatesAndEveryoneCanRead() {
        CustomUserDetails teacher = user("TEACHER");
        CreateCriteriaTemplateRequest body = new CreateCriteriaTemplateRequest();
        controller.createTemplate(body, teacher);
        controller.updateTemplate("t-1", body, user("ADMIN"));
        controller.deleteTemplate("t-1", user("EVALUATOR"));
        controller.generateCriteriaWithAi(new GenerateCriteriaRequest(), false, teacher);
        verify(criteriaService).createTemplate(body, "u-1");
        verify(criteriaService).updateTemplate("t-1", body);
        verify(criteriaService).deleteTemplate("t-1");
        verify(aiService).generateCriteria(any(), eq(false), eq("u-1"));

        when(criteriaService.getTemplatesBySubjectAndType(null, null)).thenReturn(List.of());
        assertThat(controller.getTemplates(null, null).getStatusCode().is2xxSuccessful()).isTrue();
    }

    @Test
    void manualSweepAndReminderTriggersNeedSuperAdmin() {
        LearnerSchedulerRunner runner = mock(LearnerSchedulerRunner.class);
        SchedulerTestController scheduler = new SchedulerTestController();
        org.springframework.test.util.ReflectionTestUtils.setField(scheduler, "learnerSchedulerRunner", runner);
        LearnerAssessmentNoticeService notices = mock(LearnerAssessmentNoticeService.class);
        AssessmentNotificationController notifications = new AssessmentNotificationController(notices);
        CustomUserDetails admin = user("ADMIN");

        assertThatThrownBy(() -> scheduler.testAttemptScheduler(admin)).isInstanceOf(VacademyException.class);
        assertThatThrownBy(() -> notifications.sendNotificationForUpcomingAssessments(admin))
                .isInstanceOf(VacademyException.class);
        assertThatThrownBy(() -> notifications.sendNotificationForStartedAssessments(admin))
                .isInstanceOf(VacademyException.class);
        verifyNoInteractions(runner, notices);
    }
}
