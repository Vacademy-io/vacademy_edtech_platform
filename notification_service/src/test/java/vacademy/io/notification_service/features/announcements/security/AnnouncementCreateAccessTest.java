package vacademy.io.notification_service.features.announcements.security;

import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;
import vacademy.io.common.auth.dto.UserServiceDTO;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.notification_service.features.announcements.dto.CreateAnnouncementRequest;
import vacademy.io.notification_service.features.announcements.repository.AnnouncementRepository;

import java.util.List;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;

class AnnouncementCreateAccessTest {

    private final AnnouncementAccessGuard guard = new AnnouncementAccessGuard(mock(AnnouncementRepository.class));

    private static CustomUserDetails user(String userId, String... roles) {
        UserServiceDTO dto = new UserServiceDTO();
        dto.setUserId(userId);
        dto.setUsername(userId + "@example.com");
        dto.setAuthorities(List.of(roles));
        return new CustomUserDetails(dto);
    }

    private static CreateAnnouncementRequest request(String instituteId, String createdBy, String role) {
        CreateAnnouncementRequest req = new CreateAnnouncementRequest();
        req.setInstituteId(instituteId);
        req.setCreatedBy(createdBy);
        req.setCreatedByRole(role);
        return req;
    }

    private static HttpStatus statusOf(Runnable call) {
        try {
            call.run();
            return HttpStatus.OK;
        } catch (ResponseStatusException e) {
            return HttpStatus.valueOf(e.getStatusCode().value());
        }
    }

    @Test
    void createWithoutTokenIsUnauthorized() {
        assertThat(statusOf(() -> guard.prepareCreateRequest(null, "I1", request("I1", "x", "ADMIN"))))
                .isEqualTo(HttpStatus.UNAUTHORIZED);
    }

    @Test
    void learnerAndOtherInstituteAreRefused() {
        assertThat(statusOf(() -> guard.prepareCreateRequest(user("s1", "STUDENT"), "I1", request("I1", "s1", "ADMIN"))))
                .isEqualTo(HttpStatus.FORBIDDEN);
        // Token scoped to I2, body names I1.
        assertThat(statusOf(() -> guard.prepareCreateRequest(user("a1", "ADMIN"), "I2", request("I1", "a1", "ADMIN"))))
                .isEqualTo(HttpStatus.FORBIDDEN);
    }

    @Test
    void creatorIdComesFromTheToken() {
        CreateAnnouncementRequest req = request("I1", "someone-else", "TEACHER");
        guard.prepareCreateRequest(user("t1", "TEACHER"), "I1", req);
        assertThat(req.getCreatedBy()).isEqualTo("t1");
        assertThat(req.getCreatedByRole()).isEqualTo("TEACHER");
    }

    @Test
    void nonAdminCannotClaimAdmin() {
        CreateAnnouncementRequest req = request("I1", "t1", "ADMIN");
        guard.prepareCreateRequest(user("t1", "TEACHER"), "I1", req);
        assertThat(req.getCreatedByRole()).isEqualTo("TEACHER");

        CreateAnnouncementRequest custom = request("I1", "o1", "admin");
        guard.prepareCreateRequest(user("o1", "Operations"), "I1", custom);
        assertThat(custom.getCreatedByRole()).isEqualTo("OPERATIONS");
    }

    @Test
    void adminKeepsAdminAndBlankRoleIsFilledIn() {
        CreateAnnouncementRequest admin = request("I1", "a1", "ADMIN");
        guard.prepareCreateRequest(user("a1", "ADMIN"), "I1", admin);
        assertThat(admin.getCreatedByRole()).isEqualTo("ADMIN");

        CreateAnnouncementRequest blank = request("I1", "a1", null);
        guard.prepareCreateRequest(user("a1", "ADMIN", "TEACHER"), "I1", blank);
        assertThat(blank.getCreatedByRole()).isEqualTo("ADMIN");

        CreateAnnouncementRequest blankTeacher = request("I1", "t1", " ");
        guard.prepareCreateRequest(user("t1", "STUDENT", "TEACHER"), "I1", blankTeacher);
        assertThat(blankTeacher.getCreatedByRole()).isEqualTo("TEACHER");
    }

    @Test
    void resolveCreatorRoleKeepsANonAdminRoleAsSent() {
        // The dashboard sends the sender's primary role; non-admin roles are kept as they are.
        assertThat(AnnouncementAccessGuard.resolveCreatorRole(Set.of("ADMIN"), "TEACHER")).isEqualTo("TEACHER");
        assertThat(AnnouncementAccessGuard.resolveCreatorRole(Set.of("FACULTY"), "ADMIN")).isEqualTo("FACULTY");
    }

    @Test
    void missingRequestIsBadRequest() {
        assertThatThrownBy(() -> guard.prepareCreateRequest(user("a1", "ADMIN"), "I1", null))
                .isInstanceOf(ResponseStatusException.class);
    }
}
