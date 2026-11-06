package vacademy.io.admin_core_service.features.learner_quiz.answerkey;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.stereotype.Component;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.Set;

/**
 * The switches for removing correct answers, each off until its step of the rollout, and who
 * keeps them on authoring reads. The root flag is not read: learners are created as root.
 */
@Component
public class AnswerKeyAccess {

    private static final Set<String> LEARNER_ONLY = Set.of("STUDENT", "PARENT", "GUARDIAN");

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

    /**
     * Staff keep answers on authoring reads: an editor that loads a quiz without them could
     * not show or save them. Anyone holding any authority beyond the learner roles counts,
     * since a learner who may create courses carries TEACHER too and edits their own quizzes.
     * The authorities are minted for the clientId header's institute, and the admin dashboard
     * and the AI assistant both send it.
     */
    public boolean keepsAnswersOnAuthoringRead(CustomUserDetails user) {
        if (user == null || user.getAuthorities() == null) {
            return false;
        }
        return user.getAuthorities().stream()
                .map(GrantedAuthority::getAuthority)
                .anyMatch(authority -> authority != null && !LEARNER_ONLY.contains(authority.trim().toUpperCase()));
    }
}
