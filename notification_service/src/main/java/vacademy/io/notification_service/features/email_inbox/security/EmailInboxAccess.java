package vacademy.io.notification_service.features.email_inbox.security;

import org.springframework.http.HttpStatus;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.web.server.ResponseStatusException;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.HashSet;
import java.util.Set;

/**
 * The email inbox holds every email an institute sent or received (attachments included) and
 * can send mail as the institute, so every endpoint requires institute STAFF of the institute it
 * reads. Same staff rule as admin_core's InstituteAccessValidator.requireStaffAuthorities: the
 * JWT principal's authorities are scoped to the verified {@code clientId} institute; a learner
 * stays a learner unless also ADMIN; any staff or custom institute role passes; is_root_user
 * never counts (it is set for most learners too).
 */
public final class EmailInboxAccess {

    private static final Set<String> STAFF_ROLE_NAMES = Set.of("ADMIN", "TEACHER", "EVALUATOR", "MENTOR");
    private static final Set<String> LEARNER_ROLE_NAMES = Set.of("STUDENT", "PARENT", "GUARDIAN");

    private EmailInboxAccess() {}

    public static void requireStaff(CustomUserDetails user, String clientId, String instituteId) {
        if (user == null || user.getUserId() == null) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "UNAUTHENTICATED");
        }
        if (instituteId == null || instituteId.isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "instituteId is required");
        }
        if (clientId == null || !clientId.trim().equals(instituteId.trim())) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "INSTITUTE_MISMATCH");
        }
        Set<String> authorities = new HashSet<>();
        if (user.getAuthorities() != null) {
            for (GrantedAuthority authority : user.getAuthorities()) {
                if (authority != null && authority.getAuthority() != null) {
                    authorities.add(authority.getAuthority().trim().toUpperCase());
                }
            }
        }
        boolean learner = authorities.stream().anyMatch(LEARNER_ROLE_NAMES::contains);
        if (learner && !authorities.contains("ADMIN")) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "STAFF_REQUIRED");
        }
        if (authorities.stream().anyMatch(STAFF_ROLE_NAMES::contains) || !authorities.isEmpty()) {
            return;
        }
        throw new ResponseStatusException(HttpStatus.FORBIDDEN, "STAFF_REQUIRED");
    }
}
