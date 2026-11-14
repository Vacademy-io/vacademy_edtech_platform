package vacademy.io.auth_service.feature.institute_oauth.service;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.auth.repository.UserRoleRepository;
import vacademy.io.common.exceptions.VacademyException;

import java.util.List;

/**
 * Only an ACTIVE ADMIN of the institute may read or change its OAuth client.
 *
 * <p>Deliberately stricter than the usual checks: {@code isRootUser} is true for almost every
 * account, so it is not honoured as a bypass here, and the JWT's authorities are not trusted
 * either (they are built from every role the user ever held in the clientId-header institute,
 * deleted ones included). The role is read from user_roles for the institute in the path.
 */
@Component
public class InstituteOAuthClientAccessGuard {

    private static final List<String> ADMIN_ROLE = List.of("ADMIN");
    private static final List<String> ACTIVE = List.of("ACTIVE");

    private final UserRoleRepository userRoleRepository;

    public InstituteOAuthClientAccessGuard(UserRoleRepository userRoleRepository) {
        this.userRoleRepository = userRoleRepository;
    }

    public void requireInstituteAdmin(CustomUserDetails user, String instituteId) {
        if (user == null || user.getUserId() == null || user.getUserId().isBlank()) {
            throw new VacademyException(HttpStatus.UNAUTHORIZED, "Login required");
        }
        if (instituteId == null || instituteId.isBlank()) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, "institute_id is required");
        }
        boolean admin = userRoleRepository
                .findFirstByUserIdAndInstituteIdAndRoleNamesAndStatuses(user.getUserId(), instituteId, ADMIN_ROLE, ACTIVE)
                .isPresent();
        if (!admin) {
            throw new VacademyException(HttpStatus.FORBIDDEN, "Only an admin of this institute can manage its sign-in settings");
        }
    }
}
