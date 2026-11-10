package vacademy.io.admin_core_service.features.slide.cbe;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.admin_core_service.features.learner_quiz.answerkey.AuthoringAnswerAccess;
import vacademy.io.admin_core_service.features.learner_quiz.repository.LearnerQuizAttemptRepository;
import vacademy.io.admin_core_service.features.learner_quiz.repository.LearnerQuizAttemptRepository.CourseOwnerRow;
import vacademy.io.admin_core_service.features.slide.entity.QuestionSlide;
import vacademy.io.admin_core_service.features.slide.entity.Slide;
import vacademy.io.admin_core_service.features.slide.repository.QuestionSlideRepository;
import vacademy.io.admin_core_service.features.slide.repository.SlideRepository;
import vacademy.io.common.auth.dto.UserServiceDTO;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.ForbiddenException;

import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * GET .../question-slide/v1/{slideId}/evaluation-secret: the real AuthoringAnswerAccess and
 * InstituteAccessValidator, so a learner token is refused even though learners are root users.
 */
class CbeEvaluationSecretServiceTest {

    private static final String SLIDE = "slide-1";
    private static final String INSTITUTE = "inst-1";
    private static final String SECRET = "{\"parts\":[{\"id\":\"p_a\",\"solution\":{\"html\":\"x\"}}]}";

    private final LearnerQuizAttemptRepository owners = mock(LearnerQuizAttemptRepository.class);
    private final SlideRepository slides = mock(SlideRepository.class);
    private final QuestionSlideRepository questions = mock(QuestionSlideRepository.class);
    private final CbeEvaluationSecretService service = new CbeEvaluationSecretService(
            new AuthoringAnswerAccess(owners, new InstituteAccessValidator()), slides, questions);

    @BeforeEach
    void setUp() {
        CourseOwnerRow owner = mock(CourseOwnerRow.class);
        when(owner.getInstituteId()).thenReturn(INSTITUTE);
        when(owner.getCreatedByUserId()).thenReturn("course-author");
        when(owners.findOwnersOfSlide(SLIDE)).thenReturn(List.of(owner));

        Slide slide = new Slide();
        slide.setId(SLIDE);
        slide.setSourceType("QUESTION");
        slide.setSourceId("qs-1");
        when(slides.findById(SLIDE)).thenReturn(Optional.of(slide));
        QuestionSlide question = new QuestionSlide();
        question.setId("qs-1");
        question.setQuestionType("CBE_RESPONSE");
        question.setEvaluationSecretJson(SECRET);
        when(questions.findById("qs-1")).thenReturn(Optional.of(question));
    }

    @AfterEach
    void tearDown() {
        RequestContextHolder.resetRequestAttributes();
    }

    private static CustomUserDetails user(String userId, String... authorities) {
        UserServiceDTO dto = new UserServiceDTO();
        dto.setUserId(userId);
        dto.setUsername(userId);
        dto.setRootUser(true); // learners are created as root users in prod
        dto.setAuthorities(List.of(authorities));
        return new CustomUserDetails(dto);
    }

    private static void signedInTo(String clientId) {
        MockHttpServletRequest request = new MockHttpServletRequest();
        if (clientId != null) {
            request.addHeader("clientId", clientId);
        }
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));
    }

    @Test
    @DisplayName("an admin of the owning institute reads the secret")
    void adminReads() {
        signedInTo(INSTITUTE);
        assertThat(service.getEvaluationSecret(SLIDE, user("admin", "ADMIN")))
                .containsEntry("evaluation_secret_json", SECRET);
    }

    @Test
    @DisplayName("a teacher of the owning institute reads the secret")
    void teacherReads() {
        signedInTo(INSTITUTE);
        assertThat(service.getEvaluationSecret(SLIDE, user("t", "TEACHER")))
                .containsEntry("evaluation_secret_json", SECRET);
    }

    @Test
    @DisplayName("a learner token is refused, root flag or not")
    void learnerRefused() {
        signedInTo(INSTITUTE);
        assertThatThrownBy(() -> service.getEvaluationSecret(SLIDE, user("learner", "STUDENT")))
                .isInstanceOf(ForbiddenException.class);
        assertThatThrownBy(() -> service.getEvaluationSecret(SLIDE, user("learner", "STUDENT", "TEACHER")))
                .isInstanceOf(ForbiddenException.class);
    }

    @Test
    @DisplayName("staff of another institute, or with no clientId header, are refused")
    void otherInstituteRefused() {
        signedInTo("inst-other");
        assertThatThrownBy(() -> service.getEvaluationSecret(SLIDE, user("admin", "ADMIN")))
                .isInstanceOf(ForbiddenException.class);
        signedInTo(null);
        assertThatThrownBy(() -> service.getEvaluationSecret(SLIDE, user("admin", "ADMIN")))
                .isInstanceOf(ForbiddenException.class);
    }
}
