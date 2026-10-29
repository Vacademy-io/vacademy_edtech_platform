package vacademy.io.auth_service.feature.auth.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import vacademy.io.auth_service.feature.auth.constants.AuthConstants;
import vacademy.io.common.auth.repository.UserRoleRepository;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.institute.OriginInstituteResolver;

import java.util.Arrays;
import java.util.List;

/**
 * Keeps a white-labelled learner portal for its own learners.
 *
 * <p>Before this, the learner login endpoints only asked "is this a valid student anywhere?", so a
 * student of institute A could sign in on institute B's portal (and land on A's dashboard under B's
 * branding). The login pages now send the institute their domain routes to as
 * {@code portal_institute_id}; this guard requires the account to hold a student-portal role in
 * that institute.
 *
 * <p><b>Opt-in by the caller.</b> Nothing is enforced unless {@code portal_institute_id} is sent.
 * The open-registration and assessment flows reuse the same endpoints to sign in people who are
 * <i>not yet</i> in the institute and enrol them afterwards, so they must keep omitting it.
 *
 * <p><b>The shared portal is exempt.</b> The platform's own learner site (default
 * {@code learner.vacademy.io}) routes to a platform institute but is meant for every institute's
 * learners. Its institute is resolved from the host list at run time, so no institute id lives in
 * code.
 *
 * <p><b>Fail-open.</b> If the shared host cannot be resolved (admin-core slow or down) we cannot
 * tell the shared portal apart from a white-label one, and enforcing blindly would lock everybody
 * out of the shared portal, so the guard stands down. That reproduces the previous behaviour.
 */
@Slf4j
@Component
public class LearnerPortalAccessGuard {

    public static final String NOT_A_MEMBER_MESSAGE =
            "This account is not registered with this institute. Please sign in from your own institute's portal.";

    @Autowired
    private OriginInstituteResolver originInstituteResolver;

    @Autowired
    private UserRoleRepository userRoleRepository;

    /** Comma-separated hosts of portals that serve every institute's learners. */
    @Value("${auth.learner-portal.shared-hosts:learner.vacademy.io}")
    private String sharedHosts;

    /** Kill switch: set to false to restore the old "any student, any portal" behaviour. */
    @Value("${auth.learner-portal.restrict-login-to-portal-institute:true}")
    private boolean enabled;

    /**
     * Throws unless the user may sign in on the portal of {@code portalInstituteId}.
     *
     * @param portalInstituteId institute the portal domain routes to; blank = not a portal login
     * @param userId            the account that is signing in
     * @param statuses          role statuses that count as membership (the caller's own notion of
     *                          "can sign in": ACTIVE for passwords, ACTIVE or INVITED for OTP)
     */
    public void assertUserBelongsToPortal(String portalInstituteId, String userId, List<String> statuses) {
        if (!appliesTo(portalInstituteId) || !StringUtils.hasText(userId)) {
            return;
        }
        boolean member = userRoleRepository.findFirstByUserIdAndInstituteIdAndRoleNamesAndStatuses(
                userId, portalInstituteId, AuthConstants.VALID_ROLES_FOR_STUDENT_PORTAL, statuses).isPresent();
        if (!member) {
            log.warn("Learner login refused: user {} holds no student-portal role in portal institute {}",
                    userId, portalInstituteId);
            throw new VacademyException(NOT_A_MEMBER_MESSAGE);
        }
    }

    /**
     * Whether this login is scoped to a single institute: a portal id was sent, scoping is on, and
     * the portal is a white-label one rather than the shared learner site.
     */
    public boolean appliesTo(String portalInstituteId) {
        return enabled && StringUtils.hasText(portalInstituteId) && !isSharedPortal(portalInstituteId);
    }

    /** True when the portal is the shared one, or when that cannot be determined (fail-open). */
    private boolean isSharedPortal(String portalInstituteId) {
        boolean resolvedAny = false;
        for (String host : Arrays.stream(sharedHosts.split(",")).map(String::trim)
                .filter(StringUtils::hasText).toList()) {
            String sharedInstituteId = originInstituteResolver.resolveInstituteIdFromHost(host);
            if (!StringUtils.hasText(sharedInstituteId)) {
                continue;
            }
            resolvedAny = true;
            if (sharedInstituteId.equals(portalInstituteId)) {
                return true;
            }
        }
        if (!resolvedAny) {
            log.warn("Learner portal scoping skipped: shared host(s) '{}' did not resolve to an institute",
                    sharedHosts);
            return true;
        }
        return false;
    }
}
