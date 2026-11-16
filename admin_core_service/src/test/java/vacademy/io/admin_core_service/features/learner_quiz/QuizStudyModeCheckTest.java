package vacademy.io.admin_core_service.features.learner_quiz;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.transaction.PlatformTransactionManager;
import vacademy.io.admin_core_service.features.learner_quiz.dto.QuizAnswerCheckRequest;
import vacademy.io.admin_core_service.features.learner_quiz.dto.QuizAnswerCheckResponse;
import vacademy.io.admin_core_service.features.learner_quiz.repository.LearnerQuizAttemptRepository;
import vacademy.io.admin_core_service.features.learner_quiz.repository.LearnerQuizAttemptRepository.QuizMetaRow;
import vacademy.io.admin_core_service.features.learner_quiz.repository.LearnerQuizAttemptRepository.SlideKindRow;
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
import vacademy.io.common.exceptions.ForbiddenException;

import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * The per-question check on a quiz in study mode ("show answer after each question"): the
 * key and the explanation come back only when the stored quiz has the setting on.
 */
class QuizStudyModeCheckTest {

    private static final String SLIDE = "slide-1";
    private static final String INSTITUTE = "inst-1";
    private static final String LEARNER = "learner-1";

    /** The institute's switches as the learner app writes them. */
    private static final String MOVE_ONLY_ON_CORRECT = "{\"setting\":{\"STUDENT_DISPLAY_SETTINGS\":{\"data\":"
            + "{\"courseSettings\":{\"quiz\":{\"showReportAndCorrectAnswers\":false,\"moveOnlyOnCorrectAnswer\":true}}}}}}";

    private final LearnerQuizAttemptRepository repository = mock(LearnerQuizAttemptRepository.class);
    private final LearnerQuizAccessService access = mock(LearnerQuizAccessService.class);
    private final QuizLoader loader = mock(QuizLoader.class);
    private final ObjectMapper mapper = new ObjectMapper();
    private final AutoEvaluationScorer scorer = new AutoEvaluationScorer(mapper);
    private final LearnerQuizAttemptService service = new LearnerQuizAttemptService(repository,
            mock(ActivityLogRepository.class), mock(QuizSlideQuestionTrackedRepository.class),
            mock(LearnerTrackingAsyncService.class), access, new QuizReviewPolicy(repository, mapper, false), loader,
            new QuizGrader(scorer, mapper), scorer, mapper, mock(PlatformTransactionManager.class));
    private final CustomUserDetails user = mock(CustomUserDetails.class);
    private final QuizMetaRow meta = mock(QuizMetaRow.class);

    private static final QuizGrader.Question MCQS = new QuizGrader.Question("q-mcqs", "MCQS", null, null,
            "{\"correctAnswers\":[\"A1\"]}", "Pick one", "<p>Because A1</p>",
            List.of(new QuizGrader.Option("A1", "Right"), new QuizGrader.Option("A2", "Other")));
    private static final QuizGrader.Question MCQM = new QuizGrader.Question("q-mcqm", "MCQM", null, null,
            "{\"correctAnswers\":[\"M1\",\"M2\"]}", "Pick all", null,
            List.of(new QuizGrader.Option("M1", "One"), new QuizGrader.Option("M2", "Two"),
                    new QuizGrader.Option("M3", "Three")));
    private static final QuizGrader.Question NUMERIC = new QuizGrader.Question("q-num", "NUMERIC", null, null,
            "{\"correctAnswers\":[\"2.5\"]}", "How much", "Half of five", List.of());
    private static final QuizGrader.Question ONE_WORD = new QuizGrader.Question("q-word", "ONE_WORD", null, null,
            "{\"data\":{\"answer\":\"Debit\"}}", "Which side", null, List.of());
    private static final QuizGrader.Question INDEXED = new QuizGrader.Question("q-idx", "TRUE_FALSE", null, null,
            "{\"correctAnswers\":[1]}", "True or false", null,
            List.of(new QuizGrader.Option("T", "True"), new QuizGrader.Option("F", "False")));

    @BeforeEach
    void setUp() {
        when(user.getUserId()).thenReturn(LEARNER);
        when(access.requireAccess(any(), any(), any(), any(), any()))
                .thenReturn(new LearnerQuizAccessService.Access(INSTITUTE, "ps", "ch"));
        SlideKindRow kind = mock(SlideKindRow.class);
        when(kind.getSourceType()).thenReturn("QUIZ");
        when(kind.getStatus()).thenReturn("PUBLISHED");
        when(repository.findSlideKind(SLIDE)).thenReturn(Optional.of(kind));
        when(repository.findQuizBySlideId(SLIDE)).thenReturn(Optional.of(meta));
        // Unlimited attempts unless a test caps them (a bare mock would report a cap of 0).
        when(meta.getReAttemptCount()).thenReturn(null);
        when(repository.findInstituteSettingJson(INSTITUTE)).thenReturn(Optional.empty());
        when(loader.load(SLIDE)).thenReturn(Optional.of(new QuizLoader.LoadedQuiz(meta,
                new QuizGrader.Rules(1.0, 0.0, false), List.of(MCQS, MCQM, NUMERIC, ONE_WORD, INDEXED))));
    }

    private void studyMode(Boolean on) {
        when(meta.getShowAnswerAfterEachQuestion()).thenReturn(on);
    }

    private QuizAnswerCheckResponse check(String questionId, List<String> options, String text) {
        QuizAnswerCheckRequest request = new QuizAnswerCheckRequest();
        request.setSlideId(SLIDE);
        request.setQuestionId(questionId);
        request.setSelectedOptionIds(options);
        request.setTextAnswer(text);
        return service.checkAnswer(request, user, INSTITUTE);
    }

    @Test
    @DisplayName("off (and never set): the quiz check stays closed under the default institute settings")
    void offStaysClosed() {
        for (Boolean off : new Boolean[] { null, Boolean.FALSE }) {
            studyMode(off);
            assertThatThrownBy(() -> check("q-mcqs", List.of("A1"), null)).isInstanceOf(ForbiddenException.class);
        }
    }

    @Test
    @DisplayName("off, under move-on-when-correct: the verdict only, as before")
    void offGivesVerdictOnly() {
        studyMode(false);
        when(repository.findInstituteSettingJson(INSTITUTE)).thenReturn(Optional.of(MOVE_ONLY_ON_CORRECT));
        QuizAnswerCheckResponse response = check("q-mcqs", List.of("A2"), null);
        assertThat(response.getCorrect()).isFalse();
        assertThat(response.getCorrectOptionIds()).isNull();
        assertThat(response.getCorrectAnswerText()).isNull();
        assertThat(response.getExplanation()).isNull();
    }

    @Test
    @DisplayName("on: a single-choice answer gets the verdict, the keyed option and the explanation")
    void singleChoice() {
        studyMode(true);
        QuizAnswerCheckResponse wrong = check("q-mcqs", List.of("A2"), null);
        assertThat(wrong.getCorrect()).isFalse();
        assertThat(wrong.getCorrectOptionIds()).containsExactly("A1");
        assertThat(wrong.getExplanation()).isEqualTo("<p>Because A1</p>");

        assertThat(check("q-mcqs", List.of("A1"), null).getCorrect()).isTrue();
    }

    @Test
    @DisplayName("on: the institute review settings do not close a study-mode quiz")
    void onWhateverTheInstituteSays() {
        studyMode(true);
        when(repository.findInstituteSettingJson(INSTITUTE)).thenReturn(Optional.of(MOVE_ONLY_ON_CORRECT));
        assertThat(check("q-mcqs", List.of("A1"), null).getCorrectOptionIds()).containsExactly("A1");
    }

    @Test
    @DisplayName("on: multiple-correct needs the whole key, and the whole key comes back")
    void multipleCorrect() {
        studyMode(true);
        QuizAnswerCheckResponse partial = check("q-mcqm", List.of("M1"), null);
        assertThat(partial.getCorrect()).isFalse();
        assertThat(partial.getCorrectOptionIds()).containsExactlyInAnyOrder("M1", "M2");
        assertThat(check("q-mcqm", List.of("M2", "M1"), null).getCorrect()).isTrue();
    }

    @Test
    @DisplayName("on: a positional key is returned as option ids")
    void positionalKey() {
        studyMode(true);
        QuizAnswerCheckResponse response = check("q-idx", List.of("T"), null);
        assertThat(response.getCorrect()).isFalse();
        assertThat(response.getCorrectOptionIds()).containsExactly("F");
    }

    @Test
    @DisplayName("on: numeric compares as numbers and returns the accepted value")
    void numeric() {
        studyMode(true);
        QuizAnswerCheckResponse right = check("q-num", null, "2.50");
        assertThat(right.getCorrect()).isTrue();
        assertThat(right.getCorrectOptionIds()).containsExactly("2.5");
        assertThat(right.getExplanation()).isEqualTo("Half of five");
        assertThat(check("q-num", null, "3").getCorrect()).isFalse();
    }

    @Test
    @DisplayName("on: a one-word question has no automatic verdict but returns the model answer")
    void oneWord() {
        studyMode(true);
        QuizAnswerCheckResponse response = check("q-word", null, "debit");
        assertThat(response.getCorrect()).isNull();
        assertThat(response.getCorrectAnswerText()).isEqualTo("Debit");
        assertThat(response.getCorrectOptionIds()).isEmpty();
    }

    @Test
    @DisplayName("on: nothing past the verdict before an answer is given")
    void noAnswerNoKey() {
        studyMode(true);
        QuizAnswerCheckResponse response = check("q-mcqs", List.of(), " ");
        assertThat(response.getCorrect()).isFalse();
        assertThat(response.getCorrectOptionIds()).isNull();
        assertThat(response.getExplanation()).isNull();
    }

    @Test
    @DisplayName("on: with no attempts left there is nothing to check")
    void attemptsExhausted() {
        studyMode(true);
        when(meta.getReAttemptCount()).thenReturn(2);
        when(repository.countQuizAttempts(LEARNER, SLIDE)).thenReturn(2L);
        assertThatThrownBy(() -> check("q-mcqs", List.of("A1"), null)).isInstanceOf(ForbiddenException.class);
    }
}
