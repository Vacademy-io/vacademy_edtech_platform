package vacademy.io.admin_core_service.features.learner_quiz.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import java.util.List;
import vacademy.io.admin_core_service.features.learner_quiz.repository.LearnerQuizAttemptRepository;

/**
 * Decides what a learner may see after submitting. The rule comes from the institute's
 * student display settings, read here because the same switch in the learner app is only a
 * display choice: {@code courseSettings.quiz.showReportAndCorrectAnswers}, on unless the
 * institute turned it off.
 */
@Slf4j
@Component
public class QuizReviewPolicy {

    private final LearnerQuizAttemptRepository repository;
    private final ObjectMapper objectMapper;
    private final boolean hideWhileAttemptsLeft;

    public QuizReviewPolicy(LearnerQuizAttemptRepository repository, ObjectMapper objectMapper,
            @Value("${learner.quiz.review.hide-answers-while-attempts-left:false}") boolean hideWhileAttemptsLeft) {
        this.repository = repository;
        this.objectMapper = objectMapper;
        this.hideWhileAttemptsLeft = hideWhileAttemptsLeft;
    }

    public record QuizSettings(boolean showReportAndCorrectAnswers, boolean moveOnlyOnCorrectAnswer) {
    }

    public QuizSettings settingsOf(String instituteId) {
        // The learner app's own defaults, so both ends read an unset switch the same way.
        QuizSettings defaults = new QuizSettings(true, true);
        if (!StringUtils.hasText(instituteId)) {
            return defaults;
        }
        try {
            String json = repository.findInstituteSettingJson(instituteId).orElse(null);
            if (!StringUtils.hasText(json)) {
                return defaults;
            }
            JsonNode quiz = objectMapper.readTree(json)
                    .path("setting").path("STUDENT_DISPLAY_SETTINGS").path("data")
                    .path("courseSettings").path("quiz");
            return new QuizSettings(quiz.path("showReportAndCorrectAnswers").asBoolean(true),
                    quiz.path("moveOnlyOnCorrectAnswer").asBoolean(true));
        } catch (Exception e) {
            // Settings that cannot be read must not reveal more than the institute chose.
            log.warn("[quiz-review] Unreadable settings for institute {}: {}", instituteId, e.getMessage());
            return new QuizSettings(false, false);
        }
    }

    /** Settings for someone not reading through any one institute: all of them must allow it. */
    public QuizSettings strictestOf(List<String> instituteIds) {
        if (instituteIds == null || instituteIds.isEmpty()) {
            return new QuizSettings(false, false);
        }
        boolean show = true;
        boolean moveOnly = true;
        for (String instituteId : instituteIds) {
            QuizSettings settings = settingsOf(instituteId);
            show &= settings.showReportAndCorrectAnswers();
            moveOnly &= settings.moveOnlyOnCorrectAnswer();
        }
        return new QuizSettings(show, moveOnly);
    }

    /**
     * @param attemptsUsed attempts of this learner on this quiz with recorded answers
     * @param attemptsLeft null when the quiz does not cap attempts
     */
    public boolean mayShowAnswers(QuizSettings settings, int attemptsUsed, Integer attemptsLeft) {
        if (attemptsUsed < 1 || !settings.showReportAndCorrectAnswers()) {
            return false;
        }
        if (!hideWhileAttemptsLeft) {
            return true;
        }
        return attemptsLeft != null && attemptsLeft <= 0;
    }
}
