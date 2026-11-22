package vacademy.io.notification_service.config;

import org.springframework.http.HttpStatus;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.web.server.ResponseStatusException;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.auth.util.SuperAdminAuthUtil;
import vacademy.io.common.exceptions.VacademyException;

import java.util.HashSet;
import java.util.Set;

/**
 * Staff check for the admin-dashboard notification screens (message history, analytics,
 * notification hub, webhook self-test).
 * <p>
 * The JWT principal's authorities are scoped to the {@code clientId} header institute, so the
 * caller is staff of that institute when it holds any role there other than a learner role.
 * Deliberately lenient: only a principal whose roles there are ALL learner roles
 * (STUDENT / PARENT / GUARDIAN), or who has no role there, is refused. Every admin, teacher,
 * counsellor or custom role keeps working. Platform super admins (SUPER_ADMIN_USER_IDS) pass.
 */
public final class InstituteStaffAccess {

    private static final Set<String> LEARNER_ROLE_NAMES = Set.of("STUDENT", "PARENT", "GUARDIAN");

    private InstituteStaffAccess() {}

    /** Staff of the {@code clientId} institute. */
    public static void requireStaff(CustomUserDetails user, String clientId) {
        requireStaff(user, clientId, clientId);
    }

    /**
     * Staff of {@code instituteId}, which must equal the {@code clientId} header (the
     * institute the caller's roles were loaded for).
     */
    public static void requireStaff(CustomUserDetails user, String clientId, String instituteId) {
        if (user == null || user.getUserId() == null) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "UNAUTHENTICATED");
        }
        if (isPlatformSuperAdmin(user)) {
            return;
        }
        if (clientId == null || clientId.isBlank()) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "INSTITUTE_REQUIRED");
        }
        if (instituteId == null || !clientId.trim().equals(instituteId.trim())) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "INSTITUTE_MISMATCH");
        }
        if (!isStaff(user)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "STAFF_REQUIRED");
        }
    }

    /** The caller themselves, or staff of the {@code clientId} institute. */
    public static void requireSelfOrStaff(CustomUserDetails user, String clientId, String targetUserId) {
        if (user != null && user.getUserId() != null && user.getUserId().equals(targetUserId)) {
            return;
        }
        requireStaff(user, clientId);
    }

    static boolean isStaff(CustomUserDetails user) {
        Set<String> authorities = new HashSet<>();
        if (user.getAuthorities() != null) {
            for (GrantedAuthority authority : user.getAuthorities()) {
                if (authority != null && authority.getAuthority() != null && !authority.getAuthority().isBlank()) {
                    authorities.add(authority.getAuthority().trim().toUpperCase());
                }
            }
        }
        authorities.removeAll(LEARNER_ROLE_NAMES);
        return !authorities.isEmpty();
    }

    private static boolean isPlatformSuperAdmin(CustomUserDetails user) {
        if (!SuperAdminAuthUtil.isSuperAdminUserId(user.getUserId())) {
            return false;
        }
        try {
            SuperAdminAuthUtil.requireSuperAdmin(user);
            return true;
        } catch (VacademyException e) {
            return false;
        }
    }
}
