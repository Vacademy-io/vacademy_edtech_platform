package vacademy.io.admin_core_service.features.learner_home.resolve;

import vacademy.io.admin_core_service.features.learner_home.model.HomeModel.Audience;
import vacademy.io.admin_core_service.features.learner_home.model.HomeModel.Condition;

import java.util.Collection;
import java.util.Set;

/**
 * "Show to": everyone, or learners who match ALL conditions. Each condition is a set test, so an
 * id that has since been deleted simply never matches (and a NOT_ENROLLED condition on it always
 * holds).
 */
public final class AudienceEvaluator {

    private AudienceEvaluator() {
    }

    public static boolean matches(Audience audience, LearnerFacts facts) {
        if (audience == null) {
            return false;
        }
        if (audience.everyone()) {
            return true;
        }
        LearnerFacts f = facts == null ? LearnerFacts.EMPTY : facts;
        // Fail closed: a rule set with nothing in it, or a condition without ids, targets nobody
        // (publish refuses both; this guards anything that slips past).
        if (audience.allOf() == null || audience.allOf().isEmpty()) {
            return false;
        }
        for (Condition c : audience.allOf()) {
            if (c.ids() == null || c.ids().isEmpty()) {
                return false;
            }
            boolean holds = switch (c.kind()) {
                case PACKAGE_SESSION -> intersects(f.packageSessionIds(), c.ids());
                case ENROLLED_IN_COURSE -> intersects(f.packageIds(), c.ids());
                case NOT_ENROLLED_IN_COURSE -> !intersects(f.packageIds(), c.ids());
                case USER_TAG -> intersects(f.tagIds(), c.ids());
            };
            if (!holds) {
                return false;
            }
        }
        return true;
    }

    private static boolean intersects(Set<String> have, Collection<String> wanted) {
        if (have == null || have.isEmpty() || wanted == null) return false;
        for (String id : wanted) {
            if (have.contains(id)) return true;
        }
        return false;
    }
}
