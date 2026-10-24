package vacademy.io.notification_service.features.announcements;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import vacademy.io.common.auth.dto.UserServiceDTO;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.notification_service.features.announcements.dto.CreateAnnouncementRequest;
import vacademy.io.notification_service.features.announcements.service.AnnouncementDeliveryService;
import vacademy.io.notification_service.features.announcements.service.RecipientResolutionService;

import java.util.List;
import java.util.Map;

import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class ExpandedAnnouncementApiTest {

    @Autowired private MockMvc mockMvc;
    @Autowired private ObjectMapper objectMapper;

    @MockBean private RecipientResolutionService recipientResolutionService;
    @MockBean private AnnouncementDeliveryService announcementDeliveryService;

    private static CustomUserDetails principal(String userId, String role) {
        UserServiceDTO dto = new UserServiceDTO();
        dto.setUserId(userId);
        dto.setUsername(userId + "@example.com");
        dto.setFullName(userId);
        dto.setAuthorities(List.of(role));
        return new CustomUserDetails(dto);
    }

    private String createAnnouncement() throws Exception {
        CreateAnnouncementRequest req = new CreateAnnouncementRequest();
        req.setTitle("AnnX");
        var content = new CreateAnnouncementRequest.RichTextDataRequest();
        content.setType("text");
        content.setContent("hello");
        req.setContent(content);
        req.setInstituteId("INST_X");
        req.setCreatedBy("CREATOR_X");
        req.setCreatedByRole("ADMIN");
        req.setTimezone("UTC");
        var recipient = new CreateAnnouncementRequest.RecipientRequest();
        recipient.setRecipientType("ROLE");
        recipient.setRecipientId("STUDENT");
        req.setRecipients(List.of(recipient));
        req.setModes(List.of(new CreateAnnouncementRequest.ModeRequest("SYSTEM_ALERT", Map.of("priority","MEDIUM"))));
        var medium = new CreateAnnouncementRequest.MediumRequest();
        medium.setMediumType("PUSH_NOTIFICATION");
        medium.setConfig(Map.of("title","t","body","b"));
        req.setMediums(List.of(medium));

        var res = mockMvc.perform(post("/notification-service/v1/announcements")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(req)))
                .andExpect(status().isOk())
                .andReturn();
        JsonNode json = objectMapper.readTree(res.getResponse().getContentAsString());
        return json.get("id").asText();
    }

    @Test
    @DisplayName("List, update status, stats, deliver, delete")
    void fullAnnouncementFlow() throws Exception {
        String id = createAnnouncement();

        // List by institute
        mockMvc.perform(get("/notification-service/v1/announcements/institute/INST_X").header("clientId", "INST_X").with(user(principal("admin-1", "ADMIN"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content").exists());

        // Update status
        mockMvc.perform(put("/notification-service/v1/announcements/" + id + "/status").header("clientId", "INST_X").with(user(principal("admin-1", "ADMIN")))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("status","ACTIVE"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("ACTIVE"));

        // Stats
        mockMvc.perform(get("/notification-service/v1/announcements/" + id + "/stats").header("clientId", "INST_X").with(user(principal("admin-1", "ADMIN"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalRecipients").exists());

        // Deliver (mock recipient resolution + delivery)
        Mockito.when(recipientResolutionService.resolveRecipientsToUsers(id))
                .thenReturn(List.of("USER_X"));
        Mockito.doNothing().when(announcementDeliveryService).deliverAnnouncement(id);

        mockMvc.perform(post("/notification-service/v1/announcements/" + id + "/deliver").header("clientId", "INST_X").with(user(principal("admin-1", "ADMIN"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.message").value("Announcement delivery initiated"));

        // Delete
        mockMvc.perform(delete("/notification-service/v1/announcements/" + id).header("clientId", "INST_X").with(user(principal("admin-1", "ADMIN"))))
                .andExpect(status().isNoContent());
    }
}
