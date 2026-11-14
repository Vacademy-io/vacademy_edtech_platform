package vacademy.io.admin_core_service.features.learner.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.learner.dto.LearnerLmsLandingResponse;
import vacademy.io.admin_core_service.features.learner.service.LearnerLmsConnectionResolver.LmsAttachedCourse;
import vacademy.io.admin_core_service.features.workflow.entity.WorkflowTrigger;
import vacademy.io.admin_core_service.features.workflow.enums.WorkflowTriggerEvent;
import vacademy.io.admin_core_service.features.workflow.service.WorkflowTriggerService;
import vacademy.io.common.auth.dto.UserDTO;

import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * Resolves the LearnDash hand-off for a learner who has just set a new portal password.
 *
 * <p>For an institute running its courses on a connected WordPress site, the password the
 * learner just chose is mirrored there by {@link LearnerLmsUserSyncService} - so the useful
 * next screen is that site, not the Vacademy dashboard, which for these institutes holds
 * nothing they came for.
 *
 * <p>Two grades of destination, best first:
 * <ol>
 *   <li>the institute's {@code GENERATE_ADMIN_LOGIN_URL_FOR_LEARNER_PORTAL} workflow, which
 *       returns a URL that signs the learner straight in - the same mechanism the admin-side
 *       "open learner portal" action already uses;</li>
 *   <li>failing that, the site's own front page, where they sign in with the password they
 *       have only now set.</li>
 * </ol>
 *
 * <p>Everything here is best-effort and read-only: a learner must never be stranded on the
 * change-password screen because a workflow misfired or an LMS is unreachable. Any failure
 * degrades to {@link LearnerLmsLandingResponse#notConnected()} and the caller keeps its
 * ordinary landing route.
 *
 * <p>The userId is always the caller's own, taken from the JWT by the controller and never
 * from a request parameter. The admin-side equivalent
 * ({@code LearnerPortalAccessService#generateLearnerPortalAccessUrl}) accepts an arbitrary
 * userId and mints tokens for it, which is exactly why it is not reused here.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class LearnerLmsLandingService {

    private static final String AUTO_LOGIN = "AUTO_LOGIN";
    private static final String SITE_ROOT = "SITE_ROOT";

    private final LearnerLmsConnectionResolver learnerLmsConnectionResolver;
    private final WorkflowTriggerService workflowTriggerService;
    private final AuthService authService;

    public LearnerLmsLandingResponse resolveLanding(String userId) {
        if (!StringUtils.hasText(userId)) {
            return LearnerLmsLandingResponse.notConnected();
        }

        List<LmsAttachedCourse> courses;
        try {
            courses = learnerLmsConnectionResolver.resolveLmsAttachedCourses(userId);
        } catch (Exception e) {
            log.warn("LMS landing: connection lookup failed for user {}: {}", userId, e.getMessage());
            return LearnerLmsLandingResponse.notConnected();
        }
        if (courses.isEmpty()) {
            return LearnerLmsLandingResponse.notConnected();
        }

        // The learner's first LMS-attached enrolment. Multiple connected sites is not a shape
        // any institute runs today, and picking one is strictly better than picking none -
        // the alternative would be asking a learner, mid password change, which site they meant.
        LmsAttachedCourse course = courses.get(0);

        String autoLoginUrl = autoLoginUrl(course, userId);
        if (StringUtils.hasText(autoLoginUrl)) {
            return landing(course, autoLoginUrl, AUTO_LOGIN);
        }

        String siteRoot = learnerLmsConnectionResolver.siteRootOf(course.connection());
        if (StringUtils.hasText(siteRoot)) {
            return landing(course, siteRoot, SITE_ROOT);
        }

        log.warn("LMS landing: user {} is on an LMS-attached course {} but no usable URL could be built",
                userId, course.packageId());
        return LearnerLmsLandingResponse.notConnected();
    }

    /**
     * The institute's auto-login URL for this learner, or null when the institute has no such
     * workflow configured or the workflow could not produce one (the learner not existing on
     * the LMS yet is the common case, and is not an error worth failing the response over).
     */
    private String autoLoginUrl(LmsAttachedCourse course, String userId) {
        if (!StringUtils.hasText(course.instituteId()) || !StringUtils.hasText(course.packageId())) {
            return null;
        }
        try {
            Optional<WorkflowTrigger> trigger = workflowTriggerService.findByInstituteIdEventNameAndEventId(
                    course.instituteId(),
                    WorkflowTriggerEvent.GENERATE_ADMIN_LOGIN_URL_FOR_LEARNER_PORTAL.name(),
                    course.instituteId());
            if (trigger.isEmpty()) {
                return null;
            }

            List<UserDTO> users = authService.getUsersFromAuthServiceByUserIds(List.of(userId));
            if (users == null || users.isEmpty()) {
                return null;
            }

            Map<String, Object> response = workflowTriggerService.handleTriggerEvents(
                    WorkflowTriggerEvent.GENERATE_ADMIN_LOGIN_URL_FOR_LEARNER_PORTAL.name(),
                    course.instituteId(), course.instituteId(),
                    Map.of("user", users.get(0), "packageId", course.packageId()));

            Object url = response == null ? null : response.get("adminLoginUrl");
            return url == null ? null : url.toString();
        } catch (Exception e) {
            log.warn("LMS landing: auto-login workflow failed for user {} on package {}: {}",
                    userId, course.packageId(), e.getMessage());
            return null;
        }
    }

    private LearnerLmsLandingResponse landing(LmsAttachedCourse course, String url, String type) {
        return LearnerLmsLandingResponse.builder()
                .connected(true)
                .redirectUrl(url)
                .redirectType(type)
                .packageSessionId(course.packageSessionId())
                .packageId(course.packageId())
                .build();
    }
}
