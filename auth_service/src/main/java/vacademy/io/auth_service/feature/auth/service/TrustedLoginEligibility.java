package vacademy.io.auth_service.feature.auth.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import vacademy.io.auth_service.feature.admin_core_service.dto.InstituteSignupPolicy;
import vacademy.io.auth_service.feature.admin_core_service.service.InstitutePolicyService;
import vacademy.io.common.auth.entity.User;
import vacademy.io.common.auth.entity.UserRole;
import vacademy.io.common.auth.repository.UserRoleRepository;
import vacademy.io.common.auth.service.UserRoleService;
import vacademy.io.common.auth.util.SuperAdminAuthUtil;

import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import java.util.Set;
import java.util.TreeSet;
import java.util.function.Predicate;

/**
 * Whether an account is "learner-shaped": the only kind of account a username-only join link
 * or a public re-registration may sign in without a password or OTP.
 *
 * <p>An account is learner-shaped when it is not a platform super-admin and every role it
 * holds with access (ACTIVE or INVITED), in any institute, is a learner role. One exception:
 * a TEACHER role in an institute where the same account is also a STUDENT and the institute
 * lets learners create courses, which is exactly what public sign-up grants there. When that
 * setting cannot be read (admin-core did not answer), the TEACHER role is given the benefit of
 * the doubt and the case is logged at ERROR: an outage must not cost a learner their sign-in.</p>
 */
@Component
public class TrustedLoginEligibility {

    private static final Logger log = LoggerFactory.getLogger(TrustedLoginEligibility.class);

    static final String SUPER_ADMIN = "SUPER_ADMIN";
    private static final Set<String> LEARNER_ROLES = Set.of("STUDENT", "PARENT", "GUARDIAN");
    private static final String STUDENT = "STUDENT";
    private static final String TEACHER = "TEACHER";

    private final UserRoleRepository userRoleRepository;
    private final InstitutePolicyService institutePolicyService;
    private final Predicate<String> isSuperAdmin;

    @Autowired
    public TrustedLoginEligibility(UserRoleRepository userRoleRepository,
            InstitutePolicyService institutePolicyService) {
        this(userRoleRepository, institutePolicyService, SuperAdminAuthUtil::isSuperAdminUserId);
    }

    TrustedLoginEligibility(UserRoleRepository userRoleRepository, InstitutePolicyService institutePolicyService,
            Predicate<String> isSuperAdmin) {
        this.userRoleRepository = userRoleRepository;
        this.institutePolicyService = institutePolicyService;
        this.isSuperAdmin = isSuperAdmin;
    }

    /**
     * What keeps this account from being learner-shaped: the names of its access-granting
     * non-learner roles, plus {@code SUPER_ADMIN} for a platform super-admin. Empty when the
     * account is learner-shaped.
     */
    public List<String> nonLearnerAccess(User user) {
        if (user == null) {
            return List.of();
        }
        Set<String> reasons = new TreeSet<>();
        if (isSuperAdmin.test(user.getId())) {
            reasons.add(SUPER_ADMIN);
        }
        List<UserRole> active = userRoleRepository.findByUser(user).stream()
                .filter(UserRoleService::grantsAccess)
                .filter(ur -> ur.getRole() != null && ur.getRole().getName() != null)
                .toList();
        for (UserRole userRole : active) {
            String name = userRole.getRole().getName().trim().toUpperCase();
            if (LEARNER_ROLES.contains(name)) {
                continue;
            }
            if (TEACHER.equals(name) && isLearnerCourseCreator(userRole.getInstituteId(), active)) {
                continue;
            }
            reasons.add(name);
        }
        return new ArrayList<>(reasons);
    }

    private boolean isLearnerCourseCreator(String instituteId, List<UserRole> active) {
        if (instituteId == null) {
            return false;
        }
        boolean studentHere = active.stream().anyMatch(ur -> Objects.equals(instituteId, ur.getInstituteId())
                && STUDENT.equalsIgnoreCase(ur.getRole().getName().trim()));
        if (!studentHere) {
            return false;
        }
        try {
            InstitutePolicyService.SignupPolicyAnswer answer =
                    institutePolicyService.fetchSignupPolicyAnswerCached(instituteId);
            if (answer == null || !answer.answered()) {
                log.error("ELIGIBILITY_POLICY_UNAVAILABLE institute={}: STUDENT+TEACHER treated as a learner",
                        instituteId);
                return true;
            }
            InstituteSignupPolicy policy = answer.policy();
            return policy != null && policy.isAllowLearnersToCreateCourses();
        } catch (Exception e) {
            log.error("ELIGIBILITY_POLICY_UNAVAILABLE institute={}: STUDENT+TEACHER treated as a learner: {}",
                    instituteId, e.getMessage());
            return true;
        }
    }
}
