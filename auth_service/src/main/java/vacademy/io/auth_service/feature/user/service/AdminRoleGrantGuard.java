package vacademy.io.auth_service.feature.user.service;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.auth.repository.UserRoleRepository;
import vacademy.io.common.auth.service.UserRoleService;
import vacademy.io.common.exceptions.VacademyException;

import java.util.Collection;
import java.util.List;

/**
 * Only an ADMIN of an institute may hand out the ADMIN role in that institute.
 *
 * <p>The public role/invite endpoints take the target institute and the role names from the
 * request body, so without this any signed-in user (a learner of any institute) could make
 * themselves, or a fresh account mailed to them, ADMIN of any institute. The check reads the
 * caller's own user_role rows, not the token or the root flag: learners and invited staff are
 * root users, and the token's authorities belong to whatever clientId the caller sent (same
 * approach as {@code InstituteOAuthClientAccessGuard}).
 *
 * <p>Grants of every other role are unchanged. Internal (HMAC) routes do not go through this.
 */
@Component
public class AdminRoleGrantGuard {

    private static final String ADMIN_ROLE = "ADMIN";

    /**
     * Role rows that make the caller an admin: the real ADMIN plus the legacy global "Admin"
     * row some admins were given (role_name is unique and case-sensitive). A custom role an
     * institute names "admin" is deliberately not one of them.
     */
    private static final List<String> ADMIN_ROLE_ROWS = List.of(ADMIN_ROLE, "Admin");

    private final UserRoleRepository userRoleRepository;

    public AdminRoleGrantGuard(UserRoleRepository userRoleRepository) {
        this.userRoleRepository = userRoleRepository;
    }

    /** Throws 403 when {@code roleNames} grants ADMIN (any case) and the caller is not ADMIN of {@code instituteId}. */
    public void requireAdminToGrantAdmin(CustomUserDetails caller, String instituteId, Collection<String> roleNames) {
        requireAdminFor(caller, instituteId, roleNames, "Only an admin of this institute can grant the ADMIN role");
    }

    /** The same rule for taking ADMIN away (DELETE /user-roles/remove-user-roles). */
    public void requireAdminToRemoveAdmin(CustomUserDetails caller, String instituteId, Collection<String> roleNames) {
        requireAdminFor(caller, instituteId, roleNames, "Only an admin of this institute can remove the ADMIN role");
    }

    private void requireAdminFor(CustomUserDetails caller, String instituteId, Collection<String> roleNames,
                                 String message) {
        if (roleNames == null || roleNames.stream().noneMatch(n -> n != null && ADMIN_ROLE.equalsIgnoreCase(n.strip()))) {
            return;
        }
        if (caller == null || caller.getUserId() == null || instituteId == null || instituteId.isBlank()
                || userRoleRepository.findFirstByUserIdAndInstituteIdAndRoleNamesAndStatuses(
                        caller.getUserId(), instituteId, ADMIN_ROLE_ROWS,
                        UserRoleService.ACCESS_GRANTING_STATUSES).isEmpty()) {
            throw new VacademyException(HttpStatus.FORBIDDEN, message);
        }
    }
}
