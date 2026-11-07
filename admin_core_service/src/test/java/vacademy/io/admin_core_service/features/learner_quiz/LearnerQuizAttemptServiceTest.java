package vacademy.io.admin_core_service.features.learner_quiz;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.transaction.PlatformTransactionManager;
import vacademy.io.admin_core_service.features.learner_quiz.dto.QuizAttemptSubmitRequest;
import vacademy.io.admin_core_service.features.learner_quiz.repository.LearnerQuizAttemptRepository;
import vacademy.io.admin_core_service.features.learner_quiz.service.LearnerQuizAccessService;
import vacademy.io.admin_core_service.features.learner_quiz.service.LearnerQuizAttemptService;
import vacademy.io.admin_core_service.features.learner_quiz.service.QuizGrader;
import vacademy.io.admin_core_service.features.learner_quiz.service.QuizLoader;
import vacademy.io.admin_core_service.features.learner_quiz.service.QuizReviewPolicy;
import vacademy.io.admin_core_service.features.learner_tracking.repository.ActivityLogRepository;
import vacademy.io.admin_core_service.features.learner_tracking.repository.QuizSlideQuestionTrackedRepository;
import vacademy.io.admin_core_service.features.learner_tracking.service.LearnerTrackingAsyncService;
import vacademy.io.admin_core_service.features.learner_tracking.util.AutoEvaluationScorer;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.InvalidRequestException;
import vacademy.io.common.exceptions.ResourceNotFoundException;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/** What is refused before any database write. The rest runs on Postgres. */
class LearnerQuizAttemptServiceTest {

    private final LearnerQuizAttemptRepository repository = mock(LearnerQuizAttemptRepository.class);
    private final ActivityLogRepository activityLogRepository = mock(ActivityLogRepository.class);
    private final LearnerQuizAccessService access = mock(LearnerQuizAccessService.class);
    private final QuizLoader loader = mock(QuizLoader.class);
    private final ObjectMapper mapper = new ObjectMapper();
    private final AutoEvaluationScorer scorer = new AutoEvaluationScorer(mapper);
    private final LearnerQuizAttemptService service = new LearnerQuizAttemptService(repository, activityLogRepository,
            mock(QuizSlideQuestionTrackedRepository.class), mock(LearnerTrackingAsyncService.class), access,
            new QuizReviewPolicy(repository, mapper, false), loader, new QuizGrader(scorer, mapper), scorer, mapper,
            mock(PlatformTransactionManager.class));
    private final CustomUserDetails user = mock(CustomUserDetails.class);

    private static QuizAttemptSubmitRequest request(String attemptId, String slideId) {
        QuizAttemptSubmitRequest request = new QuizAttemptSubmitRequest();
        request.setAttemptId(attemptId);
        request.setSlideId(slideId);
        return request;
    }

    @Test
    void attemptIdMustBeAUuid() {
        assertThatThrownBy(() -> service.submit(request("not-a-uuid", "s"), user, "i"))
                .isInstanceOf(InvalidRequestException.class);
        assertThatThrownBy(() -> service.submit(request(null, "s"), user, "i"))
                .isInstanceOf(InvalidRequestException.class);
        verifyNoInteractions(activityLogRepository);
    }

    @Test
    void slideIsRequired() {
        assertThatThrownBy(() -> service.submit(request(UUID.randomUUID().toString(), " "), user, "i"))
                .isInstanceOf(InvalidRequestException.class);
    }

    @Test
    @DisplayName("an answer past the length limit is refused")
    void overlongAnswer() {
        QuizAttemptSubmitRequest request = request(UUID.randomUUID().toString(), "s");
        QuizAttemptSubmitRequest.Answer answer = new QuizAttemptSubmitRequest.Answer();
        answer.setTextAnswer("x".repeat(20_001));
        request.setAnswers(List.of(answer));
        assertThatThrownBy(() -> service.submit(request, user, "i")).isInstanceOf(InvalidRequestException.class);
    }

    @Test
    @DisplayName("a slide that is not a quiz is not found, before access is even considered")
    void notAQuiz() {
        when(loader.load("s")).thenReturn(Optional.empty());
        assertThatThrownBy(() -> service.submit(request(UUID.randomUUID().toString(), "s"), user, "i"))
                .isInstanceOf(ResourceNotFoundException.class);
        verify(access, never()).requireAccess(any(), any(), any(), any(), any());
    }

    @Test
    void readNeedsASlide() {
        assertThatThrownBy(() -> service.getResult("", user, "i")).isInstanceOf(InvalidRequestException.class);
    }
}
