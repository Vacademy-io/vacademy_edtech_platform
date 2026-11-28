package vacademy.io.auth_service.feature.panel.service;

import org.springframework.stereotype.Component;
import vacademy.io.auth_service.feature.demo.service.TrialAccessGuard;
import vacademy.io.common.auth.entity.User;
import vacademy.io.common.auth.entity.UserRole;
import vacademy.io.common.auth.repository.UserRepository;
import vacademy.io.common.auth.repository.UserRoleRepository;
import vacademy.io.common.auth.service.UserRoleService;

import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * Who may sign in to a panel of an institute, read from user_role for that institute at every
 * describe, approve, password login and refresh. JWT authorities and the root-user flag are not
 * consulted. Same staff rule as admin_core's requireStaffAuthorities: a learner role needs ADMIN or
 * COUNSELLOR beside it, and any other held role counts as staff, so custom roles pass.
 */
@Component
public class PanelAccessPolicy {

    private static final Set<String> LEARNER_ROLES = Set.of("STUDENT", "PARENT", "GUARDIAN");
    private static final Set<String> LEARNER_OVERRIDING_ROLES = Set.of("ADMIN", "COUNSELLOR");

    private final UserRepository userRepository;
    private final UserRoleRepository userRoleRepository;
    private final TrialAccessGuard trialAccessGuard;

    public PanelAccessPolicy(UserRepository userRepository, UserRoleRepository userRoleRepository,
            TrialAccessGuard trialAccessGuard) {
        this.userRepository = userRepository;
        this.userRoleRepository = userRoleRepository;
        this.trialAccessGuard = trialAccessGuard;
    }

    /**
     * @throws PanelApiException 403 NOT_STAFF naming the institute when the user is not staff there
     * @throws vacademy.io.common.exceptions.VacademyException 403 when the institute's trial lapsed
     */
    public void check(String userId, String instituteId, String instituteName) {
        Optional<User> user = userRepository.findById(userId);
        if (user.isEmpty() || !isStaff(rolesAt(user.get(), instituteId))) {
            throw PanelApiException.notStaff(instituteName);
        }
        trialAccessGuard.assertNotExpired(instituteId);
    }

    /** Accepts a pending invite: the first panel approval counts as the first sign-in. */
    public void activateInvitedRoles(String userId, String instituteId) {
        userRoleRepository.activateInvitedRolesByInstituteIdAndUserId(instituteId, List.of(userId));
    }

    private List<UserRole> rolesAt(User user, String instituteId) {
        return userRoleRepository.findByUser(user).stream()
                .filter(role -> instituteId.equals(role.getInstituteId()))
                .filter(UserRoleService::grantsAccess)
                .toList();
    }

    static boolean isStaff(List<UserRole> rolesAtInstitute) {
        Set<String> names = rolesAtInstitute.stream()
                .filter(role -> role.getRole() != null && role.getRole().getName() != null)
                .map(role -> role.getRole().getName().trim().toUpperCase(Locale.ROOT))
                .collect(Collectors.toSet());
        boolean learner = names.stream().anyMatch(LEARNER_ROLES::contains);
        if (learner && names.stream().noneMatch(LEARNER_OVERRIDING_ROLES::contains)) {
            return false;
        }
        return !names.isEmpty();
    }
}
