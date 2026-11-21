package vacademy.io.notification_service.features.announcements;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultMatcher;
import vacademy.io.common.auth.dto.UserServiceDTO;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.notification_service.features.announcements.dto.CreateAnnouncementRequest;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * The admin-dashboard announcement endpoints need a token and check the caller themselves: staff
 * of the owning institute for create/history/stats/delete, ADMIN for approve/reject — the role
 * from the token, never from the request. Services create through /admin/** with service
 * credentials, and /user-messages/** only serves the caller's own messages.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class AnnouncementAccessApiTest {

    private static final String INSTITUTE = "INST_ACCESS";
    private static final String BASE = "/notification-service/v1/announcements";

    @Autowired private MockMvc mockMvc;
    @Autowired private ObjectMapper objectMapper;
    // The email-stats summary in the create response is Postgres-only SQL; on H2 it fails inside
    // the create transaction and rolls it back.
    @MockBean private vacademy.io.notification_service.features.notification_log.repository.NotificationLogRepository notificationLogRepository;

    private static final ResultMatcher REFUSED =
            result -> assertThat(result.getResponse().getStatus()).isIn(401, 403);
    private static final ResultMatcher NOT_REFUSED =
            result -> assertThat(result.getResponse().getStatus()).isNotIn(401, 403);

    private static CustomUserDetails principal(String userId, String... roles) {
        UserServiceDTO dto = new UserServiceDTO();
        dto.setUserId(userId);
        dto.setUsername(userId + "@example.com");
        dto.setFullName(userId);
        dto.setAuthorities(List.of(roles));
        return new CustomUserDetails(dto);
    }

    private CreateAnnouncementRequest request(String createdByRole) {
        CreateAnnouncementRequest req = new CreateAnnouncementRequest();
        req.setTitle("Access");
        var content = new CreateAnnouncementRequest.RichTextDataRequest();
        content.setType("text");
        content.setContent("hello");
        req.setContent(content);
        req.setInstituteId(INSTITUTE);
        req.setCreatedBy("creator");
        req.setCreatedByRole(createdByRole);
        req.setTimezone("UTC");
        var recipient = new CreateAnnouncementRequest.RecipientRequest();
        recipient.setRecipientType("ROLE");
        recipient.setRecipientId("STUDENT");
        req.setRecipients(List.of(recipient));
        req.setModes(List.of(new CreateAnnouncementRequest.ModeRequest("SYSTEM_ALERT", Map.of("priority", "MEDIUM"))));
        return req;
    }

    private String createAnnouncement() throws Exception {
        var res = mockMvc.perform(post(BASE).contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request("ADMIN")))
                        .with(AnnouncementTestAuth.admin(INSTITUTE)))
                .andExpect(status().isOk())
                .andReturn();
        return objectMapper.readTree(res.getResponse().getContentAsString()).get("id").asText();
    }

    @Test
    @DisplayName("create needs a staff login of the request's institute")
    void createNeedsStaff() throws Exception {
        String body = objectMapper.writeValueAsString(request("ADMIN"));

        mockMvc.perform(post(BASE).contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(REFUSED);
        mockMvc.perform(post(BASE).contentType(MediaType.APPLICATION_JSON).content(body)
                .with(AnnouncementTestAuth.as(INSTITUTE, "student-1", "STUDENT"))).andExpect(REFUSED);
        mockMvc.perform(post(BASE).contentType(MediaType.APPLICATION_JSON).content(body)
                .with(AnnouncementTestAuth.admin("OTHER_INSTITUTE"))).andExpect(REFUSED);
        mockMvc.perform(post(BASE + "/multiple").contentType(MediaType.APPLICATION_JSON)
                .content("[" + body + "]")).andExpect(REFUSED);
    }

    @Test
    @DisplayName("create takes the creator from the token; a non-admin cannot claim ADMIN")
    void createTakesCreatorFromToken() throws Exception {
        var res = mockMvc.perform(post(BASE).contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request("ADMIN")))
                        .with(AnnouncementTestAuth.as(INSTITUTE, "teacher-9", "TEACHER")))
                .andExpect(status().isOk())
                .andReturn();
        var json = objectMapper.readTree(res.getResponse().getContentAsString());
        assertThat(json.get("createdBy").asText()).isEqualTo("teacher-9");
        assertThat(json.get("createdByRole").asText()).isEqualTo("TEACHER");
    }

    @Test
    @DisplayName("service creation needs the service credentials headers")
    void serviceCreateNeedsClientCredentials() throws Exception {
        String body = "[" + objectMapper.writeValueAsString(request("ADMIN")) + "]";
        mockMvc.perform(post(BASE + "/admin/multiple").contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(post(BASE + "/admin/multiple").contentType(MediaType.APPLICATION_JSON).content(body)
                        .header("clientName", "no_such_client").header("Signature", "wrong"))
                .andExpect(status().isUnauthorized());
        // A user token is not service credentials.
        mockMvc.perform(post(BASE + "/admin/multiple").contentType(MediaType.APPLICATION_JSON).content(body)
                        .with(AnnouncementTestAuth.admin(INSTITUTE)))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(get(BASE + "/admin/some-id/recovery-status")).andExpect(status().isUnauthorized());
    }

    @Test
    @DisplayName("user messages need a token and only serve the caller's own id")
    void userMessagesAreOwnOnly() throws Exception {
        String own = "/notification-service/v1/user-messages/user/learner-1/dashboard-pins";
        mockMvc.perform(get(own)).andExpect(REFUSED);
        mockMvc.perform(get(own).with(AnnouncementTestAuth.as(INSTITUTE, "learner-2", "STUDENT")))
                .andExpect(status().isForbidden());
        mockMvc.perform(get(own).with(AnnouncementTestAuth.as(INSTITUTE, "learner-1", "STUDENT")))
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", org.hamcrest.Matchers.containsString("private")));

        String read = "/notification-service/v1/user-messages/interactions/read";
        String body = objectMapper.writeValueAsString(Map.of(
                "recipientMessageId", "missing", "userId", "learner-1", "interactionType", "READ"));
        mockMvc.perform(post(read).contentType(MediaType.APPLICATION_JSON).content(body)).andExpect(REFUSED);
        mockMvc.perform(post(read).contentType(MediaType.APPLICATION_JSON).content(body)
                .with(AnnouncementTestAuth.as(INSTITUTE, "learner-2", "STUDENT"))).andExpect(status().isForbidden());
        // Someone else's (or no such) message: not found, nothing recorded.
        mockMvc.perform(post(read).contentType(MediaType.APPLICATION_JSON).content(body)
                .with(AnnouncementTestAuth.as(INSTITUTE, "learner-1", "STUDENT"))).andExpect(status().isNotFound());
    }

    @Test
    @DisplayName("history needs a staff login of that institute; a custom role counts as staff")
    void historyNeedsStaff() throws Exception {
        String list = BASE + "/institute/" + INSTITUTE;

        mockMvc.perform(get(list)).andExpect(REFUSED);
        mockMvc.perform(get(list).header("clientId", INSTITUTE)
                .with(user(principal("student-1", "STUDENT")))).andExpect(REFUSED);
        mockMvc.perform(get(list).header("clientId", "OTHER_INSTITUTE")
                .with(user(principal("admin-2", "ADMIN")))).andExpect(REFUSED);

        mockMvc.perform(get(list).header("clientId", INSTITUTE)
                .with(user(principal("ops-1", "Operations")))).andExpect(status().isOk());
        // Staff who are also enrolled as learners keep the access they have today.
        mockMvc.perform(get(list).header("clientId", INSTITUTE)
                .with(user(principal("teacher-2", "STUDENT", "TEACHER")))).andExpect(status().isOk());
    }

    @Test
    @DisplayName("stats and delete are refused to a learner and to another institute")
    void perAnnouncementNeedsOwningInstitute() throws Exception {
        String id = createAnnouncement();

        mockMvc.perform(get(BASE + "/" + id + "/stats")).andExpect(REFUSED);
        mockMvc.perform(get(BASE + "/" + id + "/stats").header("clientId", "OTHER_INSTITUTE")
                .with(user(principal("admin-2", "ADMIN")))).andExpect(REFUSED);
        mockMvc.perform(delete(BASE + "/" + id).header("clientId", INSTITUTE)
                .with(user(principal("student-1", "STUDENT")))).andExpect(REFUSED);

        mockMvc.perform(get(BASE + "/" + id + "/stats").header("clientId", INSTITUTE)
                .with(user(principal("ops-1", "Operations")))).andExpect(status().isOk());
    }

    @Test
    @DisplayName("approve/reject take the role from the token, not from approvedByRole")
    void approvalNeedsAdminToken() throws Exception {
        String id = createAnnouncement();

        mockMvc.perform(post(BASE + "/" + id + "/approve").param("approvedByRole", "ADMIN")
                .header("clientId", INSTITUTE).with(user(principal("teacher-1", "TEACHER"))))
                .andExpect(REFUSED);
        mockMvc.perform(post(BASE + "/" + id + "/reject").param("rejectedByRole", "ADMIN")
                .header("clientId", INSTITUTE).with(user(principal("ops-1", "Operations"))))
                .andExpect(REFUSED);

        mockMvc.perform(post(BASE + "/" + id + "/approve")
                .header("clientId", INSTITUTE).with(user(principal("admin-1", "ADMIN"))))
                .andExpect(NOT_REFUSED);
    }
}
