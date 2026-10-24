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
import vacademy.io.notification_service.features.announcements.dto.CreateAnnouncementRequest;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * The admin-dashboard announcement endpoints sit under a permitAll path (other services create
 * announcements without a user token), so they check the caller themselves: staff of the owning
 * institute for history/stats/delete, ADMIN for approve/reject — the role from the token, never
 * from the request.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class AnnouncementAccessApiTest {

    private static final String INSTITUTE = "INST_ACCESS";
    private static final String BASE = "/notification-service/v1/announcements";

    @Autowired private MockMvc mockMvc;
    @Autowired private ObjectMapper objectMapper;

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

    private String createAnnouncement() throws Exception {
        CreateAnnouncementRequest req = new CreateAnnouncementRequest();
        req.setTitle("Access");
        var content = new CreateAnnouncementRequest.RichTextDataRequest();
        content.setType("text");
        content.setContent("hello");
        req.setContent(content);
        req.setInstituteId(INSTITUTE);
        req.setCreatedBy("creator");
        req.setCreatedByRole("ADMIN");
        req.setTimezone("UTC");
        var recipient = new CreateAnnouncementRequest.RecipientRequest();
        recipient.setRecipientType("ROLE");
        recipient.setRecipientId("STUDENT");
        req.setRecipients(List.of(recipient));
        req.setModes(List.of(new CreateAnnouncementRequest.ModeRequest("SYSTEM_ALERT", Map.of("priority", "MEDIUM"))));
        // Creation stays open: services POST without a user token.
        var res = mockMvc.perform(post(BASE).contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(req)))
                .andExpect(status().isOk())
                .andReturn();
        return objectMapper.readTree(res.getResponse().getContentAsString()).get("id").asText();
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
