package vacademy.io.admin_core_service.features.learner_quiz;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.learner_quiz.repository.LearnerQuizAttemptRepository;
import vacademy.io.admin_core_service.features.learner_quiz.service.QuizReviewPolicy;
import vacademy.io.admin_core_service.features.learner_quiz.service.QuizReviewPolicy.QuizSettings;

import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class QuizReviewPolicyTest {

    private final LearnerQuizAttemptRepository repository = mock(LearnerQuizAttemptRepository.class);

    private QuizReviewPolicy policy(boolean hideWhileAttemptsLeft) {
        return new QuizReviewPolicy(repository, new ObjectMapper(), hideWhileAttemptsLeft);
    }

    private QuizSettings read(String json) {
        when(repository.findInstituteSettingJson("i")).thenReturn(Optional.ofNullable(json));
        return policy(false).settingsOf("i");
    }

    @Test
    @DisplayName("the stored path of the switches")
    void readsStoredSettings() {
        QuizSettings s = read("{\"setting\":{\"STUDENT_DISPLAY_SETTINGS\":{\"key\":\"k\",\"name\":\"n\",\"data\":"
                + "{\"courseSettings\":{\"quiz\":{\"showReportAndCorrectAnswers\":false,\"moveOnlyOnCorrectAnswer\":false}}}}}}");
        assertThat(s.showReportAndCorrectAnswers()).isFalse();
        assertThat(s.moveOnlyOnCorrectAnswer()).isFalse();
    }

    @Test
    @DisplayName("an institute that never set them gets the learner app defaults")
    void unsetMeansAppDefaults() {
        for (String json : new String[] { null, "", "{}", "{\"setting\":{}}" }) {
            QuizSettings s = read(json);
            assertThat(s.showReportAndCorrectAnswers()).isTrue();
            assertThat(s.moveOnlyOnCorrectAnswer()).isTrue();
        }
        assertThat(policy(false).settingsOf(null).showReportAndCorrectAnswers()).isTrue();
    }

    @Test
    @DisplayName("unreadable settings do not reveal answers")
    void unreadableHidesAnswers() {
        assertThat(read("not json").showReportAndCorrectAnswers()).isFalse();
        assertThat(read("not json").moveOnlyOnCorrectAnswer()).as("nor open the per-question check").isFalse();
    }

    @Test
    @DisplayName("nobody sees answers before submitting")
    void noAttemptNoAnswers() {
        assertThat(policy(false).mayShowAnswers(new QuizSettings(true, false), 0, null)).isFalse();
    }

    @Test
    void settingOffHidesAnswers() {
        assertThat(policy(false).mayShowAnswers(new QuizSettings(false, false), 3, 0)).isFalse();
    }

    @Test
    @DisplayName("today's behaviour: shown after any attempt, attempts left or not")
    void defaultShowsAfterAnyAttempt() {
        QuizReviewPolicy p = policy(false);
        assertThat(p.mayShowAnswers(new QuizSettings(true, false), 1, 2)).isTrue();
        assertThat(p.mayShowAnswers(new QuizSettings(true, false), 1, null)).isTrue();
    }

    @Test
    @DisplayName("the stricter option waits for the last attempt, and a quiz with no cap never reveals")
    void stricterOption() {
        QuizReviewPolicy p = policy(true);
        assertThat(p.mayShowAnswers(new QuizSettings(true, false), 1, 2)).isFalse();
        assertThat(p.mayShowAnswers(new QuizSettings(true, false), 3, 0)).isTrue();
        assertThat(p.mayShowAnswers(new QuizSettings(true, false), 3, null)).isFalse();
    }
}
