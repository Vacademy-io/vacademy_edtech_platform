package vacademy.io.notification_service.features.announcements;

import org.springframework.test.web.servlet.request.RequestPostProcessor;
import vacademy.io.common.auth.dto.UserServiceDTO;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.List;

import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;

/** Signed-in callers for the announcement API tests (a principal plus the clientId header). */
final class AnnouncementTestAuth {

    private AnnouncementTestAuth() {
    }

    static CustomUserDetails principal(String userId, String... roles) {
        UserServiceDTO dto = new UserServiceDTO();
        dto.setUserId(userId);
        dto.setUsername(userId + "@example.com");
        dto.setFullName(userId);
        dto.setAuthorities(List.of(roles));
        return new CustomUserDetails(dto);
    }

    /** {@code userId} signed in to {@code instituteId} with {@code roles}. */
    static RequestPostProcessor as(String instituteId, String userId, String... roles) {
        return request -> {
            request.addHeader("clientId", instituteId);
            return user(principal(userId, roles)).postProcessRequest(request);
        };
    }

    /** An ADMIN of {@code instituteId}. */
    static RequestPostProcessor admin(String instituteId) {
        return as(instituteId, "admin-1", "ADMIN");
    }
}
