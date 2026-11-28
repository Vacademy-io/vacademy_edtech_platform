package vacademy.io.admin_core_service.features.learner_tracking.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import vacademy.io.admin_core_service.features.common.entity.RichTextData;
import vacademy.io.admin_core_service.features.learner_quiz.answerkey.AnswerKeyAccess;
import vacademy.io.admin_core_service.features.learner_tracking.dto.ActivityLogDTO;
import vacademy.io.admin_core_service.features.learner_tracking.dto.QuestionSlideActivityLogDTO;
import vacademy.io.admin_core_service.features.learner_tracking.dto.QuestionSlideResultDTO;
import vacademy.io.admin_core_service.features.learner_tracking.entity.ActivityLog;
import vacademy.io.admin_core_service.features.learner_tracking.entity.QuestionSlideTracked;
import vacademy.io.admin_core_service.features.learner_tracking.repository.ActivityLogRepository;
import vacademy.io.admin_core_service.features.learner_tracking.repository.QuestionSlideTrackedRepository;
import vacademy.io.admin_core_service.features.learner_tracking.util.AutoEvaluationScorer;
import vacademy.io.admin_core_service.features.slide.entity.Option;
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
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * What a learner is told after answering a QUESTION slide, the grade stored for the admin's
 * activity stats, and attempt numbering.
 */
class QuestionSlideResultTest {

    private static final String KEY = "{\"type\":\"MCQS\",\"data\":{\"correctOptionIds\":[\"b\"]}}";
    private static final String PICKED_A = "{\"questionName\":\"q\",\"selectedOptions\":[{\"id\":\"a\",\"name\":\"<p>A</p>\"}]}";
    private static final String PICKED_B = "{\"questionName\":\"q\",\"selectedOptions\":[{\"id\":\"b\",\"name\":\"<p>B</p>\"}]}";

    private final QuestionSlideTrackedRepository tracked = mock(QuestionSlideTrackedRepository.class);
    private final ActivityLogService activityLogService = mock(ActivityLogService.class);
    private final SlideRepository slides = mock(SlideRepository.class);
    private final QuestionSlideRepository questions = mock(QuestionSlideRepository.class);

    private final QuestionSlideActivityLogService service = new QuestionSlideActivityLogService(tracked,
            mock(ActivityLogRepository.class), activityLogService, mock(LearnerTrackingAsyncService.class), slides,
            questions, new AnswerKeyAccess(false, false, false, false),
            new QuestionSlideGrader(new AutoEvaluationScorer(new ObjectMapper())));

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
        question.setQuestionType("MCQS");
        question.setAutoEvaluationJson(KEY);
        question.setPoints(1);
        Option a = new Option();
        a.setId("a");
        Option b = new Option();
        b.setId("b");
        question.setOptions(List.of(a, b));
        RichTextData explanation = new RichTextData();
        explanation.setContent("<p>Because B.</p>");
        question.setExplanationTextData(explanation);
        when(questions.findById("qs-1")).thenReturn(Optional.of(question));
        when(questions.findByIdWithText("qs-1")).thenReturn(Optional.of(question));
    }

    private static CustomUserDetails learner() {
        UserServiceDTO dto = new UserServiceDTO();
        dto.setUserId("learner-1");
        dto.setUsername("learner-1");
        dto.setAuthorities(List.of("STUDENT"));
        return new CustomUserDetails(dto);
    }

    private void latest(String status, String responseJson, int attemptNumber) {
        QuestionSlideTracked row = new QuestionSlideTracked();
        row.setId("t-1");
        row.setResponseStatus(status);
        row.setResponseJson(responseJson);
        row.setAttemptNumber(attemptNumber);
        when(tracked.findLatestSubmission("learner-1", "slide-1")).thenReturn(Optional.of(row));
        when(tracked.countSubmissions("learner-1", "slide-1")).thenReturn((long) attemptNumber);
    }

    @Test
    @DisplayName("before any submission nothing about the answer is returned")
    void nothingBeforeSubmit() {
        QuestionSlideResultDTO result = service.getMyResult("slide-1", learner());

        assertThat(result.isSubmitted()).isFalse();
        assertThat(result.isShowAnswer()).isTrue();
        assertThat(result.getVerdict()).isNull();
        assertThat(result.getCorrectOptionIds()).isEmpty();
        assertThat(result.getExplanationHtml()).isNull();
    }

    @Test
    @DisplayName("setting on (the default): verdict, correct option and explanation")
    void shownWhenOn() {
        latest("WRONG", PICKED_A, 2);

        QuestionSlideResultDTO result = service.getMyResult("slide-1", learner());

        assertThat(result.isSubmitted()).isTrue();
        assertThat(result.getVerdict()).isEqualTo("WRONG");
        assertThat(result.getCorrectOptionIds()).containsExactly("b");
        assertThat(result.getAttemptNumber()).isEqualTo(2);
        assertThat(result.getAttempts()).isEqualTo(2);
        assertThat(result.getExplanationHtml()).isEqualTo("<p>Because B.</p>");
        assertThat(result.getResponseJson()).isEqualTo(PICKED_A);
    }

    @Test
    @DisplayName("setting off: no verdict and no answer, the explanation stays as before")
    void hiddenWhenOff() {
        question.setShowAnswerAfterSubmit(false);
        latest("CORRECT", PICKED_B, 1);

        QuestionSlideResultDTO result = service.getMyResult("slide-1", learner());

        assertThat(result.isShowAnswer()).isFalse();
        assertThat(result.isSubmitted()).isTrue();
        assertThat(result.getVerdict()).isNull();
        assertThat(result.getCorrectOptionIds()).isEmpty();
        assertThat(result.getCorrectAnswers()).isEmpty();
        assertThat(result.getExplanationHtml()).isEqualTo("<p>Because B.</p>");
    }

    @Test
    @DisplayName("a null setting (rows from before the column) reads as on")
    void nullSettingIsOn() {
        question.setShowAnswerAfterSubmit(null);
        latest("CORRECT", PICKED_B, 1);

        assertThat(service.getMyResult("slide-1", learner()).getVerdict()).isEqualTo("CORRECT");
    }

    @Test
    @DisplayName("an answer saved as SUBMITTED before grading worked is graded on read")
    void legacySubmittedRegraded() {
        latest("SUBMITTED", PICKED_B, 1);

        assertThat(service.getMyResult("slide-1", learner()).getVerdict()).isEqualTo("CORRECT");
    }

    @Test
    @DisplayName("a Spreadsheet & Written Response slide gets nothing here")
    void cbeSlide() {
        question.setQuestionType("CBE_RESPONSE");
        question.setAutoEvaluationJson("{\"type\":\"CBE_RESPONSE\",\"data\":{\"parts\":[]}}");
        latest("EVALUATED", "{}", 1);

        QuestionSlideResultDTO result = service.getMyResult("slide-1", learner());

        assertThat(result.isShowAnswer()).isFalse();
        assertThat(result.isSubmitted()).isFalse();
    }

    @Test
    @DisplayName("a submission is graded for the activity stats and numbered after earlier ones")
    @SuppressWarnings("unchecked")
    void submitGradesAndNumbers() {
        ActivityLog log = new ActivityLog();
        log.setId("act-3");
        log.setUserId("learner-1");
        log.setSlideId("slide-1");
        when(activityLogService.saveActivityLog(any(), anyString(), anyString())).thenReturn(log);
        when(tracked.countSubmissionsOutsideActivity("learner-1", "slide-1", "act-3")).thenReturn(2L);

        QuestionSlideActivityLogDTO side = new QuestionSlideActivityLogDTO();
        side.setId("side-1");
        side.setAttemptNumber(1);
        side.setResponseJson(PICKED_B);
        side.setResponseStatus("SUBMITTED");
        side.setMarks(0.0);
        ActivityLogDTO dto = new ActivityLogDTO();
        dto.setId("act-3");
        dto.setNewActivity(true);
        dto.setQuestionSlides(List.of(side));

        service.addOrUpdateQuestionSlideActivityLog(dto, "slide-1", "ch", "ps", "mod", "sub", null, learner());

        ArgumentCaptor<List<QuestionSlideTracked>> saved = ArgumentCaptor.forClass(List.class);
        verify(tracked).saveAll(saved.capture());
        QuestionSlideTracked row = saved.getValue().get(0);
        assertThat(row.getResponseStatus()).isEqualTo("CORRECT");
        assertThat(row.getMarks()).isEqualTo(1.0);
        assertThat(row.getAttemptNumber()).isEqualTo(3);
    }
}
