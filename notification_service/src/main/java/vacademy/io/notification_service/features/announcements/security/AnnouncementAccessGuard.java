package vacademy.io.notification_service.features.announcements.security;

import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.notification_service.features.announcements.entity.Announcement;
import vacademy.io.notification_service.features.announcements.repository.AnnouncementRepository;

import java.util.Objects;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * Caller checks for the admin-dashboard announcement endpoints (history list, stats,
 * recipients, approve/reject, delete, email configurations).
 *
 * <p>Other services create announcements service-to-service, so the security config does not
 * demand a token on these paths; each admin endpoint checks its caller here instead. The JWT
 * filter builds the principal scoped to the institute in the {@code clientId} header — an empty
 * authority set means the caller holds no role there.
 *
 * <p>Staff = holds at least one role in the institute that is not a learner role, so custom roles
 * (e.g. "Operations") count. Someone who is staff AND enrolled as a learner stays staff — plenty of
 * real staff hold both and use these screens today.
 */
@Component
@RequiredArgsConstructor
public class AnnouncementAccessGuard {

    private static final Set<String> LEARNER_ROLE_NAMES = Set.of("STUDENT", "LEARNER", "PARENT", "GUARDIAN");

    private final AnnouncementRepository announcementRepository;

    /** Staff of {@code instituteId}, calling with that institute as clientId. */
    public void requireStaff(CustomUserDetails user, String clientId, String instituteId) {
        Set<String> authorities = memberAuthorities(user, clientId, instituteId);
        if (authorities.stream().allMatch(LEARNER_ROLE_NAMES::contains)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "STAFF_REQUIRED");
        }
    }

    /** ADMIN of {@code instituteId}, calling with that institute as clientId. */
    public void requireAdmin(CustomUserDetails user, String clientId, String instituteId) {
        if (!memberAuthorities(user, clientId, instituteId).contains("ADMIN")) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "ADMIN_REQUIRED");
        }
    }

    /** Staff of the institute that owns the announcement. */
    public void requireStaffForAnnouncement(CustomUserDetails user, String clientId, String announcementId) {
        requireStaff(user, clientId, instituteOf(announcementId));
    }

    /** ADMIN of the institute that owns the announcement. */
    public void requireAdminForAnnouncement(CustomUserDetails user, String clientId, String announcementId) {
        requireAdmin(user, clientId, instituteOf(announcementId));
    }

    private String instituteOf(String announcementId) {
        return announcementRepository.findById(announcementId)
                .map(Announcement::getInstituteId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "ANNOUNCEMENT_NOT_FOUND"));
    }

    private static Set<String> memberAuthorities(CustomUserDetails user, String clientId, String instituteId) {
        if (user == null || user.getUserId() == null) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "UNAUTHENTICATED");
        }
        if (instituteId == null || !instituteId.equals(clientId)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "INSTITUTE_MISMATCH");
        }
        Set<String> authorities = user.getAuthorities() == null ? Set.of() : user.getAuthorities().stream()
                .map(GrantedAuthority::getAuthority)
                .filter(Objects::nonNull)
                .map(a -> a.trim().toUpperCase())
                .collect(Collectors.toSet());
        if (authorities.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "NOT_IN_INSTITUTE");
        }
        return authorities;
    }
}
