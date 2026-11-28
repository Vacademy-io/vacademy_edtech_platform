package vacademy.io.admin_core_service.features.learner_study_library.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.institute_learner.repository.StudentSessionInstituteGroupMappingRepository;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.util.List;
import java.util.Set;

/**
 * Server-side enrollment check for the authenticated learner content endpoints
 * (LearnerStudyLibraryController). Until now no content endpoint looked at enrollment:
 * the learner app hid courses a learner was not enrolled in, but the API served any
 * package session's subjects, modules, chapters and slides to any logged-in learner —
 * so a revoked, expired or never-bought course stayed readable through the API.
 *
 * <p>OFF by default ({@code learner.content.enrollment-guard.enabled}). Turn it on per
 * environment after checking that no learner screen reads content for a course the
 * learner is not enrolled in (e.g. a curriculum preview on the course details page uses
 * the open endpoints, which this guard does not touch).
 *
 * <p>Only learners are checked: root users and anyone holding a staff role (admin,
 * teacher, evaluator, course creator) pass, so admin previews keep working. A learner
 * passes with a live membership in the package session — the same rule the learner's
 * "my courses" list uses (ACTIVE, not an abandoned-cart / failed-payment placeholder).
 */
@Slf4j
@Component
public class LearnerContentAccessGuard {

    private static final Set<String> STAFF_AUTHORITIES = Set.of("ADMIN", "TEACHER", "EVALUATOR", "COURSE_CREATOR");

    private final StudentSessionInstituteGroupMappingRepository membershipRepository;
    private final boolean enabled;

    public LearnerContentAccessGuard(StudentSessionInstituteGroupMappingRepository membershipRepository,
                                     @Value("${learner.content.enrollment-guard.enabled:false}") boolean enabled) {
        this.membershipRepository = membershipRepository;
        this.enabled = enabled;
    }

    /** Throws when the guard is on and a learner reads a package session they hold no live membership in. */
    public void requireEnrolled(CustomUserDetails user, String packageSessionId) {
        if (!enabled || user == null || !StringUtils.hasText(packageSessionId) || isStaff(user)) {
            return;
        }
        if (!membershipRepository.existsActiveMembership(user.getUserId(), List.of(packageSessionId))) {
            log.info("[content-guard] blocked user {} from package session {} (no live membership)",
                    user.getUserId(), packageSessionId);
            throw new VacademyException("You are not enrolled in this course");
        }
    }

    static boolean isStaff(CustomUserDetails user) {
        if (user.isRootUser()) {
            return true;
        }
        return user.getAuthorities() != null && user.getAuthorities().stream()
                .anyMatch(a -> a.getAuthority() != null
                        && STAFF_AUTHORITIES.contains(a.getAuthority().toUpperCase()));
    }
}
