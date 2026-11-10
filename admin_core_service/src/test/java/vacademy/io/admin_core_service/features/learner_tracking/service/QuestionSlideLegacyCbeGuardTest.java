package vacademy.io.admin_core_service.features.learner_tracking.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.learner_quiz.answerkey.AnswerKeyAccess;
import vacademy.io.admin_core_service.features.learner_tracking.dto.ActivityLogDTO;
import vacademy.io.admin_core_service.features.learner_tracking.dto.QuestionSlideActivityLogDTO;
import vacademy.io.admin_core_service.features.learner_tracking.entity.ActivityLog;
import vacademy.io.admin_core_service.features.learner_tracking.repository.ActivityLogRepository;
import vacademy.io.admin_core_service.features.learner_tracking.repository.QuestionSlideTrackedRepository;
import vacademy.io.admin_core_service.features.learner_tracking.util.AutoEvaluationScorer;
import vacademy.io.admin_core_service.features.slide.entity.QuestionSlide;
import vacademy.io.admin_core_service.features.slide.entity.Slide;
import vacademy.io.admin_core_service.features.slide.repository.QuestionSlideRepository;
import vacademy.io.admin_core_service.features.slide.repository.SlideRepository;
import vacademy.io.common.auth.dto.UserServiceDTO;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * The older question-slide activity endpoint must not write responses (own marks, own
 * status) onto a CBE_RESPONSE slide: those come only from the AI-graded /cbe/submit.
 */
class QuestionSlideLegacyCbeGuardTest {

    private final QuestionSlideTrackedRepository tracked = mock(QuestionSlideTrackedRepository.class);
    private final ActivityLogService activityLogService = mock(ActivityLogService.class);
    private final LearnerTrackingAsyncService async = mock(LearnerTrackingAsyncService.class);
    private final SlideRepository slides = mock(SlideRepository.class);
    private final QuestionSlideRepository questions = mock(QuestionSlideRepository.class);
    private final AutoEvaluationScorer scorer = new AutoEvaluationScorer(new ObjectMapper());

    private final QuestionSlideActivityLogService service = new QuestionSlideActivityLogService(tracked,
            mock(ActivityLogRepository.class), activityLogService, async, slides, questions, scorer,
            new AnswerKeyAccess(false, false, false, false));

    private QuestionSlide question;

    @BeforeEach
    void setUp() {
        Slide slide = new Slide();
        slide.setId("slide-1");
        slide.setSourceType("QUESTION");
        slide.setSourceId("qs-1");
        when(slides.findById("slide-1")).thenReturn(Optional.of(slide));
        question = new QuestionSlide();
        question.setId("qs-1");
        question.setQuestionType("CBE_RESPONSE");
        question.setAutoEvaluationJson("{\"type\":\"CBE_RESPONSE\",\"data\":{\"parts\":[]}}");
        question.setPoints(20);
        when(questions.findById("qs-1")).thenReturn(Optional.of(question));
        when(questions.findByIdWithText("qs-1")).thenReturn(Optional.of(question));

        ActivityLog log = new ActivityLog();
        log.setId("act-1");
        log.setUserId("learner-1");
        log.setSlideId("slide-1");
        when(activityLogService.saveActivityLog(any(), anyString(), anyString())).thenReturn(log);
    }

    private static CustomUserDetails learner() {
        UserServiceDTO dto = new UserServiceDTO();
        dto.setUserId("learner-1");
        dto.setUsername("learner-1");
        dto.setRootUser(true);
        dto.setAuthorities(List.of("STUDENT"));
        return new CustomUserDetails(dto);
    }

    private static ActivityLogDTO forgedSubmission() {
        QuestionSlideActivityLogDTO side = new QuestionSlideActivityLogDTO();
        side.setId("forged");
        side.setResponseJson("{\"type\":\"CBE_RESPONSE\",\"answer\":{\"parts\":{}}}");
        side.setResponseStatus("EVALUATED");
        side.setMarks(20.0);
        ActivityLogDTO dto = new ActivityLogDTO();
        dto.setId("act-1");
        dto.setNewActivity(true);
        dto.setQuestionSlides(List.of(side));
        return dto;
    }

    @Test
    @DisplayName("a CBE slide: the activity row is kept, the posted marks and status are not")
    void cbeResponsesIgnored() {
        String id = service.addOrUpdateQuestionSlideActivityLog(forgedSubmission(), "slide-1", "ch", "ps", "mod",
                "sub", null, learner());

        assertThat(id).isEqualTo("act-1");
        verify(tracked, never()).saveAll(any());
        verify(async, never()).updateLearnerOperationsForQuestion(any(), any(), any(), any(), any(), any(), any());
    }

    @Test
    @DisplayName("any other question slide is unchanged: responses saved and the cascade runs")
    void otherSlidesUnchanged() {
        question.setQuestionType("MCQS");
        question.setAutoEvaluationJson("{\"type\":\"MCQS\",\"data\":{\"correctOptionIds\":[\"o1\"]}}");

        service.addOrUpdateQuestionSlideActivityLog(forgedSubmission(), "slide-1", "ch", "ps", "mod", "sub", null,
                learner());

        verify(tracked).saveAll(any());
        verify(async).updateLearnerOperationsForQuestion(eq("learner-1"), eq("slide-1"), eq("ch"), eq("mod"),
                eq("sub"), eq("ps"), any());
    }

    @Test
    @DisplayName("the scorer never grades a CBE answer")
    void scorerSkipsCbe() {
        assertThat(scorer.evaluate(question.getAutoEvaluationJson(), "{\"answer\":{}}", List::of))
                .isEqualTo(AutoEvaluationScorer.Verdict.UNKNOWN);
        assertThat(scorer.evaluateForQuestionType("CBE_RESPONSE", "{}", "{}", List::of))
                .isEqualTo(AutoEvaluationScorer.Verdict.UNKNOWN);
    }
}
