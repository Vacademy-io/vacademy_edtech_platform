package vacademy.io.admin_core_service.features.learner_quiz.answerkey;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.learner_tracking.dto.ActivityLogDTO;

import java.util.List;

/** The switches for removing correct answers, each off until its step of the rollout. */
@Component
public class AnswerKeyAccess {

    private final boolean stripOpen;
    private final boolean stripLearner;
    private final boolean stripAuthoring;
    private final boolean enforceLegacySubmit;

    public AnswerKeyAccess(@Value("${learner.quiz.strip-answer-keys.open:false}") boolean stripOpen,
            @Value("${learner.quiz.strip-answer-keys.learner:false}") boolean stripLearner,
            @Value("${learner.quiz.strip-answer-keys.authoring:false}") boolean stripAuthoring,
            @Value("${learner.quiz.legacy-submit.enforce:false}") boolean enforceLegacySubmit) {
        this.stripOpen = stripOpen;
        this.stripLearner = stripLearner;
        this.stripAuthoring = stripAuthoring;
        this.enforceLegacySubmit = enforceLegacySubmit;
    }

    public boolean isOn(AnswerKeySurface surface) {
        return switch (surface) {
            case OPEN -> stripOpen;
            case LEARNER -> stripLearner;
            case AUTHORING -> stripAuthoring;
        };
    }

    /** Whether the older activity-log endpoint checks enrolment and the attempt cap. */
    public boolean enforcesLegacySubmit() {
        return enforceLegacySubmit;
    }

    /** Whether a learner reading their attempt log loses the correct answers recorded in it. */
    public boolean stripsAttemptLogs() {
        return stripLearner;
    }

    /** A log read that is not the quiz log has no reason to carry quiz answers. */
    public ActivityLogDTO withoutQuizSidesWhenStripping(ActivityLogDTO log) {
        if (stripLearner && log != null) {
            log.setQuizSides(List.of());
        }
        return log;
    }
}
