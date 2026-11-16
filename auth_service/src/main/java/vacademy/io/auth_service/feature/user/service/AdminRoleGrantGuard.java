package vacademy.io.auth_service.feature.user.service;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import vacademy.io.auth_service.feature.auth.constants.AuthConstants;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.auth.repository.UserRoleRepository;
import vacademy.io.common.auth.service.UserRoleService;
import vacademy.io.common.exceptions.VacademyException;

import java.util.Collection;
import java.util.List;

/**
 * Only an ADMIN of an institute may hand out the ADMIN role in that institute.
 *
 * <p>The role/invite endpoints take the target institute and the role names from the request
 * body. The check reads the caller's own user_role rows, not the token or the root flag
 * (same approach as {@code InstituteOAuthClientAccessGuard}).
 *
 * <p>The same rule covers the four commerce roles ({@link AuthConstants#COMMERCE_ROLES}): only
 * an ADMIN of the institute may grant or remove them.
 *
 * <p>Grants of every other role are unchanged. Internal (HMAC) routes have no caller to test,
 * so they refuse a commerce role outright ({@link #refuseCommerceRolesWithoutCaller}), and sign-up
 * drops one from the request (AuthService).
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

    /**
     * Throws 403 when {@code roleNames} grants ADMIN or a commerce role (any case) and the
     * caller is not ADMIN of {@code instituteId}.
     */
    public void requireAdminToGrantAdmin(CustomUserDetails caller, String instituteId, Collection<String> roleNames) {
        requireAdminFor(caller, instituteId, roleNames, "grant");
    }

    /** The same rule for taking those roles away (DELETE /user-roles/remove-user-roles). */
    public void requireAdminToRemoveAdmin(CustomUserDetails caller, String instituteId, Collection<String> roleNames) {
        requireAdminFor(caller, instituteId, roleNames, "remove");
    }

    /**
     * For the internal (HMAC) routes that write role rows. They carry no signed-in caller, so
     * nothing there can prove an admin made the grant: a commerce role is refused outright.
     * Shop staff are added from the Teams screen, which goes through the checks above.
     */
    public static void refuseCommerceRolesWithoutCaller(Collection<String> roleNames) {
        if (roleNames != null && roleNames.stream().anyMatch(AuthConstants::isCommerceRole)) {
            throw new VacademyException(HttpStatus.FORBIDDEN,
                    "Commerce roles can only be granted by an admin from the team screen");
        }
    }

    private static boolean isAdminRoleName(String name) {
        return name != null && ADMIN_ROLE.equalsIgnoreCase(name.strip());
    }

    private void requireAdminFor(CustomUserDetails caller, String instituteId, Collection<String> roleNames,
                                 String verb) {
        if (roleNames == null) {
            return;
        }
        boolean admin = roleNames.stream().anyMatch(AdminRoleGrantGuard::isAdminRoleName);
        if (!admin && roleNames.stream().noneMatch(AuthConstants::isCommerceRole)) {
            return;
        }
        String message = "Only an admin of this institute can " + verb
                + (admin ? " the ADMIN role" : " commerce roles");
        if (caller == null || caller.getUserId() == null || instituteId == null || instituteId.isBlank()
                || userRoleRepository.findFirstByUserIdAndInstituteIdAndRoleNamesAndStatuses(
                        caller.getUserId(), instituteId, ADMIN_ROLE_ROWS,
                        UserRoleService.ACCESS_GRANTING_STATUSES).isEmpty()) {
            throw new VacademyException(HttpStatus.FORBIDDEN, message);
        }
    }
}
