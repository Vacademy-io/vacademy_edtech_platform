package vacademy.io.notification_service.features.announcements;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultMatcher;
import vacademy.io.common.auth.dto.UserServiceDTO;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class InstituteAnnouncementSettingsApiTest {

    private static final String INSTITUTE = "INST_SETTINGS";

    @Autowired private MockMvc mockMvc;
    @Autowired private ObjectMapper objectMapper;

    private static CustomUserDetails principal(String userId, String role, boolean root) {
        UserServiceDTO dto = new UserServiceDTO();
        dto.setUserId(userId);
        dto.setUsername(userId + "@example.com");
        dto.setFullName(userId);
        dto.setAuthorities(List.of(role));
        dto.setRootUser(root);
        return new CustomUserDetails(dto);
    }

    private static final ResultMatcher REFUSED =
            result -> assertThat(result.getResponse().getStatus()).isIn(401, 403);

    private String body() throws Exception {
        return objectMapper.writeValueAsString(Map.of(
                "instituteId", INSTITUTE,
                "settings", Map.of(
                        "community", Map.of("students_can_send", true),
                        "dashboard_pins", Map.of("students_can_create", false, "max_duration_hours", 24))));
    }

    @Test
    @DisplayName("An institute admin can create, get, validate, check permissions and delete settings")
    void settingsCrudAndPermissions() throws Exception {
        CustomUserDetails admin = principal("admin-1", "ADMIN", false);

        mockMvc.perform(post("/notification-service/v1/institute-settings")
                        .header("clientId", INSTITUTE).with(user(admin))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.instituteId").value(INSTITUTE));

        // Per-institute GET stays public (learners read chat/community flags from it).
        mockMvc.perform(get("/notification-service/v1/institute-settings/institute/" + INSTITUTE))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.instituteId").value(INSTITUTE));

        mockMvc.perform(post("/notification-service/v1/institute-settings/validate")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.valid").value(true));

        mockMvc.perform(get("/notification-service/v1/institute-settings/institute/" + INSTITUTE + "/permissions")
                        .param("userRole", "STUDENT")
                        .param("action", "send")
                        .param("modeType", "COMMUNITY"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.canPerform").exists());

        mockMvc.perform(delete("/notification-service/v1/institute-settings/institute/" + INSTITUTE)
                        .header("clientId", INSTITUTE).with(user(admin)))
                .andExpect(status().isNoContent());
    }

    @Test
    @DisplayName("Writes and the all-institutes listing are refused without a login")
    void unauthenticatedWritesRefused() throws Exception {
        mockMvc.perform(post("/notification-service/v1/institute-settings")
                        .contentType(MediaType.APPLICATION_JSON).content(body()))
                .andExpect(REFUSED);
        mockMvc.perform(delete("/notification-service/v1/institute-settings/institute/" + INSTITUTE))
                .andExpect(REFUSED);
        mockMvc.perform(get("/notification-service/v1/institute-settings/all"))
                .andExpect(REFUSED);
    }

    @Test
    @DisplayName("Students, and admins of another institute, cannot change an institute's settings")
    void nonAdminsAndOtherInstitutesRefused() throws Exception {
        mockMvc.perform(post("/notification-service/v1/institute-settings")
                        .header("clientId", INSTITUTE).with(user(principal("student-1", "STUDENT", false)))
                        .contentType(MediaType.APPLICATION_JSON).content(body()))
                .andExpect(status().isForbidden());

        mockMvc.perform(post("/notification-service/v1/institute-settings")
                        .header("clientId", "SOME_OTHER_INSTITUTE").with(user(principal("admin-2", "ADMIN", false)))
                        .contentType(MediaType.APPLICATION_JSON).content(body()))
                .andExpect(status().isForbidden());
    }

    @Test
    @DisplayName("The all-institutes listing is closed to everyone, including users flagged is_root_user")
    void allSettingsClosed() throws Exception {
        mockMvc.perform(get("/notification-service/v1/institute-settings/all")
                        .header("clientId", INSTITUTE).with(user(principal("admin-1", "ADMIN", false))))
                .andExpect(status().isForbidden());

        // is_root_user is set for almost every account by ordinary sign-up flows — it must not unlock anything.
        mockMvc.perform(get("/notification-service/v1/institute-settings/all")
                        .with(user(principal("root-1", "ADMIN", true))))
                .andExpect(status().isForbidden());
    }

    @Test
    @DisplayName("A user flagged is_root_user without ADMIN in the institute cannot change its settings")
    void rootFlagDoesNotBypassAdminCheck() throws Exception {
        mockMvc.perform(post("/notification-service/v1/institute-settings")
                        .header("clientId", INSTITUTE).with(user(principal("learner-root", "STUDENT", true)))
                        .contentType(MediaType.APPLICATION_JSON).content(body()))
                .andExpect(status().isForbidden());
        mockMvc.perform(delete("/notification-service/v1/institute-settings/institute/" + INSTITUTE)
                        .header("clientId", "SOME_OTHER_INSTITUTE").with(user(principal("admin-root", "ADMIN", true))))
                .andExpect(status().isForbidden());
    }
}
